/*
 * Rehearsal marks (A, B, C… / 1, 2…): framed text above the top staff of each system.
 * Port of `TLayout::layoutRehearsalMark` and the styles `rehearsalMark*` (MuseScore 4.7.5): bold 14 pt text centred on the barline that opens
 * the measure (at the start of a system: just after the header), square frame with 0.5 sp padding and 0.16 sp line, baseline 2 sp above the
 * top line, then pushed above everything it overlaps horizontally by `rehearsalMarkMinDistance` (0.5 sp).
 * Approximations: text width (0.62 × size per character for bold capitals; Edwin is absent), boxes of drawn elements (no continuous skyline).
 * Coordinates: top staff, y UP, 0 = bottom line.
 */
import { PID, getProperty } from '../model/index.js';
import { barlineFootprint } from './barlines.js';
import { BARLINE_THIN_W, BARLINE_THICK_W } from './constants.js';
import { rectsOf } from './bounds.js';

const PT = (1.75 * 72) / 25.4; // points per staff space
const SIZE = 14 / PT; // rehearsalMarkFontSize
const PAD = 0.5; // rehearsalMarkFramePadding
const FRAME = 0.16; // rehearsalMarkFrameWidth
const REST_ABOVE = 2; // rehearsalMarkPosAbove (0, −2): baseline 2 sp above the top line
const MIN_DISTANCE = 0.5; // rehearsalMarkMinDistance
const CHAR_WIDTH = 0.62;
const CAP = 0.72; // capital height / size
const DESCENT = 0.2;

/** Display items of the rehearsal marks of `sys` (text + 4 frame lines each). `headerEnd` = x just after clef / key / time signature. */
export function rehearsalItems(movement, sys, topLineY, existing, glyphs, headerEnd) {
  const ids = movement.masterbars.map((b) => b.id);
  const byMi = new Map(sys.measures.map((m) => [m.mi, m]));
  const pool = rectsOf(existing, glyphs);
  pool.push({ x1: -Infinity, x2: Infinity, y1: topLineY - 1, y2: topLineY + 0.05 });
  const out = [];
  for (const mark of movement.rehearsalMarks ?? []) {
    const mi = ids.indexOf(getProperty(mark, PID.MEASURE_ID));
    const m = byMi.get(mi);
    const text = getProperty(mark, PID.TEXT);
    if (!m || !text) continue;
    let cx;
    if (mi === sys.first) {
      const startRepeat = getProperty(movement.masterbars[mi], PID.REPEAT_START);
      cx = startRepeat ? BARLINE_THICK_W / 2 : headerEnd;
    } else {
      const prev = byMi.get(mi - 1);
      cx = prev ? prev.barX + barlineFootprint(prev.endType) / 2 : m.start;
    }
    const w = CHAR_WIDTH * SIZE * [...text].length;
    const x1 = cx - w / 2 - PAD; const x2 = cx + w / 2 + PAD;
    const bottomRel = -DESCENT * SIZE - PAD; const topRel = CAP * SIZE + PAD; // relative to the baseline
    let base = topLineY + REST_ABOVE;
    for (const r of pool) if (r.x2 > x1 && r.x1 < x2) base = Math.max(base, r.y2 + MIN_DISTANCE - bottomRel);
    const yb = base + bottomRel; const yt = base + topRel;
    const common = { role: 'rehearsal', ref: mark.id, color: undefined };
    out.push({ kind: 'text', text, x: cx, y: base, size: SIZE, anchor: 'middle', bold: true, role: 'rehearsal-text', ref: mark.id });
    out.push({ kind: 'line', x1, y1: yb, x2, y2: yb, width: FRAME, ...common }, { kind: 'line', x1, y1: yt, x2, y2: yt, width: FRAME, ...common },
      { kind: 'line', x1, y1: yb - FRAME / 2, x2: x1, y2: yt + FRAME / 2, width: FRAME, ...common }, { kind: 'line', x1: x2, y1: yb - FRAME / 2, x2, y2: yt + FRAME / 2, width: FRAME, ...common });
    pool.push({ x1, x2, y1: yb, y2: yt });
  }
  return out;
}
