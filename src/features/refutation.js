import { PAWN, PIECE_NAMES_FR, pieceType } from '../core/chess.js';
import { isMateScore, mateIn } from '../core/stockfish.js';

export const REFUTE_HOLD = 4000;
export const AUTO_UNDO = ' Le coup sera annulé automatiquement.';

/**
 * Calcul commun de la réfutation (Problèmes, Académie).
 */
export const RefutationLogic = {
    AUTO_UNDO,

    async reply(engine, pos, m, { minShow = 650, signal = null } = {}) {
        const t0 = Date.now();
        const san = pos.san(m);
        const after = pos.play(m);
        const opp = pos.whiteToMove ? 'Noirs' : 'Blancs';
        if (after.legalMoves.length === 0) {
            const text = after.inCheck
                ? `${san} donne échec et mat : ce n'est pourtant pas la ligne attendue.`
                : `${san} met l'adversaire pat : la partie serait nulle alors que vous aviez bien mieux !`;
            return { reply: null, position: after, text };
        }
        let res = null;
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const onAbort = () => ctrl?.abort();
            if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener('abort', onAbort, { once: true });
            }
            const timer = ctrl ? setTimeout(() => ctrl.abort(), 1800) : null;
            try {
                res = await engine.search(after.toFen(), 380, { signal: ctrl?.signal });
            } finally {
                if (timer) clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
            }
        } catch {
            res = null;
        }
        if (signal?.aborted) return null;
        const left = Math.max(0, minShow - (Date.now() - t0));
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        if (signal?.aborted) return null;

        const replyMove = (res?.best && after.isLegal(res.best))
            ? res.best
            : (after.legalMoves.find((x) => x.to === m.to) || after.legalMoves[0]);
        const after2 = after.play(replyMove);
        const score = res?.score;
        const captured = after.board[replyMove.to];
        let detail = ' et se défendent : il existait un coup bien plus fort.';
        if (after2.isCheckmate) detail = ' : échec et mat !';
        else if (score != null && isMateScore(score) && score > 0) detail = ` et forcent le mat en ${mateIn(score)}.`;
        else if (captured !== 0 && pieceType(captured) !== PAWN) detail = ` et capturent votre ${(PIECE_NAMES_FR[pieceType(captured)] || '').toLowerCase()}.`;
        else if (captured !== 0) detail = ' et gagnent un pion.';
        else if (score != null && score > 150) detail = " et prennent l'avantage.";
        else if (score != null && score > -80) detail = " et égalisent : votre avantage s'est envolé.";

        return {
            reply: replyMove,
            position: after2,
            text: `Réfutation : après ${san}, les ${opp} répondent ${after.san(replyMove)}${detail}`,
        };
    },
};
