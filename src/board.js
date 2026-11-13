// Échiquier Canvas haute résolution (Retina), Barre des prises (CapturedBar) et Jauge d'évaluation (EvalBar)
// Port fidèle de Board.kt et Captured.kt (ChessDuck v1.6.0)

import {
  BISHOP, BLACK, KING, KNIGHT, Move, PAWN, QUEEN, ROOK,
  fileOf, isWhite, materialOf, rankOf, sq,
} from './chess.js';

export const COLORS = {
  night: {
    dark: true,
    bg: '#0F172A',
    surface: '#1E293B',
    surfaceHi: '#334155',
    text: '#F8FAFC',
    muted: '#94A3B8',
    outline: '#475569',
    squareLight: '#F0D9B5',
    squareDark: '#B58863',
    coordOnLight: '#B58863',
    coordOnDark: '#F0D9B5',
    select: '#10B981',
    gold: '#F59E0B',
    green: '#10B981',
    blue: '#38BDF8',
    red: '#EF4444',
    onAccent: '#0F172A',
  },
  day: {
    dark: false,
    bg: '#F8FAFC',
    surface: '#E2E8F0',
    surfaceHi: '#CBD5E1',
    text: '#0F172A',
    muted: '#475569',
    outline: '#94A3B8',
    squareLight: '#F0D9B5',
    squareDark: '#B58863',
    coordOnLight: '#B58863',
    coordOnDark: '#F0D9B5',
    select: '#10B981',
    gold: '#F59E0B',
    green: '#10B981',
    blue: '#38BDF8',
    red: '#EF4444',
    onAccent: '#0F172A',
  },
  kid: {
    dark: false,
    bg: '#EBF6FF',
    surface: '#FFFFFF',
    surfaceHi: '#D6ECFF',
    text: '#1F3B57',
    muted: '#5B7A99',
    outline: '#9CC9F0',
    squareLight: '#FFFDF2',
    squareDark: '#98DDCA',
    coordOnLight: '#3FA98F',
    coordOnDark: '#1F7A66',
    select: '#FF9F1C',
    gold: '#F59E0B',
    green: '#10B981',
    blue: '#38BDF8',
    red: '#EF4444',
    onAccent: '#0F172A',
  },
};

export const PIECE_URLS = {
  [KING]: 'assets/pieces/p_wk.png',
  [QUEEN]: 'assets/pieces/p_wq.png',
  [ROOK]: 'assets/pieces/p_wr.png',
  [BISHOP]: 'assets/pieces/p_wb.png',
  [KNIGHT]: 'assets/pieces/p_wn.png',
  [PAWN]: 'assets/pieces/p_wp.png',
  [KING + BLACK]: 'assets/pieces/p_bk.png',
  [QUEEN + BLACK]: 'assets/pieces/p_bq.png',
  [ROOK + BLACK]: 'assets/pieces/p_br.png',
  [BISHOP + BLACK]: 'assets/pieces/p_bb.png',
  [KNIGHT + BLACK]: 'assets/pieces/p_bn.png',
  [PAWN + BLACK]: 'assets/pieces/p_bp.png',
};

export const KID_PIECE_URLS = {
  ...PIECE_URLS,
  [KNIGHT]: 'assets/pieces/p_wg.png',
  [KNIGHT + BLACK]: 'assets/pieces/p_bg.png',
};

const loadedImages = new Map();
let preloadPromise = null;

export function preloadAssets() {
  if (preloadPromise) return preloadPromise;
  const urls = new Set([
    ...Object.values(PIECE_URLS),
    ...Object.values(KID_PIECE_URLS),
    'assets/mascot.png',
  ]);
  preloadPromise = Promise.all(
    [...urls].map(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            loadedImages.set(url, img);
            resolve(img);
          };
          img.onerror = () => resolve(null);
          img.src = url;
        }),
    ),
  );
  return preloadPromise;
}

export function getPieceImg(piece, kid = false) {
  const url = (kid ? KID_PIECE_URLS : PIECE_URLS)[piece];
  return url ? loadedImages.get(url) || null : null;
}

export function getMascotImg() {
  return loadedImages.get('assets/mascot.png') || null;
}

let animCounter = 0;
export const nextAnimId = () => ++animCounter;

export function moveAnim(before, m) {
  const slides = [{ from: m.from, to: m.to }];
  if (before.isCastle(m)) {
    if (fileOf(m.to) === 6) slides.push({ from: m.to + 1, to: m.to - 1 });
    else slides.push({ from: m.to - 2, to: m.to + 1 });
  }
  return { id: nextAnimId(), slides };
}

export function undoAnim(before, m) {
  return {
    id: nextAnimId(),
    slides: moveAnim(before, m).slides.map((s) => ({ from: s.to, to: s.from })),
  };
}

export const CAPTURE_BADGE_COLOR = '#475569';

export function captureBadge(before, m) {
  return before.isCapture(m) ? { sq: m.to, text: '✕', color: CAPTURE_BADGE_COLOR } : null;
}

// FastOutSlowIn cubic-bezier(0.4, 0.0, 0.2, 1.0)
function fastOutSlowIn(x) {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function drawArrowOnCtx(ctx, a, s, centerFn, widthFactor = 0.17) {
  const df = Math.abs(fileOf(a.to) - fileOf(a.from));
  const dr = Math.abs(rankOf(a.to) - rankOf(a.from));
  const pts = [centerFn(a.from)];
  if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) {
    pts.push(dr === 2 ? centerFn(sq(fileOf(a.from), rankOf(a.to))) : centerFn(sq(fileOf(a.to), rankOf(a.from))));
  }
  pts.push(centerFn(a.to));

  const unit = (p, q) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.max(0.001, Math.hypot(dx, dy));
    return { x: dx / len, y: dy / len };
  };

  const n = pts.length;
  const uStart = unit(pts[0], pts[1]);
  const uEnd = unit(pts[n - 2], pts[n - 1]);
  const width = s * widthFactor;
  const head = s * 0.42 * Math.max(0.8, Math.min(1, widthFactor / 0.17));
  const start = { x: pts[0].x + uStart.x * (s * 0.28), y: pts[0].y + uStart.y * (s * 0.28) };
  const tip = { x: pts[n - 1].x + uEnd.x * (s * 0.12), y: pts[n - 1].y + uEnd.y * (s * 0.12) };
  const shaftEnd = { x: tip.x - uEnd.x * (head * 0.85), y: tip.y - uEnd.y * (head * 0.85) };

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 1; i < n - 1; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();

  const ang = Math.atan2(uEnd.y, uEnd.x);
  const spread = 0.52;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - head * Math.cos(ang - spread), tip.y - head * Math.sin(ang - spread));
  ctx.lineTo(tip.x - head * Math.cos(ang + spread), tip.y - head * Math.sin(ang + spread));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawBadgeOnCtx(ctx, b, cx, cy, s) {
  const r = s * 0.19;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.33)';
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.12, r * 1.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const fontSize = b.text.length > 1 ? r * 1.02 : r * 1.28;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.text, cx, cy + r * 0.04);
  ctx.restore();
}

/**
 * Composant DOM ChessBoard interactif.
 */
export class ChessBoardView {
  constructor(container, { feedback = null, onMove = () => {} } = {}) {
    this.container = container;
    this.feedback = feedback;
    this.onMove = onMove;

    this.root = document.createElement('div');
    this.root.className = 'chess-board-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chess-board-canvas';
    this.root.appendChild(this.canvas);

    this.promoOverlay = document.createElement('div');
    this.promoOverlay.className = 'promo-overlay hidden';
    this.root.appendChild(this.promoOverlay);

    this.container.appendChild(this.root);

    this.state = {
      position: null,
      colors: COLORS.night,
      flipped: false,
      interactive: false,
      lastMove: null,
      anim: null,
      arrows: [],
      marks: [],
      badges: [],
      kid: false,
    };

    this.selected = -1;
    this.dragFrom = -1;
    this.dragPos = { x: 0, y: 0 };
    this.dragIsTouch = false;
    this.promo = null;
    this.skipMove = null;
    this.runningAnimId = -1;
    this.animProgress = 1;
    this.rafId = 0;
    this.sizePx = 0;

    preloadAssets().then(() => this.draw());
    this._bindEvents();
  }

  setState(next) {
    const posChanged = this.state.position !== next.position;
    const prevAnimId = this.state.anim?.id ?? -1;
    this.state = { ...this.state, ...next };
    if (posChanged) {
      this.selected = -1;
      this.dragFrom = -1;
      this.promo = null;
      this._renderPromo();
    }
    const anim = this.state.anim;
    if (anim && anim.id !== this.runningAnimId) {
      this.runningAnimId = anim.id;
      const isSkip =
        this.skipMove &&
        anim.slides.some((sl) => sl.from === this.skipMove.from && sl.to === this.skipMove.to);
      if (isSkip) {
        this.skipMove = null;
        this.animProgress = 1;
        this.feedback?.move();
        this.draw();
      } else {
        this._startAnim(anim.id);
      }
    } else if (!anim && prevAnimId !== -1) {
      this.animProgress = 1;
      cancelAnimationFrame(this.rafId);
      this.draw();
    } else {
      this.draw();
    }
  }

  resize(sidePx) {
    if (!sidePx || sidePx <= 0) return;
    this.sizePx = sidePx;
    this.root.style.width = `${sidePx}px`;
    this.root.style.height = `${sidePx}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(sidePx * dpr);
    if (this.canvas.width !== w || this.canvas.height !== w) {
      this.canvas.width = w;
      this.canvas.height = w;
    }
    this.draw();
  }

  _startAnim(animId) {
    cancelAnimationFrame(this.rafId);
    const t0 = performance.now();
    const dur = 180;
    this.animProgress = 0;
    const step = (now) => {
      if (this.runningAnimId !== animId) return;
      const raw = (now - t0) / dur;
      if (raw >= 1) {
        this.animProgress = 1;
        this.draw();
        this.feedback?.move();
        return;
      }
      this.animProgress = fastOutSlowIn(raw);
      this.draw();
      this.rafId = requestAnimationFrame(step);
    };
    this.draw();
    this.rafId = requestAnimationFrame(step);
  }

  _tryMove(from, to, viaDrag) {
    const pos = this.state.position;
    if (!pos) return false;
    const cands = pos.legalMoves.filter((m) => m.from === from && m.to === to);
    if (cands.length === 0) return false;
    if (cands.length > 1) {
      this.promo = { from, to };
      this._renderPromo();
    } else {
      if (viaDrag) this.skipMove = cands[0];
      this.selected = -1;
      this.onMove(cands[0]);
    }
    return true;
  }

  _renderPromo() {
    if (!this.promo || !this.state.position) {
      this.promoOverlay.classList.add('hidden');
      this.promoOverlay.innerHTML = '';
      return;
    }
    const { from, to } = this.promo;
    const white = this.state.position.whiteToMove;
    const { colors, kid } = this.state;
    const urls = kid ? KID_PIECE_URLS : PIECE_URLS;
    this.promoOverlay.classList.remove('hidden');
    this.promoOverlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'promo-box';
    box.style.background = colors.surface;
    for (const type of [QUEEN, ROOK, BISHOP, KNIGHT]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'promo-piece-btn';
      btn.style.background = colors.squareLight;
      const img = document.createElement('img');
      img.src = urls[white ? type : type + BLACK];
      img.alt = '';
      btn.appendChild(img);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.promo = null;
        this.selected = -1;
        this._renderPromo();
        this.onMove(new Move(from, to, type));
      });
      box.appendChild(btn);
    }
    this.promoOverlay.appendChild(box);
  }

  _bindEvents() {
    this.promoOverlay.addEventListener('click', () => {
      this.promo = null;
      this._renderPromo();
    });

    const atPoint = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const s = rect.width / 8;
      const col = Math.max(0, Math.min(7, Math.floor(x / s)));
      const row = Math.max(0, Math.min(7, Math.floor(y / s)));
      const q = this.state.flipped ? sq(7 - col, row) : sq(col, 7 - row);
      return { q, x, y, width: rect.width, height: rect.height };
    };

    let activeId = null;
    let downPt = null;
    let sqDown = -1;
    let ownDown = false;
    let dragging = false;
    const SLOP = 7;

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.state.interactive || this.promo || !this.state.position) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      activeId = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch {}
      const pt = atPoint(e.clientX, e.clientY);
      downPt = pt;
      sqDown = pt.q;
      const piece = this.state.position.at(sqDown);
      ownDown = piece !== 0 && isWhite(piece) === this.state.position.whiteToMove;
      dragging = false;
      this.dragIsTouch = e.pointerType === 'touch';
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (activeId !== e.pointerId || !downPt) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (ownDown && !dragging && Math.hypot(x - downPt.x, y - downPt.y) > SLOP) {
        dragging = true;
        this.selected = sqDown;
        this.dragFrom = sqDown;
      }
      if (dragging) {
        this.dragPos = { x, y };
        this.draw();
      }
    });

    const endGesture = (e, cancelled) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      const pt = atPoint(e.clientX, e.clientY);
      if (dragging) {
        this.dragFrom = -1;
        const inside = !cancelled && pt.x >= 0 && pt.y >= 0 && pt.x <= pt.width && pt.y <= pt.height;
        if (inside && pt.q !== sqDown) {
          this._tryMove(sqDown, pt.q, true);
        }
        this.draw();
      } else if (!cancelled) {
        if (this.selected >= 0 && this.selected !== pt.q && this._tryMove(this.selected, pt.q, false)) {
          // coup joué par toucher-relâcher
        } else if (ownDown) {
          this.selected = this.selected === sqDown ? -1 : sqDown;
          this.draw();
        } else {
          this.selected = -1;
          this.draw();
        }
      }
      downPt = null;
      dragging = false;
    };

    this.canvas.addEventListener('pointerup', (e) => endGesture(e, false));
    this.canvas.addEventListener('pointercancel', (e) => endGesture(e, true));
  }

  draw() {
    const pos = this.state.position;
    const width = this.canvas.width;
    if (!pos || width <= 0) return;
    const ctx = this.canvas.getContext('2d');
    const c = this.state.colors;
    const { flipped, interactive, lastMove, anim, arrows, marks, badges, kid } = this.state;
    const s = width / 8;
    const dpr = width / (this.sizePx || width);

    const topLeft = (q) => {
      const col = flipped ? 7 - fileOf(q) : fileOf(q);
      const row = flipped ? rankOf(q) : 7 - rankOf(q);
      return { x: col * s, y: row * s };
    };
    const center = (q) => {
      const tl = topLeft(q);
      return { x: tl.x + s / 2, y: tl.y + s / 2 };
    };

    ctx.clearRect(0, 0, width, width);

    // 1. Cases
    for (let q = 0; q < 64; q++) {
      const light = (fileOf(q) + rankOf(q)) % 2 === 1;
      ctx.fillStyle = light ? c.squareLight : c.squareDark;
      const tl = topLeft(q);
      ctx.fillRect(tl.x, tl.y, s + 0.5, s + 0.5);
    }

    // 2. Dernier coup
    if (lastMove) {
      ctx.fillStyle = 'rgba(247, 236, 94, 0.40)';
      const f = topLeft(lastMove.from);
      const t = topLeft(lastMove.to);
      ctx.fillRect(f.x, f.y, s, s);
      ctx.fillRect(t.x, t.y, s, s);
    }

    // 3. Marques
    for (const [q, col] of marks) {
      ctx.fillStyle = hexToRgba(col, 0.62);
      const tl = topLeft(q);
      ctx.fillRect(tl.x, tl.y, s, s);
    }

    // 4. Roi en échec
    if (pos.inCheck) {
      const k = pos.kingSquare(pos.whiteToMove);
      if (k >= 0) {
        const kc = center(k);
        const tl = topLeft(k);
        const grad = ctx.createRadialGradient(kc.x, kc.y, 0, kc.x, kc.y, s * 0.62);
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.90)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0.00)');
        ctx.fillStyle = grad;
        ctx.fillRect(tl.x, tl.y, s, s);
      }
    }

    // 5. Coordonnées intégrées en bordure des cases
    const coordFontFamily = kid ? "'Fredoka', system-ui, sans-serif" : 'system-ui, -apple-system, sans-serif';
    ctx.font = `700 ${s * 0.21}px ${coordFontFamily}`;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < 8; i++) {
      const fileSq = flipped ? sq(i, 7) : sq(i, 0);
      const rankSq = flipped ? sq(7, i) : sq(0, i);
      const lightF = (fileOf(fileSq) + rankOf(fileSq)) % 2 === 1;
      const ftl = topLeft(fileSq);
      ctx.fillStyle = lightF ? c.coordOnLight : c.coordOnDark;
      ctx.textAlign = 'right';
      ctx.fillText(String.fromCharCode(97 + i), ftl.x + s * 0.94, ftl.y + s * 0.93);

      const lightR = (fileOf(rankSq) + rankOf(rankSq)) % 2 === 1;
      const rtl = topLeft(rankSq);
      ctx.fillStyle = lightR ? c.coordOnLight : c.coordOnDark;
      ctx.textAlign = 'left';
      ctx.fillText(String(1 + i), rtl.x + s * 0.06, rtl.y + s * 0.23);
    }

    // 6. Sélection et case survolée
    const targets = this.selected >= 0 && interactive ? pos.legalFrom(this.selected) : [];
    if (this.selected >= 0 && interactive) {
      ctx.fillStyle = hexToRgba(c.select, 0.5);
      const tl = topLeft(this.selected);
      ctx.fillRect(tl.x, tl.y, s, s);
    }
    if (this.dragFrom >= 0) {
      const dx = this.dragPos.x * dpr;
      const dy = this.dragPos.y * dpr;
      const col = Math.max(0, Math.min(7, Math.floor(dx / s)));
      const row = Math.max(0, Math.min(7, Math.floor(dy / s)));
      const hover = flipped ? sq(7 - col, row) : sq(col, 7 - row);
      if (targets.some((m) => m.to === hover)) {
        const htl = topLeft(hover);
        const hc = center(hover);
        ctx.fillStyle = hexToRgba(c.select, 0.6);
        ctx.fillRect(htl.x, htl.y, s, s);
        ctx.fillStyle = hexToRgba(c.select, 0.2);
        ctx.beginPath();
        ctx.arc(hc.x, hc.y, s * 0.95, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Pièces statiques
    const drawPiece = (piece, x, y, scale = 1) => {
      const img = getPieceImg(piece, kid);
      if (!img) return;
      const d = s * scale;
      ctx.drawImage(img, x - (d - s) / 2, y - (d - s) / 2, d, d);
    };

    const sliding = anim && this.animProgress < 1 ? anim.slides : [];
    for (let q = 0; q < 64; q++) {
      const piece = pos.at(q);
      if (piece === 0 || q === this.dragFrom || sliding.some((sl) => sl.to === q)) continue;
      const tl = topLeft(q);
      drawPiece(piece, tl.x, tl.y);
    }

    // 8. Destinations légales (pastilles et anneaux)
    const seenTargets = new Set();
    for (const m of targets) {
      if (seenTargets.has(m.to)) continue;
      seenTargets.add(m.to);
      const tc = center(m.to);
      ctx.save();
      if (pos.isCapture(m)) {
        ctx.strokeStyle = hexToRgba(c.select, 0.7);
        ctx.lineWidth = s * 0.09;
        ctx.beginPath();
        ctx.arc(tc.x, tc.y, s * 0.43, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = hexToRgba(c.select, 0.7);
        ctx.beginPath();
        ctx.arc(tc.x, tc.y, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 9. Pièces en animation
    for (const sl of sliding) {
      const piece = pos.at(sl.to);
      if (piece !== 0) {
        const a = topLeft(sl.from);
        const b = topLeft(sl.to);
        const t = this.animProgress;
        drawPiece(piece, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }

    // 10. Flèches
    for (const a of arrows) drawArrowOnCtx(ctx, a, s, center, 0.17);

    // 11. Badges
    const seenBadges = new Set();
    for (const b of badges) {
      const right = !seenBadges.has(b.sq);
      seenBadges.add(b.sq);
      const tl = topLeft(b.sq);
      drawBadgeOnCtx(ctx, b, tl.x + (right ? s * 0.80 : s * 0.20), tl.y + s * 0.20, s);
    }

    // 12. Pièce en cours de glissement (surélevée au-dessus du doigt sur tactile)
    if (this.dragFrom >= 0) {
      const piece = pos.at(this.dragFrom);
      const dx = this.dragPos.x * dpr;
      const dy = this.dragPos.y * dpr;
      const liftY = this.dragIsTouch ? s * 1.25 : s * 0.5;
      const atX = dx - s / 2;
      const atY = dy - liftY;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(atX + s * 0.5, atY + s * 1.12, s * 0.38, s * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      drawPiece(piece, atX, atY, 1.3);
    }
  }
}

/**
 * Barre des pièces capturées et avantage matériel (port fidèle de Captured.kt).
 */
export class CapturedBarView {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'captured-bar-canvas';
    this.container.appendChild(this.canvas);
    this.state = { position: null, colors: COLORS.night, kid: false };
    this.widthPx = 0;
    this.tintCache = new Map();
    preloadAssets().then(() => this.draw());
  }

  setState(next) {
    this.state = { ...this.state, ...next };
    this.draw();
  }

  resize(widthPx) {
    if (!widthPx || widthPx <= 0) return;
    this.widthPx = widthPx;
    const h = this.state.kid ? 34 : 28;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.style.width = `${widthPx}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(widthPx * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.draw();
  }

  _getTinted(piece, kid, color) {
    const key = `${piece}:${kid ? 1 : 0}:${color}`;
    if (this.tintCache.has(key)) return this.tintCache.get(key);
    const img = getPieceImg(piece, kid);
    if (!img) return null;
    const off = document.createElement('canvas');
    off.width = 64;
    off.height = 64;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, 64, 64);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = color;
    octx.fillRect(0, 0, 64, 64);
    this.tintCache.set(key, off);
    return off;
  }

  draw() {
    const { position, colors, kid } = this.state;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!position || w <= 0 || h <= 0) return;
    const ctx = this.canvas.getContext('2d');
    const dpr = w / (this.widthPx || w);
    const m = materialOf(position);

    ctx.clearRect(0, 0, w, h);

    // Fond + bordure arrondie
    const radius = (kid ? 16 : 8) * dpr;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, radius);
    ctx.clip();
    ctx.fillStyle = kid ? '#FFFFFF' : colors.surface;
    ctx.fillRect(0, 0, w, h);
    if (kid) {
      ctx.strokeStyle = '#9CC9F0';
      ctx.lineWidth = 2.5 * dpr * 2;
      ctx.stroke();
    }
    ctx.restore();

    const pad = (kid ? 12 : 8) * dpr;
    const avail = w - 2 * pad;

    const groupBy = (arr) => {
      const map = new Map();
      for (const p of arr) {
        if (!map.has(p)) map.set(p, []);
        map.get(p).push(p);
      }
      return [...map.values()];
    };

    const left = groupBy(m.blackLost);
    const right = groupBy(m.whiteLost);
    const scoreText = m.diff !== 0 ? `+${Math.abs(m.diff)}` : null;
    const fontFamily = kid ? "'Fredoka', system-ui, sans-serif" : 'system-ui, -apple-system, sans-serif';
    ctx.font = `700 ${14 * dpr}px ${fontFamily}`;
    const scoreWidth = scoreText ? ctx.measureText(scoreText).width : 0;
    const scoreW = scoreText ? scoreWidth + 6 * dpr : 0;
    const middle = 10 * dpr;

    let piece = (kid ? 22 : 20) * dpr;
    let gap = 4 * dpr;
    let step = piece - 5 * dpr;
    const groups = left.length + right.length;
    const extra = left.reduce((s, g) => s + g.length - 1, 0) + right.reduce((s, g) => s + g.length - 1, 0);
    const gaps = Math.max(0, left.length - 1) + Math.max(0, right.length - 1);
    const total = () => groups * piece + extra * step + gaps * gap + scoreW + middle;

    if (total() > avail && extra > 0) {
      step = Math.max(piece * 0.24, Math.min(step, (avail - (groups * piece + gaps * gap + scoreW + middle)) / extra));
    }
    if (total() > avail) gap = 2 * dpr;
    if (total() > avail) {
      const k = (avail - scoreW - middle) / Math.max(1, total() - scoreW - middle);
      piece *= k;
      step *= k;
      gap *= k;
    }

    const top = (h - piece) / 2;

    const drawPiece = (p, x) => {
      const img = getPieceImg(p, kid);
      if (!img) return;
      const halo =
        colors.dark && !isWhite(p)
          ? 'rgba(255,255,255,0.8)'
          : !colors.dark && isWhite(p)
            ? 'rgba(0,0,0,0.6)'
            : null;
      if (halo) {
        const tint = this._getTinted(p, kid, halo);
        if (tint) {
          const r = 1.2 * dpr;
          const dirs = [
            [-r, 0], [r, 0], [0, -r], [0, r],
            [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, r * 0.7],
          ];
          for (const [dx, dy] of dirs) ctx.drawImage(tint, x + dx, top + dy, piece, piece);
        }
      }
      ctx.drawImage(img, x, top, piece, piece);
    };

    const widthOf = (gs) =>
      gs.reduce((acc, g) => acc + piece + (g.length - 1) * step, 0) + Math.max(0, gs.length - 1) * gap;

    const drawGroups = (gs, start) => {
      let x = start;
      for (const g of gs) {
        for (const p of g) {
          drawPiece(p, x);
          x += step;
        }
        x += piece - step + gap;
      }
    };

    ctx.fillStyle = kid ? '#1F3B57' : colors.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    drawGroups(left, pad);
    if (scoreText && m.diff > 0) {
      ctx.fillText(scoreText, pad + widthOf(left) + (left.length === 0 ? 0 : 6 * dpr), h / 2);
    }

    const rightStart = w - pad - widthOf(right);
    drawGroups(right, rightStart);
    if (scoreText && m.diff < 0) {
      ctx.fillText(scoreText, rightStart - scoreWidth - (right.length === 0 ? 0 : 6 * dpr), h / 2);
    }
  }
}
