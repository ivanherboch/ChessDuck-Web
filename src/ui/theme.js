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
    kid: true,
};

export function roleFor(c, accent) {
    if (!accent) return { text: c.text, fill: c.surfaceHi, onFill: c.text };
    if (accent === c.gold || accent === 'gold') return c.goldRole;
    if (accent === c.green || accent === 'green') return c.greenRole;
    if (accent === c.blue || accent === 'blue') return c.blueRole;
    if (accent === c.red || accent === 'red') return c.redRole;
    return { text: accent, fill: accent, onFill: '#FFFFFF' };
}

export function isTwoPane(width = window.innerWidth, height = window.innerHeight) {
    return width > height * 1.15;
}

export function resolvePalette({ themeMode, kidMode }) {
    if (kidMode) return KidColors;
    if (themeMode === 1) return DayColors;
    if (themeMode === 0) {
        const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        return prefersDark ? NightColors : DayColors;
    }
    return NightColors;
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
    root.setProperty('--gold-text', c.goldRole.text);
    root.setProperty('--gold-fill', c.goldRole.fill);
    root.setProperty('--gold-onfill', c.goldRole.onFill);
    root.setProperty('--green-text', c.greenRole.text);
    root.setProperty('--green-fill', c.greenRole.fill);
    root.setProperty('--green-onfill', c.greenRole.onFill);
    root.setProperty('--blue-text', c.blueRole.text);
    root.setProperty('--blue-fill', c.blueRole.fill);
    root.setProperty('--blue-onfill', c.blueRole.onFill);
    root.setProperty('--red-text', c.redRole.text);
    root.setProperty('--red-fill', c.redRole.fill);
    root.setProperty('--red-onfill', c.redRole.onFill);
    root.setProperty('--tonal-alpha', c.dark ? '0.16' : '0.14');
    root.setProperty('--square-light', c.squareLight);
    root.setProperty('--square-dark', c.squareDark);

    document.documentElement.dataset.theme = c.kid ? 'kid' : (c.dark ? 'night' : 'day');
    document.body.classList.toggle('kid-mode', Boolean(c.kid));
    document.body.classList.toggle('dark-theme', Boolean(c.dark));

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', c.bg);
}
