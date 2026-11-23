/*
 * Sheets (screen 3): how the work is PRESENTED to a reader. CALL INSIDE `doc.transaction`.
 *
 * A sheet has CELLS (one movement each, with the tracks shown: null = all of them), a layout (`column`, or `matrix` with a number of columns that a narrow
 * screen folds into one) and the options OFFERED to the reader. Everything is locked for the reader by default: the author unlocks what the reader may change.
 *
 * Reader options (`PID.SHEET_READER`): `transposeDisplay` and `transposePlay` (semitones; separate settings, optionally linked: `linkTranspose`), `speed` (%),
 * and `unlocked` = the options the reader may change ({ transposeDisplay, transposePlay, tracks, speed, loop }). The reader is built without the controls of
 * what stays locked.
 */
import { PID } from './pid.js';
import { createSheet } from './elements.js';
import { newId } from './ids.js';
import { SIZE_MIN, SIZE_MAX, cleanDisplay } from './trackdisplay.js';

export class SheetEditError extends Error {
  constructor(message, code) { super(message); this.name = 'SheetEditError'; this.code = code; }
}

export const SHEET_LAYOUTS = Object.freeze(['column', 'matrix']);
export const MAX_COLUMNS = 16; // a digital whiteboard can show many; the reader folds them by the size of the writing (layout/sheetlayout.js: MIN_CELL_SPACES)
export const READER_LOCKS = Object.freeze(['transposeDisplay', 'transposePlay', 'tracks', 'speed', 'loop', 'staffSize', 'hiddenMuted', 'volume', 'signs', 'names']);
/** What the reader may change by default: everything but the transpositions (the author unlocks those on purpose). */
export const DEFAULT_UNLOCKED = Object.freeze({ transposeDisplay: false, transposePlay: false, tracks: true, speed: true, loop: true, staffSize: true, hiddenMuted: true, volume: true, signs: true, names: false });
export const STAFF_SIZE_RANGE = Object.freeze([5, 24]); // px per staff space on the reader's screen
export const TRANSPOSE_RANGE = 24; // semitones either way
export const SPEED_RANGE = Object.freeze([25, 200]);

const sheetOf = (doc, id) => {
  const s = doc.find(id);
  if (!s || s.type !== 'sheet') throw new SheetEditError(`Unknown sheet: ${id}`, 'unknown');
  return s;
};
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Size of the name cards of the parts, in % of the usual (0.3 to 1.5). */
export const CARD_SCALE_RANGE = Object.freeze([0.3, 1.5]);
/** The reader options with every default filled in. */
export const DEFAULT_SIGNS_COLOR = '#c0392b'; // red, visible but not too sharp
/** How the reader plays a sheet: 'global' = one set of controls for the whole page (it acts on the chosen cell: the arrangement a band shares), 'cases' = every cell carries its own
 * player (the exercises a student works one by one), 'auto' = 'global' for a sheet of one cell, 'cases' for several. */
export const PLAYER_MODES = Object.freeze(['auto', 'global', 'cases']);
/** The carousel of the 'cases' mode (one cell at a time): 'auto' = when the window is narrower than `CAROUSEL_WIDTH`, 'always', 'never'. */
export const CAROUSEL_MODES = Object.freeze(['auto', 'always', 'never']);
export const CAROUSEL_WIDTH = 700;
/** The mode really used for a sheet of `cellCount` cells. */
export const effectivePlayerMode = (options, cellCount) => (options.playerMode === 'auto' ? (cellCount > 1 ? 'cases' : 'global') : options.playerMode);

export function readerOptions(sheet) {
  const own = sheet.props[PID.SHEET_READER] ?? {};
  const unlocked = {};
  for (const k of READER_LOCKS) unlocked[k] = own.unlocked?.[k] ?? DEFAULT_UNLOCKED[k];
  return {
    transposeDisplay: Number.isInteger(own.transposeDisplay) ? own.transposeDisplay : 0,
    transposePlay: Number.isInteger(own.transposePlay) ? own.transposePlay : 0,
    linkTranspose: own.linkTranspose !== false,
    speed: Number.isFinite(own.speed) ? own.speed : 100,
    staffSize: Number.isFinite(own.staffSize) ? own.staffSize : null, // null = the size of the reader's device
    hiddenMuted: own.hiddenMuted !== false, // a track hidden in a cell is muted unless the author says it sounds
    showSections: own.showSections !== false, // the reader's structure strip: the parts of the form (cards)
    showRehearsal: own.showRehearsal === true, // … and the rehearsal marks
    showTempo: typeof own.showTempo === 'boolean' ? own.showTempo : null, // the tempo texts (♩ = 90): null = as the file says
    cardScale: Number.isFinite(own.cardScale) && own.cardScale > 0 ? own.cardScale : null, // size of the name cards of the parts (1 = usual): null = the usual
    cardStyle: own.cardStyle === 'text' || own.cardStyle === 'card' ? own.cardStyle : null, // « card » (a coloured rectangle) or « text » (the name alone)
    showNames: typeof own.showNames === 'boolean' ? own.showNames : null, // names of the tracks at the left of the staves: null = as the file says (the first movement's style)
    colorSigns: own.colorSigns === true, // off until the author asks: repeat bars, voltas, jumps, markers and the time signature in a colour (like iReal Pro)
    signsColor: typeof own.signsColor === 'string' ? own.signsColor : DEFAULT_SIGNS_COLOR,
    sectionColors: own.sectionColors === true, // colours of the parts (cards and tint on the music)
    playerMode: PLAYER_MODES.includes(own.playerMode) ? own.playerMode : 'auto',
    carousel: CAROUSEL_MODES.includes(own.carousel) ? own.carousel : 'auto',
    unlocked,
  };
}

const own = (o, k) => (o && o[k] !== undefined ? o[k] : undefined);

/**
 * The settings in force for a cell: the cell's own values over the sheet's (a track's own values over the cell's, for the transposition and the volume).
 * `unlocked` follows the same rule (a cell can lock or unlock an option the sheet decided otherwise). Pure.
 * → { transposeDisplay, transposePlay, linkTranspose, speed, staffSize, hiddenMuted, unlocked, loop, tracks: { [trackId]: { transposeDisplay, transposePlay, volume } } }
 */
export function cellSettings(sheet, cell) {
  const base = readerOptions(sheet); const cs = cell?.settings ?? {};
  const pick = (k) => own(cs, k) ?? base[k];
  const unlocked = {};
  for (const k of READER_LOCKS) unlocked[k] = cs.unlocked?.[k] ?? base.unlocked[k];
  const out = { transposeDisplay: pick('transposeDisplay'), transposePlay: pick('transposePlay'), linkTranspose: pick('linkTranspose'), speed: pick('speed'), staffSize: own(cs, 'staffSize') ?? base.staffSize, showNames: own(cs, 'showNames') ?? base.showNames, showTempo: own(cs, 'showTempo') ?? base.showTempo, cardScale: own(cs, 'cardScale') ?? base.cardScale, cardStyle: own(cs, 'cardStyle') ?? base.cardStyle, hiddenMuted: pick('hiddenMuted'), unlocked, loop: cell?.loop ?? null, tracks: {} };
  for (const [id, ts] of Object.entries(cell?.trackSettings ?? {})) out.tracks[id] = { transposeDisplay: ts.transposeDisplay ?? out.transposeDisplay, transposePlay: ts.transposePlay ?? out.transposePlay, volume: ts.volume ?? null, composite: ts.composite, slashes: ts.slashes, showBars: ts.showBars, sizePct: ts.sizePct, show: ts.show, colors: ts.colors };
  return out;
}

/** The transposition (semitones) of a track of a cell: its own, else the cell's, else the sheet's. */
export function trackShift(settings, trackId, kind) { return settings.tracks[trackId]?.[kind] ?? settings[kind]; }

/** The cells of a sheet: [{ id, movementId, tracks: string[] | null }] (those whose movement is gone are left out; a track list is cut to the tracks that exist). */
export function sheetCells(work, sheet) {
  const out = [];
  for (const c of sheet.props[PID.SHEET_CELLS] ?? []) {
    const mv = work.movements.find((m) => m.id === c.movementId);
    if (!mv) continue;
    let tracks = Array.isArray(c.tracks) ? c.tracks.filter((id) => mv.tracks.some((t) => t.id === id)) : null;
    if (tracks && !tracks.length) tracks = null;
    const cell = { id: c.id, movementId: c.movementId, tracks };
    if (c.settings && Object.keys(c.settings).length) cell.settings = c.settings;
    if (c.loop) cell.loop = c.loop;
    const ts = Object.fromEntries(Object.entries(c.trackSettings ?? {}).filter(([id]) => mv.tracks.some((t) => t.id === id)));
    if (Object.keys(ts).length) cell.trackSettings = ts;
    out.push(cell);
  }
  return out;
}

/** Layout of a sheet: { layout, columns } (a `column` sheet has one column). */
export function sheetShape(sheet) {
  const layout = SHEET_LAYOUTS.includes(sheet.props[PID.SHEET_LAYOUT]) ? sheet.props[PID.SHEET_LAYOUT] : 'column';
  const columns = layout === 'column' ? 1 : clampInt(sheet.props[PID.SHEET_COLUMNS] ?? 2, 1, MAX_COLUMNS);
  return { layout, columns };
}

const readCells = (sheet) => [...(sheet.props[PID.SHEET_CELLS] ?? [])];
const writeCells = (doc, sheet, cells) => { if (cells.length) doc.set(sheet, PID.SHEET_CELLS, cells); else if (sheet.props[PID.SHEET_CELLS] != null) doc.reset(sheet, PID.SHEET_CELLS); };

/** A new sheet with one cell per movement (all tracks). Returns it. */
export function addSheet(doc, { name = '', at } = {}) {
  const sheet = createSheet({ name: name || `Sheet ${doc.work.sheets.length + 1}` });
  doc.add(doc.work, 'sheets', sheet, at);
  doc.set(sheet, PID.SHEET_CELLS, doc.work.movements.map((mv) => ({ id: newId('sc'), movementId: mv.id, tracks: null })));
  return sheet;
}

export function removeSheet(doc, sheetId) { doc.remove(sheetOf(doc, sheetId)); }

export function renameSheet(doc, sheetId, name) {
  const sheet = sheetOf(doc, sheetId);
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) { if (sheet.props[PID.NAME] != null) doc.reset(sheet, PID.NAME); return; }
  if (sheet.props[PID.NAME] !== clean) doc.set(sheet, PID.NAME, clean);
}

/** Moves a sheet to the final index `index`. Returns false when it is already there. */
export function moveSheetTo(doc, sheetId, index) {
  const sheet = sheetOf(doc, sheetId);
  const from = doc.work.sheets.indexOf(sheet);
  if (!Number.isInteger(index) || index < 0 || index >= doc.work.sheets.length) throw new SheetEditError('Invalid position', 'position');
  if (from === index) return false;
  doc.remove(sheet);
  doc.add(doc.work, 'sheets', sheet, index);
  return true;
}

/** The number of columns of a sheet (1 to MAX_COLUMNS): 1 is the single column, more is the matrix. Nothing is stored for 1 (the default). */
export function setSheetColumns(doc, sheetId, columns) {
  const n = clampInt(columns, 1, MAX_COLUMNS);
  setSheetLayout(doc, sheetId, n === 1 ? 'column' : 'matrix', n);
}

export function setSheetLayout(doc, sheetId, layout, columns) {
  const sheet = sheetOf(doc, sheetId);
  if (!SHEET_LAYOUTS.includes(layout)) throw new SheetEditError(`Unknown layout: ${layout}`, 'layout');
  if (layout === 'column') { for (const pid of [PID.SHEET_LAYOUT, PID.SHEET_COLUMNS]) if (sheet.props[pid] != null) doc.reset(sheet, pid); return; }
  doc.set(sheet, PID.SHEET_LAYOUT, 'matrix');
  const n = clampInt(columns ?? sheet.props[PID.SHEET_COLUMNS] ?? 2, 1, MAX_COLUMNS);
  doc.set(sheet, PID.SHEET_COLUMNS, n);
}

/** Adds a cell for a movement (at the end, or at `index`). Returns the cell. */
export function addCell(doc, sheetId, movementId, { index } = {}) {
  const sheet = sheetOf(doc, sheetId);
  if (!doc.work.movements.some((m) => m.id === movementId)) throw new SheetEditError(`Unknown movement: ${movementId}`, 'movement');
  const cells = readCells(sheet); const cell = { id: newId('sc'), movementId, tracks: null };
  cells.splice(index ?? cells.length, 0, cell);
  writeCells(doc, sheet, cells);
  return cell;
}

export function removeCell(doc, sheetId, cellId) {
  const sheet = sheetOf(doc, sheetId);
  writeCells(doc, sheet, readCells(sheet).filter((c) => c.id !== cellId));
}

/** Moves a cell to the final index `index`. */
export function moveCellTo(doc, sheetId, cellId, index) {
  const sheet = sheetOf(doc, sheetId); const cells = readCells(sheet);
  const from = cells.findIndex((c) => c.id === cellId);
  if (from < 0) throw new SheetEditError(`Unknown cell: ${cellId}`, 'cell');
  const [cell] = cells.splice(from, 1);
  cells.splice(clampInt(index, 0, cells.length), 0, cell);
  writeCells(doc, sheet, cells);
}

const cellIn = (cells, cellId) => { const i = cells.findIndex((c) => c.id === cellId); if (i < 0) throw new SheetEditError(`Unknown cell: ${cellId}`, 'cell'); return i; };

/** Shows another movement in a cell (its track choice is forgotten). */
export function setCellMovement(doc, sheetId, cellId, movementId) {
  const sheet = sheetOf(doc, sheetId);
  if (!doc.work.movements.some((m) => m.id === movementId)) throw new SheetEditError(`Unknown movement: ${movementId}`, 'movement');
  const cells = readCells(sheet); const i = cellIn(cells, cellId);
  cells[i] = { id: cellId, movementId, tracks: null, ...(cells[i].settings ? { settings: cells[i].settings } : {}) }; // the loop and the track settings belong to the old movement
  writeCells(doc, sheet, cells);
}

/** The tracks shown in a cell: a list of ids of the cell's movement (at least one), or null for all of them (also stored as null when the list is every track). */
export function setCellTracks(doc, sheetId, cellId, trackIds) {
  const sheet = sheetOf(doc, sheetId);
  const cells = readCells(sheet); const i = cellIn(cells, cellId);
  const mv = doc.work.movements.find((m) => m.id === cells[i].movementId);
  if (!mv) throw new SheetEditError('The movement of the cell is gone', 'movement');
  let list = trackIds == null ? null : mv.tracks.map((t) => t.id).filter((id) => trackIds.includes(id));
  if (list && !list.length) throw new SheetEditError('A cell shows at least one track', 'tracks');
  if (list && list.length === mv.tracks.length) list = null;
  cells[i] = { ...cells[i], tracks: list };
  writeCells(doc, sheet, cells);
}

/** Sets one reader option. Linked transpositions move together. */
export function setReaderOption(doc, sheetId, key, value) {
  const sheet = sheetOf(doc, sheetId);
  const cur = readerOptions(sheet);
  const next = { ...cur };
  if (key === 'transposeDisplay' || key === 'transposePlay') {
    const n = clampInt(value, -TRANSPOSE_RANGE, TRANSPOSE_RANGE);
    next[key] = n;
    if (cur.linkTranspose) { next.transposeDisplay = n; next.transposePlay = n; }
  } else if (key === 'linkTranspose') {
    next.linkTranspose = Boolean(value);
    if (next.linkTranspose) next.transposePlay = next.transposeDisplay; // linking: the playback follows the display
  } else if (key === 'speed') next.speed = clampInt(value, SPEED_RANGE[0], SPEED_RANGE[1]);
  else if (key === 'staffSize') next.staffSize = value == null ? null : clampInt(value, STAFF_SIZE_RANGE[0], STAFF_SIZE_RANGE[1]);
  else if (key === 'hiddenMuted') next.hiddenMuted = Boolean(value);
  else if (key === 'showNames') next.showNames = value == null ? null : Boolean(value);
  else if (key === 'showTempo') next.showTempo = value == null ? null : Boolean(value);
  else if (key === 'cardScale') next.cardScale = value == null ? null : Math.min(CARD_SCALE_RANGE[1], Math.max(CARD_SCALE_RANGE[0], Math.round(value * 100) / 100));
  else if (key === 'cardStyle') next.cardStyle = value == null ? null : (value === 'text' ? 'text' : 'card');
  else if (key === 'showSections' || key === 'showRehearsal' || key === 'sectionColors' || key === 'colorSigns') next[key] = Boolean(value);
  else if (key === 'signsColor') next[key] = /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_SIGNS_COLOR;
  else if (key === 'playerMode') { if (!PLAYER_MODES.includes(value)) throw new SheetEditError(`Unknown player mode: ${value}`, 'option'); next.playerMode = value; }
  else if (key === 'carousel') { if (!CAROUSEL_MODES.includes(value)) throw new SheetEditError(`Unknown carousel mode: ${value}`, 'option'); next.carousel = value; }
  else throw new SheetEditError(`Unknown reader option: ${key}`, 'option');
  writeReader(doc, sheet, next);
  clearBelow(doc, sheet, key, key === 'linkTranspose' ? [] : (key === 'transposeDisplay' || key === 'transposePlay') && cur.linkTranspose ? ['transposeDisplay', 'transposePlay'] : [key]);
}

/** A value set for the WHOLE sheet applies to every cell: the cells' and tracks' own values of that option are dropped (a sheet-level change must reach them all). */
function clearBelow(doc, sheet, _key, keys) {
  if (!keys.length) return;
  const cells = readCells(sheet); let changed = false;
  const next = cells.map((c) => {
    const out = { ...c };
    if (c.settings && keys.some((k) => c.settings[k] !== undefined)) { const st = { ...c.settings }; for (const k of keys) delete st[k]; if (Object.keys(st).length) out.settings = st; else delete out.settings; changed = true; }
    if (c.trackSettings && keys.some((k) => k !== 'volume' && Object.values(c.trackSettings).some((t) => t[k] !== undefined))) {
      const all = {};
      for (const [id, t] of Object.entries(c.trackSettings)) { const x = { ...t }; for (const k of keys) delete x[k]; if (Object.keys(x).length) all[id] = x; }
      if (Object.keys(all).length) out.trackSettings = all; else delete out.trackSettings;
      changed = true;
    }
    return out;
  });
  if (changed) writeCells(doc, sheet, next);
}

/** Lets the reader change an option (or locks it again). */
export function setReaderUnlock(doc, sheetId, lock, on) {
  const sheet = sheetOf(doc, sheetId);
  if (!READER_LOCKS.includes(lock)) throw new SheetEditError(`Unknown lock: ${lock}`, 'lock');
  const next = readerOptions(sheet);
  next.unlocked = { ...next.unlocked, [lock]: Boolean(on) };
  writeReader(doc, sheet, next);
}

function writeReader(doc, sheet, o) {
  // only what differs from the defaults is stored
  const out = {};
  if (o.transposeDisplay) out.transposeDisplay = o.transposeDisplay;
  if (o.transposePlay) out.transposePlay = o.transposePlay;
  if (o.linkTranspose === false) out.linkTranspose = false;
  if (o.speed !== 100) out.speed = o.speed;
  if (o.staffSize != null) out.staffSize = o.staffSize;
  if (o.hiddenMuted === false) out.hiddenMuted = false;
  if (typeof o.showNames === 'boolean') out.showNames = o.showNames;
  if (typeof o.showTempo === 'boolean') out.showTempo = o.showTempo;
  if (o.cardScale != null) out.cardScale = o.cardScale;
  if (o.cardStyle) out.cardStyle = o.cardStyle;
  if (o.showSections === false) out.showSections = false;
  if (o.showRehearsal) out.showRehearsal = true;
  if (o.sectionColors) out.sectionColors = true;
  if (o.colorSigns) out.colorSigns = true;
  if (o.signsColor && o.signsColor !== DEFAULT_SIGNS_COLOR) out.signsColor = o.signsColor;
  if (o.playerMode && o.playerMode !== 'auto') out.playerMode = o.playerMode;
  if (o.carousel && o.carousel !== 'auto') out.carousel = o.carousel;
  const un = Object.fromEntries(Object.entries(o.unlocked).filter(([k, v]) => v !== DEFAULT_UNLOCKED[k])); // only the differences from the defaults
  if (Object.keys(un).length) out.unlocked = un;
  if (Object.keys(out).length) doc.set(sheet, PID.SHEET_READER, out); else if (sheet.props[PID.SHEET_READER] != null) doc.reset(sheet, PID.SHEET_READER);
}

/** The movements or tracks of a sheet's cells that are gone: removes the dangling cells / ids. Call after removing a movement or a track. */
export function pruneSheets(doc) {
  for (const sheet of doc.work.sheets) {
    const raw = readCells(sheet);
    const kept = sheetCells(doc.work, sheet);
    const same = kept.length === raw.length && kept.every((c, i) => raw[i].id === c.id && JSON.stringify(raw[i].tracks ?? null) === JSON.stringify(c.tracks));
    if (!same) writeCells(doc, sheet, kept);
  }
}

// ---------- cells and tracks: the same options one level down (the most precise level wins) ----------
const CELL_KEYS = Object.freeze(['transposeDisplay', 'transposePlay', 'linkTranspose', 'speed', 'staffSize', 'hiddenMuted', 'showNames', 'showTempo', 'cardScale', 'cardStyle']);
const TRACK_KEYS = Object.freeze(['transposeDisplay', 'transposePlay', 'volume', 'composite', 'slashes', 'showBars', 'sizePct', 'show', 'colors']);

function cellRecord(doc, sheetId, cellId) {
  const sheet = sheetOf(doc, sheetId); const cells = readCells(sheet); const i = cellIn(cells, cellId);
  return { sheet, cells, i, cell: cells[i] };
}
const cleanSettings = (o) => (Object.keys(o).length ? o : undefined);
function putCell(doc, ctx, patch) {
  const next = { ...ctx.cell, ...patch };
  for (const k of ['settings', 'loop', 'trackSettings']) if (next[k] === undefined || next[k] === null) delete next[k];
  ctx.cells[ctx.i] = next;
  writeCells(doc, ctx.sheet, ctx.cells);
}
const cleanValue = (key, value) => {
  if (value == null) return undefined;
  if (key === 'cardScale') return Math.min(CARD_SCALE_RANGE[1], Math.max(CARD_SCALE_RANGE[0], Math.round(value * 100) / 100));
  if (key === 'cardStyle') return value === 'text' ? 'text' : 'card';
  if (key === 'transposeDisplay' || key === 'transposePlay') return clampInt(value, -TRANSPOSE_RANGE, TRANSPOSE_RANGE);
  if (key === 'speed') return clampInt(value, SPEED_RANGE[0], SPEED_RANGE[1]);
  if (key === 'staffSize') return clampInt(value, STAFF_SIZE_RANGE[0], STAFF_SIZE_RANGE[1]);
  if (key === 'sizePct') return clampInt(value, SIZE_MIN, SIZE_MAX);
  if (key === 'composite') return typeof value === 'string' && value ? value : undefined; // the id of a composite staff of the track
  if (key === 'slashes') return Array.isArray(value) ? cleanDisplay({ slashes: value }).slashes : undefined; // a list ([] = none, whatever screen 1 shows)
  if (key === 'volume') return Math.round(Math.min(1, Math.max(0, value)) * 127) / 127;
  if (key === 'show' || key === 'colors') return cleanDisplay({ [key]: value })[key]; // the whole sub-object; empty = back to the level above
  return Boolean(value);
};

/** One option of a cell; `null` = back to the sheet's value. Linked transpositions move together. */
export function setCellOption(doc, sheetId, cellId, key, value) {
  if (!CELL_KEYS.includes(key)) throw new SheetEditError(`Unknown cell option: ${key}`, 'option');
  const ctx = cellRecord(doc, sheetId, cellId);
  const settings = { ...(ctx.cell.settings ?? {}) };
  const v = cleanValue(key, value);
  const linked = key === 'linkTranspose' ? v : cellSettings(ctx.sheet, ctx.cell).linkTranspose;
  if (v === undefined) { delete settings[key]; if ((key === 'transposeDisplay' || key === 'transposePlay') && linked) { delete settings.transposeDisplay; delete settings.transposePlay; } } else settings[key] = v;
  if ((key === 'transposeDisplay' || key === 'transposePlay') && v !== undefined && linked) { settings.transposeDisplay = v; settings.transposePlay = v; }
  if (key === 'linkTranspose' && v) { const d = settings.transposeDisplay ?? readerOptions(ctx.sheet).transposeDisplay; settings.transposeDisplay = d; settings.transposePlay = d; }
  putCell(doc, ctx, { settings: cleanSettings(settings) });
}

/** Lets the reader change an option of this cell (`true`), locks it (`false`) or follows the sheet (`null`). */
export function setCellUnlock(doc, sheetId, cellId, lock, on) {
  if (!READER_LOCKS.includes(lock)) throw new SheetEditError(`Unknown lock: ${lock}`, 'lock');
  const ctx = cellRecord(doc, sheetId, cellId);
  const settings = { ...(ctx.cell.settings ?? {}) }; const unlocked = { ...(settings.unlocked ?? {}) };
  if (on == null) delete unlocked[lock]; else unlocked[lock] = Boolean(on);
  if (Object.keys(unlocked).length) settings.unlocked = unlocked; else delete settings.unlocked;
  putCell(doc, ctx, { settings: cleanSettings(settings) });
}

/** The loop proposed for a cell: { from, to } = two measures (ids) of its movement, `from` not after `to`; `active` = on at the start. `null` removes it. */
export function setCellLoop(doc, sheetId, cellId, loop) {
  const ctx = cellRecord(doc, sheetId, cellId);
  if (loop == null) { putCell(doc, ctx, { loop: null }); return; }
  const mv = doc.work.movements.find((m) => m.id === ctx.cell.movementId);
  const a = mv?.masterbars.findIndex((b) => b.id === loop.from); const b = mv?.masterbars.findIndex((x) => x.id === loop.to);
  if (!(a >= 0 && b >= 0)) throw new SheetEditError('The loop measures must belong to the movement of the cell', 'loop');
  const [from, to] = a <= b ? [loop.from, loop.to] : [loop.to, loop.from];
  putCell(doc, ctx, { loop: { from, to, ...(loop.active ? { active: true } : {}) } });
}

/** One option of a track of a cell (transposition, volume 0..1); `null` = follows the cell. */
export function setTrackOption(doc, sheetId, cellId, trackId, key, value) {
  if (!TRACK_KEYS.includes(key)) throw new SheetEditError(`Unknown track option: ${key}`, 'option');
  const ctx = cellRecord(doc, sheetId, cellId);
  const mv = doc.work.movements.find((m) => m.id === ctx.cell.movementId);
  if (!mv?.tracks.some((t) => t.id === trackId)) throw new SheetEditError(`Unknown track: ${trackId}`, 'track');
  const all = { ...(ctx.cell.trackSettings ?? {}) }; const ts = { ...(all[trackId] ?? {}) };
  const v = cleanValue(key, value);
  if (v === undefined) { delete ts[key]; if ((key === 'transposeDisplay' || key === 'transposePlay') && cellSettings(ctx.sheet, ctx.cell).linkTranspose) { delete ts.transposeDisplay; delete ts.transposePlay; } } else ts[key] = v;
  if ((key === 'transposeDisplay' || key === 'transposePlay') && v !== undefined && cellSettings(ctx.sheet, ctx.cell).linkTranspose) { ts.transposeDisplay = v; ts.transposePlay = v; }
  if (Object.keys(ts).length) all[trackId] = ts; else delete all[trackId];
  putCell(doc, ctx, { trackSettings: cleanSettings(all) });
}
