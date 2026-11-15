import { Line } from '../core/chess.js';
import { prefs } from '../data/prefs.js';
import { createSheet, duckButton, duckSegmentedRow, el } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { createIcon } from '../ui/icons.js';
import { ShareCard, ShareFormat, shareStyleFromSettings } from './share-card.js';

function exportOptionRow(label, options, onSelect) {
    const row = el('div', 'export-option-row');
    row.appendChild(el('span', 'export-option-label', label));
    const seg = duckSegmentedRow({
        options: options.map((o) => o[0]),
        selectedIndex: options.findIndex((o) => o[1]),
        onSelect,
        className: 'flex-1',
    });
    row.appendChild(seg);
    return row;
}

/** Tiroir « Exporter en image » : format et fond, aperçus, partage (Web Share) et téléchargement PNG. */
export function openExportSheet({ puzzle, line, playerWhite, solved, onClose }) {
    let style = shareStyleFromSettings(prefs.current);
    let renderToken = 0;
    let problemShot = null;
    let solutionShot = null;
    let revealSolution = false;
    let busy = false;
    let closed = false;

    const cleanupUrls = () => {
        if (problemShot?.previewUrl) URL.revokeObjectURL(problemShot.previewUrl);
        if (solutionShot?.previewUrl) URL.revokeObjectURL(solutionShot.previewUrl);
        problemShot = null;
        solutionShot = null;
    };

    const sheet = createSheet('Exporter en image', () => {
        closed = true;
        cleanupUrls();
        onClose?.();
    });
    const b = sheet.body;

    const formatRowHost = el('div');
    const formatHint = el('p', 'muted-small export-hint', '');
    const bgRowHost = el('div');
    const problemCardHost = el('div');
    const solutionCardHost = el('div');
    const statusRow = el('div', 'export-status hidden');

    b.append(formatRowHost, formatHint, bgRowHost, problemCardHost, solutionCardHost, statusRow);

    function setStatus(ok, msg) {
        statusRow.replaceChildren();
        statusRow.classList.remove('hidden', 'is-ok', 'is-err');
        statusRow.classList.add(ok ? 'is-ok' : 'is-err');
        statusRow.append(createIcon(ok ? 'CheckCircle' : 'ErrorOutline', 18), el('span', '', msg));
    }

    function buildCard({ title, description, accent, icon, shot, masked, revealed, onReveal, onShare, onSave }) {
        const card = el('div', 'export-card');
        const top = el('div', 'export-card-top');
        const thumb = el('div', 'export-thumb');
        if (masked && !revealed) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'export-mask-btn';
            btn.setAttribute('aria-label', "Afficher l'aperçu de la solution");
            btn.append(createIcon('VisibilityOff', 24), el('span', '', 'Toucher pour voir'));
            btn.addEventListener('click', () => { feedback.key(); onReveal(); });
            thumb.appendChild(btn);
        } else if (shot?.previewUrl) {
            const img = document.createElement('img');
            img.src = shot.previewUrl;
            img.alt = `Aperçu : ${title}`;
            img.className = 'export-thumb-img';
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el('div', 'duck-spinner duck-spinner-sm'));
        }

        const info = el('div', 'export-card-info');
        const head = el('div', 'export-card-head');
        const ic = createIcon(icon, 20);
        ic.classList.add(`text-${accent}`);
        head.append(ic, el('span', 'export-card-title', title));
        info.append(head, el('p', 'export-card-desc', description));
        top.append(thumb, info);

        const actions = el('div', 'equal-row export-card-actions');
        const bShare = duckButton({
            label: 'Partager',
            icon: 'Share',
            accent,
            filled: true,
            enabled: !busy,
            ariaLabel: `Partager : ${title}`,
            onClick: onShare,
        });
        bShare.style.flex = '1';
        const bSave = duckButton({
            label: 'Enregistrer',
            icon: 'Download',
            accent,
            variant: 'outlined',
            enabled: !busy,
            ariaLabel: `Enregistrer : ${title}`,
            onClick: onSave,
        });
        bSave.style.flex = '1';
        actions.append(bShare, bSave);
        card.append(top, actions);
        return card;
    }

    function renderControlsAndCards() {
        formatRowHost.replaceChildren(exportOptionRow(
            'Format',
            [
                ['Portrait 4:5', style.format.name === 'PORTRAIT'],
                ['Carré 1:1', style.format.name === 'SQUARE'],
            ],
            (i) => {
                style = { ...style, format: i === 0 ? ShareFormat.PORTRAIT : ShareFormat.SQUARE };
                prefs.setShareStyle(style.format.name, style.light);
                regenerate();
            },
        ));
        formatHint.textContent = style.format.name === 'PORTRAIT'
            ? 'Idéal pour WhatsApp et les messageries : affiché en entier, sans recadrage.'
            : 'Idéal pour une publication Instagram ou un aperçu compact.';

        bgRowHost.replaceChildren(exportOptionRow(
            'Fond',
            [
                ['Sombre', !style.light],
                ['Clair', style.light],
            ],
            (i) => {
                style = { ...style, light: i === 1 };
                prefs.setShareStyle(style.format.name, style.light);
                regenerate();
            },
        ));

        problemCardHost.replaceChildren(buildCard({
            title: 'Le problème',
            description: "L'énoncé seul : le défi, l'échiquier, la difficulté et un indice — sans la solution.",
            accent: 'blue',
            icon: 'Extension',
            shot: problemShot,
            masked: false,
            revealed: true,
            onShare: async () => {
                busy = true;
                renderControlsAndCards();
                const cached = problemShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.render(puzzle, line.positions[1], playerWhite, line.moves[0], style);
                    if (closed) return;
                    const ch = ShareCard.challenge(puzzle, Line.fromUci(puzzle.fen, puzzle.moves), playerWhite);
                    await ShareCard.shareBlob(shot.blob, `chessduck-${puzzle.id}.png`, `${ch}. Saurez-vous trouver la solution ?`);
                    if (!closed) sheet.close();
                } finally {
                    if (!cached && shot?.previewUrl && shot !== problemShot) URL.revokeObjectURL(shot.previewUrl);
                    busy = false;
                    if (!closed) renderControlsAndCards();
                }
            },
            onSave: async () => {
                busy = true;
                renderControlsAndCards();
                const cached = problemShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.render(puzzle, line.positions[1], playerWhite, line.moves[0], style);
                    if (closed) return;
                    const msg = ShareCard.saveBlob(shot.blob, `chessduck-${puzzle.id}.png`);
                    if (msg) setStatus(true, msg);
                    else setStatus(false, "L'image n'a pas pu être enregistrée.");
                } finally {
                    if (!cached && shot?.previewUrl && shot !== problemShot) URL.revokeObjectURL(shot.previewUrl);
                    busy = false;
                    if (!closed) renderControlsAndCards();
                }
            },
        }));

        solutionCardHost.replaceChildren(buildCard({
            title: 'La solution',
            description: 'Une carte par coup : flèches, échecs (+), mat (#), pièces prises et conclusion.',
            accent: 'green',
            icon: 'CheckCircle',
            shot: solutionShot,
            masked: !solved,
            revealed: revealSolution,
            onReveal: () => {
                revealSolution = true;
                renderControlsAndCards();
            },
            onShare: async () => {
                busy = true;
                renderControlsAndCards();
                const cached = solutionShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.renderSolution(puzzle, style);
                    if (closed) return;
                    await ShareCard.shareBlob(shot.blob, `chessduck-${puzzle.id}-solution.png`, `Solution du problème Lichess #${puzzle.id}`);
                    if (!closed) sheet.close();
                } finally {
                    if (!cached && shot?.previewUrl && shot !== solutionShot) URL.revokeObjectURL(shot.previewUrl);
                    busy = false;
                    if (!closed) renderControlsAndCards();
                }
            },
            onSave: async () => {
                busy = true;
                renderControlsAndCards();
                const cached = solutionShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.renderSolution(puzzle, style);
                    if (closed) return;
                    const msg = ShareCard.saveBlob(shot.blob, `chessduck-${puzzle.id}-solution.png`);
                    if (msg) setStatus(true, msg);
                    else setStatus(false, "L'image n'a pas pu être enregistrée.");
                } finally {
                    if (!cached && shot?.previewUrl && shot !== solutionShot) URL.revokeObjectURL(shot.previewUrl);
                    busy = false;
                    if (!closed) renderControlsAndCards();
                }
            },
        }));
    }

    async function regenerate() {
        const token = ++renderToken;
        cleanupUrls();
        renderControlsAndCards();
        const [pRes, sRes] = await Promise.all([
            ShareCard.render(puzzle, line.positions[1], playerWhite, line.moves[0], style),
            ShareCard.renderSolution(puzzle, style),
        ]);
        if (closed || token !== renderToken) {
            if (pRes?.previewUrl) URL.revokeObjectURL(pRes.previewUrl);
            if (sRes?.previewUrl) URL.revokeObjectURL(sRes.previewUrl);
            return;
        }
        problemShot = pRes;
        solutionShot = sRes;
        renderControlsAndCards();
    }

    regenerate();
    return sheet;
}
