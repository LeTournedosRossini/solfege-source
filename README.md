# Solfège — initiation à la lecture musicale

Application web gratuite et libre : 25 leçons, 8 jeux de lecture (notes, rythme, intervalles, accords…), jeu d'oreille (intervalles, gammes et arpèges, phrases mélodiques) et outils (métronome, accordeur, piano). Installable, fonctionne hors-ligne.

**Utiliser l'application** : https://letournedosrossini.github.io/solfege-app/ (site compilé dans le dépôt [solfege-app](https://github.com/LeTournedosRossini/solfege-app)).

## Code source

- `src/` : l'application (coque, leçons, jeux, outils, jeu d'oreille, couche musicale).
- `vendor/scorsaire/` : copie figée du moteur de partition et de son de [Scorsaire](https://github.com/LeTournedosRossini/scorsaire-editeur) (voir `vendor/scorsaire/VENDOR.md`).
- `tools/` : compilation (`npm run build:app`) et tests automatiques (`tools/test-*.mjs`, à lancer avec `tools/safe-run.sh` pour limiter les ressources).
- Les SoundFonts sont hébergées à part (dépôt `scorsaire-lecteur`) ; sans elles, un moteur de son léger prend le relais.

```bash
npm install
npm run build:app      # produit dist/app
python3 -m http.server 8123 --directory dist/app
```

## Licence

GNU GPL version 3 ou ultérieure (voir `LICENSE`), comme Scorsaire. Bravura (SIL OFL) et les autres composants gardent leur licence (`vendor/scorsaire/LICENSES/`). Les polices Fraunces (SIL OFL) sont embarquées.
