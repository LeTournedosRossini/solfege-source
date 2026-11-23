/*
 * Sections of the form on the score (screen 1): a very light coloured band behind the staves of each system for each section that crosses it
 * (only a suggestion: strength and on / off are settings). The names are NOT written on the score: the segments of each system are exposed
 * (non-enumerable `system.sections`) for the floating "where am I" card of the interface.
 * Coordinates: system, y DOWN.
 */
import { sectionSpans } from '../model/sections.js';
import { barlineFootprint } from './barlines.js';
import { textWidth } from './textwidth.js';


/**
 * Segments of the sections in one system: [{ id, label, category, color, x1, x2, first, last, continues, begins }] (x in system coordinates).
 * `continues`: the section began in an earlier system; `begins`: its first measure is in this system.
 */
export function sectionSegments(movement, sys) {
  const spans = sectionSpans(movement);
  if (!spans.length || !sys.measures?.length) return [];
  const out = [];
  let current = null;
  sys.measures.forEach((m, k) => {
    const span = spans.find((s) => m.mi >= s.from && m.mi <= s.to);
    const startX = k === 0 ? 0 : (() => { const p = sys.measures[k - 1]; return p.barX + barlineFootprint(p.endType) / 2; })();
    const endX = k === sys.measures.length - 1 ? m.barX + barlineFootprint(m.endType) : m.barX + barlineFootprint(m.endType) / 2;
    if (!span) { current = null; return; }
    if (current && current.id === span.id) { current.x2 = endX; current.last = m.mi; return; }
    current = {
      id: span.id, label: span.label, category: span.category, color: span.color, x1: startX, x2: endX, first: m.mi, last: m.mi,
      continues: span.from < m.mi, begins: span.from === m.mi,
    };
    out.push(current);
  });
  return out;
}

/**
 * The cards of the display tags of a chord staff (screen 1 only) that START in this system, as segments for `sectionCardItems`: [{ label, color, x1, x2, continues: false }].
 * The text is short and the same in every language: « orig. », « capo », « −2 ».
 */
export function chordViewSegments(tags, sys) {
  const out = [];
  if (!tags.length || !sys.measures?.length) return out;
  sys.measures.forEach((m, k) => {
    const tag = tags.find((tg) => tg.index === m.mi); if (!tag) return;
    const startX = k === 0 ? 4 : (() => { const p = sys.measures[k - 1]; return p.barX + barlineFootprint(p.endType) / 2; })(); // (the first one clears the staff button of screen 1)
    const label = tag.mode === 'capo' ? 'capo' : tag.mode === 'original' ? 'orig.' : `${tag.shift > 0 ? '+' : tag.shift < 0 ? '−' : ''}${Math.abs(tag.shift)}`;
    out.push({ id: tag.id, label, color: '#f0e3b8', x1: startX, x2: startX + 3, continues: false, first: m.mi, last: m.mi });
  });
  return out;
}

/** The segments whose section BEGINS in this system: a name card is written only there (not again at the start of each following system, where it only gets in the way). */
export const startingSegments = (segs) => segs.filter((sg) => !sg.continues);

export const SECTION_STRIP_HEIGHT = 1.5; // sp: the strip above everything on the top staff where the interface puts the name cards

/**
 * A card whose start lies just inside the END of a volta (by `max` staff spaces at most) is moved right, past it: it then stands clear of the volta instead of half over it.
 * `rects` = the boxes of the voltas. Returns `{ x, y1 }`: the new x (the same when nothing is in the way) and, when a volta was passed or just ends before the card, the y of the BOTTOM of that volta: the card, no longer
 * under it, comes down to that level (its bottom level = the bottom level of the volta just before it), never lower than what lies under it.
 * The gap is larger than the margin `highestUnder` keeps around a box, so the volta no longer counts as lying under the card once it is passed.
 */
export function nudgePastVolta(x, rects, { max = 1, gap = 0.5, near = 0.6 } = {}) {
  for (const r of rects) if (r.x1 < x && r.x2 > x && r.x2 - x <= max) return { x: r.x2 + gap, y1: r.y1 }; // starts just inside the end of a volta: past it
  for (const r of rects) if (r.x1 < x && r.x2 <= x && x - r.x2 <= near) return { x, y1: r.y1 }; // starts right after a volta: it stays, at the bottom level of that volta
  return { x, y1: null };
}

/** y2 of the highest rect that lies under the horizontal range [x1, x2] (-Infinity when there is none). */
export function highestUnder(rects, x1, x2, { left = -0.1, right = 0.4 } = {}) {
  // (the start of a card is exact: a box that ends before it does not lie under it; its end is only an estimate: a margin keeps clear of what comes after)
  let y = -Infinity;
  for (const r of rects) if (r.x2 > x1 - left && r.x1 < x2 + right) y = Math.max(y, r.y2);
  return y;
}

// The name cards of the interface are DOM elements (a dot, the name in 11.5 px bold, padding, border): the layout cannot measure them, so it estimates their width in staff spaces for
// a SMALL staff space (7 px): a smaller space makes a wider card, so the estimate errs on the safe side.
const STRIP_REF_SS = 7;
export const stripCardWidth = (label) => (textWidth(label, 11.5, { bold: true }) + 7 + 5 + 14 + 4) / STRIP_REF_SS;

/**
 * The rooms kept for the name cards of the interface above the top staff, as invisible items (role `section-space`, `ref` = the id of the section).
 * `low` false: one room across the whole width, above everything (`top` = highest y used). `low` true: one room per card, as LOW as possible (just above what lies under the width of
 * that card: a volta, a mark…), so a card that no volta stands under sits next to the volta instead of above it. `rects` = what the top staff carries.
 */
export function sectionStripSpaces(segs, rects, { top, width, low, scale = 1, voltas = [] }) {
  if (!low) return [sectionStripSpace(top + 0.15, width)];
  return segs.map((sg, i) => {
    const next = segs[i + 1];
    const nudged = nudgePastVolta(sg.x1, voltas); const x = nudged.x; // (a start just inside the end of a volta: a little to the right, then down to the bottom of that volta)
    const w = Math.max(1, Math.min(stripCardWidth(sg.label ?? '') * scale, next ? next.x1 - x : Infinity)); // a card is clipped at the next one
    const lift = highestUnder(rects, x, x + w);
    return { kind: 'rect', x, y: Math.max((Number.isFinite(lift) ? lift : top) + 0.15, nudged.y1 ?? -Infinity), w, h: SECTION_STRIP_HEIGHT, fill: 'none', role: 'section-space', ref: sg.id };
  }).map((it) => ({ ...it, h: it.h * scale }));
}

/** The invisible item that keeps the name-card strip clear of the objects above the top staff (staff coordinates, y UP). `top` = highest y already used. */
export function sectionStripSpace(top, width) {
  return { kind: 'rect', x: 0, y: top, w: Math.max(width, 1), h: SECTION_STRIP_HEIGHT, fill: 'none', role: 'section-space' };
}

/**
 * Overlays of a system: the coloured bands (behind everything), only as a suggestion — the strength comes from the style (`SECTION_COLOR_STRENGTH`).
 * The NAME of a part is not drawn on the score: the name cards of the interface (sections-strip.js) sit in the strip reserved above the staves. `topY` / `bottomY`: system y (down).
 */
export function sectionOverlays(segments, { topY, bottomY, strength = 0.22 }) {
  return segments.map((s) => ({
    kind: 'rect', x: s.x1, y: topY, w: Math.max(0, s.x2 - s.x1), h: Math.max(0, bottomY - topY), fill: s.color, opacity: strength, role: 'section-band',
  }));
}
