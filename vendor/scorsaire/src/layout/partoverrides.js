/*
 * Overrides of single elements in ONE part of the printed score (screen 2): colour, position, visibility. `overrides` = `PID.PART_OVERRIDES` =
 * { <id the element is selected by (`sel`, else `ref`)>: { color?, offset?: [dx, dy] (staff spaces, y down), hidden? } }. Applied to the display items
 * of a staff after the placement and BEFORE the vertical spacing (like the manual offsets of the movement, which they add to), so that a moved mark still
 * pushes the next staff away. A hidden item is kept (it keeps its room, like a hidden decor element) but never drawn unless the viewer asks for hidden items.
 */
import { translateItem } from './offsets.js';

/**
 * A chord whose notes ALL carry the same hidden / colour override takes it for its own items (stem, beam, flag, dots…): hiding the only note of a chord must
 * hide the stem and the beam with it, and colouring it must colour them too. `chords` = Map(chordId → [noteId…]) of the staff.
 */
function chordEffects(overrides, chords) {
  const fx = new Map();
  if (!chords) return fx;
  for (const [chordId, noteIds] of chords) {
    if (overrides[chordId]) continue; // the chord has its own record
    const recs = noteIds.map((id) => overrides[id]);
    if (!recs.length || recs.some((r) => !r)) continue;
    const hidden = recs.every((r) => r.hidden);
    const color = recs.every((r) => r.color && r.color === recs[0].color) ? recs[0].color : null;
    if (hidden || color) fx.set(chordId, { hidden, color });
  }
  return fx;
}

/** The items of a staff with the overrides applied (the same array when nothing is overridden). `chords` = Map(chordId → note ids) of the staff, optional. */
export function applyPartOverrides(items, overrides, skipKeys, chords = null) {
  if (!overrides) return items;
  let changed = false;
  const fx = chordEffects(overrides, chords);
  const out = items.map((it) => {
    const key = it.sel ?? it.ref;
    const o = key !== undefined && !skipKeys?.has(key) ? overrides[key] : undefined;
    if (!o) {
      const c = fx.get(it.ref);
      if (!c || it.sel !== undefined) return it; // marks with their own selection id (dynamics, articulations…) keep their own record
      changed = true;
      const n = { ...it };
      if (c.color) n.tint = c.color;
      if (c.hidden) n.hidden = true;
      return n;
    }
    changed = true;
    let n = o.offset ? translateItem(it, o.offset[0], o.offset[1]) : { ...it };
    if (n === it) n = { ...it };
    if (o.color) n.tint = o.color;
    if (o.hidden) n.hidden = true;
    return n;
  });
  return changed ? out : items;
}

/**
 * A staff moved, coloured or hidden as a whole: `override` = the record of its id. Vertical offset = its origin in the system (y down), horizontal offset
 * = every item of the staff. Applied after the vertical stacking (the other staves do not make room: the user placed it).
 */
export function applyStaffOverride(staff, override) {
  if (!override) return;
  if (override.offset) {
    staff.originY += override.offset[1];
    if (override.offset[0]) staff.items = staff.items.map((it) => translateItem(it, override.offset[0], 0));
  }
  if (override.color) staff.items = staff.items.map((it) => ({ ...it, tint: it.tint ?? override.color }));
  if (override.hidden) staff.items = staff.items.map((it) => ({ ...it, hidden: true }));
}
