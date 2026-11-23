/*
 * Guitar settings written on a tablature staff, without DOM: the CAPO at the selected chord and the STAFF TUNING. Each function is meant to run inside
 * `app.edit(...)` (one undoable transaction). A capo belongs to a tablature staff; when the selection is in a notation staff, it goes to the tablature
 * staff LINKED to it (its notes have no tablature content of their own: only the capo entry is written, the projection derives the frets).
 */
import { PID } from '../model/pid.js';
import { createCapo, createStringTunings } from '../model/elements.js';
import { staffTimeline, capoTimeline, capoAt, insertCapo, changeCapo, removeCapo, tuningPitches, pitchFromName } from '../model/capo.js';
import { linkedStavesOf } from '../model/linkedstaff.js';
import { markTargets } from './marks-intents.js';
import { ownerOf } from './play-intents.js';
import { instrumentInfo } from '../model/instruments.js';
import { setStaffTuning, staffTuningNames, nameOfPitch } from '../model/tuningedit.js';
import { FRETBOARD_INSTRUMENTS, TUNING_PRESETS, applyPreset } from '../model/fretboardmap.js';

export class GuitarEditError extends Error {
  constructor(code, message) { super(message); this.name = 'GuitarEditError'; this.code = code; }
}

export const CAPO_MODES = Object.freeze(['tab', 'standard', 'playback']);
export const CAPO_MAX_FRET = 12;

/** { mv, staff (the tablature staff), chord, linked } for the first chord of the selection, or null when there is no tablature to put a capo on. */
export function capoTarget(doc, { ids = [], range = null } = {}) {
  const chord = markTargets(doc, { ids, range })[0];
  if (!chord) return null;
  const staff = ownerOf(doc, chord.id, 'staff');
  if (!staff) return null;
  const mv = doc.movementOf(staff);
  if (doc.get(staff, PID.STAFF_TYPE) === 'tab') return { mv, staff, chord, linked: false };
  const tab = linkedStavesOf(mv, staff).find((s) => doc.get(s, PID.STAFF_TYPE) === 'tab');
  return tab ? { mv, staff: tab, primary: staff, chord, linked: true } : null;
}

function resolved(doc, target) {
  const { mv, staff, chord, linked, primary } = target;
  const timeline = staffTimeline(mv, linked ? primary : staff);
  const capos = capoTimeline(mv, staff, timeline);
  const at = timeline.find((t) => t.item.id === chord.id);
  const inForce = at ? capoAt(capos, at.key) : null;
  const here = capos.find((c) => c.entry.itemId === chord.id)?.entry ?? null;
  return { capos, inForce, here };
}

/** What the capo drawer shows: { available, staffId, strings, fret, ignored (strings, 1 = highest), active, mode, hasEntry } */
export function capoState(doc, selection) {
  const target = capoTarget(doc, selection);
  if (!target) return { available: false };
  const { inForce, here } = resolved(doc, target);
  const strings = tuningPitches(target.staff).length;
  const p = inForce ?? { active: false, fret: 0, ignoredStrings: [], mode: 'tab' };
  return { available: true, staffId: target.staff.id, strings, fret: p.active ? p.fret : 0, ignored: [...p.ignoredStrings], active: !!p.active, mode: p.mode === 'playback' && !here ? 'tab' : p.mode, hasEntry: !!here, maxFret: CAPO_MAX_FRET };
}

function writeList(doc, staff, list) { doc.set(staff, PID.CAPOS, list); }

/** Creates or changes the capo anchored at the selected chord. patch: { fret?, ignored?, active?, mode? } (fret 0 removes it). */
export function setCapo(doc, selection, patch) {
  const target = capoTarget(doc, selection);
  if (!target) throw new GuitarEditError('no-tab', 'a capo needs a tablature staff');
  const { mv, staff, chord, linked } = target;
  const { inForce, here } = resolved(doc, target);
  const base = inForce?.active || (patch.active !== undefined && inForce) ? inForce : { active: true, fret: 1, ignoredStrings: [], mode: 'tab' }; // (« no capo from here » keeps the fret in force; switching it back on finds it again)
  const fret = Math.min(CAPO_MAX_FRET, Math.max(0, Math.round(patch.fret ?? base.fret)));
  if (fret === 0) { if (here) return removeCapoAt(doc, target, here); return false; }
  const ignored = patch.ignored ? [...new Set(patch.ignored)].sort((a, b) => a - b) : [...base.ignoredStrings];
  const mode = CAPO_MODES.includes(patch.mode) ? patch.mode : (here ? base.mode : 'tab');
  const params = { fret, ignoredStrings: ignored, active: patch.active ?? true, mode };
  if (here) {
    if (linked) writeList(doc, staff, (doc.get(staff, PID.CAPOS) ?? []).map((e) => (e.id === here.id ? { ...e, fret, ignoredStrings: ignored, active: params.active, mode } : e)));
    else changeCapo(doc, mv, staff, here.id, { fret, ignoredStrings: ignored, active: params.active, mode });
  } else {
    const entry = createCapo(chord.id, { fret, ignoredStrings: ignored, active: params.active, mode });
    if (linked) writeList(doc, staff, [...(doc.get(staff, PID.CAPOS) ?? []), entry]);
    else insertCapo(doc, mv, staff, entry);
  }
  return true;
}

function removeCapoAt(doc, target, here) {
  if (target.linked) writeList(doc, target.staff, (doc.get(target.staff, PID.CAPOS) ?? []).filter((e) => e.id !== here.id));
  else removeCapo(doc, target.mv, target.staff, here.id);
  return true;
}

/** Removes the capo anchored at the selected chord (false when there is none). */
export function removeCapoHere(doc, selection) {
  const target = capoTarget(doc, selection);
  if (!target) throw new GuitarEditError('no-tab', 'a capo needs a tablature staff');
  const { here } = resolved(doc, target);
  return here ? removeCapoAt(doc, target, here) : false;
}

// ───────────────────────── tuning of the staff ─────────────────────────

/** The standard tuning of the instrument of the staff's track (names, highest first), else the standard one for that string count. */
function standardNames(doc, staff, count) {
  const track = ownerOf(doc, staff.id, 'track');
  const info = track ? instrumentInfo(doc.get(track, PID.INSTRUMENT_ID)) : null;
  const lowFirst = info?.strings?.length === count ? info.strings
    : Object.values(FRETBOARD_INSTRUMENTS).find((i) => i.strings.length === count && i !== FRETBOARD_INSTRUMENTS.ukulele)?.strings ?? null;
  return lowFirst ? lowFirst.slice().reverse().map(nameOfPitch) : null;
}

/** Tuning section of the properties panel: { names (highest first), standard (names | null), presets: [{ id, names }] } */
export function tuningInfo(doc, staff) {
  const names = staffTuningNames(staff);
  const standard = standardNames(doc, staff, names.length);
  const presets = [];
  if (standard) {
    for (const p of TUNING_PRESETS) {
      const lowFirst = standard.slice().reverse().map((n) => pitchFromName(n));
      const out = applyPreset(lowFirst, p.id);
      if (p.id !== 'standard' && out.every((m, i) => m === lowFirst[i])) continue;
      presets.push({ id: p.id, names: out.slice().reverse().map(nameOfPitch) });
    }
  }
  return { names, standard, presets };
}
/** Writes the tuning (names, highest first) of a tablature staff; the notes keep their pitch. Returns { changed, failed }. */
export function writeStaffTuning(doc, staffId, names) {
  const staff = doc.find(staffId);
  if (!staff || staff.type !== 'staff' || doc.get(staff, PID.STAFF_TYPE) !== 'tab') throw new GuitarEditError('no-tab', 'not a tablature staff');
  return setStaffTuning(doc, doc.movementOf(staff), staff, names, { track: ownerOf(doc, staffId, 'track') });
}

// ───────────────────────── tuning change in the middle of a piece ─────────────────────────
// Like MuseScore (`StringTunings`, `ChangeStringData`): the change is only an entry anchored at a chord. The notes are NOT rewritten: they keep their pitch
// (so the sound) and their string; the frets shown by the tablature are derived from the pitch and the tuning in force, so they follow by themselves.

const isTuningChange = (e) => Array.isArray(e.tuning) && e.tuning.length > 0;

/** What the tuning-change menu shows: { available, staffId, presets: [{ id, names }], hereId (preset or 'custom' written here, else null), hasEntry } */
export function tuningChangeState(doc, selection) {
  const target = capoTarget(doc, selection);
  if (!target) return { available: false };
  const entry = (doc.get(target.staff, PID.STRING_TUNINGS) ?? []).find((e) => e.itemId === target.chord.id && isTuningChange(e)) ?? null;
  const presets = tuningInfo(doc, target.staff).presets;
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const hereId = entry ? (presets.find((p) => same(p.names, entry.tuning))?.id ?? 'custom') : null;
  return { available: true, staffId: target.staff.id, presets, hereId, hasEntry: !!entry };
}

/** Writes (presetId) or removes (null) the tuning change anchored at the selected chord. Returns true when something changed. */
export function setTuningChange(doc, selection, presetId) {
  const target = capoTarget(doc, selection);
  if (!target) throw new GuitarEditError('no-tab', 'a tuning change needs a tablature staff');
  const { staff, chord } = target;
  const list = doc.get(staff, PID.STRING_TUNINGS) ?? [];
  const without = list.filter((e) => !(e.itemId === chord.id && isTuningChange(e)));
  let next = without;
  if (presetId) {
    const preset = tuningInfo(doc, staff).presets.find((p) => p.id === presetId);
    if (!preset) throw new GuitarEditError('unknown', 'unknown tuning preset');
    next = [...without, createStringTunings(chord.id, { tuning: preset.names })];
  }
  if (next.length === list.length && next.every((e, i) => e === list[i])) return false;
  doc.set(staff, PID.STRING_TUNINGS, next);
  return true;
}
