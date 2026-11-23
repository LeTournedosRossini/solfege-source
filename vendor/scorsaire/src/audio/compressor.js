/*
 * The compressor of a track: pure DSP with no Web Audio (the AudioWorklet of `compressor-worklet.js` runs `processBlock`, the tests run it under Node).
 *
 * A feed-forward compressor in the log domain: the level of the signal (peak or RMS, both channels linked so the stereo image does not move) goes through the static
 * curve (threshold, ratio, soft knee), the gain reduction in dB is smoothed with an ATTACK (reduction increasing) and a RELEASE (reduction decreasing), then a make-up gain
 * and a dry / wet mix (parallel compression) are applied. No look-ahead: no delay, so a track can be compressed without moving it against the others.
 *
 * Attack 0 … 150 ms and release 40 … 500 ms, both set by a knob whose first half of the travel covers the first quarter of the range (`knobToValue`): the fast
 * settings, the ones that are looked for, get half of the knob.
 */

export const COMPRESSOR_DEFAULTS = Object.freeze({
  on: false, threshold: -30, ratio: 4, knee: 6, attack: 10, release: 120, makeup: 0, mix: 100, detector: 'peak',
});

/** Limits of every setting (the window's sliders and `cleanCompressor` use them). */
export const COMPRESSOR_RANGES = Object.freeze({
  threshold: [-60, 0], ratio: [1, 20], knee: [0, 24], attack: [0, 150], release: [40, 500], makeup: [0, 24], mix: [0, 100],
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The knob of attack and release: position 0 … 1 → value, with a square law so that HALF of the travel covers the first QUARTER of the range
 * (position 0.5 → min + 25 % of the span). Attack 0 … 150 ms: the first half of the knob goes from 0 to 37.5 ms; release 40 … 500 ms: from 40 to 155 ms.
 */
export const knobToValue = (position, min, max) => min + (max - min) * clamp(position, 0, 1) ** 2;
/** The reverse: the knob position (0 … 1) of a value. */
export const valueToKnob = (value, min, max) => (max > min ? Math.sqrt(clamp((value - min) / (max - min), 0, 1)) : 0);

/** A clean copy of a stored compressor (every setting inside its range, ratio and others rounded), or null when it is the default one (off, nothing changed). */
export function cleanCompressor(c) {
  if (!c || typeof c !== 'object') return null;
  const num = (k, step) => { const [lo, hi] = COMPRESSOR_RANGES[k]; const v = Number.isFinite(c[k]) ? c[k] : COMPRESSOR_DEFAULTS[k]; return clamp(Math.round(v / step) * step, lo, hi); };
  const out = {
    on: c.on === true,
    threshold: num('threshold', 0.5), ratio: num('ratio', 0.1), knee: num('knee', 0.5), attack: num('attack', 0.5), release: num('release', 1),
    makeup: num('makeup', 0.5), mix: num('mix', 1), detector: c.detector === 'rms' ? 'rms' : 'peak',
  };
  for (const k of Object.keys(out)) if (typeof out[k] === 'number') out[k] = Math.round(out[k] * 100) / 100;
  return Object.keys(COMPRESSOR_DEFAULTS).every((k) => out[k] === COMPRESSOR_DEFAULTS[k]) ? null : out;
}

/** Errors of a stored compressor (empty list = valid). */
export function validateCompressor(c) {
  if (c === null || c === undefined) return [];
  const bad = [];
  if (typeof c !== 'object') return ['compressor: object expected'];
  if (typeof c.on !== 'boolean') bad.push('compressor: "on" must be a boolean');
  for (const [k, [lo, hi]] of Object.entries(COMPRESSOR_RANGES)) if (!(c[k] >= lo && c[k] <= hi)) bad.push(`compressor: ${k} must be between ${lo} and ${hi}`);
  if (c.detector !== 'peak' && c.detector !== 'rms') bad.push('compressor: detector must be "peak" or "rms"');
  return bad;
}

/**
 * The static curve: the level a signal of `inputDb` comes out at (dB), for a threshold, a ratio and a soft knee of width `knee` (dB) centred on the threshold
 * (the curve and its slope are continuous at the edges of the knee).
 */
export function staticOutputDb(inputDb, { threshold, ratio, knee }) {
  const over = inputDb - threshold;
  if (knee > 0 && 2 * over < -knee) return inputDb;
  if (knee > 0 && 2 * Math.abs(over) <= knee) return inputDb + ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
  return over <= 0 ? inputDb : threshold + over / ratio;
}

/** The smoothing coefficient of a time constant in milliseconds (0 = no smoothing: the value follows at once). */
export const smoothingCoefficient = (ms, sampleRate) => (ms <= 0 ? 0 : Math.exp(-1 / ((ms / 1000) * sampleRate)));

const SILENCE_DB = -120;
const toDb = (x) => (x > 1e-6 ? 20 * Math.log10(x) : SILENCE_DB);

/** The memory of one compressor between two blocks: the smoothed gain reduction (dB, ≤ 0) and the RMS accumulator. */
export function createCompressorState() { return { reduction: 0, meanSquare: 0 }; }

/**
 * Compresses one block. `inputs` and `outputs` are arrays of 1 or 2 Float32Arrays of the same length (they may be the same arrays: in place). Returns the deepest gain reduction
 * of the block in dB (a number ≤ 0, for a meter). With `on` false the signal passes untouched (the state keeps relaxing to 0 so that switching on later starts clean).
 */
export function processBlock(state, settings, inputs, outputs, sampleRate) {
  const c = { ...COMPRESSOR_DEFAULTS, ...settings };
  const n = inputs[0].length;
  const a = smoothingCoefficient(c.attack, sampleRate);
  const r = smoothingCoefficient(c.release, sampleRate);
  const rmsCoefficient = smoothingCoefficient(10, sampleRate); // the RMS window: about 10 ms
  const makeup = 10 ** (c.makeup / 20);
  const wet = clamp(c.mix, 0, 100) / 100;
  let deepest = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of inputs) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    let level = peak;
    if (c.detector === 'rms') {
      let sum = 0; for (const ch of inputs) sum += ch[i] * ch[i];
      state.meanSquare = rmsCoefficient * state.meanSquare + (1 - rmsCoefficient) * (sum / inputs.length);
      level = Math.sqrt(state.meanSquare);
    }
    const inDb = toDb(level);
    const target = c.on ? staticOutputDb(inDb, c) - inDb : 0; // ≤ 0
    const coefficient = target < state.reduction ? a : r; // more reduction = attack, less = release
    state.reduction = coefficient * state.reduction + (1 - coefficient) * target;
    if (state.reduction < deepest) deepest = state.reduction;
    if (!c.on) continue;
    const gain = 10 ** (state.reduction / 20) * makeup;
    for (let k = 0; k < inputs.length; k++) {
      const dry = inputs[k][i];
      outputs[k][i] = dry * (1 - wet) + dry * gain * wet;
    }
  }
  if (!c.on && inputs !== outputs) for (let k = 0; k < inputs.length; k++) outputs[k].set(inputs[k]);
  return deepest;
}
