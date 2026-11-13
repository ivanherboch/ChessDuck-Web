// Point d'entrée de ChessDuck Web (port fidèle de ChessNote / ChessDuck v1.6.0)
// Navigation par 4 modules, barre/rail adaptatif iPhone & tablette, Mode Enfant et Paramètres globaux.

import { COLORS, preloadAssets } from './board.js';
import { PrefsStore, PuzzleCatalog, UserDatabase } from './db.js';
import { StockfishEngine } from './engine.js';
import { FeedbackManager } from './feedback.js';
import { AcademyModule } from './features/academy.js';
import { KidModule } from './features/kid.js';
import { NotationModule, openMemoSheet } from './features/notation.js';
import { PlayModule } from './features/play.js';
import { PuzzlesModule } from './features/puzzles.js';
import { el, makeButton, makeChip, makeSectionTitle, sheets } from './ui.js';

const TABS = [
  { emoji: '⌨️', label: 'Notation' },
  { emoji: '🎓', label: 'Académie' },
  { emoji: '🧩', label: 'Problèmes' },
  { emoji: '⚔️', label: 'Jeu Libre' },
];

class ChessDuckApp {
  constructor() {
    this.prefs = new PrefsStore();
    this.userDb = new UserDatabase();
    this.catalog = new PuzzleCatalog(this.userDb);
    this.engine = new StockfishEngine();
    this.feedback = new FeedbackManager();

    this.activeTab = 0;
    this._wasKid = this.prefs.get().kidMode;

    this._applyTheme();
    this._syncFeedbackPrefs();
    preloadAssets();
    this.feedback.preload();

    this._buildShell();
    this._initModules();

    this.prefs.subscribe(() => {
      this._applyTheme();
      this._syncFeedbackPrefs();
      this._syncHeaderAndMode();
    });

    this.userDb.init().catch(() => {});
    fetch('assets/data/lessons.json')
      .then((r) => r.json())
      .then((lessons) => this.academy.setLessons(lessons))
      .catch(() => {});

    // Préchauffage silencieux de Stockfish WASM en tâche de fond après premier rendu
    setTimeout(() => this.engine.warmup(), 600);
    this._registerSw();
  }

  _registerSw() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  _syncFeedbackPrefs() {
    const st = this.prefs.get();
    this.feedback.hapticsEnabled = !!st.haptics;
    this.feedback.soundEnabled = !!st.sound;
  }

  _applyTheme() {
    const st = this.prefs.get();
    const kid = !!st.kidMode;
    const dark = !!st.dark && !kid;
    const theme = kid ? 'kid' : dark ? 'night' : 'day';
    document.body.classList.remove('theme-night', 'theme-day', 'theme-kid');
    document.body.classList.add(`theme-${theme}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', kid ? '#EBF6FF' : dark ? '#0F172A' : '#F8FAFC');
    }
    const colors = COLORS[theme];
    if (this.modules) {
      for (const m of this.modules) m.setColors?.(colors);
    }
  }

  _buildShell() {
    this.appEl = document.getElementById('app');
    this.shellEl = el('div', { className: 'app-shell' });
    this.kidHostEl = el('div', { className: 'kid-host hidden' });

    // Header
    this.mascotImg = el('img', { className: 'header-mascot', src: 'assets/mascot.png', alt: 'Mascotte Cavalier-Canard' });
    this.titleText = el('h1', { className: 'header-title' }, 'ChessDuck');
    this.copyText = el('div', { className: 'header-copy hidden' }, '© Ivan Herboch, 2026');
    this.eloBadge = el('div', { className: 'header-elo-badge' }, `ELO ${this.prefs.get().elo}`);
    const headBrand = el('div', { className: 'header-brand' },
      this.mascotImg,
      el('div', { className: 'header-titles' }, this.titleText, this.copyText),
      this.eloBadge,
    );

    this.memoBtn = makeButton({
      label: '📖 Mémo Anglais',
      accent: 'blue',
      height: 36,
      weight: 0,
      className: 'memo-header-btn',
      feedback: this.feedback,
      onClick: () => openMemoSheet(this.feedback),
    });
    this.memoBtn.style.flexBasis = 'auto';

    this.settingsBtn = makeButton({
      label: '⚙️',
      height: 36,
      weight: 0,
      className: 'settings-header-btn',
      feedback: this.feedback,
      onClick: () => this._openSettingsSheet(),
    });
    this.settingsBtn.style.flexBasis = 'auto';

    this.headerEl = el('header', { className: 'app-header' }, headBrand, this.memoBtn, this.settingsBtn);

    // Zone centrale des 4 modules
    this.contentHost = el('main', { className: 'app-content' });

    // Barre de navigation (bas en portrait, rail gauche en paysage)
    this.navButtons = TABS.map((t, i) => {
      const btn = el('button', {
        type: 'button',
        className: `nav-tab ${i === 0 ? 'is-selected' : ''}`,
        onClick: () => {
          this.feedback?.key();
          this.setTab(i);
        },
      },
      el('span', { className: 'nav-tab-emoji' }, t.emoji),
      el('span', { className: 'nav-tab-label' }, t.label));
      return btn;
    });
    this.navEl = el('nav', { className: 'app-nav', 'aria-label': 'Modules ChessDuck' }, this.navButtons);

    this.mainColEl = el('div', { className: 'app-main-col' }, this.headerEl, this.contentHost);
    this.shellEl.append(this.mainColEl, this.navEl);

    this.modalRoot = el('div', { id: 'modal-root' });
    this.appEl.append(this.shellEl, this.kidHostEl, this.modalRoot);

    const updateOrientation = () => {
      const w = this.appEl.clientWidth;
      const h = this.appEl.clientHeight;
      if (w <= 0 || h <= 0) return;
      const landscape = w > h * 1.15;
      if (landscape) {
        if (this.navEl.nextSibling !== this.mainColEl) {
          this.shellEl.insertBefore(this.navEl, this.mainColEl);
        }
        this.shellEl.classList.add('is-landscape');
      } else {
        if (this.mainColEl.nextSibling !== this.navEl) {
          this.shellEl.appendChild(this.navEl);
        }
        this.shellEl.classList.remove('is-landscape');
      }
    };
    new ResizeObserver(updateOrientation).observe(this.appEl);
    updateOrientation();
  }

  _initModules() {
    this.notation = new NotationModule({ prefs: this.prefs, catalog: this.catalog, feedback: this.feedback });
    this.academy = new AcademyModule({ prefs: this.prefs, userDb: this.userDb, feedback: this.feedback });
    this.puzzles = new PuzzlesModule({ prefs: this.prefs, userDb: this.userDb, catalog: this.catalog, engine: this.engine, feedback: this.feedback });
    this.play = new PlayModule({ prefs: this.prefs, userDb: this.userDb, engine: this.engine, feedback: this.feedback });
    this.kid = new KidModule({
      feedback: this.feedback,
      onExit: () => this.prefs.update({ kidMode: false }),
    });

    this.modules = [this.notation, this.academy, this.puzzles, this.play];
    for (const m of this.modules) {
      m.root.classList.add('module-pane');
      this.contentHost.appendChild(m.root);
    }
    this.kidHostEl.appendChild(this.kid.root);

    this.setTab(0);
    this._syncHeaderAndMode();
  }

  setTab(idx) {
    this.activeTab = idx;
    this.modules.forEach((m, i) => {
      const on = i === idx;
      m.root.classList.toggle('hidden', !on);
      m.setActive(on);
    });
    this.navButtons.forEach((b, i) => b.classList.toggle('is-selected', i === idx));
    this.memoBtn.classList.toggle('hidden', idx !== 0);
    this.copyText.classList.toggle('hidden', idx === 0);
  }

  _syncHeaderAndMode() {
    const st = this.prefs.get();
    this.eloBadge.textContent = `ELO ${st.elo}`;

    const kid = !!st.kidMode;
    if (this._wasKid && !kid) {
      this.kid.reset();
    }
    this._wasKid = kid;

    this.shellEl.classList.toggle('hidden', kid);
    this.kidHostEl.classList.toggle('hidden', !kid);
    this.kid.setActive(kid);
    if (kid) {
      for (const m of this.modules) m.setActive(false);
    } else {
      this.setTab(this.activeTab);
    }
  }

  _openSettingsSheet() {
    const st = this.prefs.get();
    sheets.open({
      title: '⚙️ Paramètres',
      onBuild: (body, modal) => {
        const darkRow = el('div', { className: 'chips-row' });
        const nightChip = makeChip({ label: '🌙 Mode Nuit (sombre)', selected: st.dark, feedback: this.feedback, onClick: () => this.prefs.update({ dark: true }) });
        const dayChip = makeChip({ label: '☀️ Mode Jour (clair)', selected: !st.dark, feedback: this.feedback, onClick: () => this.prefs.update({ dark: false }) });
        darkRow.append(nightChip, dayChip);

        const soundRow = el('div', { className: 'chips-row' });
        const soundOn = makeChip({ label: '🔉 Son activé', selected: st.sound, feedback: this.feedback, onClick: () => this.prefs.update({ sound: true }) });
        const soundOff = makeChip({ label: '🔇 Son désactivé', selected: !st.sound, feedback: this.feedback, onClick: () => this.prefs.update({ sound: false }) });
        soundRow.append(soundOn, soundOff);

        const hapRow = el('div', { className: 'chips-row' });
        const hapOn = makeChip({ label: '📳 Vibration activée', selected: st.haptics, feedback: this.feedback, onClick: () => this.prefs.update({ haptics: true }) });
        const hapOff = makeChip({ label: '🔕 Vibration désactivée', selected: !st.haptics, feedback: this.feedback, onClick: () => this.prefs.update({ haptics: false }) });
        hapRow.append(hapOn, hapOff);

        const kidBtn = makeButton({
          label: '🧒 Activer le mode enfant',
          accent: 'green',
          filled: true,
          height: 44,
          weight: 1,
          className: 'full-btn',
          feedback: this.feedback,
          onClick: () => {
            modal.close();
            this.prefs.update({ kidMode: true });
          },
        });
        const kidDesc = el('div', { className: 'settings-muted top-gap-sm' },
          'Un écran joyeux et coloré pour jouer à deux avec un enfant : grand échiquier, cavalier en forme de girafe, animations qui montrent comment chaque pièce bouge, sans ordinateur ni historique.');

        const p1Input = el('input', {
          type: 'text',
          className: 'duck-input',
          maxlength: '16',
          value: st.pseudo,
          placeholder: 'Joueur',
          onInput: (e) => {
            const v = e.target.value.slice(0, 16);
            this.prefs.update({ pseudo: v.trim() || 'Joueur' });
          },
        });

        const p2Input = el('input', {
          type: 'text',
          className: 'duck-input',
          maxlength: '16',
          value: st.pseudo2,
          placeholder: 'Joueur 2',
          onInput: (e) => {
            const v = e.target.value.slice(0, 16);
            this.prefs.update({ pseudo2: v.trim() || 'Joueur 2' });
          },
        });

        const eloNote = el('div', { className: 'settings-elo-note' },
          `Votre classement actuel : ${st.elo} ELO (formule FIDE, K = 32). Les parties à 2 joueurs ne comptent pas.`);

        const aboutText = el('div', { className: 'settings-muted' },
          'ChessDuck fonctionne 100 % hors-ligne après installation. Moteur : Stockfish 19 WASM (GPLv3). Base : ChessNote v1.6.0 · 50 000 problèmes Lichess (CC0). Pièces : série classique de Cburnett et pièce féerique Girafe, Wikimedia Commons (CC BY-SA 3.0). Police du mode enfant : Fredoka (OFL).');

        const footer = el('div', { className: 'settings-footer' }, '© Ivan Herboch, 2026 · v1.6.0-web');

        body.append(
          makeSectionTitle('APPARENCE'), darkRow,
          makeSectionTitle('BRUIT DES PIÈCES'), soundRow,
          makeSectionTitle('RETOUR HAPTIQUE'), hapRow,
          makeSectionTitle('MODE ENFANT'), kidBtn, kidDesc,
          makeSectionTitle('PSEUDO DU JOUEUR'), p1Input,
          makeSectionTitle('PSEUDO DU JOUEUR 2 (MODE 2 JOUEURS)'), p2Input,
          eloNote,
          makeSectionTitle('À PROPOS'), aboutText,
          footer,
        );

        const unsub = this.prefs.subscribe((next) => {
          if (!document.body.contains(body)) { unsub(); return; }
          nightChip.setSelected(next.dark);
          dayChip.setSelected(!next.dark);
          soundOn.setSelected(next.sound);
          soundOff.setSelected(!next.sound);
          hapOn.setSelected(next.haptics);
          hapOff.setSelected(!next.haptics);
          eloNote.textContent = `Votre classement actuel : ${next.elo} ELO (formule FIDE, K = 32). Les parties à 2 joueurs ne comptent pas.`;
        });
      },
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__chessDuck = new ChessDuckApp();
});
