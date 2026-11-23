/*
 * Hooktheory (Hookpad / TheoryTab) melodies: the text Hookpad puts in the clipboard (`hooktheory-clipboard-v1`) or a file holding it.
 * A melody is a list of notes in SCALE DEGREES (`sd` "1".."7", optional `b` / `#` in front, `octave` relative) with a start and a length in
 * beats (480 ticks per quarter, `modern.payload`) and the key (`tonic`, `scale`). There is no time signature in what Hookpad copies: beat 1
 * is the start of the measure the text is pasted on, the barlines are those of the destination.
 * This module is PURE. `parseHooktheory` reads the text; `hooktheoryPayload` turns it into the clipboard payload of the editor
 * (`scorsaire-staff-list`, see model/clipboard.js) that `pasteClipboard` writes on a notation staff. Chords are not read yet.
 */
import { createNoteChord } from '../model/elements.js';
import { toDurationList, durationValue } from '../model/rhythmsplit.js';
import { fFromTicks } from '../model/fraction.js';
import { midiFromSpelling } from '../model/pitch.js';
import { PID } from '../model/pid.js';
import { CLIPBOARD_FORMAT, CLIPBOARD_VERSION } from '../model/clipboard.js';

const TICKS_PER_QUARTER = 480;
const SIXTEENTH = TICKS_PER_QUARTER / 4;
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Semitones above the tonic of each degree, by scale name (lower case, letters only). */
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], naturalminor: [0, 2, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicminor: [0, 2, 3, 5, 7, 8, 11], melodicminor: [0, 2, 3, 5, 7, 9, 11],
};

export class HooktheoryError extends Error {
  constructor(code, message) { super(message); this.name = 'HooktheoryError'; this.code = code; }
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

/**
 * Reads the text of a Hooktheory clipboard / file. Returns `{ notes: [{ startTick, durationTicks, sd, octave }], key: { tonic, scale }, hasChords, warnings }`
 * or null when the text is not a Hooktheory melody.
 */
export function parseHooktheory(text) {
  const data = typeof text === 'string' ? parseJson(text.trim()) : null;
  if (!data || typeof data !== 'object') return null;
  const modern = data.modern?.payload ?? (Array.isArray(data.payload?.notes) ? data.payload : null);
  const warnings = [];
  let notes;
  let keys;
  if (modern && Array.isArray(modern.notes)) {
    notes = modern.notes.map((n) => ({ startTick: n.startTick, durationTicks: n.durationTicks, sd: n.sd, octave: n.octave ?? 0, isRest: n.isRest === true }));
    keys = modern.keys;
  } else if (Array.isArray(data.notes) && data.notes.every((n) => n && typeof n === 'object' && 'beat' in n && 'sd' in n)) {
    notes = data.notes.map((n) => ({ startTick: Math.round((n.beat - 1) * TICKS_PER_QUARTER), durationTicks: Math.round(n.duration * TICKS_PER_QUARTER), sd: n.sd, octave: n.octave ?? 0, isRest: n.isRest === true }));
    keys = data.keys;
  } else return null;
  const key = keys?.[0] ?? { tonic: 'C', scale: 'major' };
  const hasChords = (modern?.chords?.length ?? data.chords?.length ?? 0) > 0;
  const valid = notes.filter((n) => !n.isRest && Number.isFinite(n.startTick) && Number.isFinite(n.durationTicks) && n.durationTicks > 0 && /^[b#♭♯]*[1-7]$/.test(String(n.sd)));
  if (valid.length < notes.filter((n) => !n.isRest).length) warnings.push('skippedNotes');
  return { notes: valid, key: { tonic: String(key.tonic ?? 'C'), scale: String(key.scale ?? 'major') }, hasChords, warnings };
}

/** MIDI pitch and spelling of a scale degree. `tonicOctave` = the octave number of the tonic's letter for octave 0. */
export function degreeSpelling({ tonic, scale }, sd, octave, tonicOctave) {
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(tonic);
  if (!m) throw new HooktheoryError('tonic', `Unknown tonic: ${tonic}`);
  const letter = m[1].toUpperCase();
  const tonicAlter = [...m[2]].reduce((a, c) => a + (c === '#' || c === '♯' ? 1 : -1), 0);
  const modeKey = String(scale).toLowerCase().replace(/[^a-z]/g, '');
  const mode = SCALES[modeKey] ?? SCALES.major;
  const am = /^([b#♭♯]*)([1-7])$/.exec(String(sd));
  const degree = Number(am[2]);
  const accidental = [...am[1]].reduce((a, c) => a + (c === '#' || c === '♯' ? 1 : -1), 0);
  const letterIndex = LETTERS.indexOf(letter) + degree - 1;
  const step = LETTERS[letterIndex % 7];
  const letterOctave = tonicOctave + Math.floor(letterIndex / 7) + octave;
  const tonicMidi = midiFromSpelling({ step: letter, alter: tonicAlter, octave: tonicOctave });
  const target = tonicMidi + mode[degree - 1] + accidental + 12 * octave;
  const alter = target - midiFromSpelling({ step, alter: 0, octave: letterOctave });
  return { step, alter, octave: letterOctave, midi: target };
}

/**
 * The clipboard payload of the melody. `centerMidi` = the pitch the melody is centred on (the middle line of the destination's clef): the octave is chosen
 * so that the average note lies as close to it as possible. Returns `{ payload, summary: { notes, key, octaveShift, quantized } }`.
 */
export function hooktheoryPayload(parsed, { centerMidi = 71 } = {}) {
  if (!parsed.notes.length) throw new HooktheoryError('empty', 'No note to paste');
  const sorted = parsed.notes.slice().sort((a, b) => a.startTick - b.startTick || a.durationTicks - b.durationTicks);
  // quantise to sixteenths (a triplet or finer value is rounded: counted so the caller can say so)
  let quantized = 0;
  const q = (t) => { const r = Math.round(t / SIXTEENTH) * SIXTEENTH; if (r !== t) quantized++; return r; };
  const flat = sorted.map((n) => ({ ...n, start: q(n.startTick), end: q(n.startTick + n.durationTicks) })).filter((n) => n.end > n.start);
  // one chord per start; a note never runs into the next start
  const groups = [];
  for (const n of flat) {
    const last = groups[groups.length - 1];
    if (last && last.start === n.start) { last.notes.push(n); last.end = Math.min(last.end, n.end); } else groups.push({ start: n.start, end: n.end, notes: [n] });
  }
  groups.forEach((g, i) => { const next = groups[i + 1]; if (next && g.end > next.start) g.end = next.start; });
  const mean = (octave) => {
    const all = groups.flatMap((g) => g.notes.map((n) => degreeSpelling(parsed.key, n.sd, n.octave, octave).midi));
    return all.reduce((a, b) => a + b, 0) / all.length;
  };
  const octaveShift = Math.round((centerMidi - mean(4)) / 12);
  const tonicOctave = 4 + octaveShift;
  const items = [];
  const ties = [];
  let labelNo = 0;
  const label = () => `#${labelNo++}`;
  for (const g of groups) {
    const specs = g.notes.map((n) => { const sp = degreeSpelling(parsed.key, n.sd, n.octave, tonicOctave); return { step: sp.step, alter: sp.alter, octave: sp.octave }; });
    // a length that is no single written value (5 sixteenths…) becomes tied chords
    const pieces = toDurationList(fFromTicks(g.end - g.start, TICKS_PER_QUARTER), 1);
    let at = g.start;
    let previous = null;
    for (const d of pieces) {
      const chord = JSON.parse(JSON.stringify(createNoteChord(specs, { duration: d.base, dots: d.dots })));
      chord.id = label();
      for (const note of chord.notes) note.id = label();
      items.push({ voice: 0, at: fFromTicks(at, TICKS_PER_QUARTER), item: chord });
      if (previous) chord.notes.forEach((note, k) => ties.push({ id: label(), startNoteId: previous.notes[k].id, endNoteId: note.id }));
      previous = chord;
      const [n, dn] = durationValue(d);
      at += Math.round((n * 4 * TICKS_PER_QUARTER) / dn);
    }
  }
  const end = Math.max(...groups.map((g) => g.end));
  const payload = {
    format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION,
    length: fFromTicks(end, TICKS_PER_QUARTER), measures: Math.ceil(end / (4 * TICKS_PER_QUARTER)),
    staves: [{ type: 'score', items, lists: ties.length ? { [PID.TIES]: ties } : {}, lyrics: [] }],
  };
  return { payload, summary: { notes: flat.length, key: parsed.key, octaveShift, quantized } };
}
