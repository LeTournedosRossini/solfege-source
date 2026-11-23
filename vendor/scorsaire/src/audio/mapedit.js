/*
 * Correcting a sync map AFTER it is made, without doing it all again: move the start of ONE measure. PURE (numbers in, numbers out).
 * A map is a list of played measures; a video keeps just the START of each (its `points`, rebuilt into measures by `videoMeasures`), a recording of stems keeps the measures themselves
 * ({ start, end, beats }). Moving the start of measure k changes the length of the two measures around it (k − 1 ends where k now starts); nothing else moves — unless the person asks for
 * the rest to follow (`shiftFrom`). A measure never gets shorter than `MIN_MEASURE` seconds.
 */
export const MIN_MEASURE = 0.2;
export const NUDGE_STEPS = Object.freeze([10, 100]); // ms

/** The instants (s) between which the start of the played measure `k` may be put: [lo, hi] (a neighbour keeps at least `min` seconds). */
export function pointBounds(points, k, { min = MIN_MEASURE } = {}) {
  const lo = k > 0 ? points[k - 1] + min : -Infinity;
  const hi = k + 1 < points.length ? points[k + 1] - min : Infinity;
  return { lo, hi };
}

/** A copy of the video's measure starts with the start of measure `k` at `t` (kept between its neighbours). Returns { points, start } — `start` is where it really went. */
export function movePoint(points, k, t, { min = MIN_MEASURE } = {}) {
  if (!(k >= 0 && k < points.length) || !Number.isFinite(t)) return { points: [...points], start: points[k] };
  const { lo, hi } = pointBounds(points, k, { min });
  const start = Math.min(hi, Math.max(lo, t));
  const out = [...points]; out[k] = start;
  return { points: out, start };
}

/** A copy of the starts with `k` and every later one moved by `delta` seconds (the rest of the piece follows), the first one never before `min` after the one that stays. */
export function shiftPointsFrom(points, k, delta, { min = MIN_MEASURE } = {}) {
  if (!(k >= 0 && k < points.length) || !Number.isFinite(delta)) return [...points];
  const floor = k > 0 ? points[k - 1] + min : -Infinity;
  const d = Math.max(delta, floor - points[k]);
  return points.map((p, i) => (i >= k ? p + d : p));
}

const rescale = (beats, from, to) => beats.map((b) => to.start + ((b - from.start) / Math.max(1e-9, from.end - from.start)) * (to.end - to.start));

/**
 * The same for a list of measures ({ start, end, beats }): measure `k` starts at `t`, measure `k − 1` ends there, their beats follow proportionally. Returns { measures, start }.
 */
export function moveMeasureStart(measures, k, t, { min = MIN_MEASURE } = {}) {
  if (!(k >= 0 && k < measures.length) || !Number.isFinite(t)) return { measures: measures.map((m) => ({ ...m })), start: measures[k]?.start };
  const lo = k > 0 ? measures[k - 1].start + min : -Infinity; const hi = measures[k].end - min;
  const start = Math.min(hi, Math.max(lo, t));
  const out = measures.map((m) => ({ ...m, beats: [...m.beats] }));
  const cur = measures[k]; out[k] = { start, end: cur.end, beats: rescale(cur.beats, cur, { start, end: cur.end }) };
  if (k > 0) { const prev = measures[k - 1]; out[k - 1] = { start: prev.start, end: start, beats: rescale(prev.beats, prev, { start: prev.start, end: start }) }; }
  return { measures: out, start };
}

/** The same with the later measures following: `k` and everything after it moves by `delta` seconds, measure `k − 1` stretches or shrinks to reach the new start. */
export function shiftMeasuresFrom(measures, k, delta, { min = MIN_MEASURE } = {}) {
  if (!(k >= 0 && k < measures.length) || !Number.isFinite(delta)) return measures.map((m) => ({ ...m }));
  const floor = k > 0 ? measures[k - 1].start + min - measures[k].start : -Infinity;
  const d = Math.max(delta, floor);
  const out = measures.map((m, i) => (i >= k ? { start: m.start + d, end: m.end + d, beats: m.beats.map((b) => b + d) } : { ...m, beats: [...m.beats] }));
  if (k > 0) { const prev = measures[k - 1]; out[k - 1] = { start: prev.start, end: prev.end + d, beats: rescale(prev.beats, prev, { start: prev.start, end: prev.end + d }) }; }
  return out;
}

/** A small history of states (undo) with the first one kept as « the original ». */
export function createMapHistory(initial) {
  const states = [initial]; let at = 0;
  return {
    original: () => states[0],
    current: () => states[at],
    push(state) { states.length = at + 1; states.push(state); at += 1; },
    canUndo: () => at > 0,
    undo() { if (at > 0) at -= 1; return states[at]; },
    reset() { states.length = 1; at = 0; return states[0]; },
    changed: () => at > 0,
  };
}
