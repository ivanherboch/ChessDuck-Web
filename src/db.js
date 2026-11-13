// Stockage local (Préférences, Progression, Historique des parties) & Catalogue de 50 000 problèmes Lichess

import { ALL_THEMES, bandRange, primaryTheme } from './themes.js';

const SETTINGS_KEY = 'chessduck_settings_v1';
const DB_NAME = 'chessduck_db';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS = {
  dark: true,
  haptics: true,
  sound: true,
  kidMode: false,
  recentPuzzles: [],
  pseudo: 'Joueur',
  pseudo2: 'Joueur 2',
  elo: 1200,
  twoPlayers: false,
  colorChoice: 0, // 0=Blancs, 1=Aléatoire, 2=Noirs
  aiElo: 1200,
  puzzleBand: 0,
  puzzleTheme: '',
  puzzleId: '',
  notationLevel: 0,
  lessonId: 1,
};

export class PrefsStore {
  constructor() {
    this._settings = this._load();
    this._subs = new Set();
  }

  _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  _save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
    } catch {}
    for (const fn of this._subs) fn(this._settings);
  }

  get() {
    return this._settings;
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  update(patch) {
    this._settings = { ...this._settings, ...patch };
    this._save();
  }

  pushRecentPuzzle(id) {
    const old = (this._settings.recentPuzzles || []).filter((x) => x && x !== id);
    this.update({
      recentPuzzles: [id, ...old].slice(0, 6),
      puzzleId: id,
    });
  }
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('puzzle_progress')) {
        db.createObjectStore('puzzle_progress', { keyPath: 'puzzleId' });
      }
      if (!db.objectStoreNames.contains('lesson_progress')) {
        db.createObjectStore('lesson_progress', { keyPath: 'lessonId' });
      }
      if (!db.objectStoreNames.contains('games')) {
        db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const LS_FALLBACK_SOLVED = 'chessduck_solved_puzzles_v1';
const LS_FALLBACK_LESSONS = 'chessduck_mastered_lessons_v1';
const LS_FALLBACK_GAMES = 'chessduck_games_v1';

export class UserDatabase {
  constructor() {
    this._dbPromise = openIdb().catch(() => null);
    this.solvedIds = new Set();
    this.masteredLessons = new Set();
    this.games = [];
    this._subs = new Set();
    this._nextFallbackId = 1;
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  _notify() {
    for (const fn of this._subs) fn();
  }

  async init() {
    const db = await this._dbPromise;
    if (db) {
      const [puzzles, lessons, games] = await Promise.all([
        this._getAll(db, 'puzzle_progress'),
        this._getAll(db, 'lesson_progress'),
        this._getAll(db, 'games'),
      ]);
      this.solvedIds = new Set(puzzles.map((p) => p.puzzleId));
      this.masteredLessons = new Set(lessons.map((l) => l.lessonId));
      this.games = games.sort((a, b) => b.date - a.date);
    } else {
      try {
        this.solvedIds = new Set(JSON.parse(localStorage.getItem(LS_FALLBACK_SOLVED) || '[]'));
        this.masteredLessons = new Set(JSON.parse(localStorage.getItem(LS_FALLBACK_LESSONS) || '[]'));
        this.games = JSON.parse(localStorage.getItem(LS_FALLBACK_GAMES) || '[]').sort((a, b) => b.date - a.date);
        this._nextFallbackId = this.games.reduce((m, g) => Math.max(m, (g.id || 0) + 1), 1);
      } catch {}
    }
    this._notify();
  }

  _getAll(db, store) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async markPuzzleSolved(puzzleId) {
    if (this.solvedIds.has(puzzleId)) return;
    this.solvedIds = new Set(this.solvedIds).add(puzzleId);
    this._notify();
    const db = await this._dbPromise;
    if (db) {
      await new Promise((res) => {
        const tx = db.transaction('puzzle_progress', 'readwrite');
        tx.objectStore('puzzle_progress').put({ puzzleId, solvedAt: Date.now() });
        tx.oncomplete = res;
        tx.onerror = res;
      });
    } else {
      try { localStorage.setItem(LS_FALLBACK_SOLVED, JSON.stringify([...this.solvedIds])); } catch {}
    }
  }

  async markLessonMastered(lessonId) {
    if (this.masteredLessons.has(lessonId)) return;
    this.masteredLessons = new Set(this.masteredLessons).add(lessonId);
    this._notify();
    const db = await this._dbPromise;
    if (db) {
      await new Promise((res) => {
        const tx = db.transaction('lesson_progress', 'readwrite');
        tx.objectStore('lesson_progress').put({ lessonId, masteredAt: Date.now() });
        tx.oncomplete = res;
        tx.onerror = res;
      });
    } else {
      try { localStorage.setItem(LS_FALLBACK_LESSONS, JSON.stringify([...this.masteredLessons])); } catch {}
    }
  }

  async insertGame(record) {
    const db = await this._dbPromise;
    let saved = { ...record };
    delete saved.id;
    if (db) {
      const id = await new Promise((res, rej) => {
        const tx = db.transaction('games', 'readwrite');
        const req = tx.objectStore('games').add(saved);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }).catch(() => Date.now());
      saved.id = id;
    } else {
      saved.id = this._nextFallbackId++;
    }
    this.games = [saved, ...this.games];
    if (!db) {
      try { localStorage.setItem(LS_FALLBACK_GAMES, JSON.stringify(this.games)); } catch {}
    }
    this._notify();
    return saved;
  }

  async saveAnalysis(id, analysisStr) {
    this.games = this.games.map((g) => (g.id === id ? { ...g, analysis: analysisStr } : g));
    this._notify();
    const db = await this._dbPromise;
    if (db) {
      await new Promise((res) => {
        const tx = db.transaction('games', 'readwrite');
        const store = tx.objectStore('games');
        const req = store.get(id);
        req.onsuccess = () => {
          const item = req.result;
          if (item) {
            item.analysis = analysisStr;
            store.put(item);
          }
        };
        tx.oncomplete = res;
        tx.onerror = res;
      });
    } else {
      try { localStorage.setItem(LS_FALLBACK_GAMES, JSON.stringify(this.games)); } catch {}
    }
  }

  async deleteGame(id) {
    this.games = this.games.filter((g) => g.id !== id);
    this._notify();
    const db = await this._dbPromise;
    if (db) {
      await new Promise((res) => {
        const tx = db.transaction('games', 'readwrite');
        tx.objectStore('games').delete(id);
        tx.oncomplete = res;
        tx.onerror = res;
      });
    } else {
      try { localStorage.setItem(LS_FALLBACK_GAMES, JSON.stringify(this.games)); } catch {}
    }
  }

  tally() {
    let w = 0, d = 0, l = 0;
    for (const g of this.games) {
      if (!g.vsComputer) continue;
      if (g.outcome === 1) w++;
      else if (g.outcome === 0) d++;
      else l++;
    }
    return { w, d, l };
  }

  async getCachedText(key) {
    const db = await this._dbPromise;
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async setCachedText(key, value) {
    const db = await this._dbPromise;
    if (!db) return;
    await new Promise((res) => {
      try {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ key, value });
        tx.oncomplete = res;
        tx.onerror = res;
      } catch {
        res();
      }
    });
  }
}

export class PuzzleCatalog {
  constructor(userDb) {
    this.userDb = userDb;
    this.puzzles = [];
    this.byIdMap = new Map();
    this.byIdLowerMap = new Map();
    this.themeIdxMap = new Map(ALL_THEMES.map((t, i) => [t.key, i]));
    this.metaIds = [];
    this.metaIdsLower = [];
    this.metaRatings = [];
    // Thème le plus caractéristique (0..49) de chaque problème selon primaryTheme()
    this.metaPrimaryIdx = [];
    this.metaThemes = [];
    this.fullLoaded = false;
    this._hotPromise = null;
    this._fullPromise = null;
    this._subs = new Set();
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  _notify() {
    for (const fn of this._subs) fn();
  }

  get totalCount() {
    return 50000;
  }

  get loadedCount() {
    return this.puzzles.length;
  }

  loadHot() {
    if (this._hotPromise) return this._hotPromise;
    this._hotPromise = (async () => {
      const resp = await fetch('assets/data/puzzles_hot.tsv');
      const txt = await resp.text();
      this._ingestTsv(txt);
      this._notify();
      // Start loading full 50k in background right after hot set is ready
      this.loadFull();
    })();
    return this._hotPromise;
  }

  loadFull() {
    if (this._fullPromise) return this._fullPromise;
    this._fullPromise = (async () => {
      let txt = await this.userDb.getCachedText('puzzles_rest_v1');
      if (!txt) {
        const resp = await fetch('assets/data/puzzles_rest.tsv');
        txt = await resp.text();
        // Cache asynchronously in IndexedDB for instant offline startup next time
        this.userDb.setCachedText('puzzles_rest_v1', txt).catch(() => {});
      }
      this._ingestTsv(txt);
      this.fullLoaded = true;
      this._notify();
    })();
    return this._fullPromise;
  }

  _ingestTsv(tsv) {
    const lines = tsv.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 5) continue;
      const id = parts[0];
      if (this.byIdMap.has(id)) continue;
      const fen = parts[1];
      const moves = parts[2];
      const rating = Number.parseInt(parts[3], 10);
      const themesRaw = parts[4];
      const themes = ` ${themesRaw.trim()} `;
      const primary = primaryTheme(themesRaw).key;
      const p = { id, fen, moves, rating, themes, primary };
      this.puzzles.push(p);
      this.byIdMap.set(id, p);
      this.byIdLowerMap.set(id.toLowerCase(), p);

      this.metaIds.push(id);
      this.metaIdsLower.push(id.toLowerCase());
      this.metaRatings.push(rating);
      this.metaThemes.push(themes);
      this.metaPrimaryIdx.push(this.themeIdxMap.get(primary) ?? -1);
    }
  }

  byId(id) {
    return this.byIdMap.get(id) || null;
  }

  byIdIgnoreCase(id) {
    return this.byIdMap.get(id) || this.byIdLowerMap.get(id.toLowerCase()) || null;
  }

  byIds(ids) {
    return ids.map((id) => this.byId(id)).filter(Boolean);
  }

  random(band, theme, excludeId) {
    const [lo, hi] = bandRange(band);
    const solved = this.userDb.solvedIds;
    const unsolvedCands = [];
    const anyCands = [];
    for (let i = 0; i < this.puzzles.length; i++) {
      const p = this.puzzles[i];
      if (p.id === excludeId) continue;
      if (p.rating < lo || p.rating > hi) continue;
      if (theme && p.primary !== theme) continue;
      anyCands.push(p);
      if (!solved.has(p.id)) unsolvedCands.push(p);
    }
    const pool = unsolvedCands.length > 0 ? unsolvedCands : anyCands;
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  sampleSlice(n, filterFn = null) {
    if (this.puzzles.length === 0) return [];
    const out = [];
    const len = this.puzzles.length;
    const start = Math.floor(Math.random() * len);
    for (let k = 0; k < len && out.length < n; k++) {
      const p = this.puzzles[(start + k) % len];
      if (!filterFn || filterFn(p)) out.push(p);
    }
    return out;
  }

  search(raw) {
    const q = raw.trim().replace(/^#/, '').toLowerCase();
    if (!q) return { query: '', items: [], more: false };
    const exact = [];
    const prefix = [];
    const inside = [];
    let total = 0;
    for (let i = 0; i < this.metaIdsLower.length; i++) {
      const id = this.metaIdsLower[i];
      const at = id.indexOf(q);
      if (at < 0) continue;
      total++;
      if (id.length === q.length) exact.push(i);
      else if (at === 0) { if (prefix.length < 6) prefix.push(i); }
      else { if (inside.length < 6) inside.push(i); }
    }
    const top = [...exact, ...prefix, ...inside].slice(0, 5);
    return {
      query: raw.trim().replace(/^#/, ''),
      items: top.map((idx) => ({
        id: this.metaIds[idx],
        type: primaryTheme(this.metaThemes[idx]).name,
        rating: this.metaRatings[idx],
      })),
      more: total > top.length,
    };
  }

  countsForBand(band) {
    const [lo, hi] = bandRange(band);
    const solved = this.userDb.solvedIds;
    const n = ALL_THEMES.length;
    const totals = new Int32Array(n + 1);
    const dones = new Int32Array(n + 1);
    for (let i = 0; i < this.metaIds.length; i++) {
      const r = this.metaRatings[i];
      if (r < lo || r > hi) continue;
      const isSolved = solved.has(this.metaIds[i]);
      totals[n]++;
      if (isSolved) dones[n]++;
      const ti = this.metaPrimaryIdx[i];
      if (ti >= 0) {
        totals[ti]++;
        if (isSolved) dones[ti]++;
      }
    }
    const map = new Map();
    ALL_THEMES.forEach((t, i) => map.set(t.key, { total: totals[i], solved: dones[i] }));
    map.set('', { total: totals[n], solved: dones[n] });
    return map;
  }
}
