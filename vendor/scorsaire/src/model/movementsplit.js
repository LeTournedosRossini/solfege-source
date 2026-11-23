/*
 * Cutting a movement into several: "one exercise = one movement" (a sheet of 16 patterns imported as 16 measures in a row).
 * CALL IT INSIDE `doc.transaction(name, () => …)` — the whole cut is one undoable step.
 *
 * Method (nothing is copied by hand): for each range, DUPLICATE the whole movement (fresh identifiers), then DELETE the measures outside the range with
 * `deleteMeasures` (slurs reconnected, references purged, automation and breaks purged). What is written PER MEASURE (time signature, key signature, bar line,
 * repeat signs) comes along by itself. What is "in force" from an earlier measure and would be lost is put back at the start of the new movement:
 *   - the tempo and the swing in force (a copy of the last one before the cut, on the first measure) ;
 *   - the clef of each staff (the base clef becomes the clef in force at the cut).
 * A tie that crosses a cut cannot be kept: it is dropped and reported in `warnings` (never refused).
 * The original is removed (unless `keepOriginal`); the sheets that showed it get one cell per new movement, in its place.
 *
 *   splitMovement(doc, mv, ranges, { titles, keepOriginal, sheets }) → { movements, warnings: [{ code: 'tie', range: k, count }] }
 *   ranges: [{ from, to }] measure indexes (inclusive), in order, not overlapping; measures outside every range are left out.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createElement } from './elements.js';
import { fCmp, ZERO } from './fraction.js';
import { deleteMeasures } from './measureedit.js';
import { copyMovement, removeMovement } from './movementedit.js';
import { addCell } from './sheetedit.js';
import { EditError } from './noteedit.js';

const staffsOf = (mv) => mv.tracks.flatMap((t) => t.staves);

/** Checks the ranges (integers, in order, inside the movement, not overlapping) and returns them as plain objects. */
export function checkRanges(ranges, total) {
  if (!Array.isArray(ranges) || !ranges.length) throw new EditError('Nothing to cut: no range');
  let last = -1;
  return ranges.map((r) => {
    if (!Number.isInteger(r?.from) || !Number.isInteger(r?.to) || r.from < 0 || r.to < r.from || r.to >= total) throw new EditError('Invalid range of measures');
    if (r.from <= last) throw new EditError('The ranges must follow each other without overlapping');
    last = r.to;
    return { from: r.from, to: r.to };
  });
}

/** Where each note sits (index of its measure), over every staff of the movement. */
export function noteMeasures(mv) {
  const where = new Map();
  for (const staff of staffsOf(mv)) for (const voice of staff.voices) voice.measures.forEach((m, mi) => {
    for (const item of m.items ?? []) for (const n of item.notes ?? []) where.set(n.id, mi);
  });
  return where;
}

/** Number of ties that have exactly one end inside `range` (they cannot survive the cut). */
export function crossingTies(mv, where, range) {
  let count = 0;
  const inside = (id) => { const mi = where.get(id); return mi !== undefined && mi >= range.from && mi <= range.to; };
  for (const staff of staffsOf(mv)) for (const tie of getProperty(staff, PID.TIES) ?? []) {
    if (inside(tie.startNoteId) !== inside(tie.endNoteId) && (where.has(tie.startNoteId) || where.has(tie.endNoteId))) count += 1;
  }
  return count;
}

/** The last element of `list` (tempos, swings) that starts BEFORE measure `from`, unless one starts exactly at its beginning. */
function inForce(list, indexOf, from) {
  let last = null; let atStart = false; let best = null;
  for (const el of list) {
    const mi = indexOf.get(getProperty(el, PID.MEASURE_ID));
    if (mi === undefined) continue;
    const pos = getProperty(el, PID.POSITION) ?? ZERO;
    if (mi === from && fCmp(pos, ZERO) === 0) atStart = true;
    if (mi < from && (best === null || mi > best.mi || (mi === best.mi && fCmp(pos, best.pos) >= 0))) best = { mi, pos, el };
  }
  last = best?.el ?? null;
  return atStart ? null : last;
}

/** The clef in force at the very start of measure `from` for a staff: { clef, concert } (the changes at (from, 0) count, they are folded in). */
function clefAtStart(staff, indexOf, from) {
  let clef = getProperty(staff, PID.CLEF); let concert = getProperty(staff, PID.CONCERT_CLEF) ?? null; let best = null;
  for (const c of getProperty(staff, PID.CLEF_CHANGES) ?? []) {
    const mi = indexOf.get(c.measureId);
    if (mi === undefined || mi > from || (mi === from && fCmp(c.position ?? ZERO, ZERO) !== 0)) continue;
    if (best === null || mi > best.mi || (mi === best.mi && fCmp(c.position ?? ZERO, best.pos) >= 0)) best = { mi, pos: c.position ?? ZERO, c };
  }
  if (best) { clef = best.c.clef; concert = best.c.concertClef ?? (concert ? best.c.clef : null); }
  return { clef, concert };
}

function putTempoOrSwing(doc, copy, key, type, source, firstId) {
  if (!source) return;
  const props = { ...source.props, [PID.MEASURE_ID]: firstId, [PID.POSITION]: [0, 1] };
  doc.add(copy, key, createElement(type, { props }));
}

/** What is "in force" at the start of measure `from` and would be lost by a cut: the tempo, the swing and the clef of each staff (read from the ORIGINAL). */
export function captureInForce(mv, indexOf, from) {
  return {
    tempo: inForce(mv.tempos, indexOf, from),
    swing: inForce(mv.swings, indexOf, from),
    clefs: staffsOf(mv).map((st) => clefAtStart(st, indexOf, from)),
  };
}

/** Puts what `captureInForce` read back at the start of a cut copy (inside a transaction). */
export function restoreInForce(doc, copy, { tempo, swing, clefs }) {
  const firstId = copy.masterbars[0].id;
  putTempoOrSwing(doc, copy, 'tempos', 'tempo', tempo, firstId);
  putTempoOrSwing(doc, copy, 'swings', 'swing', swing, firstId);
  staffsOf(copy).forEach((staff, si) => {
    const want = clefs[si];
    const changes = getProperty(staff, PID.CLEF_CHANGES) ?? [];
    const rest = changes.filter((c) => !(c.measureId === firstId && fCmp(c.position ?? ZERO, ZERO) === 0)); // folded into the base clef
    if (rest.length !== changes.length) doc.set(staff, PID.CLEF_CHANGES, rest);
    if (want.clef && want.clef !== getProperty(staff, PID.CLEF)) doc.set(staff, PID.CLEF, want.clef);
    if (want.concert && want.concert !== getProperty(staff, PID.CONCERT_CLEF)) doc.set(staff, PID.CONCERT_CLEF, want.concert);
  });
}

export function splitMovement(doc, mv, ranges, { titles = [], keepOriginal = false, sheets = true } = {}) {
  const index = doc.work.movements.findIndex((m) => m.id === mv.id);
  if (index < 0) throw new EditError('Unknown movement');
  const total = mv.masterbars.length;
  const list = checkRanges(ranges, total);
  const indexOf = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  const where = noteMeasures(mv);
  const warnings = [];
  // everything that depends on the ORIGINAL is read before anything changes
  const plan = list.map((range, k) => {
    const ties = crossingTies(mv, where, range);
    if (ties) warnings.push({ code: 'tie', range: k, count: ties });
    return { range, ...captureInForce(mv, indexOf, range.from) };
  });
  const sheetSlots = sheets ? (doc.work.sheets ?? []).map((sh) => ({ id: sh.id, at: (getProperty(sh, PID.SHEET_CELLS) ?? []).findIndex((c) => c.movementId === mv.id) })).filter((s) => s.at >= 0) : [];

  const created = [];
  plan.forEach(({ range, tempo, swing, clefs }, k) => {
    const copy = copyMovement(mv);
    doc.add(doc.work, 'movements', copy, index + 1 + k);
    if (range.to < total - 1) deleteMeasures(doc, copy, { from: range.to + 1, to: total - 1 });
    if (range.from > 0) deleteMeasures(doc, copy, { from: 0, to: range.from - 1 });
    restoreInForce(doc, copy, { tempo, swing, clefs });
    if (typeof titles[k] === 'string') doc.set(copy, PID.TITLE, titles[k].trim());
    created.push(copy);
  });
  for (const slot of sheetSlots) created.forEach((copy, k) => addCell(doc, slot.id, copy.id, { index: slot.at + 1 + k }));
  if (!keepOriginal) removeMovement(doc, mv);
  return { movements: created, warnings };
}

// ---------- the usual ways to choose the ranges ----------

/** Every `n` measures (the last one may be shorter). */
export function rangesEvery(total, n) {
  const step = Math.max(1, Math.floor(n));
  const out = [];
  for (let from = 0; from < total; from += step) out.push({ from, to: Math.min(total - 1, from + step - 1) });
  return out;
}

/** One range up to each double / final / heavy bar line (a new exercise starts after it). */
export function rangesAtDoubleBars(mv) {
  const out = []; let from = 0;
  mv.masterbars.forEach((b, i) => {
    const type = getProperty(b, PID.BAR_TYPE);
    if (type !== 'simple' && type !== 'dashed' && type !== 'dotted' && type !== 'short' && type !== 'tick') { out.push({ from, to: i }); from = i + 1; }
  });
  if (from < mv.masterbars.length) out.push({ from, to: mv.masterbars.length - 1 });
  return out;
}

/** A new range at every rehearsal mark (the text on the measure), the first one starting at measure 0. */
export function rangesAtRehearsalMarks(mv) {
  const starts = new Set([0]);
  const indexOf = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  for (const r of mv.rehearsalMarks ?? []) { const mi = indexOf.get(getProperty(r, PID.MEASURE_ID)); if (mi !== undefined) starts.add(mi); }
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.map((from, i) => ({ from, to: (sorted[i + 1] ?? mv.masterbars.length) - 1 }));
}
