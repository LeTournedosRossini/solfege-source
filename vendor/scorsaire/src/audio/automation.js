/*
 * Automation on the audio side — the layer between the model (lanes anchored to written positions) and the engines.
 *
 * CONTRACT with the engines (see engine.js): the sequence carries `automation: [{ track, param, steps: [{ t, value, ramp }] }]` in PLAYED time (seconds, speed and
 * repeats applied). `value` is the lane value (null = follow the fader), `ramp` how the value goes from this step to the NEXT one ('step' | 'linear'). Two steps
 * at the same time: the value at that instant is the later one, the earlier one gives the value just before. An engine that handles automation itself (a sampler)
 * reads these lanes as they are; the light and SoundFont engines use `compileGain` below, which turns the lanes of a track into one gain curve.
 */
import { laneAt as modelLaneAt, shapeRamp } from '../model/automation.js';

/**
 * Steps of a lane in played time. `passages` = the parts of the movement as they are played (repeats and jumps unwound):
 * [{ start, end, off }] with written positions `start`/`end` (fractions) and `off` the played-minus-written offset; `playedTime(abs + off)` gives seconds.
 * Each passage replays the automation: a first step with the value in force at its start, the points inside, a last step with the value at its end.
 */
export function passageSteps(entries, passages, playedTime, base = 0, scale = 1) {
  const steps = [];
  for (const p of passages) {
    const mark = steps.length;
    const at = (abs) => (base + playedTime(abs, p)) * scale;
    const governing = (abs, side) => { let g = null; for (const e of entries) { const c = cmp(e.abs, abs); if (c < 0 || (c === 0 && side === 'after')) g = e; else break; } return g; };
    const first = governing(p.start, 'after');
    steps.push({ t: at(p.start), value: modelLaneAt(entries, p.start, 'after', null), ramp: first?.ramp ?? 'step', curve: first?.curve });
    for (const e of entries) if (cmp(e.abs, p.start) > 0 && cmp(e.abs, p.end) < 0) steps.push({ t: at(e.abs), value: e.value, ramp: e.ramp, curve: e.curve });
    steps.push({ t: at(p.end), value: modelLaneAt(entries, p.end, 'before', null), ramp: 'step' });
    steps.splice(mark, steps.length - mark, ...bowedSteps(steps.slice(mark)));
  }
  return steps;
}

const BOW_PIECES = 12;
/** A bowed ramp (`curve`) as a chain of short straight ramps, so that every engine and the MIDI export, which only know straight ones, follow the same curve. */
function bowedSteps(list) {
  const out = [];
  list.forEach((s, i) => {
    const { curve, ...step } = s;
    out.push(step);
    const next = list[i + 1];
    if (!curve || s.ramp !== 'linear' || !next || !(next.t > s.t) || s.value == null || next.value == null || s.value === next.value) return;
    for (let k = 1; k < BOW_PIECES; k++) {
      const u = k / BOW_PIECES;
      out.push({ t: s.t + (next.t - s.t) * u, value: s.value + (next.value - s.value) * shapeRamp(u, curve), ramp: 'linear' });
    }
  });
  return out;
}
const cmp = ([a, b], [c, d]) => a * d - c * b;

/** Value of a list of steps at time `t` (right limit at a step, left limit when `side` = 'before'), `fallback` before the first. */
export function stepsAt(steps, t, side = 'after', fallback = null, fader = fallback ?? 0) {
  let i = -1;
  for (let k = 0; k < steps.length; k++) { if (steps[k].t < t || (steps[k].t === t && side === 'after')) i = k; else if (steps[k].t > t) break; }
  if (i < 0) return fallback;
  const s = steps[i];
  const n = steps.slice(i + 1).find((x) => x.t > s.t);
  if (s.ramp === 'linear' && n) {
    const v = s.value ?? fader; const nv = n.value ?? fader;
    return v + (nv - v) * ((t - s.t) / (n.t - s.t));
  }
  return s.value ?? fallback;
}

/** The volume heard for a lane value: a null value follows the fader; otherwise the value times the master (relative to its default), at most 1. */
export function volumeOf(entry, value) {
  return value === null || value === undefined ? entry.volume : Math.min(1, value * (entry.masterFactor ?? 1));
}

/**
 * One gain curve (amplitude 0..1) for a track from its lanes and its mixer entry `{ volume, masterFactor, mute, solo }`.
 * @param lanes { volume?: steps, mute?: steps }
 * @param audible false = silent whatever the lanes say (static mute, or a solo elsewhere)
 * @returns [{ t, v, to?: { t, v } }] — at `t` the gain jumps to `v`; with `to` it then rises or falls linearly to `to.v` at `to.t`. Sorted; empty when there is no lane.
 */
export function compileGain(lanes, entry, audible) {
  const vol = lanes.volume ?? [];
  const mute = lanes.mute ?? [];
  const times = [...new Set([...vol, ...mute].map((s) => s.t))].sort((a, b) => a - b);
  if (!times.length) return [];
  const gain = (t, side) => {
    if (!audible) return 0;
    if (mute.length && (stepsAt(mute, t, side, 0, 0) ?? 0) >= 0.5) return 0;
    return volumeOf(entry, vol.length ? stepsAt(vol, t, side, null, entry.fader ?? entry.volume / (entry.masterFactor || 1)) : null);
  };
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const point = { t, v: gain(t, 'after') };
    const next = times[i + 1];
    if (next !== undefined) {
      const end = gain(next, 'before');
      if (Math.abs(end - point.v) > 1e-9) point.to = { t: next, v: end };
    }
    out.push(point);
  }
  return out;
}

/** The pan (−1 … +1) heard for a lane value (0..1, 0.5 = centre); a null value follows the track's own pan. */
export const panOf = (entry, value) => (value === null || value === undefined ? (entry.pan ?? 0) : value * 2 - 1);

/**
 * One pan curve (−1 … +1) for a track from its 'pan' lane and its mixer entry `{ pan }`: same shape as `compileGain` ([{ t, v, to? }], empty without a lane).
 * The lane value 0..1 maps to −1..+1 (0.5 = centre); a point that lets go ("follow the fader") gives the pan of the track.
 */
export function compilePan(steps, entry) {
  if (!steps?.length) return [];
  const times = [...new Set(steps.map((s) => s.t))].sort((a, b) => a - b);
  const own = ((entry.pan ?? 0) + 1) / 2; // the track's own pan on the lane scale
  const pan = (t, side) => panOf(entry, stepsAt(steps, t, side, null, own));
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const point = { t, v: pan(t, 'after') };
    const next = times[i + 1];
    if (next !== undefined) {
      const end = pan(next, 'before');
      if (Math.abs(end - point.v) > 1e-9) point.to = { t: next, v: end };
    }
    out.push(point);
  }
  return out;
}

/**
 * One curve (values 0..1 of the lane) for a controller lane (expression, reverb, chorus, brightness, modulation): same shape as `compileGain` ([{ t, v, to? }], empty
 * without a lane). A point that lets go ("follow the fader") gives `rest`, the value of the controller when no lane speaks.
 */
export function compileLane(steps, rest) {
  if (!steps?.length) return [];
  const times = [...new Set(steps.map((s) => s.t))].sort((a, b) => a - b);
  const value = (t, side) => stepsAt(steps, t, side, null, rest) ?? rest;
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const point = { t, v: value(t, 'after') };
    const next = times[i + 1];
    if (next !== undefined) {
      const end = value(next, 'before');
      if (Math.abs(end - point.v) > 1e-9) point.to = { t: next, v: end };
    }
    out.push(point);
  }
  return out;
}

/** The gain a curve gives at time `t` (for positioning). */
export function curveAt(curve, t, fallback) {
  let value = fallback;
  for (const p of curve) {
    if (p.t > t) break;
    value = p.v;
    if (p.to && t < p.to.t) return p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t));
  }
  return value;
}
