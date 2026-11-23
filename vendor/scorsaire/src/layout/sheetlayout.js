/*
 * Layout of a SHEET (screen 3), as a reader's device would show it: the cells of the sheet arranged in one column or in a matrix that a narrow screen
 * folds into one column, each cell holding one movement (all its tracks or the chosen ones) laid out for the width of the cell.
 *
 * Pure (no DOM). The three device presets are the screens the author cannot know in advance: a computer, a tablet, a phone.
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { resolveStyle } from '../model/props.js';
import { trackTransposition } from '../model/instruments.js';
import { intervalOfSemitones } from '../model/transpose.js';
import { resolveDisplay, trackLayer } from '../model/trackdisplay.js';
import { sheetCells, sheetShape, cellSettings, trackShift } from '../model/sheetedit.js';
import { sheetDividers } from '../model/dividers.js';
import { addSystemDividers } from './systemdividers.js';
import { layoutMovement } from './index.js';

/** The preview presets: width in CSS pixels and the size of a staff space on that device. */
export const DEVICES = Object.freeze({
  pc: { id: 'pc', width: 1280, staffSpace: 9 },
  tablet: { id: 'tablet', width: 820, staffSpace: 9 },
  phone: { id: 'phone', width: 390, staffSpace: 7 },
});
export const FOLD_WIDTH = 700; // kept for the carousel of the reader (the narrow window); the columns follow the size of the writing, see MIN_CELL_SPACES
export const SHEET_PADDING = 12;
export const SHEET_GAP = 12;
/** A cell is never narrower than this many staff spaces (36 sp ≈ 290 px with 8 px staves: a clef, a time signature and two bars of four beats). */
export const MIN_CELL_SPACES = 36;

/**
 * Columns and cell width (px) of a sheet on a device of `width` px whose staves have `staffSpace` px per space: the columns the author asked for, or fewer when
 * the cells would be narrower than MIN_CELL_SPACES staff spaces (a bigger writing folds sooner; a big screen keeps them all).
 */
export function sheetFrame(shape, width, staffSpace = 9) {
  const minCell = MIN_CELL_SPACES * staffSpace;
  const fit = Math.max(1, Math.floor((width - 2 * SHEET_PADDING + SHEET_GAP) / (minCell + SHEET_GAP)));
  const columns = shape.layout === 'matrix' ? Math.max(1, Math.min(shape.columns, fit)) : 1;
  return { columns, cellWidth: Math.floor((width - 2 * SHEET_PADDING - SHEET_GAP * (columns - 1)) / columns) };
}

const copyWith = (el, key, value) => {
  const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el)); // keeps the non-enumerable readers of the elements
  Object.defineProperty(c, key, { value, enumerable: true, writable: true, configurable: true });
  return c;
};

/**
 * The movement as a reader sees it with a display transposition of `shift` semitones (positive = the written music goes UP): each transposing track gets
 * the interval of its instrument minus the shift (a copy; the movement itself when there is nothing to change). `shift` is a number for every track or a
 * function (track) → number (a cell or a track can have its own).
 */
export function displayShifted(mv, shift) {
  const of = typeof shift === 'function' ? shift : () => shift;
  if (!mv.tracks.some((t) => of(t))) return mv;
  const tracks = mv.tracks.map((t) => {
    const n = of(t);
    if (!n) return t;
    const iv = trackTransposition(t);
    return copyWith(t, 'props', { ...t.props, [PID.TRANSPOSITION]: intervalOfSemitones((iv?.chromatic ?? 0) - n) });
  });
  return copyWith(mv, 'tracks', tracks);
}

/**
 * Every cell of the sheet laid out: [{ id, movementId, layout, tracksShown, staffSpace, width }]. `reader` = the reader options (display transposition).
 * `layoutMovement` gets the width of the cell in staff spaces; the staves of the tracks not shown are left out (`staffFilter`).
 */
/** Roles of the structure signs (repeat bars and their dots, voltas, jumps and markers, rehearsal marks, repeat counts); the time signature carries `sign`. */
const SIGN_ROLES = new Set(['repeat-dot', 'repeat-tip', 'volta', 'volta-text', 'jump', 'jump-text', 'marker', 'marker-text', 'repeat-count', 'repeat-count-text', 'rehearsal', 'rehearsal-text']);
/** Colours the structure signs of a layout (a reader's aid, as iReal Pro does); returns nothing, the items get a `tint`. */
export function tintSigns(layout, color) {
  layout.signsTint = color; // (the name cards drawn by the browser read it: a plain name takes the colour of the signs)
  const mark = (list) => { for (let i = 0; i < list.length; i++) { const it = list[i]; if ((it.sign || SIGN_ROLES.has(it.role)) && !it.tint) list[i] = { ...it, tint: color }; } };
  for (const sys of layout.systems ?? []) {
    for (const st of sys.staves ?? []) if (Array.isArray(st.items)) mark(st.items);
    if (Array.isArray(sys.overlays)) mark(sys.overlays);
  }
}

/**
 * `view` = how a reader shows a cell on a screen (the synchro and YouTube readers): { mode: 'wrap' | 'scroll' | 'fit', zoom }.
 *   wrap    lines of the width of the screen; the staff size is `staffSpace × zoom` (more lines when it grows); the band of blocks keeps the width of the screen, its texts and heights grow
 *   scroll  ONE system as long as the music; the band keeps the width the screen has at zoom 1, so it grows as a whole with the music
 *   fit     ONE system, as wide as the screen: the staff size is the biggest that fits (at most twice the normal size), the zoom can only make it smaller
 */
export function layoutSheet(work, sheet, glyphs, { device, reader = {}, getStyle, cells: cellList = null, settingsFor = null, signsColor = null, view = null } = {}) {
  const sheetDividerSettings = sheetDividers(sheet);
  const frame = sheetFrame(sheetShape(sheet), device.width, device.staffSpace);
  const cells = (cellList ?? sheetCells(work, sheet)).map((cell) => {
    const mv = work.movements.find((m) => m.id === cell.movementId);
    const settings = settingsFor ? settingsFor(cell) : cellSettings(sheet, cell); // a reader passes the settings with what the person changed on top
    const shown = displayShifted(mv, (t) => trackShift(settings, t.id, 'transposeDisplay'));
    const base = settings.staffSize ?? device.staffSpace;
    const mode = view?.mode ?? 'wrap'; const zoom = view?.zoom ?? 1;
    let staffSpace = base * (mode === 'wrap' || mode === 'scroll' ? zoom : 1);
    const staves = new Set(mv.tracks.filter((t) => !cell.tracks || cell.tracks.includes(t.id)).flatMap((t) => t.staves.map((s) => s.id)));
    const margin = view?.margin ?? 10; // a box on the video that holds no staff has no use for a margin (its blocks are placed in percent of its width)
    const usable = frame.cellWidth - 2 * margin;
    // the cell's layer over the sheet's: the names of the tracks, the tempo texts, the size and the style of the name cards
    const own = { ...(typeof settings.showNames === 'boolean' ? { [SID.SHOW_INSTRUMENT_NAMES]: settings.showNames } : {}), ...(typeof settings.showTempo === 'boolean' ? { [SID.SHOW_TEMPO_TEXTS]: settings.showTempo } : {}),
      ...(settings.cardScale != null ? { [SID.SECTION_CARD_SCALE]: settings.cardScale } : {}), ...(settings.cardStyle ? { [SID.SECTION_CARD_STYLE]: settings.cardStyle } : {}) };
    const styleOf = getStyle ?? ((sid) => resolveStyle(sid, [mv.style]));
    const cellStyle = Object.keys(own).length ? (sid) => (Object.hasOwn(own, sid) ? own[sid] : styleOf(sid)) : getStyle; // (untouched: the very same function, so that a layout cache still recognises it) // the names of the tracks: the cell's (or the sheet's, or the reader's) choice over the file's style
    const common = { getStyle: cellStyle, lowCards: true, staffFilter: staves, trackDisplay: (t) => resolveDisplay(settings.tracks[t.id], trackLayer(t)) }; // screen 3: the cell's layer over the track's
    let layout;
    if (mode === 'wrap') {
      layout = layoutMovement(shown, glyphs, { ...common, width: usable / staffSpace, justifyLast: true, bandScale: zoom, fitBand: true });
    } else if (mode === 'scroll') {
      layout = layoutMovement(shown, glyphs, { ...common, width: 100000, bandWidth: usable / base, fitBand: true });
    } else { // fit: lay out once to learn how long the music is, then size the staves to the screen
      const probe = layoutMovement(shown, glyphs, { ...common, width: 100000 });
      staffSpace = Math.min(usable / Math.max(1, probe.width), base * 2) * Math.min(1, zoom);
      layout = layoutMovement(shown, glyphs, { ...common, width: 100000, bandWidth: probe.width, bandScale: Math.min(1, zoom), fitBand: true });
    }
    if (sheetDividerSettings.left || sheetDividerSettings.right) layout.systems = addSystemDividers(layout.systems, sheetDividerSettings, glyphs); // between the systems of the cell (a single page)
    if (signsColor) tintSigns(layout, signsColor);
    return { id: cell.id, movementId: cell.movementId, layout, tracks: cell.tracks, staffSpace, margin, width: frame.cellWidth, settings, mode };
  });
  return { frame, cells };
}

