// Port fidèle de PuzzleThemes.kt (ChessDuck v1.6.0)

export const G_PHASE = 'Autres gains, par phase de jeu';
export const G_TACTIC = 'Motifs tactiques';
export const G_ATTACK = 'Attaque & défense';
export const G_SPECIAL = 'Coups spéciaux';
export const G_MATE = 'Mats';
export const G_ENDGAME = 'Finales';

export const ALL_THEMES = [
  { key: 'opening', name: 'Ouverture', goal: 'Punir une imprécision dès les premiers coups.', group: G_PHASE, tip: 'Cherchez la pièce adverse mal défendue ou le roi encore au centre : en début de partie, un retard de développement se paie cher.' },
  { key: 'middlegame', name: 'Milieu de partie', goal: 'Trouver la tactique quand toutes les pièces sont en jeu.', group: G_PHASE, tip: "Passez en revue, dans l'ordre, les échecs, les prises puis les menaces : le coup le plus forçant est souvent le bon." },
  { key: 'endgame', name: 'Finale', goal: 'Être précis quand il reste peu de pièces.', group: G_PHASE, tip: 'Avec peu de pièces, chaque temps compte : activez votre roi et vos pions passés avant tout.' },

  { key: 'fork', name: 'Fourchette', goal: 'Attaquer deux cibles à la fois avec une seule pièce.', group: G_TACTIC, tip: "Repérez deux cibles adverses non défendues (ou le roi et une pièce) qu'une seule de vos pièces peut attaquer en même temps." },
  { key: 'pin', name: 'Clouage', goal: 'Exploiter une pièce qui ne peut pas bouger sans exposer plus précieux.', group: G_TACTIC, tip: 'Cherchez deux pièces adverses alignées sur une colonne, une rangée ou une diagonale : celle de devant ne peut pas bouger librement.' },
  { key: 'skewer', name: 'Enfilade', goal: 'Attaquer une pièce de valeur pour gagner celle qui se cache derrière.', group: G_TACTIC, tip: 'Cherchez deux pièces adverses alignées, la plus précieuse devant : attaquez-la pour gagner celle qui se cache derrière.' },
  { key: 'discoveredAttack', name: 'Attaque à la découverte', goal: "Déplacer une pièce pour démasquer l'attaque d'une autre.", group: G_TACTIC, tip: "Une de vos pièces masque l'action d'une autre : déplacez-la en créant une seconde menace." },
  { key: 'discoveredCheck', name: 'Échec à la découverte', goal: 'Démasquer un échec tout en créant une seconde menace.', group: G_TACTIC, tip: "Une de vos pièces fait écran entre une pièce à longue portée et le roi adverse : en s'écartant, elle peut tout se permettre." },
  { key: 'doubleCheck', name: 'Échec double', goal: 'Donner échec avec deux pièces : seul le roi peut répondre.', group: G_TACTIC, tip: 'Trouvez le coup qui donne échec avec deux pièces à la fois : le roi adverse sera obligé de bouger.' },
  { key: 'deflection', name: 'Déviation', goal: 'Détourner un défenseur de sa tâche essentielle.', group: G_TACTIC, tip: 'Identifiez le défenseur qui tient la position adverse, puis forcez-le à quitter son poste.' },
  { key: 'attraction', name: 'Attraction', goal: 'Attirer une pièce adverse sur une case fatale.', group: G_TACTIC, tip: 'Demandez-vous sur quelle case une pièce adverse (souvent le roi) serait vulnérable, puis forcez-la à y venir.' },
  { key: 'sacrifice', name: 'Sacrifice', goal: 'Donner du matériel pour obtenir bien davantage ensuite.', group: G_TACTIC, tip: "N'écartez pas les coups qui donnent du matériel : comptez ce que vous récupérez à la fin de la suite forcée." },
  { key: 'hangingPiece', name: 'Pièce en prise', goal: 'Repérer et capturer une pièce non défendue.', group: G_TACTIC, tip: "Comptez les attaquants et les défenseurs de chaque pièce adverse : l'une d'elles n'est pas assez protégée." },
  { key: 'trappedPiece', name: 'Pièce enfermée', goal: "Gagner une pièce qui n'a plus aucune case de fuite.", group: G_TACTIC, tip: 'Une pièce adverse manque de cases de fuite : attaquez-la après avoir vérifié que toutes ses retraites sont contrôlées.' },
  { key: 'capturingDefender', name: 'Élimination du défenseur', goal: 'Supprimer la pièce qui protège la cible.', group: G_TACTIC, tip: "Repérez la pièce qui protège votre cible : éliminez d'abord ce défenseur." },
  { key: 'clearance', name: 'Dégagement', goal: 'Libérer une case ou une ligne pour une autre pièce.', group: G_TACTIC, tip: 'Une de vos propres pièces occupe la case ou la ligne dont vous avez besoin : libérez-la avec gain de temps.' },
  { key: 'interference', name: 'Interception', goal: 'Couper la communication entre deux pièces adverses.', group: G_TACTIC, tip: 'Deux pièces adverses se protègent à distance : cherchez la case qui coupe leur ligne de communication.' },
  { key: 'intermezzo', name: 'Coup intermédiaire', goal: 'Intercaler une menace avant le coup attendu.', group: G_TACTIC, tip: 'Avant de jouer la reprise « évidente », cherchez un coup plus fort à intercaler, par exemple un échec.' },
  { key: 'xRayAttack', name: 'Rayons X', goal: 'Attaquer ou défendre à travers une pièce adverse.', group: G_TACTIC, tip: 'Vos pièces alignées agissent aussi à travers une pièce adverse : comptez-les toutes.' },
  { key: 'quietMove', name: 'Coup tranquille', goal: 'Jouer un coup calme qui prépare une menace imparable.', group: G_TACTIC, tip: "Le meilleur coup n'est ici ni un échec ni une prise : cherchez le coup calme qui crée une menace imparable." },
  { key: 'defensiveMove', name: 'Coup défensif', goal: "Trouver l'unique parade qui évite la catastrophe.", group: G_TACTIC, tip: "Identifiez d'abord la menace adverse : un seul coup la pare tout en conservant votre avantage." },
  { key: 'zugzwang', name: 'Zugzwang', goal: "Placer l'adversaire dans une position où tout coup l'affaiblit.", group: G_TACTIC, tip: "Limitez les coups adverses, puis jouez le coup qui oblige l'adversaire à abîmer lui-même sa position." },

  { key: 'kingsideAttack', name: "Attaque à l'aile roi", goal: 'Assaillir un roi adverse roqué du petit côté.', group: G_ATTACK, tip: 'Comptez vos pièces tournées vers le roque adverse : ouvrez une ligne vers le roi, quitte à sacrifier.' },
  { key: 'queensideAttack', name: "Attaque à l'aile dame", goal: 'Assaillir un roi adverse roqué du grand côté.', group: G_ATTACK, tip: 'Le roi adverse est à l’aile dame : cherchez à ouvrir une colonne ou une diagonale devant lui.' },
  { key: 'exposedKing', name: 'Roi exposé', goal: "Profiter d'un roi mal protégé par ses pions.", group: G_ATTACK, tip: 'Le roi adverse manque de protection : privilégiez les échecs qui lui retirent ses cases de fuite.' },
  { key: 'attackingF2F7', name: 'Attaque sur f2 ou f7', goal: 'Viser le pion le plus fragile du début de partie.', group: G_ATTACK, tip: 'Le pion f, défendu par le seul roi, est la cible : combien de vos pièces peuvent le viser ?' },
  { key: 'advancedPawn', name: 'Pion avancé', goal: 'Exploiter un pion proche de la promotion.', group: G_ATTACK, tip: "Un pion proche de la promotion décide de tout : chassez ou déviez la pièce qui l'arrête." },

  { key: 'promotion', name: 'Promotion', goal: 'Transformer un pion en pièce au bon moment.', group: G_SPECIAL, tip: 'Calculez la course jusqu’à la dernière rangée et écartez ce qui contrôle la case de promotion.' },
  { key: 'underPromotion', name: 'Sous-promotion', goal: "Choisir autre chose qu'une dame en arrivant au bout.", group: G_SPECIAL, tip: "Au moment de promouvoir, la dame n'est pas toujours le meilleur choix : examinez chaque pièce possible." },
  { key: 'enPassant', name: 'Prise en passant', goal: 'Se servir de cette règle spéciale des pions.', group: G_SPECIAL, tip: "Pensez à la règle spéciale des pions : elle n'est disponible qu'au coup qui suit l'avance de deux cases." },
  { key: 'castling', name: 'Roque', goal: "Mettre le roi à l'abri… avec une idée derrière la tête.", group: G_SPECIAL, tip: 'N’oubliez pas le coup spécial du roi : il peut aussi servir une idée tactique.' },

  { key: 'mateIn1', name: 'Mat en 1', goal: 'Donner échec et mat en un seul coup.', group: G_MATE, tip: "Un seul coup suffit : examinez tous vos échecs et vérifiez que le roi n'a ni fuite, ni parade, ni capture." },
  { key: 'mateIn2', name: 'Mat en 2', goal: 'Forcer le mat en deux coups.', group: G_MATE, tip: 'Mat forcé en deux coups : le premier doit laisser au roi adverse le moins de réponses possible.' },
  { key: 'mateIn3', name: 'Mat en 3', goal: 'Calculer une suite de mat en trois coups.', group: G_MATE, tip: 'Mat forcé en trois coups : ne considérez que les échecs et les menaces de mat immédiates.' },
  { key: 'mateIn4', name: 'Mat en 4', goal: 'Calculer une suite de mat en quatre coups.', group: G_MATE, tip: "Mat forcé en quatre coups : visualisez l'enfermement du roi avant de calculer l'ordre des coups." },
  { key: 'mateIn5', name: 'Mat en 5 ou plus', goal: 'Voir loin pour conclure par un mat forcé.', group: G_MATE, tip: "Longue suite de mat : chaque coup doit être forçant, n'acceptez aucune variante qui laisse respirer le roi." },
  { key: 'backRankMate', name: 'Mat du couloir', goal: 'Mater un roi prisonnier de sa dernière rangée.', group: G_MATE, tip: 'Le roi adverse est enfermé derrière ses pions : la dernière rangée est-elle assez défendue ?' },
  { key: 'smotheredMate', name: "Mat à l'étouffée", goal: 'Mater avec un cavalier un roi cerné par ses propres pièces.', group: G_MATE, tip: "Le roi adverse est entouré de ses propres pièces : seule une pièce qui saute peut l'atteindre." },
  { key: 'anastasiaMate', name: "Mat d'Anastasie", goal: 'Coordonner cavalier et pièce lourde contre un roi au bord.', group: G_MATE, tip: 'Le roi adverse est près du bord : coordonnez votre cavalier, qui lui retire deux cases, avec une pièce lourde.' },
  { key: 'arabianMate', name: 'Mat des Arabes', goal: 'Coordonner tour et cavalier contre un roi dans le coin.', group: G_MATE, tip: 'Le roi adverse est dans le coin : votre tour et votre cavalier doivent s’y donner rendez-vous.' },
  { key: 'bodenMate', name: 'Mat de Boden', goal: 'Mater avec deux fous sur des diagonales croisées.', group: G_MATE, tip: 'Vos deux fous visent des diagonales qui se croisent près du roi : il faut ouvrir la seconde.' },
  { key: 'doubleBishopMate', name: 'Mat des deux fous', goal: 'Mater avec deux fous sur des diagonales voisines.', group: G_MATE, tip: 'Vos deux fous balaient des diagonales voisines : ouvrez celle qui mène au roi.' },
  { key: 'dovetailMate', name: "Mat en queue d'aronde", goal: 'Mater avec la dame un roi gêné par ses propres pièces.', group: G_MATE, tip: "Les cases de fuite du roi sont bouchées par ses propres pièces : la dame doit s'approcher au contact." },
  { key: 'hookMate', name: 'Mat du crochet', goal: 'Combiner tour, cavalier et pion contre le roi.', group: G_MATE, tip: 'Tour, cavalier et pion peuvent se protéger en chaîne autour du roi adverse.' },

  { key: 'pawnEndgame', name: 'Finale de pions', goal: 'Maîtriser opposition, carré et percées.', group: G_ENDGAME, tip: 'Comptez les temps avec précision et pensez opposition, règle du carré et percée de pions.' },
  { key: 'rookEndgame', name: 'Finale de tours', goal: 'Activer sa tour et son roi dans la finale la plus fréquente.', group: G_ENDGAME, tip: "Activez votre tour et votre roi ; cherchez un échec utile ou la poussée d'un pion passé." },
  { key: 'bishopEndgame', name: 'Finale de fous', goal: 'Tirer parti des diagonales quand il ne reste que des fous.', group: G_ENDGAME, tip: 'Vos pions doivent vivre sur la couleur que le fou adverse ne contrôle pas ; visez les défenseurs.' },
  { key: 'knightEndgame', name: 'Finale de cavaliers', goal: 'Jongler avec les fourchettes en fin de partie.', group: G_ENDGAME, tip: "Le cavalier est lent : gagnez un temps par une fourchette ou éloignez-le de l'action." },
  { key: 'queenEndgame', name: 'Finale de dames', goal: 'Manier échecs et pions passés avec les dames seules.', group: G_ENDGAME, tip: "Cherchez la suite d'échecs qui gagne du matériel ou escorte un pion, sans autoriser l'échec perpétuel." },
  { key: 'queenRookEndgame', name: 'Finale dame et tour', goal: 'Coordonner les pièces lourdes en fin de partie.', group: G_ENDGAME, tip: 'Les pièces lourdes se coordonnent sur les lignes ouvertes : visez le roi ou la dernière rangée.' },
];

export const THEME_BY_KEY = Object.fromEntries(ALL_THEMES.map((t) => [t.key, t]));

// Règle de classement (du plus précis au plus général — premier thème présent) :
// 1. Mat nommé · 2. Mat en N · 3. Coup spécial / motif rare · 4. Motif tactique courant · 5. Attaque du roi, puis type de finale · 6. Phase de jeu
const PRIORITY = [
  'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'doubleBishopMate', 'dovetailMate', 'hookMate', 'backRankMate',
  'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'underPromotion', 'enPassant', 'castling', 'doubleCheck', 'discoveredCheck', 'zugzwang', 'interference', 'xRayAttack',
  'trappedPiece', 'capturingDefender', 'intermezzo', 'clearance', 'attraction', 'deflection', 'skewer', 'pin', 'fork',
  'discoveredAttack', 'hangingPiece', 'quietMove', 'defensiveMove', 'sacrifice', 'promotion', 'advancedPawn',
  'attackingF2F7', 'exposedKing', 'kingsideAttack', 'queensideAttack',
  'pawnEndgame', 'rookEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame', 'queenRookEndgame',
  'opening', 'endgame', 'middlegame',
];

export function primaryTheme(themesStr) {
  const set = new Set((themesStr || '').trim().split(/\s+/));
  const key = PRIORITY.find((k) => set.has(k));
  return (key && THEME_BY_KEY[key]) || THEME_BY_KEY.middlegame;
}

export const THEME_GROUPS = [G_MATE, G_TACTIC, G_ATTACK, G_SPECIAL, G_ENDGAME, G_PHASE];

export const THEME_CATEGORIES = [
  { key: 'group:mate', group: G_MATE, label: G_MATE, emoji: '👑', goal: 'Tous les types de mats (mats nommés et mats en N coups).' },
  { key: 'group:tactic', group: G_TACTIC, label: G_TACTIC, emoji: '⚡', goal: 'Fourchettes, clouages, enfilades, déviations, sacrifices…' },
  { key: 'group:attack', group: G_ATTACK, label: G_ATTACK, emoji: '⚔️', goal: 'Attaques sur le roque, roi exposé, f2/f7 et pions avancés.' },
  { key: 'group:special', group: G_SPECIAL, label: G_SPECIAL, emoji: '✨', goal: 'Promotions, sous-promotions, prises en passant et roques.' },
  { key: 'group:endgame', group: G_ENDGAME, label: G_ENDGAME, emoji: '♟️', goal: 'Finales thématiques de pions, tours, fous, cavaliers et dames.' },
  { key: 'group:phase', group: G_PHASE, label: G_PHASE, emoji: '🧭', goal: 'Gains positionnels ou matériels en ouverture, milieu ou finale.' },
];

export const CATEGORY_BY_KEY = Object.fromEntries(THEME_CATEGORIES.map((c) => [c.key, c]));

const GROUP_THEME_KEYS = new Map(
  THEME_GROUPS.map((g) => [g, new Set(ALL_THEMES.filter((t) => t.group === g).map((t) => t.key))]),
);

export function themeFilterSet(themeKey) {
  if (!themeKey) return null;
  const cat = CATEGORY_BY_KEY[themeKey];
  if (cat) return GROUP_THEME_KEYS.get(cat.group) || new Set();
  return new Set([themeKey]);
}

export const BANDS = ['Tous', 'Débutant', 'Intermédiaire', 'Avancé', 'Expert'];

export function bandRange(band) {
  if (band === 1) return [0, 1199];
  if (band === 2) return [1200, 1599];
  if (band === 3) return [1600, 1999];
  if (band === 4) return [2000, 4000];
  return [0, 4000];
}

export function bandOf(rating) {
  if (rating < 1200) return 1;
  if (rating < 1600) return 2;
  if (rating < 2000) return 3;
  return 4;
}

export function frNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
