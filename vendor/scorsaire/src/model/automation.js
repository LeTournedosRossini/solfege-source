/*
 * Mixer automation of a track: lanes of points anchored to a musical instant (masterbar id + exact fraction, like the tempos), saved in the file.
 *
 *   PID.AUTOMATION (track) = [{ id, param, points: [{ id, measureId, position: [n, d], value, ramp }] }]
 *
 * - `param` is one of AUTOMATION_PARAMS: 'volume' (0..1, the fader scale 0..127 / 127) or 'mute' (1 = muted, 0 = not). The registry is the extension point
 *   (a panning lane, effects… are added here and in the engines that understand them).
 * - `value: null` means "follow the fader" (the automation lets go). Before the first point the fader rules.
 * - `ramp` says how the value goes from this point to the NEXT one: 'step' (it holds, then jumps) or 'linear'. A switch ('mute') is always a step.
 * - `curve` (optional, −1..1, only with a linear ramp) bows that ramp: 0 = straight, > 0 slow then fast, < 0 fast then slow (`shapeRamp`). The handle in the editor sets it.
 * - Time: by WRITTEN position. A repeat plays the same automation again (like the tempo); the played times are computed by the audio layer.
 * Every function that writes must run inside `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty, hasLocalValue } from './props.js';
import { newId } from './ids.js';
import { measureLayout } from './tempomap.js';
import { ZERO, frac, fAdd, fSub, fCmp, fEq, fToNumber, isFraction } from './fraction.js';

export class AutomationError extends Error {
  constructor(message, code) { super(message); this.name = 'AutomationError'; this.code = code; }
}

/** The automatable parameters. `switch` parameters only have 0 / 1 values and step ramps. */
export const AUTOMATION_PARAMS = Object.freeze({
  volume: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127 }),
  // the master volume of the whole mix (a lane of the MOVEMENT, not of a track): the same 0..127 scale as the master fader
  master: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127 }),
  // the stereo position of the track: 0 = hard left, 0.5 = centre, 1 = hard right (steps of 1/126, so the centre is exact; the mixer pan −1 … +1 maps to it)
  pan: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 126 }),
  // MIDI controllers of a track, played by the SoundFont engine and written in the MIDI export (the light engine ignores them). `cc` = the controller number, `rest` = the value
  // when no lane speaks (and where a lane that lets go falls back): the synth's own default
  expression: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127, cc: 11, rest: 1 }), // a second level that multiplies the fader: swells without touching the mix
  reverb: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127, cc: 91, rest: 40 / 127 }), // send to the reverb
  chorus: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127, cc: 93, rest: 0 }), // send to the chorus
  brightness: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127, cc: 74, rest: 64 / 127 }), // the cut-off of the filter: dark … bright
  modulation: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 127, cc: 1, rest: 0 }), // the depth of the vibrato
  // the pitch wheel of a track: 0.5 = no bend, the ends are ± the range of the track (PID.PITCH_BEND_RANGE, ±2 semitones by default). Played as a pitch curve added to
  // the notes that sound (the light engine bends too); written in the MIDI export as pitch-wheel messages on the notes' channels
  pitchbend: Object.freeze({ kind: 'level', min: 0, max: 1, step: 1 / 126, rest: 0.5, bend: true }),
  mute: Object.freeze({ kind: 'switch', min: 0, max: 1, step: 1 }),
});
/** Ranges (semitones each way) the pitch-bend lane of a track can have. */
export const PITCH_BEND_RANGES = Object.freeze([1, 2, 3, 5, 7, 12]);
export const DEFAULT_PITCH_BEND_RANGE = 2;
/** The range of a track's pitch-bend lane. */
export const pitchBendRangeOf = (track) => { const r = getProperty(track, PID.PITCH_BEND_RANGE); return PITCH_BEND_RANGES.includes(r) ? r : DEFAULT_PITCH_BEND_RANGE; };
/** Semitones for a lane value (0..1, 0.5 = none) and back. */
export const pitchBendSemitones = (value, range) => (value - 0.5) * 2 * range;
export const pitchBendValue = (semitones, range) => Math.min(1, Math.max(0, 0.5 + semitones / (2 * range)));
/** Sets the range of the pitch-bend lane (the curve keeps its drawn shape: its values are fractions of the range). TO CALL INSIDE `doc.transaction`. */
export function setPitchBendRange(doc, track, range) {
  if (!PITCH_BEND_RANGES.includes(range)) throw new AutomationError(`pitch-bend range ${range} not allowed`, 'range');
  if (range === DEFAULT_PITCH_BEND_RANGE) { if (hasLocalValue(track, PID.PITCH_BEND_RANGE)) doc.reset(track, PID.PITCH_BEND_RANGE); } else doc.set(track, PID.PITCH_BEND_RANGE, range);
}
/** The lanes a strip can show, in the order they are stacked under a track. */
export const AUTOMATION_LANE_ORDER = Object.freeze(['volume', 'pan', 'expression', 'reverb', 'chorus', 'brightness', 'modulation', 'pitchbend']);
export const RAMPS = Object.freeze(['step', 'linear']);
export const MAX_POINTS = 2000;

/** Where a ramp stands at `u` (0..1 of the way between two points) once bowed by `curve` (−1..1): u^(4^curve), so 0 is the straight line. */
export const shapeRamp = (u, curve) => (curve ? Math.pow(Math.min(1, Math.max(0, u)), Math.pow(4, curve)) : u);
/** The `curve` that puts the middle of a ramp at `half` (0..1 of the way from the first value to the second): the inverse of `shapeRamp` at u = ½. */
export const curveForMiddle = (half) => { const h = Math.min(0.98, Math.max(0.02, half)); const c = Math.log(Math.log(h) / Math.log(0.5)) / Math.log(4); return Math.abs(c) < 0.06 ? 0 : Math.round(Math.max(-1, Math.min(1, c)) * 20) / 20; };

export function createAutomationPoint({ measureId, position = ZERO, value, ramp = 'step' }) {
  return { id: newId('ap'), measureId, position, value, ramp };
}
export function createAutomationLane(param, points = []) {
  return { id: newId('al'), param, points };
}

/** The value of the track's own fader on the lane scale: what a lane that lets go falls back to. */
export const faderOf = (track, param) => (param === 'volume' ? getProperty(track, PID.MIXER_VOLUME) : param === 'pan' ? ((getProperty(track, PID.MIXER_PAN) ?? 0) + 1) / 2 : (AUTOMATION_PARAMS[param]?.rest ?? 0));

/** The property that holds the lanes of an owner: a track (volume, pan, controllers…) or a movement (the master volume). */
export const lanesPid = (owner) => (owner?.type === 'movement' ? PID.MASTER_AUTOMATION : PID.AUTOMATION);
export const automationLanes = (track) => getProperty(track, lanesPid(track)) ?? [];

/** Where the master volume stands when no lane speaks (the master fader of the work); `doc` gives the work. */
const faderIn = (doc, owner, param) => (owner?.type === 'movement' ? getProperty(doc.work, PID.MASTER_VOLUME) : faderOf(owner, param));
export const laneOf = (track, param) => automationLanes(track).find((l) => l.param === param) ?? null;

/** Validation of PID.AUTOMATION of a track. @param barIds identifiers of the masterbars of the movement */
export function validateAutomation(lanes, barIds, where = 'automation') {
  const errors = [];
  if (lanes == null) return errors;
  if (!Array.isArray(lanes)) return [`${where}: a list of lanes is expected`];
  const seen = new Set();
  for (const lane of lanes) {
    const spec = AUTOMATION_PARAMS[lane?.param];
    if (!lane || typeof lane.id !== 'string' || !spec || !Array.isArray(lane.points)) { errors.push(`${where}: malformed lane`); continue; }
    if (seen.has(lane.param)) errors.push(`${where}: two lanes for ${lane.param}`);
    seen.add(lane.param);
    if (lane.points.length > MAX_POINTS) errors.push(`${where}: lane ${lane.param} has more than ${MAX_POINTS} points`);
    for (const p of lane.points) {
      if (!p || typeof p.id !== 'string' || !barIds.includes(p.measureId)) { errors.push(`${where}: a ${lane.param} point is anchored to an unknown measure`); continue; }
      if (!isFraction(p.position) || p.position[0] < 0) errors.push(`${where}: a ${lane.param} point has an invalid position`);
      if (p.value !== null && !(typeof p.value === 'number' && p.value >= spec.min && p.value <= spec.max)) errors.push(`${where}: a ${lane.param} point has a value outside ${spec.min}..${spec.max}`);
      if (spec.kind === 'switch' && p.value !== null && p.value !== 0 && p.value !== 1) errors.push(`${where}: a ${lane.param} point must be 0 or 1`);
      if (!RAMPS.includes(p.ramp)) errors.push(`${where}: a ${lane.param} point has an unknown ramp`);
      if (p.curve !== undefined && !(typeof p.curve === 'number' && p.curve >= -1 && p.curve <= 1 && p.ramp === 'linear')) errors.push(`${where}: a ${lane.param} point has an invalid curve`);
      if (spec.kind === 'switch' && p.ramp !== 'step') errors.push(`${where}: a ${lane.param} point must be a step`);
    }
  }
  return errors;
}

// ---------- reading ----------

/** The points of a lane with their absolute position, sorted: [{ abs, value, ramp, id }]. Points on an unknown measure are ignored. */
export function sortedEntries(lane, layout) {
  const out = [];
  for (const p of lane?.points ?? []) {
    const i = layout.ids.indexOf(p.measureId);
    if (i < 0) continue;
    out.push({ abs: fAdd(layout.starts[i], p.position ?? ZERO), value: p.value, ramp: p.ramp, id: p.id, ...(p.curve ? { curve: p.curve } : {}) });
  }
  return out.sort((a, b) => fCmp(a.abs, b.abs));
}

/**
 * Value of a lane at `abs`. `side` 'after' includes a point exactly at `abs` (right limit), 'before' excludes it (left limit).
 * Before the first point: `fallback`. A null value ("follow the fader") reads as `fallback` too, and as `fader` inside a linear ramp (`fader` defaults to `fallback`).
 */
export function laneAt(entries, abs, side = 'after', fallback = null, fader = fallback ?? 0) {
  let i = -1;
  for (let k = 0; k < entries.length; k++) {
    const c = fCmp(entries[k].abs, abs);
    if (c < 0 || (c === 0 && side === 'after')) i = k; else break;
  }
  if (i < 0) return fallback;
  const s = entries[i];
  const n = entries[i + 1];
  if (s.ramp === 'linear' && n && fCmp(n.abs, s.abs) > 0) {
    const v = s.value ?? fader; const nv = n.value ?? fader;
    return v + (nv - v) * shapeRamp(fToNumber(fSub(abs, s.abs)) / fToNumber(fSub(n.abs, s.abs)), s.curve);
  }
  return s.value ?? fallback;
}

// ---------- writing ----------

function anchorOf(layout, abs) {
  let i = 0;
  for (let k = 0; k < layout.starts.length; k++) { if (fCmp(layout.starts[k], abs) <= 0) i = k; else break; }
  return { measureId: layout.ids[i], position: fSub(abs, layout.starts[i]) };
}

function writeLane(doc, track, param, entries, layout) {
  const lanes = automationLanes(track).filter((l) => l.param !== param);
  const kept = entries.filter((e, i, all) => !(i > 0 && fEq(e.abs, all[i - 1].abs))); // one point per instant
  if (kept.length && !kept.every((e) => e.value === null)) {
    const points = kept.map((e) => ({ id: e.id ?? newId('ap'), ...anchorOf(layout, e.abs), value: e.value, ramp: e.ramp, ...(e.curve && e.ramp === 'linear' ? { curve: e.curve } : {}) }));
    lanes.push(createAutomationLane(param, points));
    const old = laneOf(track, param);
    if (old) lanes[lanes.length - 1].id = old.id;
  }
  if (lanes.length) doc.set(track, lanesPid(track), lanes);
  else if (hasLocalValue(track, lanesPid(track))) doc.reset(track, lanesPid(track));
}

/**
 * Sets `param` to `value` on [from, to[ (absolute fractions of the movement) for one track, in one go.
 * `value` null lets the fader rule again ("release"). `fade` (a fraction of the whole note, 0 = abrupt) is the length of the ramp in and the ramp out of a
 * volume change (when releasing, `fade` is the fade used to set the level: the points of those fades are removed too); a switch never fades.
 * What the lane said before and after the range is kept (the lane goes back to it).
 */
export function setRangeValue(doc, mv, track, { param, from, to, value, fade = ZERO }) {
  const spec = AUTOMATION_PARAMS[param];
  if (!spec) throw new AutomationError(`unknown automation parameter ${param}`, 'param');
  if (!(fCmp(to, from) > 0)) throw new AutomationError('the range is empty', 'range');
  if (value !== null && !(value >= spec.min && value <= spec.max)) throw new AutomationError(`value outside ${spec.min}..${spec.max}`, 'value');
  const layout = measureLayout(mv);
  const old = sortedEntries(laneOf(track, param), layout);
  const fader = faderIn(doc, track, param);
  const fadeIn = spec.kind === 'level' && fCmp(fade, ZERO) > 0 ? (fCmp(fade, from) < 0 ? fade : from) : ZERO;
  const room = fSub(layout.end, to);
  const fadeOut = spec.kind === 'level' && fCmp(fade, ZERO) > 0 ? (fCmp(fade, room) < 0 ? fade : room) : ZERO;
  const start = fSub(from, fadeIn);
  const end = fAdd(to, fadeOut);
  // (the value before the range is read at the start of the window, so a fade-in that is being replaced does not count as "before")
  const before = laneAt(old, start, 'before', null, fader);
  const next = [];
  for (const e of old) if (fCmp(e.abs, start) < 0 || fCmp(e.abs, end) >= 0) next.push(e);
  const hold = value === null ? null : value;
  if (hold !== null && fCmp(fadeIn, ZERO) > 0 && before !== hold) next.push({ abs: start, value: before, ramp: 'linear' }); // `before` stays null when the fader ruled: the ramp then starts from the fader
  next.push({ abs: from, value: hold, ramp: 'step' });
  if (hold !== null && fCmp(fadeOut, ZERO) > 0) next.push({ abs: to, value: hold, ramp: 'linear' });
  if (!old.some((e) => fEq(e.abs, end))) {
    const i = (() => { let k = -1; for (let j = 0; j < old.length; j++) if (fCmp(old[j].abs, end) <= 0) k = j; return k; })();
    const gov = i >= 0 ? old[i] : null;
    const after = laneAt(old, end, 'after', null, fader);
    next.push({ abs: end, value: after, ramp: gov?.ramp ?? 'step' }); // back to what the lane said there (null = the fader)
  }
  next.sort((a, b) => fCmp(a.abs, b.abs));
  // a point that says nothing new (same value as the one before, held) is dropped
  const tidy = next.filter((e, k) => !(k > 0 && next[k - 1].value === e.value && next[k - 1].ramp === 'step' && e.ramp === 'step'));
  if (tidy.length > MAX_POINTS) throw new AutomationError('too many points', 'limit');
  writeLane(doc, track, param, tidy, layout);
}

/** Removes the whole automation of one parameter of a track (the fader rules again everywhere). */
export function clearLane(doc, track, param) {
  const lanes = automationLanes(track).filter((l) => l.param !== param);
  if (lanes.length) doc.set(track, lanesPid(track), lanes);
  else if (hasLocalValue(track, lanesPid(track))) doc.reset(track, lanesPid(track));
}

/** Drops the points anchored to measures `ids` (measures being deleted). Call inside the transaction that deletes them. */
export function purgeAutomation(doc, mv, ids) {
  const gone = new Set(ids);
  for (const track of [...mv.tracks, mv]) {
    const lanes = automationLanes(track);
    if (!lanes.some((l) => l.points.some((p) => gone.has(p.measureId)))) continue;
    const next = lanes.map((l) => ({ ...l, points: l.points.filter((p) => !gone.has(p.measureId)) })).filter((l) => l.points.length && !l.points.every((p) => p.value === null));
    if (next.length) doc.set(track, lanesPid(track), next); else doc.reset(track, lanesPid(track));
  }
}

// ---------- editing the points of a lane (the strip under a track) ----------

const clampValue = (spec, v) => (v === null ? null : Math.min(spec.max, Math.max(spec.min, spec.kind === 'level' ? Math.round(v / spec.step) * spec.step : Math.round(v))));

function editEntries(doc, mv, track, param, change) {
  const spec = AUTOMATION_PARAMS[param];
  if (!spec) throw new AutomationError(`unknown automation parameter ${param}`, 'param');
  const layout = measureLayout(mv);
  const entries = sortedEntries(laneOf(track, param), layout);
  const next = change(entries, layout, spec).sort((a, b) => fCmp(a.abs, b.abs));
  if (next.length > MAX_POINTS) throw new AutomationError('too many points', 'limit');
  writeLane(doc, track, param, next, layout);
}

/** Adds (or replaces, at the same instant) a point of a lane. `abs` = absolute fraction of the movement. A new point of a level lane is linked to the next by a ramp. */
export function addPoint(doc, mv, track, { param = 'volume', abs, value, ramp }) {
  editEntries(doc, mv, track, param, (entries, layout, spec) => {
    if (fCmp(abs, ZERO) < 0 || fCmp(abs, layout.end) > 0) throw new AutomationError('the point is outside the movement', 'range');
    const point = { abs, value: clampValue(spec, value), ramp: spec.kind === 'switch' ? 'step' : (ramp ?? 'linear'), id: newId('ap') };
    return [...entries.filter((e) => !fEq(e.abs, abs)), point];
  });
}

/** Moves a point to a new instant and value (its id and ramp are kept; a point already there is replaced). */
export function movePoint(doc, mv, track, { param = 'volume', pointId, abs, value }) {
  editEntries(doc, mv, track, param, (entries, layout, spec) => {
    const p = entries.find((e) => e.id === pointId);
    if (!p) throw new AutomationError(`unknown point ${pointId}`, 'unknown');
    if (fCmp(abs, ZERO) < 0 || fCmp(abs, layout.end) > 0) throw new AutomationError('the point is outside the movement', 'range');
    return [...entries.filter((e) => e.id !== pointId && !fEq(e.abs, abs)), { ...p, abs, value: value === undefined ? p.value : clampValue(spec, value) }];
  });
}

/** Sets the ramp ('step' | 'linear') of points. */
export function setPointRamp(doc, mv, track, { param = 'volume', pointIds, ramp }) {
  if (!RAMPS.includes(ramp)) throw new AutomationError(`unknown ramp ${ramp}`, 'ramp');
  editEntries(doc, mv, track, param, (entries, layout, spec) => entries.map((e) => {
    if (!pointIds.includes(e.id)) return e;
    const { curve: _gone, ...rest } = e; // a step is never bowed
    return { ...rest, ramp: spec.kind === 'switch' ? 'step' : ramp, ...(ramp === 'linear' && e.curve ? { curve: e.curve } : {}) };
  }));
}

/** Bows the ramp that leaves each of `pointIds` (−1..1, 0 = straight); a point that holds (step) is made a linear ramp first. */
export function setPointCurve(doc, mv, track, { param = 'volume', pointIds, curve }) {
  if (!(typeof curve === 'number' && curve >= -1 && curve <= 1)) throw new AutomationError(`curve ${curve} outside -1..1`, 'curve');
  editEntries(doc, mv, track, param, (entries, layout, spec) => {
    if (spec.kind === 'switch') throw new AutomationError('a switch cannot be curved', 'curve');
    return entries.map((e) => {
      if (!pointIds.includes(e.id)) return e;
      const { curve: _gone, ...rest } = e;
      return { ...rest, ramp: 'linear', ...(curve ? { curve } : {}) };
    });
  });
}

/** Removes points (the lane disappears when nothing but "follow the fader" is left). */
export function removePoints(doc, mv, track, { param = 'volume', pointIds }) {
  editEntries(doc, mv, track, param, (entries) => entries.filter((e) => !pointIds.includes(e.id)));
}

/**
 * Raises (delta > 0) or lowers a whole stretch of a volume lane by `delta` (in 0..1 units), the lane outside it staying as it was: the points inside move together, the
 * stretch starts and ends with the lane's own value there shifted, and `fade` (fraction of the whole note, 0 = abrupt) is the length of the ramp up to and down from it.
 */
export function shiftRange(doc, mv, track, { param = 'volume', from, to, delta, fade = ZERO }) {
  if (!(fCmp(to, from) > 0)) throw new AutomationError('the range is empty', 'range');
  const fader = faderIn(doc, track, param);
  const steps = 1 / (AUTOMATION_PARAMS[param]?.step ?? 1 / 127);
  const clamp = (v) => Math.min(1, Math.max(0, Math.round(v * steps) / steps));
  editEntries(doc, mv, track, param, (old, layout) => {
    const fadeIn = fCmp(fade, ZERO) > 0 ? (fCmp(fade, from) < 0 ? fade : from) : ZERO;
    const room = fSub(layout.end, to);
    const fadeOut = fCmp(fade, ZERO) > 0 ? (fCmp(fade, room) < 0 ? fade : room) : ZERO;
    const start = fSub(from, fadeIn);
    const end = fAdd(to, fadeOut);
    const govRamp = (abs) => { let g = null; for (const e of old) { if (fCmp(e.abs, abs) <= 0) g = e; else break; } return g?.ramp ?? 'step'; };
    const next = old.filter((e) => fCmp(e.abs, start) < 0 || fCmp(e.abs, end) >= 0);
    if (fCmp(fadeIn, ZERO) > 0) next.push({ abs: start, value: laneAt(old, start, 'after', null, fader), ramp: 'linear' });
    next.push({ abs: from, value: clamp(laneAt(old, from, 'after', fader, fader) + delta), ramp: govRamp(from) });
    for (const e of old) if (fCmp(e.abs, from) > 0 && fCmp(e.abs, to) < 0) next.push({ ...e, value: clamp((e.value ?? fader) + delta) });
    if (fCmp(fadeOut, ZERO) > 0) next.push({ abs: to, value: clamp(laneAt(old, to, 'before', fader, fader) + delta), ramp: 'linear' });
    if (!old.some((e) => fEq(e.abs, end))) next.push({ abs: end, value: laneAt(old, end, 'after', null, fader), ramp: govRamp(end) });
    return next.sort((a, b) => fCmp(a.abs, b.abs)).filter((e, k, all) => !(k > 0 && e.value !== null && all[k - 1].value === e.value && all[k - 1].ramp === 'step' && e.ramp === 'step'));
  });
}

/**
 * Pastes points into a lane over [A, B[ (absolute fractions): the points of the lane in that zone are replaced by `points` ([{ abs, value, ramp }]), and what the lane
 * said at B is kept (a point at B restores it). Used by paste: the automation of the copied measures lands on the track of the destination.
 */
export function pasteLane(doc, mv, track, { param, points, from, to }) {
  editEntries(doc, mv, track, param, (old, layout, spec) => {
    const fader = faderIn(doc, track, param);
    const next = old.filter((e) => fCmp(e.abs, from) < 0 || fCmp(e.abs, to) >= 0);
    for (const p of points) {
      if (fCmp(p.abs, layout.end) > 0) continue;
      next.push({ abs: p.abs, value: clampValue(spec, p.value), ramp: spec.kind === 'switch' ? 'step' : p.ramp, id: newId('ap') });
    }
    if (!old.some((e) => fEq(e.abs, to)) && fCmp(to, layout.end) <= 0) {
      let gov = null;
      for (const e of old) { if (fCmp(e.abs, to) <= 0) gov = e; else break; }
      if (gov) next.push({ abs: to, value: laneAt(old, to, 'after', null, fader), ramp: gov.ramp });
    }
    const seen = new Set();
    return next.sort((a, b) => fCmp(a.abs, b.abs)).filter((e) => { const k = `${e.abs[0]}/${e.abs[1]}`; if (seen.has(k)) return false; seen.add(k); return true; });
  });
}

/** Moves several points at once: moves = [{ pointId, abs, value }]; a point already at a target instant is replaced (the moved ones win). */
export function movePoints(doc, mv, track, { param = 'volume', moves }) {
  editEntries(doc, mv, track, param, (entries, layout, spec) => {
    const byId = new Map(moves.map((m) => [m.pointId, m]));
    for (const m of moves) {
      if (!entries.some((e) => e.id === m.pointId)) throw new AutomationError(`unknown point ${m.pointId}`, 'unknown');
      if (fCmp(m.abs, ZERO) < 0 || fCmp(m.abs, layout.end) > 0) throw new AutomationError('a point would leave the movement', 'range');
    }
    const targets = moves.map((m) => m.abs);
    const kept = entries.filter((e) => byId.has(e.id) || !targets.some((t) => fEq(t, e.abs)));
    return kept.map((e) => { const m = byId.get(e.id); return m ? { ...e, abs: m.abs, value: m.value === undefined ? e.value : clampValue(spec, m.value) } : e; });
  });
}

/** Raises or lowers the value of the given points by `delta` (0..1 units); a point that follows the fader is left alone. */
export function shiftPoints(doc, mv, track, { param = 'volume', pointIds, delta }) {
  editEntries(doc, mv, track, param, (entries, layout, spec) => entries.map((e) => (pointIds.includes(e.id) && e.value !== null ? { ...e, value: clampValue(spec, Math.min(spec.max, Math.max(spec.min, e.value + delta))) } : e)));
}
