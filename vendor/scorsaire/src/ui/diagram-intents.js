/*
 * Gestures of the chord-diagram editor, WITHOUT DOM: what a tap on the grid does to a fingering. Pure functions on a `frets` array
 * (-1 muted, 0 open, n fretted; one entry per string, in diagram order).
 */
import { diagramWindow } from '../model/fretvoicing.js';

/** Tap on the fret `fret` of string `i`: sets the dot there; tapping the dot that is already there lifts the finger (the string becomes open). */
export function tapCell(frets, i, fret) {
  const next = [...frets];
  next[i] = frets[i] === fret ? 0 : fret;
  return next;
}

/** Tap on the marker row above string `i`: open ↔ muted; a fretted string becomes open. */
export function tapMarker(frets, i) {
  const next = [...frets];
  next[i] = frets[i] === 0 ? -1 : 0;
  return next;
}

/** The window the editor shows: starts at the lowest fretted fret (or the nut) and always has `rows` rows so every fret can be tapped. */
export function editorWindow(frets, first = null, rows = 5) {
  const w = diagramWindow(frets, { minRows: rows });
  const f = Math.max(1, first ?? w.first);
  return { first: f, rows, nut: f === 1 };
}

/** Moves the window by `delta` frets (never below the nut, never past the last fret `max`). */
export function shiftWindow(win, delta, max = 24) {
  const first = Math.min(Math.max(1, win.first + delta), Math.max(1, max - win.rows + 1));
  return { first, rows: win.rows, nut: first === 1 };
}

/** A root note { step, alter } from a letter and an accidental ('' | '♯' | '♭'). */
export const rootOf = (step, accidental) => ({ step, alter: accidental === '♯' ? 1 : accidental === '♭' ? -1 : 0 });

/** Finger numbers cycle 1, 2, 3, 4, none. */
export const nextFinger = (f) => (f === null || f === undefined ? 1 : f >= 4 ? null : f + 1);

/** The voicing with new frets: a string whose fret changed (or lifted) loses its finger number. */
export function withFrets(voicing, frets) {
  const fingers = voicing.fingers ? voicing.fingers.map((x, i) => (frets[i] > 0 && frets[i] === voicing.frets[i] ? x : null)) : null;
  const out = { ...voicing, frets };
  delete out.barres; // the barre is derived from the new frets
  if (fingers?.some(Boolean)) out.fingers = fingers; else delete out.fingers;
  return out;
}

/** A tap on the dot at (string i, fret): its finger number moves to the next one. Nothing happens where there is no dot. */
export function tapFinger(voicing, i, fret) {
  if (!(voicing.frets[i] > 0) || voicing.frets[i] !== fret) return voicing;
  const list = voicing.fingers ? [...voicing.fingers] : voicing.frets.map(() => null);
  list[i] = nextFinger(list[i] ?? null);
  const out = { ...voicing };
  if (list.some(Boolean)) out.fingers = list; else delete out.fingers;
  return out;
}

/** The finger numbers of a piano cycle 1 (thumb) … 5, none. */
export const nextPianoFinger = (f) => (f === null || f === undefined ? 1 : f >= 5 ? null : f + 1);

/** A piano voicing with the key `midi` put (or lifted: at least one key stays); the finger numbers follow their notes. */
export function toggleKey(voicing, midi) {
  const has = voicing.notes.includes(midi);
  const notes = has ? voicing.notes.filter((n) => n !== midi) : [...voicing.notes, midi].sort((a, b) => a - b);
  if (!notes.length) return voicing;
  const by = new Map(voicing.notes.map((n, i) => [n, voicing.fingers?.[i] ?? null]));
  const fingers = notes.map((n) => by.get(n) ?? null);
  const out = { ...voicing, notes };
  if (fingers.some(Boolean)) out.fingers = fingers; else delete out.fingers;
  return out;
}

/** A tap on a LIT key of a piano in the finger mode: its finger number moves to the next one. */
export function tapKeyFinger(voicing, midi) {
  const i = voicing.notes.indexOf(midi);
  if (i < 0) return voicing;
  const fingers = voicing.fingers ? [...voicing.fingers] : voicing.notes.map(() => null);
  fingers[i] = nextPianoFinger(fingers[i]);
  const out = { ...voicing };
  if (fingers.some(Boolean)) out.fingers = fingers; else delete out.fingers;
  return out;
}
