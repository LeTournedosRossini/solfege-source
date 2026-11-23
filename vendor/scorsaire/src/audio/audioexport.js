/*
 * The audio export: what is written, from which tracks. The piece is rendered by the SoundFont engine on a virtual clock (`prerender.js`), once per FILE: the full mix as it is played, one file per
 * track, or one file for a GROUP of tracks (a drum kit with its bass, say). Pure: the rendering and the encoding are given (`render`, `encode`), so this runs under Node.
 *
 * What is NOT in the file: the compressor, the equaliser and the Leslie stage of a track (they live in the browser's audio graph, which a virtual clock does not have); the MIDI dynamics curve, the volume, the
 * pan and the automation ARE (they are messages of the engine).
 */
import { encodeWav } from './wav.js';

/** The formats offered: id, extension, what the file is, the rate the piece is rendered at. */
export const AUDIO_FORMATS = Object.freeze([
  { id: 'wav16', ext: 'wav', bits: 16, rate: 48000 },
  { id: 'wav24', ext: 'wav', bits: 24, rate: 48000 },
  { id: 'opus96', ext: 'opus', bitrate: 96000, rate: 48000 },
  { id: 'opus128', ext: 'opus', bitrate: 128000, rate: 48000 },
  { id: 'opus192', ext: 'opus', bitrate: 192000, rate: 48000 },
]);
export const audioFormat = (id) => AUDIO_FORMATS.find((f) => f.id === id) ?? AUDIO_FORMATS[0];

/** A name safe for a file on any system. */
export const safeName = (s, fallback = 'audio') => (String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback);

/**
 * The files to make. `tracks` = [{ id, name }] (the tracks of the sequence); `full` = the mix as played; `separate` = [track ids] each in a file of its own; `groups` = [{ name, trackIds }].
 * @returns [{ name (without extension), trackIds: string[] | null }] — null = the whole mix; numbered in the order of the tracks, the groups after.
 */
export function planTargets({ tracks, full = true, separate = [], groups = [] }) {
  const targets = [];
  if (full) targets.push({ name: 'mix', trackIds: null });
  const known = new Set(tracks.map((t) => t.id));
  const apart = new Set(separate);
  for (const t of tracks) if (apart.has(t.id)) targets.push({ name: safeName(t.name, t.id), trackIds: [t.id] });
  for (const g of groups) {
    const ids = (g.trackIds ?? []).filter((id) => known.has(id));
    if (ids.length) targets.push({ name: safeName(g.name, 'group'), trackIds: ids });
  }
  const seen = new Map();
  const numbered = targets.length > 1;
  return targets.map((t, i) => {
    const base = numbered ? `${String(i + 1).padStart(2, '0')} ${t.name}` : t.name;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { ...t, name: n > 1 ? `${base} (${n})` : base };
  });
}

/** A copy of the sequence in which only `trackIds` are heard (their own mute and solo are ignored: a muted track asked for apart would give a silent file). null = the mix as played. */
export function soundOnly(sequence, trackIds) {
  if (!trackIds) return sequence;
  const keep = new Set(trackIds);
  return { ...sequence, tracks: sequence.tracks.map((tr) => ({ ...tr, mixer: { ...tr.mixer, mute: !keep.has(tr.id), solo: false } })) };
}

/**
 * Makes the files. `render(sequence, { onProgress })` → { left, right, sampleRate }; `encode(buffer, format, { onProgress })` → Uint8Array (by default WAV; the Opus encoder is given by the page).
 * @returns {Promise<{ name, data: Uint8Array }[]>} files named with their extension.
 */
export async function runAudioExport({ sequence, targets, format, render, encode = null, signal = null, onProgress = () => {} }) {
  const fmt = typeof format === 'string' ? audioFormat(format) : format;
  const files = [];
  for (let i = 0; i < targets.length; i += 1) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
    const target = targets[i];
    const part = (p) => onProgress({ file: i, files: targets.length, name: target.name, fraction: (i + p) / targets.length });
    const buffer = await render(soundOnly(sequence, target.trackIds), { onProgress: (p) => part(p * 0.8) });
    const data = fmt.ext === 'wav'
      ? encodeWav({ channels: [buffer.left, buffer.right], sampleRate: buffer.sampleRate, bits: fmt.bits })
      : await encode(buffer, fmt, { onProgress: (p) => part(0.8 + p * 0.2), signal });
    files.push({ name: `${target.name}.${fmt.ext}`, data });
    part(1);
  }
  return files;
}
