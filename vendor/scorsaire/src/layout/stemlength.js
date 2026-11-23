/*
 * Longueur de hampe d'un accord — portage de `StemLayout::calcDefaultStemLength` (MuseScore `rendering/score/stemlayout.cpp`) :
 * longueur par défaut 3,5 espaces, raccourcie selon un tableau (`maxReduction`) quand la pointe dépasse la portée, ajustement
 * optique d'un quart d'espace sur une ligne paire, longueur minimale des hampes ligaturées (`calcMinStemLength`), puis
 * prolongation jusqu'à la ligne du milieu (`minStaffOverlap`, `extraLength`). Remplace la formule approchée du prototype :
 * une note sur la 2e ligne a une hampe de 3,5 (pointe 1/2 espace au-dessus de la ligne du haut), pas 3.
 *
 * Unités de MuseScore : quarts d'espace, lignes en DEMI-espaces depuis la ligne du haut, y vers le BAS. Nos positions `ys` sont
 * en espaces depuis la ligne du bas, y vers le haut ; la conversion est faite ici. Portée de 5 lignes, échelle 1, taille normale.
 * Trémolo sur une note : terme de `calcMinStemLength` porté dans tremolo.js. Notes d'ornement : `mag` (0,7). Pas encore : portées de tablature, largeur de ligature « larges ».
 */
import { SID } from '../model/index.js';
import { tremoloMinStemLength } from './tremolo.js';

const MAX_REDUCTIONS = [
  // 1 esp. 1,5 esp. 2 esp. 2,5 esp. ≥ 3 esp. d'extension hors portée
  [1, 2, 3, 4, 4], // 0 ligature (note seule, avec ou sans crochet)
  [0, 1, 2, 3, 3], // 1 ligature
  [0, 1, 1, 1, 1], // 2 ligatures
  [0, 0, 0, 1, 1], // 3 ligatures
];

function maxReduction(beams, hook, extension, style, mag = 1) {
  if (!style(SID.SHORTEN_STEM)) return 0;
  const count = hook ? 0 : beams;
  if (count >= 4) return 0;
  const half = Math.min(Math.floor(extension / 2), 4);
  let reduction = MAX_REDUCTIONS[count][half];
  if (mag < 1) {
    // ornement : seule exception, le crochet traditionnel (réduction de 1 quart au plus : plus bas, les crochets tomberaient trop bas)
    if (hook) reduction = Math.min(reduction, 1);
    return reduction;
  }
  if (count === 1 && half < 2) reduction = 2; // moins d'1 espace hors portée : déjà ajusté aux lignes, on réduit d'1 espace
  else if (count === 3 && half === 3) reduction = 0; // 3 ligatures à 1,5 espace : on ALLONGE au lieu de réduire
  if (hook) reduction = Math.min(reduction, 1); // crochet traditionnel
  return reduction;
}

function opticalAdjustment(beams, hook, stemEnd) {
  if (hook) return 0; // un crochet sans ligature
  if (beams === 0 || beams > 2) return 0;
  // `fmod(stemEndPosition + 4, 4) == 2` : fmod garde le signe (comme `%` en JS) — une pointe à plus d'un espace au-dessus de la
  // ligne du haut (valeur < −4) n'a donc JAMAIS d'ajustement (vérifié sur l'export d'ornements ligaturés si4, 03/10/2026)
  return (stemEnd + 4) % 4 === 2 ? 1 : 0; // pointe sur une ligne paire : un quart d'espace de moins
}

/** Place minimale de la hampe dans la portée (quarts d'espace) : la pointe doit atteindre au moins la ligne du milieu (ou plus, avec des ligatures). */
function middleLine(up, beams, hook, full = true, lines = 5) {
  let overlap = 8;
  if (full) {
    if (beams === 3 && !hook) overlap = 12;
    else if (beams >= 4 && !hook) overlap = (beams - 4) * 3 + 14;
  }
  // `StemLayout::minStaffOverlap` : un ornement (taille réduite) n'empiète que d'1 espace (4 quarts) sur la portée, pas jusqu'à la ligne du milieu
  overlap = Math.min(overlap, (lines - (full ? 1 : 4)) * 4);
  return up ? (lines - 1) * 4 - overlap : overlap;
}

/**
 * @param up     hampe montante
 * @param ys     positions des notes de l'accord (espaces depuis la ligne du bas)
 * @param beams  nombre de ligatures de l'accord s'il est ligaturé (0 sinon)
 * @param hook   l'accord porte un crochet (note seule de valeur ≤ croche)
 * @param tremolo  trémolo sur une note de l'accord ({ strokes } | { buzz }) ou null : allonge la hampe minimale
 * @param hookInfo métriques du crochet ({ height, anchorY }, tremolo.js `hookMetrics`) — requis avec `tremolo` si `hook`
 * @param durationBeams  nombre de ligatures/crochets de la DURÉE de l'accord (`Chord::beams`), pour le trémolo
 * @param mag    échelle de l'accord (`Chord::intrinsicMag` : 0,7 pour un ornement) ; < 1 : `isFullSize` faux dans `minStaffOverlap`
 * @returns y (espaces depuis la ligne du bas, vers le haut) de la pointe de la hampe
 */
export function stemTipY({ up, ys, beams = 0, hook = false, style, tremolo = null, hookInfo = null, durationBeams = 0, mag = 1, lines = 5, headExtra = 0.168 }) {
  const bottomLine = 2 * (lines - 1); // demi-espaces : ligne du bas, depuis la ligne du haut
  const upLine = Math.round(bottomLine - 2 * Math.max(...ys)); // demi-espaces depuis la ligne du haut, vers le bas
  const downLine = Math.round(bottomLine - 2 * Math.min(...ys));
  const beamAddition = hook ? 0 : beams === 3 ? 2 : beams > 3 ? (beams - 3) * 3 : 0;
  const defaultLength = Math.trunc(style(SID.STEM_LENGTH) * 4) + beamAddition; // quarts d'espace
  const shortest = Math.trunc((style(SID.SHORTEST_STEM) + Math.abs(headExtra)) * 4); // + l'écart d'accroche de la hampe (`extraHeight` : y de `stemUpSE` / `stemDownNW` de LA tête ; tête noire : 0,168, croix : 0,44)
  const chordHeight = (downLine - upLine) * 2;
  const shortStart = style(SID.SHORT_STEM_START_LOCATION) * 2 + 1;
  const mid = middleLine(up, beams, hook, mag >= 1, lines);

  // longueur minimale d'une hampe ligaturée
  let minLength = 0;
  if (tremolo) {
    minLength = tremoloMinStemLength({
      tremolo, up, line: up ? upLine : downLine, beams: durationBeams, hook: hook ? hookInfo : null, style,
      straightFlags: style(SID.USE_STRAIGHT_NOTE_FLAGS),
    });
  }
  if (beams > 0 && !hook) {
    const inner = [10, 9, 8, 7][Math.min(beams, 3)];
    let beamed = Math.max(minLength, inner) + beams * 3 - 1;
    if (beams >= 4) {
      const line = up ? upLine : downLine;
      if ((up && line > 0) || (!up && line < bottomLine)) beamed += 1;
    }
    minLength = Math.max(minLength, beamed);
  }

  let ideal = defaultLength;
  if (up) {
    const end = upLine * 2 - defaultLength;
    const endMag = upLine * 2 - defaultLength * mag; // avec l'échelle de l'accord (`stemEndPositionMag`)
    if (endMag <= -shortStart) ideal = Math.max(ideal - maxReduction(beams, hook, Math.abs(Math.floor(endMag) + shortStart), style, mag), shortest);
    else if (end > mid) { /* pris en charge par la prolongation ci-dessous */ } else ideal = Math.max(ideal - opticalAdjustment(beams, hook, end), shortest);
  } else {
    const end = downLine * 2 + defaultLength;
    const endMag = downLine * 2 + defaultLength * mag;
    const downShortStart = (lines - 1) * 4 + shortStart;
    if (endMag >= downShortStart) ideal = Math.max(ideal - maxReduction(beams, hook, Math.abs(Math.ceil(endMag) - downShortStart), style, mag), shortest);
    else if (end < mid) { /* idem */ } else ideal = Math.max(ideal - opticalAdjustment(beams, hook, end), shortest);
  }
  let length = Math.max(ideal, minLength);

  if (beams === 4 && !hook) {
    const diff = up ? Math.max(0, upLine - bottomLine) : Math.max(0, -downLine);
    if (diff === 2) length = Math.max(length, 21);
    else if (diff === 3 || diff === 4) length = Math.max(length, 23);
  }

  // de la note du côté opposé à la pointe jusqu'à la pointe, puis prolongation jusqu'à la ligne du milieu
  const final = chordHeight / 4 + (length / 4) * mag;
  const startDown = (up ? downLine : upLine) * 0.5; // y vers le bas, en espaces depuis la ligne du haut
  const endDown = startDown + (up ? -final : final);
  // portée de moins de 2 espaces de haut (1, 2 ou 3 lignes) : on prolonge jusqu'à la ligne opposée (`bottomLine < 2 * spatium`)
  const target = lines - 1 < 2 ? (up ? 0 : lines - 1) : mid / 4;
  const tipDown = up ? Math.min(endDown, target) : Math.max(endDown, target);
  return (lines - 1) - tipDown;
}
