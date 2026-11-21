import { DEFAULT_ELO, prefs } from '../data/prefs.js';
import { createSheet, duckButton, duckSegmentedRow, el, openConfirmDialog, updateSegmentedRow } from '../ui/common.js';
import { feedback } from '../ui/feedback.js';
import { narrator } from '../ui/narrator.js';
import { BoardTheme, DuckPalette, isDarkTheme } from '../ui/theme.js';

function createSwitchRow({ title, description, checked, onChange }) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-switch-row';
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', String(Boolean(checked)));

    const copy = el('div', 'settings-switch-copy');
    copy.appendChild(el('div', 'settings-switch-title', title));
    const descEl = el('div', 'settings-switch-desc', description || '');
    if (!description) descEl.classList.add('hidden');
    copy.appendChild(descEl);

    const track = el('span', `duck-switch${checked ? ' is-checked' : ''}`);
    track.setAttribute('aria-hidden', 'true');
    const thumb = el('span', 'duck-switch-thumb');
    track.appendChild(thumb);

    row.append(copy, track);
    row.addEventListener('click', () => {
        if (row.disabled) return;
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
        setEnabled(en) {
            row.disabled = !en;
            row.setAttribute('aria-disabled', String(!en));
        },
        setDescription(desc) {
            descEl.textContent = desc || '';
            descEl.classList.toggle('hidden', !desc);
        },
    };
}

function createVoiceSwitchRow({ title, description, checked, onToggle }) {
    const row = createSwitchRow({
        title,
        description,
        checked,
        onChange: (v) => {
            if (v) {
                narrator.prepare();
                narrator.unlock(true);
            } else {
                narrator.stop();
            }
            onToggle(v);
        },
    });
    return {
        ...row,
        syncVoice(value, voiceAvail) {
            if (voiceAvail === false) {
                row.setChecked(false);
                row.setEnabled(false);
                row.setDescription("La synthèse vocale n'est pas disponible sur ce navigateur.");
            } else {
                row.setChecked(value);
                row.setEnabled(true);
                row.setDescription(description);
            }
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

function createPaletteOption(palette, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-option';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-label', `${palette.label}. ${palette.description}`);

    const preview = el('div', 'palette-preview');
    const topBar = el('div', 'palette-preview-bar');
    const bottomRow = el('div', 'palette-preview-bottom');
    const card = el('div', 'palette-preview-card');
    const dots = [];
    for (let i = 0; i < 3; i++) {
        const dot = el('span', 'palette-preview-dot');
        dots.push(dot);
        card.appendChild(dot);
    }

    bottomRow.append(card);
    preview.append(topBar, bottomRow);

    const copy = el('div', 'palette-option-copy');
    copy.append(
        el('div', 'palette-option-title', palette.label),
        el('div', 'palette-option-desc', palette.description),
    );

    const radio = el('span', 'duck-radio');
    radio.setAttribute('aria-hidden', 'true');
    radio.appendChild(el('span', 'duck-radio-dot'));

    btn.append(preview, copy, radio);
    btn.addEventListener('click', () => {
        feedback.key();
        onClick(palette.ordinal);
    });

    return {
        ordinal: palette.ordinal,
        el: btn,
        update(dark, selected) {
            const p = palette.colors(dark);
            const base = DuckPalette.SLATE_GOLD.colors(dark);
            const own = [p.greenRole.fill, p.blueRole.fill, p.redRole.fill];
            const baseOwn = [base.greenRole.fill, base.blueRole.fill, base.redRole.fill];
            const diff = own.some((col, idx) => col !== baseOwn[idx]);
            const roleCols = (palette === DuckPalette.SLATE_GOLD || diff)
                ? own
                : [p.goldRole.text, p.surfaceHi, p.outlineStrong];

            btn.classList.toggle('is-selected', Boolean(selected));
            btn.setAttribute('aria-checked', String(Boolean(selected)));
            preview.style.background = p.bg;
            preview.style.borderColor = p.outlineStrong;
            topBar.style.background = p.goldRole.fill;
            card.style.background = p.surface;
            dots.forEach((dot, idx) => {
                dot.style.background = roleCols[idx];
                dot.style.borderColor = p.outline;
            });
            radio.classList.toggle('is-checked', Boolean(selected));
        },
    };
}

function createBoardThemePicker(onSelect) {
    const grid = el('div', 'board-theme-grid');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', "Couleurs de l'échiquier");
    const cards = BoardTheme.entries.map((theme) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'board-theme-card';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', 'false');
        btn.setAttribute('aria-label', theme.label);

        const swatch = el('div', 'board-theme-swatch');
        swatch.setAttribute('aria-hidden', 'true');
        for (let r = 0; r < 2; r++) {
            for (let f = 0; f < 2; f++) {
                const sq = el('span', (r + f) % 2 === 0 ? 'board-theme-sq-light' : 'board-theme-sq-dark');
                sq.style.setProperty('--sq-light', theme.light);
                sq.style.setProperty('--sq-dark', theme.dark);
                swatch.appendChild(sq);
            }
        }
        const labelEl = el('span', 'board-theme-label', theme.label);
        btn.append(swatch, labelEl);
        btn.addEventListener('click', () => {
            feedback.key();
            onSelect(theme.ordinal);
        });
        grid.appendChild(btn);
        return { ordinal: theme.ordinal, el: btn };
    });

    return {
        el: grid,
        sync(currentOrd) {
            for (const c of cards) {
                const selected = c.ordinal === currentOrd;
                c.el.classList.toggle('is-selected', selected);
                c.el.setAttribute('aria-checked', String(selected));
            }
        },
    };
}

export function openSettingsSheet() {
    let closed = false;
    let unsubPrefs = null;
    let unsubAvail = null;
    let mq = null;
    let onMediaChange = null;
    let voiceAvail = narrator.available;
    let pseudo1 = null;
    let pseudo2 = null;

    narrator.prepare();

    const sheet = createSheet('Paramètres', () => {
        closed = true;
        pseudo1?.flush();
        pseudo2?.flush();
        unsubPrefs?.();
        unsubPrefs = null;
        unsubAvail?.();
        unsubAvail = null;
        if (mq && onMediaChange) {
            mq.removeEventListener?.('change', onMediaChange);
        }
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
    const kidNarrationRow = createVoiceSwitchRow({
        title: 'Voix en mode enfant',
        description: "Lit chaque façon de bouger au moment où l'enfant la voit, une seule fois. Rien n'est lu pendant les parties.",
        checked: prefs.current.kidNarration,
        onToggle: (v) => prefs.setKidNarration(v),
    });
    b.append(kidBtn, kidDesc, kidNarrationRow.el);

    // ---- Mode d'affichage ----
    b.appendChild(el('h3', 'sheet-section-title', "Mode d'affichage"));
    const themeWrap = el('div', '');
    const themeSeg = duckSegmentedRow({
        options: ['Système', 'Jour', 'Nuit'],
        selectedIndex: prefs.current.themeMode,
        onSelect: (i) => prefs.setThemeMode(i),
    });
    themeWrap.appendChild(themeSeg);
    b.appendChild(themeWrap);

    // ---- Aides pendant le jeu ----
    b.appendChild(el('h3', 'sheet-section-title', 'Aides pendant le jeu'));
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

    // ---- Audio, voix et retours ----
    b.appendChild(el('h3', 'sheet-section-title', 'Audio, voix et retours'));
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
    const narrationRow = createVoiceSwitchRow({
        title: 'Lecture vocale des leçons',
        description: "L'Académie lit à voix haute les commentaires du mode Guidé.",
        checked: prefs.current.narration,
        onToggle: (v) => prefs.setNarration(v),
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

    // ---- Couleurs de l'application ----
    b.appendChild(el('h3', 'sheet-section-title', "Couleurs de l'application"));
    const paletteIntro = el(
        'p',
        'muted-small mb-6',
        "Chaque palette adapte l'interface, en mode Jour comme en mode Nuit.",
    );
    const paletteList = el('div', 'palette-list');
    paletteList.setAttribute('role', 'radiogroup');
    paletteList.setAttribute('aria-label', "Couleurs de l'application");
    const paletteOptions = DuckPalette.entries.map((entry) =>
        createPaletteOption(entry, (ord) => prefs.setPalette(ord)));
    paletteList.append(...paletteOptions.map((opt) => opt.el));
    b.append(paletteIntro, paletteList);

    // ---- Couleurs de l'échiquier ----
    b.appendChild(el('h3', 'sheet-section-title', "Couleurs de l'échiquier"));
    const boardPicker = createBoardThemePicker((ord) => prefs.setBoardTheme(ord));
    b.appendChild(boardPicker.el);

    // ---- À propos ----
    b.appendChild(el('h3', 'sheet-section-title', 'À propos'));
    const aboutText = el(
        'p',
        'muted-small',
        'ChessDuck fonctionne 100 % hors-ligne. Moteur : Stockfish 19 Lite WASM (GPLv3). Problèmes : base ouverte Lichess (CC0). Pièces : série classique de Cburnett et pièce féerique Girafe, Wikimedia Commons (CC BY-SA 3.0). Icônes : Material Icons (Apache 2.0). Police du mode enfant : Fredoka (OFL).',
    );
    b.appendChild(aboutText);

    // ---- Réinitialisation ----
    b.appendChild(el('h3', 'sheet-section-title', 'Réinitialisation'));
    const resetEloBtn = duckButton({
        label: 'Réinitialiser mon ELO',
        icon: 'Replay',
        variant: 'outlined',
        className: 'full-w',
        enabled: prefs.current.elo !== DEFAULT_ELO,
        onClick: () => {
            openConfirmDialog({
                title: 'Réinitialiser votre ELO ?',
                text: `Votre classement repartira de ${DEFAULT_ELO}. L'historique des parties est conservé.`,
                confirmLabel: 'Réinitialiser',
                onConfirm: () => prefs.setElo(DEFAULT_ELO),
            });
        },
    });
    const copyright = el('p', 'settings-copyright', '© Ivan Herboch, 2026 · v3.3.3');
    b.append(resetEloBtn, copyright);

    function sync(st) {
        if (closed) return;
        updateSegmentedRow(themeSeg, st.themeMode);
        coordsRow.setChecked(st.coords);
        confirmRow.setChecked(st.confirmActions);
        soundRow.setChecked(st.sound);
        hapticsRow.setChecked(st.haptics);

        kidNarrationRow.syncVoice(st.kidNarration, voiceAvail);
        narrationRow.syncVoice(st.narration, voiceAvail);

        pseudo1.syncExternal(st.pseudo);
        pseudo2.syncExternal(st.pseudo2);
        eloInfo.textContent = `Classement actuel : ${st.elo} ELO (formule FIDE, K = 32). Les parties à 2 joueurs ne comptent pas.`;

        const dark = isDarkTheme(st.themeMode);
        const currentPal = DuckPalette.of(st.palette);
        for (const opt of paletteOptions) {
            opt.update(dark, opt.ordinal === currentPal.ordinal);
        }
        boardPicker.sync(BoardTheme.of(st.boardTheme).ordinal);
        resetEloBtn.disabled = st.elo === DEFAULT_ELO;
    }

    unsubPrefs = prefs.subscribe(sync);
    unsubAvail = narrator.subscribeAvailable((avail) => {
        voiceAvail = avail;
        sync(prefs.current);
    });
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        mq = window.matchMedia('(prefers-color-scheme: dark)');
        onMediaChange = () => sync(prefs.current);
        mq.addEventListener?.('change', onMediaChange);
    }
    return sheet;
}
