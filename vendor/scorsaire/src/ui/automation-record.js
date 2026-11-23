/*
 * Recording a fader move into the automation (no DOM): "touch" mode. While the song plays and a track is armed (●), touching its fader records the moves at the
 * play position; on release the recorded stretch replaces the lane there and the lane goes on as it was (what it said at the release point comes back).
 * A take is a list of { abs, value } (absolute fractions of the movement, values 0..1), thinned so that a slow move does not write hundreds of points.
 */
import { frac, fCmp, fToNumber } from '../model/fraction.js';

const TICKS = 3840; // per whole note
export const MIN_STEP = 2 / 127; // a point is kept when the value moved by at least two steps since the last kept one

/** Rounds an absolute position to the tick grid. */
export const toTick = (abs) => { const n = Math.round(fToNumber(abs) * TICKS); return frac(Math.max(0, n), TICKS); };

/**
 * One take of one track. `add(abs, value)` in play order; a position that goes BACK (a loop, a jump) is refused: the caller ends the take and starts another.
 */
export function createTake() {
  const points = [];
  return {
    /** @returns false when `abs` is before the last point (the song went back) */
    add(abs, value) {
      const a = toTick(abs);
      const last = points[points.length - 1];
      if (last && fCmp(a, last.abs) < 0) return false;
      if (last && fCmp(a, last.abs) === 0) { last.value = value; return true; }
      points.push({ abs: a, value });
      return true;
    },
    get size() { return points.length; },
    /** The thinned points, or null when nothing was recorded. The last point is always kept. */
    result() {
      if (!points.length) return null;
      const kept = [points[0]];
      for (let i = 1; i < points.length - 1; i++) if (Math.abs(points[i].value - kept[kept.length - 1].value) >= MIN_STEP) kept.push(points[i]);
      if (points.length > 1) kept.push(points[points.length - 1]);
      return kept;
    },
  };
}

/** Where a take lands: from its first point to just after its last one (one tick), so that the last point is inside. */
export function takeSpan(points) {
  const from = points[0].abs;
  const lastAbs = points[points.length - 1].abs;
  return { from, to: frac(lastAbs[0] * (TICKS / lastAbs[1]) + 1, TICKS) };
}
