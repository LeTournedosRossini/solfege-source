/*
 * Mixer intents (no DOM). Volume and mute of a track and the master volume are SAVED in the file (one undoable transaction each);
 * the solo is session state held by the Application. Every function that writes must run inside `doc.transaction`.
 */
import { isLyricsTrack } from '../model/lyricevents.js';
import { PID } from '../model/pid.js';
import { getProperty, hasLocalValue } from '../model/props.js';
import { DEFAULT_VOLUME } from '../audio/mixer.js';
import { cleanDynamics } from '../audio/velocity.js';
import { cleanCompressor } from '../audio/compressor.js';
import { cleanEq } from '../audio/eq.js';
import { cleanLeslie } from '../audio/leslie.js';
import { automationLanes } from '../model/automation.js';

export class MixerError extends Error {
  constructor(message, code) { super(message); this.name = 'MixerError'; this.code = code; }
}

const MIXER_PIDS = new Set([PID.MIXER_VOLUME, PID.MIXER_PAN, PID.MUTE, PID.MASTER_VOLUME, PID.MASTER_PAN, PID.SF_PRESET, PID.COMPRESSOR, PID.EQUALIZER, PID.LESLIE]); // (the compressor and the equalizer are part of the audio chain, not of the played notes)

/** True when every change of a Document event only touches mixer properties (no need to rebuild the played sequence). */
export function isMixerOnly(changes) {
  return Array.isArray(changes) && changes.length > 0 && changes.every((c) => c && c.kind === 'property' && MIXER_PIDS.has(c.pid));
}

/** Volumes live on a 0..127 scale: 0..1 in steps of 1/127. */
export const clampVolume = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? Math.round(x * 127) / 127 : DEFAULT_VOLUME));

/** Pan lives on a −63 … +63 scale (centre 0): −1..1 in steps of 1/63. */
export const clampPan = (x) => Math.min(1, Math.max(-1, Number.isFinite(x) ? Math.round(x * 63) / 63 : 0));

/** The tracks shown by the mixer: those of the first movement (the engines key tracks by the id they have there). */
/** The tracks of the mixer: those that make a sound (a lyrics track has no volume, no mute / solo, no automation: it is not here). */
export function mixerTracks(doc) {
  return (doc.work.movements[0]?.tracks ?? []).filter((t) => !isLyricsTrack(t));
}

function trackOf(doc, trackId) {
  const t = mixerTracks(doc).find((x) => x.id === trackId);
  if (!t) throw new MixerError(`unknown track ${trackId}`, 'unknown');
  return t;
}

function write(doc, el, pid, value, def) {
  if (value === def) { if (hasLocalValue(el, pid)) doc.reset(el, pid); return; }
  doc.set(el, pid, value);
}

export function setTrackVolumeIntent(doc, trackId, volume) {
  write(doc, trackOf(doc, trackId), PID.MIXER_VOLUME, clampVolume(volume), DEFAULT_VOLUME);
}

export function setTrackPanIntent(doc, trackId, pan) {
  write(doc, trackOf(doc, trackId), PID.MIXER_PAN, clampPan(pan), 0);
}

/** The MIDI dynamics of a track (transfer curve, see audio/velocity.js `cleanDynamics`); the straight line (or null) puts the track back to untouched. */
export function setTrackDynamicsIntent(doc, trackId, dynamics) {
  const t = trackOf(doc, trackId);
  const clean = cleanDynamics(dynamics);
  if (!clean) { if (hasLocalValue(t, PID.MIDI_DYNAMICS)) doc.reset(t, PID.MIDI_DYNAMICS); return; }
  doc.set(t, PID.MIDI_DYNAMICS, clean);
}

/** The compressor of a track (audio/compressor.js `cleanCompressor`); the default one (off, nothing changed) puts the track back to untouched. */
export function setTrackCompressorIntent(doc, trackId, compressor) {
  const t = trackOf(doc, trackId);
  const clean = cleanCompressor(compressor);
  if (!clean) { if (hasLocalValue(t, PID.COMPRESSOR)) doc.reset(t, PID.COMPRESSOR); return; }
  doc.set(t, PID.COMPRESSOR, clean);
}

/** The equalizer of a track (audio/eq.js `cleanEq`); the default one (off, flat) puts the track back to untouched. */
export function setTrackEqIntent(doc, trackId, eq) {
  const t = trackOf(doc, trackId);
  const clean = cleanEq(eq);
  if (!clean) { if (hasLocalValue(t, PID.EQUALIZER)) doc.reset(t, PID.EQUALIZER); return; }
  doc.set(t, PID.EQUALIZER, clean);
}

/** The rotary speaker of a track (audio/leslie.js `cleanLeslie`); the default one (chorale, no vibrato, nothing changed) puts the track back to untouched. */
export function setTrackLeslieIntent(doc, trackId, leslie) {
  const t = trackOf(doc, trackId);
  const clean = cleanLeslie(leslie);
  if (!clean) { if (hasLocalValue(t, PID.LESLIE)) doc.reset(t, PID.LESLIE); return; }
  doc.set(t, PID.LESLIE, clean);
}

export function setTrackMuteIntent(doc, trackId, mute) {
  write(doc, trackOf(doc, trackId), PID.MUTE, Boolean(mute), false);
}

/** The SoundFont instrument of a track (`{ name, program, bankMSB, bankLSB }`), or null to go back to the one of its catalogue instrument. */
export function setTrackPresetIntent(doc, trackId, preset) {
  const t = trackOf(doc, trackId);
  if (!preset) { if (hasLocalValue(t, PID.SF_PRESET)) doc.reset(t, PID.SF_PRESET); return; }
  doc.set(t, PID.SF_PRESET, { name: String(preset.name ?? ''), program: preset.program, bankMSB: preset.bankMSB ?? 0, bankLSB: preset.bankLSB ?? 0 });
}

export function setMasterVolumeIntent(doc, volume) {
  write(doc, doc.work, PID.MASTER_VOLUME, clampVolume(volume), DEFAULT_VOLUME);
}

/** The balance of the whole mix (the master pan): −1 … +1, 0 = centre. */
export function setMasterPanIntent(doc, pan) {
  write(doc, doc.work, PID.MASTER_PAN, clampPan(pan), 0);
}

/** Un-mutes every track in one go (the "all unmuted" button). */
export function unmuteAllIntent(doc) {
  for (const t of mixerTracks(doc)) if (getProperty(t, PID.MUTE)) doc.reset(t, PID.MUTE);
}

/**
 * Read snapshot for the panel.
 * @param {{ solo: Set<string>, viewSolo: Set<string>, preview: Map<string, number> }} session
 */
export function mixerSnapshot(doc, session) {
  const anySolo = session.solo.size > 0 || session.viewSolo.size > 0;
  const tracks = mixerTracks(doc).map((t) => {
    const mute = Boolean(getProperty(t, PID.MUTE));
    const solo = session.solo.has(t.id);
    const viewSolo = session.viewSolo.has(t.id);
    return {
      id: t.id,
      name: getProperty(t, PID.NAME) ?? '',
      volume: session.preview.has(t.id) ? session.preview.get(t.id) : clampVolume(getProperty(t, PID.MIXER_VOLUME)),
      pan: session.panPreview?.has(t.id) ? session.panPreview.get(t.id) : clampPan(getProperty(t, PID.MIXER_PAN)),
      mute,
      solo,
      viewSolo,
      audible: !mute && (!anySolo || solo || viewSolo),
      preset: getProperty(t, PID.SF_PRESET) ?? null,
      hasLanes: automationLanes(t).length > 0,
      hasFx: Boolean(getProperty(t, PID.MIDI_DYNAMICS)) || Boolean(getProperty(t, PID.COMPRESSOR)?.on) || Boolean(getProperty(t, PID.EQUALIZER)?.on) || Boolean(getProperty(t, PID.LESLIE)),
      automationShown: session.automationShown?.has(t.id) ?? false,
      automationLanes: session.automationShown?.has(t.id) ? (session.automationLanes?.get(t.id) ?? ['volume']) : [],
      armed: session.armed?.has(t.id) ?? false,
      recording: session.recording?.has(t.id) ?? false,
    };
  });
  return {
    masterAutomationShown: Boolean(session.masterAutomationShown),
    masterPan: session.panPreview?.has('*') ? session.panPreview.get('*') : clampPan(getProperty(doc.work, PID.MASTER_PAN)),
    master: session.preview.has('*') ? session.preview.get('*') : clampVolume(getProperty(doc.work, PID.MASTER_VOLUME)),
    anySolo,
    anyMuted: tracks.some((t) => t.mute),
    tracks,
  };
}
