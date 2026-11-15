import { CATEGORY_LABELS, Lessons } from '../core/lessons.js';
import { normalizeForSearch } from '../core/text.js';
import { createSheet, duckChip, duckIconButton, el, emptyState, infoPill } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';

/** Catalogue des leçons : recherche, statut (toutes / à maîtriser / maîtrisées) et catégorie. */
export function openLessonCatalog({
    currentLessonId,
    currentFilter,
    currentStatus = 0,
    masteredSet,
    onSelectFilter,
    onSelectStatus,
    onOpenLesson,
    onClose,
}) {
    let query = '';
    let status = currentStatus; // 0 = Toutes, 1 = À maîtriser, 2 = Maîtrisées
    let cat = currentFilter;
    let mastered = masteredSet;

    const sheet = createSheet(`Leçons — ${mastered.size} / ${Lessons.all.length} maîtrisées`, onClose);
    const b = sheet.body;

    // Recherche (champ conservé en place pour garder le focus sur iOS Safari)
    const searchWrap = el('div', 'duck-field-wrap');
    const searchLabel = el('label', 'duck-field-label', 'Rechercher une leçon');
    const searchBox = el('div', 'duck-field-box');
    const leadIcon = createIcon('Search', 20, 'duck-field-icon');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'duck-field-input';
    input.placeholder = 'ex. fourchette, Lucena, sicilienne…';
    input.setAttribute('aria-label', 'Rechercher une leçon');
    const clearBtn = duckIconButton({
        icon: 'Close',
        ariaLabel: 'Effacer la recherche',
        className: 'hidden',
        onClick: () => {
            query = '';
            input.value = '';
            clearBtn.classList.add('hidden');
            renderList();
            input.focus();
        },
    });
    input.addEventListener('input', () => {
        query = input.value;
        clearBtn.classList.toggle('hidden', !query.length);
        renderList();
    });
    searchBox.append(leadIcon, input, clearBtn);
    searchWrap.append(searchLabel, searchBox);

    const statusTitle = el('h3', 'section-title', 'Statut');
    const statusRow = el('div', 'chip-flow');

    const catTitle = el('h3', 'section-title', 'Catégorie');
    const catRow = el('div', 'chip-flow');

    const countTitle = el('h3', 'section-title', '');
    const listWrap = el('div', 'catalog-list');

    b.append(searchWrap, statusTitle, statusRow, catTitle, catRow, countTitle, listWrap);

    function renderFilters() {
        statusRow.replaceChildren();
        ['Toutes', 'À maîtriser', 'Maîtrisées'].forEach((label, i) => {
            statusRow.appendChild(duckChip({
                label,
                selected: status === i,
                accent: 'blue',
                onClick: () => { status = i; onSelectStatus?.(i); renderFilters(); renderList(); },
            }));
        });

        catRow.replaceChildren();
        catRow.appendChild(duckChip({
            label: 'Toutes',
            selected: cat === null,
            accent: 'blue',
            onClick: () => { cat = null; onSelectFilter(null); renderFilters(); renderList(); },
        }));
        for (const [k, label] of Object.entries(CATEGORY_LABELS)) {
            const n = Lessons.all.filter((it) => it.category === k).length;
            const m = Lessons.all.filter((it) => it.category === k && mastered.has(it.id)).length;
            catRow.appendChild(duckChip({
                label: `${label} ${m}/${n}`,
                selected: cat === k,
                accent: 'blue',
                onClick: () => { cat = k; onSelectFilter(k); renderFilters(); renderList(); },
            }));
        }
    }

    function renderList() {
        const q = normalizeForSearch(query.trim());
        const items = Lessons.all.filter((l) =>
            (cat === null || l.category === cat) &&
            (status === 0 || (status === 1) === !mastered.has(l.id)) &&
            (!q.length || normalizeForSearch(l.title).includes(q) || normalizeForSearch(l.summary).includes(q) || String(l.id) === q),
        );
        countTitle.textContent = `${items.length} leçon${items.length > 1 ? 's' : ''} — toutes en accès libre`;
        listWrap.replaceChildren();
        if (!items.length) {
            listWrap.appendChild(emptyState({
                icon: 'SearchOff',
                title: 'Aucune leçon trouvée',
                message: 'Essayez un autre mot ou retirez des filtres.',
                actionLabel: 'Réinitialiser les filtres',
                onAction: () => {
                    query = '';
                    input.value = '';
                    clearBtn.classList.add('hidden');
                    status = 0;
                    onSelectStatus?.(0);
                    cat = null;
                    onSelectFilter(null);
                    renderFilters();
                    renderList();
                },
            }));
            return;
        }
        const frag = document.createDocumentFragment();
        for (const item of items) {
            const current = item.id === currentLessonId;
            const done = mastered.has(item.id);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `lesson-row${current ? ' is-current' : ''}`;
            const lead = el('div', 'lesson-row-lead');
            if (done) {
                const ic = createIcon('CheckCircle', 22);
                ic.classList.add('is-done');
                lead.appendChild(ic);
            } else {
                lead.appendChild(el('span', 'lesson-row-num', String(item.id)));
            }
            const mid = el('div', 'lesson-row-mid');
            if (current) {
                mid.appendChild(infoPill({ text: 'En cours', accent: 'blue', className: 'lesson-current-pill' }));
            }
            mid.append(el('div', 'lesson-row-title', item.title), el('div', 'lesson-row-summary', item.summary));
            const arrow = createIcon('KeyboardArrowRight', 22, 'lesson-row-arrow');
            row.append(lead, mid, arrow);
            row.addEventListener('click', () => {
                feedback.key();
                onOpenLesson(item.id);
                sheet.close();
            });
            frag.appendChild(row);
        }
        listWrap.appendChild(frag);
    }

    renderFilters();
    renderList();

    return {
        sheet,
        updateMastered(nextSet) {
            mastered = nextSet;
            sheet.setTitle(`Leçons — ${mastered.size} / ${Lessons.all.length} maîtrisées`);
            renderFilters();
            renderList();
        },
    };
}
