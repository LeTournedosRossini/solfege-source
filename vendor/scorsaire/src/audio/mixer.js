/*
 * Mixer settings (pure). What is SAVED in the file: the volume and mute of each track (PID.MIXER_VOLUME, PID.MUTE) and the master volume of the work
 * (PID.MASTER_VOLUME). Scale: 0..127 faders (stored as 0..1), default 100. What is NOT saved: the solo (session state, plus the solo of the active named view).
 * The engines receive `{ [trackId]: { volume, mute, solo } }` where `volume` already includes the master volume.
 */
import { isLyricsTrack } from '../model/lyricevents.js';
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : DEFAULT_VOLUME));

/** Default volume of a track and of the master: 100 on a 0-127 scale, which leaves headroom above it. */
export const DEFAULT_VOLUME = 100 / 127;

/**
 * Amplitude gain (0..1, 1 = the fader's maximum) heard for a track: its own volume scaled by the master, taken RELATIVE to the master's default so that a master at its
 * default leaves the tracks alone; above it the tracks get louder, up to their maximum.
 */
export function effectiveVolume(trackVolume, master) { return Math.min(1, clamp01(trackVolume) * masterFactor(master)); }

/** How much the master scales the tracks: 1 at its default, above 1 when raised (the result is capped per track by `effectiveVolume`). */
export const masterFactor = (master) => clamp01(master) / DEFAULT_VOLUME;

/** Master volume of a work (1 for a bare movement). */
export function masterVolumeOf(work) {
  return work?.movements ? clamp01(getProperty(work, PID.MASTER_VOLUME)) : DEFAULT_VOLUME;
}

/** The saved mixer of a track: master volume folded into the volume, no solo. */
/** The compressor or equalizer settings an engine has to apply (null when the track has none or it is off: nothing is inserted in its path). */
const activeCompressor = (c) => (c && c.on ? { ...c } : null);

export function savedMixer(track, work) {
  const fader = clamp01(getProperty(track, PID.MIXER_VOLUME));
  const master = masterVolumeOf(work);
  // `fader` and `masterFactor` let an engine recompute the volume for an automation value (see automation.js)
  return { volume: effectiveVolume(fader, master), pan: Math.min(1, Math.max(-1, Number(getProperty(track, PID.MIXER_PAN)) || 0)), fader, masterFactor: masterFactor(master), mute: Boolean(getProperty(track, PID.MUTE)), solo: false, preset: getProperty(track, PID.SF_PRESET) ?? null, compressor: activeCompressor(getProperty(track, PID.COMPRESSOR)), eq: activeCompressor(getProperty(track, PID.EQUALIZER)), leslie: getProperty(track, PID.LESLIE) ? { ...getProperty(track, PID.LESLIE) } : null };
}

/**
 * The full mixer of a work for playback. Tracks are those of the FIRST movement (the engines key tracks by the id they have there).
 * @param {Iterable<string>} soloIds ids of the tracks in solo (manual solo and solo of the active view added together)
 */
export function playbackMixer(work, soloIds = []) {
  const solo = new Set(soloIds);
  const out = {};
  for (const t of work.movements[0]?.tracks ?? []) { if (isLyricsTrack(t)) continue; out[t.id] = { ...savedMixer(t, work), solo: solo.has(t.id) }; } // a lyrics track makes no sound
  return out;
}

/** Is a track heard? Not muted and, if any track is in solo, in the solo set. */
export function isAudibleTrack(mixer, trackId) {
  const m = mixer[trackId];
  if (!m) return true;
  const anySolo = Object.values(mixer).some((x) => x?.solo);
  return !m.mute && (!anySolo || m.solo);
}
