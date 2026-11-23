/*
 * Zones between the systems of a PART (screen 2) and the room between its staves.
 *
 * A zone is a strip of room reserved under a system (the one that ends with `measureId`) and cut into 1 to 4 columns. Each cell of a column is a
 * staff container owned by the part (`part.containers`, placement 'zone'), so it appears in no other part nor on screen 1:
 *  - kind 'text'          : a text (empty = just room, to write by hand),
 *  - kind 'nestedNotation': a short score of its own (a fragment: a drum pattern over a chord grid, an exercise…), edited in the nested-score editor,
 *  - kind 'syncRange'     : a range of measures of one staff of the piece, read-only and always in step with it (a SYNCHRONISED fragment);
 *                           `detachZoneCell` turns it into a nestedNotation holding a COPY that no longer follows the piece.
 * Every function writes: call it inside `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createStaffContainer, createStaff, createVoice, createEmptyMeasure, createMovement, createMasterbar, createTrack } from './elements.js';
import { copyRange } from './clipboard.js';
import { pasteClipboard } from './pasteedit.js';
import { rangeFromMeasures } from './range.js';

export class ZoneError extends Error { constructor(message, code = 'zone') { super(message); this.code = code; } }

export const ZONE_DEFAULT_HEIGHT = 6; // staff spaces
export const ZONE_MAX_COLUMNS = 4;
const FRAGMENT_STAFF_TYPES = ['score', 'tab', 'percussion', 'rhythm', 'neutral'];

const partOf = (doc, id) => { const p = doc.find(id); if (!p || p.type !== 'part') throw new ZoneError(`Partie inconnue : ${id}`, 'part'); return p; };
const barPos = (doc, id) => { const bar = doc.find(id); if (!bar || bar.type !== 'masterbar') return null; const mv = doc.movementOf(bar); return mv ? { mv, index: mv.masterbars.indexOf(bar) } : null; };

/** The zones of a part: [{ measureId, columns, height, cells: [container…] }] (cells sorted by column). */
export function zonesOf(part) {
  const byBar = new Map();
  for (const c of part.containers ?? []) {
    if (getProperty(c, PID.CONTAINER_PLACEMENT) !== 'zone') continue; // the containers hung on a staff are in partcontainers.js
    const key = `${getProperty(c, PID.MEASURE_ID)}|${getProperty(c, PID.CONTAINER_ZONE_ROW)}`;
    if (!byBar.has(key)) byBar.set(key, []);
    byBar.get(key).push(c);
  }
  return [...byBar.values()].sort((a, b) => getProperty(a[0], PID.CONTAINER_ZONE_ROW) - getProperty(b[0], PID.CONTAINER_ZONE_ROW)).map((cells) => {
    const measureId = getProperty(cells[0], PID.MEASURE_ID); const row = getProperty(cells[0], PID.CONTAINER_ZONE_ROW);
    cells.sort((a, b) => getProperty(a, PID.CONTAINER_ZONE_COLUMN) - getProperty(b, PID.CONTAINER_ZONE_COLUMN));
    const heights = cells.map((c) => getProperty(c, PID.CONTAINER_ZONE_HEIGHT)).filter((h) => h != null);
    return { measureId, row, columns: Math.max(...cells.map((c) => getProperty(c, PID.CONTAINER_ZONE_COLUMN))) + 1, height: heights.length ? Math.max(...heights) : ZONE_DEFAULT_HEIGHT, cells };
  });
}
export const zoneAt = (part, measureId, row = 0) => zonesOf(part).find((z) => z.measureId === measureId && z.row === row) ?? null;
export const ZONE_MAX_ROWS = 6;
/**
 * A zone BEFORE the first system of a movement (under the title block, above the music) uses the rows ZONE_BEFORE_BASE… of the movement's
 * first measure; rows 0… are the zones under the system that ends with the measure. Nothing else changes: same cells, columns and height.
 */
export const ZONE_BEFORE_BASE = 10;
export const isBeforeRow = (row) => row >= ZONE_BEFORE_BASE;
export const isValidZoneRow = (row) => Number.isInteger(row) && ((row >= 0 && row < ZONE_MAX_ROWS) || (row >= ZONE_BEFORE_BASE && row < ZONE_BEFORE_BASE + ZONE_MAX_ROWS));

function newFragment({ staffType = 'score', clef = 'G', measures = 1, timeSig, keySig, staffProps = {} }) {
  if (!FRAGMENT_STAFF_TYPES.includes(staffType)) throw new ZoneError(`Type de portée non pris en charge : ${staffType}`, 'type');
  if (!Number.isInteger(measures) || measures < 1 || measures > 16) throw new ZoneError('Nombre de mesures invalide', 'measures');
  const bars = Array.from({ length: measures }, () => createMasterbar({ timeSig, keySig }));
  const staff = createStaff({ type: staffType, ...(staffType === 'score' ? { clef } : {}), props: staffProps, voices: [createVoice(bars.map(() => createEmptyMeasure(staffType)))] });
  return createMovement({ masterbars: bars, tracks: [createTrack({ staves: [staff] })] });
}

/**
 * Adds a cell to the zone (row `spec.row`, 0 = the first; several rows stack under one system) under the system that ends with `measureId`. `spec`: { column?, row?, kind: 'text' | 'nestedNotation' | 'syncRange' | 'structure' | 'chordDiagram' | 'chordDiagramList', text?, chord?, instrument?, unique?, scope?,
 * staffType?, clef?, measures? (notation), rangeStaffId?, rangeFrom?, rangeTo? (syncRange), height? }. Returns the container.
 */
export function addZoneCell(doc, partId, measureId, spec = {}) {
  const part = partOf(doc, partId);
  const pos = barPos(doc, measureId);
  if (!pos) throw new ZoneError('Mesure inexistante', 'measure');
  const row = spec.row ?? 0;
  if (!isValidZoneRow(row)) throw new ZoneError(`Au plus ${ZONE_MAX_ROWS} zones superposées`, 'row');
  if (spec.blockId && !(part.props[PID.PART_EXTRACTS] ?? []).some((b) => b.id === spec.blockId)) throw new ZoneError('Bloc inconnu', 'block');
  if (isBeforeRow(row) && pos.index !== 0 && !spec.blockId) throw new ZoneError('Une zone avant le système se pose sur la première mesure du Mouvement', 'row');
  const existing = zoneAt(part, measureId, row);
  const column = spec.column ?? (existing ? existing.columns : 0);
  if (!Number.isInteger(column) || column < 0 || column >= ZONE_MAX_COLUMNS) throw new ZoneError(`Au plus ${ZONE_MAX_COLUMNS} colonnes`, 'column');
  if (existing?.cells.some((c) => getProperty(c, PID.CONTAINER_ZONE_COLUMN) === column)) throw new ZoneError('Cette colonne est déjà occupée', 'column');
  const kind = spec.kind ?? 'text';
  const props = { [PID.CONTAINER_ZONE_COLUMN]: column, ...(row ? { [PID.CONTAINER_ZONE_ROW]: row } : {}) };
  if (spec.blockId) props[PID.CONTAINER_BLOCK_ID] = spec.blockId;
  if (spec.height != null) props[PID.CONTAINER_ZONE_HEIGHT] = spec.height;
  let c;
  if (kind === 'text') c = createStaffContainer({ measureId, kind: 'text', text: spec.text ?? '', placement: 'zone', props });
  else if (kind === 'nestedNotation') {
    const bar = pos.mv.masterbars[pos.index];
    c = createStaffContainer({ measureId, kind, placement: 'zone', props, fragments: [newFragment({ ...spec, timeSig: getProperty(bar, PID.TIME_SIG), keySig: getProperty(bar, PID.KEY_SIG) })] });
  } else if (kind === 'syncRange') {
    const from = barPos(doc, spec.rangeFrom); const to = barPos(doc, spec.rangeTo);
    if (!from || !to || from.mv !== to.mv || from.index > to.index) throw new ZoneError('Plage de mesures invalide', 'range');
    if (!doc.find(spec.rangeStaffId)) throw new ZoneError('Portée inexistante', 'staff');
    c = createStaffContainer({ measureId, kind, placement: 'zone', props: { ...props, [PID.RANGE_STAFF_ID]: spec.rangeStaffId, [PID.RANGE_FROM]: spec.rangeFrom, [PID.RANGE_TO]: spec.rangeTo } });
  } else if (kind === 'structure') c = createStaffContainer({ measureId, kind, placement: 'zone', props });
  else if (kind === 'chordDiagram') {
    const chord = spec.chord ?? { root: { step: 'C', alter: 0 }, quality: '', bass: null };
    c = createStaffContainer({ measureId, kind, placement: 'zone', props: { ...props, [PID.DIAGRAM_CHORD]: { root: { step: chord.root.step, alter: chord.root.alter ?? 0 }, quality: chord.quality ?? '', bass: chord.bass ?? null }, ...(spec.instrument && spec.instrument !== 'guitar' ? { [PID.DIAGRAM_INSTRUMENT]: spec.instrument } : {}) } });
  } else if (kind === 'chordDiagramList') {
    c = createStaffContainer({ measureId, kind, placement: 'zone', props: { ...props, ...(spec.instrument && spec.instrument !== 'guitar' ? { [PID.DIAGRAM_INSTRUMENT]: spec.instrument } : {}), ...(spec.unique === false ? { [PID.DIAGRAM_LIST_UNIQUE]: false } : {}), ...(spec.scope === 'system' ? { [PID.DIAGRAM_LIST_SCOPE]: 'system' } : {}), ...(spec.source === 'tab' ? { [PID.DIAGRAM_LIST_SOURCE]: 'tab' } : {}) } });
  } else throw new ZoneError(`Genre inconnu : ${kind}`, 'kind');
  doc.add(part, 'containers', c);
  return c;
}

export function removeZoneCell(doc, partId, cellId) {
  const part = partOf(doc, partId);
  const c = (part.containers ?? []).find((x) => x.id === cellId);
  if (!c) throw new ZoneError('Cellule inconnue', 'cell');
  doc.remove(c);
}

/** Room reserved by the zone (staff spaces): written on every cell so that it survives the removal of one of them. */
export function setZoneHeight(doc, partId, measureId, height, row = 0) {
  const part = partOf(doc, partId);
  const zone = zoneAt(part, measureId, row);
  if (!zone) throw new ZoneError('Zone inconnue', 'zone');
  if (!(height >= 0 && height <= 200)) throw new ZoneError('Hauteur hors de 0 à 200 espaces', 'range');
  for (const c of zone.cells) doc.set(c, PID.CONTAINER_ZONE_HEIGHT, height);
}

/** Number of columns (1-4): empty text cells fill the new ones, cells of the removed columns go away. */
export function setZoneColumns(doc, partId, measureId, count, row = 0) {
  const part = partOf(doc, partId);
  const zone = zoneAt(part, measureId, row);
  if (!zone) throw new ZoneError('Zone inconnue', 'zone');
  if (!Number.isInteger(count) || count < 1 || count > ZONE_MAX_COLUMNS) throw new ZoneError(`De 1 à ${ZONE_MAX_COLUMNS} colonnes`, 'column');
  for (const c of zone.cells) if (getProperty(c, PID.CONTAINER_ZONE_COLUMN) >= count) doc.remove(c);
  for (let col = 0; col < count; col++) {
    if (!zone.cells.some((c) => getProperty(c, PID.CONTAINER_ZONE_COLUMN) === col)) addZoneCell(doc, partId, measureId, { column: col, row, kind: 'text', text: '', height: zone.height });
  }
}

export function setZoneCellText(doc, partId, cellId, text) {
  const part = partOf(doc, partId);
  const c = (part.containers ?? []).find((x) => x.id === cellId);
  if (!c || getProperty(c, PID.CONTAINER_KIND) !== 'text') throw new ZoneError('Pas une cellule de texte', 'cell');
  doc.set(c, PID.TEXT, String(text).slice(0, 2000));
}

/** Replaces a cell by another kind in the same column and zone (one step for the user). */
export function replaceZoneCell(doc, partId, cellId, spec) {
  const part = partOf(doc, partId);
  const old = (part.containers ?? []).find((x) => x.id === cellId);
  if (!old) throw new ZoneError('Cellule inconnue', 'cell');
  const measureId = getProperty(old, PID.MEASURE_ID); const column = getProperty(old, PID.CONTAINER_ZONE_COLUMN); const row = getProperty(old, PID.CONTAINER_ZONE_ROW); const height = getProperty(old, PID.CONTAINER_ZONE_HEIGHT);
  doc.remove(old);
  return addZoneCell(doc, partId, measureId, { height: height ?? undefined, ...spec, column, row });
}

/** Turns a synchronised cell into a notation of its own: a COPY of the measures, no longer following the piece (edited in the nested-score editor). */
export function detachZoneCell(doc, partId, cellId) {
  const part = partOf(doc, partId);
  const old = (part.containers ?? []).find((x) => x.id === cellId);
  if (!old || getProperty(old, PID.CONTAINER_KIND) !== 'syncRange') throw new ZoneError('Cette cellule n\'est pas synchronisée', 'cell');
  const staff = doc.find(getProperty(old, PID.RANGE_STAFF_ID));
  const from = barPos(doc, getProperty(old, PID.RANGE_FROM)); const to = barPos(doc, getProperty(old, PID.RANGE_TO));
  if (!staff || !from || !to) throw new ZoneError('La source n\'existe plus', 'source');
  const type = getProperty(staff, PID.STAFF_TYPE);
  const bars = from.mv.masterbars.slice(from.index, to.index + 1);
  const staffProps = {};
  for (const pid of [PID.TUNING, PID.LINE_COUNT, PID.PERCMAP, PID.CONCERT_CLEF, PID.RHYTHM_HEAD, PID.RHYTHM_STEM, PID.RHYTHM_SOUND, PID.CLEF]) if (staff.props[pid] != null) staffProps[pid] = structuredClone(staff.props[pid]);
  const fragment = createMovement({
    masterbars: bars.map((b) => createMasterbar({ timeSig: getProperty(b, PID.TIME_SIG), keySig: getProperty(b, PID.KEY_SIG) })),
    tracks: [createTrack({ staves: [createStaff({ type, props: staffProps, voices: [createVoice(bars.map(() => createEmptyMeasure(type)))] })] })],
  });
  const props = { [PID.CONTAINER_ZONE_COLUMN]: getProperty(old, PID.CONTAINER_ZONE_COLUMN), [PID.CONTAINER_ZONE_ROW]: getProperty(old, PID.CONTAINER_ZONE_ROW) };
  const h = getProperty(old, PID.CONTAINER_ZONE_HEIGHT); if (h != null) props[PID.CONTAINER_ZONE_HEIGHT] = h;
  const c = createStaffContainer({ measureId: getProperty(old, PID.MEASURE_ID), kind: 'nestedNotation', placement: 'zone', props, fragments: [fragment] });
  doc.remove(old);
  doc.add(part, 'containers', c);
  // the copy is made by the clipboard of the piece: same rules as copy / paste (a plain copy of the measures, new identifiers)
  const range = rangeFromMeasures(doc, from.mv, [staff.id], from.index, to.index);
  if (range) {
    const payload = copyRange(doc, range);
    const target = c.fragments[0];
    pasteClipboard(doc, payload, { staffId: target.tracks[0].staves[0].id, measureId: target.masterbars[0].id, position: [0, 1] });
  }
  return c;
}

// ---------- room between the staves of every system ----------

/** Extra room (staff spaces, −10 to 40) between the staves of every system of the part; null = none. */
export function setPartStaffGap(doc, partId, value) {
  const part = partOf(doc, partId);
  if (value != null && !(value >= -10 && value <= 40)) throw new ZoneError('Écart entre portées hors de −10 à 40 espaces', 'range');
  if (value == null || value === 0) { if (part.props[PID.PART_STAFF_GAP] != null) doc.reset(part, PID.PART_STAFF_GAP); } else doc.set(part, PID.PART_STAFF_GAP, Math.round(value * 100) / 100);
}

/** Key of the room above a staff in ONE system (the system that holds the measure): `<staff>@<measure>`; the plain staff id = every system. */
export const staffGapKey = (staffId, measureId) => `${staffId}@${measureId}`;

/** Room above a staff in a system whose measures are `measureIds`: the system's own value when there is one (0 included), else the value for every system. */
export function effectiveStaffGap(gaps, staffId, measureIds) {
  if (!gaps) return 0;
  for (const m of measureIds) { const k = staffGapKey(staffId, m); if (Object.hasOwn(gaps, k)) return gaps[k]; }
  return gaps[staffId] ?? 0;
}

/** Room above a staff in ONE system (the one that holds `measureId`); null = back to the value for every system. */
export function setStaffGapAt(doc, partId, staffId, measureId, value) {
  const part = partOf(doc, partId);
  if (value != null && !(value >= -10 && value <= 40)) throw new ZoneError('Écart entre portées hors de −10 à 40 espaces', 'range');
  const next = { ...(part.props[PID.PART_STAFF_GAPS] ?? {}) };
  const key = staffGapKey(staffId, measureId);
  if (value == null) delete next[key]; else next[key] = Math.round(value * 100) / 100;
  if (Object.keys(next).length) doc.set(part, PID.PART_STAFF_GAPS, next); else if (part.props[PID.PART_STAFF_GAPS] != null) doc.reset(part, PID.PART_STAFF_GAPS);
}

/** Extra room above ONE staff (added to the general gap); null or 0 = back to the general gap. */
export function setStaffGap(doc, partId, staffId, value) {
  const part = partOf(doc, partId);
  if (value != null && !(value >= -10 && value <= 40)) throw new ZoneError('Écart entre portées hors de −10 à 40 espaces', 'range');
  const next = { ...(part.props[PID.PART_STAFF_GAPS] ?? {}) };
  for (const k of Object.keys(next)) if (k.startsWith(`${staffId}@`)) delete next[k]; // "every system" also replaces the values chosen for single systems
  if (value == null || value === 0) delete next[staffId]; else next[staffId] = Math.round(value * 100) / 100;
  if (Object.keys(next).length) doc.set(part, PID.PART_STAFF_GAPS, next); else if (part.props[PID.PART_STAFF_GAPS] != null) doc.reset(part, PID.PART_STAFF_GAPS);
}

/**
 * Options of a diagram LIST cell: each chord once or in the order they come (`unique`), the whole movement or the system the zone sits under (`scope`), the instrument,
 * where the chords come from (`source`: 'symbols' = the chord staff, 'tab' = the fingerings written in a tablature staff, `staffId` null = the first tablature).
 */
export function setZoneDiagramList(doc, partId, cellId, { unique, scope, instrument, source, staffId, align, variants, groups, labelSize } = {}) {
  const part = partOf(doc, partId);
  const c = (part.containers ?? []).find((x) => x.id === cellId);
  if (!c || getProperty(c, PID.CONTAINER_KIND) !== 'chordDiagramList') throw new ZoneError('Pas une liste de diagrammes', 'cell');
  if (unique !== undefined) { if (unique) { if (getProperty(c, PID.DIAGRAM_LIST_UNIQUE) === false) doc.reset(c, PID.DIAGRAM_LIST_UNIQUE); } else doc.set(c, PID.DIAGRAM_LIST_UNIQUE, false); }
  if (labelSize !== undefined) {
    if (!Number.isFinite(labelSize) || labelSize < 0.5 || labelSize > 3) throw new ZoneError('Taille du nom de groupe invalide (0,5 à 3)', 'labelSize');
    if (Math.abs(labelSize - 1) < 1e-9) { if (getProperty(c, PID.DIAGRAM_LIST_LABEL_SIZE) !== 1) doc.reset(c, PID.DIAGRAM_LIST_LABEL_SIZE); } else doc.set(c, PID.DIAGRAM_LIST_LABEL_SIZE, Math.round(labelSize * 20) / 20);
  }
  if (groups !== undefined) {
    if (!['off', 'sections', 'labels'].includes(groups)) throw new ZoneError('Regroupement inconnu', 'groups');
    if (groups === 'off') { if (getProperty(c, PID.DIAGRAM_LIST_GROUPS) !== 'off') doc.reset(c, PID.DIAGRAM_LIST_GROUPS); } else doc.set(c, PID.DIAGRAM_LIST_GROUPS, groups);
  }
  if (variants !== undefined) {
    if (!['main', 'played', 'layer'].includes(variants)) throw new ZoneError('Variantes inconnues', 'variants');
    if (variants === 'main') { if (getProperty(c, PID.DIAGRAM_LIST_VARIANTS) !== 'main') doc.reset(c, PID.DIAGRAM_LIST_VARIANTS); } else doc.set(c, PID.DIAGRAM_LIST_VARIANTS, variants);
  }
  if (scope !== undefined) { if (scope === 'movement') { if (getProperty(c, PID.DIAGRAM_LIST_SCOPE) !== 'movement') doc.reset(c, PID.DIAGRAM_LIST_SCOPE); } else if (scope === 'system') doc.set(c, PID.DIAGRAM_LIST_SCOPE, 'system'); else throw new ZoneError('Étendue inconnue', 'scope'); }
  if (align !== undefined) {
    if (!['left', 'center', 'right', 'justify'].includes(align)) throw new ZoneError('Alignement inconnu', 'align');
    if (align === 'left') { if (getProperty(c, PID.DIAGRAM_LIST_ALIGN) !== 'left') doc.reset(c, PID.DIAGRAM_LIST_ALIGN); } else doc.set(c, PID.DIAGRAM_LIST_ALIGN, align);
  }
  if (source !== undefined) {
    if (source === 'symbols') { if (getProperty(c, PID.DIAGRAM_LIST_SOURCE) !== 'symbols') doc.reset(c, PID.DIAGRAM_LIST_SOURCE); } else if (source === 'tab') doc.set(c, PID.DIAGRAM_LIST_SOURCE, 'tab'); else throw new ZoneError('Source inconnue', 'source');
  }
  if (staffId !== undefined) {
    if (staffId === null) { if (getProperty(c, PID.DIAGRAM_LIST_STAFF) !== null) doc.reset(c, PID.DIAGRAM_LIST_STAFF); } else {
      const st = doc.find(staffId);
      if (!st || st.type !== 'staff' || getProperty(st, PID.STAFF_TYPE) !== 'tab') throw new ZoneError('Pas une portée de tablature', 'staff');
      doc.set(c, PID.DIAGRAM_LIST_STAFF, staffId);
    }
  }
  if (instrument !== undefined) {
    if (!['guitar', 'ukulele', 'bass'].includes(instrument)) throw new ZoneError('Instrument inconnu', 'instrument');
    if (instrument === 'guitar') { if (getProperty(c, PID.DIAGRAM_INSTRUMENT) !== 'guitar') doc.reset(c, PID.DIAGRAM_INSTRUMENT); } else doc.set(c, PID.DIAGRAM_INSTRUMENT, instrument);
  }
}
