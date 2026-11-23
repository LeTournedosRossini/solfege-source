/*
 * The rotary speaker ("Leslie") of an organ track, reduced to what a score needs: three states of the rotor.
 *   chorale — slow rotor. NO added effect by default: most SoundFonts already carry a chorale-like modulation of their own. Optionally
 *             (setting `vibrato`) a slow, shallow amplitude wobble is added on top.
 *   tremolo — fast rotor: an amplitude modulation at `rate` (6.5 Hz by default) of depth `depth`.
 *   brake   — the rotor is stopped: no modulation at all.
 * The state is changed from a sign on the score (technique texts `leslieChorale`, `leslieTremolo`, `leslieBrake`, see `model/techniques.js`)
 * which `sequence.js` turns into `{ kind: 'leslie', data: { mode } }` messages, and has a starting value per track (`PID.LESLIE.mode`).
 * Speed changes are not instantaneous: the rotor accelerates quickly and slows down slowly (`leslieRampSeconds`).
 *
 * The engines build, on the output of the track: gain `trem` (base gain 1 - depth/2) whose gain parameter is also driven by a sine oscillator
 * (frequency `rate`) through a gain of depth/2. Depth 0 therefore means exactly unity gain and silence from the LFO. PURE: no DOM, no audio nodes.
 */

export const LESLIE_MODES = Object.freeze(['chorale', 'tremolo', 'brake']);

/** Technique id of the sign → rotor state. */
export const LESLIE_TECHNIQUE_MODE = Object.freeze({ leslieChorale: 'chorale', leslieTremolo: 'tremolo', leslieBrake: 'brake' });
export const LESLIE_MODE_TECHNIQUE = Object.freeze(Object.fromEntries(Object.entries(LESLIE_TECHNIQUE_MODE).map(([k, v]) => [v, k])));

/** Rate (Hz) and depth (0…1) of the optional slow wobble of the chorale. */
export const CHORALE_RATE = 0.8;
export const CHORALE_DEPTH = 0.12;

/** `speed` = speed of the transitions between two states, as a factor of the natural one (1): 2 = the rotor changes speed twice as fast, 0.5 = twice as slowly. */
export const LESLIE_DEFAULTS = Object.freeze({ mode: 'chorale', vibrato: false, rate: 6.5, depth: 0.45, speed: 1 });
export const LESLIE_RANGES = Object.freeze({ rate: [2, 12], depth: [0.05, 1], speed: [0.25, 4] });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A clean copy of a setting, or null when it is the default one (nothing stored, the effect starts as a chorale without vibrato). */
export function cleanLeslie(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {
    mode: LESLIE_MODES.includes(c.mode) ? c.mode : LESLIE_DEFAULTS.mode,
    vibrato: c.vibrato === true,
    rate: Math.round(clamp(Number.isFinite(c.rate) ? c.rate : LESLIE_DEFAULTS.rate, ...LESLIE_RANGES.rate) * 10) / 10,
    depth: Math.round(clamp(Number.isFinite(c.depth) ? c.depth : LESLIE_DEFAULTS.depth, ...LESLIE_RANGES.depth) * 100) / 100,
    speed: Math.round(clamp(Number.isFinite(c.speed) ? c.speed : LESLIE_DEFAULTS.speed, ...LESLIE_RANGES.speed) * 20) / 20,
  };
  return Object.keys(LESLIE_DEFAULTS).every((k) => out[k] === LESLIE_DEFAULTS[k]) ? null : out;
}

/** Errors of a stored setting (empty list = valid). */
export function validateLeslie(c) {
  if (c === null || c === undefined) return [];
  if (typeof c !== 'object') return ['leslie: object expected'];
  const bad = [];
  if (!LESLIE_MODES.includes(c.mode)) bad.push('leslie: "mode" must be chorale, tremolo or brake');
  if (typeof c.vibrato !== 'boolean') bad.push('leslie: "vibrato" must be a boolean');
  for (const [k, [lo, hi]] of Object.entries(LESLIE_RANGES)) if (!(k === 'speed' && c[k] === undefined) && !(c[k] >= lo && c[k] <= hi)) bad.push(`leslie: ${k} must be between ${lo} and ${hi}`);
  return bad;
}

/** The full setting of a track (stored one over the defaults). */
export const leslieSettings = (c) => ({ ...LESLIE_DEFAULTS, ...(c && typeof c === 'object' ? c : {}) });

/** The `{ rate, depth }` the modulation must reach in a given state. `rate` 0 / `depth` 0 = no modulation. */
export function leslieTarget(mode, c) {
  const s = leslieSettings(c);
  if (mode === 'tremolo') return { rate: s.rate, depth: s.depth };
  if (mode === 'chorale') return s.vibrato ? { rate: CHORALE_RATE, depth: CHORALE_DEPTH } : { rate: CHORALE_RATE, depth: 0 };
  return { rate: 0, depth: 0 }; // brake (and anything unknown)
}

/**
 * Time constant (seconds, for `setTargetAtTime`) of the change of speed from a state to another: accelerating is quick, slowing down is slow.
 * `speed` (setting, 1 = natural) divides it: a higher speed makes every transition shorter.
 */
export function leslieRampSeconds(from, to, speed = 1) {
  if (from === to) return 0.05;
  const fast = clamp(Number.isFinite(speed) ? speed : 1, ...LESLIE_RANGES.speed);
  const order = { brake: 0, chorale: 1, tremolo: 2 };
  const natural = (order[to] ?? 0) > (order[from] ?? 0) ? 0.7 : to === 'brake' ? 2.2 : 1.6;
  return natural / fast;
}

/** Base gain of the `trem` gain node for a depth, and the gain of the LFO feeding its gain parameter. */
export const leslieBaseGain = (depth) => 1 - depth / 2;
export const leslieLfoGain = (depth) => depth / 2;

/** The rotor changes of a track: [{ t, mode }] sorted by time (seconds), from the messages of a sequence. */
export function leslieTimeline(messages, trackId) {
  return (messages ?? [])
    .filter((m) => m.kind === 'leslie' && m.track === trackId && LESLIE_MODES.includes(m.data?.mode))
    .map((m) => ({ t: m.t, mode: m.data.mode }))
    .sort((a, b) => a.t - b.t);
}

/** The state of the rotor at time `t`: the last change at or before `t`, or `initial` before the first sign. */
export function leslieModeAt(timeline, t, initial = 'chorale') {
  let mode = initial;
  for (const e of timeline) { if (e.t > t + 1e-9) break; mode = e.mode; }
  return mode;
}

/** The ids of the tracks of a sequence that carry at least one Leslie sign. */
export function leslieTracks(messages) {
  return new Set((messages ?? []).filter((m) => m.kind === 'leslie').map((m) => m.track));
}

/** Does this track need the Leslie stage? (a setting is stored, or a sign of the score changes its state) */
export const needsLeslie = (setting, trackId, messages) => Boolean(setting) || leslieTracks(messages).has(trackId);
