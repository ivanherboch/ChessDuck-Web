import { Position, fileOf, rankOf, sq, sqName } from '../core/chess.js';

export const VisionKind = Object.freeze({
    COLOR: Object.freeze({ key: 'COLOR', label: 'Couleur de la case' }),
    TOUCH: Object.freeze({ key: 'TOUCH', label: 'Toucher la case' }),
    KNIGHT: Object.freeze({ key: 'KNIGHT', label: 'Chemin du cavalier' }),
});

export const VISION_KINDS = Object.freeze([
    VisionKind.COLOR,
    VisionKind.TOUCH,
    VisionKind.KNIGHT,
]);

const JUMPS = [
    [1, 2], [2, 1], [2, -1], [1, -2],
    [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export const SquareVision = {
    EMPTY: EMPTY_FEN,

    /** Case claire ? (a1 est une case foncée.) */
    isLight(square) {
        return (fileOf(square) + rankOf(square)) % 2 === 1;
    },

    /** Nombre minimal de sauts de cavalier de [from] à [to] (BFS sur échiquier vide). */
    knightDistance(from, to) {
        if (from === to) return 0;
        const dist = new Int8Array(64).fill(-1);
        dist[from] = 0;
        const queue = [from];
        let head = 0;
        while (head < queue.length) {
            const q = queue[head++];
            for (const [df, dr] of JUMPS) {
                const f = fileOf(q) + df;
                const r = rankOf(q) + dr;
                if (f < 0 || f > 7 || r < 0 || r > 7) continue;
                const n = sq(f, r);
                if (dist[n] >= 0) continue;
                dist[n] = dist[q] + 1;
                if (n === to) return dist[n];
                queue.push(n);
            }
        }
        return -1;
    },

    /** FEN d'un échiquier vide avec un cavalier blanc en [square]. */
    withKnight(square) {
        const rows = [];
        for (let r = 7; r >= 0; r--) {
            if (r !== rankOf(square)) {
                rows.push('8');
            } else {
                const f = fileOf(square);
                rows.push((f > 0 ? String(f) : '') + 'N' + (f < 7 ? String(7 - f) : ''));
            }
        }
        return `${rows.join('/')} w - - 0 1`;
    },

    positionFor(q) {
        return Position.fromFen(q.kind === VisionKind.KNIGHT ? this.withKnight(q.square) : this.EMPTY);
    },

    /** Question au hasard ; [kind] null : un des trois exercices. Chemin du cavalier : 1 à 4 sauts. */
    question(rnd = Math.random, kind = null) {
        const k = kind || VISION_KINDS[Math.floor(rnd() * VISION_KINDS.length)];
        const a = Math.floor(rnd() * 64);
        if (k !== VisionKind.KNIGHT) return { kind: k, square: a, target: -1 };
        for (;;) {
            const b = Math.floor(rnd() * 64);
            const d = this.knightDistance(a, b);
            if (d >= 1 && d <= 4) return { kind: k, square: a, target: b };
        }
    },

    prompt(q) {
        switch (q.kind) {
        case VisionKind.COLOR:
            return `Sans regarder l'échiquier : la case ${sqName(q.square)} est-elle claire ou foncée ?`;
        case VisionKind.TOUCH:
            return `Touchez la case ${sqName(q.square)}.`;
        case VisionKind.KNIGHT:
            return `Combien de sauts faut-il au cavalier pour aller de ${sqName(q.square)} à ${sqName(q.target)} ?`;
        default:
            return '';
        }
    },
};
