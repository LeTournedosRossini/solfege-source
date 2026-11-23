/*
 * The equalizer of a track: a high-pass filter, a low shelf, two bells (peaking filters) and a high shelf, in series. The filters are the BiquadFilterNodes of the browser
 * (`createEq` builds and sets them); the coefficients of the same filters are computed here (RBJ cookbook, as the Web Audio specification gives them) so that the window can DRAW the
 * response curve and the tests can check it under Node. No DOM here.
 *
 * Frequencies and gains are set on logarithmic / linear sliders (`logPosition`, `logValue`); the high-pass is a 2nd-order Butterworth (12 dB per octave), off at 20 Hz.
 */

export const EQ_DEFAULTS = Object.freeze({
  on: false, hp: 20, lowF: 120, lowG: 0, m1F: 400, m1G: 0, m1Q: 1, m2F: 2500, m2G: 0, m2Q: 1, highF: 8000, highG: 0,
});

/** Limits of every setting. The high-pass at its lower limit (20 Hz) is OFF. */
export const EQ_RANGES = Object.freeze({
  hp: [20, 500], lowF: [40, 600], lowG: [-15, 15], m1F: [100, 3000], m1G: [-15, 15], m1Q: [0.3, 8], m2F: [500, 12000], m2G: [-15, 15], m2Q: [0.3, 8], highF: [2000, 16000], highG: [-15, 15],
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Slider position (0 … 1) → frequency, on a logarithmic scale between `min` and `max`; and the reverse. */
export const logValue = (position, min, max) => min * (max / min) ** clamp(position, 0, 1);
export const logPosition = (value, min, max) => Math.log(clamp(value, min, max) / min) / Math.log(max / min);

/** A clean copy (every setting inside its range, rounded), or null when it is the default one (off, nothing changed). */
export function cleanEq(c) {
  if (!c || typeof c !== 'object') return null;
  const out = { on: c.on === true };
  for (const [k, [lo, hi]] of Object.entries(EQ_RANGES)) {
    const v = Number.isFinite(c[k]) ? c[k] : EQ_DEFAULTS[k];
    const step = k.endsWith('G') ? 0.5 : k.endsWith('Q') ? 0.1 : 1;
    out[k] = Math.round(clamp(Math.round(v / step) * step, lo, hi) * 100) / 100;
  }
  return Object.keys(EQ_DEFAULTS).every((k) => out[k] === EQ_DEFAULTS[k]) ? null : out;
}

/** Errors of a stored equalizer (empty list = valid). */
export function validateEq(c) {
  if (c === null || c === undefined) return [];
  if (typeof c !== 'object') return ['equalizer: object expected'];
  const bad = [];
  if (typeof c.on !== 'boolean') bad.push('equalizer: "on" must be a boolean');
  for (const [k, [lo, hi]] of Object.entries(EQ_RANGES)) if (!(c[k] >= lo && c[k] <= hi)) bad.push(`equalizer: ${k} must be between ${lo} and ${hi}`);
  return bad;
}

/** The five filters of a setting: [{ type, frequency, gain, q }] in series order (the Web Audio meaning of `q`: dB for the high-pass, linear for the bells). */
export function eqFilters(c) {
  const s = { ...EQ_DEFAULTS, ...c };
  return [
    { type: 'highpass', frequency: s.hp, gain: 0, q: -3.0103 }, // 0.7071 (Butterworth) expressed in dB, the unit of the high-pass resonance
    { type: 'lowshelf', frequency: s.lowF, gain: s.lowG, q: 1 },
    { type: 'peaking', frequency: s.m1F, gain: s.m1G, q: s.m1Q },
    { type: 'peaking', frequency: s.m2F, gain: s.m2G, q: s.m2Q },
    { type: 'highshelf', frequency: s.highF, gain: s.highG, q: 1 },
  ];
}

/** Coefficients [b0, b1, b2, a0, a1, a2] of a Web Audio biquad. */
export function biquadCoefficients({ type, frequency, gain, q }, sampleRate) {
  const w0 = (2 * Math.PI * clamp(frequency, 1, sampleRate / 2 - 1)) / sampleRate;
  const cos = Math.cos(w0); const sin = Math.sin(w0);
  if (type === 'highpass') {
    const alpha = sin / (2 * 10 ** (q / 20));
    return [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  }
  const A = 10 ** (gain / 40);
  if (type === 'peaking') {
    const alpha = sin / (2 * q);
    return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  }
  const two = 2 * Math.sqrt(A) * ((sin / 2) * Math.SQRT2);
  if (type === 'lowshelf') {
    return [A * ((A + 1) - (A - 1) * cos + two), 2 * A * ((A - 1) - (A + 1) * cos), A * ((A + 1) - (A - 1) * cos - two),
      (A + 1) + (A - 1) * cos + two, -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - two];
  }
  // highshelf
  return [A * ((A + 1) + (A - 1) * cos + two), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - two),
    (A + 1) - (A - 1) * cos + two, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - two];
}

/** Magnitude (dB) of one filter at `hz`. */
export function filterResponseDb(filter, hz, sampleRate = 48000) {
  const [b0, b1, b2, a0, a1, a2] = biquadCoefficients(filter, sampleRate);
  const w = (2 * Math.PI * hz) / sampleRate;
  const c1 = Math.cos(w); const s1 = Math.sin(w); const c2 = Math.cos(2 * w); const s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2; const ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2; const di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The response (dB) of the whole equalizer at `hz`; the high-pass counts only when it is above its lower limit. */
export function eqResponseDb(c, hz, sampleRate = 48000) {
  return eqFilters(c).reduce((sum, f, i) => sum + (i === 0 && f.frequency <= EQ_RANGES.hp[0] ? 0 : filterResponseDb(f, hz, sampleRate)), 0);
}

/**
 * The five BiquadFilterNodes of a track in series, ready to be wired: `{ input, output, apply(settings) }`. `ctx` is the audio context (only `createBiquadFilter` is used).
 * The high-pass is set to its lower limit when it is off (almost no effect); the engines keep the whole chain out of the signal path while the equalizer is off.
 */
export function createEq(ctx) {
  const nodes = eqFilters(EQ_DEFAULTS).map((f) => { const n = ctx.createBiquadFilter(); n.type = f.type; return n; });
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
  const set = (param, v) => { if (param && 'value' in param) param.value = v; };
  return {
    input: nodes[0], output: nodes[nodes.length - 1], nodes,
    apply(settings) { eqFilters(settings).forEach((f, i) => { set(nodes[i].frequency, f.frequency); set(nodes[i].gain, f.gain); set(nodes[i].Q, f.q); }); },
  };
}
