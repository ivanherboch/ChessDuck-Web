// Port fidèle de Stockfish.kt (scoring), GameLogic (Play.kt) et ReviewComments.kt (ChessDuck v1.6.0)

import {
  BISHOP, GameEnd, KING, KNIGHT, Move, PAWN, PIECE_VALUES, QUEEN, ROOK,
  fileOf, isWhite, pieceType, rankOf, sqName,
} from './chess.js';

export const MATE = 100000;
export const COMPUTER_LABEL = '🤖 Ordinateur';

export function isMateScore(s) {
  return Math.abs(s) > MATE - 1000;
}

export function mateIn(s) {
  return s > 0 ? Math.floor((MATE - s + 1) / 2) : -Math.floor((MATE + s + 1) / 2);
}

export function winPercent(cp) {
  if (isMateScore(cp)) return cp > 0 ? 100.0 : 0.0;
  return 50.0 + 50.0 * (2.0 / (1.0 + Math.exp(-0.00368208 * cp)) - 1.0);
}

export function encodeAnalysis(list) {
  return list.map((a) => (a ? `${a.eval},${a.second ?? ''},${a.best}` : '')).join(';');
}

export function decodeAnalysis(s, n) {
  const parts = s ? s.split(';') : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const raw = parts[i];
    if (!raw) { out.push(null); continue; }
    const t = raw.split(',');
    const e = Number.parseInt(t[0], 10);
    if (Number.isNaN(e)) { out.push(null); continue; }
    const sec = t[1] !== '' && t[1] !== undefined ? Number.parseInt(t[1], 10) : NaN;
    out.push({ eval: e, second: Number.isNaN(sec) ? null : sec, best: t[2] || '' });
  }
  return out;
}

export const GameLogic = {
  newElo(elo, opponent, score, k = 32) {
    const expected = 1.0 / (1.0 + Math.pow(10.0, (opponent - elo) / 400.0));
    return Math.round(elo + k * (score - expected));
  },

  annotate(before, move, a0, a1, prev) {
    if (!a0 || !a1) return null;
    const sign = before.whiteToMove ? 1 : -1;
    const best = winPercent(sign * a0.eval);
    const after = winPercent(sign * a1.eval);
    const loss = best - after;
    if (loss >= 25) return '??';
    if (loss >= 15) return '?';
    if (loss >= 9) return '?!';
    if (move.uci === a0.best && a0.second != null) {
      const second = winPercent(sign * a0.second);
      const recapture = prev != null && prev.to === move.to && before.isCapture(move);
      if (best - second >= 18 && best >= 35 && second <= 80 && !recapture) {
        return isSacrifice(before, move) ? '!!' : '!';
      }
    }
    return null;
  },

  missedMate(whiteToMove, a0, a1) {
    if (!a0 || !a1) return null;
    const sign = whiteToMove ? 1 : -1;
    const before = sign * a0.eval;
    if (!isMateScore(before) || before <= 0) return null;
    const k = mateIn(before);
    if (k < 1 || k > 2) return null;
    const after = sign * a1.eval;
    const kept = isMateScore(after) && after > 0 && mateIn(after) <= k - 1;
    return kept ? null : k;
  },

  endText(end) {
    switch (end) {
      case GameEnd.CHECKMATE: return 'échec et mat';
      case GameEnd.STALEMATE: return 'pat';
      case GameEnd.INSUFFICIENT: return 'matériel insuffisant';
      case GameEnd.FIFTY_MOVES: return 'règle des 50 coups';
      case GameEnd.REPETITION: return 'triple répétition';
      default: return '';
    }
  },
};

function isSacrifice(before, m) {
  const moved = pieceType(before.at(m.from));
  if (moved === PAWN || moved === KING) return false;
  const gain = PIECE_VALUES[pieceType(before.at(m.to))];
  if (gain >= PIECE_VALUES[moved]) return false;
  const after = before.play(m);
  const attackers = after.attackers(m.to, after.whiteToMove);
  if (attackers.length === 0) return false;
  const cheapest = Math.min(...attackers.map((sq) => PIECE_VALUES[pieceType(after.at(sq))]));
  const defended = after.attackers(m.to, !after.whiteToMove).length > 0;
  return cheapest < PIECE_VALUES[moved] || !defended;
}

const NAME = ['', 'pion', 'cavalier', 'fou', 'tour', 'dame', 'roi'];
const fem = (t) => t === ROOK || t === QUEEN;
const the = (t) => (fem(t) ? 'la ' : 'le ') + NAME[t];
const itPron = (t) => (fem(t) ? 'la' : 'le');
const poss = (v, t) => v.f(fem(t) ? 'ta ' : 'ton ', fem(t) ? 'sa ' : 'son ') + NAME[t];

function bucket(evalWhite) {
  const w = winPercent(evalWhite);
  if (w >= 86) return 2;
  if (w >= 63) return 1;
  if (w > 37) return 0;
  if (w > 14) return -1;
  return -2;
}

function attackedCheaply(p, q) {
  const piece = p.at(q);
  if (piece === 0) return false;
  const attackers = p.attackers(q, !isWhite(piece));
  if (attackers.length === 0) return false;
  const defended = p.attackers(q, isWhite(piece)).length > 0;
  return !defended || attackers.some((a) => PIECE_VALUES[pieceType(p.at(a))] < PIECE_VALUES[pieceType(piece)]);
}

function describeMove(v, p, m, san, prev) {
  const t = pieceType(p.at(m.from));
  let base;
  if (p.isCastle(m)) {
    base = 'roque pour mettre son roi à l’abri'.replace('’', "'");
  } else if (m.promo !== 0) {
    base = `mène son pion à promotion et obtient une ${NAME[m.promo]}`
      .replace('une cavalier', 'un cavalier')
      .replace('une fou', 'un fou');
  } else if (p.isCapture(m)) {
    const victim = p.isEnPassant(m) ? PAWN : pieceType(p.at(m.to));
    base = (prev != null && prev.to === m.to ? 'reprend en capturant ' : 'capture ') + the(victim) + ` en ${sqName(m.to)}`;
  } else if (p.fullmove <= 12 && (t === KNIGHT || t === BISHOP) && rankOf(m.from) === (v.white ? 0 : 7)) {
    base = `développe son ${NAME[t]}`;
  } else if (t === PAWN && fileOf(m.to) >= 3 && fileOf(m.to) <= 4 && rankOf(m.to) >= 3 && rankOf(m.to) <= 4) {
    base = 'avance un pion au centre';
  } else if (t === PAWN) {
    base = `avance son pion en ${sqName(m.to)}`;
  } else {
    base = `joue ${fem(t) ? 'sa' : 'son'} ${NAME[t]} en ${sqName(m.to)}`;
  }
  const tail = san.endsWith('#') ? ' et fait échec et mat !' : san.endsWith('+') ? ', avec échec.' : '.';
  return `${v.label} ${base}${tail}`;
}

function explainMistake(v, p, m, san, a0, a1) {
  const after = p.play(m);
  const replyRaw = a1.best ? Move.fromUci(a1.best) : null;
  const reply = replyRaw && after.isLegal(replyRaw) ? replyRaw : null;
  const bestRaw = a0.best ? Move.fromUci(a0.best) : null;
  const best = bestRaw && p.isLegal(bestRaw) && !bestRaw.equals(m) ? bestRaw : null;
  const sign = p.whiteToMove ? 1 : -1;

  // 1. Le coup autorise un mat rapide.
  const oppScore = -sign * a1.eval;
  if (isMateScore(oppScore) && oppScore > 0 && reply != null) {
    const n = mateIn(oppScore);
    if (n <= 2) return `en jouant ${san}, ${v.f('tu permets', 'il permet')} à l'adversaire de faire échec et mat en ${n} (${after.san(reply)}).`;
    return `${san} laisse l'adversaire lancer une attaque décisive contre ${v.f('ton', 'son')} roi.`;
  }

  // 2. Une pièce est laissée en prise.
  if (reply != null && after.isCapture(reply)) {
    const victim = after.isEnPassant(reply) ? PAWN : pieceType(after.at(reply.to));
    const gained = p.isCapture(m) ? PIECE_VALUES[p.isEnPassant(m) ? PAWN : pieceType(p.at(m.to))] : 0;
    if (PIECE_VALUES[victim] > gained) {
      const rs = after.san(reply);
      if (reply.to === m.to) {
        return `en jouant ${san}, ${v.f('tu exposes', 'il expose')} ${poss(v, victim)} : ${rs} peut ${itPron(victim)} capturer.`;
      }
      return `${san} laisse ${poss(v, victim)} en ${sqName(reply.to)} sans protection suffisante : ${rs} ${itPron(victim)} capture.`;
    }
  }

  if (best != null) {
    const bs = p.san(best);
    const bt = pieceType(p.at(best.from));
    // 3. Une capture avantageuse a été manquée.
    if (p.isCapture(best)) {
      const victim = p.isEnPassant(best) ? PAWN : pieceType(p.at(best.to));
      const free = p.attackers(best.to, !p.whiteToMove).length === 0;
      if (free || PIECE_VALUES[victim] >= PIECE_VALUES[bt]) {
        return `${v.f('tu as', 'il a')} manqué l'occasion de capturer ${the(victim)} en ${sqName(best.to)} avec ${bs} : cela ${v.f("t'", 'lui ')}aurait donné l'avantage.`;
      }
    }
    // 4. Une pièce attaquée n'a pas été mise à l'abri.
    if (attackedCheaply(p, best.from) && bt !== PAWN && bt !== KING && best.from !== m.from) {
      return `${poss(v, bt)} en ${sqName(best.from)} était attaqué${fem(bt) ? 'e' : ''} : il fallait ${itPron(bt)} mettre à l'abri avec ${bs}.`;
    }
    // 5. Un échec fort a été manqué.
    if (bs.endsWith('+')) return `${v.f('tu aurais dû', 'il aurait dû')} donner échec avec ${bs} pour garder l'initiative.`;
    // 6. Principes d'ouverture.
    if (p.isCastle(best)) return `${v.f('tu aurais dû', 'il aurait dû')} mettre ${v.f('ton', 'son')} roi à l'abri en roquant (${bs}).`;
    if (p.fullmove <= 14) {
      if ((bt === KNIGHT || bt === BISHOP) && rankOf(best.from) === (p.whiteToMove ? 0 : 7)) {
        return `${v.f('tu aurais dû', 'il aurait dû')} développer ${poss(v, bt)} avec ${bs} pour prendre part à la bataille du centre.`;
      }
      if (bt === PAWN && fileOf(best.to) >= 3 && fileOf(best.to) <= 4 && rankOf(best.to) >= 2 && rankOf(best.to) <= 5) {
        return `${v.f('tu aurais dû', 'il aurait dû')} occuper le centre avec ${bs}.`;
      }
    }
    return `${bs} était plus fort que ${san}.`;
  }
  return `${san} affaiblit ${v.f('ta', 'sa')} position.`;
}

export const ReviewComments = {
  voice(g, white) {
    const human = !g.vsComputer || g.playerWhite === white;
    const stored = white ? (g.whiteName || '') : (g.blackName || '');
    let name;
    if (!human) name = "L'ordinateur";
    else if (stored) name = stored;
    else if (g.vsComputer) name = 'Joueur';
    else name = white ? 'Joueur 1' : 'Joueur 2';
    return {
      name,
      human,
      white,
      label: `${name} (${white ? 'Blancs' : 'Noirs'})`,
      f(tu, il) { return human ? tu : il; },
    };
  },

  comment(g, line, i, analysis) {
    const p = line.positions[i];
    const m = line.moves[i];
    const san = line.sans[i];
    const v = this.voice(g, p.whiteToMove);
    const prev = i > 0 ? line.moves[i - 1] : null;
    const a0 = analysis[i] || null;
    const a1 = analysis[i + 1] || null;
    if (san.endsWith('#')) return [`Échec et mat ! ${v.label} conclut la partie avec ${san}.`, 'GOOD'];
    const plain = describeMove(v, p, m, san, prev);
    if (!a0 || !a1) return [plain, 'INFO'];

    const b0 = bucket(a0.eval);
    const b1 = bucket(a1.eval);
    let trend = '';
    if (b1 !== b0) {
      const w = this.voice(g, true);
      const b = this.voice(g, false);
      let msg;
      if (b1 === 2) msg = `${w.label} a maintenant un avantage décisif.`;
      else if (b1 === 1) msg = b0 > 1 ? `${w.label} garde l'avantage, mais il n'est plus décisif.` : `${w.label} prend l'avantage.`;
      else if (b1 === 0) msg = 'La position est de nouveau équilibrée.';
      else if (b1 === -1) msg = b0 < -1 ? `${b.label} garde l'avantage, mais il n'est plus décisif.` : `${b.label} prend l'avantage.`;
      else msg = `${b.label} a maintenant un avantage décisif.`;
      trend = ' ➜ ' + msg;
    }

    const mm = GameLogic.missedMate(p.whiteToMove, a0, a1);
    if (mm != null) {
      const bestSan = a0.best ? p.san(Move.fromUci(a0.best)) : null;
      const how = mm === 1 ? 'matait immédiatement' : 'forçait le mat en 2 coups';
      return [
        `⚠️ Mat en ${mm} manqué · ${v.label} : ${v.f('tu pouvais', 'il pouvait')} gagner tout de suite` +
        (bestSan ? `, ${bestSan} ${how}.` : '.') + trend,
        'BAD',
      ];
    }

    const ann = GameLogic.annotate(p, m, a0, a1, prev);
    if (ann === '??') return [`Gaffe · ${v.label} : ${explainMistake(v, p, m, san, a0, a1)}${trend}`, 'BAD'];
    if (ann === '?') return [`Erreur · ${v.label} : ${explainMistake(v, p, m, san, a0, a1)}${trend}`, 'BAD'];
    if (ann === '?!') return [`Imprécision · ${v.label} : ${explainMistake(v, p, m, san, a0, a1)}${trend}`, 'GOLD'];
    if (ann === '!!') return [`Coup brillant · ${v.label} : ${san} sacrifie du matériel pour une attaque gagnante.${trend}`, 'GOOD'];
    if (ann === '!') return [`Très bon coup · ${v.label} : ${san} était le seul coup vraiment fort dans cette position.${trend}`, 'GOOD'];
    return [plain + trend, 'INFO'];
  },

  ending(g) {
    const w = this.voice(g, true);
    const b = this.voice(g, false);
    let txt;
    if (g.result === '1-0') txt = `Fin de la partie : victoire de ${w.label} par ${g.reason}.`;
    else if (g.result === '0-1') txt = `Fin de la partie : victoire de ${b.label} par ${g.reason}.`;
    else txt = `Fin de la partie : nulle (${g.reason}).`;
    return txt.replace("de L'ordinateur", "de l'ordinateur");
  },
};
