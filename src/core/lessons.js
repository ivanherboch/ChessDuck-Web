import { Line } from './chess.js';

export const LessonCategory = Object.freeze({
    BASICS: 'BASICS',
    OPENING: 'OPENING',
    MIDDLEGAME: 'MIDDLEGAME',
    STRATEGY: 'STRATEGY',
    ENDGAME: 'ENDGAME',
    MODEL_GAMES: 'MODEL_GAMES',
});

export const CATEGORY_ORDER = Object.freeze([
    LessonCategory.BASICS,
    LessonCategory.OPENING,
    LessonCategory.MIDDLEGAME,
    LessonCategory.STRATEGY,
    LessonCategory.ENDGAME,
    LessonCategory.MODEL_GAMES,
]);

export const CATEGORY_LABELS = Object.freeze({
    BASICS: 'Les bases',
    OPENING: 'Ouvertures',
    MIDDLEGAME: 'Milieu de partie',
    STRATEGY: 'Stratégie',
    ENDGAME: 'Finales',
    MODEL_GAMES: 'Parties modèles',
});

export const LessonKind = Object.freeze({
    LINE: 'LINE',
    MODEL_GAME: 'MODEL_GAME',
});

export class Lesson {
    constructor(raw) {
        this.id = raw.id;
        this.category = raw.category;
        this.categoryLabel = raw.categoryLabel || CATEGORY_LABELS[raw.category] || '';
        this.title = raw.title;
        this.summary = raw.summary;
        this.heroWhite = !!raw.heroWhite;
        this.fen = raw.fen;
        this.uci = raw.uci;
        this.texts = raw.texts || [];
        this.level = Number.isInteger(raw.level) ? raw.level : 2;
        this.order = Number.isInteger(raw.order) ? raw.order : this.id;
        this.theme = raw.theme || '';
        this.kind = raw.kind === LessonKind.MODEL_GAME ? LessonKind.MODEL_GAME : LessonKind.LINE;
        this.pauseSteps = new Set(Array.isArray(raw.pauseSteps) ? raw.pauseSteps : []);
        this.takeaway = raw.takeaway || '';
        this.conditions = raw.conditions || '';

        const sv = new Map();
        if (raw.stepVisuals && typeof raw.stepVisuals === 'object') {
            for (const [k, v] of Object.entries(raw.stepVisuals)) {
                sv.set(Number(k), {
                    marks: Array.isArray(v?.marks) ? v.marks.slice() : [],
                    arrows: Array.isArray(v?.arrows) ? v.arrows.map((a) => [a[0], a[1]]) : [],
                });
            }
        }
        this.stepVisuals = sv;
        this.drill = raw.drill || '';
        this.ideas = Array.isArray(raw.ideas) ? raw.ideas.slice() : [];
        this.traps = Array.isArray(raw.traps) ? raw.traps.slice() : [];
        this.quiz = raw.quiz || null;
        this.variants = Array.isArray(raw.variants) ? raw.variants.map((v) => ({
            from: v.from,
            title: v.title,
            uci: v.uci,
            texts: v.texts || [],
        })) : [];

        this._line = null;
        this._variantLines = null;
    }

    /** Construite à la première ouverture : les coups sont rejoués directement, sans analyse de notation SAN. */
    get line() {
        if (!this._line) this._line = Line.fromUci(this.fen, this.uci);
        return this._line;
    }

    get variantLines() {
        if (!this._variantLines) {
            this._variantLines = this.variants.map((v) => {
                const prefix = this.line.uciMoves(v.from);
                const full = prefix ? `${prefix} ${v.uci}`.trim() : v.uci;
                return Line.fromUci(this.fen, full);
            });
        }
        return this._variantLines;
    }

    /** Ligne affichée : principale (0) ou variante [v] (1 = première variante). */
    lineFor(v = 0) {
        return v === 0 ? this.line : this.variantLines[v - 1];
    }

    /** Commentaires de la ligne [v] : ceux de la ligne principale jusqu'au départ de la variante, puis les siens. */
    textsFor(v = 0) {
        if (v === 0) return this.texts;
        const vr = this.variants[v - 1];
        return this.texts.slice(0, vr.from).concat(vr.texts);
    }
}

export const Lessons = {
    all: [],
    categories: [],
    _index: new Map(),
    _numbers: new Map(),
    _loadPromise: null,

    async load() {
        if (this.all.length > 0) return this.all;
        if (!this._loadPromise) {
            this._loadPromise = fetch('assets/lessons.json')
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
                .then((raw) => this.initFromData(raw));
        }
        return this._loadPromise;
    },

    initFromData(raw) {
        const mapped = raw.map((d) => new Lesson(d));
        mapped.sort((a, b) => {
            const ca = CATEGORY_ORDER.indexOf(a.category);
            const cb = CATEGORY_ORDER.indexOf(b.category);
            if (ca !== cb) return ca - cb;
            return a.order - b.order;
        });
        this.all = mapped;
        this._index = new Map(this.all.map((l) => [l.id, l]));
        this._numbers = new Map(this.all.map((l, i) => [l.id, i + 1]));
        this.categories = CATEGORY_ORDER.filter((c) => this.all.some((l) => l.category === c));
        return this.all;
    },

    byId(id) {
        return this._index.get(id) || this.all[0] || null;
    },

    /** Numéro affiché dans le catalogue (1 = première leçon de la liste), distinct de [Lesson.id]. */
    number(id) {
        return this._numbers.get(id) || 0;
    },
};
