/*
 * Staff properties panel — intents (no DOM). Pure functions on the Document, called by the Application inside `app.edit(...)`:
 * every write goes through `doc.set` / `doc.reset`, so each intent is one undoable transaction.
 *
 * Sections shown by the panel depend on the staff type:
 *   percussion      → 'percmap' (open the percussion map editor) + 'sticking' (hand symbols system)
 *   accordion-left  → 'accordion' (button placement and height)
 *   tab             → 'tuning' (the strings; the notes keep their pitch, `guitar-intents.js: writeStaffTuning`)
 *   chord           → 'chordSpelling' (written by `setChordSpelling` of chordquality-intents.js) + 'chordPlayed' (see / write the notes the automatic arrangement plays) + 'display' (bars and size of the track, screen 1 layer)
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { capoStaves } from '../model/chordview.js';
import { strumInstrumentOf, autoStrumInstrument } from '../model/fretdiagram.js';
import { setPlayer } from '../model/player.js';
import { staffPercMap } from '../model/percmapedit.js';
import {
  createStickingSystem, validateStickingSystem, resolveStickingSystem, STICKING_PRESETS, STICKING_PLACEMENTS, STICKING_PRESET_SYMBOLS,
} from '../model/sticking.js';
import {
  DEFAULT_ACCORDION_LAYOUT, createAccordionLayout, validateAccordionLayout, resolveAccordionLayout, BUTTON_PLACEMENTS,
} from '../model/accordion.js';
import { ownerOf } from './play-intents.js';
import { tuningInfo } from './guitar-intents.js';

export class StaffPropertyError extends Error {
  constructor(code, message) { super(message); this.name = 'StaffPropertyError'; this.code = code; }
}

/** Sections of the panel for each staff type. */
export const SECTIONS_BY_STAFF_TYPE = Object.freeze({
  percussion: ['percmap', 'sticking'],
  'accordion-left': ['accordion'],
  chord: ['chordSpelling', 'chordPlayed', 'chordDiagrams', 'chordCapo', 'gridLyrics', 'display'],
  tab: ['tuning', 'tabDiagrams', 'arpeggio'],
  rhythm: ['strum', 'gridLyrics'],
  neutral: ['strum'],
});

export const STRUM_INSTRUMENTS = Object.freeze(['guitar', 'ukulele', 'bass', 'bass5', 'piano']);
export const STRUM_DELAY_MAX = 60;

export const OFFSET_MIN = -3;
export const OFFSET_MAX = 12;
export const OFFSET_STEP = 0.5;

const typeOf = (doc, staff) => doc.get(staff, PID.STAFF_TYPE);

/** The staff element for an id, or null when it is not a staff. */
export function staffOf(doc, staffId) {
  const el = doc.find(staffId);
  return el && el.type === 'staff' ? el : null;
}

/** Sections available for a staff (empty = the panel has nothing to show). */
export function sectionsOf(doc, staff) {
  if (typeOf(doc, staff) === 'chord' && doc.get(staff, PID.LINKED_TO)) return ['chordReading']; // a chord staff linked to another: only the way it READS the chords
  const sections = SECTIONS_BY_STAFF_TYPE[typeOf(doc, staff)] ?? [];
  return sections.includes('chordCapo') && !capoStaves(doc.movementOf(staff)).length ? sections.filter((s) => s !== 'chordCapo') : sections; // (the capo choice only appears when a guitar has a capo)
}

/** Read-only snapshot used to draw the panel. */
export function staffProperties(doc, staffId) {
  const staff = staffOf(doc, staffId);
  if (!staff) return null;
  const type = typeOf(doc, staff);
  const sections = sectionsOf(doc, staff);
  const track = ownerOf(doc, staffId, 'track');
  const info = { staffId, type, trackName: track ? (doc.get(track, PID.NAME) ?? '') : '', sections };
  if (sections.includes('percmap')) {
    const map = staffPercMap(staff);
    info.percmap = { name: map.name, soundCount: map.sounds.length };
  }
  if (sections.includes('sticking')) {
    const movement = doc.movementOf(staff);
    const resolved = resolveStickingSystem(doc.get(staff, PID.STICKING_SYSTEM) ?? null, (sid) => doc.getStyle(movement, sid));
    info.sticking = { preset: resolved.preset, placement: resolved.placement, right: resolved.symbols.right, left: resolved.symbols.left };
  }
  if (sections.includes('accordion')) info.accordion = resolveAccordionLayout(doc.get(staff, PID.ACCORDION_LAYOUT) ?? null);
  if (sections.includes('strum')) {
    info.strum = { enabled: doc.get(staff, PID.STRUM) === true, card: doc.get(staff, PID.STRUM_CARD) ?? null, pattern: doc.get(staff, PID.STRUM_PATTERN) ?? null, delayMs: doc.get(staff, PID.STRUM_DELAY) ?? null, path: doc.get(staff, PID.STRUM_PATH), diagrams: doc.get(staff, PID.STRUM_DIAGRAMS), diagramScale: doc.get(staff, PID.DIAGRAM_STAFF_SCALE) ?? 1, instrument: doc.get(staff, PID.STRUM_INSTRUMENT), resolved: strumInstrumentOf(track, staff) };
  }
  if (sections.includes('chordPlayed')) info.chordPlayed = { pattern: doc.get(track, PID.PLAYER_PATTERN) ?? null, card: doc.get(track, PID.PLAYER_CARD) ?? null, instrument: doc.get(track, PID.PLAYER_INSTRUMENT) ?? 'auto', auto: ((a) => (a === 'piano' ? 'guitar' : a))(autoStrumInstrument(track)) };
  if (sections.includes('chordDiagrams')) { // the tablature staves the diagrams of the chord symbols may read their fingering from
    const mv = doc.movementOf(staff);
    const tabs = mv.tracks.flatMap((t) => t.staves.filter((s) => doc.get(s, PID.STAFF_TYPE) === 'tab').map((s) => ({ id: s.id, name: doc.get(t, PID.NAME) || '—' })));
    const chosen = doc.get(staff, PID.DIAGRAM_TAB_STAFF) ?? null;
    info.chordDiagrams = { tabStaff: tabs.some((x) => x.id === chosen) ? chosen : null, tabs, mode: doc.get(staff, PID.CHORD_DIAGRAMS) ?? 'off' };
  }
  if (sections.includes('tabDiagrams')) info.tabDiagrams = { mode: doc.get(staff, PID.TAB_DIAGRAMS) ?? 'off', min: doc.get(staff, PID.TAB_DIAGRAMS_MIN) ?? 2, scale: doc.get(staff, PID.DIAGRAM_STAFF_SCALE) ?? 1 };
  if (sections.includes('arpeggio') && track) { // the arpeggio sign speed of the whole track (its own override, else what the movement says; 0 = automatic)
    info.arpeggio = { trackId: track.id, stepMs: (getProperty(track, PID.STYLE_OVERRIDES) ?? {})[SID.ARPEGGIO_STEP_MS] ?? null, inherited: doc.getStyle(doc.movementOf(staff), SID.ARPEGGIO_STEP_MS) ?? 0 };
  }
  if (sections.includes('chordCapo')) { const cs = capoStaves(doc.movementOf(staff)); const chosen = doc.get(staff, PID.CHORD_CAPO_STAFF) ?? null; info.chordCapo = { staves: cs, chosen: cs.some((x) => x.id === chosen) ? chosen : null }; }
  if (sections.includes('chordReading')) info.chordReading = { view: doc.get(staff, PID.CHORD_STAFF_VIEW) ?? 'capo', shift: doc.get(staff, PID.CHORD_STAFF_SHIFT) ?? 0 };
  if (sections.includes('gridLyrics')) info.gridLyrics = doc.get(staff, PID.GRID_LYRICS);
  if (sections.includes('tuning')) info.tuning = tuningInfo(doc, staff);
  if (sections.includes('chordSpelling')) info.chordSpelling = doc.get(staff, PID.CHORD_SPELLING);
  if (sections.includes('display')) { const track = doc.parentOf(staff.id); info.display = { trackId: track.id, own: track.props[PID.TRACK_DISPLAY] ?? null }; }
  return info;
}

function requireSection(doc, staffId, section) {
  const staff = staffOf(doc, staffId);
  if (!staff) throw new StaffPropertyError('no-staff', `unknown staff: ${staffId}`);
  if (!sectionsOf(doc, staff).includes(section)) throw new StaffPropertyError('wrong-type', `the property "${section}" does not apply to a staff of type ${typeOf(doc, staff)}`);
  return staff;
}

/**
 * Sets the sticking system of a percussion staff from a partial change { preset?, placement?, right?, left? }.
 * Symbols are { text } (1 to 4 characters) or { glyph }. Switching to 'custom' starts from the symbols in force.
 * Returns true when something changed. A system equal to the default (letters R/L, style placement) is not stored.
 */
export function setStickingSystem(doc, staffId, patch) {
  const staff = requireSection(doc, staffId, 'sticking');
  const stored = doc.get(staff, PID.STICKING_SYSTEM) ?? null;
  const current = resolveStickingSystem(stored, null);
  const preset = patch.preset ?? current.preset;
  if (!STICKING_PRESETS.includes(preset)) throw new StaffPropertyError('invalid', `unknown sticking preset: ${patch.preset}`);
  const placement = Object.hasOwn(patch, 'placement') ? patch.placement : stored?.placement;
  if (placement != null && !STICKING_PLACEMENTS.includes(placement)) throw new StaffPropertyError('invalid', `invalid sticking placement: ${placement}`);
  const next = { preset };
  if (placement) next.placement = placement;
  if (preset === 'custom') {
    const base = stored?.preset === 'custom' ? stored : STICKING_PRESET_SYMBOLS[current.preset] ?? STICKING_PRESET_SYMBOLS['letters-rl'];
    next.right = patch.right ?? base.right;
    next.left = patch.left ?? base.left;
  }
  const errors = validateStickingSystem(next);
  if (errors.length) throw new StaffPropertyError('invalid', errors[0]);
  const isDefault = preset === 'letters-rl' && !placement;
  if (isDefault) {
    if (stored == null) return false;
    doc.reset(staff, PID.STICKING_SYSTEM);
    return true;
  }
  const system = createStickingSystem(next);
  if (JSON.stringify(system) === JSON.stringify(stored)) return false;
  doc.set(staff, PID.STICKING_SYSTEM, system);
  return true;
}

/**
 * Strum settings of a rhythm staff from a partial change { enabled?, pattern?, delayMs? (null = from the tempo), instrument? }.
 * The sound is the track's (open mode): `instrument` only chooses the fingering the strokes play.
 */
export function setStrum(doc, staffId, patch) {
  const staff = requireSection(doc, staffId, 'strum');
  if (patch.pattern != null && !['down', 'alternate'].includes(patch.pattern)) throw new StaffPropertyError('invalid', `unknown strum pattern "${patch.pattern}"`);
  if (patch.instrument !== undefined && patch.instrument !== 'auto' && !STRUM_INSTRUMENTS.includes(patch.instrument)) throw new StaffPropertyError('invalid', `unknown strum instrument "${patch.instrument}"`);
  if (patch.delayMs != null && !(patch.delayMs >= 0 && patch.delayMs <= STRUM_DELAY_MAX)) throw new StaffPropertyError('invalid', `strum delay must lie in [0, ${STRUM_DELAY_MAX}] ms`);
  const put = (pid, value, dflt) => { if (value === dflt) { if (doc.get(staff, pid) !== dflt) doc.reset(staff, pid); } else doc.set(staff, pid, value); };
  if (patch.enabled !== undefined) put(PID.STRUM, patch.enabled === true, false);
  if (patch.path !== undefined) {
    if (!['off', 'easy', 'balanced', 'close'].includes(patch.path)) throw new StaffPropertyError('invalid', `unknown strum path "${patch.path}"`);
    put(PID.STRUM_PATH, patch.path, 'balanced');
  }
  if (patch.diagrams !== undefined) {
    if (!['off', 'changes', 'first', 'all'].includes(patch.diagrams)) throw new StaffPropertyError('invalid', `unknown strum diagrams mode "${patch.diagrams}"`);
    put(PID.STRUM_DIAGRAMS, patch.diagrams, 'off');
  }
  if (patch.diagramScale !== undefined) put(PID.DIAGRAM_STAFF_SCALE, cleanDiagramScale(patch.diagramScale), 1);
  if (patch.pattern !== undefined) put(PID.STRUM_PATTERN, patch.pattern, null);
  if (patch.card !== undefined) put(PID.STRUM_CARD, patch.card === 'standard' ? null : patch.card, null);
  if (patch.delayMs !== undefined) put(PID.STRUM_DELAY, patch.delayMs === null ? null : Math.round(patch.delayMs), null);
  if (patch.instrument !== undefined) put(PID.STRUM_INSTRUMENT, patch.instrument, 'auto');
  return true;
}

/** The tablature staff the diagrams of the chord symbols of a CHORD staff read their fingering from (`null` = the proposed fingering). */
export function setDiagramTabStaff(doc, staffId, tabStaffId) {
  const staff = requireSection(doc, staffId, 'chordDiagrams');
  if (tabStaffId == null) { if (doc.get(staff, PID.DIAGRAM_TAB_STAFF)) doc.reset(staff, PID.DIAGRAM_TAB_STAFF); return true; }
  const tab = doc.find(tabStaffId);
  if (!tab || doc.get(tab, PID.STAFF_TYPE) !== 'tab') throw new StaffPropertyError('invalid', `"${tabStaffId}" is not a tablature staff`);
  doc.set(staff, PID.DIAGRAM_TAB_STAFF, tabStaffId);
  return true;
}

/** The diagrams a CHORD staff draws by itself above its symbols: 'off' | 'voicing' (a chord the first time, then only when its fingering changes) | 'all'. */
/** The staff whose capos give the « capo shapes » of the chords of this chord staff (`null` = automatic: the first staff that has capos). */
export function setChordCapoStaff(doc, staffId, capoStaffId) {
  const staff = requireSection(doc, staffId, 'chordCapo');
  if (capoStaffId) { if (!capoStaves(doc.movementOf(staff)).some((x) => x.id === capoStaffId)) throw new StaffPropertyError('invalid', 'that staff has no capo'); doc.set(staff, PID.CHORD_CAPO_STAFF, capoStaffId); } else if (doc.get(staff, PID.CHORD_CAPO_STAFF)) doc.reset(staff, PID.CHORD_CAPO_STAFF);
  return true;
}

/** How a chord staff LINKED to another one reads the chords (read only display): `view` 'capo' | 'author' | 'shift', `shift` semitones (-11..11) for 'shift'. */
export function setChordReading(doc, staffId, { view, shift } = {}) {
  const staff = requireSection(doc, staffId, 'chordReading');
  if (view !== undefined) { if (!['capo', 'author', 'shift'].includes(view)) throw new StaffPropertyError('invalid', `unknown reading: ${view}`); doc.set(staff, PID.CHORD_STAFF_VIEW, view); }
  if (shift !== undefined) { if (!Number.isInteger(shift) || Math.abs(shift) > 11) throw new StaffPropertyError('invalid', 'a shift is a whole number of semitones, 11 at most'); doc.set(staff, PID.CHORD_STAFF_SHIFT, shift); }
  return true;
}

export function setChordDiagramsMode(doc, staffId, mode) {
  const staff = requireSection(doc, staffId, 'chordDiagrams');
  if (!['off', 'voicing', 'all'].includes(mode)) throw new StaffPropertyError('invalid', `unknown mode: ${mode}`);
  if (mode === 'off') { if (doc.get(staff, PID.CHORD_DIAGRAMS) && doc.get(staff, PID.CHORD_DIAGRAMS) !== 'off') doc.reset(staff, PID.CHORD_DIAGRAMS); } else doc.set(staff, PID.CHORD_DIAGRAMS, mode);
  return true;
}

/** The diagrams a TABLATURE staff draws by itself above its chords: `mode` 'off' | 'changes' | 'all', `min` strings a chord needs to count (2 to 6). */
export const DIAGRAM_SCALE_MIN = 0.5, DIAGRAM_SCALE_MAX = 2, DIAGRAM_SCALE_STEP = 0.1;
function cleanDiagramScale(v) {
  if (!Number.isFinite(v) || v < DIAGRAM_SCALE_MIN - 1e-9 || v > DIAGRAM_SCALE_MAX + 1e-9) throw new StaffPropertyError('invalid', `diagram size must lie in [${DIAGRAM_SCALE_MIN}, ${DIAGRAM_SCALE_MAX}]`);
  return Math.round(v * 100) / 100;
}
export function setTabDiagrams(doc, staffId, { mode, min, scale } = {}) {
  const staff = requireSection(doc, staffId, 'tabDiagrams');
  if (mode !== undefined) {
    if (!['off', 'changes', 'first', 'all'].includes(mode)) throw new StaffPropertyError('invalid', `unknown diagrams mode "${mode}"`);
    if (mode === 'off') { if (doc.get(staff, PID.TAB_DIAGRAMS) !== 'off') doc.reset(staff, PID.TAB_DIAGRAMS); } else doc.set(staff, PID.TAB_DIAGRAMS, mode);
  }
  if (scale !== undefined) {
    const v = cleanDiagramScale(scale);
    if (v === 1) { if (doc.get(staff, PID.DIAGRAM_STAFF_SCALE) !== 1) doc.reset(staff, PID.DIAGRAM_STAFF_SCALE); } else doc.set(staff, PID.DIAGRAM_STAFF_SCALE, v);
  }
  if (min !== undefined) {
    if (!Number.isInteger(min) || min < 2 || min > 6) throw new StaffPropertyError('invalid', 'the minimum number of strings lies in [2, 6]');
    if (min === 2) { if (doc.get(staff, PID.TAB_DIAGRAMS_MIN) !== 2) doc.reset(staff, PID.TAB_DIAGRAMS_MIN); } else doc.set(staff, PID.TAB_DIAGRAMS_MIN, min);
  }
  return true;
}

/** Whether the grid lyrics are drawn under a chord or rhythm staff: 'auto' | 'on' | 'off'. */
export function setGridLyrics(doc, staffId, mode) {
  const staff = requireSection(doc, staffId, 'gridLyrics');
  if (!['auto', 'on', 'off'].includes(mode)) throw new StaffPropertyError('invalid', `unknown grid lyrics mode "${mode}"`);
  if (mode === 'auto') { if (doc.get(staff, PID.GRID_LYRICS) !== 'auto') doc.reset(staff, PID.GRID_LYRICS); } else doc.set(staff, PID.GRID_LYRICS, mode);
  return true;
}

/**
 * Pattern, card and fingering instrument of the PLAYER of the track of a CHORD staff (the chord track plays with its own player; other tracks have theirs, see `model/player.js`)
 * from a partial change { pattern? (id, null = none), card? (id, null = the piano card), instrument? ('auto' or one of `STRUM_INSTRUMENTS`) }.
 */
export function setChordPattern(doc, staffId, patch) {
  requireSection(doc, staffId, 'chordPlayed');
  const track = ownerOf(doc, staffId, 'track');
  if (patch.instrument !== undefined && patch.instrument !== 'auto' && !STRUM_INSTRUMENTS.includes(patch.instrument)) throw new StaffPropertyError('invalid', `unknown strum instrument "${patch.instrument}"`);
  setPlayer(doc, track, { pattern: patch.pattern, card: patch.card === undefined ? undefined : patch.card === 'piano' || patch.card === '' ? null : patch.card, instrument: patch.instrument });
  return true;
}

/**
 * Sets the button layout of an accordion left-hand staff from a partial change { buttonPlacement?, buttonOffset? }.
 * The offset is rounded to the step (0.5 space) and must lie in [-3, 12]. A layout equal to the default is not stored.
 */
export function setAccordionLayout(doc, staffId, patch) {
  const staff = requireSection(doc, staffId, 'accordion');
  const stored = doc.get(staff, PID.ACCORDION_LAYOUT) ?? null;
  const current = resolveAccordionLayout(stored);
  const next = createAccordionLayout({
    buttonPlacement: patch.buttonPlacement ?? current.buttonPlacement,
    buttonOffset: patch.buttonOffset === undefined ? current.buttonOffset : Math.round(patch.buttonOffset / OFFSET_STEP) * OFFSET_STEP,
  });
  const errors = validateAccordionLayout(next);
  if (errors.length) throw new StaffPropertyError('invalid', errors[0]);
  const isDefault = next.buttonPlacement === DEFAULT_ACCORDION_LAYOUT.buttonPlacement && next.buttonOffset === DEFAULT_ACCORDION_LAYOUT.buttonOffset;
  if (isDefault) {
    if (stored == null) return false;
    doc.reset(staff, PID.ACCORDION_LAYOUT);
    return true;
  }
  if (stored && stored.buttonPlacement === next.buttonPlacement && stored.buttonOffset === next.buttonOffset) return false;
  doc.set(staff, PID.ACCORDION_LAYOUT, next);
  return true;
}

export { BUTTON_PLACEMENTS };
