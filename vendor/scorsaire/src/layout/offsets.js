/*
 * Manual displacement of elements (step 5): `movement.props[PID.OFFSETS]` = { <identifier>: [dx, dy] } in staff spaces, y DOWN (MuseScore's
 * convention for `Pid::OFFSET`), added to the automatic position AFTER the placement and BEFORE the vertical spacing of the staves (so a
 * moved mark still pushes the next staff away). The identifier is the one the element is selected by (`sel`, else `ref`): the synthetic
 * identifier of a chord mark (dynamic, articulation…), the identifier of a list entry (slur, hairpin, fingering, lyric…) or of a system
 * object (tempo, jump…). The whole element moves (every display item carrying that identifier).
 */

const shift = (list, dx, dy) => list?.map(([x, y]) => [x + dx, y + dy]);

/** A translated COPY of one display item (staff coordinates: x right, y UP). Unknown kinds are returned unchanged. */
export function translateItem(it, dx, dyDown) {
  const dy = -dyDown; // the model's y is down, the staff's y is up
  const n = { ...it };
  switch (it.kind) {
    case 'glyph': case 'text': case 'rect': case 'path':
      n.x = it.x + dx; n.y = it.y + dy;
      if (it.bounds) n.bounds = { x1: it.bounds.x1 + dx, x2: it.bounds.x2 + dx, y1: it.bounds.y1 + dy, y2: it.bounds.y2 + dy };
      break;
    case 'circle': n.cx = it.cx + dx; n.cy = it.cy + dy; break;
    case 'glyph-stretch': n.x = it.x + dx; n.y = it.y + dy; break;
    case 'line': n.x1 = it.x1 + dx; n.x2 = it.x2 + dx; n.y1 = it.y1 + dy; n.y2 = it.y2 + dy; break;
    case 'bezier':
      n.x1 = it.x1 + dx; n.y1 = it.y1 + dy; n.x2 = it.x2 + dx; n.y2 = it.y2 + dy;
      n.c1x = it.c1x + dx; n.c1y = it.c1y + dy; n.c2x = it.c2x + dx; n.c2y = it.c2y + dy;
      break;
    case 'curve':
      for (const k of ['x1', 'x2', 'topC1x', 'topC2x', 'botC1x', 'botC2x']) n[k] = it[k] + dx;
      for (const k of ['y1', 'y2', 'topC1y', 'topC2y', 'botC1y', 'botC2y']) n[k] = it[k] + dy;
      break;
    case 'polyline': case 'polygon':
      n.points = shift(it.points, dx, dy);
      if (it.stems) n.stems = it.stems.map((s) => ({ ...s, x1: s.x1 + dx, y1: s.y1 + dy, y2: s.y2 + dy }));
      break;
    default: return it;
  }
  return n;
}

/**
 * Translates a display item IN PLACE along x (used on items that were just painted in coordinates local to their measure: the painters also keep
 * some of these very objects on the entries — `entry.articItems` — so the identity must be kept). Same kinds as `translateItem`.
 */
export function translateItemInPlace(it, dx) {
  if (!dx) return it;
  switch (it.kind) {
    case 'glyph': case 'text': case 'rect': case 'path': case 'glyph-stretch':
      it.x += dx;
      if (it.bounds) { it.bounds.x1 += dx; it.bounds.x2 += dx; }
      break;
    case 'circle': it.cx += dx; break;
    case 'line': it.x1 += dx; it.x2 += dx; break;
    case 'bezier': it.x1 += dx; it.x2 += dx; it.c1x += dx; it.c2x += dx; break;
    case 'curve': for (const k of ['x1', 'x2', 'topC1x', 'topC2x', 'botC1x', 'botC2x']) it[k] += dx; break;
    case 'polyline': case 'polygon':
      it.points = it.points.map(([x, y]) => [x + dx, y]);
      if (it.stems) it.stems = it.stems.map((st) => ({ ...st, x1: st.x1 + dx }));
      break;
    default: break;
  }
  return it;
}

/** The items of a staff with the manual offsets applied (same array when nothing moves). */
export function applyOffsets(items, offsets) {
  if (!offsets) return items;
  let changed = false;
  const out = items.map((it) => {
    const key = it.sel ?? it.ref;
    const o = key !== undefined ? offsets[key] : undefined;
    if (!o) return it;
    changed = true;
    return translateItem(it, o[0], o[1]);
  });
  return changed ? out : items;
}
