/*
 * Fretted-instrument voicings (chord diagrams): PURE data and helpers, no DOM.
 *
 * A voicing is how a chord is fingered on a fretted instrument:
 *   { instrument: 'guitar' | 'ukulele' | 'bass' | 'bass5' | 'custom', tuning?: [midi…], frets: [-1 | 0 | n…], barres?: [{ fret, from, to }], fingers?: [1..4 | null…], name? }
 *   (`fingers` = the finger number written in the dot of each string; the colour of the dots belongs to the diagram, `PID.COLOR`, not to the fingering)
 * - `frets` has one entry per string, in DIAGRAM order (left to right = lowest string first for a guitar; for a re-entrant ukulele G C E A);
 *   -1 = muted string, 0 = open string, n >= 1 = fretted at fret n (ABSOLUTE fret number, never relative to the window drawn).
 * - `tuning` (open-string MIDI pitches, same order as `frets`) is only stored when it differs from the instrument preset.
 * - `barres` is optional: absent = derived from the frets (`detectBarre`); `from`/`to` are string indices (inclusive).
 * - Nothing derivable is stored: the sounding notes, the window of frets drawn, the fret-number label come from these helpers.
 *
 * Compact code of a voicing (`voicingCode`): one character per string, 'x' muted, '0'-'9' then 'a'… the fret ("x32010" = open C). It is the
 * format of the shape library (`fret-shapes.json`, extracted from MuseScore's table) and a convenient exchange / test format.
 */
export const INSTRUMENT_PRESETS = Object.freeze({
  guitar: Object.freeze({ tuning: Object.freeze([40, 45, 50, 55, 59, 64]), maxFret: 24 }), // E2 A2 D3 G3 B3 E4
  ukulele: Object.freeze({ tuning: Object.freeze([67, 60, 64, 69]), maxFret: 15 }), // G4 C4 E4 A4 (re-entrant)
  bass: Object.freeze({ tuning: Object.freeze([28, 33, 38, 43]), maxFret: 24 }), // E1 A1 D2 G2
  bass5: Object.freeze({ tuning: Object.freeze([23, 28, 33, 38, 43]), maxFret: 24 }), // B0 E1 A1 D2 G2
});

export const MAX_STRINGS = 12;
export const PIANO_MAX_NOTES = 20;
/** A piano "voicing" is the set of keys pressed: { instrument: 'piano', notes: [midi…] } (no frets, no tuning). */
export const isPiano = (v) => v?.instrument === 'piano';
const FRET_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export class VoicingError extends Error {
  constructor(message, code = 'invalid') { super(message); this.name = 'VoicingError'; this.code = code; }
}

/** Open-string pitches of a voicing: its own tuning, else the preset's, else null. */
export function voicingTuning(voicing) {
  return voicing.tuning ?? INSTRUMENT_PRESETS[voicing.instrument]?.tuning ?? null;
}

/** A well-formed voicing (a copy; no extra field is kept). */
export function createVoicing({ instrument = 'guitar', tuning, frets, barres, fingers, notes, name } = {}) {
  if (instrument === 'piano') {
    const v = { instrument, notes: [...new Set(notes ?? [])].sort((a, b) => a - b) };
    // finger numbers (1 = thumb … 5), one per note: kept by NOTE, so they follow it when the keys are re-sorted
    if (fingers?.some((f) => f)) { const by = new Map((notes ?? []).map((n, i) => [n, fingers[i] ?? null])); v.fingers = v.notes.map((n) => by.get(n) ?? null); }
    if (name) v.name = String(name);
    const problems = validateVoicing(v);
    if (problems.length) throw new VoicingError(problems[0]);
    return v;
  }
  const v = { instrument, frets: [...frets] };
  const preset = INSTRUMENT_PRESETS[instrument]?.tuning;
  if (tuning && !(preset && sameList(tuning, preset))) v.tuning = [...tuning];
  if (barres?.length) v.barres = barres.map((b) => ({ fret: b.fret, from: b.from, to: b.to }));
  if (fingers?.some((f) => f)) v.fingers = [...fingers];
  if (name) v.name = String(name);
  const errors = validateVoicing(v);
  if (errors.length) throw new VoicingError(errors[0]);
  return v;
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Problems of a voicing (empty = valid). */
export function validateVoicing(v) {
  const errors = [];
  if (!v || typeof v !== 'object') return ['voicing: not an object'];
  if (typeof v.instrument !== 'string' || !v.instrument) errors.push('voicing: instrument missing');
  if (v.instrument === 'piano') {
    if (!Array.isArray(v.notes) || v.notes.length < 1 || v.notes.length > PIANO_MAX_NOTES) return ['voicing: a piano voicing holds 1 to 20 notes'];
    if (!v.notes.every((n, i) => Number.isInteger(n) && n >= 0 && n <= 127 && (i === 0 || n > v.notes[i - 1]))) return ['voicing: piano notes are distinct MIDI pitches in ascending order'];
    if (v.fingers && (!Array.isArray(v.fingers) || v.fingers.length !== v.notes.length || !v.fingers.every((f) => f === null || (Number.isInteger(f) && f >= 1 && f <= 5)))) return ['voicing: piano fingers match the notes (null or 1 to 5)'];
    return [];
  }
  const tuning = voicingTuning(v ?? {});
  if (!Array.isArray(v.frets) || v.frets.length < 1 || v.frets.length > MAX_STRINGS) errors.push('voicing: frets must hold 1 to 12 strings');
  else {
    if (!tuning) errors.push('voicing: no tuning (unknown instrument needs its own `tuning`)');
    else if (tuning.length !== v.frets.length) errors.push('voicing: tuning and frets must have the same length');
    const max = INSTRUMENT_PRESETS[v.instrument]?.maxFret ?? 36;
    v.frets.forEach((f, i) => { if (!Number.isInteger(f) || f < -1 || f > max) errors.push(`voicing: string ${i}: invalid fret ${f}`); });
  }
  if (tuning && !tuning.every((p) => Number.isInteger(p) && p >= 0 && p <= 127)) errors.push('voicing: invalid tuning pitch');
  for (const b of v.barres ?? []) {
    if (!Number.isInteger(b.fret) || b.fret < 1 || !Number.isInteger(b.from) || !Number.isInteger(b.to) || b.from < 0 || b.to <= b.from || b.to >= (v.frets?.length ?? 0)) errors.push('voicing: invalid barre');
  }
  if (v.fingers && (!Array.isArray(v.fingers) || v.fingers.length !== v.frets?.length || !v.fingers.every((f) => f === null || (Number.isInteger(f) && f >= 1 && f <= 4)))) errors.push('voicing: fingers must match the strings (null or 1 to 4)');
  return errors;
}

export const voicingCode = (frets) => frets.map((f) => (f < 0 ? 'x' : FRET_CHARS[f])).join('');
export function fretsFromCode(code) {
  return [...code].map((ch) => {
    if (ch === 'x' || ch === 'X') return -1;
    const n = FRET_CHARS.indexOf(ch.toLowerCase());
    if (n < 0) throw new VoicingError(`invalid fret character "${ch}"`);
    return n;
  });
}

/** MIDI pitch sounded by each string (null for a muted string). */
export function voicingPitches(v) {
  if (isPiano(v)) return [...v.notes];
  const tuning = voicingTuning(v);
  return v.frets.map((f, i) => (f < 0 ? null : tuning[i] + f));
}

/** Pitch classes sounded, as a sorted list of 0-11. */
export function voicingPitchClasses(v) {
  return [...new Set(voicingPitches(v).filter((p) => p !== null).map((p) => p % 12))].sort((a, b) => a - b);
}

/** Pitch class of the lowest sounding note (the bass), or null if nothing sounds. */
export function voicingBassPc(v) {
  const sounding = voicingPitches(v).filter((p) => p !== null);
  return sounding.length ? Math.min(...sounding) % 12 : null;
}

/**
 * The barre a fretting implies: the lowest fretted fret when at least two strings are pressed there and no open string lies between the first and the last
 * of them (a muted string between is fine: the finger lies over it). null when there is none.
 */
export function detectBarre(frets) {
  const fretted = frets.filter((f) => f > 0);
  if (fretted.length < 2) return null;
  const lowest = Math.min(...fretted);
  const idx = frets.map((f, i) => (f === lowest ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  const from = idx[0];
  const to = idx[idx.length - 1];
  for (let i = from; i <= to; i++) if (frets[i] === 0) return null;
  // every string between the ends must be pressed at least as high as the barre (or muted): otherwise the finger cannot lie flat
  for (let i = from; i <= to; i++) if (frets[i] > 0 && frets[i] < lowest) return null;
  return { fret: lowest, from, to };
}

/** The barres drawn: the stored ones, else the one the frets imply. */
export const voicingBarres = (v) => (v.barres?.length ? v.barres : [detectBarre(v.frets)].filter(Boolean));

/** Number of fingers needed (a barre counts for one). */
export function fingerCount(frets) {
  const barre = detectBarre(frets);
  let n = 0;
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] <= 0) continue;
    if (barre && frets[i] === barre.fret && i >= barre.from && i <= barre.to) continue;
    n++;
  }
  return n + (barre ? 1 : 0);
}

/**
 * Window of frets a diagram shows: `first` = fret number of the top row (1 = the nut is drawn), `rows` = number of fret rows (at least `minRows`).
 * A shape that fits in the first `minRows` frets starts at the nut; otherwise the window starts at the lowest fretted fret.
 */
export function diagramWindow(frets, { minRows = 4 } = {}) {
  const fretted = frets.filter((f) => f > 0);
  if (!fretted.length) return { first: 1, rows: minRows, nut: true };
  const lo = Math.min(...fretted);
  const hi = Math.max(...fretted);
  if (hi <= minRows) return { first: 1, rows: minRows, nut: true };
  return { first: lo, rows: Math.max(minRows, hi - lo + 1), nut: false };
}

/** Two voicings finger the same notes the same way. */
export const sameVoicing = (a, b) => a.instrument === b.instrument && (isPiano(a) ? sameList(a.notes, b.notes) : sameList(a.frets, b.frets)) && sameList(voicingTuning(a) ?? [], voicingTuning(b) ?? []);
