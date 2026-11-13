// Moteur Stockfish WASM (single-threaded, compatible Safari iOS & GitHub Pages sans COOP/COEP)

import { Move } from './chess.js';
import { MATE } from './review-comments.js';

export class StockfishEngine {
  constructor(workerUrl = 'assets/engine/stockfish-19-lite-single.js') {
    this.workerUrl = workerUrl;
    this.worker = null;
    this.readyPromise = null;
    this.listeners = new Set();
    this._tail = Promise.resolve();
    this._searching = false;
  }

  _ensureWorker() {
    if (this.worker && this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      try {
        const w = new Worker(this.workerUrl);
        this.worker = w;
        let stage = 'uci';
        const timer = setTimeout(() => {
          reject(new Error('Stockfish init timeout'));
        }, 15000);
        const onMsg = (ev) => {
          const line = String(ev.data || '');
          for (const fn of this.listeners) fn(line);
          if (stage === 'uci' && line === 'uciok') {
            stage = 'ready';
            w.postMessage('setoption name Hash value 32');
            w.postMessage('isready');
          } else if (stage === 'ready' && line === 'readyok') {
            clearTimeout(timer);
            resolve();
          }
        };
        w.onmessage = onMsg;
        w.onerror = (err) => {
          clearTimeout(timer);
          this.worker = null;
          this.readyPromise = null;
          reject(err);
        };
        w.postMessage('uci');
      } catch (e) {
        this.worker = null;
        this.readyPromise = null;
        reject(e);
      }
    });
    return this.readyPromise;
  }

  warmup() {
    this._ensureWorker().catch(() => {});
  }

  /**
   * Lance une recherche sérialisée et annulable via AbortSignal.
   * elo: null = force maximale ; nombre = UCI_LimitStrength (1350..2850).
   */
  search(fen, movetimeMs, { multiPv = 1, elo = null, depth = null, signal = null } = {}) {
    if (signal?.aborted) return Promise.resolve({ best: null, lines: [], score: null });

    const run = this._tail.then(() => this._runSearch(fen, movetimeMs, { multiPv, elo, depth, signal }));
    this._tail = run.catch(() => {});
    return run;
  }

  async _runSearch(fen, movetimeMs, { multiPv, elo, depth, signal }) {
    if (signal?.aborted) return { best: null, lines: [], score: null };
    try {
      await this._ensureWorker();
    } catch {
      return { best: null, lines: [], score: null };
    }
    if (signal?.aborted) return { best: null, lines: [], score: null };

    const w = this.worker;
    if (!w) return { best: null, lines: [], score: null };

    return new Promise((resolve) => {
      const pvs = new Map();
      let best = null;
      let finished = false;
      let stopped = false;

      const cleanup = () => {
        this.listeners.delete(onLine);
        if (signal) signal.removeEventListener('abort', onAbort);
        clearTimeout(hardTimeout);
        this._searching = false;
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        const lines = [...pvs.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => v);
        resolve({
          best,
          lines,
          score: lines[0]?.score ?? null,
        });
      };

      const onAbort = () => {
        if (finished || stopped) return;
        stopped = true;
        try { w.postMessage('stop'); } catch {}
        setTimeout(() => {
          if (!finished) {
            best = null;
            pvs.clear();
            finish();
          }
        }, 1200);
      };

      const onLine = (l) => {
        if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
          const parsed = parseInfo(l);
          if (parsed) pvs.set(parsed.idx, parsed.pv);
        } else if (l.startsWith('bestmove')) {
          if (!stopped) {
            const tok = l.split(' ')[1];
            if (tok && tok !== '(none)') {
              try { best = Move.fromUci(tok); } catch { best = null; }
            }
          } else {
            best = null;
            pvs.clear();
          }
          finish();
        }
      };

      const hardTimeout = setTimeout(() => {
        if (!finished) {
          try { w.postMessage('stop'); } catch {}
          setTimeout(finish, 400);
        }
      }, Math.max(2500, movetimeMs + 3000));

      this._searching = true;
      this.listeners.add(onLine);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      w.postMessage(`setoption name UCI_LimitStrength value ${elo != null}`);
      if (elo != null) {
        const clamped = Math.max(1350, Math.min(2850, Math.round(elo)));
        w.postMessage(`setoption name UCI_Elo value ${clamped}`);
      }
      w.postMessage(`setoption name MultiPV value ${multiPv}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(depth != null ? `go depth ${depth} movetime ${movetimeMs}` : `go movetime ${movetimeMs}`);
    });
  }
}

function parseInfo(l) {
  if (l.includes(' upperbound') || l.includes(' lowerbound')) return null;
  const t = l.split(' ');
  let idx = 1;
  let score = null;
  let move = null;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'multipv') {
      idx = Number.parseInt(t[i + 1], 10) || 1;
    } else if (t[i] === 'score') {
      const kind = t[i + 1];
      const v = Number.parseInt(t[i + 2], 10) || 0;
      if (kind === 'mate') {
        score = v > 0 ? MATE - (2 * v - 1) : -MATE - 2 * v;
      } else {
        score = v;
      }
    } else if (t[i] === 'pv') {
      const uci = t[i + 1];
      if (uci) {
        try { move = Move.fromUci(uci); } catch { move = null; }
      }
      break;
    }
  }
  return score != null && move != null ? { idx, pv: { move, score } } : null;
}
