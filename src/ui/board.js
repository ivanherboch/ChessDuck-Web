import {
    BISHOP, BLACK, KNIGHT, Move, PIECE_NAMES_FR, QUEEN, ROOK,
    fileOf, isWhite, pieceType, rankOf, sq, sqName,
} from '../core/chess.js';
import { PieceLexiconFr } from '../core/piece-fr.js';
import { winPercent, isMateScore, mateIn } from '../core/stockfish.js';
import { BoardGeometry } from './board-geometry.js';
import { feedback } from './feedback.js';
import { pieceStore } from './pieces.js';
import { hexToRgba, NightColors } from './theme.js';

function fastOutSlowIn(t) {
    // Approximation fidèle de CubicBezier(0.4, 0, 0.2, 1)
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const SHAKE_KEYS = [0, 1, -1, 0.7, -0.7, 0.35, 0];

export function drawRoundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
}

/** Nom vocal d'une pièce : « Cavalier blanc », « Tour noire » ; « case vide » sinon. */
function spokenPiece(piece) {
    if (!piece) return 'case vide';
    const t = pieceType(piece);
    const f = PieceLexiconFr.isFeminine(t);
    return PIECE_NAMES_FR[t] + (isWhite(piece) ? (f ? ' blanche' : ' blanc') : (f ? ' noire' : ' noir'));
}

export function evalShort(evalWhite) {
    if (isMateScore(evalWhite)) {
        const m = Math.max(1, Math.abs(mateIn(evalWhite)));
        return `M${m}`;
    }
    const pawns = Math.abs(evalWhite) / 100.0;
    return `${evalWhite >= 0 ? '+' : '−'}${Math.abs(evalWhite) >= 1000 ? pawns.toFixed(0) : pawns.toFixed(1)}`;
}

/** Échiquier interactif HTML5 Canvas avec animation 180 ms, secousse, glisser-déposer, flèches et grille ARIA. */
export class ChessBoardView {
    constructor() {
        this.el = document.createElement('div');
        this.el.className = 'chess-board-wrap';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'chess-board-canvas';
        this.canvas.setAttribute('aria-hidden', 'true');
        this.dragCanvas = document.createElement('canvas');
        this.dragCanvas.className = 'chess-board-drag-canvas hidden';
        this.dragCanvas.setAttribute('aria-hidden', 'true');

        // 64 cases accessibles superposées dans l'ordre visuel (sans intercepter les gestes du pointeur).
        this.a11yEl = document.createElement('div');
        this.a11yEl.className = 'board-a11y-grid';
        this.a11yEl.setAttribute('role', 'group');
        this._a11yCells = [];
        for (let vis = 0; vis < 64; vis++) {
            const cell = document.createElement('div');
            cell.className = 'board-a11y-cell';
            cell.addEventListener('click', () => {
                const q = Number(cell.dataset.sq);
                if (Number.isInteger(q) && q >= 0 && q < 64) {
                    this._tapSquare(q);
                }
            });
            cell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const q = Number(cell.dataset.sq);
                    if (Number.isInteger(q) && q >= 0 && q < 64) {
                        e.preventDefault();
                        this._tapSquare(q);
                    }
                }
            });
            this._a11yCells.push(cell);
            this.a11yEl.appendChild(cell);
        }

        this.promoEl = document.createElement('div');
        this.promoEl.className = 'promo-overlay hidden';
        this.promoEl.setAttribute('aria-label', 'Annuler la promotion');
        this.el.append(this.canvas, this.a11yEl, this.dragCanvas, this.promoEl);

        this.ctx = this.canvas.getContext('2d');
        this.dragCtx = this.dragCanvas.getContext('2d');
        this._state = {
            position: null,
            flipped: false,
            interactive: false,
            lastMove: null,
            anim: null,
            arrows: [],
            marks: [],
            badges: [],
            kid: false,
            showCoords: true,
            palette: NightColors,
            onIllegalTouch: null,
            onSquareTap: null,
            onMove: () => {},
        };

        this._lastPosition = null;
        this._selected = -1;
        this._dragFrom = -1;
        this._dragPos = { x: 0, y: 0 };
        this._promoPair = null;
        this._skipMove = null;
        this._pointer = null; // { id, downX, downY, sqDown, own, dragging }

        // Animation state
        this._runningAnimId = -1;
        this._animStart = 0;
        this._animT = 1;
        this._rafId = 0;

        // Shake state
        this._shakeSq = -1;
        this._shakeStart = 0;
        this._shakeVal = 0;

        this._unbindPieceLoad = pieceStore.onLoad(() => this.draw());
        this._bindPointer();
        this._resizeObs = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => this._syncCanvasSize())
            : null;
        this._resizeObs?.observe(this.el);

        this._cancelPromo = () => {
            if (!this._promoPair) return;
            this._promoPair = null;
            this._selected = -1;
            this._renderPromo();
            this._syncA11y();
            this.draw();
        };
        this.promoEl.addEventListener('click', (e) => {
            if (e.target === this.promoEl) this._cancelPromo();
        });
        this._onPromoKey = (e) => {
            if (e.key === 'Escape' && this._promoPair) {
                e.preventDefault();
                this._cancelPromo();
            }
        };
        document.addEventListener('keydown', this._onPromoKey);
    }

    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._unbindPieceLoad();
        this._resizeObs?.disconnect();
        document.removeEventListener('keydown', this._onPromoKey);
    }

    setState(next) {
        const prevPos = this._lastPosition;
        const nextTap = 'onSquareTap' in next ? next.onSquareTap : null;
        Object.assign(this._state, next, { onSquareTap: nextTap });
        pieceStore.preloadSet(this._state.kid).catch(() => {});

        const clearStaleInteraction = (!this._state.interactive || typeof this._state.onSquareTap === 'function') &&
            (this._selected >= 0 || this._dragFrom >= 0 || this._promoPair || this._pointer);
        if (this._state.position !== prevPos || clearStaleInteraction) {
            this._lastPosition = this._state.position;
            this._selected = -1;
            this._dragFrom = -1;
            this._promoPair = null;
            this._pointer = null;
            this._renderPromo();
        }

        const anim = this._state.anim;
        if (anim && anim.id !== this._runningAnimId) {
            this._runningAnimId = anim.id;
            const sk = this._skipMove;
            const shouldSkip = sk && anim.slides.some((sl) => sl.from === sk.from && sl.to === sk.to);
            this._skipMove = null;
            const fbOpts = {
                capture: Boolean(anim.capture),
                check: Boolean(this._state.position?.inCheck),
                promotion: Boolean(anim.promotion),
            };
            if (shouldSkip) {
                this._animT = 1;
                feedback.move(fbOpts);
            } else {
                this._animT = 0;
                this._animStart = performance.now();
                feedback.move(fbOpts);
                this._ensureLoop();
            }
        }

        this._syncCanvasSize();
        this._syncA11y();
        this.draw();
    }

    _syncA11y() {
        const pos = this._state.position;
        if (!pos) return;
        const { flipped, interactive, lastMove } = this._state;
        const status = pos.isCheckmate ? ' Échec et mat.' : pos.inCheck ? ' Échec au roi.' : '';
        this.a11yEl.setAttribute(
            'aria-label',
            `Échiquier, vue des ${flipped ? 'Noirs' : 'Blancs'}. Trait aux ${pos.whiteToMove ? 'Blancs' : 'Noirs'}.${status}`,
        );

        const sel = interactive ? this._selected : -1;
        const targets = sel >= 0 ? pos.legalFrom(sel) : [];
        const checked = pos.inCheck ? pos.kingSquare(pos.whiteToMove) : -1;

        for (let vis = 0; vis < 64; vis++) {
            const r = Math.floor(vis / 8);
            const c = vis % 8;
            const q = flipped ? sq(7 - c, r) : sq(c, 7 - r);
            const cell = this._a11yCells[vis];
            cell.dataset.sq = String(q);
            const label = `${sqName(q)}, ${spokenPiece(pos.board[q])}`;
            const states = [];
            if (q === sel) states.push('sélectionnée');
            const targetMove = targets.find((m) => m.to === q);
            if (targetMove) states.push(pos.isCapture(targetMove) ? 'prise possible' : 'destination légale');
            if (lastMove && (q === lastMove.from || q === lastMove.to)) states.push('dernier coup');
            if (q === checked) states.push('roi en échec');

            cell.setAttribute('aria-label', states.length ? `${label}, ${states.join(', ')}` : label);
            if (states.length) cell.setAttribute('aria-description', states.join(', '));
            else cell.removeAttribute('aria-description');

            if (interactive || typeof this._state.onSquareTap === 'function') {
                cell.setAttribute('role', 'button');
                cell.tabIndex = 0;
                cell.setAttribute('aria-pressed', String(q === sel));
            } else {
                cell.removeAttribute('role');
                cell.removeAttribute('tabindex');
                cell.removeAttribute('aria-pressed');
            }
        }
    }

    _cssBoardSide() {
        const rect = this.el.getBoundingClientRect();
        return rect.height > 0
            ? Math.max(0, Math.round(Math.min(rect.width, rect.height)))
            : Math.max(0, Math.round(rect.width));
    }

    _syncCanvasSize() {
        const cssSide = this._cssBoardSide();
        if (!cssSide) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const px = Math.round(cssSide * dpr);
        if (this.canvas.width !== px || this.canvas.height !== px) {
            this.canvas.width = px;
            this.canvas.height = px;
            this.draw();
        }
        if (this._promoPair) this._renderPromo();
    }

    _ensureLoop() {
        if (this._rafId) return;
        const tick = (now) => {
            this._rafId = 0;
            let keepGoing = false;
            if (this._animT < 1) {
                const raw = (now - this._animStart) / 180;
                if (raw >= 1) {
                    this._animT = 1;
                } else {
                    this._animT = fastOutSlowIn(Math.max(0, raw));
                    keepGoing = true;
                }
            }
            if (this._shakeSq >= 0) {
                const elapsed = now - this._shakeStart;
                const totalDur = (SHAKE_KEYS.length - 1) * 45;
                if (elapsed >= totalDur) {
                    this._shakeSq = -1;
                    this._shakeVal = 0;
                } else {
                    const seg = Math.floor(elapsed / 45);
                    const frac = (elapsed % 45) / 45;
                    this._shakeVal = SHAKE_KEYS[seg] + (SHAKE_KEYS[seg + 1] - SHAKE_KEYS[seg]) * frac;
                    keepGoing = true;
                }
            }
            this.draw();
            if (keepGoing) {
                this._rafId = requestAnimationFrame(tick);
            }
        };
        this._rafId = requestAnimationFrame(tick);
    }

    _refuse(q) {
        this._shakeSq = q;
        this._shakeStart = performance.now();
        this._shakeVal = 0;
        feedback.error();
        this._state.onIllegalTouch?.(q);
        this._syncA11y();
        this._ensureLoop();
    }

    _tryMove(from, to, viaDrag) {
        const pos = this._state.position;
        if (!pos) return false;
        const cands = pos.legalMoves.filter((m) => m.from === from && m.to === to);
        if (!cands.length) return false;
        if (cands.length > 1) {
            this._promoPair = { from, to };
            this._renderPromo();
        } else {
            if (viaDrag) this._skipMove = cands[0];
            this._selected = -1;
            this._syncA11y();
            this._state.onMove?.(cands[0]);
        }
        return true;
    }

    _tapSquare(q) {
        const pos = this._state.position;
        if (!pos || this._promoPair) return false;
        if (typeof this._state.onSquareTap === 'function') {
            feedback.unlock();
            this._state.onSquareTap(q);
            return true;
        }
        if (!this._state.interactive) return false;
        if (this._selected >= 0 && this._selected !== q && this._tryMove(this._selected, q, false)) {
            return true;
        }
        const piece = pos.board[q];
        const own = piece !== 0 && isWhite(piece) === pos.whiteToMove;
        if (own) {
            if (pos.legalFrom(q).length === 0) {
                this._selected = -1;
                this._refuse(q);
            } else {
                this._selected = this._selected === q ? -1 : q;
                this._syncA11y();
                this.draw();
            }
            return true;
        }
        if (this._selected >= 0) {
            this._selected = -1;
            this._syncA11y();
            this.draw();
            return true;
        }
        return false;
    }

    _renderPromo() {
        const pair = this._promoPair;
        const pos = this._state.position;
        if (!pair || !pos) {
            this.promoEl.classList.add('hidden');
            this.promoEl.classList.remove('is-kid');
            this.promoEl.replaceChildren();
            return;
        }
        const white = pos.whiteToMove;
        const { flipped, kid } = this._state;
        const side = this._cssBoardSide() || this.el.clientWidth || 320;
        const cell = Math.max(side / 8, 48);
        const col = BoardGeometry.column(pair.to, flipped);
        const atTop = BoardGeometry.row(pair.to, flipped) === 0;
        const x = Math.min((side / 8) * col, Math.max(0, side - cell));
        const y = atTop ? 0 : Math.max(0, side - cell * 4);
        const types = atTop ? [QUEEN, ROOK, BISHOP, KNIGHT] : [KNIGHT, BISHOP, ROOK, QUEEN];

        this.promoEl.classList.toggle('is-kid', Boolean(kid));
        const box = document.createElement('div');
        box.className = `promo-box${kid ? ' is-kid' : ''}`;
        box.style.width = `${cell}px`;
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        for (const type of types) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'promo-btn';
            btn.style.width = `${cell}px`;
            btn.style.height = `${cell}px`;
            btn.setAttribute('aria-label', `Promouvoir en ${PIECE_NAMES_FR[type]}`);
            const img = document.createElement('img');
            img.src = pieceStore.urlFor(white ? type : type + BLACK, kid);
            img.alt = PIECE_NAMES_FR[type];
            btn.appendChild(img);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._promoPair = null;
                this._selected = -1;
                this._renderPromo();
                this._syncA11y();
                this._state.onMove?.(new Move(pair.from, pair.to, type));
            });
            box.appendChild(btn);
        }
        this.promoEl.replaceChildren(box);
        this.promoEl.classList.remove('hidden');
    }

    _bindPointer() {
        const slop = 8;
        const coordsOf = (e) => {
            const r = this.canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top, size: r.width };
        };

        this.canvas.addEventListener('pointerdown', (e) => {
            const hasTap = typeof this._state.onSquareTap === 'function';
            if ((!this._state.interactive && !hasTap) || this._promoPair || !this._state.position) return;
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            feedback.unlock();
            const { x, y, size } = coordsOf(e);
            if (size <= 0) return;
            const s = size / 8;
            const sqDown = BoardGeometry.squareAtXY(x, y, s, this._state.flipped);
            const piece = this._state.position.board[sqDown];
            const own = !hasTap && piece !== 0 && isWhite(piece) === this._state.position.whiteToMove;
            this._pointer = { id: e.pointerId, downX: x, downY: y, sqDown, own, dragging: false };
            try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        });

        this.canvas.addEventListener('pointermove', (e) => {
            const ptr = this._pointer;
            if (!ptr || e.pointerId !== ptr.id || !this._state.position || !this._state.interactive) return;
            if (typeof this._state.onSquareTap === 'function') return;
            const { x, y } = coordsOf(e);
            if (ptr.own && !ptr.dragging && Math.hypot(x - ptr.downX, y - ptr.downY) > slop) {
                ptr.dragging = true;
                this._selected = ptr.sqDown;
                this._dragFrom = ptr.sqDown;
                this._syncA11y();
            }
            if (ptr.dragging) {
                this._dragPos = { x, y };
                this.draw();
            }
        });

        const endPointer = (e, cancelled) => {
            const ptr = this._pointer;
            if (!ptr || e.pointerId !== ptr.id) return;
            this._pointer = null;
            try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            const pos = this._state.position;
            const hasTap = typeof this._state.onSquareTap === 'function';
            if (!pos || (!this._state.interactive && !hasTap)) {
                this._dragFrom = -1;
                this._selected = -1;
                this._syncA11y();
                this.draw();
                return;
            }
            const { x, y, size } = coordsOf(e);
            const s = size / 8;

            if (cancelled) {
                this._dragFrom = -1;
                this.draw();
                return;
            }

            if (ptr.dragging && pos.legalFrom(ptr.sqDown).length === 0) {
                this._dragFrom = -1;
                this._selected = -1;
                this._refuse(ptr.sqDown);
                return;
            }
            if (ptr.dragging) {
                const inside = x >= 0 && y >= 0 && x <= size && y <= size;
                const target = BoardGeometry.squareAtXY(x, y, s, this._state.flipped);
                this._dragFrom = -1;
                if (inside && target !== ptr.sqDown) {
                    if (!this._tryMove(ptr.sqDown, target, true)) {
                        this._syncA11y();
                        this.draw();
                    }
                } else {
                    this._syncA11y();
                    this.draw();
                }
            } else {
                this._tapSquare(ptr.sqDown);
            }
        };

        this.canvas.addEventListener('pointerup', (e) => endPointer(e, false));
        this.canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
    }

    draw() {
        const ctx = this.ctx;
        const pos = this._state.position;
        if (!ctx || !pos) return;
        const rect = this.el.getBoundingClientRect();
        const rectSide = rect.height > 0 ? Math.min(rect.width, rect.height) : rect.width;
        const dpr = this.canvas.width / Math.max(1, rectSide || this.canvas.width);
        const cssSide = this.canvas.width / Math.max(1, dpr);
        if (cssSide <= 0) return;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.beginPath();
        drawRoundRect(ctx, 0, 0, cssSide, cssSide, this._state.kid ? 17 : 4);
        ctx.clip();

        const s = cssSide / 8;
        const { flipped, interactive, lastMove, anim, arrows, marks, badges, kid, showCoords, palette: c } = this._state;
        const fontFam = kid ? '"Fredoka", system-ui, sans-serif' : 'system-ui, -apple-system, sans-serif';

        const topLeft = (q) => [BoardGeometry.column(q, flipped) * s, BoardGeometry.row(q, flipped) * s];
        const center = (q) => {
            const [x, y] = topLeft(q);
            return [x + s / 2, y + s / 2];
        };

        // 1. Cases
        for (let q = 0; q < 64; q++) {
            const light = (fileOf(q) + rankOf(q)) % 2 === 1;
            const [x, y] = topLeft(q);
            ctx.fillStyle = light ? c.squareLight : c.squareDark;
            ctx.fillRect(x, y, s + 0.4, s + 0.4);
        }

        // 2. Dernier coup
        if (lastMove) {
            ctx.fillStyle = c.lastMoveTint || 'rgba(247, 236, 94, 0.40)';
            for (const q of [lastMove.from, lastMove.to]) {
                const [x, y] = topLeft(q);
                ctx.fillRect(x, y, s, s);
            }
        }

        // 3. Marques
        for (const [q, col] of marks) {
            ctx.fillStyle = col.startsWith('#') ? hexToRgba(col, 0.62) : col;
            const [x, y] = topLeft(q);
            ctx.fillRect(x, y, s, s);
        }

        // 4. Roi en échec
        if (pos.inCheck) {
            const k = pos.kingSquare(pos.whiteToMove);
            if (k >= 0) {
                const [cx, cy] = center(k);
                const [kx, ky] = topLeft(k);
                const glow = c.checkGlow || '#EF4444';
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.62);
                grad.addColorStop(0, glow.startsWith('#') ? hexToRgba(glow, 0.90) : glow);
                grad.addColorStop(1, glow.startsWith('#') ? hexToRgba(glow, 0.00) : 'rgba(239, 68, 68, 0.00)');
                ctx.fillStyle = grad;
                ctx.fillRect(kx, ky, s, s);
            }
        }

        // 5. Sélection & hover drag
        const targets = (this._selected >= 0 && interactive) ? pos.legalFrom(this._selected) : [];
        if (this._selected >= 0 && interactive) {
            const [sx, sy] = topLeft(this._selected);
            ctx.fillStyle = hexToRgba(c.select, 0.50);
            ctx.fillRect(sx, sy, s, s);
        }
        if (this._dragFrom >= 0) {
            const hover = BoardGeometry.squareAtXY(this._dragPos.x, this._dragPos.y, s, flipped);
            if (targets.some((m) => m.to === hover)) {
                const [hx, hy] = topLeft(hover);
                const [hcx, hcy] = center(hover);
                ctx.fillStyle = hexToRgba(c.select, 0.60);
                ctx.fillRect(hx, hy, s, s);
                ctx.fillStyle = hexToRgba(c.select, 0.20);
                ctx.beginPath();
                ctx.arc(hcx, hcy, s * 0.95, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 6. Pièces immobiles
        const drawPiece = (targetCtx, piece, x, y, scale = 1) => {
            const img = pieceStore.getPieceImage(piece, kid);
            if (!img) return;
            const d = s * scale;
            targetCtx.drawImage(img, x - (d - s) / 2, y - (d - s) / 2, d, d);
        };

        const sliding = anim && this._animT < 1 ? anim.slides : [];
        for (let q = 0; q < 64; q++) {
            const piece = pos.board[q];
            if (piece === 0 || q === this._dragFrom || sliding.some((sl) => sl.to === q)) continue;
            let [x, y] = topLeft(q);
            if (q === this._shakeSq) x += this._shakeVal * s * 0.09;
            drawPiece(ctx, piece, x, y, 1);
        }

        // 7. Coordonnées par-dessus les pièces (lettres en bas à droite, chiffres en haut à gauche)
        if (showCoords) {
            const fs = Math.max(9, s * 0.19);
            ctx.font = `700 ${fs}px ${fontFam}`;
            ctx.textBaseline = 'top';
            const drawLabel = (txt, cellX, cellY, bottomRight) => {
                const m = ctx.measureText(txt);
                const pad = s * 0.035;
                const w = m.width + pad * 2;
                const h = fs * 1.18;
                const margin = s * 0.03;
                const rx = bottomRight ? cellX + s - margin - w : cellX + margin;
                const ry = bottomRight ? cellY + s - margin - h : cellY + margin;
                ctx.fillStyle = c.coordPill;
                ctx.beginPath();
                drawRoundRect(ctx, rx, ry, w, h, h / 3);
                ctx.fill();
                ctx.fillStyle = c.coordInk;
                ctx.fillText(txt, rx + pad, ry + (h - fs) * 0.55);
            };
            for (let i = 0; i < 8; i++) {
                const fileSq = flipped ? sq(7 - i, 7) : sq(i, 0);
                const rankSq = flipped ? sq(7, 7 - i) : sq(0, i);
                const [fx, fy] = topLeft(fileSq);
                const [rx, ry] = topLeft(rankSq);
                drawLabel(String.fromCharCode(97 + fileOf(fileSq)), fx, fy, true);
                drawLabel(String.fromCharCode(49 + rankOf(rankSq)), rx, ry, false);
            }
        }

        // 8. Cibles légales
        if (targets.length) {
            const seenTo = new Set();
            ctx.fillStyle = hexToRgba(c.select, 0.70);
            ctx.strokeStyle = hexToRgba(c.select, 0.70);
            ctx.lineWidth = s * 0.09;
            for (const m of targets) {
                if (seenTo.has(m.to)) continue;
                seenTo.add(m.to);
                const [cx, cy] = center(m.to);
                ctx.beginPath();
                if (pos.isCapture(m)) {
                    ctx.arc(cx, cy, s * 0.43, 0, Math.PI * 2);
                    ctx.stroke();
                } else {
                    ctx.arc(cx, cy, s * 0.16, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // 9. Pièces glissantes
        for (const sl of sliding) {
            const piece = pos.board[sl.to];
            if (!piece) continue;
            const [fx, fy] = topLeft(sl.from);
            const [tx, ty] = topLeft(sl.to);
            drawPiece(ctx, piece, fx + (tx - fx) * this._animT, fy + (ty - fy) * this._animT, 1);
        }

        // 10. Flèches
        for (const a of arrows) {
            const squares = BoardGeometry.arrowSquares(a.from, a.to);
            const cx = [];
            const cy = [];
            for (const q of squares) {
                const [qx, qy] = center(q);
                cx.push(qx);
                cy.push(qy);
            }
            const shape = BoardGeometry.arrowShape(cx, cy, s, s * 0.42);
            const col = a.color.startsWith('#') ? hexToRgba(a.color, 0.85) : a.color;
            ctx.strokeStyle = col;
            ctx.fillStyle = col;
            ctx.lineWidth = s * 0.17;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(shape.shaftX[0], shape.shaftY[0]);
            for (let i = 1; i < shape.shaftX.length; i++) ctx.lineTo(shape.shaftX[i], shape.shaftY[i]);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(shape.headX[0], shape.headY[0]);
            ctx.lineTo(shape.headX[1], shape.headY[1]);
            ctx.lineTo(shape.headX[2], shape.headY[2]);
            ctx.closePath();
            ctx.fill();
        }

        // 11. Badges d'annotation (!!, !, ?!, ?, ??)
        const seenBadgeSq = new Set();
        for (const b of badges) {
            const right = !seenBadgeSq.has(b.sq);
            seenBadgeSq.add(b.sq);
            const [bx, by] = topLeft(b.sq);
            const cx = bx + (right ? s * 0.80 : s * 0.20);
            const cy = by + s * 0.20;
            const r = s * 0.19;
            ctx.fillStyle = 'rgba(0,0,0,0.33)';
            ctx.beginPath();
            ctx.arc(cx, cy + r * 0.12, r * 1.08, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = b.color;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            const fs = b.text.length > 1 ? r * 1.05 : r * 1.25;
            ctx.font = `900 ${fs}px system-ui, sans-serif`;
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.text, cx, cy + 0.5);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
        }

        ctx.restore();

        // 12. Pièce en cours de glissement (non rognée aux bords, notamment en 8e rangée)
        if (this._dragFrom >= 0 && this.dragCtx) {
            const pad = Math.ceil(s * 1.6);
            const fullCss = cssSide + pad * 2;
            const fullPx = Math.round(fullCss * dpr);
            if (this.dragCanvas.width !== fullPx || this.dragCanvas.height !== fullPx) {
                this.dragCanvas.width = fullPx;
                this.dragCanvas.height = fullPx;
            }
            this.dragCanvas.style.left = `${-pad}px`;
            this.dragCanvas.style.top = `${-pad}px`;
            this.dragCanvas.style.width = `${fullCss}px`;
            this.dragCanvas.style.height = `${fullCss}px`;
            this.dragCanvas.classList.remove('hidden');

            const dctx = this.dragCtx;
            dctx.clearRect(0, 0, fullPx, fullPx);
            dctx.save();
            dctx.scale(dpr, dpr);
            const piece = pos.board[this._dragFrom];
            const ax = this._dragPos.x - s / 2 + pad;
            const ay = this._dragPos.y - s * 1.35 + pad;
            dctx.fillStyle = 'rgba(0,0,0,0.25)';
            dctx.beginPath();
            dctx.ellipse(ax + s * 0.5, ay + s * 1.12, s * 0.38, s * 0.10, 0, 0, Math.PI * 2);
            dctx.fill();
            drawPiece(dctx, piece, ax, ay, 1.3);
            dctx.restore();
        } else {
            this.dragCanvas.classList.add('hidden');
        }
    }
}

const EVAL_WIDEST = ['−9.9', '+9.9', '+10', 'M12'];
let evalMeasureCtx = null;

/**
 * Largeur de la jauge : fixe (l'échiquier ne saute pas quand le score change) et assez large pour le score
 * le plus long, quelle que soit la taille de police du navigateur/système.
 */
export function measureEvalBarWidth({
    font = '800 9px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    measureFn = null,
    minWidth = 26,
    extraPad = 8,
} = {}) {
    let measure = measureFn;
    if (!measure && typeof document !== 'undefined') {
        if (!evalMeasureCtx) {
            const c = document.createElement('canvas');
            evalMeasureCtx = c.getContext?.('2d') || null;
        }
        if (evalMeasureCtx) {
            evalMeasureCtx.font = font;
            measure = (s) => evalMeasureCtx.measureText(s).width;
        }
    }
    if (!measure) return minWidth;
    let widest = 0;
    for (const sample of EVAL_WIDEST) {
        widest = Math.max(widest, measure(sample));
    }
    return Math.max(minWidth, Math.ceil(widest) + extraPad);
}

/** Jauge latérale d'évaluation animée (350 ms). */
export class EvalBarView {
    constructor() {
        this.el = document.createElement('div');
        this.el.className = 'eval-bar';
        this.el.setAttribute('role', 'status');
        this.fill = document.createElement('div');
        this.fill.className = 'eval-bar-fill';
        this.tick = document.createElement('div');
        this.tick.className = 'eval-bar-tick';
        this.label = document.createElement('span');
        this.label.className = 'eval-bar-label';
        this.el.append(this.fill, this.tick, this.label);
        this.el._measureSpace = () => this.measureSpace();
    }

    /** Met à jour `--eval-w` selon la police réelle et renvoie l'espace total occupé à gauche de l'échiquier. */
    measureSpace() {
        let font;
        let gap = 6;
        if (typeof getComputedStyle === 'function') {
            if (this.label.isConnected) {
                const lcs = getComputedStyle(this.label);
                font = lcs.font || `${lcs.fontWeight || '800'} ${lcs.fontSize || '9px'} ${lcs.fontFamily || 'system-ui, sans-serif'}`;
            }
            const parent = this.el.parentElement;
            if (parent && parent.isConnected) {
                const pcs = getComputedStyle(parent);
                const parsedGap = parseFloat(pcs.columnGap || pcs.gap);
                if (Number.isFinite(parsedGap) && parsedGap >= 0) gap = parsedGap;
            }
        }
        const barWidth = measureEvalBarWidth({ font });
        this.el.style.setProperty('--eval-w', `${barWidth}px`);
        return barWidth + gap;
    }

    update(evalWhite, flipped) {
        this.measureSpace();
        const share = Math.max(0.03, Math.min(0.97, winPercent(evalWhite) / 100));
        const pct = (share * 100).toFixed(2) + '%';
        this.fill.style.height = pct;
        if (flipped) {
            this.fill.style.top = '0';
            this.fill.style.bottom = 'auto';
        } else {
            this.fill.style.top = 'auto';
            this.fill.style.bottom = '0';
        }

        const whiteAhead = evalWhite >= 0;
        const txt = evalShort(evalWhite);
        this.label.textContent = txt;
        this.label.style.color = whiteAhead ? '#0F172A' : '#FFFFFF';
        const whiteAtBottom = !flipped;
        const atBottom = whiteAhead === whiteAtBottom;
        if (atBottom) {
            this.label.style.bottom = '3px';
            this.label.style.top = 'auto';
        } else {
            this.label.style.top = '3px';
            this.label.style.bottom = 'auto';
        }

        let desc;
        if (isMateScore(evalWhite)) {
            desc = `Évaluation : mat en ${Math.max(1, Math.abs(mateIn(evalWhite)))} pour les ${evalWhite > 0 ? 'Blancs' : 'Noirs'}`;
        } else if (Math.abs(evalWhite) < 30) {
            desc = 'Évaluation : position équilibrée';
        } else {
            desc = `Évaluation : avantage ${whiteAhead ? 'Blancs' : 'Noirs'} ${txt.slice(1).replace('.', ',')}`;
        }
        this.el.setAttribute('aria-label', desc);
    }
}
