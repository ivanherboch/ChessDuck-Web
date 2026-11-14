import { fileOf, rankOf, sq } from '../core/chess.js';

export const BoardGeometry = {
    column(q, flipped) {
        return flipped ? 7 - fileOf(q) : fileOf(q);
    },

    row(q, flipped) {
        return flipped ? rankOf(q) : 7 - rankOf(q);
    },

    squareAtColRow(col, row, flipped) {
        return flipped ? sq(7 - col, row) : sq(col, 7 - row);
    },

    squareAtXY(x, y, cell, flipped) {
        const col = Math.max(0, Math.min(7, Math.floor(x / cell)));
        const row = Math.max(0, Math.min(7, Math.floor(y / cell)));
        return this.squareAtColRow(col, row, flipped);
    },

    knightCorner(from, to) {
        const df = Math.abs(fileOf(to) - fileOf(from));
        const dr = Math.abs(rankOf(to) - rankOf(from));
        if (!((df === 1 && dr === 2) || (df === 2 && dr === 1))) return -1;
        return dr === 2 ? sq(fileOf(from), rankOf(to)) : sq(fileOf(to), rankOf(from));
    },

    arrowSquares(from, to) {
        const corner = this.knightCorner(from, to);
        return corner >= 0 ? [from, corner, to] : [from, to];
    },

    arrowShape(cx, cy, cell, head) {
        const n = cx.length;
        const unit = (i, j) => {
            const dx = cx[j] - cx[i];
            const dy = cy[j] - cy[i];
            const len = Math.max(0.001, Math.hypot(dx, dy));
            return [dx / len, dy / len];
        };
        const [u0x, u0y] = unit(0, 1);
        const [u1x, u1y] = unit(n - 2, n - 1);
        const tipX = cx[n - 1] + u1x * cell * 0.12;
        const tipY = cy[n - 1] + u1y * cell * 0.12;
        const shaftX = new Array(n);
        const shaftY = new Array(n);
        shaftX[0] = cx[0] + u0x * cell * 0.28;
        shaftY[0] = cy[0] + u0y * cell * 0.28;
        for (let i = 1; i < n - 1; i++) {
            shaftX[i] = cx[i];
            shaftY[i] = cy[i];
        }
        shaftX[n - 1] = tipX - u1x * head * 0.85;
        shaftY[n - 1] = tipY - u1y * head * 0.85;
        const ang = Math.atan2(u1y, u1x);
        const spread = 0.52;
        return {
            shaftX,
            shaftY,
            headX: [tipX, tipX - head * Math.cos(ang - spread), tipX - head * Math.cos(ang + spread)],
            headY: [tipY, tipY - head * Math.sin(ang - spread), tipY - head * Math.sin(ang + spread)],
        };
    },
};
