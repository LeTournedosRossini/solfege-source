/*
 * Recording what is PLAYED (on the on-screen keyboard or the fretboard) against a metronome: the pure part, without DOM nor audio.
 *
 *  - `takeClock(movement, fromMi, toMi)`: the tempo of the measures to record as a clock — seconds since the start of the take (the start of measure
 *    `fromMi`) ↔ whole notes, the metronome's clicks (a pre-roll before the take, then every beat), the length of the take.
 *  - `quantizeTake(events, clock, { grid, offset })`: raw events { t (seconds since the start of the take), type 'on' | 'off', midi, string?, fret? } →
 *    chords snapped to a grid. `offset` (seconds) is the latency: events arrive that much LATE, so every time is moved back by it before snapping.
 *      1. notes are paired (on / off) and their start and end snapped to the grid (a note lasts one step at least);
 *      2. notes starting on the same step make a chord, which lasts as long as its median note;
 *      3. a chord is cut where the next one starts (one voice); with `legato` it lasts until the next one (no rests between chords).
 *    Not done (first version): triplets, several voices, notes before the first measure (the pre-roll) or after the last one.
 *  - `estimateOffset(events, clock, { grid, offset })`: how late the notes sit on average inside a grid step (a circular mean of their phase), so the
 *    latency can be proposed after a take. Only within ±half a step: a bigger latency is for the calibration to find.
 * Positions are exact fractions of a whole note since the start of the take; seconds are numbers (the tempo map is real-valued).
 */
import { frac, fAdd, fSub, fMul, fToNumber, ZERO } from '../model/fraction.js';
import { PID, getProperty } from '../model/index.js';
import { measureLengthOf } from '../model/timing.js';
import { tempoTimeline } from '../model/tempomap.js';

const TICKS = 3840; // resolution of the search for a position from a time (a quarter note = 960)

/** Beats of a time signature as a fraction of a whole note: 1/den, or 3/den in compound time (6/8, 9/8, 12/8). */
export function beatOf([num, den]) {
  return num > 3 && num % 3 === 0 && den >= 8 ? frac(3, den) : frac(1, den);
}

/** Clock of the measures `fromMi` … `toMi - 1` (indices of the movement's measures; `toMi` excluded). */
export function takeClock(movement, fromMi, toMi) {
  if (!(fromMi >= 0 && toMi > fromMi && toMi <= movement.masterbars.length)) throw new RangeError('takeClock: empty or invalid measure range');
  const timeline = tempoTimeline(movement);
  const { starts, lengths } = timeline.layout;
  const absFrom = starts[fromMi];
  const absTo = fAdd(starts[toMi - 1], lengths[toMi - 1]);
  const t0 = timeline.secondsAt(absFrom);
  const lengthFraction = fSub(absTo, absFrom);
  const length = timeline.secondsAt(absTo) - t0; // seconds of the whole take
  const wps0 = timeline.tempoAt(absFrom);
  /** Seconds since the start of the take of a position (exact fraction of a whole note since the start of the take); may be negative (pre-roll). */
  const secondsOf = (rel) => {
    if (rel[0] < 0) return fToNumber(rel) / wps0;
    return timeline.secondsAt(fAdd(absFrom, rel)) - t0;
  };
  /** Whole notes (number) since the start of the take at `sec` seconds since its start (negative: constant tempo before the take). */
  const wholeAt = (sec) => {
    if (sec <= 0) return sec * wps0;
    const target = t0 + sec;
    const base = Math.round(fToNumber(absFrom) * TICKS);
    let lo = base; let hi = base + TICKS;
    for (let i = 0; i < 40 && timeline.secondsAt(frac(hi, TICKS)) < target; i += 1) hi += (hi - lo);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (timeline.secondsAt(frac(mid, TICKS)) < target) lo = mid; else hi = mid;
    }
    const a = timeline.secondsAt(frac(lo, TICKS)); const b = timeline.secondsAt(frac(hi, TICKS));
    const part = b > a ? (target - a) / (b - a) : 0;
    return (lo + part) / TICKS - fToNumber(absFrom);
  };
  /** The metronome: { t (seconds since the start of the take, negative = pre-roll), accent (first beat of a measure), beat (0-based, in its measure), measure (index; -1 = pre-roll) }. */
  const clicks = (prerollBeats = 0) => {
    const out = [];
    const first = getProperty(movement.masterbars[fromMi], PID.TIME_SIG);
    const pre = beatOf(first);
    const perBar = Math.max(1, Math.round(fToNumber(measureLengthOf(movement.masterbars[fromMi])) / fToNumber(pre)));
    for (let k = prerollBeats; k >= 1; k -= 1) out.push({ t: -(k * fToNumber(pre)) / wps0, accent: (prerollBeats - k) % perBar === 0, beat: (prerollBeats - k) % perBar, measure: -1 });
    for (let mi = fromMi; mi < toMi; mi += 1) {
      const bar = movement.masterbars[mi];
      const beat = beatOf(getProperty(bar, PID.TIME_SIG));
      const len = lengths[mi];
      let pos = ZERO; let j = 0;
      while (fToNumber(pos) < fToNumber(len) - 1e-9) {
        out.push({ t: secondsOf(fAdd(fSub(starts[mi], absFrom), pos)), accent: j === 0, beat: j, measure: mi });
        pos = fAdd(pos, beat); j += 1;
      }
    }
    return out;
  };
  return { timeline, length, lengthFraction, secondsOf, wholeAt, clicks, wps0, fromMi, toMi };
}

const keyOf = (e) => `${e.midi}|${e.string ?? ''}`;

/** Notes (on paired with off) in time order: { on, off, midi, string, fret, stringCount, velocity } (seconds since the start of the take, offset applied). */
function pairNotes(events, length, offset) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const open = new Map(); const out = []; let id = 0;
  for (const e of sorted) {
    const t = e.t - offset;
    if (e.type === 'on') {
      const old = open.get(keyOf(e));
      if (old) { old.off = t; out.push(old); }
      open.set(keyOf(e), { id: id++, on: t, off: null, midi: e.midi, string: e.string, fret: e.fret, stringCount: e.stringCount, velocity: e.velocity });
    } else {
      const n = open.get(keyOf(e));
      if (n) { n.off = t; out.push(n); open.delete(keyOf(e)); }
    }
  }
  for (const n of open.values()) { n.off = length; out.push(n); }
  return out.sort((a, b) => a.on - b.on);
}

const lowMedian = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

/**
 * Snaps a take to a grid. `edits` (Map: note id → { deleted?, midi?, start?, end? }) are the user's corrections made in the piano roll: `start` / `end` are
 * EXACT fractions of a whole note since the start of the take, so they survive a change of grid (they are re-snapped to the new one); a new `midi` drops the
 * string and fret the note was played on (they are worked out again when it is written).
 * @returns {{ chords: { start, duration, startIndex, steps, notes }[], steps: number, grid }}; each note carries its `id` and its own `start` / `end` steps.
 */
export function quantizeTake(events, clock, { grid = frac(1, 16), offset = 0, legato = false, edits = null } = {}) {
  const gridF = fToNumber(grid);
  const total = Math.floor(fToNumber(clock.lengthFraction) / gridF + 1e-9);
  const groups = new Map();
  for (const n of pairNotes(events, clock.length, offset)) {
    const ed = edits?.get(n.id);
    if (ed?.deleted) continue;
    const snap = (f) => Math.round(fToNumber(f) / gridF + 1e-9) || 0;
    const k0 = ed?.start ? snap(ed.start) : Math.round(clock.wholeAt(n.on) / gridF) || 0; // (never -0)
    if (k0 < 0 || k0 >= total) continue; // the pre-roll, or after the last measure
    const k1 = Math.min(total, Math.max(k0 + 1, ed?.end ? snap(ed.end) : Math.round(clock.wholeAt(n.off) / gridF)));
    const note = Number.isInteger(ed?.midi) && ed.midi !== n.midi
      ? { id: n.id, midi: ed.midi, velocity: n.velocity }
      : { id: n.id, midi: n.midi, string: n.string, fret: n.fret, stringCount: n.stringCount, velocity: n.velocity };
    const g = groups.get(k0) ?? { index: k0, ends: [], notes: [] };
    if (g.notes.some((x) => x.midi === note.midi && (x.string ?? '') === (note.string ?? ''))) continue; // the same key twice on a step
    g.ends.push(k1 - k0);
    g.notes.push({ ...note, start: k0, end: k1 });
    groups.set(k0, g);
  }
  const list = [...groups.values()].sort((a, b) => a.index - b.index);
  const chords = list.map((g, i) => {
    const next = list[i + 1]?.index ?? total;
    const steps = Math.max(1, legato ? next - g.index : Math.min(lowMedian(g.ends), next - g.index)); // legato: each chord lasts until the next one
    return { start: fMul(grid, frac(g.index, 1)), duration: fMul(grid, frac(steps, 1)), startIndex: g.index, steps, notes: g.notes.sort((a, b) => a.midi - b.midi) };
  });
  return { chords, steps: total, grid };
}

/**
 * How late (seconds, + = late) the note starts sit inside a grid step on average, and how sure that is (0..1: all on the same phase = 1).
 * `offset` is the latency already applied; the result is what to ADD to it. null when there are fewer than 2 notes.
 */
export function estimateOffset(events, clock, { grid = frac(1, 16), offset = 0 } = {}) {
  const gridF = fToNumber(grid);
  const starts = pairNotes(events, clock.length, offset).map((n) => n.on).filter((t) => t >= 0 && t < clock.length);
  if (starts.length < 2) return null;
  let c = 0; let s = 0;
  for (const t of starts) { const phase = clock.wholeAt(t) / gridF; const a = 2 * Math.PI * (phase - Math.round(phase)); c += Math.cos(a); s += Math.sin(a); }
  const R = Math.hypot(c, s) / starts.length;
  const mean = Math.atan2(s, c) / (2 * Math.PI); // in steps, -0.5 … 0.5
  const stepSeconds = clock.secondsOf(grid) - clock.secondsOf(ZERO);
  return { seconds: mean * stepSeconds, confidence: R, count: starts.length };
}
