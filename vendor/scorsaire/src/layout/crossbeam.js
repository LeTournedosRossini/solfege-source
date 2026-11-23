/*
 * Ligatures CROISÉES (une ligature dont les membres sont dessinés sur deux portées voisines, `ChordRest::staffMove` des accords du groupe
 * pas tous égaux) — port de MuseScore 4.7.5 :
 *   - `BeamBase::cross`, `defaultCrossStaffIdx`, `crossStaffIdx`, `ChordRest::isBelowCrossBeam` (`beambase.cpp`, `chordrest.cpp`) ;
 *   - `BeamLayout::layout1` (`beamlayout.cpp` : sens `up` de la ligature, `computeUpForMovedCross`) ;
 *   - `BeamTremoloLayout::calculateAnchorsCross` (`beamtremololayout.cpp`) : ligature « entre les deux portées » ;
 *   - `BeamLayout::createBeamSegments` / `createBeamSegment` / `createBeamletSegment` (barres secondaires, `overallUp` par sous-groupe,
 *     rallonge des hampes) ; `Beam::topLevelSegmentForElement` ;
 *   - `SystemLayout::minVertSpaceForCrossStaffBeams` (`systemlayout.cpp`) : distance minimale entre les deux portées ;
 *   - `TDraw::draw(Beam)` : épaisseur perpendiculaire à la pente.
 *
 * REPÈRE de ce module : celui de MuseScore (y vers le BAS, en espaces). Les données d'un membre sont dans le repère de SA portée (0 = ligne du
 * haut de cette portée) ; les résultats sont dans le repère COMMUN : 0 = ligne du haut de la portée du HAUT, la portée du bas étant `D`
 * plus bas (`D` = distance entre les lignes du haut des deux portées, connue seulement après l'espacement vertical d'où le second passage).
 *
 * Cas portés : exactement DEUX portées voisines, les deux côtés de la ligature occupés (`BETWEEN`), `PID.BEAM_CROSS_STAFF_MOVE` absent du
 * modèle donc `crossStaffIdx` = `defaultCrossStaffIdx`. NON PORTÉS : ligature utilisateur (`userModified`), ABOVE/BELOW (inatteignables sans
 * `BEAM_CROSS_STAFF_MOVE`), groupes sur trois portées, ornements, tablature, ligatures « français » (`frenchStyleBeams`), ligature en éventail
 * (`growLeft` ≠ `growRight`), trémolo à deux notes de portées différentes.
 *
 * @typedef {object} CrossMember  un élément du groupe, dans l'ordre
 * @property {boolean} rest      silence
 * @property {number}  x         accord : axe de la hampe ; silence : ancrage (`chordBeamAnchorX`, déjà réglé selon le sens de la ligature)
 * @property {boolean} lower     dessiné sur la portée du BAS (= `isBelowCrossBeam` : hampe vers le haut)
 * @property {number}  move      `staffMove` (−1, 0, +1)
 * @property {number}  beams     nombre de barres de l'élément ; @property {object} [info] @property {string} [dflt] (voir `collectBeamSegments`)
 * @property {object}  ms        accord seulement, repère de SA portée (y vers le bas) :
 *   farY (note du côté de la hampe, y), len (longueur de hampe par défaut), upLine / downLine (lignes de la note la plus haute / basse),
 *   topY / bottomY (y de la note la plus haute / basse), strokes (`strokeCount`)
 */
import { collectBeamSegments } from './beaming.js';
import { maxSlopeForWidth, minStemLength } from './beamtremolo.js';

/** Unités internes de MuseScore par espace : `Sid::spatium` = 1,75 mm × DPMM (1200 / 25,4). Sert à la troncature `int` de la pente (voir `slantAnchors`). */
export const SPATIUM_UNITS = 1.75 * (1200 / 25.4);
const BEAM_WIDTH = 0.5; // `Sid::beamWidth` (espaces)
const BEAM_DIST = 0.75; // `beamSpacing / 4` (3 / 4)

/** `round` de C++ (loin de zéro sur .5). */
const cround = (v) => Math.sign(v) * Math.round(Math.abs(v));

// ---------- direction ----------

/** `Beam::up()` d'une ligature croisée (`BeamLayout::layout1`) : plus grand déplacement > 0 → hampes vers le bas, sinon un déplacement < 0 → vers le haut. */
export function crossBeamUp(members) {
  const moves = members.map((m) => m.move);
  if (Math.max(...moves) > 0) return false;
  return Math.min(...moves) < 0;
}

/** Sens de la hampe d'un membre (`computeUpBeamCase` : accord sous la ligature → montante ; silence : sens de la ligature, `computeUp`). */
const upOf = (m, beamUp) => (m.rest ? beamUp : m.lower);

// ---------- ancres ----------

/** `Chord::line()` : ligne de la note du côté de la pointe de hampe (`up` ? note la plus haute : la plus basse). */
const lineOf = (c) => (c.lower ? c.ms.upLine : c.ms.downLine);

const anchorX = (m, type, stemWidth) => {
  if (m.rest) return m.x;
  if (type === 'start') return m.x - stemWidth / 2;
  if (type === 'end') return m.x + stemWidth / 2;
  return m.x;
};

/** `chordBeamAnchorY` dans le repère commun : milieu de la ligature (et non la pointe de hampe) pour la longueur par défaut. */
const anchorY = (m, D, beamWidth) => {
  const dy = m.lower ? D : 0;
  return m.lower ? m.ms.farY + dy - m.ms.len + beamWidth / 2 : m.ms.farY + dy + m.ms.len - beamWidth / 2;
};

// ---------- segments (sans géométrie) ----------

/**
 * Segments de barres avec leur sens (`BeamLayout::createBeamSegment` : `overallUp`) : chaque segment `{ kind, level, start, end, above, overallUp }`
 * (talon : `start = end = index`, `above = !up de l'accord`). Ne dépend ni de `D` ni des ancrages.
 */
export function crossSegmentList(members, beamUp) {
  const n = members.length;
  const out = [];
  for (const d of collectBeamSegments(members)) {
    if (d.kind === 'beamlet') {
      out.push({ ...d, start: d.index, end: d.index, above: !upOf(members[d.index], beamUp), overallUp: upOf(members[d.index], beamUp) });
      continue;
    }
    const isFirst = d.start === 0;
    const isLast = d.end === n - 1;
    const firstUp = upOf(members[d.start], beamUp);
    const lastUp = upOf(members[d.end], beamUp);
    let overallUp = beamUp;
    if (isFirst === isLast) {
      if (firstUp === lastUp) overallUp = firstUp; // les extrémités du sous-groupe vont du même côté
      else {
        let ups = 0;
        let downs = 0;
        for (let k = d.start; k <= d.end; k++) if (!members[k].rest) (upOf(members[k], beamUp) ? ups++ : downs++);
        overallUp = ups === downs ? beamUp : ups > downs; // égalité : sens de la ligature
      }
    } else if (isFirst) overallUp = lastUp;
    else if (isLast) overallUp = firstUp;
    out.push({ ...d, above: !overallUp, overallUp });
  }
  return out;
}

/** `Beam::topLevelSegmentForElement` : segment de plus haut niveau couvrant l'élément (les talons n'ont pas de plage : jamais retenus). */
export function topLevelSegment(segs, index) {
  let cur = segs[0];
  for (const s of segs) {
    if (s.level <= cur.level) continue;
    if (s.kind === 'segment' && s.start <= index && s.end >= index) cur = s;
  }
  return cur;
}

// ---------- distance minimale entre les deux portées ----------

/**
 * `SystemLayout::minVertSpaceForCrossStaffBeams` pour UNE ligature : distance minimale entre les lignes du haut des deux portées, et accords
 * limitants. `minSpace = −Infinity` quand elle n'impose rien (1er élément = silence : MuseScore n'examine que les ligatures dont le 1er élément
 * est un ACCORD ; ou un côté sans accord).
 * @returns { minSpace, limitingAbove, limitingBelow }  (indices de membres ou null)
 */
export function crossMinSpace(members, { beamUp = crossBeamUp(members), beamDist = BEAM_DIST, beamWidth = BEAM_WIDTH } = {}) {
  const none = { minSpace: -Infinity, limitingAbove: null, limitingBelow: null };
  if (members[0].rest) return none;
  let limitFromAbove = -Infinity;
  let limitFromBelow = Infinity;
  let limitingAbove = null;
  let limitingBelow = null;
  members.forEach((m, i) => {
    if (m.rest) return;
    const minLen = minStemLength({ strokes: m.ms.strokes }) / 4;
    if (m.lower) {
      const noteLimit = m.ms.topY - minLen;
      if (noteLimit < limitFromBelow) { limitFromBelow = noteLimit; limitingBelow = i; }
    } else {
      const noteLimit = m.ms.bottomY + minLen;
      if (noteLimit > limitFromAbove) { limitFromAbove = noteLimit; limitingAbove = i; }
    }
  });
  if (limitingAbove === null || limitingBelow === null) return none;
  let minSpace = limitFromAbove - limitFromBelow;
  const segs = crossSegmentList(members, beamUp);
  if (topLevelSegment(segs, limitingAbove).above === topLevelSegment(segs, limitingBelow).above) {
    // les deux hampes opposées recouvrent la hauteur de la ligature : on la retranche
    const strokes = Math.min(members[limitingAbove].ms.strokes, members[limitingBelow].ms.strokes);
    minSpace -= beamWidth + beamDist * (strokes - 1);
  }
  return { minSpace, limitingAbove, limitingBelow };
}

// ---------- ancrage ----------

/**
 * `BeamTremoloLayout::calculateAnchorsCross` : ligature plate ou pentue entre les deux portées, au milieu de l'espace libre entre les hampes
 * par défaut des deux côtés, puis pente selon les groupes de notes de chaque portée.
 * @param D          distance entre les lignes du haut des deux portées
 * @param prev       { segs, limitingAbove, limitingBelow } d'un passage précédent (centrage, voir ci-dessous) ou null
 * @returns { startX, endX, startY, endY, slope }
 */
export function crossAnchors(members, D, { stemWidth = 0.12, beamWidth = BEAM_WIDTH, prev = null } = {}) {
  const startCr = members[0];
  const endCr = members[members.length - 1];
  let topFirst = null; let topLast = null; let bottomFirst = null; let bottomLast = null;
  let maxMiddleTopLine = -Infinity; // note la plus basse, au milieu, de la portée du haut (`int` min)
  let minMiddleBottomLine = Infinity; // note la plus haute, au milieu, de la portée du bas
  let prevTopLine = maxMiddleTopLine;
  let prevBottomLine = minMiddleBottomLine;
  let secondTopIsSame = false; let secondBottomIsSame = false; let penultimateTopIsSame = false; let penultimateBottomIsSame = false;
  // `maxY` / `minY` : pointe (milieu de barre) la plus proche, côté bas / côté haut. ÉCART : `minY` part de −∞ (MuseScore : `double::min()`,
  // le plus petit POSITIF, sans conséquence dans leurs coordonnées de page, toujours positives)
  let maxY = Infinity;
  let minY = -Infinity;
  let prevBelowBeam = startCr.lower;
  let hasBeamSideSwitch = false;
  let beamSideSwitchDirection = 0;
  const staffOf = (m) => (m.lower ? 1 : 0);
  let prevStaff = staffOf(startCr);
  let hasStaffSwitch = false;
  let staffSwitchDirection = 0;
  let checkNextTop = false;
  let checkNextBottom = false;
  for (const c of members) {
    if (c.rest) continue;
    if (c.lower === prevBelowBeam && prevStaff !== staffOf(c)) {
      const diff = prevStaff - staffOf(c);
      staffSwitchDirection = hasStaffSwitch ? 0 : diff < 0 ? -1 : 1;
      hasStaffSwitch = true;
    }
    prevStaff = staffOf(c);
    const line = lineOf(c);
    if (c.lower) {
      if (penultimateBottomIsSame) { minMiddleBottomLine = Math.min(minMiddleBottomLine, prevBottomLine); penultimateBottomIsSame = false; }
      checkNextTop = false;
      if (!bottomFirst) {
        bottomFirst = c;
        checkNextBottom = true;
      } else {
        penultimateBottomIsSame = prevBottomLine === line;
        if (!penultimateBottomIsSame) minMiddleBottomLine = Math.min(minMiddleBottomLine, prevBottomLine);
        if (checkNextBottom) {
          secondBottomIsSame = line === lineOf(bottomFirst);
          checkNextBottom = false;
        } else prevBottomLine = line;
        bottomLast = c;
      }
      if (!prevBelowBeam) { beamSideSwitchDirection = hasBeamSideSwitch ? 0 : -1; hasBeamSideSwitch = true; }
      prevBelowBeam = true;
      maxY = Math.min(maxY, anchorY(c, D, beamWidth));
    } else {
      if (penultimateTopIsSame) { maxMiddleTopLine = Math.max(maxMiddleTopLine, prevTopLine); penultimateTopIsSame = false; }
      checkNextBottom = false;
      if (!topFirst) {
        topFirst = c;
        checkNextTop = true;
      } else {
        penultimateTopIsSame = prevTopLine === line;
        if (!penultimateTopIsSame) maxMiddleTopLine = Math.max(maxMiddleTopLine, prevTopLine);
        if (checkNextTop) {
          secondTopIsSame = line === lineOf(topFirst);
          checkNextTop = false;
        } else prevTopLine = line;
        topLast = c;
      }
      if (prevBelowBeam) { beamSideSwitchDirection = hasBeamSideSwitch ? 0 : 1; hasBeamSideSwitch = true; }
      prevBelowBeam = false;
      minY = Math.max(minY, anchorY(c, D, beamWidth));
    }
  }
  let yMid = (maxY + minY) / 2;
  // centrage d'après un passage précédent (les barres secondaires des deux accords limitants peuvent se trouver de part et d'autre du niveau 0)
  if (prev && prev.segs?.length && prev.limitingAbove !== null && prev.limitingBelow !== null) {
    const center = (s) => 0.5 * (s.y1 + s.y2);
    const c0 = center(prev.segs[0]);
    const distAbove = center(topLevelSegment(prev.segs, prev.limitingAbove)) - c0;
    const distBelow = center(topLevelSegment(prev.segs, prev.limitingBelow)) - c0;
    yMid -= 0.5 * (0.5 * (distAbove + distBelow));
  }
  const startX = anchorX(startCr, 'start', stemWidth);
  const endX = anchorX(endCr, 'end', stemWidth);
  let startY = yMid;
  let endY = yMid;
  const first = members.find((m) => !m.rest);
  if (!first) return { startX, endX, startY, endY, slope: 0 };
  // pente (`noSlope` = faux)
  const maxSlope = maxSlopeForWidth(anchorX(endCr, 'start', stemWidth) - anchorX(startCr, 'end', stemWidth));
  const quarter = SPATIUM_UNITS / 4;
  const topFirstLine = topFirst ? topFirst.ms.downLine : 0;
  const topLastLine = topLast ? topLast.ms.downLine : 0;
  const bottomFirstLine = bottomFirst ? bottomFirst.ms.upLine : 0;
  const bottomLastLine = bottomLast ? bottomLast.ms.upLine : 0;
  const constrainTopToQuarter = (topFirstLine > topLastLine && secondTopIsSame) || (topFirstLine < topLastLine && penultimateTopIsSame);
  const constrainBottomToQuarter = (bottomFirstLine < bottomLastLine && secondBottomIsSame) || (bottomFirstLine > bottomLastLine && penultimateBottomIsSame);
  if (!topLast && !bottomLast && topFirst && bottomFirst) {
    // deux notes seulement, une par portée : pente limitée. `int slant` de MuseScore : le produit par le quart d'espace (en unités internes)
    // est TRONQUÉ à l'entier, puis `slant / 2` est une division ENTIÈRE (écart ≤ 1 / 82,7 espace, reproduit). `ldata->elements[0] == topFirst` :
    // l'élément 0 peut être un silence, auquel cas c'est la branche « bas d'abord » qui s'applique (reproduit).
    const baseY = (m) => m.ms.farY + (m.lower ? D : 0);
    const [yFirst, yLast] = members[0] === topFirst ? [baseY(topFirst), baseY(bottomFirst)] : [baseY(bottomFirst), baseY(topFirst)];
    const desired = cround(yFirst - yLast);
    const slantUnits = Math.trunc(Math.min(Math.abs(desired), maxSlope) * (desired < 0 ? -quarter : quarter));
    const half2 = Math.trunc(slantUnits / 2) / SPATIUM_UNITS;
    startY += half2;
    endY -= half2;
  } else {
    let forceHoriz = false;
    let singleNoteTop = false;
    let singleNoteBottom = false;
    let topSlant = topFirstLine - topLastLine;
    if (constrainTopToQuarter && topSlant !== 0) topSlant = topFirstLine < topLastLine ? -1 : 1;
    if (!topLast) { topSlant = 0; singleNoteTop = true; }
    let bottomSlant = bottomFirstLine - bottomLastLine;
    if (constrainBottomToQuarter && bottomSlant !== 0) bottomSlant = bottomFirstLine < bottomLastLine ? -1 : 1;
    if (!bottomLast) { bottomSlant = 0; singleNoteBottom = true; }
    if (maxMiddleTopLine >= Math.max(topFirstLine, topLastLine) || minMiddleBottomLine <= Math.min(bottomFirstLine, bottomLastLine)) forceHoriz = true;
    const dir = (v) => (v <= 0 ? (v === 0 ? 0 : -1) : 1);
    const topSlantDir = dir(topSlant);
    const bottomSlantDir = dir(bottomSlant);
    let overall = 0;
    for (const d of [topSlantDir, bottomSlantDir, beamSideSwitchDirection, staffSwitchDirection]) {
      if (d !== 0) { overall = d; break; }
    }
    const flat = overall === 0;
    const topDiff = topSlantDir !== 0 && topSlantDir !== overall;
    const bottomDiff = bottomSlantDir !== 0 && bottomSlantDir !== overall;
    const sideDiff = beamSideSwitchDirection !== 0 && beamSideSwitchDirection !== overall;
    const staffDiff = staffSwitchDirection !== 0 && staffSwitchDirection !== overall;
    const flattenNeutralBeamSideSwitch = beamSideSwitchDirection === 0 && topSlantDir !== bottomSlantDir && !(singleNoteTop || singleNoteBottom);
    forceHoriz = forceHoriz || flat || flattenNeutralBeamSideSwitch || topDiff || bottomDiff || sideDiff || staffDiff;
    if (!forceHoriz) {
      let slant;
      if (topSlant === 0) slant = bottomSlant;
      else if (bottomSlant === 0) slant = topSlant;
      else slant = Math.abs(topSlant) < Math.abs(bottomSlant) ? topSlant : bottomSlant;
      const absSlant = Math.min(Math.abs(slant), maxSlope);
      const slope = (absSlant * (slant < 0 ? -1 : 1)) * 0.25; // `double slope` : pas de troncature ici
      startY += slope / 2;
      endY -= slope / 2;
    }
  }
  return { startX, endX, startY, endY, slope: endX > startX ? (endY - startY) / (endX - startX) : 0 };
}

// ---------- barres et hampes ----------

/**
 * Segments de barres (`createBeamSegment` / `createBeamletSegment`) et fins de hampes (`extendStem`), repère commun, pour UNE disposition
 * (`prev` : passage précédent pour le centrage de `calculateAnchorsCross`, ou null).
 */
function layoutOnce(members, D, { stemWidth, beamWidth, beamDist, beamletLen, prev }) {
  const beamUp = crossBeamUp(members);
  const a = crossAnchors(members, D, { stemWidth, beamWidth, prev });
  const list = crossSegmentList(members, beamUp);
  const yAtLine = (x) => (a.endX === a.startX ? a.startY : a.startY + a.slope * (x - a.startX));
  const segs = [];
  const half = stemWidth / 2;
  const adjust = new Map(); // index → pas d'allongement de hampe retenu (le dernier segment qui en demande un l'emporte, comme `setBeamExtension`)
  for (const d of list) {
    if (d.kind === 'beamlet') {
      const m = members[d.index];
      const x1 = m.x + (d.before ? half : -half); // `chordBeamAnchorX` End (talon vers la gauche) / Start (vers la droite)
      const x2 = x1 + (d.before ? -beamletLen : beamletLen);
      const cru = upOf(m, beamUp);
      let extra = 0;
      for (const s of segs) {
        if (s.level === 0 || s.x2 < x1 || s.x1 > x2) continue; // `beam->line.x2() < startX || beam->line.x1() > endX` (tel quel, même vers la gauche)
        if (cru === s.above) extra++;
      }
      const off = beamDist * (d.level - extra) * (cru ? -1 : 1);
      const y1 = yAtLine(x1) - off;
      const y2 = a.slope * (x2 - x1) + y1;
      segs.push({ kind: 'beamlet', level: d.level, above: !cru, start: d.index, end: d.index, x1, y1, x2, y2, before: d.before });
      continue;
    }
    const x1 = anchorX(members[d.start], 'start', stemWidth);
    const x2 = anchorX(members[d.end], 'end', stemWidth);
    let y1 = yAtLine(x1);
    let y2 = yAtLine(x2);
    let beamsAbove = 0;
    let beamsBelow = 0;
    if (d.level !== 0) {
      for (const s of segs) {
        if (s.level === 0 || s.end < d.start || s.start > d.end) continue; // plage de temps (indices de membres) disjointe
        if (s.above) beamsAbove++; else beamsBelow++;
      }
      const extraBeamAdjust = d.overallUp ? beamsAbove : beamsBelow;
      const off = beamDist * (d.level - extraBeamAdjust) * (d.overallUp ? -1 : 1);
      y1 -= off;
      y2 -= off;
    }
    segs.push({ kind: 'segment', level: d.level, above: d.above, start: d.start, end: d.end, x1, y1, x2, y2 });
    if (d.level > 0) { if (d.above) beamsAbove++; else beamsBelow++; }
    // allongement des hampes (`extendStem`) : les accords du segment dont la hampe va du MÊME côté que lui sont rallongés
    for (let k = d.start; k <= d.end; k++) {
      const m = members[k];
      if (m.rest) continue;
      if (d.level === 0) { adjust.set(k, 0); continue; }
      if (d.above === upOf(m, beamUp)) {
        const steps = d.level - (d.above ? beamsBelow : beamsAbove);
        if (steps !== 0) adjust.set(k, steps);
      }
    }
  }
  const stemEnds = new Map();
  members.forEach((m, k) => {
    if (m.rest) return;
    const desiredY = a.endX > a.startX ? a.startY + ((m.x - a.startX) / (a.endX - a.startX)) * (a.endY - a.startY) : Math.max(a.endY, a.startY);
    const add = (adjust.get(k) ?? 0) * beamDist;
    stemEnds.set(k, m.lower ? desiredY - add : desiredY + add);
  });
  return { segs, stemEnds, anchors: a, beamUp };
}

/**
 * Disposition d'une ligature croisée une fois la distance `D` entre portées connue (`BeamLayout::layout` appelée par `updateCrossBeams`) :
 * un premier jeu de segments sert au centrage de `calculateAnchorsCross` (accords limitants de `crossMinSpace`), puis la disposition finale.
 * ÉCART possible : MuseScore tire ces segments d'un premier passage fait AVANT l'espacement des portées (positions de portées alors non
 * définitives) ; seule la pente d'une ligature à deux notes en dépend, et seulement pour des segments de centres différents (talons).
 * @returns { segs: [{ kind, level, above, start, end, x1, y1, x2, y2 }], stemEnds: Map(index → y de la fin de la hampe), anchors, beamUp, minSpace }
 */
export function crossBeamLayout(members, D, { stemWidth = 0.12, beamWidth = BEAM_WIDTH, beamDist = BEAM_DIST, beamletLen = 1.1 } = {}) {
  const opts = { stemWidth, beamWidth, beamDist, beamletLen };
  const trial = layoutOnce(members, D, { ...opts, prev: null });
  const lim = crossMinSpace(members, { beamUp: trial.beamUp, beamDist, beamWidth });
  if (lim.limitingAbove === null) return { ...trial, minSpace: lim.minSpace };
  const final = layoutOnce(members, D, { ...opts, prev: { segs: trial.segs, limitingAbove: lim.limitingAbove, limitingBelow: lim.limitingBelow } });
  return { ...final, minSpace: lim.minSpace };
}

/**
 * Polygones d'une ligature croisée dans le repère commun (y vers le bas) : chaque segment est centré sur sa ligne, d'épaisseur
 * perpendiculaire `beamWidth` (`TDraw::draw(Beam)` : `ww` = demi-épaisseur / cos(atan(pente du 1er segment)), pente plafonnée à π/6 s'il y a
 * plusieurs segments).
 */
export function crossBeamPolygons(segs, beamWidth = BEAM_WIDTH) {
  if (!segs.length) return [];
  const f = segs[0];
  let d = Math.abs(f.y2 - f.y1) / (f.x2 - f.x1);
  if (segs.length > 1 && d > Math.PI / 6) d = Math.PI / 6;
  const ww = (beamWidth / 2) / Math.sin(Math.PI / 2 - Math.atan(d));
  return segs.map((s) => [[s.x1, s.y1 - ww], [s.x2, s.y2 - ww], [s.x2, s.y2 + ww], [s.x1, s.y1 + ww]]);
}
