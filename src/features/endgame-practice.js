import {
    KING,
    PAWN,
    QUEEN,
    ROOK,
    Position,
    fileOf,
    isWhite,
    pieceType,
    rankOf,
    sq,
} from '../core/chess.js';
import { MATE, isMateScore } from '../core/stockfish.js';
import { Tone } from '../ui/common.js';
import { moveAnim, undoAnim } from '../ui/line-playback.js';

export const EndgameGoal = Object.freeze({
    WIN: 'WIN',
    DRAW: 'DRAW',
});

function makeFamily(name, label, goal, maxMoves, task, method) {
    const heroWhite = goal === EndgameGoal.WIN;
    const cap = task.charAt(0).toUpperCase() + task.slice(1);
    const instruction = goal === EndgameGoal.WIN
        ? `${cap} en ${maxMoves} coups au plus.`
        : `${cap} pendant ${maxMoves} coups.`;
    return Object.freeze({ name, label, goal, maxMoves, task, method, heroWhite, instruction });
}

export const EndgameFamily = Object.freeze({
    KQK: makeFamily(
        'KQK',
        'Roi et dame contre roi',
        EndgameGoal.WIN,
        12,
        'matez le roi noir',
        "La dame seule coupe le roi noir, votre roi se rapproche, et l'on pousse le roi adverse sur un bord avant de mater (attention au pat).",
    ),
    KRRK: makeFamily(
        'KRRK',
        'Deux tours contre roi',
        EndgameGoal.WIN,
        8,
        'matez le roi noir',
        "Les deux tours donnent l'escalier : l'une barre une rangée, l'autre chasse le roi sur la rangée suivante jusqu'au bord.",
    ),
    KRK: makeFamily(
        'KRK',
        'Roi et tour contre roi',
        EndgameGoal.WIN,
        25,
        'matez le roi noir',
        'La tour coupe le roi noir et rétrécit sa boîte, votre roi vient se placer en face du sien, puis la tour mate sur le bord.',
    ),
    KBBK: makeFamily(
        'KBBK',
        'Les deux fous',
        EndgameGoal.WIN,
        30,
        'matez le roi noir',
        "Les deux fous côte à côte forment un mur, votre roi les soutient, et l'on repousse le roi noir vers un coin, sans le mettre pat.",
    ),
    KPK_WIN: makeFamily(
        'KPK_WIN',
        'Roi et pion contre roi',
        EndgameGoal.WIN,
        20,
        'menez votre pion à dame',
        "Le roi passe devant son pion et gagne une case clé, deux rangées devant lui. Ne poussez le pion que quand la route est sûre : si le roi noir prend l'opposition devant le pion, c'est nul.",
    ),
    LUCENA: makeFamily(
        'LUCENA',
        'Position de Lucena',
        EndgameGoal.WIN,
        25,
        'menez votre pion à dame',
        'Construisez le pont : la tour vient sur la quatrième rangée pour abriter le roi des échecs, puis le pion va à dame.',
    ),
    PHILIDOR_DRAW: makeFamily(
        'PHILIDOR_DRAW',
        'Défense de Philidor',
        EndgameGoal.DRAW,
        15,
        'tenez la nulle',
        "Gardez la tour sur votre troisième rangée pour empêcher le roi blanc d'avancer ; dès que le pion y arrive, donnez des échecs par derrière.",
    ),
    ROOK_PAWN_DRAW: makeFamily(
        'ROOK_PAWN_DRAW',
        'Pion tour : la nulle',
        EndgameGoal.DRAW,
        15,
        'tenez la nulle',
        "Gardez votre roi dans le coin, devant le pion tour : personne ne peut l'en chasser.",
    ),
    KQKP: makeFamily(
        'KQKP',
        'Dame contre pion en septième',
        EndgameGoal.WIN,
        25,
        'gagnez le pion ou matez',
        "Par des échecs et des attaques du pion, forcez le roi noir à se placer devant son pion ; chaque fois, rapprochez votre roi d'un pas.",
    ),
    QUEEN_BISHOP_PAWN_DRAW: makeFamily(
        'QUEEN_BISHOP_PAWN_DRAW',
        'Dame contre pion fou : le pat',
        EndgameGoal.DRAW,
        15,
        'tenez la nulle',
        'Réfugiez votre roi dans le coin, à côté du pion : si la dame prend le pion, c\'est pat.',
    ),
    VANCURA_DRAW: makeFamily(
        'VANCURA_DRAW',
        'Défense Vancura',
        EndgameGoal.DRAW,
        15,
        'tenez la nulle',
        "Votre tour attaque le pion tour de côté ; donnez des échecs dès que le roi blanc s'approche du pion.",
    ),
    of(name) {
        return ENDGAME_FAMILIES.find((f) => f.name === name) || null;
    },
});

export const ENDGAME_FAMILIES = Object.freeze([
    EndgameFamily.KQK,
    EndgameFamily.KRRK,
    EndgameFamily.KRK,
    EndgameFamily.KBBK,
    EndgameFamily.KPK_WIN,
    EndgameFamily.LUCENA,
    EndgameFamily.PHILIDOR_DRAW,
    EndgameFamily.ROOK_PAWN_DRAW,
    EndgameFamily.KQKP,
    EndgameFamily.QUEEN_BISHOP_PAWN_DRAW,
    EndgameFamily.VANCURA_DRAW,
]);

function dist(a, b) {
    return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}

function rndInt(rnd, n) {
    return Math.floor(rnd() * n);
}

function pick(arr, rnd) {
    return arr[rndInt(rnd, arr.length)];
}

export const EndgamePositions = {
    generate(family, rnd = Math.random) {
        for (let i = 0; i < 5000; i++) {
            const pos = this._candidate(family, rnd);
            if (pos) return pos;
        }
        throw new Error(`aucune position trouvée pour ${family.name}`);
    },

    fen(pieces, whiteToMove) {
        const board = new Array(64).fill(null);
        for (const [q, p] of pieces) {
            if (board[q] !== null) return '';
            board[q] = p;
        }
        const rows = [];
        for (let r = 7; r >= 0; r--) {
            let row = '';
            let empty = 0;
            for (let fl = 0; fl < 8; fl++) {
                const p = board[sq(fl, r)];
                if (p === null) empty++;
                else {
                    if (empty > 0) {
                        row += String(empty);
                        empty = 0;
                    }
                    row += p;
                }
            }
            if (empty > 0) row += String(empty);
            rows.push(row);
        }
        return `${rows.join('/')} ${whiteToMove ? 'w' : 'b'} - - 0 1`;
    },

    _valid(fenStr, family) {
        if (!fenStr) return null;
        let p;
        try {
            p = Position.fromFen(fenStr);
        } catch {
            return null;
        }
        const wk = p.kingSquare(true);
        const bk = p.kingSquare(false);
        if (wk < 0 || bk < 0 || dist(wk, bk) < 2) return null;
        if (p.inCheck) return null;
        const flippedSide = p.whiteToMove
            ? fenStr.replace(' w ', ' b ')
            : fenStr.replace(' b ', ' w ');
        try {
            if (Position.fromFen(flippedSide).inCheck) return null;
        } catch {
            return null;
        }
        if (p.legalMoves.length === 0) return null;
        return family.heroWhite === p.whiteToMove ? p : null;
    },

    _candidate(family, rnd) {
        const any = () => rndInt(rnd, 64);
        const center = () => sq(2 + rndInt(rnd, 4), 2 + rndInt(rnd, 4));
        const mirror = rnd() < 0.5;
        const m = (q) => (mirror ? sq(7 - fileOf(q), rankOf(q)) : q);

        switch (family.name) {
        case 'KQK':
        case 'KRK':
        case 'KRRK':
        case 'KBBK': {
            const bk = center();
            const pieces = [[bk, 'k'], [any(), 'K']];
            if (family.name === 'KQK') pieces.push([any(), 'Q']);
            else if (family.name === 'KRK') pieces.push([any(), 'R']);
            else if (family.name === 'KRRK') {
                pieces.push([any(), 'R']);
                pieces.push([any(), 'R']);
            } else {
                let light;
                do { light = any(); } while ((fileOf(light) + rankOf(light)) % 2 !== 1);
                let dark;
                do { dark = any(); } while ((fileOf(dark) + rankOf(dark)) % 2 !== 0);
                pieces.push([light, 'B']);
                pieces.push([dark, 'B']);
            }
            if (pieces.slice(2).some(([q]) => dist(q, bk) < 2)) return null;
            return this._valid(this.fen(pieces, true), family);
        }
        case 'KPK_WIN': {
            const pf = 1 + rndInt(rnd, 6);
            const pr = 1 + rndInt(rnd, 4);
            const pawn = sq(pf, pr);
            const wk = sq(pf - 1 + rndInt(rnd, 3), pr + 2);
            const bk = any();
            if (dist(bk, pawn) < 2 || rankOf(bk) <= pr) return null;
            return this._valid(this.fen([[pawn, 'P'], [wk, 'K'], [bk, 'k']], true), family);
        }
        case 'LUCENA': {
            const pf = 2 + rndInt(rnd, 4);
            const dir = rnd() < 0.5 ? 1 : -1;
            const bkFile = pf + 2 * dir;
            const rookFile = pf + dir;
            const farFiles = [];
            for (let i = 0; i < 8; i++) {
                if (i * dir < (pf - dir) * dir) farFiles.push(i);
            }
            if (bkFile < 0 || bkFile > 7 || farFiles.length === 0) return null;
            const pieces = [
                [sq(pf, 6), 'P'],
                [sq(pf, 7), 'K'],
                [sq(bkFile, 5 + rndInt(rnd, 2)), 'k'],
                [sq(rookFile, rndInt(rnd, 3)), 'R'],
                [sq(pick(farFiles, rnd), rndInt(rnd, 3)), 'r'],
            ];
            return this._valid(this.fen(pieces, true), family);
        }
        case 'PHILIDOR_DRAW': {
            const pf = 2 + rndInt(rnd, 4);
            let rookCol;
            do { rookCol = rndInt(rnd, 8); } while (Math.abs(rookCol - pf) < 2);
            let wRookCol;
            do { wRookCol = rndInt(rnd, 8); } while (Math.abs(wRookCol - pf) < 2 || wRookCol === rookCol);
            const pieces = [
                [m(sq(pf, 3)), 'P'],
                [m(sq(pf, 4)), 'K'],
                [m(sq(pf, 7)), 'k'],
                [m(sq(rookCol, 5)), 'r'],
                [m(sq(wRookCol, 6)), 'R'],
            ];
            return this._valid(this.fen(pieces, false), family);
        }
        case 'ROOK_PAWN_DRAW': {
            const pr = 3 + rndInt(rnd, 3);
            const pawn = m(sq(7, pr));
            const bk = m(pick([sq(7, 7), sq(6, 7), sq(6, 6), sq(7, 6)], rnd));
            const wk = m(sq(4 + rndInt(rnd, 3), pr - 1 + rndInt(rnd, 3)));
            return this._valid(this.fen([[pawn, 'P'], [bk, 'k'], [wk, 'K']], false), family);
        }
        case 'KQKP': {
            const pf = pick([1, 3, 4, 6], rnd);
            const pawn = sq(pf, 1);
            const bkFile = pf + pick([-1, 1], rnd);
            if (bkFile < 0 || bkFile > 7) return null;
            const bk = sq(bkFile, 1 + rndInt(rnd, 2));
            let qf;
            do { qf = rndInt(rnd, 8); } while (Math.abs(qf - pf) < 3);
            const queen = sq(qf, 0);
            const wk = sq(rndInt(rnd, 8), 3 + rndInt(rnd, 5));
            if (dist(queen, bk) < 2 || dist(wk, pawn) < 4) return null;
            return this._valid(this.fen([[pawn, 'p'], [bk, 'k'], [queen, 'Q'], [wk, 'K']], true), family);
        }
        case 'QUEEN_BISHOP_PAWN_DRAW': {
            const pawn = m(sq(2, 1));
            const bk = m(pick([sq(1, 1), sq(1, 0)], rnd));
            const queen = any();
            const wk = sq(rndInt(rnd, 8), 4 + rndInt(rnd, 4));
            if (dist(queen, bk) < 2 || dist(wk, pawn) < 5 || queen === m(sq(2, 0))) return null;
            return this._valid(this.fen([[pawn, 'p'], [bk, 'k'], [queen, 'Q'], [wk, 'K']], false), family);
        }
        case 'VANCURA_DRAW': {
            const pieces = [
                [m(sq(0, 5)), 'P'],
                [m(sq(0, 7)), 'R'],
                [m(sq(5, 5)), 'r'],
                [m(pick([sq(6, 6), sq(7, 6)], rnd)), 'k'],
                [m(sq(2 + rndInt(rnd, 6), rndInt(rnd, 4))), 'K'],
            ];
            return this._valid(this.fen(pieces, false), family);
        }
        default:
            return null;
        }
    },
};

export const ENDGAME_PASS = 3;
export const ENDGAME_WIN_CP = 250;
export const ENDGAME_DROP_CP = 150;
export const ENDGAME_ENGINE_WAIT = 10000;
const PAWN_FAMILIES = new Set(['KPK_WIN', 'LUCENA']);

function noPawns(p) {
    for (let i = 0; i < 64; i++) {
        if (pieceType(p.board[i]) === PAWN) return false;
    }
    return true;
}

function onlyKing(p, white) {
    for (let i = 0; i < 64; i++) {
        const pc = p.board[i];
        if (pc !== 0 && isWhite(pc) === white && pieceType(pc) !== KING) return false;
    }
    return true;
}

function hasMajor(p, white) {
    for (let i = 0; i < 64; i++) {
        const pc = p.board[i];
        if (pc !== 0 && isWhite(pc) === white && (pieceType(pc) === ROOK || pieceType(pc) === QUEEN)) {
            return true;
        }
    }
    return false;
}

export class EndgameTrainer {
    constructor(engine, { rnd = Math.random, movetimeMs = 400, onFinished = null } = {}) {
        this.engine = engine;
        this.rnd = rnd;
        this.movetimeMs = movetimeMs;
        this.onFinished = onFinished;
        this.state = null;
        this._subs = new Set();
        this._runId = 0;
        this._abortCtrl = null;
        this._hintAbortCtrl = null;
        this._prepAbortCtrl = null;
        this._prepFen = null;
        this._prepPromise = null;
        this._pulses = 0;
    }

    subscribe(fn) {
        this._subs.add(fn);
        fn(this.state);
        return () => this._subs.delete(fn);
    }

    _emit() {
        for (const fn of this._subs) fn(this.state);
    }

    _clearPrepared() {
        this._prepAbortCtrl?.abort();
        this._prepAbortCtrl = null;
        this._prepFen = null;
        this._prepPromise = null;
    }

    /**
     * Analyse la position où l'élève a le trait pendant sa réflexion : fournit la référence d'avant coup
     * (pour détecter une vraie baisse d'évaluation) et rend l'indice immédiat.
     */
    _prepare(p) {
        if (!p || !this.engine) return;
        const fen = p.toFen();
        if (this._prepFen === fen && this._prepPromise) return;
        this._clearPrepared();
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this._prepAbortCtrl = ctrl;
        this._prepFen = fen;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), ENDGAME_ENGINE_WAIT) : null;
        this._prepPromise = Promise.resolve()
            .then(() => this.engine.search(fen, this.movetimeMs, { signal: ctrl?.signal }))
            .then((res) => (res && !res.aborted ? res : null))
            .catch(() => null)
            .finally(() => {
                if (timer) clearTimeout(timer);
            });
    }

    async _prepared(fen, signal) {
        if (!this._prepPromise || this._prepFen !== fen) return null;
        const p = this._prepPromise;
        if (!signal) return p;
        if (signal.aborted) return null;
        return new Promise((resolve) => {
            const onAbort = () => resolve(null);
            signal.addEventListener('abort', onAbort, { once: true });
            p.then(
                (res) => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(signal.aborted ? null : res);
                },
                () => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(null);
                },
            );
        });
    }

    async _searchWithWait(fen, signal) {
        if (!this.engine || signal?.aborted) return null;
        const sub = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const onAbort = () => sub?.abort();
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        const timer = sub ? setTimeout(() => sub.abort(), ENDGAME_ENGINE_WAIT) : null;
        try {
            const res = await this.engine.search(fen, this.movetimeMs, { signal: sub?.signal });
            if (signal?.aborted || !res || res.aborted) return null;
            return res;
        } catch {
            return null;
        } finally {
            if (timer) clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        }
    }

    start(family, total = 5) {
        this._cancelJobs();
        this._runId++;
        this.state = {
            family,
            index: 0,
            total,
            results: [],
            position: null,
            start: null,
            last: null,
            anim: null,
            moves: 0,
            thinking: false,
            hint: null,
            hintStage: 0,
            hinting: false,
            over: false,
            finished: false,
            message: '',
            tone: Tone.INFO,
            evalWhite: null,
            punish: null,
            replay: false,
            pulse: null,
            better: null,
            before: null,
            beforeMoves: 0,
        };
        this._show(0);
    }

    stop() {
        this._cancelJobs();
        this._runId++;
        this.state = null;
        this._emit();
    }

    _cancelJobs({ keepPrep = false } = {}) {
        this._abortCtrl?.abort();
        this._abortCtrl = null;
        this._hintAbortCtrl?.abort();
        this._hintAbortCtrl = null;
        if (!keepPrep) this._clearPrepared();
    }

    _heroToMove(s = this.state) {
        return Boolean(s && s.position && !s.over && !s.thinking && s.position.whiteToMove === s.family.heroWhite);
    }

    _show(index) {
        if (!this.state) return;
        const f = this.state.family;
        const p = EndgamePositions.generate(f, this.rnd);
        this._hintAbortCtrl?.abort();
        this._clearPrepared();
        this.state = {
            ...this.state,
            index,
            position: p,
            start: p,
            last: null,
            anim: null,
            moves: 0,
            thinking: false,
            hint: null,
            hintStage: 0,
            hinting: false,
            over: false,
            evalWhite: null,
            punish: null,
            replay: false,
            better: null,
            before: null,
            beforeMoves: 0,
            tone: Tone.INFO,
            message: `Position ${index + 1} sur ${this.state.total} : ${f.instruction}\n\nMéthode : ${f.method}`,
        };
        this._emit();
        if (p.whiteToMove === f.heroWhite) this._prepare(p);
    }

    retry() {
        const s = this.state;
        if (!s || !s.over || s.finished || !s.start || s.results[s.results.length - 1] !== false) return;
        this._cancelJobs();
        this._runId++;
        const back = s.before;
        const resumePos = back || s.start;
        this.state = {
            ...s,
            position: resumePos,
            last: null,
            anim: null,
            moves: back ? s.beforeMoves : 0,
            thinking: false,
            hint: null,
            hintStage: 0,
            hinting: false,
            over: false,
            evalWhite: null,
            punish: null,
            replay: true,
            before: null,
            tone: Tone.INFO,
            message: back && s.better
                ? `Entraînement (hors score) : rejouez ce coup. La flèche verte montre le bon coup. ${s.family.method}`
                : `Entraînement (hors score) : rejouez la position. ${s.family.method}`,
        };
        this._emit();
        this._prepare(resumePos);
    }

    next() {
        const s = this.state;
        if (!s || !s.over) return;
        if (s.index + 1 < s.total) {
            this._show(s.index + 1);
        } else {
            const score = s.results.filter(Boolean).length;
            this.state = {
                ...s,
                finished: true,
                tone: score >= ENDGAME_PASS ? Tone.GOOD : Tone.GOLD,
                message: `${score} sur ${s.total} : ` + (score >= ENDGAME_PASS
                    ? 'vous maîtrisez cette finale.'
                    : `il en faut ${ENDGAME_PASS} pour valider. Relisez la leçon, puis réessayez.`),
            };
            this._emit();
            if (this.onFinished) {
                Promise.resolve(this.onFinished(s.family, score, s.total)).catch(() => {});
            }
        }
    }

    async hint() {
        const s = this.state;
        if (!this._heroToMove(s) || s.hinting) return;
        if (s.hint && s.hintStage === 1) {
            this.state = {
                ...s,
                hintStage: 2,
                tone: Tone.GOLD,
                message: 'Indice 2/2 : suivez la flèche verte.',
            };
            this._emit();
            return;
        }
        if (s.hint) return;
        this._hintAbortCtrl?.abort();
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this._hintAbortCtrl = ctrl;
        const fen = s.position.toFen();
        const runId = this._runId;
        this.state = {
            ...s,
            hinting: true,
            tone: Tone.INFO,
            message: "L'Ordinateur cherche un bon coup…",
        };
        this._emit();

        const pre = await this._prepared(fen, ctrl?.signal);
        let best = pre?.best || null;
        if (!best && runId === this._runId && !ctrl?.signal.aborted) {
            const res = await this._searchWithWait(fen, ctrl?.signal);
            best = res?.best || null;
        }
        if (runId !== this._runId || ctrl?.signal.aborted || !this.state) return;
        if (this.state.position?.toFen() !== fen) {
            this.state = { ...this.state, hinting: false };
            this._emit();
            return;
        }
        this.state = {
            ...this.state,
            hinting: false,
            hint: best,
            hintStage: best ? 1 : 0,
            tone: Tone.GOLD,
            message: best ? 'Indice 1/2 : la pièce à jouer est surlignée en vert.' : 'Indice indisponible.',
        };
        this._emit();
    }

    async move(m) {
        const s = this.state;
        const pos = s?.position;
        if (!this._heroToMove(s) || !pos || !pos.isLegal(m)) return;
        this._cancelJobs({ keepPrep: true });
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this._abortCtrl = ctrl;
        const runId = this._runId;

        const after = pos.play(m);
        const moves = s.moves + 1;
        this.state = {
            ...s,
            position: after,
            last: m,
            anim: moveAnim(pos, m),
            moves,
            thinking: true,
            hint: null,
            hintStage: 0,
            hinting: false,
            better: null,
        };
        this._emit();

        const f = s.family;
        const promoted = m.promo !== 0;
        if (after.isCheckmate) {
            return this._end(true, `Échec et mat ! Position gagnée en ${moves} coup${moves > 1 ? 's' : ''}.`);
        }
        if (after.legalMoves.length === 0) {
            return this._end(
                f.goal === EndgameGoal.DRAW,
                f.goal === EndgameGoal.WIN
                    ? 'Pat ! La partie est nulle : laissez toujours une case au roi adverse.'
                    : 'Pat : la nulle est acquise.',
            );
        }
        if (f.goal === EndgameGoal.DRAW && noPawns(after)) return this._pawnGone(after);
        if (f.name === 'KQKP' && noPawns(after)) {
            return this._end(true, 'Le pion est tombé : avec la dame contre le roi seul, le gain est assuré.');
        }
        if (f.goal === EndgameGoal.WIN && noPawns(after) && PAWN_FAMILIES.has(f.name) && !promoted) {
            if (onlyKing(after, !f.heroWhite) && hasMajor(after, f.heroWhite)) {
                return this._end(true, 'Le pion a disparu, mais il vous reste une pièce lourde contre le roi seul : le gain est assuré.');
            }
            return this._end(false, "Le pion est perdu : le gain s'est envolé.");
        }

        // Référence d'avant coup préparée pendant la réflexion de l'élève.
        const ref = await this._prepared(pos.toFen(), ctrl?.signal);
        if (runId !== this._runId || ctrl?.signal.aborted || !this.state) return;

        const res = await this._searchWithWait(after.toFen(), ctrl?.signal);
        if (runId !== this._runId || ctrl?.signal.aborted || !this.state) return;

        const reply = res?.best && after.isLegal(res.best) ? res.best : null;
        if (res?.score == null || !reply) {
            this._clearPrepared();
            this.state = {
                ...this.state,
                position: pos,
                last: null,
                anim: undoAnim(pos, m),
                moves: s.moves,
                thinking: false,
                tone: Tone.GOLD,
                message: "L'Ordinateur n'a pas répondu à temps : rejouez votre coup.",
            };
            this._emit();
            this._prepare(pos);
            return;
        }
        const mine = -res.score;
        const below = f.goal === EndgameGoal.WIN
            ? !(isMateScore(mine) && mine > 0) && mine < ENDGAME_WIN_CP
            : mine < -ENDGAME_WIN_CP;
        const beforeScore = ref?.score ?? null;
        const lost = below && (beforeScore === null || (beforeScore - mine) >= ENDGAME_DROP_CP);
        const ev = f.heroWhite ? mine : -mine;

        if (lost) {
            let cand = ref?.best || null;
            if (!cand) {
                const bestRes = await this._searchWithWait(pos.toFen(), ctrl?.signal);
                if (runId !== this._runId || ctrl?.signal.aborted || !this.state) return;
                cand = bestRes?.best || null;
            }
            const best = (cand && !cand.equals(m) && pos.isLegal(cand)) ? cand : null;

            await new Promise((r) => setTimeout(r, 450));
            if (runId !== this._runId || ctrl?.signal.aborted || !this.state) return;
            const punished = after.play(reply);
            this.state = {
                ...this.state,
                position: punished,
                last: reply,
                anim: moveAnim(after, reply),
                punish: reply,
                better: best,
                before: pos,
                beforeMoves: s.moves,
            };
            const san = pos.san(m);
            const text = (f.goal === EndgameGoal.WIN ? `${san} laisse échapper le gain` : `${san} perd la nulle`)
                + ` : l'Ordinateur répond ${after.san(reply)}.`
                + (best ? ` Il fallait jouer ${pos.san(best)}.` : '')
                + `\n\nMéthode : ${f.method}\n\nReprenez le coup pour vous entraîner, ou passez à la position suivante.`;
            return this._end(false, text, ev);
        }
        if (f.goal === EndgameGoal.WIN && promoted) {
            return this._end(true, 'Le pion devient dame et le gain est assuré !', ev);
        }
        await new Promise((r) => setTimeout(r, 450));
        if (runId !== this._runId || ctrl?.signal.aborted || !this.state) return;

        const nextPos = after.play(reply);
        this.state = {
            ...this.state,
            position: nextPos,
            last: reply,
            anim: moveAnim(after, reply),
            thinking: false,
        };
        if (nextPos.isCheckmate) return this._end(false, "Échec et mat : l'Ordinateur a gagné.");
        if (nextPos.legalMoves.length === 0) {
            return this._end(
                f.goal === EndgameGoal.DRAW,
                f.goal === EndgameGoal.DRAW ? 'Pat : la nulle est acquise.' : 'Pat : la partie est nulle.',
            );
        }
        if (f.goal === EndgameGoal.DRAW && noPawns(nextPos)) return this._pawnGone(nextPos);
        if (f.goal === EndgameGoal.DRAW && moves >= f.maxMoves) {
            return this._end(true, `Vous avez tenu ${moves} coups : la nulle est acquise.`, ev);
        }
        if (f.goal === EndgameGoal.WIN && moves >= f.maxMoves) {
            return this._end(false, `Trop lent : il fallait conclure en ${f.maxMoves} coups.\n\nMéthode : ${f.method}`, ev);
        }
        this.state = {
            ...this.state,
            tone: Tone.INFO,
            message: `Coup ${moves} sur ${f.maxMoves}. ${f.instruction}`,
        };
        this._emit();
        this._prepare(nextPos);
    }

    _end(ok, text, evalWhite = null) {
        const s = this.state;
        if (!s) return;
        this._clearPrepared();
        const p = s.position;
        let ev = evalWhite;
        if (ev === null) {
            if (p && p.isCheckmate) ev = p.whiteToMove ? -MATE : MATE;
            else if (p && p.legalMoves.length === 0) ev = 0;
            else if (s.family.goal === EndgameGoal.DRAW && ok) ev = 0;
        }
        this.state = {
            ...s,
            over: true,
            thinking: false,
            results: s.replay ? s.results : [...s.results, ok],
            tone: ok ? Tone.GOOD : Tone.BAD,
            message: s.replay ? `${text} (entraînement, hors score)` : text,
            evalWhite: ev,
            pulse: { id: ++this._pulses, good: ok },
        };
        this._emit();
    }

    _pawnGone(p) {
        let queenLeft = false;
        let defenderPieces = false;
        for (let i = 0; i < 64; i++) {
            const pc = p.board[i];
            if (!pc) continue;
            if (pieceType(pc) === QUEEN && isWhite(pc)) queenLeft = true;
            if (!isWhite(pc) && pieceType(pc) !== KING) defenderPieces = true;
        }
        if (queenLeft && !defenderPieces) {
            this._end(false, 'Le pion est tombé : la dame gagne contre le roi seul.');
        } else {
            this._end(true, 'Le pion a disparu : la nulle est acquise.');
        }
    }
}
