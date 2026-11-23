/*
 * Nuances (tranche 3, deuxième complément de marque, validé avec Jean après discussion le 27/09/2026 — voir
 * `claude/etape-3-suivi-et-decisions.md`). PID.DYNAMIC (chaîne simple sur `chord`, déjà dans le schéma) : une des 7
 * nuances « courantes » retenues par le roadmap (pp, p, mp, mf, f, ff, sfz).
 *
 * Contrairement aux articulations, les nuances de MuseScore n'ont PAS de formule fermée par type (vérifié dans le
 * dépôt cloné : `chordlayout.cpp` ne les concerne pas — fichier dédié `dynamicslayout.cpp`, lu en entier). Leur
 * position verticale vient du système générique « autoplace »/skyline (`autoplace.cpp`, `SystemLayout::
 * layoutDynamicExpressionAndHairpins`), partagé avec paroles, soufflets, texte de tempo… : une silhouette haut/bas
 * calculée en continu sur toute la largeur d'un système, bien plus gros chantier que les articulations (voir la
 * discussion avec Jean, 27/09/2026, consignée dans le doc du projet). DÉCISION (Jean, même jour, sans coder d'abord) :
 * ne PAS porter cette skyline continue — jugée disproportionnée pour le bénéfice (ne se voit que dans les cas de
 * collision réelle) et incohérente avec le principe déjà choisi ailleurs (conteneurs : pile ordonnée explicite, pas
 * de détection géométrique continue). À la place :
 *  - **Cascade PAR ACCORD SEULEMENT** (pas par colonne partagée entre voix, plus simple à raisonner correctement) :
 *    une nuance démarre son empilement au-delà de ce que les articulations du MÊME accord ont déjà réservé
 *    (`articulationItems(...).bounds`, ajouté à `articulations.js` pour cette cascade) — pas de collision testée
 *    avec un élément d'un AUTRE accord ou d'une autre voix à la même colonne (limite assumée, comme pour les
 *    articulations).
 *  - **Décalage latéral REJETÉ en conception** (idée de Jean, écartée après discussion) : une marque ancrée à un
 *    instant précis ne doit jamais glisser vers une autre colonne pour éviter une collision — risque de lecture
 *    erronée du moment d'attaque. Voir la conversation pour le raisonnement complet.
 *  - **Côté par défaut = MuseScore, mais résolu autrement** : en dessous par défaut (`Sid::dynamicsPlacement =
 *    BELOW`), sauf sur une portée qui porte des paroles auquel cas AU-DESSUS — port fidèle de
 *    `Sid::dynamicsHairpinsAboveForVocalStaves` (activé par défaut chez MuseScore), qui règle exactement le cas
 *    « nuance juste au-dessus d'un départ de parole » sans jamais avoir besoin d'empiler dessus. Décidé par une
 *    règle de PORTÉE (un booléen « cette portée porte-t-elle des paroles quelque part »), pas par une détection de
 *    collision instant par instant.
 *  - **Position de repos EN DESSOUS** : `-2,8 esp.` — PAS la valeur MuseScore brute (`dynamicsPosBelow` = 2,0 esp.,
 *    dont l'ancre de référence dépend du système de mise en page générique qu'on ne porte pas) mais la valeur DÉJÀ
 *    calibrée par Jean dans le prototype (commentaire prototype : « abaissée d'un espace entier, retour
 *    utilisateur ») — le prototype fait foi sur ce réglage précis (CLAUDE.md), gardée telle quelle plutôt que
 *    remplacée par une fausse fidélité qu'on ne peut de toute façon pas garantir sans le système générique complet.
 *    Dégagement sous une hampe descendante (0,4 esp.) : identique au prototype.
 *  - **Position de repos AU-DESSUS** (nouveau cas, jamais dans le prototype) : `portée + 1 esp.` au-dessus de la
 *    ligne du haut — port DIRECT de `Sid::dynamicsPosAbove` (1,0 esp.), pas de calibration Jean disponible pour ce
 *    cas (jamais rendu jusqu'ici) : à AJUSTER À L'ŒIL une fois vu, comme pour tout le reste de ce projet. Dégagement
 *    symétrique sous une hampe montante.
 *  - **Centrage en X sur le « centre optique » SMuFL** (`Dynamic::doLayoutDynamic`, `symSmuflAnchor(...,
 *    opticalCenter)`) — PAS le milieu géométrique de la boîte englobante : pour des glyphes asymétriques comme
 *    « f » (la panse déborde à gauche de l'empattement), le centre optique n'est pas au milieu de la boîte. Donnée
 *    ajoutée aux 7 glyphes utilisés dans `bravura-subset.json` (ancre `opticalCenter`, valeurs lues telles quelles
 *    dans `bravura_metadata.json`, le fichier de métadonnées Bravura complet du projet Claude — jamais devinées).
 *    Repli sur le centrage géométrique si l'ancre venait à manquer pour un type ajouté plus tard.
 *
 * Limites assumées et documentées : une seule nuance par accord (`PID.DYNAMIC` = chaîne simple, pas une liste —
 * cohérent avec le roadmap qui ne prévoit que 7 nuances "courantes", pas le jeu complet MuseScore avec sfz/rf/fp
 * composés) ; pas de soufflet (tranche 3, à venir) ; cascade limitée au même accord (voir plus haut) ; portée
 * toujours à 5 lignes fixes (cohérent avec `scorePainter`/`articulations.js`) ; peintres `tab`/`percussion` non
 * câblés.
 *
 * BUG TROUVÉ ET CORRIGÉ (Jean, capture d'écran, 27/09/2026) : la démo de cascade montrait le « f » posé en plein sur
 * l'accent qu'il était censé dépasser. Cause : les formules de dégagement traitaient l'ancre `y` du glyphe comme son
 * bord visible directement, alors que la convention réelle du moteur (`src/render/svg.js`) est
 * `bord_réel = y + coordonnée_locale_de_boîte` — donc bord haut réel = `y + bBoxNE[1]`, bord bas réel =
 * `y + bBoxSW[1]`. Cette hypothèse se trouvait juste par coïncidence pour les glyphes d'articulation Above/Below
 * (dessinés par SMuFL avec l'ancre AU point d'attache, `bBoxNE[1]≈0` ou `bBoxSW[1]≈0`) mais pas pour les nuances,
 * glyphes ordinaires avec une ascendance/descendance propre (ex. `dynamicForte` : ascendant 1,776 esp., à cause du
 * corps du « f », qui débordait donc par-dessus la limite). Corrigé en soustrayant l'ascendant (dégagement en
 * dessous) ou le descendant (au-dessus) du glyphe DE NUANCE RÉSOLU dans chaque formule de dégagement (pas dans les
 * positions de repos elles-mêmes, déjà des ancres validées). Les articulations n'étaient pas concernées (vérifié
 * par relevé de bbox sur plusieurs glyphes Above/Below : ancre bien au point d'attache).
 */
import { glyphItem, glyphWidth } from './header.js';
import { DYNAMIC_DISPLAY } from '../model/dynamics.js';

/** Glyphes d'une nuance (tranche « nuances » : vocabulaire complet de MuseScore ; voir model/dynamics.js). */
export const DYNAMIC_GLYPH = DYNAMIC_DISPLAY;

const PT = (1.75 * 72) / 25.4; // points par espace
const CUSTOM_TEXT_SIZE = 10 / PT; // `dynamicsFontSize` (Edwin italique 10 pt) — texte libre ('other')

const STAFF_TOP = 4; // ligne du haut (repère à ressort, y vers le haut, portée à 5 lignes fixes — cf. articulations.js)
const DYN_BASE_BELOW = -2.8; // calibré par Jean dans le prototype (pas la valeur MuseScore brute — voir en-tête)
const DYN_BASE_ABOVE = STAFF_TOP + 1; // port direct de Sid::dynamicsPosAbove (1 esp.), jamais calibré à l'œil ici
const DYN_STEM_GAP = 0.4; // dégagement sous/au-dessus d'une hampe qui dépasse (prototype, étendu symétriquement)
const MARGIN = 0.4; // marge accord↔nuance quand il n'y a pas de hampe (cohérent avec articulations.js)
const MIN_DIST = 0.4; // marge quand on démarre au-delà des articulations du même accord (Sid::articulationMinDistance)

const glyphHeightOf = (glyphs, name) => {
  const b = glyphs.glyphs[name].bbox;
  return b.bBoxNE[1] - b.bBoxSW[1];
};

/**
 * @param dynType     'pp'|'p'|'mp'|'mf'|'f'|'ff'|'sfz' (PID.DYNAMIC)
 * @param opts.ys     positions (espaces) des têtes de l'accord
 * @param opts.stemUp sens de la hampe de l'accord
 * @param opts.stemTip position (espaces) de la pointe de la hampe, ou null si l'accord n'en a pas
 * @param opts.headWidth largeur de la tête, pour centrer sur son milieu (référence horizontale, comme les articulations)
 * @param opts.x      x (espaces) de la tête
 * @param opts.hasLyrics bascule au-dessus si vrai — nommé pour la 1re raison historique (paroles), mais couvre
 *        maintenant aussi l'instrument catalogué vocal : l'appelant (score.js, `staffAbove`) combine les deux
 *        conditions MuseScore (`Sid::dynamicsHairpinsAboveForVocalStaves` ET `isVocalInstrument`, voir hairpins.js).
 * @param opts.chordBounds bornes déjà réservées par les articulations du MÊME accord (`articulationItems(...).bounds`), ou null
 * @param opts.glyphs données Bravura
 * @param opts.itemId identifiant du modèle (ref)
 * @returns élément d'affichage `glyph`, ou null si le type est inconnu ou le glyphe absent
 */
export function dynamicItems(dynType, { ys, stemUp, stemTip, headWidth, x, hasLyrics = false, chordBounds = null, glyphs, itemId, tab = null, staffTop = STAFF_TOP, text = null }) {
  // Pièces à poser côte à côte : glyphes de la suite que la police produit (une ligature = un glyphe ; sff, sfff, sfffz : plusieurs),
  // ou le texte libre ('other', Edwin italique 10 pt, largeur approchée comme les autres textes du moteur).
  let pieces;
  if (dynType === 'other') {
    if (!text) return [];
    pieces = [{ text, width: 0.5 * CUSTOM_TEXT_SIZE * text.length, ascent: 0.75 * CUSTOM_TEXT_SIZE, descent: -0.25 * CUSTOM_TEXT_SIZE }];
  } else {
    const names = DYNAMIC_GLYPH[dynType];
    if (!names || !names.length || names.some((n) => !glyphs.glyphs[n])) return [];
    pieces = names.map((n) => {
      const g = glyphs.glyphs[n];
      return { name: n, width: g.advance ?? g.bbox.bBoxNE[0], ascent: g.bbox.bBoxNE[1], descent: g.bbox.bBoxSW[1] };
    });
  }
  const total = pieces.reduce((a, p) => a + p.width, 0);
  const gname = pieces.length === 1 ? pieces[0].name ?? null : null; // nuance à glyphe unique : centre optique SMuFL possible

  // Convention de coordonnées du moteur (src/render/svg.js) : l'ancre `y` d'un glyphe est le point tel qu'une
  // coordonnée LOCALE de boîte englobante 0 tombe à `y` — donc le bord HAUT réel = y + bBoxNE[1] (ascendant),
  // le bord BAS réel = y + bBoxSW[1] (descendant, valeur généralement négative). Vrai seulement par coïncidence
  // pour les glyphes d'articulation Above/Below (conçus par SMuFL avec l'ancre AU point d'attache, donc
  // bBoxNE[1]≈0 ou bBoxSW[1]≈0) : les nuances sont des glyphes ordinaires (texte), avec une ascendance/descendance
  // propre non négligeable (ex. dynamicForte : ascendant 1,776 esp., descendant -0,608 esp., à cause du corps du
  // « f »), qu'il FAUT soustraire pour dégager un bord déjà réservé par un autre élément (bug trouvé par Jean :
  // le « f » chevauchait un accent au-dessus duquel il aurait dû s'empiler — captures d'écran, 27/09/2026).
  // Une suite de plusieurs pièces prend l'ascendant le plus haut et le descendant le plus bas.
  const ascent = Math.max(...pieces.map((p) => p.ascent));
  const descent = Math.min(...pieces.map((p) => p.descent)); // négatif

  const headHeight = tab ? tab.headHeight : glyphHeightOf(glyphs, 'noteheadBlack');
  const top = Math.max(...ys);
  const bottom = Math.min(...ys);
  const above = !!hasLyrics;

  let y;
  if (tab) {
    // Tablature (4c-2, mesuré sur E8) : plus de position de repos fixe — le bord du glyphe se pose à `Sid::dynamicsMinDistance`
    // (0,5) de la silhouette de la portée (ligne extrême + demi-épaisseur), repoussé au-delà de l'accord (têtes, hampe) et des
    // articulations du même accord.
    const MIN = 0.5;
    if (above) {
      let edge = tab.top + MIN;
      edge = Math.max(edge, top + headHeight / 2 + MIN);
      if (stemUp && stemTip !== null) edge = Math.max(edge, stemTip + MIN);
      if (chordBounds) edge = Math.max(edge, chordBounds.top - MIN_DIST + MIN);
      y = edge - descent;
    } else {
      let edge = tab.bottom - MIN;
      edge = Math.min(edge, bottom - headHeight / 2 - MIN);
      if (!stemUp && stemTip !== null) edge = Math.min(edge, stemTip - MIN);
      if (chordBounds) edge = Math.min(edge, chordBounds.bottom + MIN_DIST - MIN);
      y = edge - ascent;
    }
  } else if (above) {
    // Position de repos : ancre déjà validée telle quelle (voir en-tête), pas de correction d'ascendance ici.
    y = staffTop + 1;
    // Chaque dégagement compare un bord réel à un bord déjà occupé (limite L) : le bord bas réel du glyphe
    // (y + descent) doit rester au-delà de L + marge, donc y >= L + marge - descent.
    y = Math.max(y, top + headHeight / 2 + MARGIN - descent);
    if (stemUp && stemTip !== null) y = Math.max(y, stemTip + DYN_STEM_GAP - descent);
    if (chordBounds) y = Math.max(y, chordBounds.top + MIN_DIST - descent);
  } else {
    y = DYN_BASE_BELOW;
    // Le bord haut réel du glyphe (y + ascent) doit rester en deçà de L - marge, donc y <= L - marge - ascent.
    y = Math.min(y, bottom - headHeight / 2 - MARGIN - ascent);
    if (!stemUp && stemTip !== null) y = Math.min(y, stemTip - DYN_STEM_GAP - ascent);
    if (chordBounds) y = Math.min(y, chordBounds.bottom - MIN_DIST - ascent);
  }

  // Centrage en x (`Dynamic::doLayoutDynamic`) : centre optique SMuFL pour une nuance à glyphe unique qui en a un ; sinon la suite entière
  // (largeurs d'avance) est centrée sur la tête (MuseScore ne décale pas les nuances sans symbole propre : `symId == noSym`).
  const opt = gname ? glyphs.glyphs[gname].anchors?.opticalCenter : null;
  let startX;
  if (opt) startX = x + headWidth / 2 - opt[0];
  else if (gname) startX = x + headWidth / 2 - glyphWidth(glyphs, gname) / 2;
  else startX = x + headWidth / 2 - total / 2;
  const out = [];
  let cx = startX;
  for (const p of pieces) {
    out.push(p.name
      ? glyphItem(p.name, cx, y, { ref: itemId, sel: `${itemId}-dyn`, role: 'dynamic' })
      : { kind: 'text', text: p.text, x: cx, y, size: CUSTOM_TEXT_SIZE, italic: true, anchor: 'start', ref: itemId, sel: `${itemId}-dyn`, role: 'dynamic' });
    cx += p.width;
  }
  return out;
}

/** Variante à un seul élément (premier glyphe de la suite) — pour les appelants qui ne posent qu'une nuance simple. */
export function dynamicItem(dynType, opts) {
  return dynamicItems(dynType, opts)[0] ?? null;
}
