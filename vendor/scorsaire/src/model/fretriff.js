// Placing the notes of a riff on the neck of a fretted instrument. PURE (no DOM, no document).
//
// A chord pattern writes its notes as chord DEGREES (`chorddegrees.js`), never as pitches. For the piano `comping.js` turns a degree into a pitch directly. A guitar
// first has its chord SHAPE chosen (`fretdiagram.js` `resolveDiagram`, `fretpath.js` `chooseFretPath`: the diagram the user drew, a preferred one, or the path of least
// movement); this module then decides, for the notes of ONE hit, on which string and fret each of them is played, near the hand that holds that shape.
// The notes are an accompaniment: what matters is that each note is the right one for the chord, not that it is what a guitarist would play.
//
// For each note, in this order of preference (the costs below):
//   1. a string of the shape that already carries this degree (the finger is already there);
//   2. a free string, fretted inside the hand zone (the span of the shape's fretted notes, widened by `reach` frets);
//   3. an open string;
//   4. nothing good: the note is played as on a keyboard, at the pitch it has above the root (`source: 'fallback'`, no string).
// The OCTAVE is not written: the root is put at the octave nearest to the hand (the mean pitch of the shape), the degrees keep their own number (8 is an octave
// above 1, 9 a ninth above) so that the contour of the riff stays; a note may shift by an octave (`maxDrift`) to be reached by the hand.
// The values are Scorsaire's own choices, to be tuned by ear.
import { isPiano, voicingTuning, INSTRUMENT_PRESETS } from './fretvoicing.js';

export const RIFF_COSTS = Object.freeze({
  /** a fretted note of a free string costs this, plus `drift` per fret from the middle of the hand zone */
  free: 1,
  drift: 0.2,
  /** an open string that the shape does not use */
  open: 2,
  /** per octave a note is moved away from its written place (the root at the octave nearest to the hand) */
  octave: 4,
  /** a note that cannot be placed (its cost only has to be above every other) */
  fallback: 100,
});

export const RIFF_DEFAULTS = Object.freeze({
  /** frets added on each side of the fretted notes of the shape to make the hand zone */
  reach: 2,
  /** the farthest a note may move from its place, in semitones (one octave) */
  maxDrift: 12,
  /** mean pitch of the hand when there is no shape (MIDI) */
  centre: 55,
  maxFret: 24,
});

const mod12 = (n) => ((n % 12) + 12) % 12;

/** The octave of the root nearest to `centre` (the lower one when two are equally near): the MIDI pitch of the root. */
function rootNear(rootPc, centre) {
  let best = null;
  for (let p = 0; p <= 127; p++) if (mod12(p) === mod12(rootPc) && (best === null || Math.abs(p - centre) < Math.abs(best - centre))) best = p;
  return best;
}

/**
 * Where to play the notes of one hit.
 * @param p {
 *   voicing   the chord shape { instrument, frets, tuning? } (frets: −1 = muted, 0 = open), or null / a piano voicing (then every note is a fallback)
 *   rootPc    pitch class of the root of the chord (0-11)
 *   intervals the notes of the hit, in semitones above the root (0-23): `degreeSemis` of `comping.js`, in the order of the hit
 *   tuning    open-string pitches to use instead of the shape's (a capo raises them; the frets are then counted from the capo)
 *   options   { reach, maxDrift, centre, maxFret }
 * }
 * @returns {{ rootPitch, notes: { interval, pitch, string, fret, source: 'shape' | 'free' | 'open' | 'fallback' }[] }}
 *   `notes` in the order of `intervals`; `string` is the index in the tuning (0 = the first of the shape's frets) and `fret` is null for a fallback.
 */
export function placeRiffHit({ voicing = null, rootPc, intervals, tuning = null, options = {} }) {
  const o = { ...RIFF_DEFAULTS, ...options };
  const shape = voicing && !isPiano(voicing) ? voicing : null;
  const open = shape ? (tuning ?? voicingTuning(shape)) : null;
  const maxFret = options.maxFret ?? (shape ? INSTRUMENT_PRESETS[shape.instrument]?.maxFret : null) ?? o.maxFret;

  // the hand: the mean pitch of the shape and the span of its fretted notes
  const held = shape ? shape.frets.map((f, s) => (f >= 0 ? open[s] + f : null)) : [];
  const sounding = held.filter((x) => x !== null);
  const centre = sounding.length ? sounding.reduce((a, b) => a + b, 0) / sounding.length : o.centre;
  const fretted = shape ? shape.frets.filter((f) => f > 0) : [];
  const lo = fretted.length ? Math.min(...fretted) : 1;
  const hi = fretted.length ? Math.max(...fretted) : 1;
  const zoneLo = Math.max(1, lo - o.reach); const zoneHi = Math.min(maxFret, hi + o.reach);
  const zoneMid = (lo + hi) / 2;

  const rootPitch = rootNear(rootPc, centre);
  const wanted = intervals.map((i) => rootPitch + i);

  // for each note, the cheapest place on each string
  const choices = wanted.map((pitch) => {
    const list = [];
    if (shape) {
      open.forEach((base, s) => {
        let best = null;
        const consider = (fret, source, cost) => {
          const drift = Math.abs(base + fret - pitch);
          if (mod12(base + fret) !== mod12(pitch) || drift > o.maxDrift) return;
          const total = cost + (RIFF_COSTS.octave * drift) / 12;
          if (best === null || total < best.cost) best = { string: s, fret, pitch: base + fret, source, cost: total };
        };
        if (shape.frets[s] >= 0) consider(shape.frets[s], 'shape', 0);
        consider(0, 'open', RIFF_COSTS.open);
        for (let f = zoneLo; f <= zoneHi; f++) consider(f, 'free', RIFF_COSTS.free + RIFF_COSTS.drift * Math.abs(f - zoneMid));
        if (best) list.push(best);
      });
    }
    return list.sort((a, b) => a.cost - b.cost);
  });

  // the cheapest way to give every note its own string (a hit has a handful of notes: an exhaustive search with pruning)
  let bestCost = Infinity; let bestPick = [];
  const walk = (k, used, pick, cost) => {
    if (cost >= bestCost) return;
    if (k === choices.length) { bestCost = cost; bestPick = pick; return; }
    for (const c of choices[k]) if (!used.has(c.string)) walk(k + 1, new Set([...used, c.string]), [...pick, c], cost + c.cost);
    walk(k + 1, used, [...pick, null], cost + RIFF_COSTS.fallback);
  };
  walk(0, new Set(), [], 0);

  return {
    rootPitch,
    notes: intervals.map((interval, k) => {
      const c = bestPick[k];
      return c ? { interval, pitch: c.pitch, string: c.string, fret: c.fret, source: c.source } : { interval, pitch: wanted[k], string: null, fret: null, source: 'fallback' };
    }),
  };
}
