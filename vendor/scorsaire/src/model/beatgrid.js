// The GRID of a pattern or a groove, BEAT BY BEAT: each beat of the pattern is cut in its own number of steps (4 = sixteenth notes in a quarter-note beat, 3 = an eighth-note triplet, 6 = a sixteenth-note
// triplet…), so that one beat can be a triplet inside a straight pattern. PURE. The notes themselves are exact fractions of a whole note (model/fraction.js), nothing here changes how they sound: the
// grid is the way the editor draws them, kept with the pattern (`beats`: one step count per beat of the WHOLE pattern, bars times the beats of a bar) because it is part of the music.
//   - a beat is a quarter note, in 6/8, 9/8, 12/8 a dotted quarter note (three eighth notes); a bar that does not fill whole beats ends with a shorter one (7/8: three quarter notes and an eighth);
//   - without `beats` the grid is derived from the notes: sixteenth notes, finer or a triplet in the beats that need it.
import { fAdd, fSub, fMul, fCmp, ZERO } from './fraction.js';

export const MAX_STEPS = 24;
/** The cuts a menu offers for a beat, by kind of beat. */
export const BEAT_STEPS = Object.freeze({ simple: Object.freeze([1, 2, 3, 4, 6, 8]), compound: Object.freeze([1, 3, 6, 12]), short: Object.freeze([1, 2, 4]) });

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const reduce = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };

/** The beats of ONE bar: [{ len: fraction, kind: 'simple' | 'compound' | 'short' }]. */
export function beatsOfBar(barLength) {
  const [n, d] = barLength;
  if (d === 8 && n % 3 === 0 && n >= 3) return Array.from({ length: n / 3 }, () => ({ len: [3, 8], kind: 'compound' }));
  const whole = Math.floor((n * 4) / d);
  const out = Array.from({ length: whole }, () => ({ len: [1, 4], kind: 'simple' }));
  const rest = fSub(barLength, reduce(whole, 4));
  if (rest[0] > 0) out.push({ len: rest, kind: 'short' });
  return out;
}

/** How many beats a pattern of `bars` bars of `barLength` has. */
export const beatCount = (barLength, bars = 1) => beatsOfBar(barLength).length * bars;

/** `beats` as stored: an array of whole step counts, one per beat; null when it does not fit the pattern (it is then derived from the notes). */
export function checkBeats(beats, barLength, bars = 1) {
  if (!Array.isArray(beats) || beats.length !== beatCount(barLength, bars)) return null;
  return beats.every((k) => Number.isInteger(k) && k >= 1 && k <= MAX_STEPS) ? [...beats] : null;
}

/** The segments of the whole pattern: [{ index, bar, beatInBar, start, len, kind, steps, firstCol }]. */
function segmentsOf(barLength, bars, steps) {
  const beats = beatsOfBar(barLength);
  const out = [];
  let start = ZERO; let col = 0; let index = 0;
  for (let b = 0; b < bars; b++) {
    beats.forEach((beat, beatInBar) => {
      const k = steps[index];
      out.push({ index, bar: b, beatInBar, start, len: beat.len, kind: beat.kind, steps: k, firstCol: col });
      start = fAdd(start, beat.len); col += k; index += 1;
    });
  }
  return out;
}

/** The step counts the notes ask for, beat by beat (`positions` = the starts of the notes, fractions of the pattern): sixteenth notes, or the first cut that holds every note of the beat. */
export function autoBeats(barLength, bars, positions, prefer = 4) {
  const beats = beatsOfBar(barLength);
  const offsets = beats.map(() => []);
  const segs = segmentsOf(barLength, bars, Array.from({ length: beats.length * bars }, () => 1));
  for (const p of positions) {
    const s = [...segs].reverse().find((x) => fCmp(p, x.start) >= 0);
    if (s && fCmp(p, fAdd(s.start, s.len)) < 0) offsets[s.index % offsets.length].push({ seg: s, at: p });
  }
  return segs.map((s) => {
    const list = s.kind === 'compound' ? [3, 6, 12, 1, 24] : s.kind === 'short' ? [2, 4, 1, 8, 24] : [...new Set([prefer, 4, 8, 3, 6, 12, 16, 24, 1, 2])];
    const mine = offsets[s.index % offsets.length].filter((o) => o.seg.index === s.index);
    const fits = (k) => mine.every(({ at }) => { const x = fMul(fSub(at, s.start), [k, 1]); const q = fMul(x, [s.len[1], s.len[0]]); return q[1] === 1; });
    return list.find((k) => fits(k)) ?? MAX_STEPS;
  });
}

/**
 * The grid of a pattern: `cols` (cells in all), `segments`, and the geometry the editor needs.
 * @param o { barLength (one bar), bars, beats (stored step counts or null), positions (the starts of the notes, for the derived grid), prefer (the cut a beat gets first when the notes allow it: 4 = sixteenth notes for a pattern, 2 = eighth notes for a groove) }
 */
export function createBeatGrid({ barLength, bars = 1, beats = null, positions = [], prefer = 4 }) {
  const steps = checkBeats(beats, barLength, bars) ?? autoBeats(barLength, bars, positions, prefer);
  const segments = segmentsOf(barLength, bars, steps);
  const cols = segments.reduce((n, s) => n + s.steps, 0);
  const total = reduce(barLength[0] * bars, barLength[1]);
  const cellLen = (s) => fMul(s.len, [1, s.steps]);
  const segmentOfCol = (c) => segments.find((s) => c >= s.firstCol && c < s.firstCol + s.steps) ?? null;
  return {
    steps, segments, cols, total, barLength, bars,
    /** The start of column `c` (c = cols gives the end of the pattern). */
    atOf(c) { if (c >= cols) return total; const s = segmentOfCol(c); return fAdd(s.start, fMul(cellLen(s), [c - s.firstCol, 1])); },
    /** The column a position falls on, or null when it is between two cells (not on this grid). */
    colOf(at) {
      const s = [...segments].reverse().find((x) => fCmp(at, x.start) >= 0);
      if (!s || fCmp(at, fAdd(s.start, s.len)) >= 0) return null;
      const q = fMul(fSub(at, s.start), [s.steps, 1]); const r = fMul(q, [s.len[1], s.len[0]]);
      return r[1] === 1 ? s.firstCol + r[0] : null;
    },
    segmentOfCol,
    /** The length of the cell at column `c`. */
    cellLen(c) { const s = segmentOfCol(c); return s ? cellLen(s) : null; },
    /** How many cells a note of length `dur` starting at column `c` covers (at least one). */
    cellsCovered(c, dur) {
      const end = fAdd(this.atOf(c), dur);
      let j = c + 1;
      while (j < cols && fCmp(this.atOf(j), end) < 0) j += 1;
      return Math.max(1, j - c);
    },
  };
}

/** The nearest step of its beat for a position that is not on the grid `to`: `{ at, moved }`. */
export function snapAt(to, at) {
  if (to.colOf(at) !== null) return { at, moved: false };
  const s = [...to.segments].reverse().find((x) => fCmp(at, x.start) >= 0) ?? to.segments[0];
  const x = fMul(fMul(fSub(at, s.start), [s.steps, 1]), [s.len[1], s.len[0]]); // in steps, a fraction
  const nearest = Math.min(s.steps - 1, Math.max(0, Math.round(x[0] / x[1])));
  return { at: to.atOf(s.firstCol + nearest), moved: true };
}

/**
 * Puts notes on a new grid: a note whose start is not on the new grid goes to the nearest step of its beat. Notes that land on the same step are merged (parts joined, the longer length).
 * @param hits [{ at, dur, parts, ... }]  @param from, to the grids (`createBeatGrid`) before and after
 * @returns {{ hits, moved }} `moved` = notes that had to be moved
 */
export function retimeHits(hits, to) {
  const out = new Map(); let moved = 0;
  for (const h of hits) {
    const snapped = snapAt(to, h.at); const at = snapped.at; if (snapped.moved) moved += 1;
    const key = `${at[0]}/${at[1]}`;
    const old = out.get(key);
    if (!old) out.set(key, { ...h, at });
    else out.set(key, { ...old, parts: [...new Set([...old.parts, ...h.parts])], dur: fCmp(h.dur, old.dur) > 0 ? h.dur : old.dur });
  }
  return { hits: [...out.values()].sort((a, b) => fCmp(a.at, b.at)), moved };
}
