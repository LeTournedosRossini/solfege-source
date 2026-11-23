/*
 * Ancrages d'une ligature ou d'un trémolo à deux notes — port de `BeamTremoloLayout` (MuseScore
 * `rendering/score/beamtremololayout.cpp`) : grille au quart d'espace, « dictateur » / « pointeur », pente maximale selon
 * la largeur, ligne de portée visée, positions de ligature valides (ni flottante, ni collée à une ligne du mauvais côté),
 * dégagement des notes intérieures. Sert aux trémolos à deux accords (`tremolo.js`) ; prévu pour les ligatures.
 *
 * Cas portés : portée standard à 5 lignes, échelle 1, hampes non personnalisées, un seul niveau de portée (sans
 * ligature à cheval sur deux portées), pas de tablature. Notes d'ornement : `L.isGrace` (sites de `beamtremololayout.cpp`). Non portés (chaque absence est
 * marquée « NON PORTÉ » dans le code) : `calculateAnchorsCross`, `noSlope`, `useWideBeams`,
 * trémolo à l'intérieur d'une ligature (`tremAnchors`).
 *
 * REPÈRE : celui de MuseScore — y vers le BAS, 0 = ligne du haut de la portée, en espaces ; « quarts d'espace » = entiers
 * (1 = 0,25 esp.). `line` = demi-espaces depuis la ligne du haut, y vers le bas (5 lignes : 0 à 8).
 *
 * @typedef {object} BeamMember  un accord du groupe
 * @property {number} x        axe de sa hampe
 * @property {number} farY     y de la note du côté OPPOSÉ à la ligature (la plus basse si la hampe monte)
 * @property {number} len      longueur de hampe par défaut (espaces, depuis `farY`) — `calcDefaultStemLength`
 * @property {number} upLine   ligne de la note la plus haute ; @property {number} downLine  de la plus basse
 * @property {number} strokes  barres à cet accord (`strokeCount`)
 * @property {number} attachY  y du point d'attache de la hampe sur la tête d'extrémité
 * @property {boolean} [stemless]  accord sans hampe (ronde) : `x` est l'abscisse commune de tous les ancrages
 */

const COMPARE_DELTA = 1e-9;
const MAX_SLOPES = [0, 1, 2, 3, 4, 5, 6, 7];
const MIN_STEM_LENGTHS = [11, 13, 15, 18, 21, 24, 27, 30, 33]; // quarts d'espace, selon le nombre de barres (à partir de 1)
const BEAMS_COUNT = 9;

/** `round` de C++ (arrondi loin de zéro sur .5), différent de Math.round pour les négatifs. */
const cround = (v) => Math.sign(v) * Math.round(Math.abs(v));
const eqOrLess = (a, b) => a <= b + COMPARE_DELTA;
const eqOrMore = (a, b) => a >= b - COMPARE_DELTA;
const mod = (a, n) => ((a % n) + n) % n;

/** Réglages de mise en page (`setupLData`). @param up sens des hampes ; @param beamWidth épaisseur de ligature (esp.) ; @param stemWidth épaisseur de hampe. */
export function beamLayoutData({ up, beamWidth = 0.5, stemWidth = 0.12, beamSpacing = 3, grace = false, graceMag = 0.7 }) {
  // ornements (`setupLData`) : `beamDist` × graceNoteMag ; `beamWidth` des ancrages reste celui de la ligature normale (c'est
  // l'ÉPAISSEUR dessinée qui est réduite, `BeamLayout::layout2`) ; `stemWidth` = largeur de la hampe de l'ornement
  return { up, beamWidth, stemWidth, beamSpacing, beamDist: (beamSpacing / 4) * (grace ? graceMag : 1), isGrace: grace, graceMag };
}

// ---------- ancres géométriques ----------

/** `chordBeamAnchorX` : bord gauche de la hampe (Start), axe (Middle) ou bord droit (End). */
export function chordBeamAnchorX(L, m, type) {
  if (m.stemless) return m.x; // sans hampe : même abscisse quel que soit le type d'ancre
  if (type === 'start') return m.x - L.stemWidth / 2;
  if (type === 'end') return m.x + L.stemWidth / 2;
  return m.x;
}

/** `chordBeamAnchorY` : milieu de la ligature (et non la pointe de hampe) pour la longueur par défaut. */
export function chordBeamAnchorY(L, m) {
  const upValue = L.up ? -1 : 1;
  return m.farY + m.len * upValue - (L.beamWidth / 2) * upValue;
}

const strokeCount = (m) => m.strokes;

export function minStemLength(m) {
  const beams = strokeCount(m);
  if (beams > BEAMS_COUNT) return MIN_STEM_LENGTHS[BEAMS_COUNT - 1];
  return MIN_STEM_LENGTHS[Math.max(beams - 1, 0)];
}

const lineOf = (L, m) => (L.up ? m.upLine : m.downLine);

// ---------- positions valides ----------

function isBeamInsideStaff(yPos, staffLines, allowFloater) {
  const aboveStaff = allowFloater ? -2 : -3;
  const belowStaff = (staffLines - 1) * 4 + (allowFloater ? 2 : 3);
  return yPos > aboveStaff && yPos < belowStaff;
}

function isValidBeamPosition(isUp, yPos, isStart, isAscending, isFlat, staffLines, isOuter) {
  // hors de la portée
  const slantsAway = (isUp && isAscending === isStart) || (!isUp && isAscending !== isStart);
  if (!isBeamInsideStaff(yPos, staffLines, isOuter && (slantsAway || isFlat))) return true;
  yPos += 8; // évite le modulo négatif
  if (yPos % 4 === 2) return false; // flottante
  if (isFlat) return true;
  if (yPos % 4 === 0) return true; // sur une ligne
  if (yPos % 4 === 3) return isAscending !== isStart; // « assise » : seulement si on part d'ici en descendant, ou on y arrive en montant
  return isAscending === isStart; // « suspendue »
}

function is64thBeamPositionException(beamSpacing, yPos, staffLines) {
  if (beamSpacing === 4) return false;
  return yPos === 2 || yPos === staffLines * 4 - 2 || yPos === staffLines * 4 - 6 || yPos === -2;
}

function getOuterBeamPosOffset(L, innerBeam, beamCount, staffLines) {
  const spacing = L.up ? -L.beamSpacing : L.beamSpacing;
  let offset = (beamCount - 1) * spacing;
  let isInner = false;
  while (offset !== 0 && !isBeamInsideStaff(innerBeam + offset, staffLines, isInner)) {
    offset -= spacing;
    isInner = true;
  }
  return offset;
}

function findValidBeamOffset(L, outer, beamCount, staffLines, isStart, isAscending, isFlat) {
  let isBeamValid = false;
  let offset = 0;
  const innerBeam = outer + (beamCount - 1) * (L.up ? L.beamSpacing : -L.beamSpacing);
  while (!isBeamValid) {
    while (!isValidBeamPosition(L.up, innerBeam + offset, isStart, isAscending, isFlat, staffLines, beamCount < 2)) {
      offset += L.up ? -1 : 1;
    }
    const outerMostBeam = innerBeam + offset + getOuterBeamPosOffset(L, innerBeam + offset, beamCount, staffLines);
    if (isValidBeamPosition(L.up, outerMostBeam, isStart, isAscending, isFlat, staffLines, true)
      || (beamCount === 4 && is64thBeamPositionException(L.beamSpacing, outerMostBeam, staffLines))) {
      isBeamValid = true;
    } else {
      offset += L.up ? -1 : 1;
    }
  }
  return offset;
}

/** @returns [dictator, pointer] */
function setValidBeamPositions(L, members, dictator, pointer, beamCountD, beamCountP, staffLines, isStartDictator, isFlat, isAscending) {
  let areBeamsValid = false;
  let has3BeamsInsideStaff = beamCountD >= 3 || beamCountP >= 3;
  while (!areBeamsValid && has3BeamsInsideStaff && L.beamSpacing !== 4) {
    const dictatorInner = dictator + (beamCountD - 1) * (L.up ? L.beamSpacing : -L.beamSpacing);
    // dictatorInner pour les deux, pour simuler des ligatures plates
    const outerDictatorOffset = getOuterBeamPosOffset(L, dictatorInner, beamCountD, staffLines);
    if (Math.abs(outerDictatorOffset) <= L.beamSpacing) {
      has3BeamsInsideStaff = false;
      break;
    }
    const offsetD = findValidBeamOffset(L, dictator, beamCountD, staffLines, isStartDictator, false, true);
    const offsetP = findValidBeamOffset(L, pointer, beamCountP, staffLines, isStartDictator, false, true);
    const offset = offsetD === 0 ? offsetP : offsetD;
    if (pointer === dictator) dictator += offset;
    pointer = dictator;
    if (offset === 0) areBeamsValid = true;
  }
  if (isFlat) areBeamsValid = false; // les ligatures plates demandent des vérifications de plus
  while (!areBeamsValid) {
    const dictatorOffset = findValidBeamOffset(L, dictator, beamCountD, staffLines, isStartDictator, isAscending, isFlat);
    dictator += dictatorOffset;
    pointer += dictatorOffset;
    if (isFlat) {
      pointer = dictator;
      let currOffset = 0;
      for (const m of members) {
        // (les silences ne sont ni gérés ni nécessaires : un groupe ne contient que des accords)
        const beamCount = strokeCount(m);
        currOffset = findValidBeamOffset(L, dictator, beamCount, staffLines, isStartDictator, isAscending, isFlat);
        if (currOffset) break;
      }
      if (currOffset === 0) {
        areBeamsValid = true;
      } else {
        dictator += currOffset;
        pointer += currOffset;
      }
    } else {
      pointer += findValidBeamOffset(L, pointer, beamCountP, staffLines, !isStartDictator, isAscending, isFlat);
      if ((L.up && pointer <= dictator) || (!L.up && pointer >= dictator)) dictator = pointer + (L.up ? -1 : 1);
      else areBeamsValid = true;
    }
  }
  return [dictator, pointer];
}

// ---------- pente ----------

/** `getMaxSlope` : pente maximale (quarts d'espace) selon la largeur (espaces) entre les 1er et dernier éléments du groupe. */
export function maxSlopeForWidth(width) {
  if (width < 3.0) return MAX_SLOPES[1];
  if (width < 5.0) return MAX_SLOPES[2];
  if (width < 7.5) return MAX_SLOPES[3];
  if (width < 10.0) return MAX_SLOPES[4];
  if (width < 15.0) return MAX_SLOPES[5];
  if (width < 20.0) return MAX_SLOPES[6];
  return MAX_SLOPES[7];
}

function getMaxSlope(L, members) {
  const endX = chordBeamAnchorX(L, members[members.length - 1], 'start');
  const startX = chordBeamAnchorX(L, members[0], 'end');
  return maxSlopeForWidth(endX - startX);
}

const FLAT = 'flat';
const SMALL_SLOPE = 'small';
const NO_CONSTRAINT = 'none';

/**
 * `getSlopeConstraint`. `notePositions` : lignes de toutes les notes du groupe, triées (vide → aucune contrainte).
 * Pour un trémolo (`beamType` 'tremolo') seule l'égalité des deux extrémités impose une ligature plate.
 */
function getSlopeConstraint(L, members, startPos, endPos, notePositions, beamType) {
  if (!notePositions.length) return NO_CONSTRAINT;
  if (startPos === endPos) return FLAT;
  if (beamType === 'tremolo') return NO_CONSTRAINT; // deux notes seulement : pas de « petite pente »
  const n = notePositions.length;
  if (members.length > 2) {
    if (L.up) {
      const higherEnd = Math.min(startPos, endPos);
      if (higherEnd > notePositions[0]) return FLAT; // une note est plus haute que l'extrémité la plus haute
      if (higherEnd === notePositions[0] && higherEnd >= notePositions[1]) {
        if (higherEnd > notePositions[1]) return FLAT;
        const chordCount = members.length;
        if (chordCount >= 3 && n >= 3) {
          if (higherEnd >= notePositions[2]) return FLAT; // trois notes au moins aussi hautes que l'extrémité
          const second = members[1];
          const secondToLast = members[chordCount - 2];
          const secondSame = startPos < endPos && second && second.upLine === higherEnd;
          const secondToLastSame = endPos < startPos && secondToLast && secondToLast.upLine === higherEnd;
          if (!(secondSame || secondToLastSame)) return FLAT; // une seule note de même hauteur mais pas voisine
          return SMALL_SLOPE; // exception : voisine de même hauteur, pente de 1/4 au plus
        }
        return FLAT;
      }
    } else {
      const lowerEnd = Math.max(startPos, endPos);
      if (lowerEnd < notePositions[n - 1]) return FLAT;
      if (lowerEnd === notePositions[n - 1] && lowerEnd <= notePositions[n - 2]) {
        if (lowerEnd < notePositions[n - 2]) return FLAT;
        const chordCount = members.length;
        if (chordCount >= 3 && n >= 3) {
          if (lowerEnd <= notePositions[n - 3]) return FLAT;
          const second = members[1];
          const secondToLast = members[chordCount - 2];
          const secondSame = startPos > endPos && second && second.downLine === lowerEnd;
          const secondToLastSame = endPos > startPos && secondToLast && secondToLast.downLine === lowerEnd;
          if (!(secondSame || secondToLastSame)) return FLAT;
          return SMALL_SLOPE;
        }
        return FLAT;
      }
    }
  }
  return NO_CONSTRAINT;
}

/** `getTargetStaffLine` : ligne (quarts d'espace) que la ligature doit au moins atteindre (milieu de la portée). */
function getTargetStaffLine(L, members, staffLines) {
  const startBeams = strokeCount(members[0]);
  const endBeams = strokeCount(members[members.length - 1]);
  // `getTargetStaffLine` : début « taille normale » si ni ornement ni petite note ; fin : `!isGrace`
  const startTarget = minStaffOverlap(L.up, staffLines, startBeams, L.beamSpacing / 4.0, !L.isGrace);
  const endTarget = minStaffOverlap(L.up, staffLines, endBeams, L.beamSpacing / 4.0, !L.isGrace);
  // la cible est décalée de 1 : l'ancre est au milieu de la ligature, pas à la pointe de la hampe
  if (L.up) return Math.min(startTarget, endTarget) + 1;
  return Math.max(startTarget, endTarget) - 1;
}

/** `StemLayout::minStaffOverlap` (notes de taille normale, sans crochet, sans ligatures larges). `beamSpacing` : 3 ou, pour `getTargetStaffLine`, 0,75 (repris tel quel de MuseScore). */
export function minStaffOverlap(up, staffLines, beamCount, beamSpacing, isFullSize = true) {
  let beamOverlap = 8;
  if (isFullSize) {
    if (beamCount === 3) beamOverlap = 12;
    else if (beamCount >= 4) beamOverlap = Math.trunc((beamCount - 4) * beamSpacing + 14);
  }
  // taille réduite (ornement) : la hampe n'empiète que d'1 espace sur la portée (`staffLineOffset` = 4)
  const staffOverlap = Math.min(beamOverlap, (staffLines - (isFullSize ? 1 : 4)) * 4);
  if (!up) return staffOverlap;
  return (staffLines - 1) * 4 - staffOverlap;
}

/** `computeDesiredSlant` (ligature sur une seule portée, non figée à plat par l'utilisateur). */
function computeDesiredSlant(L, members, startPos, endPos, notePositions, beamType, targetLine, dictator, pointer) {
  let dictatorExtension = targetLine - dictator; // pour traiter comme plates les ligatures prolongées jusqu'à la ligne du milieu
  let pointerExtension = targetLine - pointer;
  if (L.up) {
    dictatorExtension = Math.min(dictatorExtension, 0);
    pointerExtension = Math.min(pointerExtension, 0);
  } else {
    dictatorExtension = Math.max(dictatorExtension, 0);
    pointerExtension = Math.max(pointerExtension, 0);
  }
  if (dictator + dictatorExtension === targetLine && pointer + pointerExtension === targetLine) return 0;
  if (startPos === endPos) return 0;
  const constraint = getSlopeConstraint(L, members, startPos, endPos, notePositions, beamType);
  if (constraint === FLAT) return 0;
  if (constraint === SMALL_SLOPE) return dictator > pointer ? -1 : 1;
  const maxSlope = getMaxSlope(L, members);
  // pente maximale d'après l'intervalle entre les notes
  const interval = Math.min(Math.abs(endPos - startPos), MAX_SLOPES.length - 1);
  return Math.min(maxSlope, MAX_SLOPES[interval]) * (L.up ? 1 : -1);
}

function addMiddleLineSlant(L, dictator, pointer, beamCount, targetLine, interval, desiredSlant) {
  // NON PORTÉ : `noSlope`. Ornements (`isSmall`) : pas d'exception « plus de 2 barres » ni « 2 barres » (`addMiddleLineSlant`)
  const isSmall = Boolean(L.isGrace);
  if (interval === 0 || (!isSmall && beamCount > 2 && L.beamSpacing !== 4)) return dictator;
  const isOnTargetLine = pointer === targetLine && Math.abs(pointer - dictator) < 2;
  if (isOnTargetLine) {
    if (Math.abs(desiredSlant) === 1 || interval === 1 || (beamCount === 2 && L.beamSpacing !== 4 && !isSmall)) {
      dictator = targetLine + (L.up ? -1 : 1);
    } else {
      dictator = targetLine + (L.up ? -2 : 2);
    }
  }
  return dictator;
}

// ---------- hampes d'extrémité et notes intérieures ----------

/**
 * `setSmallInnerBeamPos` : ligature PLATE de petites notes / d'ornements dont une note est hors de la portée — la ligature la plus
 * intérieure reste à au moins 0,5 esp. dans la portée (fractions de quart d'espace permises : `mag` peut changer).
 * @returns [dictator, pointer]
 */
function setSmallInnerBeamPos(L, members, dictator, pointer, staffLines, isFlat) {
  if (!L.isGrace || !isFlat) return [dictator, pointer];
  let noteOutsideStaff = false;
  let beamCount = 0;
  for (const m of members) {
    beamCount = Math.max(beamCount, strokeCount(m));
    noteOutsideStaff = noteOutsideStaff || (m.downLine < -2 && !L.up) || (m.upLine >= 11 && L.up);
  }
  if (!noteOutsideStaff) return [dictator, pointer];
  const innerBeam = dictator + (beamCount - 1) * (L.up ? L.beamSpacing : -L.beamSpacing) * L.graceMag;
  const aboveStaff = 1;
  const belowStaff = (staffLines - 1) * 4 - 1;
  let offset = 0;
  if (L.up) offset = Math.min(offset, Math.trunc(Math.floor(belowStaff - innerBeam)));
  else offset = Math.max(offset, Math.trunc(Math.ceil(aboveStaff - innerBeam)));
  dictator += offset;
  return [dictator, dictator];
}

function offsetBeamWithAnchorShortening(L, members, dictator, pointer, staffLines, isStartDictator, stemLengthDictator, targetLine) {
  const startChord = members[0];
  const endChord = members[members.length - 1];
  let dictatorBeams = strokeCount(isStartDictator ? startChord : endChord);
  let pointerBeams = strokeCount(isStartDictator ? endChord : startChord);
  if (dictatorBeams > BEAMS_COUNT) dictatorBeams = BEAMS_COUNT - 1;
  if (pointerBeams > BEAMS_COUNT) pointerBeams = BEAMS_COUNT - 1;

  let maxDictatorReduce = stemLengthDictator - MIN_STEM_LENGTHS[Math.max(dictatorBeams - 1, 0)];
  maxDictatorReduce = Math.min(Math.abs(dictator - targetLine), maxDictatorReduce);

  const isFlat = dictator === pointer;
  const isAscending = lineOf(L, startChord) > lineOf(L, endChord);
  const towardBeam = L.up ? -1 : 1;
  let newDictator = dictator;
  let newPointer = pointer;
  let reduce = 0;
  const fourBeamException = (beams, yPos) => beams >= 4 && (yPos + 400) % 4 === 2;
  while (!fourBeamException(dictatorBeams, newDictator)
    && !isValidBeamPosition(L.up, newDictator, isStartDictator, isAscending, isFlat, staffLines, true)) {
    if (++reduce > maxDictatorReduce) {
      // impossible de raccourcir : retour à la longueur par défaut puis allongement
      newDictator = dictator;
      newPointer = pointer;
      while (!isValidBeamPosition(L.up, newDictator, isStartDictator, isAscending, isFlat, staffLines, true)) {
        newDictator += towardBeam;
        newPointer += towardBeam;
      }
      break;
    }
    newDictator += -towardBeam;
    newPointer += -towardBeam;
  }
  // newDictator est valide, ou égal à dictator ; on contraint d'abord le pointeur, puis on recule vers la ligature
  newPointer = L.up ? Math.min(newPointer, targetLine) : Math.max(newPointer, targetLine);
  while (!fourBeamException(dictatorBeams, newDictator) && !fourBeamException(pointerBeams, newPointer)
    && (!isValidBeamPosition(L.up, newDictator, isStartDictator, isAscending, isFlat, staffLines, true)
      || !isValidBeamPosition(L.up, newPointer, !isStartDictator, isAscending, isFlat, staffLines, true))) {
    if (isFlat) {
      newDictator += towardBeam;
      newPointer += towardBeam;
    } else if (Math.abs(newDictator - newPointer) === 1) {
      newDictator += towardBeam;
    } else {
      newPointer += towardBeam;
    }
  }
  dictator = newDictator;
  pointer = newPointer;
  if (isFlat) pointer = dictator;
  return [dictator, pointer];
}

function offsetBeamToRemoveCollisions(L, members, dictator, pointer, startX, endX, isFlat, isStartDictator) {
  if (endX === startX) return [dictator, pointer];
  if (isFlat && dictator !== pointer) pointer = dictator; // ne devrait pas arriver
  const tolerance = L.beamWidth * 0.25 * (L.up ? -1 : 1);
  let startY = (isStartDictator ? dictator : pointer) / 4 + tolerance;
  let endY = (isStartDictator ? pointer : dictator) / 4 + tolerance;
  const first = members[0];
  const last = members[members.length - 1];
  let cur = 0;
  for (const m of members) {
    if (m === last || m === first) {
      cur++;
      continue;
    }
    let sameLineException = 0;
    if ((cur === 1) || (cur === members.length - 2)) {
      const outer = cur === 1 ? first : last;
      const innerLine = lineOf(L, m);
      const outerLine = lineOf(L, outer);
      if (innerLine === outerLine) {
        sameLineException = 1;
      } else if (members.length === 3) {
        const otherOuter = outer === first ? last : first;
        if (innerLine === lineOf(L, otherOuter)) sameLineException = 1;
      }
    }
    const anchorX = chordBeamAnchorX(L, m, 'middle');
    const anchorY = chordBeamAnchorY(L, m);
    const minLen = minStemLength(m) - sameLineException;
    const mag = m.mag ?? 1; // `chordRest->mag()` : 0,7 pour un ornement
    const proportionAlongX = (anchorX - startX) / (endX - startX);
    for (;;) {
      const slope = Math.abs(dictator - pointer);
      let reduction = 0.0;
      if (!isFlat) {
        if (slope <= 3) reduction = 0.25;
        else if (slope <= 6) reduction = 0.5;
        else reduction = 0.75;
      }
      // la ligature doit passer le sommet de l'ancre et la hampe intérieure garder sa longueur minimale
      const desiredY = proportionAlongX * (endY - startY) + startY;
      const beamClearsAnchor = (L.up && eqOrLess(desiredY, anchorY + reduction))
        || (!L.up && eqOrMore(desiredY, anchorY - reduction));
      const desiredLen = Math.abs(cround((desiredY - m.attachY) * 4)) + 1;
      if (beamClearsAnchor && desiredLen >= cround(minLen * mag)) break;
      if (isFlat || (L.isGrace && dictator === pointer)) {
        dictator += L.up ? -1 : 1;
        pointer += L.up ? -1 : 1;
      } else if (Math.abs(dictator - pointer) === 1) {
        dictator += L.up ? -1 : 1;
      } else {
        pointer += L.up ? -1 : 1;
      }
      startY = (isStartDictator ? dictator : pointer) / 4 + tolerance;
      endY = (isStartDictator ? pointer : dictator) / 4 + tolerance;
    }
    cur++;
  }
  return [dictator, pointer];
}

// ---------- ancrages ----------

/**
 * `calculateAnchors` : ancrages (milieu de la ligature de niveau 0) de début et de fin.
 * @param L        `beamLayoutData`
 * @param members  [BeamMember] dans l'ordre, au moins deux
 * @param notePositions  lignes (demi-espaces, y vers le bas) de TOUTES les notes du groupe, triées croissantes
 * @param beamType 'beam' | 'tremolo'
 * @returns { startX, endX, startY, endY, slope, beamDist }
 */
export function calculateAnchors(L, members, notePositions, { beamType = 'tremolo', staffLines = 5, tab = false } = {}) {
  const startChord = members[0];
  const endChord = members[members.length - 1];
  const startAnchor = { x: chordBeamAnchorX(L, startChord, 'start'), y: chordBeamAnchorY(L, startChord) };
  const endAnchor = { x: chordBeamAnchorX(L, endChord, 'end'), y: chordBeamAnchorY(L, endChord) };

  const startLength = startChord.len;
  const endLength = endChord.len;
  const startAnchorBase = startAnchor.y + (L.up ? startLength : -startLength);
  const endAnchorBase = endAnchor.y + (L.up ? endLength : -endLength);
  const startPos = lineOf(L, startChord);
  const endPos = lineOf(L, endChord);
  const interval = Math.abs(startPos - endPos);
  const isStartDictator = L.up ? startPos < endPos : startPos > endPos;
  let dictator = cround((isStartDictator ? startAnchor.y : endAnchor.y) / 0.25);
  let pointer = cround((isStartDictator ? endAnchor.y : startAnchor.y) / 0.25);

  const targetLine = getTargetStaffLine(L, members, staffLines);
  const slant = computeDesiredSlant(L, members, startPos, endPos, notePositions, beamType, targetLine, dictator, pointer);
  const isFlat = slant === 0;
  const specialSlant = isFlat ? getSlopeConstraint(L, members, startPos, endPos, notePositions, beamType) : NO_CONSTRAINT;
  const forceFlat = specialSlant === FLAT;
  const smallSlant = specialSlant === SMALL_SLOPE;
  if (isFlat) {
    dictator = L.up ? Math.min(pointer, dictator) : Math.max(pointer, dictator);
    pointer = dictator;
  } else if ((dictator > pointer) !== (isStartDictator ? startPos > endPos : endPos > startPos)) {
    dictator = pointer - slant;
  } else {
    pointer = dictator + slant;
  }
  const isAscending = startPos > endPos;
  const beamCountD = strokeCount(isStartDictator ? startChord : endChord);
  const beamCountP = strokeCount(isStartDictator ? endChord : startChord);
  const stemLengthStart = Math.abs(cround(((startAnchorBase - startAnchor.y)) * 4));
  const stemLengthEnd = Math.abs(cround(((endAnchorBase - endAnchor.y)) * 4));
  const stemLengthDictator = isStartDictator ? stemLengthStart : stemLengthEnd;
  if (endAnchor.x > startAnchor.x) {
    // ornements : positions intérieures dans la portée (`setSmallInnerBeamPos`), pas de raccourcissement des hampes d'extrémité
    [dictator, pointer] = setSmallInnerBeamPos(L, members, dictator, pointer, staffLines, isFlat);
    if (!L.isGrace) [dictator, pointer] = offsetBeamWithAnchorShortening(L, members, dictator, pointer, staffLines, isStartDictator, stemLengthDictator, targetLine);
    [dictator, pointer] = offsetBeamToRemoveCollisions(L, members, dictator, pointer, startAnchor.x, endAnchor.x, isFlat, isStartDictator);
  }
  const beamCount = Math.max(beamCountD, beamCountP);
  // tablature (`if (!ldata->tab)`) : ni positions valides par rapport aux lignes, ni pente de ligne du milieu, ni huitième d'espace
  if (!L.isGrace && !tab) [dictator, pointer] = setValidBeamPositions(L, members, dictator, pointer, beamCountD, beamCountP, staffLines, isStartDictator, isFlat, isAscending);
  if (!forceFlat && !tab) dictator = addMiddleLineSlant(L, dictator, pointer, beamCount, targetLine, interval, smallSlant ? 1 : slant);

  let startY = 0.25 * (isStartDictator ? dictator : pointer);
  let endY = 0.25 * (isStartDictator ? pointer : dictator);
  let beamDist = L.beamDist;

  // `add8thSpaceSlant` : 3 barres, ligature « inclinée » d'un huitième d'espace
  if (!tab && beamCount === 3 && L.beamSpacing === 3 && !((isFlat && dictator !== targetLine) || dictator !== pointer || interval === 0)
    && !((L.up && (dictator + 4) % 4 === 3) || (!L.up && (dictator + 4) % 4 === 1))) {
    const dy = L.up ? -0.125 : 0.125;
    if (isStartDictator) startY += dy;
    else endY += dy;
    beamDist += 0.0625;
  }
  const startX = chordBeamAnchorX(L, startChord, 'start');
  const endX = chordBeamAnchorX(L, endChord, 'end');
  return { startX, endX, startY, endY, slope: endX > startX ? (endY - startY) / (endX - startX) : 0, beamDist };
}
