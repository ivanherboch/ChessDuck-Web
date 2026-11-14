import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK } from '../core/chess.js';

export const PIECE_URLS = {
    [KING]: './assets/pieces/Chess_klt45.svg',
    [QUEEN]: './assets/pieces/Chess_qlt45.svg',
    [ROOK]: './assets/pieces/Chess_rlt45.svg',
    [BISHOP]: './assets/pieces/Chess_blt45.svg',
    [KNIGHT]: './assets/pieces/Chess_nlt45.svg',
    [PAWN]: './assets/pieces/Chess_plt45.svg',
    [KING + BLACK]: './assets/pieces/Chess_kdt45.svg',
    [QUEEN + BLACK]: './assets/pieces/Chess_qdt45.svg',
    [ROOK + BLACK]: './assets/pieces/Chess_rdt45.svg',
    [BISHOP + BLACK]: './assets/pieces/Chess_bdt45.svg',
    [KNIGHT + BLACK]: './assets/pieces/Chess_ndt45.svg',
    [PAWN + BLACK]: './assets/pieces/Chess_pdt45.svg',
};

export const KID_PIECE_URLS = {
    ...PIECE_URLS,
    [KNIGHT]: './assets/pieces/p_wg.png',
    [KNIGHT + BLACK]: './assets/pieces/p_bg.png',
};

class PieceStore {
    constructor() {
        this._imgs = new Map();       // url -> HTMLImageElement
        this._tinted = new Map();     // `${url}|${color}` -> HTMLCanvasElement
        this._listeners = new Set();
        this._mascotImg = null;
    }

    onLoad(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _notify() {
        for (const fn of this._listeners) fn();
    }

    urlFor(piece, kid = false) {
        return (kid ? KID_PIECE_URLS : PIECE_URLS)[piece] || null;
    }

    getImage(url) {
        if (!url) return null;
        let entry = this._imgs.get(url);
        if (entry) return entry.complete && entry.naturalWidth > 0 ? entry : null;
        entry = new Image();
        entry.decoding = 'async';
        entry.onload = () => this._notify();
        entry.src = url;
        this._imgs.set(url, entry);
        return entry.complete && entry.naturalWidth > 0 ? entry : null;
    }

    getPieceImage(piece, kid = false) {
        return this.getImage(this.urlFor(piece, kid));
    }

    getTintedPiece(piece, color, kid = false) {
        const url = this.urlFor(piece, kid);
        const img = this.getImage(url);
        if (!img || typeof document === 'undefined') return null;
        const key = `${url}|${color}`;
        if (this._tinted.has(key)) return this._tinted.get(key);
        const cv = document.createElement('canvas');
        cv.width = 64;
        cv.height = 64;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, 64, 64);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 64, 64);
        this._tinted.set(key, cv);
        return cv;
    }

    async preloadSet(kid = false) {
        const map = kid ? KID_PIECE_URLS : PIECE_URLS;
        const urls = [...new Set(Object.values(map))];
        await Promise.all(urls.map((u) => new Promise((resolve) => {
            const img = this.getImage(u);
            if (img) { resolve(img); return; }
            const el = this._imgs.get(u);
            if (!el) { resolve(null); return; }
            const done = () => resolve(el);
            el.addEventListener('load', done, { once: true });
            el.addEventListener('error', done, { once: true });
        })));
    }

    async loadImage(url) {
        return new Promise((resolve) => {
            const img = this.getImage(url);
            if (img) { resolve(img); return; }
            const el = this._imgs.get(url);
            if (!el) { resolve(null); return; }
            const done = () => resolve(el.naturalWidth > 0 ? el : null);
            el.addEventListener('load', done, { once: true });
            el.addEventListener('error', done, { once: true });
        });
    }
}

export const pieceStore = new PieceStore();
