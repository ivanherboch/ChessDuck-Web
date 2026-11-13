// Port fidèle de Chess.kt (ChessDuck v1.6.0)

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const BLACK = 8;

export const pieceType = (p) => p & 7;
export const isWhite = (p) => p >= 1 && p <= 6;
export const isBlack = (p) => p > 8;
export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 3;
export const sq = (file, rank) => rank * 8 + file;
export const sqName = (q) => `${String.fromCharCode(97 + fileOf(q))}${1 + rankOf(q)}`;
export const sqFromName = (s) => sq(s.charCodeAt(0) - 97, s.charCodeAt(1) - 49);

const PIECE_LETTERS = ' PNBRQK';
export const pieceLetter = (type) => PIECE_LETTERS[type];
export function pieceFromChar(c) {
  const t = PIECE_LETTERS.indexOf(c.toUpperCase());
  if (t <= 0) return 0;
  return c === c.toUpperCase() ? t : t + BLACK;
}
export function pieceChar(p) {
  return p > 8 ? PIECE_LETTERS[p & 7].toLowerCase() : PIECE_LETTERS[p];
}

export const PIECE_NAMES_FR = ['', 'Pion', 'Cavalier', 'Fou', 'Tour', 'Dame', 'Roi'];
export const PIECE_NAMES_EN = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
export const PIECE_VALUES = [0, 1, 3, 3, 5, 9, 100];

export const GameEnd = Object.freeze({
  NONE: 'NONE',
  CHECKMATE: 'CHECKMATE',
  STALEMATE: 'STALEMATE',
  INSUFFICIENT: 'INSUFFICIENT',
  FIFTY_MOVES: 'FIFTY_MOVES',
  REPETITION: 'REPETITION',
});

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Move {
  constructor(from, to, promo = 0) {
    this.from = from;
    this.to = to;
    this.promo = promo;
  }

  get uci() {
    return sqName(this.from) + sqName(this.to) + (this.promo !== 0 ? pieceLetter(this.promo).toLowerCase() : '');
  }

  equals(other) {
    return other != null && this.from === other.from && this.to === other.to && this.promo === other.promo;
  }

  static fromUci(s) {
    return new Move(
      sqFromName(s.slice(0, 2)),
      sqFromName(s.slice(2, 4)),
      s.length > 4 ? pieceType(pieceFromChar(s[4])) : 0,
    );
  }
}

const KN_DF = [1, 2, 2, 1, -1, -2, -2, -1];
const KN_DR = [2, 1, -1, -2, -2, -1, 1, 2];
const K_DF = [1, 1, 1, 0, -1, -1, -1, 0];
const K_DR = [1, 0, -1, -1, -1, 0, 1, 1];

export class Position {
  constructor(board, whiteToMove, castling, ep, halfmove, fullmove) {
    this.board = board; // Int32Array or Array(64)
    this.whiteToMove = whiteToMove;
    this.castling = castling; // bits: 1=K, 2=Q, 4=k, 8=q
    this.ep = ep;
    this.halfmove = halfmove;
    this.fullmove = fullmove;
    this._inCheck = undefined;
    this._legalMoves = undefined;
  }

  at(q) {
    return this.board[q];
  }

  _own(p) {
    return this.whiteToMove ? isWhite(p) : isBlack(p);
  }

  _enemy(p) {
    return this.whiteToMove ? isBlack(p) : isWhite(p);
  }

  kingSquare(white) {
    const k = white ? KING : KING + BLACK;
    for (let i = 0; i < 64; i++) if (this.board[i] === k) return i;
    return -1;
  }

  isAttacked(target, byWhite) {
    return this.attackers(target, byWhite, true).length > 0;
  }

  attackers(target, byWhite, firstOnly = false) {
    const res = [];
    const c = byWhite ? 0 : BLACK;
    const f = fileOf(target);
    const r = rankOf(target);
    const pr = byWhite ? r - 1 : r + 1;
    if (pr >= 0 && pr <= 7) {
      if (f > 0 && this.board[sq(f - 1, pr)] === PAWN + c) res.push(sq(f - 1, pr));
      if (f < 7 && this.board[sq(f + 1, pr)] === PAWN + c) res.push(sq(f + 1, pr));
    }
    if (firstOnly && res.length > 0) return res;
    for (let i = 0; i < 8; i++) {
      const nf = f + KN_DF[i];
      const nr = r + KN_DR[i];
      if (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7 && this.board[sq(nf, nr)] === KNIGHT + c) res.push(sq(nf, nr));
      const kf = f + K_DF[i];
      const kr = r + K_DR[i];
      if (kf >= 0 && kf <= 7 && kr >= 0 && kr <= 7 && this.board[sq(kf, kr)] === KING + c) res.push(sq(kf, kr));
    }
    if (firstOnly && res.length > 0) return res;
    for (let d = 0; d < 8; d++) {
      let nf = f + K_DF[d];
      let nr = r + K_DR[d];
      while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
        const p = this.board[sq(nf, nr)];
        if (p !== 0) {
          const t = p & 7;
          const diag = K_DF[d] !== 0 && K_DR[d] !== 0;
          if ((p >= BLACK) !== byWhite && (t === QUEEN || (diag && t === BISHOP) || (!diag && t === ROOK))) {
            res.push(sq(nf, nr));
            if (firstOnly) return res;
          }
          break;
        }
        nf += K_DF[d];
        nr += K_DR[d];
      }
    }
    return res;
  }

  get inCheck() {
    if (this._inCheck === undefined) {
      const k = this.kingSquare(this.whiteToMove);
      this._inCheck = k >= 0 && this.isAttacked(k, !this.whiteToMove);
    }
    return this._inCheck;
  }

  _pseudoMoves() {
    const out = [];
    for (let from = 0; from < 64; from++) {
      const p = this.board[from];
      if (p === 0 || !this._own(p)) continue;
      const f = fileOf(from);
      const r = rankOf(from);
      const t = p & 7;
      if (t === PAWN) {
        const dir = this.whiteToMove ? 1 : -1;
        const startRank = this.whiteToMove ? 1 : 6;
        const promoRank = this.whiteToMove ? 7 : 0;
        const nr = r + dir;
        if (nr < 0 || nr > 7) continue;
        const add = (to) => {
          if (rankOf(to) === promoRank) {
            out.push(new Move(from, to, QUEEN));
            out.push(new Move(from, to, ROOK));
            out.push(new Move(from, to, BISHOP));
            out.push(new Move(from, to, KNIGHT));
          } else {
            out.push(new Move(from, to));
          }
        };
        if (this.board[sq(f, nr)] === 0) {
          add(sq(f, nr));
          if (r === startRank && this.board[sq(f, r + 2 * dir)] === 0) {
            out.push(new Move(from, sq(f, r + 2 * dir)));
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const to = sq(nf, nr);
          if (this._enemy(this.board[to])) add(to);
          else if (to === this.ep && this.board[to] === 0) out.push(new Move(from, to));
        }
      } else if (t === KNIGHT || t === KING) {
        const dfs = t === KNIGHT ? KN_DF : K_DF;
        const drs = t === KNIGHT ? KN_DR : K_DR;
        for (let i = 0; i < 8; i++) {
          const nf = f + dfs[i];
          const nr = r + drs[i];
          if (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7 && !this._own(this.board[sq(nf, nr)])) {
            out.push(new Move(from, sq(nf, nr)));
          }
        }
        if (t === KING) this._addCastling(from, out);
      } else {
        for (let d = 0; d < 8; d++) {
          const diag = K_DF[d] !== 0 && K_DR[d] !== 0;
          if ((t === BISHOP && !diag) || (t === ROOK && diag)) continue;
          let nf = f + K_DF[d];
          let nr = r + K_DR[d];
          while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
            const q = this.board[sq(nf, nr)];
            if (this._own(q)) break;
            out.push(new Move(from, sq(nf, nr)));
            if (q !== 0) break;
            nf += K_DF[d];
            nr += K_DR[d];
          }
        }
      }
    }
    return out;
  }

  _addCastling(from, out) {
    const home = this.whiteToMove ? 4 : 60;
    if (from !== home) return;
    const c = this.whiteToMove ? 0 : BLACK;
    const kBit = this.whiteToMove ? 1 : 4;
    const qBit = this.whiteToMove ? 2 : 8;
    const opp = !this.whiteToMove;
    if (
      (this.castling & kBit) !== 0 &&
      this.board[home + 1] === 0 &&
      this.board[home + 2] === 0 &&
      this.board[home + 3] === ROOK + c &&
      !this.isAttacked(home, opp) &&
      !this.isAttacked(home + 1, opp) &&
      !this.isAttacked(home + 2, opp)
    ) {
      out.push(new Move(home, home + 2));
    }
    if (
      (this.castling & qBit) !== 0 &&
      this.board[home - 1] === 0 &&
      this.board[home - 2] === 0 &&
      this.board[home - 3] === 0 &&
      this.board[home - 4] === ROOK + c &&
      !this.isAttacked(home, opp) &&
      !this.isAttacked(home - 1, opp) &&
      !this.isAttacked(home - 2, opp)
    ) {
      out.push(new Move(home, home - 2));
    }
  }

  get legalMoves() {
    if (this._legalMoves === undefined) {
      this._legalMoves = this._pseudoMoves().filter((m) => {
        const n = this.play(m);
        const k = n.kingSquare(this.whiteToMove);
        return k < 0 || !n.isAttacked(k, !this.whiteToMove);
      });
    }
    return this._legalMoves;
  }

  legalFrom(from) {
    return this.legalMoves.filter((m) => m.from === from);
  }

  isLegal(m) {
    return m != null && this.legalMoves.some((x) => x.equals(m));
  }

  isCapture(m) {
    return this.board[m.to] !== 0 || this.isEnPassant(m);
  }

  isEnPassant(m) {
    return pieceType(this.board[m.from]) === PAWN && m.to === this.ep && this.board[m.to] === 0 && fileOf(m.from) !== fileOf(m.to);
  }

  isCastle(m) {
    return pieceType(this.board[m.from]) === KING && Math.abs(fileOf(m.from) - fileOf(m.to)) === 2;
  }

  isPromotionMove(from, to) {
    return pieceType(this.board[from]) === PAWN && (rankOf(to) === 7 || rankOf(to) === 0);
  }

  play(m) {
    const b = this.board.slice();
    const p = b[m.from];
    const t = p & 7;
    const capture = b[m.to] !== 0;
    let newEp = -1;
    b[m.from] = 0;
    if (t === PAWN) {
      if (m.to === this.ep && !capture && fileOf(m.from) !== fileOf(m.to)) {
        b[sq(fileOf(m.to), rankOf(m.from))] = 0;
      }
      if (Math.abs(m.to - m.from) === 16) newEp = (m.from + m.to) / 2;
    }
    b[m.to] = m.promo !== 0 ? m.promo + (p & BLACK) : p;
    if (t === KING && Math.abs(fileOf(m.to) - fileOf(m.from)) === 2) {
      if (fileOf(m.to) === 6) {
        b[m.to - 1] = b[m.to + 1];
        b[m.to + 1] = 0;
      } else {
        b[m.to + 1] = b[m.to - 2];
        b[m.to - 2] = 0;
      }
    }
    let c = this.castling;
    const touch = (s) => {
      if (s === 4) c &= 12;
      else if (s === 60) c &= 3;
      else if (s === 7) c &= ~1;
      else if (s === 0) c &= ~2;
      else if (s === 63) c &= ~4;
      else if (s === 56) c &= ~8;
    };
    touch(m.from);
    touch(m.to);
    return new Position(
      b,
      !this.whiteToMove,
      c,
      newEp,
      t === PAWN || capture ? 0 : this.halfmove + 1,
      this.whiteToMove ? this.fullmove : this.fullmove + 1,
    );
  }

  get isCheckmate() {
    return this.inCheck && this.legalMoves.length === 0;
  }

  get isStalemate() {
    return !this.inCheck && this.legalMoves.length === 0;
  }

  get insufficientMaterial() {
    let minors = 0;
    for (let i = 0; i < 64; i++) {
      const t = this.board[i] & 7;
      if (t === 0 || t === KING) continue;
      if (t === KNIGHT || t === BISHOP) minors++;
      else return false;
    }
    return minors <= 1;
  }

  get key() {
    const fen = this.toFen();
    const last = fen.lastIndexOf(' ');
    const prev = fen.lastIndexOf(' ', last - 1);
    return fen.slice(0, prev);
  }

  toFen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f <= 7; f++) {
        const p = this.board[sq(f, r)];
        if (p === 0) empty++;
        else {
          if (empty > 0) { s += empty; empty = 0; }
          s += pieceChar(p);
        }
      }
      if (empty > 0) s += empty;
      if (r > 0) s += '/';
    }
    s += this.whiteToMove ? ' w ' : ' b ';
    if (this.castling === 0) s += '-';
    else {
      if (this.castling & 1) s += 'K';
      if (this.castling & 2) s += 'Q';
      if (this.castling & 4) s += 'k';
      if (this.castling & 8) s += 'q';
    }
    const epLegal = this.ep >= 0 && this.legalMoves.some((m) => this.isEnPassant(m));
    s += ' ' + (epLegal ? sqName(this.ep) : '-');
    s += ` ${this.halfmove} ${this.fullmove}`;
    return s;
  }

  san(m) {
    const p = this.board[m.from];
    const t = p & 7;
    let s = '';
    if (this.isCastle(m)) {
      s = fileOf(m.to) === 6 ? 'O-O' : 'O-O-O';
    } else {
      const capture = this.isCapture(m);
      if (t === PAWN) {
        if (capture) s += String.fromCharCode(97 + fileOf(m.from));
      } else {
        s += pieceLetter(t);
        const others = this.legalMoves.filter((x) => x.to === m.to && x.from !== m.from && this.board[x.from] === p);
        if (others.length > 0) {
          const sameFile = others.some((x) => fileOf(x.from) === fileOf(m.from));
          const sameRank = others.some((x) => rankOf(x.from) === rankOf(m.from));
          if (!sameFile) s += String.fromCharCode(97 + fileOf(m.from));
          else if (!sameRank) s += String(1 + rankOf(m.from));
          else s += sqName(m.from);
        }
      }
      if (capture) s += 'x';
      s += sqName(m.to);
      if (m.promo !== 0) s += '=' + pieceLetter(m.promo);
    }
    const n = this.play(m);
    if (n.inCheck) s += n.legalMoves.length === 0 ? '#' : '+';
    return s;
  }

  parseSan(san) {
    const clean = san.trim().replace(/[+#!?]+$/, '').replace(/0/g, 'O');
    return this.legalMoves.find((m) => this.san(m).replace(/[+#]+$/, '') === clean) || null;
  }

  static fromFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const b = new Int32Array(64);
    let r = 7;
    let f = 0;
    for (const ch of parts[0]) {
      if (ch === '/') {
        r--;
        f = 0;
      } else if (ch >= '1' && ch <= '8') {
        f += ch.charCodeAt(0) - 48;
      } else {
        b[sq(f, r)] = pieceFromChar(ch);
        f++;
      }
    }
    let c = 0;
    const cs = parts[2] ?? '-';
    if (cs.includes('K')) c |= 1;
    if (cs.includes('Q')) c |= 2;
    if (cs.includes('k')) c |= 4;
    if (cs.includes('q')) c |= 8;
    const eps = parts[3] ?? '-';
    return new Position(
      b,
      (parts[1] ?? 'w') === 'w',
      c,
      eps === '-' ? -1 : sqFromName(eps),
      Number.parseInt(parts[4] ?? '0', 10) || 0,
      Number.parseInt(parts[5] ?? '1', 10) || 1,
    );
  }
}

Position.START = Position.fromFen(START_FEN);

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export class Line {
  constructor(startFen, moves = []) {
    this.startFen = startFen;
    this.positions = [Position.fromFen(startFen)];
    this.moves = [];
    this.sans = [];
    for (const m of moves) this.push(m);
  }

  get size() {
    return this.moves.length;
  }

  get last() {
    return this.positions[this.positions.length - 1];
  }

  push(m) {
    const p = this.positions[this.positions.length - 1];
    this.sans.push(p.san(m));
    this.moves.push(m);
    this.positions.push(p.play(m));
  }

  copy(n = this.size) {
    const l = new Line(this.startFen);
    const k = Math.max(0, Math.min(n, this.size));
    l.moves = this.moves.slice(0, k);
    l.sans = this.sans.slice(0, k);
    l.positions = this.positions.slice(0, k + 1);
    return l;
  }

  uciMoves(upTo = this.size) {
    return this.moves.slice(0, upTo).map((m) => m.uci).join(' ');
  }

  end() {
    const p = this.last;
    if (p.legalMoves.length === 0) return p.inCheck ? GameEnd.CHECKMATE : GameEnd.STALEMATE;
    if (p.insufficientMaterial) return GameEnd.INSUFFICIENT;
    if (p.halfmove >= 100) return GameEnd.FIFTY_MOVES;
    const k = p.key;
    let count = 0;
    for (const pos of this.positions) if (pos.key === k) count++;
    if (count >= 3) return GameEnd.REPETITION;
    return GameEnd.NONE;
  }

  static fromUci(startFen, uci) {
    const l = new Line(startFen);
    for (const tok of uci.split(' ')) {
      if (tok.trim()) l.push(Move.fromUci(tok.trim()));
    }
    return l;
  }

  static fromMoves(startFen, tokens) {
    const l = new Line(startFen);
    for (const t of tokens) {
      const p = l.last;
      let m = null;
      if (UCI_RE.test(t)) {
        const cand = Move.fromUci(t);
        if (p.isLegal(cand)) m = cand;
      }
      if (!m) m = p.parseSan(t);
      if (!m) throw new Error(`Coup illégal « ${t} » après ${l.sans.join(' ')} (${startFen})`);
      l.push(m);
    }
    return l;
  }

  static fromSan(startFen, sans) {
    const l = new Line(startFen);
    for (const s of sans) {
      const m = l.last.parseSan(s);
      if (!m) throw new Error(`Coup illégal « ${s} »`);
      l.push(m);
    }
    return l;
  }
}

const CAPTURE_ORDER = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN];
const START_COUNT = [0, 8, 2, 2, 2, 1, 1];

export function materialOf(p) {
  const white = [0, 0, 0, 0, 0, 0, 0];
  const black = [0, 0, 0, 0, 0, 0, 0];
  let diff = 0;
  for (let q = 0; q < 64; q++) {
    const piece = p.at(q);
    if (piece === 0) continue;
    const t = pieceType(piece);
    if (isWhite(piece)) {
      white[t]++;
      if (t !== 6) diff += PIECE_VALUES[t];
    } else {
      black[t]++;
      if (t !== 6) diff -= PIECE_VALUES[t];
    }
  }
  const lost = (counts, color) => {
    const arr = [];
    for (const t of CAPTURE_ORDER) {
      const n = Math.max(0, START_COUNT[t] - counts[t]);
      for (let i = 0; i < n; i++) arr.push(t + color);
    }
    return arr;
  };
  return { blackLost: lost(black, BLACK), whiteLost: lost(white, 0), diff };
}
