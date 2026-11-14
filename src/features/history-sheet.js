import {
    createSheet, duckButton, duckChip, duckIconButton, el, emptyState, openConfirmDialog,
} from '../ui/common.js';
import { feedback } from '../ui/feedback.js';

export function formatDate(t) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function openHistorySheet({ games: initialGames, subscribeGames, onDelete, onReplay }) {
    let unsub = null;
    const sheet = createSheet('Historique des parties', () => {
        unsub?.();
        unsub = null;
    });
    const listWrap = el('div', 'history-list');
    sheet.body.appendChild(listWrap);

    function render(games) {
        listWrap.replaceChildren();
        if (!games.length) {
            listWrap.appendChild(emptyState({
                icon: 'History',
                title: "Aucune partie pour l'instant",
                message: 'Terminez une partie en Jeu Libre : elle apparaîtra ici avec sa revue commentée.',
                actionLabel: 'Fermer',
                onAction: () => sheet.close(),
            }));
            return;
        }
        for (const g of games) {
            const card = el('div', 'history-card');
            const top = el('div', 'history-card-top');
            let label;
            let toneCls;
            if (!g.vsComputer) {
                if (g.outcome === 1) label = `Victoire de ${g.whiteName || 'Blancs'}`;
                else if (g.outcome === -1) label = `Victoire de ${g.blackName || 'Noirs'}`;
                else label = 'Nulle';
                toneCls = 'text-gold';
            } else if (g.outcome === 1) {
                label = 'Victoire';
                toneCls = 'text-green';
            } else if (g.outcome === -1) {
                label = 'Défaite';
                toneCls = 'text-red';
            } else {
                label = 'Nulle';
                toneCls = 'text-gold';
            }
            const titleEl = el('div', `history-outcome ${toneCls}`, label);
            top.appendChild(titleEl);

            if (g.vsComputer) {
                const d = g.eloAfter - g.eloBefore;
                const deltaTxt = d >= 0 ? `+${d}` : `−${-d}`;
                const eloEl = el('span', `history-elo ${d >= 0 ? 'text-green' : 'text-red'}`, `ELO ${g.eloAfter} (${deltaTxt})`);
                top.appendChild(eloEl);
            }

            const delBtn = duckIconButton({
                icon: 'Delete',
                ariaLabel: 'Supprimer cette partie',
                onClick: () => {
                    openConfirmDialog({
                        title: 'Supprimer cette partie ?',
                        text: `Elle disparaîtra définitivement de l'historique (${formatDate(g.date)}).`,
                        confirmLabel: 'Supprimer',
                        onConfirm: () => onDelete(g.id),
                    });
                },
            });
            top.appendChild(delBtn);

            const plyCount = g.moves ? g.moves.trim().split(/\s+/).filter(Boolean).length : 0;
            const nbMoves = Math.floor((plyCount + 1) / 2);
            let players;
            if (!g.whiteName) {
                players = `contre ${(g.opponent || '').replace('Stockfish', 'Ordinateur')}` +
                    (g.vsComputer ? ` · avec les ${g.playerWhite ? 'Blancs' : 'Noirs'}` : '');
            } else if (g.vsComputer) {
                const me = `(${g.eloBefore})`;
                const ai = `(${g.opponentElo})`;
                players = `Blancs : ${g.whiteName} ${g.playerWhite ? me : ai}  –  Noirs : ${g.blackName} ${g.playerWhite ? ai : me}`;
            } else {
                players = `Blancs : ${g.whiteName}  –  Noirs : ${g.blackName} · hors ELO`;
            }

            const playersEl = el('div', 'history-players', players);
            const metaEl = el('div', 'history-meta', `${formatDate(g.date)} · ${g.result} par ${g.reason} · ${nbMoves} coups`);
            const replayBtn = duckButton({
                label: 'Rejouer sur l’échiquier',
                icon: 'PlayArrow',
                accent: 'blue',
                filled: true,
                className: 'full-w',
                onClick: () => {
                    sheet.close();
                    onReplay(g);
                },
            });
            card.append(top, playersEl, metaEl, replayBtn);
            listWrap.appendChild(card);
        }
    }

    if (subscribeGames) {
        unsub = subscribeGames(render);
    } else {
        render(initialGames || []);
    }
    return sheet;
}

export function openGameSettingsSheet({ twoPlayers, colorChoice, aiElo, onApply }) {
    const sheet = createSheet('Paramètres de partie');
    let two = Boolean(twoPlayers);
    let col = colorChoice ?? 0;
    let elo = aiElo ?? 1200;

    const body = sheet.body;
    const modeSection = el('div', 'sheet-block');
    const modeTitle = el('h3', 'sheet-section-title', 'Mode de jeu');
    const modeRow = el('div', 'flow-row');

    const colorSection = el('div', 'sheet-block');
    const colorTitle = el('h3', 'sheet-section-title', 'Votre couleur');
    const colorRow = el('div', 'flow-row');

    const eloSection = el('div', 'sheet-block');
    const eloTitle = el('h3', 'sheet-section-title', `Niveau de l'ordinateur : ${elo} ELO`);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '600';
    slider.max = '2400';
    slider.step = '50';
    slider.value = String(elo);
    slider.className = 'duck-slider';
    slider.setAttribute('aria-label', `Niveau de l'ordinateur : ${elo} ELO`);
    slider.addEventListener('input', () => {
        elo = parseInt(slider.value, 10) || 1200;
        eloTitle.textContent = `Niveau de l'ordinateur : ${elo} ELO`;
        slider.setAttribute('aria-label', `Niveau de l'ordinateur : ${elo} ELO`);
    });
    const sliderLabels = el('div', 'slider-bounds');
    sliderLabels.append(
        el('span', 'muted-small', '600 · débutant'),
        el('span', 'muted-small text-right', '2400 · maître'),
    );

    const startBtn = duckButton({
        label: 'Lancer une nouvelle partie',
        icon: 'PlayArrow',
        accent: 'gold',
        filled: true,
        className: 'full-w mt-16',
        onClick: () => {
            sheet.close();
            onApply(two, col, elo);
        },
    });
    const note = el(
        'p',
        'muted-small mt-8',
        'Le pseudo, le thème et les confirmations se règlent dans Paramètres, en haut à droite.',
    );

    function renderChips() {
        modeRow.replaceChildren(
            duckChip({ label: "Contre l'ordinateur", selected: !two, icon: 'SmartToy', onClick: () => { two = false; renderChips(); } }),
            duckChip({ label: '2 joueurs (Pass & Play)', selected: two, icon: 'People', onClick: () => { two = true; renderChips(); } }),
        );
        colorRow.replaceChildren(
            duckChip({ label: 'Blancs', selected: col === 0, onClick: () => { col = 0; renderChips(); } }),
            duckChip({ label: 'Aléatoire', selected: col === 1, onClick: () => { col = 1; renderChips(); } }),
            duckChip({ label: 'Noirs', selected: col === 2, onClick: () => { col = 2; renderChips(); } }),
        );
        colorSection.classList.toggle('hidden', two);
        eloSection.classList.toggle('hidden', two);
    }

    modeSection.append(modeTitle, modeRow);
    colorSection.append(colorTitle, colorRow);
    eloSection.append(eloTitle, slider, sliderLabels);
    body.append(modeSection, colorSection, eloSection, startBtn, note);
    renderChips();
    return sheet;
}
