import { createSheet, el } from '../ui/common.js';

function sectionTitle(text) {
    return el('h3', 'section-title', text);
}

function memoRow(key, text) {
    const row = el('div', 'memo-row');
    const badge = el('div', 'memo-key', key);
    const desc = el('div', 'memo-desc', text);
    row.append(badge, desc);
    return row;
}

/** Fiche « Mémo Anglais » : lettres FIDE et symboles. */
export function openMemoSheet(onClose = null) {
    const sheet = createSheet('Mémo anglais — notation FIDE', onClose);
    const b = sheet.body;

    b.appendChild(sectionTitle('Les pièces'));
    const pieces = [
        ['K', 'King', 'Roi'],
        ['Q', 'Queen', 'Dame'],
        ['R', 'Rook', 'Tour'],
        ['B', 'Bishop', 'Fou'],
        ['N', 'Knight', 'Cavalier'],
        ['—', 'Pawn', 'Pion : aucune lettre'],
    ];
    for (const [l, en, fr] of pieces) {
        b.appendChild(memoRow(l, `${en}  →  ${fr}`));
    }

    b.appendChild(sectionTitle('Les symboles'));
    b.appendChild(memoRow('x', 'Prise (capture) : Bxf7, exd5'));
    b.appendChild(memoRow('+', 'Échec au roi : Qh5+'));
    b.appendChild(memoRow('#', 'Échec et mat : Qxf7#'));
    b.appendChild(memoRow('=', 'Promotion du pion : e8=Q'));
    b.appendChild(memoRow('O-O', 'Petit roque (côté roi)'));
    b.appendChild(memoRow('O-O-O', 'Grand roque (côté dame)'));

    b.appendChild(sectionTitle("Les règles d'or"));
    const rules = [
        "Un coup = lettre de la pièce + case d'arrivée : Nf3.",
        "Un pion ne prend jamais de lettre : e4. S'il capture, on indique sa colonne de départ : exd5.",
        'N comme kNight : le K est réservé au roi (King).',
        'Si deux pièces identiques peuvent aller sur la même case, on précise la colonne de départ (Rad1), sinon la rangée (N5f3).',
        "L'ordre est toujours : pièce, départ éventuel, x, case d'arrivée, =promotion, + ou #.",
    ];
    for (const t of rules) {
        const li = el('div', 'memo-rule');
        li.append(el('span', 'memo-bullet', '•  '), el('span', 'memo-rule-text', t));
        b.appendChild(li);
    }
    return sheet;
}
