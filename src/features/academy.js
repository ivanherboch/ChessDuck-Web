import { Line } from '../core/chess.js';
import { CATEGORY_LABELS, LessonCategory, LessonKind, Lessons } from '../core/lessons.js';
import { PuzzleThemes } from '../core/puzzle-themes.js';
import { SpokenFr } from '../core/spoken-fr.js';
import { db } from '../data/db.js';
import { prefs } from '../data/prefs.js';
import { ChessBoardView, EvalBarView } from '../ui/board.js';
import {
    FeedbackCardView,
    ModuleLayoutView,
    MoveStripView,
    Tone,
    createRefuteCountdown,
    createSessionHeader,
    createStarsRow,
    duckButton,
    duckIconButton,
    duckSegmentedRow,
    el,
    emptyState,
    hintButton,
    hintIconButton,
    loadingState,
    stepTitle,
    turnOf,
    updateSegmentedRow,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { LinePlaybackController, moveAnim, undoAnim } from '../ui/line-playback.js';
import { narrator } from '../ui/narrator.js';
import { isTwoPane } from '../ui/theme.js';
import { AcademyAssessments, KIND_EXAM, KIND_PLACEMENT } from './academy-assessments.js';
import {
    PRACTICE_PASS,
    PRACTICE_SIZE,
    REPERTOIRE_SIZE,
    REVIEW_SIZE,
    buildAcademyBoardInfo,
    buildLessonBridges,
    buildVariantMenu,
    levelName,
    levelSpoken,
    objectiveText,
    openChooseColorSheet,
    openLessonBriefSheet,
    openTrainingsSheet,
    renderAcademyMoveTable,
    renderQuizChoice,
    starsText,
    variantLabel,
} from './academy-panels.js';
import { EndgameFamily, EndgameGoal, EndgameTrainer, ENDGAME_PASS } from './endgame-practice.js';
import { GameLogic } from './game-logic.js';
import { openLessonCatalog } from './lesson-catalog.js';
import { MoveJudge, Verdict, MAX_LOSS } from './move-judge.js';
import { AUTO_UNDO, REFUTE_HOLD, RefutationLogic } from './refutation.js';
import { ReflexKind, ReflexTrainer, reflexSessionPosition } from './reflex-drills.js';
import { SrsScheduler } from './srs-scheduler.js';
import { WeakTopics } from './weak-topics.js';

export const POST_SPEECH_PAUSE_MS = 850;
export const ASK = 'À vous : que jouez-vous ici ?';
const TENTATIVE_HOLD = 1200;

export function academyStepDelayMs(lesson, cursor, { narrationActive = false, speechResult = null } = {}) {
    const c = Math.max(0, Math.min(lesson?.line?.size ?? 0, cursor || 0));
    if (!narrationActive) return c === 0 ? 700 : 2600;
    if (speechResult?.played) return POST_SPEECH_PAUSE_MS;

    // Secours si la synthèse vocale n'a pas parlé (bloquée, muette ou absente sur l'appareil) :
    // on laisse un temps de lecture proportionnel au texte plutôt que 600 ms.
    const rawText = c === 0 ? `${lesson?.title || ''}. ${lesson?.summary || ''}` : (lesson?.texts?.[c - 1] || '');
    const textLen = rawText.trim().length;
    const targetMs = Math.max(c === 0 ? 3200 : 3000, Math.min(8500, 1400 + textLen * 48));
    const waitedMs = Math.max(0, speechResult?.elapsedMs || 0);
    return Math.max(900, targetMs - waitedMs);
}

export const Validation = Object.freeze({
    NONE: 'NONE',
    PUZZLES: 'PUZZLES',
    ENDGAME: 'ENDGAME',
});

export const PracticeKind = Object.freeze({
    LESSON: 'LESSON',
    REVIEW: 'REVIEW',
    ONLY_MOVE: 'ONLY_MOVE',
    PLACEMENT: 'PLACEMENT',
    EXAM: 'EXAM',
});

export function academyLevelToBand(level) {
    return Math.max(1, Math.min(4, (Number(level) || 2) - 1));
}

export class AcademyFeature {
    constructor(engine = null, { onTrainTheme = null, onPlayPosition = null, onTopState = null } = {}) {
        this.engine = engine;
        this.onTrainTheme = onTrainTheme;
        this.onPlayPosition = onPlayPosition;
        this.onTopState = onTopState;

        this.el = el('div', 'feature-root');
        this.loadingEl = loadingState('Chargement des leçons…');
        this.el.appendChild(this.loadingEl);

        this.layout = new ModuleLayoutView({ bottomMin: 190 });
        this.layout.el.classList.add('academy-layout');
        this.board = new ChessBoardView();
        this.evalBar = new EvalBarView();
        this.evalBar.el.classList.add('hidden');
        this.boardRow = el('div', 'board-row');
        this.boardRow.append(this.evalBar.el, this.board.el);
        this.boardLoadingEl = loadingState('Préparation des exercices…');
        this.boardLoadingEl.classList.add('hidden');
        this.boardEmptyWrap = el('div', 'academy-board-empty hidden');

        this.moveStrip = new MoveStripView();
        this.feedbackCard = new FeedbackCardView();
        this.moveTableWrap = el('div', 'move-table-wrap hidden');

        this.srs = new SrsScheduler();
        this.judge = this.engine ? new MoveJudge(this.engine) : null;
        this.endgame = this.engine
            ? new EndgameTrainer(this.engine, { onFinished: (f, score, total) => this._endgameFinished(f, score, total) })
            : null;
        this.reflex = new ReflexTrainer(db, this.engine, {
            speak: (txt) => {
                if (prefs.current.narration && this._voiceAvailable !== false) {
                    narrator.speak(txt);
                }
            },
            onFinished: () => {},
        });

        this.playback = new LinePlaybackController();

        this._palette = null;
        this._showCoords = true;
        this._catalog = null;
        this._trainingsSheet = null;
        this._destroyed = false;
        this._voiceAvailable = narrator.available;
        this._lastNarration = prefs.current.narration;
        this._spokenHere = false;
        this._openedExplicitly = false;
        this._variantMenuEl = null;

        this._judgeToken = 0;
        this._judgeAbort = null;
        this._judgeTimer = null;
        this._practiceToken = 0;
        this._practiceAbort = null;
        this._practiceTimer = null;
        this._practiceRefuteTimer = null;
        this._refuteRaf = 0;
        this._missed = null;
        this._endgameLesson = null;
        this._endgameReview = false;

        this.mastered = db.masteredLessons;
        this.progressList = db.lessonProgress;
        this.assessments = db.assessments;
        this.games = db.games;

        this.state = {
            lessonId: prefs.current.lessonId || 1,
            filter: null,
            challenge: false,
            cursor: 0,
            variant: 0,
            playing: false,
            flipped: false,
            sessionFlipped: false,
            anim: null,
            hintStage: 0,
            message: '',
            tone: Tone.INFO,
            done: false,
            answered: new Set(),
            note: null,
            noteTone: Tone.INFO,
            errors: 0,
            maxHint: 0,
            stars: 0,
            guessScore: 0,
            guessMax: 0,
            judging: false,
            refute: null,
            refuteUntil: 0,
            refuteHold: 0,
            tentative: null,
            suggest: null,
            practice: null,
            quiz: null,
            review: null,
            repertoire: null,
            fromDrawer: false,
            stuck: null,
            voiceTip: null,
        };

        this._buildDom();

        this._unsubLessons = db.subscribeMasteredLessons((set) => {
            this.mastered = set;
            if (!this._destroyed && Lessons.all.length) this._render();
        });
        this._unsubProgress = db.subscribeLessonProgress((list) => {
            this.progressList = list;
            if (!this._destroyed && Lessons.all.length) this._render();
        });
        this._unsubAssessments = db.subscribeAssessments((list) => {
            this.assessments = list;
            if (!this._destroyed && Lessons.all.length) this._render();
        });
        this._unsubGames = db.subscribeGames((list) => {
            this.games = list;
            if (!this._destroyed && Lessons.all.length) this._emitTopState();
        });

        this._unsubSpeak = narrator.subscribeSpeaking(() => {
            if (!this._destroyed && Lessons.all.length && !this.state.challenge) this._render();
        });

        this._unsubAvail = narrator.subscribeAvailable((avail) => {
            this._voiceAvailable = avail;
            if (!this._destroyed && Lessons.all.length && !this.state.challenge) this._render();
        });

        this._unsubPrefs = prefs.subscribe((st) => {
            const changed = st.narration !== this._lastNarration;
            this._lastNarration = st.narration;
            if (changed) {
                if (st.narration) {
                    this.state.voiceTip = null;
                    narrator.prepare();
                } else {
                    narrator.stop();
                }
                if (Lessons.all.length && !this.state.challenge) this._render();
            }
            if (!this._destroyed && Lessons.all.length) this._emitTopState();
        });

        this._lastEgPulseId = 0;
        this._lastRxPulseId = 0;
        this._unsubEndgame = this.endgame?.subscribe((eg) => {
            if (eg?.pulse && eg.pulse.id !== this._lastEgPulseId) {
                this._lastEgPulseId = eg.pulse.id;
                if (eg.pulse.good) feedback.success();
                else feedback.error();
            }
            if (!this._destroyed && Lessons.all.length) this._render();
        });
        this._unsubReflex = this.reflex.subscribe((rx) => {
            if (rx?.pulse && rx.pulse.id !== this._lastRxPulseId) {
                this._lastRxPulseId = rx.pulse.id;
                if (rx.pulse.good) feedback.success();
                else feedback.error();
            }
            if (!this._destroyed && Lessons.all.length) this._render();
        });

        if (prefs.current.narration) narrator.prepare();
        this._init();
    }

    async _init() {
        await Lessons.load();
        await db.initUserState?.();
        if (this._destroyed) return;
        this.loadingEl.remove();
        this.el.appendChild(this.layout.el);
        const savedId = prefs.current.lessonId || (Lessons.all[0]?.id ?? 1);
        if (!this._openedExplicitly) {
            this.open(savedId, { save: false });
        } else {
            this._render();
        }
    }

    destroy() {
        this._destroyed = true;
        this._cancelAll();
        narrator.stop();
        this._catalog?.sheet?.close();
        this._trainingsSheet?.close();
        this._variantMenuEl?.cleanup?.();
        this._unsubLessons?.();
        this._unsubProgress?.();
        this._unsubAssessments?.();
        this._unsubGames?.();
        this._unsubSpeak?.();
        this._unsubAvail?.();
        this._unsubPrefs?.();
        this._unsubEndgame?.();
        this._unsubReflex?.();
        this.board.destroy();
        this.moveStrip.destroy();
        this.feedbackCard.destroy();
        this.layout.destroy();
    }

    setThemeAndCoords(palette, showCoords) {
        this._palette = palette;
        this._showCoords = showCoords;
        if (Lessons.all.length) this._renderBoard();
    }

    onActivate() {
        if (prefs.current.narration) narrator.prepare();
        this.layout.relayout();
        if (Lessons.all.length) this._render();
        this.board._syncCanvasSize();
        this.board.draw();
        this._emitTopState();
    }

    onDeactivate() {
        this.silence();
    }

    silence() {
        this.pause();
        narrator.stop();
        this._spokenHere = false;
    }

    get lesson() {
        return Lessons.byId(this.state.lessonId);
    }

    lineOf(s = this.state) {
        const l = Lessons.byId(s.lessonId);
        return l.lineFor(s.variant);
    }

    textsOf(s = this.state) {
        const l = Lessons.byId(s.lessonId);
        return l.textsFor(s.variant);
    }

    validation(l = this.lesson) {
        if (EndgameFamily.of(l.drill)) return Validation.ENDGAME;
        if (l.theme) return Validation.PUZZLES;
        return Validation.NONE;
    }

    homeData() {
        const progressMap = new Map((this.progressList || []).map((p) => [p.lessonId, p]));
        const due = this.srs.due(this.progressList || []);
        const level = prefs.current.academyLevel || 2;
        const placementDone = Boolean(prefs.current.placementDone);
        const rec = this.srs.recommended(Lessons.all, progressMap, level)?.id ?? null;
        const cont = this.srs.continueLesson(Lessons.all, progressMap, this.state.lessonId)?.id ?? null;
        const examsPassed = new Set(
            (this.assessments || []).filter((a) => a.kind === KIND_EXAM && a.passed).map((a) => a.level),
        );
        const endgamesDone = new Set(
            Lessons.all
                .filter((l) => l.drill && progressMap.get(l.id)?.masteredAt > 0 && EndgameFamily.of(l.drill))
                .map((l) => l.drill),
        );
        return { level, placementDone, due, recommended: rec, continueId: cont, examsPassed, endgamesDone, progressMap };
    }

    prioritiesData() {
        return WeakTopics.compute(this.games || [], this.progressList || []);
    }

    topBarState() {
        const home = this.homeData();
        const prios = this.prioritiesData();
        const cur = this.state.lessonId;
        const rec = home.recommended && home.recommended !== cur && home.recommended !== home.continueId ? home.recommended : null;
        const suggestions = (home.due.length > 0 ? 1 : 0)
            + (home.continueId !== null ? 1 : 0)
            + (rec !== null ? 1 : 0)
            + prios.filter((p) => p.lessonId !== cur).length;
        const eg = this.endgame?.state || null;
        const rx = this.reflex.state || null;
        const s = this.state;
        const trainingActive = Boolean(eg || rx || s.practice || s.review || s.repertoire);
        return {
            suggestions,
            trainingActive,
            trainingsOpen: Boolean(this._trainingsSheet),
        };
    }

    _emitTopState() {
        this.onTopState?.(this.topBarState());
    }

    openTrainings() {
        if (this._trainingsSheet) return;
        const home = this.homeData();
        const priorities = this.prioritiesData();
        this._trainingsSheet = openTrainingsSheet({
            home,
            priorities,
            s: this.state,
            eg: this.endgame?.state || null,
            rx: this.reflex.state || null,
            onClose: () => {
                this._trainingsSheet = null;
                this._emitTopState();
            },
            onMarkFromDrawer: () => this.markFromDrawer(),
            onStartReviews: () => this.startReviews(),
            onOpenLesson: (id) => this.open(id, { guided: true }),
            onTrainTopic: (lessonId, theme) => this.trainTopic(lessonId, theme),
            onStartPlacement: () => this.startPlacement(),
            onStartExam: () => this.startExam(),
            onStartReflex: (kind) => this.startReflex(kind),
            onStartOnlyMove: () => this.startOnlyMove(),
            onStartEndgame: (f) => this.startEndgame(f),
            onStartRepertoire: (w) => this.startRepertoire(w),
        });
        this._emitTopState();
    }

    // ---- Session title & active check ----

    sessionTitle() {
        const s = this.state;
        const eg = this.endgame?.state || null;
        const rx = this.reflex.state || null;
        const l = this.lesson;
        const pr = s.practice;
        if (eg && this._endgameReview) return { label: 'Révision', title: `Finale : ${eg.family.label}` };
        if (eg && this._endgameLesson !== null) return { label: `Finale de validation · ${eg.total} positions`, title: l.title };
        if (eg) return { label: 'Entraînement', title: `Finale : ${eg.family.label}` };
        if (rx) return { label: 'Entraînement', title: rx.kind.label };
        if (pr?.kind === PracticeKind.ONLY_MOVE) return { label: 'Entraînement', title: 'Le seul coup' };
        if (pr?.kind === PracticeKind.PLACEMENT) return { label: 'Test', title: 'Test de placement' };
        if (pr?.kind === PracticeKind.EXAM) return { label: 'Test', title: `Examen du palier ${levelName(pr.level)}` };
        if (pr?.kind === PracticeKind.REVIEW) return { label: 'Révision · problèmes', title: l.title };
        if (pr) return { label: `Validation · ${pr.ids.length || PRACTICE_SIZE} problèmes`, title: l.title };
        if (s.quiz) return { label: 'Question de fin de leçon', title: l.title };
        if (s.review) return { label: `Révision ${s.review.index + 1} sur ${s.review.queue.length}`, title: l.title };
        if (s.repertoire) {
            return {
                label: `Répertoire ${s.repertoire.white ? 'Blancs' : 'Noirs'} · ${s.repertoire.index + 1} sur ${s.repertoire.items.length}`,
                title: l.title,
            };
        }
        return null;
    }

    _active() {
        const s = this.state;
        return Boolean(s.challenge || s.practice || s.quiz || this.endgame?.state || this.reflex.state);
    }

    asking(s = this.state) {
        const l = Lessons.byId(s.lessonId);
        if (!l) return false;
        const ownLine = s.variant === 0 || s.cursor < l.variants[s.variant - 1].from;
        return !s.challenge && !s.practice && !s.quiz && !this.endgame?.state && !this.reflex.state
            && ownLine && l.pauseSteps.has(s.cursor) && !s.answered.has(s.cursor) && s.cursor < l.line.size;
    }

    // ---- Cancellation ----

    _cancelAll() {
        this.playback.cancel();
        this._judgeToken += 1;
        this._judgeAbort?.abort();
        this._judgeAbort = null;
        if (this._judgeTimer) { clearTimeout(this._judgeTimer); this._judgeTimer = null; }
        this._practiceToken += 1;
        this._practiceAbort?.abort();
        this._practiceAbort = null;
        if (this._practiceTimer) { clearTimeout(this._practiceTimer); this._practiceTimer = null; }
        if (this._practiceRefuteTimer) { clearTimeout(this._practiceRefuteTimer); this._practiceRefuteTimer = null; }
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        this.endgame?.stop();
        this.reflex.stop();
    }

    markFromDrawer() {
        this.state.fromDrawer = true;
    }

    _backToDrawer() {
        if (!this.state.fromDrawer || this._destroyed) return;
        this.state.fromDrawer = false;
        this.openTrainings();
    }

    closeTraining() {
        const back = this.state.fromDrawer;
        this.state.fromDrawer = false;
        this.closeEndgame();
        this.closeReflex();
        this.closePractice();
        this.closeQuiz();
        this.closeReviews();
        this.closeRepertoire();
        this._render();
        if (back && !this._destroyed) this.openTrainings();
    }

    // ---- Narration ----

    spokenStep() {
        const l = this.lesson;
        const ln = this.lineOf();
        const tx = this.textsOf();
        const c = this.state.cursor;
        const base = c === 0
            ? `${l.title}. ${objectiveText(l)}`
            : `${SpokenFr.move(ln.sans[c - 1])}. ${tx[c - 1]}`;
        return SpokenFr.text(this.asking() ? `${base} ${ASK}` : base);
    }

    narrate() {
        if (prefs.current.narration && this._voiceAvailable !== false && !this._active()) {
            this._spokenHere = true;
            narrator.speak(this.spokenStep());
        }
    }

    toggleSpeech() {
        if (this._voiceAvailable === false) return;
        if (narrator.speaking) {
            narrator.stop();
            this._spokenHere = false;
        } else {
            this._spokenHere = true;
            narrator.speak(this.spokenStep());
        }
    }

    // ---- Navigation & Lesson Lifecycle ----

    open(id, { save = true, variant = 0, session = false, guided = false } = {}) {
        this._cancelAll();
        const l = Lessons.byId(id);
        if (!l) return;
        if (guided) this.state.challenge = false;
        const challenge = this.state.challenge;
        const vr = Math.max(0, Math.min(l.variants.length, variant));
        Object.assign(this.state, {
            lessonId: l.id,
            cursor: vr === 0 ? 0 : l.variants[vr - 1].from,
            variant: vr,
            playing: false,
            flipped: !l.heroWhite,
            anim: null,
            hintStage: 0,
            done: false,
            answered: new Set(),
            note: null,
            noteTone: Tone.INFO,
            errors: 0,
            maxHint: 0,
            stars: 0,
            guessScore: 0,
            guessMax: 0,
            judging: false,
            refute: null,
            refuteUntil: 0,
            refuteHold: 0,
            tentative: null,
            suggest: null,
            practice: null,
            quiz: null,
            review: session ? this.state.review : null,
            repertoire: session ? this.state.repertoire : null,
            fromDrawer: session && Boolean(this.state.fromDrawer),
            stuck: null,
            voiceTip: null,
        });
        this._spokenHere = false;
        this._endgameLesson = null;
        this._endgameReview = false;
        if (save) prefs.setLesson(l.id);
        if (challenge) {
            narrator.stop();
            this._startChallenge();
        } else {
            this.state.message = '';
            this.state.tone = Tone.INFO;
            if (save) this.narrate();
            else narrator.stop();
        }
        this._render();
    }

    setFilter(cat) {
        this.state.filter = cat;
    }

    nextLesson(guided = false) {
        this._shiftLesson(1, guided);
    }

    prevLesson() {
        this._shiftLesson(-1, false);
    }

    _shiftLesson(delta, guided = false) {
        const all = Lessons.all;
        if (!all.length) return;
        if (guided) this.state.challenge = false;
        const pool = this.state.filter ? all.filter((it) => it.category === this.state.filter) : all;
        const idx = Math.max(0, pool.findIndex((it) => it.id === this.state.lessonId));
        const next = pool[(idx + delta + pool.length) % pool.length];
        this.open(next.id, { save: true });
    }

    flip() {
        if (this.state.practice || this.endgame?.state || this.reflex.state) {
            this.state.sessionFlipped = !this.state.sessionFlipped;
        } else {
            this.state.flipped = !this.state.flipped;
        }
        this._renderBoard();
    }

    setChallenge(on) {
        if (this.state.challenge === on) return;
        this._cancelAll();
        const ln = this.lineOf();
        const keep = on ? 0 : Math.max(0, Math.min(ln.size, this.state.cursor));
        Object.assign(this.state, {
            challenge: on,
            cursor: keep,
            playing: false,
            anim: null,
            hintStage: 0,
            done: false,
            message: '',
            tone: Tone.INFO,
            note: null,
            judging: false,
            refute: null,
            refuteUntil: 0,
            tentative: null,
            suggest: null,
            practice: null,
            quiz: null,
            errors: 0,
            maxHint: 0,
            stars: 0,
            guessScore: 0,
            guessMax: 0,
            review: on ? this.state.review : null,
            repertoire: on ? this.state.repertoire : null,
            stuck: null,
            voiceTip: null,
        });
        this._spokenHere = false;
        if (on) {
            narrator.stop();
            this._startChallenge();
        } else {
            this.narrate();
        }
        this._render();
    }

    setVariant(v) {
        const l = this.lesson;
        if (v < 0 || v > l.variants.length || v === this.state.variant) return;
        this.pause();
        const start = v === 0 ? Math.min(this.state.cursor, l.line.size) : l.variants[v - 1].from;
        Object.assign(this.state, {
            variant: v,
            cursor: start,
            anim: null,
            note: null,
            quiz: null,
            stuck: null,
        });
        this.narrate();
        this._render();
    }

    // ---- Guided Mode ----

    goTo(target) {
        const ln = this.lineOf();
        const s = this.state;
        const t = Math.max(0, Math.min(ln.size, target));
        if (t === s.cursor) return;
        s.anim = LinePlaybackController.transition(ln, s.cursor, t);
        s.cursor = t;
        s.note = null;
        s.suggest = null;
        s.stuck = null;
        s.voiceTip = null;
        if (!s.challenge) s.hintStage = 0;
        this.narrate();
        this._render();
    }

    step(delta) {
        this.pause();
        if (delta > 0 && this.asking()) this._revealPauseStep();
        else this.goTo(this.state.cursor + delta);
    }

    rewind() {
        this.pause();
        this.goTo(0);
    }

    last() {
        this.pause();
        this.goTo(this.lineOf().size);
    }

    jump(n) {
        this.pause();
        this.goTo(n);
    }

    guideHint() {
        const s = this.state;
        if (!this.asking(s) || s.judging) return;
        s.hintStage = 1;
        s.note = 'Indice : la pièce à jouer est surlignée en vert.';
        s.noteTone = Tone.GOLD;
        this._render();
    }

    _revealPauseStep() {
        const c = this.state.cursor;
        this.state.answered.add(c);
        this.goTo(c + 1);
    }

    pause() {
        this.playback.cancel();
        narrator.pause();
        this.state.playing = false;
        this._render();
    }

    togglePlay() {
        if (this.state.playing) {
            this.pause();
            return;
        }
        this.playback.cancel();
        const ln = this.lineOf();
        if (this.state.cursor >= ln.size) {
            this.goTo(0);
        } else if (this.asking()) {
            this._revealPauseStep();
        } else {
            const resumed = narrator.resume();
            const failedHere = !narrator.speaking && !narrator.lastResult?.played;
            if (!resumed && (!this._spokenHere || failedHere)) this.narrate();
        }
        this._startAutoplay();
    }

    _startAutoplay() {
        this.playback.cancel();
        const l = this.lesson;
        const ln = this.lineOf();
        this.state.playing = true;
        this._render();
        let stepResult = narrator.lastResult;
        const useNarration = () => Boolean(prefs.current.narration && this._voiceAvailable !== false);
        this.playback.autoplay({
            cursor: () => (this._destroyed ? null : this.state.cursor),
            size: () => ln.size,
            delayFor: (c) => academyStepDelayMs({ title: l.title, summary: l.summary, line: ln, texts: this.textsOf() }, c, {
                narrationActive: useNarration(),
                speechResult: stepResult,
            }),
            checkBeforeDelay: true,
            awaitReady: async () => {
                stepResult = useNarration() ? await narrator.awaitIdle() : null;
            },
            advance: (t) => {
                this.goTo(t);
                if (this.asking()) {
                    this.playback.cancel();
                    this.state.playing = false;
                    this._render();
                }
            },
            onEnd: () => {
                this.state.playing = false;
                if (!this._destroyed) this._render();
            },
        });
    }

    async guideMove(m) {
        const s = this.state;
        if (!this.asking(s) || s.judging) return;
        const l = this.lesson;
        const c = s.cursor;
        const pos = l.line.positions[c];
        if (!pos.isLegal(m)) return;
        const expected = l.line.moves[c];
        const san = pos.san(m);
        const lessonSan = l.line.sans[c];

        if (m.equals(expected)) {
            feedback.success();
            s.answered.add(c);
            this.goTo(c + 1);
            this.state.note = "Bravo, c'est le coup de la leçon !";
            this.state.noteTone = Tone.GOOD;
            this._render();
            if (this.state.cursor < this.lineOf().size) this._startAutoplay();
            return;
        }

        const token = ++this._judgeToken;
        this._showTentative(pos, m);
        const v = this.judge
            ? await this.judge.judge(pos, m, expected, l.category === LessonCategory.ENDGAME)
            : Verdict.UNAVAILABLE;
        if (this._destroyed || token !== this._judgeToken) return;

        if (v === Verdict.EXACT) {
            feedback.success();
            s.judging = false;
            s.tentative = null;
            s.anim = null;
            s.answered.add(c);
            this.goTo(c + 1);
            this.state.note = "Bravo, c'est le coup de la leçon !";
            this.state.noteTone = Tone.GOOD;
            this._render();
            if (this.state.cursor < this.lineOf().size) this._startAutoplay();
        } else if (v === Verdict.EQUIVALENT) {
            feedback.success();
            s.note = `${san} : bon coup aussi !`;
            s.noteTone = Tone.GOOD;
            this._render();
            await new Promise((r) => { this._judgeTimer = setTimeout(r, TENTATIVE_HOLD); });
            if (this._destroyed || token !== this._judgeToken) return;
            Object.assign(s, {
                judging: false,
                tentative: null,
                anim: undoAnim(pos, m),
                suggest: expected,
                noteTone: Tone.GOOD,
                note: `${san} est aussi bon ! Cette leçon suit une autre ligne : jouez ${lessonSan}, indiqué par la flèche verte.`,
            });
            this._render();
        } else {
            feedback.error();
            Object.assign(s, {
                judging: false,
                tentative: null,
                anim: undoAnim(pos, m),
                noteTone: Tone.GOLD,
                note: v === Verdict.SLOWER
                    ? `${san} garde le mat, mais plus lentement : la méthode de la leçon est plus directe. Cherchez encore, ou touchez Lecture pour la découvrir.`
                    : `${san} n'est pas le coup de la leçon. Cherchez encore, ou touchez Lecture pour la découvrir.`,
            });
            this._render();
        }
    }

    _showTentative(pos, m) {
        const s = this.state;
        const wait = `L'Ordinateur analyse ${pos.san(m)}…`;
        s.judging = true;
        s.tentative = { position: pos.play(m), last: m, arrow: null };
        s.anim = moveAnim(pos, m);
        s.stuck = null;
        if (s.challenge) {
            s.message = wait;
            s.tone = Tone.INFO;
        } else {
            s.note = wait;
            s.noteTone = Tone.INFO;
        }
        this._render();
    }

    // ---- Quiz de fin de leçon ----

    startQuiz() {
        const q = this.lesson.quiz;
        if (!q) return;
        this.pause();
        narrator.stop();
        const choices = [q.answer, ...q.wrong];
        for (let i = choices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [choices[i], choices[j]] = [choices[j], choices[i]];
        }
        this.state.quiz = {
            choices,
            correct: choices.indexOf(q.answer),
            picked: null,
        };
        this._render();
    }

    answerQuiz(i) {
        const q = this.state.quiz;
        if (!q || q.picked !== null || i < 0 || i >= q.choices.length) return;
        if (i === q.correct) feedback.success();
        else feedback.error();
        this.state.quiz = { ...q, picked: i };
        this._render();
    }

    closeQuiz() {
        this.state.quiz = null;
        this._render();
    }

    // ---- Challenge & Model Game "Devinez le coup" ----

    _heroToMove(cursor, s = this.state) {
        const ln = this.lineOf(s);
        return cursor < ln.size && ln.positions[cursor].whiteToMove === this.lesson.heroWhite;
    }

    _startChallenge() {
        const l = this.lesson;
        const side = l.heroWhite ? 'Blancs' : 'Noirs';
        const intro = l.kind === LessonKind.MODEL_GAME
            ? `Devinez les coups des ${side} : 3 points pour le coup du maître, 1 ou 2 points pour un coup presque aussi bon.`
            : `À vous de jouer les coups des ${side} sur l'échiquier. ${l.summary}`;
        Object.assign(this.state, {
            cursor: 0,
            anim: null,
            hintStage: 0,
            done: false,
            tone: Tone.INFO,
            flipped: !l.heroWhite,
            errors: 0,
            maxHint: 0,
            stars: 0,
            refute: null,
            refuteUntil: 0,
            refuteHold: 0,
            tentative: null,
            suggest: null,
            judging: false,
            guessScore: 0,
            guessMax: 0,
            stuck: null,
            message: intro,
        });
        this._render();
        this._advanceOpponent();
    }

    restartChallenge() {
        this.playback.cancel();
        this._judgeToken += 1;
        this._judgeAbort?.abort();
        if (this._judgeTimer) { clearTimeout(this._judgeTimer); this._judgeTimer = null; }
        this._startChallenge();
    }

    _advanceOpponent() {
        const l = this.lesson;
        const ln = this.lineOf();
        const tx = this.textsOf();
        this.playback.launch(async ({ isCancelled, wait }) => {
            while (this.state.cursor < ln.size && !this._heroToMove(this.state.cursor)) {
                const ok = await wait(650);
                if (!ok || this._destroyed || isCancelled()) return;
                const cur = this.state.cursor;
                const reply = `Réponse ${ln.sans[cur]} : ${tx[cur]}`;
                this.state.anim = moveAnim(ln.positions[cur], ln.moves[cur]);
                this.state.cursor = cur + 1;
                this.state.hintStage = 0;
                this.state.stuck = null;
                this.state.message = this.state.message ? `${this.state.message}\n\n${reply}` : reply;
                this._render();
            }
            if (this.state.cursor >= ln.size && !isCancelled()) {
                await this._finishChallenge();
            }
        });
    }

    async _finishChallenge() {
        const l = this.lesson;
        const s = this.state;
        const model = l.kind === LessonKind.MODEL_GAME;
        let stars;
        if (model) {
            stars = s.guessScore * 5 >= s.guessMax * 4 ? 3 : (s.guessScore * 5 >= s.guessMax * 3 ? 2 : 1);
        } else {
            stars = s.errors === 0 && s.maxHint === 0 ? 3 : (s.errors <= 1 && s.maxHint <= 1 ? 2 : 1);
        }
        const takeaway = s.message.includes('À retenir') ? '' : `\n\nÀ retenir : ${l.takeaway}`;
        const scoreText = model ? `\n\nScore : ${s.guessScore} points sur ${s.guessMax}.` : '';
        s.done = true;
        s.stars = stars;
        s.tone = Tone.GOOD;
        s.message = `${s.message}${takeaway}${scoreText}`;
        this._render();

        if (s.repertoire) {
            await this._repertoireResult(stars >= 2);
            return;
        }
        if (s.review) {
            await this._reviewChallengeDone(stars >= 2);
            return;
        }

        const v = this.validation(l);
        const old = db.lessonProgressOf(l.id);
        const needed = v === Validation.ENDGAME ? ENDGAME_PASS : PRACTICE_PASS;
        const practiced = (old?.practicePassed || 0) >= needed;
        const bestStars = Math.max(stars, old?.stars || 0);
        const alreadyMastered = Boolean(old && old.masteredAt > 0);
        const nowMastered = alreadyMastered || (bestStars >= 2 && (v === Validation.NONE || practiced));
        let next = '';
        if (!nowMastered) {
            if (stars < 2) next = '\n\nRejouez avec au plus une erreur pour viser la maîtrise.';
            else if (v === Validation.ENDGAME) next = `\n\nValidez maintenant la leçon contre l'Ordinateur : réussissez ${ENDGAME_PASS} positions sur 5.`;
            else next = `\n\nValidez maintenant la leçon sur ${PRACTICE_SIZE} problèmes inédits du même thème.`;
        }
        await this._saveProgress(l.id, (p) => ({
            ...p,
            masteredAt: p.masteredAt > 0 ? p.masteredAt : (nowMastered ? this.srs.now() : 0),
            stars: bestStars,
            errors: s.errors,
            hintsUsed: s.maxHint,
        }));
        if (!this._destroyed && this.state.lessonId === l.id && this.state.done) {
            this.state.message += next;
            this._render();
        }
    }

    async challengeMove(m) {
        const s = this.state;
        const l = this.lesson;
        const ln = this.lineOf();
        if (!s.challenge || s.done || s.judging || s.refute || !this._heroToMove(s.cursor)) return false;
        const pos = ln.positions[s.cursor];
        if (!pos.isLegal(m)) return false;
        const expected = ln.moves[s.cursor];
        if (l.kind === LessonKind.MODEL_GAME) return this._guessMove(pos, m, expected);

        if (m.equals(expected)) {
            feedback.success();
            this._acceptChallengeMove(s.cursor, `${ln.sans[s.cursor]} : ${this.textsOf()[s.cursor]}`);
            return true;
        }

        const token = ++this._judgeToken;
        this._showTentative(pos, m);
        const v = this.judge
            ? await this.judge.judge(pos, m, expected, l.category === LessonCategory.ENDGAME)
            : Verdict.UNAVAILABLE;
        if (this._destroyed || token !== this._judgeToken) return false;

        if (v === Verdict.EXACT || v === Verdict.EQUIVALENT) {
            feedback.success();
            s.tone = Tone.GOOD;
            s.message = `${pos.san(m)} : bon coup aussi !`;
            this._render();
            await new Promise((r) => { this._judgeTimer = setTimeout(r, TENTATIVE_HOLD); });
            if (this._destroyed || token !== this._judgeToken) return false;
            Object.assign(s, {
                judging: false,
                tentative: null,
                anim: undoAnim(pos, m),
                suggest: expected,
                tone: Tone.GOOD,
                message: `${pos.san(m)} est aussi bon ! Cette leçon suit une autre ligne : jouez ${ln.sans[s.cursor]}, indiqué par la flèche verte.`,
            });
            this._render();
        } else if (v === Verdict.WORSE) {
            await this._refuteChallenge(pos, m, token);
        } else if (v === Verdict.SLOWER) {
            feedback.error();
            s.errors += 1;
            s.tone = Tone.GOLD;
            s.message = `${pos.san(m)} garde le mat, mais plus lentement. La méthode de la leçon est plus directe : retrouvez-la.`;
            this._render();
            await new Promise((r) => { this._judgeTimer = setTimeout(r, TENTATIVE_HOLD); });
            if (this._destroyed || token !== this._judgeToken) return false;
            Object.assign(s, {
                judging: false,
                tentative: null,
                anim: undoAnim(pos, m),
            });
            this._render();
        } else {
            feedback.error();
            Object.assign(s, {
                judging: false,
                tentative: null,
                anim: undoAnim(pos, m),
                errors: s.errors + 1,
                tone: Tone.BAD,
                message: `${pos.san(m)} n'est pas le coup de la leçon. Réfléchissez à l'idée du thème, ou demandez un indice.`,
            });
            this._render();
        }
        return false;
    }

    async _guessMove(pos, m, expected) {
        const cur = this.state.cursor;
        const ln = this.lineOf();
        const tx = this.textsOf();
        if (m.equals(expected)) {
            feedback.success();
            this.state.guessScore += 3;
            this.state.guessMax += 3;
            this._acceptChallengeMove(cur, `3 points : c'est le coup du maître ! ${ln.sans[cur]} : ${tx[cur]}`);
            return true;
        }
        const token = ++this._judgeToken;
        this._showTentative(pos, m);
        const loss = this.judge ? await this.judge.loss(pos, m, expected) : null;
        if (this._destroyed || token !== this._judgeToken) return false;

        let pts = 0;
        if (loss !== null) {
            if (loss <= MAX_LOSS) pts = 2;
            else if (loss <= 15.0) pts = 1;
        }
        if (pts > 0) feedback.success();
        else feedback.error();

        if (pts === 0 && this.engine) {
            const after = pos.play(m);
            this._judgeAbort = new AbortController();
            const r = await RefutationLogic.reply(this.engine, pos, m, { minShow: 0, signal: this._judgeAbort.signal });
            this._judgeAbort = null;
            if (this._destroyed || token !== this._judgeToken || !r) return false;
            const redColor = this._palette?.red || '#EF4444';
            this.state.tentative = {
                position: r.position,
                last: r.reply || m,
                arrow: r.reply ? { from: r.reply.from, to: r.reply.to, color: redColor } : null,
            };
            if (r.reply) this.state.anim = moveAnim(after, r.reply);
            this.state.tone = Tone.GOLD;
            this.state.message = `${pos.san(m)} : 0 point. ${r.text} Le maître a joué ${ln.sans[cur]}.`;
            this._render();
            await new Promise((res) => { this._judgeTimer = setTimeout(res, REFUTE_HOLD / 2); });
        } else {
            this.state.tone = Tone.GOOD;
            this.state.message = `${pos.san(m)} : ${pts} point${pts > 1 ? 's' : ''}. Le maître a joué ${ln.sans[cur]}.`;
            this._render();
            await new Promise((res) => { this._judgeTimer = setTimeout(res, TENTATIVE_HOLD); });
        }
        if (this._destroyed || token !== this._judgeToken) return false;
        Object.assign(this.state, {
            judging: false,
            tentative: null,
            anim: null,
            guessScore: this.state.guessScore + pts,
            guessMax: this.state.guessMax + 3,
        });
        this._acceptChallengeMove(
            cur,
            `${pos.san(m)} : ${pts} point${pts > 1 ? 's' : ''}. Le maître a joué ${ln.sans[cur]} : ${tx[cur]}`,
        );
        return false;
    }

    skipGuess() {
        const s = this.state;
        if (!s.challenge || s.done || s.judging || !this._heroToMove(s.cursor) || this.lesson.kind !== LessonKind.MODEL_GAME) return;
        s.guessMax += 3;
        const cur = s.cursor;
        this._acceptChallengeMove(cur, `Le coup du maître : ${this.lineOf().sans[cur]} : ${this.textsOf()[cur]}`);
    }

    _acceptChallengeMove(cur, text) {
        const ln = this.lineOf();
        Object.assign(this.state, {
            cursor: cur + 1,
            anim: moveAnim(ln.positions[cur], ln.moves[cur]),
            hintStage: 0,
            suggest: null,
            stuck: null,
            tone: Tone.GOOD,
            message: text,
        });
        this._render();
        this._advanceOpponent();
    }

    async _refuteChallenge(pos, m, token) {
        const s = this.state;
        feedback.error();
        const san = pos.san(m);
        const after = pos.play(m);
        const opp = pos.whiteToMove ? 'Noirs' : 'Blancs';
        this._missed = { pos, m };
        Object.assign(s, {
            judging: false,
            errors: s.errors + 1,
            tone: Tone.BAD,
            tentative: null,
            anim: null,
            refute: { position: after, last: m, arrow: null },
            refuteUntil: 0,
            refuteHold: 0,
            message: `${san} n'est pas le bon coup. Regardez la réponse des ${opp}…`,
        });
        this._render();

        this._judgeAbort = new AbortController();
        const r = await RefutationLogic.reply(this.engine, pos, m, { signal: this._judgeAbort.signal });
        this._judgeAbort = null;
        if (this._destroyed || token !== this._judgeToken || !r) return;

        const redColor = this._palette?.red || '#EF4444';
        if (r.reply) s.anim = moveAnim(after, r.reply);
        s.refute = {
            position: r.position,
            last: r.reply || m,
            arrow: r.reply ? { from: r.reply.from, to: r.reply.to, color: redColor } : null,
        };
        s.refuteUntil = performance.now() + REFUTE_HOLD;
        s.refuteHold = REFUTE_HOLD;
        s.message = r.text + AUTO_UNDO;
        this._render();

        this._judgeTimer = setTimeout(() => {
            this._judgeTimer = null;
            if (!this._destroyed && token === this._judgeToken) this.resumeAtMiss();
        }, REFUTE_HOLD);
    }

    resumeAtMiss() {
        if (!this.state.refute) return;
        this._judgeToken += 1;
        this._judgeAbort?.abort();
        if (this._judgeTimer) { clearTimeout(this._judgeTimer); this._judgeTimer = null; }
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        const miss = this._missed;
        this._missed = null;
        Object.assign(this.state, {
            refute: null,
            refuteUntil: 0,
            anim: miss ? undoAnim(miss.pos, miss.m) : null,
            tone: Tone.INFO,
            message: 'Position rétablie : à vous de retrouver le bon coup.',
        });
        this._render();
    }

    holdRefutation() {
        const s = this.state;
        if (!s.refute || !s.refuteUntil) return;
        this._judgeToken += 1;
        if (this._judgeTimer) { clearTimeout(this._judgeTimer); this._judgeTimer = null; }
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        s.refuteUntil = 0;
        const base = s.message.endsWith(AUTO_UNDO) ? s.message.slice(0, -AUTO_UNDO.length) : s.message;
        s.message = `${base} Prenez votre temps, puis touchez « Reprendre au coup manqué ».`;
        this._render();
    }

    hint() {
        const s = this.state;
        if (!s.challenge || s.done || s.judging || s.refute || !this._heroToMove(s.cursor) || this.lesson.kind === LessonKind.MODEL_GAME) return;
        const stage = Math.min(2, s.hintStage + 1);
        s.hintStage = stage;
        s.maxHint = Math.max(s.maxHint, stage);
        s.tone = Tone.GOLD;
        s.message = stage === 1
            ? 'Indice 1/2 : la pièce à jouer est surlignée en vert.'
            : 'Indice 2/2 : suivez la flèche.';
        this._render();
    }

    // ---- Validation / Practice / Placement / Exam Series ----

    startPractice() {
        const l = this.lesson;
        if (!l.theme) return;
        const specs = Array.from({ length: PRACTICE_SIZE }, () => ({
            themes: [l.theme],
            range: AcademyAssessments.levelRange(l.level),
        }));
        this._startSeries(PracticeKind.LESSON, specs, l.level);
    }

    async trainTopic(lessonId, theme) {
        this._openedExplicitly = true;
        if (lessonId && lessonId.lessonId !== undefined) {
            theme = lessonId.theme || '';
            lessonId = lessonId.lessonId;
        }
        if (!Lessons.all.length) {
            await Lessons.load();
            await db.initUserState?.();
        }
        if (this._destroyed) return;
        this.open(lessonId, { save: true, guided: true });
        if (!theme) return;
        const level = Math.max(2, prefs.current.academyLevel || 2);
        const specs = Array.from({ length: PRACTICE_SIZE }, () => ({
            themes: [theme],
            range: AcademyAssessments.levelRange(level),
        }));
        await this._startSeries(PracticeKind.LESSON, specs, level);
    }

    startOnlyMove() {
        const level = prefs.current.academyLevel || 2;
        const specs = Array.from({ length: PRACTICE_SIZE }, () => ({
            themes: ['defensiveMove'],
            range: AcademyAssessments.levelRange(level),
        }));
        this._startSeries(PracticeKind.ONLY_MOVE, specs, level);
    }

    startPlacement() {
        this._startSeries(PracticeKind.PLACEMENT, AcademyAssessments.placementSpecs(), 2);
    }

    startExam() {
        const level = Math.max(2, prefs.current.academyLevel || 2);
        this._startSeries(PracticeKind.EXAM, AcademyAssessments.examSpecs(level), level);
    }

    async _startSeries(kind, specs, level = 2) {
        this._cancelAll();
        narrator.stop();
        const token = ++this._practiceToken;
        Object.assign(this.state, {
            quiz: null,
            sessionFlipped: false,
            practice: {
                kind,
                level,
                ids: [],
                index: 0,
                results: [],
                line: null,
                cursor: 0,
                progress: 0,
                anim: null,
                hintStage: 0,
                solved: false,
                failed: false,
                loading: true,
                finished: false,
                tone: Tone.INFO,
                message: 'Préparation des problèmes…',
                refute: null,
                refuteUntil: 0,
                refuteHold: 0,
                hadError: false,
                missed: null,
            },
        });
        this._render();

        await db.initMeta?.();
        const ids = [];
        for (const spec of specs) {
            if (this._destroyed || token !== this._practiceToken) return;
            let found = null;
            for (const range of [spec.range, [0, 4000]]) {
                for (let tries = 0; tries < 6 && !found; tries++) {
                    try {
                        const cand = await db.randomId(spec.themes, range, ids[ids.length - 1] || '');
                        if (cand && !ids.includes(cand)) found = cand;
                    } catch {
                        found = null;
                    }
                }
                if (found) break;
            }
            if (found) ids.push(found);
        }
        if (this._destroyed || token !== this._practiceToken) return;

        if (!ids.length) {
            this.state.practice = {
                ...this.state.practice,
                loading: false,
                finished: true,
                message: 'Aucun problème disponible pour cette série.',
            };
            this._render();
            return;
        }
        this.state.practice = { ...this.state.practice, ids, loading: false };
        await this._showPractice(0, token);
    }

    async _showPractice(index, token = this._practiceToken) {
        const pr = this.state.practice;
        if (!pr) return;
        let p = null;
        let line = null;
        try {
            p = await db.byId(pr.ids[index]);
            if (p) line = Line.fromUci(p.fen, p.moves);
        } catch {
            line = null;
        }
        if (this._destroyed || token !== this._practiceToken) return;

        if (!line || line.size < 2) {
            this.state.practice = { ...pr, results: [...pr.results, false] };
            await this._nextPracticeOrFinish(index, token);
            return;
        }

        const side = line.positions[1].whiteToMove ? 'Blancs' : 'Noirs';
        const l = this.lesson;
        const theme = PuzzleThemes.byKey[l.theme];
        let goal = `les ${side} trouvent la meilleure suite.`;
        if (pr.kind === PracticeKind.LESSON || pr.kind === PracticeKind.REVIEW) {
            let tDesc = '';
            if (theme) {
                const g = theme.goal.replace(/\.$/, '');
                const gl = g.charAt(0).toLowerCase() + g.slice(1);
                tDesc = `. À chercher : ${theme.name.toLowerCase()} (${gl})`;
            }
            goal = `les ${side} jouent${tDesc}.\n\nRappel de la leçon « ${l.title} » : ${l.takeaway}`;
        } else if (pr.kind === PracticeKind.ONLY_MOVE) {
            goal = `les ${side} trouvent la seule défense.`;
        }

        this.state.practice = {
            ...pr,
            index,
            line,
            cursor: 0,
            progress: 0,
            hintStage: 0,
            failed: false,
            solved: false,
            anim: null,
            tone: Tone.INFO,
            refute: null,
            refuteUntil: 0,
            refuteHold: 0,
            hadError: false,
            missed: null,
            message: `Problème ${index + 1} sur ${pr.ids.length} : ${goal}`,
        };
        this._render();

        await new Promise((r) => { this._practiceTimer = setTimeout(r, 600); });
        if (this._destroyed || token !== this._practiceToken || !this.state.practice) return;
        const p2 = this.state.practice;
        this.state.practice = {
            ...p2,
            cursor: 1,
            progress: 1,
            anim: moveAnim(line.positions[0], line.moves[0]),
        };
        this._render();
    }

    practiceMove(m) {
        const pr = this.state.practice;
        const line = pr?.line;
        if (!pr || !line || pr.failed || pr.solved || pr.refute || pr.cursor !== pr.progress || pr.cursor >= line.size) return;
        const heroWhite = line.positions[0].whiteToMove === false;
        const pos = line.positions[pr.cursor];
        if (pos.whiteToMove !== heroWhite || !pos.isLegal(m)) return;

        const expected = line.moves[pr.cursor];
        const after = pos.play(m);
        if (!m.equals(expected) && !after.isCheckmate) {
            this._refutePractice(pos, m);
            return;
        }
        const cur = pr.cursor;
        const finished = cur + 1 >= line.size || after.isCheckmate;
        feedback.success();
        if (finished) {
            const ok = pr.hintStage < 2 && !pr.hadError;
            if (ok) db.markSolved(pr.ids[pr.index]).catch(() => {});
            const newLine = m.equals(expected) ? line : new Line(line.startFen, [...line.moves.slice(0, cur), m]);
            let msg = 'Résolu !';
            if (!ok && pr.hadError) msg = 'Résolu, mais après une erreur : ce problème ne compte pas.';
            else if (!ok) msg = "Résolu, mais avec l'indice qui montre le coup : ce problème ne compte pas.";
            this.state.practice = {
                ...pr,
                cursor: cur + 1,
                progress: cur + 1,
                anim: moveAnim(pos, m),
                solved: true,
                results: [...pr.results, ok],
                tone: ok ? Tone.GOOD : Tone.GOLD,
                line: newLine,
                message: msg,
            };
            this._render();
            return;
        }

        const token = this._practiceToken;
        this.state.practice = {
            ...pr,
            cursor: cur + 1,
            progress: cur + 1,
            anim: moveAnim(pos, m),
            hintStage: 0,
            tone: Tone.GOOD,
            message: 'Bien vu. La suite arrive…',
        };
        this._render();

        this._practiceTimer = setTimeout(() => {
            this._practiceTimer = null;
            if (this._destroyed || token !== this._practiceToken || !this.state.practice) return;
            const p2 = this.state.practice;
            this.state.practice = {
                ...p2,
                cursor: cur + 2,
                progress: cur + 2,
                anim: moveAnim(line.positions[cur + 1], line.moves[cur + 1]),
                message: `L'adversaire répond ${line.sans[cur + 1]} : à vous de continuer.`,
            };
            this._render();
        }, 600);
    }

    async _refutePractice(pos, m) {
        const pr = this.state.practice;
        if (!pr) return;
        const token = ++this._practiceToken;
        feedback.error();
        const san = pos.san(m);
        const after = pos.play(m);
        const opp = pos.whiteToMove ? 'Noirs' : 'Blancs';
        this.state.practice = {
            ...pr,
            hadError: true,
            missed: { pos, m },
            anim: moveAnim(pos, m),
            refute: { position: after, last: m, arrow: null },
            refuteUntil: 0,
            refuteHold: 0,
            tone: Tone.BAD,
            message: `${san} n'est pas la solution. Regardez la réponse des ${opp}…`,
        };
        this._render();

        this._practiceAbort = new AbortController();
        const r = await RefutationLogic.reply(this.engine, pos, m, { signal: this._practiceAbort.signal });
        this._practiceAbort = null;
        if (this._destroyed || token !== this._practiceToken || !r || !this.state.practice) return;

        const redColor = this._palette?.red || '#EF4444';
        const curPr = this.state.practice;
        this.state.practice = {
            ...curPr,
            anim: r.reply ? moveAnim(after, r.reply) : curPr.anim,
            refute: {
                position: r.position,
                last: r.reply || m,
                arrow: r.reply ? { from: r.reply.from, to: r.reply.to, color: redColor } : null,
            },
            refuteUntil: performance.now() + REFUTE_HOLD,
            refuteHold: REFUTE_HOLD,
            message: r.text + AUTO_UNDO,
        };
        this._render();

        this._practiceRefuteTimer = setTimeout(() => {
            this._practiceRefuteTimer = null;
            if (!this._destroyed && token === this._practiceToken) this.retryPractice();
        }, REFUTE_HOLD);
    }

    holdPracticeRefutation() {
        const pr = this.state.practice;
        if (!pr || !pr.refute || !pr.refuteUntil) return;
        if (this._practiceRefuteTimer) { clearTimeout(this._practiceRefuteTimer); this._practiceRefuteTimer = null; }
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        const base = pr.message.endsWith(AUTO_UNDO) ? pr.message.slice(0, -AUTO_UNDO.length) : pr.message;
        this.state.practice = {
            ...pr,
            refuteUntil: 0,
            message: `${base} Prenez votre temps, puis touchez Réessayer.`,
        };
        this._render();
    }

    retryPractice() {
        const pr = this.state.practice;
        if (!pr || !pr.refute) return;
        this._practiceToken += 1;
        this._practiceAbort?.abort();
        if (this._practiceRefuteTimer) { clearTimeout(this._practiceRefuteTimer); this._practiceRefuteTimer = null; }
        if (this._refuteRaf) { cancelAnimationFrame(this._refuteRaf); this._refuteRaf = 0; }
        const m = pr.missed;
        this.state.practice = {
            ...pr,
            refute: null,
            refuteUntil: 0,
            missed: null,
            anim: m ? undoAnim(m.pos, m.m) : null,
            tone: Tone.INFO,
            message: 'Position rétablie : à vous de rejouer.',
        };
        this._render();
    }

    practiceBack() {
        const pr = this.state.practice;
        const ln = pr?.line;
        if (!pr || !ln || pr.refute || pr.cursor <= 0) return;
        this.state.practice = {
            ...pr,
            cursor: pr.cursor - 1,
            anim: undoAnim(ln.positions[pr.cursor - 1], ln.moves[pr.cursor - 1]),
        };
        this._render();
    }

    practiceForward() {
        const pr = this.state.practice;
        const ln = pr?.line;
        if (!pr || !ln || pr.refute || pr.cursor >= pr.progress) return;
        this.state.practice = {
            ...pr,
            cursor: pr.cursor + 1,
            anim: moveAnim(ln.positions[pr.cursor], ln.moves[pr.cursor]),
        };
        this._render();
    }

    practiceHint() {
        const pr = this.state.practice;
        if (!pr || pr.loading || pr.finished || pr.failed || pr.solved || pr.refute) return;
        const stage = Math.min(2, pr.hintStage + 1);
        this.state.practice = {
            ...pr,
            hintStage: stage,
            tone: Tone.GOLD,
            message: stage === 1
                ? 'Indice 1/2 : la pièce à jouer est surlignée.'
                : 'Indice 2/2 : suivez la flèche.',
        };
        this._render();
    }

    practiceSolution() {
        const pr = this.state.practice;
        const line = pr?.line;
        if (!pr || !line || !pr.hadError || pr.failed || pr.solved || pr.refute) return;
        this.state.practice = {
            ...pr,
            cursor: pr.progress,
            failed: true,
            results: [...pr.results, false],
            tone: Tone.GOLD,
            message: `Solution : ${line.sans[pr.progress]}. Regardez le coup, puis passez au suivant.`,
        };
        this._render();
    }

    nextPractice() {
        const pr = this.state.practice;
        if (!pr || (!pr.failed && !pr.solved)) return;
        const token = ++this._practiceToken;
        this._nextPracticeOrFinish(pr.index, token);
    }

    async _nextPracticeOrFinish(index, token = this._practiceToken) {
        const pr = this.state.practice;
        if (!pr) return;
        if (index + 1 < pr.ids.length) {
            await this._showPractice(index + 1, token);
            return;
        }
        const score = pr.results.filter(Boolean).length;
        const total = pr.ids.length;
        let text = '';
        let good = false;
        if (pr.kind === PracticeKind.LESSON) {
            text = await this._lessonPracticeDone(score, total);
            good = score >= PRACTICE_PASS;
        } else if (pr.kind === PracticeKind.REVIEW) {
            good = score >= 1;
            await this._completeReview(good);
            text = `${score} sur ${total}.${good ? ' Révision réussie.' : ' Révision à refaire demain.'}`;
        } else if (pr.kind === PracticeKind.ONLY_MOVE) {
            good = score >= PRACTICE_PASS;
            text = `${score} sur ${total}. ${good ? 'Vous savez repérer la menace et la parer.' : "Cherchez d'abord la menace adverse, puis la seule parade."}`;
        } else if (pr.kind === PracticeKind.PLACEMENT) {
            good = true;
            const lv = AcademyAssessments.placementLevel(pr.results);
            prefs.setAcademyLevel(lv);
            prefs.setPlacementDone(true);
            await db.saveAssessment({ kind: KIND_PLACEMENT, level: lv, score, total, passed: true, completedAt: this.srs.now() });
            text = `${score} sur ${total}. Votre palier de départ : ${levelName(lv)}. Les leçons conseillées suivent ce palier.`;
        } else if (pr.kind === PracticeKind.EXAM) {
            good = AcademyAssessments.examPassed(score);
            if (good && pr.level < 5) prefs.setAcademyLevel(pr.level + 1);
            await db.saveAssessment({ kind: KIND_EXAM, level: pr.level, score, total, passed: good, completedAt: this.srs.now() });
            text = `${score} sur ${total}. ${good
                ? `Examen réussi : bienvenue au palier ${levelName(Math.min(5, pr.level + 1))} !`
                : `Il faut ${AcademyAssessments.EXAM_PASS} bonnes réponses : révisez les leçons du palier, puis retentez l'examen.`}`;
        }
        if (this._destroyed || token !== this._practiceToken || !this.state.practice) return;
        this.state.practice = {
            ...this.state.practice,
            finished: true,
            solved: false,
            failed: false,
            tone: good ? Tone.GOOD : Tone.GOLD,
            message: text,
        };
        this._render();
    }

    async _lessonPracticeDone(score, total) {
        const l = this.lesson;
        const passed = score >= PRACTICE_PASS;
        const p = await this._saveProgress(l.id, (old) => {
            const mastered = old.masteredAt > 0 || (passed && old.stars >= 2);
            return {
                ...old,
                masteredAt: old.masteredAt > 0 ? old.masteredAt : (mastered ? this.srs.now() : 0),
                practicePassed: Math.max(score, old.practicePassed),
                practiceTotal: total,
            };
        });
        if (p.masteredAt > 0 && passed) {
            return `${score} sur ${total} : leçon maîtrisée ! Vous savez appliquer cette idée sur des positions inédites.`;
        }
        if (passed) {
            return `${score} sur ${total} : série réussie. Réussissez aussi le Défi avec au plus une erreur pour maîtriser la leçon.`;
        }
        return `${score} sur ${total} : il en faut ${PRACTICE_PASS} pour valider. Relisez la leçon en mode Guidé, puis retentez la série.`;
    }

    closePractice() {
        this._practiceToken += 1;
        this._practiceAbort?.abort();
        if (this._practiceTimer) { clearTimeout(this._practiceTimer); this._practiceTimer = null; }
        if (this._practiceRefuteTimer) { clearTimeout(this._practiceRefuteTimer); this._practiceRefuteTimer = null; }
        this.state.practice = null;
        this._render();
        if (!this.state.review) this._backToDrawer();
    }

    // ---- Endgames ----

    startEndgame(family, { fromLesson = false, total = 5 } = {}) {
        if (!this.endgame) return;
        this._cancelAll();
        narrator.stop();
        this._endgameLesson = fromLesson ? this.lesson.id : null;
        this._endgameReview = false;
        this.state.quiz = null;
        this.state.practice = null;
        this.state.sessionFlipped = false;
        this.state.stuck = null;
        this.endgame.start(family, total);
        this._render();
    }

    closeEndgame() {
        this.endgame?.stop();
        this._endgameLesson = null;
        this._endgameReview = false;
        this._render();
        if (!this.state.review) this._backToDrawer();
    }

    async _endgameFinished(_family, score, total) {
        if (this._endgameReview) {
            await this._completeReview(score === total);
            return;
        }
        const id = this._endgameLesson;
        if (id === null) return;
        const passed = score >= ENDGAME_PASS;
        await this._saveProgress(id, (old) => {
            const mastered = old.masteredAt > 0 || (passed && old.stars >= 2);
            return {
                ...old,
                masteredAt: old.masteredAt > 0 ? old.masteredAt : (mastered ? this.srs.now() : 0),
                practicePassed: Math.max(score, old.practicePassed),
                practiceTotal: total,
            };
        });
    }

    // ---- Reflexes ----

    startReflex(kind) {
        this._cancelAll();
        narrator.stop();
        this.state.quiz = null;
        this.state.practice = null;
        this.state.sessionFlipped = false;
        this.state.stuck = null;
        const lv = kind === ReflexKind.BLIND ? 5 : (prefs.current.academyLevel || 2);
        this.reflex.start(kind, lv);
        this._render();
    }

    replayBlind() {
        if (prefs.current.narration && this._voiceAvailable !== false) {
            narrator.prepare();
            this.reflex.announce();
        } else if (this._voiceAvailable === false) {
            this.reflex.note("Aucune voix française n'est disponible sur ce navigateur. Les coups annoncés restent écrits ci-dessus.");
        } else {
            narrator.prepare();
            this.reflex.note('La lecture vocale est désactivée : activez-la dans Paramètres, section Audio, voix et retours. Les coups annoncés restent écrits ci-dessus.');
        }
    }

    closeReflex() {
        narrator.stop();
        this.reflex.stop();
        this._render();
        this._backToDrawer();
    }

    // ---- Spaced Repetition Reviews ----

    startReviews() {
        const due = this.srs.due(this.progressList || []);
        if (!due.length) {
            this.state.fromDrawer = false;
            return;
        }
        this.state.review = { queue: due, index: 0, passed: 0, finished: false };
        this.state.repertoire = null;
        this.state.challenge = true;
        this._openReview(0);
    }

    _openReview(index) {
        const r = this.state.review;
        if (!r) return;
        this.state.review = { ...r, index };
        this.state.challenge = true;
        this.open(r.queue[index], { save: false, session: true });
    }

    async _reviewChallengeDone(success) {
        const l = this.lesson;
        if (!success) {
            await this._completeReview(false);
            return;
        }
        const v = this.validation(l);
        if (v === Validation.PUZZLES) {
            const specs = Array.from({ length: REVIEW_SIZE }, () => ({
                themes: [l.theme],
                range: AcademyAssessments.levelRange(l.level),
            }));
            this._startSeries(PracticeKind.REVIEW, specs, l.level);
        } else if (v === Validation.ENDGAME) {
            const fam = EndgameFamily.of(l.drill);
            this.startEndgame(fam, { fromLesson: false, total: 1 });
            this._endgameReview = true;
            this._render();
        } else {
            await this._completeReview(true);
        }
    }

    async _completeReview(success) {
        const r = this.state.review;
        if (!r) return;
        const id = r.queue[r.index];
        const old = db.lessonProgressOf(id);
        let days = 1;
        if (old) {
            const updated = this.srs.reviewed(old, success);
            await db.saveLessonProgress(updated);
            days = this.srs.daysUntil(updated) ?? 1;
        }
        this.state.review = { ...r, passed: r.passed + (success ? 1 : 0) };
        this.state.message += success
            ? `\n\nRévision réussie : prochaine révision dans ${days} jours.`
            : '\n\nRévision ratée : cette leçon reviendra demain.';
        this._render();
    }

    nextReview() {
        const r = this.state.review;
        if (!r) return;
        this.endgame?.stop();
        this._endgameLesson = null;
        this._endgameReview = false;
        this.state.practice = null;
        if (r.index + 1 < r.queue.length) this._openReview(r.index + 1);
        else {
            this.state.review = { ...r, finished: true };
            this.closeReviews();
        }
    }

    closeReviews() {
        this.state.review = null;
        this._render();
        this._backToDrawer();
    }

    // ---- Opening Repertoire Drill ----

    startRepertoire(white) {
        const pool = Lessons.all.filter((l) => l.category === LessonCategory.OPENING && l.heroWhite === white);
        if (!pool.length) {
            this.state.fromDrawer = false;
            return;
        }
        const dueSet = new Set(this.srs.due(this.progressList || []));
        const dueFirst = pool.filter((l) => dueSet.has(l.id));
        const rest = pool.filter((l) => !dueSet.has(l.id));
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        const items = [...dueFirst, ...rest]
            .slice(0, REPERTOIRE_SIZE)
            .map((l) => [l.id, Math.floor(Math.random() * (l.variants.length + 1))]);
        this.state.repertoire = { white, items, index: 0, results: [], finished: false };
        this.state.review = null;
        this.state.challenge = true;
        this._openRepertoire(0);
    }

    _openRepertoire(index) {
        const r = this.state.repertoire;
        if (!r) return;
        this.state.repertoire = { ...r, index };
        this.state.challenge = true;
        const [id, variant] = r.items[index];
        this.open(id, { save: false, variant, session: true });
    }

    async _repertoireResult(success) {
        const r = this.state.repertoire;
        if (!r) return;
        const id = r.items[r.index][0];
        const old = db.lessonProgressOf(id);
        if (old && old.masteredAt > 0) {
            await db.saveLessonProgress(this.srs.reviewed(old, success));
        }
        this.state.repertoire = { ...r, results: [...r.results, success] };
        this._render();
    }

    nextRepertoire() {
        const r = this.state.repertoire;
        if (!r) return;
        if (r.index + 1 < r.items.length) this._openRepertoire(r.index + 1);
        else {
            this.state.repertoire = { ...r, finished: true };
            this.closeRepertoire();
        }
    }

    closeRepertoire() {
        this.state.repertoire = null;
        this._render();
        this._backToDrawer();
    }

    async _saveProgress(id, updater) {
        const old = db.lessonProgressOf(id) || {
            lessonId: id,
            masteredAt: 0,
            stars: 0,
            errors: 0,
            hintsUsed: 0,
            practicePassed: 0,
            practiceTotal: 0,
            srsStage: 0,
            nextReviewAt: 0,
            lastReviewedAt: 0,
        };
        let next = updater(old);
        if (!(old.masteredAt > 0) && next.masteredAt > 0) next = this.srs.mastered(next);
        await db.saveLessonProgress(next);
        return next;
    }

    // ---- DOM & Rendering ----

    _buildDom() {
        this.topNormalWrap = el('div', 'academy-top-normal');
        this.topSessionWrap = el('div', 'academy-top-session hidden');

        // Selector row
        this.selectorRow = el('div', 'academy-selector-row');
        this.prevLessonBtn = duckIconButton({
            icon: 'KeyboardArrowLeft',
            ariaLabel: 'Leçon précédente',
            onClick: () => this.prevLesson(),
        });
        this.catalogBtn = document.createElement('button');
        this.catalogBtn.type = 'button';
        this.catalogBtn.className = 'academy-selector-btn';
        this.catalogCol = el('div', 'academy-selector-col');
        this.selectorLine1 = el('div', 'academy-selector-l1');
        this.selectorTitle = el('span', 'academy-selector-title');
        this.selectorChevron = createIcon('ExpandMore', 20, 'academy-selector-chev');
        this.selectorLine1.append(this.selectorTitle, this.selectorChevron);

        this.selectorLine2 = el('div', 'academy-selector-l2');
        this.selectorCat = el('span', 'academy-selector-cat');
        this.selectorStatus = el('span', 'academy-selector-status');
        this.selectorStarsWrap = el('span', 'academy-selector-stars');
        this.selectorProg = el('span', 'academy-selector-prog');
        this.selectorLine2.append(this.selectorCat, this.selectorStatus, this.selectorStarsWrap, this.selectorProg);

        this.catalogCol.append(this.selectorLine1, this.selectorLine2);
        this.catalogBtn.append(this.catalogCol);
        this.catalogBtn.addEventListener('click', () => this._openCatalog());

        this.nextLessonBtn = duckIconButton({
            icon: 'KeyboardArrowRight',
            ariaLabel: 'Leçon suivante',
            onClick: () => this.nextLesson(),
        });
        this.selectorRow.append(this.prevLessonBtn, this.catalogBtn, this.nextLessonBtn);

        // Modes + Tools row
        this.modesToolsRow = el('div', 'academy-modes-row');
        this.modeSeg = duckSegmentedRow({
            options: ['Guidé', 'Défi'],
            selectedIndex: 0,
            icons: ['Visibility', 'SportsScore'],
            className: 'flex-1',
            onSelect: (idx) => this.setChallenge(idx === 1),
        });
        this.toolsRow = el('div', 'academy-tools-row');
        this.variantSlot = el('div', 'academy-variant-slot');
        this.briefBtn = duckIconButton({
            icon: 'Info',
            ariaLabel: 'Fiche de la leçon',
            accent: 'blue',
            onClick: () => openLessonBriefSheet(this.lesson),
        });
        this.modelPlayBtn = duckIconButton({
            icon: 'SportsEsports',
            ariaLabel: "Jouer cette position contre l'Ordinateur, avec le camp de votre choix",
            accent: 'blue',
            onClick: () => {
                const fen = this._currentPlayableFen();
                if (fen) {
                    openChooseColorSheet({
                        fen,
                        lesson: this.lesson,
                        onPick: (white) => this.onPlayPosition?.(fen, white),
                    });
                }
            },
        });
        this.flipBtn = duckIconButton({
            icon: 'SwapVert',
            ariaLabel: "Retourner l'échiquier",
            onClick: () => this.flip(),
        });
        this.toolsRow.append(this.variantSlot, this.briefBtn, this.modelPlayBtn, this.flipBtn);
        this.modesToolsRow.append(this.modeSeg, this.toolsRow);

        this.topNormalWrap.append(this.selectorRow, this.modesToolsRow);
        this.layout.topSlot.append(this.topNormalWrap, this.topSessionWrap);

        // Board container
        this.layout.boardHost.append(this.boardRow, this.boardLoadingEl, this.boardEmptyWrap);

        // Bottom container
        this.quizChoicesWrap = el('div', 'academy-quiz-choices hidden');
        this.refuteRow = createRefuteCountdown({
            onHold: () => (this.state.practice ? this.holdPracticeRefutation() : this.holdRefutation()),
        });
        this.refuteRow.wrap.classList.add('hidden');
        this.actionRow = el('div', 'equal-row');
        this.layout.bottomSlot.append(
            this.moveStrip.el,
            this.feedbackCard.el,
            this.quizChoicesWrap,
            this.moveTableWrap,
            this.refuteRow.wrap,
            this.actionRow,
        );
    }

    _openCatalog() {
        if (this._catalog) return;
        const home = this.homeData();
        const sheet = openLessonCatalog({
            state: this.state,
            currentFilter: this.state.filter,
            mastered: this.mastered,
            lessonProgress: this.progressList,
            home,
            srs: this.srs,
            validationOf: (l) => this.validation(l),
            onSetFilter: (cat) => this.setFilter(cat),
            onOpen: (id) => this.open(id, { guided: true }),
            onClose: () => { this._catalog = null; },
        });
        this._catalog = { sheet };
    }

    _currentPlayableFen() {
        const s = this.state;
        const ln = this.lineOf();
        const cur = Math.max(0, Math.min(ln.size, s.cursor));
        const p = ln.positions[cur];
        return p && p.legalMoves.length > 0 ? p.toFen() : null;
    }

    _render() {
        if (this._destroyed || !Lessons.all.length) return;
        const s = this.state;
        const l = this.lesson;
        const ln = this.lineOf();
        const tx = this.textsOf();
        const cur = Math.max(0, Math.min(ln.size, s.cursor));
        const eg = this.endgame?.state || null;
        const rx = this.reflex.state || null;
        const pr = s.practice;
        const model = l.kind === LessonKind.MODEL_GAME;
        const wide = isTwoPane();
        const prog = db.lessonProgressOf(l.id);
        const stars = prog?.stars || 0;
        const mastered = this.mastered.has(l.id);
        const needsChallenge = !mastered && stars < 2 && !s.review && !s.repertoire;
        const toValidate = !mastered && stars >= 2 && this.validation(l) !== Validation.NONE;

        // Top header: session vs lesson selector
        const stTitle = this.sessionTitle();
        this.topSessionWrap.classList.toggle('hidden', !stTitle);
        this.topNormalWrap.classList.toggle('hidden', Boolean(stTitle));
        if (stTitle) {
            this.topSessionWrap.replaceChildren(createSessionHeader({
                title: stTitle.title,
                label: stTitle.label,
                backLabel: s.fromDrawer ? 'Revenir aux entraînements' : 'Revenir à la leçon',
                onBack: () => this.closeTraining(),
                onFlip: () => this.flip(),
            }));
        } else {
            const num = Lessons.number(l.id);
            const total = Lessons.all.length;
            this.selectorTitle.textContent = `${num}. ${l.title}`;
            this.selectorCat.textContent = `${CATEGORY_LABELS[l.category] || l.categoryLabel} · P${l.level}`;
            this.selectorStatus.replaceChildren();
            if (mastered) {
                this.selectorStatus.appendChild(createIcon('CheckCircle', 15, 'academy-mastered-icon'));
            } else if (toValidate) {
                this.selectorStatus.textContent = ' · À valider';
            }
            this.selectorStarsWrap.replaceChildren(stars > 0 ? createStarsRow(stars, { size: 13 }) : document.createTextNode(''));
            this.selectorProg.textContent = `${this.mastered.size}/${total}`;
            this.catalogBtn.setAttribute(
                'aria-label',
                `Leçon ${num} : ${l.title}, ${CATEGORY_LABELS[l.category] || l.categoryLabel}, palier ${levelSpoken(l.level)}`
                + (mastered ? ', maîtrisée' : (toValidate ? ', Défi réussi, validation restante' : ''))
                + (stars > 0 ? `, ${starsText(stars)}` : '')
                + `. ${this.mastered.size} leçons maîtrisées sur ${total}. Ouvrir le catalogue des leçons`,
            );

            // Modes labels ("Défi" vs "Deviner")
            const segBtns = this.modeSeg.querySelectorAll('.duck-seg-btn');
            if (segBtns[1]) {
                const lbl = segBtns[1].querySelector('span:last-child');
                if (lbl) lbl.textContent = model ? 'Deviner' : 'Défi';
            }
            updateSegmentedRow(this.modeSeg, s.challenge ? 1 : 0);

            // Variant dropdown & model game Play button
            this._variantMenuEl?.cleanup?.();
            this._variantMenuEl = null;
            this.variantSlot.replaceChildren();
            if (!s.challenge && l.variants.length > 0) {
                this._variantMenuEl = buildVariantMenu({
                    lesson: l,
                    selected: s.variant,
                    onSelect: (v) => this.setVariant(v),
                });
                this.variantSlot.appendChild(this._variantMenuEl);
            }
            const endFen = this._currentPlayableFen();
            const showModelPlay = model && Boolean(endFen) && !s.judging && !s.refute && !s.done;
            this.modelPlayBtn.classList.toggle('hidden', !showModelPlay);
        }

        // Over-board strip
        const infoBar = buildAcademyBoardInfo({ eg, rx, pr });
        this.layout.overSlot.replaceChildren(infoBar || '');

        // Eval bar only for finished/over endgame drills
        const showEval = Boolean(eg && (eg.over || eg.finished) && eg.evalWhite != null);
        this.evalBar.el.classList.toggle('hidden', !showEval);
        this.layout.setEvalActive(showEval);
        if (showEval) {
            const egFlip = (!eg.family.heroWhite) !== s.sessionFlipped;
            this.evalBar.update(eg.evalWhite, egFlip);
        }

        // Default visibility
        this.moveStrip.el.classList.add('hidden');
        this.quizChoicesWrap.classList.add('hidden');
        this.moveTableWrap.classList.add('hidden');
        this.refuteRow.wrap.classList.add('hidden');
        this.actionRow.replaceChildren();

        const bridgesEl = buildLessonBridges({
            lesson: l,
            endFen: this._currentPlayableFen(),
            onTrainTheme: this.onTrainTheme,
            onPlayPosition: model
                ? (fen) => openChooseColorSheet({
                    fen,
                    lesson: l,
                    onPick: (white) => this.onPlayPosition?.(fen, white),
                })
                : this.onPlayPosition,
        });

        // Panels switch
        if (eg) {
            this._renderEndgamePanel(eg, l, needsChallenge);
        } else if (rx) {
            this._renderReflexPanel(rx);
        } else if (pr) {
            this._renderPracticePanel(pr);
        } else if (s.quiz) {
            this._renderQuizPanel(l, s.quiz, needsChallenge);
        } else if (!s.challenge) {
            const asking = this.asking(s);
            if (!wide) {
                this.moveStrip.el.classList.remove('hidden');
                this.moveStrip.update({
                    line: ln,
                    cursor: cur,
                    onSelect: (n) => this.jump(n),
                    onPrev: () => this.step(-1),
                    onNext: () => this.step(1),
                    emptyText: "Les coups de la leçon s'afficheront ici.",
                    firstTurn: 1,
                });
            } else {
                this.moveTableWrap.classList.remove('hidden');
                renderAcademyMoveTable(this.moveTableWrap, ln, cur, (n) => this.jump(n));
            }
            const inVariant = s.variant > 0 && cur > l.variants[s.variant - 1].from;
            let title;
            if (asking) title = ASK;
            else if (cur === 0) title = 'Objectif de la leçon';
            else if (inVariant) title = l.variants[s.variant - 1].title;
            else title = stepTitle(ln, cur, { first: 1 });

            const base = cur === 0
                ? `${l.summary}\n\nÀ retenir : ${l.takeaway}${asking ? '' : '\n\nTouchez Lecture pour dérouler la leçon coup par coup.'}`
                : tx[cur - 1];
            let text = base;
            if (s.voiceTip) text = `${s.voiceTip}\n\n${base}`;
            else if (s.stuck && asking) text = s.stuck;
            else if (s.note) text = `${s.note}\n\n${base}`;
            else if (asking) text = `${base}\n\nJouez votre coup sur l'échiquier, ou touchez Lecture pour découvrir celui de la leçon.`;

            let tone = s.cursor === 0 ? Tone.INFO : Tone.INFO;
            if (s.voiceTip) tone = Tone.GOLD;
            else if (s.stuck && asking) tone = Tone.GOLD;
            else if (s.note) tone = s.noteTone;
            else if (asking) tone = Tone.GOLD;

            this.feedbackCard.update({
                text,
                tone,
                title,
                busy: s.judging,
                actionEl: cur === ln.size ? bridgesEl : null,
            });
            this.feedbackCard.el.classList.toggle('is-wide-academy', wide);

            const narration = prefs.current.narration;
            const speaking = narrator.speaking;
            const bSpeech = duckIconButton({
                icon: (speaking || !narration) ? 'VolumeOff' : 'VolumeUp',
                ariaLabel: s.voiceTip && this._voiceAvailable !== false && !narration
                    ? 'Activer la lecture vocale'
                    : s.voiceTip
                        ? "Fermer l'aide sur la lecture vocale"
                        : !narration
                            ? 'Lecture vocale désactivée : comment l\'activer'
                            : speaking
                                ? 'Arrêter la lecture à voix haute'
                                : 'Réécouter le commentaire',
                selected: narration && this._voiceAvailable !== false ? speaking : false,
                onClick: () => {
                    if (s.voiceTip && this._voiceAvailable !== false && !narration) {
                        s.voiceTip = null;
                        narrator.prepare();
                        prefs.setNarration(true);
                        this._render();
                    } else if (s.voiceTip) {
                        s.voiceTip = null;
                        this._render();
                    } else if (narration && this._voiceAvailable !== false) {
                        this.toggleSpeech();
                    } else if (this._voiceAvailable === false) {
                        narrator.prepare();
                        s.voiceTip = "Aucune voix française n'est disponible sur ce navigateur. Vérifiez les réglages de synthèse vocale de votre appareil.";
                        this._render();
                    } else {
                        narrator.prepare();
                        s.voiceTip = 'La lecture vocale est désactivée. Touchez de nouveau le haut-parleur pour l\'activer (réglage aussi dans Paramètres, section Audio, voix et retours).';
                        this._render();
                    }
                },
            });

            const leftBtn = asking
                ? hintIconButton({ stage: s.hintStage, enabled: !s.judging && s.hintStage === 0, onClick: () => this.guideHint() })
                : duckIconButton({ icon: 'SkipPrevious', ariaLabel: 'Revenir au début', enabled: cur > 0, onClick: () => this.rewind() });

            let mainBtn = null;
            if (cur >= ln.size) {
                mainBtn = this._buildEndOfLessonButton(l);
            } else {
                const running = s.playing || speaking;
                mainBtn = duckButton({
                    label: running ? 'Pause' : 'Lecture',
                    icon: running ? 'Pause' : 'PlayArrow',
                    accent: 'blue',
                    filled: true,
                    className: 'flex-1',
                    ariaLabel: (asking && !running) ? 'Lecture : découvrir le coup de la leçon et continuer' : null,
                    onClick: () => (!s.playing && speaking ? this.pause() : this.togglePlay()),
                });
            }

            const bEnd = duckIconButton({
                icon: 'SkipNext',
                ariaLabel: 'Aller à la fin',
                enabled: cur < ln.size,
                onClick: () => this.last(),
            });

            this.actionRow.append(bSpeech, leftBtn, mainBtn, bEnd);
        } else {
            // Challenge or "Devinez le coup"
            const turn = turnOf(ln, Math.min(cur, Math.max(0, ln.size - 1)), 1);
            const totalTurns = ln.size > 0 ? turnOf(ln, ln.size - 1, 1) : 1;
            const side = l.heroWhite ? 'Blancs' : 'Noirs';
            let title;
            if (s.done && model) title = `Partie terminée · ${s.guessScore} points sur ${s.guessMax}`;
            else if (s.done) title = `Défi réussi · ${starsText(s.stars)}`;
            else if (model) title = `Devinez le coup des ${side} · coup ${turn} sur ${totalTurns} · ${s.guessScore} points sur ${s.guessMax}`;
            else title = `Défi : jouez les ${side}${s.variant > 0 ? ` · ${variantLabel(l, s.variant)}` : ''} · coup ${turn} sur ${totalTurns}`;

            this.feedbackCard.update({
                text: s.stuck || s.message,
                tone: s.stuck ? Tone.GOLD : s.tone,
                title,
                busy: s.judging,
                actionEl: (s.done && !s.review && !s.repertoire) ? bridgesEl : null,
            });
            this.feedbackCard.el.classList.toggle('is-wide-academy', false);

            if (s.refute && s.refuteUntil > 0) {
                this.refuteRow.wrap.classList.remove('hidden');
                this._runCountdown(s.refuteUntil, s.refuteHold, () => Boolean(this.state.refute && this.state.refuteUntil));
            }

            if (s.refute) {
                this.actionRow.appendChild(duckButton({
                    label: 'Reprendre au coup manqué',
                    icon: 'Undo',
                    accent: 'red',
                    filled: true,
                    className: 'flex-1',
                    onClick: () => this.resumeAtMiss(),
                }));
            } else if (s.done && s.review) {
                this.actionRow.appendChild(this._buildReviewNextButton(s.review));
            } else if (s.done && s.repertoire) {
                const rep = s.repertoire;
                const lastItem = rep.index + 1 >= rep.items.length;
                const okCount = rep.results.filter(Boolean).length;
                this.actionRow.appendChild(duckButton({
                    label: lastItem ? `Terminer (${okCount} sur ${rep.items.length})` : 'Ouverture suivante',
                    icon: 'ArrowForward',
                    accent: 'green',
                    filled: true,
                    className: 'flex-1',
                    onClick: () => this.nextRepertoire(),
                }));
            } else if (s.done) {
                const bRestart = duckIconButton({
                    icon: 'RestartAlt',
                    ariaLabel: 'Recommencer le Défi',
                    onClick: () => this.restartChallenge(),
                });
                const bGuided = duckButton({
                    label: 'Revoir',
                    icon: 'Visibility',
                    className: 'flex-1',
                    ariaLabel: 'Revoir les coups de la leçon en mode Guidé',
                    onClick: () => this.setChallenge(false),
                });
                const v = this.validation(l);
                let bNext;
                if (!mastered && v === Validation.PUZZLES) {
                    bNext = duckButton({
                        label: 'Valider : 5 problèmes',
                        icon: 'Extension',
                        accent: 'green',
                        filled: true,
                        className: 'flex-1-4',
                        ariaLabel: 'Valider la leçon sur 5 problèmes inédits du même thème',
                        onClick: () => this.startPractice(),
                    });
                } else if (!mastered && v === Validation.ENDGAME) {
                    bNext = duckButton({
                        label: 'Valider : 5 positions',
                        icon: 'SportsEsports',
                        accent: 'green',
                        filled: true,
                        className: 'flex-1-4',
                        ariaLabel: "Valider la leçon contre l'Ordinateur sur 5 positions",
                        onClick: () => {
                            const fam = EndgameFamily.of(l.drill);
                            if (fam) this.startEndgame(fam, { fromLesson: true });
                        },
                    });
                } else {
                    bNext = duckButton({
                        label: 'Leçon suivante',
                        icon: 'ArrowForward',
                        accent: 'green',
                        filled: true,
                        className: 'flex-1-4',
                        onClick: () => this.nextLesson(true),
                    });
                }
                this.actionRow.append(bRestart, bGuided, bNext);
            } else if (model) {
                this.actionRow.append(
                    duckButton({
                        label: 'Recommencer',
                        icon: 'RestartAlt',
                        className: 'flex-1',
                        onClick: () => this.restartChallenge(),
                    }),
                    duckButton({
                        label: 'Passer ce coup',
                        icon: 'ArrowForward',
                        enabled: !s.judging,
                        className: 'flex-1-4',
                        onClick: () => this.skipGuess(),
                    }),
                );
            } else {
                this.actionRow.append(
                    duckButton({
                        label: 'Recommencer',
                        icon: 'RestartAlt',
                        className: 'flex-1',
                        onClick: () => this.restartChallenge(),
                    }),
                    hintButton({
                        stage: s.hintStage,
                        enabled: !s.judging,
                        className: 'flex-1-4',
                        onClick: () => this.hint(),
                    }),
                );
            }
        }

        this._renderBoard();
        this.layout.relayout();
        this._emitTopState();
    }

    _buildEndOfLessonButton(l) {
        const fam = EndgameFamily.of(l.drill);
        if (l.quiz) {
            return duckButton({
                label: 'Quel est le plan ?',
                accent: 'gold',
                filled: true,
                className: 'flex-1',
                onClick: () => this.startQuiz(),
            });
        }
        if (fam) {
            return duckButton({
                label: fam.goal === EndgameGoal.WIN ? 'Gagnez-la' : 'Tenez la nulle',
                icon: 'SportsEsports',
                accent: 'green',
                filled: true,
                className: 'flex-1',
                ariaLabel: `${fam.label} : jouer contre l'Ordinateur`,
                onClick: () => this.startEndgame(fam, { fromLesson: true }),
            });
        }
        return duckButton({
            label: l.kind === LessonKind.MODEL_GAME ? 'Devinez le coup' : 'Passer au Défi',
            icon: 'SportsScore',
            accent: 'gold',
            filled: true,
            className: 'flex-1',
            onClick: () => this.setChallenge(true),
        });
    }

    _buildReviewNextButton(r) {
        const last = r.index + 1 >= r.queue.length;
        return duckButton({
            label: last ? 'Terminer les révisions' : 'Révision suivante',
            icon: 'ArrowForward',
            accent: 'green',
            filled: true,
            className: 'flex-1',
            onClick: () => this.nextReview(),
        });
    }

    _renderEndgamePanel(eg, l, needsChallenge) {
        const score = eg.results.filter(Boolean).length;
        const title = eg.finished
            ? `${eg.family.label} · bilan : ${score} sur ${eg.total}`
            : `${eg.family.label} · position ${eg.index + 1} sur ${eg.total} · coup ${eg.moves} sur ${eg.family.maxMoves}`;
        this.feedbackCard.update({
            text: this.state.stuck || eg.message,
            tone: this.state.stuck ? Tone.GOLD : eg.tone,
            title,
        });
        const fromLesson = needsChallenge && eg.family.name === l.drill;
        if (eg.finished && this.state.review) {
            this.actionRow.appendChild(this._buildReviewNextButton(this.state.review));
        } else if (eg.finished && fromLesson) {
            this.actionRow.append(
                duckButton({ label: 'Recommencer', icon: 'RestartAlt', className: 'flex-1', onClick: () => this.startEndgame(eg.family) }),
                duckButton({
                    label: 'Passer au Défi',
                    icon: 'SportsScore',
                    accent: 'gold',
                    filled: true,
                    className: 'flex-1',
                    onClick: () => {
                        this.closeEndgame();
                        this.setChallenge(true);
                    },
                }),
            );
        } else if (eg.finished) {
            this.actionRow.append(
                duckButton({ label: 'Fermer', icon: 'ArrowBack', className: 'flex-1', onClick: () => this.closeEndgame() }),
                duckButton({ label: 'Recommencer', icon: 'RestartAlt', accent: 'green', filled: true, className: 'flex-1', onClick: () => this.startEndgame(eg.family) }),
            );
        } else if (eg.over) {
            if (eg.results[eg.results.length - 1] === false) {
                this.actionRow.appendChild(duckButton({
                    label: eg.before ? 'Reprendre le coup' : 'Rejouer',
                    icon: 'RestartAlt',
                    className: 'flex-1',
                    ariaLabel: eg.before
                        ? "Revenir juste avant l'erreur pour s'entraîner, sans changer le score"
                        : "Rejouer cette position pour s'entraîner, sans changer le score",
                    onClick: () => this.endgame.retry(),
                }));
            }
            this.actionRow.appendChild(duckButton({
                label: eg.index + 1 < eg.total ? 'Position suivante' : 'Voir le bilan',
                icon: 'ArrowForward',
                accent: 'green',
                filled: true,
                className: 'flex-1-4',
                onClick: () => this.endgame.next(),
            }));
        } else if (eg.hinting) {
            this.actionRow.appendChild(duckButton({
                label: 'Recherche…',
                icon: 'Lightbulb',
                accent: 'green',
                enabled: false,
                className: 'flex-1-4',
                ariaLabel: "Indice : l'Ordinateur cherche un bon coup",
            }));
        } else {
            const heroTurn = Boolean(eg.position && !eg.over && !eg.thinking && eg.position.whiteToMove === eg.family.heroWhite);
            this.actionRow.appendChild(hintButton({
                stage: eg.hintStage,
                enabled: heroTurn,
                className: 'flex-1-4',
                onClick: () => this.endgame.hint(),
            }));
        }
    }

    _renderReflexPanel(rx) {
        const score = rx.results.filter(Boolean).length;
        const title = rx.finished
            ? `${rx.kind.label} · bilan : ${score} sur ${rx.total}`
            : rx.loading
                ? rx.kind.label
                : `${rx.kind.label} · ${rx.index + 1} sur ${rx.total}`;
        this.feedbackCard.update({ text: rx.message, tone: rx.tone, title });
        if (rx.finished) {
            this.actionRow.append(
                duckButton({ label: 'Fermer', icon: 'ArrowBack', className: 'flex-1', onClick: () => this.closeReflex() }),
                duckButton({ label: 'Recommencer', icon: 'RestartAlt', accent: 'green', filled: true, className: 'flex-1', onClick: () => this.startReflex(rx.kind) }),
            );
        } else if (rx.answered) {
            this.actionRow.appendChild(duckButton({
                label: rx.index + 1 < rx.total ? 'Question suivante' : 'Voir le bilan',
                icon: 'ArrowForward',
                accent: 'green',
                filled: true,
                className: 'flex-1-4',
                onClick: () => this.reflex.next(),
            }));
        } else if (rx.capture) {
            this.actionRow.append(
                duckButton({ label: 'Oui, je prends', accent: 'green', filled: true, className: 'flex-1', onClick: () => this.reflex.answer(true) }),
                duckButton({ label: 'Non', accent: 'red', filled: true, className: 'flex-1', onClick: () => this.reflex.answer(false) }),
            );
        } else if (rx.blind) {
            this.actionRow.append(
                duckIconButton({
                    icon: 'VolumeUp',
                    ariaLabel: 'Réécouter les coups annoncés',
                    accent: 'blue',
                    onClick: () => this.replayBlind(),
                }),
                duckButton({
                    label: "Revoir l'échiquier",
                    icon: 'Visibility',
                    enabled: !rx.shown,
                    className: 'flex-1-3',
                    ariaLabel: "Réafficher l'échiquier après les coups annoncés ; la réponse ne comptera plus",
                    onClick: () => this.reflex.showBoard(),
                }),
            );
        }
    }

    _renderPracticePanel(pr) {
        const names = {
            LESSON: 'Validation',
            REVIEW: 'Révision',
            ONLY_MOVE: 'Le seul coup',
            PLACEMENT: 'Test de placement',
            EXAM: `Examen du palier ${levelName(pr.level)}`,
        };
        const name = names[pr.kind] || 'Validation';
        const score = pr.results.filter(Boolean).length;
        let title = name;
        if (pr.finished) title = `${name} · bilan : ${score} sur ${Math.max(1, pr.ids.length)}`;
        else if (!pr.loading) {
            title = `${name} · problème ${pr.index + 1} sur ${pr.ids.length} · ${score} réussi${score > 1 ? 's' : ''}`;
        }

        this.feedbackCard.update({
            text: this.state.stuck || pr.message,
            tone: this.state.stuck ? Tone.GOLD : pr.tone,
            title,
        });

        if (pr.refute && pr.refuteUntil > 0) {
            this.refuteRow.wrap.classList.remove('hidden');
            this._runCountdown(pr.refuteUntil, pr.refuteHold, () => Boolean(this.state.practice?.refute && this.state.practice?.refuteUntil));
        }

        const nav = !pr.finished && !pr.loading && Boolean(pr.line);
        if (nav) {
            this.actionRow.appendChild(duckIconButton({
                icon: 'KeyboardArrowLeft',
                ariaLabel: 'Coup précédent',
                enabled: !pr.refute && pr.cursor > 0,
                onClick: () => this.practiceBack(),
            }));
        }

        if (pr.finished && pr.kind === PracticeKind.REVIEW && this.state.review) {
            this.actionRow.appendChild(this._buildReviewNextButton(this.state.review));
        } else if (pr.finished) {
            this.actionRow.appendChild(duckButton({
                label: this.state.fromDrawer ? 'Revenir aux entraînements' : 'Revenir à la leçon',
                icon: 'ArrowBack',
                className: 'flex-1',
                onClick: () => this.closePractice(),
            }));
            if (pr.kind === PracticeKind.LESSON && score >= PRACTICE_PASS) {
                this.actionRow.appendChild(duckButton({
                    label: 'Leçon suivante',
                    icon: 'ArrowForward',
                    accent: 'green',
                    filled: true,
                    className: 'flex-1',
                    onClick: () => {
                        this.closePractice();
                        this.nextLesson(true);
                    },
                }));
            } else if (pr.kind === PracticeKind.LESSON || pr.kind === PracticeKind.ONLY_MOVE) {
                this.actionRow.appendChild(duckButton({
                    label: 'Retenter',
                    icon: 'RestartAlt',
                    accent: 'green',
                    filled: true,
                    className: 'flex-1',
                    onClick: () => (pr.kind === PracticeKind.LESSON ? this.startPractice() : this.startOnlyMove()),
                }));
            }
        } else if (pr.refute) {
            this.actionRow.appendChild(duckButton({
                label: 'Réessayer',
                icon: 'Undo',
                accent: 'red',
                filled: true,
                className: 'flex-1',
                onClick: () => this.retryPractice(),
            }));
        } else if (pr.failed || pr.solved) {
            this.actionRow.appendChild(duckButton({
                label: pr.index + 1 < pr.ids.length ? 'Problème suivant' : 'Voir le bilan',
                icon: 'ArrowForward',
                accent: 'green',
                filled: true,
                className: 'flex-1',
                onClick: () => this.nextPractice(),
            }));
        } else {
            this.actionRow.appendChild(hintButton({
                stage: pr.hintStage,
                enabled: !pr.loading,
                className: 'flex-1',
                onClick: () => this.practiceHint(),
            }));
            if (pr.hadError) {
                this.actionRow.appendChild(duckButton({
                    label: 'Solution',
                    icon: 'Visibility',
                    className: 'flex-1',
                    onClick: () => this.practiceSolution(),
                }));
            }
        }

        if (nav) {
            this.actionRow.appendChild(duckIconButton({
                icon: 'KeyboardArrowRight',
                ariaLabel: 'Coup suivant',
                enabled: !pr.refute && pr.cursor < pr.progress,
                onClick: () => this.practiceForward(),
            }));
        }
    }

    _renderQuizPanel(l, q, needsChallenge) {
        const quiz = l.quiz;
        if (!quiz) return;
        const picked = q.picked;
        let text = quiz.question;
        let tone = Tone.INFO;
        if (picked !== null) {
            if (picked === q.correct) {
                text = `Exact ! ${quiz.explanation}`;
                tone = Tone.GOOD;
            } else {
                text = `Pas tout à fait. La bonne réponse : ${quiz.answer}. ${quiz.explanation}`;
                tone = Tone.BAD;
            }
        }
        this.feedbackCard.update({
            text,
            tone,
            title: picked === null ? 'Question' : quiz.question,
        });

        this.quizChoicesWrap.classList.remove('hidden');
        this.quizChoicesWrap.replaceChildren();
        if (picked === null) {
            q.choices.forEach((choice, i) => {
                this.quizChoicesWrap.appendChild(duckButton({
                    label: choice,
                    accent: 'blue',
                    className: 'full-w quiz-option-btn',
                    onClick: () => this.answerQuiz(i),
                }));
            });
        } else {
            if (picked !== q.correct) {
                this.quizChoicesWrap.appendChild(renderQuizChoice(q.choices[picked], false, 'Votre réponse'));
            }
            this.quizChoicesWrap.appendChild(renderQuizChoice(
                q.choices[q.correct],
                true,
                picked === q.correct ? 'Votre réponse' : 'Bonne réponse',
            ));
            this.actionRow.append(
                duckButton({
                    label: 'Revoir la leçon',
                    icon: 'ArrowBack',
                    className: 'flex-1',
                    onClick: () => this.closeQuiz(),
                }),
                needsChallenge
                    ? duckButton({
                        label: l.kind === LessonKind.MODEL_GAME ? 'Devinez le coup' : 'Passer au Défi',
                        icon: 'SportsScore',
                        accent: 'gold',
                        filled: true,
                        className: 'flex-1',
                        onClick: () => {
                            this.closeQuiz();
                            this.setChallenge(true);
                        },
                    })
                    : duckButton({
                        label: 'Leçon suivante',
                        icon: 'ArrowForward',
                        accent: 'green',
                        filled: true,
                        className: 'flex-1',
                        onClick: () => {
                            this.closeQuiz();
                            this.nextLesson(true);
                        },
                    }),
            );
        }
    }

    _runCountdown(until, hold, checkActive) {
        if (this._refuteRaf) cancelAnimationFrame(this._refuteRaf);
        const tick = () => {
            if (this._destroyed || !checkActive()) return;
            const left = Math.max(0, until - performance.now());
            const ratio = hold > 0 ? Math.min(1, left / hold) : 0;
            this.refuteRow.fill.style.width = `${(ratio * 100).toFixed(2)}%`;
            if (left > 0) this._refuteRaf = requestAnimationFrame(tick);
        };
        this._refuteRaf = requestAnimationFrame(tick);
    }

    _renderBoard() {
        if (!this._palette || !Lessons.all.length) return;
        const c = this._palette;
        const s = this.state;
        const eg = this.endgame?.state || null;
        const rx = this.reflex.state || null;
        const pr = s.practice;

        const isLoading = Boolean((pr && pr.loading) || (rx && rx.loading));
        const isEmpty = Boolean(
            (pr && pr.finished && pr.ids.length === 0)
            || (rx && rx.finished && rx.total === 0),
        );
        this.boardLoadingEl.classList.toggle('hidden', !isLoading);
        this.boardEmptyWrap.classList.toggle('hidden', !isEmpty);
        this.boardRow.classList.toggle('hidden', isLoading || isEmpty);

        if (isLoading) return;
        if (isEmpty) {
            const msg = pr?.message || rx?.message || '';
            this.boardEmptyWrap.replaceChildren(emptyState({
                icon: 'SearchOff',
                title: 'Aucun exercice disponible',
                message: msg,
                actionLabel: s.fromDrawer ? 'Revenir aux entraînements' : 'Revenir à la leçon',
                onAction: () => this.closeTraining(),
            }));
            return;
        }

        if (eg?.position) {
            const pos = eg.position;
            const flip = (!eg.family.heroWhite) !== s.sessionFlipped;
            const heroTurn = !eg.over && !eg.thinking && pos.whiteToMove === eg.family.heroWhite;
            const hint = heroTurn ? eg.hint : null;
            const arrows = [];
            if (eg.punish) arrows.push({ from: eg.punish.from, to: eg.punish.to, color: c.red });
            if (eg.better && eg.replay && heroTurn && !eg.before && eg.moves === eg.beforeMoves && !(hint && eg.hintStage >= 2)) {
                arrows.push({ from: eg.better.from, to: eg.better.to, color: c.green });
            }
            if (hint && eg.hintStage >= 2) arrows.push({ from: hint.from, to: hint.to, color: c.green });
            const marks = (hint && eg.hintStage === 1) ? [[hint.from, c.green]] : [];

            this.board.setState({
                position: pos,
                flipped: flip,
                interactive: heroTurn,
                lastMove: eg.last,
                anim: eg.anim,
                arrows,
                marks,
                badges: [],
                kid: false,
                showCoords: this._showCoords,
                palette: c,
                onSquareTap: null,
                onIllegalTouch: (sq) => {
                    this.state.stuck = GameLogic.whyStuck(pos, sq);
                    if (this.state.stuck) this._render();
                },
                onMove: (m) => this.endgame.move(m),
            });
            return;
        }

        const rxPos = reflexSessionPosition(rx);
        if (rx && rxPos) {
            const t = rx.threat;
            const cp = rx.capture;
            const b = rx.blind;
            const flip = !(b ? b.start : rxPos).whiteToMove !== s.sessionFlipped;
            const arrows = [];
            if (cp) arrows.push({ from: cp.capture.from, to: cp.capture.to, color: c.blue });
            else if (t && rx.answered) {
                for (const [to, from] of t.threats) arrows.push({ from, to, color: c.red });
            } else if (b && rx.answered) arrows.push({ from: b.expected.from, to: b.expected.to, color: c.green });

            const marks = [];
            if (t && rx.answered) {
                for (const to of t.targets) marks.push([to, c.green]);
                if (rx.tapped >= 0 && !t.targets.includes(rx.tapped)) marks.push([rx.tapped, c.red]);
            } else if (b && !rx.answered && rx.from >= 0) {
                marks.push([rx.from, c.select]);
            } else if (b && rx.answered && rx.tapped >= 0 && rx.tone === Tone.BAD && !(rx.from === b.expected.from && rx.tapped === b.expected.to)) {
                marks.push([rx.tapped, c.red]);
            }

            this.board.setState({
                position: rxPos,
                flipped: flip,
                interactive: false,
                lastMove: t?.lastMove || null,
                anim: null,
                arrows,
                marks,
                badges: [],
                kid: false,
                showCoords: this._showCoords,
                palette: c,
                onSquareTap: ((t || b) && !rx.answered) ? (sq) => {
                    const prevLen = rx.results.length;
                    this.reflex.tap(sq);
                    const next = this.reflex.state;
                    if (next && next.results.length > prevLen && next.pulse) {
                        if (next.pulse.good) feedback.success();
                        else feedback.error();
                    }
                } : null,
                onIllegalTouch: null,
                onMove: () => {},
            });
            return;
        }

        if (pr) {
            const pl = pr.line;
            const pc = pl ? Math.max(0, Math.min(pl.size, pr.cursor)) : 0;
            const r = pr.refute;
            const heroWhite = pl ? pl.positions[0].whiteToMove === false : true;
            const ppos = r?.position || (pl ? pl.positions[pc] : this.lineOf().positions[0]);
            const pnext = (pl && pc < pl.size) ? pl.moves[pc] : null;
            const pTurn = Boolean(pl && !r && !pr.failed && !pr.solved && !pr.finished && pc === pr.progress && pc < pl.size && ppos.whiteToMove === heroWhite);
            const arrows = [];
            if (r?.arrow) arrows.push({ from: r.arrow.from, to: r.arrow.to, color: r.arrow.color || c.red });
            else if (pnext && (pr.failed || (pTurn && pr.hintStage >= 2))) arrows.push({ from: pnext.from, to: pnext.to, color: c.green });
            const marks = (pTurn && pr.hintStage >= 1 && pnext) ? [[pnext.from, c.green]] : [];

            this.board.setState({
                position: ppos,
                flipped: (!heroWhite) !== s.sessionFlipped,
                interactive: pTurn,
                lastMove: r?.last || (pl && pc > 0 ? pl.moves[pc - 1] : null),
                anim: pr.anim,
                arrows,
                marks,
                badges: [],
                kid: false,
                showCoords: this._showCoords,
                palette: c,
                onSquareTap: null,
                onIllegalTouch: (sq) => {
                    this.state.stuck = GameLogic.whyStuck(ppos, sq);
                    if (this.state.stuck) this._render();
                },
                onMove: (m) => this.practiceMove(m),
            });
            return;
        }

        const l = this.lesson;
        const ln = this.lineOf();
        const cur = Math.max(0, Math.min(ln.size, s.cursor));
        const r = s.refute || s.tentative;
        const pos = r?.position || ln.positions[cur];
        const last = r?.last || (cur > 0 ? ln.moves[cur - 1] : null);
        const heroTurn = s.challenge && !s.done && !s.judging && !r && cur < ln.size && ln.positions[cur].whiteToMove === l.heroWhite;
        const asking = this.asking(s);
        const next = cur < ln.size ? ln.moves[cur] : null;
        const visuals = (!s.challenge && s.variant === 0) ? l.stepVisuals.get(cur) : null;

        const arrows = [];
        if (r?.arrow) arrows.push({ from: r.arrow.from, to: r.arrow.to, color: r.arrow.color || c.red });
        else if ((heroTurn || asking) && s.suggest) arrows.push({ from: s.suggest.from, to: s.suggest.to, color: c.green });
        else if (heroTurn && s.hintStage >= 2 && next) arrows.push({ from: next.from, to: next.to, color: c.green });
        else if (!s.challenge && visuals?.arrows) {
            for (const [f, t] of visuals.arrows) arrows.push({ from: f, to: t, color: c.blue });
        }

        const marks = [];
        if ((heroTurn || (asking && !s.judging)) && s.hintStage >= 1 && next) {
            marks.push([next.from, c.green]);
        } else if (visuals?.marks) {
            for (const q of visuals.marks) marks.push([q, c.gold]);
        }

        this.board.setState({
            position: pos,
            flipped: s.flipped,
            interactive: heroTurn || (asking && !s.judging),
            lastMove: last,
            anim: s.anim,
            arrows,
            marks,
            badges: [],
            kid: false,
            showCoords: this._showCoords,
            palette: c,
            onSquareTap: null,
            onIllegalTouch: (sq) => {
                this.state.stuck = GameLogic.whyStuck(pos, sq);
                if (this.state.stuck) this._render();
            },
            onMove: (m) => (s.challenge ? this.challengeMove(m) : this.guideMove(m)),
        });
    }
}
