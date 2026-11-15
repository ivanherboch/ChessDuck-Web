import { PIECE_NAMES_FR, ROOK, QUEEN } from './chess.js';

const NAMES = ['', 'pion', 'cavalier', 'fou', 'tour', 'dame', 'roi'];
const PLURALS = ['', 'pions', 'cavaliers', 'fous', 'tours', 'dames', 'rois'];

/** Lexique français unique des pièces (indicé par type : PAWN … KING). */
export const PieceLexiconFr = {
    name(type) { return NAMES[type]; },
    title(type) { return PIECE_NAMES_FR[type]; },
    plural(type) { return PLURALS[type]; },
    count(type, n) { return `${n} ${n > 1 ? PLURALS[type] : NAMES[type]}`; },
    isFeminine(type) { return type === ROOK || type === QUEEN; },
    definite(type) { return (this.isFeminine(type) ? 'la ' : 'le ') + NAMES[type]; },
    definiteCapitalized(type) {
        const d = this.definite(type);
        return d[0].toUpperCase() + d.slice(1);
    },
    indefinite(type) { return (this.isFeminine(type) ? 'une ' : 'un ') + NAMES[type]; },
    pronoun(type) { return this.isFeminine(type) ? 'la' : 'le'; },
    possessive(type, secondPerson = false) {
        const det = secondPerson
            ? (this.isFeminine(type) ? 'ta ' : 'ton ')
            : (this.isFeminine(type) ? 'sa ' : 'son ');
        return det + NAMES[type];
    },
};
