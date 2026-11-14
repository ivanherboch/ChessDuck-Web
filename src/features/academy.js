import { CATEGORY_LABELS, Lessons } from '../core/lessons.js';
import { db } from '../data/db.js';
import { prefs } from '../data/prefs.js';
import { ChessBoardView } from '../ui/board.js';
import {
    FeedbackCardView, ModuleLayoutView, MoveStripView, Tone,
    duckButton, duckIconButton, duckSegmentedRow, el, infoPill, loadingState,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { LinePlaybackController, moveAnim } from '../ui/line-playback.js';
import { openLessonCatalog } from './lesson-catalog.js';

export function moveLabel(fullmove, white, san) {
    return white ? `${fullmove}. ${san}` : `${fullmove}… ${san}`;
}

export class AcademyFeature {
    constructor() {
        this.el = el('div', 'feature-root');
        this.layout = new ModuleLayoutView({ bottomMin: 190 });
        this.board = new ChessBoardView();
        this.moveStrip = new MoveStripView();
        this.feedbackCard = new FeedbackCardView();
        this.playback = new LinePlaybackController();

        this.loadingEl = loadingState('Chargement des leçons…');
        this.el.appendChild(this.loadingEl);

        this.state = {
            lessonId: prefs.current.lessonId || 1,
            filter: null,
            challenge: false,
            cursor: 0,
            playing: false,
            flipped: false,
            anim: null,
            hintStage: 0,
            message: '',
            tone: Tone.INFO,
            done: false,
        };
        this.mastered = new Set();
        this._palette = null;
        this._showCoords = true;
        this._catalog = null;

        this._unsubLessons = db.subscribeMasteredLessons((set) => {
            this.mastered = new Set(set);
            this._catalog?.updateMastered(this.mastered);
            if (Lessons.all.length) this._render();
        });

        this._init();
    }

    async _init() {
        await Lessons.load();
        this._buildDom();
        this.open(prefs.current.lessonId || 1, false);
        this.loadingEl.remove();
        this.el.appendChild(this.layout.el);
        this.layout.relayout();
        this._render();
    }

    destroy() {
        this.playback.cancel();
        this._unsubLessons?.();
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

    get lesson() {
        return Lessons.byId(this.state.lessonId);
    }

    _buildDom() {
        // Row 1: prev lesson / selector card / next lesson
        this.selRow = el('div', 'academy-sel-row');
        this.prevLessonBtn = duckIconButton({ icon: 'KeyboardArrowLeft', ariaLabel: 'Leçon précédente', onClick: () => this.prevLesson() });
        this.selectorBtn = document.createElement('button');
        this.selectorBtn.type = 'button';
        this.selectorBtn.className = 'academy-selector';
        this.selTop = el('div', 'academy-sel-top');
        this.catPill = infoPill({ text: '', accent: 'blue' });
        this.doneBadge = createIcon('CheckCircle', 18, 'academy-done-ic hidden');
        this.selSpacer = el('div', 'flex-1');
        this.countLabel = el('span', 'academy-mastered-count', '');
        this.expandIcon = createIcon('ExpandMore', 20, 'academy-expand-ic');
        this.selTop.append(this.catPill, this.doneBadge, this.selSpacer, this.countLabel, this.expandIcon);
        this.selTitle = el('div', 'academy-sel-title', '');
        this.selectorBtn.append(this.selTop, this.selTitle);
        this.selectorBtn.addEventListener('click', () => {
            feedback.key();
            this._openCatalogSheet();
        });
        this.nextLessonBtn = duckIconButton({ icon: 'KeyboardArrowRight', ariaLabel: 'Leçon suivante', onClick: () => this.nextLesson() });
        this.selRow.append(this.prevLessonBtn, this.selectorBtn, this.nextLessonBtn);

        // Row 2: Segmented Guidé/Défi + flip
        this.modeRow = el('div', 'academy-mode-row');
        this.segWrap = el('div', 'flex-1');
        this.flipBtn = duckIconButton({ icon: 'SwapVert', ariaLabel: "Retourner l'échiquier", onClick: () => this.flip() });
        this.modeRow.append(this.segWrap, this.flipBtn);

        this.layout.topSlot.append(this.selRow, this.modeRow);
        this.layout.boardHost.appendChild(this.board.el);

        this.actionRow = el('div', 'equal-row academy-actions');
        this.layout.bottomSlot.append(this.moveStrip.el, this.feedbackCard.el, this.actionRow);
    }

    _openCatalogSheet() {
        this._catalog = openLessonCatalog({
            currentLessonId: this.state.lessonId,
            currentFilter: this.state.filter,
            masteredSet: this.mastered,
            onSelectFilter: (cat) => this.setFilter(cat),
            onOpenLesson: (id) => this.open(id),
            onClose: () => { this._catalog = null; },
        });
    }

    open(id, save = true) {
        this.playback.cancel();
        const l = Lessons.byId(id);
        if (!l) return;
        const challenge = this.state.challenge;
        this.state.lessonId = l.id;
        this.state.cursor = 0;
        this.state.playing = false;
        this.state.flipped = !l.heroWhite;
        this.state.anim = null;
        this.state.hintStage = 0;
        this.state.done = false;
        if (this.state.filter !== null && this.state.filter !== l.category) {
            this.state.filter = l.category;
        }
        if (save) prefs.setLesson(l.id);
        if (challenge) {
            this._startChallenge();
        } else {
            this.state.message = '';
            this.state.tone = Tone.INFO;
        }
        this._render();
    }

    setFilter(cat) {
        this.state.filter = cat;
        if (cat !== null && this.lesson && this.lesson.category !== cat) {
            const first = Lessons.all.find((it) => it.category === cat);
            if (first) this.open(first.id);
        }
    }

    flip() {
        this.state.flipped = !this.state.flipped;
        this._renderBoard();
    }

    setChallenge(on) {
        if (this.state.challenge === on) return;
        this.playback.cancel();
        this.state.challenge = on;
        this.state.cursor = 0;
        this.state.playing = false;
        this.state.anim = null;
        this.state.hintStage = 0;
        this.state.done = false;
        this.state.message = '';
        this.state.tone = Tone.INFO;
        if (on) this._startChallenge();
        this._render();
    }

    // ---- Mode Guidé ----
    goTo(target) {
        const l = this.lesson;
        if (!l) return;
        const t = Math.max(0, Math.min(l.line.size, target));
        if (t === this.state.cursor) return;
        this.state.anim = LinePlaybackController.transition(l.line, this.state.cursor, t);
        this.state.cursor = t;
        this._render();
    }

    step(delta) {
        this.pause();
        this.goTo(this.state.cursor + delta);
    }

    rewind() {
        this.pause();
        this.goTo(0);
    }

    jump(n) {
        this.pause();
        this.goTo(n);
    }

    last() {
        if (!this.lesson) return;
        this.pause();
        this.goTo(this.lesson.line.size);
    }

    pause() {
        this.playback.cancel();
        this.state.playing = false;
        this._render();
    }

    togglePlay() {
        if (this.state.playing) { this.pause(); return; }
        const l = this.lesson;
        if (!l) return;
        this.playback.cancel();
        if (this.state.cursor >= l.line.size) this.goTo(0);
        this.state.playing = true;
        this._render();
        this.playback.autoplay({
            cursor: () => this.state.cursor,
            size: () => l.line.size,
            delayFor: (c) => (c === 0 ? 700 : 2600),
            checkBeforeDelay: true,
            advance: (t) => this.goTo(t),
            onEnd: () => {
                this.state.playing = false;
                this._render();
            },
        });
    }

    // ---- Mode Défi ----
    _startChallenge() {
        const l = this.lesson;
        if (!l) return;
        const side = l.heroWhite ? 'Blancs' : 'Noirs';
        this.state.cursor = 0;
        this.state.anim = null;
        this.state.hintStage = 0;
        this.state.done = false;
        this.state.tone = Tone.INFO;
        this.state.flipped = !l.heroWhite;
        this.state.message = `À vous de jouer les coups des ${side} sur l'échiquier. ${l.summary}`;
        this._advanceOpponent();
    }

    restartChallenge() {
        this.playback.cancel();
        this._startChallenge();
        this._render();
    }

    _heroToMove(cursor) {
        const l = this.lesson;
        return Boolean(l && cursor < l.line.size && l.line.positions[cursor].whiteToMove === l.heroWhite);
    }

    _advanceOpponent() {
        const l = this.lesson;
        if (!l) return;
        this.playback.launch(async ({ isCancelled, wait }) => {
            while (!isCancelled() && this.state.cursor < l.line.size && !this._heroToMove(this.state.cursor)) {
                const ok = await wait(650);
                if (!ok || isCancelled()) return;
                const cur = this.state.cursor;
                this.state.anim = moveAnim(l.line.positions[cur], l.line.moves[cur]);
                this.state.cursor = cur + 1;
                this.state.hintStage = 0;
                this._render();
            }
            if (!isCancelled() && this.state.cursor >= l.line.size) {
                await db.markLesson(l.id);
                this.state.done = true;
                this.state.tone = Tone.GOOD;
                this.state.message = `Leçon maîtrisée ! Vous avez joué tous les coups clés de « ${l.title} ».`;
                this._render();
            }
        });
    }

    challengeMove(m) {
        const s = this.state;
        const l = this.lesson;
        if (!l || !s.challenge || s.done || !this._heroToMove(s.cursor)) return false;
        const expected = l.line.moves[s.cursor];
        if (m.equals(expected)) {
            s.anim = moveAnim(l.line.positions[s.cursor], m);
            s.message = `${l.line.sans[s.cursor]} — ${l.texts[s.cursor]}`;
            s.cursor += 1;
            s.hintStage = 0;
            s.tone = Tone.GOOD;
            this._render();
            this._advanceOpponent();
            return true;
        }
        const played = l.line.positions[s.cursor].san(m);
        s.tone = Tone.BAD;
        s.message = `${played} n'est pas le coup de la leçon. Réfléchissez à l'idée du thème, ou demandez un indice.`;
        this._render();
        return false;
    }

    hint() {
        const s = this.state;
        if (!s.challenge || s.done || !this._heroToMove(s.cursor)) return;
        const stage = Math.min(2, s.hintStage + 1);
        s.hintStage = stage;
        s.tone = Tone.GOLD;
        s.message = stage === 1
            ? 'Indice 1/2 : la pièce à jouer est surlignée en vert.'
            : 'Indice 2/2 : suivez la flèche.';
        this._render();
    }

    nextLesson() { this._shiftLesson(1); }
    prevLesson() { this._shiftLesson(-1); }

    _shiftLesson(delta) {
        const all = Lessons.all;
        if (!all.length) return;
        const pool = this.state.filter ? all.filter((it) => it.category === this.state.filter) : all;
        const idx = Math.max(0, pool.findIndex((it) => it.id === this.state.lessonId));
        const target = pool[(idx + delta + pool.length) % pool.length];
        if (target) this.open(target.id);
    }

    _renderBoard() {
        const l = this.lesson;
        if (!l || !this._palette) return;
        const s = this.state;
        const line = l.line;
        const cur = Math.max(0, Math.min(line.size, s.cursor));
        const pos = line.positions[cur];
        const last = cur > 0 ? line.moves[cur - 1] : null;
        const heroTurn = s.challenge && !s.done && cur < line.size && pos.whiteToMove === l.heroWhite;
        const next = cur < line.size ? line.moves[cur] : null;

        let arrows = [];
        if (heroTurn && s.hintStage >= 2 && next) arrows = [{ from: next.from, to: next.to, color: this._palette.green }];
        else if (!s.challenge && last) arrows = [{ from: last.from, to: last.to, color: this._palette.blue }];

        const marks = heroTurn && s.hintStage >= 1 && next ? [[next.from, this._palette.green]] : [];

        this.board.setState({
            position: pos,
            flipped: s.flipped,
            interactive: heroTurn,
            lastMove: last,
            anim: s.anim,
            arrows,
            marks,
            badges: [],
            kid: false,
            showCoords: this._showCoords,
            palette: this._palette,
            onMove: (m) => {
                if (this.challengeMove(m)) feedback.success();
                else feedback.error();
            },
        });
    }

    _render() {
        const l = this.lesson;
        if (!l || !this.selRow) return;
        const s = this.state;
        const line = l.line;
        const total = Lessons.all.length;
        const cur = Math.max(0, Math.min(line.size, s.cursor));
        const done = this.mastered.has(l.id);

        // Selector header
        const newPill = infoPill({ text: l.categoryLabel || CATEGORY_LABELS[l.category], accent: 'blue' });
        this.catPill.replaceWith(newPill);
        this.catPill = newPill;
        this.doneBadge.classList.toggle('hidden', !done);
        this.countLabel.textContent = `${this.mastered.size}/${total}`;
        this.selTitle.textContent = `${l.id}. ${l.title}`;
        this.selectorBtn.setAttribute(
            'aria-label',
            `Leçon ${l.id} : ${l.title}, ${l.categoryLabel || CATEGORY_LABELS[l.category]}${done ? ', maîtrisée' : ''}. ${this.mastered.size} leçons maîtrisées sur ${total}. Ouvrir le catalogue des leçons`,
        );

        // Mode segmented bar
        this.segWrap.replaceChildren(duckSegmentedRow({
            options: ['Guidé (démo)', 'Défi (pratique)'],
            selectedIndex: s.challenge ? 1 : 0,
            icons: ['Visibility', 'SportsScore'],
            onSelect: (i) => this.setChallenge(i === 1),
        }));

        // Move strip
        this.moveStrip.update({
            line,
            cursor: cur,
            onSelect: !s.challenge ? (n) => this.jump(n) : null,
            onPrev: !s.challenge ? () => this.step(-1) : null,
            onNext: !s.challenge ? () => this.step(1) : null,
            emptyText: "Les coups de la leçon s'afficheront ici.",
        });

        // Feedback + action buttons
        if (!s.challenge) {
            const title = cur === 0
                ? 'Objectif de la leçon'
                : `${moveLabel(line.positions[cur - 1].fullmove, line.positions[cur - 1].whiteToMove, line.sans[cur - 1])} · coup ${cur} / ${line.size}`;
            const text = cur === 0
                ? `${l.summary} Touchez Lecture pour dérouler la leçon coup par coup.`
                : l.texts[cur - 1];
            this.feedbackCard.update({ text, tone: Tone.INFO, title });

            const bPrev = duckButton({
                label: 'Début',
                icon: 'SkipPrevious',
                enabled: cur > 0,
                onClick: () => this.rewind(),
            });
            bPrev.style.flex = '1';
            const bPlay = duckButton({
                label: s.playing ? 'Pause' : 'Lecture',
                icon: s.playing ? 'Pause' : 'PlayArrow',
                accent: 'blue',
                filled: true,
                onClick: () => this.togglePlay(),
            });
            bPlay.style.flex = '1.5';
            const bNext = duckButton({
                label: 'Fin',
                icon: 'SkipNext',
                enabled: cur < line.size,
                onClick: () => this.last(),
            });
            bNext.style.flex = '1';
            this.actionRow.replaceChildren(bPrev, bPlay, bNext);
        } else {
            const side = l.heroWhite ? 'Blancs' : 'Noirs';
            const title = s.done ? 'Défi réussi' : `Défi : jouez les ${side} · coup ${cur} / ${line.size}`;
            this.feedbackCard.update({ text: s.message, tone: s.tone, title });

            const bReset = duckButton({
                label: 'Recommencer',
                icon: 'RestartAlt',
                onClick: () => this.restartChallenge(),
            });
            bReset.style.flex = '1';
            const bRight = s.done
                ? duckButton({
                    label: 'Leçon suivante',
                    icon: 'ArrowForward',
                    accent: 'green',
                    filled: true,
                    onClick: () => this.nextLesson(),
                })
                : duckButton({
                    label: `Indice ${Math.min(2, s.hintStage + 1)}/2`,
                    icon: 'Lightbulb',
                    accent: 'green',
                    onClick: () => this.hint(),
                });
            bRight.style.flex = '1.4';
            this.actionRow.replaceChildren(bReset, bRight);
        }

        this.layout.relayout();
        this._renderBoard();
    }
}
