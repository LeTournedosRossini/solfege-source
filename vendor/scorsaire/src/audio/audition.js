/*
 * Hearing a note as it is placed (decided with Jean, 20/10/2026): a tiny one-track SEQUENCE of the notes of the chord(s) just entered or retouched, played
 * by the current engine through its normal contract (`load` + `play`), so the timbre, the program, the percussion sound or the accordion row are exactly
 * those of the real playback. PURE (no DOM): `buildAuditionSequence(doc, ids)` → a sequence or null; `createAuditioner` runs it (and cuts the previous one).
 * The whole chord is heard, so a note added above or below another sounds as a chord.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { actualDuration } from '../model/pitch.js';
import { fToNumber } from '../model/fraction.js';
import { NO_CAPO, tuningPitches } from '../model/capo.js';
import { staffSoundMap } from '../model/percmap.js';
import { resolveStradellaTable } from '../model/stradella.js';
import { instrumentInfo } from '../model/instruments.js';
import { savedMixer } from './mixer.js';
import { notePitches } from './sequence.js';

const NOTE_TYPES = new Set(['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);
const SOUNDING_STAFF = new Set(['score', 'tab', 'percussion', 'accordion-left', 'rhythm', 'neutral']);

/** Seconds a written duration lasts at 120 quarter notes per minute (a whole note = 2 s), kept between `min` and `max`. */
const secondsOf = (chord, min, max) => {
  const d = getProperty(chord, PID.DURATION); const tuplet = getProperty(chord, PID.TUPLET);
  const s = d ? fToNumber(actualDuration(d, tuplet)) * 2 : 0.5;
  return Math.min(max, Math.max(min, s));
};

/** The track record of an audition sequence: the instrument, and whether it plays pitches or percussion, with the mixer the track has. */
function trackRecord(doc, track) {
  const types = track.staves.map((s) => getProperty(s, PID.STAFF_TYPE));
  const instrumentId = getProperty(track, PID.INSTRUMENT_ID) ?? null;
  return {
    id: track.id, name: getProperty(track, PID.NAME), instrumentId, family: instrumentInfo(instrumentId)?.family ?? null,
    kind: types.length && types.every((t) => ['percussion', 'rhythm', 'neutral'].includes(t)) ? 'percussion' : 'pitched',
    mixer: savedMixer(track, doc.work),
  };
}

/**
 * @param doc  the Document ; @param ids  ids of notes or chords (what was just entered / changed)
 * @returns a sequence ready for `engine.load` (one note event per pitch), or null when nothing is playable
 */
export function buildAuditionSequence(doc, ids, { velocity = 80, minSeconds = 0.3, maxSeconds = 1.2 } = {}) {
  const chords = new Map();
  for (const id of ids ?? []) {
    let el = doc.find(id);
    if (el && NOTE_TYPES.has(el.type)) el = doc.parentOf(el.id);
    if (el?.type === 'chord') chords.set(el.id, el);
  }
  const notes = []; const tracks = new Map();
  const stradella = resolveStradellaTable(undefined);
  for (const chord of chords.values()) {
    const measure = doc.parentOf(chord.id); const voice = measure && doc.parentOf(measure.id); const staff = voice && doc.parentOf(voice.id);
    if (!staff || staff.type !== 'staff') continue;
    const staffType = getProperty(staff, PID.STAFF_TYPE);
    if (!SOUNDING_STAFF.has(staffType)) continue;
    const track = doc.parentOf(staff.id);
    if (!track) continue;
    if (!tracks.has(track.id)) tracks.set(track.id, trackRecord(doc, track));
    const duration = secondsOf(chord, minSeconds, maxSeconds);
    const soundMap = staffSoundMap(getProperty(staff, PID.PERCMAP));
    for (const note of chord.notes ?? []) {
      for (const p of notePitches({ note, staffType, staff, capoParams: NO_CAPO, soundMap, stradella })) {
        if (p.pitch == null) continue;
        notes.push({ id: `audition-${notes.length}`, track: track.id, staff: staff.id, voice: 0, movement: 0, measure: 0, chord: chord.id, pitch: p.pitch, ...(p.sound != null ? { sound: p.sound } : {}), velocity, t: 0, duration });
      }
    }
  }
  if (!notes.length) return null;
  const length = Math.max(...notes.map((n) => n.duration)) + 0.3;
  return { format: 'scorsaire-sequence', version: 1, speed: 1, duration: length, tracks: [...tracks.values()], notes, messages: [], tempo: { version: 1, steps: [] }, slots: [], movements: [], automation: [] };
}

/**
 * The sequential pad of a tablature: the strings and frets chosen so far (`notes` = [{ string, fret }], string 1 = the highest) heard as one chord, before anything is written.
 * The pitch is the open string of the staff's tuning plus the fret (a capo is not counted, as in `buildAuditionSequence`). null when nothing is playable.
 */
export function buildTabPreviewSequence(doc, staffId, notes, { velocity = 80, seconds = 0.8 } = {}) {
  const staff = doc.find(staffId);
  if (!staff || staff.type !== 'staff' || getProperty(staff, PID.STAFF_TYPE) !== 'tab') return null;
  const track = doc.parentOf(staff.id);
  if (!track) return null;
  const open = tuningPitches(staff);
  const heard = (notes ?? []).filter((n) => Number.isInteger(n.string) && Number.isInteger(n.fret) && open[n.string - 1] != null)
    .map((n, i) => ({ id: `audition-${i}`, track: track.id, staff: staff.id, voice: 0, movement: 0, measure: 0, chord: 'audition', pitch: open[n.string - 1] + n.fret, velocity, t: 0, duration: seconds }));
  if (!heard.length) return null;
  return { format: 'scorsaire-sequence', version: 1, speed: 1, duration: seconds + 0.3, tracks: [trackRecord(doc, track)], notes: heard, messages: [], tempo: { version: 1, steps: [] }, slots: [], movements: [], automation: [] };
}

/**
 * Plays audition sequences on the current engine through `engine.audition` (which cuts the previous one and never touches the transport). Never while the
 * real playback runs.
 * @param o.getEngine () → the engine ; o.isPlaying () → true while the score plays ; o.enabled () → the user setting
 */
export function createAuditioner({ getEngine, isPlaying = () => false, enabled = () => true }) {
  return {
    play(sequence) {
      if (!sequence || !enabled() || isPlaying()) return false;
      const engine = getEngine();
      if (!engine || typeof engine.audition !== 'function') return false;
      try { engine.audition(sequence); } catch { return false; }
      return true;
    },
  };
}
