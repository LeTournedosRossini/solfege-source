/*
 * Liaisons D'EXPRESSION (slur, plage sur accords, distincte du tie — tranche 3, cinquième complément de marque, voir
 * claude/etape-3-suivi-et-decisions.md). `PID.SLURS` (portée) : [{ id, startChordId, endChordId }] — même mécanisme
 * d'ancrage par IDENTITÉ que `PID.HAIRPINS` (résolution via `itemMeasureIndexMap`, `hairpins.js`).
 *
 * Géométrie de la courbe : voir `slurtie.js` (commun avec le tie) pour les simplifications assumées (pas de moteur
 * d'évitement de collision itératif, pas de forme fuselée).
 *
 * Sens par défaut (port de `SlurTieLayout::computeUp`, `slurtielayout.cpp`, dépôt cloné) : **simplification
 * assumée et documentée** par rapport à la source — MuseScore recalcule le sens en tenant compte du sens de hampe
 * de CHAQUE accord de la plage (bascule vers le haut si la plage mélange des hampes montantes et descendantes,
 * `isDirectionMixture`), y compris ceux d'un système pas encore mis en page si la liaison le traverse. Notre moteur
 * pose ses systèmes un par un (`paintSystemExtra`, un seul système visible à la fois) : reproduire cette règle
 * exigerait de connaître le sens de hampe de TOUS les accords de la plage au moment de la décision, y compris ceux
 * d'un système futur pas encore calculé — chantier disproportionné pour une liaison qui, en pratique, mélange
 * rarement les sens de hampe sur toute sa longueur. Ici : le sens ne dépend QUE de l'accord de DÉPART (comme une
 * note seule chez MuseScore), avec la même bascule « voix multiples » (côté de la hampe) — limite assumée : une
 * liaison entre deux accords aux hampes opposées ne bascule pas automatiquement vers le haut, rattrapable à la main
 * (étape 5).
 *
 * Dégagement vertical, coupure de système : mêmes principes que `hairpins.js` (généralisation bornée de la cascade
 * des nuances, bord le plus extrême des têtes de note DANS LE SYSTÈME COURANT ; `SpannerSegmentType`
 * SINGLE/BEGIN/MIDDLE/END) — voir ce fichier pour le détail des limites (pas de skyline continue, pas de collision
 * entre systèmes).
 */
import { PID, getProperty } from '../model/index.js';
import { itemMeasureIndexMap, spannerSegmentType } from './hairpins.js';

export const SLUR_MID_WIDTH = 0.21; // Sid::slurMidWidth — utilisé comme épaisseur de trait uniforme, voir slurtie.js
const MARGIN = 0.4; // marge tête↔liaison, cohérente avec hairpins.js/dynamics.js
export const SLUR_HORIZONTAL_INSET = 0.1; // même valeur que le tie (TIE_HORIZONTAL_INSET), par cohérence

export { spannerSegmentType };

/** Résout `PID.SLURS` d'une portée (même principe que `resolveStaffHairpins`). */
export function resolveStaffSlurs(staff) {
  const idx = itemMeasureIndexMap(staff);
  const raw = getProperty(staff, PID.SLURS) || [];
  return raw
    .map((s) => ({ ...s, startMi: idx.get(s.startChordId), endMi: idx.get(s.endChordId) }))
    .filter((s) => s.startMi !== undefined && s.endMi !== undefined && s.startMi <= s.endMi);
}

/**
 * Sens par défaut (`up`) d'un slur — voir la limite documentée en tête de fichier. `startStemUp` : sens de hampe de
 * l'accord de départ ; `multipleVoices` : la mesure de départ porte-t-elle plusieurs voix ; `startVoice` : voix de
 * l'accord de départ.
 * - Voix multiples : la liaison va du côté de la hampe — au-dessus si voix 0/2, en dessous si voix 1/3 (port direct
 *   du principe MuseScore, simplifié : « côté hampe » plutôt que le sens de hampe réel de l'accord, cohérent avec
 *   la règle MuseScore par PARITÉ de voix déjà utilisée ailleurs dans le projet — ornements, silences).
 * - Sinon : opposé au sens de hampe de l'accord de départ (comme une note seule chez MuseScore).
 */
export function slurUp({ startStemUp, multipleVoices, startVoice }) {
  if (multipleVoices) return startVoice % 2 === 0;
  return !startStemUp;
}

/**
 * Position verticale (espaces) du bord d'ancrage de CE côté de la liaison (avant l'épaule) : la position de repos
 * (bord de la portée + marge, même famille que hairpins.js) étendue par le bord le plus extrême des têtes de note
 * de l'accord d'ancrage lui-même. `extremeY` : la plus haute (si up) ou la plus basse (si down) tête de note DE CET
 * ACCORD (pas de toute la plage — voir `slurAnchorY` pour l'extension à toute la plage).
 */
export function slurEndpointY({ up, extremeY }) {
  return up ? extremeY + MARGIN : extremeY - MARGIN;
}

/**
 * Étend un point d'ancrage par le bord le plus extrême des têtes de note de TOUTE LA PLAGE visible dans ce système
 * (même principe que `hairpinY`, `hairpins.js`) — c'est ce qui fait « bomber » la liaison entière si une note du
 * milieu dépasse (voir la limite documentée dans `slurtie.js` : pas de bombement localisé).
 */
export function extendByRange(y, { up, extremeTop = null, extremeBottom = null }) {
  if (up && extremeTop !== null) return Math.max(y, extremeTop + MARGIN);
  if (!up && extremeBottom !== null) return Math.min(y, extremeBottom - MARGIN);
  return y;
}

/**
 * Fraction de la longueur occupée par l'intervalle entre les 2 points de contrôle — port DIRECT (palier par
 * longueur, `computeBezier(SlurSegment*)`, cote de forme).
 */
export function slurShoulderWidth(lengthSp) {
  if (lengthSp < 2) return 0.6;
  if (lengthSp < 10) return 0.5;
  if (lengthSp < 18) return 0.6;
  return 0.7;
}

/**
 * Hauteur d'épaule (port DIRECT de `computeShoulderHeight`, SANS la réduction de 25 % « liaison par-dessus une
 * ligature » — `isOverBeams`, limite assumée : la détection exigerait de connaître les groupes de ligature de
 * chaque accord traversé, non câblé ici).
 */
export function slurShoulderHeight(lengthSp) {
  return Math.sqrt(lengthSp / 4);
}

export const SLUR_REST_BELOW = -2.8; // même valeur que hairpins.js/dynamics.js (position de repos, calibrée par Jean)
export const SLUR_STAFF_TOP = 4;
export const SLUR_REST_ABOVE_GAP = 1;
