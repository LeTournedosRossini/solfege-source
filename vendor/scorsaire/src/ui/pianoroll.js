/*
 * The pure part of the piano roll of the recording window (`record-dom.js`): what a drag on a note means. No DOM.
 *
 * A note of the quantized take (`recording.js: quantizeTake`) has `start` / `end` in grid steps and a `midi` pitch. A drag changes ONE of: the start (left
 * edge), the end (right edge) or the whole note (body: moved in time and in pitch). The result is a patch for `recorder.editNote`: exact fractions of a whole
 * note, so it stays valid when the grid changes (it is snapped to the new grid then).
 */
import { frac, fMul } from '../model/index.js';

export const MIN_MIDI = 0;
export const MAX_MIDI = 127;

/**
 * Which part of a note a pointer is on: 'start' | 'end' | 'body'. `x` is measured from the left edge of the note and `width` is the note's width (any unit
 * as long as `edge` uses it too). The edge zones never take more than a third of a narrow note each, so its body can always be grabbed.
 */
export function noteZone(x, width, edge) {
  const e = Math.min(edge, width / 3);
  if (x <= e) return 'start';
  if (x >= width - e) return 'end';
  return 'body';
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The patch for a drag of `mode` ('start' | 'end' | 'body') by `dSteps` grid steps and `dPitch` semitones on `note` ({ start, end, midi }).
 * `total` = number of steps of the take, `grid` = the grid as a fraction of a whole note. Returns null when nothing changes.
 */
export function dragPatch(note, mode, dSteps, dPitch, { grid, total }) {
  const len = note.end - note.start;
  let start = note.start; let end = note.end; let midi = note.midi;
  if (mode === 'start') start = clamp(note.start + dSteps, 0, note.end - 1);
  else if (mode === 'end') end = clamp(note.end + dSteps, note.start + 1, total);
  else {
    start = clamp(note.start + dSteps, 0, Math.max(0, total - len));
    end = start + len;
    midi = clamp(note.midi + dPitch, MIN_MIDI, MAX_MIDI);
  }
  if (start === note.start && end === note.end && midi === note.midi) return null;
  const patch = {};
  if (start !== note.start) patch.start = fMul(grid, frac(start, 1));
  if (end !== note.end) patch.end = fMul(grid, frac(end, 1));
  if (midi !== note.midi) patch.midi = midi;
  // moving a note keeps its length: both ends are stored so a later change of the quantization of one end cannot change it
  if (mode === 'body' && (patch.start || patch.end)) { patch.start = fMul(grid, frac(start, 1)); patch.end = fMul(grid, frac(end, 1)); }
  return patch;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 'C4' for 60 (middle C). */
export function pitchName(midi) { return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`; }
