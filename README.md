# ChessDuck WebApp (portage de ChessNote v2.2.1)

Version Web progressive (PWA) 100 % hors-ligne de **ChessDuck v2.2.1** ([ivanherboch/ChessNote](https://github.com/ivanherboch/ChessNote)), optimisée pour Safari iOS (iPhone), tablettes (mise en page à deux colonnes) et navigateurs de bureau.

Lien : <https://ivanherboch.github.io/ChessDuck-Web/>

## Modules inclus (v2.2.1)

- **Notation** : entraînement à la notation échiquéenne anglaise FIDE avec clavier dédié (`K Q R B N`, `a–h`, `1–8`, `x`, `+`, `#`, `=`, `O-O`, `O-O-O`), niveaux filtrables, séries et records, diagnostic pédagogique et mémo FIDE.
- **Académie** : 113 leçons interactives (ouvertures, tactique, finales) en mode **Guidé (démo)** avec flèches, repères et lecture pas à pas, et en mode **Défi (pratique)** avec suivi des leçons maîtrisées.
- **Problèmes** : 150 000 problèmes tactiques Lichess organisés selon les 50 thèmes officiels et 4 paliers de difficulté, recherche instantanée par identifiant `#id` ou thème, réfutation Stockfish en direct et export PNG prêt à partager.
- **Jeu Libre** : partie contre l'ordinateur (600–2400 ELO via Stockfish 19 Lite WASM) ou à 2 joueurs (Pass & Play) avec jauge d'évaluation, classement FIDE K=32, historique local et **revue commentée coup par coup** (`!!`, `!`, `?!`, `?`, `??`, mats manqués).
- **Mode Enfant** : interface dédiée en palette claire avec la police *Fredoka*, cavalier en forme de girafe, cartes colorées et animations pédagogiques du déplacement de chaque pièce.

## Structure du projet

```text
├── index.html                  # Point d'entrée PWA (iPhone Safari safe-area & no-FOUC)
├── manifest.webmanifest        # Manifeste PWA
├── sw.js                       # Service Worker hors-ligne
├── css/styles.css              # Design system « Ardoise & Or » + Mode Enfant
├── src/
│   ├── app.js                  # Navigation adaptative & cycle de vie des modules
│   ├── core/                   # Moteur d'échecs, leçons, thèmes Lichess, Stockfish Worker
│   ├── data/                   # Préférences locales & IndexedDB (puzzles, parties, analyses)
│   ├── ui/                     # Échiquier Canvas 60 fps, pièces capturées, composants UI
│   └── features/               # Notation, Académie, Problèmes, Jeu Libre & Revue, Mode Enfant
├── assets/                     # Pièces SVG/PNG, Fredoka, son bois, lessons.json, index & paquets gzip
├── vendor/stockfish/           # Stockfish 19 Lite WASM single-thread (GPLv3)
└── tests/unit.test.mjs         # Suite de tests unitaires Node.js
```

## Développement & tests

```bash
# Tests unitaires (Node >= 20)
node --test tests/unit.test.mjs

# Aperçu local (Service Worker et Web Workers actifs sur localhost)
python3 -m http.server 8080
```
