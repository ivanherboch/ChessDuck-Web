import {
    KING, KNIGHT, BISHOP, Move, PAWN, PIECE_VALUES, fileOf, isWhite, pieceType, rankOf, sqName,
} from '../core/chess.js';
import { PieceLexiconFr } from '../core/piece-fr.js';
import { mateFor, winPercent } from '../core/stockfish.js';
import { GameLogic } from './game-logic.js';

const Tone = Object.freeze({
    INFO: 'info',
    GOOD: 'good',
    BAD: 'bad',
    NEUTRAL: 'neutral',
    GOLD: 'gold',
});

export class Voice {
    constructor(name, human, white) {
        this.name = name;
        this.human = human;
        this.white = white;
    }

    get label() {
        return `${this.name} (${this.white ? 'Blancs' : 'Noirs'})`;
    }

    f(vous, il) {
        return this.human ? vous : il;
    }
}

const the = (t) => PieceLexiconFr.definite(t);
const it = (t) => PieceLexiconFr.pronoun(t);
const poss = (v, t) => v.f(`votre ${PieceLexiconFr.name(t)}`, PieceLexiconFr.possessive(t));

/** Tendance de la partie, du point de vue des Blancs : -2 … +2. */
function bucket(evalWhite) {
    const w = winPercent(evalWhite);
    if (w >= 86) return 2;
    if (w >= 63) return 1;
    if (w > 37) return 0;
    if (w > 14) return -1;
    return -2;
}

function attackedCheaply(p, sq) {
    const piece = p.board[sq];
    if (piece === 0) return false;
    const attackers = p.attackers(sq, !isWhite(piece));
    if (!attackers.length) return false;
    const defended = p.attackers(sq, isWhite(piece)).length > 0;
    return !defended || attackers.some((att) => PIECE_VALUES[pieceType(p.board[att])] < PIECE_VALUES[pieceType(piece)]);
}

/** Description neutre d'un coup, à la troisième personne. */
function describe(v, p, m, san, prev) {
    const t = pieceType(p.board[m.from]);
    let base;
    if (p.isCastle(m)) {
        base = "roque pour mettre son roi à l'abri";
    } else if (m.promo !== 0) {
        base = `mène son pion à promotion et obtient ${PieceLexiconFr.indefinite(m.promo)}`;
    } else if (p.isCapture(m)) {
        const victim = p.capturedType(m);
        base = (prev != null && prev.to === m.to ? 'reprend en capturant ' : 'capture ') + the(victim) + ` en ${sqName(m.to)}`;
    } else if (p.fullmove <= 12 && (t === KNIGHT || t === BISHOP) && rankOf(m.from) === (v.white ? 0 : 7)) {
        base = `développe ${PieceLexiconFr.possessive(t)}`;
    } else if (t === PAWN && fileOf(m.to) >= 3 && fileOf(m.to) <= 4 && rankOf(m.to) >= 3 && rankOf(m.to) <= 4) {
        base = 'avance un pion au centre';
    } else if (t === PAWN) {
        base = `avance son pion en ${sqName(m.to)}`;
    } else {
        base = `joue ${PieceLexiconFr.possessive(t)} en ${sqName(m.to)}`;
    }
    const tail = san.endsWith('#') ? ' et fait échec et mat !' : (san.endsWith('+') ? ', avec échec.' : '.');
    return `${v.label} ${base}${tail}`;
}

/** Pourquoi le coup joué est fautif : la première explication concrète qui s'applique. */
function explain(v, p, m, san, a0, a1) {
    const after = p.play(m);
    const replyCand = a1.best ? Move.fromUci(a1.best) : null;
    const reply = replyCand && after.isLegal(replyCand) ? replyCand : null;
    const bestCand = a0.best ? Move.fromUci(a0.best) : null;
    const best = bestCand && p.isLegal(bestCand) && !bestCand.equals(m) ? bestCand : null;

    // 1. Le coup autorise un mat rapide.
    const oppMate = mateFor(a1.eval, !p.whiteToMove);
    if (oppMate !== null && reply) {
        if (oppMate <= 2) {
            return `en jouant ${san}, ${v.f('vous permettez', 'il permet')} à l'adversaire de faire échec et mat en ${oppMate} (${after.san(reply)}).`;
        }
        return `${san} laisse l'adversaire lancer une attaque décisive contre ${v.f('votre', 'son')} roi.`;
    }
    // 2. Une pièce est laissée en prise.
    if (reply && after.isCapture(reply)) {
        const victim = after.capturedType(reply);
        const gained = p.isCapture(m) ? PIECE_VALUES[p.capturedType(m)] : 0;
        if (PIECE_VALUES[victim] > gained) {
            const rs = after.san(reply);
            return reply.to === m.to
                ? `en jouant ${san}, ${v.f('vous exposez', 'il expose')} ${poss(v, victim)} : ${rs} peut ${it(victim)} capturer.`
                : `${san} laisse ${poss(v, victim)} en ${sqName(reply.to)} sans protection suffisante : ${rs} ${it(victim)} capture.`;
        }
    }
    if (best) {
        const bs = p.san(best);
        const bt = pieceType(p.board[best.from]);
        // 3. Une capture avantageuse a été manquée.
        if (p.isCapture(best)) {
            const victim = p.capturedType(best);
            const free = p.attackers(best.to, !p.whiteToMove).length === 0;
            if (free || PIECE_VALUES[victim] >= PIECE_VALUES[bt]) {
                return `${v.f('vous avez', 'il a')} manqué l'occasion de capturer ${the(victim)} en ${sqName(best.to)} avec ${bs} : cela ${v.f('vous ', 'lui ')}aurait donné l'avantage.`;
            }
        }
        // 4. Une pièce attaquée n'a pas été mise à l'abri.
        if (attackedCheaply(p, best.from) && bt !== PAWN && bt !== KING && best.from !== m.from) {
            return `${poss(v, bt)} en ${sqName(best.from)} était attaqué${PieceLexiconFr.isFeminine(bt) ? 'e' : ''} : il fallait ${it(bt)} mettre à l'abri avec ${bs}.`;
        }
        // 5. Un échec fort a été manqué.
        if (bs.endsWith('+')) {
            return `${v.f('vous auriez dû', 'il aurait dû')} donner échec avec ${bs} pour garder l'initiative.`;
        }
        // 6. Principes d'ouverture.
        if (p.isCastle(best)) {
            return `${v.f('vous auriez dû', 'il aurait dû')} mettre ${v.f('votre', 'son')} roi à l'abri en roquant (${bs}).`;
        }
        if (p.fullmove <= 14) {
            if ((bt === KNIGHT || bt === BISHOP) && rankOf(best.from) === (p.whiteToMove ? 0 : 7)) {
                return `${v.f('vous auriez dû', 'il aurait dû')} développer ${poss(v, bt)} avec ${bs} pour prendre part à la bataille du centre.`;
            }
            if (bt === PAWN && fileOf(best.to) >= 3 && fileOf(best.to) <= 4 && rankOf(best.to) >= 2 && rankOf(best.to) <= 5) {
                return `${v.f('vous auriez dû', 'il aurait dû')} occuper le centre avec ${bs}.`;
            }
        }
        return `${bs} était plus fort que ${san}.`;
    }
    return `${san} affaiblit ${v.f('votre', 'sa')} position.`;
}

export const ReviewComments = {
    voice(g, white) {
        const human = !g.vsComputer || g.playerWhite === white;
        const stored = (white ? g.whiteName : g.blackName) || '';
        let name;
        if (!human) name = "L'ordinateur";
        else if (stored) name = stored;
        else if (g.vsComputer) name = 'Joueur';
        else name = white ? 'Joueur 1' : 'Joueur 2';
        return new Voice(name, human, white);
    },

    /**
     * Commentaire du coup n° i (indice 0) de la partie. analysis peut être incomplète :
     * on se contente alors de décrire le coup.
     */
    comment(g, line, i, analysis) {
        const p = line.positions[i];
        const m = line.moves[i];
        const san = line.sans[i];
        const v = this.voice(g, p.whiteToMove);
        const prev = i > 0 ? line.moves[i - 1] : null;
        const a0 = analysis?.[i] ?? null;
        const a1 = analysis?.[i + 1] ?? null;
        if (san.endsWith('#')) {
            return { text: `Échec et mat ! ${v.label} conclut la partie avec ${san}.`, tone: Tone.GOOD };
        }
        const plain = describe(v, p, m, san, prev);
        if (!a0 || !a1) return { text: plain, tone: Tone.INFO };

        // Dynamique de la partie : qui a l'avantage après ce coup ?
        const b0 = bucket(a0.eval);
        const b1 = bucket(a1.eval);
        let trend = '';
        if (b1 !== b0) {
            const w = this.voice(g, true);
            const b = this.voice(g, false);
            if (b1 === 2) trend = ` ➜ ${w.label} a maintenant un avantage décisif.`;
            else if (b1 === 1) trend = ' ➜ ' + (b0 > 1 ? `${w.label} garde l'avantage, mais il n'est plus décisif.` : `${w.label} prend l'avantage.`);
            else if (b1 === 0) trend = ' ➜ La position est de nouveau équilibrée.';
            else if (b1 === -1) trend = ' ➜ ' + (b0 < -1 ? `${b.label} garde l'avantage, mais il n'est plus décisif.` : `${b.label} prend l'avantage.`);
            else trend = ` ➜ ${b.label} a maintenant un avantage décisif.`;
        }

        const mm = GameLogic.missedMate(p.whiteToMove, a0, a1);
        if (mm !== null) {
            const bestMove = a0.best ? p.san(Move.fromUci(a0.best)) : null;
            const how = mm === 1 ? 'matait immédiatement' : 'forçait le mat en 2 coups';
            const left = mateFor(a1.eval, p.whiteToMove);
            const now = left === null
                ? ` Après ${san}, le mat n'est plus forcé.`
                : ` Après ${san}, ${v.f('il vous faut', 'il lui faut')} encore ${left} ${left > 1 ? 'coups' : 'coup'} pour mater.`;
            return {
                text: `⚠️ Mat en ${mm} manqué · ${v.label} : ${v.f('vous pouviez', 'il pouvait')} gagner tout de suite` +
                    (bestMove ? `, ${bestMove} ${how}.` : '.') + now + trend,
                tone: Tone.BAD,
            };
        }

        switch (GameLogic.annotate(p, m, a0, a1, prev)) {
            case '??': return { text: `Gaffe · ${v.label} : ${explain(v, p, m, san, a0, a1)}${trend}`, tone: Tone.BAD };
            case '?': return { text: `Erreur · ${v.label} : ${explain(v, p, m, san, a0, a1)}${trend}`, tone: Tone.BAD };
            case '?!': return { text: `Imprécision · ${v.label} : ${explain(v, p, m, san, a0, a1)}${trend}`, tone: Tone.GOLD };
            case '!!': return { text: `Coup brillant · ${v.label} : ${san} sacrifie du matériel pour une attaque gagnante.${trend}`, tone: Tone.GOOD };
            case '!': return { text: `Très bon coup · ${v.label} : ${san} était le seul coup vraiment fort dans cette position.${trend}`, tone: Tone.GOOD };
            default: return { text: plain + trend, tone: Tone.INFO };
        }
    },

    /** Conclusion affichée sur la position finale. */
    ending(g) {
        const w = this.voice(g, true);
        const b = this.voice(g, false);
        let raw;
        if (g.result === '1-0') raw = `Fin de la partie : victoire de ${w.label} par ${g.reason}.`;
        else if (g.result === '0-1') raw = `Fin de la partie : victoire de ${b.label} par ${g.reason}.`;
        else raw = `Fin de la partie : nulle (${g.reason}).`;
        return raw.replace("de L'ordinateur", "de l'ordinateur");
    },
};
