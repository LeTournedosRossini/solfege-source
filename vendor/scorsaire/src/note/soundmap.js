/*
 * Which small SoundFont holds which sound. ONE source of truth for the tool that builds the files (tools/make-note-soundfont.mjs) and for the component that loads them.
 * Programs are General Music numbers (bank 0); the drum kit is the GM standard kit. Pure: no DOM.
 *   mode 'family': one file per family, loaded on demand (note-piano.sf3, note-guitars.sf3…): a note downloads only the families its tracks use;
 *   mode 'single': one file with everything (note-all.sf3).
 */
import { programOfTrack } from '../audio/programs.js';

export const SOUND_FAMILIES = Object.freeze({
  piano: [0],
  guitars: [24, 25, 27, 33, 34], // nylon, steel, clean electric, electric bass (finger, picked)
  strings: [40, 41, 42], // violin, viola, cello
  winds: [56, 57, 60, 64, 65, 66, 67, 71, 73], // trumpet, trombone, horn, saxes, clarinet, flute
  drums: 'drums',
});
export const soundFile = (family) => `note-${family}.sf3`;
export const SINGLE_FILE = 'note-all.sf3';

/** The family that holds a General MIDI program (null when none does: the sound then falls back to the piano). */
export function familyOfProgram(program) {
  for (const [name, programs] of Object.entries(SOUND_FAMILIES)) if (Array.isArray(programs) && programs.includes(program)) return name;
  return null;
}

/** The families a sequence needs: the drum kit for a percussion track, else the family of the track's program (the piano for anything unknown). Only tracks that PLAY something count (a silent chord track needs no piano). Sorted, no duplicates. */
export function familiesOfSequence(sequence) {
  const playing = new Set((sequence?.notes ?? []).map((n) => n.track));
  const out = new Set();
  for (const t of sequence?.tracks ?? []) if (playing.has(t.id)) out.add(t.kind === 'percussion' ? 'drums' : familyOfProgram(programOfTrack(t)) ?? 'piano');
  if (!out.size) out.add('piano');
  return [...out].sort();
}
