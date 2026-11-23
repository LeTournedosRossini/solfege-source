/*
 * Score settings (NO DOM): the style options of a movement that the user can change from the settings panel. Each entry is a style (`SID`)
 * of the movement; "local" = the movement overrides the default. Writes go through `doc.setStyle` / `doc.resetStyle` (call inside `app.edit`).
 */
import { SID, TRACK_STYLE_SIDS } from '../model/sid.js';
import { PID } from '../model/pid.js';
import { resolveStyle, getProperty } from '../model/props.js';

/** Sections of the settings panel, in order. `type`: 'bool' | 'number' (with min / max / step); `requires`: another bool setting that enables this one. */
export const SETTINGS_SECTIONS = Object.freeze([
  { id: 'page', items: [
    { sid: 'ENABLE_INDENTATION_ON_FIRST_SYSTEM', type: 'bool' },
    { sid: 'FIRST_SYSTEM_INDENTATION_VALUE', type: 'number', min: 0, max: 20, step: 0.5, requires: 'ENABLE_INDENTATION_ON_FIRST_SYSTEM' },
    { sid: 'MIN_VERTICAL_DISTANCE', type: 'number', min: 0, max: 4, step: 0.25 },
    { sid: 'STAFF_DISTANCE', type: 'number', min: 3, max: 14, step: 0.5 },
    { sid: 'MEASURE_SPACING', type: 'number', min: 1.2, max: 2, step: 0.05 },
    { sid: 'SHAPE_SPACING', type: 'bool' },
    { sid: 'REPEAT_BAR_TIPS', type: 'bool' },
  ] },
  { id: 'notation', items: [
    { sid: 'BEAM_BY_BEAT', type: 'bool' },
    { sid: 'GEN_COURTESY_KEYSIG', type: 'bool' },
    { sid: 'GEN_COURTESY_TIMESIG', type: 'bool' },
    { sid: 'COMBINE_VOICE', type: 'bool' },
    { sid: 'SHORTEN_STEM', type: 'bool' },
    { sid: 'USE_STRAIGHT_NOTE_FLAGS', type: 'bool' },
    { sid: 'STAFF_LINE_THICKNESS', type: 'number', min: 0.08, max: 0.25, step: 0.01 },
    { sid: 'STEM_THICKNESS', type: 'number', min: 0.08, max: 0.2, step: 0.01 },
    { sid: 'BEAM_THICKNESS', type: 'number', min: 0.4, max: 0.7, step: 0.05 },
    { sid: 'LEDGER_LINE_THICKNESS', type: 'number', min: 0.08, max: 0.25, step: 0.01 },
  ] },
  { id: 'chords', items: [
    { sid: 'CHORD_FONT_FAMILY', type: 'choice', options: ["'Barlow Condensed','JetBrains Mono',monospace", "'JetBrains Mono',monospace"] },
    { sid: 'CHORD_FONT_WEIGHT', type: 'choice', options: [400, 500, 600, 700] },
    { sid: 'CHORD_DELTA_STYLE', type: 'choice', options: ['round', 'sym', 'text'] },
    { sid: 'CHORD_LETTER_SPACING', type: 'number', min: -0.2, max: 0.3, step: 0.01 },
  ] },
  { id: 'sections', items: [
    { sid: 'SECTION_COLORS_SHOW', type: 'bool' },
    { sid: 'SECTION_COLOR_STRENGTH', type: 'number', min: 0.05, max: 0.6, step: 0.05, requires: 'SECTION_COLORS_SHOW' },
  ] },
  { id: 'voltas', items: [
    { sid: 'VOLTA_TEXT_SIZE', type: 'number', min: 0.4, max: 3, step: 0.05 },
    { sid: 'VOLTA_LINE_WIDTH', type: 'number', min: 0.03, max: 0.5, step: 0.01 },
    { sid: 'VOLTA_CORNER_RADIUS', type: 'number', min: 0, max: 2, step: 0.1 },
  ] },
  { id: 'text', items: [
    { sid: 'LYRICS_FONT_SIZE', type: 'number', min: 6, max: 16, step: 0.5 },
    { sid: 'LYRICS_HOLD_LINE', type: 'bool' },
    { sid: 'FINGERING_FONT_SIZE', type: 'number', min: 5, max: 14, step: 0.5 },
    { sid: 'USE_FRACTION_CHARACTERS', type: 'bool' },
  ] },
  { id: 'guitar', items: [
    { sid: 'DIAGRAM_LIFT', type: 'number', min: 0, max: 10, step: 0.25 },
    { sid: 'HOPO_SHOW_ON_STANDARD', type: 'bool' },
    { sid: 'HOPO_UPPER_CASE', type: 'bool' },
    { sid: 'HOPO_SHOW_ALL', type: 'bool' },
    { sid: 'GUITAR_BEND_USE_FULL', type: 'bool' },
    { sid: 'SHOW_FRET_ON_FULL_BEND_RELEASE', type: 'bool' },
    { sid: 'ALIGN_PRE_BEND_AND_PRE_DIVE_TO_GRACE_NOTE', type: 'bool' },
    { sid: 'GUITAR_DIVES_ABOVE_STAFF', type: 'bool' },
  ] },
  { id: 'playback', items: [
    { sid: 'MUTED_NOTE_DURATION', type: 'number', min: 0.05, max: 1, step: 0.05 },
    { sid: 'MUTED_NOTE_VELOCITY', type: 'number', min: -60, max: 0, step: 5 },
    { sid: 'ARPEGGIO_STEP_MS', type: 'number', min: 0, max: 250, step: 5 },
  ] },
  { id: 'tablature', items: [
    { sid: 'TAB_STRING_GAUGE', type: 'bool' },
    { sid: 'TAB_STRING_LETTERS', type: 'bool' },
    { sid: 'HOPO_SHOW_ON_TAB', type: 'bool' },
    { sid: 'PALM_MUTE_SHOW_TAB_COMMON', type: 'bool' },
    { sid: 'LET_RING_SHOW_TAB_COMMON', type: 'bool' },
    { sid: 'HARMONIC_MARK_SHOW_TAB_COMMON', type: 'bool' },
  ] },
]);

const ALL = SETTINGS_SECTIONS.flatMap((s) => s.items);

/** Options that only mean something on a tablature staff: offered only when a staff of that type exists (movement) / in the track. */
const TAB_ONLY = new Set(['TAB_STRING_GAUGE', 'TAB_STRING_LETTERS', 'HOPO_SHOW_ON_TAB', 'PALM_MUTE_SHOW_TAB_COMMON', 'LET_RING_SHOW_TAB_COMMON', 'HARMONIC_MARK_SHOW_TAB_COMMON']);
const hasTabStaff = (tracks) => tracks.some((t) => t.staves.some((s) => getProperty(s, PID.STAFF_TYPE) === 'tab'));

export class SettingError extends Error {}

const def = (sid) => {
  const d = ALL.find((i) => i.sid === sid);
  if (!d) throw new SettingError(`Unknown setting: ${sid}`);
  return d;
};

/** Snapshot of the settings of a movement: sections with the resolved value and whether the movement overrides the default. */
export function settingsSnapshot(movement) {
  const value = (sid) => resolveStyle(SID[sid], [movement.style]);
  const tabs = hasTabStaff(movement.tracks);
  return SETTINGS_SECTIONS.map((section) => ({
    id: section.id,
    items: section.items.filter((item) => tabs || !TAB_ONLY.has(item.sid)).map((item) => ({
      ...item,
      value: value(item.sid),
      local: Object.hasOwn(movement.style ?? {}, SID[item.sid]),
      enabled: item.requires ? value(item.requires) === true : true,
    })),
  })).filter((section) => section.items.length);
}

/** Set one setting (validated against its definition). */
export function setSetting(doc, movement, sid, value) {
  const d = def(sid);
  if (d.type === 'bool' && typeof value !== 'boolean') throw new SettingError('A yes / no value is expected');
  if (d.type === 'choice' && !d.options.includes(value)) throw new SettingError('Not one of the offered values');
  if (d.type === 'number') {
    if (!Number.isFinite(value)) throw new SettingError('A number is expected');
    value = Number(Math.min(d.max, Math.max(d.min, Math.round(value / d.step) * d.step)).toFixed(4));
  }
  doc.setStyle(movement, SID[sid], value);
  return value;
}

/** Back to the default of one setting (the movement no longer overrides it). */
export function resetSetting(doc, movement, sid) {
  def(sid);
  return doc.resetStyle(movement, SID[sid]);
}

/** Back to the defaults for every setting of the panel. Returns the number reset. */
export function resetAllSettings(doc, movement) {
  let n = 0;
  for (const item of ALL) if (doc.resetStyle(movement, SID[item.sid])) n++;
  return n;
}

// ---------- per-track overrides ----------

/** The options a track may override (a subset of the panel's options: the others shape the system shared by every track). */
export const TRACK_SETTINGS = Object.freeze(TRACK_STYLE_SIDS.map((sid) => ALL.find((i) => i.sid === sid)).filter(Boolean));

/** For each track of the movement: its name and, per overridable option, `value` (true / false / null = follows the movement). */
export function trackSettingsSnapshot(movement) {
  return movement.tracks.map((track, i) => {
    const overrides = getProperty(track, PID.STYLE_OVERRIDES) ?? {};
    return {
      id: track.id,
      name: getProperty(track, PID.NAME) || `${i + 1}`,
      options: TRACK_SETTINGS.filter((item) => !TAB_ONLY.has(item.sid) || hasTabStaff([track])).map((item) => ({
        sid: item.sid,
        value: Object.hasOwn(overrides, SID[item.sid]) ? overrides[SID[item.sid]] : null,
        inherited: resolveStyle(SID[item.sid], [movement.style]),
        ...(item.type === 'number' ? { type: 'number', min: item.min, max: item.max, step: item.step } : {}),
      })),
    };
  }).filter((t) => t.options.length);
}

/** Set (true / false) or clear (null) one override of a track. Call inside `app.edit`. */
export function setTrackSetting(doc, trackId, sid, value) {
  const track = doc.find(trackId);
  if (!track || track.type !== 'track') throw new SettingError('Track expected');
  if (!TRACK_STYLE_SIDS.includes(sid)) throw new SettingError(`Option « ${sid} » is not a per-track option`);
  const numeric = ALL.find((i) => i.sid === sid)?.type === 'number';
  if (value !== null && (numeric ? !Number.isFinite(value) : typeof value !== 'boolean')) throw new SettingError(numeric ? 'A number, or null, is expected' : 'A yes / no value, or null, is expected');
  if (numeric && value !== null) { const d = ALL.find((i) => i.sid === sid); value = Number(Math.min(d.max, Math.max(d.min, Math.round(value / d.step) * d.step)).toFixed(4)); }
  const next = { ...(getProperty(track, PID.STYLE_OVERRIDES) ?? {}) };
  if (value === null) delete next[SID[sid]]; else next[SID[sid]] = value;
  if (Object.keys(next).length) doc.set(track, PID.STYLE_OVERRIDES, next);
  else if (getProperty(track, PID.STYLE_OVERRIDES)) doc.reset(track, PID.STYLE_OVERRIDES);
}
