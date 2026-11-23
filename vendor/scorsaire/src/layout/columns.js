/*
 * Colonnes de temps — cœur de la mise en page multi-portées (MuseScore : `Segment`, `HorizontalSpacing`).
 *
 * Chaque instant d'une mesure (fraction exacte depuis son début) est UNE colonne commune à toutes les portées et à toutes
 * les voix : deux éléments qui attaquent au même instant sont alignés verticalement, sans tolérance, même s'ils viennent
 * d'un triolet et de croches. Largeur d'une colonne = celle de l'élément le plus large qui y attaque (règle du prototype :
 * `mergeVoiceColumns`, généralisée à toutes les portées du système). Une colonne a une « avance » `lead` (place à gauche des
 * têtes : altérations) : les têtes de toutes les portées s'alignent à `début + lead × étirement`, les altérations pendent à gauche.
 */
import { fCmp, fAdd, fSub, fMin, SID } from '../model/index.js';
import { fToNumber } from '../model/fraction.js';
import { segmentStretch } from './spacing.js';
import { DEFAULT_QUARTER_NOTE_SPACE } from './constants.js';
import { createPaddingTable, MUSESCORE_PADDING_STYLE } from './padding.js';
import { spaceSegments, segmentMinDistance } from './hspacing.js';
import { entryShape, graceShape } from './shapes.js';
import { breathGeometry } from './breaths.js';

const BAR_LINE_WIDTH = 0.16; // largeur de la forme d'une barre simple

const PADDING = { table: createPaddingTable(), style: MUSESCORE_PADDING_STYLE };

const key = (position) => `${position[0]}/${position[1]}`;

/**
 * Memo of what the spacing computes for an ENTRY that survives from one layout to the next (incremental layout: the entries of an untouched measure are the previous
 * layout's objects): its width and lead and its shape. All of it is a function of the entry, of the stretch factor of its
 * column and of the shortest duration of the piece, so after hiding a staff (columns must be recomputed: they depend on every shown staff) the staves that stay do not
 * repaint each of their entries for its shape. The shape rectangles are never modified (spaceByShapes copies them), so they are shared.
 */
// (the memo lives ON the entry, as a hidden property, not in a table of the module: it dies with the entry, and a changed measure gets new entries)
const MEMO = Symbol('entryMemo');
const memoKey = (stretch, min) => `${stretch}|${min ? `${min[0]}/${min[1]}` : ''}`;
const memoable = (src, ctx) => ctx.memoEntries && !ctx.spacingStaves && !src.relocated && !src.crossMember && src.shapeStaff === undefined;
function memoOf(src, k) { return src[MEMO]?.get(k); }
function memoSet(src, k, value) {
  if (!src[MEMO]) Object.defineProperty(src, MEMO, { value: new Map(), enumerable: false });
  const old = src[MEMO].get(k);
  if (old) Object.assign(old, value); else src[MEMO].set(k, value);
}

/** Colonnes de la mesure `mi`, triées par instant : [{ position, width, entries: [{ staffIndex, …entrée, width }] }]. */
export function measureColumns(ctx, mi) {
  // 1. entrées regroupées par instant
  const byPosition = new Map();
  // staves that take part in the spacing: the staves of the piece, plus (option "widen") the nested staves of stacked containers
  const staves = ctx.spacingStaves ?? ctx.staves;
  const allEntries = ctx.spacingEntries ?? ctx.entries;
  staves.forEach((sref, si) => {
    for (const entry of allEntries[si][mi]) {
      const k = key(entry.position);
      let col = byPosition.get(k);
      if (!col) {
        col = { position: entry.position, width: 0, lead: 0, space: 0, stretchFactor: 0, entries: [] };
        byPosition.set(k, col);
      }
      col.entries.push({ ...entry, staffIndex: si, sref });
      (col.srcs ??= []).push(entry);
    }
  });
  const columns = [...byPosition.values()].sort((a, b) => fCmp(a.position, b.position));
  // 2. étirement par SEGMENT (MuseScore : durée jusqu'au prochain instant, toutes portées confondues, pas la durée de chaque élément)
  const measureEnd = fAdd(ctx.offsets?.[mi] ?? [0, 1], ctx.barLengths[mi]);
  let prev = null;
  columns.forEach((col, i) => {
    const next = i + 1 < columns.length ? columns[i + 1].position : measureEnd;
    const segTicks = fSub(next, col.position);
    const durations = col.entries.filter((e) => e.duration && !e.annotation).map((e) => e.duration);
    const shortest = durations.length ? durations.reduce((m, d) => fMin(m, d)) : segTicks;
    col.stretchFactor = segmentStretch(segTicks, shortest, prev, ctx.style);
    prev = { segTicks, shortest };
  });
  // 3. largeurs : place naturelle du segment, élargie par la forme de chaque élément
  const srcsOf = new Map(); // column → the original entries (the memo is keyed by them)
  for (const col of columns) {
    const srcs = col.srcs; delete col.srcs;
    srcsOf.set(col, srcs);
    col.entries = col.entries.map(({ sref, ...e }, i) => {
      const entry = { ...e, spaceStretch: col.stretchFactor };
      const src = srcs[i];
      const memo = memoable(src, ctx) ? memoOf(src, memoKey(col.stretchFactor, sref.ctx.minDuration)) : null;
      let width; let lead;
      if (memo && memo.width !== undefined) { width = memo.width; lead = memo.lead; } else {
        width = sref.painter.itemWidth(entry, sref.ctx);
        lead = sref.painter.lead ? sref.painter.lead(entry, sref.ctx) : 0;
        if (memoable(src, ctx)) memoSet(src, memoKey(col.stretchFactor, sref.ctx.minDuration), { width, lead });
      }
      col.lead = Math.max(col.lead, lead);
      col.space = Math.max(col.space, width - lead);
      return { ...entry, width, lead };
    });
    col.width = col.lead + col.space;
  }
  if (ctx.style(SID.SHAPE_SPACING)) spaceByShapes(ctx, columns, measureEnd, mi, staves, srcsOf);
  return columns;
}

/**
 * Espacement par formes (MuseScore `HorizontalSpacing::spaceSegments`) : l'écart entre les ORIGINES de deux colonnes voisines est le plus
 * grand de la place naturelle (`3,5 sp × étirement`) et de la distance minimale entre les formes des éléments (`PaddingTable`) ; une
 * altération ne s'ajoute plus à la largeur naturelle, elle l'ÉLARGIT seulement si celle-ci ne suffit pas. Après le calcul :
 *   col.lead  = place à gauche de l'origine de la 1re colonne seulement (les suivantes : 0, leur origine = leur début) ;
 *   col.width = écart d'origine à origine (1re colonne : + lead) ; la dernière colonne va jusqu'à la barre de fin de mesure.
 */
function spaceByShapes(ctx, columns, measureEnd, mi, staves = ctx.staves, srcsOf = new Map()) {
  if (!columns.length) return;
  const nStaves = staves.length;
  const colSegs = columns.map((col, i) => {
    const shapes = Array.from({ length: nStaves }, () => []);
    const srcs = srcsOf.get(col);
    col.entries.forEach((e, ei) => {
      const sref = staves[e.staffIndex];
      const natural = DEFAULT_QUARTER_NOTE_SPACE * col.stretchFactor;
      const moveX = e.vx ? e.vx.moveX : 0;
      const src = srcs?.[ei];
      const k = src && memoable(src, ctx) ? memoKey(col.stretchFactor, sref.ctx.minDuration) : null;
      const memo = k ? memoOf(src, k) : null;
      let sh;
      if (memo?.rects) {
        if (ctx.memoStats) ctx.memoStats.shapeHits++;
        // (the shape pass also leaves fields on the entry — slurGeom, articItems, dotsRight… — but nothing reads them before the measure is painted or restored from the painting cache,
        // which both set them again: tests/layout-incremental-staffset.test.js)
        sh = memo.rects.map((r) => ({ ...r, staff: e.staffIndex }));
      } else {
        if (ctx.memoStats && k) ctx.memoStats.shapeMisses++;
        sh = entryShape(e, sref.painter, sref.ctx, { staff: e.staffIndex, naturalSpace: natural });
        if (k) memoSet(src, k, { rects: sh });
      }
      for (const r of sh) shapes[e.shapeStaff ?? e.staffIndex].push({ ...r, l: r.l + moveX, r: r.r + moveX }); // accord relocalisé (portées croisées) : forme dans la portée CIBLE
    });
    const tick = fToNumber(col.position);
    const endTick = i + 1 < columns.length ? fToNumber(columns[i + 1].position) : fToNumber(measureEnd);
    return { kind: 'col', col: i, position: col.position, tick, endTick, isCR: true, shapes, naturalWidth: DEFAULT_QUARTER_NOTE_SPACE * col.stretchFactor };
  });
  // segments « Breath » (un par instant, toutes portées) : alignés à droite, placés AVANT le segment d'accord de même instant (`SegmentType::Breath` < `ChordRest`)
  const groups = new Map();
  ctx.staves.forEach((sref, si) => {
    for (const b of ctx.breaths?.[si]?.[mi] ?? []) {
      const geom = breathGeometry(b, sref.painter.lines(sref.staff, sref.ctx), ctx.glyphs);
      if (!geom) continue;
      let g = groups.get(key(b.position));
      if (!g) {
        g = { kind: 'breath', position: b.position, tick: fToNumber(b.position), endTick: fToNumber(b.position), isCR: false, rightAligned: true,
          shapes: Array.from({ length: nStaves }, () => []), naturalWidth: 0, members: [] };
        groups.set(key(b.position), g);
      }
      g.members.push({ staffIndex: si, breath: b, geom });
      g.shapes[si].push({ type: 'BREATH', l: geom.l, r: geom.r, t: geom.t, b: geom.b, voice: b.voice, staff: si, mag: 1 });
    }
  });
  const segs = [...colSegs, ...groups.values()].sort((a, b) => fCmp(a.position, b.position) || (a.kind === b.kind ? 0 : a.kind === 'breath' ? -1 : 1));
  // barre de fin de mesure (+ ornements « après » qui s'y posent), en dernier segment
  const barShapes = Array.from({ length: nStaves }, () => []);
  staves.forEach((sref, si) => {
    const lines = sref.painter.lines(sref.staff, sref.ctx);
    const ys = lines.map((l) => l.y);
    const span = !ys.length && sref.painter.barSpan ? sref.painter.barSpan(sref.staff, sref.ctx) : null; // portée sans lignes (accords) : étendue des barres du peintre
    const lo = span ? span.lo : ys.length ? Math.min(...ys) : 0, hi = span ? span.hi : ys.length ? Math.max(...ys) : 4;
    barShapes[si].push({ type: 'BAR_LINE', l: 0, r: BAR_LINE_WIDTH, t: lo, b: hi, voice: -1, staff: si, mag: 1 });
  });
  for (const col of columns) for (const e of col.entries) {
    if (e.graceTrailLayout?.boxes) barShapes[e.staffIndex].push(...graceShape(e.graceTrailLayout.boxes, { voice: e.voice ?? 0, staff: e.staffIndex }));
  }
  segs.push({ kind: 'bar', tick: fToNumber(measureEnd), endTick: fToNumber(measureEnd), isCR: false, shapes: barShapes, naturalWidth: 0 });

  const lead0 = columns[0].lead;
  // place à gauche de l'origine de la 1re colonne = le point le plus à gauche de ses formes (`Segment::minLeft`) : sert à l'espacement d'en-tête (`systems.js`)
  let shapeLeft = 0;
  for (const sh of colSegs[0].shapes) for (const r of sh) shapeLeft = Math.max(shapeLeft, -r.l);
  columns[0].shapeLeft = shapeLeft;
  // formes gardées : `respaceColumns` recalcule l'espacement (compression d'un système trop large) sans repasser par les peintres
  columns.shapeSpacing = { segs, lead0, columnsStretch: columns.map((c) => c.stretchFactor) };
  respaceColumns(columns, 1, 1);
}

/**
 * Recalcule les largeurs de colonnes d'une mesure à partir de ses formes (`HorizontalSpacing::computeSpacingForFullSystem` avec ses deux
 * réductions) : `squeeze` réduit toutes les distances entre formes (paddings, dégagements vertical, en-tête ; `squeezeFactor`),
 * `stretchReduction` réduit la place naturelle des durées (`naturalWidth = defaultQuarterNoteSpace × étirement × stretchReduction`).
 * 1 et 1 = espacement normal. Pose aussi `columns.breathSegs` : les segments de respiration avec leurs liens vers les segments suivants.
 */
export function respaceColumns(columns, squeeze = 1, stretchReduction = 1) {
  const sp = columns.shapeSpacing;
  if (!sp) return;
  const { segs, lead0 } = sp;
  segs.forEach((seg) => {
    if (seg.kind === 'col') seg.naturalWidth = DEFAULT_QUARTER_NOTE_SPACE * sp.columnsStretch[seg.col] * stretchReduction;
  });
  const opts = { ...PADDING, squeeze };
  const xs = spaceSegments(segs, opts, lead0);
  const colIndex = []; // colonne i → indice de son segment
  segs.forEach((seg, k) => { if (seg.kind === 'col') colIndex[seg.col] = k; });
  const breathIndex = new Map(); // indice de segment → rang dans `breathSegs`
  segs.forEach((seg, k) => { if (seg.kind === 'breath') breathIndex.set(k, breathIndex.size); });
  const barIdx = segs.length - 1;
  // distance depuis la barre PRÉCÉDENTE (même forme que la barre de fin) jusqu'au début de la 1re colonne (origine − lead0), mesurée depuis
  // le bord droit de la barre : `BAR_LINE → NOTE` 1,25 sp, `BAR_LINE → ACCIDENTAL` 0,65 sp (`minHorizontalDistance`)
  const startBar = { shapes: segs[barIdx].shapes.map((sh) => sh.filter((r) => r.type === 'BAR_LINE')) };
  columns.barGap = Math.max(0, segmentMinDistance(startBar, segs[colIndex[0]], opts) - BAR_LINE_WIDTH - lead0);
  columns.forEach((col, i) => {
    const next = i + 1 < columns.length ? colIndex[i + 1] : barIdx;
    col.width = xs[next] - xs[colIndex[i]] + (i === 0 ? lead0 : 0);
    col.lead = i === 0 ? lead0 : 0;
    col.space = col.width - col.lead;
  });
  columns.breathSegs = segs.flatMap((seg, k) => {
    if (seg.kind !== 'breath') return [];
    const links = (xs.links[k] ?? []).map(({ index, dist }) => {
      const t = segs[index];
      return { dist, target: t.kind === 'col' ? { col: t.col } : t.kind === 'bar' ? { bar: true } : { breath: breathIndex.get(index) } };
    });
    return [{ members: seg.members, links }];
  });
}

/**
 * Independent copy of the columns of a measure (the incremental layout keeps a pristine copy per measure and works on another one: the system
 * breaking squeezes columns and the painters write onto their entries). The shapes themselves are never modified, so they are shared; the
 * `segs` records (whose `naturalWidth` `respaceColumns` rewrites) are copied.
 */
export function cloneColumns(columns) {
  const out = columns.map((col) => ({ ...col, entries: col.entries.map((e) => ({ ...e })) }));
  for (const k of Object.keys(columns)) if (!/^\d+$/.test(k)) out[k] = columns[k];
  const sp = columns.shapeSpacing;
  if (sp) out.shapeSpacing = { ...sp, segs: sp.segs.map((seg) => ({ ...seg })), columnsStretch: [...sp.columnsStretch] };
  if (columns.breathSegs) out.breathSegs = columns.breathSegs.map((b) => ({ ...b, links: b.links.map((l) => ({ ...l })) }));
  return out;
}

/** Somme des largeurs de colonnes (part étirable de la mesure, sans l'espace après la barre). */
export const columnsWidth = (columns) => columns.reduce((sum, c) => sum + c.width, 0);
