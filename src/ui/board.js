import {
    BISHOP, BLACK, KNIGHT, Move, PIECE_NAMES_FR, PIECE_VALUES, QUEEN, ROOK,
    fileOf, isWhite, pieceType, rankOf, sq, sqName,
} from '../core/chess.js';
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

/** Description TalkBack/ARIA de l'échiquier. */
export function describeBoard(p, last, selected, flipped) {
    let sb = `Échiquier, vue des ${flipped ? 'Noirs' : 'Blancs'}. Trait aux ${p.whiteToMove ? 'Blancs' : 'Noirs'}.`;
    if (p.isCheckmate) sb += ' Échec et mat.';
    else if (p.inCheck) sb += ' Échec au roi.';
    if (last) sb += ` Dernier coup : ${sqName(last.from)} vers ${sqName(last.to)}.`;
    if (selected != null && selected >= 0 && p.board[selected] !== 0) {
        const uniq = new Set(p.legalFrom(selected).map((m) => m.to));
        sb += ` Sélection : ${PIECE_NAMES_FR[pieceType(p.board[selected])]} en ${sqName(selected)}, ${uniq.size} coup${uniq.size > 1 ? 's' : ''} possible${uniq.size > 1 ? 's' : ''}.`;
    }
    for (const white of [true, false]) {
        const items = [];
        for (let i = 0; i < 64; i++) {
            const pc = p.board[i];
            if (pc !== 0 && isWhite(pc) === white) {
                items.push({ t: pieceType(pc), sq: i, val: PIECE_VALUES[pieceType(pc)] });
            }
        }
        items.sort((a, b) => b.val - a.val);
        const list = items.map((it) => `${PIECE_NAMES_FR[it.t]} ${sqName(it.sq)}`).join(', ');
        sb += ` ${white ? 'Blancs' : 'Noirs'} : ${list}.`;
    }
    return sb;
}

export function evalShort(evalWhite) {
    if (isMateScore(evalWhite)) {
        const m = Math.max(1, Math.abs(mateIn(evalWhite)));
        return `M${m}`;
    }
    const pawns = Math.abs(evalWhite) / 100.0;
    return `${evalWhite >= 0 ? '+' : '−'}${Math.abs(evalWhite) >= 1000 ? pawns.toFixed(0) : pawns.toFixed(1)}`;
}

/** Échiquier interactif HTML5 Canvas avec animation 180 ms, secousse, glisser-déposer et flèches. */
export class ChessBoardView {
    constructor() {
        this.el = document.createElement('div');
        this.el.className = 'chess-board-wrap';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'chess-board-canvas';
        this.canvas.setAttribute('role', 'img');
        this.promoEl = document.createElement('div');
        this.promoEl.className = 'promo-overlay hidden';
        this.el.append(this.canvas, this.promoEl);

        this.ctx = this.canvas.getContext('2d');
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

        this.promoEl.addEventListener('click', (e) => {
            if (e.target === this.promoEl) {
                this._promoPair = null;
                this._selected = -1;
                this._renderPromo();
                this.draw();
            }
        });
    }

    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._unbindPieceLoad();
        this._resizeObs?.disconnect();
    }

    setState(next) {
        const prevPos = this._lastPosition;
        Object.assign(this._state, next);
        pieceStore.preloadSet(this._state.kid).catch(() => {});

        const clearStaleInteraction = !this._state.interactive &&
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
            if (shouldSkip) {
                this._animT = 1;
                feedback.move();
            } else {
                this._animT = 0;
                this._animStart = performance.now();
                feedback.move();
                this._ensureLoop();
            }
        }

        if (this._state.position) {
            this.canvas.setAttribute(
                'aria-label',
                describeBoard(
                    this._state.position,
                    this._state.lastMove,
                    this._state.interactive && this._selected >= 0 ? this._selected : null,
                    this._state.flipped,
                ),
            );
        }
        this._syncCanvasSize();
        this.draw();
    }

    _syncCanvasSize() {
        const rect = this.el.getBoundingClientRect();
        const cssSide = Math.max(0, Math.round(rect.width));
        if (!cssSide) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const px = Math.round(cssSide * dpr);
        if (this.canvas.width !== px || this.canvas.height !== px) {
            this.canvas.width = px;
            this.canvas.height = px;
            this.draw();
        }
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
            this._state.onMove?.(cands[0]);
        }
        return true;
    }

    _renderPromo() {
        const pair = this._promoPair;
        const pos = this._state.position;
        if (!pair || !pos) {
            this.promoEl.classList.add('hidden');
            this.promoEl.replaceChildren();
            return;
        }
        const white = pos.whiteToMove;
        const box = document.createElement('div');
        box.className = 'promo-box';
        for (const type of [QUEEN, ROOK, BISHOP, KNIGHT]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'promo-btn';
            btn.setAttribute('aria-label', `Promouvoir en ${PIECE_NAMES_FR[type]}`);
            const img = document.createElement('img');
            img.src = pieceStore.urlFor(white ? type : type + BLACK, this._state.kid);
            img.alt = PIECE_NAMES_FR[type];
            btn.appendChild(img);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._promoPair = null;
                this._selected = -1;
                this._renderPromo();
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
            if (!this._state.interactive || this._promoPair || !this._state.position) return;
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            feedback.unlock();
            const { x, y, size } = coordsOf(e);
            if (size <= 0) return;
            const s = size / 8;
            const sqDown = BoardGeometry.squareAtXY(x, y, s, this._state.flipped);
            const piece = this._state.position.board[sqDown];
            const own = piece !== 0 && isWhite(piece) === this._state.position.whiteToMove;
            this._pointer = { id: e.pointerId, downX: x, downY: y, sqDown, own, dragging: false };
            try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        });

        this.canvas.addEventListener('pointermove', (e) => {
            const ptr = this._pointer;
            if (!ptr || e.pointerId !== ptr.id || !this._state.position || !this._state.interactive) return;
            const { x, y } = coordsOf(e);
            if (ptr.own && !ptr.dragging && Math.hypot(x - ptr.downX, y - ptr.downY) > slop) {
                ptr.dragging = true;
                this._selected = ptr.sqDown;
                this._dragFrom = ptr.sqDown;
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
            if (!pos || !this._state.interactive) {
                this._dragFrom = -1;
                this._selected = -1;
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
                    if (!this._tryMove(ptr.sqDown, target, true)) this.draw();
                } else {
                    this.draw();
                }
            } else if (this._selected >= 0 && this._selected !== ptr.sqDown && this._tryMove(this._selected, ptr.sqDown, false)) {
                // coup joué par toucher-relâcher
            } else if (ptr.own) {
                if (pos.legalFrom(ptr.sqDown).length === 0) {
                    this._selected = -1;
                    this._refuse(ptr.sqDown);
                } else {
                    this._selected = this._selected === ptr.sqDown ? -1 : ptr.sqDown;
                    this.draw();
                }
            } else {
                this._selected = -1;
                this.draw();
            }
        };

        this.canvas.addEventListener('pointerup', (e) => endPointer(e, false));
        this.canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
    }

    draw() {
        const ctx = this.ctx;
        const pos = this._state.position;
        if (!ctx || !pos) return;
        const dpr = this.canvas.width / Math.max(1, this.el.getBoundingClientRect().width || this.canvas.width);
        const cssSide = this.canvas.width / Math.max(1, dpr);
        if (cssSide <= 0) return;

        ctx.save();
        ctx.scale(dpr, dpr);

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
            ctx.fillStyle = 'rgba(247, 236, 94, 0.40)';
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
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.62);
                grad.addColorStop(0, 'rgba(239, 68, 68, 0.90)');
                grad.addColorStop(1, 'rgba(239, 68, 68, 0.00)');
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
        const drawPiece = (piece, x, y, scale = 1) => {
            const img = pieceStore.getPieceImage(piece, kid);
            if (!img) return;
            const d = s * scale;
            ctx.drawImage(img, x - (d - s) / 2, y - (d - s) / 2, d, d);
        };

        const sliding = anim && this._animT < 1 ? anim.slides : [];
        for (let q = 0; q < 64; q++) {
            const piece = pos.board[q];
            if (piece === 0 || q === this._dragFrom || sliding.some((sl) => sl.to === q)) continue;
            let [x, y] = topLeft(q);
            if (q === this._shakeSq) x += this._shakeVal * s * 0.09;
            drawPiece(piece, x, y, 1);
        }

        // 7. Coordonnées par-dessus les pièces
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
                ctx.roundRect(rx, ry, w, h, h / 3);
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
            drawPiece(piece, fx + (tx - fx) * this._animT, fy + (ty - fy) * this._animT, 1);
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

        // 12. Pièce en cours de glissement (surélevée au-dessus du doigt, x1.3)
        if (this._dragFrom >= 0) {
            const piece = pos.board[this._dragFrom];
            const ax = this._dragPos.x - s / 2;
            const ay = this._dragPos.y - s * 1.35;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(ax + s * 0.5, ay + s * 1.12, s * 0.38, s * 0.10, 0, 0, Math.PI * 2);
            ctx.fill();
            drawPiece(piece, ax, ay, 1.3);
        }

        ctx.restore();
    }
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
    }

    update(evalWhite, flipped) {
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
