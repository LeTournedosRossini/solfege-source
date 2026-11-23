/*
 * Changing the tuning of a tablature staff (properties panel). The notes KEEP THEIR PITCH (the music does not change, the notation staves linked to it
 * neither) and their strings are chosen again for the new tuning with `StringData::convertPitch` (as MuseScore's `fretChords` does): the tab numbers change.
 * A note that no longer fits (below the lowest string, or beyond the last fret) keeps its string and is counted in `failed`.
 * A linked tablature staff has no notes of its own: only its tuning is written, its projection derives the strings again.
 * To be called INSIDE `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { pitchFromName, STANDARD_TUNING, staffTimeline, capoTimeline, capoAt, convertPitch } from './capo.js';
import { maxFretOf } from './instruments.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI pitch → 'E4', 'F#3'. */
export const nameOfPitch = (p) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;

/** Tuning names of a staff, highest string first (the standard guitar tuning when none was written). */
export const staffTuningNames = (staff) => [...(getProperty(staff, PID.TUNING) ?? STANDARD_TUNING)];

export class TuningError extends Error {
  constructor(code, message) { super(message); this.name = 'TuningError'; this.code = code; }
}

/** Valid tuning for `count` strings: the names parse, are in range, and run from the highest string to the lowest. Returns the pitches. */
export function checkTuning(names, count) {
  if (!Array.isArray(names) || names.length !== count) throw new TuningError('count', `a tuning needs ${count} strings`);
  let pitches;
  try { pitches = names.map(pitchFromName); } catch { throw new TuningError('name', 'invalid note name in the tuning'); }
  if (pitches.some((p) => p < 12 || p > 96)) throw new TuningError('range', 'a string is out of range');
  return pitches;
}

/** Sets the tuning of a tablature staff; returns { changed, failed (notes that no longer fit) }. */
export function setStaffTuning(doc, movement, staff, names, { track = null } = {}) {
  const old = staffTuningNames(staff);
  const pitches = checkTuning(names, old.length);
  if (names.every((n, i) => n === old[i])) return { changed: false, failed: 0 };
  let failed = 0;
  const maxFret = track ? maxFretOf(track) : 24;
  if (staff.voices?.length) {
    const timeline = staffTimeline(movement, staff);
    const capos = capoTimeline(movement, staff, timeline);
    const refret = (notes, params) => {
      const used = [];
      for (const note of [...notes].sort((a, b) => getProperty(b, PID.PITCH) - getProperty(a, PID.PITCH))) {
        const hit = convertPitch(getProperty(note, PID.PITCH), pitches, params, used);
        if (hit && hit.fret <= maxFret) { used.push(hit.string); if (getProperty(note, PID.STRING) !== hit.string) doc.set(note, PID.STRING, hit.string); } else failed += 1;
      }
    };
    for (const t of timeline) {
      if (t.item.type !== 'chord') continue;
      const params = capoAt(capos, t.key);
      for (const g of t.item.graceNotes ?? []) refret(g.notes, params);
      refret(t.item.notes, params);
    }
  }
  doc.set(staff, PID.TUNING, [...names]);
  return { changed: true, failed };
}
