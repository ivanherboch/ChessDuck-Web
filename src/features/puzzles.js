import { Line, PAWN, PIECE_NAMES_FR, pieceType } from '../core/chess.js';
import { PuzzleThemes } from '../core/puzzle-themes.js';
import { isMateScore, mateIn } from '../core/stockfish.js';
import { PUZZLE_COUNT, db } from '../data/db.js';
import { prefs } from '../data/prefs.js';
import { ChessBoardView } from '../ui/board.js';
import { createSideDot } from '../ui/captured.js';
import {
    FeedbackCardView, ModuleLayoutView, Tone, createSheet,
    duckButton, duckIconButton, el, emptyState, formatFr, loadingState,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { moveAnim, undoAnim } from '../ui/line-playback.js';
import { openExportSheet } from './export-sheet.js';
import { openPuzzleCatalog } from './puzzle-catalog.js';

export const REFUTE_HOLD = 4000;

export class PuzzlesFeature {
    constructor(engine) {
        this.engine = engine;
        this.el = el('div', 'feature-root');
        this.layout = new ModuleLayoutView({ bottomMin: 170 });
        this.board = new ChessBoardView();
        this.feedbackCard = new FeedbackCardView();

        this.loadingEl = loadingState('Chargement du problème…');
        this.emptyHost = el('div', 'empty-center hidden');
        this.el.append(this.loadingEl, this.emptyHost);

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
            band: prefs.current.puzzleBand,
            theme: prefs.current.puzzleTheme,
            empty: false,
            themeRevealed: false,
            refuteUntil: 0,
            refuteHold: 0,
        };
        this.solvedIds = new Set();
        this.recents = [];
        this._palette = null;
        this._showCoords = true;
        this._playTimer = null;
        this._refuteAbort = null;
        this._refuteToken = 0;
        this._loadToken = 0;
        this._refuteRaf = 0;

        this._unsubSolved = db.subscribeSolvedIds((s) => {
            this.solvedIds = new Set(s);
            this._render();
        });
        this._lastRecentsKey = '';
        this._unsubPrefs = prefs.subscribe((st) => {
            const key = st.recentPuzzles.slice(1, 6).join(',');
            if (key !== this._lastRecentsKey) {
                this._lastRecentsKey = key;
                this._loadRecents(st.recentPuzzles.slice(1, 6));
            }
        });

        this._buildDom();
        this._init();
    }

    async _init() {
        const st = prefs.current;
        this.state.band = st.puzzleBand;
        this.state.theme = st.puzzleTheme;
        await db.initUserState();
        const id = st.puzzleId;
        const current = id ? await db.byId(id).catch(() => null) : null;
        if (current) this.show(current);
        else await this.random();
    }

    async _loadRecents(ids) {
        if (!ids.length) {
            this.recents = [];
            this._render();
            return;
        }
        try {
            const found = await db.byIds(ids);
            this.recents = ids.map((id) => found.find((p) => p.id === id)).filter(Boolean);
            this._render();
        } catch { /* ignore */ }
    }

    destroy() {
        if (this._playTimer) clearTimeout(this._playTimer);
        if (this._refuteRaf) cancelAnimationFrame(this._refuteRaf);
        this._refuteAbort?.abort();
        this._unsubSolved?.();
        this._unsubPrefs?.();
        this.board.destroy();
        this.feedbackCard.destroy();
        this.layout.destroy();
    }

    setThemeAndCoords(palette, showCoords) {
        this._palette = palette;
        this._showCoords = showCoords;
        this._renderBoard();
    }

    onActivate() {
        this.layout.relayout();
        this.board._syncCanvasSize();
        this.board.draw();
    }

    get themeVisible() {
        const s = this.state;
        return s.solved || s.themeRevealed || Boolean(PuzzleThemes.byKey[s.theme]);
    }

    get playerWhite() {
        return this.state.line?.positions[1]?.whiteToMove ?? true;
    }

    _buildDom() {
        this.topBar = el('div', 'top-bar');
        this.catalogBtn = duckButton({
            label: `0 / ${formatFr(PUZZLE_COUNT)}`,
            icon: 'Extension',
            accent: 'blue',
            onClick: () => this._openCatalog(),
        });
        this.catalogBtn.style.flex = '1';
        this.randomBtn = duckIconButton({ icon: 'Casino', ariaLabel: 'Problème aléatoire', accent: 'gold', onClick: () => this.random() });
        this.historyBtn = duckIconButton({ icon: 'History', ariaLabel: 'Problèmes récents', enabled: false, onClick: () => this._openRecentSheet() });
        this.exportBtn = duckIconButton({ icon: 'IosShare', ariaLabel: 'Exporter en image', onClick: () => this._openExport() });
        this.topBar.append(this.catalogBtn, this.randomBtn, this.historyBtn, this.exportBtn);

        this.metaRow = el('div', 'puzzle-meta-row');
        this.sideDot = createSideDot(true);
        this.turnLabelEl = el('span', 'puzzle-turn-label', '');
        this.infoLabelEl = el('span', 'puzzle-info-label', '');
        this.metaRow.append(this.sideDot, this.turnLabelEl, this.infoLabelEl);

        this.layout.topSlot.append(this.topBar, this.metaRow);
        this.layout.boardHost.appendChild(this.board.el);

        this.refuteBarWrap = el('div', 'refute-progress-wrap hidden');
        this.refuteBarFill = el('div', 'refute-progress-fill');
        this.refuteBarWrap.appendChild(this.refuteBarFill);

        this.navRow = el('div', 'equal-row puzzle-nav-row');
        this.bottomEmptyHost = el('div', 'hidden');
        this.layout.bottomSlot.append(this.bottomEmptyHost, this.feedbackCard.el, this.refuteBarWrap, this.navRow);
    }

    _openCatalog() {
        openPuzzleCatalog({
            state: this.state,
            onSetBand: (b) => this.setBand(b),
            onSetFilter: (b, t) => this.setFilter(b, t),
            onOpenById: (raw) => this.openById(raw),
            onOpenSuggestion: (id) => this.openSuggestion(id),
        });
    }

    _openRecentSheet() {
        const sheet = createSheet('Derniers problèmes joués');
        const b = sheet.body;
        const knownThemes = prefs.current.knownThemePuzzles || [];
        for (const r of this.recents) {
            const done = this.solvedIds.has(r.id);
            // Thème visible si le problème est résolu, ou s'il était déjà affiché quand il a été joué.
            const themeShown = done || knownThemes.includes(r.id);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'recent-puzzle-row';
            const left = el('div', 'recent-puzzle-left');
            left.append(
                el('div', 'recent-puzzle-title', `#${r.id} · ${themeShown ? PuzzleThemes.primary(r.themes).name : 'thème masqué'}`),
                el('div', 'recent-puzzle-sub', `${PuzzleThemes.BANDS[PuzzleThemes.bandOf(r.rating)]} · ${r.rating}`),
            );
            const right = el('div', 'recent-puzzle-right');
            if (done) right.appendChild(createIcon('CheckCircle', 18, 'recent-done-ic'));
            right.appendChild(el('span', `recent-status ${done ? 'is-done' : ''}`, done ? 'Résolu' : 'À résoudre'));
            row.append(left, right);
            row.addEventListener('click', () => {
                feedback.key();
                sheet.close();
                this.openPuzzle(r);
            });
            b.appendChild(row);
        }
    }

    _openExport() {
        const s = this.state;
        if (!s.puzzle || !s.line) return;
        openExportSheet({
            puzzle: s.puzzle,
            line: s.line,
            playerWhite: this.playerWhite,
            solved: s.solved,
        });
    }

    _turnLabel(white) {
        return white ? 'Trait aux Blancs' : 'Trait aux Noirs';
    }

    _cancelTimers() {
        this._refuteToken += 1;
        if (this._playTimer) { clearTimeout(this._playTimer); this._playTimer = null; }
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        this._refuteAbort?.abort();
        this._refuteAbort = null;
    }

    show(p) {
        this._cancelTimers();
        let line;
        try {
            line = Line.fromUci(p.fen, p.moves);
        } catch {
            return;
        }
        const white = line.positions[1].whiteToMove;
        Object.assign(this.state, {
            puzzle: p,
            line,
            progress: 0,
            cursor: 0,
            solved: false,
            anim: null,
            hintStage: 0,
            refute: null,
            empty: false,
            themeRevealed: Boolean(prefs.current.knownThemePuzzles?.includes(p.id)),
            message: `${this._turnLabel(white)} : trouvez la meilleure suite.`,
            tone: Tone.INFO,
            refuteUntil: 0,
            refuteHold: 0,
        });
        prefs.pushRecentPuzzle(p.id);
        // Thème déjà affiché (filtre sur un thème précis) : il le restera dans la liste des récents.
        if (this.themeVisible) prefs.markThemeKnown(p.id);
        this._ensureVisible();
        this._render();

        const token = ++this._loadToken;
        this._playTimer = setTimeout(() => {
            this._playTimer = null;
            if (token !== this._loadToken || this.state.puzzle?.id !== p.id) return;
            this.state.progress = 1;
            this.state.cursor = 1;
            this.state.anim = moveAnim(line.positions[0], line.moves[0]);
            this._render();
        }, 600);
    }

    openPuzzle(p) {
        this.show(p);
    }

    async openSuggestion(id) {
        const p = await db.byId(id).catch(() => null);
        if (p) this.show(p);
    }

    async openById(raw) {
        const parts = raw.trim().replace(/^#/, '').split('/');
        const id = parts[parts.length - 1].trim();
        if (!id) return false;
        const p = (await db.byId(id).catch(() => null)) || (await db.byIdIgnoreCase(id).catch(() => null));
        if (p) {
            this.show(p);
            return true;
        }
        return false;
    }

    async random() {
        const token = ++this._loadToken;
        this._cancelTimers();
        const s = this.state;
        const range = PuzzleThemes.bandRange(s.band);
        const cur = s.puzzle?.id || '';
        const group = PuzzleThemes.groupOf(s.theme);
        let themes = null;
        if (group) themes = PuzzleThemes.all.filter((it) => it.group === group).map((it) => it.key);
        else if (s.theme) themes = [s.theme];

        const id = await db.randomId(themes, range, cur).catch(() => null);
        if (token !== this._loadToken) return;
        const p = id ? await db.byId(id).catch(() => null) : null;
        if (token !== this._loadToken) return;
        if (p) {
            this.show(p);
        } else {
            s.empty = true;
            s.tone = Tone.BAD;
            s.message = 'Aucun problème ne correspond à ces filtres. Élargissez la sélection dans le catalogue.';
            this._ensureVisible();
            this._render();
        }
    }

    revealTheme() {
        this.state.themeRevealed = true;
        if (this.state.puzzle?.id) prefs.markThemeKnown(this.state.puzzle.id);
        this._render();
    }

    setBand(band) {
        this.state.band = band;
        prefs.setPuzzleFilter(band, this.state.theme);
    }

    setFilter(band, theme) {
        this.state.band = band;
        this.state.theme = theme;
        prefs.setPuzzleFilter(band, theme);
        this.random();
    }

    back() {
        const s = this.state;
        if (!s.line || s.refute || s.cursor <= 0) return;
        const t = s.cursor - 1;
        s.cursor = t;
        s.anim = undoAnim(s.line.positions[t], s.line.moves[t]);
        s.hintStage = 0;
        this._render();
    }

    forward() {
        const s = this.state;
        if (!s.line || s.refute || s.cursor >= s.progress) return;
        s.anim = moveAnim(s.line.positions[s.cursor], s.line.moves[s.cursor]);
        s.cursor += 1;
        s.hintStage = 0;
        this._render();
    }

    canPlay(s = this.state) {
        if (!s.line) return false;
        return !s.refute && s.cursor >= 1 && s.cursor < s.line.size && s.cursor <= s.progress &&
            s.line.positions[s.cursor].whiteToMove === this.playerWhite;
    }

    hint() {
        const s = this.state;
        if (!this.canPlay(s)) return;
        const stage = Math.min(2, s.hintStage + 1);
        s.hintStage = stage;
        s.tone = Tone.GOLD;
        s.message = stage === 1
            ? 'Indice 1/2 : la pièce à jouer est surlignée en vert.'
            : 'Indice 2/2 : la flèche montre le coup à jouer.';
        this._render();
    }

    onMove(m) {
        const s = this.state;
        const line = s.line;
        const p = s.puzzle;
        if (!line || !p || !this.canPlay(s)) return 0;
        this._cancelTimers();

        const cur = s.cursor;
        const pos = line.positions[cur];
        const expected = line.moves[cur];
        const after = pos.play(m);
        if (m.equals(expected) || after.isCheckmate) {
            const newLine = m.equals(expected)
                ? line
                : new Line(line.startFen, [...line.moves.slice(0, cur), m]);
            const finished = cur + 1 >= newLine.size;
            s.line = newLine;
            s.cursor = cur + 1;
            s.progress = cur + 1;
            s.anim = moveAnim(pos, m);
            s.hintStage = 0;
            s.solved = s.solved || finished;
            s.tone = Tone.GOOD;
            s.message = finished ? this._solvedMessage(p) : `${newLine.sans[cur]} — bon coup ! La suite arrive…`;
            this._render();

            if (finished) {
                db.markSolved(p.id);
                return 2;
            }
            const token = this._loadToken;
            this._playTimer = setTimeout(() => {
                this._playTimer = null;
                if (token !== this._loadToken || this.state.puzzle?.id !== p.id) return;
                const reply = newLine.moves[cur + 1];
                s.cursor = cur + 2;
                s.progress = cur + 2;
                s.anim = moveAnim(newLine.positions[cur + 1], reply);
                s.message = `Bien vu. L'adversaire répond ${newLine.sans[cur + 1]} : à vous de continuer.`;
                this._render();
            }, 600);
            return 1;
        }

        this._refute(pos, m, after, cur);
        return -1;
    }

    _solvedMessage(p) {
        const names = p.themes.trim().split(' ').map((k) => PuzzleThemes.byKey[k]?.name).filter(Boolean).slice(0, 4);
        return `Problème résolu ! ${names.length ? `Thèmes : ${names.join(', ')}. ` : ''}Touchez « Problème aléatoire » pour le suivant.`;
    }

    async _refute(pos, m, after, cur) {
        const s = this.state;
        const san = pos.san(m);
        const oppName = pos.whiteToMove ? 'Noirs' : 'Blancs';
        const token = ++this._refuteToken;

        s.progress = Math.max(cur, Math.min(s.progress, cur));
        s.cursor = cur;
        s.hintStage = 0;
        s.tone = Tone.BAD;
        s.anim = moveAnim(pos, m);
        s.refute = { position: after, last: m, arrow: null };
        s.refuteUntil = 0;
        s.refuteHold = 0;
        s.message = `${san} n'est pas la solution. Regardez la réponse des ${oppName}…`;
        this._render();

        const t0 = performance.now();
        if (!after.legalMoves.length) {
            s.message = `${san} met l'adversaire pat : la partie serait nulle alors que vous aviez bien mieux !`;
            s.refuteUntil = performance.now() + REFUTE_HOLD;
            s.refuteHold = REFUTE_HOLD;
            this._render();
            await new Promise((r) => { this._playTimer = setTimeout(r, REFUTE_HOLD); });
            if (token === this._refuteToken) this.retry();
            return;
        }

        this._refuteAbort = new AbortController();
        const timeoutId = setTimeout(() => this._refuteAbort?.abort(), 1800);
        let res = null;
        try {
            res = await this.engine.search(after.toFen(), 380, { signal: this._refuteAbort.signal });
        } finally {
            clearTimeout(timeoutId);
            this._refuteAbort = null;
        }
        if (token !== this._refuteToken) return;

        const waitMs = Math.max(0, 650 - (performance.now() - t0));
        if (waitMs > 0) {
            await new Promise((r) => { this._playTimer = setTimeout(r, waitMs); });
        }
        if (token !== this._refuteToken) return;

        const reply = (res?.best && after.isLegal(res.best))
            ? res.best
            : (after.legalMoves.find((mv) => mv.to === m.to) || after.legalMoves[0]);
        const replySan = after.san(reply);
        const after2 = after.play(reply);
        const score = res?.score ?? null;
        const captured = after.board[reply.to];
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
        };
        s.refuteUntil = performance.now() + REFUTE_HOLD;
        s.refuteHold = REFUTE_HOLD;
        s.message = `Réfutation : après ${san}, les ${oppName} répondent ${replySan}${detail} Le coup sera annulé automatiquement.`;
        this._render();

        this._playTimer = setTimeout(() => {
            this._playTimer = null;
            if (token === this._refuteToken) this.retry();
        }, REFUTE_HOLD);
    }

    retry() {
        if (!this.state.refute) return;
        this._cancelTimers();
        this.state.refute = null;
        this.state.anim = null;
        this.state.tone = Tone.INFO;
        this.state.refuteUntil = 0;
        this.state.message = 'Position rétablie : à vous de rejouer.';
        this._render();
    }

    _ensureVisible() {
        const s = this.state;
        if (!s.puzzle || !s.line) {
            if (s.empty) {
                this.loadingEl.classList.add('hidden');
                this.layout.el.remove();
                this.emptyHost.classList.remove('hidden');
                this.emptyHost.replaceChildren(emptyState({
                    icon: 'SearchOff',
                    title: 'Aucun problème trouvé',
                    message: 'Aucun problème ne correspond à ces filtres.',
                    actionLabel: 'Ouvrir le catalogue',
                    onAction: () => this._openCatalog(),
                    secondaryLabel: 'Réinitialiser les filtres',
                    onSecondary: () => this.setFilter(0, ''),
                }));
            }
            return;
        }
        this.loadingEl.remove();
        this.emptyHost.classList.add('hidden');
        if (!this.layout.el.parentElement) {
            this.el.appendChild(this.layout.el);
            this.layout.relayout();
        }
    }

    _updateCountdown() {
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        const s = this.state;
        if (!s.refute || !s.refuteUntil) {
            this.refuteBarWrap.classList.add('hidden');
            return;
        }
        this.refuteBarWrap.classList.remove('hidden');
        const tick = () => {
            const left = Math.max(0, s.refuteUntil - performance.now());
            const ratio = s.refuteHold > 0 ? Math.min(1, left / s.refuteHold) : 0;
            this.refuteBarFill.style.width = `${(ratio * 100).toFixed(2)}%`;
            if (left > 0 && this.state.refuteUntil === s.refuteUntil) {
                this._refuteRaf = requestAnimationFrame(tick);
            }
        };
        this._refuteRaf = requestAnimationFrame(tick);
    }

    _renderBoard() {
        const s = this.state;
        if (!s.puzzle || !s.line || !this._palette) return;
        const r = s.refute;
        const cur = Math.max(0, Math.min(s.line.size, s.cursor));
        const pos = r ? r.position : s.line.positions[cur];
        const last = r ? r.last : (cur > 0 ? s.line.moves[cur - 1] : null);
        const canPlay = this.canPlay(s);
        const next = canPlay ? s.line.moves[cur] : null;
        const arrows = [];
        if (r?.arrow) arrows.push(r.arrow);
        if (next && s.hintStage >= 2) arrows.push({ from: next.from, to: next.to, color: this._palette.green });

        this.board.setState({
            position: pos,
            flipped: !this.playerWhite,
            interactive: canPlay,
            lastMove: last,
            anim: s.anim,
            arrows,
            marks: next && s.hintStage >= 1 ? [[next.from, this._palette.green]] : [],
            badges: [],
            kid: false,
            showCoords: this._showCoords,
            palette: this._palette,
            onMove: (m) => {
                const code = this.onMove(m);
                if (code === 2) feedback.success();
                else if (code === -1) feedback.error();
            },
        });
    }

    _render() {
        const s = this.state;
        this._ensureVisible();
        const p = s.puzzle;
        const line = s.line;
        if (!p || !line) return;

        const type = PuzzleThemes.primary(p.themes);
        const visible = this.themeVisible;

        this.catalogBtn.querySelector('.duck-btn-label').textContent = `${formatFr(this.solvedIds.size)} / ${formatFr(PUZZLE_COUNT)}`;
        this.catalogBtn.setAttribute('aria-label', `Catalogue des problèmes : ${formatFr(this.solvedIds.size)} résolus sur ${formatFr(PUZZLE_COUNT)}`);
        this.randomBtn.classList.toggle('is-on', s.solved || s.empty);
        this.historyBtn.disabled = !this.recents.length;

        const newDot = createSideDot(this.playerWhite);
        this.sideDot.replaceWith(newDot);
        this.sideDot = newDot;
        this.turnLabelEl.textContent = this.playerWhite ? 'Trait aux Blancs' : 'Trait aux Noirs';
        this.infoLabelEl.textContent = `${visible ? type.name : 'Thème masqué'} · ${PuzzleThemes.BANDS[PuzzleThemes.bandOf(p.rating)]} ${p.rating} · #${p.id}`;

        if (s.empty) {
            this.feedbackCard.el.classList.add('hidden');
            this.navRow.classList.add('hidden');
            this.bottomEmptyHost.classList.remove('hidden');
            this.bottomEmptyHost.replaceChildren(emptyState({
                icon: 'SearchOff',
                title: 'Plus aucun problème',
                message: 'Aucun problème ne correspond à ces filtres.',
                actionLabel: 'Ouvrir le catalogue',
                onAction: () => this._openCatalog(),
                secondaryLabel: 'Réinitialiser les filtres',
                onSecondary: () => this.setFilter(0, ''),
            }));
        } else {
            this.bottomEmptyHost.classList.add('hidden');
            this.feedbackCard.el.classList.remove('hidden');
            this.navRow.classList.remove('hidden');

            const showTip = visible && !s.refute && !s.solved && s.tone === Tone.INFO;
            const text = s.message + (showTip ? `\nConseil : ${type.tip}` : '');
            const title = visible ? `Type de problème : ${type.name}` : 'Thème masqué (mode libre)';
            const actionEl = !visible
                ? duckButton({
                    label: 'Révéler le thème',
                    icon: 'Visibility',
                    accent: 'blue',
                    variant: 'outlined',
                    onClick: () => this.revealTheme(),
                })
                : null;
            this.feedbackCard.update({ text, tone: s.tone, title, actionEl });

            this._updateCountdown();

            const backBtn = duckIconButton({
                icon: 'KeyboardArrowLeft',
                ariaLabel: 'Coup précédent',
                enabled: !s.refute && s.cursor > 0,
                onClick: () => this.back(),
            });
            let midBtn;
            if (s.refute) {
                midBtn = duckButton({
                    label: 'Réessayer',
                    icon: 'Undo',
                    accent: 'red',
                    filled: true,
                    onClick: () => this.retry(),
                });
            } else if (s.solved) {
                midBtn = duckButton({
                    label: 'Problème aléatoire',
                    icon: 'Casino',
                    accent: 'gold',
                    filled: true,
                    onClick: () => this.random(),
                });
            } else {
                midBtn = duckButton({
                    label: `Indice ${Math.min(2, s.hintStage + 1)}/2`,
                    icon: 'Lightbulb',
                    accent: 'green',
                    enabled: this.canPlay(s),
                    onClick: () => this.hint(),
                });
            }
            midBtn.style.flex = '1';
            const fwdBtn = duckIconButton({
                icon: 'KeyboardArrowRight',
                ariaLabel: 'Coup suivant',
                enabled: !s.refute && s.cursor < s.progress,
                onClick: () => this.forward(),
            });
            this.navRow.replaceChildren(backBtn, midBtn, fwdBtn);
        }

        this.layout.relayout();
        this._renderBoard();
    }
}
