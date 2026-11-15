import { GameEnd, Line, Move, START_FEN } from '../core/chess.js';
import { db } from '../data/db.js';
import { prefs } from '../data/prefs.js';
import { ChessBoardView, EvalBarView } from '../ui/board.js';
import { PlayerBarView } from '../ui/captured.js';
import {
    FeedbackCardView, ModuleLayoutView, MoveStripView, Tone,
    duckButton, duckIconButton, el, openConfirmDialog, stepTitle,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { LinePlaybackController, moveAnim, undoAnim } from '../ui/line-playback.js';
import { isTwoPane } from '../ui/theme.js';
import { GameAnalysisService } from './game-analysis.js';
import { Analysis, GameLogic } from './game-logic.js';
import { formatDate, openGameSettingsSheet, openHistorySheet } from './history-sheet.js';
import { ReviewComments } from './review-comments.js';

export const COMPUTER = '🤖 Ordinateur';

const NOTES = ['!!', '!', '?!', '?', '??'];
const NOTE_NAMES = {
    '!!': 'brillant',
    '!': 'très bon',
    '?!': 'imprécision',
    '?': 'erreur',
    '??': 'gaffe',
};

export function annotationColor(a) {
    if (a === '!!') return '#0F766E';
    if (a === '!') return '#047857';
    if (a === '?!') return '#A16207';
    if (a === '?') return '#C2410C';
    return '#B91C1C';
}

export class PlayFeature {
    constructor(engine) {
        this.engine = engine;
        this.analyzer = new GameAnalysisService(engine, db);
        this.el = el('div', 'feature-root');

        this._palette = null;
        this._showCoords = true;
        this._destroyed = false;

        this._gameGeneration = 0;
        this._aiAbort = null;
        this._aiTimer = null;
        this._precomputeAbort = null;

        this.settings = prefs.current;
        this.games = db.games;
        this.tally = db.getTally();

        this.state = {
            line: new Line(START_FEN),
            cursor: 0,
            playerWhite: true,
            twoPlayers: false,
            aiElo: 1200,
            flipped: false,
            anim: null,
            thinking: false,
            result: null,
            hintStage: 0,
            analysis: new Map(),
            evalOn: false,
            lastRecord: null,
        };

        this.review = null; // { record, line, cursor, playing, analysis, flipped, evalOn, anim }
        this._revPlayback = new LinePlaybackController();
        this._noteCache = new Map();
        this._cachedLineRef = null;

        this._buildLiveDom();
        this._buildReviewDom();
        this.el.append(this.liveLayout.el, this.reviewLayout.el);
        this.reviewLayout.el.classList.add('hidden');

        this._unsubPrefs = prefs.subscribe((st) => {
            if (this._destroyed) return;
            this.settings = st;
            this._renderLive();
        });
        this._unsubGames = db.subscribeGames((list) => {
            if (this._destroyed) return;
            this.games = list;
            this.tally = db.getTally();
            if (this.review) {
                const updated = list.find((g) => g.id === this.review.record.id);
                if (updated) this.review.record = updated;
            }
            this._renderLive();
        });
        this._unsubAnalyses = this.analyzer.subscribe((map) => {
            if (this._destroyed) return;
            if (this.review && map.has(this.review.record.id)) {
                this.review.analysis = map.get(this.review.record.id);
                this._renderReview();
            }
        });

        this._onWindowResize = () => {
            if (this.review) this._renderReview();
        };
        window.addEventListener('resize', this._onWindowResize);

        db.initUserState().catch(() => {});
        this._startGameFromSettings(prefs.current);
    }

    destroy() {
        this._destroyed = true;
        this._aiAbort?.abort();
        if (this._aiTimer) clearTimeout(this._aiTimer);
        this._precomputeAbort?.abort();
        this._revPlayback.cancel();
        window.removeEventListener('resize', this._onWindowResize);
        this._unsubPrefs?.();
        this._unsubGames?.();
        this._unsubAnalyses?.();
        this.liveBoard.destroy();
        this.overBar.destroy();
        this.underBar.destroy();
        this.liveFeedback.destroy();
        this.liveLayout.destroy();
        this.revBoard.destroy();
        this.revOverBar.destroy();
        this.revUnderBar.destroy();
        this.revFeedback.destroy();
        this.reviewLayout.destroy();
    }

    setThemeAndCoords(palette, showCoords) {
        this._palette = palette;
        this._showCoords = showCoords;
        if (this.review) this._renderReviewBoard();
        else this._renderLiveBoard();
    }

    onActivate() {
        if (this.review) {
            this.reviewLayout.relayout();
            this.revBoard._syncCanvasSize();
            this.revBoard.draw();
        } else {
            this.liveLayout.relayout();
            this.liveBoard._syncCanvasSize();
            this.liveBoard.draw();
        }
    }

    get inReview() {
        return this.review !== null;
    }

    // ---- Helpers d'état LiveGame ----

    get currentPosition() {
        const s = this.state;
        return s.line.positions[Math.max(0, Math.min(s.line.size, s.cursor))];
    }

    get canPlay() {
        const s = this.state;
        return s.result === null && !s.thinking && (s.twoPlayers || this.currentPosition.whiteToMove === s.playerWhite);
    }

    get inProgress() {
        const s = this.state;
        return s.result === null && s.line.size >= 2;
    }

    get currentHint() {
        const s = this.state;
        const a = s.analysis.get(s.cursor);
        return a && a.best ? Move.fromUci(a.best) : null;
    }

    undoTarget() {
        const s = this.state;
        if (s.thinking || s.result !== null || s.cursor === 0) return -1;
        if (s.twoPlayers) return s.cursor - 1;
        let t = s.cursor - 1;
        while (t >= 0 && s.line.positions[t].whiteToMove !== s.playerWhite) t--;
        return t;
    }

    // ---- DOM LiveGame ----

    _buildLiveDom() {
        this.liveLayout = new ModuleLayoutView({ bottomMin: 170 });
        this.liveEvalBar = new EvalBarView();
        this.liveEvalBar.el.classList.add('hidden');
        this.liveBoard = new ChessBoardView();
        this.liveBoardRow = el('div', 'board-row');
        this.liveBoardRow.append(this.liveEvalBar.el, this.liveBoard.el);

        this.overBar = new PlayerBarView();
        this.underBar = new PlayerBarView();
        this.liveMoveStrip = new MoveStripView();
        this.liveFeedback = new FeedbackCardView();

        this.liveTopBar = el('div', 'play-top-bar');
        this.liveModeIcon = el('span', 'play-mode-icon');
        this.liveTitleCol = el('div', 'play-title-col');
        this.liveTitleEl = el('div', 'play-title', '');
        this.liveSubEl = el('div', 'play-subtitle', '');
        this.liveTitleCol.append(this.liveTitleEl, this.liveSubEl);

        this.liveFlipBtn = duckIconButton({ icon: 'SwapVert', ariaLabel: "Retourner l'échiquier", onClick: () => this.flip() });
        this.liveEvalBtn = duckIconButton({ icon: 'Insights', ariaLabel: "Jauge d'évaluation", accent: 'blue', selected: false, onClick: () => this.toggleEval() });
        this.liveHistBtn = duckIconButton({ icon: 'History', ariaLabel: 'Historique des parties', onClick: () => this._openHistory() });
        this.liveTuneBtn = duckIconButton({ icon: 'Tune', ariaLabel: 'Paramètres de partie', onClick: () => this._openGameSettings() });
        this.liveTopBar.append(this.liveModeIcon, this.liveTitleCol, this.liveFlipBtn, this.liveEvalBtn, this.liveHistBtn, this.liveTuneBtn);

        this.liveLayout.topSlot.appendChild(this.liveTopBar);
        this.liveLayout.overSlot.appendChild(this.overBar.el);
        this.liveLayout.boardHost.appendChild(this.liveBoardRow);
        this.liveLayout.underSlot.appendChild(this.underBar.el);

        this.liveActions = el('div', 'equal-row play-actions');
        this.liveLayout.bottomSlot.append(this.liveMoveStrip.el, this.liveFeedback.el, this.liveActions);
    }

    _openHistory() {
        openHistorySheet({
            games: this.games,
            subscribeGames: (fn) => db.subscribeGames(fn),
            onDelete: (id) => this.deleteGame(id),
            onReplay: (g) => this.openReview(g),
        });
    }

    _openGameSettings() {
        const st = prefs.current;
        openGameSettingsSheet({
            twoPlayers: st.twoPlayers,
            colorChoice: st.colorChoice,
            aiElo: st.aiElo,
            onApply: (two, color, elo) => this.applySettings(two, color, elo),
        });
    }

    // ---- Actions LiveGame ----

    applySettings(twoPlayers, color, aiElo) {
        prefs.setGameSettings(twoPlayers, color, aiElo);
        this._startGameFromSettings(prefs.current);
    }

    newGame() {
        this._startGameFromSettings(prefs.current);
    }

    _startGameFromSettings(st) {
        this._gameGeneration++;
        this._aiAbort?.abort();
        this._aiAbort = null;
        if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; }
        this._precomputeAbort?.abort();
        this._precomputeAbort = null;

        let white;
        if (st.colorChoice === 0) white = true;
        else if (st.colorChoice === 2) white = false;
        else white = Math.random() < 0.5;
        const playerWhite = st.twoPlayers || white;

        this.state = {
            line: new Line(START_FEN),
            cursor: 0,
            playerWhite,
            twoPlayers: Boolean(st.twoPlayers),
            aiElo: st.aiElo,
            flipped: !playerWhite,
            anim: null,
            thinking: false,
            result: null,
            hintStage: 0,
            analysis: new Map(),
            evalOn: this.state.evalOn,
            lastRecord: null,
        };
        this.liveLayout.resetReserve();
        this._renderLive();

        if (!this.state.twoPlayers && !this.state.playerWhite) {
            this._aiMove();
        } else {
            this._precompute();
        }
    }

    flip() {
        this.state.flipped = !this.state.flipped;
        this._renderLive();
    }

    toggleEval() {
        this.state.evalOn = !this.state.evalOn;
        this._renderLive();
        this._precompute();
    }

    hint() {
        if (!this.canPlay) return;
        this.state.hintStage = Math.min(2, this.state.hintStage + 1);
        this._renderLive();
    }

    playerMove(m) {
        const s = this.state;
        const pos = this.currentPosition;
        if (!this.canPlay || !pos.isLegal(m)) return;
        this._precomputeAbort?.abort();
        this._precomputeAbort = null;

        const cur = s.cursor;
        const nl = s.line.copy(cur);
        nl.push(m);
        for (const k of [...s.analysis.keys()]) {
            if (k > cur) s.analysis.delete(k);
        }
        s.line = nl;
        s.cursor = nl.size;
        s.anim = moveAnim(pos, m);
        s.hintStage = 0;

        this._renderLive();
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
        this._precomputeAbort?.abort();
        this._precomputeAbort = null;
        this._aiAbort?.abort();
        if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; }

        const ac = new AbortController();
        this._aiAbort = ac;
        this.state.thinking = true;
        this._renderLive();

        const gen = this._gameGeneration;
        const s = this.state;
        const lineRef = s.line;
        const pos = s.line.last;
        const elo = s.aiElo;
        const t0 = performance.now();

        let move = null;
        try {
            if (elo < 1350 && Math.random() < (1350 - elo) / 1500.0) {
                const res = await this.engine.search(pos.toFen(), 160, { multiPv: 30, depth: 4, signal: ac.signal });
                if (!ac.signal.aborted && res.lines && res.lines.length) {
                    const top = res.lines[0].score;
                    const cap = 150 + Math.trunc((1350 - elo) * 1.2);
                    const cands = res.lines.slice(1).filter((pv) => (top - pv.score) <= cap && pos.isLegal(pv.move));
                    if (cands.length) move = cands[Math.floor(Math.random() * cands.length)].move;
                }
            }
            if (!move && !ac.signal.aborted) {
                const res = await this.engine.search(pos.toFen(), 220 + Math.trunc(elo / 10), { elo: Math.max(1350, elo), signal: ac.signal });
                move = res.best;
            }
        } catch { /* fallback below */ }

        if (ac.signal.aborted || this._destroyed || gen !== this._gameGeneration || this.state.line !== lineRef) return;

        if (!move || !pos.isLegal(move)) {
            const legals = pos.legalMoves;
            move = legals.length ? legals[Math.floor(Math.random() * legals.length)] : null;
        }

        const waitMs = Math.max(0, 550 - (performance.now() - t0));
        if (waitMs > 0) {
            await new Promise((resolve) => {
                this._aiTimer = setTimeout(() => { this._aiTimer = null; resolve(); }, waitMs);
            });
        }

        if (ac.signal.aborted || this._destroyed || gen !== this._gameGeneration || this.state.line !== lineRef) return;
        this._aiAbort = null;

        if (!move) {
            this.state.thinking = false;
            this._renderLive();
            return;
        }
        const nl = lineRef.copy();
        nl.push(move);
        this.state.line = nl;
        this.state.cursor = nl.size;
        this.state.anim = moveAnim(pos, move);
        this.state.thinking = false;
        this.state.hintStage = 0;

        this._renderLive();
        const end = nl.end();
        if (end !== GameEnd.NONE) this._finish(end, null);
        else this._precompute();
    }

    async _precompute() {
        this._precomputeAbort?.abort();
        const s = this.state;
        if (s.thinking || s.analysis.has(s.cursor)) return;
        const ac = new AbortController();
        this._precomputeAbort = ac;
        const ply = s.cursor;
        const lineRef = s.line;
        try {
            const a = await this.analyzer.analyse(lineRef.positions[ply], 450, ac.signal);
            if (!a || ac.signal.aborted || this._destroyed) return;
            if (this.state.line === lineRef) {
                this.state.analysis.set(ply, a);
                this._renderLive();
            }
        } catch { /* ignore */ }
    }

    back() { this._navigate(-1); }
    forward() { this._navigate(1); }

    goTo(n) {
        const s = this.state;
        if (s.thinking) return;
        const t = Math.max(0, Math.min(s.line.size, n));
        if (t === s.cursor) return;
        s.anim = LinePlaybackController.transition(s.line, s.cursor, t);
        s.cursor = t;
        s.hintStage = 0;
        this._renderLive();
        this._precompute();
    }

    undoMove() {
        const t = this.undoTarget();
        if (t < 0) return;
        this._aiAbort?.abort();
        this._aiAbort = null;
        if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; }
        this.goTo(t);
    }

    _navigate(delta) {
        this.goTo(this.state.cursor + delta);
    }

    resign() {
        const s = this.state;
        if (s.result !== null) return;
        this._aiAbort?.abort();
        this._aiAbort = null;
        if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; }
        s.thinking = false;
        this._finish(GameEnd.NONE, s.twoPlayers ? s.line.last.whiteToMove : s.playerWhite);
    }

    async _finish(end, resignedWhite) {
        const s = this.state;
        const line = s.line;
        if (end !== GameEnd.NONE) {
            this._precomputeAbort?.abort();
            this._precomputeAbort = null;
            s.analysis.set(line.size, Analysis.decided(line.last, end));
        }
        let whiteResult;
        if (resignedWhite !== null && resignedWhite !== undefined) whiteResult = resignedWhite ? -1 : 1;
        else if (end === GameEnd.CHECKMATE) whiteResult = line.last.whiteToMove ? -1 : 1;
        else whiteResult = 0;

        const reason = resignedWhite !== null && resignedWhite !== undefined ? 'abandon' : GameLogic.endText(end);
        const resultStr = whiteResult === 1 ? '1-0' : (whiteResult === -1 ? '0-1' : '1/2-1/2');

        if (line.size < 2) {
            s.result = {
                text: "Partie interrompue avant le premier échange : rien n'est enregistré.",
                tone: Tone.NEUTRAL,
            };
            s.thinking = false;
            this._renderLive();
            return;
        }

        const gen = this._gameGeneration;
        const st = prefs.current;
        const encodedAnalysis = Analysis.encodeAll(Array.from({ length: line.size + 1 }, (_, i) => s.analysis.get(i) ?? null));

        if (s.twoPlayers) {
            let text;
            if (whiteResult === 1) text = `Victoire de ${st.pseudo} (Blancs) par ${reason}.`;
            else if (whiteResult === -1) text = `Victoire de ${st.pseudo2} (Noirs) par ${reason}.`;
            else text = `Partie nulle (${reason}).`;
            text += " Partie à 2 joueurs : l'ELO ne change pas.";
            if (gen === this._gameGeneration && !this._destroyed) {
                s.result = { text, tone: Tone.GOLD };
                s.thinking = false;
                this._renderLive();
            }
            const record = {
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
                analysis: encodedAnalysis,
                whiteName: st.pseudo,
                blackName: st.pseudo2,
                opponentElo: 1200,
            };
            const id = await db.insertGame(record);
            record.id = id;
            if (gen === this._gameGeneration && !this._destroyed) {
                s.lastRecord = record;
                this._renderLive();
            }
            this.analyzer.start(record, line);
        } else {
            const outcome = s.playerWhite ? whiteResult : -whiteResult;
            const newElo = GameLogic.newElo(st.elo, s.aiElo, (outcome + 1) / 2.0);
            const diff = newElo - st.elo;
            const delta = diff >= 0 ? `+${diff}` : `−${-diff}`;
            const head = outcome === 1 ? `Victoire par ${reason} !` : (outcome === -1 ? `Défaite par ${reason}.` : `Partie nulle (${reason}).`);
            const tone = outcome === 1 ? Tone.GOOD : (outcome === 0 ? Tone.GOLD : Tone.BAD);
            if (gen === this._gameGeneration && !this._destroyed) {
                s.thinking = false;
                s.result = { text: `${head} ELO ${st.elo} → ${newElo} (${delta}).`, tone };
                this._renderLive();
            }
            prefs.setElo(newElo);
            const record = {
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
                analysis: encodedAnalysis,
                whiteName: s.playerWhite ? st.pseudo : COMPUTER,
                blackName: s.playerWhite ? COMPUTER : st.pseudo,
                opponentElo: s.aiElo,
            };
            const id = await db.insertGame(record);
            record.id = id;
            if (gen === this._gameGeneration && !this._destroyed) {
                s.lastRecord = record;
                this._renderLive();
            }
            this.analyzer.start(record, line);
        }
    }

    deleteGame(id) {
        if (this.state.lastRecord?.id === id) {
            this.state.lastRecord = null;
            this._renderLive();
        }
        db.deleteGame(id).catch(() => {});
    }

    // ---- Rendu LiveGame ----

    _liveStatus() {
        const s = this.state;
        const st = this.settings;
        const pos = this.currentPosition;
        const side = pos.whiteToMove ? 'Blancs' : 'Noirs';
        if (s.result) {
            return {
                text: (s.cursor < s.line.size ? `Coup ${s.cursor} / ${s.line.size}. ` : '') +
                    s.result.text +
                    (s.lastRecord ? ' Touchez « Analyser la partie » pour la revue commentée.' : ''),
                tone: s.result.tone,
            };
        }
        if (s.thinking) return { text: `L'ordinateur (${s.aiElo} ELO) réfléchit…`, tone: Tone.NEUTRAL };
        if (this.canPlay && s.hintStage > 0) {
            const h = this.currentHint;
            if (!h) return { text: "Calcul en cours, l'indice s'affiche dans un instant…", tone: Tone.GOLD };
            if (s.hintStage === 1) {
                return { text: 'Indice 1/2 : la pièce à jouer est surlignée en vert. Touchez encore pour voir le coup.', tone: Tone.GOLD };
            }
            return { text: `Indice 2/2 : coup suggéré ${pos.san(h)}.`, tone: Tone.GOLD };
        }
        if (s.cursor < s.line.size) {
            return {
                text: this.canPlay
                    ? `Coup ${s.cursor} / ${s.line.size}, trait aux ${side}. Jouez un autre coup ici pour reprendre la partie depuis cette position.`
                    : `Coup ${s.cursor} / ${s.line.size}. Reculez ou avancez jusqu'à votre tour pour rejouer depuis ce moment.`,
                tone: Tone.INFO,
            };
        }
        const check = pos.inCheck ? 'Échec ! ' : '';
        if (s.twoPlayers) {
            return { text: `${check}À ${pos.whiteToMove ? st.pseudo : st.pseudo2} de jouer (les ${side}).`, tone: Tone.INFO };
        }
        if (s.line.size === 0) {
            return { text: `Nouvelle partie contre l'ordinateur (${s.aiElo} ELO). Vous jouez les ${side} : à vous de commencer !`, tone: Tone.INFO };
        }
        return { text: `${check}À vous de jouer (les ${side}).`, tone: Tone.INFO };
    }

    _renderLiveBoard() {
        if (!this._palette) return;
        const s = this.state;
        const cur = s.cursor;
        const pos = this.currentPosition;
        const last = cur > 0 ? s.line.moves[cur - 1] : null;
        const hint = this.canPlay ? this.currentHint : null;

        this.liveEvalBar.el.classList.toggle('hidden', !s.evalOn);
        this.liveLayout.setEvalActive(s.evalOn);
        if (s.evalOn) {
            let known = s.analysis.get(cur) || null;
            if (!known) {
                let bestKey = -1;
                for (const [k, v] of s.analysis.entries()) {
                    if (k <= cur && k > bestKey) { bestKey = k; known = v; }
                }
            }
            this.liveEvalBar.update(known ? known.eval : 0, s.flipped);
        }

        const c = this._palette;
        this.liveBoard.setState({
            position: pos,
            flipped: s.flipped,
            interactive: this.canPlay,
            lastMove: last,
            anim: s.anim,
            arrows: hint && s.hintStage >= 2 ? [{ from: hint.from, to: hint.to, color: c.green }] : [],
            marks: hint && s.hintStage >= 1 ? [[hint.from, c.green]] : [],
            badges: [],
            kid: false,
            showCoords: this._showCoords,
            palette: c,
            onMove: (m) => this.playerMove(m),
        });

        const st = this.settings;
        const players = s.twoPlayers
            ? { white: { name: st.pseudo, detail: null }, black: { name: st.pseudo2, detail: null } }
            : (s.playerWhite
                ? { white: { name: st.pseudo, detail: `${st.elo}` }, black: { name: COMPUTER, detail: `${s.aiElo}` } }
                : { white: { name: COMPUTER, detail: `${s.aiElo}` }, black: { name: st.pseudo, detail: `${st.elo}` } });

        const drawBar = (bar, whiteSide) => {
            const p = whiteSide ? players.white : players.black;
            bar.update({
                name: p.name,
                detail: p.detail,
                white: whiteSide,
                position: pos,
                toMove: s.result === null && pos.whiteToMove === whiteSide && s.cursor === s.line.size,
                thinking: s.thinking && pos.whiteToMove === whiteSide,
                palette: c,
            });
        };
        drawBar(this.overBar, s.flipped);
        drawBar(this.underBar, !s.flipped);
    }

    _renderLive() {
        if (this.review) return;
        const s = this.state;
        this.liveModeIcon.replaceChildren(createIcon(s.twoPlayers ? 'People' : 'SmartToy', 20));
        this.liveTitleEl.textContent = s.twoPlayers ? 'Partie à 2 joueurs' : `Ordinateur · ${s.aiElo}`;
        this.liveSubEl.textContent = s.twoPlayers
            ? 'Hors classement ELO'
            : `Bilan ${this.tally.wins} V · ${this.tally.draws} N · ${this.tally.losses} D`;

        this.liveEvalBtn.classList.toggle('is-on', s.evalOn);
        this.liveEvalBtn.setAttribute('aria-pressed', String(s.evalOn));

        this._renderLiveBoard();

        this.liveMoveStrip.update({
            line: s.line,
            cursor: s.cursor,
            onSelect: (n) => this.goTo(n),
            onPrev: () => this.back(),
            onNext: () => this.forward(),
            prevEnabled: s.cursor > 0 && !s.thinking,
            nextEnabled: s.cursor < s.line.size && !s.thinking,
        });

        const status = this._liveStatus();
        this.liveFeedback.update({ text: status.text, tone: status.tone });

        const undo = this.undoTarget();
        if (s.result !== null) {
            this.liveActions.replaceChildren(
                duckButton({
                    label: 'Analyser la partie',
                    icon: 'Analytics',
                    accent: 'blue',
                    filled: true,
                    enabled: Boolean(s.lastRecord),
                    className: 'flex-1',
                    onClick: () => { if (s.lastRecord) this.openReview(s.lastRecord); },
                }),
                duckButton({
                    label: 'Nouvelle partie',
                    icon: 'Add',
                    accent: 'gold',
                    filled: true,
                    className: 'flex-1',
                    onClick: () => this.newGame(),
                }),
            );
        } else {
            this.liveActions.replaceChildren(
                duckButton({
                    label: `Indice ${Math.min(2, s.hintStage + 1)}/2`,
                    icon: 'Lightbulb',
                    accent: 'green',
                    enabled: this.canPlay,
                    className: 'flex-1',
                    onClick: () => this.hint(),
                }),
                duckButton({
                    label: s.twoPlayers ? 'Annuler le coup' : 'Annuler mon coup',
                    icon: 'Undo',
                    enabled: undo >= 0,
                    className: 'flex-1',
                    onClick: () => this.undoMove(),
                }),
                duckIconButton({
                    icon: 'Flag',
                    ariaLabel: 'Abandonner',
                    accent: 'red',
                    enabled: s.line.size > 0,
                    onClick: () => {
                        if (prefs.current.confirmActions && this.inProgress) {
                            openConfirmDialog({
                                title: 'Abandonner la partie ?',
                                text: s.twoPlayers
                                    ? 'Le camp au trait perd la partie.'
                                    : 'La partie sera comptée comme une défaite et votre ELO sera mis à jour.',
                                confirmLabel: 'Abandonner',
                                onConfirm: () => this.resign(),
                            });
                        } else {
                            this.resign();
                        }
                    },
                }),
                duckIconButton({
                    icon: 'Add',
                    ariaLabel: 'Nouvelle partie',
                    accent: 'gold',
                    onClick: () => {
                        if (prefs.current.confirmActions && this.inProgress) {
                            openConfirmDialog({
                                title: 'Commencer une nouvelle partie ?',
                                text: "La partie en cours sera perdue (elle n'est pas enregistrée).",
                                confirmLabel: 'Nouvelle partie',
                                onConfirm: () => this.newGame(),
                            });
                        } else {
                            this.newGame();
                        }
                    },
                }),
            );
        }
        this.liveLayout.relayout();
        this.liveBoard._syncCanvasSize();
    }

    // ---- DOM & Actions ReviewLayout ----

    _buildReviewDom() {
        this.reviewLayout = new ModuleLayoutView({ bottomMin: 170 });
        this.revEvalBar = new EvalBarView();
        this.revBoard = new ChessBoardView();
        this.revBoardRow = el('div', 'board-row');
        this.revBoardRow.append(this.revEvalBar.el, this.revBoard.el);

        this.revOverBar = new PlayerBarView();
        this.revUnderBar = new PlayerBarView();

        this.revTopBar = el('div', 'play-top-bar');
        this.revBackBtn = duckIconButton({ icon: 'ArrowBack', ariaLabel: 'Quitter la revue', onClick: () => this.closeReview() });
        this.revTitleCol = el('div', 'play-title-col');
        this.revTitleEl = el('div', 'play-title', '');
        this.revSubEl = el('div', 'play-subtitle', '');
        this.revTitleCol.append(this.revTitleEl, this.revSubEl);
        this.revFlipBtn = duckIconButton({ icon: 'SwapVert', ariaLabel: "Retourner l'échiquier", onClick: () => this.flipReview() });
        this.revEvalBtn = duckIconButton({ icon: 'Insights', ariaLabel: "Jauge d'évaluation", accent: 'blue', selected: true, onClick: () => this.toggleReviewEval() });
        this.revTopBar.append(this.revBackBtn, this.revTitleCol, this.revFlipBtn, this.revEvalBtn);

        this.reviewLayout.topSlot.appendChild(this.revTopBar);
        this.reviewLayout.overSlot.appendChild(this.revOverBar.el);
        this.reviewLayout.boardHost.appendChild(this.revBoardRow);
        this.reviewLayout.underSlot.appendChild(this.revUnderBar.el);

        this.revMoveStrip = new MoveStripView();
        this.revSummaryEl = el('div', 'review-summary hidden');
        this.revFeedback = new FeedbackCardView();
        this.revMoveTableWrap = el('div', 'rev-move-table hidden');
        this.revActions = el('div', 'equal-row play-actions');

        this.reviewLayout.bottomSlot.append(
            this.revMoveStrip.el,
            this.revSummaryEl,
            this.revFeedback.el,
            this.revMoveTableWrap,
            this.revActions,
        );
    }

    openReview(g) {
        this._revPlayback.cancel();
        let line;
        try {
            line = Line.fromUci(START_FEN, g.moves || '');
        } catch {
            return;
        }
        this._cachedLineRef = line;
        this._noteCache.clear();
        this.review = {
            record: g,
            line,
            cursor: 0,
            playing: true,
            analysis: this.analyzer.analysisOf(g, line),
            flipped: Boolean(g.vsComputer && !g.playerWhite),
            evalOn: true,
            anim: null,
        };
        this.liveLayout.el.classList.add('hidden');
        this.reviewLayout.el.classList.remove('hidden');
        this.reviewLayout.resetReserve();
        this._renderReview();
        this._revAutoplay();
        this.analyzer.start(g, line);
    }

    closeReview() {
        if (!this.review) return;
        this._revPlayback.cancel();
        this.review = null;
        this.reviewLayout.el.classList.add('hidden');
        this.liveLayout.el.classList.remove('hidden');
        this._renderLive();
        this.onActivate();
    }

    _revAutoplay() {
        this._revPlayback.autoplay({
            cursor: () => this.review?.cursor ?? null,
            size: () => this.review?.line.size ?? 0,
            delayFor: () => 1150,
            checkBeforeDelay: false,
            advance: (t) => this._revGo(t),
            onEnd: () => {
                if (this.review) {
                    this.review.playing = false;
                    this._renderReview();
                }
            },
        });
    }

    _revGo(target) {
        const r = this.review;
        if (!r) return;
        const t = Math.max(0, Math.min(r.line.size, target));
        if (t === r.cursor) return;
        r.anim = LinePlaybackController.transition(r.line, r.cursor, t);
        r.cursor = t;
        this._renderReview();
    }

    pauseReview() {
        if (!this.review) return;
        this._revPlayback.cancel();
        this.review.playing = false;
        this._renderReview();
    }

    toggleReviewPlay() {
        const r = this.review;
        if (!r) return;
        if (r.playing) return this.pauseReview();
        if (r.cursor >= r.line.size) this._revGo(0);
        r.playing = true;
        this._renderReview();
        this._revAutoplay();
    }

    jumpReview(n) { this.pauseReview(); this._revGo(n); }
    stepReview(delta) { this.pauseReview(); if (this.review) this._revGo(this.review.cursor + delta); }
    firstReview() { this.pauseReview(); this._revGo(0); }
    lastReview() { this.pauseReview(); if (this.review) this._revGo(this.review.line.size); }

    flipReview() {
        if (!this.review) return;
        this.review.flipped = !this.review.flipped;
        this._renderReview();
    }

    toggleReviewEval() {
        if (!this.review) return;
        this.review.evalOn = !this.review.evalOn;
        this._renderReview();
    }

    _computeNotes(line, analysis) {
        if (this._cachedLineRef !== line) {
            this._cachedLineRef = line;
            this._noteCache.clear();
        }
        const out = new Array(line.size);
        for (let i = 0; i < line.size; i++) {
            const a0 = analysis?.[i] ?? null;
            const a1 = analysis?.[i + 1] ?? null;
            const prev = i > 0 ? line.moves[i - 1] : null;
            const cached = this._noteCache.get(i);
            const eq = (x, y) => (x === y) || (x != null && x.equals(y));
            if (cached && eq(cached.a0, a0) && eq(cached.a1, a1)) {
                out[i] = cached.note;
            } else {
                const note = GameLogic.annotate(line.positions[i], line.moves[i], a0, a1, prev);
                this._noteCache.set(i, { a0, a1, note });
                out[i] = note;
            }
        }
        return out;
    }

    _renderReviewBoard() {
        const r = this.review;
        if (!r || !this._palette) return;
        const c = this._palette;
        const cur = Math.max(0, Math.min(r.line.size, r.cursor));
        const pos = r.line.positions[cur];
        const last = cur > 0 ? r.line.moves[cur - 1] : null;
        const notes = this._computeNotes(r.line, r.analysis);
        const note = last ? notes[cur - 1] : null;

        this.revEvalBar.el.classList.toggle('hidden', !r.evalOn);
        this.reviewLayout.setEvalActive(r.evalOn);
        if (r.evalOn) {
            let known = r.analysis?.[cur] ?? null;
            if (!known) {
                for (let k = cur; k >= 0; k--) {
                    if (r.analysis?.[k]) { known = r.analysis[k]; break; }
                }
            }
            this.revEvalBar.update(known ? known.eval : 0, r.flipped);
        }

        const badges = last && note ? [{ sq: last.to, text: note, color: annotationColor(note) }] : [];
        this.revBoard.setState({
            position: pos,
            flipped: r.flipped,
            interactive: false,
            lastMove: last,
            anim: r.anim,
            arrows: [],
            marks: [],
            badges,
            kid: false,
            showCoords: this._showCoords,
            palette: c,
        });

        const g = r.record;
        const wName = g.whiteName || (g.vsComputer && !g.playerWhite ? COMPUTER : 'Blancs');
        const bName = g.blackName || (g.vsComputer && g.playerWhite ? COMPUTER : 'Noirs');
        const drawBar = (bar, whiteSide) => {
            bar.update({
                name: whiteSide ? wName : bName,
                detail: null,
                white: whiteSide,
                position: pos,
                toMove: cur < r.line.size && pos.whiteToMove === whiteSide,
                thinking: false,
                palette: c,
            });
        };
        drawBar(this.revOverBar, r.flipped);
        drawBar(this.revUnderBar, !r.flipped);
    }

    _renderReviewSummary(g, line, analysis, notes, ready) {
        const total = line.size + 1;
        this.revSummaryEl.replaceChildren();
        this.revSummaryEl.appendChild(el('div', 'review-summary-title', 'Résumé de la partie'));

        if (ready < total) {
            this.revSummaryEl.appendChild(el('div', 'muted-small mt-4', `Analyse des coups : ${ready} / ${total}…`));
            const prog = el('div', 'review-prog-track');
            const fill = el('div', 'review-prog-fill');
            fill.style.width = `${Math.round((ready / total) * 100)}%`;
            prog.appendChild(fill);
            this.revSummaryEl.appendChild(prog);
        }

        const alignedWrap = el('div', 'review-aligned-rows');
        const labelEls = [];
        const countEls = [];
        for (const white of [true, false]) {
            const v = ReviewComments.voice(g, white);
            const idxs = [];
            for (let i = 0; i < line.size; i++) {
                if (line.positions[i].whiteToMove === white) idxs.push(i);
            }
            const counts = {};
            for (const n of NOTES) counts[n] = idxs.filter((idx) => notes[idx] === n).length;
            const missed = idxs.filter((idx) => GameLogic.missedMate(white, analysis?.[idx], analysis?.[idx + 1]) !== null).length;

            const row = el('div', 'review-side-row');
            row.setAttribute(
                'aria-label',
                v.label + ' : ' + NOTES.map((n) => `${counts[n]} ${NOTE_NAMES[n]}`).join(', ') + `, ${missed} mat manqué`,
            );
            const nameEl = el('span', 'review-side-name', v.label);
            row.appendChild(nameEl);
            const badgesWrap = el('div', 'review-side-counts');
            for (const n of NOTES) {
                const item = el('span', 'review-note-item');
                const chip = el('span', 'review-note-chip', n);
                chip.style.background = annotationColor(n);
                item.append(chip, el('span', 'review-note-num', ` ${counts[n]}`));
                badgesWrap.appendChild(item);
            }
            if (missed > 0) {
                badgesWrap.appendChild(el('span', 'review-missed-mate', `${missed} mat${missed > 1 ? 's' : ''} manqué${missed > 1 ? 's' : ''}`));
            }
            row.appendChild(badgesWrap);
            alignedWrap.appendChild(row);
            labelEls.push(nameEl);
            countEls.push(badgesWrap);
        }
        this.revSummaryEl.appendChild(alignedWrap);

        const hintEl = el('div', 'review-summary-hint', 'Touchez Lecture ou un coup pour lire les commentaires.');
        this.revSummaryEl.appendChild(hintEl);

        const fitAligned = () => {
            if (!this.revSummaryEl.isConnected) return;
            const cs = getComputedStyle(this.revSummaryEl);
            const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            const availW = (this.revSummaryEl.clientWidth || 0) - padX;
            if (availW <= 0) return;
            alignedWrap.classList.remove('is-stacked', 'is-one-line');
            alignedWrap.style.removeProperty('--label-col-w');
            let maxLabelW = 0;
            let maxCountsW = 0;
            for (let i = 0; i < labelEls.length; i++) {
                maxLabelW = Math.max(maxLabelW, Math.ceil(labelEls[i].scrollWidth));
                maxCountsW = Math.max(maxCountsW, Math.ceil(countEls[i].scrollWidth));
            }
            const colW = maxLabelW + 10;
            if (colW + maxCountsW <= availW) {
                alignedWrap.classList.add('is-one-line');
                alignedWrap.style.setProperty('--label-col-w', `${maxLabelW}px`);
            } else {
                alignedWrap.classList.add('is-stacked');
            }
        };
        fitAligned();
        requestAnimationFrame(fitAligned);
    }

    _renderMoveTable(line, cur, notes) {
        const first = line.size > 0 && !line.positions[0].whiteToMove ? 1 : 0;
        const rows = Math.floor((line.size + first + 1) / 2);
        const startMove = line.positions[0].fullmove;
        this.revMoveTableWrap.replaceChildren();
        let activeBtn = null;

        for (let row = 0; row < rows; row++) {
            const tr = el('div', 'move-table-row');
            tr.appendChild(el('span', 'move-table-num', `${startMove + row}.`));
            for (let col = 0; col < 2; col++) {
                const i = row * 2 + col - first;
                const cell = el('div', 'move-table-cell');
                if (i >= 0 && i < line.size) {
                    const current = i === cur - 1;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = `move-table-btn${current ? ' is-current' : ''}`;
                    btn.setAttribute('aria-label', `Aller au coup ${line.sans[i]}`);
                    btn.setAttribute('aria-current', String(current));
                    btn.appendChild(el('span', 'move-table-san', line.sans[i]));
                    if (notes[i]) {
                        const badge = el('span', 'move-table-badge', notes[i]);
                        badge.style.background = annotationColor(notes[i]);
                        btn.appendChild(badge);
                    }
                    btn.addEventListener('click', () => {
                        feedback.key();
                        this.jumpReview(i + 1);
                    });
                    if (current) activeBtn = btn;
                    cell.appendChild(btn);
                }
                tr.appendChild(cell);
            }
            this.revMoveTableWrap.appendChild(tr);
        }

        if (activeBtn) {
            try {
                activeBtn.scrollIntoView({ block: 'nearest' });
            } catch { /* ignore */ }
        }
    }

    _renderReview() {
        const r = this.review;
        if (!r) return;
        const g = r.record;
        const line = r.line;
        const cur = Math.max(0, Math.min(line.size, r.cursor));
        const wide = isTwoPane(window.innerWidth, window.innerHeight);

        this.revTitleEl.textContent = 'Revue : ' + (
            !g.whiteName ? (g.opponent || '').replace('Stockfish', 'Ordinateur') : `${g.whiteName} – ${g.blackName}`
        );
        this.revSubEl.textContent = `${formatDate(g.date)} · ${g.result} (${g.reason})`;

        this.revEvalBtn.classList.toggle('is-on', r.evalOn);
        this.revEvalBtn.setAttribute('aria-pressed', String(r.evalOn));

        this._renderReviewBoard();

        const notes = this._computeNotes(line, r.analysis);
        const ready = (r.analysis || []).filter(Boolean).length;

        this.revMoveStrip.el.classList.toggle('hidden', wide);
        if (!wide) {
            this.revMoveStrip.update({
                line,
                cursor: cur,
                onSelect: (n) => this.jumpReview(n),
                onPrev: () => this.stepReview(-1),
                onNext: () => this.stepReview(1),
            });
        }

        if (cur === 0) {
            this.revSummaryEl.classList.remove('hidden');
            this.revFeedback.el.classList.add('hidden');
            this._renderReviewSummary(g, line, r.analysis, notes, ready);
        } else {
            this.revSummaryEl.classList.add('hidden');
            this.revFeedback.el.classList.remove('hidden');
            const cmt = ReviewComments.comment(g, line, cur - 1, r.analysis);
            const text = cmt.text + (cur === line.size ? ' ' + ReviewComments.ending(g) : '');
            const note = notes[cur - 1];
            const title = stepTitle(line, cur, { note });
            this.revFeedback.el.classList.toggle('is-wide-review', wide);
            this.revFeedback.update({ text, tone: cmt.tone, title });
        }

        this.revMoveTableWrap.classList.toggle('hidden', !wide);
        if (wide) {
            this._renderMoveTable(line, cur, notes);
        }

        this.revActions.replaceChildren(
            duckButton({ label: 'Début', icon: 'SkipPrevious', enabled: cur > 0, className: 'flex-1', onClick: () => this.firstReview() }),
            duckButton({
                label: r.playing ? 'Pause' : 'Lecture',
                icon: r.playing ? 'Pause' : 'PlayArrow',
                accent: 'blue',
                filled: true,
                className: 'flex-1-4',
                onClick: () => this.toggleReviewPlay(),
            }),
            duckButton({ label: 'Fin', icon: 'SkipNext', enabled: cur < line.size, className: 'flex-1', onClick: () => this.lastReview() }),
        );
        this.reviewLayout.relayout();
        this.revBoard._syncCanvasSize();
    }
}
