import {
    BISHOP, KING, KNIGHT, Line, PIECE_NAMES_FR, Position, QUEEN, ROOK, pieceLetter,
} from '../core/chess.js';
import { PUZZLE_COUNT, db } from '../data/db.js';
import { prefs } from '../data/prefs.js';
import { ChessBoardView } from '../ui/board.js';
import {
    FeedbackCardView, ModuleLayoutView, Tone,
    duckButton, duckIconButton, el, infoPill, loadingState,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { moveAnim } from '../ui/line-playback.js';
import { NotationLogic } from './notation-logic.js';

const LEVEL_SHORT = ['Tous', 'Bases', 'Prises', 'Roques'];

export class NotationFeature {
    constructor() {
        this.el = el('div', 'feature-root');
        this.layout = new ModuleLayoutView({ bottomMin: 298 });
        this.board = new ChessBoardView();
        this.feedbackCard = new FeedbackCardView();
        this.loadingEl = loadingState("Préparation de l'exercice…");
        this.el.appendChild(this.loadingEl);

        this.state = {
            level: prefs.current.notationLevel,
            exercise: null,
            shown: false,
            anim: null,
            flipped: false,
            input: '',
            message: "Observez le coup joué sur l'échiquier, puis écrivez-le en notation anglaise FIDE.",
            tone: Tone.INFO,
            solved: false,
            hintStage: 0,
            streak: 0,
            best: prefs.current.notationBest,
        };

        this._palette = null;
        this._showCoords = true;
        this._nextToken = 0;
        this._showTimer = null;
        this._menuOpen = false;
        this._docClickBound = null;
        this._destroyed = false;

        this._buildDom();
        this._init();
    }

    async _init() {
        const st = prefs.current;
        this.state.level = st.notationLevel;
        this.state.best = st.notationBest;
        await this.next();
    }

    destroy() {
        this._destroyed = true;
        this._nextToken += 1;
        if (this._showTimer) clearTimeout(this._showTimer);
        if (this._docClickBound) document.removeEventListener('click', this._docClickBound, true);
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

    onDeactivate() {
        this._toggleMenu(false);
    }

    _buildDom() {
        // Top row
        this.topRow = el('div', 'top-bar notation-top-bar');
        this.levelWrap = el('div', 'dropdown-wrap flex-1');
        this.levelBtn = duckButton({
            label: `Niveau : ${LEVEL_SHORT[this.state.level]}`,
            icon: 'Tune',
            onClick: (e) => {
                e.stopPropagation();
                this._toggleMenu(!this._menuOpen);
            },
        });
        this.levelBtn.classList.add('level-btn');
        this.levelMenu = el('div', 'duck-dropdown hidden');
        this.levelMenu.setAttribute('role', 'menu');
        this.levelItems = [];
        NotationLogic.LEVELS.forEach((label, i) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'duck-dropdown-item';
            item.setAttribute('role', 'menuitem');
            const chk = el('span', 'duck-dropdown-check');
            chk.appendChild(createIcon('Check', 18));
            const txt = el('span', '', i === 0 ? 'Tous les niveaux' : label);
            item.append(chk, txt);
            item.addEventListener('click', () => {
                feedback.key();
                this._toggleMenu(false);
                this.setLevel(i);
            });
            this.levelItems.push({ item, chk });
            this.levelMenu.appendChild(item);
        });
        this.levelWrap.append(this.levelBtn, this.levelMenu);

        this._docClickBound = (e) => {
            if (this._menuOpen && !this.levelWrap.contains(e.target)) {
                this._toggleMenu(false);
            }
        };
        document.addEventListener('click', this._docClickBound, true);

        this.flipBtn = duckIconButton({ icon: 'SwapVert', ariaLabel: "Retourner l'échiquier", onClick: () => this.flip() });
        this.replayBtn = duckIconButton({ icon: 'Replay', ariaLabel: 'Revoir le coup', onClick: () => this.replay() });
        this.hintBtn = duckIconButton({ icon: 'Lightbulb', ariaLabel: 'Indice', accent: 'green', onClick: () => this.hint() });
        this.nextBtn = duckIconButton({ icon: 'SkipNext', ariaLabel: 'Exercice suivant', accent: 'gold', onClick: () => this.next() });
        this.topRow.append(this.levelWrap, this.flipBtn, this.replayBtn, this.hintBtn, this.nextBtn);
        this.layout.topSlot.appendChild(this.topRow);

        // Board
        this.layout.boardHost.appendChild(this.board.el);

        // Under-board pills
        this.underRow = el('div', 'notation-under-row');
        this.orientPill = infoPill({ text: 'Vue Blancs', icon: 'SwapVert' });
        this.streakPill = infoPill({ text: 'Série 0 · record 0', icon: 'LocalFireDepartment' });
        this.underRow.append(this.orientPill, this.streakPill);
        this.layout.underSlot.appendChild(this.underRow);

        // Bottom: Feedback + input bar + FIDE keyboard
        this.layout.bottomSlot.appendChild(this.feedbackCard.el);

        this.inputRow = el('div', 'notation-input-row');
        this.inputBox = el('div', 'notation-input-box');
        this.clearIconBtn = duckIconButton({ icon: 'Close', ariaLabel: 'Tout effacer', onClick: () => this.clear() });
        this.clearSpacer = el('div', 'notation-clear-spacer');
        this.inputText = el('span', 'notation-input-text is-empty', 'Votre réponse…');
        this.inputBox.append(this.clearIconBtn, this.clearSpacer, this.inputText);

        this.bsBtn = document.createElement('button');
        this.bsBtn.type = 'button';
        this.bsBtn.className = 'notation-bs-btn';
        this.bsBtn.setAttribute('aria-label', 'Effacer');
        this.bsBtn.appendChild(createIcon('Backspace', 22));
        this._bindBackspace();

        this.actionBtn = duckButton({
            label: 'Valider',
            icon: 'Check',
            accent: 'gold',
            filled: true,
            className: 'notation-validate-btn',
            onClick: () => {
                if (this.state.solved) {
                    this.next();
                } else {
                    if (this.validate()) feedback.success();
                    else feedback.error();
                }
            },
        });
        this.inputRow.append(this.inputBox, this.bsBtn, this.actionBtn);
        this.layout.bottomSlot.appendChild(this.inputRow);

        // FIDE virtual keyboard
        this.kbEl = el('div', 'fide-kb');
        this.keyButtons = [];

        const makeKey = (label, { sub = null, sub2 = null, ariaLabel, flex = 1, keyVal = label } = {}) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `fide-key${sub ? ' is-piece' : ''}`;
            btn.style.flex = String(flex);
            btn.setAttribute('aria-label', ariaLabel || label);
            btn.appendChild(el('span', 'fide-key-main', label));
            if (sub) btn.appendChild(el('span', 'fide-key-sub', sub));
            if (sub2) btn.appendChild(el('span', 'fide-key-sub2', sub2));
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                feedback.key();
                if (!this.type(keyVal)) feedback.error();
            });
            this.keyButtons.push(btn);
            return btn;
        };

        const row1 = el('div', 'fide-row fide-row-pieces');
        for (const [pt, sub] of [[KING, 'King'], [QUEEN, 'Queen'], [ROOK, 'Rook'], [BISHOP, 'Bishop'], [KNIGHT, 'Knight']]) {
            const k = pieceLetter(pt);
            row1.appendChild(makeKey(k, {
                sub,
                sub2: PIECE_NAMES_FR[pt],
                ariaLabel: `${k}, ${sub}, ${PIECE_NAMES_FR[pt]}`,
            }));
        }

        const row2 = el('div', 'fide-row fide-row-compact');
        for (let i = 0; i < 8; i++) {
            const ch = String.fromCharCode(97 + i);
            row2.appendChild(makeKey(ch, { ariaLabel: `colonne ${ch}` }));
        }

        const row3 = el('div', 'fide-row fide-row-compact');
        for (let i = 1; i <= 8; i++) {
            const ch = String(i);
            row3.appendChild(makeKey(ch, { ariaLabel: `rangée ${ch}` }));
        }

        const row4 = el('div', 'fide-row');
        for (const [k, d] of [['x', 'x, prise'], ['+', 'plus, échec'], ['#', 'dièse, échec et mat'], ['=', 'égal, promotion']]) {
            row4.appendChild(makeKey(k, { ariaLabel: d }));
        }
        row4.appendChild(makeKey('O-O', { ariaLabel: 'petit roque', flex: 1.4 }));
        row4.appendChild(makeKey('O-O-O', { ariaLabel: 'grand roque', flex: 1.8 }));

        this.kbEl.append(row1, row2, row3, row4);
        this.layout.bottomSlot.appendChild(this.kbEl);
    }

    _bindBackspace() {
        let timer = null;
        let longTriggered = false;
        const cancelTimer = () => {
            if (timer) { clearTimeout(timer); timer = null; }
        };
        this.bsBtn.addEventListener('pointerdown', (e) => {
            if (this.bsBtn.disabled) return;
            e.preventDefault();
            longTriggered = false;
            cancelTimer();
            timer = setTimeout(() => {
                longTriggered = true;
                timer = null;
                feedback.error();
                this.clear();
            }, 450);
        });
        this.bsBtn.addEventListener('pointerup', () => {
            if (this.bsBtn.disabled) { cancelTimer(); return; }
            const wasLong = longTriggered;
            cancelTimer();
            if (!wasLong) {
                feedback.key();
                this.backspace();
            }
        });
        this.bsBtn.addEventListener('pointercancel', cancelTimer);
        this.bsBtn.addEventListener('pointerleave', cancelTimer);
        this.bsBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _toggleMenu(open) {
        this._menuOpen = open;
        this.levelMenu.classList.toggle('hidden', !open);
        this.levelBtn.setAttribute('aria-expanded', String(open));
    }

    setLevel(level) {
        this.state.level = level;
        prefs.setNotationLevel(level);
        this.next();
    }

    async next() {
        const token = ++this._nextToken;
        if (this._showTimer) { clearTimeout(this._showTimer); this._showTimer = null; }
        const level = this.state.level;
        const ex = await this._generate(level);
        if (this._destroyed || token !== this._nextToken) return;
        this.state.exercise = ex;
        this.state.shown = false;
        this.state.anim = null;
        this.state.flipped = !ex.before.whiteToMove;
        this.state.input = '';
        this.state.solved = false;
        this.state.hintStage = 0;
        this.state.message = "Quel coup vient d'être joué ? Écrivez-le en notation anglaise FIDE.";
        this.state.tone = Tone.INFO;
        this._ensureMounted();
        this._render();
        this._play(450);
    }

    _ensureMounted() {
        if (this.loadingEl.parentElement) {
            this.loadingEl.remove();
            this.el.appendChild(this.layout.el);
            this.layout.relayout();
        }
    }

    async _generate(level) {
        const target = level === 0 ? 1 + Math.floor(Math.random() * 3) : level;
        try {
            await db.ensureMeta();
            for (let attempt = 0; attempt < 6; attempt++) {
                const start = 1 + Math.floor(Math.random() * (PUZZLE_COUNT - 41));
                const kind = target === 3 ? 1 + Math.floor(Math.random() * 4) : 0;
                let batch;
                if (kind === 1) batch = await db.sliceCastling(start, 60);
                else if (kind === 2) batch = await db.sliceThemes(start, ['promotion', 'underPromotion'], 30);
                else if (kind === 3) batch = await db.sliceThemes(start, ['mateIn1'], 30);
                else batch = await db.slice(start, 30);

                const positions = [];
                for (const pz of batch) {
                    try {
                        const line = Line.fromUci(pz.fen, pz.moves);
                        if (kind === 1) {
                            positions.push(line.positions[0], line.positions[1]);
                        } else if (kind === 3) {
                            positions.push(line.positions[line.size - 1]);
                        } else {
                            for (let i = 0; i < line.positions.length - 1; i++) positions.push(line.positions[i]);
                        }
                    } catch { /* ignore invalid puzzle line */ }
                }
                const picked = NotationLogic.pick(positions, target, Math.random, kind);
                if (picked) return picked;
            }
        } catch { /* fallback below */ }
        const fallback = NotationLogic.buildFallbackPositions();
        return NotationLogic.pick(fallback, target, Math.random) || NotationLogic.pick(fallback, 0, Math.random);
    }

    _play(delayMs) {
        if (this._showTimer) clearTimeout(this._showTimer);
        const token = this._nextToken;
        this._showTimer = setTimeout(() => {
            this._showTimer = null;
            if (this._destroyed || token !== this._nextToken) return;
            const ex = this.state.exercise;
            if (!ex) return;
            this.state.shown = true;
            this.state.anim = moveAnim(ex.before, ex.move);
            this._render();
        }, delayMs);
    }

    replay() {
        if (!this.state.exercise) return;
        this.state.shown = false;
        this.state.anim = null;
        this._render();
        this._play(350);
    }

    flip() {
        this.state.flipped = !this.state.flipped;
        this._render();
    }

    type(key) {
        const s = this.state;
        if (s.solved) return false;
        if (key.startsWith('O-O')) {
            if (s.input.length > 0 && !s.input.startsWith('O-O')) {
                s.tone = Tone.GOLD;
                s.message = "Le roque s'écrit seul (O-O ou O-O-O). Effacez d'abord la saisie : touche « Tout effacer » ou appui long sur ⌫.";
                this._render();
                return false;
            }
            s.input = key;
            this._render();
            return true;
        }
        if (s.input.startsWith('O-O') && key !== '+' && key !== '#') {
            s.tone = Tone.GOLD;
            s.message = "Après un roque, seuls « + » (échec) ou « # » (mat) peuvent suivre.";
            this._render();
            return false;
        }
        if (s.input.length + key.length > 9) return false;
        s.input += key;
        this._render();
        return true;
    }

    backspace() {
        if (this.state.solved || !this.state.input.length) return;
        this.state.input = this.state.input.slice(0, -1);
        this._render();
    }

    clear() {
        if (this.state.solved || !this.state.input.length) return;
        this.state.input = '';
        this._render();
    }

    hint() {
        const s = this.state;
        const ex = s.exercise;
        if (!ex || s.solved) return;
        const stage = Math.min(2, s.hintStage + 1);
        s.hintStage = stage;
        s.message = NotationLogic.hint(ex, stage);
        s.tone = Tone.GOLD;
        this._render();
    }

    validate() {
        const s = this.state;
        const ex = s.exercise;
        if (!ex) return false;
        if (s.input === ex.san) {
            const streak = s.streak + 1;
            s.solved = true;
            s.tone = Tone.GOOD;
            s.streak = streak;
            s.best = Math.max(s.best, streak);
            s.message = `Exact : ${ex.san}. ${NotationLogic.explain(ex)}`;
            if (streak > prefs.current.notationBest) {
                prefs.setNotationBest(streak);
            }
            this._render();
            return true;
        }
        s.tone = Tone.BAD;
        s.streak = 0;
        s.message = NotationLogic.diagnose(s.input, ex);
        this._render();
        return false;
    }

    _renderBoard() {
        const ex = this.state.exercise;
        if (!ex || !this._palette) return;
        const pos = this.state.shown ? ex.before.play(ex.move) : ex.before;
        this.board.setState({
            position: pos,
            flipped: this.state.flipped,
            interactive: false,
            lastMove: this.state.shown ? ex.move : null,
            anim: this.state.anim,
            arrows: this.state.shown ? [{ from: ex.move.from, to: ex.move.to, color: this._palette.blue }] : [],
            marks: [],
            badges: [],
            kid: false,
            showCoords: this._showCoords,
            palette: this._palette,
        });
    }

    _render() {
        const s = this.state;
        if (!s.exercise) return;

        // Top controls
        this.levelBtn.querySelector('.duck-btn-label').textContent = `Niveau : ${LEVEL_SHORT[s.level]}`;
        this.levelBtn.setAttribute('aria-label', `Niveau d'exercice : ${NotationLogic.LEVELS[s.level]}. Toucher pour changer`);
        this.levelItems.forEach(({ item, chk }, i) => {
            item.classList.toggle('is-selected', i === s.level);
            chk.style.visibility = i === s.level ? 'visible' : 'hidden';
        });

        this.hintBtn.disabled = s.solved;
        const oldBadge = this.hintBtn.querySelector('.duck-icon-badge');
        if (s.hintStage > 0) {
            if (oldBadge) oldBadge.textContent = `${s.hintStage}/2`;
            else this.hintBtn.appendChild(el('span', 'duck-icon-badge', `${s.hintStage}/2`));
        } else if (oldBadge) {
            oldBadge.remove();
        }
        this.nextBtn.classList.toggle('is-on', s.solved);

        // Under-board pills
        const newOrient = infoPill({
            text: s.flipped ? 'Vue Noirs' : 'Vue Blancs',
            icon: 'SwapVert',
            ariaLabel: s.flipped ? 'Échiquier vu du côté des Noirs : les colonnes vont de h à a' : 'Échiquier vu du côté des Blancs',
        });
        this.orientPill.replaceWith(newOrient);
        this.orientPill = newOrient;

        const newStreak = infoPill({
            text: `Série ${s.streak} · record ${s.best}`,
            icon: 'LocalFireDepartment',
            accent: s.streak > 0 ? 'gold' : null,
            ariaLabel: `Série en cours : ${s.streak} bonne${s.streak > 1 ? 's' : ''} réponse${s.streak > 1 ? 's' : ''}. Record : ${s.best}`,
        });
        this.streakPill.replaceWith(newStreak);
        this.streakPill = newStreak;

        // Feedback card
        this.feedbackCard.update({ text: s.message, tone: s.tone });

        // Input bar
        const showClear = s.input.length > 0 && !s.solved;
        this.clearIconBtn.classList.toggle('hidden', !showClear);
        this.clearSpacer.classList.toggle('hidden', showClear);
        this.inputBox.classList.toggle('is-solved', s.solved);
        this.inputText.textContent = s.input || 'Votre réponse…';
        this.inputText.classList.toggle('is-empty', !s.input.length);
        this.inputText.classList.toggle('is-solved', s.solved);

        this.bsBtn.disabled = s.solved || !s.input.length;

        // Action button (Valider / Suivant)
        const nextActionBtn = duckButton({
            label: s.solved ? 'Suivant' : 'Valider',
            icon: s.solved ? 'ArrowForward' : 'Check',
            accent: s.solved ? 'green' : 'gold',
            filled: true,
            enabled: s.solved || s.input.length > 0,
            className: 'notation-validate-btn',
            onClick: () => {
                if (this.state.solved) {
                    this.next();
                } else {
                    if (this.validate()) feedback.success();
                    else feedback.error();
                }
            },
        });
        this.actionBtn.replaceWith(nextActionBtn);
        this.actionBtn = nextActionBtn;

        const keysEnabled = !s.solved;
        for (const btn of this.keyButtons) btn.disabled = !keysEnabled;

        this.layout.relayout();
        this._renderBoard();
    }
}
