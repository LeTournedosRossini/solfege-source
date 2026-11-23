/*
 * Name cards of the sections of the form: where each card sits along the strip above a system. PURE (pixels in, pixels out).
 * Like the headers of a sticky list: a card sits at the START of its section; when that start has scrolled off the left edge of the visible
 * area the card stays pinned to the left edge, until the next section's card pushes it out (or its own section ends).
 */

export const MIN_CARD_WIDTH = 18; // a card squeezed down to its colour dot

/**
 * @param segments  [{ id, px1, px2 }] the sections of one system, left to right (pixels along the system)
 * @param visible   { left, right } the visible part of the system, same pixels (`left` already excludes whatever covers the left edge, e.g. the sticky header)
 * @param widthOf   (segment) → natural width in pixels of its card
 * @param gap       space kept between a card and the edge / the next card
 * @returns [{ id, x, width }] the cards that have something visible (a section entirely outside the visible part gets none).
 *          A section too narrow for its card squeezes the card (down to `MIN_CARD_WIDTH`, the dot) instead of letting it scroll away.
 */
export function cardPlacements(segments, visible, widthOf, gap = 4) {
  const out = [];
  segments.forEach((s, i) => {
    if (s.px2 <= visible.left || s.px1 >= visible.right) return;
    const natural = widthOf(s);
    const next = segments[i + 1];
    const limit = Math.min(s.px2, next ? next.px1 : Infinity) - gap; // the card must end before this
    const start = Math.max(s.px1, visible.left + gap);
    let width = Math.min(natural, Math.max(MIN_CARD_WIDTH, limit - start));
    let x = start;
    if (x + width > limit) x = Math.max(s.px1, limit - width);
    out.push({ id: s.id, x, width });
  });
  return out;
}
