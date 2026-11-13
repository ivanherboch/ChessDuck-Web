// Module Académie : 113 leçons interactives (Mode Guidé & Mode Défi)
// Port fidèle de Academy.kt et Lessons.kt (ChessDuck v1.6.0)

import { Line } from '../chess.js';
import { COLORS, ChessBoardView, captureBadge, moveAnim, undoAnim } from '../board.js';
import {
  ModuleLayoutView, Tone, el, makeButton, makeChip, makeFeedbackCard, makeSectionTitle, moveLabel, sheets,
} from '../ui.js';

export const LESSON_CATEGORIES = [
  { key: 'OPENING', label: 'Ouvertures', emoji: '🚀' },
  { key: 'MIDDLEGAME', label: 'Milieu de partie', emoji: '⚔️' },
  { key: 'ENDGAME', label: 'Finales', emoji: '🏁' },
];

export const CAT_BY_KEY = Object.fromEntries(LESSON_CATEGORIES.map((c) => [c.key, c]));

export function getLessonLine(lesson) {
  if (!lesson._line) {
    lesson._line = Line.fromMoves(lesson.fen, lesson.sans);
  }
  return lesson._line;
}

export class AcademyModule {
  constructor({ prefs, userDb, feedback, lessons = [] }) {
    this.prefs = prefs;
    this.userDb = userDb;
    this.feedback = feedback;
    this.lessons = lessons;
    this.colors = prefs.get().dark ? COLORS.night : COLORS.day;
    this.active = false;
    this._timer = null;

    this.state = {
      lessonId: prefs.get().lessonId || 1,
      filter: null, // null | 'OPENING' | 'MIDDLEGAME' | 'ENDGAME'
      challenge: false,
      cursor: 0,
      playing: false,
      flipped: false,
      anim: null,
      hintStage: 0,
      message: '',
      tone: Tone.INFO,
      done: false,
    };

    this._buildDom();
    this.userDb.subscribe(() => this.render());

    if (this.lessons.length > 0) {
      this.open(this.state.lessonId, false);
    }
  }

  setLessons(lessons) {
    this.lessons = lessons;
    if (lessons.length > 0) {
      this.open(this.state.lessonId, false);
    }
  }

  get currentLesson() {
    return this.lessons.find((l) => l.id === this.state.lessonId) || this.lessons[0] || null;
  }

  _buildDom() {
    this.layout = new ModuleLayoutView({ bottomMin: 150 });
    this.root = this.layout.root;

    // Bandeau haut : puces catégories + sélecteur leçon + toggle Guidé / Défi
    const filterItems = [
      { key: null, label: 'Tous', weight: 0.7 },
      { key: 'OPENING', label: 'Ouvertures', weight: 1.1 },
      { key: 'MIDDLEGAME', label: 'Milieu de partie', weight: 1.4 },
      { key: 'ENDGAME', label: 'Finales', weight: 0.9 },
    ];
    this.filterChips = filterItems.map((it) => ({
      key: it.key,
      chip: makeChip({
        label: it.label,
        selected: this.state.filter === it.key,
        accent: 'blue',
        weight: it.weight,
        feedback: this.feedback,
        onClick: () => this.setFilter(it.key),
      }),
    }));
    const filterRow = el('div', { className: 'chips-row top-pad' }, this.filterChips.map((x) => x.chip));

    this.selectorTitle = el('div', { className: 'lesson-selector-title' }, 'Chargement des leçons…');
    this.selectorCount = el('div', { className: 'lesson-selector-count' }, '📚 0 / 113 ▾');
    this.selectorBar = el('button', {
      type: 'button',
      className: 'lesson-selector-bar',
      onClick: () => {
        this.feedback?.key();
        this._openCatalogSheet();
      },
    }, this.selectorTitle, this.selectorCount);

    this.guidedBtn = makeButton({
      label: '👁️ Mode Guidé (Démo)',
      accent: 'blue',
      filled: true,
      weight: 1,
      height: 34,
      feedback: this.feedback,
      onClick: () => this.setChallenge(false),
    });
    this.challengeBtn = makeButton({
      label: '🎯 Mode Défi (Pratique)',
      accent: 'gold',
      filled: false,
      weight: 1,
      height: 34,
      feedback: this.feedback,
      onClick: () => this.setChallenge(true),
    });
    const modeRow = el('div', { className: 'equal-row bottom-gap' }, this.guidedBtn, this.challengeBtn);
    this.layout.topEl.append(filterRow, this.selectorBar, modeRow);

    // Échiquier
    this.board = new ChessBoardView(this.layout.boardMount, {
      feedback: this.feedback,
      onMove: (m) => {
        if (this.challengeMove(m)) this.feedback.success();
        else this.feedback.error();
      },
    });
    this.layout.onBoardSize((side) => this.board.resize(side));

    // Bas : commentaire + contrôles
    this.feedbackCard = makeFeedbackCard();

    // Boutons Mode Guidé
    this.btnRewind = makeButton({ label: '⏮', onClick: () => this.rewind(), weight: 0.7, height: 44, className: 'btn-icon', feedback: this.feedback });
    this.btnPrev = makeButton({ label: '◀', onClick: () => this.step(-1), weight: 0.7, height: 44, className: 'btn-icon', feedback: this.feedback });
    this.btnPlay = makeButton({ label: '▶ Lecture', accent: 'blue', filled: true, onClick: () => this.togglePlay(), weight: 1.5, height: 44, feedback: this.feedback });
    this.btnNext = makeButton({ label: '▶', onClick: () => this.step(1), weight: 0.7, height: 44, className: 'btn-icon', feedback: this.feedback });
    this.btnFlipG = makeButton({ label: '⇅ Retourner', onClick: () => this.flip(), weight: 1.3, height: 44, feedback: this.feedback });
    this.guidedControls = el('div', { className: 'equal-row v-pad-5' }, this.btnRewind, this.btnPrev, this.btnPlay, this.btnNext, this.btnFlipG);

    // Boutons Mode Défi
    this.btnRestart = makeButton({ label: '↺ Recommencer', onClick: () => this.restartChallenge(), weight: 1, height: 44, feedback: this.feedback });
    this.btnFlipC = makeButton({ label: '⇅ Retourner', onClick: () => this.flip(), weight: 1, height: 44, feedback: this.feedback });
    this.btnHintOrNext = makeButton({
      label: '💡 Indice 1/2',
      accent: 'green',
      weight: 1.4,
      height: 44,
      feedback: this.feedback,
      onClick: () => {
        if (this.state.done) this.nextLesson();
        else this.hint();
      },
    });
    this.challengeControls = el('div', { className: 'equal-row v-pad-5 hidden' }, this.btnRestart, this.btnFlipC, this.btnHintOrNext);

    this.layout.bottomEl.append(this.feedbackCard, this.guidedControls, this.challengeControls);
    this.render();
  }

  setActive(on) {
    this.active = on;
    if (!on) this.pause();
    if (on) requestAnimationFrame(() => this.layout.measure());
  }

  setColors(colors) {
    this.colors = colors;
    this.render();
  }

  open(id, save = true) {
    clearTimeout(this._timer);
    const l = this.lessons.find((x) => x.id === id) || this.lessons[0];
    if (!l) return;
    this.state.lessonId = l.id;
    this.state.cursor = 0;
    this.state.playing = false;
    this.state.flipped = !l.heroWhite;
    this.state.anim = null;
    this.state.hintStage = 0;
    this.state.done = false;
    if (this.state.filter !== null && this.state.filter !== l.category) {
      this.state.filter = l.category;
    }
    if (save) this.prefs.update({ lessonId: l.id });
    if (this.state.challenge) {
      this._startChallenge();
    } else {
      this.state.message = '';
      this.state.tone = Tone.INFO;
      this.render();
    }
  }

  setFilter(cat) {
    this.state.filter = cat;
    const cur = this.currentLesson;
    if (cat !== null && cur && cur.category !== cat) {
      const first = this.lessons.find((x) => x.category === cat);
      if (first) this.open(first.id);
    } else {
      this.render();
    }
  }

  flip() {
    this.state.flipped = !this.state.flipped;
    this.render();
  }

  setChallenge(on) {
    if (this.state.challenge === on) return;
    clearTimeout(this._timer);
    this.state.challenge = on;
    this.state.cursor = 0;
    this.state.playing = false;
    this.state.anim = null;
    this.state.hintStage = 0;
    this.state.done = false;
    this.state.message = '';
    this.state.tone = Tone.INFO;
    if (on) this._startChallenge();
    else this.render();
  }

  goTo(target) {
    const l = this.currentLesson;
    if (!l) return;
    const line = getLessonLine(l);
    const t = Math.max(0, Math.min(target, line.size));
    if (t === this.state.cursor) return;
    let anim = null;
    if (t === this.state.cursor + 1) anim = moveAnim(line.positions[this.state.cursor], line.moves[this.state.cursor]);
    else if (t === this.state.cursor - 1) anim = undoAnim(line.positions[t], line.moves[t]);
    this.state.cursor = t;
    this.state.anim = anim;
    this.render();
  }

  step(delta) {
    this.pause();
    this.goTo(this.state.cursor + delta);
  }

  rewind() {
    this.pause();
    this.goTo(0);
  }

  pause() {
    clearTimeout(this._timer);
    if (this.state.playing) {
      this.state.playing = false;
      this.render();
    }
  }

  togglePlay() {
    const l = this.currentLesson;
    if (!l) return;
    if (this.state.playing) {
      this.pause();
      return;
    }
    const line = getLessonLine(l);
    if (this.state.cursor >= line.size) this.goTo(0);
    this.state.playing = true;
    this.render();
    const tick = () => {
      if (!this.state.playing) return;
      const delayMs = this.state.cursor === 0 ? 700 : 2600;
      this._timer = setTimeout(() => {
        if (!this.state.playing) return;
        if (this.state.cursor < line.size) {
          this.goTo(this.state.cursor + 1);
          if (this.state.cursor < line.size) tick();
          else {
            this.state.playing = false;
            this.render();
          }
        } else {
          this.state.playing = false;
          this.render();
        }
      }, delayMs);
    };
    tick();
  }

  _heroToMove(cursor) {
    const l = this.currentLesson;
    if (!l) return false;
    const line = getLessonLine(l);
    return cursor < line.size && line.positions[cursor].whiteToMove === l.heroWhite;
  }

  _startChallenge() {
    const l = this.currentLesson;
    if (!l) return;
    const side = l.heroWhite ? 'Blancs' : 'Noirs';
    this.state.cursor = 0;
    this.state.anim = null;
    this.state.hintStage = 0;
    this.state.done = false;
    this.state.tone = Tone.INFO;
    this.state.flipped = !l.heroWhite;
    this.state.message = `🎯 À vous de jouer les coups des ${side} sur l'échiquier. ${l.summary}`;
    this.render();
    this._advanceOpponent();
  }

  restartChallenge() {
    clearTimeout(this._timer);
    this._startChallenge();
  }

  _advanceOpponent() {
    clearTimeout(this._timer);
    const l = this.currentLesson;
    if (!l) return;
    const line = getLessonLine(l);
    const stepNext = () => {
      if (!this.state.challenge) return;
      if (this.state.cursor < line.size && !this._heroToMove(this.state.cursor)) {
        this._timer = setTimeout(() => {
          if (!this.state.challenge || this.currentLesson?.id !== l.id) return;
          const cur = this.state.cursor;
          this.state.cursor = cur + 1;
          this.state.anim = moveAnim(line.positions[cur], line.moves[cur]);
          this.state.hintStage = 0;
          this.render();
          stepNext();
        }, 650);
      } else if (this.state.cursor >= line.size) {
        this.userDb.markLessonMastered(l.id);
        this.state.done = true;
        this.state.tone = Tone.GOOD;
        this.state.message = `✅ Maîtrisée ! Vous avez joué tous les coups clés de « ${l.title} ».`;
        this.render();
      }
    };
    stepNext();
  }

  challengeMove(m) {
    const s = this.state;
    const l = this.currentLesson;
    if (!l || !s.challenge || s.done || !this._heroToMove(s.cursor)) return false;
    const line = getLessonLine(l);
    const expected = line.moves[s.cursor];
    if (m.equals(expected)) {
      const idx = s.cursor;
      s.cursor = idx + 1;
      s.anim = moveAnim(line.positions[idx], m);
      s.hintStage = 0;
      s.tone = Tone.GOOD;
      s.message = `✅ ${line.sans[idx]} — ${l.texts[idx]}`;
      this.render();
      this._advanceOpponent();
      return true;
    }
    const played = line.positions[s.cursor].san(m);
    s.tone = Tone.BAD;
    s.message = `❌ ${played} n'est pas le coup de la leçon. Réfléchissez à l'idée du thème, ou demandez un 💡 indice.`;
    this.render();
    return false;
  }

  hint() {
    const s = this.state;
    if (!s.challenge || s.done || !this._heroToMove(s.cursor)) return;
    const stage = Math.min(2, s.hintStage + 1);
    s.hintStage = stage;
    s.tone = Tone.GOLD;
    s.message = stage === 1
      ? '💡 Indice 1/2 : la pièce à jouer est surlignée en vert.'
      : '💡 Indice 2/2 : suivez la flèche.';
    this.render();
  }

  nextLesson() {
    if (this.lessons.length === 0) return;
    const pool = this.state.filter ? this.lessons.filter((l) => l.category === this.state.filter) : this.lessons;
    const idx = pool.findIndex((l) => l.id === this.state.lessonId);
    const next = pool[(idx + 1) % pool.length];
    if (next) this.open(next.id);
  }

  _openCatalogSheet() {
    const l = this.currentLesson;
    if (!l) return;
    const total = this.lessons.length;
    const mastered = this.userDb.masteredLessons;
    let catKey = this.state.filter || l.category;

    sheets.open({
      title: `📚 Catalogue — ${mastered.size} / ${total} maîtrisées`,
      onBuild: (body, modal) => {
        const listWrap = el('div', { className: 'sheet-list' });
        const catRow = el('div', { className: 'chips-row' });

        const renderList = () => {
          const catInfo = CAT_BY_KEY[catKey];
          listWrap.innerHTML = '';
          listWrap.appendChild(makeSectionTitle(`${catInfo.emoji} ${catInfo.label.toUpperCase()} — toutes les leçons sont en accès libre`));
          for (const item of this.lessons.filter((x) => x.category === catKey)) {
            const current = item.id === this.state.lessonId;
            const done = mastered.has(item.id);
            const row = el('button', {
              type: 'button',
              className: `catalog-lesson-row ${current ? 'is-current' : ''}`,
              onClick: () => {
                this.feedback?.key();
                this.open(item.id);
                modal.close();
              },
            },
            el('div', { className: 'catalog-lesson-num' }, done ? '✅' : String(item.id)),
            el('div', { className: 'catalog-lesson-info' },
              el('div', { className: 'catalog-lesson-title' }, item.title),
              el('div', { className: 'catalog-lesson-sub' }, item.summary),
            ));
            listWrap.appendChild(row);
          }
        };

        for (const k of LESSON_CATEGORIES) {
          const allIn = this.lessons.filter((x) => x.category === k.key);
          const doneCount = allIn.filter((x) => mastered.has(x.id)).length;
          const chip = makeChip({
            label: `${k.label} ${doneCount}/${allIn.length}`,
            selected: catKey === k.key,
            accent: 'blue',
            weight: 1,
            feedback: this.feedback,
            onClick: () => {
              catKey = k.key;
              catRow.querySelectorAll('.duck-chip').forEach((cEl, idx) => {
                cEl.classList.toggle('is-selected', LESSON_CATEGORIES[idx].key === catKey);
              });
              renderList();
            },
          });
          catRow.appendChild(chip);
        }

        body.append(catRow, listWrap);
        renderList();
      },
    });
  }

  render() {
    const s = this.state;
    const c = this.colors;
    const l = this.currentLesson;
    const mastered = this.userDb.masteredLessons;

    this.filterChips.forEach((x) => x.chip.setSelected(x.key === s.filter));
    this.guidedBtn.setConfig({ filled: !s.challenge });
    this.challengeBtn.setConfig({ filled: s.challenge });
    this.guidedControls.classList.toggle('hidden', s.challenge);
    this.challengeControls.classList.toggle('hidden', !s.challenge);

    if (!l) return;
    const cat = CAT_BY_KEY[l.category];
    this.selectorTitle.textContent = `${mastered.has(l.id) ? '✅' : cat.emoji} ${l.id}. ${l.title}`;
    this.selectorCount.textContent = `📚 ${mastered.size} / ${this.lessons.length} ▾`;

    const line = getLessonLine(l);
    const cur = Math.max(0, Math.min(s.cursor, line.size));
    const pos = line.positions[cur];
    const last = cur > 0 ? line.moves[cur - 1] : null;
    const heroTurn = s.challenge && !s.done && cur < line.size && pos.whiteToMove === l.heroWhite;
    const nextMove = cur < line.size ? line.moves[cur] : null;

    let arrows = [];
    if (heroTurn && s.hintStage >= 2 && nextMove) arrows = [{ from: nextMove.from, to: nextMove.to, color: c.green }];
    else if (!s.challenge && last) arrows = [{ from: last.from, to: last.to, color: c.blue }];

    const marks = heroTurn && s.hintStage >= 1 && nextMove ? [[nextMove.from, c.green]] : [];
    const badges = last ? [captureBadge(line.positions[cur - 1], last)].filter(Boolean) : [];

    this.board.setState({
      position: pos,
      colors: c,
      flipped: s.flipped,
      interactive: heroTurn,
      lastMove: last,
      anim: s.anim,
      arrows,
      marks,
      badges,
    });

    if (!s.challenge) {
      const title = cur === 0
        ? 'Objectif de la leçon'
        : `${moveLabel(line.positions[cur - 1].fullmove, line.positions[cur - 1].whiteToMove, line.sans[cur - 1])}   (${cur} / ${line.size})`;
      const text = cur === 0
        ? `${l.summary} Appuyez sur ▶ Lecture pour dérouler la leçon coup par coup.`
        : l.texts[cur - 1];
      this.feedbackCard.setState(text, Tone.INFO, title);

      this.btnRewind.setConfig({ enabled: cur > 0 });
      this.btnPrev.setConfig({ enabled: cur > 0 });
      this.btnPlay.setConfig({ label: s.playing ? '⏸ Pause' : '▶ Lecture' });
      this.btnNext.setConfig({ enabled: cur < line.size });
    } else {
      const title = s.done ? 'Défi réussi' : `Défi : jouez les ${l.heroWhite ? 'Blancs' : 'Noirs'}`;
      this.feedbackCard.setState(s.message, s.tone, title);
      if (s.done) {
        this.btnHintOrNext.setConfig({ label: 'Leçon suivante →', accent: 'green', filled: true, enabled: true });
      } else {
        this.btnHintOrNext.setConfig({ label: `💡 Indice ${Math.min(2, s.hintStage + 1)}/2`, accent: 'green', filled: false, enabled: heroTurn });
      }
    }
  }
}
