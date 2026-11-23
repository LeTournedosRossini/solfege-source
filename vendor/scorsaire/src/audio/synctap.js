/*
 * Making the synchronisation BY HAND: the person plays the recording and taps at the start of every measure; the instants become the time map of screen 4. PURE (no DOM, no audio).
 * The taps follow the recording, so they follow the score AS PLAYED: with a repeat at bars 3-4 the taps are 1, 2, 3, 4, 3, 4, 5… (`playOrder` of the movement). The map keeps that
 * order (`createSyncMap(…, { order })`) and answers in written bars.
 *
 *   times[k]   second of the recording at which the k-th PLAYED measure begins (as many as were tapped)
 *   lengths[k] length of the k-th played measure, in whole notes (1 = a 4/4 bar)
 */
import { playOrder } from '../model/repeatlist.js';
import { sectionList } from '../model/sections.js';
import { tempoTimeline } from '../model/tempomap.js';
import { bpmFromWps } from '../model/tempo.js';
import { measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';
import { videoMeasures } from './videosync.js';

export const MIN_GAP = 0.05; // seconds: two measures never start closer than this (a nudge stops there)

/** What the taps go over: the played order of the movement, the length of each played measure and which pass of its written bar each one is. */
export function tapPlan(movement) {
  const order = playOrder(movement);
  const lengths = order.map((w) => fToNumber(measureLengthOf(movement.masterbars[w])));
  const seen = new Map();
  const total = new Map(); for (const w of order) total.set(w, (total.get(w) ?? 0) + 1);
  const labels = order.map((w) => { const pass = seen.get(w) ?? 0; seen.set(w, pass + 1); return { measure: w, pass, passes: total.get(w) }; });
  const sectionStarts = sectionList(movement).map((x) => x.index); // written bars where a section begins
  const first = tempoTimeline(movement).events[0];
  const bpm = first && first.wps > 0 ? Math.round(bpmFromWps(first.wps)) : null; // the tempo the score starts at, in quarter notes per minute
  const pace = bpm ? 240 / bpm : 2; // seconds per whole note at the tempo of the score: the pace of the measures no tap tells about
  return { order, lengths, labels, sectionStarts, bpm, pace };
}

/** The first PLAYED measure after `after` that is the written bar `written`, or -1 (the bar is not played after that point). */
export function playedAfter(order, written, after = -1) {
  for (let k = after + 1; k < order.length; k += 1) if (order[k] === written) return k;
  return -1;
}

/** The first played measure after `after` where a section of the score begins, or -1. */
export function nextSectionPlayed(plan, after = -1) {
  for (let k = after + 1; k < plan.order.length; k += 1) if (plan.sectionStarts.includes(plan.order[k])) return k;
  return -1;
}

const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Seconds per whole note of what was tapped (the median of the full measures), or null with fewer than two taps. */
export function secondsPerWhole(times, lengths) {
  if (times.length < 2) return null;
  const v = median(times.slice(1).map((t, i) => (t - times[i]) / Math.max(1e-9, lengths[i])));
  return v > 0 ? v : null;
}

/**
 * What is wrong with a list of anchors, or null: 'none' (no anchor), 'order' (two on one measure, or time going back), 'pace' (measures are left before or after and no pace can be
 * taken: a single anchor), 'before' (the measures before the first anchor would begin before the start of the recording).
 */
export function anchorProblem(anchors, lengths, fallbackPace = 0) {
  const a = [...anchors].sort((x, y) => x.k - y.k);
  if (!a.length) return 'none';
  const n = lengths.length;
  const cum = [0]; lengths.forEach((l, i) => cum.push(cum[i] + l));
  const paces = [];
  for (let i = 0; i + 1 < a.length; i += 1) {
    const span = cum[a[i + 1].k] - cum[a[i].k];
    if (a[i + 1].k === a[i].k || !(span > 0) || !(a[i + 1].t > a[i].t)) return 'order';
    paces.push((a[i + 1].t - a[i].t) / span);
  }
  if (a[0].k > 0 || a[a.length - 1].k < n - 1) {
    const pace = median(paces) || fallbackPace;
    if (!(pace > 0)) return 'pace';
    if (a[0].k > 0 && a[0].t - pace * (cum[a[0].k] - cum[0]) < -1e-9) return 'before';
  }
  return null;
}

/**
 * Every played measure gets a start from ANCHORS: [{ k, t }] = the k-th played measure begins at second t (the person tapped it). Between two anchors the measures are spread by their
 * lengths (a steady tempo: tap only the start of the sections, or just the first and the last measure); before the first and after the last anchor they follow the pace of the anchors.
 * `fallbackPace` (seconds per whole note) stands in when the anchors give none (a single anchor). Returns { times, tapped } (`tapped` = the number of anchors), or null when `anchorProblem` says there is one.
 */
export function completeAnchors(anchors, lengths, fallbackPace = 0) {
  if (anchorProblem(anchors, lengths, fallbackPace)) return null;
  const a = [...anchors].sort((x, y) => x.k - y.k);
  const n = lengths.length;
  const cum = [0]; lengths.forEach((l, i) => cum.push(cum[i] + l));
  const times = new Array(n);
  const paces = [];
  for (let i = 0; i + 1 < a.length; i += 1) {
    const span = cum[a[i + 1].k] - cum[a[i].k];
    paces.push((a[i + 1].t - a[i].t) / span);
    for (let k = a[i].k; k < a[i + 1].k; k += 1) times[k] = a[i].t + ((a[i + 1].t - a[i].t) * (cum[k] - cum[a[i].k])) / span;
  }
  const first = a[0]; const last = a[a.length - 1];
  times[last.k] = last.t;
  const pace = median(paces) || fallbackPace; // a single anchor: the tempo of the score
  for (let k = first.k - 1; k >= 0; k -= 1) times[k] = times[k + 1] - pace * lengths[k]; // before the first anchor, at the pace of the anchors
  for (let k = last.k + 1; k < n; k += 1) times[k] = times[k - 1] + pace * lengths[k - 1];
  return { times, tapped: a.length };
}

/**
 * Is the pace of the anchors far from the tempo the score starts at? → { bpm (of the taps), ratio (taps / score) } and `warn` when the ratio is under 0.67 or over 1.5, or null when
 * it cannot be told (fewer than two anchors, or the score has no tempo). A ratio near 2 or ½ is the usual slip: half or double time, or a measure counted twice.
 */
export function tempoCheck(anchors, lengths, scoreBpm) {
  const a = [...anchors].sort((x, y) => x.k - y.k);
  if (a.length < 2 || !(scoreBpm > 0)) return null;
  const cum = [0]; lengths.forEach((l, i) => cum.push(cum[i] + l));
  const span = cum[a[a.length - 1].k] - cum[a[0].k];
  const dt = a[a.length - 1].t - a[0].t;
  if (!(span > 0) || !(dt > 0)) return null;
  const bpm = Math.round(240 / (dt / span));
  const ratio = bpm / scoreBpm;
  return { bpm, ratio, warn: ratio < 0.67 || ratio > 1.5 };
}

/** Every played measure tapped in turn (`times[k]` = measure k) completed after the last tap at the pace of the taps: the anchors of consecutive measures. */
export function completeTimes(times, lengths) {
  if (times.length >= lengths.length) return { times: times.slice(0, lengths.length), tapped: lengths.length };
  return completeAnchors(times.map((t, k) => ({ k, t })), lengths);
}

/** The measures of the map (see audio/syncmap.js) from complete times; the last one lasts as long as its length says at the pace of the others, but not past `duration`. */
export function tapsToMeasures(times, lengths, duration = Infinity) {
  const list = videoMeasures(times, lengths);
  const last = list[list.length - 1];
  if (last.end > duration && duration > last.start + MIN_GAP) { last.end = duration; last.beats = last.beats.map((_, k) => last.start + ((last.end - last.start) * k) / last.beats.length); }
  return list;
}

/** `delta` seconds added to the start of measure `i` (the person's reaction time, or a nudge): never past a neighbour. Returns a new list. */
export function nudge(times, i, delta) {
  const out = [...times];
  const lo = i > 0 ? out[i - 1] + MIN_GAP : 0;
  const hi = i + 1 < out.length ? out[i + 1] - MIN_GAP : Infinity;
  out[i] = Math.min(hi, Math.max(lo, out[i] + delta));
  return out;
}

/** Every tap moved by `ms` (positive = later): the correction of the hand being behind the beat (a negative value moves the taps earlier). The first never goes below 0. */
export function compensate(times, ms) {
  return times.map((t) => Math.max(0, t + ms / 1000));
}

/** Beats per minute of the whole thing, from the pace of the taps (quarter notes), rounded; null when unknown. */
export function bpmOf(times, lengths) {
  const p = secondsPerWhole(times, lengths);
  return p ? Math.round(240 / p) : null;
}

const medianOf = (values) => { const s = [...values].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * The hand's delay from taps made over a regular click: each tap is matched with the nearest click (further than `reach` seconds = a stray press, dropped); the delay is the median
 * of (tap − click). Returns { delayMs (positive = the hand is behind the beat), correctionMs (what to add to a tap: −delayMs), n, spreadMs (median deviation) }, or null with fewer than `min` usable taps.
 */
export function handDelayFromTaps(taps, clicks, { reach = 0.3, min = 4 } = {}) {
  const diffs = [];
  for (const t of taps) {
    let best = null;
    for (const c of clicks) if (best === null || Math.abs(t - c) < Math.abs(t - best)) best = c;
    if (best !== null && Math.abs(t - best) <= reach) diffs.push(t - best);
  }
  if (diffs.length < min) return null;
  const m = medianOf(diffs);
  const delayMs = Math.round(m * 1000);
  return { delayMs, correctionMs: -delayMs, n: diffs.length, spreadMs: Math.round(medianOf(diffs.map((d) => Math.abs(d - m))) * 1000) };
}

/**
 * How far the sound of a recording is from the taps: for each anchor the nearest clear attack (`attackNear(t, range)` → { offsetMs, ratio }, ratio ≥ 2 = a clear hit) gives an offset; the
 * median is the correction to ADD to the taps. Returns { correctionMs, n, spreadMs }, or null with fewer than `min` clear attacks.
 */
export function attackCorrection(anchors, attackNear, { range = 0.12, min = 3 } = {}) {
  const offs = [];
  for (const a of anchors) { const h = attackNear(a.t, range); if (h && h.ratio >= 2) offs.push(h.offsetMs); }
  if (offs.length < min) return null;
  const m = medianOf(offs);
  return { correctionMs: Math.round(m), n: offs.length, spreadMs: Math.round(medianOf(offs.map((d) => Math.abs(d - m)))) };
}

/** The instants (seconds, from `start`) of `count` clicks at `bpm`. */
export function clickTimes(start, bpm, count) {
  return Array.from({ length: count }, (_, i) => start + (i * 60) / bpm);
}

/**
 * The plan of the taps for a score that does not exist yet (made from the music): room for `max` measures, each tap is the next one, every measure in `timeSig` until the person changes it
 * (`timeSigs[k]` and `lengths[k]` are rewritten by the tapping window). `tempo` (quarter notes per minute) only sets the pace used when a single tap has been made.
 */
export function openTapPlan({ timeSig = [4, 4], tempo = 100, max = 400 } = {}) {
  const order = Array.from({ length: max }, (_, k) => k);
  return {
    order, lengths: order.map(() => timeSig[0] / timeSig[1]), timeSigs: order.map(() => [...timeSig]),
    labels: order.map((m) => ({ measure: m, pass: 0, passes: 1 })), sectionStarts: [], bpm: null, pace: 240 / tempo,
  };
}
