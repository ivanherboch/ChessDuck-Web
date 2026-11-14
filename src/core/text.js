/** Forme de recherche d'un texte : sans accents ni diacritiques, en minuscules (« Échec » → « echec »). */
export function normalizeForSearch(text) {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
