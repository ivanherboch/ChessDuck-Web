# ChessDuck Web

Application web complète (sans serveur requis) portée depuis la version **v1.6.0** du dépôt [ivanherboch/ChessNote](https://github.com/ivanherboch/ChessNote), optimisée pour **Safari sur iPhone / iPad** et installable sur l'écran d'accueil (PWA hors-ligne).

🔗 **Application en ligne** : https://ivanherboch.github.io/ChessDuck-Web/

## Fonctionnalités

- **⌨️ Notation** : apprentissage de la notation algébrique anglaise FIDE avec clavier virtuel dédié, 3 niveaux pédagogiques (Bases, Prises & Échecs, Roques & Avancé), diagnostic précis des erreurs et **Mémo Anglais**.
- **🎓 Académie** : les **113 leçons** interactives classées (Ouvertures, Milieu de partie, Finales), disponibles en **Mode Guidé** (lecture automatique) et en **Mode Défi** avec suivi des leçons maîtrisées.
- **🧩 Problèmes** : **75 000 problèmes tactiques Lichess** filtrables par difficulté et parmi 50 thèmes officiels, recherche instantanée par identifiant `#id`, réfutation en temps réel calculée par **Stockfish 19 WASM** (flèche rouge), et **export en image PNG 1080 px** (énoncé & solution illustrée).
- **⚔️ Jeu Libre & Revue** : parties contre Stockfish (600 à 2400 ELO), mode 2 joueurs sur le même écran (*Pass & Play*), classement ELO FIDE (`K = 32`), jauge d'évaluation en direct, barre des pièces capturées, historique local et **analyse commentée coup par coup**.
- **🧒 Mode Enfant** : interface joyeuse dédiée aux plus jeunes avec cavalier-girafe, pastilles de déplacement, démonstrations animées de chaque pièce, son du bois sur iOS Safari et boîte de confirmation floutée.

## Installation sur iPhone (Safari)

1. Ouvrez `https://ivanherboch.github.io/ChessDuck-Web/` dans **Safari** sur iPhone.
2. Touchez le bouton **Partager** (`□↑`), puis **Sur l'écran d'accueil**.
3. Après le premier chargement des 75 000 problèmes et de Stockfish WASM, l'application fonctionne **100 % hors-ligne**.

## Crédits & Licences

- **Code source & contenu pédagogique d'origine** : [ivanherboch/ChessNote (v1.6.0)](https://github.com/ivanherboch/ChessNote) — © Ivan Herboch, 2026.
- **Moteur d'échecs** : Stockfish 19 WASM (`stockfish-19-lite-single`) — GNU GPLv3 ([Copying.txt](assets/engine/Copying.txt)).
- **Base de problèmes** : 75 000 problèmes issus de Lichess.org — Domaine public (CC0).
- **Pièces d'échecs** : série classique par Colin M.L. Burnett & pièce féerique Girafe (Wikimedia Commons) — CC BY-SA 3.0.
- **Police du Mode Enfant** : Fredoka — SIL Open Font License ([Fredoka-OFL.txt](assets/fonts/Fredoka-OFL.txt)).
