import {
    KING, Line, PAWN, fileOf, isWhite, pieceType, rankOf, sqName,
} from '../core/chess.js';
import { PieceLexiconFr } from '../core/piece-fr.js';
import { PuzzleThemes } from '../core/puzzle-themes.js';
import { BoardGeometry } from '../ui/board-geometry.js';
import { pieceStore } from '../ui/pieces.js';
import { DuckPalette, hexToRgba } from '../ui/theme.js';

function drawRoundRect(ctx, x, y, w, h, r) {
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

export const ShareFormat = {
    PORTRAIT: { name: 'PORTRAIT', height: 1350, label: 'Portrait 4:5' },
    SQUARE: { name: 'SQUARE', height: 1080, label: 'Carré 1:1' },
};

export function shareStyleFromSettings(settings) {
    const fmt = settings?.shareFormat === 'SQUARE' ? ShareFormat.SQUARE : ShareFormat.PORTRAIT;
    return {
        format: fmt,
        light: Boolean(settings?.shareLight),
        palette: DuckPalette.of(settings?.palette ?? 0),
    };
}

const W = 1080;
const M = 44;
const FOOTER_H = 62;
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function buildPal(style) {
    const light = Boolean(style?.light);
    const palEntry = style?.palette || DuckPalette.SLATE_GOLD;
    const c = palEntry.colors(!light);
    return {
        light,
        bgTop: light ? c.surface : c.surfaceHi,
        bgBottom: c.bg,
        texture: light ? hexToRgba(c.text, 0.039) : 'rgba(255, 255, 255, 0.035)',
        halo: hexToRgba(c.gold, 0.18),
        text: c.text,
        body: c.text,
        soft: c.muted,
        muted: c.muted,
        faint: c.muted,
        surface: c.surface,
        stroke: c.outline,
        dotOff: c.surfaceHi,
        shadow: light ? hexToRgba(c.text, 0.24) : 'rgba(0, 0, 0, 0.55)',
        lightSq: c.squareLight,
        darkSq: c.squareDark,
        goldText: c.goldRole.text,
        goldFill: c.goldRole.fill,
        onGold: c.goldRole.onFill,
        greenText: c.greenRole.text,
        greenFill: c.greenRole.fill,
        onGreen: c.greenRole.onFill,
        redText: c.redRole.text,
        redFill: c.redRole.fill,
        onRed: c.redRole.onFill,
    };
}

let mascotPromise = null;
function loadMascot() {
    if (!mascotPromise) {
        mascotPromise = pieceStore.loadImage('./assets/mascot.png');
    }
    return mascotPromise;
}

class Painter {
    constructor(cv, pal, mascotImg) {
        this.cv = cv;
        this.ctx = cv.getContext('2d');
        this.pal = pal;
        this.mascotImg = mascotImg;
    }

    _setFont(size, bold = false) {
        this.ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
    }

    text(s, x, y, size, color, { bold = false, align = 'left' } = {}) {
        const ctx = this.ctx;
        this._setFont(size, bold);
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(s, x, y);
        ctx.textAlign = 'left';
    }

    width(s, size, bold = false) {
        this._setFont(size, bold);
        return this.ctx.measureText(s).width;
    }

    wrap(s, size, maxWidth, bold = false) {
        this._setFont(size, bold);
        const out = [];
        let cur = '';
        for (const w of s.split(' ')) {
            const cand = cur ? `${cur} ${w}` : w;
            if (this.ctx.measureText(cand).width > maxWidth && cur) {
                out.push(cur);
                cur = w;
            } else {
                cur = cand;
            }
        }
        if (cur) out.push(cur);
        return out;
    }

    background(h) {
        const ctx = this.ctx;
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, this.pal.bgTop);
        grad.addColorStop(1, this.pal.bgBottom);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, h);

        const s = 72;
        ctx.fillStyle = this.pal.texture;
        let row = 0;
        for (let y = 0; y < h; y += s) {
            for (let x = row % 2 === 0 ? 0 : s; x < W; x += 2 * s) {
                ctx.fillRect(x, y, s, s);
            }
            row++;
        }

        const rg = ctx.createRadialGradient(W * 0.5, 100, 0, W * 0.5, 100, 720);
        rg.addColorStop(0, this.pal.halo);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, h);
    }

    difficulty(rating, right, y) {
        const band = PuzzleThemes.bandOf(rating);
        const r = 9;
        let x = right - r;
        const ctx = this.ctx;
        for (let i = 4; i >= 1; i--) {
            ctx.fillStyle = i <= band ? this.pal.goldFill : this.pal.dotOff;
            ctx.beginPath();
            ctx.arc(x, y - 11, r, 0, Math.PI * 2);
            ctx.fill();
            x -= 2 * r + 8;
        }
        this.text(`${PuzzleThemes.BANDS[band]} · ${rating}`, x - 6, y, 30, this.pal.soft, { align: 'right' });
    }

    sideDot(cx, cy, r, white) {
        const ctx = this.ctx;
        ctx.fillStyle = white ? '#FFFFFF' : '#020617';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.pal.light ? '#475569' : this.pal.muted;
        ctx.lineWidth = 4;
        ctx.stroke();
    }

    panel(x, y, w, h, accent = null) {
        const ctx = this.ctx;
        ctx.save();
        ctx.shadowColor = this.pal.light ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = this.pal.surface;
        ctx.beginPath();
        drawRoundRect(ctx, x, y, w, h, 28);
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = this.pal.stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        drawRoundRect(ctx, x, y, w, h, 28);
        ctx.stroke();

        if (accent) {
            ctx.save();
            ctx.beginPath();
            drawRoundRect(ctx, x, y, w, h, 28);
            ctx.clip();
            ctx.fillStyle = accent;
            ctx.fillRect(x, y, 8, h);
            ctx.restore();
        }
    }

    footer(h, id) {
        const y = h - 24;
        if (this.mascotImg) {
            this.ctx.drawImage(this.mascotImg, M, y - 34, 42, 42);
        }
        this.text('ChessDuck', M + 52, y, 26, this.pal.soft, { bold: true });
        this.text(`Lichess #${id}`, M + 52 + this.width('ChessDuck', 26, true) + 16, y, 24, this.pal.faint);
        this.text('© Ivan Herboch, 2026', W - M, y, 24, this.pal.faint, { align: 'right' });
    }

    board(left, top, side, position, flipped, lastMove, glow = -1) {
        const ctx = this.ctx;
        const s = side / 8;
        const radius = side * 0.018;
        const x = (q) => left + BoardGeometry.column(q, flipped) * s;
        const y = (q) => top + BoardGeometry.row(q, flipped) * s;

        ctx.save();
        ctx.shadowColor = this.pal.shadow;
        ctx.shadowBlur = side * 0.03;
        ctx.shadowOffsetY = side * 0.012;
        ctx.fillStyle = this.pal.darkSq;
        ctx.beginPath();
        drawRoundRect(ctx, left, top, side, side, radius);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        drawRoundRect(ctx, left, top, side, side, radius);
        ctx.clip();

        for (let q = 0; q < 64; q++) {
            ctx.fillStyle = (fileOf(q) + rankOf(q)) % 2 === 1 ? this.pal.lightSq : this.pal.darkSq;
            ctx.fillRect(x(q), y(q), s + 0.5, s + 0.5);
        }
        if (lastMove) {
            ctx.fillStyle = 'rgba(247, 236, 94, 0.47)';
            ctx.fillRect(x(lastMove.from), y(lastMove.from), s, s);
            ctx.fillRect(x(lastMove.to), y(lastMove.to), s, s);
        }
        if (glow >= 0) {
            const cx = x(glow) + s / 2;
            const cy = y(glow) + s / 2;
            const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.8);
            rg.addColorStop(0, 'rgba(239, 68, 68, 0.90)');
            rg.addColorStop(0.55, 'rgba(239, 68, 68, 0.47)');
            rg.addColorStop(1, 'rgba(239, 68, 68, 0)');
            ctx.fillStyle = rg;
            ctx.fillRect(cx - s, cy - s, 2 * s, 2 * s);
        }

        if (s >= 70) {
            ctx.font = `700 ${s * 0.2}px ${FONT}`;
            ctx.textBaseline = 'alphabetic';
            for (let i = 0; i < 8; i++) {
                const fq = flipped ? (7 - i) + 7 * 8 : i;
                ctx.fillStyle = (fileOf(fq) + rankOf(fq)) % 2 === 1 ? this.pal.darkSq : this.pal.lightSq;
                ctx.fillText(String.fromCharCode(97 + fileOf(fq)), x(fq) + s * 0.80, y(fq) + s * 0.92);
                const rq = flipped ? 7 + (7 - i) * 8 : i * 8;
                ctx.fillStyle = (fileOf(rq) + rankOf(rq)) % 2 === 1 ? this.pal.darkSq : this.pal.lightSq;
                ctx.fillText(String.fromCharCode(49 + rankOf(rq)), x(rq) + s * 0.07, y(rq) + s * 0.25);
            }
        }

        for (let q = 0; q < 64; q++) {
            const p = position.board[q];
            if (p !== 0) {
                const img = pieceStore.getPieceImage(p, false);
                if (img) ctx.drawImage(img, x(q), y(q), s, s);
            }
        }
        ctx.restore();

        ctx.strokeStyle = this.pal.light ? 'rgba(15, 23, 42, 0.16)' : 'rgba(255, 255, 255, 0.20)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        drawRoundRect(ctx, left, top, side, side, radius);
        ctx.stroke();

        return (q) => [x(q), y(q)];
    }

    arrow(m, at, s, color, widthFactor) {
        const ctx = this.ctx;
        const squares = BoardGeometry.arrowSquares(m.from, m.to);
        const cx = squares.map((q) => at(q)[0] + s / 2);
        const cy = squares.map((q) => at(q)[1] + s / 2);
        const head = s * 0.42 * Math.max(0.8, Math.min(1, widthFactor / 0.17));
        const shape = BoardGeometry.arrowShape(cx, cy, s, head);
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = s * widthFactor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = s * 0.06;
        ctx.shadowOffsetY = s * 0.02;
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
        ctx.restore();
    }

    badge(label, cx, cy, r, color, textColor = '#FFFFFF') {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.33)';
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.12, r * 1.08, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        this._setFont(r * 1.3, true);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(label, cx, cy + r * 0.46);
        ctx.textAlign = 'left';
    }

    pill(label, x, y, size, bg, fg) {
        const w = this.width(label, size, true) + size * 1.4;
        this.ctx.fillStyle = bg;
        this.ctx.beginPath();
        drawRoundRect(this.ctx, x, y, w, size * 1.7, size * 0.85);
        this.ctx.fill();
        this.text(label, x + size * 0.7, y + size * 1.2, size, fg, { bold: true });
        return w;
    }
}

const EYEBROW_Y = 64;

function coups(n) {
    return n > 1 ? `${n} coups` : '1 coup';
}

function fitTitle(p, text, max) {
    const width = W - 2 * M - 56;
    let size = max;
    while (size > 44 && p.width(text, size, true) > width) size -= 2;
    return [p.wrap(text, size, width, true), size];
}

function headerHeight(lines, size) {
    return EYEBROW_Y + size * 1.3 + (lines - 1) * size * 1.15 + size * 0.32;
}

function drawHeader(g, eyebrow, eyebrowColor, puzzle, title, size, playerWhite) {
    g.text(eyebrow.toUpperCase(), M, EYEBROW_Y, 28, eyebrowColor, { bold: true });
    g.difficulty(puzzle.rating, W - M, EYEBROW_Y);
    let y = EYEBROW_Y + size * 1.3;
    g.sideDot(M + 18, y - size * 0.36, 18, playerWhite);
    title.forEach((l, i) => {
        if (i > 0) y += size * 1.15;
        g.text(l, M + 54, y, size, g.pal.text, { bold: true });
    });
}

function canvasToBlob(canvas) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
    });
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const ShareCard = {
    playerMoves(line) {
        return Math.max(1, Math.trunc(line.size / 2));
    },

    challenge(puzzle, line, playerWhite) {
        const who = playerWhite ? 'Les Blancs' : 'Les Noirs';
        const lastSan = line.sans[line.sans.length - 1] || '';
        const mate = lastSan.endsWith('#');
        if (mate) return `${who} jouent et font mat en ${this.playerMoves(line)}`;
        if (` ${puzzle.themes} `.includes(' equality ')) return `${who} jouent et sauvent la partie`;
        return `${who} jouent et gagnent`;
    },

    describe(p, m, san) {
        const type = pieceType(p.board[m.from]);
        let s;
        if (p.isCastle(m)) s = fileOf(m.to) === 6 ? 'Petit roque' : 'Grand roque';
        else if (p.isEnPassant(m)) s = `Le pion capture le pion en passant, en ${sqName(m.to)}`;
        else if (p.isCapture(m)) {
            s = `${PieceLexiconFr.definiteCapitalized(type)} capture ${PieceLexiconFr.definite(p.capturedType(m))} en ${sqName(m.to)}`;
        } else {
            s = `${PieceLexiconFr.definiteCapitalized(type)} va en ${sqName(m.to)}`;
        }
        if (m.promo !== 0) s += ` et se promeut en ${PieceLexiconFr.name(m.promo)}`;
        if (san.endsWith('#')) s += ' : échec et mat !';
        else if (san.endsWith('+')) s += ', avec échec.';
        else s += '.';
        return s;
    },

    _replyText(st) {
        const desc = this.describe(st.before.play(st.move), st.reply, st.replySan);
        return `Réponse : ${st.replySan} — ${desc[0].toLowerCase()}${desc.slice(1)}`;
    },

    async render(puzzle, position, playerWhite, lastMove, style) {
        const [, mascotImg] = await Promise.all([pieceStore.preloadSet(false), loadMascot()]);
        const pal = buildPal(style);
        const square = style.format.height === 1080;
        const h = style.format.height;
        const line = Line.fromUci(puzzle.fen, puzzle.moves);
        const theme = PuzzleThemes.primary(puzzle.themes);
        const mate = Boolean(line.sans[line.sans.length - 1]?.endsWith('#'));
        const n = this.playerMoves(line);

        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = h;
        const g = new Painter(cv, pal, mascotImg);

        const [title, titleSize] = fitTitle(g, this.challenge(puzzle, line, playerWhite), square ? 52 : 58);
        const eyebrow = mate ? "Problème d'échecs" : `Problème · ${coups(n)} à trouver`;
        const tipSize = 28;
        const tipLineH = tipSize * 1.32;
        const label = mate || !theme.tip ? 'Indice :' : `Indice · ${theme.name} :`;
        const tipText = theme.tip ? `${label} ${theme.tip}` : '';
        const tip = tipText ? g.wrap(tipText, tipSize, W - 2 * M - 48) : [];
        const tipH = !tip.length ? 0 : 28 + tip.length * tipLineH;
        const top = headerHeight(title.length, titleSize) + 6;
        const bottom = (!tip.length ? 0 : tipH + 16) + FOOTER_H + 4;
        const side = Math.min(W - 40, h - top - 16 - bottom);

        g.background(h);
        drawHeader(g, eyebrow, pal.goldText, puzzle, title, titleSize, playerWhite);
        g.board((W - side) / 2, top, side, position, !playerWhite, lastMove);

        if (tip.length) {
            const y = top + side + 16;
            g.panel(M, y, W - 2 * M, tipH, pal.goldFill);
            let ty = y + 14 + tipSize;
            tip.forEach((l, i) => {
                if (i === 0 && l.startsWith(label)) {
                    g.text(label, M + 26, ty, tipSize, pal.goldText, { bold: true });
                    g.text(l.slice(label.length), M + 26 + g.width(label, tipSize, true), ty, tipSize, pal.body);
                } else {
                    g.text(l, M + 26, ty, tipSize, pal.body);
                }
                ty += tipLineH;
            });
        }
        g.footer(h, puzzle.id);
        const blob = await canvasToBlob(cv);
        const previewUrl = blob ? URL.createObjectURL(blob) : null;
        return { canvas: cv, blob, previewUrl };
    },

    async renderSolution(puzzle, style) {
        const [, mascotImg] = await Promise.all([pieceStore.preloadSet(false), loadMascot()]);
        const pal = buildPal(style);
        const square = style.format.height === 1080;
        const h = style.format.height;
        const line = Line.fromUci(puzzle.fen, puzzle.moves);
        const playerWhite = line.positions[1].whiteToMove;
        const steps = [];
        for (let i = 1; i < line.size; i += 2) {
            steps.push({
                before: line.positions[i],
                move: line.moves[i],
                san: line.sans[i],
                prev: line.moves[i - 1],
                reply: i + 1 < line.size ? line.moves[i + 1] : null,
                replySan: i + 1 < line.size ? line.sans[i + 1] : null,
            });
        }
        const n = steps.length;

        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = h;
        const g = new Painter(cv, pal, mascotImg);

        const [title, titleSize] = fitTitle(g, this.challenge(puzzle, line, playerWhite), square ? 50 : 56);
        const top = headerHeight(title.length, titleSize) + 4;
        const legendH = 44;
        const margin = 16;
        const gap = 12;
        const gridH = h - top - legendH - FOOTER_H - 6;

        const detailed = n <= 2;
        const titleSz = n === 1 ? 40 : n <= 4 ? 34 : 30;
        const textSize = n === 1 ? 30 : n <= 2 ? 26 : 24;
        const lineH = textSize * 1.28;
        const pad = n === 1 ? 18 : 10;

        const layout = (cols) => {
            const rows = Math.ceil(n / cols);
            const panelW = (W - 2 * margin - (cols - 1) * gap) / cols;
            return { rows, panelW, textW: panelW - 2 * pad };
        };

        const captionH = (cols) => {
            const w = layout(cols).textW;
            let maxH = 0;
            steps.forEach((st, k) => {
                let hh = titleSz * 1.2 + 6;
                if (detailed) {
                    hh += g.wrap(this.describe(st.before, st.move, st.san), textSize, w).length * lineH;
                    if (st.reply && st.replySan) {
                        hh += g.wrap(this._replyText(st), textSize, w - textSize * 0.8).length * lineH;
                    }
                }
                if (k === n - 1) hh += textSize * 1.7 + 10;
                if (hh > maxH) maxH = hh;
            });
            return maxH;
        };

        const sideFor = (cols) => {
            const { rows, textW } = layout(cols);
            const panelH = (gridH - (rows - 1) * gap) / rows;
            return Math.min(textW, panelH - 2 * pad - 10 - captionH(cols));
        };

        let cols = 1;
        let bestSide = -Infinity;
        for (let c = 1; c <= Math.min(n, 3); c++) {
            const sf = sideFor(c);
            if (sf > bestSide) { bestSide = sf; cols = c; }
        }

        const { rows, panelW, textW } = layout(cols);
        const side = Math.max(120, sideFor(cols));
        const capH = captionH(cols);
        const panelH = 2 * pad + side + 10 + capH;
        const gridTop = top + Math.max(0, (gridH - rows * panelH - (rows - 1) * gap) / 2);

        g.background(h);
        drawHeader(g, `Solution · ${coups(n)}`, pal.greenText, puzzle, title, titleSize, playerWhite);

        let y = gridTop;
        for (let r = 0; r < rows; r++) {
            const inRow = [];
            for (let cIdx = 0; cIdx < cols; cIdx++) {
                if (r * cols + cIdx < n) inRow.push(cIdx);
            }
            const rowW = inRow.length * panelW + (inRow.length - 1) * gap;
            let x = (W - rowW) / 2;
            for (const cIdx of inRow) {
                const k = r * cols + cIdx;
                const st = steps[k];
                const isLast = k === n - 1;
                g.panel(x, y, panelW, panelH);
                const bx = x + pad;
                const by = y + pad;
                let glow = -1;
                if (isLast && st.san.endsWith('#')) {
                    const after = st.before.play(st.move);
                    for (let q = 0; q < 64; q++) {
                        if (after.board[q] !== 0 && pieceType(after.board[q]) === KING && isWhite(after.board[q]) !== playerWhite) {
                            glow = q;
                            break;
                        }
                    }
                }
                const at = g.board(x + (panelW - side) / 2, by, side, st.before, !playerWhite, st.prev, glow);
                const s = side / 8;
                if (st.reply) g.arrow(st.reply, at, s, pal.redFill, 0.10);
                g.arrow(st.move, at, s, pal.greenFill, 0.17);
                const [dx, dy] = at(st.move.to);
                if (st.san.endsWith('#')) g.badge('#', dx + s * 0.80, dy + s * 0.20, s * 0.22, pal.redFill, pal.onRed);
                else if (st.san.endsWith('+')) g.badge('+', dx + s * 0.80, dy + s * 0.20, s * 0.22, pal.goldFill, pal.onGold);

                const ty0 = by + side + 10 + titleSz * 0.95;
                const br = titleSz * 0.5;
                g.badge(String(k + 1), bx + br, ty0 - titleSz * 0.34, br, pal.greenFill, pal.onGreen);
                const sanX = bx + 2 * br + 10;
                g.text(st.san, sanX, ty0, titleSz, pal.text, { bold: true });
                if (!detailed && st.replySan) {
                    g.text(`— ${st.replySan}`, sanX + g.width(st.san, titleSz, true) + 12, ty0, titleSz * 0.85, pal.redText, { bold: true });
                }

                const victim = st.before.isEnPassant(st.move)
                    ? PAWN + (isWhite(st.before.board[st.move.from]) ? 8 : 0)
                    : st.before.board[st.move.to];
                if (victim !== 0) {
                    const ps = titleSz * 1.05;
                    const px = bx + textW - ps;
                    const py = ty0 - ps * 0.8;
                    g.ctx.fillStyle = pal.lightSq;
                    g.ctx.beginPath();
                    drawRoundRect(g.ctx, px, py, ps, ps, 10);
                    g.ctx.fill();
                    const vImg = pieceStore.getPieceImage(victim, false);
                    if (vImg) g.ctx.drawImage(vImg, px, py, ps, ps);
                    if (detailed) g.text('prend', px - 10, ty0 - titleSz * 0.12, textSize * 0.9, pal.muted, { align: 'right' });
                }

                let ty = ty0 + titleSz * 0.25;
                if (detailed) {
                    for (const l of g.wrap(this.describe(st.before, st.move, st.san), textSize, textW)) {
                        ty += lineH;
                        g.text(l, bx, ty, textSize, pal.body);
                    }
                    if (st.reply && st.replySan) {
                        const rLines = g.wrap(this._replyText(st), textSize, textW - textSize * 0.8);
                        rLines.forEach((l, i) => {
                            ty += lineH;
                            if (i === 0) {
                                g.ctx.fillStyle = pal.redFill;
                                g.ctx.beginPath();
                                g.ctx.arc(bx + textSize * 0.25, ty - textSize * 0.34, textSize * 0.2, 0, Math.PI * 2);
                                g.ctx.fill();
                            }
                            g.text(l, bx + textSize * 0.8, ty, textSize, pal.redText);
                        });
                    }
                }
                if (isLast) {
                    ty += 10;
                    if (st.san.endsWith('#')) g.pill('Échec et mat !', bx, ty, textSize, pal.goldFill, pal.onGold);
                    else g.pill('Avantage décisif', bx, ty, textSize, pal.greenFill, pal.onGreen);
                }
                x += panelW + gap;
            }
            y += panelH + gap;
        }

        const ly = h - FOOTER_H - 18;
        g.ctx.fillStyle = pal.greenFill;
        g.ctx.beginPath();
        drawRoundRect(g.ctx, M, ly - 15, 48, 12, 6);
        g.ctx.fill();
        g.text('votre coup', M + 58, ly, 25, pal.muted);

        g.ctx.fillStyle = pal.redFill;
        g.ctx.beginPath();
        drawRoundRect(g.ctx, M + 230, ly - 13, 48, 8, 4);
        g.ctx.fill();
        g.text('réponse adverse', M + 288, ly, 25, pal.muted);

        g.badge('+', M + 560, ly - 9, 14, pal.goldFill, pal.onGold);
        g.text('échec', M + 582, ly, 25, pal.muted);
        g.badge('#', M + 680, ly - 9, 14, pal.redFill, pal.onRed);
        g.text('mat', M + 702, ly, 25, pal.muted);
        g.footer(h, puzzle.id);

        const blob = await canvasToBlob(cv);
        const previewUrl = blob ? URL.createObjectURL(blob) : null;
        return { canvas: cv, blob, previewUrl };
    },

    async shareBlob(blob, filename, text) {
        if (!blob) return false;
        try {
            const file = new File([blob], filename, { type: 'image/png' });
            if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file], title: 'ChessDuck', text });
                return true;
            }
        } catch (err) {
            if (err?.name === 'AbortError') return true;
        }
        triggerDownload(blob, filename);
        return true;
    },

    saveBlob(blob, filename) {
        if (!blob) return null;
        triggerDownload(blob, filename);
        return `Image enregistrée (${filename}).`;
    },
};
