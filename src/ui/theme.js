const INK = '#0F172A';

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export { hexToRgba };

export const NightColors = {
    dark: true,
    bg: '#0F172A',
    surface: '#1E293B',
    surfaceSubtle: '#172033',
    surfaceHi: '#334155',
    text: '#F8FAFC',
    muted: '#CBD5E1',
    outline: '#475569',
    outlineStrong: '#94A3B8',
    gold: '#F59E0B',
    green: '#10B981',
    blue: '#38BDF8',
    red: '#F87171',
    goldRole: { text: '#F59E0B', fill: '#F59E0B', onFill: INK },
    greenRole: { text: '#34D399', fill: '#10B981', onFill: INK },
    blueRole: { text: '#38BDF8', fill: '#38BDF8', onFill: INK },
    redRole: { text: '#FCA5A5', fill: '#F87171', onFill: INK },
    squareLight: '#F0D9B5',
    squareDark: '#B58863',
    coordInk: '#5C3D24',
    coordPill: 'rgba(240, 217, 181, 0.85)',
    select: '#10B981',
    lastMoveTint: 'rgba(247, 236, 94, 0.40)',
    checkGlow: '#EF4444',
    kid: false,
};

export const DayColors = {
    dark: false,
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceSubtle: '#EEF2F6',
    surfaceHi: '#E2E8F0',
    text: '#0F172A',
    muted: '#475569',
    outline: '#CBD5E1',
    outlineStrong: '#64748B',
    gold: '#F59E0B',
    green: '#10B981',
    blue: '#0284C7',
    red: '#DC2626',
    goldRole: { text: '#92400E', fill: '#F59E0B', onFill: INK },
    greenRole: { text: '#065F46', fill: '#047857', onFill: '#FFFFFF' },
    blueRole: { text: '#075985', fill: '#0369A1', onFill: '#FFFFFF' },
    redRole: { text: '#B91C1C', fill: '#DC2626', onFill: '#FFFFFF' },
    squareLight: '#F0D9B5',
    squareDark: '#B58863',
    coordInk: '#5C3D24',
    coordPill: 'rgba(240, 217, 181, 0.85)',
    select: '#10B981',
    lastMoveTint: 'rgba(247, 236, 94, 0.40)',
    checkGlow: '#EF4444',
    kid: false,
};

export const KidColors = {
    dark: false,
    bg: '#EBF6FF',
    surface: '#FFFFFF',
    surfaceSubtle: '#F4FAFF',
    surfaceHi: '#D6ECFF',
    text: '#1F3B57',
    muted: '#4A6785',
    outline: '#9CC9F0',
    outlineStrong: '#4A6785',
    gold: '#F59E0B',
    green: '#237A36',
    blue: '#0369A1',
    red: '#D93829',
    goldRole: { text: '#8A5A00', fill: '#F59E0B', onFill: '#1F3B57' },
    greenRole: { text: '#17602A', fill: '#237A36', onFill: '#FFFFFF' },
    blueRole: { text: '#075985', fill: '#0369A1', onFill: '#FFFFFF' },
    redRole: { text: '#A12A1E', fill: '#D93829', onFill: '#FFFFFF' },
    squareLight: '#FFFDF2',
    squareDark: '#98DDCA',
    coordInk: '#17594B',
    coordPill: 'rgba(255, 255, 255, 0.80)',
    select: '#FF9F1C',
    lastMoveTint: 'rgba(247, 236, 94, 0.40)',
    checkGlow: '#EF4444',
    kid: true,
};

export const DuckRadius = Object.freeze({
    S: 8,
    M: 12,
    L: 16,
    Kid: 24,
});

function makeBoardTheme(ordinal, key, label, light, dark, coordInk) {
    return Object.freeze({
        ordinal,
        key,
        label,
        light,
        dark,
        coordInk,
        applyTo(c) {
            return Object.freeze({
                ...c,
                squareLight: light,
                squareDark: dark,
                coordInk,
                coordPill: hexToRgba(light, 0.85),
            });
        },
    });
}

const BOARD_THEMES = [
    makeBoardTheme(0, 'WOOD', 'Bois classique', '#F0D9B5', '#B58863', '#5C3D24'),
    makeBoardTheme(1, 'SLATE', 'Ardoise', '#DEE3E6', '#8CA2AD', '#2B3A42'),
    makeBoardTheme(2, 'TOURNAMENT', 'Vert tournoi', '#EEEED2', '#769656', '#34481F'),
    makeBoardTheme(3, 'AMETHYST', 'Améthyste et lin', '#F1E9DC', '#9F86C0', '#45305F'),
];

export const BoardTheme = Object.freeze({
    WOOD: BOARD_THEMES[0],
    SLATE: BOARD_THEMES[1],
    TOURNAMENT: BOARD_THEMES[2],
    AMETHYST: BOARD_THEMES[3],
    entries: Object.freeze(BOARD_THEMES),
    of(index) {
        return BOARD_THEMES[index] || BOARD_THEMES[0];
    },
});

function makePalette(ordinal, key, label, description, night, day) {
    return Object.freeze({
        ordinal,
        key,
        label,
        description,
        night: Object.freeze(night),
        day: Object.freeze(day),
        colors(dark) {
            return dark ? this.night : this.day;
        },
    });
}

/**
 * Palettes au choix (Paramètres) : chacune décline les surfaces et l'accent principal en Nuit et en Jour, sans toucher
 * à l'échiquier en bois ; toutes respectent les contrastes WCAG AA. [BLUE_ORANGE] remplace le couple
 * vert / rouge (réussite / erreur) par bleu / vermillon (palette Okabe-Ito), lisible avec un daltonisme rouge-vert.
 */
const PALETTES = [
    makePalette(
        0,
        'SLATE_GOLD',
        'Ardoise & Or',
        'La charte ChessDuck : ardoise et or.',
        NightColors,
        DayColors,
    ),
    makePalette(
        1,
        'AMETHYST',
        'Améthyste',
        "Violet profond, assorti à l'icône.",
        {
            ...NightColors,
            bg: '#120F24', surface: '#1F1A38', surfaceSubtle: '#18142E', surfaceHi: '#322B55',
            muted: '#D4CDEB', outline: '#4C4378', outlineStrong: '#9B92C9',
            gold: '#A78BFA', goldRole: { text: '#C4B5FD', fill: '#A78BFA', onFill: INK },
        },
        {
            ...DayColors,
            bg: '#F8F6FE', surface: '#FFFFFF', surfaceSubtle: '#F0ECFC', surfaceHi: '#E2DCF7',
            text: '#1E1538', muted: '#4E4470', outline: '#CFC6EC', outlineStrong: '#6E62A0',
            gold: '#7C3AED', goldRole: { text: '#5B21B6', fill: '#6D28D9', onFill: '#FFFFFF' },
        },
    ),
    makePalette(
        2,
        'WALNUT',
        'Noyer',
        "Bois chaleureux et orange, comme l'échiquier.",
        {
            ...NightColors,
            bg: '#17110D', surface: '#261C16', surfaceSubtle: '#1F1712', surfaceHi: '#3A2C22',
            text: '#FBF5EF', muted: '#E2D3C4', outline: '#5A463A', outlineStrong: '#A8927F',
            gold: '#FB923C', goldRole: { text: '#FDBA74', fill: '#FB923C', onFill: INK },
        },
        {
            ...DayColors,
            bg: '#FBF7F2', surface: '#FFFFFF', surfaceSubtle: '#F6F0E8', surfaceHi: '#E9DDCF',
            text: '#24170F', muted: '#5E4B3D', outline: '#DCCBB9', outlineStrong: '#8A7360',
            gold: '#C2410C', goldRole: { text: '#9A3412', fill: '#C2410C', onFill: '#FFFFFF' },
        },
    ),
    makePalette(
        3,
        'GRAPHITE_ROSE',
        'Graphite & Rose',
        'Gris neutre et rose vif.',
        {
            ...NightColors,
            bg: '#121214', surface: '#1E1E22', surfaceSubtle: '#18181B', surfaceHi: '#323238',
            text: '#FAFAFA', muted: '#D4D4DC', outline: '#4B4B55', outlineStrong: '#9C9CA8',
            gold: '#F472B6', goldRole: { text: '#F9A8D4', fill: '#F472B6', onFill: INK },
        },
        {
            ...DayColors,
            bg: '#F7F7F8', surface: '#FFFFFF', surfaceSubtle: '#EFEFF2', surfaceHi: '#E2E2E7',
            text: '#18181B', muted: '#52525B', outline: '#D4D4D8', outlineStrong: '#71717A',
            gold: '#DB2777', goldRole: { text: '#9D174D', fill: '#BE185D', onFill: '#FFFFFF' },
        },
    ),
    makePalette(
        4,
        'BLUE_ORANGE',
        'Bleu-Orange',
        'Adaptée au daltonisme : réussite en bleu, erreur en vermillon.',
        {
            ...NightColors,
            gold: '#F0E442', goldRole: { text: '#F0E442', fill: '#F0E442', onFill: INK },
            green: '#56B4E9', greenRole: { text: '#7CC6F0', fill: '#56B4E9', onFill: INK },
            blue: '#CC79A7', blueRole: { text: '#E3A5C7', fill: '#CC79A7', onFill: INK },
            red: '#E07A3F', redRole: { text: '#F3A06E', fill: '#E07A3F', onFill: INK },
            select: '#0072B2',
        },
        {
            ...DayColors,
            gold: '#F0E442', goldRole: { text: '#6B5D00', fill: '#F0E442', onFill: INK },
            green: '#0072B2', greenRole: { text: '#005A8C', fill: '#0072B2', onFill: '#FFFFFF' },
            blue: '#A64D7E', blueRole: { text: '#8E3A68', fill: '#A64D7E', onFill: '#FFFFFF' },
            red: '#D55E00', redRole: { text: '#A63F00', fill: '#B34D00', onFill: '#FFFFFF' },
            select: '#0072B2',
        },
    ),
];

export const DuckPalette = Object.freeze({
    SLATE_GOLD: PALETTES[0],
    AMETHYST: PALETTES[1],
    WALNUT: PALETTES[2],
    GRAPHITE_ROSE: PALETTES[3],
    BLUE_ORANGE: PALETTES[4],
    entries: Object.freeze(PALETTES),
    of(index) {
        return PALETTES[index] || PALETTES[0];
    },
});

export function roleFor(c, accent) {
    if (!accent) return { text: c.text, fill: c.surfaceHi, onFill: c.text };
    if (accent === c.gold || accent === 'gold') return c.goldRole;
    if (accent === c.green || accent === 'green') return c.greenRole;
    if (accent === c.blue || accent === 'blue') return c.blueRole;
    if (accent === c.red || accent === 'red') return c.redRole;
    return { text: accent, fill: accent, onFill: '#FFFFFF' };
}

export function isTwoPane(width = window.innerWidth, height = window.innerHeight) {
    return width >= 540 && width > height * 1.15;
}

export function isIosDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav) return false;
    const ua = nav.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}

export function syncIosViewportMeta(standalone, doc = typeof document !== 'undefined' ? document : null) {
    const vp = doc?.querySelector?.('meta[name="viewport"]');
    if (!vp) return;
    const parts = (vp.getAttribute('content') || '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && !/^viewport-fit=/i.test(p));
    if (standalone) parts.push('viewport-fit=cover');
    vp.setAttribute('content', parts.join(', '));
}

export function computeIosTopGap({
    isIos = false,
    standalone = false,
    innerWidth = 0,
    innerHeight = 0,
    screenWidth = 0,
    screenHeight = 0,
    safeTop = 0,
} = {}) {
    if (!isIos) return 0;
    const portrait = innerHeight >= innerWidth;
    if (!portrait) {
        return innerHeight > 0 && innerHeight <= 450 ? 8 : 12;
    }
    if (standalone) {
        if (safeTop > 0) return 40;
        const screenPortraitH = Math.max(screenWidth || 0, screenHeight || 0);
        const screenPortraitW = Math.min(screenWidth || 0, screenHeight || 0);
        const coversFullScreen = screenPortraitH > 0 && innerHeight >= screenPortraitH - 4;
        if (coversFullScreen) {
            const isTabletSize = screenPortraitW >= 600;
            const statusFallback = isTabletSize ? 24 : (screenPortraitH >= 850 ? 59 : (screenPortraitH >= 780 ? 47 : 20));
            return statusFallback + 40;
        }
        return 20;
    }
    return safeTop > 0 ? Math.max(36, Math.round(safeTop * 0.6) + 12) : 32;
}

export function isDarkTheme(themeMode) {
    if (themeMode === 1) return false;
    if (themeMode === 0) {
        return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    }
    return true;
}

export function resolvePalette({ themeMode, kidMode, palette = 0, boardTheme = 0 }) {
    if (kidMode) return KidColors;
    const dark = isDarkTheme(themeMode);
    return BoardTheme.of(boardTheme).applyTo(DuckPalette.of(palette).colors(dark));
}

export function applyThemeToDom(c) {
    const root = document.documentElement.style;
    root.setProperty('--bg', c.bg);
    root.setProperty('--surface', c.surface);
    root.setProperty('--surface-subtle', c.surfaceSubtle);
    root.setProperty('--surface-hi', c.surfaceHi);
    root.setProperty('--text', c.text);
    root.setProperty('--muted', c.muted);
    root.setProperty('--outline', c.outline);
    root.setProperty('--outline-strong', c.outlineStrong);
    root.setProperty('--gold', c.gold);
    root.setProperty('--green', c.green);
    root.setProperty('--blue', c.blue);
    root.setProperty('--red', c.red);
    root.setProperty('--select', c.select);
    const tonalAlpha = c.dark ? 0.16 : 0.14;
    root.setProperty('--gold-text', c.goldRole.text);
    root.setProperty('--gold-fill', c.goldRole.fill);
    root.setProperty('--gold-onfill', c.goldRole.onFill);
    root.setProperty('--gold-tonal', hexToRgba(c.goldRole.fill, tonalAlpha));
    root.setProperty('--green-text', c.greenRole.text);
    root.setProperty('--green-fill', c.greenRole.fill);
    root.setProperty('--green-onfill', c.greenRole.onFill);
    root.setProperty('--green-tonal', hexToRgba(c.greenRole.fill, tonalAlpha));
    root.setProperty('--blue-text', c.blueRole.text);
    root.setProperty('--blue-fill', c.blueRole.fill);
    root.setProperty('--blue-onfill', c.blueRole.onFill);
    root.setProperty('--blue-tonal', hexToRgba(c.blueRole.fill, tonalAlpha));
    root.setProperty('--red-text', c.redRole.text);
    root.setProperty('--red-fill', c.redRole.fill);
    root.setProperty('--red-onfill', c.redRole.onFill);
    root.setProperty('--red-tonal', hexToRgba(c.redRole.fill, tonalAlpha));
    root.setProperty('--tonal-alpha', String(tonalAlpha));
    root.setProperty('--square-light', c.squareLight);
    root.setProperty('--square-dark', c.squareDark);

    document.documentElement.dataset.theme = c.kid ? 'kid' : (c.dark ? 'night' : 'day');
    root.colorScheme = c.dark ? 'dark' : 'light';
    document.body.classList.toggle('kid-mode', Boolean(c.kid));
    document.body.classList.toggle('dark-theme', Boolean(c.dark));

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', c.bg);
}
