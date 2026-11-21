import { Line, START_FEN } from '../core/chess.js';
import { Lessons } from '../core/lessons.js';
import { Analysis } from './game-logic.js';
import { ReviewComments } from './review-comments.js';

export const ReviewTopic = Object.freeze({
    MISSED_MATE: Object.freeze({ key: 'MISSED_MATE', label: 'Mat manqué', lessonId: 131, theme: 'mateIn2' }),
    ALLOWED_MATE: Object.freeze({ key: 'ALLOWED_MATE', label: "Mat permis à l'adversaire", lessonId: 132, theme: 'defensiveMove' }),
    HANGING_PIECE: Object.freeze({ key: 'HANGING_PIECE', label: 'Pièce laissée en prise', lessonId: 136, theme: 'hangingPiece' }),
    MISSED_CAPTURE: Object.freeze({ key: 'MISSED_CAPTURE', label: 'Prise gagnante manquée', lessonId: 133, theme: 'hangingPiece' }),
    CASTLING: Object.freeze({ key: 'CASTLING', label: 'Roque retardé', lessonId: 73, theme: 'castling' }),
    DEVELOPMENT: Object.freeze({ key: 'DEVELOPMENT', label: 'Développement en retard', lessonId: 1, theme: 'opening' }),
});

export const WEAK_TOPICS_GAMES = 20;

export const WeakTopics = {
    GAMES: WEAK_TOPICS_GAMES,

    /** Erreurs du joueur humain dans une partie analysée, par point faible. */
    fromGame(g) {
        const counts = new Map();
        if (!g?.analysis) return counts;
        let line;
        try {
            line = Line.fromUci(g.startFen || START_FEN, g.moves || '');
        } catch {
            return counts;
        }
        const analysis = Analysis.decodeAll(g.analysis, line.size + 1);
        for (let i = 0; i < line.size; i++) {
            try {
                const topic = ReviewComments.topic(g, line, i, analysis);
                if (topic) counts.set(topic, (counts.get(topic) || 0) + 1);
            } catch {
                // Ignore inconsistent historical entries
            }
        }
        return counts;
    },

    compute(games, progress) {
        const counts = new Map();
        const recent = (games || []).slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, WEAK_TOPICS_GAMES);
        for (const g of recent) {
            for (const [t, n] of this.fromGame(g)) {
                counts.set(t, (counts.get(t) || 0) + n);
            }
        }
        const fromGames = [];
        for (const [t, n] of counts) {
            fromGames.push({
                title: t.label,
                reason: `Repéré ${n} fois dans vos parties analysées.`,
                lessonId: t.lessonId,
                theme: t.theme,
                score: n * 3,
            });
        }

        const fromAcademy = [];
        for (const p of (progress || [])) {
            if (!p || p.masteredAt > 0) continue;
            const failedPractice = Math.max(0, (p.practiceTotal || 0) - (p.practicePassed || 0));
            const score = (p.errors || 0) + 2 * failedPractice;
            if (score < 2) continue;
            const l = Lessons.byId(p.lessonId);
            if (!l || l.id !== p.lessonId) continue;
            const parts = [];
            if (p.errors > 0) parts.push(`${p.errors} erreur${p.errors > 1 ? 's' : ''} en Défi`);
            if (failedPractice > 0) parts.push(`${failedPractice} exercice${failedPractice > 1 ? 's' : ''} manqué${failedPractice > 1 ? 's' : ''}`);
            fromAcademy.push({
                title: `Leçon : ${l.title}`,
                reason: `Dans l'Académie : ${parts.join(' et ')}.`,
                lessonId: l.id,
                theme: l.theme,
                score,
            });
        }

        const combined = [...fromGames, ...fromAcademy].sort((a, b) => b.score - a.score);
        const out = [];
        const seenLessons = new Set();
        for (const item of combined) {
            if (seenLessons.has(item.lessonId)) continue;
            seenLessons.add(item.lessonId);
            out.push(item);
            if (out.length >= 3) break;
        }
        return out;
    },
};
