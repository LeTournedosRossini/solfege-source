/*
 * Composite staves (model/composite.js) in a system: the carrier staff (the tallest source, the only one that takes room) receives the MEASURES of the other sources
 * where the composite shows them. Every source has been laid out and painted like any staff, so a measure looks exactly as it does on screen 1; here the finished
 * items are sorted by the measure they sit in, kept for the source that shows that measure, centred on the carrier's middle line and dropped when they straddle a
 * junction between two different sources (a tie, a bend… that would start in one staff and end in another is simply cut).
 *   zone of a measure = from just after the end barline of the previous measure (the start of the system for the first) to its own end barline;
 *   what sits left of the first measure (clef, key, time signature, string letters) is that of the source of the first measure.
 */
import { rectsOf } from './bounds.js';
import { translateItem } from './offsets.js';
import { barlineItems, barlineFootprint } from './barlines.js';
import { BARLINE_THIN_W } from './constants.js';

const JUNCTION_TYPE = { double: 'double', thick: 'heavy' };
const LOZENGE_STYLES = new Set(['lozenge', 'lozengeHollow', 'lozengeTriple']);
const LOZENGE_GAP = 0.8; // between the two thin lines of a lozenge bar, centre to centre
const LOZENGE_WIDTH = LOZENGE_GAP + BARLINE_THIN_W; // the bar of `composite.junction` → the bar line type that draws it
const CLEF_MAG = 0.75; // the clef shown again after a junction is a small one, like a courtesy clef

const BAR_OVERSHOOT = 0.065; // an ordinary bar line goes this far beyond the outer lines
const BAR_ROOM = 0.5; // an end barline belongs to its own measure: the next zone starts this far after its x

/** Replaces, in every system of `out`, the items of the carrier of each composite by the merged measures; empties the other sources. Mutates `out`. */
export function mergeComposites({ out, ctx, systems }) {
  for (const comp of ctx.composed ?? []) {
    const index = (ref) => ctx.staves.indexOf(ref);
    const bySource = new Map(comp.sources.map((s) => [s.ref.staff.id, s]));
    out.forEach((o, k) => {
      const sys = systems[k];
      const carrierEntry = o.staves[index(comp.carrier.ref)];
      if (!carrierEntry) return;
      const zones = sys.measures.map((m, j) => ({ mi: m.mi, from: j === 0 ? -Infinity : sys.measures[j - 1].barX + BAR_ROOM, to: m.barX + BAR_ROOM, bar: m.barX, source: comp.byMeasure[m.mi] }));
      if (!zones.length) return;
      const zoneAt = (x) => { for (let j = zones.length - 1; j >= 0; j--) if (x >= zones[j].from) return zones[j]; return zones[0]; };
      const items = [];
      const junctionStyle = comp.composite.junction;
      const junctionType = JUNCTION_TYPE[junctionStyle] ?? (LOZENGE_STYLES.has(junctionStyle) ? 'lozenge' : null);
      const changes = zones.map((z, j) => j + 1 < zones.length && zones[j + 1].source !== z.source); // the staff shown changes right after measure j
      const clefs = new Map(comp.sources.map((s) => [s, headerClefs(s, o.staves[index(s.ref)], ctx, sys)])); // (before the other sources are emptied)
      const bars = new Map(); // junction index → { y1, y2, ref } of the ordinary bar line that the styled bar replaces
      for (const source of comp.sources) {
        const entry = o.staves[index(source.ref)];
        if (!entry) continue;
        const id = source.ref.staff.id;
        const dy = -source.shift; // translateItem takes a downward shift
        for (const it of entry.items) {
          if (it.role === 'staff-line') { // the lines are cut to the stretch of measures this source shows
            for (const run of runsOf(zones, id)) {
              const x1 = Math.max(it.x1, run.from); const x2 = Math.min(it.x2, run.to);
              if (x2 > x1 + 1e-6) items.push(translateItem({ ...it, x1, x2 }, 0, dy));
            }
            continue;
          }
          const rect = rectsOf([it], ctx.glyphs)[0];
          if (!rect) { if (source === comp.carrier) items.push(it); continue; } // (an item with no extent only stays on the carrier)
          const a = zoneAt(rect.x1 + 1e-6); const b = zoneAt(rect.x2 - 1e-6);
          if (a.source !== id || b.source !== id) continue; // not shown here, or straddling a junction
          const placed = source === comp.carrier || !source.shift ? it : translateItem(it, 0, dy);
          const j = zones.indexOf(a);
          if (junctionType && it.role === 'barline' && changes[j] && it.kind === 'line' && Math.abs(it.x1 - a.bar) < 0.6) { // the bar at a junction is drawn in the chosen style instead
            const y = bars.get(j) ?? { y1: Infinity, y2: -Infinity, ref: it.ref };
            bars.set(j, { ...y, y1: Math.min(y.y1, placed.y1, placed.y2), y2: Math.max(y.y2, placed.y1, placed.y2) });
            continue;
          }
          items.push(placed);
        }
        if (source !== comp.carrier) entry.items = [];
      }
      // the junction bar is as tall as the TALLER of the two staves it separates
      const reach = (staffId) => { const ys = items.filter((it) => it.role === 'staff-line' && it.ref === staffId).map((it) => it.y1); return ys.length ? [Math.min(...ys) - BAR_OVERSHOOT, Math.max(...ys) + BAR_OVERSHOOT] : null; };
      for (const [j, y] of bars) {
        const both = [reach(zones[j].source), reach(zones[j + 1].source)].filter(Boolean);
        const lo = Math.min(y.y1, ...both.map((r) => r[0])); const hi = Math.max(y.y2, ...both.map((r) => r[1]));
        items.push(...(junctionType === 'lozenge' ? lozengeBar(junctionStyle, zones[j].bar, lo, hi, y.ref) : barlineItems(zones[j].bar, junctionType, lo, hi, y.ref, ctx.glyphs)));
      }
      // the clef of the staff that starts, small, right after the bar (it only exists in the header of the system otherwise)
      if (comp.composite.junctionClef) {
        zones.forEach((z, j) => {
          if (!changes[j]) return;
          const next = comp.sources.find((s) => s.ref.staff.id === zones[j + 1].source);
          const x0 = z.bar + (junctionType === 'lozenge' ? LOZENGE_WIDTH : barlineFootprint(junctionType ?? 'simple')) + 0.3;
          for (const g of next ? clefs.get(next) : []) items.push({ ...translateItem(g, 0, -next.shift), x: x0, mag: (g.mag ?? 1) * CLEF_MAG });
        });
      }
      carrierEntry.items = items;
    });
  }
}

/**
 * A junction bar with a lozenge: two thin lines `LOZENGE_GAP` apart (left edge of the bar at `x`) and, between them, a lozenge — filled ('lozenge'), an outline on the
 * paper ('lozengeHollow') or three small ones, at both ends and in the middle ('lozengeTriple'). `lo` / `hi` = the bottom and top of the bar.
 */
function lozengeBar(style, x, lo, hi, ref) {
  const w = BARLINE_THIN_W;
  const line = (cx) => ({ kind: 'line', role: 'barline', x1: cx, x2: cx, y1: lo, y2: hi, width: w, ref });
  const xa = x + w / 2; const xb = x + LOZENGE_GAP + w / 2; const mid = (xa + xb) / 2; const ym = (lo + hi) / 2;
  const diamond = (cx, cy, hw, hh, extra = {}) => ({ kind: 'polygon', role: 'barline', points: [[cx, cy + hh], [cx + hw, cy], [cx, cy - hh], [cx - hw, cy]], ref, ...extra });
  const k = Math.min(1.9, Math.max(1, (hi - lo) / 4.2)); // the lozenges grow with the staff (a tablature is taller than a notation staff), the lines stay as thin
  const items = [line(xa), line(xb)];
  if (style === 'lozengeHollow') items.push(diamond(mid, ym, 0.34 * k, 0.66 * k, { fill: 'paper', stroke: 'ink', strokeWidth: 0.12 }));
  else if (style === 'lozengeTriple') items.push(diamond(mid, ym, 0.27 * k, 0.5 * k), diamond(mid, hi - 0.4 * k, 0.2 * k, 0.34 * k), diamond(mid, lo + 0.4 * k, 0.2 * k, 0.34 * k));
  else items.push(diamond(mid, ym, 0.3 * k, 0.6 * k));
  return items;
}

/** The clef glyphs of a source staff in the header of a system (taken from its own painted items: they are emptied once the measures are merged). */
function headerClefs(source, entry, ctx, sys) {
  if (!source || !entry) return [];
  const first = sys.measures[0].start;
  return entry.items.filter((it) => it.kind === 'glyph' && /clef/i.test(it.name ?? '') && it.x < first && it.role !== 'clef-change');
}

/** The stretches [{ from, to }] of consecutive measures that show `staffId`: a run starts at the end barline before it and ends at its own end barline. */
function runsOf(zones, staffId) {
  const runs = [];
  let open = null;
  zones.forEach((z, j) => {
    if (z.source === staffId) {
      if (!open) open = { from: j === 0 ? -Infinity : zones[j - 1].bar, to: z.bar };
      else open.to = z.bar;
      if (j === zones.length - 1) open.to = Infinity;
    } else if (open) { runs.push(open); open = null; }
  });
  if (open) runs.push(open);
  return runs;
}
