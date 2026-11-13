// Module Jeu Libre & Revue de partie : Jeu vs Stockfish (600..2400 ELO), Pass & Play 2 joueurs,
// Jauge d'évaluation, Barre des prises, Historique et Analyse commentée coup par coup.
// Port fidèle de Play.kt et PlayScreen.kt (ChessDuck v1.6.0)

import { GameEnd, Line, Move, START_FEN } from '../chess.js';
import {
  COMPUTER_LABEL, GameLogic, MATE, ReviewComments, decodeAnalysis, encodeAnalysis,
  isMateScore, mateIn, winPercent,
} from '../review-comments.js';
import {
  COLORS, CapturedBarView, ChessBoardView, captureBadge, moveAnim, undoAnim,
} from '../board.js';
import {
  ModuleLayoutView, Tone, el, makeButton, makeChip, makeFeedbackCard, makeSectionTitle, moveLabel, sheets,
} from '../ui.js';

function evalLabel(ev) {
  if (isMateScore(ev)) {
    return `Mat en ${Math.max(1, Math.abs(mateIn(ev)))} pour les ${ev > 0 ? 'Blancs' : 'Noirs'}`;
  }
  const abs = (Math.abs(ev) / 100).toFixed(1).replace('.', ',');
  return (ev >= 0 ? '+' : '−') + abs;
}

export function annotationColor(a) {
  switch (a) {
    case '!!': return '#0EA5A4';
    case '!': return '#10B981';
    case '?!': return '#EAB308';
    case '?': return '#F97316';
    default: return '#EF4444';
  }
}

function formatDateFr(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class PlayModule {
  constructor({ prefs, userDb, engine, feedback }) {
    this.prefs = prefs;
    this.userDb = userDb;
    this.engine = engine;
    this.feedback = feedback;
    this.colors = prefs.get().dark ? COLORS.night : COLORS.day;
    this.active = false;

    this._aiAbort = null;
    this._aiGen = 0;
    this._preAbort = null;
    this._reviewTimer = null;
    this._analysisGen = 0;
    this._analysisGameId = -1;
    this._analysisCache = new Map();

    const st = prefs.get();
    this.state = {
      line: new Line(START_FEN),
      cursor: 0,
      playerWhite: true,
      twoPlayers: st.twoPlayers,
      aiElo: st.aiElo || 1200,
      flipped: false,
      anim: null,
      thinking: false,
      result: null,
      hintStage: 0,
      analysis: new Map(),
      evalOn: false,
      review: null,
    };

    this._buildDom();
    this.prefs.subscribe(() => this.render());
    this.userDb.subscribe(() => this.render());
    this.newGame();
  }

  get currentPos() {
    const cur = Math.max(0, Math.min(this.state.cursor, this.state.line.size));
    return this.state.line.positions[cur];
  }

  get canPlay() {
    const s = this.state;
    return !s.result && !s.thinking && !s.review && (s.twoPlayers || this.currentPos.whiteToMove === s.playerWhite);
  }

  get currentHint() {
    const a = this.state.analysis.get(this.state.cursor);
    if (!a || !a.best) return null;
    try { return Move.fromUci(a.best); } catch { return null; }
  }

  _buildDom() {
    this.layout = new ModuleLayoutView({ bottomMin: 150, hasEvalSlot: true, hasUnderBoard: true });
    this.root = this.layout.root;

    // En-tête Mode Jeu Libre
    this.headerName = el('div', { className: 'play-head-title' });
    this.headerSub = el('div', { className: 'play-head-sub' });
    const headLeft = el('div', { className: 'play-head-left' }, this.headerName, this.headerSub);
    this.histBtn = makeButton({ label: '📜 Historique', weight: 1, height: 38, feedback: this.feedback, onClick: () => this._openHistorySheet() });
    this.cfgBtn = makeButton({ label: '⚙️ Partie', weight: 0.8, height: 38, feedback: this.feedback, onClick: () => this._openGameSettingsSheet() });
    this.liveRow1 = el('div', { className: 'play-head-row' }, headLeft, this.histBtn, this.cfgBtn);

    this.liveFlipBtn = makeButton({ label: '⇅ Retourner', weight: 1, height: 36, feedback: this.feedback, onClick: () => this.flip() });
    this.liveHintBtn = makeButton({ label: '💡 Indice 1/2', accent: 'green', weight: 1, height: 36, feedback: this.feedback, onClick: () => this.hint() });
    this.liveEvalBtn = makeButton({ label: '📊 Évaluation OFF', accent: 'blue', weight: 1.2, height: 36, feedback: this.feedback, onClick: () => this.toggleEval() });
    this.liveRow2 = el('div', { className: 'equal-row v-pad-5' }, this.liveFlipBtn, this.liveHintBtn, this.liveEvalBtn);

    // En-tête Mode Revue
    this.revTitle = el('div', { className: 'play-head-title' });
    this.revSub = el('div', { className: 'play-head-sub' });
    const revLeft = el('div', { className: 'play-head-left' }, this.revTitle, this.revSub);
    this.revQuitBtn = makeButton({ label: '✕ Quitter la revue', accent: 'red', weight: 1, height: 38, feedback: this.feedback, onClick: () => this.closeReview() });
    this.revRow1 = el('div', { className: 'play-head-row hidden' }, revLeft, this.revQuitBtn);

    this.revFlipBtn = makeButton({ label: '⇅ Retourner', weight: 1, height: 36, feedback: this.feedback, onClick: () => this.flip() });
    this.revEvalBtn = makeButton({ label: '📊 Évaluation ON', accent: 'blue', filled: true, weight: 1.2, height: 36, feedback: this.feedback, onClick: () => this.toggleEval() });
    this.revRow2 = el('div', { className: 'equal-row v-pad-5 hidden' }, this.revFlipBtn, this.revEvalBtn);

    this.layout.topEl.append(this.liveRow1, this.liveRow2, this.revRow1, this.revRow2);

    // Échiquier + Barre des prises
    this.board = new ChessBoardView(this.layout.boardMount, {
      feedback: this.feedback,
      onMove: (m) => this.playerMove(m),
    });
    this.captured = new CapturedBarView(this.layout.underEl);
    this.layout.onBoardSize((side) => {
      this.board.resize(side);
      this.captured.resize(side);
    });

    // Bas : Bandeau des coups + FeedbackCard + Contrôles
    this.moveStrip = el('div', { className: 'move-strip' });
    this.feedbackCard = makeFeedbackCard();

    // Contrôles Jeu Libre
    this.liveBackBtn = makeButton({ label: '◀ Arrière', weight: 1, height: 44, feedback: this.feedback, onClick: () => this.back() });
    this.liveResignBtn = makeButton({ label: '🏳️ Abandon', accent: 'red', weight: 1.1, height: 44, feedback: this.feedback, onClick: () => this.resign() });
    this.liveNewBtn = makeButton({ label: '🆕 Nouvelle', accent: 'gold', weight: 1.3, height: 44, feedback: this.feedback, onClick: () => this.newGame() });
    this.liveFwdBtn = makeButton({ label: 'Avant ▶', weight: 1, height: 44, feedback: this.feedback, onClick: () => this.forward() });
    this.liveBottomRow = el('div', { className: 'equal-row v-pad-5' }, this.liveBackBtn, this.liveResignBtn, this.liveNewBtn, this.liveFwdBtn);

    // Contrôles Revue
    this.revFirstBtn = makeButton({ label: '⏮', weight: 1, height: 44, className: 'btn-icon', feedback: this.feedback, onClick: () => this.reviewFirst() });
    this.revPrevBtn = makeButton({ label: '◀', weight: 1, height: 44, className: 'btn-icon', feedback: this.feedback, onClick: () => this.reviewStep(-1) });
    this.revPlayBtn = makeButton({ label: '⏸ Pause', accent: 'blue', filled: true, weight: 1.6, height: 44, feedback: this.feedback, onClick: () => this.reviewToggle() });
    this.revNextBtn = makeButton({ label: '▶', weight: 1, height: 44, className: 'btn-icon', feedback: this.feedback, onClick: () => this.reviewStep(1) });
    this.revLastBtn = makeButton({ label: '⏭', weight: 1, height: 44, className: 'btn-icon', feedback: this.feedback, onClick: () => this.reviewLast() });
    this.revBottomRow = el('div', { className: 'equal-row v-pad-5 hidden' }, this.revFirstBtn, this.revPrevBtn, this.revPlayBtn, this.revNextBtn, this.revLastBtn);

    this.layout.bottomEl.append(this.moveStrip, this.feedbackCard, this.liveBottomRow, this.revBottomRow);
    this.render();
  }

  setActive(on) {
    this.active = on;
    if (on) requestAnimationFrame(() => this.layout.measure());
  }

  setColors(colors) {
    this.colors = colors;
    this.render();
  }

  applySettings(twoPlayers, colorChoice, aiElo) {
    this.prefs.update({ twoPlayers, colorChoice, aiElo });
    this.newGame();
  }

  newGame() {
    this._aiGen++;
    if (this._aiAbort) { this._aiAbort.abort(); this._aiAbort = null; }
    if (this._preAbort) { this._preAbort.abort(); this._preAbort = null; }

    const st = this.prefs.get();
    const white = st.colorChoice === 0 ? true : st.colorChoice === 2 ? false : Math.random() < 0.5;
    const playerWhite = st.twoPlayers || white;

    this.state = {
      ...this.state,
      line: new Line(START_FEN),
      cursor: 0,
      playerWhite,
      twoPlayers: st.twoPlayers,
      aiElo: st.aiElo || 1200,
      flipped: !playerWhite,
      anim: null,
      thinking: false,
      result: null,
      hintStage: 0,
      analysis: new Map(),
    };
    this.render();

    if (!st.twoPlayers && !playerWhite) this._aiMove();
    else this._precompute();
  }

  flip() {
    if (this.state.review) {
      this.state.review = { ...this.state.review, flipped: !this.state.review.flipped };
    } else {
      this.state.flipped = !this.state.flipped;
    }
    this.render();
  }

  toggleEval() {
    if (this.state.review) {
      this.state.review = { ...this.state.review, evalOn: !this.state.review.evalOn };
    } else {
      this.state.evalOn = !this.state.evalOn;
      this._precompute();
    }
    this.render();
    requestAnimationFrame(() => this.layout.measure());
  }

  hint() {
    if (!this.canPlay) return;
    this.state.hintStage = Math.min(2, this.state.hintStage + 1);
    this.render();
  }

  playerMove(m) {
    const s = this.state;
    const pos = this.currentPos;
    if (!this.canPlay || !pos.isLegal(m)) return;

    if (this._preAbort) { this._preAbort.abort(); this._preAbort = null; }
    const cur = s.cursor;
    const nl = s.line.copy(cur);
    nl.push(m);
    const trimmed = new Map();
    for (const [k, v] of s.analysis.entries()) {
      if (k <= cur) trimmed.set(k, v);
    }

    s.line = nl;
    s.cursor = nl.size;
    s.anim = moveAnim(pos, m);
    s.hintStage = 0;
    s.analysis = trimmed;
    this.render();
    this._afterMove();
  }

  _afterMove() {
    const s = this.state;
    const end = s.line.end();
    if (end !== GameEnd.NONE) {
      this._finish(end, null);
    } else if (!s.twoPlayers && s.line.last.whiteToMove !== s.playerWhite) {
      this._aiMove();
    } else {
      this._precompute();
    }
  }

  async _aiMove() {
    if (this._preAbort) { this._preAbort.abort(); this._preAbort = null; }
    if (this._aiAbort) { this._aiAbort.abort(); this._aiAbort = null; }

    const gen = ++this._aiGen;
    const ctrl = new AbortController();
    this._aiAbort = ctrl;
    const s = this.state;
    s.thinking = true;
    this.render();

    const t0 = performance.now();
    const pos = s.line.last;
    const elo = s.aiElo;
    let move = null;

    if (elo < 1350 && Math.random() < (1350 - elo) / 1500) {
      const r = await this.engine.search(pos.toFen(), 160, { multiPv: 30, depth: 4, signal: ctrl.signal });
      if (this._aiGen !== gen) return;
      const top = r.lines[0]?.score;
      if (top != null) {
        const cap = 150 + Math.floor((1350 - elo) * 1.2);
        const cands = r.lines.slice(1).filter((lv) => top - lv.score <= cap && pos.isLegal(lv.move));
        if (cands.length > 0) move = cands[Math.floor(Math.random() * cands.length)].move;
      }
    }

    if (!move && this._aiGen === gen) {
      const r = await this.engine.search(pos.toFen(), 220 + Math.floor(elo / 10), { elo: Math.max(1350, elo), signal: ctrl.signal });
      if (this._aiGen !== gen) return;
      move = r.best;
    }

    if (this._aiGen !== gen) return;
    if (!move || !pos.isLegal(move)) {
      const lm = pos.legalMoves;
      move = lm[Math.floor(Math.random() * lm.length)];
    }

    const waitMs = Math.max(0, 550 - (performance.now() - t0));
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    if (this._aiGen !== gen) return;

    this._aiAbort = null;
    const nl = this.state.line.copy();
    nl.push(move);
    this.state.line = nl;
    this.state.cursor = nl.size;
    this.state.anim = moveAnim(pos, move);
    this.state.thinking = false;
    this.state.hintStage = 0;
    this.render();

    const end = nl.end();
    if (end !== GameEnd.NONE) this._finish(end, null);
    else this._precompute();
  }

  async _analysePos(pos, ms, signal = null) {
    if (pos.legalMoves.length === 0) {
      return { eval: pos.inCheck ? (pos.whiteToMove ? -MATE : MATE) : 0, second: null, best: '' };
    }
    const r = await this.engine.search(pos.toFen(), ms, { multiPv: 2, signal });
    const first = r.lines[0];
    if (!first) return null;
    const sign = pos.whiteToMove ? 1 : -1;
    return {
      eval: sign * first.score,
      second: r.lines[1] ? sign * r.lines[1].score : null,
      best: first.move.uci,
    };
  }

  async _precompute() {
    const s = this.state;
    if (s.thinking || s.review || s.analysis.has(s.cursor)) return;
    if (this._preAbort) { this._preAbort.abort(); this._preAbort = null; }
    const ctrl = new AbortController();
    this._preAbort = ctrl;
    const ply = s.cursor;
    const line = s.line;
    const a = await this._analysePos(line.positions[ply], 450, ctrl.signal);
    if (this._preAbort === ctrl) this._preAbort = null;
    if (!a || this.state.line !== line) return;
    const next = new Map(this.state.analysis);
    next.set(ply, a);
    this.state.analysis = next;
    this.render();
  }

  back() {
    this._navigate(-1);
  }

  forward() {
    this._navigate(1);
  }

  _navigate(delta) {
    const s = this.state;
    if (s.thinking) return;
    const t = Math.max(0, Math.min(s.cursor + delta, s.line.size));
    if (t === s.cursor) return;
    s.anim = delta > 0 ? moveAnim(s.line.positions[s.cursor], s.line.moves[s.cursor]) : undoAnim(s.line.positions[t], s.line.moves[t]);
    s.cursor = t;
    s.hintStage = 0;
    this.render();
    this._precompute();
  }

  resign() {
    const s = this.state;
    if (s.result || s.review) return;
    this._aiGen++;
    if (this._aiAbort) { this._aiAbort.abort(); this._aiAbort = null; }
    s.thinking = false;
    this._finish(GameEnd.NONE, s.twoPlayers ? s.line.last.whiteToMove : s.playerWhite);
  }

  async _finish(end, resignedWhite) {
    const s = this.state;
    const line = s.line;
    const whiteResult = resignedWhite != null ? (resignedWhite ? -1 : 1) : (end === GameEnd.CHECKMATE ? (line.last.whiteToMove ? -1 : 1) : 0);
    const reason = resignedWhite != null ? 'abandon' : GameLogic.endText(end);
    const resultStr = whiteResult === 1 ? '1-0' : whiteResult === -1 ? '0-1' : '1/2-1/2';

    if (line.size < 2) {
      s.result = { text: "Partie interrompue avant le premier échange : rien n'est enregistré.", tone: Tone.NEUTRAL };
      s.thinking = false;
      this.render();
      return;
    }

    const st = this.prefs.get();
    const encoded = encodeAnalysis(Array.from({ length: line.size + 1 }, (_, i) => s.analysis.get(i) || null));

    if (s.twoPlayers) {
      let msg;
      if (whiteResult === 1) msg = `🏆 Victoire de ${st.pseudo} (Blancs) par ${reason}.`;
      else if (whiteResult === -1) msg = `🏆 Victoire de ${st.pseudo2} (Noirs) par ${reason}.`;
      else msg = `🤝 Partie nulle (${reason}).`;
      s.result = { text: `${msg} Partie à 2 joueurs : l'ELO ne change pas.`, tone: Tone.GOLD };
      s.thinking = false;
      this.render();

      const saved = await this.userDb.insertGame({
        date: Date.now(),
        opponent: '2 joueurs',
        vsComputer: false,
        playerWhite: true,
        result: resultStr,
        outcome: whiteResult,
        reason,
        eloBefore: st.elo,
        eloAfter: st.elo,
        moves: line.uciMoves(),
        analysis: encoded,
        whiteName: st.pseudo,
        blackName: st.pseudo2,
        opponentElo: 0,
      });
      this._startAnalysis(saved, line);
    } else {
      const outcome = s.playerWhite ? whiteResult : -whiteResult;
      const newElo = GameLogic.newElo(st.elo, s.aiElo, (outcome + 1) / 2);
      const diff = newElo - st.elo;
      const delta = diff >= 0 ? `+${diff}` : `−${-diff}`;
      const head = outcome === 1 ? `🏆 Victoire par ${reason} !` : outcome === -1 ? `Défaite par ${reason}.` : `🤝 Partie nulle (${reason}).`;
      s.thinking = false;
      s.result = {
        text: `${head} ELO ${st.elo} → ${newElo} (${delta}). Revoyez la partie dans 📜 Historique.`,
        tone: outcome === 1 ? Tone.GOOD : outcome === 0 ? Tone.GOLD : Tone.BAD,
      };
      this.prefs.update({ elo: newElo });
      this.render();

      const saved = await this.userDb.insertGame({
        date: Date.now(),
        opponent: `Ordinateur ${s.aiElo}`,
        vsComputer: true,
        playerWhite: s.playerWhite,
        result: resultStr,
        outcome,
        reason,
        eloBefore: st.elo,
        eloAfter: newElo,
        moves: line.uciMoves(),
        analysis: encoded,
        whiteName: s.playerWhite ? st.pseudo : COMPUTER_LABEL,
        blackName: s.playerWhite ? COMPUTER_LABEL : st.pseudo,
        opponentElo: s.aiElo,
      });
      this._startAnalysis(saved, line);
    }
  }

  // ---- Analyse & Revue de partie ----

  async _startAnalysis(g, line) {
    const gen = ++this._analysisGen;
    this._analysisGameId = g.id;
    const list = (this._analysisCache.get(g.id) || decodeAnalysis(g.analysis, line.size + 1)).slice();
    this._analysisCache.set(g.id, list.slice());
    let changed = false;

    try {
      for (let i = 0; i <= line.size; i++) {
        if (this._analysisGen !== gen) return;
        const ex = list[i];
        if (ex && (ex.second != null || ex.best === '')) continue;
        const a = await this._analysePos(line.positions[i], 110);
        if (this._analysisGen !== gen) return;
        if (!a) continue;
        list[i] = a;
        changed = true;
        const snap = list.slice();
        this._analysisCache.set(g.id, snap);
        if (this.state.review && this.state.review.record.id === g.id) {
          this.state.review = { ...this.state.review, analysis: snap };
          this.render();
        }
      }
    } finally {
      if (changed) {
        this.userDb.saveAnalysis(g.id, encodeAnalysis(list)).catch(() => {});
      }
    }
  }

  openReview(g) {
    clearTimeout(this._reviewTimer);
    let line;
    try {
      line = Line.fromUci(START_FEN, g.moves);
    } catch {
      return;
    }
    const analysis = this._analysisCache.get(g.id) || decodeAnalysis(g.analysis, line.size + 1);
    this.state.review = {
      record: g,
      line,
      cursor: 0,
      playing: true,
      analysis,
      flipped: g.vsComputer && !g.playerWhite,
      evalOn: true,
      anim: null,
    };
    this.render();
    requestAnimationFrame(() => this.layout.measure());
    this._autoplay();
    this._startAnalysis(g, line);
  }

  _autoplay() {
    clearTimeout(this._reviewTimer);
    const step = () => {
      this._reviewTimer = setTimeout(() => {
        const r = this.state.review;
        if (!r || !r.playing) return;
        if (r.cursor >= r.line.size) {
          this.state.review = { ...r, playing: false };
          this.render();
          return;
        }
        this._reviewGo(r.cursor + 1);
        if (this.state.review && this.state.review.playing && this.state.review.cursor < this.state.review.line.size) {
          step();
        } else if (this.state.review) {
          this.state.review = { ...this.state.review, playing: false };
          this.render();
        }
      }, 1150);
    };
    step();
  }

  _reviewGo(target) {
    const r = this.state.review;
    if (!r) return;
    const t = Math.max(0, Math.min(target, r.line.size));
    if (t === r.cursor) return;
    let anim = null;
    if (t === r.cursor + 1) anim = moveAnim(r.line.positions[r.cursor], r.line.moves[r.cursor]);
    else if (t === r.cursor - 1) anim = undoAnim(r.line.positions[t], r.line.moves[t]);
    this.state.review = { ...r, cursor: t, anim };
    this.render();
  }

  reviewPause() {
    clearTimeout(this._reviewTimer);
    if (this.state.review) {
      this.state.review = { ...this.state.review, playing: false };
      this.render();
    }
  }

  reviewToggle() {
    const r = this.state.review;
    if (!r) return;
    if (r.playing) return this.reviewPause();
    if (r.cursor >= r.line.size) this._reviewGo(0);
    this.state.review = { ...this.state.review, playing: true };
    this.render();
    this._autoplay();
  }

  reviewStep(delta) {
    this.reviewPause();
    this._reviewGo((this.state.review?.cursor || 0) + delta);
  }

  reviewFirst() {
    this.reviewPause();
    this._reviewGo(0);
  }

  reviewLast() {
    this.reviewPause();
    this._reviewGo(Number.MAX_SAFE_INTEGER);
  }

  closeReview() {
    clearTimeout(this._reviewTimer);
    this.state.review = null;
    this.render();
    requestAnimationFrame(() => this.layout.measure());
  }

  _liveStatus() {
    const s = this.state;
    const st = this.prefs.get();
    const pos = this.currentPos;
    const side = pos.whiteToMove ? 'Blancs' : 'Noirs';
    if (s.result) {
      const prefix = s.cursor < s.line.size ? `⏪ Coup ${s.cursor} / ${s.line.size}. ` : '';
      return [prefix + s.result.text, s.result.tone];
    }
    if (s.thinking) return [`🤖 L'ordinateur (${s.aiElo} ELO) réfléchit…`, Tone.NEUTRAL];

    const a = s.analysis.get(s.cursor);
    const evalNote = s.evalOn && a ? ` Évaluation : ${evalLabel(a.eval)}.` : '';
    if (this.canPlay && s.hintStage > 0) {
      const h = this.currentHint;
      if (!h) return ['💡 Calcul en cours, l\'indice s\'affiche dans un instant…', Tone.GOLD];
      return s.hintStage === 1
        ? ['💡 Indice 1/2 : la pièce à jouer est surlignée en vert. Touchez encore pour voir le coup.', Tone.GOLD]
        : [`💡 Indice 2/2 : coup suggéré ${pos.san(h)}.${evalNote}`, Tone.GOLD];
    }
    if (s.cursor < s.line.size) {
      return this.canPlay
        ? [`⏪ Coup ${s.cursor} / ${s.line.size} — trait aux ${side}. Jouez un autre coup ici pour reprendre la partie depuis cette position.${evalNote}`, Tone.INFO]
        : [`⏪ Coup ${s.cursor} / ${s.line.size}. Reculez ou avancez jusqu'à votre tour pour rejouer depuis ce moment.${evalNote}`, Tone.INFO];
    }
    const check = pos.inCheck ? 'Échec ! ' : '';
    if (s.twoPlayers) return [`${check}👥 À ${pos.whiteToMove ? st.pseudo : st.pseudo2} de jouer (les ${side}).${evalNote}`, Tone.INFO];
    if (s.line.size === 0) return [`⚔️ Nouvelle partie contre l'ordinateur (${s.aiElo} ELO). Vous jouez les ${side} : à vous de commencer !${evalNote}`, Tone.INFO];
    return [`${check}À vous de jouer (les ${side}).${evalNote}`, Tone.INFO];
  }

  _renderMoveStrip(line, cursor) {
    this.moveStrip.innerHTML = '';
    if (line.size === 0) {
      this.moveStrip.appendChild(el('span', { className: 'move-strip-empty' }, 'Les coups de la partie s’afficheront ici.'));
      return;
    }
    let activePill = null;
    for (let i = 0; i < line.size; i++) {
      const before = line.positions[i];
      const current = i === cursor - 1;
      const pill = el('span', {
        className: `move-pill ${current ? 'is-current' : ''} ${before.whiteToMove ? 'is-white' : 'is-black'}`,
      }, `${before.whiteToMove ? `${before.fullmove}. ` : ''}${line.sans[i]}`);
      if (current) activePill = pill;
      this.moveStrip.appendChild(pill);
    }
    if (activePill) {
      const target = activePill.offsetLeft - this.moveStrip.clientWidth / 2 + activePill.offsetWidth / 2;
      this.moveStrip.scrollLeft = Math.max(0, target);
    }
  }

  _openHistorySheet() {
    let pendingDelete = -1;
    sheets.open({
      title: '📜 Historique des parties',
      onBuild: (body, modal) => {
        const renderList = () => {
          body.innerHTML = '';
          const games = this.userDb.games;
          if (games.length === 0) {
            body.appendChild(
              el('div', { className: 'empty-sheet-msg' },
                "Aucune partie pour l'instant. Terminez une partie en Jeu Libre : elle apparaîtra ici avec sa revue commentée."),
            );
            return;
          }
          for (const g of games) {
            let outcomeLabel, outcomeCls;
            if (!g.vsComputer) {
              outcomeLabel = g.outcome === 1 ? `Victoire de ${g.whiteName || 'Blancs'}` : g.outcome === -1 ? `Victoire de ${g.blackName || 'Noirs'}` : 'Nulle';
              outcomeCls = 'is-gold';
            } else if (g.outcome === 1) {
              outcomeLabel = 'Victoire'; outcomeCls = 'is-green';
            } else if (g.outcome === -1) {
              outcomeLabel = 'Défaite'; outcomeCls = 'is-red';
            } else {
              outcomeLabel = 'Nulle'; outcomeCls = 'is-gold';
            }

            let eloPill = null;
            if (g.vsComputer) {
              const d = g.eloAfter - g.eloBefore;
              eloPill = el('span', { className: `hist-elo ${d >= 0 ? 'is-up' : 'is-down'}` }, `ELO ${g.eloAfter} (${d >= 0 ? `+${d}` : `−${-d}`})`);
            }

            const delIcon = el('button', {
              type: 'button',
              className: 'hist-del-btn',
              'aria-label': 'Supprimer',
              onClick: () => {
                this.feedback?.key();
                pendingDelete = pendingDelete === g.id ? -1 : g.id;
                renderList();
              },
            }, '🗑');

            const nbMoves = Math.floor(((g.moves ? g.moves.split(' ').length : 0) + 1) / 2);
            let playersTxt;
            if (!g.whiteName) {
              playersTxt = `contre ${String(g.opponent || '').replace('Stockfish', 'Ordinateur')}${g.vsComputer ? ` · avec les ${g.playerWhite ? 'Blancs' : 'Noirs'}` : ''}`;
            } else if (g.vsComputer) {
              const me = `(${g.eloBefore})`;
              const ai = `(${g.opponentElo})`;
              playersTxt = `⬜ ${g.whiteName} ${g.playerWhite ? me : ai}  –  ⬛ ${g.blackName} ${g.playerWhite ? ai : me}`;
            } else {
              playersTxt = `⬜ ${g.whiteName}  –  ⬛ ${g.blackName} · hors ELO`;
            }

            const card = el('div', { className: 'hist-card' },
              el('div', { className: 'hist-top' },
                el('span', { className: `hist-outcome ${outcomeCls}` }, outcomeLabel),
                eloPill,
                delIcon,
              ),
              el('div', { className: 'hist-players' }, playersTxt),
              el('div', { className: 'hist-meta' }, `${formatDateFr(g.date)} · ${g.result} par ${g.reason} · ${nbMoves} coups`),
            );

            if (pendingDelete === g.id) {
              card.appendChild(
                el('div', { className: 'hist-confirm-txt' }, "Supprimer définitivement cette partie de l'historique ?"),
              );
              card.appendChild(
                el('div', { className: 'equal-row' },
                  makeButton({ label: 'Annuler', height: 38, weight: 1, feedback: this.feedback, onClick: () => { pendingDelete = -1; renderList(); } }),
                  makeButton({ label: '🗑 Supprimer', accent: 'red', filled: true, height: 38, weight: 1, feedback: this.feedback, onClick: async () => { pendingDelete = -1; await this.userDb.deleteGame(g.id); renderList(); } }),
                ),
              );
            } else {
              card.appendChild(
                makeButton({
                  label: 'Rejouer sur l’échiquier',
                  accent: 'blue',
                  filled: true,
                  height: 38,
                  weight: 1,
                  feedback: this.feedback,
                  onClick: () => {
                    modal.close();
                    this.openReview(g);
                  },
                }),
              );
            }
            body.appendChild(card);
          }
        };

        renderList();
        const unsub = this.userDb.subscribe(() => {
          if (!document.body.contains(body)) { unsub(); return; }
          renderList();
        });
      },
    });
  }

  _openGameSettingsSheet() {
    const st = this.prefs.get();
    let two = st.twoPlayers;
    let col = st.colorChoice;
    let elo = st.aiElo || 1200;

    sheets.open({
      title: '⚙️ Paramètres de partie',
      onBuild: (body, modal) => {
        const cpuSection = el('div');
        const modeRow = el('div', { className: 'chips-row' });
        const modeChips = [
          makeChip({ label: "🤖 Contre l'ordinateur", selected: !two, feedback: this.feedback, onClick: () => { two = false; sync(); } }),
          makeChip({ label: '👥 2 joueurs (Pass & Play)', selected: two, feedback: this.feedback, onClick: () => { two = true; sync(); } }),
        ];
        modeRow.append(...modeChips);

        const colRow = el('div', { className: 'chips-row' });
        const colChips = [
          makeChip({ label: '⬜ Blancs', selected: col === 0, feedback: this.feedback, onClick: () => { col = 0; sync(); } }),
          makeChip({ label: '🎲 Aléatoire', selected: col === 1, feedback: this.feedback, onClick: () => { col = 1; sync(); } }),
          makeChip({ label: '⬛ Noirs', selected: col === 2, feedback: this.feedback, onClick: () => { col = 2; sync(); } }),
        ];
        colRow.append(...colChips);

        const eloTitle = makeSectionTitle(`NIVEAU DE L'ORDINATEUR : ${elo} ELO`);
        const slider = el('input', {
          type: 'range',
          className: 'duck-slider',
          min: '600',
          max: '2400',
          step: '50',
          value: String(elo),
          onInput: (e) => {
            elo = Number.parseInt(e.target.value, 10);
            eloTitle.textContent = `NIVEAU DE L'ORDINATEUR : ${elo} ELO`;
          },
        });
        const rangeLabels = el('div', { className: 'slider-labels' }, el('span', null, '600 · débutant'), el('span', null, '2400 · maître'));
        cpuSection.append(makeSectionTitle('VOTRE COULEUR'), colRow, eloTitle, slider, rangeLabels);

        const sync = () => {
          modeChips[0].setSelected(!two);
          modeChips[1].setSelected(two);
          colChips.forEach((cEl, i) => cEl.setSelected(col === i));
          cpuSection.classList.toggle('hidden', two);
        };
        sync();

        const startBtn = makeButton({
          label: 'Lancer une nouvelle partie',
          accent: 'gold',
          filled: true,
          height: 46,
          weight: 1,
          className: 'full-btn top-gap-lg',
          feedback: this.feedback,
          onClick: () => {
            modal.close();
            this.applySettings(two, col, elo);
          },
        });
        const note = el('div', { className: 'sheet-footnote' }, 'Le pseudo et le thème se règlent dans ⚙️ Paramètres, en haut à droite.');

        body.append(makeSectionTitle('MODE DE JEU'), modeRow, cpuSection, startBtn, note);
      },
    });
  }

  render() {
    const s = this.state;
    const st = this.prefs.get();
    const c = this.colors;
    const r = s.review;
    const inReview = !!r;

    this.liveRow1.classList.toggle('hidden', inReview);
    this.liveRow2.classList.toggle('hidden', inReview);
    this.liveBottomRow.classList.toggle('hidden', inReview);
    this.revRow1.classList.toggle('hidden', !inReview);
    this.revRow2.classList.toggle('hidden', !inReview);
    this.revBottomRow.classList.toggle('hidden', !inReview);

    if (inReview) {
      const line = r.line;
      const cur = Math.max(0, Math.min(r.cursor, line.size));
      const g = r.record;
      const last = cur > 0 ? line.moves[cur - 1] : null;
      const note = last
        ? GameLogic.annotate(line.positions[cur - 1], last, r.analysis[cur - 1] || null, r.analysis[cur] || null, cur > 1 ? line.moves[cur - 2] : null)
        : null;

      this.revTitle.textContent = `📜 Revue : ${!g.whiteName ? String(g.opponent || '').replace('Stockfish', 'Ordinateur') : `${g.whiteName} – ${g.blackName}`}`;
      this.revSub.textContent = `${formatDateFr(g.date)} · ${g.result} (${g.reason})`;
      this.revEvalBtn.setConfig({ label: r.evalOn ? '📊 Évaluation ON' : '📊 Évaluation OFF', filled: r.evalOn });

      let known = r.analysis[cur] || null;
      if (!known) {
        for (let i = cur; i >= 0; i--) { if (r.analysis[i]) { known = r.analysis[i]; break; } }
      }
      this.layout.evalBar.setState({
        visible: r.evalOn,
        whiteShare: winPercent(known?.eval ?? 0) / 100,
        flipped: r.flipped,
      });

      const badges = [];
      if (last) {
        if (note) badges.push({ sq: last.to, text: note, color: annotationColor(note) });
        const cb = captureBadge(line.positions[cur - 1], last);
        if (cb) badges.push(cb);
      }

      this.board.setState({
        position: line.positions[cur],
        colors: c,
        flipped: r.flipped,
        interactive: false,
        lastMove: last,
        anim: r.anim,
        arrows: [],
        marks: [],
        badges,
      });
      this.captured.setState({ position: line.positions[cur], colors: c, kid: false });
      this._renderMoveStrip(line, cur);

      const ready = r.analysis.filter(Boolean).length;
      let text, tone;
      if (cur === 0) {
        const missed = [];
        for (let i = 1; i <= line.size; i++) {
          const k = GameLogic.missedMate(line.positions[i - 1].whiteToMove, r.analysis[i - 1] || null, r.analysis[i] || null);
          if (k != null) missed.push(`coup ${i} (mat en ${k})`);
        }
        text = "Position initiale. La partie se déroule automatiquement : ⏸ pour l'arrêter, ◀ ▶ pour naviguer."
          + (missed.length > 0 ? ` ⚠️ Mats manqués : ${missed.join(', ')}.` : '')
          + (ready <= line.size ? ` Analyse des coups : ${ready} / ${line.size + 1}…` : '');
        tone = Tone.INFO;
      } else {
        const [c0, t0] = ReviewComments.comment(g, line, cur - 1, r.analysis);
        text = c0 + (cur === line.size ? ` ${ReviewComments.ending(g)}` : '');
        tone = t0;
      }
      const title = cur === 0
        ? `Coup 0 / ${line.size}`
        : `Coup ${cur} / ${line.size} · ${moveLabel(line.positions[cur - 1].fullmove, line.positions[cur - 1].whiteToMove, line.sans[cur - 1])}${note ? ` ${note}` : ''}`;

      this.feedbackCard.setState(text, tone, title);
      this.revFirstBtn.setConfig({ enabled: cur > 0 });
      this.revPrevBtn.setConfig({ enabled: cur > 0 });
      this.revPlayBtn.setConfig({ label: r.playing ? '⏸ Pause' : '▶ Lecture' });
      this.revNextBtn.setConfig({ enabled: cur < line.size });
      this.revLastBtn.setConfig({ enabled: cur < line.size });
      return;
    }

    // Mode Jeu Libre
    const { w, d, l } = this.userDb.tally();
    this.headerName.textContent = s.twoPlayers ? `👥 ${st.pseudo} – ${st.pseudo2}` : `👤 ${st.pseudo} · ELO ${st.elo}`;
    this.headerSub.textContent = s.twoPlayers ? `⬜ ${st.pseudo} · ⬛ ${st.pseudo2} · hors ELO` : `Bilan ${w}V / ${d}N / ${l}D · 🤖 Ordinateur ${s.aiElo}`;

    this.liveHintBtn.setConfig({ label: `💡 Indice ${Math.min(2, s.hintStage + 1)}/2`, enabled: this.canPlay });
    this.liveEvalBtn.setConfig({ label: s.evalOn ? '📊 Évaluation ON' : '📊 Évaluation OFF', filled: s.evalOn });

    const cur = s.cursor;
    const pos = this.currentPos;
    const last = cur > 0 ? s.line.moves[cur - 1] : null;
    const hint = this.canPlay ? this.currentHint : null;

    let known = s.analysis.get(cur) || null;
    if (!known) {
      for (let i = cur; i >= 0; i--) { if (s.analysis.has(i)) { known = s.analysis.get(i); break; } }
    }
    this.layout.evalBar.setState({
      visible: s.evalOn,
      whiteShare: winPercent(known?.eval ?? 0) / 100,
      flipped: s.flipped,
    });

    this.board.setState({
      position: pos,
      colors: c,
      flipped: s.flipped,
      interactive: this.canPlay,
      lastMove: last,
      anim: s.anim,
      arrows: hint && s.hintStage >= 2 ? [{ from: hint.from, to: hint.to, color: c.green }] : [],
      marks: hint && s.hintStage >= 1 ? [[hint.from, c.green]] : [],
      badges: last ? [captureBadge(s.line.positions[cur - 1], last)].filter(Boolean) : [],
    });

    this.captured.setState({ position: pos, colors: c, kid: false });
    this._renderMoveStrip(s.line, cur);

    const [msg, tone] = this._liveStatus();
    this.feedbackCard.setState(msg, tone);

    this.liveBackBtn.setConfig({ enabled: cur > 0 && !s.thinking });
    this.liveFwdBtn.setConfig({ enabled: cur < s.line.size && !s.thinking });
    this.liveResignBtn.classList.toggle('hidden', !!s.result);
    if (!s.result) this.liveResignBtn.setConfig({ enabled: s.line.size > 0 });
    this.liveNewBtn.setConfig({ filled: !!s.result });
  }
}
