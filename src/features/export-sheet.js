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

/** Tiroir « Exporter en image » : format et fond, aperçus, agrandissement, partage (Web Share) et téléchargement PNG. */
export function openExportSheet({ puzzle, line, playerWhite, solved, onClose }) {
    let style = shareStyleFromSettings(prefs.current);
    let renderToken = 0;
    let problemShot = null;
    let solutionShot = null;
    let problemFailed = false;
    let solutionFailed = false;
    let revealSolution = false;
    let sharing = 0; // 0 = aucun, 1 = problème, 2 = solution
    let busy = false;
    let closed = false;
    let lightbox = null;
    let onLightboxKey = null;

    const closeLightbox = () => {
        if (onLightboxKey) {
            document.removeEventListener('keydown', onLightboxKey);
            onLightboxKey = null;
        }
        if (lightbox) {
            lightbox.remove();
            lightbox = null;
        }
    };

    const openLightbox = (title, previewUrl) => {
        closeLightbox();
        const root = document.getElementById('modal-root') || document.body;
        const overlay = el('div', 'export-lightbox');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', "Fermer l'aperçu");
        const img = document.createElement('img');
        img.src = previewUrl;
        img.alt = `Aperçu agrandi : ${title}`;
        img.className = 'export-lightbox-img';
        overlay.appendChild(img);
        overlay.addEventListener('click', () => closeLightbox());
        onLightboxKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeLightbox();
            }
        };
        document.addEventListener('keydown', onLightboxKey);
        root.appendChild(overlay);
        lightbox = overlay;
    };

    const cleanupUrls = () => {
        closeLightbox();
        if (problemShot?.previewUrl) URL.revokeObjectURL(problemShot.previewUrl);
        if (solutionShot?.previewUrl) URL.revokeObjectURL(solutionShot.previewUrl);
        problemShot = null;
        solutionShot = null;
        problemFailed = false;
        solutionFailed = false;
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
    statusRow.setAttribute('aria-live', 'polite');

    b.append(formatRowHost, formatHint, bgRowHost, problemCardHost, solutionCardHost, statusRow);

    function clearStatus() {
        statusRow.replaceChildren();
        statusRow.className = 'export-status hidden';
    }

    function setStatus(ok, msg) {
        statusRow.replaceChildren();
        statusRow.classList.remove('hidden', 'is-ok', 'is-err');
        statusRow.classList.add(ok ? 'is-ok' : 'is-err');
        statusRow.append(createIcon(ok ? 'CheckCircle' : 'ErrorOutline', 18), el('span', '', msg));
    }

    function buildCard({ title, description, accent, icon, shot, failed, masked, revealed, activeBusy, onReveal, onShare, onSave }) {
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
            const zoomBtn = document.createElement('button');
            zoomBtn.type = 'button';
            zoomBtn.className = 'export-thumb-btn';
            zoomBtn.setAttribute('aria-label', `Agrandir l'aperçu : ${title}`);
            const img = document.createElement('img');
            img.src = shot.previewUrl;
            img.alt = `Aperçu : ${title}`;
            img.className = 'export-thumb-img';
            zoomBtn.appendChild(img);
            zoomBtn.addEventListener('click', () => {
                feedback.key();
                openLightbox(title, shot.previewUrl);
            });
            thumb.appendChild(zoomBtn);
        } else if (failed) {
            const errBox = el('div', 'export-thumb-failed');
            const errIc = createIcon('ErrorOutline', 24);
            errIc.classList.add('text-red');
            errBox.append(errIc, el('span', 'export-thumb-failed-text', 'Aperçu indisponible'));
            thumb.appendChild(errBox);
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
            label: activeBusy ? 'Préparation…' : 'Partager',
            icon: 'Share',
            accent,
            filled: true,
            enabled: !busy,
            ariaLabel: activeBusy ? `Préparation de l'image : ${title}` : `Partager : ${title}`,
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

        const shareFailedMsg = "L'image n'a pas pu être préparée pour le partage. Réessayez.";

        problemCardHost.replaceChildren(buildCard({
            title: 'Le problème',
            description: "L'énoncé seul : le défi, l'échiquier, la difficulté et un indice — sans la solution.",
            accent: 'blue',
            icon: 'Extension',
            shot: problemShot,
            failed: problemFailed,
            masked: false,
            revealed: true,
            activeBusy: busy && sharing === 1,
            onShare: async () => {
                clearStatus();
                busy = true;
                sharing = 1;
                renderControlsAndCards();
                const cached = problemShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.render(puzzle, line.positions[1], playerWhite, line.moves[0], style);
                    if (closed) return;
                    if (!shot?.blob) {
                        setStatus(false, shareFailedMsg);
                        return;
                    }
                    const ch = ShareCard.challenge(puzzle, Line.fromUci(puzzle.fen, puzzle.moves), playerWhite);
                    const ok = await ShareCard.shareBlob(shot.blob, `chessduck-${puzzle.id}.png`, `${ch}. Saurez-vous trouver la solution ?`);
                    if (!closed) {
                        if (ok) sheet.close();
                        else setStatus(false, shareFailedMsg);
                    }
                } catch {
                    if (!closed) setStatus(false, shareFailedMsg);
                } finally {
                    if (!cached && shot?.previewUrl && shot !== problemShot) URL.revokeObjectURL(shot.previewUrl);
                    busy = false;
                    sharing = 0;
                    if (!closed) renderControlsAndCards();
                }
            },
            onSave: async () => {
                clearStatus();
                busy = true;
                renderControlsAndCards();
                const cached = problemShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.render(puzzle, line.positions[1], playerWhite, line.moves[0], style);
                    if (closed) return;
                    const msg = ShareCard.saveBlob(shot?.blob, `chessduck-${puzzle.id}.png`);
                    if (msg) setStatus(true, msg);
                    else setStatus(false, "L'image n'a pas pu être enregistrée.");
                } catch {
                    if (!closed) setStatus(false, "L'image n'a pas pu être enregistrée.");
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
            failed: solutionFailed,
            masked: !solved,
            revealed: revealSolution,
            activeBusy: busy && sharing === 2,
            onReveal: () => {
                revealSolution = true;
                renderControlsAndCards();
            },
            onShare: async () => {
                clearStatus();
                busy = true;
                sharing = 2;
                renderControlsAndCards();
                const cached = solutionShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.renderSolution(puzzle, style);
                    if (closed) return;
                    if (!shot?.blob) {
                        setStatus(false, shareFailedMsg);
                        return;
                    }
                    const ok = await ShareCard.shareBlob(shot.blob, `chessduck-${puzzle.id}-solution.png`, `Solution du problème Lichess #${puzzle.id}`);
                    if (!closed) {
                        if (ok) sheet.close();
                        else setStatus(false, shareFailedMsg);
                    }
                } catch {
                    if (!closed) setStatus(false, shareFailedMsg);
                } finally {
                    if (!cached && shot?.previewUrl && shot !== solutionShot) URL.revokeObjectURL(shot.previewUrl);
                    busy = false;
                    sharing = 0;
                    if (!closed) renderControlsAndCards();
                }
            },
            onSave: async () => {
                clearStatus();
                busy = true;
                renderControlsAndCards();
                const cached = solutionShot;
                let shot = cached;
                try {
                    if (!shot) shot = await ShareCard.renderSolution(puzzle, style);
                    if (closed) return;
                    const msg = ShareCard.saveBlob(shot?.blob, `chessduck-${puzzle.id}-solution.png`);
                    if (msg) setStatus(true, msg);
                    else setStatus(false, "L'image n'a pas pu être enregistrée.");
                } catch {
                    if (!closed) setStatus(false, "L'image n'a pas pu être enregistrée.");
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
            ShareCard.render(puzzle, line.positions[1], playerWhite, line.moves[0], style).catch(() => null),
            ShareCard.renderSolution(puzzle, style).catch(() => null),
        ]);
        if (closed || token !== renderToken) {
            if (pRes?.previewUrl) URL.revokeObjectURL(pRes.previewUrl);
            if (sRes?.previewUrl) URL.revokeObjectURL(sRes.previewUrl);
            return;
        }
        problemShot = pRes?.previewUrl ? pRes : null;
        problemFailed = !problemShot;
        solutionShot = sRes?.previewUrl ? sRes : null;
        solutionFailed = !solutionShot;
        renderControlsAndCards();
    }

    regenerate();
    return sheet;
}
