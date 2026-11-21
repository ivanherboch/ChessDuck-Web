import { PAWN, pieceFromChar, pieceType } from './chess.js';
import { PieceLexiconFr } from './piece-fr.js';

/**
 * Coup SAN isolé dans une phrase, avec son éventuel numéro (« 3. », « 3... »), qui n'est pas lu.
 */
const SAN_IN_TEXT = /(?<![\p{L}\p{N}_])(?:\d+\.(?:\.\.)?\s?)?(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![\p{L}\p{N}_])/gu;

/**
 * Mots que la synthèse vocale française prononce mal (« pat » lu « pa », « gambit » lu « gambi »…), écrits
 * comme ils se disent. Ce lexique ne sert qu'à la voix : l'écran affiche toujours l'orthographe correcte.
 */
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PRONUNCIATION = [
    ['pat', 'patte'], ['mat', 'matte'], ['mats', 'mattes'],
    ['gambit', 'gambitte'], ['gambits', 'gambittes'],
    ['fianchetto', 'fianquétto'], ['zugzwang', 'zougtsvang'],
    ['Giuoco', 'Djouoco'], ['Fegatello', 'Fégatello'], ['Kieseritzky', 'Kizéritski'],
    ['Sveshnikov', 'Svéchnikov'], ['Najdorf', 'Naïdorf'], ['Winawer', 'Vinaver'], ['Tarrasch', 'Tarache'],
    ['Caro-Kann', 'Caro-Kane'], ['Grünfeld', 'Grunfèlde'], ['Alekhine', 'Aliékhine'], ['Pirc', 'Pirtse'],
    ['Rubinstein', 'Roubinnchtaïne'], ['Fischer', 'Fichère'], ['Lucena', 'Loucéna'], ['Boden', 'Bodène'],
    ['Evans', 'Évanse'], ['Petrov', 'Pétrof'], ['Kasparov', 'Kasparof'],
    ['Réti', 'Rétti'], ['Philidor', 'Filidor'], ['Anastasie', 'Anastazie'], ['Scandinave', 'Skandinave'],
    ['Nimzo-indienne', 'Nimmzo-indienne'], ['Nimzo', 'Nimmzo'],
    ['Morphy', 'Morfi'], ['Brunswick', 'Brunesvik'], ['Isouard', 'Izouar'],
    ['Vancura', 'Vantsoura'], ['Saavedra', 'Saavédra'], ['Anderssen', 'Andersséne'], ['Nimzowitsch', 'Nimmzovitch'],
    ['Botvinnik', 'Botvinik'], ['Lasker', 'Laskère'], ['Bauer', 'Baouère'], ['Pillsbury', 'Pilsbéri'],
    ['Greco', 'Gréco'], ['Taimanov', 'Taïmanof'], ['Trompowsky', 'Trompofski'], ['Marshall', 'Marchal'],
    ['Benko', 'Bènnko'], ['desperado', 'dèspérado'], ['Smith-Morra', 'Smisse-Morra'], ['Kan', 'Kanne'],
    ['Panov', 'Panof'], ['Budapest', 'Boudapèste'], ['Tartakower', 'Tartakovère'], ['Rotlewi', 'Rotlévi'],
    ['Lodz', 'Woudj'], ['Sämisch', 'Zémiche'], ['AVRO', 'Avro'], ['Capablanca', 'Capablannca'],
    ['Rossolimo', 'Rossolimmo'],
].map(([word, said]) => [new RegExp(`(?<![\\p{L}-])${escapeRegExp(word)}(?![\\p{L}-])`, 'giu'), said]);

/**
 * Notation des coups (SAN anglaise) prononcée en français pour la synthèse vocale :
 * « Nxe5+ » → « cavalier prend e5, échec », « O-O » → « petit roque », « exd5 » → « e prend d5 ».
 */
export const SpokenFr = Object.freeze({
    move(san) {
        let suffix = '';
        if (san.endsWith('#')) suffix = ', mat';
        else if (san.endsWith('+')) suffix = ', échec';

        const body = san.replace(/[+#!?]+$/, '');
        if (body === 'O-O-O') return `grand roque${suffix}`;
        if (body === 'O-O') return `petit roque${suffix}`;

        const eqIdx = body.indexOf('=');
        const core = eqIdx >= 0 ? body.slice(0, eqIdx) : body;
        const promoChar = eqIdx >= 0 ? body[eqIdx + 1] : null;

        const first = core[0];
        const isUpper = first >= 'A' && first <= 'Z';
        const type = isUpper ? pieceType(pieceFromChar(first)) : PAWN;
        const squares = type === PAWN ? core : core.slice(1);
        const promo = promoChar
            ? `promotion en ${PieceLexiconFr.name(pieceType(pieceFromChar(promoChar)))}`
            : null;

        const disamb = squares.slice(0, -2).replace(/x$/, '');
        const parts = [];
        if (type !== PAWN) parts.push(PieceLexiconFr.name(type));
        if (disamb) parts.push(disamb);
        if (squares.includes('x')) parts.push('prend');
        parts.push(squares.slice(-2));
        if (promo) parts.push(promo);

        return parts.join(' ') + suffix;
    },

    /**
     * Phrase à lire : chaque coup en notation est remplacé par sa forme parlée, la mise en gras est retirée,
     * et les mots difficiles sont réécrits comme ils se prononcent.
     */
    text(s) {
        if (!s) return '';
        let out = s.replaceAll('**', '').replace(SAN_IN_TEXT, (_, san) => SpokenFr.move(san));
        for (const [re, said] of PRONUNCIATION) {
            out = out.replace(re, said);
        }
        return out;
    },
});
