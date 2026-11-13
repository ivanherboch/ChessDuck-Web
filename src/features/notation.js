// Module Notation : transcription de coups en notation anglaise FIDE avec clavier virtuel et diagnostic pédagogique
// Port fidèle de Notation.kt (ChessDuck v1.6.0)

import {
  KING, KNIGHT, Line, PAWN, PIECE_NAMES_EN, PIECE_NAMES_FR, Position,
  pieceLetter, pieceType, sqName,
} from '../chess.js';
import { COLORS, ChessBoardView, captureBadge, moveAnim } from '../board.js';
import {
  ModuleLayoutView, Tone, el, makeButton, makeChip, makeFeedbackCard, makeSectionTitle, sheets,
} from '../ui.js';

export const NotationLogic = {
  LEVELS: ['Tous', '1. Bases', '2. Prises & Échecs', '3. Roques & Avancé'],

  /** Niveau pédagogique d'un coup : 1 = bases, 2 = prises & échecs, 3 = roques & avancé. */
  levelOf(p, m, san) {
    const body = san.replace(/[+#]+$/, '');
    const disamb = pieceType(p.at(m.from)) !== PAWN && !p.isCastle(m) && body.replace(/x/g, '').length > 3;
    if (p.isCastle(m) || m.promo !== 0 || san.endsWith('#') || p.isEnPassant(m) || disamb) return 3;
    if (p.isCapture(m) || san.endsWith('+')) return 2;
    return 1;
  },

  /** Sous-familles du niveau 3 : 1 roque, 2 promotion, 3 mat, 4 désambiguïsation. */
  isKind(p, m, san, kind) {
    switch (kind) {
      case 1: return p.isCastle(m);
      case 2: return m.promo !== 0;
      case 3: return san.endsWith('#');
      case 4: return pieceType(p.at(m.from)) !== PAWN && !p.isCastle(m) && san.replace(/[+#]+$/, '').replace(/x/g, '').length > 3;
      default: return true;
    }
  },

  /** Choisit dans [positions] un coup légal du niveau demandé (0 = n'importe lequel). */
  pick(positions, level, wantKind = 0) {
    const shuffled = positions.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const pool = [];
    for (const p of shuffled) {
      if (p.legalMoves.length === 0) continue;
      for (const m of p.legalMoves) {
        const san = p.san(m);
        const lv = this.levelOf(p, m, san);
        if (level !== 0 && lv !== level) continue;
        if (wantKind !== 0 && !this.isKind(p, m, san, wantKind)) continue;
        pool.push({ before: p, move: m, san, level: lv });
      }
      if (pool.length >= 12) break;
    }
    if (pool.length === 0) return null;
    // Varie les types de pièces plutôt que de favoriser celles qui ont le plus de coups.
    const byType = new Map();
    for (const ex of pool) {
      const pt = pieceType(ex.before.at(ex.move.from));
      if (!byType.has(pt)) byType.set(pt, []);
      byType.get(pt).push(ex);
    }
    const buckets = [...byType.values()];
    const chosenBucket = buckets[Math.floor(Math.random() * buckets.length)];
    return chosenBucket[Math.floor(Math.random() * chosenBucket.length)];
  },

  _nameOf(type) {
    return `${PIECE_NAMES_FR[type]} (${PIECE_NAMES_EN[type]})`;
  },

  /** Diagnostic pédagogique d'une réponse fausse, sans donner la solution. */
  diagnose(input, ex) {
    const san = ex.san;
    const p = ex.before;
    const m = ex.move;
    const type = pieceType(p.at(m.from));
    const castle = p.isCastle(m);
    if (!input) return "Écrivez d'abord le coup avec le clavier ci-dessous.";
    if (input.startsWith('P')) return 'Les pions n\'ont pas de lettre : on écrit « e4 », jamais « Pe4 ».';
    if (castle) {
      return input.startsWith('O-O')
        ? 'Attention au côté : O-O = petit roque (côté roi), O-O-O = grand roque (côté dame).'
        : 'Le roi se déplace de deux cases : c\'est un roque. Il se note O-O (petit) ou O-O-O (grand).';
    }
    if (input.startsWith('O')) return "Ce coup n'est pas un roque : commencez par la lettre de la pièce (rien pour un pion).";

    const inBody = input.replace(/[+#]+$/, '');
    const sanBody = san.replace(/[+#]+$/, '');
    const inSuffix = input.slice(inBody.length);
    const sanSuffix = san.slice(sanBody.length);
    if (inBody === sanBody) {
      if (sanSuffix === '#' && inSuffix === '+') return "C'est plus qu'un échec : le roi n'a aucune parade. L'échec et mat se note « # ».";
      if (sanSuffix === '#') return 'Ce coup donne échec et mat : terminez par « # ».';
      if (sanSuffix === '+' && inSuffix === '#') return 'Le roi peut encore parer : c\'est un simple échec, noté « + ».';
      if (sanSuffix === '+') return 'Ce coup donne échec au roi : ajoutez « + » à la fin.';
      return `Ce coup ne donne pas échec : retirez le « ${inSuffix} » final.`;
    }

    const first = input[0];
    if (type === KNIGHT && first === 'K') return 'N = Knight (Cavalier). La lettre K est réservée au King (Roi).';
    if (type === KING && first === 'N') return 'K = King (Roi). La lettre N désigne le Knight (Cavalier).';
    if (type === PAWN && first >= 'A' && first <= 'Z') return "C'est un pion qui joue : aucune lettre de pièce, on commence par la colonne.";
    if (type !== PAWN && first !== pieceLetter(type)) {
      return `La pièce jouée est un(e) ${this._nameOf(type)} : sa lettre est « ${pieceLetter(type)} ».`;
    }

    const capture = p.isCapture(m);
    if (capture && !inBody.includes('x')) {
      return type === PAWN
        ? "Le pion capture : colonne de départ, puis « x », puis la case d'arrivée (comme « exd5 »)."
        : "C'est une prise : ajoutez « x » juste avant la case d'arrivée.";
    }
    if (!capture && inBody.includes('x')) return 'Aucune pièce n\'est capturée : pas de « x » dans ce coup.';
    if (m.promo !== 0) {
      if (!inBody.includes('=')) return 'Le pion atteint la dernière rangée : indiquez la promotion avec « = » et la pièce (ex. « =Q »).';
      if (inBody.split('=').slice(1).join('=') !== sanBody.split('=').slice(1).join('=')) {
        return "Regardez bien la pièce apparue : la lettre après « = » n'est pas la bonne.";
      }
    } else if (inBody.includes('=')) {
      return 'Pas de promotion ici : le « = » ne sert que lorsqu\'un pion atteint la dernière rangée.';
    }

    const dest = sqName(m.to);
    if (!inBody.includes(dest)) {
      return "La case d'arrivée est inexacte : repérez la colonne (a–h) puis la rangée (1–8) de la case où la pièce se pose.";
    }
    if (type === PAWN && capture && inBody[0] !== sanBody[0]) {
      return 'Pour une prise de pion, on commence par la colonne de départ du pion.';
    }
    if (type !== PAWN) {
      const inCore = inBody.replace(/x/g, '');
      const sanCore = sanBody.replace(/x/g, '');
      if (sanCore.length > 3 && inCore.length === 3) {
        return `Deux ${PIECE_NAMES_FR[type].toLowerCase()}s peuvent aller sur ${dest} : précisez la colonne (ou la rangée) de départ, comme dans « Rad1 ».`;
      }
      if (sanCore.length === 3 && inCore.length > 3) {
        return 'Une seule pièce peut jouer ce coup : inutile de préciser sa case de départ.';
      }
      if (sanCore.length > 3) {
        return 'La précision de départ est inexacte : indiquez la colonne de la pièce qui joue (ou sa rangée si les colonnes sont identiques).';
      }
    }
    return "Presque ! Ordre à respecter : pièce, (départ), (x), case d'arrivée, (=promotion), (+ ou #).";
  },

  hint(ex, stage) {
    const p = ex.before;
    const m = ex.move;
    const type = pieceType(p.at(m.from));
    if (stage >= 2) return `Solution : ${ex.san} — recopiez-la pour la mémoriser.`;
    const parts = [];
    if (p.isCastle(m)) parts.push("Le roi et la tour bougent ensemble : c'est un roque (O-O ou O-O-O).");
    else if (type === PAWN) parts.push('Un pion joue : pas de lettre de pièce.');
    else parts.push(`Pièce : ${this._nameOf(type)} → lettre « ${pieceLetter(type)} ».`);
    if (p.isCapture(m)) parts.push('C\'est une prise (x).');
    if (m.promo !== 0) parts.push('Il y a promotion (=).');
    if (ex.san.endsWith('#')) parts.push('Le coup fait mat (#).');
    else if (ex.san.endsWith('+')) parts.push('Le coup donne échec (+).');
    return parts.join(' ');
  },

  FALLBACK: [
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
    'r3k2r/ppp2ppp/2n1bn2/3qp3/8/2NP1N2/PPP1BPPP/R2Q1RK1 b kq - 0 9',
    '8/4P1k1/8/8/8/8/1p4K1/8 w - - 0 1',
    '3r2k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1',
  ],
};

export function openMemoSheet(feedback) {
  feedback?.key();
  sheets.open({
    title: '📖 Mémo Anglais — notation FIDE',
    onBuild: (body) => {
      const pieces = [
        ['K', 'King → Roi'],
        ['Q', 'Queen → Dame'],
        ['R', 'Rook → Tour'],
        ['B', 'Bishop → Fou'],
        ['N', 'Knight → Cavalier'],
        ['—', 'Pawn → Pion : aucune lettre'],
      ];
      body.appendChild(makeSectionTitle('LES PIÈCES'));
      for (const [k, txt] of pieces) {
        body.appendChild(
          el('div', { className: 'memo-row' },
            el('div', { className: 'memo-key' }, k),
            el('div', { className: 'memo-text' }, txt),
          ),
        );
      }
      body.appendChild(makeSectionTitle('LES SYMBOLES'));
      const symbols = [
        ['x', 'Prise (capture) : Bxf7, exd5'],
        ['+', 'Échec au roi : Qh5+'],
        ['#', 'Échec et mat : Qxf7#'],
        ['=', 'Promotion du pion : e8=Q'],
        ['O-O', 'Petit roque (côté roi)'],
        ['O-O-O', 'Grand roque (côté dame)'],
      ];
      for (const [k, txt] of symbols) {
        body.appendChild(
          el('div', { className: 'memo-row' },
            el('div', { className: 'memo-key' }, k),
            el('div', { className: 'memo-text' }, txt),
          ),
        );
      }
      body.appendChild(makeSectionTitle("LES RÈGLES D'OR"));
      const rules = [
        "Un coup = lettre de la pièce + case d'arrivée : Nf3.",
        "Un pion ne prend jamais de lettre : e4. S'il capture, on indique sa colonne de départ : exd5.",
        'N comme kNight : le K est réservé au roi (King).',
        'Si deux pièces identiques peuvent aller sur la même case, on précise la colonne de départ (Rad1), sinon la rangée (N5f3).',
        "L'ordre est toujours : pièce, départ éventuel, x, case d'arrivée, =promotion, + ou #.",
      ];
      for (const r of rules) {
        body.appendChild(
          el('div', { className: 'memo-rule' },
            el('span', { className: 'memo-bullet' }, '• '),
            el('span', null, r),
          ),
        );
      }
    },
  });
}

export class NotationModule {
  constructor({ prefs, catalog, feedback }) {
    this.prefs = prefs;
    this.catalog = catalog;
    this.feedback = feedback;
    this.colors = prefs.get().dark ? COLORS.night : COLORS.day;
    this.active = false;
    this._timer = null;

    this.state = {
      level: prefs.get().notationLevel || 0,
      exercise: null,
      shown: false,
      anim: null,
      flipped: false,
      input: '',
      message: "Observez le coup joué sur l'échiquier, puis écrivez-le en notation anglaise FIDE.",
      tone: Tone.INFO,
      solved: false,
      hintStage: 0,
      streak: 0,
    };

    this._buildDom();
    this.next();
  }

  _buildDom() {
    this.layout = new ModuleLayoutView({ bottomMin: 248 });
    this.root = this.layout.root;

    // Bandeau haut : boutons d'action + puces de niveau
    const flipBtn = makeButton({ label: '⇅ Retourner', onClick: () => this.flip(), weight: 1.06, height: 36, feedback: this.feedback });
    const replayBtn = makeButton({ label: '🔄 Revoir le coup', onClick: () => this.replay(), weight: 1.48, height: 36, feedback: this.feedback });
    const hintBtn = makeButton({ label: '💡 Indice', onClick: () => this.hint(), accent: 'green', weight: 0.84, height: 36, feedback: this.feedback });
    const newBtn = makeButton({ label: '🎲 Nouveau', onClick: () => this.next(), accent: 'gold', weight: 1.0, height: 36, feedback: this.feedback });
    this.topActions = el('div', { className: 'equal-row top-pad' }, flipBtn, replayBtn, hintBtn, newBtn);

    const chipWeights = [0.44, 0.72, 1.38, 1.46];
    this.levelChips = NotationLogic.LEVELS.map((label, i) =>
      makeChip({
        label,
        selected: this.state.level === i,
        accent: 'blue',
        weight: chipWeights[i],
        feedback: this.feedback,
        onClick: () => this.setLevel(i),
      }),
    );
    this.levelRow = el('div', { className: 'chips-row' }, this.levelChips);
    this.layout.topEl.append(this.topActions, this.levelRow);

    // Échiquier
    this.board = new ChessBoardView(this.layout.boardMount, { feedback: this.feedback });
    this.layout.onBoardSize((side) => this.board.resize(side));

    // Bas : bandeau pédagogique + ligne de saisie + clavier FIDE
    this.feedbackCard = makeFeedbackCard();
    this.inputDisplay = el('div', { className: 'notation-input-box is-empty' }, 'Votre réponse…');
    this.bkBtn = makeButton({ label: '⌫', onClick: () => this.backspace(), weight: 0.5, height: 40, feedback: this.feedback, className: 'key-sym' });
    this.clrBtn = makeButton({ label: '✕', onClick: () => this.clear(), weight: 0.5, height: 40, feedback: this.feedback, className: 'key-sym' });
    this.actionBtn = makeButton({
      label: 'Valider',
      accent: 'gold',
      filled: true,
      weight: 1.1,
      height: 40,
      feedback: this.feedback,
      onClick: () => {
        if (this.state.solved) {
          this.next();
        } else {
          if (this.validate()) this.feedback.success();
          else this.feedback.error();
        }
      },
    });
    const inputRow = el('div', { className: 'notation-input-row' }, this.inputDisplay, this.bkBtn, this.clrBtn, this.actionBtn);

    const makeKey = (label, sub = null, weight = 1) => {
      const btn = el('button', {
        type: 'button',
        className: 'fide-key',
        style: { flexGrow: String(weight), flexBasis: '0' },
        onClick: () => {
          this.feedback?.key();
          this.type(label);
        },
      }, el('span', { className: 'fide-key-main' }, label));
      if (sub) btn.appendChild(el('span', { className: 'fide-key-sub' }, sub));
      return btn;
    };

    const row1 = el('div', { className: 'fide-row fide-row-pieces' },
      makeKey('K', 'King'), makeKey('Q', 'Queen'), makeKey('R', 'Rook'), makeKey('B', 'Bishop'), makeKey('N', 'Knight'),
    );
    const row2 = el('div', { className: 'fide-row' },
      ...'abcdefgh'.split('').map((ch) => makeKey(ch)),
    );
    const row3 = el('div', { className: 'fide-row' },
      ...'12345678'.split('').map((ch) => makeKey(ch)),
    );
    const row4 = el('div', { className: 'fide-row' },
      makeKey('x'), makeKey('+'), makeKey('#'), makeKey('='), makeKey('O-O', null, 1.4), makeKey('O-O-O', null, 1.8),
    );
    const kb = el('div', { className: 'fide-keyboard' }, row1, row2, row3, row4);

    this.layout.bottomEl.append(this.feedbackCard, inputRow, kb);

    // Support optionnel clavier physique (iPad / ordinateur)
    window.addEventListener('keydown', (e) => {
      if (!this.active || document.querySelector('.sheet-backdrop')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') { e.preventDefault(); this.backspace(); }
      else if (e.key === 'Escape' || e.key === 'Delete') { e.preventDefault(); this.clear(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.state.solved) this.next();
        else if (this.validate()) this.feedback.success();
        else this.feedback.error();
      } else if (/^[KQRBNa-h1-8x+#=]$/.test(e.key)) {
        e.preventDefault();
        this.type(e.key);
      }
    });

    this.render();
  }

  setActive(on) {
    this.active = on;
    if (on) requestAnimationFrame(() => this.layout.measure());
  }

  setColors(colors) {
    this.colors = colors;
    this.render();
  }

  setLevel(level) {
    this.state.level = level;
    this.prefs.update({ notationLevel: level });
    this.levelChips.forEach((chip, i) => chip.setSelected(i === level));
    this.next();
  }

  _generate(level) {
    const target = level === 0 ? 1 + Math.floor(Math.random() * 3) : level;
    if (this.catalog.puzzles.length > 0) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const kind = target === 3 ? 1 + Math.floor(Math.random() * 4) : 0;
        let filter = null;
        if (kind === 1) filter = (p) => !p.fen.includes(' w - ') && !p.fen.includes(' b - ');
        else if (kind === 2) filter = (p) => p.themes.includes(' promotion ');
        else if (kind === 3) filter = (p) => p.themes.includes(' mateIn1 ');
        const batch = this.catalog.sampleSlice(kind === 1 ? 60 : 30, filter);
        const positions = [];
        for (const pz of batch) {
          try {
            const line = Line.fromUci(pz.fen, pz.moves);
            if (kind === 1) {
              positions.push(line.positions[0]);
              if (line.positions[1]) positions.push(line.positions[1]);
            } else if (kind === 3) {
              positions.push(line.positions[line.size - 1]);
            } else {
              for (let k = 0; k < line.positions.length - 1; k++) positions.push(line.positions[k]);
            }
          } catch {}
        }
        const ex = NotationLogic.pick(positions, target, kind);
        if (ex) return ex;
      }
    }
    const positions = NotationLogic.FALLBACK.map((f) => Position.fromFen(f));
    return NotationLogic.pick(positions, target) || NotationLogic.pick(positions, 0);
  }

  next() {
    const ex = this._generate(this.state.level);
    this.state.exercise = ex;
    this.state.shown = false;
    this.state.anim = null;
    this.state.flipped = !ex.before.whiteToMove;
    this.state.input = '';
    this.state.solved = false;
    this.state.hintStage = 0;
    this.state.message = "Quel coup vient d'être joué ? Écrivez-le en notation anglaise FIDE.";
    this.state.tone = Tone.INFO;
    this.render();
    this._play(450);
  }

  _play(delayMs) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      const ex = this.state.exercise;
      if (!ex) return;
      this.state.shown = true;
      this.state.anim = moveAnim(ex.before, ex.move);
      this.render();
    }, delayMs);
  }

  replay() {
    this.state.shown = false;
    this.state.anim = null;
    this.render();
    this._play(350);
  }

  flip() {
    this.state.flipped = !this.state.flipped;
    this.render();
  }

  type(key) {
    if (this.state.solved) return;
    if (this.state.input.length + key.length > 9) return;
    this.state.input = key.startsWith('O-O') ? key : this.state.input + key;
    this.render();
  }

  backspace() {
    if (this.state.solved) return;
    this.state.input = this.state.input.slice(0, -1);
    this.render();
  }

  clear() {
    if (this.state.solved) return;
    this.state.input = '';
    this.render();
  }

  hint() {
    const ex = this.state.exercise;
    if (!ex || this.state.solved) return;
    const stage = Math.min(2, this.state.hintStage + 1);
    this.state.hintStage = stage;
    this.state.message = NotationLogic.hint(ex, stage);
    this.state.tone = Tone.GOLD;
    this.render();
  }

  validate() {
    const ex = this.state.exercise;
    if (!ex) return false;
    if (this.state.input === ex.san) {
      this.state.solved = true;
      this.state.tone = Tone.GOOD;
      this.state.streak++;
      this.state.message = `✅ Exact : ${ex.san}. ${this._explain(ex)}`;
      this.render();
      return true;
    }
    this.state.tone = Tone.BAD;
    this.state.streak = 0;
    this.state.message = `❌ ${NotationLogic.diagnose(this.state.input, ex)}`;
    this.render();
    return false;
  }

  _explain(ex) {
    const p = ex.before;
    const m = ex.move;
    const type = pieceType(p.at(m.from));
    if (p.isCastle(m)) return ex.san.startsWith('O-O-O') ? 'Grand roque, côté dame.' : 'Petit roque, côté roi.';
    if (type === PAWN && m.promo !== 0) return `Le pion est promu en ${PIECE_NAMES_FR[m.promo]} (${PIECE_NAMES_EN[m.promo]}).`;
    if (type === PAWN) return `Le pion va en ${sqName(m.to)}${p.isCapture(m) ? ' en capturant.' : '.'}`;
    return `${PIECE_NAMES_FR[type]} (${PIECE_NAMES_EN[type]}) en ${sqName(m.to)}${p.isCapture(m) ? ', avec prise.' : '.'}`;
  }

  render() {
    const s = this.state;
    const ex = s.exercise;
    const c = this.colors;

    if (ex) {
      const pos = s.shown ? ex.before.play(ex.move) : ex.before;
      this.board.setState({
        position: pos,
        colors: c,
        flipped: s.flipped,
        interactive: false,
        lastMove: s.shown ? ex.move : null,
        anim: s.anim,
        arrows: s.shown ? [{ from: ex.move.from, to: ex.move.to, color: c.blue }] : [],
        marks: [],
        badges: s.shown ? [captureBadge(ex.before, ex.move)].filter(Boolean) : [],
      });
    }

    this.feedbackCard.setState(s.message, s.tone);

    if (!s.input) {
      this.inputDisplay.textContent = 'Votre réponse…';
      this.inputDisplay.className = 'notation-input-box is-empty';
    } else {
      this.inputDisplay.textContent = s.input;
      this.inputDisplay.className = `notation-input-box ${s.solved ? 'is-solved' : 'is-filled'}`;
    }

    if (s.solved) {
      this.actionBtn.setConfig({ label: 'Suivant →', accent: 'green', filled: true });
    } else {
      this.actionBtn.setConfig({ label: 'Valider', accent: 'gold', filled: true });
    }
  }
}
