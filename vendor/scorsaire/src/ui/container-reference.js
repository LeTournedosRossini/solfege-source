/*
 * Reference strip of the full-screen editor of a nested score: the staff the container sits on, restricted to the measures the container covers,
 * greyed out and read-only (pure data here: `referenceMovement`). The strip is a layout of a derived movement that SHARES the measures of the
 * staff (same ids, same objects); everything that points outside the covered measures (lists of ties, slurs…, containers) is left out.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { clefTimeline, clefAtMeasureStart } from '../layout/clefchanges.js';

/** Whether a container shows its source staff as a reference: stacked, aligned, a score. */
export function hasReference(container) {
  return getProperty(container, PID.CONTAINER_PLACEMENT) !== 'between' && getProperty(container, PID.CONTAINER_PLACEMENT) !== 'zone' && getProperty(container, PID.CONTAINER_LAYOUT) !== 'free';
}

/**
 * A derived movement holding only `staff` (of `track`) over the measures covered by `container`, or null when the container is not aligned.
 * @param {object} movement  the movement that holds the staff
 */
export function referenceMovement(movement, track, staff, container) {
  if (!hasReference(container)) return null;
  const first = movement.masterbars.findIndex((b) => b.id === getProperty(container, PID.MEASURE_ID));
  const span = getProperty(container, PID.SPAN) ?? 1;
  if (first < 0) return null;
  const masterbars = movement.masterbars.slice(first, first + span);
  // props of the staff without the lists that refer to elements outside the slice; the clef in force at the first covered measure becomes the base clef
  const props = {};
  for (const [k, v] of Object.entries(staff.props ?? {})) if (!(Array.isArray(v) && v.some((e) => e && typeof e === 'object'))) props[k] = v; // lists of entries point at elements; plain arrays (tuning…) stay
  const clef = clefAtMeasureStart(clefTimeline(staff, movement, false), first);
  if (clef) props[PID.CLEF] = clef;
  const shim = {
    ...staff, props, containers: [],
    voices: staff.voices.map((v) => ({ ...v, measures: v.measures.slice(first, first + span) })),
  };
  const out = { ...movement, masterbars, tracks: [{ ...track, staves: [shim] }] };
  for (const [k, v] of Object.entries(movement)) if (Array.isArray(v) && k !== 'masterbars' && k !== 'tracks') out[k] = [];
  return out;
}
