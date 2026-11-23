# Copie de Scorsaire (instantané figé)

Cette copie sert de base technique à l'application Solfège (rendu SVG de partition, glyphes Bravura, moteur audio, i18n, outils de build).

- **Origine** : dépôt local de Scorsaire (`scorsaire-`), commit `12652961b8fef9f8ca83c79c634ceddd65d356a5`
- **Date du commit** : 2026-11-20 15:38 (+01:00) — « Readers: lyrics shown as strophes by default… »
- **Date de la copie** : 2026-11-21
- **État de l'origine à la copie** : arbre de travail propre (aucune modification non validée)
- **Copié tel quel** : `src/`, `static/`, `tools/`, `LICENSE`, `LICENSES/`, `package.json`, `package-lock.json`
- **Non copié** : `tests/`, `dist/`, `docs/`, `reference/`, `node_modules/`

## Règles

1. **Le dépôt d'origine n'est jamais modifié** depuis ici. Cette copie est une base, pas un lien.
2. Les changements faits dans `vendor/scorsaire/` sont listés ci-dessous. Tant que la liste est vide, la copie est identique à l'origine.
3. Un correctif de Scorsaire ne se rapatrie qu'à la main, par décision explicite, et se note ici.
4. Licence : Scorsaire est sous GPLv3+ (`LICENSE`), Bravura sous SIL OFL et les autres composants selon `LICENSES/`. Ces fichiers restent avec le code. L'application publiée l'est avec son code source.

## Changements locaux

*(aucun : les fichiers copiés sont identiques à l'origine)*

## Correctifs appliqués à la compilation (`tools/build-app.mjs`, sans toucher aux fichiers copiés)

- `src/note/edit.js` : le bouton « double croche » de l'éditeur de note envoie la durée `16th` alors que le modèle l'appelle `sixteenth` ; toucher la portée répond « Impossible ici ». Le build remplace ces deux endroits (et échoue si la copie change). À signaler à l'origine, qui n'a pas été modifiée.

## Dépendances à figer

Scorsaire est construit avec `spessasynth_lib` **4.3.14** et `spessasynth_core` **4.3.22** (voir son `package-lock.json`). Avec les versions plus récentes (4.4.x), le moteur SoundFont se bloque au chargement d'une séquence et sature le processeur. Le `package.json` de l'application fige donc ces deux versions exactes ; ne les changer qu'après un essai du son.
