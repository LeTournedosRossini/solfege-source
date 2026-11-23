/*
 * Hampes de tablature — port de MuseScore 4.7.5 (`rendering/score/stemlayout.cpp` : `tabStemLength`, `tabRestStemPosY`, `tabStemPos`,
 * `calcDefaultStemLength` branche tablature ; `tdraw.cpp` : tracé de la hampe, barres obliques des blanches, points près de la hampe).
 * Fonctions pures. Repère de sortie : celui des portées du moteur (espaces, y vers le HAUT depuis la ligne du bas).
 *
 * Deux familles (`StaffType::stemThrough`) :
 *  - hampes À CÔTÉ de la portée (préréglage Common) : position et longueur FIXES (3 sp, départ 1 sp au-delà de la ligne extrême) ;
 *  - hampes À TRAVERS la portée (Full, défaut de Scorsaire) : longueur par `calcDefaultStemLength` (×1,5 en tablature), la hampe
 *    commence 0,7 distance de lignes au-delà de la note extrême.
 */

import { SID } from '../model/index.js';

export const TAB_STEM_LEN = 3.0; // STAFFTYPE_TAB_DEFAULTSTEMLEN_UP / _DN
export const TAB_STEM_DIST = 1.0; // STAFFTYPE_TAB_DEFAULTSTEMDIST_UP / _DN : écart entre la ligne extrême et le départ de la hampe
export const TAB_SHORT_STEM_RATIO = 0.5; // STAFFTYPE_TAB_SHORTSTEMRATIO (blanche, préréglage « SHORTER »)
export const TAB_DOT_DIST_X = 0.75; // STAFFTYPE_TAB_DEFAULTDOTDIST_X : points à côté de la hampe
const THROUGH_CLEARANCE = 0.7; // `layoutStem` : la hampe traversante démarre à 0,7 distance de lignes de la note extrême

// Tableau de réduction maximale (`maxReduction`) : [nombre de ligatures][demi-espaces hors portée, plafonné à 4]
const MAX_REDUCTIONS = [[1, 2, 3, 4, 4], [0, 1, 2, 3, 3], [0, 1, 1, 1, 1], [0, 0, 0, 1, 1]];

/** `StemLayout::maxReduction` (accord de taille normale). */
function maxReduction(beams, hook, extension, shorten, mag = 1) {
  if (!shorten) return 0;
  const count = hook ? 0 : beams;
  if (count >= 4) return 0;
  const half = Math.min(Math.floor(extension / 2), 4);
  let reduction = MAX_REDUCTIONS[count][half];
  if (mag < 1) return hook ? Math.min(reduction, 1) : reduction; // ornement : seule exception, le crochet traditionnel
  if (count === 1 && half < 2) reduction = 2;
  else if (count === 3 && half === 3) reduction = 0;
  if (hook) reduction = Math.min(reduction, 1); // crochet traditionnel
  return reduction;
}

/** `stemOpticalAdjustment` : pointe sur une ligne paire (quarts d'espace) = un quart de moins. */
const optical = (beams, hook, end) => (hook || beams === 0 || beams > 2 ? 0 : (((end + 4) % 4) + 4) % 4 === 2 ? 1 : 0);

/** `minStaffOverlap` pour une portée de `lines` lignes (quarts d'espace, taille normale). */
function minOverlap(up, lines, beams, hook, full = true) {
  let overlap = 8;
  if (full) {
    if (beams === 3 && !hook) overlap = 12;
    else if (beams >= 4 && !hook) overlap = (beams - 4) * 3 + 14;
  }
  overlap = Math.min(overlap, full ? (lines - 1) * 4 : (lines - 4) * 4);
  return up ? (lines - 1) * 4 - overlap : overlap;
}

/**
 * Longueur de la hampe d'un accord de tablature À TRAVERS la portée = `calcDefaultStemLength` (branche tablature : longueur par
 * défaut ×1,5, quarts d'espace par demi-ligne = floor(2 × distance de lignes)). `length` = distance (espaces) de la note la plus éloignée
 * de la pointe à la pointe ; `fromFar` = la part au-delà de la note extrême du côté de la pointe.
 * @param up        hampe montante
 * @param upStr     indice (0 = ligne du haut) de la corde la plus haute de l'accord ; @param downStr la plus basse
 * @param beams     nombre de ligatures si l'accord est ligaturé (0 sinon) ; @param hook crochet isolé
 * @param lineDist  distance de lignes (1,5)
 * @param style     lecteur de style (`SID.STEM_LENGTH`, `SID.SHORTEST_STEM`, `SID.SHORT_STEM_START_LOCATION`, `SID.SHORTEN_STEM`)
 */
export function tabThroughStemLength({ up, upStr, downStr, beams = 0, hook = false, lines, lineDist, style, tremoloMin = 0, mag = 1 }) {
  const qpl = Math.floor(lineDist * 2); // `quarterSpacesPerLine` : quarts d'espace par DEMI-distance de lignes (3 pour 1,5)
  const upLine = upStr * 2;
  const downLine = downStr * 2;
  const beamAddition = hook ? 0 : beams === 3 ? 2 : beams > 3 ? (beams - 3) * 3 : 0;
  const defaultLen = Math.trunc((Math.trunc(style(SID.STEM_LENGTH) * 4) + beamAddition) * 1.5);
  const shortest = Math.trunc((style(SID.SHORTEST_STEM) + 0.168) * 4);
  const shortStart = Math.trunc(style(SID.SHORT_STEM_START_LOCATION)) * qpl + 1;
  const chordHeight = (downLine - upLine) * qpl;
  const mid = minOverlap(up, lines, beams, hook, mag >= 1);
  const shorten = style(SID.SHORTEN_STEM);

  // longueur minimale d'une hampe ligaturée (`calcMinStemLength`)
  let minLength = tremoloMin; // trémolo sur une note (`calcMinStemLength`, quarts d'espace) ; 0 sinon
  if (beams > 0 && !hook) {
    const inner = [10, 9, 8, 7][Math.min(beams, 3)];
    let beamed = Math.max(minLength, inner) + beams * 3 - 1;
    const line = up ? upLine : downLine;
    if (beams >= 4 && ((up && line > 0) || (!up && line < (lines - 1) * 2))) beamed += 1;
    minLength = Math.max(minLength, beamed);
  }

  let ideal = defaultLen;
  if (up) {
    const end = upLine * qpl - defaultLen;
    const endMag = upLine * qpl - defaultLen * mag; // avec l'échelle de l'accord (`stemEndPositionMag`)
    if (endMag <= -shortStart) ideal = Math.max(ideal - maxReduction(beams, hook, Math.abs(Math.floor(endMag) + shortStart), shorten, mag), shortest);
    else if (end > mid) { /* prolongation ci-dessous */ } else ideal = Math.max(ideal - optical(beams, hook, end), shortest);
  } else {
    const end = downLine * qpl + defaultLen;
    const downShortStart = (lines - 1) * (2 * qpl) + shortStart;
    const endMag = downLine * qpl + defaultLen * mag;
    if (endMag >= downShortStart) ideal = Math.max(ideal - maxReduction(beams, hook, Math.abs(Math.ceil(endMag) - downShortStart), shorten, mag), shortest);
    else if (end < mid) { /* idem */ } else ideal = Math.max(ideal - optical(beams, hook, end), shortest);
  }
  const length = Math.max(ideal, minLength);

  // de la note de départ (opposée à la pointe) à la pointe, puis prolongation jusqu'à 2 sp dans la portée (`extraLength`, lineDist ≥ 1)
  const final = chordHeight / 4 + (length / 4) * mag;
  const topLine = 0;
  const bottomLine = lineDist * (lines - 1);
  const startY = (up ? downStr : upStr) * lineDist; // y vers le bas depuis la ligne du haut
  const endY = startY + (up ? -final : final);
  const target = lineDist === 1 ? (mid / 4) : up ? bottomLine - 2 : topLine + 2;
  let extra = 0;
  if (up && endY > target) extra = endY - target;
  else if (!up && endY < target) extra = target - endY;
  return { length: final + extra, fromFar: (length / 4) * mag + extra };
}

/**
 * Hampe À CÔTÉ de la portée : départ et longueur fixes (`tabRestStemPosY`, `tabStemLength`).
 * @param topY  ordonnée de la ligne du haut (espaces depuis la ligne du bas)
 * @returns { startY, tipY }
 */
export function tabBesideStem({ up, topY, shortHalf }) {
  const delta = shortHalf ? TAB_STEM_LEN * 0.5 : 0; // blanche courte : on s'éloigne d'une demi-longueur de plus
  const length = TAB_STEM_LEN * (shortHalf ? TAB_SHORT_STEM_RATIO : 1);
  if (up) {
    const startY = topY + TAB_STEM_DIST + delta;
    return { startY, tipY: startY + length };
  }
  const startY = -TAB_STEM_DIST - delta;
  return { startY, tipY: startY - length };
}

/**
 * Barres obliques d'une blanche (style « SLASHED », `TDraw::draw(Stem)`) : deux parallélogrammes sur la hampe.
 * @param axisX    abscisse de l'axe de la hampe ; @param posY ordonnée (y vers le haut) du point d'attache de la hampe
 * @param length   longueur de la hampe ; @param through hampe traversante : calage sur les demi-lignes
 * @param topY     (facultatif) ordonnée imposée du bord haut du bloc des deux barres, y vers le haut ; remplace le calcul MuseScore
 */
export const TAB_SLASH_BLOCK_HEIGHT = 0.4 + 0.8 + 0.8; // épaisseur + pente + déplacement (voir tabSlashItems)
export function tabSlashItems({ up, axisX, posY, length, through, lineDist, ref, topY = null }) {
  const W = 1.2; const SLANT = 0.8; const THICK = 0.4; const DISPL = 0.8;
  const total = THICK + DISPL + SLANT;
  let y = up ? -length + (TAB_STEM_LEN - total) * 0.5 : length - (TAB_STEM_LEN + total) * 0.5; // y vers le BAS depuis l'attache
  if (topY !== null) y = posY - topY; // position imposée (y vers le haut du bord haut du bloc) : blanche + trémolo, voir `stemSpec`
  else if (through) {
    const half = lineDist * 0.5;
    y = Math.round((y + total / 2) / half) * half - total / 2;
  }
  const items = [];
  for (let i = 0; i < 2; i++) {
    const pts = [[W / 2, y], [W / 2, y + THICK], [-W / 2, y + THICK + SLANT], [-W / 2, y + SLANT]];
    items.push({ kind: 'polygon', role: 'stem-slash', points: pts.map(([dx, dy]) => [axisX + dx, posY - dy]), ref });
    y += DISPL;
  }
  return items;
}
