/*
 * Geometry of an automation strip (PURE, no DOM): the pixel ↔ musical position and value maps used by the editor.
 * A strip comes from `ScoreView.automationStrips()`: { x1, x2, yVol0, yVol1, yMute1, yMute2, grid: [{ abs, x, level }] } (pixels of the SVG, y down). `abs` are fractions
 * of the whole note from the start of the movement; `level` is 0 for a measure start, 1 for a beat, 2 for a half beat.
 */
import { frac, fCmp, fToNumber } from '../model/fraction.js';

export const SNAPS = Object.freeze(['measure', 'beat', 'half', 'sixteenth', 'free']);
const MAX_LEVEL = { measure: 0, beat: 1, half: 2, sixteenth: 3 };
const TICKS = 3840; // per whole note (960 per quarter)

/** Pixel x of a position (linear between the grid points). */
export function xOfAbs(strip, abs) {
  const g = strip.grid;
  if (!g.length) return strip.x1;
  if (fCmp(abs, g[0].abs) <= 0) return g[0].x;
  for (let i = 1; i < g.length; i++) {
    if (fCmp(abs, g[i].abs) <= 0) {
      const a = g[i - 1]; const b = g[i];
      const t = (fToNumber(abs) - fToNumber(a.abs)) / ((fToNumber(b.abs) - fToNumber(a.abs)) || 1);
      return a.x + (b.x - a.x) * t;
    }
  }
  return g[g.length - 1].x;
}

/** Position under pixel x, snapped to the grid ('measure' | 'beat' | 'half' | 'sixteenth') or free (to the nearest tick). */
export function absOfX(strip, x, snap = 'beat') {
  const g = strip.grid;
  const px = Math.min(strip.x2, Math.max(strip.x1, x));
  if (snap !== 'free') {
    const max = MAX_LEVEL[snap] ?? 1;
    let best = null;
    for (const p of g) if (p.level <= max && (best === null || Math.abs(p.x - px) < Math.abs(best.x - px))) best = p;
    return best ? best.abs : g[0].abs;
  }
  for (let i = 1; i < g.length; i++) {
    if (px <= g[i].x) {
      const a = g[i - 1]; const b = g[i];
      const t = (px - a.x) / ((b.x - a.x) || 1);
      const n = fToNumber(a.abs) + (fToNumber(b.abs) - fToNumber(a.abs)) * t;
      return frac(Math.round(n * TICKS), TICKS);
    }
  }
  return g[g.length - 1].abs;
}

/** The next grid position after `abs` at the level of `snap` (the end of a one-cell span). 'free' uses beats. */
export function nextSnap(strip, abs, snap = 'beat') {
  const max = MAX_LEVEL[snap === 'free' ? 'beat' : snap] ?? 1;
  for (const p of strip.grid) if (p.level <= max && fCmp(p.abs, abs) > 0) return p.abs;
  return strip.lastAbs ?? abs;
}

/** Value (0..1, steps of 1/127) at pixel y of the volume area. */
export function valueOfY(strip, y) {
  const span = strip.yVol0 - strip.yVol1;
  const v = span ? (strip.yVol0 - y) / span : 0;
  const steps = strip.steps ?? 127; // 127 for the volume, 126 for the pan (so that its centre, 0.5, is exact)
  return Math.round(Math.min(1, Math.max(0, v)) * steps) / steps;
}
export const yOfValue = (strip, v) => strip.yVol0 + (strip.yVol1 - strip.yVol0) * Math.min(1, Math.max(0, v));

/** True when pixel y falls in the mute row of the strip. */
export const inMuteRow = (strip, y) => y >= strip.yMute1 && y < strip.yMute2;

/** Is `abs` inside the strip's own range [firstAbs, lastAbs]? */
export const inStrip = (strip, abs) => fCmp(abs, strip.firstAbs) >= 0 && fCmp(abs, strip.lastAbs) <= 0;

