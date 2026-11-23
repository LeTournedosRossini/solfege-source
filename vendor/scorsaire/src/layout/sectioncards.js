/*
 * The cards of the sections of the form written on a staff of a printed part (like a staff text): a rounded-looking coloured card with the name,
 * above the staff where each section BEGINS (a section that began in an earlier system is not written again). Staff coordinates, y UP.
 */
import { SLOT_TEXT_SIZE } from './slots.js';
import { textWidth } from './textwidth.js';
import { nudgePastVolta } from './sections.js';


/** @param segs  sectionSegments(): [{ label, color, x1, continues }]; @param top  y of the bottom of the cards */
export function sectionCardItems(segs, top, scale = 1, place = null, style = 'card', voltas = []) { // `place(x1, x2)` → the y of the bottom of a card over that range (as low as possible); without it every card sits at `top`
  const size = SLOT_TEXT_SIZE * scale; const plain = style === 'text'; const CARD_H = size * (plain ? 1.2 : 1.5); // 'text': the name alone, no rectangle
  const out = [];
  let rightEdge = -Infinity;
  for (const sg of segs.filter((x) => !x.continues)) { // only where a part BEGINS
    const text = sg.label ?? '';
    const padL = plain ? 0.2 : size * 0.6; const padR = plain ? 0.3 : size * 0.55; // the card ends about one letter after its text
    const w = padL + textWidth(text, size) + padR;
    const nudged = nudgePastVolta(sg.x1, voltas); const x = Math.max(nudged.x, rightEdge + 0.3); // a card never overlaps the previous one; one that starts just inside the end of a volta moves past it
    const y = place ? Math.max(place(x, x + w), nudged.y1 ?? -Infinity) : top; // (past a volta: down to the bottom of that volta, never lower than what lies under the card)
    if (!plain) out.push({ kind: 'rect', role: 'section-card', x, y, w, h: CARD_H, fill: sg.color ?? '#ddd' });
    // (a plain name is a « sign »: it takes the colour of the signs when a reader colours them)
    out.push({ kind: 'text', text, x: x + padL, y: y + CARD_H * (plain ? 0.2 : 0.28), size, anchor: 'start', role: 'section-card-text', ...(plain ? { sign: true, weight: 600 } : {}) });
    rightEdge = x + w;
  }
  return out;
}
