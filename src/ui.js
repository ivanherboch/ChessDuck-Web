// Primitives d'interface partagées (boutons, pastilles, bandeau pédagogique, tiroir modal, jauge d'évaluation et gabarit ModuleLayout)
// Adapté de Common.kt et Board.kt (ChessDuck v1.6.0) avec ergonomie Safari iPhone.

export const Tone = Object.freeze({
  INFO: 'INFO',
  GOOD: 'GOOD',
  BAD: 'BAD',
  GOLD: 'GOLD',
  NEUTRAL: 'NEUTRAL',
});

export function moveLabel(fullmove, white, san) {
  return white ? `${fullmove}. ${san}` : `${fullmove}… ${san}`;
}

export function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'className' || k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) node.style.setProperty(sk, sv);
          else node.style[sk] = sv;
        }
      } else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  for (const ch of children) {
    if (ch === null || ch === undefined || ch === false) continue;
    if (Array.isArray(ch)) {
      for (const item of ch) {
        if (item !== null && item !== undefined && item !== false) {
          node.appendChild(typeof item === 'string' || typeof item === 'number' ? document.createTextNode(String(item)) : item);
        }
      }
    } else {
      node.appendChild(typeof ch === 'string' || typeof ch === 'number' ? document.createTextNode(String(ch)) : ch);
    }
  }
  return node;
}

export function makeButton({
  label,
  onClick,
  accent = null, // 'blue' | 'gold' | 'green' | 'red' | null
  filled = false,
  enabled = true,
  height = 40,
  weight = 1,
  className = '',
  id = null,
  feedback = null,
}) {
  const btn = el('button', {
    type: 'button',
    id,
    className: `duck-btn ${accent ? `accent-${accent}` : ''} ${filled ? 'is-filled' : ''} ${className}`.trim(),
    disabled: !enabled,
    style: {
      flexGrow: String(weight),
      flexBasis: '0',
      minHeight: `${height}px`,
      height: `${height}px`,
    },
    onClick: (e) => {
      if (btn.disabled) return;
      feedback?.key();
      onClick(e);
    },
  }, el('span', { className: 'duck-btn-label' }, label));

  btn.setConfig = ({ label: nextLabel, accent: nextAccent, filled: nextFilled, enabled: nextEnabled, height: nextHeight } = {}) => {
    if (nextLabel !== undefined) btn.firstChild.textContent = nextLabel;
    if (nextAccent !== undefined) {
      btn.classList.remove('accent-blue', 'accent-gold', 'accent-green', 'accent-red');
      if (nextAccent) btn.classList.add(`accent-${nextAccent}`);
    }
    if (nextFilled !== undefined) btn.classList.toggle('is-filled', !!nextFilled);
    if (nextEnabled !== undefined) btn.disabled = !nextEnabled;
    if (nextHeight !== undefined) {
      btn.style.minHeight = `${nextHeight}px`;
      btn.style.height = `${nextHeight}px`;
    }
  };
  return btn;
}

export function makeChip({ label, selected = false, onClick, accent = 'gold', weight = 1, feedback = null }) {
  const btn = el('button', {
    type: 'button',
    className: `duck-chip accent-${accent} ${selected ? 'is-selected' : ''}`,
    style: { flexGrow: String(weight), flexBasis: '0' },
    onClick: () => {
      feedback?.key();
      onClick();
    },
  }, el('span', { className: 'duck-chip-label' }, label));

  btn.setSelected = (sel) => btn.classList.toggle('is-selected', !!sel);
  return btn;
}

export function makeFeedbackCard() {
  const titleEl = el('div', { className: 'feedback-title hidden' });
  const textEl = el('div', { className: 'feedback-text' });
  const card = el('div', { className: 'feedback-card tone-info' }, titleEl, textEl);
  card.setState = (text, tone = Tone.INFO, title = null) => {
    card.className = `feedback-card tone-${tone.toLowerCase()}`;
    if (title) {
      titleEl.textContent = title;
      titleEl.classList.remove('hidden');
    } else {
      titleEl.textContent = '';
      titleEl.classList.add('hidden');
    }
    textEl.textContent = text || '';
  };
  return card;
}

export function makeSectionTitle(text) {
  return el('div', { className: 'section-title' }, text);
}

/**
 * Jauge latérale d'évaluation (whiteShare entre 0 et 1).
 */
export class EvalBarView {
  constructor(container) {
    this.root = el('div', { className: 'eval-bar hidden' });
    this.whiteEl = el('div', { className: 'eval-bar-white' });
    this.midEl = el('div', { className: 'eval-bar-mid' });
    this.root.append(this.whiteEl, this.midEl);
    container.appendChild(this.root);
    this.visible = false;
  }

  setState({ visible, whiteShare = 0.5, flipped = false }) {
    this.visible = !!visible;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) return;
    const pct = Math.max(3, Math.min(97, whiteShare * 100));
    this.whiteEl.style.height = `${pct.toFixed(1)}%`;
    this.whiteEl.style.top = flipped ? '0' : 'auto';
    this.whiteEl.style.bottom = flipped ? 'auto' : '0';
  }
}

/**
 * Gabarit « Zéro Scroll » fidèle à Common.kt : calcule exactement la taille carrée de l'échiquier
 * pour garantir que top + échiquier + underBoard + bottom tiennent sans défilement sur mobile portrait
 * et bascule en 2 colonnes (échiquier à gauche, commandes à droite) en paysage.
 */
export class ModuleLayoutView {
  constructor({ bottomMin = 150, hasEvalSlot = false, hasUnderBoard = false, kid = false } = {}) {
    this.bottomMin = bottomMin;
    this.hasEvalSlot = hasEvalSlot;
    this.hasUnderBoard = hasUnderBoard;
    this.kid = kid;

    this.root = el('div', { className: `module-layout ${kid ? 'is-kid' : ''}` });
    this.leftCol = el('div', { className: 'module-board-col' });
    this.panelCol = el('div', { className: 'module-panel-col' });
    this.topEl = el('div', { className: 'module-top' });
    this.boardStage = el('div', { className: 'module-board-stage' });
    this.boardRow = el('div', { className: 'board-row' });
    this.boardMount = el('div', { className: 'board-mount' });
    this.evalBar = hasEvalSlot ? new EvalBarView(this.boardRow) : null;
    this.boardRow.appendChild(this.boardMount);
    this.boardStage.appendChild(this.boardRow);

    this.underEl = el('div', { className: `module-under ${hasUnderBoard ? '' : 'hidden'}` });
    this.bottomEl = el('div', { className: 'module-bottom' });

    this.leftCol.append(this.boardStage, this.underEl);
    this.panelCol.append(this.topEl, this.bottomEl);
    this.root.append(this.topEl, this.leftCol, this.bottomEl);

    this._onResizeSide = null;
    this._ro = new ResizeObserver(() => this.measure());
    this._ro.observe(this.root);
  }

  onBoardSize(fn) {
    this._onResizeSide = fn;
  }

  setModeLandscape(landscape) {
    if (landscape) {
      if (this.topEl.parentNode !== this.panelCol) {
        this.panelCol.innerHTML = '';
        this.panelCol.append(this.topEl, this.bottomEl);
      }
      if (this.panelCol.parentNode !== this.root) {
        this.root.innerHTML = '';
        this.root.append(this.leftCol, this.panelCol);
      }
      this.root.classList.add('is-landscape');
    } else {
      if (this.topEl.parentNode !== this.root) {
        this.root.innerHTML = '';
        this.root.append(this.topEl, this.leftCol, this.bottomEl);
      }
      this.root.classList.remove('is-landscape');
    }
  }

  measure() {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w <= 0 || h <= 0) return;

    const landscape = w > h * 1.15;
    this.setModeLandscape(landscape);

    const evalW = this.evalBar && this.evalBar.visible ? 16 : 0;
    const framePad = this.kid ? 14 : 0; // cadre menthe 7px * 2 en mode enfant
    const underH = this.hasUnderBoard ? (this.kid ? 40 : 31) : 0;
    this.root.classList.toggle('is-compact-h', !landscape && h < 530);

    let side = 0;
    if (landscape) {
      const panelMin = Math.max(260, Math.min(340, Math.floor(w * 0.36)));
      const maxBoardW = Math.min(w - panelMin - 12 - evalW - framePad, Math.floor(w * 0.64) - evalW - framePad);
      const maxBoardH = h - underH - framePad - 4;
      side = Math.max(120, Math.floor(Math.min(maxBoardW, maxBoardH)));
      this.leftCol.style.width = `${side + evalW + framePad}px`;
      this.panelCol.style.maxHeight = `${h}px`;
    } else {
      const topH = this.topEl.offsetHeight;
      // Sur iPhone SE / écrans très courts (<520px utiles), on adapte le plancher pour préserver un échiquier lisible.
      const scaledMin = h < 520 ? Math.min(this.bottomMin, Math.round(this.bottomMin * 0.80)) : this.bottomMin;
      const availForBoard = h - topH - underH - scaledMin - framePad;
      side = Math.max(140, Math.floor(Math.min(w - evalW - framePad - (this.kid ? 8 : 0), availForBoard)));
      this.leftCol.style.width = '';
      this.panelCol.style.maxHeight = '';
    }

    this.boardStage.style.width = `${side + evalW + framePad}px`;
    this.boardStage.style.height = `${side + framePad}px`;
    if (this.hasUnderBoard) {
      this.underEl.style.width = `${side + evalW + framePad}px`;
      this.underEl.style.paddingLeft = `${evalW + (this.kid ? 4 : 0)}px`;
      this.underEl.style.paddingRight = `${this.kid ? 4 : 0}px`;
    }
    this._onResizeSide?.(side, evalW, landscape, h);
  }
}

/**
 * Tiroir modal coulissant (DuckSheet), fermé par backdrop, glissement vers le bas ou bouton ✕.
 */
class SheetManager {
  constructor() {
    this.overlay = null;
    this.onCloseCurrent = null;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.overlay) this.close();
      });
    }
  }

  open({ title, onClose = null, onBuild = () => {} }) {
    this.close(false);
    this.onCloseCurrent = onClose;

    const handle = el('div', { className: 'sheet-handle-bar' }, el('div', { className: 'sheet-handle' }));
    const closeBtn = el('button', {
      type: 'button',
      className: 'sheet-close-btn',
      'aria-label': 'Fermer',
      onClick: () => this.close(),
    }, '✕');
    const titleEl = el('div', { className: 'sheet-title' }, title);
    const header = el('div', { className: 'sheet-header' }, titleEl, closeBtn);
    const body = el('div', { className: 'sheet-body' });

    const sheet = el('div', {
      className: 'duck-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      onClick: (e) => e.stopPropagation(),
    }, handle, header, body);

    const overlay = el('div', {
      className: 'sheet-backdrop',
      onClick: () => this.close(),
    }, sheet);

    // Geste de glissement vers le bas sur la poignée ou l'en-tête (ergonomie iOS native)
    let startY = 0;
    let dragging = false;
    const onDown = (e) => {
      if (e.target === closeBtn) return;
      startY = e.clientY;
      dragging = true;
      sheet.style.transition = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      const dy = e.clientY - startY;
      if (dy > 90) {
        this.close();
      } else {
        sheet.style.transform = '';
      }
    };
    handle.addEventListener('pointerdown', onDown);
    header.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    this._cleanupGesture = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    const modalRoot = document.getElementById('modal-root') || document.body;
    modalRoot.appendChild(overlay);
    this.overlay = overlay;

    const api = {
      body,
      setTitle: (next) => { titleEl.textContent = next; },
      close: () => this.close(),
    };
    onBuild(body, api);

    requestAnimationFrame(() => overlay.classList.add('is-open'));
    return api;
  }

  close(notify = true) {
    if (!this.overlay) return;
    const ov = this.overlay;
    const cb = this.onCloseCurrent;
    this.overlay = null;
    this.onCloseCurrent = null;
    this._cleanupGesture?.();
    this._cleanupGesture = null;
    ov.classList.remove('is-open');
    setTimeout(() => ov.remove(), 200);
    if (notify && cb) cb();
  }
}

export const sheets = new SheetManager();
