/*
 * User grips of slurs, ties, hammer-ons/pull-offs and hairpins (step 5): the end points and Bézier control points of a curve, the end
 * points and opening of a hairpin. MuseScore 4.7.5 (`slurtie.cpp` `SLUR_UOFF1..4`, `hairpin.cpp` `HAIRPIN_HEIGHT`): offsets are stored PER
 * SEGMENT (one set for each system the spanner crosses) and ADDED to the automatic shape, which is recomputed at every layout.
 *
 * Stored on the list entry itself (so it travels with copy/paste, undo and deletion):
 *   entry.grips = { segments: { "0": { start: [dx, dy], c1: [dx, dy], c2: [dx, dy], end: [dx, dy] }, "1": … }, aperture?: number }
 * Offsets are in staff spaces, y DOWN (same convention as `PID.OFFSETS`). `aperture` (hairpins only, spaces) replaces the full opening
 * `hairpinHeight` of the WHOLE hairpin. A zero offset is never stored; an empty `grips` is removed.
 */

/** Grip keys by kind of entry. */
export const CURVE_GRIPS = Object.freeze(['start', 'c1', 'c2', 'end']);
export const HAIRPIN_GRIPS = Object.freeze(['start', 'end']);
/** List-entry kinds (`doc.findListEntry(id).kind`) that carry grips → 'curve' | 'hairpin'. */
export const GRIP_KINDS = Object.freeze({ slur: 'curve', tie: 'curve', hopo: 'curve', hairpin: 'hairpin' });
export const MIN_APERTURE = 0.5;
export const MAX_APERTURE = 4;

const isOffset = (o) => Array.isArray(o) && o.length === 2 && Number.isFinite(o[0]) && Number.isFinite(o[1]);
const isZero = (o) => o[0] === 0 && o[1] === 0;

/** Offset [dx, dy] of one grip of one segment ([0, 0] when none). */
export function gripOffset(entry, seg, key) {
  const o = entry?.grips?.segments?.[String(seg)]?.[key];
  return isOffset(o) ? o : [0, 0];
}

/** Aperture override (spaces) or null. */
export const gripAperture = (entry) => (Number.isFinite(entry?.grips?.aperture) ? entry.grips.aperture : null);

/** True when the entry has any user grip. */
export const hasGrips = (entry) => !!entry?.grips && (gripAperture(entry) !== null || Object.keys(entry.grips.segments ?? {}).length > 0);

function clean(grips) {
  const segments = {};
  for (const [seg, keys] of Object.entries(grips.segments ?? {})) {
    const k = {};
    for (const [key, o] of Object.entries(keys)) if (isOffset(o) && !isZero(o)) k[key] = [o[0], o[1]];
    if (Object.keys(k).length) segments[seg] = k;
  }
  const out = {};
  if (Object.keys(segments).length) out.segments = segments;
  if (Number.isFinite(grips.aperture)) out.aperture = grips.aperture;
  return Object.keys(out).length ? out : null;
}

function withGrips(entry, grips) {
  const { grips: _old, ...rest } = entry;
  const next = grips ? clean(grips) : null;
  return next ? { ...rest, grips: next } : rest;
}

/** A copy of `entry` with one grip offset set (a zero offset clears it). */
export function withGrip(entry, seg, key, offset) {
  const grips = { segments: { ...(entry.grips?.segments ?? {}) }, aperture: entry.grips?.aperture };
  grips.segments[String(seg)] = { ...(grips.segments[String(seg)] ?? {}), [key]: [offset[0], offset[1]] };
  return withGrips(entry, grips);
}

/** A copy of `entry` with the aperture set (`null` clears it). Clamped to [MIN_APERTURE, MAX_APERTURE]. */
export function withAperture(entry, value) {
  const grips = { segments: { ...(entry.grips?.segments ?? {}) } };
  if (value !== null) grips.aperture = Math.min(MAX_APERTURE, Math.max(MIN_APERTURE, value));
  return withGrips(entry, grips);
}

/** A copy of `entry` with grips cleared: all, one segment, or one grip of one segment (aperture only with `all`). */
export function withoutGrips(entry, { seg = null, key = null } = {}) {
  if (seg === null) return withGrips(entry, null);
  const grips = { segments: { ...(entry.grips?.segments ?? {}) }, aperture: entry.grips?.aperture };
  if (key === null) delete grips.segments[String(seg)];
  else if (grips.segments[String(seg)]) {
    const { [key]: _drop, ...rest } = grips.segments[String(seg)];
    grips.segments[String(seg)] = rest;
  }
  return withGrips(entry, grips);
}
