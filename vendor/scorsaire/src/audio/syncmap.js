// Time map of a synchronised recording: audio seconds ↔ (measure, ratio of the measure). PURE (no DOM, no audio).
// Built from `sync.measures` (see import/allinone.js): per measure its start, its end and the time of each of its beats. Inside a measure the
// time is interpolated between the beats, so a live tempo is followed beat by beat. `offset` (seconds) slides the whole map in time (the global
// correction the user may apply); it is the only edit a map from an analysis accepts.
//
// PLAYED ORDER: a recording that plays a repeat or a volta twice has MORE measures than the score has bars. `measures` is then the list of the measures AS PLAYED (in time order) and
// `order[k]` the index of the written measure that the k-th played measure is (`playOrder` of the movement at the time the map was made). Without `order` the two are the same.
// The map answers in WRITTEN measures: `locate(t)` gives the written measure heard at `t` (and which pass it is), `timeOf(m)` the time of its FIRST pass (`timeOfPass` any other).

/** @param {{ start: number, end: number, beats: number[] }[]} measures  @param {{ offset?: number, order?: number[] }} [options] `order`: the written measure of each played one (see above) */
export function createSyncMap(measures, { offset = 0, order = null } = {}) {
  if (!Array.isArray(measures) || !measures.length) throw new Error('A sync map needs at least one measure');
  if (order !== null && !(Array.isArray(order) && order.length === measures.length && order.every((w) => Number.isInteger(w) && w >= 0))) order = null; // a list that does not fit is ignored: the map is then read as written
  const shift = (t) => t + offset;
  const starts = measures.map((m) => m.start);
  const writtenOf = (k) => (order ? order[k] : k);
  const written = order ? Math.max(...order) + 1 : measures.length; // the number of bars of the score the map speaks of
  // the played measures of each written one, in time order: [[k, k', …], …]; a bar that is never played takes the pass of the next bar that is
  const passes = Array.from({ length: written }, () => []);
  measures.forEach((_, k) => passes[writtenOf(k)].push(k));
  for (let w = written - 1; w >= 0; w -= 1) if (!passes[w].length) passes[w] = w + 1 < written ? passes[w + 1].slice(0, 1) : [measures.length - 1];

  /** Seconds of the position `ratio` (0..1) of the PLAYED measure `index`. */
  function timeOfPlayed(index, ratio = 0) {
    const i = Math.min(Math.max(index, 0), measures.length - 1);
    const m = measures[i];
    const n = m.beats.length;
    const x = Math.min(Math.max(ratio, 0), 1) * n;
    const k = Math.min(Math.floor(x), n - 1);
    const a = m.beats[k];
    const b = k + 1 < n ? m.beats[k + 1] : m.end;
    return shift(a + (x - k) * (b - a));
  }
  /** Seconds of the position `ratio` of the WRITTEN measure `index`, at its first pass. */
  function timeOf(index, ratio = 0) { return timeOfPlayed(passes[Math.min(Math.max(index, 0), written - 1)][0], ratio); }
  /** The same at its `pass`-th time (0 = the first); a pass that does not exist is the last one. */
  function timeOfPass(index, pass = 0, ratio = 0) { const list = passes[Math.min(Math.max(index, 0), written - 1)]; return timeOfPlayed(list[Math.min(Math.max(pass, 0), list.length - 1)], ratio); }

  /** Played measure and ratio at `time` seconds. Before the first beat: measure 0, ratio 0 (`before`); after the last end: the last measure, ratio 1 (`after`). */
  function locatePlayed(time) {
    const t = time - offset;
    if (t < starts[0]) return { measure: 0, ratio: 0, before: true, after: false };
    const last = measures[measures.length - 1];
    if (t >= last.end) return { measure: measures.length - 1, ratio: 1, before: false, after: true };
    let lo = 0; let hi = measures.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= t) lo = mid; else hi = mid - 1; }
    const m = measures[lo];
    const n = m.beats.length;
    let k = n - 1;
    while (k > 0 && m.beats[k] > t) k -= 1;
    const a = m.beats[k];
    const b = k + 1 < n ? m.beats[k + 1] : m.end;
    return { measure: lo, ratio: (k + (b > a ? (t - a) / (b - a) : 0)) / n, before: false, after: false };
  }
  /** WRITTEN measure and ratio at `time` seconds, with the played measure (`played`) and which pass of the written one it is (`pass`, 0 = the first). */
  function locate(time) {
    const at = locatePlayed(time);
    const w = writtenOf(at.measure);
    return { ...at, measure: w, played: at.measure, pass: Math.max(0, passes[w].indexOf(at.measure)) };
  }

  /** The played measure of written bar `w` whose start is the nearest to `time` (a click on a bar of the score chooses the pass the recording is at, or next to). */
  function playedNear(w, time = 0) {
    const list = passes[Math.min(Math.max(w, 0), written - 1)];
    let best = list[0]; let d = Infinity;
    for (const k of list) { const x = Math.abs(timeOfPlayed(k, 0) - time); if (x < d) { d = x; best = k; } }
    return best;
  }
  /** The first played measure of written bar `w` at or after played measure `from` (the end of a selection that runs over a repeat), else its last pass. */
  function playedFrom(w, from = 0) {
    const list = passes[Math.min(Math.max(w, 0), written - 1)];
    return list.find((k) => k >= from) ?? list[list.length - 1];
  }

  return {
    timeOf, timeOfPass, timeOfPlayed, locate, locatePlayed, offset, measureCount: written, playedCount: measures.length, order,
    writtenOf, playedNear, playedFrom,
    passOf: (k) => Math.max(0, passes[writtenOf(Math.min(Math.max(k, 0), measures.length - 1))].indexOf(k)),
    passesOf: (w) => (passes[w] ?? []).length,
    start: () => shift(starts[0]), end: () => shift(measures[measures.length - 1].end),
    withOffset: (next) => createSyncMap(measures, { offset: next, order }),
  };
}
