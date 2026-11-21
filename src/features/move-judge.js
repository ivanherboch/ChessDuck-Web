import { MATE, isMateScore, winPercent } from '../core/stockfish.js';

export const Verdict = Object.freeze({
    EXACT: 'EXACT',
    EQUIVALENT: 'EQUIVALENT',
    SLOWER: 'SLOWER',
    WORSE: 'WORSE',
    UNAVAILABLE: 'UNAVAILABLE',
});

export const MAX_LOSS = 6.0;

/**
 * Arbitre d'un coup alternatif proposé par l'élève (mode Guidé ou « Devinez le coup »).
 */
export class MoveJudge {
    constructor(engine, movetimeMs = 250) {
        this.engine = engine;
        this.movetimeMs = movetimeMs;
    }

    async judge(position, played, expected, endgame = false) {
        if (played.equals(expected)) return Verdict.EXACT;
        if (!position.isLegal(played)) return Verdict.WORSE;
        if (position.play(played).isCheckmate) return Verdict.EQUIVALENT;
        const pair = await this._scores(position, played, expected);
        if (!pair) return Verdict.UNAVAILABLE;
        return MoveJudge.compare(pair[0], pair[1], endgame);
    }

    /**
     * Perte (en points de pourcentage de gain, 0 si le coup est au moins aussi bon) du coup [played]
     * par rapport à [expected] ; null si l'Ordinateur ne répond pas.
     */
    async loss(position, played, expected) {
        if (played.equals(expected) || position.play(played).isCheckmate) return 0;
        const pair = await this._scores(position, played, expected);
        if (!pair) return null;
        return Math.max(0, winPercent(pair[1]) - winPercent(pair[0]));
    }

    async _scores(position, played, expected) {
        const timeoutMs = this.movetimeMs * 4 + 500;
        let lines = [];
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
            try {
                const res = await this.engine.search(position.toFen(), this.movetimeMs, { multiPv: 4, signal: ctrl?.signal });
                if (res && !res.aborted && Array.isArray(res.lines)) lines = res.lines;
            } finally {
                if (timer) clearTimeout(timer);
            }
        } catch {
            lines = [];
        }
        const byUci = new Map();
        for (const l of lines) {
            if (l?.move) byUci.set(typeof l.move === 'string' ? l.move : l.move.uci, l.score);
        }
        const pUci = played.uci;
        const eUci = expected.uci;
        const both = byUci.has(pUci) && byUci.has(eUci);
        const mine = both ? byUci.get(pUci) : await this._score(position.play(played));
        if (mine == null) return null;
        const target = both ? byUci.get(eUci) : await this._score(position.play(expected));
        if (target == null) return null;
        return [mine, target];
    }

    async _score(after) {
        if (after.isCheckmate) return MATE;
        if (after.legalMoves.length === 0) return 0;
        const timeoutMs = this.movetimeMs * 4 + 500;
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
            try {
                const res = await this.engine.search(after.toFen(), this.movetimeMs, { signal: ctrl?.signal });
                if (!res || res.aborted || res.score == null) return null;
                return -res.score;
            } finally {
                if (timer) clearTimeout(timer);
            }
        } catch {
            return null;
        }
    }

    /** Règle de comparaison, isolée pour les tests : [mine] et [target] du point de vue du joueur. */
    static compare(mine, target, endgame = false) {
        if (isMateScore(target) && target > 0) {
            if (isMateScore(mine) && mine > 0 && mine >= target) return Verdict.EQUIVALENT;
            if (isMateScore(mine) && mine > 0) return Verdict.SLOWER;
            return Verdict.WORSE;
        }
        const wMine = winPercent(mine);
        const wTarget = winPercent(target);
        let ok = false;
        if (!endgame) ok = wTarget - wMine <= MAX_LOSS;
        else if (wTarget >= 95.0) ok = wMine >= 90.0;
        else ok = wTarget - wMine <= 12.0;
        return ok ? Verdict.EQUIVALENT : Verdict.WORSE;
    }

    static acceptable(mine, target, endgame = false) {
        return MoveJudge.compare(mine, target, endgame) === Verdict.EQUIVALENT;
    }
}
