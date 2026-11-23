import { filterTemplate } from '../model/templateedit.js';
// New score assistant — state and choices without DOM: key / time signature / pickup / tempo options and the final options object.
import { frac, fLt, ZERO } from '../model/fraction.js';
import { NEW_SCORE_DEFAULTS, NEW_SCORE_LIMITS } from '../model/newscore.js';

export const KEY_CHOICES = Object.freeze(Array.from({ length: 15 }, (_, i) => i - 7)); // -7 .. +7 (flats .. sharps)
/** Count text of a key signature: "3 ♭", "2 ♯", "—". */
export const keyCountText = (n) => (n > 0 ? `${n} ♯` : n < 0 ? `${-n} ♭` : '—');

/** Time signature presets: [numerator, denominator, style]. 4/4 in digits comes first (the default). */
export const TIME_PRESETS = Object.freeze([
  [4, 4, 'normal'], [4, 4, 'common'], [2, 2, 'cut'], [2, 2, 'normal'], [3, 4, 'normal'], [2, 4, 'normal'], [6, 8, 'normal'], [9, 8, 'normal'], [12, 8, 'normal'], [5, 4, 'normal'], [7, 8, 'normal'],
]);
export const sameTimeChoice = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** Pickup lengths shorter than a measure: multiples of 1/16 of a whole note (reduced pairs). */
export function pickupChoices(timeSig) {
  const limit = frac(timeSig[0], timeSig[1]);
  const out = [];
  for (let k = 1; k < 16 * 4; k += 1) {
    const g = gcd(k, 16);
    const pair = [k / g, 16 / g];
    if (!fLt(frac(pair[0], pair[1]), limit)) break;
    if (fLt(ZERO, frac(pair[0], pair[1]))) out.push(pair);
  }
  return out;
}
export const pickupText = ([n, d]) => `${n}/${d}`;

/**
 * A pickup length in musical terms, for display: its length in beats (the beat is a dotted quarter in compound meters, else 1/den) as a reduced
 * fraction, and in eighths (integer) or sixteenths (integer) when it is a whole number of them.
 */
export function pickupParts([n, d], timeSig) {
  const compound = timeSig[1] === 8 && timeSig[0] % 3 === 0 && timeSig[0] >= 6;
  const beat = compound ? [3, 8] : [1, timeSig[1]];
  const bn = n * beat[1]; const bd = d * beat[0];
  const g = gcd(bn, bd);
  const eighths = (n * 8) % d === 0 ? (n * 8) / d : null;
  const sixteenths = (n * 16) % d === 0 ? (n * 16) / d : null;
  return { beats: [bn / g, bd / g], eighths, sixteenths };
}
/** Default pickup: a quarter note when it fits, else the first choice. */
export function defaultPickup(timeSig) {
  const list = pickupChoices(timeSig);
  return list.find(([n, d]) => n === 1 && d === 4) ?? list[0] ?? null;
}

export const TEMPO_UNITS = Object.freeze([
  { id: 'whole', beatUnit: { base: 'whole', dots: 0 } },
  { id: 'half', beatUnit: { base: 'half', dots: 0 } },
  { id: 'half.', beatUnit: { base: 'half', dots: 1 } },
  { id: 'quarter', beatUnit: { base: 'quarter', dots: 0 } },
  { id: 'quarter.', beatUnit: { base: 'quarter', dots: 1 } },
  { id: 'eighth', beatUnit: { base: 'eighth', dots: 0 } },
  { id: 'eighth.', beatUnit: { base: 'eighth', dots: 1 } },
  { id: 'sixteenth', beatUnit: { base: 'sixteenth', dots: 0 } },
]);
/** Default beat unit follows the time signature: dotted quarter in compound meters (6/8, 9/8, 12/8), quarter otherwise. */
export const defaultTempoUnit = (timeSig) => (timeSig[1] === 8 && timeSig[0] % 3 === 0 && timeSig[0] >= 6 ? 'quarter.' : 'quarter');

export function initialState() {
  return {
    title: '', subtitle: '', composer: '', lyricist: '',
    parts: [], template: null, templateOff: new Set(), // templateOff: indices of the template's parts the user unticked
    // parts: [{ key, text, spec }]
    chordTrack: true, // a chord track, the first track, by default (decided with Jean, 18/10/2026)
    keySig: NEW_SCORE_DEFAULTS.keySig,
    time: [4, 4, 'normal'],
    measures: NEW_SCORE_DEFAULTS.measures,
    pickupOn: false, pickup: [1, 4],
    tempoOn: false, bpm: 120, tempoUnit: 'quarter',
  };
}

/** The options for `createScore` from the assistant's state. */
export function optionsFromState(state, { lang = 'en' } = {}) {
  const [num, den, style] = state.time;
  return {
    title: state.title.trim(), subtitle: state.subtitle.trim(), composer: state.composer.trim(), lyricist: state.lyricist.trim(),
    parts: state.parts.map((p) => p.spec), template: state.template ? filterTemplate(state.template, state.templateOff) : null, chordTrack: state.chordTrack !== false,
    keySig: state.keySig, timeSig: [num, den], timeSigStyle: style,
    measures: state.measures,
    pickup: state.pickupOn ? state.pickup : null,
    tempo: state.tempoOn ? { bpm: state.bpm, beatUnit: (TEMPO_UNITS.find((u) => u.id === state.tempoUnit) ?? TEMPO_UNITS[3]).beatUnit } : null,
    lang,
  };
}

/** Changing the time signature keeps the pickup valid and the tempo unit coherent when the unit was the automatic one. */
export function setTime(state, time) {
  const wasAuto = state.tempoUnit === defaultTempoUnit([state.time[0], state.time[1]]);
  state.time = time;
  const list = pickupChoices([time[0], time[1]]);
  if (!list.some((p) => p[0] === state.pickup[0] && p[1] === state.pickup[1])) state.pickup = defaultPickup([time[0], time[1]]) ?? [1, 4];
  if (wasAuto) state.tempoUnit = defaultTempoUnit([time[0], time[1]]);
}

export const clampMeasures = (n) => Math.min(NEW_SCORE_LIMITS.maxMeasures, Math.max(NEW_SCORE_LIMITS.minMeasures, Number.isFinite(n) ? Math.round(n) : NEW_SCORE_DEFAULTS.measures));
