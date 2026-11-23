/*
 * Cache of the PAINTING of one measure of one staff (incremental layout, step 2).
 *
 * A measure painted in coordinates local to itself (layout/index.js `localPaint`) gives the same result wherever it sits along x (step 0 proved it on
 * every demo): the cache keeps that local result and re-uses it, translated, when nothing changed in the measure. Two things come out of a painting:
 *   - the DISPLAY ITEMS of the measure, and
 *   - what the painters WROTE onto the entries (`slurGeom`, `tabGeom`, `articItems`, the anchors of the ornaments of a tablature chord, `slurBeam`…),
 *     which the passes of range marks read afterwards.
 * Both are saved as a record, and given back as COPIES (the later passes modify items in place — embedStemsInBeams, the passes of slurs — so the cache must
 * never hand out, nor keep, an object that is in use).
 */
import { translateItemInPlace } from './offsets.js';
import { shiftedSlurGeom, shiftedTabGeom } from './entrygeom.js';

const round6 = (x) => Math.round(x * 1e6);

/** Key of everything the painting of a measure depends on that is NOT in the (unchanged) content: where its columns fall relative to its start. */
export function relativeKey(placed, m, sys) {
  const xs = placed.map((p) => round6(p.x - m.start));
  return `${xs.join(',')}|${round6(m.content)}|${round6(m.barX - m.start)}|${m.mi === sys.first ? 1 : 0}`;
}

/** A copy of a display item that a later in-place translation cannot reach through shared nested objects. */
function cloneItem(it) {
  const n = { ...it };
  if (it.bounds) n.bounds = { ...it.bounds };
  return n;
}

const cloneAnchors = (map, dx = 0) => new Map([...map].map(([id, a]) => [id, { ...a, geom: shiftedTabGeom(a.geom, dx) }]));

/**
 * Record of a freshly painted measure (call BEFORE translating anything: everything is still local).
 * @param placed  [{ entry, x }] given to the painter ; `pre` = shallow copies of the entries taken before painting ; `items` = what `paintMeasure` returned
 */
export function snapshotMeasure({ placed, pre, items }) {
  const index = new Map(items.map((it, i) => [it, i])); // items by identity: `articItems` of an entry are some of them
  const deltas = placed.map((p, i) => {
    const e = p.entry;
    const d = {};
    for (const k of Object.keys(e)) {
      if (e[k] === pre[i][k]) continue;
      const v = e[k];
      if (k === 'slurGeom') d[k] = shiftedSlurGeom(v, 0);
      else if (k === 'tabGeom') d[k] = shiftedTabGeom(v, 0);
      else if (k === 'articItems') d[k] = { itemIndexes: v.map((it) => (index.has(it) ? index.get(it) : -1)), fallback: v.map(cloneItem) };
      else d[k] = v; // relative or independent of x: shared by reference
    }
    const anchors = {};
    for (const key of ['graceLayout', 'graceTrailLayout']) if (e[key]?.anchors) anchors[key] = cloneAnchors(e[key].anchors);
    return { d, anchors };
  });
  return { items: items.map(cloneItem), deltas };
}

/** The painting of a measure from its record, translated by `dx`: { items, apply(placed) } — `apply` writes the saved fields onto the new entries. */
export function restoreMeasure(record, dx) {
  const items = record.items.map((it) => translateItemInPlace(cloneItem(it), dx));
  const apply = (placed) => {
    placed.forEach((p, i) => {
      const { d, anchors } = record.deltas[i];
      const e = p.entry;
      for (const k of Object.keys(d)) {
        const v = d[k];
        if (k === 'slurGeom') e.slurGeom = shiftedSlurGeom(v, dx);
        else if (k === 'tabGeom') e.tabGeom = shiftedTabGeom(v, dx);
        else if (k === 'articItems') e.articItems = v.itemIndexes.map((ix, j) => (ix >= 0 ? items[ix] : translateItemInPlace(cloneItem(v.fallback[j]), dx)));
        else e[k] = v;
      }
      for (const key of Object.keys(anchors)) {
        if (e[key]) e[key].anchors = cloneAnchors(anchors[key], dx);
      }
    });
  };
  return { items, apply };
}
