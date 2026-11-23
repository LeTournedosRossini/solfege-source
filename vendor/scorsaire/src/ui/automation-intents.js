/*
 * Automation intents (no DOM): what the quick gesture does to the tracks under a selected range. Every write runs inside `doc.transaction` (the caller:
 * `Application.edit`). The model lives in model/automation.js; this layer maps a range (staves + measure anchors) to tracks and absolute positions.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { measureLayout, absolutePosition } from '../model/tempomap.js';
import { measureLengthOf } from '../model/timing.js';
import { frac, ZERO, fCmp } from '../model/fraction.js';
import { setRangeValue, laneOf, laneAt, sortedEntries, clearLane, AutomationError, addPoint, movePoint, movePoints, shiftPoints, setPointRamp, setPointCurve, removePoints, shiftRange } from '../model/automation.js';
import { beatLength } from '../layout/automationstrip.js';

/** Fades written as a note value: a thirty-second, sixteenth, eighth or quarter note of the whole note (the editor of the strips shows them as note glyphs). */
export const NOTE_FADES = Object.freeze({ thirtysecond: frac(1, 32), sixteenth: frac(1, 16), eighth: frac(1, 8), quarter: frac(1, 4) });
export const FADES = Object.freeze(['none', 'short', ...Object.keys(NOTE_FADES), 'beat', 'measure']);
/** The 'short' fade: a thirty-second note (1/32 of the whole note), so that a moved stretch rises or falls almost as one block (the default of the editor). */
export const SHORT_FADE = frac(1, 32);

/** The tracks under a range: [{ mv, track }] without duplicates, in score order. */
export function rangeTracks(doc, range) {
  const out = []; const seen = new Set();
  for (const id of range?.staffIds ?? []) {
    const staff = doc.find(id);
    const track = staff ? doc.parentOf(staff.id) : null;
    const mv = staff ? doc.movementOf(staff) : null;
    if (!track || !mv || seen.has(track.id) || !doc.work.movements.includes(mv)) continue;
    seen.add(track.id);
    out.push({ mv, track });
  }
  return out;
}

/** Absolute positions (fractions of the movement) of the start and the end of a range. */
export function rangeAbsolute(mv, range) {
  const layout = measureLayout(mv);
  const from = absolutePosition(layout, range.from.measureId, range.from.position);
  const to = absolutePosition(layout, range.to.measureId, range.to.position);
  if (!from || !to) throw new AutomationError('the range is not in this movement', 'range');
  return { from, to, layout };
}

/** Length of a fade, as a fraction of the whole note: 'short' = a thirty-second note, 'beat' = one beat of the time signature where the range starts, 'measure' = that measure. */
export function fadeLength(mv, range, fade) {
  if (fade === 'none' || !FADES.includes(fade)) return ZERO;
  const bar = mv.masterbars.find((b) => b.id === range.from.measureId);
  if (!bar) return ZERO;
  if (fade === 'short') return SHORT_FADE;
  if (NOTE_FADES[fade]) return NOTE_FADES[fade];
  if (fade === 'measure') return measureLengthOf(bar);
  const [, den] = getProperty(bar, PID.TIME_SIG);
  return frac(1, den);
}

/** Sets `param` over the range for every track under it. `value` null releases the fader. One transaction (the caller's). */
export function applyRangeAutomation(doc, range, { param = 'volume', value, fade = 'none' }) {
  const targets = rangeTracks(doc, range);
  if (!targets.length) throw new AutomationError('no track under the range', 'range');
  for (const { mv, track } of targets) {
    const { from, to } = rangeAbsolute(mv, range);
    setRangeValue(doc, mv, track, { param, from, to, value, fade: fadeLength(mv, range, fade) });
  }
}

/** Removes the whole lane `param` of a track. */
export function clearTrackAutomation(doc, trackId, param) {
  const track = doc.find(trackId);
  if (!track || track.type !== 'track') throw new AutomationError(`unknown track ${trackId}`, 'unknown');
  clearLane(doc, track, param);
}

/** Read snapshot for the gesture bar: the fader of the first track under the range (0..127) and which lanes exist. */
export function rangeAutomationState(doc, range) {
  const targets = rangeTracks(doc, range);
  const first = targets[0]?.track;
  // the level in force at the start of the range: what the volume lane says there, else the fader
  let level = first ? Math.round(getProperty(first, PID.MIXER_VOLUME) * 127) : 100;
  if (first) {
    try {
      const { mv } = targets[0];
      const { from, layout } = rangeAbsolute(mv, range);
      const lane = laneOf(first, 'volume');
      if (lane) level = Math.round(laneAt(sortedEntries(lane, layout), from, 'after', getProperty(first, PID.MIXER_VOLUME), getProperty(first, PID.MIXER_VOLUME)) * 127);
    } catch { /* a range that is not in the movement: the fader */ }
  }
  return {
    tracks: targets.length,
    level,
    fader: first ? Math.round(getProperty(first, PID.MIXER_VOLUME) * 127) : 100,
    hasVolume: targets.some(({ track }) => laneOf(track, 'volume')),
    hasMute: targets.some(({ track }) => laneOf(track, 'mute')),
  };
}

/** True when every change of a Document event only touches the automation lanes of tracks (the sequence needs rebuilding, the loop stays valid). */
export function isAutomationOnly(changes) {
  return Array.isArray(changes) && changes.length > 0 && changes.every((c) => c && c.kind === 'property' && c.pid === PID.AUTOMATION);
}

// ---------- the points of a lane (the strip under a track) ----------

function trackOf(doc, trackId) {
  const track = doc.find(trackId);
  if (!track || (track.type !== 'track' && track.type !== 'movement')) throw new AutomationError(`unknown track ${trackId}`, 'unknown');
  const mv = track.type === 'movement' ? track : doc.movementOf(track); // a movement owns the lane of the master volume
  if (!mv || !doc.work.movements.includes(mv)) throw new AutomationError('the track is not in a movement of the work', 'unknown');
  return { track, mv };
}

export function addPointIntent(doc, trackId, { param = 'volume', abs, value }) { const { track, mv } = trackOf(doc, trackId); addPoint(doc, mv, track, { param, abs, value }); }
export function movePointIntent(doc, trackId, { param = 'volume', pointId, abs, value }) { const { track, mv } = trackOf(doc, trackId); movePoint(doc, mv, track, { param, pointId, abs, value }); }
export function movePointsIntent(doc, trackId, { param = 'volume', moves }) { const { track, mv } = trackOf(doc, trackId); movePoints(doc, mv, track, { param, moves }); }
export function shiftPointsIntent(doc, trackId, { param = 'volume', pointIds, delta }) { const { track, mv } = trackOf(doc, trackId); shiftPoints(doc, mv, track, { param, pointIds, delta }); }
export function setRampIntent(doc, trackId, { param = 'volume', pointIds, ramp }) { const { track, mv } = trackOf(doc, trackId); setPointRamp(doc, mv, track, { param, pointIds, ramp }); }
export function setCurveIntent(doc, trackId, { param = 'volume', pointIds, curve }) { const { track, mv } = trackOf(doc, trackId); setPointCurve(doc, mv, track, { param, pointIds, curve }); }
export function removePointsIntent(doc, trackId, { param = 'volume', pointIds }) { const { track, mv } = trackOf(doc, trackId); removePoints(doc, mv, track, { param, pointIds }); }
export function shiftIntent(doc, trackId, { param = 'volume', from, to, delta, fade = 'none' }) {
  const { track, mv } = trackOf(doc, trackId);
  shiftRange(doc, mv, track, { param, from, to, delta, fade: fadeLengthAt(mv, from, fade) });
}
/** Sets mute / volume over [from, to[ of ONE track (absolute fractions), like the gesture on a range of the score. */
export function setSpanIntent(doc, trackId, { param, from, to, value, fade = 'none' }) {
  const { track, mv } = trackOf(doc, trackId);
  setRangeValue(doc, mv, track, { param, from, to, value, fade: fadeLengthAt(mv, from, fade) });
}

/** Length of a fade starting at absolute position `abs`: one beat or one measure of the measure that contains it. */
export function fadeLengthAt(mv, abs, fade) {
  if (fade === 'none' || !FADES.includes(fade)) return ZERO;
  const layout = measureLayout(mv);
  let i = 0;
  for (let k = 0; k < layout.starts.length; k++) { if (fCmp(layout.starts[k], abs) <= 0) i = k; else break; }
  const bar = mv.masterbars[i];
  if (!bar) return ZERO;
  if (fade === 'short') return SHORT_FADE;
  if (NOTE_FADES[fade]) return NOTE_FADES[fade];
  return fade === 'measure' ? measureLengthOf(bar) : beatLength(getProperty(bar, PID.TIME_SIG));
}
