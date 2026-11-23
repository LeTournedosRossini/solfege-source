/*
 * Geometry that the painters write onto the ENTRIES of a measure while they paint it, in x of the coordinate system they were given (the
 * passes of range marks — slurs, glissandos… — read it afterwards). When a measure is painted in coordinates local to itself (incremental
 * layout), this geometry is local too and must be translated with the measure. `translateEntries` is that translation.
 *
 * The list of absolute fields was FOUND by painting every demo work twice (absolute and local) and comparing what the painters wrote on the
 * entries: only the x of `slurGeom` and `tabGeom` differ by exactly the offset (the rest — y, widths, `dotsRight`, `chordLineBox`,
 * `arpeggioBox`, `accExtent`, `restDy`… — is relative to the chord or independent of x). `articItems` are display items shared with the painted
 * list: they are translated in place with it (`translateItemInPlace`). A test (tests/layout-incremental.test.js) keeps this honest.
 */
const shift = (o, keys, dx) => { for (const k of keys) if (typeof o[k] === 'number') o[k] += dx; };
const shiftRect = (r, dx) => { if (r) shift(r, ['x1', 'x2'], dx); };

export function translateSlurGeom(g, dx) {
  shift(g, ['x0', 'headRight', 'stemX'], dx);
  for (const n of g.notes ?? []) { shift(n, ['cx'], dx); for (const r of n.rects ?? []) shiftRect(r, dx); }
  for (const d of g.dots ?? []) shiftRect(d, dx);
  for (const o of g.others ?? []) shiftRect(o, dx);
  shiftRect(g.hook, dx);
  shiftRect(g.rest, dx);
  if (g.stem) shift(g.stem, ['x'], dx);
}

export function translateTabGeom(g, dx) {
  shift(g, ['axis'], dx);
  for (const n of g.notes ?? []) { shiftRect(n.noteBox, dx); for (const r of n.rects ?? []) shiftRect(r, dx); }
  for (const d of g.dots ?? []) shiftRect(d, dx);
  shiftRect(g.hook, dx);
  shiftRect(g.rest, dx);
  if (g.stem) shift(g.stem, ['x'], dx);
}

/** Translates, in place, the absolute geometry the painters wrote on `entries` (one measure). */
export function translateEntries(entries, dx) {
  if (!dx) return;
  for (const e of entries) {
    if (e.slurGeom) translateSlurGeom(e.slurGeom, dx);
    if (e.tabGeom) translateTabGeom(e.tabGeom, dx);
    // ornaments of a tablature chord: `layout.anchors` (a Map, hence missing from a plain comparison) holds an ABSOLUTE `tabGeom`-shaped record per ornament
    for (const lay of [e.graceLayout, e.graceTrailLayout]) if (lay?.anchors) for (const a of lay.anchors.values()) translateTabGeom(a.geom, dx);
  }
}

// ---------- translated COPIES (the cache gives out copies; `structuredClone` was the slowest part of re-using a measure) ----------
const rectAt = (r, dx) => (r ? { ...r, x1: r.x1 + dx, x2: r.x2 + dx } : r);

/** A translated copy of a `slurGeom` (same fields as `translateSlurGeom` moves). */
export function shiftedSlurGeom(g, dx) {
  return {
    ...g,
    x0: g.x0 + dx, headRight: g.headRight + dx, stemX: g.stemX === null || g.stemX === undefined ? g.stemX : g.stemX + dx,
    notes: g.notes.map((n) => ({ ...n, cx: n.cx + dx, rects: n.rects.map((r) => rectAt(r, dx)) })),
    dots: g.dots.map((r) => rectAt(r, dx)),
    others: g.others.map((r) => rectAt(r, dx)),
    stem: g.stem ? { ...g.stem, x: g.stem.x + dx } : g.stem,
    hook: rectAt(g.hook, dx),
    rest: rectAt(g.rest, dx),
  };
}

/** A translated copy of a `tabGeom` (also the geometry of the ornaments of a tablature chord). */
export function shiftedTabGeom(g, dx) {
  return {
    ...g,
    axis: g.axis + dx,
    notes: g.notes.map((n) => ({ ...n, noteBox: rectAt(n.noteBox, dx), rects: (n.rects ?? []).map((r) => rectAt(r, dx)) })),
    dots: (g.dots ?? []).map((r) => rectAt(r, dx)),
    stem: g.stem ? { ...g.stem, x: g.stem.x + dx } : g.stem,
    hook: rectAt(g.hook, dx),
    rest: rectAt(g.rest, dx),
  };
}
