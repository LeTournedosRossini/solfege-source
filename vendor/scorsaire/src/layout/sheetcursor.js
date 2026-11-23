/*
 * Where is the playhead of a cell? PURE. `playheadRect(laidCell, movement, at)` → { x, y1, y2 } in the pixels of the cell's SVG (`at` = { measure, position }
 * from `audio/cursor.js: locate`), or null when that measure is not in the layout. Used by the sheets screen of the editor and by the reader.
 */
import { fAdd } from '../model/fraction.js';
import { measureOffsetOf } from '../model/timing.js';

export function playheadRect(laid, movement, at) {
  if (!laid || !movement || !at) return null;
  const ss = laid.staffSpace;
  for (const sys of laid.layout.systems) {
    const m = sys.measures.find((x) => x.index === at.measure);
    if (!m || !sys.staves.length) continue;
    const masterbar = movement.masterbars[at.measure];
    const nominal = masterbar ? fAdd(at.position, measureOffsetOf(masterbar, at.measure === 0)) : at.position;
    const xs = sys.xAt ? sys.xAt(at.measure, nominal) : m.x;
    return { x: laid.margin + (sys.x0 + (Number.isFinite(xs) ? xs : m.x)) * ss, y1: (sys.top + sys.staves[0].originY - 5) * ss, y2: (sys.top + sys.staves.at(-1).originY + 1) * ss };
  }
  return null;
}

/** The measures of a laid cell as boxes in the pixels of its SVG: [{ index, x1, x2, y1, y2 }] (the whole height of the system, from the opening bar to the closing one). */
export function measureZones(laid) {
  const out = [];
  if (!laid) return out;
  const ss = laid.staffSpace;
  laid.layout.systems.forEach((sys, si) => {
    if (!sys.staves.length) return;
    const ox = laid.margin + sys.x0 * ss;
    const first = sys.staves[0].originY; const last = sys.staves.at(-1).originY;
    for (const m of sys.measures) out.push({ index: m.index, system: si, x1: ox + m.x * ss, x2: ox + m.barX * ss, y1: (sys.top + first - 5) * ss, y2: (sys.top + last + 1) * ss });
  });
  return out;
}

/** The measure under a point of the cell's SVG (a point slightly above or below a system counts for that system), or null. */
export function measureAt(laid, x, y) {
  const zones = measureZones(laid);
  const inside = zones.find((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2);
  if (inside) return inside.index;
  const slack = (laid?.staffSpace ?? 10) * 4;
  const near = zones.filter((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 - slack && y <= z.y2 + slack).sort((a, b) => Math.abs(y - (a.y1 + a.y2) / 2) - Math.abs(y - (b.y1 + b.y2) / 2))[0];
  return near ? near.index : null;
}
