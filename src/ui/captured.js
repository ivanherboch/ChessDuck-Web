import {
    BISHOP, BLACK, KNIGHT, PAWN, PIECE_VALUES, QUEEN, ROOK, isWhite, pieceType,
} from '../core/chess.js';
import { PieceLexiconFr } from '../core/piece-fr.js';
import { pieceStore } from './pieces.js';

const ORDER = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN];
const START_COUNT = [0, 8, 2, 2, 2, 1, 1];

export function materialOf(p) {
    const white = new Int32Array(7);
    const black = new Int32Array(7);
    let diff = 0;
    for (let q = 0; q < 64; q++) {
        const piece = p.board[q];
        if (!piece) continue;
        const t = pieceType(piece);
        if (isWhite(piece)) {
            white[t]++;
            if (t !== 6) diff += PIECE_VALUES[t];
        } else {
            black[t]++;
            if (t !== 6) diff -= PIECE_VALUES[t];
        }
    }
    const lost = (counts, color) => {
        const out = [];
        for (const t of ORDER) {
            const n = Math.max(0, START_COUNT[t] - counts[t]);
            for (let i = 0; i < n; i++) out.push(t + color);
        }
        return out;
    };
    return { blackLost: lost(black, BLACK), whiteLost: lost(white, 0), diff };
}

export function describePieces(pieces) {
    if (!pieces.length) return 'aucune';
    const byType = new Map();
    for (const pc of pieces) {
        const t = pieceType(pc);
        byType.set(t, (byType.get(t) || 0) + 1);
    }
    return [...byType.entries()].map(([t, n]) => PieceLexiconFr.count(t, n)).join(', ');
}

function drawCaptured(ctx, height, pieces, leadStr, dark, start, avail, pieceSize, alignEnd, kid, textColor, fontFam) {
    const groups = [];
    const byPiece = new Map();
    for (const p of pieces) {
        if (!byPiece.has(p)) {
            const arr = [];
            byPiece.set(p, arr);
            groups.push(arr);
        }
        byPiece.get(p).push(p);
    }

    let scoreW = 0;
    if (leadStr) {
        ctx.font = `700 ${kid ? 14 : 13}px ${fontFam}`;
        scoreW = ctx.measureText(leadStr).width + 6;
    }

    let piece = pieceSize;
    let gap = 4;
    let step = piece - 5;
    const extra = groups.reduce((acc, g) => acc + g.length - 1, 0);
    const gaps = Math.max(0, groups.length - 1);
    const total = () => groups.length * piece + extra * step + gaps * gap + scoreW;

    if (total() > avail && extra > 0) {
        step = Math.max(piece * 0.24, Math.min(step, (avail - (groups.length * piece + gaps * gap + scoreW)) / extra));
    }
    if (total() > avail) gap = 2;
    if (total() > avail && total() - scoreW > 0) {
        const k = Math.min(1, (avail - scoreW) / (total() - scoreW));
        piece *= k;
        step *= k;
        gap *= k;
    }

    const width = groups.length ? total() - scoreW : 0;
    let x = alignEnd ? start + avail - width - scoreW : start;
    const top = (height - piece) / 2;

    const drawOne = (p, px) => {
        const img = pieceStore.getPieceImage(p, kid);
        if (!img) return;
        let haloColor = null;
        if (dark && !isWhite(p)) haloColor = 'rgba(255,255,255,0.80)';
        else if (!dark && isWhite(p)) haloColor = 'rgba(0,0,0,0.60)';
        if (haloColor) {
            const tint = pieceStore.getTintedPiece(p, haloColor, kid);
            if (tint) {
                const r = 1.2;
                const d = r * 0.7;
                for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-d, -d], [d, -d], [-d, d], [d, d]]) {
                    ctx.drawImage(tint, px + dx, top + dy, piece, piece);
                }
            }
        }
        ctx.drawImage(img, px, top, piece, piece);
    };

    for (const g of groups) {
        for (const p of g) {
            drawOne(p, x);
            x += step;
        }
        x += piece - step + gap;
    }

    if (leadStr) {
        const lx = !groups.length ? (alignEnd ? start + avail - (scoreW - 6) : start) : x - gap + 6;
        ctx.font = `700 ${kid ? 14 : 13}px ${fontFam}`;
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'middle';
        ctx.fontVariantNumeric = 'tabular-nums';
        ctx.fillText(leadStr, lx, height / 2);
    }
}

export class CapturedBarView {
    constructor(kid = false) {
        this.kid = kid;
        this.el = document.createElement('canvas');
        this.el.className = kid ? 'captured-bar captured-bar-kid' : 'captured-bar';
        this.el.setAttribute('role', 'img');
        this._state = null;
        this._unbind = pieceStore.onLoad(() => this.draw());
        this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.draw()) : null;
        this._ro?.observe(this.el);
    }

    destroy() {
        this._unbind();
        this._ro?.disconnect();
    }

    update(position, palette) {
        const m = materialOf(position);
        const empty = !m.blackLost.length && !m.whiteLost.length;
        this.el.classList.toggle('hidden', empty);
        if (empty) {
            this._state = null;
            return;
        }
        const desc = `Pièces prises par les Blancs : ${describePieces(m.blackLost)}. Pièces prises par les Noirs : ${describePieces(m.whiteLost)}.` +
            (m.diff !== 0 ? ` Avantage ${m.diff > 0 ? 'Blancs' : 'Noirs'} +${Math.abs(m.diff)}.` : ' Matériel égal.');
        this.el.setAttribute('aria-label', desc);
        this._state = { m, palette };
        this.draw();
    }

    draw() {
        if (!this._state || this.el.classList.contains('hidden')) return;
        const rect = this.el.getBoundingClientRect();
        const w = Math.max(0, Math.round(rect.width));
        const h = this.kid ? 34 : 28;
        if (!w) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        if (this.el.width !== Math.round(w * dpr) || this.el.height !== Math.round(h * dpr)) {
            this.el.width = Math.round(w * dpr);
            this.el.height = Math.round(h * dpr);
        }
        const ctx = this.el.getContext('2d');
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        const { m, palette } = this._state;
        const pad = this.kid ? 12 : 8;
        const half = Math.max(10, (w - 2 * pad - 10) / 2);
        const pSize = this.kid ? 22 : 20;
        const fontFam = this.kid ? '"Fredoka", system-ui, sans-serif' : 'system-ui, -apple-system, sans-serif';
        drawCaptured(ctx, h, m.blackLost, m.diff > 0 ? `+${m.diff}` : null, palette.dark, pad, half, pSize, false, this.kid, palette.text, fontFam);
        drawCaptured(ctx, h, m.whiteLost, m.diff < 0 ? `+${Math.abs(m.diff)}` : null, palette.dark, w - pad - half, half, pSize, true, this.kid, palette.text, fontFam);
        ctx.restore();
    }
}

export function createSideDot(white) {
    const dot = document.createElement('span');
    dot.className = `side-dot ${white ? 'side-dot-white' : 'side-dot-black'}`;
    dot.setAttribute('aria-hidden', 'true');
    return dot;
}

export class PlayerBarView {
    constructor() {
        this.el = document.createElement('div');
        this.el.className = 'player-bar';
        this.dot = createSideDot(true);
        this.nameEl = document.createElement('span');
        this.nameEl.className = 'player-name';
        this.detailEl = document.createElement('span');
        this.detailEl.className = 'player-detail';
        this.statusEl = document.createElement('span');
        this.statusEl.className = 'player-status';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'player-captured-canvas';
        this.el.append(this.dot, this.nameEl, this.detailEl, this.statusEl, this.canvas);

        this._state = null;
        this._unbind = pieceStore.onLoad(() => this.draw());
        this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.draw()) : null;
        this._ro?.observe(this.canvas);
    }

    destroy() {
        this._unbind();
        this._ro?.disconnect();
    }

    update({ name, detail = null, white, position, toMove, thinking = false, palette }) {
        this.dot.className = `side-dot ${white ? 'side-dot-white' : 'side-dot-black'}`;
        this.nameEl.textContent = name;
        if (detail) {
            this.detailEl.textContent = ` ${detail}`;
            this.detailEl.classList.remove('hidden');
        } else {
            this.detailEl.textContent = '';
            this.detailEl.classList.add('hidden');
        }

        if (thinking) {
            this.statusEl.className = 'player-status spinner';
            this.statusEl.classList.remove('hidden');
        } else if (toMove) {
            this.statusEl.className = 'player-status turn-dot';
            this.statusEl.classList.remove('hidden');
        } else {
            this.statusEl.className = 'player-status hidden';
        }

        const m = materialOf(position);
        const captured = white ? m.blackLost : m.whiteLost;
        const lead = white ? m.diff : -m.diff;
        const side = white ? 'Blancs' : 'Noirs';
        let desc = `${name}, ${side}`;
        if (detail) desc += `, ${detail}`;
        if (thinking) desc += ', réfléchit';
        else if (toMove) desc += ', au trait';
        if (captured.length) desc += `. A pris : ${describePieces(captured)}`;
        if (lead > 0) desc += `. Avantage +${lead}`;
        this.el.setAttribute('aria-label', desc);

        this._state = { captured, lead, palette };
        this.draw();
    }

    draw() {
        if (!this._state) return;
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(0, Math.round(rect.width));
        const h = 28;
        if (!w) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
        }
        const ctx = this.canvas.getContext('2d');
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        const { captured, lead, palette } = this._state;
        drawCaptured(
            ctx, h, captured, lead > 0 ? `+${lead}` : null,
            palette.dark, 0, w, 20, true, false, palette.text, 'system-ui, -apple-system, sans-serif',
        );
        ctx.restore();
    }
}
