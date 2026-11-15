import { feedback } from './feedback.js';
import { createIcon } from './icons.js';
import { isTwoPane } from './theme.js';

export const Tone = Object.freeze({
    INFO: 'info',
    GOOD: 'good',
    BAD: 'bad',
    NEUTRAL: 'neutral',
    GOLD: 'gold',
});

export function formatFr(n) {
    const s = String(Math.abs(Math.trunc(n)));
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
        out += s[i];
    }
    return n < 0 ? '-' + out : out;
}

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/** Bouton texte + icône du design system ChessDuck. */
export function duckButton({
    label = '',
    onClick,
    enabled = true,
    accent = null,      // 'gold' | 'green' | 'blue' | 'red' | null
    filled = false,
    variant = null,     // 'primary' | 'tonal' | 'outlined' | 'ghost'
    icon = null,
    className = '',
    ariaLabel = null,
}) {
    const v = variant || (filled ? 'primary' : 'tonal');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `duck-btn duck-btn-${v}${accent ? ` accent-${accent}` : ''} ${className}`.trim();
    btn.disabled = !enabled;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    if (icon) btn.appendChild(createIcon(icon, 20));
    if (label) btn.appendChild(el('span', 'duck-btn-label', label));
    btn.addEventListener('click', (e) => {
        if (btn.disabled) return;
        feedback.key();
        onClick?.(e);
    });
    return btn;
}

/** Bouton-icône 48×48 du design system. */
export function duckIconButton({
    icon,
    ariaLabel,
    onClick,
    enabled = true,
    accent = null,
    filled = false,
    selected = null,
    badge = null,
    className = '',
}) {
    const on = selected === true || filled;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `duck-icon-btn${on ? ' is-on' : ''}${accent ? ` accent-${accent}` : ''} ${className}`.trim();
    btn.disabled = !enabled;
    btn.title = ariaLabel;
    btn.setAttribute('aria-label', ariaLabel + (badge ? ` (${badge})` : ''));
    if (selected !== null) btn.setAttribute('aria-pressed', String(Boolean(selected)));
    const inner = el('span', 'duck-icon-btn-inner');
    inner.appendChild(createIcon(icon, 22));
    btn.appendChild(inner);
    if (badge != null) btn.appendChild(el('span', 'duck-icon-badge', badge));
    btn.addEventListener('click', (e) => {
        if (btn.disabled) return;
        feedback.key();
        onClick?.(e);
    });
    return btn;
}

export function duckChip({ label, selected, onClick, icon = null, accent = 'gold', className = '' }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `duck-chip${selected ? ' is-selected' : ''} accent-${accent} ${className}`.trim();
    btn.setAttribute('aria-pressed', String(Boolean(selected)));
    if (icon) btn.appendChild(createIcon(icon, 16));
    btn.appendChild(el('span', '', label));
    btn.addEventListener('click', (e) => {
        feedback.key();
        onClick?.(e);
    });
    return btn;
}

export function duckSegmentedRow({ options, selectedIndex, onSelect, icons = null, className = '' }) {
    const wrap = el('div', `duck-seg-row ${className}`.trim());
    wrap.setAttribute('role', 'group');
    options.forEach((label, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const active = i === selectedIndex;
        btn.className = `duck-seg-btn${active ? ' is-selected' : ''}`;
        btn.setAttribute('aria-pressed', String(active));
        if (icons?.[i]) {
            btn.appendChild(createIcon(icons[i], 18));
        } else {
            btn.appendChild(createIcon('Check', 18, `duck-seg-check${active ? '' : ' hidden'}`));
        }
        btn.appendChild(el('span', 'duck-seg-label', label));
        btn.addEventListener('click', () => {
            feedback.key();
            onSelect?.(i);
        });
        wrap.appendChild(btn);
    });
    return wrap;
}

export function updateSegmentedRow(wrap, selectedIndex) {
    Array.from(wrap.children).forEach((btn, i) => {
        const active = i === selectedIndex;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-pressed', String(active));
        btn.querySelector('.duck-seg-check')?.classList.toggle('hidden', !active);
    });
}

export function infoPill({ text, icon = null, accent = null, ariaLabel = null, className = '' }) {
    const pill = el('span', `info-pill${accent ? ` accent-${accent}` : ''} ${className}`.trim());
    if (ariaLabel) pill.setAttribute('aria-label', ariaLabel);
    if (icon) pill.appendChild(createIcon(icon, 16));
    pill.appendChild(el('span', '', text));
    return pill;
}

const TONE_ICONS = {
    [Tone.INFO]: 'Info',
    [Tone.GOOD]: 'CheckCircle',
    [Tone.BAD]: 'ErrorOutline',
    [Tone.GOLD]: 'Lightbulb',
    [Tone.NEUTRAL]: 'HourglassTop',
};

/** Carte pédagogique sous l'échiquier avec réduction automatique de police (14 -> 12 px) et « Lire la suite ». */
export class FeedbackCardView {
    constructor() {
        this.el = el('div', 'feedback-card tone-info');
        this.el.setAttribute('aria-live', 'polite');
        this._row = el('div', 'feedback-row');
        this._iconWrap = el('span', 'feedback-icon');
        this._col = el('div', 'feedback-col');
        this._titleEl = el('div', 'feedback-title hidden');
        this._textEl = el('div', 'feedback-text');
        this._col.append(this._titleEl, this._textEl);
        this._row.append(this._iconWrap, this._col);
        this._moreBtn = document.createElement('button');
        this._moreBtn.type = 'button';
        this._moreBtn.className = 'feedback-more hidden';
        this._moreBtn.textContent = 'Lire la suite';
        this._actionWrap = el('div', 'feedback-action hidden');
        this.el.append(this._row, this._moreBtn, this._actionWrap);

        this._moreBtn.addEventListener('click', () => {
            if (this._currentTitle || this._currentText) {
                openAlertSheet(this._currentTitle || 'Message', this._currentText);
            }
        });
        this._currentTitle = null;
        this._currentText = '';
        this._fitRaf = 0;
        this.el._fitText = () => this.fitText();
        this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._scheduleFit()) : null;
        this._ro?.observe(this.el);
    }

    destroy() {
        if (this._fitRaf) cancelAnimationFrame(this._fitRaf);
        this._ro?.disconnect();
    }

    _scheduleFit() {
        if (this._fitRaf) return;
        this._fitRaf = requestAnimationFrame(() => {
            this._fitRaf = 0;
            this.fitText();
        });
    }

    update({ text, tone = Tone.INFO, title = null, actionEl = null }) {
        this.el.className = `feedback-card tone-${tone}`;
        this._iconWrap.replaceChildren(createIcon(TONE_ICONS[tone] || 'Info', 18));
        this._currentTitle = title;
        this._currentText = text || '';
        if (title) {
            this._titleEl.textContent = title;
            this._titleEl.classList.remove('hidden');
        } else {
            this._titleEl.textContent = '';
            this._titleEl.classList.add('hidden');
        }
        this._textEl.textContent = this._currentText;
        if (actionEl) {
            this._actionWrap.replaceChildren(actionEl);
            this._actionWrap.classList.remove('hidden');
        } else {
            this._actionWrap.replaceChildren();
            this._actionWrap.classList.add('hidden');
        }
        this.fitText();
        this._scheduleFit();
    }

    fitText() {
        this._textEl.style.fontSize = '14px';
        this._moreBtn.classList.add('hidden');
        this.el.classList.remove('is-overflowing');
        this.el.onclick = null;
        // Si le texte déborde à 14px dans une carte contrainte, réduire jusqu'à 12px.
        if (this.el.clientHeight > 0 && this._row.scrollHeight > this._row.clientHeight + 2) {
            for (const sz of [13, 12]) {
                this._textEl.style.fontSize = `${sz}px`;
                if (this._row.scrollHeight <= this._row.clientHeight + 2) break;
            }
            if (this._row.scrollHeight > this._row.clientHeight + 2) {
                this._moreBtn.classList.remove('hidden');
                this.el.classList.add('is-overflowing');
                this.el.onclick = (e) => {
                    if (e.target.closest('button, a')) return;
                    if (this._currentTitle || this._currentText) {
                        openAlertSheet(this._currentTitle || 'Message', this._currentText);
                    }
                };
            }
        }
    }
}

/** Numéro de tour du demi-coup [i], la ligne commençant au tour [first] (par défaut, le vrai numéro de la partie). */
export function turnOf(line, i, first = line.positions[0].fullmove) {
    return line.positions[i].fullmove - line.positions[0].fullmove + first;
}

/** Libellé d'un coup : « 6. O-O » pour les Blancs, « 12… Qe5+ » pour les Noirs. */
export function moveLabel(turn, white, san) {
    return white ? `${turn}. ${san}` : `${turn}… ${san}`;
}

/** Titre de carte pour la position après [cursor] demi-coups : « 12… Qe5+ · coup 12 sur 14 ». */
export function stepTitle(line, cursor, { first = line.positions[0].fullmove, note = null } = {}) {
    const i = cursor - 1;
    const turn = turnOf(line, i, first);
    const label = moveLabel(turn, line.positions[i].whiteToMove, line.sans[i]);
    return `${label}${note ? ` ${note}` : ''} · coup ${turn} sur ${turnOf(line, line.size - 1, first)}`;
}

/**
 * Bande horizontale des coups joués, regroupés par tour : chaque capsule réunit le numéro du tour (en bleu),
 * le coup des Blancs et la réponse des Noirs. Seul le coup affiché est surligné. Flèches précédent / suivant.
 */
export class MoveStripView {
    constructor() {
        this.el = el('div', 'move-strip');
        this._prevBtn = duckIconButton({
            icon: 'KeyboardArrowLeft',
            ariaLabel: 'Coup précédent',
            onClick: () => this._onPrev?.(),
        });
        this._list = el('div', 'move-strip-list');
        this._nextBtn = duckIconButton({
            icon: 'KeyboardArrowRight',
            ariaLabel: 'Coup suivant',
            onClick: () => this._onNext?.(),
        });
        this.el.append(this._prevBtn, this._list, this._nextBtn);
        this._onPrev = null;
        this._onNext = null;
        this._lastLineRef = null;
        this._lastSize = -1;
        this._lastFirstTurn = null;
        this._lastCursor = -1;
        this._lastInteractive = null;
        this._moveEls = [];
    }

    update({
        line,
        cursor,
        onSelect = null,
        onPrev = null,
        onNext = null,
        prevEnabled = cursor > 0,
        nextEnabled = line ? cursor < line.size : false,
        emptyText = 'Les coups de la partie s\'afficheront ici.',
        firstTurn = null,
    }) {
        this._onPrev = onPrev;
        this._onNext = onNext;
        this._prevBtn.classList.toggle('hidden', !onPrev);
        this._nextBtn.classList.toggle('hidden', !onNext);
        this._prevBtn.disabled = !prevEnabled;
        this._nextBtn.disabled = !nextEnabled;

        if (!line) return;
        const first = firstTurn ?? line.positions[0].fullmove;
        const interactive = Boolean(onSelect);
        if (this._lastLineRef !== line || this._lastSize !== line.size || this._lastFirstTurn !== first || this._lastInteractive !== interactive) {
            this._lastLineRef = line;
            this._lastSize = line.size;
            this._lastFirstTurn = first;
            this._lastInteractive = interactive;
            this._lastCursor = -1;
            this._moveEls = new Array(line.size);
            const frag = document.createDocumentFragment();
            if (line.size === 0) {
                frag.appendChild(el('span', 'move-strip-empty', emptyText));
            } else {
                const turns = [];
                for (let i = 0; i < line.size; i++) {
                    const turn = turnOf(line, i, first);
                    const lastGrp = turns[turns.length - 1];
                    if (lastGrp && lastGrp.turn === turn) lastGrp.plies.push(i);
                    else turns.push({ turn, plies: [i] });
                }
                for (const { turn, plies } of turns) {
                    const capsule = el('div', 'move-strip-turn');
                    const blackFirst = !line.positions[plies[0]].whiteToMove;
                    const numEl = el('span', 'move-strip-turn-num', blackFirst ? `${turn}…` : `${turn}`);
                    numEl.setAttribute('aria-hidden', 'true');
                    capsule.appendChild(numEl);
                    for (const i of plies) {
                        const white = line.positions[i].whiteToMove;
                        const label = moveLabel(turn, white, line.sans[i]);
                        const item = document.createElement(onSelect ? 'button' : 'span');
                        if (onSelect) {
                            item.type = 'button';
                            item.setAttribute('aria-label', `Aller au coup ${label}`);
                            item.addEventListener('click', () => {
                                feedback.key();
                                onSelect(i + 1);
                            });
                        }
                        item.className = `move-strip-item ${white ? 'is-white' : 'is-black'}`;
                        item.textContent = line.sans[i];
                        item._capsule = capsule;
                        this._moveEls[i] = item;
                        capsule.appendChild(item);
                    }
                    frag.appendChild(capsule);
                }
            }
            this._list.replaceChildren(frag);
        }

        if (this._lastCursor !== cursor && line.size > 0) {
            if (this._lastCursor > 0 && this._moveEls[this._lastCursor - 1]) {
                this._moveEls[this._lastCursor - 1].classList.remove('is-current');
                this._moveEls[this._lastCursor - 1].setAttribute('aria-current', 'false');
            }
            if (cursor > 0 && this._moveEls[cursor - 1]) {
                const curEl = this._moveEls[cursor - 1];
                curEl.classList.add('is-current');
                curEl.setAttribute('aria-current', 'true');
                try {
                    (curEl._capsule || curEl).scrollIntoView({ inline: 'nearest', block: 'nearest' });
                } catch { /* ignore */ }
            }
            this._lastCursor = cursor;
        }
    }
}

export function loadingState(message) {
    const box = el('div', 'loading-state');
    box.append(el('div', 'duck-spinner'), el('p', 'muted-text', message));
    return box;
}

export function emptyState({ icon, title, message, actionLabel = null, onAction = null, secondaryLabel = null, onSecondary = null }) {
    const card = el('div', 'empty-state');
    const ic = createIcon(icon, 36);
    ic.classList.add('empty-state-icon');
    card.append(ic, el('h3', 'empty-state-title', title), el('p', 'empty-state-msg', message));
    if (actionLabel && onAction) {
        card.appendChild(duckButton({ label: actionLabel, onClick: onAction, accent: 'gold', filled: true, className: 'full-w' }));
    }
    if (secondaryLabel && onSecondary) {
        card.appendChild(duckButton({ label: secondaryLabel, onClick: onSecondary, variant: 'outlined', className: 'full-w mt-8' }));
    }
    return card;
}

/** Modal layer stack managed cleanly in #modal-root */
function modalRoot() {
    let root = document.getElementById('modal-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'modal-root';
        document.body.appendChild(root);
    }
    return root;
}

export function openConfirmDialog({ title, text, confirmLabel, onConfirm, dismissLabel = 'Annuler', confirmAccent = 'red' }) {
    const root = modalRoot();
    const backdrop = el('div', 'duck-dialog-backdrop');
    const dlg = el('div', 'duck-dialog');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    const titleEl = el('h2', 'duck-dialog-title', title);
    const bodyEl = el('p', 'duck-dialog-text', text);
    const actions = el('div', 'duck-dialog-actions');
    const cancelBtn = duckButton({ label: dismissLabel, variant: 'ghost', onClick: close });
    const okBtn = duckButton({
        label: confirmLabel,
        variant: 'ghost',
        accent: confirmAccent,
        onClick: () => { close(); onConfirm?.(); },
    });
    actions.append(cancelBtn, okBtn);
    dlg.append(titleEl, bodyEl, actions);
    backdrop.appendChild(dlg);

    function onKey(e) {
        if (e.key === 'Escape' && root.lastElementChild === backdrop) close();
    }
    function close() {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
    }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(backdrop);
    return { close };
}

export function openAlertSheet(title, text) {
    const sheet = createSheet(title);
    sheet.body.appendChild(el('p', 'sheet-message-text', text));
    return sheet;
}

export function createSheet(title, onCloseCallback = null) {
    const root = modalRoot();
    const backdrop = el('div', 'duck-sheet-backdrop');
    const sheet = el('div', 'duck-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const handle = el('div', 'duck-sheet-handle');
    const header = el('div', 'duck-sheet-header');
    const titleEl = el('h2', 'duck-sheet-title', title);
    const closeBtn = duckIconButton({ icon: 'Close', ariaLabel: 'Fermer', onClick: close });
    header.append(titleEl, closeBtn);
    const body = el('div', 'duck-sheet-body');
    sheet.append(handle, header, body);
    backdrop.appendChild(sheet);

    let closed = false;
    function onKey(e) {
        if (e.key === 'Escape' && root.lastElementChild === backdrop) close();
    }
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        onCloseCallback?.();
    }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(backdrop);

    return {
        backdrop,
        sheet,
        titleEl,
        body,
        close,
        setTitle(t) { titleEl.textContent = t; },
    };
}

/**
 * Gabarit responsive 1:1 avec ModuleLayout de ChessNote :
 * en portrait, échiquier carré adaptatif maximisé selon la hauteur réelle du contenu du bas ;
 * en paysage tablette/bureau (w > h * 1.15), échiquier à gauche et panneau de commandes à droite.
 */
export class ModuleLayoutView {
    constructor({ bottomMin = 170, adaptive = true } = {}) {
        this.bottomMin = bottomMin;
        this.adaptive = adaptive;
        this.el = el('div', 'module-layout');
        this.topSlot = el('div', 'module-top');
        this.boardPane = el('div', 'module-board-pane');
        this.overSlot = el('div', 'module-over');
        this.boardHost = el('div', 'module-board-host');
        this.underSlot = el('div', 'module-under');
        this.boardPane.append(this.overSlot, this.boardHost, this.underSlot);
        this.panelPane = el('div', 'module-panel-pane');
        this.bottomSlot = el('div', 'module-bottom');
        this.panelPane.append(this.topSlot, this.bottomSlot);
        this.el.append(this.boardPane, this.panelPane);

        this._evalActive = false;
        this._evalPad = 0;
        this._destroyed = false;
        this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.relayout()) : null;
        this._ro?.observe(this.el);
        this._onWindowResize = () => this.relayout();
        window.addEventListener('resize', this._onWindowResize);
        window.visualViewport?.addEventListener('resize', this._onWindowResize);
        document.fonts?.ready?.then(() => { if (!this._destroyed) this.relayout(); });
    }

    destroy() {
        this._destroyed = true;
        this._ro?.disconnect();
        window.removeEventListener('resize', this._onWindowResize);
        window.visualViewport?.removeEventListener('resize', this._onWindowResize);
    }

    setEvalActive(active) {
        this._evalActive = Boolean(active);
        this._evalPad = this._resolveEvalPad();
        this.relayout();
    }

    _resolveEvalPad() {
        if (!this._evalActive) return 0;
        const evalEl = this.boardHost.querySelector('.eval-bar');
        if (evalEl && typeof evalEl._measureSpace === 'function') {
            return evalEl._measureSpace();
        }
        return 32;
    }

    resetReserve() {
        this.relayout();
    }

    _measureChildHeight(child) {
        if (!child || child.classList.contains('hidden')) return 0;
        const cs = getComputedStyle(child);
        if (cs.display === 'none') return 0;

        if (child.classList.contains('feedback-card')) {
            const row = child.querySelector('.feedback-row');
            const textEl = child.querySelector('.feedback-text');
            const actionEl = child.querySelector('.feedback-action');
            const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
                + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            const minH = parseFloat(cs.minHeight) || 0;
            let rowH = row ? row.scrollHeight : 0;
            if (row && textEl) {
                const prevFs = textEl.style.fontSize;
                const prevFlex = row.style.flex;
                const prevOverflow = row.style.overflow;
                textEl.style.fontSize = '14px';
                row.style.flex = '0 0 auto';
                row.style.overflow = 'visible';
                rowH = Math.ceil(row.scrollHeight);
                textEl.style.fontSize = prevFs;
                row.style.flex = prevFlex;
                row.style.overflow = prevOverflow;
            }
            const actionH = (actionEl && !actionEl.classList.contains('hidden')) ? actionEl.offsetHeight : 0;
            return Math.max(minH, Math.ceil(padY + rowH + actionH));
        }

        if (child.classList.contains('rev-move-table')) {
            return 92;
        }

        if (child.classList.contains('kid-demo-bottom') || child.classList.contains('kid-bottom-col')) {
            const subPad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
                + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            const subGap = parseFloat(cs.rowGap || cs.gap) || 0;
            let sum = subPad;
            let vis = 0;
            for (const sub of child.children) {
                const h = this._measureChildHeight(sub);
                if (h > 0) {
                    if (vis > 0) sum += subGap;
                    sum += h;
                    vis += 1;
                }
            }
            return Math.ceil(sum);
        }

        if (child.classList.contains('kid-demo-card')) {
            const subPad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
                + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            const txt = child.querySelector('.kid-demo-text');
            return Math.ceil(subPad + (txt ? txt.scrollHeight : child.scrollHeight));
        }

        return Math.max(child.offsetHeight, child.scrollHeight);
    }

    _measureBottomNeeded() {
        const cs = getComputedStyle(this.bottomSlot);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const gap = parseFloat(cs.rowGap || cs.gap) || 0;
        let sum = padY;
        let vis = 0;
        for (const child of this.bottomSlot.children) {
            const ch = this._measureChildHeight(child);
            if (ch > 0) {
                if (vis > 0) sum += gap;
                sum += ch;
                vis += 1;
            }
        }
        return vis > 0 ? Math.ceil(sum) : 0;
    }

    _refitFeedbackCards() {
        for (const child of this.bottomSlot.children) {
            if (child._fitText) child._fitText();
            else child.querySelector('.feedback-card')?._fitText?.();
        }
    }

    relayout() {
        const w = this.el.clientWidth;
        const h = this.el.clientHeight;
        if (!w || !h) return;
        this._evalPad = this._resolveEvalPad();
        const twoPane = isTwoPane(window.innerWidth, window.innerHeight);
        this.el.classList.toggle('is-two-pane', twoPane);

        if (twoPane) {
            this.el.classList.remove('is-portrait-scroll');
            if (this.topSlot.parentElement !== this.panelPane) this.panelPane.prepend(this.topSlot);
            const gap = 12;
            const overH = this.overSlot.offsetHeight || 0;
            const underH = this.underSlot.offsetHeight || 0;
            const maxPanelReserve = Math.min(w * 0.42, w - 220);
            const minPanelReserve = Math.min(308, Math.max(240, w - 160 - gap - this._evalPad));
            const side = Math.max(150, Math.min(
                h - overH - underH - 4,
                w - Math.max(minPanelReserve, maxPanelReserve) - gap - this._evalPad,
                Math.floor(w * 0.56),
            ));
            this.boardPane.style.width = `${side + this._evalPad}px`;
            this.boardPane.style.alignItems = '';
            this.boardHost.style.width = `${side + this._evalPad}px`;
            this.boardHost.style.height = `${side}px`;
            this.overSlot.style.width = `${side}px`;
            this.underSlot.style.width = `${side}px`;
            this.overSlot.style.marginLeft = `${this._evalPad}px`;
            this.underSlot.style.marginLeft = `${this._evalPad}px`;
            this._refitFeedbackCards();
            return;
        }

        // Portrait : ordre vertical top -> overBoard -> board -> underBoard -> bottom
        if (this.topSlot.parentElement !== this.el) {
            this.el.insertBefore(this.topSlot, this.boardPane);
        }
        this.panelPane.style.width = '';
        const topH = this.topSlot.offsetHeight || 0;
        const overH = this.overSlot.offsetHeight || 0;
        const underH = this.underSlot.offsetHeight || 0;
        const availW = Math.max(150, w - 12);
        const measuredBottom = this._measureBottomNeeded();
        const effectiveBottom = measuredBottom > 0 ? measuredBottom : this.bottomMin;
        const availBoard = Math.floor(h - topH - overH - underH - effectiveBottom - 2);
        const needScroll = availBoard < 148;
        this.el.classList.toggle('is-portrait-scroll', needScroll);
        const maxBoardW = availW - this._evalPad;
        const side = Math.max(
            148,
            Math.min(maxBoardW, needScroll ? Math.min(maxBoardW, 240) : availBoard),
        );
        this.boardPane.style.width = '';
        this.boardPane.style.alignItems = 'center';
        this.boardHost.style.width = `${side + this._evalPad}px`;
        this.boardHost.style.height = `${side}px`;
        this.overSlot.style.width = `${side}px`;
        const hasPills = Boolean(this.underSlot.querySelector('.notation-under-row'));
        this.underSlot.style.width = hasPills ? `${Math.min(availW, Math.max(side, 290))}px` : `${side}px`;
        this.overSlot.style.marginLeft = `${this._evalPad}px`;
        this.underSlot.style.marginLeft = hasPills ? '0px' : `${this._evalPad}px`;
        this._refitFeedbackCards();
    }
}
