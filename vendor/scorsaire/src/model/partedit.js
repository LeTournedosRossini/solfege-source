/*
 * Editing of the parts of a work (screen 2). CALL INSIDE `doc.transaction`.
 * A part = a print layout: its name, the staves it shows, and its style layer (page format, margins, staff size…).
 * The work always keeps at least one part (the default "score" part, `pt0`).
 */
import { PID } from './pid.js';
import { SID, SID_TABLE } from './sid.js';
import { createPart } from './elements.js';
import { newId } from './ids.js';
import { getProperty } from './props.js';
import { PAGE_FORMATS } from './page.js';
import { normalizeRole } from './partroles.js';
import { mergeReaderSettings, readerSettingsOf } from './partreader.js';
import { setZoneCellText } from './partzones.js';
import { cloneWithFreshIds } from './partcontainers.js';
import { partStaffTextsOf, updatePartStaffText } from './partstafftext.js';
import { hydrate } from './serialize.js';
import { headerFooterOf, titleBlockOf, DEFAULT_HEADER, DEFAULT_FOOTER, TEXT_FAMILIES, TEXT_ALIGNS, TEXT_KEY } from './pagetext.js';

export class PartEditError extends Error {
  constructor(message, code) { super(message); this.name = 'PartEditError'; this.code = code; }
}

const partOf = (doc, id) => {
  const p = doc.find(id);
  if (!p || p.type !== 'part') throw new PartEditError(`Unknown part: ${id}`, 'unknown');
  return p;
};

/** Staves of the work in reading order: [{ id, trackName, movementIndex, trackId }] (names resolved by the caller for display). */
export function partStaffChoices(work) {
  const out = [];
  work.movements.forEach((mv, movementIndex) => mv.tracks.forEach((t) => t.staves.forEach((s, i) => out.push({ id: s.id, trackId: t.id, trackName: t.props[PID.NAME] ?? '', indexInTrack: i, movementIndex }))));
  return out;
}

/** Staff ids a part shows (null list = all of them). */
export function partStaffIds(work, part) {
  const all = partStaffChoices(work).map((c) => c.id);
  const own = part.props[PID.PART_STAVES];
  return own ? all.filter((id) => own.includes(id)) : all;
}

/**
 * The tracks of a movement as ONE part shows them: in the part's own order (`PID.PART_TRACK_ORDER`, the whole list; a track it does not list goes last, in the
 * order of the document). Pure: returns ids.
 */
export function partTrackIds(part, mv) {
  const own = part.props[PID.PART_TRACK_ORDER];
  const ids = mv.tracks.map((t) => t.id);
  if (!own?.length) return ids;
  const rank = (id) => { const i = own.indexOf(id); return i < 0 ? own.length + ids.indexOf(id) : i; };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** Moves a track of a part to position `index` among the tracks of its movement, for this part only (null = back to the order of the document). */
export function setPartTrackOrder(doc, partId, trackId, index) {
  const part = partOf(doc, partId);
  if (trackId === null) { if (part.props[PID.PART_TRACK_ORDER] != null) doc.reset(part, PID.PART_TRACK_ORDER); return; }
  const mv = doc.work.movements.find((m) => m.tracks.some((t) => t.id === trackId));
  if (!mv) throw new PartEditError(`Unknown track: ${trackId}`, 'unknown');
  const mine = partTrackIds(part, mv).filter((id) => id !== trackId);
  mine.splice(Math.max(0, Math.min(mine.length, index)), 0, trackId);
  // the whole list: the other movements keep their order, this one gets the new one
  const next = [...doc.work.movements.flatMap((m) => (m === mv ? mine : partTrackIds(part, m)))];
  const same = next.every((id, i) => id === doc.work.movements.flatMap((m) => m.tracks.map((t) => t.id))[i]);
  if (same) { if (part.props[PID.PART_TRACK_ORDER] != null) doc.reset(part, PID.PART_TRACK_ORDER); return; }
  doc.set(part, PID.PART_TRACK_ORDER, next);
}

/** Display transposition of a track in ONE part: `interval` = { diatonic, chromatic }, or null = the track's own. */
export function setPartTransposition(doc, partId, trackId, interval) {
  const part = partOf(doc, partId);
  if (!doc.work.movements.some((m) => m.tracks.some((t) => t.id === trackId))) throw new PartEditError(`Unknown track: ${trackId}`, 'unknown');
  if (interval && !(Number.isInteger(interval.diatonic) && Number.isInteger(interval.chromatic))) throw new PartEditError('A transposition is two whole numbers', 'range');
  const next = { ...(part.props[PID.PART_TRANSPOSITIONS] ?? {}) };
  if (interval) next[trackId] = { diatonic: interval.diatonic, chromatic: interval.chromatic }; else delete next[trackId];
  if (Object.keys(next).length) doc.set(part, PID.PART_TRANSPOSITIONS, next); else if (part.props[PID.PART_TRANSPOSITIONS] != null) doc.reset(part, PID.PART_TRANSPOSITIONS);
}

/** Display transposition of the WHOLE part, in semitones (−24 to 24; positive = everything is written higher; 0 = none): added to what each track has. */
export function setPartTransposeAll(doc, partId, semitones) {
  const part = partOf(doc, partId);
  if (!Number.isInteger(semitones) || Math.abs(semitones) > 24) throw new PartEditError('A transposition is a whole number of semitones, 24 at most', 'range');
  if (semitones === 0) { if (part.props[PID.PART_TRANSPOSE_ALL] != null) doc.reset(part, PID.PART_TRANSPOSE_ALL); } else doc.set(part, PID.PART_TRANSPOSE_ALL, semitones);
}

/** How a part reads the chord symbols (model/chordview.js): 'author' (the display tags of the score; default), 'original' (as written) or 'capo' (as played with the capo in force). The sound never changes. */
export function setPartChordView(doc, partId, mode) {
  const part = partOf(doc, partId);
  if (!['author', 'original', 'capo'].includes(mode)) throw new PartEditError('Chords are read as the author tagged them, as written or as capo shapes', 'range');
  if (mode === 'author') { if (part.props[PID.PART_CHORD_VIEW] != null) doc.reset(part, PID.PART_CHORD_VIEW); } else doc.set(part, PID.PART_CHORD_VIEW, mode);
}

/** Adds a part (at the end); `copyFrom`: id of a part whose page style is copied. Returns the new part. */
export function addPart(doc, { name = '', staffIds = null, copyFrom = null, canvasId = null } = {}) {
  const style = copyFrom ? { ...partOf(doc, copyFrom).style } : undefined;
  const part = createPart({ name, staffIds, style });
  doc.add(doc.work, 'parts', part);
  if (canvasId) { // a layout for a tablet: it belongs to the canvas and takes its shape
    const canvas = canvasOf(doc.work, canvasId);
    if (!canvas) throw new PartEditError(`Unknown canvas: ${canvasId}`, 'unknown');
    doc.set(part, PID.PART_CANVAS, canvasId);
    applyCanvasShape(doc, part, canvas);
    doc.setStyle(part, SID.SHOW_INSTRUMENT_NAMES, false);
    doc.setStyle(part, SID.PAGE_SCORE_ONLY, true); // a tablet shows the music alone: no title block, header or footer
    }
  return part;
}

/**
 * Duplicates a part right after the original: its page style, texts, layout, breaks and fixed systems, zones and containers, per-track display and every other setting, with fresh
 * identifiers for everything that has one (what it refers to in the work — staves, measures — stays the same). `name`: the name of the copy (the interface decides it). Returns the copy.
 */
export function duplicatePart(doc, id, { name = '' } = {}) {
  const part = partOf(doc, id);
  const at = doc.work.parts.findIndex((p) => p.id === id);
  const copy = hydrate(cloneWithFreshIds(JSON.parse(JSON.stringify(part))));
  const text = String(name ?? '').trim();
  doc.add(doc.work, 'parts', copy, at + 1);
  if (text) doc.set(copy, PID.NAME, text);
  return copy;
}

/** A work keeps at least one PAPER part, and a canvas keeps at least one part of its own (a canvas with nothing to show is removed with `removeCanvas`). */
export function removePart(doc, id) {
  const part = partOf(doc, id);
  const canvas = getProperty(part, PID.PART_CANVAS) ?? null;
  const sameKind = doc.work.parts.filter((p) => (getProperty(p, PID.PART_CANVAS) ?? null) === canvas);
  if (sameKind.length <= 1) throw new PartEditError(canvas ? 'A canvas keeps at least one layout' : 'A work keeps at least one part', 'lastPart');
  doc.remove(part);
}

// ---------- canvases: the DESTINATIONS of a work (a tablet), commun to all its movements; each holds layouts (parts) of its own ----------

/** The canvases of a work, in order. */
export const canvasesOf = (work) => getProperty(work, PID.CANVASES) ?? [];
const canvasOf = (work, id) => canvasesOf(work).find((c) => c.id === id) ?? null;
export const partsOfCanvas = (work, canvasId) => work.parts.filter((p) => getProperty(p, PID.PART_CANVAS) === canvasId);
/** The parts of the PAPER layouts (screen 2 as it has always been): those that belong to no canvas. */
export const paperParts = (work) => work.parts.filter((p) => !getProperty(p, PID.PART_CANVAS));

/** Is this a usable canvas shape? A known tablet format (or any paper format) or `custom` with a size in millimetres. */
function checkShape({ format, widthMm, heightMm }) {
  if (format === 'custom') {
    if (!(widthMm >= 30 && widthMm <= 1000 && heightMm >= 30 && heightMm <= 1000)) throw new PartEditError('A custom canvas has a width and a height between 30 and 1000 mm', 'range');
  } else if (!PAGE_FORMATS[format]) throw new PartEditError(`Unknown page format: ${format}`, 'format');
}

/** Gives a part the shape of its canvas (format, orientation, custom size). */
function applyCanvasShape(doc, part, canvas) {
  doc.setStyle(part, SID.PAGE_FORMAT, canvas.format);
  doc.setStyle(part, SID.PAGE_LANDSCAPE, canvas.landscape !== false);
  if (canvas.format === 'custom') { doc.setStyle(part, SID.PAGE_WIDTH_MM, canvas.widthMm); doc.setStyle(part, SID.PAGE_HEIGHT_MM, canvas.heightMm); }
}

/** A tablet shows the music from edge to edge: small margins in the first layout of a canvas (the person changes them afterwards, per layout). */
const TABLET_MARGIN_MM = 4;

/** Adds a canvas (a destination: `format` of PAGE_FORMATS or `custom` + `widthMm` / `heightMm`, `landscape` default FALSE: a score is nearly always read in portrait; `role` = the role of the first layout) with a first layout showing everything. Returns the canvas. */
export function addCanvas(doc, { name = '', format = 'tablet-4-3', landscape = false, widthMm = null, heightMm = null, role = null } = {}) {
  checkShape({ format, widthMm, heightMm });
  const clean = String(name ?? '').trim().slice(0, 40);
  const canvas = { id: newId('cv'), name: clean, format, landscape: landscape === true, ...(format === 'custom' ? { widthMm, heightMm } : {}) };
  doc.set(doc.work, PID.CANVASES, [...canvasesOf(doc.work), canvas]);
  const part = createPart({ name: clean });
  doc.add(doc.work, 'parts', part);
  doc.set(part, PID.PART_CANVAS, canvas.id);
  setPartRole(doc, part.id, role);
  applyCanvasShape(doc, part, canvas);
  doc.setStyle(part, SID.PAGE_SCORE_ONLY, true); // the music alone on a tablet: no title block, header or footer (a person can turn it off)
  doc.setStyle(part, SID.SHOW_INSTRUMENT_NAMES, false); // a tablet is read at a glance: the names of the tracks stay out of the way (the small grey line at the bottom of the screen says what is shown)
  for (const sid of [SID.PAGE_MARGIN_LEFT, SID.PAGE_MARGIN_RIGHT, SID.PAGE_MARGIN_TOP, SID.PAGE_MARGIN_BOTTOM]) doc.setStyle(part, sid, TABLET_MARGIN_MM);
  return canvas;
}

/** Renames or reshapes a canvas; its layouts follow the new shape at once. */
export function setCanvas(doc, canvasId, patch) {
  const canvas = canvasOf(doc.work, canvasId);
  if (!canvas) throw new PartEditError(`Unknown canvas: ${canvasId}`, 'unknown');
  const next = { ...canvas };
  if ('name' in patch) next.name = String(patch.name ?? '').trim().slice(0, 40);
  if ('format' in patch) next.format = patch.format;
  if ('landscape' in patch) next.landscape = patch.landscape !== false;
  if ('widthMm' in patch) next.widthMm = patch.widthMm;
  if ('heightMm' in patch) next.heightMm = patch.heightMm;
  if (next.format !== 'custom') { delete next.widthMm; delete next.heightMm; }
  checkShape(next);
  doc.set(doc.work, PID.CANVASES, canvasesOf(doc.work).map((c) => (c.id === canvasId ? next : c)));
  for (const part of partsOfCanvas(doc.work, canvasId)) applyCanvasShape(doc, part, next);
  return next;
}

/** Removes a canvas and the layouts of it. */
export function removeCanvas(doc, canvasId) {
  if (!canvasOf(doc.work, canvasId)) throw new PartEditError(`Unknown canvas: ${canvasId}`, 'unknown');
  for (const part of partsOfCanvas(doc.work, canvasId)) doc.remove(part);
  const rest = canvasesOf(doc.work).filter((c) => c.id !== canvasId);
  if (rest.length) doc.set(doc.work, PID.CANVASES, rest); else doc.reset(doc.work, PID.CANVASES);
}

/** Moves a part to position `index` of the list of parts (tab order). */
export function movePart(doc, id, index) {
  const part = partOf(doc, id);
  const parts = doc.work.parts;
  const from = parts.indexOf(part);
  const to = Math.max(0, Math.min(parts.length - 1, index));
  if (to === from) return false;
  doc.remove(part);
  doc.add(doc.work, 'parts', part, to);
  return true;
}

export function renamePart(doc, id, name) {
  const part = partOf(doc, id);
  const clean = String(name ?? '').trim().slice(0, 60);
  if (clean) doc.set(part, PID.NAME, clean); else doc.reset(part, PID.NAME);
}

/** Sets (or, with an empty value, clears) the role of a layout (model/partroles.js). */
export function setPartRole(doc, id, role) {
  const part = partOf(doc, id);
  const code = normalizeRole(role);
  if (code) doc.set(part, PID.PART_ROLE, code); else if (part.props[PID.PART_ROLE] != null) doc.reset(part, PID.PART_ROLE);
}

/** Changes the reader settings of a layout (model/partreader.js): `null` for a key removes it; nothing left removes the whole property. */
export function setPartReader(doc, id, patch) {
  const part = partOf(doc, id);
  let next;
  try { next = mergeReaderSettings(readerSettingsOf(part), patch); } catch (e) { throw new PartEditError(e.message, 'reader'); }
  if (Object.keys(next).length) doc.set(part, PID.PART_READER, next); else if (part.props[PID.PART_READER] != null) doc.reset(part, PID.PART_READER);
}

/** `staffIds` null = every staff. A part never shows nothing: an empty list is refused. */
export function setPartStaves(doc, id, staffIds) {
  const part = partOf(doc, id);
  if (staffIds == null) { doc.reset(part, PID.PART_STAVES); return; }
  const valid = new Set(partStaffChoices(doc.work).map((c) => c.id));
  const list = [...new Set(staffIds)].filter((s) => valid.has(s));
  if (!list.length) throw new PartEditError('A part shows at least one staff', 'noStaff');
  doc.set(part, PID.PART_STAVES, list);
}

const PAGE_SIDS = [SID.PAGE_FORMAT, SID.PAGE_LANDSCAPE, SID.PAGE_WIDTH_MM, SID.PAGE_HEIGHT_MM, SID.PAGE_MARGIN_LEFT, SID.PAGE_MARGIN_RIGHT, SID.PAGE_MARGIN_TOP, SID.PAGE_MARGIN_BOTTOM, SID.PAGE_STAFF_SPACE_MM,
  SID.PAGE_UPPER_BORDER, SID.PAGE_LOWER_BORDER, SID.PAGE_VERTICAL_SPREAD, SID.PAGE_MAX_FILL_SPREAD, SID.LAST_SYSTEM_JUSTIFY, SID.LAST_SYSTEM_FILL_LIMIT,
  SID.PAGE_SCORE_ONLY, SID.TITLE_SIZE, SID.SUBTITLE_SIZE, SID.CREDITS_SIZE, SID.HEADER_SIZE, SID.FOOTER_SIZE, SID.TITLE_FRAME_DISTANCE, SID.PAGE_HEADER_MARGIN, SID.PAGE_FOOTER_MARGIN, SID.PAGE_NUMBER_OFFSET, SID.REGULAR_MEASURES, SID.MEASURES_PER_SYSTEM, SID.MEASURE_GRID, SID.MEASURE_GRID_BASE, SID.MEASURE_GRID_CHORDS, SID.MEASURE_GRID_STRETCH,
  SID.SHOW_MEASURE_NUMBERS, SID.MEASURE_NUMBER_MODE, SID.MEASURE_NUMBER_INTERVAL, SID.MEASURE_NUMBER_SHOW_ONE, SID.MEASURE_NUMBER_SIZE, SID.MEASURE_NUMBERS_CONTINUE, SID.PART_SIGNS_ON, SID.PART_SECTION_CARDS, SID.PART_SECTION_BANDS, SID.SHOW_INSTRUMENT_NAMES, SID.INSTRUMENT_NAME_FIRST, SID.INSTRUMENT_NAME_NEXT, SID.HIDE_INSTRUMENT_NAME_IF_ONE, SID.SYSTEM_TOP_MARGIN, SID.SYSTEM_BOTTOM_MARGIN, SID.SYSTEM_EDGE_DISTANCE, SID.SECTION_CARD_SCALE, SID.SECTION_CARD_GAP, SID.SECTION_CARD_PLACE, SID.SECTION_CARD_STYLE, SID.SHOW_TEMPO_TEXTS];

/** Sets (value) or clears (null = back to the default) page styles of a part: `patch` = { [SID.PAGE_…]: value | null }. */
export function setPartPage(doc, id, patch) {
  const part = partOf(doc, id);
  for (const [sid, value] of Object.entries(patch)) {
    if (!PAGE_SIDS.includes(sid)) throw new PartEditError(`Not a page style: ${sid}`, 'style');
    if (value === null) { doc.resetStyle(part, sid); continue; }
    if (sid === SID.PAGE_FORMAT && value !== 'custom' && !PAGE_FORMATS[value]) throw new PartEditError(`Unknown page format: ${value}`, 'format');
    const def = SID_TABLE[sid];
    if (sid === SID.TITLE_FRAME_DISTANCE) { if (!(value >= -8 && value <= 50)) throw new PartEditError('The distance under the title is between -8 and 50 spaces', 'range'); } // (negative: the first system is pulled up under the title)
    else if (def.type === 'real' && !(value >= 0 && value <= 1000)) throw new PartEditError(`Value out of range for ${sid}: ${value}`, 'range');
    if (sid === SID.MEASURE_NUMBER_MODE && !['system', 'interval', 'every'].includes(value)) throw new PartEditError(`Unknown numbering mode: ${value}`, 'mode');
    if (sid === SID.MEASURES_PER_SYSTEM && !(Number.isInteger(value) && value >= 0 && value <= 32)) throw new PartEditError('Measures per system: 0 (automatic) to 32', 'range');
    if ((sid === SID.INSTRUMENT_NAME_FIRST || sid === SID.INSTRUMENT_NAME_NEXT) && !['long', 'short', 'icon', 'none'].includes(value)) throw new PartEditError(`Unknown name style: ${value}`, 'mode');
    if (sid === SID.MEASURE_GRID && !['off', 'columns'].includes(value)) throw new PartEditError(`Unknown measure grid: ${value}`, 'mode');
    if (sid === SID.MEASURE_GRID_BASE && !['common', 'widest', 'chords'].includes(value)) throw new PartEditError(`Unknown grid column base: ${value}`, 'mode');
    if (sid === SID.MEASURE_GRID_STRETCH && !['off', '2', '3', 'any'].includes(value)) throw new PartEditError(`Unknown grid stretch: ${value}`, 'mode');
    if (sid === SID.MEASURE_GRID_CHORDS && !(Number.isInteger(value) && value >= 2 && value <= 4)) throw new PartEditError('The grid chords are 2 to 4', 'range');
    if (sid === SID.MEASURE_NUMBER_INTERVAL && !(Number.isInteger(value) && value >= 1 && value <= 99)) throw new PartEditError('The interval is between 1 and 99', 'range');
    if (sid === SID.LAST_SYSTEM_FILL_LIMIT && !(value >= 0 && value <= 1)) throw new PartEditError('The fill limit is between 0 and 100 %', 'range');
    if (sid === SID.PAGE_STAFF_SPACE_MM && !(value >= 0.8 && value <= 5)) throw new PartEditError('The staff space is between 0.8 and 5 mm', 'range');
    doc.setStyle(part, sid, value);
  }
}

/** Copies the page settings of a part to every other part (`which`: SID list, default = the four margins). */
export function applyPageToAllParts(doc, fromId, which = [SID.PAGE_MARGIN_LEFT, SID.PAGE_MARGIN_RIGHT, SID.PAGE_MARGIN_TOP, SID.PAGE_MARGIN_BOTTOM]) {
  const from = partOf(doc, fromId);
  for (const part of doc.work.parts) {
    if (part.id === from.id) continue;
    for (const sid of which) {
      if (Object.hasOwn(from.style, sid)) doc.setStyle(part, sid, from.style[sid]); else doc.resetStyle(part, sid);
    }
  }
}

// ---------- forced breaks and fixed systems (MuseScore LayoutBreak, SystemLock) ----------

export const partBreaks = (part) => part.props[PID.PART_BREAKS] ?? [];
export const partLocks = (part) => part.props[PID.PART_LOCKS] ?? [];
const writeList = (doc, part, pid, list) => { if (list.length) doc.set(part, pid, list); else doc.reset(part, pid); };

/** Position of a measure (masterbar id): { mv, index } or null. */
function measurePos(doc, id) {
  const bar = doc.find(id);
  if (!bar || bar.type !== 'masterbar') return null;
  const mv = doc.movementOf(bar);
  return mv ? { mv, index: mv.masterbars.findIndex((b) => b.id === id) } : null;
}
/** A lock as indices: { lock, mv, from, to }. */
function lockSpan(doc, lock) {
  const a = measurePos(doc, lock.from); const b = measurePos(doc, lock.to);
  return a && b && a.mv === b.mv ? { lock, mv: a.mv, from: a.index, to: b.index } : null;
}

/** The fixed system that contains a measure, or undefined. */
export function lockContaining(doc, part, measureId) {
  const pos = measurePos(doc, measureId);
  if (!pos) return undefined;
  return partLocks(part).find((l) => { const sp = lockSpan(doc, l); return sp && sp.mv === pos.mv && pos.index >= sp.from && pos.index <= sp.to; });
}

/**
 * Break after a measure: toggles a `kind` ('system' | 'page') break; the other kind is replaced. Like MuseScore
 * (`removeSystemLocksOnAddLayoutBreak`), a system break inside a fixed system, or a page break anywhere but at its end, removes that fixed system.
 */
export function toggleBreak(doc, partId, measureId, kind) {
  const part = partOf(doc, partId);
  if (kind !== 'system' && kind !== 'page') throw new PartEditError(`Unknown break kind: ${kind}`, 'kind');
  if (!measurePos(doc, measureId)) throw new PartEditError(`Unknown measure: ${measureId}`, 'measure');
  const existing = partBreaks(part).find((b) => b.measureId === measureId);
  const next = partBreaks(part).filter((b) => b.measureId !== measureId);
  const adding = existing?.breakKind !== kind;
  if (adding) {
    next.push({ id: newId('pb'), measureId, breakKind: kind });
    const lock = lockContaining(doc, part, measureId);
    if (lock && (kind === 'system' || lock.to !== measureId)) writeList(doc, part, PID.PART_LOCKS, partLocks(part).filter((l) => l.id !== lock.id));
  }
  writeList(doc, part, PID.PART_BREAKS, next);
  return adding;
}

/**
 * Makes the measures `fromId` … `toId` (same movement) ONE fixed system (MuseScore `makeIntoSystem`): fixed systems that overlap are cut around it,
 * those inside it disappear, system breaks inside it are removed (a page break stays only at its end).
 */
export function lockSystem(doc, partId, fromId, toId) {
  const part = partOf(doc, partId);
  const a = measurePos(doc, fromId); const b = measurePos(doc, toId);
  if (!a || !b || a.mv !== b.mv) throw new PartEditError('A fixed system lives in one movement', 'range');
  const [lo, hi] = a.index <= b.index ? [a, b] : [b, a];
  const mv = lo.mv;
  const ids = mv.masterbars.map((m) => m.id);
  const kept = [];
  for (const l of partLocks(part)) {
    const sp = lockSpan(doc, l);
    if (!sp || sp.mv !== mv) { kept.push(l); continue; }
    if (sp.to < lo.index || sp.from > hi.index) { kept.push(l); continue; } // no overlap
    if (sp.from < lo.index) kept.push({ id: newId('pl'), from: ids[sp.from], to: ids[lo.index - 1] });
    if (sp.to > hi.index) kept.push({ id: newId('pl'), from: ids[hi.index + 1], to: ids[sp.to] });
  }
  kept.push({ id: newId('pl'), from: ids[lo.index], to: ids[hi.index] });
  const inside = new Set(ids.slice(lo.index, hi.index + 1));
  const breaks = partBreaks(part).filter((br) => !(inside.has(br.measureId) && (br.breakKind === 'system' || br.measureId !== ids[hi.index])));
  writeList(doc, part, PID.PART_BREAKS, breaks);
  writeList(doc, part, PID.PART_LOCKS, kept);
}

export function unlockSystem(doc, partId, lockId) {
  const part = partOf(doc, partId);
  if (!partLocks(part).some((l) => l.id === lockId)) throw new PartEditError(`Unknown fixed system: ${lockId}`, 'unknown');
  writeList(doc, part, PID.PART_LOCKS, partLocks(part).filter((l) => l.id !== lockId));
}

/** Grows (+1) or shrinks (−1) a fixed system by one measure at its `edge` ('from' | 'to'). Shrinking the last measure away removes it. */
export function extendLock(doc, partId, lockId, edge, delta) {
  const part = partOf(doc, partId);
  const lock = partLocks(part).find((l) => l.id === lockId);
  if (!lock) throw new PartEditError(`Unknown fixed system: ${lockId}`, 'unknown');
  const sp = lockSpan(doc, lock);
  if (!sp) throw new PartEditError('Broken fixed system', 'range');
  let { from, to } = sp;
  if (edge === 'from') from -= delta; else to += delta;
  if (from > to) { unlockSystem(doc, partId, lockId); return; }
  if (from < 0 || to >= sp.mv.masterbars.length) throw new PartEditError('No measure there', 'range');
  lockSystem(doc, partId, sp.mv.masterbars[from].id, sp.mv.masterbars[to].id);
}

/**
 * "N measures per system" (MuseScore: add / remove system breaks): in every movement, the system breaks and fixed systems are replaced by a
 * system break after every N-th measure; page breaks stay. N = 0 only removes them. Returns the number of breaks written.
 */
export function setBreaksEvery(doc, partId, n) {
  const part = partOf(doc, partId);
  if (!Number.isInteger(n) || n < 0 || n > 64) throw new PartEditError('Measures per system: 0 to 64', 'range');
  const ids = new Set(doc.work.movements.flatMap((mv) => mv.masterbars.map((b) => b.id)));
  const next = partBreaks(part).filter((b) => !ids.has(b.measureId) || b.breakKind === 'page');
  let added = 0;
  if (n > 0) {
    for (const mv of doc.work.movements) {
      mv.masterbars.forEach((bar, i) => {
        if ((i + 1) % n !== 0 || i === mv.masterbars.length - 1) return;
        if (next.some((b) => b.measureId === bar.id)) return;
        next.push({ id: newId('pb'), measureId: bar.id, breakKind: 'system' }); added += 1;
      });
    }
  }
  writeList(doc, part, PID.PART_BREAKS, next);
  writeList(doc, part, PID.PART_LOCKS, partLocks(part).filter((l) => !ids.has(l.from)));
  return added;
}

/**
 * Called by `deleteMeasures`: breaks on removed measures disappear; a fixed system with a bound in the removed range is cut like MuseScore
 * (`removeSystemLocksOnRemoveMeasures`): the part that survives becomes the new fixed system.
 */
export function purgePartLayout(doc, mv, from, to) {
  const ids = mv.masterbars.map((b) => b.id);
  const doomed = new Set(ids.slice(from, to + 1));
  for (const part of doc.work.parts) {
    const breaks = partBreaks(part);
    if (breaks.some((b) => doomed.has(b.measureId))) writeList(doc, part, PID.PART_BREAKS, breaks.filter((b) => !doomed.has(b.measureId)));
    for (const c of [...(part.containers ?? [])]) {
      if (getProperty(c, PID.CONTAINER_PLACEMENT) !== 'zone') continue; // the containers hung on a staff follow the measures like those of screen 1 (measureedit.js)
      const k = getProperty(c, PID.CONTAINER_KIND);
      if (doomed.has(getProperty(c, PID.MEASURE_ID)) || (k === 'syncRange' && (doomed.has(getProperty(c, PID.RANGE_FROM)) || doomed.has(getProperty(c, PID.RANGE_TO))))) doc.remove(c); // a zone under a deleted measure goes with it; a view of a deleted range too
    }
    const gaps = part.props[PID.PART_STAFF_GAPS];
    if (gaps) { // the room above a staff in a system is tied to a measure of that system
      const keep = Object.fromEntries(Object.entries(gaps).filter(([k]) => !doomed.has(k.split('@')[1])));
      if (Object.keys(keep).length !== Object.keys(gaps).length) { if (Object.keys(keep).length) doc.set(part, PID.PART_STAFF_GAPS, keep); else doc.reset(part, PID.PART_STAFF_GAPS); }
    }
    const numbers = part.props[PID.PART_MEASURE_NUMBERS] ?? [];
    if (numbers.some((o) => doomed.has(o.measureId))) writeList(doc, part, PID.PART_MEASURE_NUMBERS, numbers.filter((o) => !doomed.has(o.measureId)));
    const locks = partLocks(part);
    if (!locks.length) continue;
    const next = [];
    for (const l of locks) {
      const lf = ids.indexOf(l.from); const lt = ids.indexOf(l.to);
      if (lf < 0 || lt < 0) { next.push(l); continue; } // another movement
      const sIn = lf >= from && lf <= to; const eIn = lt >= from && lt <= to;
      if (!sIn && !eIn) { next.push(l); continue; }
      if (sIn && !eIn && ids[to + 1]) next.push({ id: newId('pl'), from: ids[to + 1], to: l.to });
      else if (!sIn && eIn && from > 0) next.push({ id: newId('pl'), from: l.from, to: ids[from - 1] });
    }
    writeList(doc, part, PID.PART_LOCKS, next);
  }
}

// ---------- header, footer, title block, measure numbers, work metadata ----------

const AREA_KEYS = ['l', 'c', 'r'];
const cleanTemplate = (t) => (t === null ? null : Object.fromEntries(AREA_KEYS.map((k) => [k, String(t?.[k] ?? '').slice(0, 200)])));

/**
 * Header or footer of a part (`kind` 'header' | 'footer'): `patch` = { enabled?, twoSided?, first?: {l,c,r} | null, odd?, even? }, merged into what is there
 * (the defaults of model/pagetext.js fill the rest). A result equal to the default is not stored.
 */
export function setHeaderFooter(doc, partId, kind, patch) {
  const part = partOf(doc, partId);
  const pid = kind === 'header' ? PID.PART_HEADER : PID.PART_FOOTER;
  if (kind !== 'header' && kind !== 'footer') throw new PartEditError(`Unknown kind: ${kind}`, 'kind');
  const base = headerFooterOf(part, kind);
  const next = { ...base };
  for (const k of ['enabled', 'twoSided']) if (patch[k] !== undefined) next[k] = Boolean(patch[k]);
  for (const k of ['first', 'odd', 'even']) if (patch[k] !== undefined) next[k] = k === 'first' ? cleanTemplate(patch[k]) : cleanTemplate(patch[k] ?? base[k]);
  const dflt = kind === 'header' ? DEFAULT_HEADER() : DEFAULT_FOOTER();
  if (JSON.stringify(next) === JSON.stringify(dflt)) { if (part.props[pid] != null) doc.reset(part, pid); return; }
  doc.set(part, pid, next);
}

/** Title block of a part: `patch` = { show?, fields?: { subtitle, composer, arranger, lyricist, album }, lines?: [{ id?, text, align, bold, italic }] }. */
export function setTitleBlock(doc, partId, patch) {
  const part = partOf(doc, partId);
  const cur = titleBlockOf(part);
  const next = { show: patch.show !== undefined ? Boolean(patch.show) : cur.show, fields: { ...cur.fields, ...(patch.fields ?? {}) }, lines: patch.lines ?? cur.lines };
  next.lines = next.lines.slice(0, 12).map((l) => ({ id: l.id ?? newId('tl'), text: String(l.text ?? '').slice(0, 200), align: ['left', 'center', 'right'].includes(l.align) ? l.align : 'center', bold: Boolean(l.bold), italic: Boolean(l.italic) }));
  const isDefault = next.show && Object.values(next.fields).every(Boolean) && !next.lines.length;
  if (isDefault) { if (part.props[PID.PART_TITLE] != null) doc.reset(part, PID.PART_TITLE); return; }
  doc.set(part, PID.PART_TITLE, next);
}

/** Number of a measure in this part: 'show' | 'hide' | null (automatic). */
export function setMeasureNumberMode(doc, partId, measureId, mode) {
  const part = partOf(doc, partId);
  if (!measurePos(doc, measureId)) throw new PartEditError(`Unknown measure: ${measureId}`, 'measure');
  if (mode !== null && mode !== 'show' && mode !== 'hide') throw new PartEditError(`Unknown mode: ${mode}`, 'mode');
  const next = (part.props[PID.PART_MEASURE_NUMBERS] ?? []).filter((o) => o.measureId !== measureId);
  if (mode) next.push({ measureId, mode });
  writeList(doc, part, PID.PART_MEASURE_NUMBERS, next);
}

/**
 * Counting of a measure (the document, shared by every part): `exclude` true = not counted and not numbered, false = counted even when it is a pickup,
 * null = automatic; `offset` = number added from this measure on (integer, 0 removes it).
 */
export function setMeasureCounting(doc, measureId, { exclude, offset } = {}) {
  const bar = doc.find(measureId);
  if (!bar || bar.type !== 'masterbar') throw new PartEditError(`Unknown measure: ${measureId}`, 'measure');
  if (exclude === null) doc.reset(bar, PID.MEASURE_NUMBER_EXCLUDE); else if (exclude !== undefined) doc.set(bar, PID.MEASURE_NUMBER_EXCLUDE, Boolean(exclude));
  if (offset !== undefined) {
    if (!Number.isInteger(offset) || Math.abs(offset) > 9999) throw new PartEditError('The offset is a whole number', 'range');
    if (offset === 0) doc.reset(bar, PID.MEASURE_NUMBER_OFFSET); else doc.set(bar, PID.MEASURE_NUMBER_OFFSET, offset);
  }
}

const META_PIDS = { title: PID.TITLE, subtitle: PID.SUBTITLE, composer: PID.COMPOSER, arranger: PID.ARRANGER, lyricist: PID.LYRICIST, album: PID.ALBUM, copyright: PID.COPYRIGHT, date: PID.DATE };
/** Metadata of the work that the title block and the tokens show: `patch` = { title, subtitle, composer, arranger, lyricist, album, copyright, date } (empty text clears a field). */
export function setWorkMeta(doc, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const pid = META_PIDS[key];
    if (!pid) throw new PartEditError(`Unknown metadata field: ${key}`, 'field');
    const text = String(value ?? '').slice(0, 300);
    if (key === 'title') doc.set(doc.work, pid, text);
    else if (text) doc.set(doc.work, pid, text); else if (doc.work.props[pid] != null) doc.reset(doc.work, pid);
  }
}

// ---------- overrides of single elements in a part (colour, position, visibility) ----------

/** Music (notes, chords, rests) and staves: moved by hand only on request (`options.music`): the lock of the screen 2 bar. */
export const MUSIC_TYPES = new Set(['chord', 'note', 'rhythmnote', 'tabnote', 'percnote', 'accnote', 'rest', 'chordsymbol', 'staff']);
const NOT_MOVABLE_TYPES = new Set([...MUSIC_TYPES, 'masterbar', 'measure', 'voice', 'track']);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The override record of an element in a part, or undefined. */
export const partOverrideOf = (part, id) => (part.props[PID.PART_OVERRIDES] ?? {})[id];

/**
 * Colour, offset and visibility of elements in ONE part, without any effect on screen 1 or on the other parts. `ids` = identifiers the elements are selected
 * by; `patch` = { color: '#rrggbb' | null (back to the ink), offset: [dx, dy] | null (absolute, staff spaces, y down; 0,0 or null = back in place),
 * hidden: true | null }. Empty records are removed. Offsets are refused for notes, chords and rests (they are placed by the music).
 */
export function setElementOverride(doc, partId, ids, patch, { music = false } = {}) {
  const part = partOf(doc, partId);
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some((i) => typeof i !== 'string' || !i || i.length > 200)) throw new PartEditError('Pick at least one element', 'ids');
  if (patch.color != null && !HEX.test(patch.color)) throw new PartEditError(`Not a colour: ${patch.color}`, 'color');
  if (patch.offset != null && !(Array.isArray(patch.offset) && patch.offset.length === 2 && patch.offset.every((n) => Number.isFinite(n) && Math.abs(n) <= 100))) throw new PartEditError('Offset out of range', 'range');
  const next = { ...(part.props[PID.PART_OVERRIDES] ?? {}) };
  for (const id of ids) {
    const el = doc.find(id);
    if (patch.offset && (patch.offset[0] || patch.offset[1]) && el && (music ? !MUSIC_TYPES.has(el.type) && NOT_MOVABLE_TYPES.has(el.type) : NOT_MOVABLE_TYPES.has(el.type))) throw new PartEditError('Notes, chords, rests and staves are moved by hand only when the lock is open', 'immovable');
    const rec = { ...(next[id] ?? {}) };
    if (patch.color !== undefined) { if (patch.color === null) delete rec.color; else rec.color = patch.color.toLowerCase(); }
    if (patch.offset !== undefined) { if (patch.offset === null || (!patch.offset[0] && !patch.offset[1])) delete rec.offset; else rec.offset = [Math.round(patch.offset[0] * 100) / 100, Math.round(patch.offset[1] * 100) / 100]; }
    if (patch.hidden !== undefined) { if (patch.hidden) rec.hidden = true; else delete rec.hidden; }
    if (Object.keys(rec).length) next[id] = rec; else delete next[id];
  }
  if (Object.keys(next).length) doc.set(part, PID.PART_OVERRIDES, next); else if (part.props[PID.PART_OVERRIDES] != null) doc.reset(part, PID.PART_OVERRIDES);
}

// ---------- text styles and text of the printed texts (title, header, footer, measure numbers) ----------

/**
 * Text style of one printed text of the part: `patch` = { family, size, bold, italic, underline, align, color } (null = back to the default of its place).
 * `key`: title, subtitle, album, composer, arranger, lyricist, line:<id>, header|footer:<first|odd|even>:<l|c|r>, measureNumber.
 */
export function setTextStyle(doc, partId, key, patch) {
  const part = partOf(doc, partId);
  if (!TEXT_KEY.test(key)) throw new PartEditError(`Not a text: ${key}`, 'key');
  if (patch.family != null && !(typeof patch.family === 'string' && /^[^"'<>&;{}\\]{1,80}$/.test(patch.family))) throw new PartEditError(`Not a font name: ${patch.family}`, 'family');
  if (patch.size != null && !(patch.size >= 4 && patch.size <= 120)) throw new PartEditError('The size is between 4 and 120 pt', 'range');
  if (patch.align != null && !TEXT_ALIGNS.includes(patch.align)) throw new PartEditError(`Unknown alignment: ${patch.align}`, 'align');
  if (patch.color != null && !HEX.test(patch.color)) throw new PartEditError(`Not a colour: ${patch.color}`, 'color');
  const all = { ...(part.props[PID.PART_TEXT_STYLES] ?? {}) };
  const rec = { ...(all[key] ?? {}) };
  for (const k of ['family', 'size', 'align', 'color']) if (patch[k] !== undefined) { if (patch[k] === null) delete rec[k]; else rec[k] = k === 'color' ? patch[k].toLowerCase() : patch[k]; }
  for (const k of ['bold', 'italic', 'underline']) if (patch[k] !== undefined) { if (patch[k] === null) delete rec[k]; else rec[k] = Boolean(patch[k]); }
  if (Object.keys(rec).length) all[key] = rec; else delete all[key];
  if (Object.keys(all).length) doc.set(part, PID.PART_TEXT_STYLES, all); else if (part.props[PID.PART_TEXT_STYLES] != null) doc.reset(part, PID.PART_TEXT_STYLES);
}

const META_KEYS = new Set(['title', 'subtitle', 'album', 'composer', 'arranger', 'lyricist']);

/** What a printed text is made of, for the editor: { kind: 'meta' | 'line' | 'template' | 'number', text, … } or null. */
export function textSourceOf(doc, part, key) {
  if (META_KEYS.has(key)) return { kind: 'meta', text: doc.work.props[META_PIDS[key]] ?? '' };
  if (key === 'measureNumber') return { kind: 'number', text: '' };
  if (key.startsWith('cell:')) { const c = (part.containers ?? []).find((x) => x.id === key.slice(5)); return c && getProperty(c, PID.CONTAINER_KIND) === 'text' ? { kind: 'cell', text: String(getProperty(c, PID.TEXT) ?? '') } : null; }
  if (key.startsWith('stext:')) { const e = partStaffTextsOf(part).find((x) => x.id === key.slice(6)); return e ? { kind: 'staffText', text: e.text } : null; } // a free staff text of the part
  if (key.startsWith('line:')) { const l = titleBlockOf(part).lines.find((x) => x.id === key.slice(5)); return l ? { kind: 'line', text: l.text } : null; }
  const m = /^(header|footer):(first|odd|even):([lcr])$/.exec(key);
  if (m) { const cfg = headerFooterOf(part, m[1]); const tpl = cfg[m[2]]; return { kind: 'template', text: tpl?.[m[3]] ?? '', header: m[1], template: m[2], area: m[3] }; }
  return null;
}

/** Changes the text of a printed text: the work's metadata, a free line, or one area of a header / footer template. */
export function setTextContent(doc, partId, key, text) {
  const part = partOf(doc, partId);
  const src = textSourceOf(doc, part, key);
  if (!src) throw new PartEditError(`Unknown text: ${key}`, 'key');
  if (src.kind === 'number') throw new PartEditError('Measure numbers are not typed: they follow the measures', 'derived');
  if (src.kind === 'cell') { setZoneCellText(doc, partId, key.slice(5), text); return; }
  if (src.kind === 'staffText') { updatePartStaffText(doc, partId, key.slice(6), { text }); return; }
  if (src.kind === 'meta') { setWorkMeta(doc, { [key]: text }); return; }
  if (src.kind === 'line') { const cur = titleBlockOf(part); setTitleBlock(doc, partId, { lines: cur.lines.map((l) => (l.id === key.slice(5) ? { ...l, text } : l)) }); return; }
  const cfg = headerFooterOf(part, src.header);
  setHeaderFooter(doc, partId, src.header, { [src.template]: { ...(cfg[src.template] ?? { l: '', c: '', r: '' }), [src.area]: text } });
}

// ---------- copy ONE group of settings from a part to all the others ----------

/** Groups of settings that can be copied to every other part: styles (SID) and part properties (PID). */
export const COPY_GROUPS = {
  format: { sids: [SID.PAGE_FORMAT, SID.PAGE_LANDSCAPE, SID.PAGE_WIDTH_MM, SID.PAGE_HEIGHT_MM] },
  margins: { sids: [SID.PAGE_MARGIN_LEFT, SID.PAGE_MARGIN_RIGHT, SID.PAGE_MARGIN_TOP, SID.PAGE_MARGIN_BOTTOM] },
  staffSize: { sids: [SID.PAGE_STAFF_SPACE_MM] },
  layout: { pids: [PID.PART_STAFF_GAP, PID.PART_STAFF_GAPS], sids: [SID.SYSTEM_TOP_MARGIN, SID.SYSTEM_BOTTOM_MARGIN, SID.SYSTEM_EDGE_DISTANCE, SID.PAGE_UPPER_BORDER, SID.PAGE_LOWER_BORDER, SID.PAGE_VERTICAL_SPREAD, SID.PAGE_MAX_FILL_SPREAD, SID.LAST_SYSTEM_JUSTIFY, SID.LAST_SYSTEM_FILL_LIMIT] },
  title: { sids: [SID.PAGE_SCORE_ONLY, SID.TITLE_SIZE, SID.SUBTITLE_SIZE, SID.CREDITS_SIZE, SID.TITLE_FRAME_DISTANCE], pids: [PID.PART_TITLE] },
  header: { sids: [SID.HEADER_SIZE, SID.PAGE_HEADER_MARGIN, SID.PAGE_NUMBER_OFFSET], pids: [PID.PART_HEADER] },
  footer: { sids: [SID.FOOTER_SIZE, SID.PAGE_FOOTER_MARGIN], pids: [PID.PART_FOOTER] },
  numbers: { sids: [SID.SHOW_MEASURE_NUMBERS, SID.MEASURE_NUMBER_MODE, SID.MEASURE_NUMBER_INTERVAL, SID.MEASURE_NUMBER_SHOW_ONE, SID.MEASURE_NUMBER_SIZE, SID.MEASURE_NUMBERS_CONTINUE], pids: [PID.PART_MEASURE_NUMBERS] },
  signs: { sids: [SID.PART_SIGNS_ON, SID.PART_SECTION_CARDS, SID.PART_SECTION_BANDS, SID.SECTION_CARD_SCALE, SID.SECTION_CARD_GAP, SID.SECTION_CARD_PLACE, SID.SECTION_CARD_STYLE, SID.SHOW_TEMPO_TEXTS] },
  measures: { sids: [SID.REGULAR_MEASURES, SID.MEASURES_PER_SYSTEM, SID.MEASURE_GRID, SID.MEASURE_GRID_BASE, SID.MEASURE_GRID_CHORDS, SID.MEASURE_GRID_STRETCH] },
  dividers: { pids: [PID.PART_DIVIDERS] },
  textStyles: { pids: [PID.PART_TEXT_STYLES] },
};

/** Copies one group of settings (a key of `COPY_GROUPS`) of a part to every other part; what the source leaves at its default is reset in the others. */
export function copyPartSettings(doc, fromId, group) {
  const spec = COPY_GROUPS[group];
  if (!spec) throw new PartEditError(`Unknown group: ${group}`, 'group');
  const from = partOf(doc, fromId);
  for (const part of doc.work.parts) {
    if (part.id === from.id) continue;
    for (const sid of spec.sids ?? []) { if (Object.hasOwn(from.style, sid)) doc.setStyle(part, sid, from.style[sid]); else doc.resetStyle(part, sid); }
    for (const pid of spec.pids ?? []) {
      if (from.props[pid] != null) doc.set(part, pid, structuredClone(from.props[pid])); else if (part.props[pid] != null) doc.reset(part, pid);
    }
  }
}
