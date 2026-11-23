/*
 * Where to put the notes of a track on a fretboard (the guitar viewer). A pitch can be played on several strings, so a position must be CHOSEN.
 * Known positions win: a note that already knows its string (a tablature note, or a notation note with a string hint) keeps it when it fits the
 * viewer's tuning. For the others the choice is the classic "optimal path" one (Sayegh 1989, dynamic programming over the successive chords):
 * every chord has a few candidate fingerings (one string per note, never two notes on a string); a fingering costs its hand span and its height on
 * the neck; going from one fingering to the next costs the shift of the hand. The cheapest path through the whole track (Viterbi) is kept, so a
 * melody stays in one position instead of jumping across the neck. Pure functions, no DOM.
 */

/** Open strings (MIDI), LOWEST string first (the order of the instrument catalogue). */
export const FRETBOARD_INSTRUMENTS = Object.freeze({
  guitar: { strings: [40, 45, 50, 55, 59, 64], frets: 22 },
  guitar7: { strings: [35, 40, 45, 50, 55, 59, 64], frets: 22 },
  bass: { strings: [28, 33, 38, 43], frets: 21 },
  bass5: { strings: [23, 28, 33, 38, 43], frets: 21 },
  ukulele: { strings: [67, 60, 64, 69], frets: 15 }, // re-entrant: the G string is the highest in pitch order of the strings but listed first
});

const SPAN_LIMIT = 5;     // frets a hand can cover (open strings are free)
const MAX_CANDIDATES = 14; // fingerings kept per chord

/** Positions (string index 0 = lowest string, fret) where `pitch` can be played. */
export function positionsOf(pitch, strings, frets) {
  const out = [];
  strings.forEach((open, s) => { const f = pitch - open; if (f >= 0 && f <= frets) out.push({ string: s, fret: f }); });
  return out;
}

/** Cost of a fingering on its own: span of the hand, height on the neck (low is better), stretched strings between used strings. */
function innerCost(fingering, limit = 0) {
  const fretted = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  if (!fretted.length) return 0;
  const lo = Math.min(...fretted); const hi = Math.max(...fretted);
  const span = hi - lo;
  // `limit` = the player wants to stay on the first frets: every fret beyond it costs
  return (span > SPAN_LIMIT ? 100 + (span - SPAN_LIMIT) * 20 : span * 2) + lo * 0.15 + (limit && hi > limit ? (hi - limit) * 6 : 0);
}

/** Centre of the hand for a fingering (open strings do not move the hand). */
function centre(fingering, previous = 0) {
  const fretted = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  return fretted.length ? (Math.min(...fretted) + Math.max(...fretted)) / 2 : previous;
}

/** Candidate fingerings of a chord: every note on a different string, the cheapest ones. Notes with a known position are fixed. */
function candidatesOf(chord, strings, frets, limit = 0) {
  const options = chord.map((n) => {
    if (n.string != null && n.string >= 0 && n.string < strings.length) {
      const f = n.pitch - strings[n.string];
      if (f >= 0 && f <= frets) return [{ string: n.string, fret: f }];
    }
    return positionsOf(n.pitch, strings, frets);
  });
  if (options.some((o) => !o.length)) return null; // a note outside the neck: no fingering for the chord
  const found = [];
  const used = new Set();
  const pick = (i, acc) => {
    if (found.length > 4000) return;
    if (i === options.length) { found.push(acc.slice()); return; }
    for (const p of options[i]) {
      if (used.has(p.string)) continue;
      used.add(p.string); acc.push(p); pick(i + 1, acc); acc.pop(); used.delete(p.string);
    }
  };
  pick(0, []);
  if (!found.length) return null;
  found.sort((a, b) => innerCost(a, limit) - innerCost(b, limit));
  return found.slice(0, MAX_CANDIDATES);
}

/**
 * Chooses a position for every note.
 * @param limit  0 = free; n = prefer to stay on the first n frets (a soft preference, not a wall)
 * @param notes  [{ pitch, t, string? }] (string = index from the LOWEST string, when already known); any order
 * @returns {Array<{ string, fret } | null>} parallel to `notes`; null = the note does not fit on the neck
 */
export function assignPositions(notes, { strings: openStrings, frets: maxFrets, limit = 0, capo = null }) {
  // A capo makes its fret the new nut for every string it presses: the search runs on the shortened neck with the strings raised by the capo, then the
  // frets are put back to absolute ones. `capo` = { fret, ignored: Set of string indices (0 = lowest) the capo does not press }.
  const K = capo?.fret ?? 0;
  const pressed = (i) => K > 0 && !capo.ignored?.has(i);
  const strings = openStrings.map((m, i) => (pressed(i) ? m + K : m));
  const frets = Math.max(1, maxFrets - K);
  if (K > 0) {
    const inner = assignPositions(notes, { strings, frets, limit });
    return inner.map((p) => (p ? { string: p.string, fret: p.fret + (pressed(p.string) ? K : 0) } : null));
  }
  const result = new Array(notes.length).fill(null);
  const order = notes.map((n, i) => i).sort((a, b) => notes[a].t - notes[b].t);
  // chords = notes that start together
  const groups = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(notes[g[0]].t - notes[i].t) < 0.02) g.push(i); else groups.push([i]);
  }
  const layers = []; // for each playable group: { indices, cands }
  for (const indices of groups) {
    let cands = candidatesOf(indices.map((i) => notes[i]), strings, frets, limit);
    let idx = indices;
    if (!cands) { // some note does not fit: try with the notes that do
      idx = indices.filter((i) => positionsOf(notes[i].pitch, strings, frets).length);
      if (!idx.length) continue;
      cands = candidatesOf(idx.map((i) => notes[i]), strings, frets, limit);
      if (!cands) continue;
    }
    layers.push({ indices: idx, cands });
  }
  if (!layers.length) return result;
  // Viterbi: cost[k][c] = cheapest cost of reaching candidate c of layer k
  const cost = []; const back = []; const centres = [];
  layers.forEach((layer, k) => {
    const row = []; const brow = []; const crow = [];
    layer.cands.forEach((cand, c) => {
      const own = innerCost(cand, limit);
      if (k === 0) { row.push(own); brow.push(-1); crow.push(centre(cand, 0)); return; }
      let best = Infinity; let bestJ = 0; let bestCentre = 0;
      layers[k - 1].cands.forEach((_, j) => {
        const prevCentre = centres[k - 1][j];
        const here = centre(cand, prevCentre);
        const shift = Math.abs(here - prevCentre);
        const v = cost[k - 1][j] + (shift > 0 ? 1.2 * shift + (shift > SPAN_LIMIT ? 6 : 0) : 0);
        if (v < best) { best = v; bestJ = j; bestCentre = here; }
      });
      row.push(best + own); brow.push(bestJ); crow.push(bestCentre);
    });
    cost.push(row); back.push(brow); centres.push(crow);
  });
  let c = cost[layers.length - 1].reduce((bi, v, i, a) => (v < a[bi] ? i : bi), 0);
  for (let k = layers.length - 1; k >= 0; k--) {
    const cand = layers[k].cands[c];
    // candidates were built from the notes in `indices` order
    layers[k].indices.forEach((noteIndex, i) => { result[noteIndex] = cand[i]; });
    c = back[k][c];
  }
  return result;
}

/** Whether the notes of a track carry strings (tablature or hinted): the viewer then shows exactly what the tablature says. */
export const knownStringCount = (notes) => notes.reduce((n, x) => n + (x.string != null ? 1 : 0), 0);

/** Tunings the viewer offers, as semitone offsets from the instrument's standard tuning (lowest string first). Only presets that fit the string count apply. */
const all = (n, d) => Array(n).fill(d);
export const TUNING_PRESETS = Object.freeze([
  { id: 'standard', offsets: () => null },
  { id: 'halfDown', offsets: (n) => all(n, -1) },
  { id: 'wholeDown', offsets: (n) => all(n, -2) },
  { id: 'dropD', offsets: (n) => (n >= 4 ? [-2, ...all(n - 1, 0)] : null) },
  { id: 'dadgad', offsets: (n) => (n === 6 ? [-2, 0, 0, 0, -2, -2] : null) },
  { id: 'openG', offsets: (n) => (n === 6 ? [-2, -2, 0, 0, 0, -2] : null) },
  { id: 'openD', offsets: (n) => (n === 6 ? [-2, 0, 0, -1, -2, -2] : null) },
  { id: 'openE', offsets: (n) => (n === 6 ? [0, 2, 2, 1, 0, 0] : null) },
]);
/** Presets that fit `count` strings: [{ id }]. */
export const presetsFor = (count) => TUNING_PRESETS.filter((p) => p.id === 'standard' || p.offsets(count)).map((p) => ({ id: p.id }));
/** Strings of a tuning changed by a preset (the standard strings when the preset does not fit). */
export function applyPreset(strings, presetId) {
  const offsets = TUNING_PRESETS.find((p) => p.id === presetId)?.offsets(strings.length);
  return offsets ? strings.map((m, i) => m + offsets[i]) : strings.slice();
}
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** Letter name of a MIDI pitch (sharps), without octave: the open strings shown beside the neck. */
export const pitchLetter = (midi) => NAMES[((midi % 12) + 12) % 12];
