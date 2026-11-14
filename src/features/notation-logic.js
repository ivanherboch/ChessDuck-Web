import {
    KING, KNIGHT, PAWN, PIECE_NAMES_EN, PIECE_NAMES_FR, Position,
    pieceLetter, pieceType, sqName,
} from '../core/chess.js';
import { PieceLexiconFr } from '../core/piece-fr.js';

export function shuffleInPlace(arr, rnd = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

function randomOf(arr, rnd = Math.random) {
    return arr[Math.floor(rnd() * arr.length)];
}

export const NotationLogic = {
    LEVELS: ['Tous', '1. Bases', '2. Prises & Échecs', '3. Roques & Avancé'],

    /** Niveau pédagogique d'un coup : 1 = bases, 2 = prises & échecs, 3 = roques & avancé. */
    levelOf(p, m, san) {
        const body = san.replace(/[+#]+$/, '');
        const disamb = pieceType(p.board[m.from]) !== PAWN && !p.isCastle(m) && body.replace(/x/g, '').length > 3;
        if (p.isCastle(m) || m.promo !== 0 || san.endsWith('#') || p.isEnPassant(m) || disamb) return 3;
        if (p.isCapture(m) || san.endsWith('+')) return 2;
        return 1;
    },

    /** Sous-familles du niveau 3 : 1 roque, 2 promotion, 3 mat, 4 désambiguïsation. */
    isKind(p, m, san, kind) {
        switch (kind) {
            case 1: return p.isCastle(m);
            case 2: return m.promo !== 0;
            case 3: return san.endsWith('#');
            case 4: return pieceType(p.board[m.from]) !== PAWN && !p.isCastle(m) && san.replace(/[+#]+$/, '').replace(/x/g, '').length > 3;
            default: return true;
        }
    },

    /** Choisit dans positions un coup légal du niveau demandé (0 = n'importe lequel). */
    pick(positions, level, rnd = Math.random, wantKind = 0) {
        const pool = [];
        const shuffled = shuffleInPlace([...positions], rnd);
        for (const p of shuffled) {
            if (!p.legalMoves.length) continue;
            for (const m of p.legalMoves) {
                const san = p.san(m);
                const lv = this.levelOf(p, m, san);
                if (level !== 0 && lv !== level) continue;
                if (wantKind !== 0 && !this.isKind(p, m, san, wantKind)) continue;
                pool.push({ before: p, move: m, san, level: lv });
            }
            if (pool.length >= 12) break;
        }
        if (!pool.length) return null;
        // Varie les types de pièces plutôt que de favoriser celles qui ont le plus de coups.
        const byType = new Map();
        for (const ex of pool) {
            const t = pieceType(ex.before.board[ex.move.from]);
            if (!byType.has(t)) byType.set(t, []);
            byType.get(t).push(ex);
        }
        const groups = [...byType.values()];
        return randomOf(randomOf(groups, rnd), rnd);
    },

    _nameOf(type) {
        return `${PieceLexiconFr.title(type)} (${PIECE_NAMES_EN[type]})`;
    },

    /** Diagnostic pédagogique d'une réponse fausse, sans donner la solution. */
    diagnose(input, ex) {
        const san = ex.san;
        const p = ex.before;
        const m = ex.move;
        const type = pieceType(p.board[m.from]);
        const castle = p.isCastle(m);
        if (!input.length) return "Écrivez d'abord le coup avec le clavier ci-dessous.";
        if (input.startsWith('P')) return "Les pions n'ont pas de lettre : on écrit « e4 », jamais « Pe4 ».";
        if (castle) {
            return input.startsWith('O-O')
                ? 'Attention au côté : O-O = petit roque (côté roi), O-O-O = grand roque (côté dame).'
                : 'Le roi se déplace de deux cases : c\'est un roque. Il se note O-O (petit) ou O-O-O (grand).';
        }
        if (input.startsWith('O')) {
            return 'Ce coup n\'est pas un roque : commencez par la lettre de la pièce (rien pour un pion).';
        }
        const inBody = input.replace(/[+#]+$/, '');
        const sanBody = san.replace(/[+#]+$/, '');
        const inSuffix = input.slice(inBody.length);
        const sanSuffix = san.slice(sanBody.length);
        if (inBody === sanBody) {
            if (sanSuffix === '#' && inSuffix === '+') return "C'est plus qu'un échec : le roi n'a aucune parade. L'échec et mat se note « # ».";
            if (sanSuffix === '#') return 'Ce coup donne échec et mat : terminez par « # ».';
            if (sanSuffix === '+' && inSuffix === '#') return 'Le roi peut encore parer : c\'est un simple échec, noté « + ».';
            if (sanSuffix === '+') return 'Ce coup donne échec au roi : ajoutez « + » à la fin.';
            return `Ce coup ne donne pas échec : retirez le « ${inSuffix} » final.`;
        }
        const first = input[0];
        if (type === KNIGHT && first === 'K') return 'N = Knight (Cavalier). La lettre K est réservée au King (Roi).';
        if (type === KING && first === 'N') return 'K = King (Roi). La lettre N désigne le Knight (Cavalier).';
        if (type === PAWN && /[A-Z]/.test(first)) return "C'est un pion qui joue : aucune lettre de pièce, on commence par la colonne.";
        if (type !== PAWN && first !== pieceLetter(type)) {
            return `La pièce jouée est un(e) ${this._nameOf(type)} : sa lettre est « ${pieceLetter(type)} ».`;
        }
        const capture = p.isCapture(m);
        if (capture && !inBody.includes('x')) {
            return type === PAWN
                ? "Le pion capture : colonne de départ, puis « x », puis la case d'arrivée (comme « exd5 »)."
                : "C'est une prise : ajoutez « x » juste avant la case d'arrivée.";
        }
        if (!capture && inBody.includes('x')) return "Aucune pièce n'est capturée : pas de « x » dans ce coup.";
        if (m.promo !== 0) {
            if (!inBody.includes('=')) return 'Le pion atteint la dernière rangée : indiquez la promotion avec « = » et la pièce (ex. « =Q »).';
            const inAfterEq = inBody.slice(inBody.indexOf('=') + 1);
            const sanAfterEq = sanBody.slice(sanBody.indexOf('=') + 1);
            if (inAfterEq !== sanAfterEq) return "Regardez bien la pièce apparue : la lettre après « = » n'est pas la bonne.";
        } else if (inBody.includes('=')) {
            return "Pas de promotion ici : le « = » ne sert que lorsqu'un pion atteint la dernière rangée.";
        }
        const dest = sqName(m.to);
        if (!inBody.includes(dest)) {
            return "La case d'arrivée est inexacte : repérez la colonne (a–h) puis la rangée (1–8) de la case où la pièce se pose.";
        }
        if (type === PAWN && capture && inBody[0] !== sanBody[0]) {
            return 'Pour une prise de pion, on commence par la colonne de départ du pion.';
        }
        if (type !== PAWN) {
            const inCore = inBody.replace(/x/g, '');
            const sanCore = sanBody.replace(/x/g, '');
            if (sanCore.length > 3 && inCore.length === 3) {
                return `Deux ${PIECE_NAMES_FR[type].toLowerCase()}s peuvent aller sur ${dest} : précisez la colonne (ou la rangée) de départ, comme dans « Rad1 ».`;
            }
            if (sanCore.length === 3 && inCore.length > 3) {
                return 'Une seule pièce peut jouer ce coup : inutile de préciser sa case de départ.';
            }
            if (sanCore.length > 3) {
                return 'La précision de départ est inexacte : indiquez la colonne de la pièce qui joue (ou sa rangée si les colonnes sont identiques).';
            }
        }
        return 'Presque ! Ordre à respecter : pièce, (départ), (x), case d\'arrivée, (=promotion), (+ ou #).';
    },

    hint(ex, stage) {
        const p = ex.before;
        const m = ex.move;
        const type = pieceType(p.board[m.from]);
        if (stage >= 2) return `Solution : ${ex.san} — recopiez-la pour la mémoriser.`;
        const parts = [];
        if (p.isCastle(m)) parts.push("Le roi et la tour bougent ensemble : c'est un roque (O-O ou O-O-O).");
        else if (type === PAWN) parts.push('Un pion joue : pas de lettre de pièce.');
        else parts.push(`Pièce : ${this._nameOf(type)} → lettre « ${pieceLetter(type)} ».`);
        if (p.isCapture(m)) parts.push("C'est une prise (x).");
        if (m.promo !== 0) parts.push('Il y a promotion (=).');
        if (ex.san.endsWith('#')) parts.push('Le coup fait mat (#).');
        else if (ex.san.endsWith('+')) parts.push('Le coup donne échec (+).');
        return parts.join(' ');
    },

    explain(ex) {
        const p = ex.before;
        const m = ex.move;
        const type = pieceType(p.board[m.from]);
        if (p.isCastle(m)) return ex.san.startsWith('O-O-O') ? 'Grand roque, côté dame.' : 'Petit roque, côté roi.';
        if (type === PAWN && m.promo !== 0) return `Le pion est promu en ${PIECE_NAMES_FR[m.promo]} (${PIECE_NAMES_EN[m.promo]}).`;
        if (type === PAWN) return `Le pion va en ${sqName(m.to)}${p.isCapture(m) ? ' en capturant.' : '.'}`;
        return `${PIECE_NAMES_FR[type]} (${PIECE_NAMES_EN[type]}) en ${sqName(m.to)}${p.isCapture(m) ? ', avec prise.' : '.'}`;
    },

    /** Exercices de secours si la base n'est pas disponible. */
    FALLBACK: [
        'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
        'r3k2r/ppp2ppp/2n1bn2/3qp3/8/2NP1N2/PPP1BPPP/R2Q1RK1 b kq - 0 9',
        '8/4P1k1/8/8/8/8/1p4K1/8 w - - 0 1',
        '3r2k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1',
    ],

    buildFallbackPositions() {
        return this.FALLBACK.map((fen) => Position.fromFen(fen));
    },
};
