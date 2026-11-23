/*
 * The SOUND TEST of the audio settings: four notes played by the current engine through `engine.audition` (nothing of the score is touched, the mixer of the work is not
 * used), while the level that leaves the engine is measured (`engine.outputPeak()`, after the output gain and the limiter, before the system volume). It tells apart
 * "the engine makes no sound" from "the sound is made but not heard" (system volume, muted tab, wrong output). PURE: the sequence and the reading of the result.
 */
const TRACK = Object.freeze({ id: 'sound-test', name: 'Test', instrumentId: 'piano', family: 'keyboards', kind: 'pitched', mixer: { volume: 1, pan: 0, fader: 1, masterFactor: 1, mute: false, solo: false, preset: null } });

/** A C major arpeggio on a piano, about 1.3 s (the notes keep their instants: `timed`). */
export function soundTestSequence() {
  const pitches = [60, 64, 67, 72];
  const notes = pitches.map((pitch, i) => ({ id: `sound-test-${i}`, track: TRACK.id, staff: 'sound-test', voice: 0, movement: 0, measure: 0, chord: 'sound-test', pitch, velocity: 90, t: i * 0.25, duration: 0.6 }));
  return { format: 'scorsaire-sequence', version: 1, speed: 1, duration: 1.8, timed: true, tracks: [{ ...TRACK }], notes, messages: [], tempo: { version: 1, steps: [] }, slots: [], movements: [], automation: [] };
}

/** dBFS of a peak (0 … 1); −Infinity for silence. */
export const peakDb = (peak) => (peak > 0 ? 20 * Math.log10(peak) : -Infinity);

const SILENT = 0.001; // −60 dB: nothing
const QUIET = 0.01; // −40 dB: very weak

/**
 * What the test found. @param o { peak (the largest reading), contextState, active ('light' | 'soundfont'), status ('ready' | 'loading' | 'error' | …), outputDb }
 * @returns { level: 'ok' | 'quiet' | 'silent', cause: null | 'suspended' | 'notReady' | 'closed' | 'unknown', db }
 */
export function judgeSoundTest({ peak, contextState, active, status, outputDb }) {
  const db = peakDb(peak);
  if (peak >= QUIET) return { level: 'ok', cause: null, db };
  const cause = contextState === 'suspended' ? 'suspended' : contextState === 'closed' || contextState === 'none' ? 'closed' : active === 'soundfont' && status !== 'ready' ? 'notReady' : 'unknown';
  if (peak >= SILENT) return { level: 'quiet', cause: outputDb <= -12 ? 'lowGain' : cause === 'unknown' ? null : cause, db };
  return { level: 'silent', cause, db };
}
