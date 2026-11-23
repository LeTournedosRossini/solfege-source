/*
 * Liaisons de PROLONGATION (tie, même hauteur — tranche 3, quatrième complément de marque, voir
 * claude/etape-3-suivi-et-decisions.md). `PID.TIES` (portée) : [{ id, startNoteId, endNoteId }] — remplace l'ancien
 * `PID.TIED` (booléen sur la note, jamais rendu, étape 2 — voir `pid.js`) : ancré par IDENTITÉ des deux NOTES de
 * bornes, pas des accords (règle du projet « jamais se fier à la position, toujours vérifier l'identité » : un
 * accord peut porter plusieurs ties simultanés vers des notes différentes de l'accord suivant, il faut savoir
 * PRÉCISÉMENT laquelle va où — un simple booléen ne le permettait pas).
 *
 * Géométrie de la courbe : voir `slurtie.js` (commun avec le slur) pour les simplifications assumées (pas de moteur
 * d'évitement de collision itératif, pas de forme fuselée).
 *
 * Ancrage sur la note (port de `Tie::computeDefaultStartOrEndPoint`/`noteOpticalCenterForTie`, `slurtielayout.cpp`,
 * dépôt cloné) : MuseScore ancre horizontalement sur le « centre optique » SMuFL de la tête (ancres `cutOutNW/NE/
 * SW/SE`, absentes de notre sous-ensemble Bravura) — **repli documenté** (même principe que `dynamics.js`,
 * `opticalCenter` manquant → centrage géométrique) : on ancre ici sur le BORD RÉEL de la tête (droit pour le début
 * de la liaison, gauche pour la fin — MuseScore lui-même utilise ce même repli, `if (cutOutLeft.isNull() ||
 * cutOutRight.isNull()) return 0.5 * note->width()`, un centre géométrique qui pour une tête ronde ordinaire tombe
 * près du bord réel puisque `noteWidth` est déjà la largeur du glyphe). Décalages réels portés tels quels :
 * `TIE_HORIZONTAL_INSET` = 0,1 esp. (`visualInsetSp`, cas par défaut — pas le cas `0,45 esp.` d'une autre tête
 * juste au-dessus/en dessous, non détecté ici, ni le cas `0,2 esp.` d'une tête « slash », hors scope tab) ;
 * `TIE_VERTICAL_GAP` = 0,20 esp. (`yOffset`, annoté « TODO: style » dans MuseScore lui-même) ; décalage vertical de
 * base = demi-hauteur de tête (`noteHeight / 2`).
 *
 * Sens par défaut : port complet de `SlurTieLayout::calculateDirection` (`tieDirection` ci-dessous, point pivot compris
 * depuis la tranche 4c — l'ancienne version simplifiée a été remplacée).
 *
 * Hauteur d'épaule (port DIRECT de `computeBezier(TieSegment*)`, cotes de FORME) :
 * `shoulderH = clamp(TIE_MIN_SHOULDER + 0.3 × √|longueur_esp − 1|, TIE_MIN_SHOULDER, TIE_MAX_SHOULDER)`.
 *
 * Limites assumées et documentées : pas de tie
 * inter-portées (grand staff) ; pas de tie inter-voix (les deux notes doivent être dans la MÊME voix — limite du
 * modèle de résolution, `resolveStaffTies`) ; pas de "laissez vibrer" (fin de tie sans note d'arrivée, hors scope) ;
 * portée toujours à 5 lignes fixes ; peintres `tab`/`percussion` non câblés.
 */
import { PID, getProperty } from '../model/index.js';

export const TIE_MID_WIDTH = 0.21; // Sid::tieMidWidth (styledef.cpp) — utilisé comme épaisseur de trait uniforme, voir slurtie.js
const TIE_MIN_SHOULDER = 0.3; // Sid::tieMinShoulderHeight
const TIE_MAX_SHOULDER = 2.0; // Sid::tieMaxShoulderHeight
const SHOULDER_W = 0.6; // fraction fixe de la longueur (port direct, TieSegment::computeBezier)
export const TIE_HORIZONTAL_INSET = 0.1; // visualInsetSp (cas par défaut)
export const TIE_VERTICAL_GAP = 0.20; // yOffset

/**
 * Table note.id → { voice, mi, ii, chordId } pour TOUTE la portée — sert à résoudre `PID.TIES` sans dépendre de la
 * position d'une note dans une collection (règle du projet). `ii` = index de l'accord dans la mesure (les accords
 * d'une voix sont toujours dans l'ordre temporel, invariant du projet « mesures toujours remplies ») : sert à
 * ordonner deux ties dont les bornes tombent dans la même mesure.
 */
export function noteIndexMap(staff) {
  const map = new Map();
  staff.voices.forEach((voice, vi) => {
    voice.measures.forEach((measure, mi) => {
      measure.items.forEach((item, ii) => {
        if (item.type !== 'chord') return;
        for (const note of item.notes) map.set(note.id, { voice: vi, mi, ii, chordId: item.id });
      });
    });
  });
  return map;
}

/**
 * Résout `PID.TIES` d'une portée : une entrée dont une des deux notes n'est plus trouvée (accord supprimé depuis),
 * dont les deux notes ne sont pas dans la même voix (limite assumée), ou dont l'ordre est incohérent, est
 * silencieusement ignorée (donnée invalide plutôt qu'une erreur de rendu — même principe que `resolveStaffHairpins`).
 */
export function resolveStaffTies(staff) {
  const idx = noteIndexMap(staff);
  const raw = getProperty(staff, PID.TIES) || [];
  return raw
    .map((t) => ({ ...t, start: idx.get(t.startNoteId), end: idx.get(t.endNoteId) }))
    .filter((t) => t.start && t.end && t.start.voice === t.end.voice
      && (t.start.mi < t.end.mi || (t.start.mi === t.end.mi && t.start.ii < t.end.ii)));
}

/**
 * Sens par défaut (`up`) d'un tie — port COMPLET de `SlurTieLayout::calculateDirection(Tie*)` (`slurtielayout.cpp` v4.7.5,
 * relu le 01/10/2026 ; remplace l'ancien `tieUp` simplifié, qui regardait TOUTES les notes de l'accord).
 *  - **Voix multiples** (la mesure de départ OU celle d'arrivée en porte plusieurs) : côté de la hampe (`startStemUp`/`endStemUp`) ;
 *    en tablature SIMPLE (sans hampes, `simpleException`) : parité de la voix (`isUpVoice` : voix 1 et 3 = vers le haut).
 *  - **Note seule** : opposé à la hampe, toujours vers le haut si le sens de hampe est mixte entre les deux accords.
 *  - **Accord** : on cherche un POINT PIVOT parmi les notes QUI PORTENT UN TIE (seulement elles) : deux notes liées à un
 *    intervalle d'une seconde ou d'un unisson (`|compareNotesPos| ≤ 1`) ; un seul pivot = en dessous le tie descend, au-dessus il monte
 *    (la note pivot elle-même descend si elle est la plus basse du couple) ; zéro ou plusieurs pivots : on compte les notes (et les ties)
 *    au-dessus/au-dessous de la note — aucun autre tie : moins de notes au-dessus qu'au-dessous → vers le haut, égalité → opposé à la
 *    hampe ; autant de ties au-dessus qu'au-dessous → opposé à la hampe ; sinon vers le haut s'il y a moins de ties au-dessus.
 * `notes` : toutes les notes de l'accord de DÉPART `{ id, y (espaces, vers le haut), pitch, tied (porte un tie sortant) }` ;
 * `compareNotesPos` = différence de position, à égalité la hauteur (cas des unissons).
 */
export function tieDirection({
  notes, noteId, startStemUp, endStemUp, multipleVoices = false, startVoice = 0, endVoice = null, endMultipleVoices = false,
  simpleException = false,
}) {
  const stemSide = (up, voice) => (simpleException ? voice % 2 === 0 : up);
  if (multipleVoices) return stemSide(startStemUp, startVoice);
  if (endMultipleVoices) return stemSide(endStemUp, endVoice ?? startVoice);
  const cmp = (a, b) => (a.y !== b.y ? a.y - b.y : a.pitch - b.pitch); // `compareNotesPos` (>0 : a au-dessus de b)
  if (notes.length <= 1) {
    if (endStemUp !== undefined && endStemUp !== null && startStemUp !== endStemUp) return true;
    return !startStemUp;
  }
  // ordre de `Chord::notes()` : de la note la plus basse à la plus haute (`noteIsBefore`)
  const sorted = [...notes].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.pitch - b.pitch));
  const primary = sorted.find((n) => n.id === noteId);
  let pivot = null;
  let multiplePivots = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (!sorted[i].tied) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (!sorted[j].tied) continue;
      const diff = cmp(sorted[i], sorted[j]);
      if (!multiplePivots && Math.abs(diff) <= 1) {
        if (pivot) { multiplePivots = true; pivot = null; } else pivot = diff < 0 ? sorted[i] : sorted[j];
      }
    }
  }
  if (!pivot) {
    let notesAbove = 0; let tiesAbove = 0; let notesBelow = 0; let tiesBelow = 0; let unisonTies = 0;
    for (const n of sorted) {
      if (n === primary) continue;
      const diff = cmp(primary, n); // < 0 : n est au-dessus de la note de départ
      if (diff === 0 && n.tied) unisonTies++;
      if (diff < 0) { notesAbove++; if (n.tied) tiesAbove++; }
      if (diff > 0) { notesBelow++; if (n.tied) tiesBelow++; }
    }
    if (tiesAbove === 0 && tiesBelow === 0 && unisonTies === 0) {
      return notesAbove === notesBelow ? !startStemUp : notesAbove < notesBelow;
    }
    if (tiesAbove === tiesBelow) return !startStemUp;
    return tiesAbove < tiesBelow;
  }
  if (pivot === primary) return false;
  return cmp(primary, pivot) >= 0;
}

/** Hauteur d'épaule (esp.) pour un tie de longueur `lengthSp` (port DIRECT, cote de forme). */
export function tieShoulderHeight(lengthSp) {
  const h = TIE_MIN_SHOULDER + 0.3 * Math.sqrt(Math.abs(lengthSp - 1));
  return Math.min(Math.max(h, TIE_MIN_SHOULDER), TIE_MAX_SHOULDER);
}

export { SHOULDER_W as TIE_SHOULDER_W };
