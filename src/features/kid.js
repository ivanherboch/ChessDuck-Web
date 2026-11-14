import {
    BISHOP, BLACK, GameEnd, KING, KNIGHT, Line, PAWN, QUEEN, ROOK, START_FEN, fileOf, rankOf, sq,
} from '../core/chess.js';
import { prefs } from '../data/prefs.js';
import { BoardGeometry } from '../ui/board-geometry.js';
import { ChessBoardView } from '../ui/board.js';
import { CapturedBarView } from '../ui/captured.js';
import { ModuleLayoutView, el } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { moveAnim, undoAnim } from '../ui/line-playback.js';
import { KID_PIECE_URLS, pieceStore } from '../ui/pieces.js';
import { KidColors } from '../ui/theme.js';

export const KID_LEGEND = [
    {
        type: KING, name: 'Roi', bg: '#FFE08A', edge: '#F2B705', ink: '#8A5A00', article: 'Le Roi',
        text: "Le **Roi** avance d'**une seule case**, dans **toutes les directions**.",
    },
    {
        type: QUEEN, name: 'Dame', bg: '#FFC2D4', edge: '#FF7AA2', ink: '#D6336C', article: 'La Dame',
        text: "La **Dame** va **tout droit** ou **en diagonale**, aussi loin qu'elle veut.",
    },
    {
        type: ROOK, name: 'Tour', bg: '#BFE6FF', edge: '#4DB5F5', ink: '#1971C2', article: 'La Tour',
        text: "La **Tour** va **tout droit** : devant, derrière ou sur les côtés, aussi loin qu'elle veut.",
    },
    {
        type: BISHOP, name: 'Fou', bg: '#D9C8FF', edge: '#9B7BFF', ink: '#6741D9', article: 'Le Fou',
        text: "Le **Fou** glisse **en diagonale**, aussi loin qu'il veut.",
    },
    {
        type: KNIGHT, name: 'Cavalier', bg: '#FFD3A8', edge: '#FF9F43', ink: '#C2410C', article: 'Le Cavalier',
        text: "Le **Cavalier** saute en forme de **L** : 2 cases tout droit, puis 1 sur le côté. Il peut **sauter par-dessus** les autres pièces !",
    },
    {
        type: PAWN, name: 'Pion', bg: '#C9F2B0', edge: '#6CCB3A', ink: '#237A36', article: 'Le Pion',
        text: "Le **Pion** avance **tout droit** d'une case (2 cases la première fois). Il mange **en diagonale** !",
    },
];

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
        case ROOK: {
            const r = rays(STRAIGHT);
            return [{ home, paths: r, dots: r.flat(), enemy: null }];
        }
        case BISHOP: {
            const r = rays(DIAGONAL);
            return [{ home, paths: r, dots: r.flat(), enemy: null }];
        }
        case QUEEN:
            return [
                { home, paths: rays(STRAIGHT.slice(0, 2)), dots: rays(STRAIGHT).flat(), enemy: null },
                { home, paths: rays([[1, 1], [-1, -1]]), dots: rays(DIAGONAL).flat(), enemy: null },
            ];
        case KING: {
            const steps = [...STRAIGHT, ...DIAGONAL].map(([df, dr]) => [home[0] + df, home[1] + dr]);
            const paths = [0, 4, 1, 5, 2, 6, 3, 7].map((i) => [steps[i]]);
            return [{ home, paths, dots: steps, enemy: null }];
        }
        case KNIGHT: {
            const jumps = [[1, 2], [2, -1], [-1, -2], [-2, 1], [2, 1], [1, -2], [-2, -1], [-1, 2]]
                .map(([df, dr]) => [home[0] + df, home[1] + dr]);
            return [{ home, paths: jumps.slice(0, 4).map((j) => [j]), dots: jumps, enemy: null }];
        }
        default:
            return [
                { home: [3, 1], paths: [[[3, 2]]], dots: [[3, 2]], enemy: null },
                { home: [3, 1], paths: [[[3, 3]]], dots: [[3, 2], [3, 3]], enemy: null },
                { home: [3, 3], paths: [[[4, 4]]], dots: [[4, 4]], enemy: [4, 4] },
            ];
    }
}

function appendBoldText(container, src) {
    container.replaceChildren();
    const parts = src.split('**');
    parts.forEach((part, i) => {
        if (!part) return;
        if (i % 2 === 1) container.appendChild(el('strong', '', part));
        else container.appendChild(document.createTextNode(part));
    });
}

function kidButton({ label = '', variant = 'blue', onClick, enabled = true, icon = null, ariaLabel = null, className = '' }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `kid-btn kid-btn-${variant} ${className}`.trim();
    btn.disabled = !enabled;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);

    const edge = el('span', 'kid-btn-edge');
    const face = el('span', 'kid-btn-face');
    if (icon) face.appendChild(createIcon(icon, 24, 'kid-btn-ic'));
    if (label) face.appendChild(el('span', 'kid-btn-label', label));
    btn.append(edge, face);

    btn.addEventListener('click', (e) => {
        if (btn.disabled) return;
        feedback.key();
        onClick?.(e);
    });
    return btn;
}

export class KidFeature {
    constructor() {
        this.el = el('div', 'feature-root kid-screen');
        this._palette = KidColors;
        this._showCoords = true;
        this._blocked = null;
        this._blockedTimer = null;
        this._demoType = 0;
        this._demoToken = 0;
        this._demoRaf = 0;
        this._demoTimer = null;
        this._demoSnapshot = null;
        this._quitBackdrop = null;
        this._destroyed = false;

        this.state = {
            line: new Line(START_FEN),
            cursor: 0,
            anim: null,
            result: null,
        };

        this.mainWrap = el('div', 'kid-main-wrap');
        this.el.appendChild(this.mainWrap);

        this._buildGameDom();
        this.mainWrap.appendChild(this.layout.el);

        this._unbindPieceLoad = pieceStore.onLoad(() => {
            if (this._demoCanvas) this._drawDemo();
        });
        pieceStore.preloadSet(true).catch(() => {});
        this._render();
    }

    destroy() {
        this._destroyed = true;
        this._stopDemo();
        this._closeQuitDialog();
        if (this._blockedTimer) clearTimeout(this._blockedTimer);
        this._unbindPieceLoad?.();
        this.board.destroy();
        this.capturedBar.destroy();
        this.layout.destroy();
        this.demoLayout?.destroy();
    }

    setThemeAndCoords(palette, showCoords) {
        this._palette = palette || KidColors;
        this._showCoords = showCoords;
        this._renderBoard();
        if (this._demoCanvas) this._drawDemo();
    }

    onActivate() {
        if (this._demoType > 0 && this.demoLayout) {
            this.demoLayout.relayout();
            this._syncDemoCanvasSize();
            this._drawDemo();
        } else {
            this.layout.relayout();
            this.board._syncCanvasSize();
            this.board.draw();
        }
    }

    get position() {
        return this.state.line.positions[Math.max(0, Math.min(this.state.line.size, this.state.cursor))];
    }

    reset() {
        this._stopDemo();
        if (this._blockedTimer) { clearTimeout(this._blockedTimer); this._blockedTimer = null; }
        this._blocked = null;
        this.state = {
            line: new Line(START_FEN),
            cursor: 0,
            anim: null,
            result: null,
        };
        this._render();
    }

    move(m) {
        const s = this.state;
        const pos = this.position;
        if (s.result !== null || !pos.isLegal(m)) return;
        const nl = s.line.copy(s.cursor);
        nl.push(m);
        const moverWhite = !nl.last.whiteToMove;
        const end = nl.end();
        let result = null;
        if (end === GameEnd.CHECKMATE) {
            result = `🎉 Échec et mat ! Bravo aux ${moverWhite ? 'Blancs' : 'Noirs'} !`;
        } else if (end !== GameEnd.NONE) {
            result = "🤝 Partie nulle : personne n'a perdu !";
        }
        s.line = nl;
        s.cursor = nl.size;
        s.anim = moveAnim(pos, m);
        s.result = result;
        this._blocked = null;
        if (this._blockedTimer) { clearTimeout(this._blockedTimer); this._blockedTimer = null; }
        this._render();
    }

    back() {
        const s = this.state;
        if (s.cursor <= 0) return;
        const t = s.cursor - 1;
        s.cursor = t;
        s.anim = undoAnim(s.line.positions[t], s.line.moves[t]);
        s.result = null;
        this._render();
    }

    forward() {
        const s = this.state;
        if (s.cursor >= s.line.size) return;
        const pos = this.position;
        s.anim = moveAnim(pos, s.line.moves[s.cursor]);
        s.cursor += 1;
        this._render();
    }

    resign() {
        const s = this.state;
        if (s.result !== null) return;
        const pos = this.position;
        const loser = pos.whiteToMove ? 'Blancs' : 'Noirs';
        const winner = pos.whiteToMove ? 'Noirs' : 'Blancs';
        s.result = `🏳️ Les ${loser} abandonnent : bravo aux ${winner} !`;
        this._render();
    }

    _buildGameDom() {
        this.layout = new ModuleLayoutView({ bottomMin: 200, adaptive: false });

        this.topBar = el('div', 'kid-top-bar');
        this.bubble = el('div', 'kid-turn-bubble');
        this.bubble.setAttribute('aria-live', 'polite');
        this.turnDot = el('span', 'kid-turn-dot');
        this.turnText = el('span', 'kid-turn-text', '');
        this.bubble.append(this.turnDot, this.turnText);

        this.quitBtn = document.createElement('button');
        this.quitBtn.type = 'button';
        this.quitBtn.className = 'kid-quit-pill';
        this.quitBtn.setAttribute('aria-label', 'Quitter le mode enfant');
        const pillInner = el('span', 'kid-quit-pill-inner');
        pillInner.append(createIcon('Close', 18), el('span', 'kid-quit-label', 'Quitter'));
        this.quitBtn.appendChild(pillInner);
        this.quitBtn.addEventListener('click', () => {
            feedback.key();
            this._openQuitDialog();
        });
        this.topBar.append(this.bubble, this.quitBtn);
        this.layout.topSlot.appendChild(this.topBar);

        this.boardFrame = el('div', 'kid-board-frame');
        this.board = new ChessBoardView();
        this.boardFrame.appendChild(this.board.el);
        this.layout.boardHost.appendChild(this.boardFrame);

        this.capturedBar = new CapturedBarView(true);
        this.layout.underSlot.appendChild(this.capturedBar.el);

        this.bottomCol = el('div', 'kid-bottom-col');
        const promptCol = el('div', 'kid-legend-wrap');
        promptCol.appendChild(el('div', 'kid-legend-title', '👆 Touche une pièce pour voir comment elle bouge !'));
        const cardsRow = el('div', 'kid-legend-row');
        for (const p of KID_LEGEND) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'kid-piece-card';
            card.style.setProperty('--card-bg', p.bg);
            card.style.setProperty('--card-edge', p.edge);
            card.setAttribute('aria-label', `${p.name} : voir comment bouge ${p.article[0].toLowerCase()}${p.article.slice(1)}`);
            const img = document.createElement('img');
            img.src = KID_PIECE_URLS[p.type];
            img.alt = '';
            img.className = 'kid-piece-card-img';
            card.append(img, el('span', 'kid-piece-card-name', p.name));
            card.addEventListener('click', () => {
                feedback.key();
                this._openDemo(p.type);
            });
            cardsRow.appendChild(card);
        }
        promptCol.appendChild(cardsRow);

        this.navRow = el('div', 'kid-nav-row');
        this.bottomCol.append(promptCol, this.navRow);
        this.layout.bottomSlot.appendChild(this.bottomCol);
    }

    _openQuitDialog() {
        if (this._quitBackdrop) return;
        this.mainWrap.classList.add('is-blurred');
        const backdrop = el('div', 'kid-quit-backdrop');
        const dlg = el('div', 'kid-quit-dialog');
        dlg.setAttribute('role', 'alertdialog');
        dlg.setAttribute('aria-modal', 'true');

        const mascot = document.createElement('img');
        mascot.src = './assets/mascot.png';
        mascot.alt = '';
        mascot.className = 'kid-quit-mascot';

        const title = el('h2', 'kid-quit-title', 'Quitter le mode enfant ?');
        const desc = el('p', 'kid-quit-desc', 'La partie en cours du mode enfant sera effacée.');
        const stayBtn = kidButton({
            label: 'Non, on continue à jouer',
            variant: 'green',
            icon: 'SportsEsports',
            className: 'full-w kid-quit-stay',
            onClick: () => this._closeQuitDialog(),
        });
        const leaveBtn = kidButton({
            label: 'Oui, quitter',
            variant: 'coral',
            icon: 'Logout',
            className: 'full-w kid-quit-leave',
            onClick: () => {
                this._closeQuitDialog();
                prefs.setKidMode(false);
            },
        });

        dlg.append(mascot, title, desc, stayBtn, leaveBtn);
        backdrop.appendChild(dlg);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) this._closeQuitDialog();
        });
        this.el.appendChild(backdrop);
        this._quitBackdrop = backdrop;
    }

    _closeQuitDialog() {
        this.mainWrap.classList.remove('is-blurred');
        if (this._quitBackdrop) {
            this._quitBackdrop.remove();
            this._quitBackdrop = null;
        }
    }

    _renderBoard() {
        const s = this.state;
        const pos = this.position;
        const cur = s.cursor;
        const last = cur > 0 ? s.line.moves[cur - 1] : null;
        this.board.setState({
            position: pos,
            flipped: false,
            interactive: s.result === null,
            lastMove: last,
            anim: s.anim,
            arrows: [],
            marks: [],
            badges: [],
            kid: true,
            showCoords: this._showCoords,
            palette: this._palette,
            onIllegalTouch: () => {
                this._blocked = pos.inCheck ? 'Ton roi est en échec : protège-le !' : 'Cette pièce est bloquée !';
                if (this._blockedTimer) clearTimeout(this._blockedTimer);
                this._blockedTimer = setTimeout(() => {
                    this._blocked = null;
                    this._blockedTimer = null;
                    this._render();
                }, 2600);
                this._render();
            },
            onMove: (m) => this.move(m),
        });
        this.capturedBar.update(pos, this._palette);
    }

    _render() {
        if (this._demoType > 0) return;
        const s = this.state;
        const pos = this.position;
        const cur = s.cursor;
        const whiteTurn = pos.whiteToMove;

        let accent;
        if (s.result !== null) accent = '#237A36';
        else if (this._blocked !== null) accent = '#C2410C';
        else if (whiteTurn) accent = '#F59E0B';
        else accent = '#7C3AED';
        this.bubble.style.borderColor = accent;

        const hideDot = s.result !== null || this._blocked !== null;
        this.turnDot.classList.toggle('hidden', hideDot);
        this.turnDot.className = `kid-turn-dot${hideDot ? ' hidden' : ''}${whiteTurn ? ' is-white' : ' is-black'}`;

        const text = s.result || this._blocked || ((pos.inCheck ? 'Échec ! ' : '') + (whiteTurn ? 'Aux Blancs de jouer' : 'Aux Noirs de jouer'));
        this.turnText.textContent = text;
        this.turnText.classList.toggle('is-long', text.length > 22);

        this._renderBoard();

        const backBtn = kidButton({
            variant: 'blue',
            icon: 'KeyboardArrowLeft',
            ariaLabel: 'Coup précédent',
            enabled: cur > 0,
            className: 'kid-nav-step',
            onClick: () => this.back(),
        });
        const fwdBtn = kidButton({
            variant: 'blue',
            icon: 'KeyboardArrowRight',
            ariaLabel: 'Coup suivant',
            enabled: cur < s.line.size,
            className: 'kid-nav-step',
            onClick: () => this.forward(),
        });
        const mainBtn = s.result === null
            ? kidButton({
                label: 'Abandonner',
                variant: 'orange',
                icon: 'Flag',
                enabled: s.line.size > 0,
                className: 'kid-nav-main',
                onClick: () => this.resign(),
            })
            : kidButton({
                label: 'Rejouer',
                variant: 'green',
                icon: 'Replay',
                className: 'kid-nav-main',
                onClick: () => this.reset(),
            });
        this.navRow.replaceChildren(backBtn, fwdBtn, mainBtn);
        this.layout.relayout();
        this.board._syncCanvasSize();
    }

    // ---- Leçon animée d'une pièce ----

    _openDemo(type) {
        this._stopDemo();
        const piece = KID_LEGEND.find((p) => p.type === type);
        if (!piece) return;
        this._demoType = type;

        this.demoLayout = new ModuleLayoutView({ bottomMin: 190, adaptive: false });

        const headerPill = el('div', 'kid-demo-pill');
        headerPill.style.borderColor = piece.edge;
        const headerImg = document.createElement('img');
        headerImg.src = KID_PIECE_URLS[piece.type];
        headerImg.alt = '';
        headerImg.className = 'kid-demo-pill-img';
        const headerText = el(
            'span',
            'kid-demo-pill-text',
            `Comment bouge ${piece.article[0].toLowerCase()}${piece.article.slice(1)} ?`,
        );
        headerText.style.color = piece.ink;
        headerPill.append(headerImg, headerText);
        this.demoLayout.topSlot.appendChild(headerPill);

        const frame = el('div', 'kid-board-frame');
        const canvas = document.createElement('canvas');
        canvas.className = 'kid-demo-canvas';
        frame.appendChild(canvas);
        this.demoLayout.boardHost.appendChild(frame);
        this._demoCanvas = canvas;
        this._demoRo = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => { this._syncDemoCanvasSize(); this._drawDemo(); })
            : null;
        this._demoRo?.observe(frame);

        const bottom = el('div', 'kid-demo-bottom');
        const box = el('div', 'kid-demo-card');
        box.style.borderColor = piece.edge;
        box.style.color = piece.ink;
        const txtEl = el('p', 'kid-demo-text');
        appendBoldText(txtEl, piece.text);
        box.appendChild(txtEl);
        const backBtn = kidButton({
            label: 'Revenir à la partie',
            variant: 'green',
            icon: 'ArrowBack',
            className: 'full-w',
            onClick: () => {
                this._stopDemo();
                this._render();
            },
        });
        bottom.append(box, backBtn);
        this.demoLayout.bottomSlot.appendChild(bottom);

        this.mainWrap.replaceChildren(this.demoLayout.el);
        this.demoLayout.relayout();
        this._syncDemoCanvasSize();
        this._runDemoLoop(piece);
    }

    _stopDemo() {
        this._demoToken += 1;
        this._demoType = 0;
        if (this._demoTimer) { clearTimeout(this._demoTimer); this._demoTimer = null; }
        if (this._demoRaf) { cancelAnimationFrame(this._demoRaf); this._demoRaf = 0; }
        this._demoRo?.disconnect();
        this._demoRo = null;
        this._demoCanvas = null;
        this._demoSnapshot = null;
        if (this.demoLayout) {
            this.demoLayout.destroy();
            this.demoLayout = null;
            this.mainWrap.replaceChildren(this.layout.el);
        }
    }

    _syncDemoCanvasSize() {
        const cv = this._demoCanvas;
        if (!cv) return;
        const r = cv.getBoundingClientRect();
        const cssSide = Math.max(0, Math.round(r.width));
        if (!cssSide) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const px = Math.round(cssSide * dpr);
        if (cv.width !== px || cv.height !== px) {
            cv.width = px;
            cv.height = px;
        }
    }

    _runDemoLoop(piece) {
        const token = ++this._demoToken;
        const phases = demoPhases(piece.type);
        const wait = (ms) => new Promise((resolve) => {
            if (token !== this._demoToken || this._destroyed) { resolve(false); return; }
            this._demoTimer = setTimeout(() => {
                this._demoTimer = null;
                resolve(token === this._demoToken && !this._destroyed);
            }, ms);
        });
        const animateT = (durMs) => new Promise((resolve) => {
            const start = performance.now();
            const step = (now) => {
                this._demoRaf = 0;
                if (token !== this._demoToken || this._destroyed) { resolve(false); return; }
                const p = Math.min(1, (now - start) / durMs);
                if (this._demoSnapshot) this._demoSnapshot.t = p;
                this._drawDemo();
                if (p < 1) {
                    this._demoRaf = requestAnimationFrame(step);
                } else {
                    resolve(true);
                }
            };
            this._demoRaf = requestAnimationFrame(step);
        });

        (async () => {
            while (token === this._demoToken && !this._destroyed) {
                for (const ph of phases) {
                    for (const path of ph.paths) {
                        if (token !== this._demoToken || this._destroyed) return;
                        this._demoSnapshot = {
                            piece,
                            phase: ph,
                            from: ph.home,
                            to: ph.home,
                            enemyAlive: true,
                            target: path[path.length - 1],
                            t: 1,
                        };
                        this._drawDemo();
                        if (!(await wait(450))) return;
                        let cur = ph.home;
                        for (const s of path) {
                            this._demoSnapshot.from = cur;
                            this._demoSnapshot.to = s;
                            this._demoSnapshot.t = 0;
                            const far = Math.max(1, Math.abs(s[0] - cur[0]), Math.abs(s[1] - cur[1]));
                            const dur = piece.type === KNIGHT ? 560 : 250 + 110 * far;
                            if (!(await animateT(dur))) return;
                            feedback.move();
                            cur = s;
                            if (ph.enemy && s[0] === ph.enemy[0] && s[1] === ph.enemy[1]) {
                                this._demoSnapshot.enemyAlive = false;
                                this._drawDemo();
                            }
                        }
                        if (!(await wait(650))) return;
                    }
                }
            }
        })();
    }

    _drawDemo() {
        const cv = this._demoCanvas;
        const snap = this._demoSnapshot;
        if (!cv || !snap) return;
        const rect = cv.getBoundingClientRect();
        const cssSide = rect.width || (cv.width / Math.max(1, window.devicePixelRatio || 1));
        if (!cssSide) return;
        const dpr = cv.width / cssSide;
        const ctx = cv.getContext('2d');
        const c = KidColors;

        ctx.save();
        ctx.scale(dpr, dpr);
        const s = cssSide / 8;
        const topLeft = ([f, r]) => [f * s, (7 - r) * s];
        const center = ([f, r]) => [f * s + s / 2, (7 - r) * s + s / 2];

        for (let f = 0; f < 8; f++) {
            for (let r = 0; r < 8; r++) {
                ctx.fillStyle = (f + r) % 2 === 1 ? c.squareLight : c.squareDark;
                ctx.fillRect(f * s, (7 - r) * s, s + 0.4, s + 0.4);
            }
        }

        const { piece, phase, from, to, enemyAlive, target, t } = snap;
        for (const d of phase.dots) {
            const [cx, cy] = center(d);
            ctx.beginPath();
            if (phase.enemy && d[0] === phase.enemy[0] && d[1] === phase.enemy[1]) {
                ctx.strokeStyle = piece.edge;
                ctx.lineWidth = s * 0.09;
                ctx.arc(cx, cy, s * 0.44, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.fillStyle = piece.edge;
                ctx.globalAlpha = 0.85;
                ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }

        const [hx, hy] = topLeft(phase.home);
        ctx.fillStyle = piece.edge;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(hx, hy, s, s);
        ctx.globalAlpha = 1;

        if (piece.type === KNIGHT && target) {
            const h = phase.home;
            const cornerSq = BoardGeometry.knightCorner(sq(h[0], h[1]), sq(target[0], target[1]));
            const corner = cornerSq >= 0 ? [fileOf(cornerSq), rankOf(cornerSq)] : target;
            const [p0x, p0y] = center(h);
            const [p1x, p1y] = center(corner);
            const [p2x, p2y] = center(target);
            ctx.strokeStyle = piece.edge;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = s * 0.14;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(p0x, p0y);
            ctx.lineTo(p1x, p1y);
            ctx.lineTo(p2x, p2y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        const drawPiece = (pType, x, y, scaleY = 1) => {
            const img = pieceStore.getPieceImage(pType, true);
            if (!img) return;
            const ph = s * scaleY;
            ctx.drawImage(img, x, y + (s - ph), s, ph);
        };

        if (phase.enemy && enemyAlive) {
            const [ex, ey] = topLeft(phase.enemy);
            drawPiece(ROOK + BLACK, ex, ey, 1);
        }

        const [fx, fy] = topLeft(from);
        const [tx, ty] = topLeft(to);
        const gx = fx + (tx - fx) * t;
        const gy = fy + (ty - fy) * t;
        const dist = Math.max(1, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
        const lift = Math.sin(Math.PI * t) * s * (piece.type === KNIGHT ? 0.75 : 0.28 + 0.1 * dist);

        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.beginPath();
        ctx.ellipse(gx + s * 0.5, gy + s * 0.87, s * 0.3, s * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();

        const squash = t > 0.85 && t < 1 ? 0.92 : 1;
        drawPiece(piece.type, gx, gy - lift, squash);

        if (phase.enemy && !enemyAlive) {
            const [ex, ey] = topLeft(phase.enemy);
            ctx.fillStyle = '#FF6F61';
            ctx.beginPath();
            ctx.arc(ex + s * 0.82, ey + s * 0.18, s * 0.16, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}
