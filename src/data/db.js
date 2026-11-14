import { PuzzleThemes } from '../core/puzzle-themes.js';

export const PUZZLE_COUNT = 150_000;
const CHUNK_SIZE = 5000;
const NUM_CHUNKS = 30;
const DB_NAME = 'chessduck_v2';
const DB_VERSION = 1;

async function fetchAndGunzip(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const raw = await res.arrayBuffer();
    const u8 = new Uint8Array(raw);
    const isGzip = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
    if (!isGzip) return raw;
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Navigateur incompatible (DecompressionStream requis).');
    }
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
}

async function fetchGzipText(url) {
    const buf = await fetchAndGunzip(url);
    return new TextDecoder('utf-8').decode(buf);
}

function parseTsvChunk(text, chunkIdx) {
    const map = new Map();
    const list = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const p = line.split('\t');
        if (p.length < 6) continue;
        const puzzle = {
            id: p[0],
            fen: p[1],
            moves: p[2],
            rating: parseInt(p[3], 10) || 1200,
            themes: p[4],
            primaryTheme: p[5],
            rowIdx: chunkIdx * CHUNK_SIZE + list.length,
        };
        map.set(puzzle.id, puzzle);
        list.push(puzzle);
    }
    return { map, list };
}

function parseStarterTsv(text) {
    const byId = new Map();
    const byRow = new Map();
    const rows = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const p = line.split('\t');
        if (p.length < 7) continue;
        const rowIdx = parseInt(p[0], 10);
        const puzzle = {
            id: p[1],
            fen: p[2],
            moves: p[3],
            rating: parseInt(p[4], 10) || 1200,
            themes: p[5],
            primaryTheme: p[6],
            rowIdx,
        };
        byId.set(puzzle.id, puzzle);
        byRow.set(rowIdx, puzzle);
        rows.push(puzzle);
    }
    return { byId, byRow, rows };
}

class DuckDatabase {
    constructor() {
        this._idbPromise = null;
        this._metaPromise = null;
        this._meta = null;           // Uint8Array(150_000 * 8)
        this._ids = null;            // string[150_000]
        this._idsLower = null;       // string[150_000]
        this._idToRow = null;        // Map<string, number>
        this._lowerToRow = null;     // Map<string, number>
        this._solvedIds = new Set();
        this._solvedMask = new Uint8Array(PUZZLE_COUNT);
        this._solvedSubs = new Set();

        this._starterPromise = null;
        this._starter = null;        // { byId, byRow, rows }
        this._chunkMem = new Map();  // chunkIdx -> { map, list }
        this._chunkInflight = new Map();
        this._cachedChunks = new Set();

        this._masteredLessons = new Set();
        this._lessonSubs = new Set();
        this._games = [];
        this._gameSubs = new Set();
        this._bgSyncStarted = false;
    }

    _openIdb() {
        if (this._idbPromise) return this._idbPromise;
        if (typeof indexedDB === 'undefined') {
            this._idbPromise = Promise.resolve(null);
            return this._idbPromise;
        }
        this._idbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                    if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
                    if (!db.objectStoreNames.contains('puzzle_progress')) db.createObjectStore('puzzle_progress', { keyPath: 'puzzleId' });
                    if (!db.objectStoreNames.contains('lesson_progress')) db.createObjectStore('lesson_progress', { keyPath: 'lessonId' });
                    if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
        return this._idbPromise;
    }

    async _idbGet(store, key) {
        const db = await this._openIdb();
        if (!db) return undefined;
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
        });
    }

    async _idbPut(store, val, key = undefined) {
        const db = await this._openIdb();
        if (!db) return;
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readwrite');
            if (key !== undefined) tx.objectStore(store).put(val, key);
            else tx.objectStore(store).put(val);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    async _idbGetAll(store) {
        const db = await this._openIdb();
        if (!db) return [];
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    async _idbGetAllKeys(store) {
        const db = await this._openIdb();
        if (!db) return [];
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAllKeys();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    async initUserState() {
        if (this._initUserPromise) return this._initUserPromise;
        this._initUserPromise = (async () => {
            const [pRows, lRows, gRows, chunkKeys] = await Promise.all([
                this._idbGetAll('puzzle_progress'),
                this._idbGetAll('lesson_progress'),
                this._idbGetAll('games'),
                this._idbGetAllKeys('chunks'),
            ]);
            for (const k of chunkKeys) this._cachedChunks.add(k);
            this._solvedIds = new Set(pRows.map((r) => r.puzzleId));
            this._rebuildSolvedMask();
            this._emitSolved();

            this._masteredLessons = new Set(lRows.map((r) => r.lessonId));
            this._emitLessons();

            this._games = gRows.sort((a, b) => (b.date || 0) - (a.date || 0));
            this._emitGames();
        })();
        return this._initUserPromise;
    }

    _rebuildSolvedMask() {
        this._solvedMask.fill(0);
        if (!this._idToRow) return;
        for (const id of this._solvedIds) {
            const row = this._idToRow.get(id);
            if (row !== undefined) this._solvedMask[row] = 1;
        }
    }

    async ensureMeta() {
        if (this._meta) return this._meta;
        if (!this._metaPromise) {
            this._metaPromise = (async () => {
                let buf = await this._idbGet('kv', 'meta_v3');
                if (!(buf instanceof ArrayBuffer) || buf.byteLength !== PUZZLE_COUNT * 8) {
                    buf = await fetchAndGunzip('./assets/puzzles/meta.bin.gz');
                    this._idbPut('kv', buf, 'meta_v3').catch(() => {});
                }
                const meta = new Uint8Array(buf);
                const ids = new Array(PUZZLE_COUNT);
                const idsLower = new Array(PUZZLE_COUNT);
                const idToRow = new Map();
                const lowerToRow = new Map();
                for (let i = 0; i < PUZZLE_COUNT; i++) {
                    const o = i * 8;
                    const id = String.fromCharCode(meta[o], meta[o + 1], meta[o + 2], meta[o + 3], meta[o + 4]);
                    const low = id.toLowerCase();
                    ids[i] = id;
                    idsLower[i] = low;
                    idToRow.set(id, i);
                    if (!lowerToRow.has(low)) lowerToRow.set(low, i);
                }
                this._meta = meta;
                this._ids = ids;
                this._idsLower = idsLower;
                this._idToRow = idToRow;
                this._lowerToRow = lowerToRow;
                this._rebuildSolvedMask();
                this._startBackgroundSync();
                return meta;
            })();
        }
        return this._metaPromise;
    }

    async ensureStarter() {
        if (this._starter) return this._starter;
        if (!this._starterPromise) {
            this._starterPromise = (async () => {
                let tsv = await this._idbGet('kv', 'starter_v1');
                if (typeof tsv !== 'string' || !tsv.length) {
                    tsv = await fetchGzipText('./assets/puzzles/starter.tsv.gz');
                    this._idbPut('kv', tsv, 'starter_v1').catch(() => {});
                }
                this._starter = parseStarterTsv(tsv);
                return this._starter;
            })();
        }
        return this._starterPromise;
    }

    async _getChunk(chunkIdx) {
        const cached = this._chunkMem.get(chunkIdx);
        if (cached) return cached;
        if (this._chunkInflight.has(chunkIdx)) return this._chunkInflight.get(chunkIdx);

        const p = (async () => {
            let text = await this._idbGet('chunks', chunkIdx);
            if (typeof text !== 'string' || !text.length) {
                const padded = String(chunkIdx).padStart(2, '0');
                text = await fetchGzipText(`./assets/puzzles/chunk_${padded}.tsv.gz`);
                this._idbPut('chunks', text, chunkIdx).catch(() => {});
                this._cachedChunks.add(chunkIdx);
            }
            const parsed = parseTsvChunk(text, chunkIdx);
            this._chunkMem.set(chunkIdx, parsed);
            // Éviter de gonfler la RAM sur Safari iOS : garder au maximum 6 chunks décompressés en mémoire.
            if (this._chunkMem.size > 6) {
                const firstKey = this._chunkMem.keys().next().value;
                if (firstKey !== chunkIdx) this._chunkMem.delete(firstKey);
            }
            return parsed;
        })();
        this._chunkInflight.set(chunkIdx, p);
        try {
            return await p;
        } finally {
            this._chunkInflight.delete(chunkIdx);
        }
    }

    async _puzzleAtRow(rowIdx) {
        if (this._starter?.byRow.has(rowIdx)) return this._starter.byRow.get(rowIdx);
        const chunkIdx = Math.floor(rowIdx / CHUNK_SIZE);
        const inChunk = rowIdx % CHUNK_SIZE;
        try {
            const chunk = await this._getChunk(chunkIdx);
            return chunk.list[inChunk] || null;
        } catch {
            return null;
        }
    }

    async _puzzlesAtRows(rowIdxs) {
        if (!rowIdxs.length) return [];
        const starter = await this.ensureStarter().catch(() => null);
        const byChunk = new Map();
        const out = new Array(rowIdxs.length);
        for (let i = 0; i < rowIdxs.length; i++) {
            const r = rowIdxs[i];
            if (starter?.byRow.has(r)) {
                out[i] = starter.byRow.get(r);
            } else {
                const c = Math.floor(r / CHUNK_SIZE);
                if (!byChunk.has(c)) byChunk.set(c, []);
                byChunk.get(c).push({ outIdx: i, inChunk: r % CHUNK_SIZE });
            }
        }
        await Promise.all([...byChunk.entries()].map(async ([c, items]) => {
            try {
                const chunk = await this._getChunk(c);
                for (const { outIdx, inChunk } of items) {
                    out[outIdx] = chunk.list[inChunk] || null;
                }
            } catch { /* offline chunk not yet cached */ }
        }));
        return out.filter(Boolean);
    }

    _startBackgroundSync() {
        if (this._bgSyncStarted) return;
        this._bgSyncStarted = true;
        const run = async () => {
            await new Promise((r) => setTimeout(r, 1500));
            for (let c = 0; c < NUM_CHUNKS; c++) {
                if (this._cachedChunks.has(c)) continue;
                if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                    await new Promise((r) => setTimeout(r, 5000));
                    c--;
                    continue;
                }
                try {
                    const existing = await this._idbGet('chunks', c);
                    if (typeof existing === 'string' && existing.length) {
                        this._cachedChunks.add(c);
                    } else {
                        const padded = String(c).padStart(2, '0');
                        const text = await fetchGzipText(`./assets/puzzles/chunk_${padded}.tsv.gz`);
                        await this._idbPut('chunks', text, c);
                        this._cachedChunks.add(c);
                    }
                } catch { /* retry lazily next session */ }
                await new Promise((r) => setTimeout(r, 120));
            }
        };
        run();
    }

    // ---- PuzzleRepository API ----

    async byId(id) {
        if (!id) return null;
        await Promise.all([this.ensureMeta(), this.ensureStarter().catch(() => null)]);
        if (this._starter?.byId.has(id)) return this._starter.byId.get(id);
        const row = this._idToRow?.get(id);
        if (row === undefined) return null;
        return this._puzzleAtRow(row);
    }

    async byIds(ids) {
        if (!ids || !ids.length) return [];
        await Promise.all([this.ensureMeta(), this.ensureStarter().catch(() => null)]);
        const rows = [];
        for (const id of ids) {
            const row = this._idToRow?.get(id);
            if (row !== undefined) rows.push(row);
        }
        return this._puzzlesAtRows(rows);
    }

    async byIdIgnoreCase(id) {
        if (!id) return null;
        await this.ensureMeta();
        const row = this._lowerToRow?.get(id.toLowerCase());
        if (row === undefined) return null;
        return this._puzzleAtRow(row);
    }

    async randomId(themesList, [lo, hi], excludeId) {
        await this.ensureMeta();
        const meta = this._meta;
        const ids = this._ids;
        const solved = this._solvedMask;
        let allowedMask = null;
        if (themesList && themesList.length) {
            allowedMask = new Uint8Array(PuzzleThemes.all.length);
            for (const k of themesList) {
                const idx = PuzzleThemes.all.findIndex((t) => t.key === k);
                if (idx >= 0) allowedMask[idx] = 1;
            }
        }
        const exRow = excludeId ? this._idToRow.get(excludeId) : -1;

        const offlinePartial = typeof navigator !== 'undefined' && navigator.onLine === false && this._cachedChunks.size < NUM_CHUNKS;
        const starterByRow = offlinePartial ? (await this.ensureStarter().catch(() => null))?.byRow : null;

        for (const includeSolved of [false, true]) {
            let count = 0;
            let chosen = -1;
            for (let i = 0; i < PUZZLE_COUNT; i++) {
                if (i === exRow) continue;
                if (!includeSolved && solved[i]) continue;
                if (offlinePartial && !this._cachedChunks.has((i / CHUNK_SIZE) | 0) && !starterByRow?.has(i)) continue;
                const o = i * 8;
                const rating = meta[o + 5] | (meta[o + 6] << 8);
                if (rating < lo || rating > hi) continue;
                if (allowedMask && !allowedMask[meta[o + 7] & 127]) continue;
                count++;
                if (Math.random() * count < 1) chosen = i;
            }
            if (chosen >= 0) return ids[chosen];
        }
        return null;
    }

    async themeCounts([lo, hi]) {
        await this.ensureMeta();
        const meta = this._meta;
        const solved = this._solvedMask;
        const nThemes = PuzzleThemes.all.length;
        const totals = new Int32Array(nThemes);
        const solvedCounts = new Int32Array(nThemes);
        for (let i = 0; i < PUZZLE_COUNT; i++) {
            const o = i * 8;
            const rating = meta[o + 5] | (meta[o + 6] << 8);
            if (rating < lo || rating > hi) continue;
            const tIdx = meta[o + 7] & 127;
            totals[tIdx]++;
            if (solved[i]) solvedCounts[tIdx]++;
        }
        return PuzzleThemes.all.map((t, idx) => ({
            theme: t.key,
            total: totals[idx],
            solved: solvedCounts[idx],
        })).filter((r) => r.total > 0);
    }

    async searchIds(query, limit = 5) {
        await this.ensureMeta();
        const q = query.trim().toLowerCase();
        if (!q) return { items: [], total: 0 };
        const meta = this._meta;
        const ids = this._ids;
        const idsLower = this._idsLower;
        const tier0 = [];
        const tier1 = [];
        const tier2 = [];
        let total = 0;

        for (let i = 0; i < PUZZLE_COUNT; i++) {
            const low = idsLower[i];
            if (!low.includes(q)) continue;
            total++;
            if (low === q) {
                if (tier0.length < limit) tier0.push(i);
            } else if (low.startsWith(q)) {
                if (tier0.length + tier1.length < limit) tier1.push(i);
            } else if (tier0.length + tier1.length + tier2.length < limit) {
                tier2.push(i);
            }
        }
        const picked = [...tier0, ...tier1, ...tier2].slice(0, limit);
        const items = picked.map((i) => {
            const o = i * 8;
            const rating = meta[o + 5] | (meta[o + 6] << 8);
            const tIdx = meta[o + 7] & 127;
            return { id: ids[i], rating, primaryTheme: PuzzleThemes.all[tIdx]?.key || 'middlegame' };
        });
        return { items, total };
    }

    async _collectMatchingRows(startRow, n, predicate) {
        await this.ensureMeta();
        const meta = this._meta;
        const rows = [];
        for (let i = Math.max(0, startRow); i < PUZZLE_COUNT && rows.length < n; i++) {
            const o = i * 8;
            if (predicate(meta[o + 7], meta[o + 5] | (meta[o + 6] << 8))) rows.push(i);
        }
        return this._puzzlesAtRows(rows);
    }

    async slice(start, n) {
        const res = await this._collectMatchingRows(start - 1, n, () => true);
        if (res.length) return res;
        const s = await this.ensureStarter();
        return s.rows.slice(0, n);
    }

    async sliceThemes(start, themes, n) {
        const allowed = new Uint8Array(PuzzleThemes.all.length);
        for (const k of themes) {
            const idx = PuzzleThemes.all.findIndex((t) => t.key === k);
            if (idx >= 0) allowed[idx] = 1;
        }
        const res = await this._collectMatchingRows(start - 1, n, (flags) => allowed[flags & 127] === 1);
        if (res.length) return res;
        const set = new Set(themes);
        const s = await this.ensureStarter();
        return s.rows.filter((r) => set.has(r.primaryTheme)).slice(0, n);
    }

    async sliceCastling(start, n) {
        const res = await this._collectMatchingRows(start - 1, n, (flags) => (flags & 128) !== 0);
        if (res.length) return res;
        const s = await this.ensureStarter();
        return s.rows.filter((r) => {
            const cast = r.fen.split(' ')[2];
            return cast && cast !== '-';
        }).slice(0, n);
    }

    async markSolved(id, at = Date.now()) {
        if (!id) return;
        this._solvedIds.add(id);
        const row = this._idToRow?.get(id);
        if (row !== undefined) this._solvedMask[row] = 1;
        this._emitSolved();
        await this._idbPut('puzzle_progress', { puzzleId: id, solvedAt: at });
    }

    subscribeSolvedIds(fn) {
        this._solvedSubs.add(fn);
        fn(this._solvedIds);
        return () => this._solvedSubs.delete(fn);
    }

    _emitSolved() {
        for (const fn of this._solvedSubs) fn(this._solvedIds);
    }

    // ---- LessonProgressRepository API ----

    async markLesson(lessonId, at = Date.now()) {
        this._masteredLessons.add(lessonId);
        this._emitLessons();
        await this._idbPut('lesson_progress', { lessonId, masteredAt: at });
    }

    subscribeMasteredLessons(fn) {
        this._lessonSubs.add(fn);
        fn(this._masteredLessons);
        return () => this._lessonSubs.delete(fn);
    }

    _emitLessons() {
        for (const fn of this._lessonSubs) fn(this._masteredLessons);
    }

    // ---- GameRepository API ----

    async insertGame(record) {
        const entry = { ...record };
        delete entry.id;
        const db = await this._openIdb();
        let id = Date.now();
        if (db) {
            id = await new Promise((resolve) => {
                const tx = db.transaction('games', 'readwrite');
                const req = tx.objectStore('games').add(entry);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(Date.now());
            });
        }
        entry.id = id;
        this._games = [entry, ...this._games].sort((a, b) => (b.date || 0) - (a.date || 0));
        this._emitGames();
        return id;
    }

    async saveAnalysis(id, analysis) {
        const idx = this._games.findIndex((g) => g.id === id);
        if (idx >= 0) {
            this._games = this._games.slice();
            this._games[idx] = { ...this._games[idx], analysis };
            this._emitGames();
            await this._idbPut('games', this._games[idx]);
        }
    }

    async deleteGame(id) {
        this._games = this._games.filter((g) => g.id !== id);
        this._emitGames();
        const db = await this._openIdb();
        if (db) {
            await new Promise((resolve) => {
                const tx = db.transaction('games', 'readwrite');
                tx.objectStore('games').delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        }
    }

    subscribeGames(fn) {
        this._gameSubs.add(fn);
        fn(this._games);
        return () => this._gameSubs.delete(fn);
    }

    _emitGames() {
        for (const fn of this._gameSubs) fn(this._games);
    }

    get games() {
        return this._games;
    }

    getTally() {
        const res = { wins: 0, draws: 0, losses: 0 };
        for (const g of this._games) {
            if (!g.vsComputer) continue;
            if (g.outcome === 1) res.wins++;
            else if (g.outcome === 0) res.draws++;
            else if (g.outcome === -1) res.losses++;
        }
        return res;
    }
}

export const db = new DuckDatabase();
