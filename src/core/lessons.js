import { Line } from './chess.js';

export const LessonCategory = Object.freeze({
    OPENING: 'OPENING',
    MIDDLEGAME: 'MIDDLEGAME',
    ENDGAME: 'ENDGAME',
});

export const CATEGORY_LABELS = Object.freeze({
    OPENING: 'Ouvertures',
    MIDDLEGAME: 'Milieu de partie',
    ENDGAME: 'Finales',
});

export class Lesson {
    constructor(data) {
        this.id = data.id;
        this.category = data.category;
        this.categoryLabel = data.categoryLabel || CATEGORY_LABELS[data.category] || '';
        this.title = data.title;
        this.summary = data.summary;
        this.heroWhite = data.heroWhite;
        this.fen = data.fen;
        this.uci = data.uci;
        this.texts = data.texts;
        this._line = null;
    }

    get line() {
        if (!this._line) this._line = Line.fromUci(this.fen, this.uci);
        return this._line;
    }
}

export const Lessons = {
    all: [],
    _loaded: false,
    _loadingPromise: null,

    initFromData(rawList) {
        this.all = rawList.map((d) => new Lesson(d));
        this._loaded = true;
        return this.all;
    },

    async load(url = './assets/lessons.json') {
        if (this._loaded) return this.all;
        if (!this._loadingPromise) {
            this._loadingPromise = fetch(url)
                .then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status} loading lessons`);
                    return res.json();
                })
                .then((list) => this.initFromData(list));
        }
        return this._loadingPromise;
    },

    byId(id) {
        return this.all.find((l) => l.id === id) || this.all[0] || null;
    },
};
