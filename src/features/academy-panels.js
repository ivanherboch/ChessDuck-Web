import { Position } from '../core/chess.js';
import { CATEGORY_LABELS, LessonKind, Lessons } from '../core/lessons.js';
import { PuzzleThemes } from '../core/puzzle-themes.js';
import { createSideDot } from '../ui/captured.js';
import {
    createSheet,
    createStepDots,
    duckButton,
    duckChip,
    el,
    moveLabel,
    turnOf,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { ENDGAME_FAMILIES, EndgameGoal } from './endgame-practice.js';
import { ReflexKind } from './reflex-drills.js';

export const PRACTICE_SIZE = 5;
export const PRACTICE_PASS = 4;
export const REVIEW_SIZE = 2;
export const REPERTOIRE_SIZE = 5;

export function levelLabel(level) {
    switch (level) {
    case 1: return 'Les bases';
    case 2: return 'Débutant';
    case 3: return 'Novice';
    case 4: return 'Club';
    default: return 'Confirmé';
    }
}

export function levelName(level) {
    const lv = Math.max(1, Math.min(5, Number(level) || 1));
    return `${lv} · ${levelLabel(lv)}`;
}

export function levelSpoken(level) {
    const lv = Math.max(1, Math.min(5, Number(level) || 1));
    return `${lv}, ${levelLabel(lv)}`;
}

export function starsText(n) {
    return `${n} étoile${n > 1 ? 's' : ''} sur 3`;
}

export function objectiveText(l) {
    const parts = [l.summary, `À retenir : ${l.takeaway}`];
    if (l.conditions) parts.push(`Conditions : ${l.conditions}`);
    if (l.ideas.length) parts.push(`Les idées : ${l.ideas.join(' ')}`);
    if (l.traps.length) parts.push(`Les pièges : ${l.traps.join(' ')}`);
    return parts.join('\n\n');
}

export function variantLabel(l, v) {
    if (v === 0) return 'Ligne principale';
    const vv = l.variants[v - 1];
    const line = l.lineFor(v);
    const turn = turnOf(line, vv.from, 1);
    const first = line.sans[vv.from];
    const white = line.positions[vv.from].whiteToMove;
    return `Si ${white ? `${turn}. ${first}` : `${turn}… ${first}`}`;
}

/**
 * Tableau complet des coups (2 colonnes) en mode Guidé sur tablette/bureau.
 */
export function renderAcademyMoveTable(container, line, cur, onSelect) {
    const first = line.size > 0 && !line.positions[0].whiteToMove ? 1 : 0;
    const rows = Math.floor((line.size + first + 1) / 2);
    const startMove = 1;
    container.replaceChildren();
    let activeBtn = null;

    for (let row = 0; row < rows; row++) {
        const tr = el('div', 'move-table-row');
        tr.appendChild(el('span', 'move-table-num', `${startMove + row}.`));
        for (let col = 0; col < 2; col++) {
            const i = row * 2 + col - first;
            const cell = el('div', 'move-table-cell');
            if (i >= 0 && i < line.size) {
                const current = i === cur - 1;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `move-table-btn${current ? ' is-current' : ''}`;
                btn.setAttribute('aria-label', `Aller au coup ${line.sans[i]}`);
                btn.setAttribute('aria-current', String(current));
                btn.appendChild(el('span', 'move-table-san', line.sans[i]));
                btn.addEventListener('click', () => {
                    feedback.key();
                    onSelect(i + 1);
                });
                if (current) activeBtn = btn;
                cell.appendChild(btn);
            }
            tr.appendChild(cell);
        }
        container.appendChild(tr);
    }
    if (activeBtn) {
        requestAnimationFrame(() => activeBtn.scrollIntoView({ block: 'nearest' }));
    }
}

/**
 * Bandeau au-dessus de l'échiquier (finale vs Ordinateur, série ou réflexe).
 */
export function buildAcademyBoardInfo({ eg, rx, pr }) {
    if (eg?.position) {
        const computerWhite = !eg.family.heroWhite;
        const toMove = !eg.over && eg.position.whiteToMove === computerWhite;
        const bar = el('div', 'academy-board-info');
        bar.setAttribute(
            'aria-label',
            `Ordinateur ${eg.thinking ? 'réfléchit' : toMove ? 'au trait' : ''}`,
        );
        const left = el('div', 'academy-board-info-left');
        left.append(
            createSideDot(computerWhite),
            el('span', 'academy-board-info-txt', '🤖 Ordinateur'),
        );
        if (eg.thinking) {
            left.appendChild(el('span', 'duck-spinner duck-spinner-sm'));
        } else if (toMove) {
            left.appendChild(el('span', 'academy-dot-ready'));
        }
        const dots = createStepDots(eg.results, eg.total, eg.finished ? -1 : eg.index);
        bar.append(left, dots);
        return bar;
    }

    let white = true;
    let text = '';
    if (rx?.blind) {
        white = rx.blind.after.whiteToMove;
        text = `Après les coups annoncés, trait aux ${white ? 'Blancs' : 'Noirs'}`;
    } else if (rx && (rx.threat || rx.capture)) {
        const pos = rx.threat?.position || rx.capture?.position;
        white = pos.whiteToMove;
        text = `Trait aux ${white ? 'Blancs' : 'Noirs'}`;
    } else if (pr?.line && !pr.finished) {
        white = pr.line.positions[0].whiteToMove === false;
        text = `Vous jouez les ${white ? 'Blancs' : 'Noirs'}`;
    } else {
        return null;
    }

    const bar = el('div', 'academy-board-info');
    const left = el('div', 'academy-board-info-left');
    left.append(createSideDot(white), el('span', 'academy-board-info-txt', text));
    const dots = rx
        ? createStepDots(rx.results, rx.total, rx.index)
        : createStepDots(pr.results, pr.ids.length, pr.index);
    bar.append(left, dots);
    return bar;
}

/**
 * Fiche complète d'une leçon dans un tiroir.
 */
export function openLessonBriefSheet(l) {
    const sheet = createSheet('Fiche de la leçon');
    const b = sheet.body;

    b.appendChild(el('div', 'brief-lesson-title', l.title));
    b.appendChild(el('div', 'brief-lesson-meta', `${CATEGORY_LABELS[l.category] || l.categoryLabel} · Palier ${levelName(l.level)}`));

    const addSection = (title, contentEl) => {
        b.appendChild(el('h3', 'sheet-section-title', title));
        b.appendChild(contentEl);
    };

    addSection('Objectif', el('p', 'brief-body', l.summary));
    addSection('À retenir', el('p', 'brief-body', l.takeaway));

    const themeInfo = l.theme ? PuzzleThemes.byKey[l.theme] : null;
    if (themeInfo) {
        const tip = themeInfo.tip ? ` ${themeInfo.tip}` : '';
        addSection(`Thème : ${themeInfo.name}`, el('p', 'brief-body', `${themeInfo.goal}${tip}`));
    }

    const keys = Array.from(l.pauseSteps || []).filter((i) => i < l.line.size).sort((a, b2) => a - b2);
    if (keys.length > 0) {
        const list = el('div', 'brief-bullets');
        for (const i of keys) {
            const label = moveLabel(turnOf(l.line, i, 1), l.line.positions[i].whiteToMove, l.line.sans[i]);
            list.appendChild(el('p', 'brief-bullet', `• ${label} : ${l.texts[i]}`));
        }
        addSection('Les moments clés', list);
    }

    if (l.conditions) addSection('Conditions', el('p', 'brief-body', l.conditions));

    if (l.ideas.length) {
        const list = el('div', 'brief-bullets');
        for (const t of l.ideas) list.appendChild(el('p', 'brief-bullet', `• ${t}`));
        addSection('Les idées', list);
    }

    if (l.traps.length) {
        const list = el('div', 'brief-bullets');
        for (const t of l.traps) list.appendChild(el('p', 'brief-bullet', `• ${t}`));
        addSection('Les pièges', list);
    }

    return sheet;
}

/**
 * Choix du camp avant d'ouvrir une position de partie modèle dans le Jeu Libre.
 */
export function openChooseColorSheet({ fen, lesson, onPick }) {
    const pos = Position.fromFen(fen);
    const whiteToMove = pos.whiteToMove;
    const sheet = createSheet('Jouer cette position');
    const b = sheet.body;

    b.appendChild(el(
        'p',
        'brief-body',
        `Trait aux ${whiteToMove ? 'Blancs' : 'Noirs'} · le maître jouait les ${lesson.heroWhite ? 'Blancs' : 'Noirs'}.`,
    ));

    const list = el('div', 'color-pick-list');
    for (const white of [true, false]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-pick-row';
        btn.append(
            createSideDot(white),
            el('span', 'color-pick-label', `Jouer avec les ${white ? 'Blancs' : 'Noirs'}`),
        );
        btn.addEventListener('click', () => {
            feedback.key();
            sheet.close();
            onPick(white);
        });
        list.appendChild(btn);
    }
    b.appendChild(list);
    return sheet;
}

/**
 * Passerelles de fin de leçon sous le commentaire.
 */
export function buildLessonBridges({ lesson, endFen, onTrainTheme, onPlayPosition }) {
    if (!lesson.theme && !endFen) return null;
    const row = el('div', 'lesson-bridges-row');
    if (lesson.theme) {
        row.appendChild(duckButton({
            label: "S'entraîner",
            icon: 'Extension',
            accent: 'blue',
            className: 'flex-1',
            ariaLabel: "S'entraîner sur ce thème dans l'onglet Problèmes",
            onClick: () => onTrainTheme?.(lesson.theme, lesson.level),
        }));
    }
    if (endFen) {
        row.appendChild(duckButton({
            label: 'Jouer cette position',
            icon: 'SportsEsports',
            accent: 'blue',
            className: 'flex-1',
            ariaLabel: "Jouer cette position contre l'Ordinateur dans le Jeu Libre",
            onClick: () => onPlayPosition?.(endFen, lesson.heroWhite),
        }));
    }
    return row;
}

/**
 * Bouton « Variantes » (ouvertures en mode Guidé).
 */
export function buildVariantMenu({ lesson, selected, onSelect }) {
    const wrap = el('div', 'dropdown-wrap');
    const menu = el('div', 'duck-dropdown duck-dropdown-right hidden');
    menu.setAttribute('role', 'menu');
    let open = false;
    const setOpen = (v) => {
        open = v;
        menu.classList.toggle('hidden', !v);
        chip.setAttribute('aria-expanded', String(v));
    };

    const chip = duckChip({
        label: selected === 0 ? 'Variantes' : `Variante ${selected}`,
        selected: selected !== 0,
        icon: 'ExpandMore',
        accent: 'blue',
        onClick: (e) => {
            e?.stopPropagation?.();
            setOpen(!open);
        },
    });
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-label', `Ligne affichée : ${variantLabel(lesson, selected)}. Choisir une autre ligne`);

    for (let v = 0; v <= lesson.variants.length; v++) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `duck-dropdown-item${v === selected ? ' is-selected' : ''}`;
        item.setAttribute('role', 'menuitem');
        const chk = el('span', 'duck-dropdown-check');
        if (v === selected) chk.appendChild(createIcon('Check', 18));
        item.append(chk, el('span', '', variantLabel(lesson, v)));
        item.addEventListener('click', () => {
            feedback.key();
            setOpen(false);
            onSelect(v);
        });
        menu.appendChild(item);
    }

    const onDocClick = (e) => {
        if (open && !wrap.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDocClick, true);

    wrap.append(chip, menu);
    wrap.cleanup = () => document.removeEventListener('click', onDocClick, true);
    return wrap;
}

/**
 * Tiroir « Entraînements » : À faire maintenant, Vos 3 priorités, Tests, Réflexes, Exercices avancés, Finales, Répertoire.
 */
export function openTrainingsSheet({
    home,
    priorities,
    s,
    eg,
    rx,
    onClose,
    onStartReviews,
    onOpenLesson,
    onTrainTopic,
    onStartPlacement,
    onStartExam,
    onStartReflex,
    onStartOnlyMove,
    onStartEndgame,
    onStartRepertoire,
}) {
    const sheet = createSheet('Entraînements', onClose);
    const b = sheet.body;
    const pk = s.practice?.kind || null;
    const go = (fn) => () => {
        sheet.close();
        fn();
    };

    const intro = el(
        'p',
        'brief-muted',
        `Votre palier : ${levelName(home.level)}.${home.placementDone ? '' : ' Un court test de placement peut l\'ajuster.'}`,
    );
    intro.setAttribute(
        'aria-label',
        `Votre palier : ${levelSpoken(home.level)}.${home.placementDone ? '' : ' Un court test de placement peut l\'ajuster.'}`,
    );
    b.appendChild(intro);

    const cont = home.continueId;
    const rec = home.recommended && home.recommended !== s.lessonId && home.recommended !== cont
        ? home.recommended
        : null;

    if (home.due.length > 0 || cont || rec) {
        b.appendChild(el('h3', 'sheet-section-title', 'À faire maintenant'));
        if (home.due.length > 0) {
            b.appendChild(_suggestionCard({
                title: `Révisions du jour : ${home.due.length}`,
                detail: "Rejouez en Défi les leçons à revoir aujourd'hui.",
                action: 'Commencer les révisions',
                accent: 'gold',
                onClick: go(onStartReviews),
            }));
        }
        if (cont) {
            b.appendChild(_suggestionCard({
                title: 'Reprendre',
                detail: Lessons.byId(cont).title,
                action: 'Reprendre cette leçon',
                accent: 'blue',
                onClick: go(() => onOpenLesson(cont)),
            }));
        }
        if (rec) {
            b.appendChild(_suggestionCard({
                title: `Conseillée : ${Lessons.byId(rec).title}`,
                detail: 'La prochaine leçon de votre palier.',
                action: 'Ouvrir la leçon conseillée',
                accent: 'green',
                onClick: go(() => onOpenLesson(rec)),
            }));
        }
    }

    b.appendChild(el('h3', 'sheet-section-title', 'Vos 3 priorités'));
    if (!priorities.length) {
        b.appendChild(el(
            'p',
            'brief-muted',
            'Analysez vos parties du Jeu Libre et travaillez des leçons : vos points faibles apparaîtront ici.',
        ));
    } else {
        priorities.forEach((p, i) => {
            const card = el('div', 'suggestion-card accent-gold');
            card.append(
                el('div', 'suggestion-title', `${i + 1}. ${p.title}`),
                el('div', 'suggestion-detail', p.reason),
                duckButton({
                    label: p.theme ? 'Travailler ce point : leçon et 5 exercices' : 'Revoir la leçon',
                    icon: 'School',
                    accent: 'gold',
                    filled: true,
                    className: 'full-w',
                    onClick: go(() => onTrainTopic(p.lessonId, p.theme)),
                }),
            );
            b.appendChild(card);
        });
    }

    b.appendChild(el('h3', 'sheet-section-title', 'Tests'));
    b.appendChild(_trainingBtn({
        label: 'Test de placement : 12 positions',
        active: pk === 'PLACEMENT',
        done: home.placementDone,
        onClick: go(onStartPlacement),
    }));
    const examLevel = Math.max(2, home.level);
    b.appendChild(_trainingBtn({
        label: `Examen du palier ${levelName(examLevel)} : 10 positions`,
        active: pk === 'EXAM',
        done: home.examsPassed.has(examLevel),
        onClick: go(onStartExam),
    }));

    b.appendChild(el('h3', 'sheet-section-title', 'Réflexes'));
    b.appendChild(_trainingBtn({
        label: ReflexKind.THREAT.label,
        active: rx?.kind === ReflexKind.THREAT,
        onClick: go(() => onStartReflex(ReflexKind.THREAT)),
    }));
    b.appendChild(_trainingBtn({
        label: 'Le seul coup',
        active: pk === 'ONLY_MOVE',
        onClick: go(onStartOnlyMove),
    }));
    b.appendChild(_trainingBtn({
        label: ReflexKind.CAPTURE.label,
        active: rx?.kind === ReflexKind.CAPTURE,
        onClick: go(() => onStartReflex(ReflexKind.CAPTURE)),
    }));

    b.appendChild(el('h3', 'sheet-section-title', 'Exercices avancés'));
    b.appendChild(_trainingBtn({
        label: "Calcul à l'aveugle (palier 5)",
        active: rx?.kind === ReflexKind.BLIND,
        onClick: go(() => onStartReflex(ReflexKind.BLIND)),
    }));

    // Les 11 finales jouables, repliées par défaut sauf si l'une d'elles est en cours.
    let endgamesOpen = Boolean(eg);
    const egHead = document.createElement('button');
    egHead.type = 'button';
    egHead.className = 'endgames-fold-btn';
    const doneCount = ENDGAME_FAMILIES.filter((f) => home.endgamesDone.has(f.name)).length;
    let egArrow = createIcon(endgamesOpen ? 'ExpandLess' : 'ExpandMore', 20);
    const egTitle = el('span', 'endgames-fold-title', `Finales contre l'Ordinateur (${ENDGAME_FAMILIES.length})`);
    const egCount = el('span', 'endgames-fold-count', `${doneCount}/${ENDGAME_FAMILIES.length}`);
    egHead.append(egTitle, egCount, egArrow);
    const egList = el('div', `endgames-fold-list${endgamesOpen ? '' : ' hidden'}`);
    egHead.setAttribute('aria-expanded', String(endgamesOpen));
    egHead.addEventListener('click', () => {
        feedback.key();
        endgamesOpen = !endgamesOpen;
        egList.classList.toggle('hidden', !endgamesOpen);
        egHead.setAttribute('aria-expanded', String(endgamesOpen));
        const ic = createIcon(endgamesOpen ? 'ExpandLess' : 'ExpandMore', 20);
        egArrow.replaceWith(ic);
        egArrow = ic;
    });

    for (const [goal, goalLabel] of [[EndgameGoal.WIN, 'Gagner'], [EndgameGoal.DRAW, 'Tenir la nulle']]) {
        egList.appendChild(el('div', 'endgame-group-sub', goalLabel));
        for (const f of ENDGAME_FAMILIES.filter((x) => x.goal === goal)) {
            egList.appendChild(_trainingBtn({
                label: `${f.goal === EndgameGoal.WIN ? 'Gagnez' : 'Tenez la nulle'} : ${f.label}`,
                active: eg?.family?.name === f.name,
                done: home.endgamesDone.has(f.name),
                onClick: go(() => onStartEndgame(f)),
            }));
        }
    }
    b.append(egHead, egList);

    b.appendChild(el('h3', 'sheet-section-title', 'Répertoire'));
    b.appendChild(_trainingBtn({
        label: 'Réviser mon répertoire avec les Blancs',
        active: s.repertoire?.white === true,
        onClick: go(() => onStartRepertoire(true)),
    }));
    b.appendChild(_trainingBtn({
        label: 'Réviser mon répertoire avec les Noirs',
        active: s.repertoire?.white === false,
        onClick: go(() => onStartRepertoire(false)),
    }));

    return sheet;
}

function _suggestionCard({ title, detail, action, accent, onClick }) {
    const card = el('div', `suggestion-card accent-${accent}`);
    card.append(
        el('div', 'suggestion-title', title),
        el('div', 'suggestion-detail', detail),
        duckButton({
            label: action,
            icon: 'ArrowForward',
            accent,
            filled: true,
            className: 'full-w',
            onClick,
        }),
    );
    return card;
}

function _trainingBtn({ label, active = false, done = false, onClick }) {
    const text = active ? `${label} · En cours` : label;
    const btn = duckButton({
        label: text,
        icon: active ? 'PlayArrow' : (done ? 'CheckCircle' : null),
        accent: active ? 'gold' : null,
        filled: active,
        className: `full-w training-item-btn${done ? ' is-done' : ''}`,
        onClick,
    });
    if (active) btn.setAttribute('aria-current', 'true');
    return btn;
}

export function renderQuizChoice(text, right, what) {
    const row = el('div', `quiz-choice ${right ? 'is-good' : 'is-bad'}`);
    row.setAttribute('aria-label', `${what} : ${text}, ${right ? 'juste' : 'fausse'}`);
    row.append(createIcon(right ? 'CheckCircle' : 'Close', 18), el('span', 'quiz-choice-txt', text));
    return row;
}
