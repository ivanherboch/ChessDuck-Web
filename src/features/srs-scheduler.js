export const DAY = 86_400_000;
export const INTERVAL_DAYS = Object.freeze([1, 7, 30, 90]);

/**
 * Répétition espacée de l'Académie : 1, 7, 30 puis 90 jours ;
 * une révision ratée ramène l'intervalle à un jour.
 */
export class SrsScheduler {
    constructor(clock = () => Date.now()) {
        this.clock = clock;
    }

    now() {
        return this.clock();
    }

    /** Première maîtrise : première révision le lendemain (sans changer un calendrier déjà en cours). */
    mastered(p) {
        if (p.srsStage > 0) return p;
        const t = this.now();
        return { ...p, srsStage: 1, nextReviewAt: t + DAY, lastReviewedAt: t };
    }

    /** Révision faite : réussie, l'intervalle s'allonge ; ratée, on repart à un jour. */
    reviewed(p, success) {
        const stage = success ? Math.min((p.srsStage || 0) + 1, INTERVAL_DAYS.length) : 1;
        const t = this.now();
        return {
            ...p,
            srsStage: stage,
            nextReviewAt: t + INTERVAL_DAYS[stage - 1] * DAY,
            lastReviewedAt: t,
        };
    }

    isDue(p) {
        const n = this.now();
        return Boolean(p && p.masteredAt > 0 && p.srsStage > 0 && p.nextReviewAt >= 1 && p.nextReviewAt <= n);
    }

    /** Leçons à réviser aujourd'hui, les plus anciennes d'abord. */
    due(progress) {
        return Array.from(progress)
            .filter((p) => this.isDue(p))
            .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
            .map((p) => p.lessonId);
    }

    /** Jours avant la prochaine révision (0 : aujourd'hui), null si non planifiée. */
    daysUntil(p) {
        if (!p || !(p.masteredAt > 0) || !p.srsStage) return null;
        const diff = Math.max(0, p.nextReviewAt - this.now());
        return Math.floor((diff + DAY - 1) / DAY);
    }

    /**
     * Prochaine leçon conseillée : première non maîtrisée du palier [level] (ordre du cursus),
     * sinon des paliers inférieurs (les bases du palier 1 seulement au palier 1), sinon suivants.
     */
    recommended(lessons, progressMap, level) {
        const isMastered = (id) => (progressMap instanceof Map ? progressMap.get(id)?.masteredAt > 0 : progressMap?.[id]?.masteredAt > 0);
        const open = lessons.filter((l) => !isMastered(l.id));
        return (
            open.find((l) => l.level === level)
            || open.find((l) => l.level < level && (l.level > 1 || level === 1))
            || open.filter((l) => l.level > level).sort((a, b) => a.level - b.level)[0]
            || open.slice().sort((a, b) => a.level - b.level)[0]
            || null
        );
    }

    /** Leçon commencée (Défi ou exercices déjà tentés) mais pas encore maîtrisée, autre que [current]. */
    continueLesson(lessons, progressMap, current) {
        return lessons.find((l) => {
            if (l.id === current) return false;
            const p = progressMap instanceof Map ? progressMap.get(l.id) : progressMap?.[l.id];
            return Boolean(p && !(p.masteredAt > 0) && (p.stars > 0 || p.practiceTotal > 0));
        }) || null;
    }
}
