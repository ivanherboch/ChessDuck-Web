import {
    KING,
    PIECE_VALUES,
    Line,
    isWhite,
    pieceType,
    sqName,
} from '../core/chess.js';
import { PieceLexiconFr } from '../core/piece-fr.js';
import { SpokenFr } from '../core/spoken-fr.js';
import { Tone } from '../ui/common.js';
import { AcademyAssessments } from './academy-assessments.js';

export const THREAT_THEMES = Object.freeze([
    'fork', 'skewer', 'pin', 'discoveredAttack', 'trappedPiece', 'hangingPiece', 'attraction',
]);

export const CAPTURE_THEMES = Object.freeze([
    'hangingPiece', 'capturingDefender', 'trappedPiece', 'fork', 'pin', 'skewer',
]);

function valueOf(type) {
    return PIECE_VALUES[type] || 0;
}

function pointsFr(n) {
    return `${n} point${n > 1 ? 's' : ''}`;
}

export const ReflexKind = Object.freeze({
    THREAT: Object.freeze({
        key: 'THREAT',
        label: 'Quelle est la menace ?',
        question: "L'adversaire vient de jouer. Touchez la pièce qu'il menace de prendre.",
    }),
    CAPTURE: Object.freeze({
        key: 'CAPTURE',
        label: 'Puis-je prendre ?',
        question: 'Cette prise est-elle bonne ? Répondez par oui ou par non.',
    }),
    BLIND: Object.freeze({
        key: 'BLIND',
        label: "Calcul à l'aveugle",
        question: 'Sans les voir joués, suivez les deux coups annoncés, puis touchez la case de départ et la case d\'arrivée du coup suivant.',
    }),
});

export const ReflexDrills = {
    THREAT_THEMES,
    CAPTURE_THEMES,

    threatFrom(p) {
        let line;
        try {
            line = Line.fromUci(p.fen, p.moves);
        } catch {
            return null;
        }
        if (line.size < 4) return null;
        const pos = line.positions[2];
        const follow = line.moves[3];
        if (!line.positions[3].isCapture(follow) || line.moves[2].from === follow.to || line.moves[2].to === follow.to) {
            return null;
        }
        const victim = pos.board[follow.to];
        const attacker = pos.board[follow.from];
        if (victim === 0 || attacker === 0 || isWhite(victim) !== pos.whiteToMove || isWhite(attacker) === pos.whiteToMove) {
            return null;
        }
        if (pieceType(victim) === KING) return null;
        const explanation = `${PieceLexiconFr.definiteCapitalized(pieceType(attacker))} ${sqName(follow.from)} menace de prendre `
            + `votre ${PieceLexiconFr.name(pieceType(victim))} en ${sqName(follow.to)}.`;
        return {
            position: pos,
            lastMove: line.moves[1],
            target: follow.to,
            attacker: follow.from,
            explanation,
        };
    },

    blindFrom(p) {
        let line;
        try {
            line = Line.fromUci(p.fen, p.moves);
        } catch {
            return null;
        }
        if (line.size < 4) return null;
        return {
            start: line.positions[1],
            announced: [line.sans[1], line.sans[2]],
            after: line.positions[3],
            expected: line.moves[3],
            answer: line.sans[3],
        };
    },

    announcedText(b) {
        const n = b.start.fullmove;
        const [a, r] = b.announced;
        return b.start.whiteToMove ? `${n}. ${a} ${r}` : `${n}… ${a} ${n + 1}. ${r}`;
    },

    captureFrom(pos, rnd = Math.random) {
        if (pos.inCheck) return null;
        const options = [];
        for (const m of pos.legalMoves) {
            if (pos.board[m.to] === 0 || m.promo !== 0) continue;
            const victim = pieceType(pos.board[m.to]);
            const attacker = pieceType(pos.board[m.from]);
            if (attacker === KING) continue;
            const defended = pos.play(m).legalMoves.some((x) => x.to === m.to);
            const gain = valueOf(victim) - (defended ? valueOf(attacker) : 0);
            if (gain >= -1 && gain <= 1) continue;
            options.push({ m, gain, defended });
        }
        if (options.length === 0) return null;
        const { m, gain, defended } = options[Math.floor(rnd() * options.length)];
        const victim = pieceType(pos.board[m.to]);
        const attacker = pieceType(pos.board[m.from]);
        const target = `${PieceLexiconFr.definite(victim)} en ${sqName(m.to)}`;
        const fem = PieceLexiconFr.isFeminine(victim) ? 'e' : '';
        let explanation;
        if (gain > 0 && !defended) {
            explanation = `Oui : ${target} n'est pas protégé${fem}. Vous gagnez ${pointsFr(valueOf(victim))}.`;
        } else if (gain > 0) {
            explanation = `Oui : ${target} est protégé${fem}, mais vous échangez votre ${PieceLexiconFr.name(attacker)} contre une pièce plus forte : vous gagnez ${pointsFr(gain)}.`;
        } else {
            explanation = `Non : ${target} est protégé${fem}. Vous donneriez votre ${PieceLexiconFr.name(attacker)} pour ${PieceLexiconFr.indefinite(victim)} : vous perdriez ${pointsFr(-gain)}.`;
        }
        return {
            position: pos,
            capture: m,
            good: gain > 0,
            explanation,
        };
    },
};

export function reflexSessionPosition(s) {
    if (!s) return null;
    if (s.threat) return s.threat.position;
    if (s.capture) return s.capture.position;
    if (s.blind) return (s.shown || s.answered) ? s.blind.after : s.blind.start;
    return null;
}

export class ReflexTrainer {
    constructor(db, engine, { rnd = Math.random, onFinished = null, speak = () => {} } = {}) {
        this.db = db;
        this.engine = engine;
        this.rnd = rnd;
        this.onFinished = onFinished;
        this.speak = speak;
        this.state = null;
        this._queue = [];
        this._subs = new Set();
        this._runId = 0;
        this._abortCtrl = null;
        this._engineOk = true;
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

    async start(kind, level, total = 5) {
        this._abortCtrl?.abort();
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this._abortCtrl = ctrl;
        const runId = ++this._runId;

        this._queue = [];
        this._engineOk = true;
        this.state = {
            kind,
            total,
            index: 0,
            results: [],
            threat: null,
            capture: null,
            blind: null,
            from: -1,
            shown: false,
            prompt: '',
            answered: false,
            tapped: -1,
            loading: true,
            finished: false,
            message: 'Préparation des exercices…',
            tone: Tone.INFO,
            pulse: null,
        };
        this._emit();

        const range = AcademyAssessments.levelRange(level);
        const themes = kind === ReflexKind.THREAT
            ? THREAT_THEMES
            : kind === ReflexKind.CAPTURE
                ? CAPTURE_THEMES
                : null;
        let exclude = '';
        for (let attempt = 0; attempt < total * 8 && this._queue.length < total; attempt++) {
            if (runId !== this._runId || ctrl?.signal.aborted) return;
            let id = null;
            try {
                id = await this.db.randomId(themes, range, exclude);
            } catch {
                id = null;
            }
            if (!id || runId !== this._runId) break;
            exclude = id;
            let p = null;
            try {
                p = await this.db.byId(id);
            } catch {
                p = null;
            }
            if (!p || runId !== this._runId) continue;
            let item = null;
            if (kind === ReflexKind.THREAT) {
                item = ReflexDrills.threatFrom(p);
            } else if (kind === ReflexKind.CAPTURE) {
                let pos1 = null;
                try { pos1 = Line.fromUci(p.fen, p.moves).positions[1]; } catch { pos1 = null; }
                const cap = pos1 ? ReflexDrills.captureFrom(pos1, this.rnd) : null;
                if (cap && await this._confirmed(cap, ctrl?.signal)) item = cap;
            } else {
                item = ReflexDrills.blindFrom(p);
            }
            if (runId !== this._runId || ctrl?.signal.aborted) return;
            if (item && !this._hasDuplicate(item)) this._queue.push(item);
        }
        if (runId !== this._runId || ctrl?.signal.aborted) return;
        if (this._queue.length === 0) {
            this.state = {
                ...this.state,
                total: 0,
                loading: false,
                finished: true,
                message: 'Aucun exercice disponible pour ce palier.',
            };
            this._emit();
            return;
        }
        this.state = { ...this.state, total: this._queue.length, loading: false };
        this._show(0);
    }

    _hasDuplicate(item) {
        if (item.start) return this._queue.some((q) => q.start?.toFen() === item.start.toFen());
        if (item.capture) return this._queue.some((q) => q.capture?.uci === item.capture?.uci && q.position?.toFen() === item.position?.toFen());
        return this._queue.some((q) => q.position?.toFen() === item.position?.toFen() && q.target === item.target);
    }

    async _confirmed(c, signal) {
        if (!this._engineOk || !this.engine) return true;
        try {
            const bestRes = await this.engine.search(c.position.toFen(), 200, { signal });
            if (!bestRes || bestRes.aborted || bestRes.score == null) {
                this._engineOk = false;
                return true;
            }
            const after = c.position.play(c.capture);
            if (after.legalMoves.length === 0) return c.good;
            const replyRes = await this.engine.search(after.toFen(), 200, { signal });
            if (!replyRes || replyRes.aborted || replyRes.score == null) {
                this._engineOk = false;
                return true;
            }
            const engineGood = bestRes.score - (-replyRes.score) <= 150;
            return engineGood === c.good;
        } catch {
            this._engineOk = false;
            return true;
        }
    }

    _show(index) {
        const s = this.state;
        if (!s) return;
        const item = this._queue[index];
        const threat = s.kind === ReflexKind.THREAT ? item : null;
        const capture = s.kind === ReflexKind.CAPTURE ? item : null;
        const blind = s.kind === ReflexKind.BLIND ? item : null;
        const prompt = `Question ${index + 1} sur ${this._queue.length}. ${s.kind.question}`
            + (blind ? ` Coups annoncés : ${ReflexDrills.announcedText(blind)}.` : '');
        this.state = {
            ...s,
            index,
            answered: false,
            tapped: -1,
            from: -1,
            shown: false,
            tone: Tone.INFO,
            threat,
            capture,
            blind,
            prompt,
            message: prompt,
        };
        this._emit();
        if (blind) this.announce(blind);
    }

    announce(b = this.state?.blind) {
        if (!b) return;
        const side = b.after.whiteToMove ? 'des Blancs' : 'des Noirs';
        this.speak(SpokenFr.text(
            `Coups annoncés : ${SpokenFr.move(b.announced[0])}, puis ${SpokenFr.move(b.announced[1])}. Quel est le coup suivant ${side} ?`,
        ));
    }

    note(text) {
        const s = this.state;
        if (!s || s.answered || s.finished) return;
        this.state = {
            ...s,
            message: `${s.prompt}\n\n${text}`,
            tone: Tone.GOLD,
        };
        this._emit();
    }

    showBoard() {
        const s = this.state;
        if (!s || !s.blind || s.answered) return;
        this.state = { ...s, shown: true };
        this._emit();
    }

    tap(sqIdx) {
        const s = this.state;
        if (!s || s.answered) return;
        if (s.blind) return this._blindTap(s, s.blind, sqIdx);
        const t = s.threat;
        if (!t) return;
        const ok = sqIdx === t.target;
        this.state = {
            ...s,
            answered: true,
            tapped: sqIdx,
            results: [...s.results, ok],
            tone: ok ? Tone.GOOD : Tone.BAD,
            pulse: { id: ++this._pulses, good: ok },
            message: (ok ? 'Bien vu ! ' : "Ce n'est pas la pièce menacée. ") + t.explanation,
        };
        this._emit();
    }

    _blindTap(s, b, sqIdx) {
        if (s.from < 0 || s.from === sqIdx) {
            const from = s.from === sqIdx ? -1 : sqIdx;
            this.state = {
                ...s,
                from,
                tone: Tone.INFO,
                message: from < 0
                    ? s.prompt
                    : `${s.prompt}\n\nDépart : ${sqName(from)}. Touchez maintenant la case d'arrivée.`,
            };
            this._emit();
            return;
        }
        const right = s.from === b.expected.from && sqIdx === b.expected.to;
        const ok = right && !s.shown;
        let message;
        if (ok) message = `Bien calculé ! Le coup suivant était ${b.answer}.`;
        else if (right) message = `Exact : ${b.answer}. Vous avez réaffiché l'échiquier : réessayez sans le regarder.`;
        else message = `Ce n'est pas le bon coup. Il fallait jouer ${b.answer}. Regardez la position après les coups annoncés.`;
        this.state = {
            ...s,
            answered: true,
            tapped: sqIdx,
            results: [...s.results, ok],
            tone: right ? Tone.GOOD : Tone.BAD,
            pulse: { id: ++this._pulses, good: right },
            message,
        };
        this._emit();
    }

    answer(yes) {
        const s = this.state;
        const c = s?.capture;
        if (!s || !c || s.answered) return;
        const ok = yes === c.good;
        this.state = {
            ...s,
            answered: true,
            results: [...s.results, ok],
            tone: ok ? Tone.GOOD : Tone.BAD,
            pulse: { id: ++this._pulses, good: ok },
            message: (ok ? 'Exact. ' : 'Pas tout à fait. ') + c.explanation,
        };
        this._emit();
    }

    next() {
        const s = this.state;
        if (!s || !s.answered) return;
        if (s.index + 1 < this._queue.length) return this._show(s.index + 1);
        const score = s.results.filter(Boolean).length;
        this.state = {
            ...s,
            finished: true,
            tone: score * 5 >= s.total * 4 ? Tone.GOOD : Tone.GOLD,
            message: `${score} sur ${s.total}. ` + (score * 5 >= s.total * 4
                ? 'Excellent réflexe !'
                : 'Recommencez pour l\'automatiser : ce réflexe évite les gaffes.'),
        };
        this._emit();
        if (this.onFinished) {
            Promise.resolve(this.onFinished(s.kind, score, s.total)).catch(() => {});
        }
    }

    stop() {
        this._abortCtrl?.abort();
        this._runId++;
        this.state = null;
        this._emit();
    }
}
