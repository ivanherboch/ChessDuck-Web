import { GameEnd } from '../core/chess.js';
import { Analysis } from './game-logic.js';

const MAX_CACHED = 20;

/**
 * Analyse des positions et des parties terminées, partagée par le Jeu Libre (indices, analyse lancée à la fin
 * d'une partie) et la revue. Les analyses en cours ou terminées sont publiées par partie :
 * la revue s'ouvre sans rien recalculer, et l'analyse d'une partie continue même si la revue est fermée.
 */
export class GameAnalysisService {
    constructor(engine, gamesRepo) {
        this.engine = engine;
        this.gamesRepo = gamesRepo;
        this._analyses = new Map(); // gameId -> (Analysis | null)[]
        this._subs = new Set();
        this._activeGameId = -1;
        this._running = false;
        this._abort = null;
        this._token = 0;
    }

    subscribe(fn) {
        this._subs.add(fn);
        fn(this._analyses);
        return () => this._subs.delete(fn);
    }

    _emit() {
        for (const fn of this._subs) fn(this._analyses);
    }

    /** Évaluation d'une position (point de vue des Blancs) et meilleur coup ; null si le moteur ne répond pas. */
    async analyse(pos, ms, signal = null) {
        if (pos.legalMoves.length === 0) {
            return Analysis.decided(pos, pos.inCheck ? GameEnd.CHECKMATE : GameEnd.STALEMATE);
        }
        const r = await this.engine.search(pos.toFen(), ms, { multiPv: 2, signal });
        if (!r || !r.lines || !r.lines.length) return null;
        const first = r.lines[0];
        const sign = pos.whiteToMove ? 1 : -1;
        const second = r.lines[1] ? sign * r.lines[1].score : null;
        return new Analysis(sign * first.score, second, first.move.uci);
    }

    /** Analyses connues d'une partie (cache), sinon celles enregistrées avec la partie. */
    analysisOf(g, line) {
        return this._analyses.get(g.id) ?? Analysis.decodeAll(g.analysis || '', line.size + 1);
    }

    /**
     * Analyse une partie en tâche de fond (une position après l'autre, recherche courte) et enregistre le résultat.
     * Lancée dès la fin de la partie : quand on ouvre la revue, l'essentiel est déjà prêt.
     */
    start(g, line) {
        if (this._activeGameId === g.id && this._running) return;
        this._abort?.abort();
        const token = ++this._token;
        const ac = new AbortController();
        this._abort = ac;
        this._activeGameId = g.id;
        this._running = true;

        const list = this.analysisOf(g, line).slice();
        if (!this._analyses.has(g.id) && this._analyses.size >= MAX_CACHED) {
            const firstKey = this._analyses.keys().next().value;
            if (firstKey !== undefined) this._analyses.delete(firstKey);
        }
        this._analyses.set(g.id, list.slice());
        this._emit();

        (async () => {
            let changed = false;
            try {
                for (let i = 0; i <= line.size; i++) {
                    if (ac.signal.aborted || token !== this._token) break;
                    const existing = list[i];
                    if (existing && (existing.second !== null || !existing.best)) continue;
                    const a = await this.analyse(line.positions[i], 110, ac.signal);
                    if (ac.signal.aborted || token !== this._token) break;
                    if (!a) continue;
                    list[i] = a;
                    changed = true;
                    this._analyses.set(g.id, list.slice());
                    this._emit();
                }
            } finally {
                if (token === this._token) {
                    this._running = false;
                }
                // Même interrompue, l'analyse déjà faite est conservée.
                if (changed) {
                    await this.gamesRepo.saveAnalysis(g.id, Analysis.encodeAll(list)).catch(() => {});
                }
            }
        })();
    }
}
