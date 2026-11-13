// Génération des cartes PNG haute définition (1080 px) : énoncé du problème & solution illustrée
// Port fidèle de ShareCard.kt (ChessDuck v1.6.0)

import { Line, PAWN, fileOf, isWhite, pieceType, rankOf, sq, sqName } from './chess.js';
import { primaryTheme, BANDS, bandOf } from './themes.js';
import { drawArrowOnCtx, drawBadgeOnCtx, getMascotImg, getPieceImg, preloadAssets } from './board.js';

const W = 1080;
const LIGHT = '#F0D9B5';
const DARK = '#B58863';
const TEXT = '#F8FAFC';
const MUTED = '#94A3B8';
const GOLD = '#F59E0B';
const GREEN = '#10B981';
const BLUE = '#38BDF8';
const RED = '#EF4444';

const ARTICLE = ['', 'Le pion', 'Le cavalier', 'Le fou', 'La tour', 'La dame', 'Le roi'];
const OBJECT = ['', 'le pion', 'le cavalier', 'le fou', 'la tour', 'la dame', 'le roi'];
const PROMO = ['', '', 'cavalier', 'fou', 'tour', 'dame', ''];

export function describeSolutionMove(p, m, san) {
  let s = '';
  const type = pieceType(p.at(m.from));
  if (p.isCastle(m)) {
    s += fileOf(m.to) === 6 ? 'Petit roque' : 'Grand roque';
  } else if (p.isEnPassant(m)) {
    s += `Le pion capture le pion en passant, en ${sqName(m.to)}`;
  } else if (p.isCapture(m)) {
    s += `${ARTICLE[type]} capture ${OBJECT[pieceType(p.at(m.to))]} en ${sqName(m.to)}`;
  } else {
    s += `${ARTICLE[type]} va en ${sqName(m.to)}`;
  }
  if (m.promo !== 0) s += ` et se promeut en ${PROMO[m.promo]}`;
  if (san.endsWith('#')) s += ' : échec et mat !';
  else if (san.endsWith('+')) s += ', avec échec.';
  else s += '.';
  return s;
}

class Painter {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
  }

  text(s, x, y, size, color, bold = false, align = 'left') {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  wrap(s, size, maxWidth, bold = false) {
    const ctx = this.ctx;
    ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, -apple-system, sans-serif`;
    const out = [];
    let cur = '';
    for (const w of s.split(' ')) {
      const cand = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(cand).width > maxWidth && cur) {
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
    grad.addColorStop(0, '#1E293B');
    grad.addColorStop(1, '#0F172A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, h);
  }

  header(subtitle) {
    const mascot = getMascotImg();
    if (mascot) this.ctx.drawImage(mascot, 48, 30, 156, 156);
    this.text('ChessDuck', 222, 112, 76, TEXT, true);
    this.text(subtitle, 224, 166, 36, MUTED, false);
  }

  footer(h) {
    this.text('© Ivan Herboch, 2026', W - 48, h - 28, 28, '#64748B', false, 'right');
  }

  turnBox(x, y, white) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, 46, 46, 8);
    ctx.fillStyle = white ? '#FFFFFF' : '#020617';
    ctx.fill();
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  board(left, top, side, position, flipped, lastMove) {
    const ctx = this.ctx;
    const s = side / 8;
    const xOf = (q) => left + (flipped ? 7 - fileOf(q) : fileOf(q)) * s;
    const yOf = (q) => top + (flipped ? rankOf(q) : 7 - rankOf(q)) * s;

    for (let q = 0; q < 64; q++) {
      ctx.fillStyle = (fileOf(q) + rankOf(q)) % 2 === 1 ? LIGHT : DARK;
      ctx.fillRect(xOf(q), yOf(q), s + 0.5, s + 0.5);
    }
    if (lastMove) {
      ctx.fillStyle = 'rgba(247, 236, 94, 0.40)';
      ctx.fillRect(xOf(lastMove.from), yOf(lastMove.from), s, s);
      ctx.fillRect(xOf(lastMove.to), yOf(lastMove.to), s, s);
    }

    ctx.save();
    ctx.font = `700 ${s * 0.2}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < 8; i++) {
      const fq = flipped ? sq(i, 7) : sq(i, 0);
      ctx.fillStyle = (fileOf(fq) + rankOf(fq)) % 2 === 1 ? DARK : LIGHT;
      ctx.fillText(String.fromCharCode(97 + i), xOf(fq) + s * 0.82, yOf(fq) + s * 0.94);

      const rq = flipped ? sq(7, i) : sq(0, i);
      ctx.fillStyle = (fileOf(rq) + rankOf(rq)) % 2 === 1 ? DARK : LIGHT;
      ctx.fillText(String(1 + i), xOf(rq) + s * 0.06, yOf(rq) + s * 0.24);
    }
    ctx.restore();

    for (let q = 0; q < 64; q++) {
      const p = position.at(q);
      if (p !== 0) {
        const img = getPieceImg(p, false);
        if (img) ctx.drawImage(img, xOf(q), yOf(q), s, s);
      }
    }
    return (q) => ({ x: xOf(q), y: yOf(q) });
  }
}

export async function renderProblemCard(puzzle, position, playerWhite, lastMove) {
  await preloadAssets();
  const h = 1600;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = h;
  const g = new Painter(cv);
  g.background(h);
  g.header(`Problème d'échecs  ·  Lichess #${puzzle.id}`);
  const side = 984;
  const top = 220;
  g.board((W - side) / 2, top, side, position, !playerWhite, lastMove);

  const theme = primaryTheme(puzzle.themes);
  const base = top + side;
  g.turnBox(48, base + 44, playerWhite);
  g.text(playerWhite ? 'Trait aux Blancs' : 'Trait aux Noirs', 110, base + 86, 54, TEXT, true);
  const band = BANDS[bandOf(puzzle.rating)];
  g.text(`Difficulté : ${band} (${puzzle.rating})`, 48, base + 150, 40, GOLD);
  g.text(`Type de problème : ${theme.name}`, 48, base + 206, 40, BLUE);
  let y = base + 264;
  for (const l of g.wrap(`Conseil : ${theme.tip}`, 36, W - 96)) {
    g.text(l, 48, y, 36, '#E2E8F0');
    y += 46;
  }
  g.footer(h);
  return cv;
}

export async function renderSolutionCard(puzzle) {
  await preloadAssets();
  const line = Line.fromUci(puzzle.fen, puzzle.moves);
  const playerWhite = line.positions[1].whiteToMove;
  const steps = [];
  for (let i = 1; i < line.size; i += 2) {
    steps.push({
      before: line.positions[i],
      move: line.moves[i],
      san: line.sans[i],
      prev: line.moves[i - 1],
      reply: line.moves[i + 1] || null,
      replySan: line.sans[i + 1] || null,
    });
  }

  const single = steps.length === 1;
  const cols = single ? 1 : 2;
  const side = single ? 984 : 492;
  const gap = 24;
  const textSize = single ? 38 : 27;
  const lineH = textSize * 1.3;
  const capW = side;

  const probeCv = document.createElement('canvas');
  probeCv.width = 1;
  probeCv.height = 1;
  const probe = new Painter(probeCv);

  const captions = steps.map((st, k) => {
    const head = `${k + 1}. ${st.san}`;
    const body = probe.wrap(describeSolutionMove(st.before, st.move, st.san), textSize, capW);
    let tail;
    if (st.replySan && st.reply) {
      const after = st.before.play(st.move);
      const d = describeSolutionMove(after, st.reply, st.replySan);
      const lower = d.charAt(0).toLowerCase() + d.slice(1);
      tail = probe.wrap(`Réponse adverse : ${st.replySan} — ${lower}`, textSize, capW);
    } else if (st.san.endsWith('#')) {
      tail = ['Échec et mat : problème résolu.'];
    } else {
      tail = ["Problème résolu : l'avantage est décisif."];
    }
    return { head, body, tail };
  });

  const rows = Math.ceil(steps.length / cols);
  const rowHeights = [];
  for (let r = 0; r < rows; r++) {
    let maxLines = 0;
    for (let c = 0; c < cols; c++) {
      const cap = captions[r * cols + c];
      if (cap) maxLines = Math.max(maxLines, cap.body.length + cap.tail.length);
    }
    rowHeights.push(side + textSize * 1.9 + maxLines * lineH + 34);
  }

  const top = 290;
  const legendH = 120;
  const h = Math.round(top + rowHeights.reduce((a, b) => a + b, 0) + legendH + 50);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = h;
  const g = new Painter(cv);
  g.background(h);
  g.header(`Solution du problème  ·  Lichess #${puzzle.id}`);
  const theme = primaryTheme(puzzle.themes);
  g.turnBox(48, 208, playerWhite);
  g.text(`${playerWhite ? 'Trait aux Blancs' : 'Trait aux Noirs'}  ·  ${theme.name}  ·  ${puzzle.rating}`, 110, 246, 38, TEXT, true);

  let y = top;
  for (let r = 0; r < rows; r++) {
    const inRow = [];
    for (let c = 0; c < cols; c++) if (r * cols + c < steps.length) inRow.push(c);
    const rowW = inRow.length * side + (inRow.length - 1) * gap;
    let x = (W - rowW) / 2;
    for (const cIdx of inRow) {
      const k = r * cols + cIdx;
      const st = steps[k];
      const at = g.board(x, y, side, st.before, !playerWhite, st.prev);
      const s = side / 8;
      const center = (q) => {
        const pt = at(q);
        return { x: pt.x + s / 2, y: pt.y + s / 2 };
      };
      if (st.reply) drawArrowOnCtx(g.ctx, { from: st.reply.from, to: st.reply.to, color: RED }, s, center, 0.10);
      drawArrowOnCtx(g.ctx, { from: st.move.from, to: st.move.to, color: GREEN }, s, center, 0.17);

      const dest = at(st.move.to);
      const labels = [];
      if (st.before.isCapture(st.move)) labels.push(['✕', '#475569']);
      if (st.san.endsWith('#')) labels.push(['#', RED]);
      else if (st.san.endsWith('+')) labels.push(['+', GOLD]);
      labels.forEach(([label, color], i) => {
        drawBadgeOnCtx(g.ctx, { text: label, color }, dest.x + s * (i === 0 ? 0.80 : 0.20), dest.y + s * 0.20, s);
      });

      const cap = captions[k];
      let ty = y + side + textSize * 1.35;
      g.text(cap.head, x, ty, textSize * 1.25, GREEN, true);

      const victim = st.before.isEnPassant(st.move)
        ? PAWN + (isWhite(st.before.at(st.move.from)) ? 8 : 0)
        : st.before.at(st.move.to);
      if (victim !== 0) {
        const ps = textSize * 1.7;
        const px = x + side - ps;
        const py = ty - ps * 0.82;
        g.ctx.save();
        g.ctx.fillStyle = LIGHT;
        g.ctx.beginPath();
        g.ctx.roundRect(px, py, ps, ps, 8);
        g.ctx.fill();
        g.ctx.restore();
        const img = getPieceImg(victim, false);
        if (img) g.ctx.drawImage(img, px, py, ps, ps);
        drawBadgeOnCtx(g.ctx, { text: '✕', color: RED }, px + ps, py, ps * 1.22);
        g.text('pris', px - 10, ty, textSize * 0.9, MUTED, false, 'right');
      }

      ty += textSize * 0.55;
      for (const l of cap.body) { ty += lineH; g.text(l, x, ty, textSize, '#E2E8F0'); }
      for (const l of cap.tail) { ty += lineH; g.text(l, x, ty, textSize, st.replySan ? '#FCA5A5' : GOLD); }

      x += side + gap;
    }
    y += rowHeights[r];
  }

  const ly = y + 30;
  g.ctx.save();
  g.ctx.fillStyle = GREEN;
  g.ctx.beginPath();
  g.ctx.roundRect(48, ly - 16, 60, 14, 7);
  g.ctx.fill();
  g.text('votre coup', 120, ly, 28, MUTED);

  g.ctx.fillStyle = RED;
  g.ctx.beginPath();
  g.ctx.roundRect(290, ly - 13, 60, 8, 4);
  g.ctx.fill();
  g.ctx.restore();
  g.text('réponse adverse', 362, ly, 28, MUTED);
  g.text('✕ prise    + échec    # échec et mat', 48, ly + 44, 28, MUTED);
  g.footer(h);
  return cv;
}

export async function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0));
}

export async function shareOrSaveCanvas(canvas, filename, shareTitle, shareText, mode = 'save') {
  const blob = await canvasToBlob(canvas);
  const dataUrl = canvas.toDataURL('image/png');
  if (!blob) return { ok: false, message: "❌ L'image n'a pas pu être générée.", dataUrl };

  const file = new File([blob], filename, { type: 'image/png' });
  if (mode === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle, text: shareText });
        return { ok: true, message: '✅ Image partagée.', dataUrl, shared: true };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, message: null, dataUrl };
    }
  }

  if (mode === 'save') {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return {
        ok: true,
        message: '✅ Image prête ! Sur iPhone, touchez Télécharger ou maintenez le doigt sur l’aperçu pour Enregistrer dans Photos.',
        dataUrl,
      };
    } catch {}
  }

  return {
    ok: true,
    message: '✅ Image générée : maintenez le doigt sur l’image ci-dessous pour la partager ou l’enregistrer dans Photos.',
    dataUrl,
  };
}
