import { PuzzleThemes } from '../core/puzzle-themes.js';
import { normalizeForSearch } from '../core/text.js';
import { PUZZLE_COUNT, db } from '../data/db.js';
import { createSheet, duckButton, duckChip, duckIconButton, el, formatFr } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';

function highlightNode(text, query) {
    const span = document.createElement('span');
    if (!query) {
        span.textContent = text;
        return span;
    }
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) {
        span.textContent = text;
        return span;
    }
    if (idx > 0) span.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = el('mark', 'search-hl', text.slice(idx, idx + query.length));
    span.appendChild(mark);
    if (idx + query.length < text.length) span.appendChild(document.createTextNode(text.slice(idx + query.length)));
    return span;
}

function buildThemeRow({ name, goal, count, selected, icon = null, onClick }) {
    const enabled = !count || count.total > 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.disabled = !enabled;
    btn.className = `theme-row${selected ? ' is-selected' : ''}`;
    btn.setAttribute('aria-pressed', String(Boolean(selected)));
    if (count) btn.setAttribute('aria-description', `${count.solved} résolus sur ${count.total}`);
    if (icon) {
        const ic = createIcon(icon, 20, 'theme-row-icon');
        btn.appendChild(ic);
    }
    const mid = el('div', 'theme-row-mid');
    mid.append(
        el('div', `theme-row-name${enabled ? '' : ' is-disabled'}`, name),
        el('div', 'theme-row-goal', goal),
    );
    btn.appendChild(mid);
    if (count) {
        const cntEl = el('span', `theme-row-count${count.solved > 0 ? ' has-solved' : ''}`, `${formatFr(count.solved)} / ${formatFr(count.total)}`);
        btn.appendChild(cntEl);
    }
    btn.addEventListener('click', () => {
        if (!enabled) return;
        feedback.key();
        onClick();
    });
    return btn;
}

export function openPuzzleCatalog({ state, onSetBand, onSetFilter, onOpenById, onOpenSuggestion, onClose }) {
    let band = state.band;
    let query = '';
    let notFound = false;
    let counts = new Map();
    let sugg = { query: '', items: [], more: false };
    let searchTimer = null;
    const expanded = new Set();
    const initialGroup = PuzzleThemes.byKey[state.theme]?.group;
    if (initialGroup) expanded.add(initialGroup);

    const sheet = createSheet('Catalogue des problèmes', () => {
        if (searchTimer) clearTimeout(searchTimer);
        onClose?.();
    });
    const b = sheet.body;

    // Recherche (champ permanent pour préserver le focus iOS Safari)
    const searchRow = el('div', 'puzzle-search-row');
    const fieldWrap = el('div', 'duck-field-wrap flex-1');
    const fieldLabel = el('label', 'duck-field-label', 'Identifiant Lichess ou thème');
    const fieldBox = el('div', 'duck-field-box');
    const searchIcon = createIcon('Search', 20, 'duck-field-icon');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'duck-field-input';
    input.placeholder = 'ex. 00sHx, fourchette…';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('spellcheck', 'false');
    input.maxLength = 24;
    fieldBox.append(searchIcon, input);
    fieldWrap.append(fieldLabel, fieldBox);

    const openBtn = duckButton({
        label: 'Ouvrir',
        accent: 'gold',
        filled: true,
        enabled: false,
        className: 'puzzle-open-btn',
        onClick: () => submitId(),
    });
    searchRow.append(fieldWrap, openBtn);

    const suggHost = el('div');
    const matchesHost = el('div');
    const errorEl = el('p', 'puzzle-not-found hidden', '');
    const bandTitle = el('h3', 'section-title', '1. Difficulté');
    const bandRow = el('div', 'chip-flow');
    const bandNote = el('p', 'muted-small', "Enregistrée immédiatement : elle s'applique au prochain problème aléatoire.");
    const themeTitle = el('h3', 'section-title', '2. Thème — 50 thèmes officiels Lichess');
    const themeNote = el('p', 'muted-small mb-6', "Chaque problème est rangé dans un seul thème : son idée la plus caractéristique. En mode libre, le thème reste masqué jusqu'à la résolution.");
    const allThemesHost = el('div');
    const groupsHost = el('div');

    b.append(searchRow, suggHost, matchesHost, errorEl, bandTitle, bandRow, bandNote, themeTitle, themeNote, allThemesHost, groupsHost);

    async function submitId() {
        const raw = query.trim();
        if (!raw) return;
        const ok = await onOpenById(raw);
        if (ok) sheet.close();
        else {
            notFound = true;
            renderSearchExtras();
        }
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitId();
        }
    });

    input.addEventListener('input', () => {
        query = input.value.slice(0, 24);
        notFound = false;
        openBtn.disabled = !query.trim().length;
        openBtn.setAttribute('aria-label', `Ouvrir le problème « ${query.trim()} »`);
        renderSearchExtras();

        if (searchTimer) clearTimeout(searchTimer);
        const raw = query.trim().replace(/^#/, '').toLowerCase();
        if (!raw) {
            sugg = { query: '', items: [], more: false };
            renderSuggestions();
            return;
        }
        searchTimer = setTimeout(async () => {
            try {
                const { items, total } = await db.searchIds(raw, 5);
                sugg = {
                    query: query.trim().replace(/^#/, ''),
                    items: items.map((it) => ({
                        id: it.id,
                        type: (PuzzleThemes.byKey[it.primaryTheme] || PuzzleThemes.primary('')).name,
                        rating: it.rating,
                    })),
                    more: total > items.length,
                };
                renderSuggestions();
            } catch { /* ignore */ }
        }, 40);
    });

    function renderSuggestions() {
        suggHost.replaceChildren();
        if (!sugg.items.length || !query.trim()) return;
        const box = el('div', 'sugg-box');
        for (const item of sugg.items) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'sugg-row';
            const idEl = highlightNode(`#${item.id}`, sugg.query);
            idEl.className = 'sugg-id';
            const typeEl = el('span', 'sugg-type', item.type);
            const ratEl = el('span', 'sugg-rating', String(item.rating));
            row.append(idEl, typeEl, ratEl);
            row.addEventListener('click', async () => {
                feedback.key();
                await onOpenSuggestion(item.id);
                sheet.close();
            });
            box.appendChild(row);
        }
        if (sugg.more) box.appendChild(el('div', 'sugg-more', '…'));
        suggHost.appendChild(box);
    }

    function renderSearchExtras() {
        fieldBox.classList.toggle('is-error', notFound);
        errorEl.classList.toggle('hidden', !notFound);
        if (notFound) {
            errorEl.textContent = `Aucun problème « ${query.trim()} » parmi les ${formatFr(PUZZLE_COUNT)} embarqués. Vérifiez l'identifiant (majuscules et minuscules comptent).`;
        }

        const q = normalizeForSearch(query.trim().replace(/^#/, ''));
        matchesHost.replaceChildren();
        if (q.length >= 2) {
            const matches = PuzzleThemes.all.filter((t) =>
                normalizeForSearch(t.name).includes(q) || normalizeForSearch(t.goal).includes(q));
            if (matches.length) {
                matchesHost.appendChild(el('h3', 'section-title', 'Thèmes correspondants'));
                for (const t of matches) {
                    matchesHost.appendChild(buildThemeRow({
                        name: t.name,
                        goal: t.goal,
                        count: counts.get(t.key),
                        selected: state.theme === t.key,
                        onClick: () => { onSetFilter(band, t.key); sheet.close(); },
                    }));
                }
            }
        }
    }

    function renderBands() {
        bandRow.replaceChildren();
        PuzzleThemes.BANDS.forEach((label, i) => {
            bandRow.appendChild(duckChip({
                label,
                selected: band === i,
                onClick: () => {
                    band = i;
                    onSetBand(i);
                    renderBands();
                    loadCounts();
                },
            }));
        });
    }

    function renderThemes() {
        allThemesHost.replaceChildren(buildThemeRow({
            name: 'Tous les thèmes',
            goal: 'Un mélange de toutes les idées, sans indication à l\'avance.',
            count: counts.get(''),
            selected: !state.theme,
            icon: 'Shuffle',
            onClick: () => { onSetFilter(band, ''); sheet.close(); },
        }));

        const frag = document.createDocumentFragment();
        for (const g of PuzzleThemes.groups) {
            const gKey = PuzzleThemes.groupKey(g);
            const isOpen = expanded.has(g);
            const wrap = el('div', 'theme-group-wrap');
            const headRow = el('div', 'theme-group-head');
            const rowWrap = el('div', 'flex-1');
            rowWrap.appendChild(buildThemeRow({
                name: g,
                goal: PuzzleThemes.GROUP_GOALS[g] || '',
                count: counts.get(gKey),
                selected: state.theme === gKey,
                icon: 'Folder',
                onClick: () => { onSetFilter(band, gKey); sheet.close(); },
            }));
            const expBtn = duckIconButton({
                icon: isOpen ? 'ExpandLess' : 'ExpandMore',
                ariaLabel: isOpen ? `Replier les thèmes : ${g}` : `Déplier les thèmes : ${g}`,
                onClick: () => {
                    if (isOpen) expanded.delete(g);
                    else expanded.add(g);
                    renderThemes();
                },
            });
            headRow.append(rowWrap, expBtn);
            wrap.appendChild(headRow);
            if (isOpen) {
                const sub = el('div', 'theme-group-children');
                for (const t of PuzzleThemes.all.filter((it) => it.group === g)) {
                    sub.appendChild(buildThemeRow({
                        name: t.name,
                        goal: t.goal,
                        count: counts.get(t.key),
                        selected: state.theme === t.key,
                        onClick: () => { onSetFilter(band, t.key); sheet.close(); },
                    }));
                }
                wrap.appendChild(sub);
            }
            frag.appendChild(wrap);
        }
        groupsHost.replaceChildren(frag);
    }

    async function loadCounts() {
        const range = PuzzleThemes.bandRange(band);
        const rows = await db.themeCounts(range);
        const byTheme = new Map(rows.map((r) => [r.theme, r]));
        const next = new Map();
        let sumTotal = 0;
        let sumSolved = 0;
        for (const t of PuzzleThemes.all) {
            const row = byTheme.get(t.key);
            const entry = row ? { total: row.total, solved: row.solved } : { total: 0, solved: 0 };
            next.set(t.key, entry);
            sumTotal += entry.total;
            sumSolved += entry.solved;
        }
        next.set('', { total: sumTotal, solved: sumSolved });
        for (const g of PuzzleThemes.groups) {
            let gt = 0;
            let gs = 0;
            for (const t of PuzzleThemes.all) {
                if (t.group === g) {
                    const e = next.get(t.key);
                    gt += e.total;
                    gs += e.solved;
                }
            }
            next.set(PuzzleThemes.groupKey(g), { total: gt, solved: gs });
        }
        counts = next;
        renderSearchExtras();
        renderThemes();
    }

    renderBands();
    renderThemes();
    loadCounts();

    return sheet;
}
