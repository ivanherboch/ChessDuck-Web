import { CATEGORY_LABELS, Lessons } from '../core/lessons.js';
import { normalizeForSearch } from '../core/text.js';
import { db } from '../data/db.js';
import { createSheet, createStarsRow, duckChip, el, emptyState, infoPill } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { levelName, levelSpoken } from './academy-panels.js';

let savedFiltersOpen = false;
let savedStatus = 0;
let savedLevel = 0;

/**
 * Catalogue des leçons : recherche, filtres dépliables (Statut incl. À revoir, Palier 1-5, Catégorie),
 * accès rapide à la leçon en cours, badges Conseillée / Validation restante / révision espacée.
 */
export function openLessonCatalog({
    state,
    currentFilter,
    mastered: masteredSet,
    lessonProgress: progressList = db.lessonProgress,
    home = {},
    srs,
    validationOf,
    onSetFilter,
    onOpen,
    onClose = null,
}) {
    let query = '';
    let cat = currentFilter;
    let status = savedStatus;
    let level = savedLevel;
    let showFilters = savedFiltersOpen;
    let mastered = masteredSet;
    let progressMap = new Map((progressList || []).map((p) => [p.lessonId, p]));

    const sheet = createSheet(`Leçons — ${mastered.size} / ${Lessons.all.length} maîtrisées`, onClose);
    const b = sheet.body;

    // Recherche (champ conservé en place pour garder le focus sur iOS Safari)
    const searchWrap = el('div', 'duck-field-wrap');
    const searchIcon = el('span', 'duck-field-icon');
    searchIcon.appendChild(createIcon('Search', 18));
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'duck-input';
    searchInput.placeholder = 'Rechercher une leçon (titre ou thème)';
    searchInput.setAttribute('aria-label', 'Rechercher une leçon');
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'duck-field-clear hidden';
    clearBtn.setAttribute('aria-label', 'Effacer la recherche');
    clearBtn.appendChild(createIcon('Close', 18));
    searchWrap.append(searchIcon, searchInput, clearBtn);

    const filterHead = el('div', 'catalog-filter-head');
    const jumpRow = el('div', 'catalog-jump-row');
    const filtersBody = el('div', 'catalog-filters-body');
    const countEl = el('h3', 'sheet-section-title');
    const listWrap = el('div', 'catalog-list');

    b.append(searchWrap, filterHead, jumpRow, filtersBody, countEl, listWrap);

    const filteredItems = () => {
        const q = normalizeForSearch(query);
        return Lessons.all.filter((l) => {
            if (cat && l.category !== cat) return false;
            if (level > 0 && l.level !== level) return false;
            if (status === 1 && mastered.has(l.id)) return false;
            if (status === 2 && !mastered.has(l.id)) return false;
            if (status === 3) {
                const p = progressMap.get(l.id);
                if (!p || !srs?.isDue(p)) return false;
            }
            if (q && !normalizeForSearch(`${l.title} ${l.summary} ${CATEGORY_LABELS[l.category] || ''}`).includes(q)) {
                return false;
            }
            return true;
        });
    };

    const render = () => {
        savedStatus = status;
        savedLevel = level;
        savedFiltersOpen = showFilters;
        clearBtn.classList.toggle('hidden', !query);

        const total = Lessons.all.length;
        const active = (status !== 0 ? 1 : 0) + (level > 0 ? 1 : 0) + (cat !== null ? 1 : 0);
        const statusLabels = ['Toutes', 'À maîtriser', 'Maîtrisées', 'À revoir'];
        const summaryParts = [];
        if (status !== 0) summaryParts.push(statusLabels[status]);
        if (level > 0) summaryParts.push(`Palier ${levelName(level)}`);
        if (cat) summaryParts.push(CATEGORY_LABELS[cat] || cat);
        const summary = summaryParts.join(' · ') || 'Aucun filtre';

        const filterChip = duckChip({
            label: active > 0 ? `Filtres (${active})` : 'Filtres',
            selected: showFilters || active > 0,
            icon: 'Tune',
            accent: 'blue',
            onClick: () => {
                showFilters = !showFilters;
                render();
            },
        });
        filterChip.setAttribute('aria-expanded', String(showFilters));
        filterChip.setAttribute('aria-label', `Filtres : ${summary}. ${showFilters ? 'Replier' : 'Déplier'}`);
        const summarySpan = el('span', 'catalog-filter-summary', summary);
        filterHead.replaceChildren(filterChip, summarySpan);
        if (active > 0) {
            filterHead.appendChild(duckChip({
                label: 'Effacer',
                selected: false,
                icon: 'Close',
                onClick: () => {
                    status = 0;
                    level = 0;
                    cat = null;
                    onSetFilter(null);
                    render();
                },
            }));
        }

        const items = filteredItems();
        const curIdx = items.findIndex((it) => it.id === state.lessonId);
        jumpRow.replaceChildren();
        if (curIdx >= 0) {
            jumpRow.appendChild(duckChip({
                label: `Aller à la leçon en cours (n° ${Lessons.number(state.lessonId)})`,
                selected: false,
                icon: 'School',
                accent: 'gold',
                onClick: () => {
                    const card = listWrap.querySelector(`[data-lesson-id="${state.lessonId}"]`);
                    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                },
            }));
        }

        filtersBody.replaceChildren();
        filtersBody.classList.toggle('hidden', !showFilters);
        if (showFilters) {
            const dueCount = Lessons.all.filter((l) => {
                const p = progressMap.get(l.id);
                return Boolean(p && srs?.isDue(p));
            }).length;

            const statusRow = _filterRow('Statut');
            const sCounts = [total, total - mastered.size, mastered.size, dueCount];
            statusLabels.forEach((label, i) => {
                const chip = duckChip({
                    label: `${label} ${sCounts[i]}`,
                    selected: status === i,
                    accent: 'blue',
                    onClick: () => {
                        status = i;
                        render();
                    },
                });
                chip.setAttribute('aria-label', `${label} : ${sCounts[i]} leçons`);
                statusRow.pills.appendChild(chip);
            });
            filtersBody.appendChild(statusRow.wrap);

            const levelRow = _filterRow('Palier');
            levelRow.pills.appendChild(duckChip({
                label: 'Tous',
                selected: level === 0,
                accent: 'blue',
                onClick: () => {
                    level = 0;
                    render();
                },
            }));
            for (let lv = 1; lv <= 5; lv++) {
                const n = Lessons.all.filter((it) => it.level === lv).length;
                const m = Lessons.all.filter((it) => it.level === lv && mastered.has(it.id)).length;
                if (n > 0) {
                    const chip = duckChip({
                        label: `${levelName(lv)} ${m}/${n}`,
                        selected: level === lv,
                        accent: 'blue',
                        onClick: () => {
                            level = lv;
                            render();
                        },
                    });
                    chip.setAttribute('aria-label', `Palier ${levelSpoken(lv)} : ${m} leçons maîtrisées sur ${n}`);
                    levelRow.pills.appendChild(chip);
                }
            }
            filtersBody.appendChild(levelRow.wrap);

            const catRow = _filterRow('Catégorie');
            catRow.pills.appendChild(duckChip({
                label: 'Toutes',
                selected: cat === null,
                accent: 'blue',
                onClick: () => {
                    cat = null;
                    onSetFilter(null);
                    render();
                },
            }));
            for (const k of Lessons.categories) {
                const n = Lessons.all.filter((it) => it.category === k).length;
                const m = Lessons.all.filter((it) => it.category === k && mastered.has(it.id)).length;
                catRow.pills.appendChild(duckChip({
                    label: `${CATEGORY_LABELS[k]} ${m}/${n}`,
                    selected: cat === k,
                    accent: 'blue',
                    onClick: () => {
                        cat = k;
                        onSetFilter(k);
                        render();
                    },
                }));
            }
            filtersBody.appendChild(catRow.wrap);
        }

        countEl.textContent = `${items.length} leçon${items.length > 1 ? 's' : ''} — toutes en accès libre`;

        listWrap.replaceChildren();
        if (items.length === 0) {
            listWrap.appendChild(emptyState({
                icon: 'SearchOff',
                title: 'Aucune leçon trouvée',
                message: 'Essayez un autre mot ou retirez des filtres.',
                actionLabel: 'Réinitialiser les filtres',
                onAction: () => {
                    query = '';
                    searchInput.value = '';
                    status = 0;
                    level = 0;
                    cat = null;
                    onSetFilter(null);
                    render();
                },
            }));
            return;
        }

        for (const item of items) {
            const current = item.id === state.lessonId;
            const advised = item.id === home.recommended && !current;
            const done = mastered.has(item.id);
            const prog = progressMap.get(item.id);
            const stars = prog?.stars || 0;
            const toValidate = !done && stars >= 2 && validationOf && validationOf(item) !== 'NONE';
            const days = srs ? srs.daysUntil(prog) : null;
            const srsText = days === null ? null : (days === 0 ? "À revoir aujourd'hui" : `Révision dans ${days} jour${days > 1 ? 's' : ''}`);

            const row = document.createElement('button');
            row.type = 'button';
            row.dataset.lessonId = String(item.id);
            row.className = `lesson-card${current ? ' is-current' : ''}`;
            const num = Lessons.number(item.id);
            row.setAttribute(
                'aria-label',
                `${item.title}, ${done ? 'maîtrisée' : 'à maîtriser'}` +
                (stars > 0 ? `, ${stars} étoile${stars > 1 ? 's' : ''} sur 3` : '') +
                `, palier ${levelSpoken(item.level)}` +
                (srsText ? `, ${srsText.toLowerCase()}` : '') +
                (current ? ', leçon en cours' : '') +
                (toValidate ? ', validation restante' : '') +
                (advised ? ', leçon conseillée' : ''),
            );

            const numBox = el('div', 'lesson-card-num');
            if (done) {
                numBox.classList.add('is-done');
                numBox.appendChild(createIcon('CheckCircle', 22));
            } else {
                numBox.textContent = String(num);
            }

            const body = el('div', 'lesson-card-body');
            if (current || advised || stars > 0 || srsText || toValidate) {
                const badges = el('div', 'lesson-card-badges');
                if (current) badges.appendChild(infoPill({ text: 'En cours', accent: 'blue' }));
                if (advised) badges.appendChild(infoPill({ text: 'Conseillée', accent: 'green' }));
                if (stars > 0) badges.appendChild(createStarsRow(stars, { size: 14 }));
                if (toValidate) badges.appendChild(el('span', 'lesson-badge-val', 'Validation restante'));
                if (srsText) badges.appendChild(el('span', `lesson-badge-srs${days === 0 ? ' is-due' : ''}`, srsText));
                body.appendChild(badges);
            }
            body.append(
                el('div', 'lesson-card-title', item.title),
                el('div', 'lesson-card-summary', item.summary),
            );

            const arrow = el('span', 'lesson-card-arrow');
            arrow.appendChild(createIcon('KeyboardArrowRight', 20));
            row.append(numBox, body, arrow);
            row.addEventListener('click', () => {
                feedback.key();
                sheet.close();
                onOpen(item.id);
            });
            listWrap.appendChild(row);
        }
    };

    searchInput.addEventListener('input', () => {
        query = searchInput.value;
        render();
    });
    clearBtn.addEventListener('click', () => {
        query = '';
        searchInput.value = '';
        render();
        searchInput.focus();
    });

    const unsubMastered = db.subscribeMasteredLessons((set) => {
        mastered = set;
        sheet.setTitle(`Leçons — ${mastered.size} / ${Lessons.all.length} maîtrisées`);
        render();
    });
    const unsubProgress = db.subscribeLessonProgress((list) => {
        progressMap = new Map((list || []).map((p) => [p.lessonId, p]));
        render();
    });

    const origClose = sheet.close;
    sheet.close = () => {
        unsubMastered();
        unsubProgress();
        origClose();
    };
    render();
    return sheet;
}

function _filterRow(label) {
    const wrap = el('div', 'catalog-filter-row');
    const lbl = el('span', 'catalog-filter-row-lbl', label);
    const pills = el('div', 'catalog-filter-pills');
    wrap.append(lbl, pills);
    return { wrap, pills };
}
