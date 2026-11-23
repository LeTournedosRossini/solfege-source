/*
 * ADVISED PAGE TURNS. A musician reads on a tablet whose shape and size nobody knows in advance: the Lecteur cuts the pages itself. The author can say, STAFF BY STAFF (so instrument by
 * instrument: the guitar and the bass do not want to turn at the same place), where a page is advised to START; the automatic cutting prefers those places (never forced: a hint that would
 * leave a page almost empty is ignored). A hint is an entry `{ id, measureId }` of the list `PID.PAGE_HINTS` of the staff, anchored by the id of the masterbar like everything else.
 * Pure functions; the writes go through `doc` (inside a transaction).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';

export const pageHintsOf = (staff) => getProperty(staff, PID.PAGE_HINTS) ?? [];
export const hasPageHint = (staff, measureId) => pageHintsOf(staff).some((h) => h.measureId === measureId);

/** Puts the hint on (or takes it off) at `measureId` for these staves: on for all when one of them lacks it, else off for all. Returns the new state (true = on). */
export function togglePageHint(doc, staves, measureId) {
  const on = !staves.every((s) => hasPageHint(s, measureId));
  for (const staff of staves) {
    const list = pageHintsOf(staff).filter((h) => h.measureId !== measureId);
    if (on) list.push({ id: newId('ph'), measureId });
    if (list.length) doc.set(staff, PID.PAGE_HINTS, list); else if (pageHintsOf(staff).length) doc.reset(staff, PID.PAGE_HINTS);
  }
  return on;
}

/** The measures (indices of the movement) where a page is advised to start, for the staves of the given tracks (all of the movement's when `trackIds` is null). A hint on a measure that is gone is ignored. */
export function pageHintMeasures(movement, trackIds = null) {
  const index = new Map(movement.masterbars.map((mb, i) => [mb.id, i]));
  const out = new Set();
  for (const track of movement.tracks) {
    if (trackIds && !trackIds.includes(track.id)) continue;
    for (const staff of track.staves) for (const h of pageHintsOf(staff)) if (index.has(h.measureId)) out.add(index.get(h.measureId));
  }
  return out;
}

/** What the Lecteur follows: the hints only count when ONE track is shown (they were advised for that track); with several tracks, null (the automatic pages decide). */
export function hintsForShown(movement, trackIds = null) {
  const ids = trackIds ?? movement.tracks.map((t) => t.id);
  return ids.length === 1 ? pageHintMeasures(movement, ids) : null;
}
