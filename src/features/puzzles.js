// Module Problèmes : 50 000 problèmes Lichess, réfutation temps réel via Stockfish, catalogue 50 thèmes & export image PNG
// Port fidèle de Puzzles.kt (ChessDuck v1.6.0)

import { Line, PAWN, PIECE_NAMES_FR, pieceType } from '../chess.js';
import { BANDS, THEME_CATEGORIES, THEME_GROUPS, ALL_THEMES, bandOf, frNum, primaryTheme, THEME_BY_KEY } from '../themes.js';
import { COLORS, ChessBoardView, captureBadge, moveAnim, undoAnim } from '../board.js';
import { isMateScore, mateIn } from '../review-comments.js';
import { renderProblemCard, renderSolutionCard, shareOrSaveCanvas } from '../share-card.js';
import {
  ModuleLayoutView, Tone, el, makeButton, makeChip, makeFeedbackCard, makeSectionTitle, sheets,
} from '../ui.js';

export class PuzzlesModule {
  constructor({ prefs, userDb, catalog, engine, feedback }) {
    this.prefs = prefs;
    this.userDb = userDb;
    this.catalog = catalog;
    this.engine = engine;
    this.feedback = feedback;
    this.colors = prefs.get().dark ? COLORS.night : COLORS.day;
    this.active = false;
    this._gen = 0;
    this._timer = null;
    this._abort = null;
    this._initialized = false;

    const st = prefs.get();
    this.state = {
      puzzle: null,
      line: null,
      progress: 0,
      cursor: 0,
      solved: false,
      anim: null,
      hintStage: 0,
      message: 'Chargement du problème…',
      tone: Tone.INFO,
      refute: null,
      band: st.puzzleBand || 0,
      theme: st.puzzleTheme || '',
      empty: false,
    };

    this._buildDom();
    this.userDb.subscribe(() => this.render());
    this.prefs.subscribe(() => this.render());
    this.catalog.subscribe(() => {
      if (!this._initialized && this.catalog.puzzles.length > 0) {
        this._initFirstPuzzle();
      }
      this.render();
    });

    this.catalog.loadHot().then(() => {
      if (!this._initialized) this._initFirstPuzzle();
    }).catch(() => {});
  }

  async _initFirstPuzzle() {
    if (this._initialized) return;
    this._initialized = true;
    const savedId = this.prefs.get().puzzleId;
    if (savedId) {
      let saved = this.catalog.byId(savedId);
      if (!saved && !this.catalog.fullLoaded) {
        try { await this.catalog.loadFull(); } catch {}
        if (this.state.puzzle) return; // utilisateur a déjà navigué entre-temps
        saved = this.catalog.byId(savedId);
      }
      if (saved) {
        this._show(saved);
        return;
      }
    }
    this.random();
  }

  get playerWhite() {
    return this.state.line?.positions?.[1]?.whiteToMove ?? true;
  }

  _buildDom() {
    this.layout = new ModuleLayoutView({ bottomMin: 140 });
    this.root = this.layout.root;

    this.catalogBtn = makeButton({
      label: '🧩 0 / 50 000 ▾',
      accent: 'blue',
      weight: 1.36,
      height: 38,
      feedback: this.feedback,
      onClick: () => this._openCatalogSheet(),
    });
    this.randomBtn = makeButton({
      label: '🎲 Aléatoire',
      accent: 'gold',
      weight: 1.05,
      height: 38,
      feedback: this.feedback,
      onClick: () => this.random(),
    });
    this.recentsBtn = makeButton({
      label: '🕘 Récents',
      enabled: false,
      weight: 0.94,
      height: 38,
      feedback: this.feedback,
      onClick: () => this._openRecentsSheet(),
    });
    this.exportBtn = makeButton({
      label: '🖼️ Exporter',
      enabled: false,
      weight: 1.02,
      height: 38,
      feedback: this.feedback,
      onClick: () => this._openExportSheet(),
    });
    const topBar = el('div', { className: 'equal-row top-pad' }, this.catalogBtn, this.randomBtn, this.recentsBtn, this.exportBtn);

    this.infoTurn = el('span', { className: 'puzzle-info-turn' });
    this.infoMeta = el('span', { className: 'puzzle-info-meta' });
    const infoBar = el('div', { className: 'puzzle-info-row' }, this.infoTurn, this.infoMeta);

    this.layout.topEl.append(topBar, infoBar);

    this.board = new ChessBoardView(this.layout.boardMount, {
      feedback: this.feedback,
      onMove: (m) => {
        const res = this.onMove(m);
        if (res === 2) this.feedback.success();
        else if (res === -1) this.feedback.error();
      },
    });
    this.layout.onBoardSize((side) => this.board.resize(side));

    this.feedbackCard = makeFeedbackCard();
    this.backBtn = makeButton({ label: '◀ Arrière', onClick: () => this.back(), weight: 1, height: 44, feedback: this.feedback });
    this.midBtn = makeButton({
      label: '💡 Indice 1/2',
      accent: 'green',
      weight: 1.3,
      height: 44,
      feedback: this.feedback,
      onClick: () => {
        if (this.state.refute) this.retry();
        else this.hint();
      },
    });
    this.fwdBtn = makeButton({ label: 'Avant ▶', onClick: () => this.forward(), weight: 1, height: 44, feedback: this.feedback });
    const bottomBtns = el('div', { className: 'equal-row v-pad-5' }, this.backBtn, this.midBtn, this.fwdBtn);

    this.layout.bottomEl.append(this.feedbackCard, bottomBtns);
    this.render();
  }

  setActive(on) {
    this.active = on;
    if (on) {
      requestAnimationFrame(() => this.layout.measure());
    }
  }

  setColors(colors) {
    this.colors = colors;
    this.render();
  }

  _cancelAsync() {
    this._gen++;
    clearTimeout(this._timer);
    this._timer = null;
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
  }

  _turnLabel(white) {
    return white ? '⬜ Trait aux Blancs' : '⬛ Trait aux Noirs';
  }

  _show(p) {
    this._cancelAsync();
    const gen = this._gen;
    let line;
    try {
      line = Line.fromUci(p.fen, p.moves);
    } catch {
      return;
    }
    const white = line.positions[1].whiteToMove;
    this.state.puzzle = p;
    this.state.line = line;
    this.state.progress = 0;
    this.state.cursor = 0;
    this.state.solved = false;
    this.state.anim = null;
    this.state.hintStage = 0;
    this.state.refute = null;
    this.state.empty = false;
    this.state.tone = Tone.INFO;
    this.state.message = `${this._turnLabel(white)}. 💡 Conseil : ${primaryTheme(p.themes).tip}`;
    this.prefs.pushRecentPuzzle(p.id);
    this.render();

    this._timer = setTimeout(() => {
      if (this._gen !== gen) return;
      this.state.progress = 1;
      this.state.cursor = 1;
      this.state.anim = moveAnim(line.positions[0], line.moves[0]);
      this.render();
    }, 600);
  }

  openPuzzle(p) {
    this._show(p);
  }

  random() {
    const s = this.state;
    const p = this.catalog.random(s.band, s.theme, s.puzzle?.id || '');
    if (p) {
      this._show(p);
    } else if (!this.catalog.fullLoaded && this.catalog.puzzles.length > 0) {
      this.state.message = 'Chargement du catalogue complet (50 000 problèmes)…';
      this.state.tone = Tone.INFO;
      this.render();
      this.catalog.loadFull().then(() => {
        const p2 = this.catalog.random(this.state.band, this.state.theme, this.state.puzzle?.id || '');
        if (p2) this._show(p2);
        else {
          this.state.empty = true;
          this.state.tone = Tone.BAD;
          this.state.message = 'Aucun problème ne correspond à ces filtres. Élargissez la sélection dans le catalogue.';
          this.render();
        }
      });
    } else {
      this.state.empty = true;
      this.state.tone = Tone.BAD;
      this.state.message = 'Aucun problème ne correspond à ces filtres. Élargissez la sélection dans le catalogue.';
      this.render();
    }
  }

  async openById(raw) {
    const id = raw.trim().replace(/^#/, '').split('/').pop().trim();
    if (!id) return false;
    let p = this.catalog.byIdIgnoreCase(id);
    if (!p && !this.catalog.fullLoaded) {
      await this.catalog.loadFull();
      p = this.catalog.byIdIgnoreCase(id);
    }
    if (p) {
      this._show(p);
      return true;
    }
    return false;
  }

  setFilter(band, theme) {
    this.state.band = band;
    this.state.theme = theme;
    this.prefs.update({ puzzleBand: band, puzzleTheme: theme });
    this.random();
  }

  back() {
    const s = this.state;
    if (s.refute || s.cursor <= 0 || !s.line) return;
    const t = s.cursor - 1;
    s.cursor = t;
    s.anim = undoAnim(s.line.positions[t], s.line.moves[t]);
    s.hintStage = 0;
    this.render();
  }

  forward() {
    const s = this.state;
    if (s.refute || !s.line || s.cursor >= s.progress) return;
    s.anim = moveAnim(s.line.positions[s.cursor], s.line.moves[s.cursor]);
    s.cursor = s.cursor + 1;
    s.hintStage = 0;
    this.render();
  }

  canPlay() {
    const s = this.state;
    const line = s.line;
    if (!line) return false;
    return !s.refute && s.cursor >= 1 && s.cursor < line.size && s.cursor <= s.progress &&
      line.positions[s.cursor].whiteToMove === this.playerWhite;
  }

  hint() {
    if (!this.canPlay()) return;
    const stage = Math.min(2, this.state.hintStage + 1);
    this.state.hintStage = stage;
    this.state.tone = Tone.GOLD;
    this.state.message = stage === 1
      ? '💡 Indice 1/2 : la pièce à jouer est surlignée en vert.'
      : '💡 Indice 2/2 : la flèche montre le coup à jouer.';
    this.render();
  }

  onMove(m) {
    const s = this.state;
    const line = s.line;
    const p = s.puzzle;
    if (!line || !p || !this.canPlay()) return 0;

    this._cancelAsync();
    const gen = this._gen;
    const cur = s.cursor;
    const pos = line.positions[cur];
    const expected = line.moves[cur];
    const after = pos.play(m);

    if (m.equals(expected) || after.isCheckmate) {
      const newLine = m.equals(expected) ? line : new Line(line.startFen, [...line.moves.slice(0, cur), m]);
      const finished = cur + 1 >= newLine.size;
      s.line = newLine;
      s.cursor = cur + 1;
      s.progress = cur + 1;
      s.anim = moveAnim(pos, m);
      s.hintStage = 0;
      s.solved = s.solved || finished;
      s.tone = Tone.GOOD;
      s.message = finished ? this._solvedMessage(p) : `✅ ${newLine.sans[cur]} — bon coup ! La suite arrive…`;
      this.render();

      if (finished) {
        this.userDb.markPuzzleSolved(p.id);
        return 2;
      }

      this._timer = setTimeout(() => {
        if (this._gen !== gen) return;
        const reply = newLine.moves[cur + 1];
        s.cursor = cur + 2;
        s.progress = cur + 2;
        s.anim = moveAnim(newLine.positions[cur + 1], reply);
        s.message = `✅ Bien vu. L'adversaire répond ${newLine.sans[cur + 1]} : à vous de continuer.`;
        this.render();
      }, 600);
      return 1;
    }

    this._refute(pos, m, after, cur);
    return -1;
  }

  _solvedMessage(p) {
    const prim = primaryTheme(p.themes);
    const others = p.themes.trim().split(/\s+/).map((k) => THEME_BY_KEY[k]).filter((t) => t && t.key !== prim.key).map((t) => t.name);
    const names = [prim.name, ...new Set(others)].slice(0, 4);
    return `✅ Problème résolu ! ${names.length > 0 ? `Thèmes : ${names.join(', ')}. ` : ''}Touchez 🎲 Aléatoire pour le suivant.`;
  }

  async _refute(pos, m, after, cur) {
    const gen = this._gen;
    const s = this.state;
    const san = pos.san(m);
    const oppName = pos.whiteToMove ? 'Noirs' : 'Blancs';

    s.progress = Math.max(cur, Math.min(s.progress, cur));
    s.cursor = cur;
    s.hintStage = 0;
    s.tone = Tone.BAD;
    s.anim = moveAnim(pos, m);
    s.refute = { position: after, last: m, arrow: null, badge: captureBadge(pos, m) };
    s.message = `❌ ${san} n'est pas la solution. Regardez la réponse des ${oppName}…`;
    this.render();

    if (after.legalMoves.length === 0) {
      s.message = `❌ ${san} met l'adversaire pat : la partie serait nulle alors que vous aviez bien mieux !`;
      this.render();
      this._timer = setTimeout(() => {
        if (this._gen === gen) this.retry();
      }, 3200);
      return;
    }

    const t0 = performance.now();
    const controller = new AbortController();
    this._abort = controller;
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    let res = null;
    try {
      res = await this.engine.search(after.toFen(), 380, { signal: controller.signal });
    } catch {}
    clearTimeout(timeoutId);
    if (this._abort === controller) this._abort = null;
    if (this._gen !== gen) return;

    const waitMs = Math.max(0, 650 - (performance.now() - t0));
    await new Promise((r) => { this._timer = setTimeout(r, waitMs); });
    if (this._gen !== gen) return;

    const reply = (res?.best && after.isLegal(res.best))
      ? res.best
      : (after.legalMoves.find((mv) => mv.to === m.to) || after.legalMoves[0]);
    const replySan = after.san(reply);
    const after2 = after.play(reply);
    const score = res?.score ?? null;
    const captured = after.at(reply.to);

    let detail;
    if (after2.isCheckmate) detail = ' : échec et mat !';
    else if (score !== null && isMateScore(score) && score > 0) detail = ` et forcent le mat en ${mateIn(score)}.`;
    else if (captured !== 0 && pieceType(captured) !== PAWN) detail = ` et capturent votre ${PIECE_NAMES_FR[pieceType(captured)].toLowerCase()}.`;
    else if (captured !== 0) detail = ' et gagnent un pion.';
    else if (score !== null && score > 150) detail = " et prennent l'avantage.";
    else if (score !== null && score > -80) detail = " et égalisent : votre avantage s'est envolé.";
    else detail = ' et se défendent : il existait un coup bien plus fort.';

    s.anim = moveAnim(after, reply);
    s.refute = {
      position: after2,
      last: reply,
      arrow: { from: reply.from, to: reply.to, color: '#EF4444' },
      badge: captureBadge(after, reply),
    };
    s.message = `❌ Réfutation : après ${san}, les ${oppName} répondent ${replySan}${detail} Le coup va être annulé.`;
    this.render();

    this._timer = setTimeout(() => {
      if (this._gen === gen) this.retry();
    }, 2550);
  }

  retry() {
    if (!this.state.refute) return;
    this._cancelAsync();
    const tip = this.state.puzzle ? primaryTheme(this.state.puzzle.themes).tip : '';
    this.state.refute = null;
    this.state.anim = null;
    this.state.tone = Tone.INFO;
    this.state.message = `↩️ Position rétablie, à vous de rejouer. 💡 Conseil : ${tip}`;
    this.render();
  }

  _highlightText(text, query) {
    const span = el('span', { className: 'sugg-id' });
    if (!query) {
      span.textContent = text;
      return span;
    }
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) {
      span.textContent = text;
      return span;
    }
    if (at > 0) span.appendChild(document.createTextNode(text.slice(0, at)));
    span.appendChild(el('mark', { className: 'search-hl' }, text.slice(at, at + query.length)));
    if (at + query.length < text.length) span.appendChild(document.createTextNode(text.slice(at + query.length)));
    return span;
  }

  _openCatalogSheet() {
    let band = this.state.band;
    let query = '';
    let notFound = false;

    sheets.open({
      title: '🧩 Catalogue des problèmes',
      onBuild: (body, modal) => {
        const inputEl = el('input', {
          type: 'text',
          className: 'duck-input',
          placeholder: 'ex. 0D1Z6',
          maxlength: '12',
          autocapitalize: 'none',
          autocomplete: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          enterkeyhint: 'search',
        });
        const openBtn = makeButton({
          label: '🔎 Ouvrir',
          accent: 'gold',
          filled: true,
          enabled: false,
          height: 46,
          weight: 0,
          className: 'open-id-btn',
          feedback: this.feedback,
          onClick: () => submitSearch(),
        });
        openBtn.style.flexBasis = 'auto';
        openBtn.style.width = '106px';

        const searchRow = el('div', { className: 'search-row' }, inputEl, openBtn);
        const suggWrap = el('div', { className: 'sugg-wrap hidden' });
        const notFoundEl = el('div', { className: 'search-error hidden' });
        const bandRow = el('div', { className: 'chips-row' });
        const themesWrap = el('div', { className: 'themes-list' });
        const indexStatus = el('div', { className: 'index-status' });

        const submitSearch = async () => {
          if (!query.trim()) return;
          const ok = await this.openById(query);
          if (ok) {
            modal.close();
          } else {
            notFound = true;
            notFoundEl.textContent = `Aucun problème « ${query.trim()} » parmi les 50 000 embarqués. Vérifiez l'identifiant (majuscules et minuscules comptent).`;
            notFoundEl.classList.remove('hidden');
          }
        };

        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitSearch();
          }
        });

        const renderSuggestions = () => {
          suggWrap.innerHTML = '';
          if (!query.trim()) {
            suggWrap.classList.add('hidden');
            return;
          }
          const res = this.catalog.search(query);
          if (res.items.length > 0) {
            suggWrap.classList.remove('hidden');
            suggWrap.className = 'sugg-wrap';
            for (const item of res.items) {
              const row = el('button', {
                type: 'button',
                className: 'sugg-item',
                onClick: async () => {
                  this.feedback?.key();
                  await this.openById(item.id);
                  modal.close();
                },
              },
              this._highlightText(`#${item.id}`, res.query),
              el('span', { className: 'sugg-type' }, item.type),
              el('span', { className: 'sugg-rating' }, String(item.rating)));
              suggWrap.appendChild(row);
            }
            if (res.more) {
              suggWrap.appendChild(el('div', { className: 'sugg-more' }, '…'));
            }
          } else {
            suggWrap.classList.remove('hidden');
            suggWrap.className = 'sugg-empty';
            suggWrap.textContent = `Aucun identifiant ne contient « ${query.trim()} ».`;
          }
        };

        inputEl.addEventListener('input', () => {
          query = inputEl.value.slice(0, 12);
          notFound = false;
          notFoundEl.classList.add('hidden');
          openBtn.setConfig({ enabled: query.trim().length > 0 });
          renderSuggestions();
        });

        const renderThemes = () => {
          const counts = this.catalog.countsForBand(band);
          indexStatus.textContent = this.catalog.fullLoaded
            ? ''
            : `Indexation hors-ligne en cours (${frNum(this.catalog.loadedCount)} / 50 000 problèmes chargés)…`;
          indexStatus.classList.toggle('hidden', this.catalog.fullLoaded);

          themesWrap.innerHTML = '';
          const addRow = (name, goal, key) => {
            const cnt = counts.get(key);
            const enabled = !cnt || cnt.total > 0;
            const selected = this.state.theme === key && this.state.band === band;
            const row = el('button', {
              type: 'button',
              disabled: !enabled,
              className: `theme-row ${selected ? 'is-selected' : ''}`,
              onClick: () => {
                if (!enabled) return;
                this.feedback?.key();
                this.setFilter(band, key);
                modal.close();
              },
            },
            el('div', { className: 'theme-row-info' },
              el('div', { className: `theme-row-name ${enabled ? '' : 'is-disabled'}` }, name),
              el('div', { className: 'theme-row-goal' }, goal),
            ),
            cnt ? el('div', { className: `theme-row-count ${cnt.solved > 0 ? 'has-solved' : ''}` }, `${frNum(cnt.solved)} / ${frNum(cnt.total)}`) : null);
            themesWrap.appendChild(row);
          };

          addRow('🎯 Tous les thèmes', 'Un mélange de toutes les idées tactiques.', '');
          for (const cat of THEME_CATEGORIES) {
            addRow(`${cat.emoji} ${cat.label}`, cat.goal, cat.key);
          }
          for (const g of THEME_GROUPS) {
            themesWrap.appendChild(makeSectionTitle(g.toUpperCase()));
            for (const t of ALL_THEMES.filter((x) => x.group === g)) {
              addRow(t.name, t.goal, t.key);
            }
          }
        };

        const bandWeights = [0.8, 1.1, 1.5, 1.1, 1.0];
        BANDS.forEach((label, i) => {
          const chip = makeChip({
            label,
            selected: band === i,
            accent: 'gold',
            weight: bandWeights[i],
            feedback: this.feedback,
            onClick: () => {
              band = i;
              bandRow.querySelectorAll('.duck-chip').forEach((cEl, idx) => cEl.classList.toggle('is-selected', idx === band));
              renderThemes();
            },
          });
          bandRow.appendChild(chip);
        });

        body.append(
          makeSectionTitle('RECHERCHER PAR IDENTIFIANT LICHESS'),
          searchRow,
          suggWrap,
          notFoundEl,
          makeSectionTitle('1. DIFFICULTÉ'),
          bandRow,
          makeSectionTitle('2. CATÉGORIE OU THÈME'),
          indexStatus,
          themesWrap,
        );

        renderThemes();
        const unsub = this.catalog.subscribe(() => {
          if (!document.body.contains(body)) { unsub(); return; }
          renderThemes();
          if (query.trim()) renderSuggestions();
        });
      },
    });
  }

  _openRecentsSheet() {
    const recIds = (this.prefs.get().recentPuzzles || []).slice(1, 6);
    const items = this.catalog.byIds(recIds);
    const solved = this.userDb.solvedIds;

    sheets.open({
      title: '🕘 Derniers problèmes joués',
      onBuild: (body, modal) => {
        if (items.length === 0) {
          body.appendChild(el('div', { className: 'empty-sheet-msg' }, 'Aucun problème précédent encore enregistré.'));
          return;
        }
        for (const r of items) {
          const done = solved.has(r.id);
          body.appendChild(
            el('button', {
              type: 'button',
              className: 'recent-row',
              onClick: () => {
                this.feedback?.key();
                modal.close();
                this.openPuzzle(r);
              },
            },
            el('div', { className: 'recent-info' },
              el('div', { className: 'recent-title' }, `#${r.id} · ${primaryTheme(r.themes).name}`),
              el('div', { className: 'recent-sub' }, `${BANDS[bandOf(r.rating)]} · ${r.rating}`),
            ),
            el('div', { className: `recent-status ${done ? 'is-done' : ''}` }, done ? '✅ Résolu' : 'À résoudre')),
          );
        }
      },
    });
  }

  _openExportSheet() {
    const s = this.state;
    const p = s.puzzle;
    const line = s.line;
    if (!p || !line) return;

    sheets.open({
      title: '🖼️ Exporter en image',
      onBuild: (body) => {
        const statusEl = el('div', { className: 'export-status hidden' });
        const previewWrap = el('div', { className: 'export-preview-wrap hidden' });
        const previewImg = el('img', { className: 'export-preview-img', alt: 'Aperçu image ChessDuck' });
        const previewCaption = el('div', { className: 'export-preview-hint' }, "Astuce iPhone : maintenez le doigt sur l'image puis touchez « Enregistrer dans Photos ».");
        previewWrap.append(previewCaption, previewImg);

        const handleAction = async (kind, mode) => {
          statusEl.textContent = 'Génération de l’image HD (1080 px)…';
          statusEl.className = 'export-status';
          try {
            const canvas = kind === 'problem'
              ? await renderProblemCard(p, line.positions[1], this.playerWhite, line.moves[0])
              : await renderSolutionCard(p);
            const fname = kind === 'problem' ? `ChessDuck_${p.id}.png` : `ChessDuck_${p.id}_solution.png`;
            const title = kind === 'problem' ? `Problème Lichess #${p.id}` : `Solution Lichess #${p.id}`;
            const res = await shareOrSaveCanvas(canvas, fname, title, `${title} — ChessDuck`, mode);
            if (res.dataUrl) {
              previewImg.src = res.dataUrl;
              previewWrap.classList.remove('hidden');
            }
            if (res.message) {
              statusEl.textContent = res.message;
              statusEl.className = `export-status ${res.ok ? 'is-ok' : 'is-err'}`;
            } else {
              statusEl.classList.add('hidden');
            }
          } catch {
            statusEl.textContent = "❌ L'image n'a pas pu être générée.";
            statusEl.className = 'export-status is-err';
          }
        };

        const makeCard = (title, desc, accent, kind) => el('div', { className: 'export-card' },
          el('div', { className: 'export-card-title' }, title),
          el('div', { className: 'export-card-desc' }, desc),
          el('div', { className: 'equal-row' },
            makeButton({ label: '📤 Partager', accent, filled: true, height: 44, weight: 1, feedback: this.feedback, onClick: () => handleAction(kind, 'share') }),
            makeButton({ label: '⬇️ Enregistrer', accent, filled: false, height: 44, weight: 1, feedback: this.feedback, onClick: () => handleAction(kind, 'save') }),
          ),
        );

        body.append(
          makeCard('🧩 Le problème', "L'énoncé seul : échiquier, trait, difficulté, type et conseil — sans la solution.", 'blue', 'problem'),
          makeCard('✅ La solution', 'Une grille par coup : flèches des déplacements, symboles ✕ + # et pièces capturées.', 'green', 'solution'),
          statusEl,
          previewWrap,
        );
      },
    });
  }

  render() {
    const s = this.state;
    const c = this.colors;
    const p = s.puzzle;
    const line = s.line;
    const solvedCount = this.userDb.solvedIds.size;
    const recIds = (this.prefs.get().recentPuzzles || []).slice(1, 6);
    const recItems = this.catalog.byIds(recIds);

    this.catalogBtn.setConfig({ label: `🧩 ${frNum(solvedCount)} / 50 000 ▾` });
    this.randomBtn.setConfig({ filled: s.solved || s.empty });
    this.recentsBtn.setConfig({ enabled: recItems.length > 0 });
    this.exportBtn.setConfig({ enabled: !!(p && line) });

    if (p) {
      this.infoTurn.textContent = this.playerWhite ? '⬜ Trait aux Blancs' : '⬛ Trait aux Noirs';
      this.infoMeta.textContent = `${primaryTheme(p.themes).name} · ${BANDS[bandOf(p.rating)]} ${p.rating}   #${p.id}`;
    } else {
      this.infoTurn.textContent = '';
      this.infoMeta.textContent = '';
    }

    if (line) {
      const r = s.refute;
      const cur = Math.max(0, Math.min(s.cursor, line.size));
      const pos = r ? r.position : line.positions[cur];
      const last = r ? r.last : (cur > 0 ? line.moves[cur - 1] : null);
      const can = this.canPlay();
      const next = can ? line.moves[cur] : null;
      const arrows = [];
      if (r?.arrow) arrows.push(r.arrow);
      if (next && s.hintStage >= 2) arrows.push({ from: next.from, to: next.to, color: c.green });
      const marks = next && s.hintStage >= 1 ? [[next.from, c.green]] : [];
      const badges = [];
      if (r) {
        if (r.badge) badges.push(r.badge);
      } else if (cur > 0) {
        const cb = captureBadge(line.positions[cur - 1], line.moves[cur - 1]);
        if (cb) badges.push(cb);
      }

      this.board.setState({
        position: pos,
        colors: c,
        flipped: !this.playerWhite,
        interactive: can,
        lastMove: last,
        anim: s.anim,
        arrows,
        marks,
        badges,
      });
    }

    const title = p ? `🧩 Type de problème : ${primaryTheme(p.themes).name}` : null;
    this.feedbackCard.setState(s.message, s.tone, title);

    this.backBtn.setConfig({ enabled: !s.refute && s.cursor > 0 });
    this.fwdBtn.setConfig({ enabled: !s.refute && s.cursor < s.progress });
    if (s.refute) {
      this.midBtn.setConfig({ label: '↩️ Réessayer', accent: 'red', filled: true, enabled: true });
    } else {
      this.midBtn.setConfig({
        label: `💡 Indice ${Math.min(2, s.hintStage + 1)}/2`,
        accent: 'green',
        filled: false,
        enabled: this.canPlay(),
      });
    }
  }
}
