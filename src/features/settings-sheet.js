import { prefs } from '../data/prefs.js';
import { createSheet, duckButton, duckSegmentedRow, el } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { narrator } from '../ui/narrator.js';
import { DuckPalette, isDarkTheme } from '../ui/theme.js';

function createSwitchRow({ title, description, checked, onChange }) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-switch-row';
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', String(Boolean(checked)));

    const copy = el('div', 'settings-switch-copy');
    copy.appendChild(el('div', 'settings-switch-title', title));
    if (description) copy.appendChild(el('div', 'settings-switch-desc', description));

    const track = el('span', `duck-switch${checked ? ' is-checked' : ''}`);
    track.setAttribute('aria-hidden', 'true');
    const thumb = el('span', 'duck-switch-thumb');
    track.appendChild(thumb);

    row.append(copy, track);
    row.addEventListener('click', () => {
        feedback.key();
        const next = row.getAttribute('aria-checked') !== 'true';
        onChange(next);
    });

    return {
        el: row,
        setChecked(v) {
            row.setAttribute('aria-checked', String(Boolean(v)));
            track.classList.toggle('is-checked', Boolean(v));
        },
    };
}

function createPseudoField({ label, initial, fallback, onSave }) {
    const wrap = el('div', 'pseudo-field');
    const lbl = el('label', 'pseudo-field-label', label);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'duck-text-input pseudo-input';
    input.maxLength = 16;
    input.value = initial;
    input.setAttribute('aria-label', label);
    input.enterKeyHint = 'done';

    const counter = el('div', 'pseudo-counter', `${input.value.length}/16`);
    let dirty = false;
    let focused = false;
    let timer = null;

    function flush() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (!dirty) return;
        dirty = false;
        const clean = input.value.trim() || fallback;
        onSave(clean);
    }

    input.addEventListener('input', () => {
        if (input.value.length > 16) input.value = input.value.slice(0, 16);
        counter.textContent = `${input.value.length}/16`;
        dirty = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 300);
    });
    input.addEventListener('focus', () => { focused = true; });
    input.addEventListener('blur', () => {
        focused = false;
        flush();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            flush();
            input.blur();
        }
    });

    wrap.append(lbl, input, counter);
    return {
        el: wrap,
        syncExternal(next) {
            const currentNorm = input.value.trim() || fallback;
            if (!focused && !dirty && next !== currentNorm) {
                input.value = next;
                counter.textContent = `${input.value.length}/16`;
            }
        },
        flush,
    };
}

function createPaletteOption(palette, dark, selected, onClick) {
    const p = palette.colors(dark);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-option${selected ? ' is-selected' : ''}`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(Boolean(selected)));
    btn.setAttribute('aria-label', `${palette.title}. ${palette.description}`);

    const preview = el('div', 'palette-preview');
    preview.style.background = p.bg;
    preview.style.borderColor = p.outlineStrong;

    const topBar = el('div', 'palette-preview-bar');
    topBar.style.background = p.goldRole.fill;

    const bottomRow = el('div', 'palette-preview-bottom');
    const card = el('div', 'palette-preview-card');
    card.style.background = p.surface;
    for (const col of [p.greenRole.fill, p.blueRole.fill, p.redRole.fill]) {
        const dot = el('span', 'palette-preview-dot');
        dot.style.background = col;
        card.appendChild(dot);
    }

    const sqPair = el('div', 'palette-preview-squares');
    const sqL = el('span', 'palette-preview-sq');
    sqL.style.background = p.squareLight;
    const sqD = el('span', 'palette-preview-sq');
    sqD.style.background = p.squareDark;
    sqPair.append(sqL, sqD);

    bottomRow.append(card, sqPair);
    preview.append(topBar, bottomRow);

    const copy = el('div', 'palette-option-copy');
    copy.append(
        el('div', 'palette-option-title', palette.title),
        el('div', 'palette-option-desc', palette.description),
    );

    const radio = el('span', `duck-radio${selected ? ' is-checked' : ''}`);
    radio.setAttribute('aria-hidden', 'true');

    btn.append(preview, copy, radio);
    btn.addEventListener('click', () => {
        feedback.key();
        onClick();
    });
    return btn;
}

export function openSettingsSheet() {
    let unsub = null;
    let pseudo1 = null;
    let pseudo2 = null;

    narrator.prepare();

    const sheet = createSheet('Paramètres', () => {
        pseudo1?.flush();
        pseudo2?.flush();
        unsub?.();
        unsub = null;
    });

    const b = sheet.body;

    // ---- Mode enfant ----
    b.appendChild(el('h3', 'sheet-section-title', 'Mode enfant'));
    const kidBtn = duckButton({
        label: 'Activer le mode enfant',
        accent: 'green',
        filled: true,
        icon: 'ChildCare',
        className: 'full-w',
        onClick: () => {
            sheet.close();
            prefs.setKidMode(true);
        },
    });
    const kidDesc = el(
        'p',
        'muted-small mt-6',
        'Un écran joyeux et coloré pour jouer à deux avec un enfant : grand échiquier, cavalier en forme de girafe, animations qui montrent comment chaque pièce bouge, sans ordinateur ni historique.',
    );
    b.append(kidBtn, kidDesc);

    // ---- Apparence ----
    b.appendChild(el('h3', 'sheet-section-title', 'Apparence'));
    const themeWrap = el('div', '');
    b.appendChild(themeWrap);

    // ---- Échiquier et parties ----
    b.appendChild(el('h3', 'sheet-section-title', 'Échiquier et parties'));
    const coordsRow = createSwitchRow({
        title: 'Afficher les coordonnées',
        description: "Lettres a–h et chiffres 1–8 sur l'échiquier. Masquez-les pour vous entraîner à la notation.",
        checked: prefs.current.coords,
        onChange: (v) => prefs.setCoords(v),
    });
    const confirmRow = createSwitchRow({
        title: "Confirmer l'abandon et la nouvelle partie",
        description: 'Demande une confirmation quand une partie est en cours.',
        checked: prefs.current.confirmActions,
        onChange: (v) => prefs.setConfirmActions(v),
    });
    b.append(coordsRow.el, confirmRow.el);

    // ---- Sons et vibrations ----
    b.appendChild(el('h3', 'sheet-section-title', 'Sons et vibrations'));
    const soundRow = createSwitchRow({
        title: 'Bruit des pièces',
        description: 'Petit bruit de bois quand une pièce se pose.',
        checked: prefs.current.sound,
        onChange: (v) => prefs.setSound(v),
    });
    const hapticsRow = createSwitchRow({
        title: 'Vibrations',
        description: 'Retour haptique au toucher, aux erreurs et aux réussites.',
        checked: prefs.current.haptics,
        onChange: (v) => prefs.setHaptics(v),
    });
    const narrationRow = createSwitchRow({
        title: 'Lecture vocale des leçons',
        description: "Lit à voix haute les coups et les explications du mode Guidé de l'Académie.",
        checked: prefs.current.narration,
        onChange: (v) => {
            if (v) narrator.prepare();
            else narrator.stop();
            prefs.setNarration(v);
        },
    });
    b.append(soundRow.el, hapticsRow.el, narrationRow.el);

    // ---- Joueurs ----
    b.appendChild(el('h3', 'sheet-section-title', 'Joueurs'));
    pseudo1 = createPseudoField({
        label: 'Pseudo du joueur',
        initial: prefs.current.pseudo,
        fallback: 'Joueur',
        onSave: (v) => prefs.setPseudo(v),
    });
    pseudo2 = createPseudoField({
        label: 'Pseudo du joueur 2 (mode 2 joueurs)',
        initial: prefs.current.pseudo2,
        fallback: 'Joueur 2',
        onSave: (v) => prefs.setPseudo2(v),
    });
    const eloInfo = el('p', 'muted-small mt-4', '');
    b.append(pseudo1.el, pseudo2.el, eloInfo);

    // ---- Palette de couleurs ----
    b.appendChild(el('h3', 'sheet-section-title', 'Palette de couleurs'));
    const paletteIntro = el(
        'p',
        'muted-small mb-6',
        "Chaque palette adapte l'interface et l'échiquier, en mode Jour comme en mode Nuit.",
    );
    const paletteList = el('div', 'palette-list');
    paletteList.setAttribute('role', 'radiogroup');
    paletteList.setAttribute('aria-label', 'Palette de couleurs');
    b.append(paletteIntro, paletteList);

    // ---- À propos ----
    b.appendChild(el('h3', 'sheet-section-title', 'À propos'));
    const aboutText = el(
        'p',
        'muted-small',
        'ChessDuck fonctionne 100 % hors-ligne. Moteur : Stockfish 19 Lite WASM (GPLv3). Problèmes : base ouverte Lichess (CC0). Pièces : série classique de Cburnett et pièce féerique Girafe, Wikimedia Commons (CC BY-SA 3.0). Icônes : Material Icons (Apache 2.0). Police du mode enfant : Fredoka (OFL).',
    );
    const copyright = el('p', 'settings-copyright', '© Ivan Herboch, 2026 · v2.4.2');
    b.append(aboutText, copyright);

    function sync(st) {
        themeWrap.replaceChildren(duckSegmentedRow({
            options: ['Système', 'Jour', 'Nuit'],
            selectedIndex: st.themeMode,
            onSelect: (i) => prefs.setThemeMode(i),
        }));
        coordsRow.setChecked(st.coords);
        confirmRow.setChecked(st.confirmActions);
        soundRow.setChecked(st.sound);
        hapticsRow.setChecked(st.haptics);
        narrationRow.setChecked(st.narration);
        pseudo1.syncExternal(st.pseudo);
        pseudo2.syncExternal(st.pseudo2);
        eloInfo.textContent = `Classement actuel : ${st.elo} ELO (formule FIDE, K = 32). Les parties à 2 joueurs ne comptent pas.`;

        const dark = isDarkTheme(st.themeMode);
        const currentPal = DuckPalette.of(st.palette);
        paletteList.replaceChildren(
            ...DuckPalette.entries.map((entry) => createPaletteOption(
                entry,
                dark,
                entry.ordinal === currentPal.ordinal,
                () => prefs.setPalette(entry.ordinal),
            )),
        );
    }

    unsub = prefs.subscribe(sync);
    return sheet;
}
