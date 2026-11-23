/*
 * The « measure entry » mode for small touch screens (a tablet, a phone): ONE measure of ONE staff fills the top of the screen, the entry tools stay at the bottom, and the buttons
 * ◀ ▶ move to the next / previous measure, ▲ ▼ to the staff above / below. These are the pure rules (no DOM); `measure-focus.js` does the drawing and the scrolling.
 */

/** Smallest and largest size of the writing (pixels per staff space) the mode uses. */
export const FOCUS_MIN_SPACE = 6;
export const FOCUS_MAX_SPACE = 28;

/**
 * Pixels per staff space that make a measure `widthInSpaces` wide fill `availablePx`, kept between the two limits (a very short measure is not blown up past `FOCUS_MAX_SPACE`,
 * a very long one is not shrunk below `FOCUS_MIN_SPACE`: the person scrolls it then).
 */
export function focusStaffSpace(availablePx, widthInSpaces, zoom = 1) {
  if (!(availablePx > 0) || !(widthInSpaces > 0)) return FOCUS_MIN_SPACE;
  const fit = Math.min(FOCUS_MAX_SPACE, Math.max(FOCUS_MIN_SPACE, availablePx / widthInSpaces));
  const k = typeof zoom === 'number' ? zoom : 1; // 'fit' = the measure fills the width, nothing more
  return Math.round(Math.min(FOCUS_ZOOM_CEILING, fit * k) * 10) / 10; // a zoom may make the measure wider than the screen: it is scrolled
}

/** The zoom steps of the measure bar (a finger needs more room between the lines than the width alone gives), and the largest size they reach. */
/** `FIT_ZOOM` = the measure always stays whole in the width: the writing only gets smaller while notes are added, and is fitted again on another measure. */
export const FIT_ZOOM = 'fit';
export const FOCUS_ZOOMS = Object.freeze([1, 1.5, 2, FIT_ZOOM]);
export const FOCUS_ZOOM_CEILING = 48;
export const nextZoom = (zoom) => FOCUS_ZOOMS[(FOCUS_ZOOMS.indexOf(zoom) + 1) % FOCUS_ZOOMS.length] ?? 1;

/**
 * The staff the mode starts on. `staves` = [{ id, type, trackId }] in the order of the page; `start` = the staff the person was on (or null). A fretted instrument opens on its TABLATURE
 * (the ▲ ▼ buttons reach the notation staff if needed); a chord staff or a staff the page does not have falls back to the first staff that holds notes.
 */
export function pickFocusStaff(staves, start) {
  const noteStaff = (s) => s.type !== 'chord' && s.type !== 'lyrics';
  const here = staves.find((s) => s.id === start) ?? staves.find(noteStaff) ?? staves[0];
  if (!here) return null;
  if (here.type === 'score') { const tab = staves.find((s) => s.trackId === here.trackId && s.type === 'tab'); if (tab) return tab.id; }
  return here.id;
}

/** The index reached from `index` by `delta` (−1 / +1) in a list of `count` entries, or the same index at the ends. */
export const stepIndex = (index, delta, count) => Math.min(count - 1, Math.max(0, index + delta));
