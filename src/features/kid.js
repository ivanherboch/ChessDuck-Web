// Module Enfant : partie 2 joueurs joyeuse, Cavalier-Girafe, cartes interactives, leçons animées & confirmation floutée
// Port fidèle de Kid.kt (ChessDuck v1.6.0)

import { BISHOP, BLACK, GameEnd, KING, KNIGHT, Line, PAWN, QUEEN, ROOK, START_FEN } from '../chess.js';
import {
  COLORS, CapturedBarView, ChessBoardView, KID_PIECE_URLS, captureBadge, getPieceImg, moveAnim, preloadAssets, undoAnim,
} from '../board.js';
import { ModuleLayoutView, el } from '../ui.js';

const KID_LEGEND = [
  { type: KING, name: 'Roi', bg: '#FFE08A', edge: '#F2B705', ink: '#A86F00', article: 'le Roi', text: "Le **Roi** avance d'**une seule case**, dans **toutes les directions**." },
  { type: QUEEN, name: 'Dame', bg: '#FFC2D4', edge: '#FF7AA2', ink: '#D6336C', article: 'la Dame', text: "La **Dame** va **tout droit** ou **en diagonale**, aussi loin qu'elle veut." },
  { type: ROOK, name: 'Tour', bg: '#BFE6FF', edge: '#4DB5F5', ink: '#1971C2', article: 'la Tour', text: "La **Tour** va **tout droit** : devant, derrière ou sur les côtés, aussi loin qu'elle veut." },
  { type: BISHOP, name: 'Fou', bg: '#D9C8FF', edge: '#9B7BFF', ink: '#6741D9', article: 'le Fou', text: "Le **Fou** glisse **en diagonale**, aussi loin qu'il veut." },
  { type: KNIGHT, name: 'Cavalier', bg: '#FFD3A8', edge: '#FF9F43', ink: '#D9580A', article: 'le Cavalier', text: 'Le **Cavalier** saute en forme de **L** : 2 cases tout droit, puis 1 sur le côté. Il peut **sauter par-dessus** les autres pièces !' },
  { type: PAWN, name: 'Pion', bg: '#C9F2B0', edge: '#6CCB3A', ink: '#2B8A3E', article: 'le Pion', text: 'Le **Pion** avance **tout droit** d\'une case (2 cases la première fois). Il mange **en diagonale** !' },
];

const KID_BTNS = {
  blue: { face: '#1CB0F6', edge: '#1483C2' },
  orange: { face: '#FFA94D', edge: '#E07F1F' },
  coral: { face: '#FF6F61', edge: '#D9483B' },
  green: { face: '#58CC02', edge: '#3F9A00' },
};

function makeKidButton({ label, palette, onClick, weight = 1, height = 52, enabled = true, className = '', feedback = null }) {
  const pal = KID_BTNS[palette];
  const btn = el('button', {
    type: 'button',
    className: `kid-btn ${className}`.trim(),
    disabled: !enabled,
    style: {
      flexGrow: String(weight),
      flexBasis: '0',
      height: `${height}px`,
      minHeight: `${height}px`,
      '--kid-face': pal.face,
      '--kid-edge': pal.edge,
    },
    onClick: () => {
      if (btn.disabled) return;
      feedback?.key();
      onClick();
    },
  }, el('span', { className: 'kid-btn-face' }, el('span', { className: 'kid-btn-label' }, label)));

  btn.setConfig = ({ label: nextLabel, palette: nextPalette, enabled: nextEnabled } = {}) => {
    if (nextLabel !== undefined) btn.querySelector('.kid-btn-label').textContent = nextLabel;
    if (nextPalette !== undefined) {
      const p = KID_BTNS[nextPalette];
      btn.style.setProperty('--kid-face', p.face);
      btn.style.setProperty('--kid-edge', p.edge);
    }
    if (nextEnabled !== undefined) btn.disabled = !nextEnabled;
  };
  return btn;
}

const STRAIGHT = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const DIAGONAL = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

function ray(from, df, dr) {
  const out = [];
  let f = from[0] + df;
  let r = from[1] + dr;
  while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
    out.push([f, r]);
    f += df;
    r += dr;
  }
  return out;
}

function demoPhases(type) {
  const home = [3, 3]; // d4
  const rays = (dirs) => dirs.map(([df, dr]) => ray(home, df, dr));
  switch (type) {
    case ROOK:
      return [{ home, paths: rays(STRAIGHT), dots: rays(STRAIGHT).flat(), enemy: null }];
    case BISHOP:
      return [{ home, paths: rays(DIAGONAL), dots: rays(DIAGONAL).flat(), enemy: null }];
    case QUEEN:
      return [
        { home, paths: rays(STRAIGHT.slice(0, 2)), dots: rays(STRAIGHT).flat(), enemy: null },
        { home, paths: rays([[1, 1], [-1, -1]]), dots: rays(DIAGONAL).flat(), enemy: null },
      ];
    case KING: {
      const steps = [...STRAIGHT, ...DIAGONAL].map(([df, dr]) => [home[0] + df, home[1] + dr]);
      const order = [0, 4, 1, 5, 2, 6, 3, 7].map((idx) => [steps[idx]]);
      return [{ home, paths: order, dots: steps, enemy: null }];
    }
    case KNIGHT: {
      const jumps = [[1, 2], [2, -1], [-1, -2], [-2, 1], [2, 1], [1, -2], [-2, -1], [-1, 2]]
        .map(([df, dr]) => [home[0] + df, home[1] + dr]);
      return [{ home, paths: jumps.slice(0, 4).map((j) => [j]), dots: jumps, enemy: null }];
    }
    default: // PAWN
      return [
        { home: [3, 1], paths: [[[3, 2]]], dots: [[3, 2]], enemy: null },
        { home: [3, 1], paths: [[[3, 3]]], dots: [[3, 2], [3, 3]], enemy: null },
        { home: [3, 3], paths: [[[4, 4]]], dots: [[4, 4]], enemy: [4, 4] },
      ];
  }
}

function appendBoldText(container, src) {
  container.innerHTML = '';
  src.split('**').forEach((part, idx) => {
    if (!part) return;
    if (idx % 2 === 1) container.appendChild(el('strong', { className: 'kid-demo-strong' }, part));
    else container.appendChild(document.createTextNode(part));
  });
}

export class KidModule {
  constructor({ feedback, onExit }) {
    this.feedback = feedback;
    this.onExit = onExit;
    this.active = false;

    this.state = {
      line: new Line(START_FEN),
      cursor: 0,
      anim: null,
      result: null,
      demoType: 0,
      confirmQuit: false,
    };

    this._demoRaf = 0;
    this._demoAbort = null;
    this._buildDom();
  }

  _buildDom() {
    this.root = el('div', { className: 'kid-screen' });

    // 1. Vue principale de partie
    this.gameLayer = el('div', { className: 'kid-game-layer' });
    this.gameLayout = new ModuleLayoutView({ bottomMin: 228, hasUnderBoard: true, kid: true });

    this.turnDot = el('span', { className: 'kid-turn-dot' });
    this.turnText = el('span', { className: 'kid-turn-text' }, 'Aux Blancs de jouer');
    this.turnBubble = el('div', { className: 'kid-turn-bubble' }, this.turnDot, this.turnText);
    this.gameLayout.topEl.appendChild(this.turnBubble);

    this.boardFrame = el('div', { className: 'kid-board-frame' });
    this.boardInner = el('div', { className: 'kid-board-inner' });
    this.boardFrame.appendChild(this.boardInner);
    this.gameLayout.boardMount.appendChild(this.boardFrame);
    this.board = new ChessBoardView(this.boardInner, {
      feedback: this.feedback,
      onMove: (m) => this.move(m),
    });
    this.captured = new CapturedBarView(this.gameLayout.underEl);
    this.gameLayout.onBoardSize((side) => {
      this.boardFrame.style.width = `${side + 14}px`;
      this.boardFrame.style.height = `${side + 14}px`;
      this.board.resize(side);
      this.captured.resize(side + 6);
    });

    const prompt = el('div', { className: 'kid-prompt' }, '👆 Touche une pièce pour voir comment elle bouge !');
    this.cardsRow = el('div', { className: 'kid-cards-row' },
      ...KID_LEGEND.map((p) => {
        const card = el('button', {
          type: 'button',
          className: 'kid-piece-card',
          style: { background: p.bg, borderColor: p.edge },
          onClick: () => {
            this.feedback?.key();
            this.openDemo(p.type);
          },
        },
        el('img', { className: 'kid-piece-img', src: KID_PIECE_URLS[p.type], alt: p.name }),
        el('span', { className: 'kid-piece-name' }, p.name));
        return card;
      }),
    );

    this.prevBtn = makeKidButton({ label: '◀', palette: 'blue', weight: 1, height: 50, feedback: this.feedback, onClick: () => this.back() });
    this.nextBtn = makeKidButton({ label: '▶', palette: 'blue', weight: 1, height: 50, feedback: this.feedback, onClick: () => this.forward() });
    this.resignBtn = makeKidButton({
      label: '🏳️ Abandonner',
      palette: 'orange',
      weight: 1.9,
      height: 50,
      feedback: this.feedback,
      onClick: () => {
        if (this.state.result) this.reset();
        else this.resign();
      },
    });
    const navRow = el('div', { className: 'kid-nav-row' }, this.prevBtn, this.nextBtn, this.resignBtn);
    this.quitBtn = makeKidButton({
      label: '✕ Quitter le mode enfant',
      palette: 'coral',
      weight: 1,
      height: 46,
      className: 'kid-quit-btn',
      feedback: this.feedback,
      onClick: () => this.setConfirmQuit(true),
    });

    const bottomStack = el('div', { className: 'kid-bottom-stack' },
      el('div', { className: 'kid-legend-block' }, prompt, this.cardsRow),
      navRow,
      this.quitBtn,
    );
    this.gameLayout.bottomEl.appendChild(bottomStack);
    this.gameLayer.appendChild(this.gameLayout.root);

    // 2. Vue leçon animée (Canvas en boucle)
    this.demoLayer = el('div', { className: 'kid-demo-layer hidden' });
    this.demoLayout = new ModuleLayoutView({ bottomMin: 186, kid: true });
    this.demoPieceImg = el('img', { className: 'kid-demo-icon', alt: '' });
    this.demoTitle = el('span', { className: 'kid-demo-title' });
    this.demoBubble = el('div', { className: 'kid-turn-bubble' }, this.demoPieceImg, this.demoTitle);
    this.demoLayout.topEl.appendChild(this.demoBubble);

    this.demoCanvas = el('canvas', { className: 'kid-demo-canvas' });
    this.demoFrame = el('div', { className: 'kid-board-frame' }, el('div', { className: 'kid-board-inner' }, this.demoCanvas));
    this.demoLayout.boardMount.appendChild(this.demoFrame);
    this.demoLayout.onBoardSize((side) => {
      this.demoFrame.style.width = `${side + 14}px`;
      this.demoFrame.style.height = `${side + 14}px`;
      this.demoCanvas.style.width = `${side}px`;
      this.demoCanvas.style.height = `${side}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.demoCanvas.width = Math.round(side * dpr);
      this.demoCanvas.height = Math.round(side * dpr);
    });

    this.demoTextInner = el('div', { className: 'kid-demo-text' });
    this.demoTextCard = el('div', { className: 'kid-demo-card' }, this.demoTextInner);
    this.demoBackBtn = makeKidButton({
      label: '⬅️ Revenir à la partie',
      palette: 'green',
      weight: 1,
      height: 54,
      className: 'kid-demo-back-btn',
      feedback: this.feedback,
      onClick: () => this.closeDemo(),
    });
    this.demoLayout.bottomEl.append(
      el('div', { className: 'kid-demo-bottom-stack' }, this.demoTextCard, this.demoBackBtn),
    );
    this.demoLayer.appendChild(this.demoLayout.root);

    // 3. Boîte de confirmation « Quitter le mode enfant ? »
    const dialogCard = el('div', { className: 'kid-quit-card', onClick: (e) => e.stopPropagation() },
      el('img', { className: 'kid-quit-mascot', src: 'assets/mascot.png', alt: '' }),
      el('div', { className: 'kid-quit-title' }, 'Quitter le mode enfant ?'),
      el('div', { className: 'kid-quit-desc' }, 'La partie en cours du mode enfant sera effacée.'),
      makeKidButton({ label: 'Non, on continue à jouer', palette: 'green', weight: 1, height: 54, className: 'kid-dialog-btn', feedback: this.feedback, onClick: () => this.setConfirmQuit(false) }),
      makeKidButton({
        label: 'Oui, quitter',
        palette: 'coral',
        weight: 1,
        height: 48,
        className: 'kid-dialog-btn kid-dialog-btn-gap',
        feedback: this.feedback,
        onClick: () => {
          this.setConfirmQuit(false);
          this.closeDemo();
          this.reset();
          this.onExit();
        },
      }),
    );
    this.quitOverlay = el('div', {
      className: 'kid-quit-overlay hidden',
      onClick: () => this.setConfirmQuit(false),
    }, dialogCard);

    this.root.append(this.gameLayer, this.demoLayer, this.quitOverlay);
    this.render();
  }

  setActive(on) {
    this.active = on;
    if (!on) {
      this.closeDemo();
      this.setConfirmQuit(false);
    } else {
      requestAnimationFrame(() => {
        this.gameLayout.measure();
        if (this.state.demoType) this.demoLayout.measure();
      });
    }
  }

  reset() {
    this.state.line = new Line(START_FEN);
    this.state.cursor = 0;
    this.state.anim = null;
    this.state.result = null;
    this.state.demoType = 0;
    this.render();
  }

  move(m) {
    const s = this.state;
    const pos = s.line.positions[s.cursor];
    if (s.result || !pos.isLegal(m)) return;
    const nl = s.line.copy(s.cursor);
    nl.push(m);
    const white = !nl.last.whiteToMove;
    const end = nl.end();
    let result = null;
    if (end === GameEnd.CHECKMATE) result = `🎉 Échec et mat ! Bravo aux ${white ? 'Blancs' : 'Noirs'} !`;
    else if (end !== GameEnd.NONE) result = "🤝 Partie nulle : personne n'a perdu !";
    s.line = nl;
    s.cursor = nl.size;
    s.anim = moveAnim(pos, m);
    s.result = result;
    this.render();
  }

  back() {
    const s = this.state;
    if (s.cursor <= 0) return;
    const t = s.cursor - 1;
    s.cursor = t;
    s.anim = undoAnim(s.line.positions[t], s.line.moves[t]);
    s.result = null;
    this.render();
  }

  forward() {
    const s = this.state;
    if (s.cursor >= s.line.size) return;
    const pos = s.line.positions[s.cursor];
    s.anim = moveAnim(pos, s.line.moves[s.cursor]);
    s.cursor = s.cursor + 1;
    this.render();
  }

  resign() {
    const s = this.state;
    if (s.result) return;
    const pos = s.line.positions[s.cursor];
    const loser = pos.whiteToMove ? 'Blancs' : 'Noirs';
    const winner = pos.whiteToMove ? 'Noirs' : 'Blancs';
    s.result = `🏳️ Les ${loser} abandonnent : bravo aux ${winner} !`;
    this.render();
  }

  setConfirmQuit(on) {
    this.state.confirmQuit = on;
    this.gameLayer.classList.toggle('is-blurred', on);
    this.quitOverlay.classList.toggle('hidden', !on);
  }

  openDemo(type) {
    this.state.demoType = type;
    this.gameLayer.classList.add('hidden');
    this.demoLayer.classList.remove('hidden');
    const piece = KID_LEGEND.find((p) => p.type === type);
    if (!piece) return;

    this.demoPieceImg.src = KID_PIECE_URLS[piece.type];
    this.demoTitle.textContent = `Comment bouge ${piece.article} ?`;
    this.demoTitle.style.color = piece.ink;
    this.demoBubble.style.borderColor = piece.edge;
    this.demoTextCard.style.borderColor = piece.edge;
    this.demoTextCard.style.color = piece.ink;
    appendBoldText(this.demoTextInner, piece.text);

    requestAnimationFrame(() => {
      this.demoLayout.measure();
      this._startDemoLoop(piece);
    });
  }

  closeDemo() {
    this._stopDemoLoop();
    if (this.state.demoType !== 0) {
      this.state.demoType = 0;
      this.demoLayer.classList.add('hidden');
      this.gameLayer.classList.remove('hidden');
      requestAnimationFrame(() => this.gameLayout.measure());
    }
  }

  _stopDemoLoop() {
    cancelAnimationFrame(this._demoRaf);
    this._demoRaf = 0;
    if (this._demoAbort) {
      this._demoAbort.abort();
      this._demoAbort = null;
    }
  }

  async _startDemoLoop(piece) {
    this._stopDemoLoop();
    await preloadAssets();
    const ctrl = new AbortController();
    this._demoAbort = ctrl;
    const signal = ctrl.signal;

    const sleep = (ms) => new Promise((res) => {
      if (signal.aborted) return res();
      const id = setTimeout(res, ms);
      signal.addEventListener('abort', () => { clearTimeout(id); res(); }, { once: true });
    });

    const phases = demoPhases(piece.type);
    const animState = {
      phase: phases[0],
      from: phases[0].home,
      to: phases[0].home,
      target: phases[0].paths[0]?.[phases[0].paths[0].length - 1] || null,
      enemyAlive: true,
      p: 1,
    };

    const drawFrame = () => {
      const cv = this.demoCanvas;
      const w = cv.width;
      if (w <= 0) return;
      const ctx = cv.getContext('2d');
      const s = w / 8;
      const c = COLORS.kid;
      const ph = animState.phase;

      const tl = (q) => ({ x: q[0] * s, y: (7 - q[1]) * s });
      const ctr = (q) => ({ x: q[0] * s + s / 2, y: (7 - q[1]) * s + s / 2 });

      ctx.clearRect(0, 0, w, w);
      for (let f = 0; f <= 7; f++) {
        for (let r = 0; r <= 7; r++) {
          ctx.fillStyle = (f + r) % 2 === 1 ? c.squareLight : c.squareDark;
          const pt = tl([f, r]);
          ctx.fillRect(pt.x, pt.y, s + 0.5, s + 0.5);
        }
      }

      // Pastilles / cercle de prise
      ctx.save();
      for (const d of ph.dots) {
        const dc = ctr(d);
        if (ph.enemy && d[0] === ph.enemy[0] && d[1] === ph.enemy[1]) {
          ctx.strokeStyle = piece.edge;
          ctx.lineWidth = s * 0.09;
          ctx.beginPath();
          ctx.arc(dc.x, dc.y, s * 0.44, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = piece.edge;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(dc.x, dc.y, s * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // Case de départ surlignée
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = piece.edge;
      const hpt = tl(ph.home);
      ctx.fillRect(hpt.x, hpt.y, s, s);
      ctx.restore();

      // Chemin en L du Cavalier
      if (piece.type === KNIGHT && animState.target) {
        const h = ph.home;
        const tg = animState.target;
        const corner = Math.abs(tg[1] - h[1]) === 2 ? [h[0], tg[1]] : [tg[0], h[1]];
        const ch = ctr(h), cc = ctr(corner), ct = ctr(tg);
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = piece.edge;
        ctx.lineWidth = s * 0.14;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ch.x, ch.y);
        ctx.lineTo(cc.x, cc.y);
        ctx.lineTo(ct.x, ct.y);
        ctx.stroke();
        ctx.restore();
      }

      const drawDemoPiece = (typeId, pt, scaleY = 1) => {
        const img = getPieceImg(typeId, true);
        if (!img) return;
        const phPx = s * scaleY;
        ctx.drawImage(img, pt.x, pt.y + (s - phPx), s, phPx);
      };

      if (ph.enemy && animState.enemyAlive) {
        drawDemoPiece(ROOK + BLACK, tl(ph.enemy));
      }

      const p = animState.p;
      const fpt = tl(animState.from);
      const tpt = tl(animState.to);
      const gx = fpt.x + (tpt.x - fpt.x) * p;
      const gy = fpt.y + (tpt.y - fpt.y) * p;
      const dist = Math.max(1, Math.abs(animState.to[0] - animState.from[0]), Math.abs(animState.to[1] - animState.from[1]));
      const lift = Math.sin(Math.PI * p) * s * (piece.type === KNIGHT ? 0.75 : 0.28 + 0.1 * dist);

      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath();
      ctx.ellipse(gx + s * 0.5, gy + s * 0.87, s * 0.30, s * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();

      const squash = p > 0.85 && p < 1 ? 0.92 : 1;
      drawDemoPiece(piece.type, { x: gx, y: gy - lift }, squash);

      if (ph.enemy && !animState.enemyAlive) {
        const ep = tl(ph.enemy);
        ctx.fillStyle = '#FF6F61';
        ctx.beginPath();
        ctx.arc(ep.x + s * 0.82, ep.y + s * 0.18, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const animateHop = (durMs) => new Promise((res) => {
      const t0 = performance.now();
      const tick = (now) => {
        if (signal.aborted) return res();
        const raw = Math.min(1, (now - t0) / durMs);
        animState.p = raw;
        drawFrame();
        if (raw >= 1) res();
        else this._demoRaf = requestAnimationFrame(tick);
      };
      this._demoRaf = requestAnimationFrame(tick);
    });

    while (!signal.aborted) {
      for (const ph of phases) {
        for (const path of ph.paths) {
          if (signal.aborted) return;
          animState.phase = ph;
          animState.from = ph.home;
          animState.to = ph.home;
          animState.enemyAlive = true;
          animState.target = path[path.length - 1];
          animState.p = 1;
          drawFrame();
          await sleep(450);
          let cur = ph.home;
          for (const stp of path) {
            if (signal.aborted) return;
            animState.from = cur;
            animState.to = stp;
            animState.p = 0;
            const far = Math.max(Math.abs(stp[0] - cur[0]), Math.abs(stp[1] - cur[1]));
            await animateHop(piece.type === KNIGHT ? 560 : 250 + 110 * far);
            if (signal.aborted) return;
            this.feedback?.move();
            cur = stp;
            if (ph.enemy && stp[0] === ph.enemy[0] && stp[1] === ph.enemy[1]) {
              animState.enemyAlive = false;
              drawFrame();
            }
          }
          await sleep(650);
        }
      }
    }
  }

  render() {
    const s = this.state;
    const pos = s.line.positions[s.cursor];
    const cur = s.cursor;
    const last = cur > 0 ? s.line.moves[cur - 1] : null;
    const whiteTurn = pos.whiteToMove;

    const borderCol = s.result ? '#58CC02' : (whiteTurn ? '#FFB020' : '#8B5CF6');
    this.turnBubble.style.borderColor = borderCol;
    this.turnDot.classList.toggle('hidden', !!s.result);
    this.turnDot.classList.toggle('is-black', !whiteTurn);
    this.turnText.textContent = s.result || ((pos.inCheck ? 'Échec ! ' : '') + (whiteTurn ? 'Aux Blancs de jouer' : 'Aux Noirs de jouer'));

    this.board.setState({
      position: pos,
      colors: COLORS.kid,
      flipped: false,
      interactive: !s.result,
      lastMove: last,
      anim: s.anim,
      arrows: [],
      marks: [],
      badges: last ? [captureBadge(s.line.positions[cur - 1], last)].filter(Boolean) : [],
      kid: true,
    });
    this.captured.setState({ position: pos, colors: COLORS.kid, kid: true });

    this.prevBtn.setConfig({ enabled: cur > 0 });
    this.nextBtn.setConfig({ enabled: cur < s.line.size });
    if (s.result) {
      this.resignBtn.setConfig({ label: '🎉 Rejouer', palette: 'green', enabled: true });
    } else {
      this.resignBtn.setConfig({ label: '🏳️ Abandonner', palette: 'orange', enabled: s.line.size > 0 });
    }
  }
}
