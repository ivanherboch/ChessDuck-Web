import { StockfishEngine } from './core/stockfish.js';
import { db } from './data/db.js';
import { prefs } from './data/prefs.js';
import { AcademyFeature } from './features/academy.js';
import { KidFeature } from './features/kid.js';
import { openMemoSheet } from './features/memo-sheet.js';
import { NotationFeature } from './features/notation.js';
import { PlayFeature } from './features/play.js';
import { PuzzlesFeature } from './features/puzzles.js';
import { openSettingsSheet } from './features/settings-sheet.js';
import { duckButton, duckIconButton, el } from './ui/common.js';
import { feedback } from './ui/feedback.js';
import { createIcon } from './ui/icons.js';
import { KidColors, applyThemeToDom, computeIosTopGap, isIosDevice, isTwoPane, resolvePalette } from './ui/theme.js';

const TABS = [
    { label: 'Notation', icon: 'KeyboardOutlined', selectedIcon: 'Keyboard' },
    { label: 'Académie', icon: 'SchoolOutlined', selectedIcon: 'School' },
    { label: 'Problèmes', icon: 'ExtensionOutlined', selectedIcon: 'Extension' },
    { label: 'Jeu Libre', icon: 'Knight', selectedIcon: 'Knight' },
];

const TAB_STORAGE_KEY = 'chessduck_active_tab';

function loadInitialTab() {
    try {
        const raw = window.sessionStorage?.getItem(TAB_STORAGE_KEY);
        const n = raw !== null ? parseInt(raw, 10) : 0;
        return Number.isInteger(n) && n >= 0 && n < TABS.length ? n : 0;
    } catch {
        return 0;
    }
}

function saveActiveTab(idx) {
    try {
        window.sessionStorage?.setItem(TAB_STORAGE_KEY, String(idx));
    } catch { /* ignore */ }
}

function createNavButton(spec, onSelect) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'duck-nav-item';
    btn.setAttribute('aria-label', spec.label);
    const pill = el('span', 'duck-nav-pill');
    const lbl = el('span', 'duck-nav-label', spec.label);
    btn.append(pill, lbl);
    btn.addEventListener('click', onSelect);
    return { btn, pill, spec };
}

class ChessDuckApp {
    constructor(rootEl) {
        this.rootEl = rootEl;
        this.engine = new StockfishEngine();
        this.activeTab = loadInitialTab();
        this.features = new Array(TABS.length).fill(null);
        this.kidFeature = null;
        this._wasKid = prefs.current.kidMode;
        this._palette = resolvePalette(prefs.current);
        this._isIos = isIosDevice();
        this._safeProbe = null;
        document.documentElement.classList.toggle('is-ios', this._isIos);

        this._syncViewportMetrics();
        this._buildShell();
        this._syncLayoutMode();
        if (!prefs.current.kidMode) {
            this._mountTab(this.activeTab);
        }

        this._unsubPrefs = prefs.subscribe((st) => this._applyPrefs(st));

        this._mq = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;
        this._onMediaChange = () => this._applyPrefs(prefs.current);
        this._mq?.addEventListener?.('change', this._onMediaChange);

        this._onResize = () => {
            this._syncViewportMetrics();
            this._syncLayoutMode();
            const cur = prefs.current.kidMode ? this.kidFeature : this.features[this.activeTab];
            cur?.onActivate?.();
        };
        this._onOrientationChange = () => {
            this._onResize();
            requestAnimationFrame(() => this._onResize());
            setTimeout(() => this._onResize(), 200);
        };
        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onOrientationChange);
        window.visualViewport?.addEventListener('resize', this._onResize);

        db.initUserState().catch(() => {});
    }

    _measureSafeTop() {
        if (!this._isIos || typeof document === 'undefined' || !document.body) return 0;
        if (!this._safeProbe) {
            const p = document.createElement('div');
            p.setAttribute('aria-hidden', 'true');
            p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);';
            document.body.appendChild(p);
            this._safeProbe = p;
        }
        return parseFloat(getComputedStyle(this._safeProbe).paddingTop) || 0;
    }

    _syncViewportMetrics() {
        const ae = typeof document !== 'undefined' ? document.activeElement : null;
        const editing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (editing) return;
        const vv = window.visualViewport;
        let h = window.innerHeight;
        if (vv && vv.height > 0) {
            const scale = vv.scale && vv.scale > 0 ? vv.scale : 1;
            h = Math.min(h, Math.round(vv.height * scale));
        }
        if (h > 0) {
            document.documentElement.style.setProperty('--app-h', `${h}px`);
        }
        if (this._isIos) {
            const standalone = Boolean(window.navigator?.standalone)
                || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
            const safeTop = this._measureSafeTop();
            const topGap = computeIosTopGap({
                isIos: true,
                standalone,
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                screenWidth: window.screen?.width || 0,
                screenHeight: window.screen?.height || 0,
                safeTop,
            });
            document.documentElement.style.setProperty('--ios-top-gap', `${topGap}px`);
        } else {
            document.documentElement.style.removeProperty('--ios-top-gap');
        }
    }

    _buildShell() {
        this.appShell = el('div', 'app-shell');
        this.kidShell = el('div', 'kid-shell hidden');

        // Navigation Rail (tablette / paysage)
        this.railEl = el('nav', 'duck-rail');
        this.railEl.setAttribute('aria-label', 'Navigation principale');
        const railSpacerTop = el('div', 'duck-rail-spacer');
        const railSpacerBot = el('div', 'duck-rail-spacer');
        this.railItems = TABS.map((spec, i) => createNavButton(spec, () => this.selectTab(i)));
        this.railEl.append(railSpacerTop, ...this.railItems.map((it) => it.btn), railSpacerBot);

        // Main column (header + content)
        this.mainEl = el('div', 'app-main');
        this.headerEl = el('header', 'app-header');
        const mascot = document.createElement('img');
        mascot.src = './assets/mascot.png';
        mascot.alt = '';
        mascot.width = 34;
        mascot.height = 34;
        mascot.className = 'app-logo';

        const title = el('h1', 'app-title', 'ChessDuck');
        this.memoBtn = duckButton({
            label: 'Mémo',
            icon: 'MenuBook',
            accent: 'blue',
            ariaLabel: 'Mémo anglais : lettres et symboles FIDE',
            onClick: () => openMemoSheet(),
        });
        this.settingsBtn = duckIconButton({
            icon: 'Settings',
            ariaLabel: 'Paramètres',
            onClick: () => openSettingsSheet(),
        });
        this.headerEl.append(mascot, title, this.memoBtn, this.settingsBtn);

        this.contentEl = el('main', 'app-content');
        this.mainEl.append(this.headerEl, this.contentEl);

        // Bottom Bar (téléphone / portrait)
        this.bottomBarEl = el('nav', 'duck-bottom-bar');
        this.bottomBarEl.setAttribute('aria-label', 'Navigation principale');
        this.barItems = TABS.map((spec, i) => createNavButton(spec, () => this.selectTab(i)));
        this.bottomBarEl.append(...this.barItems.map((it) => it.btn));

        this.appShell.append(this.railEl, this.mainEl, this.bottomBarEl);
        this.rootEl.replaceChildren(this.appShell, this.kidShell);
    }

    _instantiateTab(index) {
        if (index === 0) return new NotationFeature();
        if (index === 1) return new AcademyFeature();
        if (index === 2) return new PuzzlesFeature(this.engine);
        return new PlayFeature(this.engine);
    }

    _mountTab(index) {
        let feat = this.features[index];
        if (!feat) {
            feat = this._instantiateTab(index);
            feat.setThemeAndCoords(this._palette, prefs.current.coords);
            this.features[index] = feat;
            this.contentEl.appendChild(feat.el);
        }
        this.features.forEach((f, i) => {
            if (!f) return;
            if (i !== index) f.onDeactivate?.();
            f.el.classList.toggle('hidden', i !== index);
        });
        this.memoBtn.classList.toggle('hidden', index !== 0);
        this._syncNavSelection();
        feat.onActivate?.();
        requestAnimationFrame(() => {
            if (!prefs.current.kidMode && this.activeTab === index) {
                feat.onActivate?.();
            }
        });
    }

    selectTab(index) {
        if (index === this.activeTab || index < 0 || index >= TABS.length) return;
        feedback.key();
        this.activeTab = index;
        saveActiveTab(index);
        this._mountTab(index);
    }

    _syncNavSelection() {
        for (const group of [this.railItems, this.barItems]) {
            group.forEach(({ btn, pill, spec }, i) => {
                const selected = i === this.activeTab;
                btn.classList.toggle('is-selected', selected);
                btn.setAttribute('aria-current', selected ? 'page' : 'false');
                pill.replaceChildren(createIcon(selected ? spec.selectedIcon : spec.icon, 22));
            });
        }
    }

    _syncLayoutMode() {
        const twoPane = isTwoPane(window.innerWidth, window.innerHeight);
        this.appShell.classList.toggle('is-two-pane', twoPane);
    }

    _applyPrefs(st) {
        feedback.hapticsEnabled = st.haptics;
        feedback.soundEnabled = st.sound;

        const palette = resolvePalette(st);
        this._palette = palette;
        applyThemeToDom(palette);

        for (const f of this.features) {
            f?.setThemeAndCoords(palette, st.coords);
        }

        if (st.kidMode) {
            for (const f of this.features) f?.onDeactivate?.();
            if (!this.kidFeature) {
                this.kidFeature = new KidFeature();
                this.kidShell.appendChild(this.kidFeature.el);
            }
            this.kidFeature.setThemeAndCoords(KidColors, st.coords);
            this.appShell.classList.add('hidden');
            this.kidShell.classList.remove('hidden');
            requestAnimationFrame(() => this.kidFeature?.onActivate());
        } else {
            if (this._wasKid) {
                this.kidFeature?.reset();
            }
            this.kidShell.classList.add('hidden');
            this.appShell.classList.remove('hidden');
            this._syncLayoutMode();
            if (this._wasKid || !this.features[this.activeTab]) {
                this._mountTab(this.activeTab);
            }
        }
        this._wasKid = st.kidMode;
    }
}

const appRoot = document.getElementById('app');
if (appRoot) {
    new ChessDuckApp(appRoot);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    });
}
