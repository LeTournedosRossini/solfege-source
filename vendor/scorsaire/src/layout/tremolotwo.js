/*
 * Trémolo entre DEUX accords — MuseScore `TremoloTwoChord` (`dom/tremolotwochord.cpp`, `rendering/score/tremololayout.cpp` :
 * `layoutTwoNotesTremolo`, `createBeamSegments`, `calcIsUp` ; `dom/chord.cpp` : `setTremoloTwoChord`, `shouldHaveHook` ;
 * `dom/measure.cpp` : `connectTremolo`).
 *
 * Modèle : `PID.TREMOLOS` (portée) `[{ id, startChordId, endChordId, strokes }]`, ancré par identité (comme PID.SLURS). Les
 * deux accords doivent se SUIVRE dans la même voix et la même mesure et avoir la même durée réelle (MuseScore rattache le
 * suivant de la même piste et de la même mesure). Chacun garde sa durée RÉELLE ; la valeur ÉCRITE affichée est le DOUBLE
 * (`Chord::setTremoloTwoChord` : `d.shift(-1)`, points conservés) : deux noires trémolées s'écrivent deux blanches — vérifié
 * sur un export MuseScore (deux accords d'une noire, têtes blanches ; deux croches, têtes noires sans ligature ni crochet).
 * Les deux accords n'ont jamais de crochet (`Chord::shouldHaveHook`) : les barres du trémolo font office de ligature.
 *
 * Les barres sont TOUTES tracées par le trémolo (`strokes` au total, sans ajouter celles de la durée écrite) ; elles
 * partent à 1 esp. de chaque hampe (rétrécies si les hampes sont proches), espacées de 0,75 esp. vers les têtes.
 * Limite : un couple de doubles croches (valeur écrite : croche, donc ligaturable) se ligature normalement avec ses voisines
 * chez MuseScore, le trémolo est alors « inséré » dans la ligature (`tremAnchors`) — NON PORTÉ : le couple est dessiné isolé.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { stemTipY } from './stemlength.js';
import { beamLayoutData, calculateAnchors, chordBeamAnchorX } from './beamtremolo.js';

const WRITTEN_DOUBLE = { breve: null, whole: 'breve', half: 'whole', quarter: 'half', eighth: 'quarter', sixteenth: 'eighth', thirtysecond: 'sixteenth', sixtyfourth: 'thirtysecond' };

/** Durée écrite d'un accord de trémolo à deux notes : le double de la durée réelle (null si elle n'existe pas). */
export function writtenBaseOfPair(base) {
  return Object.hasOwn(WRITTEN_DOUBLE, base) ? WRITTEN_DOUBLE[base] : null;
}

/**
 * Trémolos à deux accords d'une portée : Map `id d'accord de début` → { id, strokes, endChordId }. Les entrées mal formées
 * (barres hors 1..6, mêmes bornes) sont ignorées ; l'existence et l'adjacence des accords se vérifient à la mise en page.
 */
export function resolveStaffTwoChordTremolos(staff) {
  const map = new Map();
  for (const t of getProperty(staff, PID.TREMOLOS) || []) {
    if (!Number.isInteger(t.strokes) || t.strokes < 1 || t.strokes > 6 || t.startChordId === t.endChordId) continue;
    if (!map.has(t.startChordId)) map.set(t.startChordId, { id: t.id, strokes: t.strokes, endChordId: t.endChordId });
  }
  return map;
}

/** `ChordLayout::computeAutoStemDirection` : > 0 vers le haut. `distances` : ligne − ligne du milieu (demi-espaces, y vers le bas), triées. */
export function computeAutoStemDirection(distances) {
  let left = 0;
  let right = distances.length - 1;
  while (left <= right) {
    const net = distances[left] + distances[right];
    if (net === 0) {
      left++;
      right--;
      continue;
    }
    return net > 0 ? 1 : -1;
  }
  return 0;
}

/** Sens des hampes d'un couple (`TremoloLayout::calcIsUp`, cas courant : même portée, sens automatique) : notes des deux accords ensemble. */
export function pairStemUp(ysA, ysB, { multiVoice = false, voice = 0 } = {}) {
  if (multiVoice) return voice % 2 === 0;
  const distances = [...ysA, ...ysB].map((y) => Math.round(8 - 2 * y) - 4).sort((a, b) => a - b);
  return computeAutoStemDirection(distances) > 0; // 0 (tout s'annule) : vers le bas
}

/**
 * Barres d'un trémolo à deux accords : `TremoloLayout::createBeamSegments` (style par défaut) puis `TDraw::draw`.
 * @param anchors { startX, endX, startY, endY } : ancrages du trait principal, y VERS LE BAS depuis la ligne du haut
 * @returns un polygone par barre (repère de portée, y vers le haut)
 */
export function strokePolygons({ up, strokes, anchors, beamWidth, ref, staffHeight = 4 }) {
  // `createBeamSegments` (style par défaut) : le trait principal part à `gapSp` de chaque hampe
  const stemGapSp = 1.0;
  const slope = anchors.endX > anchors.startX ? (anchors.endY - anchors.startY) / (anchors.endX - anchors.startX) : 0;
  let gapSp = stemGapSp;
  const widthSp = anchors.endX - anchors.startX - stemGapSp * 2;
  if (!(widthSp >= 0.6 - 1e-9)) gapSp = Math.max(stemGapSp - (0.6 - widthSp) * 0.5, 0.4); // trait trop court : on entame la marge
  const x1 = anchors.startX + gapSp;
  const x2 = anchors.endX - gapSp;
  const y1 = anchors.startY + gapSp * slope;
  const y2 = anchors.endY - gapSp * slope;
  // épaisseur verticale indépendante de la pente (`TDraw::draw(TremoloTwoChord)`, la pente est plafonnée à 30° si plusieurs barres)
  let d = Math.abs(y2 - y1) / (x2 - x1);
  if (strokes > 1 && d > Math.PI / 6) d = Math.PI / 6;
  const ww = (beamWidth / 2) / Math.sin(Math.PI / 2 - Math.atan(d));
  const towardHeads = up ? 0.75 : -0.75; // en y vers le bas : vers les têtes
  const toUp = (yd) => staffHeight - yd;
  const items = [];
  for (let i = 0; i < strokes; i++) {
    const o = towardHeads * i;
    items.push({
      kind: 'polygon', role: 'tremolo', ref,
      points: [
        [x1, toUp(y1 + o - ww)], [x2, toUp(y2 + o - ww)], [x2, toUp(y2 + o + ww)], [x1, toUp(y1 + o + ww)],
      ],
    });
  }
  return items;
}

/**
 * Trémolo « inséré » dans une ligature (`BeamLayout::setTremAnchors` + `TremoloLayout::createBeamSegments`) : les barres du
 * trémolo prolongent la pile de niveaux de la ligature, à `regularBeams` niveaux de la ligne principale, sur la même pente.
 * @param line         ligne de la ligature : `at(x)` = y (vers le haut) du BORD EXTÉRIEUR du niveau 0, `beamDist`
 * @param x1,x2        axes des deux hampes du couple
 * @param regularBeams nombre de ligatures « ordinaires » du 1er accord (`Chord::beams`, valeur écrite)
 */
export function insetTremoloItems({ up, strokes, line, x1, x2, regularBeams, beamWidth, ref, staffHeight = 4 }) {
  const dist = line.beamDist ?? 0.75;
  const centre = (x) => (up ? line.at(x) - beamWidth / 2 : line.at(x) + beamWidth / 2); // ligne médiane du niveau 0 (y vers le haut)
  const toward = up ? -1 : 1; // vers les têtes
  const yDown = (x) => staffHeight - (centre(x) + toward * regularBeams * dist);
  return strokePolygons({ up, strokes, anchors: { startX: x1, endX: x2, startY: yDown(x1), endY: yDown(x2) }, beamWidth, ref, staffHeight });
}

/**
 * Disposition d'un couple.
 * @param up      sens des deux hampes
 * @param strokes nombre de barres
 * @param chords  [{ x, ys, hasStem }] : `x` = axe de la hampe ; sans hampe, abscisse commune des ancrages
 *                (`StemLayout::stemPosX` : bord droit de la tête si la hampe monterait, sinon bord gauche)
 * @returns { items, tips }  `items` : un polygone par barre (repère de portée) ; `tips` : pointe de hampe COMPLÈTE de chaque
 *          accord (y vers le haut) ou null s'il n'a pas de hampe
 */
export function twoChordTremoloLayout({ up, strokes, chords, style, glyphs, ref, lines = 5 }) {
  const top = lines - 1; // y de la ligne du haut
  const beamWidth = style(SID.BEAM_THICKNESS);
  const L = beamLayoutData({ up, beamWidth, stemWidth: style(SID.STEM_THICKNESS) });
  const members = chords.map((c) => {
    const tip = stemTipY({ up, ys: c.ys, beams: strokes, hook: false, style, lines }); // longueur par défaut, y vers le haut
    const farUp = up ? Math.min(...c.ys) : Math.max(...c.ys);
    return {
      x: c.x,
      stemless: !c.hasStem,
      farY: top - farUp,
      len: Math.abs(tip - farUp),
      upLine: Math.round(2 * top - 2 * Math.max(...c.ys)),
      downLine: Math.round(2 * top - 2 * Math.min(...c.ys)),
      strokes,
      attachY: top - farUp, // sans effet pour deux accords (sert au dégagement des notes intérieures d'une ligature)
    };
  });
  const notePositions = chords.flatMap((c) => c.ys.map((y) => Math.round(2 * top - 2 * y))).sort((a, b) => a - b);
  const anchors = calculateAnchors(L, members, notePositions, { beamType: 'tremolo', staffLines: lines });

  const items = strokePolygons({ up, strokes, anchors, beamWidth, ref, staffHeight: top });

  // hampes : prolongées jusqu'au bord extérieur de la 1re barre (`extendStem` : ancre au milieu de la barre ± demi-épaisseur)
  const tips = members.map((m, k) => {
    if (!chords[k].hasStem) return null;
    const ax = chordBeamAnchorX(L, m, 'middle');
    const desiredY = anchors.endX > anchors.startX
      ? ((ax - anchors.startX) / (anchors.endX - anchors.startX)) * (anchors.endY - anchors.startY) + anchors.startY
      : Math.max(anchors.endY, anchors.startY);
    const centre = top - desiredY;
    return up ? centre + beamWidth / 2 : centre - beamWidth / 2;
  });
  return { items, tips, anchors };
}

/**
 * Trémolo à deux accords EN TABLATURE (`TremoloLayout::layoutTwoNotesTremolo` sur une portée de tablature) : mêmes ancrages que la portée
 * (`BeamTremoloLayout::calculateAnchors`, sans les règles « par rapport aux lignes » : `if (!ldata->tab)`), les « lignes » étant les CORDES.
 * L'appelant fournit les membres déjà calés sur la tablature (hampes à côté : départ et longueur fixes ; à travers ou sans hampe : longueur
 * par défaut du chord).
 * @param members  [{ x, stemless, farY, len, upLine, downLine, strokes, attachY }] — repère y vers le BAS depuis la ligne du haut
 * @param staffLines nombre de cordes ; @param staffHeight hauteur de la portée (espaces) ; @returns { items, tips, anchors } comme `twoChordTremoloLayout`
 */
export function tabTwoChordTremoloLayout({ up, strokes, members, staffLines, staffHeight, style, ref }) {
  const beamWidth = style(SID.BEAM_THICKNESS);
  const L = beamLayoutData({ up, beamWidth, stemWidth: style(SID.STEM_THICKNESS) });
  const notePositions = members.flatMap((m) => m.strings).sort((a, b) => a - b);
  const anchors = calculateAnchors(L, members, notePositions, { beamType: 'tremolo', staffLines, tab: true });
  const items = strokePolygons({ up, strokes, anchors, beamWidth, ref, staffHeight });
  const tips = members.map((m) => {
    if (m.stemless) return null;
    const ax = chordBeamAnchorX(L, m, 'middle');
    const desiredY = anchors.endX > anchors.startX
      ? ((ax - anchors.startX) / (anchors.endX - anchors.startX)) * (anchors.endY - anchors.startY) + anchors.startY
      : Math.max(anchors.endY, anchors.startY);
    const centre = staffHeight - desiredY;
    return up ? centre + beamWidth / 2 : centre - beamWidth / 2;
  });
  return { items, tips, anchors };
}
