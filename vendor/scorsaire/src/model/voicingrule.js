/*
 * The RULE a layer of preferred fingerings can carry (see voicingpools.js): kept apart so that `fretdiagram.js` (which resolves a diagram) and
 * `voicingpools.js` (which edits the layers) do not import each other.
 */
import { createVoicing, INSTRUMENT_PRESETS } from './fretvoicing.js';

/** Hidden key of an effective preferred map: { rule, own: Set of the keys the layer sets itself }. */
export const POOL_RULE = Symbol('voicingPoolRule');
export const POOL_RULES = Object.freeze(['power', 'easy']);
/** Hidden key of an effective preferred map: the ACTIVE alternative fingerings of the layer, { <chord key>: [voicing…] } (model/voicingpools.js). */
export const POOL_ALTERNATIVES = Symbol('voicingPoolAlternatives');
/** Hidden key of an effective preferred map: the layer object itself (read by the diagram lists grouped by label: its tags, names and fingerings). */
export const POOL_SOURCE = Symbol('voicingPoolSource');

/** Does this effective map apply a rule, and to which chord keys does it NOT apply (the keys the layer sets itself)? null when there is no rule. */
export const ruleOf = (preferred) => preferred?.[POOL_RULE] ?? null;

// ---------- the rule: power chord ----------

/**
 * A power chord (root, fifth, octave) for a chord spec on a fretted instrument, or null when the rule does not apply (no standard 6 / 4-string
 * instrument, no third string above the root). The root goes on the low E or A string, wherever it is nearest to the nut. PLACEHOLDER rule: the table
 * that decides the real "simple chords" is still to come (the rule is then replaced here).
 */
export function powerChordVoicing(spec, instrument) {
  if (!spec || (instrument !== 'guitar' && instrument !== 'bass')) return null;
  const tuning = INSTRUMENT_PRESETS[instrument]?.tuning;
  const strings = tuning.length;
  const fretOf = (open) => (((spec.rootPc - open) % 12) + 12) % 12;
  const fifth = spec.intervals.includes(7) ? 7 : spec.intervals.includes(6) && !spec.intervals.includes(7) ? 6 : spec.intervals.includes(8) && !spec.intervals.includes(7) ? 8 : 7;
  let best = null;
  for (const s of [0, 1]) { // the low string, then the next one
    if (s + 2 >= strings) continue;
    const root = fretOf(tuning[s] % 12);
    if (!best || root < best.root) best = { s, root };
  }
  if (!best) return null;
  const frets = Array(strings).fill(-1);
  frets[best.s] = best.root;
  frets[best.s + 1] = best.root + (fifth - 5);
  frets[best.s + 2] = best.root + 2;
  try { return createVoicing({ instrument, frets, name: 'power' }); } catch { return null; }
}


// ---------- the rule: easy power chord (the built-in layer « Easy PC ») ----------

/**
 * The two-note power chord of the built-in layer « Easy PC » (decided with Jean, 12/11/2026): only the ROOT matters, the quality (major, minor…) is ignored.
 * The root goes on the low E or the A string, wherever it is nearest to the nut (E to G♯ on the low E string, A to D♯ on the A string), and the fifth on the
 * next string, two frets higher; the other strings are muted. null for an instrument that is not a standard 6-string guitar / 4-string bass.
 */
export function easyPowerVoicing(spec, instrument) {
  if (!spec || (instrument !== 'guitar' && instrument !== 'bass')) return null;
  const tuning = INSTRUMENT_PRESETS[instrument]?.tuning;
  if (!tuning || tuning.length < 4) return null;
  const fretOf = (open) => (((spec.rootPc - open) % 12) + 12) % 12;
  let best = null;
  for (const s of [0, 1]) { const root = fretOf(tuning[s] % 12); if (!best || root < best.root) best = { s, root }; }
  const frets = Array(tuning.length).fill(-1);
  frets[best.s] = best.root;
  frets[best.s + 1] = best.root + 2;
  try { return createVoicing({ instrument, frets, name: 'easy' }); } catch { return null; }
}

/** The fingering a rule gives a chord spec (null when it does not apply). */
export const ruleVoicing = (rule, spec, instrument) => (rule === 'easy' ? easyPowerVoicing(spec, instrument) : powerChordVoicing(spec, instrument));
