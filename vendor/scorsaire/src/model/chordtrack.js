/*
 * The chord track: a track whose staff is a CHORD staff (chord symbols, no music). Decided with Jean (18/10/2026): a movement has AT MOST ONE chord track and
 * when it has one it is ALWAYS THE FIRST track (the top of the score). The edit gestures keep the rule (`trackedit.js`), the file validator checks it and the
 * file migration 47 → 48 moves the chord track to the top. Fragments (short scores inside containers) are not concerned.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

/** True when one of the staves of the track is a chord staff. */
export const isChordTrack = (track) => (track.staves ?? []).some((s) => getProperty(s, PID.STAFF_TYPE) === 'chord');

/** The chord tracks of a movement, in order. */
export const chordTracksOf = (mv) => mv.tracks.filter(isChordTrack);

/** The (first) chord track of a movement, or null. */
export const chordTrackOf = (mv) => chordTracksOf(mv)[0] ?? null;

/** Problems of the movement against the rule (empty = fine): more than one chord track, or a chord track that is not the first track. */
export function chordTrackProblems(mv) {
  const out = [];
  const chords = chordTracksOf(mv);
  if (chords.length > 1) out.push(`mouvement ${mv.id} : plus d'une piste d'accords (${chords.length}) ; il ne peut y en avoir qu'une`);
  if (chords.length && mv.tracks[0] !== chords[0]) out.push(`mouvement ${mv.id} : la piste d'accords doit être la première piste`);
  return out;
}

/** Moves the chord track to the top when it is not there. To call inside `doc.transaction`. Returns true when something moved. */
export function ensureChordFirst(doc, mv) {
  const chord = chordTrackOf(mv);
  if (!chord || mv.tracks[0] === chord) return false;
  doc.remove(chord);
  doc.add(mv, 'tracks', chord, 0);
  return true;
}

/** Pure: the tracks with the chord tracks first (stable). For data that is built, not edited (a new score, a demo). */
export function chordFirst(tracks) {
  return [...tracks.filter(isChordTrack), ...tracks.filter((t) => !isChordTrack(t))];
}
