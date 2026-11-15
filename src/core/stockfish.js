import { Move } from './chess.js';

export const MATE = 100_000;
export function isMateScore(s) { return Math.abs(s) > MATE - 1000; }
export function mateIn(s) { return s > 0 ? Math.trunc((MATE - s + 1) / 2) : -Math.trunc((MATE + s + 1) / 2); }

/** Nombre de coups avant mat forcé en faveur de `white` (evalWhite du point de vue des Blancs), ou null. */
export function mateFor(evalWhite, white) {
    return isMateScore(evalWhite) && (evalWhite > 0) === Boolean(white)
        ? Math.abs(mateIn(evalWhite))
        : null;
}

/** Probabilité de gain (0–100) estimée à partir d'une évaluation en centipions (formule Lichess). */
export function winPercent(cp) {
    if (isMateScore(cp)) return cp > 0 ? 100.0 : 0.0;
    return 50.0 + 50.0 * (2.0 / (1.0 + Math.exp(-0.00368208 * cp)) - 1.0);
}

function parseInfo(l) {
    const t = l.split(' ');
    if (l.includes(' upperbound') || l.includes(' lowerbound')) return null;
    let idx = 1;
    let score = null;
    let move = null;
    for (let i = 0; i < t.length; i++) {
        const tok = t[i];
        if (tok === 'multipv') {
            const n = parseInt(t[i + 1], 10);
            if (!Number.isNaN(n)) idx = n;
        } else if (tok === 'score') {
            const kind = t[i + 1];
            const v = parseInt(t[i + 2], 10) || 0;
            score = kind === 'mate' ? (v > 0 ? MATE - (2 * v - 1) : -MATE - 2 * v) : v;
        } else if (tok === 'pv') {
            const mv = t[i + 1];
            if (mv && Move.isUci(mv)) move = Move.fromUci(mv);
            break;
        }
    }
    return score !== null && move !== null ? { idx, pv: { move, score } } : null;
}

/**
 * Wrapper Web Worker pour Stockfish 19 Lite WASM (100 % hors-ligne).
 * Sérialise les recherches via une file FIFO et gère l'annulation propre via stop + isready/readyok.
 */
export class StockfishEngine {
    constructor(workerUrl = null) {
        this._workerUrl = workerUrl || new URL('../../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url).href;
        this._worker = null;
        this._listeners = new Set();
        this._sentLimit = null;
        this._sentElo = null;
        this._sentMultiPv = null;
        this._queue = Promise.resolve();
        this._closed = false;
    }

    _spawn() {
        this._shutdown();
        const w = new Worker(this._workerUrl);
        w.onmessage = (e) => {
            const line = typeof e.data === 'string' ? e.data : String(e.data ?? '');
            for (const fn of [...this._listeners]) fn(line);
        };
        w.onerror = () => {
            for (const fn of [...this._listeners]) fn('__ERROR__');
        };
        this._worker = w;
        this._sentLimit = null;
        this._sentElo = null;
        this._sentMultiPv = null;
    }

    _shutdown() {
        if (this._worker) {
            try { this._worker.terminate(); } catch { /* ignore */ }
            this._worker = null;
        }
        this._sentLimit = null;
        this._sentElo = null;
        this._sentMultiPv = null;
    }

    _send(cmd) {
        this._worker?.postMessage(cmd);
    }

    _waitFor(token, timeoutMs = 5000) {
        return new Promise((resolve) => {
            if (!this._worker) { resolve(false); return; }
            let timer = null;
            const onLine = (line) => {
                if (line === '__ERROR__') {
                    cleanup();
                    resolve(false);
                } else if (line.startsWith(token)) {
                    cleanup();
                    resolve(true);
                }
            };
            const cleanup = () => {
                if (timer !== null) clearTimeout(timer);
                this._listeners.delete(onLine);
            };
            this._listeners.add(onLine);
            timer = setTimeout(() => {
                cleanup();
                resolve(false);
            }, timeoutMs);
        });
    }

    async _ensureStarted() {
        if (this._worker) return true;
        this._spawn();
        this._send('uci');
        if (!(await this._waitFor('uciok', 8000))) { this._shutdown(); return false; }
        this._send('setoption name Hash value 16');
        this._send('isready');
        if (!(await this._waitFor('readyok', 5000))) { this._shutdown(); return false; }
        return true;
    }

    _setOptions(elo, multiPv) {
        const limit = elo !== null && elo !== undefined;
        if (this._sentLimit !== limit) {
            this._send(`setoption name UCI_LimitStrength value ${limit}`);
            this._sentLimit = limit;
        }
        if (limit) {
            const e = Math.max(1350, Math.min(2850, elo));
            if (this._sentElo !== e) {
                this._send(`setoption name UCI_Elo value ${e}`);
                this._sentElo = e;
            }
        }
        if (this._sentMultiPv !== multiPv) {
            this._send(`setoption name MultiPV value ${multiPv}`);
            this._sentMultiPv = multiPv;
        }
    }

    search(fen, movetimeMs, { multiPv = 1, elo = null, depth = null, signal = null } = {}) {
        if (this._closed || signal?.aborted) {
            return Promise.resolve({ best: null, score: null, lines: [], aborted: Boolean(signal?.aborted) });
        }
        const run = async () => {
            if (this._closed || signal?.aborted) {
                return { best: null, score: null, lines: [], aborted: Boolean(signal?.aborted) };
            }
            try {
                const ok = await this._ensureStarted();
                if (!ok || signal?.aborted) {
                    return { best: null, score: null, lines: [], aborted: Boolean(signal?.aborted) };
                }
                this._setOptions(elo, multiPv);
                this._send(`position fen ${fen}`);
                this._send(depth != null ? `go depth ${depth} movetime ${movetimeMs}` : `go movetime ${movetimeMs}`);

                const pvs = new Map();
                let best = null;
                let done = false;

                await new Promise((resolve) => {
                    let safetyTimer = null;
                    const finish = () => {
                        if (safetyTimer !== null) clearTimeout(safetyTimer);
                        this._listeners.delete(onLine);
                        if (signal) signal.removeEventListener('abort', onAbort);
                        resolve();
                    };
                    const onAbort = () => finish();
                    const onLine = (l) => {
                        if (l === '__ERROR__') {
                            this._shutdown();
                            finish();
                        } else if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
                            const parsed = parseInfo(l);
                            if (parsed) pvs.set(parsed.idx, parsed.pv);
                        } else if (l.startsWith('bestmove')) {
                            const tok = l.split(' ')[1];
                            best = tok && Move.isUci(tok) ? Move.fromUci(tok) : null;
                            done = true;
                            finish();
                        }
                    };
                    this._listeners.add(onLine);
                    if (signal) signal.addEventListener('abort', onAbort, { once: true });
                    safetyTimer = setTimeout(() => finish(), Math.max(5000, movetimeMs + 4500));
                });

                if (!done) {
                    this._send('stop');
                    const stopped = await this._waitFor('bestmove', 1500);
                    this._send('isready');
                    const ready = stopped && await this._waitFor('readyok', 1000);
                    if (!ready) this._shutdown();
                    return { best: null, score: null, lines: [], aborted: true };
                }

                const sorted = [...pvs.entries()].sort((a, b) => a[0] - b[0]).map(([, pv]) => pv);
                return { best, score: sorted[0]?.score ?? null, lines: sorted, aborted: false };
            } catch {
                this._shutdown();
                return { best: null, score: null, lines: [], aborted: false };
            }
        };

        const p = this._queue.then(run, run);
        this._queue = p.catch(() => {});
        return p;
    }

    close() {
        this._closed = true;
        this._shutdown();
    }
}
