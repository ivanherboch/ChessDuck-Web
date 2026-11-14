import {
    GameEnd, KING, Move, PAWN, PIECE_VALUES, pieceType,
} from '../core/chess.js';
import { isMateScore, mateIn, winPercent } from '../core/stockfish.js';

/** Analyse d'une position : évaluations (point de vue des Blancs) du meilleur et du 2e coup. */
export class Analysis {
    constructor(evalScore, second = null, best = '') {
        this.eval = evalScore;
        this.second = second;
        this.best = best;
    }

    encode() {
        return `${this.eval},${this.second !== null && this.second !== undefined ? this.second : ''},${this.best || ''}`;
    }

    equals(other) {
        return other != null
            && this.eval === other.eval
            && this.second === other.second
            && this.best === other.best;
    }

    static decodeAll(s, n) {
        const parts = s ? s.split(';') : [];
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
            const raw = parts[i];
            if (!raw) {
                out[i] = null;
                continue;
            }
            const t = raw.split(',');
            const e = t[0] !== undefined && t[0] !== '' ? parseInt(t[0], 10) : NaN;
            if (Number.isNaN(e)) {
                out[i] = null;
                continue;
            }
            const secRaw = t[1] !== undefined && t[1] !== '' ? parseInt(t[1], 10) : NaN;
            const sec = Number.isNaN(secRaw) ? null : secRaw;
            out[i] = new Analysis(e, sec, t[2] || '');
        }
        return out;
    }

    static encodeAll(list) {
        return list.map((it) => (it ? it.encode() : '')).join(';');
    }
}

function isSacrifice(before, m) {
    const moved = pieceType(before.board[m.from]);
    if (moved === PAWN || moved === KING) return false;
    const gain = PIECE_VALUES[pieceType(before.board[m.to])];
    if (gain >= PIECE_VALUES[moved]) return false;
    const after = before.play(m);
    const attackers = after.attackers(m.to, after.whiteToMove);
    if (!attackers.length) return false;
    let cheapest = Infinity;
    for (const sq of attackers) {
        const v = PIECE_VALUES[pieceType(after.board[sq])];
        if (v < cheapest) cheapest = v;
    }
    const defended = after.attackers(m.to, !after.whiteToMove).length > 0;
    return cheapest < PIECE_VALUES[moved] || !defended;
}

export const GameLogic = {
    /** Nouvel ELO selon la formule FIDE (K = 32). score : 1 victoire, 0,5 nulle, 0 défaite. */
    newElo(elo, opponent, score, k = 32) {
        const expected = 1.0 / (1.0 + Math.pow(10.0, (opponent - elo) / 400.0));
        return Math.round(elo + k * (score - expected));
    },

    /**
     * Annotation parcimonieuse d'un coup (!!, !, ?!, ?, ??) ou null pour un coup normal.
     * Calcul instantané à partir des analyses des positions avant (a0) et après (a1) le coup.
     */
    annotate(before, move, a0, a1, prev) {
        if (!a0 || !a1) return null;
        const sign = before.whiteToMove ? 1 : -1;
        const best = winPercent(sign * a0.eval);
        const after = winPercent(sign * a1.eval);
        const loss = best - after;
        if (loss >= 25) return '??';
        if (loss >= 15) return '?';
        if (loss >= 9) return '?!';
        if (move.uci === a0.best && a0.second !== null && a0.second !== undefined) {
            const second = winPercent(sign * a0.second);
            const recapture = prev != null && prev.to === move.to && before.isCapture(move);
            if (best - second >= 18 && best >= 35 && second <= 80 && !recapture) {
                return isSacrifice(before, move) ? '!!' : '!';
            }
        }
        return null;
    },

    /**
     * Mat manqué : renvoie 1 ou 2 si le camp au trait disposait d'un mat en 1 ou 2 coups (a0)
     * et que le coup joué ne le conserve pas (a1 = analyse de la position obtenue), sinon null.
     */
    missedMate(whiteToMove, a0, a1) {
        if (!a0 || !a1) return null;
        const sign = whiteToMove ? 1 : -1;
        const before = sign * a0.eval;
        if (!isMateScore(before) || before <= 0) return null;
        const k = mateIn(before);
        if (k < 1 || k > 2) return null;
        const after = sign * a1.eval;
        const kept = isMateScore(after) && after > 0 && mateIn(after) <= k - 1;
        return kept ? null : k;
    },

    endText(end) {
        switch (end) {
            case GameEnd.CHECKMATE: return 'échec et mat';
            case GameEnd.STALEMATE: return 'pat';
            case GameEnd.INSUFFICIENT: return 'matériel insuffisant';
            case GameEnd.FIFTY_MOVES: return 'règle des 50 coups';
            case GameEnd.REPETITION: return 'triple répétition';
            default: return '';
        }
    },
};
