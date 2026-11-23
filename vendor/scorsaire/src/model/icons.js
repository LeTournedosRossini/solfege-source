/*
 * Track icons: a small picture written on the score instead of the name (option of the movement, `SID.INSTRUMENT_NAME_*`).
 * They are glyphs of the SMuFL font (Bravura, SIL OFL): the percussion pictograms (`pict*`), the three clefs and a note.
 * `ICONS` lists the names the user can choose from; the painting side (layout/instrumentnames.js) draws them at a fixed height.
 */
const GLYPH_ICONS = Object.freeze([
  // drums and cymbals
  'pictSnareDrum', 'pictBassDrum', 'pictTomTom', 'pictTenorDrum', 'pictHiHat', 'pictCrashCymbals', 'pictSuspendedCymbal', 'pictTimpani',
  // hand percussion
  'pictConga', 'pictBongos', 'pictTimbales', 'pictTambourine', 'pictTriangle', 'pictCowBell', 'pictClaves', 'pictWoodBlock', 'pictMaracas',
  'pictGuiro', 'pictCastanets', 'pictSleighBell', 'pictGong', 'pictTamTam',
  // pitched percussion
  'pictGlsp', 'pictXyl', 'pictVib', 'pictMar', 'pictCrotales', 'pictTubularBells', 'pictCelesta', 'pictSteelDrums',
  // general
  'gClef', 'fClef', 'cClef', 'noteQuarterUp',
]);

import { hasIconShape } from './iconshapes.js';
import { LIBRARY } from './icon-library.js';
import { INSTRUMENT_ICON_NAMES } from './instrument-icons.js';

/** Instrument icons of the interface (`ui:<name>`): strokes, drawn by the score renderer like a glyph. The photograph icon is not a choice. */
export const UI_ICONS = Object.freeze(INSTRUMENT_ICON_NAMES.filter((n) => n !== 'soprano-photo').map((n) => `ui:${n}`));
/** The whole icon library (334 icons, `ui:<family-id>`): offered too, after the others; the 53 retained ones are already in `UI_ICONS`. */
const LIBRARY_ICONS = Object.freeze(Object.keys(LIBRARY).map((n) => `ui:${n}`).filter((n) => !UI_ICONS.includes(n)));
const SET = new Set([...GLYPH_ICONS, ...UI_ICONS, ...LIBRARY_ICONS]);
/** The choices offered for a track icon: SMuFL pictograms, then the instrument icons, then the rest of the icon library. */
export const ICONS = Object.freeze([...GLYPH_ICONS, ...UI_ICONS, ...LIBRARY_ICONS]);
export const isTrackIcon = (name) => SET.has(name) || (typeof name === 'string' && name.startsWith('ui:') && hasIconShape(name.slice(3)));
