/*
 * Lignes de trille (PID.TRILLS) : dessin. Port de MuseScore v4.7.5 (`TLayout::layoutTrillSegment`, `TrillSegment::symbolLine`, `Trill::trillLinePos`,
 * styles `trillPosAbove` (0, −0,5) / `trillPosBelow` (0, 2) / `trillMinDistance` 0,5, autoplace de segment de ligne).
 *
 *  - Glyphes : TRILL → `ornamentTrill` puis `wiggleTrill` répétés ; PRALLPRALL → `wiggleTrill` seuls ; UPPRALL → `ornamentBottomLeftConcaveStroke`,
 *    `ornamentZigZagLineNoRightEnd` répétés, `ornamentZigZagLineWithRightEnd` à la fin ; DOWNPRALL → `ornamentLeftVerticalStroke` (même suite). Nombre de
 *    glyphes de remplissage = lrint((longueur − avance du 1er [− avance du dernier]) / avance du remplissage). Segment qui CONTINUE un retour à la ligne
 *    (milieu / arrivée) : plus de glyphe de tête (`wiggleTrill` seuls, ou zigzag).
 *  - Étendue : départ = x de la colonne de l'accord de début ; fin = x de la colonne SUIVANTE de la portée − 1 sp (`SLine::linePos`, `trillLinePos`) ;
 *    segment de départ coupé → dernière barre − 0,25 sp ; milieu / arrivée → début de système.
 *  - Côté : `placement` de la ligne, sinon parité de la voix de l'accord de début (voix paire = dessus) comme `ArticulationAnchor::AUTO`.
 *  - Altération de l'ornement (`Ornament::computeNotesAboveAndBelow`) : seulement pour un intervalle NON automatique (en mode automatique la note de
 *    l'ornement reprend l'état d'altération : rien à montrer) — glyphe à l'échelle 0,6, centré sur le 1er glyphe, à 0,35 sp de la ligne (au-dessus ;
 *    DOWNPRALL : au-dessous avec `intervalBelow`).
 *
 *  Fin de ligne : recule devant l'ornement « avant » le plus à gauche de la colonne suivante (même voix) et devant une petite clé de changement
 *  (`trillLinePos`, `graceOffset` / `clefOffset`, le plus grand des deux ; bord gauche de la clé = bbox du glyphe, MuseScore : `leftMostEdgeAtTop`).
 *
 *  Intervalle ≠ seconde : note d'aide (`cuenote.js`) à la place des altérations (`showCueNote`). Signe isolé : `signAccidentals` (articulations.js).
 *
 *  LIMITES (non vérifié sur export MuseScore) : altération comparée à l'armure seule (pas aux altérations déjà posées dans la mesure ; propriété
 *  `showAccidental` non portée) ; « skyline » = boîtes des éléments.
 */
import { PID, getProperty } from '../model/index.js';
import { ornamentIntervalOf, ornamentChromatic } from '../model/trill.js';
import { defaultSpelling, diatonicIndex, midiFromSpelling } from '../model/pitch.js';
import { itemMeasureIndexMap } from './hairpins.js';
import { systemSpan } from './painters/systemspan.js';
import { rectsOf } from './bounds.js';
import { staffTrills } from './painters/resolved.js';

export function resolveStaffTrills(staff) {
  const idx = itemMeasureIndexMap(staff);
  return (getProperty(staff, PID.TRILLS) || [])
    .map((s) => ({ ...s, startMi: idx.get(s.startChordId), endMi: idx.get(s.endChordId) }))
    .filter((s) => s.startMi !== undefined && s.endMi !== undefined && s.startMi <= s.endMi);
}

const SYSTEM_BARLINE_WIDTH = 0.18;
const POS_ABOVE = -0.5; // trillPosAbove (y vers le bas, depuis la ligne du haut)
const POS_BELOW = 2; // trillPosBelow (depuis la ligne du bas)
const MIN_DISTANCE = 0.5; // trillMinDistance
const ACC_MAG = 0.6;
const ACC_MARGIN = 0.35;
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const KEY_ORDER_SHARP = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const KEY_ORDER_FLAT = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const ALTER_GLYPH = { '-2': 'accidentalDoubleFlat', '-1': 'accidentalFlat', 0: 'accidentalNatural', 1: 'accidentalSharp', 2: 'accidentalDoubleSharp' };

/** Glyphes de la ligne : { start, fill, end?, startOnContinuation } selon le type. */
export const TRILL_SYMBOLS = {
  trill: { start: 'ornamentTrill', fill: 'wiggleTrill' },
  prallPrall: { start: 'wiggleTrill', fill: 'wiggleTrill' },
  upPrall: { start: 'ornamentBottomLeftConcaveStroke', fill: 'ornamentZigZagLineNoRightEnd', end: 'ornamentZigZagLineWithRightEnd', cont: 'ornamentZigZagLineNoRightEnd' },
  downPrall: { start: 'ornamentLeftVerticalStroke', fill: 'ornamentZigZagLineNoRightEnd', end: 'ornamentZigZagLineWithRightEnd', cont: 'ornamentZigZagLineNoRightEnd' },
  pure: null,
};

/** Suite de glyphes d'un segment (`TrillSegment::symbolLine`) : [{ name, dx }]. `first` : segment qui porte le glyphe de tête (début de ligne). */
export function trillSymbolRow(type, length, first, glyphs) {
  const def = TRILL_SYMBOLS[type];
  if (!def) return [];
  const adv = (n) => glyphs.glyphs[n]?.advance ?? 0;
  const start = first ? def.start : (def.cont ?? def.fill);
  const row = [{ name: start, dx: 0 }];
  let x = adv(start);
  const wFill = adv(def.fill);
  const wEnd = def.end ? adv(def.end) : 0;
  const n = wFill > 0 ? Math.round((length - adv(start) - wEnd) / wFill) : 0;
  for (let i = 0; i < n; i++) { row.push({ name: def.fill, dx: x }); x += wFill; }
  if (def.end) row.push({ name: def.end, dx: x });
  return row;
}

/** Note de l'ornement (au-dessus ou en dessous de la plus haute note de l'accord) : { step, octave, alter, glyph } ; glyphe d'altération null en mode automatique. */
export function ornamentTarget(entry, chord, keySig, below) {
  const iv = ornamentIntervalOf(entry, !below);
  const notes = chord.notes ?? [];
  if (!notes.length) return null;
  const main = notes.reduce((a, b) => (getProperty(b, PID.PITCH) > getProperty(a, PID.PITCH) ? b : a));
  const pitch = getProperty(main, PID.PITCH);
  if (!Number.isFinite(pitch)) return null;
  const spelling = getProperty(main, PID.SPELLING) ?? defaultSpelling(pitch, keySig);
  const dir = below ? -1 : 1;
  const index = diatonicIndex(spelling) + dir * iv.step;
  const step = STEPS[((index % 7) + 7) % 7];
  const octave = Math.floor(index / 7);
  const keyAlter = ((keySig < 0 ? KEY_ORDER_FLAT : KEY_ORDER_SHARP).slice(0, Math.abs(keySig)).includes(step)) ? Math.sign(keySig) : 0;
  if (iv.type === 'auto') return { step, octave, alter: keyAlter, glyph: null };
  const alter = pitch + dir * ornamentChromatic(iv) - midiFromSpelling({ step, alter: 0, octave });
  if (Math.abs(alter) > 2) return { step, octave, alter: keyAlter, glyph: null };
  return { step, octave, alter, glyph: alter === keyAlter ? null : (ALTER_GLYPH[alter] ?? null) };
}

/** Glyphe d'altération de la note d'un ornement (`Ornament::updateAccidentalsAboveAndBelow`), ou null. */
export function trillAccidentalGlyph(line, chord, keySig, below) {
  if (chord.notes?.[0]?.type !== 'note') return null; // hauteur et orthographe : portée de notation seulement
  if (ornamentIntervalOf(line, true).step !== 1) return null; // `showCueNote` : la note d'aide remplace les altérations
  return ornamentTarget(line, chord, keySig, below)?.glyph ?? null;
}

/** Signes d'ornement qui ont un intervalle au-dessus / en dessous (`Ornament::hasIntervalAbove/Below` ; `mordent` = glyphe sans trait = SMuFL shortTrill). */
const SIGN_ABOVE = new Set(['trill', 'mordent', 'turn', 'turnInverted']);
const SIGN_BELOW = new Set(['mordentInverted', 'turn', 'turnInverted']);

/**
 * Altérations (au-dessus / en dessous) d'un SIGNE d'ornement isolé (`Ornament::updateAccidentalsAboveAndBelow`) : seulement pour un intervalle non
 * automatique, et jamais quand la note d'aide est montrée (`showCueNote` : intervalle du dessus ≠ seconde). → `{ above, below }` (noms de glyphes ou null).
 */
export function signAccidentals(entry, chord, keySig) {
  const none = { above: null, below: null };
  if (!SIGN_ABOVE.has(entry.type) && !SIGN_BELOW.has(entry.type)) return none;
  if (ornamentIntervalOf(entry, true).step !== 1) return none; // note d'aide à la place
  return {
    above: SIGN_ABOVE.has(entry.type) ? trillAccidentalGlyph(entry, chord, keySig, false) : null,
    below: SIGN_BELOW.has(entry.type) ? trillAccidentalGlyph(entry, chord, keySig, true) : null,
  };
}

export function trillLineItems({ perSystem, staff, ctx, where, result, lines, lineDist, existing = [] }) {
  const model = staffTrills(ctx, staff);
  if (!model.length) return;
  const H = (lines - 1) * lineDist;
  const U = (y) => H - y;
  const glyphs = ctx.glyphs;
  const spanOf = (k) => systemSpan(perSystem, k, { headerMin: SYSTEM_BARLINE_WIDTH });
  const pool = perSystem.map((_, k) => {
    const rs = rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], glyphs).map((r) => ({ x1: r.x1, x2: r.x2, top: H - r.y2, bottom: H - r.y1 }));
    rs.push({ x1: -Infinity, x2: Infinity, top: -0.05, bottom: H + 0.05 });
    return rs;
  });
  const nextColumnX = (k, afterX) => {
    let best = null;
    for (const p of perSystem[k].placed) if (p.x > afterX + 1e-6 && (best === null || p.x < best)) best = p.x;
    return best;
  };
  // `Trill::trillLinePos` (fin) : la ligne s'arrête 1 sp avant la colonne suivante, reculée du plus grand de deux décalages — l'ornement « avant » le plus
  // à gauche de CETTE voix à la colonne suivante, et la petite clé de changement qui la précède (bord gauche de son glyphe).
  const stopOffset = (k, endP, nextX) => {
    let graceOffset = 0;
    for (const p of perSystem[k].placed) {
      if (Math.abs(p.x - nextX) > 1e-6 || (p.entry.voice ?? 0) !== (endP.entry.voice ?? 0)) continue;
      const xs = p.entry.graceLayout?.x;
      if (xs?.length) graceOffset = Math.max(graceOffset, -Math.min(...xs));
    }
    let clefOffset = 0;
    for (const it of [...(existing[k] ?? []), ...(result[k] ?? [])]) {
      if (it.role !== 'clef-change' || it.x <= endP.x || it.x > nextX) continue;
      const g = glyphs.glyphs[it.name];
      const leftEdge = g ? g.bbox.bBoxSW[0] * (it.mag ?? 1) : 0;
      clefOffset = Math.max(clefOffset, nextX - (it.x - leftEdge));
    }
    return Math.max(graceOffset, clefOffset);
  };
  const order = model
    .map((ln) => ({ ln, s: where.get(ln.startChordId), e: where.get(ln.endChordId) }))
    .filter((r) => r.s && r.e && TRILL_SYMBOLS[r.ln.trillType] && (r.s.k < r.e.k || (r.s.k === r.e.k && r.s.p.x <= r.e.p.x)))
    .sort((a, b) => a.s.k - b.s.k || a.s.p.x - b.s.p.x);

  for (const { ln, s, e } of order) {
    const below = ln.placement ? ln.placement === 'below' : (s.p.entry.voice ?? 0) % 2 === 1;
    const nextX = nextColumnX(e.k, e.p.x);
    const endX = nextX === null ? spanOf(e.k).right : nextX - 1 - stopOffset(e.k, e.p, nextX);
    for (let k = s.k; k <= e.k; k++) {
      const isBegin = k === s.k; const isEnd = k === e.k;
      const span = spanOf(k);
      const x1 = isBegin ? s.p.x : span.left;
      const x2 = isEnd ? endX : span.right;
      const row = trillSymbolRow(ln.trillType, Math.max(0, x2 - x1), isBegin, glyphs);
      if (!row.length) continue;
      const base0 = below ? H + POS_BELOW : POS_ABOVE;
      // boîte du segment relative à la ligne de base (y bas)
      let top = Infinity; let bottom = -Infinity; let right = x1;
      for (const r of row) {
        const g = glyphs.glyphs[r.name];
        if (!g) continue;
        top = Math.min(top, -g.bbox.bBoxNE[1]); bottom = Math.max(bottom, -g.bbox.bBoxSW[1]);
        right = Math.max(right, x1 + r.dx + g.bbox.bBoxNE[0]);
      }
      // altération (1er segment seulement) : centrée sur le 1er glyphe, à 0,35 sp du bord
      let acc = null;
      if (isBegin) {
        const name = trillAccidentalGlyph(ln, s.p.entry.item, s.p.entry.keySig ?? 0, below && ln.trillType === 'downPrall');
        const g = name && glyphs.glyphs[name];
        if (g) {
          const g0 = glyphs.glyphs[row[0].name];
          const w0 = g0.bbox.bBoxNE[0] - g0.bbox.bBoxSW[0];
          const aw = (g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0]) * ACC_MAG;
          const ah = { up: g.bbox.bBoxNE[1] * ACC_MAG, down: -g.bbox.bBoxSW[1] * ACC_MAG };
          const dx = g0.bbox.bBoxSW[0] + 0.5 * (w0 - aw) - g.bbox.bBoxSW[0] * ACC_MAG;
          if (below && ln.trillType === 'downPrall') { acc = { name, dx, dy: bottom + ACC_MARGIN + ah.up, extent: [bottom + ACC_MARGIN, bottom + ACC_MARGIN + ah.up + ah.down] }; }
          else { acc = { name, dx, dy: top - ACC_MARGIN - ah.down, extent: [top - ACC_MARGIN - ah.up - ah.down, top - ACC_MARGIN] }; }
          top = Math.min(top, acc.extent[0]); bottom = Math.max(bottom, acc.extent[1]);
        }
      }
      let yd = 0;
      const overl = pool[k].filter((r) => r.x2 > x1 && r.x1 < right);
      if (overl.length) {
        if (below) yd = Math.max(0, Math.max(...overl.map((r) => r.bottom)) + MIN_DISTANCE - (base0 + top));
        else yd = Math.min(0, Math.min(...overl.map((r) => r.top)) - MIN_DISTANCE - (base0 + bottom));
      }
      const base = base0 + yd;
      for (const r of row) result[k].push({ kind: 'glyph', name: r.name, x: x1 + r.dx, y: U(base), role: 'trill-line', ref: ln.id });
      if (acc) result[k].push({ kind: 'glyph', name: acc.name, x: x1 + acc.dx, y: U(base + acc.dy), mag: ACC_MAG, role: 'trill-accidental', ref: ln.id });
      pool[k].push({ x1, x2: right, top: base + top, bottom: base + bottom });
    }
  }
}
