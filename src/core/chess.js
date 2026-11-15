/** Types de pièces. Une pièce = type (blanc) ou type + 8 (noir). 0 = case vide. */
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const BLACK = 8;

export function pieceType(p) { return p & 7; }
export function isWhite(p) { return p >= 1 && p <= 6; }
export function isBlack(p) { return p > 8; }
export function fileOf(sq) { return sq & 7; }
export function rankOf(sq) { return sq >> 3; }
export function sq(file, rank) { return rank * 8 + file; }
export function sqName(s) { return String.fromCharCode(97 + fileOf(s), 49 + rankOf(s)); }
export function sqFromName(str) { return sq(str.charCodeAt(0) - 97, str.charCodeAt(1) - 49); }

const PIECE_LETTERS = ' PNBRQK';

export function pieceLetter(type) { return PIECE_LETTERS[type]; }

export function pieceFromChar(c) {
    const up = c.toUpperCase();
    const t = PIECE_LETTERS.indexOf(up);
    if (t <= 0) return 0;
    return c === up ? t : t + BLACK;
}

export function pieceChar(p) {
    return p > 8 ? PIECE_LETTERS[p & 7].toLowerCase() : PIECE_LETTERS[p];
}

export const PIECE_NAMES_FR = ['', 'Pion', 'Cavalier', 'Fou', 'Tour', 'Dame', 'Roi'];
export const PIECE_NAMES_EN = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
export const PIECE_VALUES = [0, 1, 3, 3, 5, 9, 100];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const GameEnd = Object.freeze({
    NONE: 'NONE',
    CHECKMATE: 'CHECKMATE',
    STALEMATE: 'STALEMATE',
    INSUFFICIENT: 'INSUFFICIENT',
    FIFTY_MOVES: 'FIFTY_MOVES',
    REPETITION: 'REPETITION',
});

const KN_DF = [1, 2, 2, 1, -1, -2, -2, -1];
const KN_DR = [2, 1, -1, -2, -2, -1, 1, 2];
const K_DF = [1, 1, 1, 0, -1, -1, -1, 0];
const K_DR = [1, 0, -1, -1, -1, 0, 1, 1];
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

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

    static isUci(s) {
        return typeof s === 'string' && UCI_RE.test(s);
    }

    static fromUci(s) {
        return new Move(
            sqFromName(s.slice(0, 2)),
            sqFromName(s.slice(2, 4)),
            s.length > 4 ? pieceType(pieceFromChar(s[4])) : 0,
        );
    }
}

/** Position d'échecs immuable : génération de coups légaux, FEN, SAN, UCI. */
export class Position {
    constructor(board, whiteToMove, castling, ep, halfmove, fullmove) {
        this.board = board;
        this.whiteToMove = whiteToMove;
        this.castling = castling; // 1 = K, 2 = Q, 4 = k, 8 = q
        this.ep = ep;
        this.halfmove = halfmove;
        this.fullmove = fullmove;
        this._inCheck = undefined;
        this._legalMoves = undefined;
        this._epCaptureLegal = undefined;
        this._key = undefined;
    }

    at(s) { return this.board[s]; }
    _own(p) { return this.whiteToMove ? isWhite(p) : isBlack(p); }
    _enemy(p) { return this.whiteToMove ? isBlack(p) : isWhite(p); }

    kingSquare(white) {
        const k = white ? KING : KING + BLACK;
        for (let i = 0; i < 64; i++) {
            if (this.board[i] === k) return i;
        }
        return -1;
    }

    isAttacked(target, byWhite) {
        return this.hasAttacker(target, byWhite);
    }

    hasAttacker(target, byWhite) {
        const b = this.board;
        const c = byWhite ? 0 : BLACK;
        const f = fileOf(target);
        const r = rankOf(target);
        const pr = byWhite ? r - 1 : r + 1;
        if (pr >= 0 && pr <= 7) {
            if (f > 0 && b[sq(f - 1, pr)] === PAWN + c) return true;
            if (f < 7 && b[sq(f + 1, pr)] === PAWN + c) return true;
        }
        for (let i = 0; i < 8; i++) {
            const nf = f + KN_DF[i];
            const nr = r + KN_DR[i];
            if (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7 && b[sq(nf, nr)] === KNIGHT + c) return true;
            const kf = f + K_DF[i];
            const kr = r + K_DR[i];
            if (kf >= 0 && kf <= 7 && kr >= 0 && kr <= 7 && b[sq(kf, kr)] === KING + c) return true;
        }
        for (let d = 0; d < 8; d++) {
            let nf = f + K_DF[d];
            let nr = r + K_DR[d];
            const diag = K_DF[d] !== 0 && K_DR[d] !== 0;
            while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
                const p = b[sq(nf, nr)];
                if (p !== 0) {
                    const t = p & 7;
                    if ((p >= BLACK) !== byWhite && (t === QUEEN || (diag && t === BISHOP) || (!diag && t === ROOK))) {
                        return true;
                    }
                    break;
                }
                nf += K_DF[d];
                nr += K_DR[d];
            }
        }
        return false;
    }

    attackers(target, byWhite, firstOnly = false) {
        const res = [];
        const b = this.board;
        const c = byWhite ? 0 : BLACK;
        const f = fileOf(target);
        const r = rankOf(target);
        const pr = byWhite ? r - 1 : r + 1;
        if (pr >= 0 && pr <= 7) {
            if (f > 0 && b[sq(f - 1, pr)] === PAWN + c) res.push(sq(f - 1, pr));
            if (f < 7 && b[sq(f + 1, pr)] === PAWN + c) res.push(sq(f + 1, pr));
        }
        if (firstOnly && res.length > 0) return res;
        for (let i = 0; i < 8; i++) {
            const nf = f + KN_DF[i];
            const nr = r + KN_DR[i];
            if (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7 && b[sq(nf, nr)] === KNIGHT + c) res.push(sq(nf, nr));
            const kf = f + K_DF[i];
            const kr = r + K_DR[i];
            if (kf >= 0 && kf <= 7 && kr >= 0 && kr <= 7 && b[sq(kf, kr)] === KING + c) res.push(sq(kf, kr));
        }
        if (firstOnly && res.length > 0) return res;
        for (let d = 0; d < 8; d++) {
            let nf = f + K_DF[d];
            let nr = r + K_DR[d];
            const diag = K_DF[d] !== 0 && K_DR[d] !== 0;
            while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
                const p = b[sq(nf, nr)];
                if (p !== 0) {
                    const t = p & 7;
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
            const ks = this.kingSquare(this.whiteToMove);
            this._inCheck = ks >= 0 && this.isAttacked(ks, !this.whiteToMove);
        }
        return this._inCheck;
    }

    _pseudoMoves() {
        const out = [];
        const b = this.board;
        for (let from = 0; from < 64; from++) {
            const p = b[from];
            if (p === 0 || !this._own(p)) continue;
            const f = fileOf(from);
            const r = rankOf(from);
            const pt = p & 7;
            if (pt === PAWN) {
                const dir = this.whiteToMove ? 1 : -1;
                const startRank = this.whiteToMove ? 1 : 6;
                const promoRank = this.whiteToMove ? 7 : 0;
                const nr = r + dir;
                if (nr < 0 || nr > 7) continue;
                const add = (to) => {
                    if (rankOf(to) === promoRank) {
                        out.push(new Move(from, to, QUEEN), new Move(from, to, ROOK), new Move(from, to, BISHOP), new Move(from, to, KNIGHT));
                    } else {
                        out.push(new Move(from, to));
                    }
                };
                if (b[sq(f, nr)] === 0) {
                    add(sq(f, nr));
                    if (r === startRank && b[sq(f, r + 2 * dir)] === 0) out.push(new Move(from, sq(f, r + 2 * dir)));
                }
                for (const df of [-1, 1]) {
                    const nf = f + df;
                    if (nf < 0 || nf > 7) continue;
                    const to = sq(nf, nr);
                    if (this._enemy(b[to])) add(to);
                    else if (to === this.ep && b[to] === 0) out.push(new Move(from, to));
                }
            } else if (pt === KNIGHT || pt === KING) {
                const dfs = pt === KNIGHT ? KN_DF : K_DF;
                const drs = pt === KNIGHT ? KN_DR : K_DR;
                for (let i = 0; i < 8; i++) {
                    const nf = f + dfs[i];
                    const nr = r + drs[i];
                    if (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7 && !this._own(b[sq(nf, nr)])) {
                        out.push(new Move(from, sq(nf, nr)));
                    }
                }
                if (pt === KING) this._addCastling(from, out);
            } else {
                for (let d = 0; d < 8; d++) {
                    const diag = K_DF[d] !== 0 && K_DR[d] !== 0;
                    if ((pt === BISHOP && !diag) || (pt === ROOK && diag)) continue;
                    let nf = f + K_DF[d];
                    let nr = r + K_DR[d];
                    while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
                        const q = b[sq(nf, nr)];
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
        const b = this.board;
        if ((this.castling & kBit) !== 0 && b[home + 1] === 0 && b[home + 2] === 0 && b[home + 3] === ROOK + c &&
            !this.isAttacked(home, opp) && !this.isAttacked(home + 1, opp) && !this.isAttacked(home + 2, opp)) {
            out.push(new Move(home, home + 2));
        }
        if ((this.castling & qBit) !== 0 && b[home - 1] === 0 && b[home - 2] === 0 && b[home - 3] === 0 &&
            b[home - 4] === ROOK + c && !this.isAttacked(home, opp) && !this.isAttacked(home - 1, opp) && !this.isAttacked(home - 2, opp)) {
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
        return this.legalMoves.some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo);
    }

    isCapture(m) {
        return this.board[m.to] !== 0 || this.isEnPassant(m);
    }

    isEnPassant(m) {
        return pieceType(this.board[m.from]) === PAWN && m.to === this.ep && this.board[m.to] === 0 && fileOf(m.from) !== fileOf(m.to);
    }

    capturedType(m) {
        return this.isEnPassant(m) ? PAWN : pieceType(this.board[m.to]);
    }

    isCastle(m) {
        return pieceType(this.board[m.from]) === KING && Math.abs(fileOf(m.from) - fileOf(m.to)) === 2;
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
            if (Math.abs(m.to - m.from) === 16) newEp = (m.from + m.to) >> 1;
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

    get isCheckmate() { return this.inCheck && this.legalMoves.length === 0; }

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

    get _epCaptureLegalFlag() {
        if (this._epCaptureLegal === undefined) {
            if (this.ep < 0) {
                this._epCaptureLegal = false;
            } else {
                const pawn = this.whiteToMove ? PAWN : PAWN + BLACK;
                const r = this.whiteToMove ? 4 : 3;
                const f = fileOf(this.ep);
                const adjacent = (f > 0 && this.board[sq(f - 1, r)] === pawn) || (f < 7 && this.board[sq(f + 1, r)] === pawn);
                this._epCaptureLegal = adjacent && this.legalMoves.some((m) => this.isEnPassant(m));
            }
        }
        return this._epCaptureLegal;
    }

    _placement() {
        let s = '';
        for (let r = 7; r >= 0; r--) {
            let empty = 0;
            for (let f = 0; f <= 7; f++) {
                const p = this.board[sq(f, r)];
                if (p === 0) {
                    empty++;
                } else {
                    if (empty > 0) { s += empty; empty = 0; }
                    s += pieceChar(p);
                }
            }
            if (empty > 0) s += empty;
            if (r > 0) s += '/';
        }
        return s;
    }

    _stateFields() {
        let s = this.whiteToMove ? ' w ' : ' b ';
        if (this.castling === 0) {
            s += '-';
        } else {
            if (this.castling & 1) s += 'K';
            if (this.castling & 2) s += 'Q';
            if (this.castling & 4) s += 'k';
            if (this.castling & 8) s += 'q';
        }
        s += ' ' + (this._epCaptureLegalFlag ? sqName(this.ep) : '-');
        return s;
    }

    get key() {
        if (this._key === undefined) {
            this._key = this._placement() + this._stateFields();
        }
        return this._key;
    }

    toFen() {
        return `${this._placement()}${this._stateFields()} ${this.halfmove} ${this.fullmove}`;
    }

    san(m) {
        let s = this.sanBody(m);
        const n = this.play(m);
        if (n.inCheck) s += n.legalMoves.length === 0 ? '#' : '+';
        return s;
    }

    sanBody(m) {
        const p = this.board[m.from];
        const t = p & 7;
        if (this.isCastle(m)) return fileOf(m.to) === 6 ? 'O-O' : 'O-O-O';
        let sb = '';
        const capture = this.isCapture(m);
        if (t === PAWN) {
            if (capture) sb += String.fromCharCode(97 + fileOf(m.from));
        } else {
            sb += pieceLetter(t);
            const others = this.legalMoves.filter((it) => it.to === m.to && it.from !== m.from && this.board[it.from] === p);
            if (others.length > 0) {
                const sameFile = others.some((it) => fileOf(it.from) === fileOf(m.from));
                const sameRank = others.some((it) => rankOf(it.from) === rankOf(m.from));
                if (!sameFile) sb += String.fromCharCode(97 + fileOf(m.from));
                else if (!sameRank) sb += String.fromCharCode(49 + rankOf(m.from));
                else sb += sqName(m.from);
            }
        }
        if (capture) sb += 'x';
        sb += sqName(m.to);
        if (m.promo !== 0) sb += '=' + pieceLetter(m.promo);
        return sb;
    }

    parseSan(san) {
        const clean = san.trim().replace(/[+#!?]+$/, '').replace(/0/g, 'O');
        return this.legalMoves.find((m) => this.sanBody(m) === clean) || null;
    }

    static get START() {
        if (!Position._START) Position._START = Position.fromFen(START_FEN);
        return Position._START;
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
            } else if (ch >= '0' && ch <= '9') {
                f += ch.charCodeAt(0) - 48;
            } else {
                b[sq(f, r)] = pieceFromChar(ch);
                f++;
            }
        }
        let c = 0;
        const cs = parts[2] || '-';
        if (cs.includes('K')) c |= 1;
        if (cs.includes('Q')) c |= 2;
        if (cs.includes('k')) c |= 4;
        if (cs.includes('q')) c |= 8;
        const eps = parts[3] || '-';
        return new Position(
            b,
            (parts[1] || 'w') === 'w',
            c,
            eps === '-' ? -1 : sqFromName(eps),
            parseInt(parts[4] || '0', 10) || 0,
            parseInt(parts[5] || '1', 10) || 1,
        );
    }
}

/** Partie : position initiale + suite de coups, avec positions et SAN précalculés. */
export class Line {
    constructor(startFen, initialMovesOrEmpty = [], _pre = null) {
        this.startFen = startFen;
        if (_pre) {
            this.positions = _pre.positions;
            this.moves = _pre.moves;
            this.sans = _pre.sans;
        } else {
            this.positions = [Position.fromFen(startFen)];
            this.moves = [];
            this.sans = [];
            for (const m of initialMovesOrEmpty) this.push(m);
        }
    }

    get size() { return this.moves.length; }
    get last() { return this.positions[this.positions.length - 1]; }

    push(m) {
        const p = this.last;
        this.sans.push(p.san(m));
        this.moves.push(m);
        this.positions.push(p.play(m));
    }

    copy(n = this.size) {
        const k = Math.max(0, Math.min(this.size, n));
        return new Line(this.startFen, [], {
            positions: this.positions.slice(0, k + 1),
            moves: this.moves.slice(0, k),
            sans: this.sans.slice(0, k),
        });
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
        for (const pos of this.positions) {
            if (pos.key === k) count++;
        }
        if (count >= 3) return GameEnd.REPETITION;
        return GameEnd.NONE;
    }

    static fromUci(startFen, uci) {
        const l = new Line(startFen);
        if (!uci) return l;
        for (const tok of uci.split(' ')) {
            if (tok) l.push(Move.fromUci(tok));
        }
        return l;
    }

    static fromMoves(startFen, tokens) {
        const l = new Line(startFen);
        for (const t of tokens) {
            const p = l.last;
            let move = null;
            if (UCI_RE.test(t)) {
                const candidate = Move.fromUci(t);
                if (p.isLegal(candidate)) move = candidate;
            }
            if (!move) move = p.parseSan(t);
            if (!move) throw new Error(`Coup illégal « ${t} » après ${l.sans.join(' ')} (${startFen})`);
            l.push(move);
        }
        return l;
    }

    static fromSan(startFen, sans) {
        const l = new Line(startFen);
        for (const s of sans) {
            const m = l.last.parseSan(s);
            if (!m) throw new Error(`Coup illégal « ${s} » après ${l.sans.join(' ')} (${startFen})`);
            l.push(m);
        }
        return l;
    }
}
