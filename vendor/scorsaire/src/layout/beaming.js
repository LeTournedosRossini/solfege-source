/*
 * Ligatures : la constitution des groupes (règles par chiffrage de MuseScore `Groups`) est dans `beamgroups.js` ; ici : direction d'un
 * groupe, ligne de ligature (`BeamTremoloLayout`, beamtremolo.js) et segments par niveau (`BeamLayout::createBeamSegments`,
 * `calcIsBeamletBefore`, `createBeamletSegment`, `Beam::calcBeamBreaks`). Coordonnées de portée (y vers le haut).
 * Les groupes sont faits par VOIX : les éléments passés sont ceux d'une seule voix. Un silence « ligaturé » (`PID.BEAM_THROUGH`) fait partie
 * du groupe : membre `rest: true`, `x` = bord du glyphe (`chordBeamAnchorX` : bord DROIT si hampes en haut, GAUCHE sinon).
 */
import { beamLayoutData, calculateAnchors } from './beamtremolo.js';
import { computeAutoStemDirection } from './tremolotwo.js';
import { buildBeamGroups, hooksOfTicks } from './beamgroups.js';

export { buildBeamGroups };

const BEAM_COUNT = { eighth: 1, sixteenth: 2, thirtysecond: 3, sixtyfourth: 4 };
export const beamCountOf = (base) => BEAM_COUNT[base] ?? 0;

const BEAMLET_LEN = 1.1; // `Sid::beamMinLen` (styledef.cpp) : longueur d'un talon, depuis le bord extérieur de la hampe
const BEAM_TUPLET_TOLERANCE = 6;

/**
 * Direction d'un groupe (`BeamLayout::layout1` : `computeAutoStemDirection` sur les positions DISTINCTES de toutes les notes du
 * groupe, triées ; 0 = les extrêmes s'annulent jusqu'au bout → vers le bas). Vérifié sur un export MuseScore : la5 si5 do6 la5 →
 * positions {−1, 0, +1} → 0 → hampes vers le bas (l'ancienne règle « note la plus éloignée » donnait le haut).
 * @param allYs  positions (espaces depuis la ligne du bas) de toutes les notes de tous les accords du groupe
 */
export function groupDirection(allYs, lines = 5) {
  const distances = [...new Set(allYs.map((y) => Math.round(2 * (lines - 1) - 2 * y) - (lines - 1)))].sort((a, b) => a - b);
  return computeAutoStemDirection(distances) > 0 ? 'up' : 'down';
}

/**
 * Ligne de ligature de MuseScore (`BeamTremoloLayout::calculateAnchors`, beamtremolo.js), dans le repère de portée (y vers le haut).
 * @param members  [{ x, beams, ms }] ; `ms` = membre de BeamTremoloLayout (+ `ys` : positions des notes de l'accord)
 * @returns { startX, endX, at(x) → y du BORD EXTÉRIEUR du niveau 0 (pointe complète des hampes), beamDist }
 */
export function beamGroupLine(allMembers, up, { beamWidth, stemWidth, grace = false, staffLines = 5, staffHeight = 4 }) {
  const L = beamLayoutData({ up, beamWidth, stemWidth, grace });
  const members = allMembers.filter((m) => !m.rest); // les ancrages ne regardent que les ACCORDS (`startChord` / `endChord`)
  // tablature : `ms.lines` = indices de cordes (les « lignes » de MuseScore y sont les cordes, `noteDistances`)
  const notePositions = members.flatMap((m) => m.ms.lines ?? m.ms.ys.map((y) => Math.round(2 * staffHeight - 2 * y))).sort((a, b) => a - b);
  const a = calculateAnchors(L, members.map((m) => m.ms), notePositions, { beamType: 'beam', staffLines });
  // `calculateAnchors` pose le x des ancrages sur le 1er / dernier ÉLÉMENT du groupe, silence compris (`chordBeamAnchorX(startCr…)`) ;
  // les y restent ceux des accords : la pente (`computeAndSetSlope`) se calcule sur ces ancrages finaux
  if (allMembers[0].rest) a.startX = allMembers[0].x;
  if (allMembers[allMembers.length - 1].rest) a.endX = allMembers[allMembers.length - 1].x;
  // bord extérieur = ligne d'ancrage ± demi-épaisseur DESSINÉE (`Beam::draw` : rectangle centré sur la ligne ; un ornement : épaisseur × `graceNoteMag`,
  // alors que les ancrages restent calés avec l'épaisseur non réduite — mesuré sur E7 : barre 6,325..6,675 centrée sur 6,5)
  const half = grace ? (beamWidth * 0.7) / 2 : beamWidth / 2;
  const edge = up ? half : -half;
  const at = (x) => staffHeight - (a.endX === a.startX ? a.startY : a.startY + ((a.endY - a.startY) * (x - a.startX)) / (a.endX - a.startX)) + edge;
  return { startX: a.startX, endX: a.endX, at, beamDist: a.beamDist };
}

/** `Beam::calcBeamBreaks` (accords seulement) : coupures des barres secondaires avant le membre k, au niveau `level`. */
function beamBreaks(members, k, level) {
  const m = members[k];
  // silence en mode MID : on l'ignore, les barres continuent à travers (`Beam::calcBeamBreaks`)
  if (m.rest) return [false, false];
  const prev = k > 0 ? members[k - 1] : null;
  let b16 = level >= 1 && m.dflt === 'begin16';
  let b32 = level >= 2 && m.dflt === 'begin32';
  // n-olets inclus dans une ligature : coupés comme leur durée sous-jacente (`max(hooks, 1)`)
  if (level > 0 && prev) {
    const sameTuplet = m.info.tupletId === prev.info.tupletId;
    let span = null;
    if (m.info.tupletId && !sameTuplet) span = m.info.tupletSpan;
    else if (prev.info.tupletId && !sameTuplet) span = prev.info.tupletSpan;
    if (span !== null && Math.max(hooksOfTicks(span), 1) <= level) {
      b16 = level === 1;
      b32 = level >= 2;
    }
  }
  return [b16, b32];
}

/** `BeamLayout::calcIsBeamletBefore` : le talon du membre i pointe-t-il vers la gauche ? */
function beamletBefore(members, i, level, after16, after32) {
  if (i === 0) return false;
  if (i === members.length - 1) return true;
  const cur = members[i];
  const t = cur.info;
  if (t.tupletId && t.rtick === t.tupletStart) return false;
  if (t.tupletId && t.rtick + t.actual === t.tupletStart + t.tupletSpan) return true;
  const next = members[i + 1];
  const [n16, n32] = beamBreaks(members, i + 1, level);
  const [c16] = beamBreaks(members, i, members[i - 1].beams);
  if ((n16 && level >= 1) || (!c16 && n32 && level >= 2)) return true;
  let prevLevel = members[i - 1].beams;
  if (after16) prevLevel = Math.min(prevLevel, 1);
  else if (after32) prevLevel = Math.min(prevLevel, 2);
  const diff = next.beams - prevLevel;
  if (diff !== 0) return diff < 0;
  // ornements : `ticks()` vaut 0 (aucune durée dans la mesure), la subdivision du temps n'a pas de sens → talon vers l'avant
  if (t.grace) return false;
  // le membre termine une subdivision du temps
  const baseTick = t.tupletId ? t.tupletStart : 0;
  let tickNext = next.info.rtick - baseTick;
  if (t.tupletId && t.tupletRatio[0] & 1) tickNext = Math.trunc((tickNext * t.tupletRatio[0]) / t.tupletRatio[1]);
  const large = t.actual * 2;
  const rem = tickNext % large;
  return rem <= BEAM_TUPLET_TOLERANCE || large - rem <= BEAM_TUPLET_TOLERANCE;
}

/**
 * Liste des segments de barres d'une ligature, dans l'ordre de création de `BeamLayout::createBeamSegments` (niveau 0 d'abord, puis 1, 2…) :
 * `{ kind: 'segment', level, start, end }` (indices de membres, du 1er au dernier ; le début peut être un silence seulement s'il est le 1er
 * élément) ou `{ kind: 'beamlet', level, index, before }` (talon d'un membre seul à ce niveau, vers la gauche si `before`). Ne dépend d'aucune
 * géométrie : sert à la ligature ordinaire (`beamItems`) comme à la ligature croisée (`crossbeam.js`).
 * @param members  [{ beams, rest, info, dflt }] (voir `beamItems`)
 */
export function collectBeamSegments(members) {
  const out = [];
  const n = members.length;
  let level = 0;
  let levelHasBeam;
  // `BeamLayout::createBeamSegments`, avec les silences ligaturés (mode MID)
  do {
    levelHasBeam = false;
    let start = null;
    let end = null;
    let breakBeam = false;
    let prev16 = false;
    let prev32 = false;
    let lastChord = null; // dernier ACCORD vu
    for (let k = 0; k < n; k++) {
      const cr = members[k];
      if (level < cr.beams && !cr.rest) levelHasBeam = true;
      const [b16, b32] = beamBreaks(members, k, level);
      breakBeam = b16 || b32;
      let skipRest = false;
      if (cr.rest && level >= cr.beams) {
        // niveau inférieur à celui des deux accords voisins : la barre continue sous le silence
        let next = k + 1;
        while (next < n && members[next].rest) next++;
        if (lastChord !== null && next < n && level < members[lastChord].beams && level < members[next].beams) {
          skipRest = (b16 && level < 1) || (b32 && level < 2) || (!b16 && !b32);
        }
      }
      if ((level < cr.beams && !breakBeam) || skipRest) {
        end = k;
        if (start === null || (members[start].rest && start !== 0)) start = k;
      } else if (level >= cr.beams && cr.rest && !breakBeam) {
        continue; // silence plus long que ce niveau : il passe sous la barre si les suivants sont ligaturés
      } else {
        let beamletIndex = k - 1;
        if (lastChord !== null && (cr.rest || (end !== null && members[end].rest))) {
          // un segment ne peut pas finir sur un silence : il finit sur le dernier accord
          if (start !== null && lastChord >= start) {
            end = lastChord;
            beamletIndex = lastChord;
            lastChord = null;
          }
        }
        if (start !== null && end !== null && levelHasBeam) {
          if (start === end && !members[start].rest) out.push({ kind: 'beamlet', level, index: start, before: beamletBefore(members, beamletIndex, level, prev16, prev32) });
          else if (start !== end) out.push({ kind: 'segment', level, start, end });
        }
        const setCr = !cr.rest && breakBeam && level < cr.beams;
        start = setCr ? k : null;
        end = setCr ? k : null;
      }
      prev16 = b16;
      prev32 = b32;
      if (!cr.rest) lastChord = k;
    }
    if (start !== null && (end !== null || breakBeam)) {
      if ((start === end || end === null) && !members[start].rest) out.push({ kind: 'beamlet', level, index: start, before: start !== 0 });
      else if (end !== null && start !== end) out.push({ kind: 'segment', level, start, end });
    }
    level++;
  } while (levelHasBeam);
  return out;
}

/**
 * Polygones de la ligature (un par segment et par niveau), niveau 0 = à la pointe des hampes, les suivants vers les têtes
 * (`BeamLayout::createBeamSegments`). Un segment va du bord gauche de la hampe du 1er membre au bord droit de celle du dernier ;
 * un membre seul à un niveau porte un talon de `BEAMLET_LEN`, à gauche ou à droite selon `calcIsBeamletBefore`.
 * @param members  [{ x (hampe), beams, info (`beamInfoOf`), dflt (`baseBeamMode` par rapport au précédent) }]
 */
export function beamItems(members, line, direction, { thickness, stemWidth, beamletLen = BEAMLET_LEN }, ref) {
  const sign = direction === 'up' ? -1 : 1; // sens vers les têtes
  const items = [];
  const dist = line.beamDist;
  const posAt = (x, level) => line.at(x) + sign * level * dist;
  const half = stemWidth / 2;
  const left = (m) => (m.rest ? m.x : m.x - half); // `chordBeamAnchorX` Start : bord gauche de la hampe ; silence : son ancrage
  const right = (m) => (m.rest ? m.x : m.x + half);
  const descriptors = collectBeamSegments(members);
  // Épaisseur indépendante de la pente (`TDraw::draw(Beam)`) : la barre est un parallélogramme CENTRÉ sur la ligne d'ancrage,
  // de demi-hauteur verticale ww = (épaisseur / 2) / cos(atan d), d = pente du 1er segment (plafonnée à π/6 dès qu'il y a plus d'un
  // segment) ; le même ww pour tous les segments. `line.at` est le bord EXTÉRIEUR (centre ± demi-épaisseur nominale) : le centre
  // est donc `at + sign × thickness / 2`, et sur une pente la barre grandit symétriquement autour de lui.
  const first = members[0];
  const last = members[members.length - 1];
  let slope = last.x !== first.x ? Math.abs(line.at(last.x) - line.at(first.x)) / Math.abs(last.x - first.x) : 0;
  if (descriptors.length > 1 && slope > Math.PI / 6) slope = Math.PI / 6;
  const ww = (thickness / 2) * Math.sqrt(1 + slope * slope); // 1 / sin(π/2 − atan d) = 1 / cos(atan d)
  const segment = (x1, x2, level) => {
    const c1 = posAt(x1, level) + sign * (thickness / 2);
    const c2 = posAt(x2, level) + sign * (thickness / 2);
    items.push({
      kind: 'polygon', role: 'beam', ref,
      points: [[x1, c1 - sign * ww], [x2, c2 - sign * ww], [x2, c2 + sign * ww], [x1, c1 + sign * ww]],
    });
  };
  for (const d of descriptors) {
    if (d.kind === 'segment') segment(left(members[d.start]), right(members[d.end]), d.level);
    else {
      const x0 = members[d.index].x + (d.before ? half : -half);
      segment(x0, x0 + (d.before ? -beamletLen : beamletLen), d.level);
    }
  }
  return items;
}

/**
 * `BeamLayout::verticalAdjustBeamedRests` : un silence sous une ligature est écarté, par pas de distance de lignes, tant que son
 * dégagement vis-à-vis des barres reste inférieur à 0,35 sp (0,2 sp pour un silence de 32e ou plus court). Repère de portée, y vers le haut :
 * des hampes montantes (barres au-dessus) poussent le silence vers le bas, des hampes descendantes vers le haut.
 * @param polygons  barres du groupe (`beamItems`)
 * @param box       { x0, x1, top, bottom } : boîte du silence (espaces)
 * @returns décalage vertical (espaces, y vers le haut) à ajouter à la position du silence
 */
export function beamedRestShift({ up, polygons, box, short, firstRest, lineDist = 1 }) {
  const padding = short ? 0.2 : 0.35;
  const margin = up && firstRest ? 0.1 : 0;
  let clearance = Infinity;
  for (const p of polygons) {
    const [a, b, c, d] = p.points; // a→b : un bord ; d→c : l'autre
    const pxmin = Math.min(a[0], b[0]);
    const pxmax = Math.max(a[0], b[0]);
    if (pxmax < box.x0 - margin || pxmin > box.x1 + margin) continue;
    const edge = (u, v, x) => (v[0] === u[0] ? u[1] : u[1] + ((v[1] - u[1]) * (x - u[0])) / (v[0] - u[0]));
    for (const x of [Math.min(Math.max(box.x0, pxmin), pxmax), Math.min(Math.max(box.x1, pxmin), pxmax)]) {
      const ya = edge(a, b, x);
      const yb = edge(d, c, x);
      clearance = Math.min(clearance, up ? Math.min(ya, yb) - box.top : box.bottom - Math.max(ya, yb));
    }
  }
  if (clearance > padding) return 0;
  const moves = Math.ceil((padding - clearance) / lineDist);
  return (up ? -1 : 1) * moves * lineDist;
}
