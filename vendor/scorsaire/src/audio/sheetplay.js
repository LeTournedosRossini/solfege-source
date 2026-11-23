/*
 * Listening to ONE CELL of a sheet (screen 3), as a reader would hear it: the movement of the cell with the settings in force (speed, playback
 * transposition per track, volume per track, hidden tracks muted or not) and the loop proposed for the cell. PURE: no DOM, no engine.
 * `buildCellSequence(work, sheet, cell, options)` → { sequence, loop: { start, end } | null, settings } or null when the movement is gone.
 * `overrides` = what the reader changed for now (never saved): { speed, transposePlay, hiddenMuted, volumes: { [trackId]: 0..1 }, muted: [trackIds] }.
 */
import { cellSettings, trackShift } from '../model/sheetedit.js';
import { savedMixer, effectiveVolume, masterVolumeOf, masterFactor } from './mixer.js';
import { buildSequence } from './sequence.js';
import { secondsOf } from './cursor.js';

export function buildCellSequence(work, sheet, cell, { overrides = {}, sequenceOptions = {} } = {}) {
  const mv = work.movements.find((m) => m.id === cell.movementId);
  if (!mv) return null;
  const st = cellSettings(sheet, cell);
  const speed = (overrides.speed ?? st.speed) / 100;
  const hiddenMuted = overrides.hiddenMuted ?? st.hiddenMuted;
  const shown = cell.tracks ? new Set(cell.tracks) : null;
  const master = overrides.master != null ? overrides.master : masterVolumeOf(null); // a movement is built on its own: the default master unless the reader moved it
  const transpose = {}; const mixer = {};
  for (const t of mv.tracks) {
    const k = overrides.transposePlay != null ? overrides.transposePlay : trackShift(st, t.id, 'transposePlay');
    if (k) transpose[t.id] = k;
    const entry = {};
    let fader = overrides.volumes?.[t.id] ?? st.tracks[t.id]?.volume;
    if (fader == null && overrides.master != null) fader = savedMixer(t, null).fader;
    if (fader != null) { entry.fader = fader; entry.volume = effectiveVolume(fader, master); entry.masterFactor = masterFactor(master); }
    if ((shown && !shown.has(t.id) && hiddenMuted) || overrides.muted?.includes(t.id)) entry.mute = true;
    if (overrides.solo?.includes(t.id)) entry.solo = true;
    if (Object.keys(entry).length) mixer[t.id] = entry;
  }
  const sequence = buildSequence(mv, { ...sequenceOptions, speed, transpose, mixer });
  let loop = null;
  if (cell.loop) {
    const a = mv.masterbars.findIndex((b) => b.id === cell.loop.from); const b = mv.masterbars.findIndex((x) => x.id === cell.loop.to);
    // the first played measure from `a` on, the last played one up to `b` (a measure skipped by a volta or a jump does not stop the loop from existing)
    let from = a; while (from <= b && secondsOf(sequence, 0, from) == null) from += 1;
    let to = b; while (to >= from && !sequence.slots.some((s) => s.measure === to)) to -= 1;
    const start = from <= b ? secondsOf(sequence, 0, from) : null; const slot = to >= from ? sequence.slots.find((s) => s.measure === to && s.t >= start) : null;
    if (start != null && slot) loop = { start, end: slot.end };
  }
  return { sequence, loop, settings: st };
}
