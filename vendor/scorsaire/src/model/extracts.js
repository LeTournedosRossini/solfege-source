/*
 * Parts by EXTRACTS (screen 2): a part that shows a list of BLOCKS instead of whole movements. A block is a slice of one movement, chosen
 *   - by SECTION  { kind: 'section', sectionId }          (the id of the section container: it follows renames and moves), or
 *   - by MEASURES { kind: 'range', from, to }             (measure ids of the masterbars, inclusive: they follow insertions and deletions),
 * with its own track selection (`staffIds`, null = every staff of the part), and two optional page rules: `breakBefore` (new page) and `keepTogether`.
 *   block = { id, movementId, source, staffIds?, breakBefore?, keepTogether?, chordView? }  (chordView: how the block reads the chords, 'author' | 'original' | 'capo'; absent = as the part does)
 * The slice is COMPUTED, never stored: `sliceMovement` copies the movement (same identifiers) into a scratch document, deletes the measures outside the
 * range with `deleteMeasures` (as the movement split does) and puts back what was in force (tempo, swing, clefs). The document is never touched.
 * An optional property: a part without `PID.PART_EXTRACTS` is a normal part and nothing else changes.
 *
 * Warnings (never refusals): 'tie' (a tie cut at an edge), 'repeat' (a repeat sign without its mate inside the block), 'volta' (a volta cut at an edge).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createWork } from './elements.js';
import { createDocument } from './document.js';
import { hydrate } from './serialize.js';
import { deleteMeasures } from './measureedit.js';
import { captureInForce, restoreInForce, noteMeasures, crossingTies } from './movementsplit.js';
import { sectionSpans } from './sections.js';
import { newId } from './ids.js';
import { EditError } from './noteedit.js';
import { addZoneCell, isBeforeRow, ZONE_BEFORE_BASE, ZONE_MAX_ROWS } from './partzones.js';
import { addPartContainer } from './partcontainers.js';
import { partStaffIds } from './partedit.js';

export const MAX_EXTRACT_BLOCKS = 64;

/** Defaults of `PID.PART_EXTRACT_LAYOUT` and what is accepted (staff spaces for the gap between columns). */
export const EXTRACT_LAYOUT_DEFAULTS = Object.freeze({ columns: 1, gap: 2, rowGap: null, flow: 'grid', perPage: 0, numbers: false }); // rowGap null = automatic (the room between two systems, 6 staff spaces at least)
export const EXTRACT_MAX_COLUMNS = 4;
export const EXTRACT_MAX_GAP = 20;
export const EXTRACT_MAX_ROW_GAP = 30;

/** The page layout of the blocks of a part, normalised: { columns, gap, flow, perPage, numbers }. */
export function extractLayoutOf(part) {
  const raw = part?.props?.[PID.PART_EXTRACT_LAYOUT] ?? {};
  const D = EXTRACT_LAYOUT_DEFAULTS;
  const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    columns: Math.round(num(raw.columns, 1, EXTRACT_MAX_COLUMNS, D.columns)),
    gap: num(raw.gap, 0, EXTRACT_MAX_GAP, D.gap),
    rowGap: Number.isFinite(raw.rowGap) ? Math.min(EXTRACT_MAX_ROW_GAP, Math.max(0, raw.rowGap)) : null,
    flow: raw.flow === 'free' ? 'free' : 'grid',
    perPage: Math.round(num(raw.perPage, 0, MAX_EXTRACT_BLOCKS, D.perPage)),
    numbers: raw.numbers === true,
  };
}

/** Changes some settings of the page layout (inside a transaction); only the values that differ from the defaults are kept. */
export function setExtractLayout(doc, part, patch) {
  const next = { ...extractLayoutOf(part), ...patch };
  const clean = extractLayoutOf({ props: { [PID.PART_EXTRACT_LAYOUT]: next } });
  const kept = {};
  for (const k of Object.keys(EXTRACT_LAYOUT_DEFAULTS)) if (clean[k] !== EXTRACT_LAYOUT_DEFAULTS[k]) kept[k] = clean[k];
  if (Object.keys(kept).length) doc.set(part, PID.PART_EXTRACT_LAYOUT, kept); else doc.reset(part, PID.PART_EXTRACT_LAYOUT);
}

/** The blocks of a part (empty list = a normal part). */
export const extractBlocks = (part) => (Array.isArray(part?.props?.[PID.PART_EXTRACTS]) ? part.props[PID.PART_EXTRACTS] : []);
export const isExtractPart = (part) => extractBlocks(part).length > 0;

export function createExtractBlock({ movementId, source, staffIds = null, id, breakBefore = false, keepTogether = false, chordView = null }) {
  if (typeof movementId !== 'string') throw new EditError('A block needs a movement');
  if (source?.kind === 'section') { if (typeof source.sectionId !== 'string') throw new EditError('A section block needs a section'); }
  else if (source?.kind === 'range') { if (typeof source.from !== 'string' || typeof source.to !== 'string') throw new EditError('A range block needs two measures'); }
  else throw new EditError('Unknown block source');
  const block = { id: id ?? newId('xb'), movementId, source: { ...source }, staffIds: staffIds ? [...staffIds] : null };
  if (breakBefore) block.breakBefore = true; // the block starts a new page
  if (keepTogether) block.keepTogether = true; // the block is not split between two pages when it fits on one
  if (chordView === 'author' || chordView === 'original' || chordView === 'capo') block.chordView = chordView; // its own way of reading the chord symbols (model/chordview.js)
  return block;
}

/** The measure indexes { from, to } of a block in its movement, or null when its section or measures no longer exist. */
export function blockRange(mv, block) {
  const indexOf = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  const src = block.source;
  if (src?.kind === 'section') {
    const span = sectionSpans(mv).find((s) => s.id === src.sectionId);
    return span ? { from: span.from, to: span.to } : null;
  }
  if (src?.kind === 'range') {
    const a = indexOf.get(src.from); const b = indexOf.get(src.to);
    if (a === undefined || b === undefined) return null;
    return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  return null;
}

/** Repeat signs and voltas that do not close inside the range. */
function edgeWarnings(mv, range) {
  const out = [];
  const slice = mv.masterbars.slice(range.from, range.to + 1);
  let open = 0; let unmatchedEnd = false;
  for (const b of slice) {
    if (getProperty(b, PID.REPEAT_START)) open += 1;
    if (getProperty(b, PID.REPEAT_END)) { if (open > 0) open -= 1; else unmatchedEnd = true; }
  }
  if (open > 0 || unmatchedEnd) out.push({ code: 'repeat' });
  const indexOf = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  let cut = 0;
  for (const v of mv.voltas ?? []) {
    const a = indexOf.get(getProperty(v, PID.MEASURE_ID));
    if (a === undefined) continue;
    const z = a + (getProperty(v, PID.SPAN) ?? 1) - 1;
    const overlaps = a <= range.to && z >= range.from;
    if (overlaps && (a < range.from || z > range.to)) cut += 1;
  }
  if (cut) out.push({ code: 'volta', count: cut });
  return out;
}

/**
 * The slice of `mv` over `range` ({ from, to } measure indexes): a detached movement with the SAME identifiers as the original (so what the part anchors
 * by measure id still finds its place) and the warnings. The tempo, the swing and the clefs in force at the start are put back on its first measure.
 */
export function sliceMovement(mv, range) {
  const total = mv.masterbars.length;
  if (!Number.isInteger(range?.from) || !Number.isInteger(range?.to) || range.from < 0 || range.to < range.from || range.to >= total) throw new EditError('Invalid range of measures');
  const warnings = [];
  const ties = crossingTies(mv, noteMeasures(mv), range);
  if (ties) warnings.push({ code: 'tie', count: ties });
  warnings.push(...edgeWarnings(mv, range));
  if (range.from === 0 && range.to === total - 1) return { movement: mv, warnings }; // the whole movement: nothing to cut
  const indexOf = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  const force = captureInForce(mv, indexOf, range.from);
  const copy = hydrate(JSON.parse(JSON.stringify(mv)));
  const doc = createDocument(createWork({ movements: [copy] }), { checkInvariants: false });
  doc.transaction('slice', () => {
    if (range.to < total - 1) deleteMeasures(doc, copy, { from: range.to + 1, to: total - 1 });
    if (range.from > 0) deleteMeasures(doc, copy, { from: 0, to: range.from - 1 });
    restoreInForce(doc, copy, force);
  });
  return { movement: copy, warnings };
}

/** Every block of a part resolved against the work: [{ block, movement (the original), range, slice, warnings, missing }]. */
export function resolveExtracts(work, part) {
  return extractBlocks(part).map((block) => {
    const movement = work.movements.find((m) => m.id === block.movementId);
    const range = movement ? blockRange(movement, block) : null;
    if (!movement || !range) return { block, movement: movement ?? null, range: null, slice: null, warnings: [], missing: true };
    const { movement: slice, warnings } = sliceMovement(movement, range);
    return { block, movement, range, slice, warnings, missing: false };
  });
}

// ---------- editing (inside doc.transaction) ----------

const write = (doc, part, list) => doc.set(part, PID.PART_EXTRACTS, list.length ? list : null);

export function addExtractBlock(doc, part, spec, at) {
  const list = [...extractBlocks(part)];
  if (list.length >= MAX_EXTRACT_BLOCKS) throw new EditError('Too many blocks');
  const block = createExtractBlock(spec);
  list.splice(at ?? list.length, 0, block);
  write(doc, part, list);
  return block;
}

/**
 * One block per movement of the work that has a staff shown by the part, each covering the WHOLE movement, appended after the blocks already there (a movement
 * that already has a block covering all of it is not added twice). Returns the blocks added. Inside a transaction.
 */
export function addBlockPerMovement(doc, part) {
  const shown = new Set(partStaffIds(doc.work, part));
  const list = [...extractBlocks(part)];
  const added = [];
  for (const mv of doc.work.movements) {
    if (!mv.masterbars.length || !mv.tracks.some((t) => t.staves.some((st) => shown.has(st.id)))) continue;
    const from = mv.masterbars[0].id; const to = mv.masterbars[mv.masterbars.length - 1].id;
    if (list.some((b) => b.movementId === mv.id && b.source?.kind === 'range' && b.source.from === from && b.source.to === to)) continue;
    if (list.length >= MAX_EXTRACT_BLOCKS) throw new EditError('Too many blocks');
    const block = createExtractBlock({ movementId: mv.id, source: { kind: 'range', from, to } });
    list.push(block); added.push(block);
  }
  if (added.length) write(doc, part, list);
  return added;
}

export function updateExtractBlock(doc, part, blockId, patch) {
  const list = extractBlocks(part).map((b) => (b.id === blockId ? createExtractBlock({ ...b, ...patch, id: b.id }) : b));
  if (!list.some((b) => b.id === blockId)) throw new EditError('Unknown block');
  write(doc, part, list);
}

export function removeExtractBlock(doc, part, blockId) {
  for (const c of [...blockZoneCells(part, blockId)]) doc.remove(c); // the zones of a block go with it
  write(doc, part, extractBlocks(part).filter((b) => b.id !== blockId));
}

/** The zone cells (staff containers of the part) that belong to a block. */
export const blockZoneCells = (part, blockId) => (part.containers ?? []).filter((c) => getProperty(c, PID.CONTAINER_BLOCK_ID) === blockId);

/** Number of zones of a block above (`above`) or under (`below`) it. */
export function blockZoneCount(part, blockId, position) {
  const rows = new Set(blockZoneCells(part, blockId).map((c) => getProperty(c, PID.CONTAINER_ZONE_ROW)).filter((r) => isBeforeRow(r) === (position === 'above')));
  return rows.size;
}

/**
 * Adds a zone ABOVE the first system of a block or UNDER its last one: the same cells as the zones between systems (a text to write, a structure, a notation…), but attached to the
 * block, so they follow it when it moves and appear nowhere else. `spec`: what `addZoneCell` takes (kind, text, height, columns…). The cell is anchored to the first measure of the block
 * (what keeps it valid); where it is drawn comes from the block. The row is a free one of its own (zones of the part between systems keep theirs). Returns the container.
 */
export function addBlockZone(doc, part, blockId, position, spec = {}) {
  const block = extractBlocks(part).find((b) => b.id === blockId);
  if (!block) throw new EditError('Unknown block');
  if (position !== 'above' && position !== 'below') throw new EditError('A zone goes above or under the block');
  const mv = doc.work.movements.find((m) => m.id === block.movementId);
  const range = mv ? blockRange(mv, block) : null;
  if (!range) throw new EditError('The block has no measures');
  const measureId = mv.masterbars[range.from].id;
  const used = new Set((part.containers ?? []).filter((c) => getProperty(c, PID.MEASURE_ID) === measureId).map((c) => getProperty(c, PID.CONTAINER_ZONE_ROW)));
  const base = position === 'above' ? ZONE_BEFORE_BASE : 0;
  let row = base;
  while (used.has(row) && row < base + ZONE_MAX_ROWS) row += 1;
  if (row >= base + ZONE_MAX_ROWS) throw new EditError(`At most ${ZONE_MAX_ROWS} zones ${position} a block`);
  return addZoneCell(doc, part.id, measureId, { kind: 'text', text: '', height: 6, ...spec, row, column: 0, blockId });
}

export function moveExtractBlock(doc, part, blockId, to) {
  const list = [...extractBlocks(part)];
  const from = list.findIndex((b) => b.id === blockId);
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= list.length) throw new EditError('Invalid position');
  const [b] = list.splice(from, 1);
  list.splice(to, 0, b);
  write(doc, part, list);
}

/**
 * Adds a CONTAINER OF A STAFF that belongs to a block (a text or a notation above the first measures of one of the block's staves, like those of screen 2 but shown only in this
 * block, so two blocks on the same measures can carry different ones). It is anchored to the first measure of the block and hung on its first staff (`spec.staffId` to choose another);
 * `spec`: what `addPartContainer` takes (kind 'text' | 'nestedNotation', span, text…). Returns the container.
 */
export function addBlockContainer(doc, part, blockId, spec = {}) {
  const block = extractBlocks(part).find((b) => b.id === blockId);
  if (!block) throw new EditError('Unknown block');
  const mv = doc.work.movements.find((m) => m.id === block.movementId);
  const range = mv ? blockRange(mv, block) : null;
  if (!range) throw new EditError('The block has no measures');
  const shown = new Set(partStaffIds(doc.work, part));
  const wanted = block.staffIds ? new Set(block.staffIds) : null;
  const staff = spec.staffId ?? mv.tracks.flatMap((t) => t.staves).find((st) => shown.has(st.id) && (!wanted || wanted.has(st.id)))?.id;
  if (!staff) throw new EditError('The block shows no staff');
  const span = Math.max(1, Math.min(spec.span ?? 2, range.to - range.from + 1));
  const c = addPartContainer(doc, part.id, staff, mv.masterbars[range.from].id, { placement: 'above', ...spec, span });
  doc.set(c, PID.CONTAINER_BLOCK_ID, blockId);
  return c;
}
