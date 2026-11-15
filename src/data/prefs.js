const STORAGE_KEY = 'chessduck_v2_settings';

export const DEFAULT_ELO = 1200;

export const DEFAULT_SETTINGS = Object.freeze({
    themeMode: 2,          // 0 = système, 1 = Jour, 2 = Nuit
    palette: 0,            // 0 = Ardoise & Or, 1 = Améthyste, 2 = Noyer, 3 = Graphite & Rose, 4 = Bleu-Orange
    boardTheme: 0,         // 0 = Bois classique, 1 = Ardoise, 2 = Vert tournoi, 3 = Améthyste et lin
    coords: true,
    confirmActions: true,
    notationBest: 0,
    haptics: true,
    sound: true,
    narration: false,      // Lecture à voix haute des commentaires de l'Académie (mode Guidé)
    kidNarration: false,   // Lecture à voix haute des fiches de pièces du mode enfant (réglage parental)
    kidMode: false,
    recentPuzzles: [],
    knownThemePuzzles: [],
    pseudo: 'Joueur',
    pseudo2: 'Joueur 2',
    elo: DEFAULT_ELO,
    twoPlayers: false,
    colorChoice: 0,        // 0 = Blancs, 1 = Aléatoire, 2 = Noirs
    aiElo: DEFAULT_ELO,
    puzzleBand: 0,         // 0 = Tous, 1 = Débutant, 2 = Intermédiaire, 3 = Avancé, 4 = Expert
    puzzleTheme: '',
    puzzleId: '',
    notationLevel: 0,
    lessonId: 1,
    shareFormat: 'PORTRAIT',
    shareLight: false,
});

function clampInt(v, min, max, fallback) {
    return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function loadInitial() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            themeMode: clampInt(parsed.themeMode, 0, 2, DEFAULT_SETTINGS.themeMode),
            palette: clampInt(parsed.palette, 0, 4, DEFAULT_SETTINGS.palette),
            boardTheme: clampInt(parsed.boardTheme, 0, 3, DEFAULT_SETTINGS.boardTheme),
            coords: parsed.coords !== undefined ? Boolean(parsed.coords) : DEFAULT_SETTINGS.coords,
            confirmActions: parsed.confirmActions !== undefined ? Boolean(parsed.confirmActions) : DEFAULT_SETTINGS.confirmActions,
            notationBest: Number.isInteger(parsed.notationBest) && parsed.notationBest >= 0 ? parsed.notationBest : 0,
            haptics: parsed.haptics !== undefined ? Boolean(parsed.haptics) : DEFAULT_SETTINGS.haptics,
            sound: parsed.sound !== undefined ? Boolean(parsed.sound) : DEFAULT_SETTINGS.sound,
            narration: Boolean(parsed.narration),
            kidNarration: Boolean(parsed.kidNarration),
            kidMode: Boolean(parsed.kidMode),
            recentPuzzles: Array.isArray(parsed.recentPuzzles) ? parsed.recentPuzzles.filter((x) => typeof x === 'string' && x) : [],
            knownThemePuzzles: Array.isArray(parsed.knownThemePuzzles) ? parsed.knownThemePuzzles.filter((x) => typeof x === 'string' && x) : [],
            colorChoice: clampInt(parsed.colorChoice, 0, 2, DEFAULT_SETTINGS.colorChoice),
            puzzleBand: clampInt(parsed.puzzleBand, 0, 4, DEFAULT_SETTINGS.puzzleBand),
            notationLevel: clampInt(parsed.notationLevel, 0, 3, DEFAULT_SETTINGS.notationLevel),
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

    setThemeMode(v) { this._update({ themeMode: clampInt(v, 0, 2, DEFAULT_SETTINGS.themeMode) }); }
    setPalette(v) { this._update({ palette: clampInt(v, 0, 4, DEFAULT_SETTINGS.palette) }); }
    setBoardTheme(v) { this._update({ boardTheme: clampInt(v, 0, 3, DEFAULT_SETTINGS.boardTheme) }); }
    setCoords(v) { this._update({ coords: Boolean(v) }); }
    setConfirmActions(v) { this._update({ confirmActions: Boolean(v) }); }
    setNotationBest(v) {
        if (v > this._value.notationBest) this._update({ notationBest: v });
    }
    setHaptics(v) { this._update({ haptics: Boolean(v) }); }
    setSound(v) { this._update({ sound: Boolean(v) }); }
    setNarration(v) { this._update({ narration: Boolean(v) }); }
    setKidNarration(v) { this._update({ kidNarration: Boolean(v) }); }
    setKidMode(v) { this._update({ kidMode: Boolean(v) }); }

    pushRecentPuzzle(id) {
        if (!id) return;
        const old = this._value.recentPuzzles.filter((x) => x && x !== id);
        const recent = [id, ...old].slice(0, 6);
        // Les thèmes « connus » ne concernent que les problèmes encore dans l'historique.
        const known = (this._value.knownThemePuzzles || []).filter((x) => x && recent.includes(x));
        this._update({ recentPuzzles: recent, puzzleId: id, knownThemePuzzles: known });
    }

    markThemeKnown(id) {
        if (!id) return;
        const cur = this._value.knownThemePuzzles || [];
        if (!cur.includes(id)) {
            this._update({ knownThemePuzzles: [...cur, id] });
        }
    }

    setPseudo(v) { this._update({ pseudo: v }); }
    setPseudo2(v) { this._update({ pseudo2: v }); }
    setElo(v) { this._update({ elo: v }); }
    setGameSettings(twoPlayers, colorChoice, aiElo) {
        this._update({
            twoPlayers: Boolean(twoPlayers),
            colorChoice: clampInt(colorChoice, 0, 2, DEFAULT_SETTINGS.colorChoice),
            aiElo,
        });
    }
    setPuzzleFilter(puzzleBand, puzzleTheme) {
        this._update({
            puzzleBand: clampInt(puzzleBand, 0, 4, DEFAULT_SETTINGS.puzzleBand),
            puzzleTheme: typeof puzzleTheme === 'string' ? puzzleTheme : '',
        });
    }
    setNotationLevel(v) { this._update({ notationLevel: clampInt(v, 0, 3, DEFAULT_SETTINGS.notationLevel) }); }
    setLesson(v) { this._update({ lessonId: v }); }
    setShareStyle(shareFormat, shareLight) {
        this._update({ shareFormat, shareLight });
    }
}

export const prefs = new PrefsStore();
