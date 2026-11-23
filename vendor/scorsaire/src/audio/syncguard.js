/*
 * Guard of a synchronisation: the time map of a recording is made for a given list of measures (masterbar identifiers).
 * PURE. Inserting, deleting or moving a measure makes the map wrong, so the file must not be written with it.
 * Undo that brings the same identifiers back, in the same order, lifts the problem.
 */

/** True when the measures of the work still match those the map was made for. */
export function syncStructureMatches(work, measureIds) {
  const ids = work?.movements?.[0]?.masterbars?.map((b) => b.id) ?? [];
  return ids.length === measureIds.length && ids.every((x, i) => x === measureIds[i]);
}

/** What differs: { added, removed, moved } counts (for the explanation shown to the user). */
export function syncStructureDiff(work, measureIds) {
  const ids = work?.movements?.[0]?.masterbars?.map((b) => b.id) ?? [];
  const had = new Set(measureIds), has = new Set(ids);
  const added = ids.filter((x) => !had.has(x)).length;
  const removed = measureIds.filter((x) => !has.has(x)).length;
  const common = ids.filter((x) => had.has(x)), before = measureIds.filter((x) => has.has(x));
  const moved = common.some((x, i) => x !== before[i]) ? 1 : 0;
  return { added, removed, moved };
}

/** Name of the file written when only the score is saved (the synchronisation is dropped). */
export function scoreOnlyName(name) {
  return /\.scorsaire$/i.test(name) ? name.replace(/\.scorsaire$/i, '-partition.scorsaire') : `${name}-partition.scorsaire`;
}
