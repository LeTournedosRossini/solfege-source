/*
 * The path of least movement through a chord progression on a fretted instrument. PURE (no DOM, no document).
 *
 * Every chord has several fingerings (`suggestVoicings`, ranked by playability); a progression is hard to play when the HAND jumps between them, not when one
 * chord is a bit stretched. So the whole progression is chosen at once (dynamic programming, the cheapest path through every chord): each fingering costs a little
 * for being less comfortable than the best one of its chord (`ease`) and each change from one fingering to the next costs the distance the hand travels on the
 * neck, less a bonus for every finger that can stay where it is or slide one or two frets (`move`). A fingering the user fixed is the only choice of its chord:
 * the path is built around it.
 *
 * Modes (the staff's setting): 'easy' favours comfortable shapes, 'balanced' both, 'close' the smallest movement, even through a less comfortable shape.
 */
export const PATH_MODES = Object.freeze(['off', 'easy', 'balanced', 'close']);
export const DEFAULT_PATH_MODE = 'balanced';

const WEIGHTS = Object.freeze({ easy: { ease: 1.5, move: 0.5 }, balanced: { ease: 1, move: 1 }, close: { ease: 0.35, move: 1.5 } });
const EASE_UNIT = 4; // the score of a fingering (about 25..45) in comfort steps: 4 points of score = 1 step
const STAY = 0.6; const SLIDE = 0.2;

/** Where the hand sits: the middle of the fretted notes (an open shape sits around its fretted notes; no fretted note = the nut). */
export function handCentre(frets) {
  const fretted = frets.filter((f) => f > 0);
  return fretted.length ? (Math.min(...fretted) + Math.max(...fretted)) / 2 : 0;
}

/** The cost of going from the fingering `a` to the fingering `b` (arrays of frets, −1 = not played): travel of the hand, less what the fingers keep. */
export function moveCost(a, b) {
  let cost = Math.abs(handCentre(a) - handCentre(b));
  const n = Math.min(a.length, b.length);
  for (let s = 0; s < n; s++) {
    if (a[s] > 0 && b[s] > 0) cost -= a[s] === b[s] ? STAY : Math.abs(a[s] - b[s]) <= 2 ? SLIDE : 0;
  }
  return Math.max(0, cost);
}

/**
 * @param chords  [{ fixed: voicing | null, candidates: [{ voicing, score }] }] in playing order; `fixed` wins over `candidates`
 * @param mode    'easy' | 'balanced' | 'close'
 * @returns       [voicing | null] one per chord (null where a chord has neither a fixed fingering nor a candidate)
 */
export function chooseFretPath(chords, { mode = DEFAULT_PATH_MODE } = {}) {
  const w = WEIGHTS[mode] ?? WEIGHTS[DEFAULT_PATH_MODE];
  const options = chords.map((c) => {
    if (c.fixed) return [{ voicing: c.fixed, unary: 0 }];
    const list = c.candidates ?? [];
    const best = list.reduce((m, x) => Math.max(m, x.score), -Infinity);
    return list.map((x) => ({ voicing: x.voicing, unary: ((best - x.score) / EASE_UNIT) * w.ease }));
  });
  const result = new Array(chords.length).fill(null);
  // a chord without any fingering breaks the progression in two: each part has its own cheapest path
  let from = 0;
  while (from < options.length) {
    if (!options[from].length) { from++; continue; }
    let to = from;
    while (to + 1 < options.length && options[to + 1].length) to++;
    const cost = []; const back = [];
    for (let i = from; i <= to; i++) {
      const row = []; const prev = [];
      options[i].forEach((o, j) => {
        if (i === from) { row.push(o.unary); prev.push(-1); return; }
        let bestCost = Infinity; let bestK = 0;
        options[i - 1].forEach((p, k) => {
          const c = cost[i - 1 - from][k] + w.move * moveCost(p.voicing.frets, o.voicing.frets);
          if (c < bestCost - 1e-9) { bestCost = c; bestK = k; }
        });
        row.push(bestCost + o.unary); prev.push(bestK);
      });
      cost.push(row); back.push(prev);
    }
    let j = cost[cost.length - 1].reduce((bi, c, k, arr) => (c < arr[bi] - 1e-9 ? k : bi), 0);
    for (let i = to; i >= from; i--) { result[i] = options[i][j].voicing; j = back[i - from][j]; }
    from = to + 1;
  }
  return result;
}
