const STORAGE_KEY = 'chessduck_v2_settings';

export const DEFAULT_SETTINGS = Object.freeze({
    themeMode: 2,          // 0 = système, 1 = Jour, 2 = Nuit
    dynamicColor: false,   // Conservé pour parité schéma, non utilisé sur Web
    coords: true,
    confirmActions: true,
    notationBest: 0,
    haptics: true,
    sound: true,
    kidMode: false,
    recentPuzzles: [],
    pseudo: 'Joueur',
    pseudo2: 'Joueur 2',
    elo: 1200,
    twoPlayers: false,
    colorChoice: 0,        // 0 = Blancs, 1 = Aléatoire, 2 = Noirs
    aiElo: 1200,
    puzzleBand: 0,         // 0 = Tous, 1 = Débutant, 2 = Intermédiaire, 3 = Avancé, 4 = Expert
    puzzleTheme: '',
    puzzleId: '',
    notationLevel: 0,
    lessonId: 1,
    shareFormat: 'PORTRAIT',
    shareLight: false,
});

function loadInitial() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            recentPuzzles: Array.isArray(parsed.recentPuzzles) ? parsed.recentPuzzles : [],
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

class PrefsStore {
    constructor() {
        this._value = loadInitial();
        this._subs = new Set();
    }

    get current() {
        return this._value;
    }

    subscribe(fn) {
        this._subs.add(fn);
        fn(this._value);
        return () => this._subs.delete(fn);
    }

    _update(patch) {
        const next = { ...this._value, ...patch };
        this._value = next;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { /* ignore quota / private mode errors */ }
        for (const fn of this._subs) fn(next);
    }

    setThemeMode(v) { this._update({ themeMode: v }); }
    setCoords(v) { this._update({ coords: Boolean(v) }); }
    setConfirmActions(v) { this._update({ confirmActions: Boolean(v) }); }
    setNotationBest(v) {
        if (v > this._value.notationBest) this._update({ notationBest: v });
    }
    setHaptics(v) { this._update({ haptics: Boolean(v) }); }
    setSound(v) { this._update({ sound: Boolean(v) }); }
    setKidMode(v) { this._update({ kidMode: Boolean(v) }); }

    pushRecentPuzzle(id) {
        if (!id) return;
        const old = this._value.recentPuzzles.filter((x) => x && x !== id);
        this._update({ recentPuzzles: [id, ...old].slice(0, 6), puzzleId: id });
    }

    setPseudo(v) { this._update({ pseudo: v }); }
    setPseudo2(v) { this._update({ pseudo2: v }); }
    setElo(v) { this._update({ elo: v }); }
    setGameSettings(twoPlayers, colorChoice, aiElo) {
        this._update({ twoPlayers, colorChoice, aiElo });
    }
    setPuzzleFilter(puzzleBand, puzzleTheme) {
        this._update({ puzzleBand, puzzleTheme });
    }
    setNotationLevel(v) { this._update({ notationLevel: v }); }
    setLesson(v) { this._update({ lessonId: v }); }
    setShareStyle(shareFormat, shareLight) {
        this._update({ shareFormat, shareLight });
    }
}

export const prefs = new PrefsStore();
