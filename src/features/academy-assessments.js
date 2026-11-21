export const PLACEMENT_PER_LEVEL = 3;
export const EXAM_SIZE = 10;
export const EXAM_PASS = 8;
export const KIND_PLACEMENT = 'placement';
export const KIND_EXAM = 'exam';

export const ASSESSMENT_TACTICS = Object.freeze([
    'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection', 'attraction', 'hangingPiece',
    'trappedPiece', 'capturingDefender', 'backRankMate', 'mateIn1', 'mateIn2', 'sacrifice', 'xRayAttack',
]);

export const ASSESSMENT_ENDGAMES = Object.freeze([
    'pawnEndgame', 'rookEndgame', 'queenEndgame', 'knightEndgame', 'bishopEndgame',
]);

/**
 * Tests de l'Académie : placement (paliers 2..5 x 3) et examens de palier (10 mixtes, 8/10).
 */
export const AcademyAssessments = {
    PLACEMENT_PER_LEVEL,
    EXAM_SIZE,
    EXAM_PASS,
    KIND_PLACEMENT,
    KIND_EXAM,
    TACTICS: ASSESSMENT_TACTICS,
    ENDGAMES: ASSESSMENT_ENDGAMES,

    levelRange(level) {
        switch (level) {
        case 1:
        case 2:
            return [400, 1100];
        case 3:
            return [1000, 1500];
        case 4:
            return [1400, 1900];
        default:
            return [1800, 2500];
        }
    },

    placementSpecs() {
        const specs = [];
        for (let lv = 2; lv <= 5; lv++) {
            const range = this.levelRange(lv);
            for (let i = 0; i < PLACEMENT_PER_LEVEL; i++) {
                specs.push({ themes: null, range });
            }
        }
        return specs;
    },

    /** Palier atteint d'après les résultats du placement (1 si le palier 2 échoue). */
    placementLevel(results) {
        let level = 1;
        for (let i = 0; i < 4; i++) {
            const lv = i + 2;
            const part = results.slice(i * PLACEMENT_PER_LEVEL, (i + 1) * PLACEMENT_PER_LEVEL);
            if (part.length === PLACEMENT_PER_LEVEL && part.filter(Boolean).length >= 2) level = lv;
            else break;
        }
        return level;
    },

    /** Examen du palier [level] : 6 tactiques, 2 défensives, 2 finales, ordre mélangé. */
    examSpecs(level, rng = Math.random) {
        const range = this.levelRange(level);
        const list = [];
        for (let i = 0; i < 6; i++) list.push({ themes: ASSESSMENT_TACTICS, range });
        for (let i = 0; i < 2; i++) list.push({ themes: ['defensiveMove'], range });
        for (let i = 0; i < 2; i++) list.push({ themes: ASSESSMENT_ENDGAMES, range });
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    },

    examPassed(score) {
        return score >= EXAM_PASS;
    },
};
