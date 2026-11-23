/*
 * The strip of the mixer automation under a track (screen only): its background, the fader line, the mute blocks, the volume curve and its points, and a grid of
 * the beats of the system used by the editor to snap what the user drags. Drawn with the layout of the score, so the points fall exactly under the measures.
 * Not printed or exported (role 'automation'). The strip carries `ref: null`: it is not a selectable element of the score; the editor (ui/automation-dom.js)
 * reads its geometry through `ScoreView.automationStrips`.
 *
 * Staff coordinates, y UP. The strip is a rectangle of height STRIP_HEIGHT sp whose top edge is `top`; the first MUTE_ROW sp are the mute row, the rest the volume
 * area (value 0 at its bottom edge, 1 at its top edge).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { measureLayout } from '../model/tempomap.js';
import { laneOf, sortedEntries, laneAt, pitchBendRangeOf, shapeRamp } from '../model/automation.js';
import { ZERO, frac, fAdd, fSub, fCmp, fToNumber } from '../model/fraction.js';

export const STRIP_HEIGHT = 5.2;
export const MUTE_ROW = 0.9;
const GAP = 0.8; // between what the staff carries and the strip
// colours follow the theme (`--auto-*` in static/index.html; the light values are the fallbacks)
const COLORS = { bg: 'var(--auto-bg,#f3f6fb)', border: 'var(--auto-border,#b9c4d6)', fader: 'var(--auto-fader,#8a97ab)', curve: 'var(--auto-curve,#2878ff)', mute: 'var(--auto-mute,#c3c9d3)', point: 'var(--auto-point,#ffffff)', grid: 'var(--auto-grid,#dde4ef)', label: 'var(--auto-label,#5b6b84)' };

/** The short name written after the track name on a strip that is not the volume. */
const LANE_TAG = { pan: 'pan', expression: 'expr.', reverb: 'reverb', chorus: 'chorus', brightness: 'bright.', modulation: 'mod.', pitchbend: 'pitch' };

/** Beats of a time signature as a fraction of the whole note: 1/den, or 3/den in compound time (6/8, 9/8, 12/8). */
export function beatLength([num, den]) {
  return num > 3 && num % 3 === 0 && den >= 8 ? frac(3, den) : frac(1, den);
}

/**
 * @param o.movement  the movement; o.track the track; o.sys the system (`sys.measures` with `mi`, `start`, `barX`); o.xAt (mi, position) → x
 * @param o.bottom    y (staff coordinates) of the lowest thing the staff carries; o.fader 0..1 the fader of the track
 * @returns {{ items, strip }} `strip` = { trackId, top, bottom, yMute, yVol0, yVol1, x1, x2, grid: [{ abs, x, level }], firstAbs, lastAbs }
 */
export function automationStrip({ movement, track, sys, xAt, bottom, fader, name = '', scale = 1, param = 'volume', gap = GAP, above = false }) {
  const layout = measureLayout(movement);
  // `above`: the strip sits ABOVE `bottom` (the master volume strip, over the top staff) instead of under it
  const master = param === 'master';
  const muteRow = master ? 0 : MUTE_ROW; // the master volume has no mute row
  const height0 = STRIP_HEIGHT * scale;
  const top = above ? bottom + gap + height0 : bottom - gap;
  const height = height0; // the strip can be made taller (screen option: 1, 1.6, 2.4) to draw the curve more easily
  const low = top - height;
  const yVol1 = top - muteRow; // value 1
  const yVol0 = low; // value 0
  const first = sys.measures[0];
  const last = sys.measures[sys.measures.length - 1];
  if (!first || !last) return { items: [], strip: null };
  const x1 = first.start;
  const x2 = last.barX;
  const firstAbs = layout.starts[first.mi];
  const lastAbs = fAdd(layout.starts[last.mi], layout.lengths[last.mi]);
  // grid of the system: measure starts (level 0), beats (1), half beats (2), sixteenth notes in between (3), with their x
  const grid = [];
  const SIXTEENTH = frac(1, 16);
  for (const m of sys.measures) {
    const bar = movement.masterbars[m.mi];
    const beat = beatLength(getProperty(bar, PID.TIME_SIG));
    const half = frac(beat[0], beat[1] * 2);
    const len = layout.lengths[m.mi];
    const onGrid = (p, g) => (p[0] * g[1]) % (p[1] * g[0]) === 0; // is p a whole number of g?
    // every sixteenth note and every half beat (a half beat is not always a whole number of sixteenth notes: 6/8)
    const points = new Map();
    for (let p = ZERO; fCmp(p, len) < 0; p = fAdd(p, SIXTEENTH)) points.set(`${p[0]}/${p[1]}`, p);
    for (let p = ZERO; fCmp(p, len) < 0; p = fAdd(p, half)) points.set(`${p[0]}/${p[1]}`, p);
    for (const p of [...points.values()].sort((a, b) => fCmp(a, b))) {
      const level = fCmp(p, ZERO) === 0 ? 0 : onGrid(p, beat) ? 1 : onGrid(p, half) ? 2 : 3;
      grid.push({ abs: fAdd(layout.starts[m.mi], p), x: xAt(m.mi, p), level });
    }
  }
  grid.push({ abs: lastAbs, x: x2, level: 0 });
  const absToX = (abs) => {
    let a = grid[0];
    if (fCmp(abs, a.abs) <= 0) return a.x;
    for (let i = 1; i < grid.length; i++) {
      const b = grid[i];
      if (fCmp(abs, b.abs) <= 0) {
        const t = (fToNumber(abs) - fToNumber(a.abs)) / ((fToNumber(b.abs) - fToNumber(a.abs)) || 1);
        return a.x + (b.x - a.x) * t;
      }
      a = b;
    }
    return grid[grid.length - 1].x;
  };
  const yOf = (v) => yVol0 + Math.min(1, Math.max(0, v)) * (yVol1 - yVol0);
  const items = [];
  const base = { role: 'automation' };
  items.push({ kind: 'rect', x: x1, y: low, w: x2 - x1, h: height, fill: COLORS.bg, ...base, role: 'automation-bg', trackId: track.id });
  items.push({ kind: 'line', x1, y1: top, x2, y2: top, width: 0.06, color: COLORS.border, ...base });
  items.push({ kind: 'line', x1, y1: low, x2, y2: low, width: 0.06, color: COLORS.border, ...base });
  items.push({ kind: 'line', x1, y1: yVol1 - 0.02, x2, y2: yVol1 - 0.02, width: 0.04, color: COLORS.border, ...base });
  for (const g of grid) if (g.level <= 1) items.push({ kind: 'line', x1: g.x, y1: g.level === 0 ? top : yVol1, x2: g.x, y2: low, width: g.level === 0 ? 0.05 : 0.03, color: g.level === 0 ? COLORS.border : COLORS.grid, ...base });
  if (name) items.push({ kind: 'text', x: x1 + 0.3, y: top - 0.25, text: LANE_TAG[param] ? `${name} · ${LANE_TAG[param]}` : name, size: 0.75, family: 'sans-serif', color: COLORS.label, ...base });
  // the fader line (what rules where no point speaks)
  const yf = yOf(fader);
  items.push({ kind: 'line', x1, y1: yf, x2, y2: yf, width: 0.06, color: COLORS.fader, dash: [0.4, 0.3], ...base });

  if (param === 'pan' || param === 'pitchbend') { const yc = yOf(0.5); items.push({ kind: 'line', x1, y1: yc, x2, y2: yc, width: 0.04, color: COLORS.border, ...base }); } // the centre of the stereo field
  const volume = sortedEntries(laneOf(track, param), layout); // the curve shown: the lane of the strip (volume or pan)
  const mute = sortedEntries(laneOf(track, 'mute'), layout);
  // mute blocks (value 1 from a point to the next)
  for (let i = 0; i < mute.length; i++) {
    if (mute[i].value !== 1) continue;
    const a = fCmp(mute[i].abs, firstAbs) < 0 ? firstAbs : mute[i].abs;
    const bAbs = i + 1 < mute.length ? mute[i + 1].abs : lastAbs;
    const b = fCmp(bAbs, lastAbs) > 0 ? lastAbs : bAbs;
    if (fCmp(b, firstAbs) <= 0 || fCmp(a, lastAbs) >= 0) continue;
    const xa = absToX(a); const xb = absToX(b);
    items.push({ kind: 'rect', x: xa, y: yVol1, w: Math.max(0.1, xb - xa), h: MUTE_ROW - 0.05, fill: COLORS.mute, ...base });
  }
  // the volume curve over the system: the value at the start, the points inside, the value at the end (linear ramps and steps)
  if (volume.length) {
    const val = (abs, side) => laneAt(volume, abs, side, fader, fader);
    const pts = [{ abs: firstAbs, v: val(firstAbs, 'after'), ramp: null }];
    for (const e of volume) if (fCmp(e.abs, firstAbs) > 0 && fCmp(e.abs, lastAbs) < 0) pts.push({ abs: e.abs, v: e.value ?? fader, ramp: e.ramp, curve: e.curve, id: e.id, before: val(e.abs, 'before') });
    pts.push({ abs: lastAbs, v: val(lastAbs, 'before'), ramp: null });
    let prev = { x: absToX(pts[0].abs), y: yOf(pts[0].v), v: pts[0].v, ramp: governing(volume, firstAbs), curve: volume.filter((e) => fCmp(e.abs, firstAbs) <= 0).pop()?.curve };
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const x = absToX(p.abs);
      if (prev.ramp === 'linear' && prev.curve) { // a bowed ramp: short straight pieces along the curve
        const v1 = p.before ?? p.v; let ax = prev.x; let ay = prev.y;
        for (let k = 1; k <= 16; k++) {
          const u = k / 16; const bx = prev.x + (x - prev.x) * u; const by = yOf(prev.v + (v1 - prev.v) * shapeRamp(u, prev.curve));
          items.push({ kind: 'line', x1: ax, y1: ay, x2: bx, y2: by, width: 0.11, color: COLORS.curve, ...base }); ax = bx; ay = by;
        }
      } else if (prev.ramp === 'linear') items.push({ kind: 'line', x1: prev.x, y1: prev.y, x2: x, y2: yOf(p.before ?? p.v), width: 0.11, color: COLORS.curve, ...base });
      else items.push({ kind: 'line', x1: prev.x, y1: prev.y, x2: x, y2: prev.y, width: 0.11, color: COLORS.curve, ...base });
      if (p.id !== undefined) {
        const yb = yOf(p.before ?? p.v); const ya = yOf(p.v);
        if (Math.abs(yb - ya) > 0.01) items.push({ kind: 'line', x1: x, y1: yb, x2: x, y2: ya, width: 0.11, color: COLORS.curve, ...base });
      }
      prev = { x, y: yOf(p.v), v: p.v, ramp: p.ramp, curve: p.curve };
    }
    for (const e of volume) {
      if (fCmp(e.abs, firstAbs) < 0 || fCmp(e.abs, lastAbs) >= 0) continue;
      items.push({ kind: 'circle', cx: absToX(e.abs), cy: yOf(e.value ?? fader), r: 0.3, fill: COLORS.point, stroke: COLORS.curve, strokeWidth: 0.1, ...base, pointId: e.id });
    }
  }
  return { items, strip: { trackId: track.id, param, steps: param === 'pan' || param === 'pitchbend' ? 126 : 127, ...(param === 'pitchbend' ? { range: pitchBendRangeOf(track) } : {}), top, bottom: low, yMute: top, yVol0, yVol1, x1, x2, firstAbs, lastAbs, grid: grid.map((g) => ({ abs: g.abs, x: g.x, level: g.level })) } };
}

function governing(entries, abs) {
  let g = null;
  for (const e of entries) { if (fCmp(e.abs, abs) <= 0) g = e; else break; }
  return g?.ramp ?? null;
}

export { COLORS as STRIP_COLORS };
