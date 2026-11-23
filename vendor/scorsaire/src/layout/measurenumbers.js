/*
 * Measure numbers of a printed system (screen 2): a small italic number above the top staff, at the start of the measure, left aligned on the barline.
 * Port of `MeasureNumberLayout::layoutMeasureNumber` (4.7.5): baseline 2 staff spaces above the top line (`measureNumberPosAbove`), 0.25 space after the
 * barline (`minBarLineDistance`), pushed up when it would touch something already drawn there (autoplace, `measureNumberMinDistance` 0.5).
 * Which measures get a number: model/pagetext.js (`showsMeasureNumber`).
 */
import { SID } from '../model/index.js';
import { showsMeasureNumber } from '../model/pagetext.js';
import { rectsOf } from './bounds.js';
import { textWidth } from './textwidth.js';

const PT_MM = 25.4 / 72;

/**
 * @param ctx        layout context (`ctx.numbering` = { no, excluded, overrides }, `ctx.systemFirsts`, `ctx.style`)
 * @param sys        system plan (`first`, `measures` with `mi` and `barX`)
 * @param topLineY   y of the top line of the top staff (staff coordinates, y up)
 * @param existing   items already drawn on the top staff (to stay clear of them)
 * @param spaceMm    staff space of the page in mm (the size of the numbers is in points, not in staff spaces)
 */
export function measureNumberItems(ctx, sys, topLineY, existing, glyphs, spaceMm) {
  const numbering = ctx.numbering;
  if (!numbering) return [];
  const style = ctx.style;
  const opts = { mode: style(SID.MEASURE_NUMBER_MODE), interval: Math.max(1, style(SID.MEASURE_NUMBER_INTERVAL)), showOne: style(SID.MEASURE_NUMBER_SHOW_ONE) };
  const ts = ctx.textStyles?.measureNumber ?? {}; // the part's text style of the numbers (size, font, bold, italic, underline, colour)
  const size = ((ts.size ?? style(SID.MEASURE_NUMBER_SIZE)) * PT_MM) / spaceMm; // staff spaces
  // the number of the first measure of the system sits to the LEFT of the section card that begins there, on the card's line (the card moves right,
  // and so do the cards it now touches), instead of climbing above the card
  const firstNumber = sys.measures.length && showsMeasureNumber(numbering, sys.measures[0].mi, { ...opts, override: numbering.overrides.get(sys.measures[0].mi), firstInSystem: (i) => ctx.systemFirsts.has(i) })
    ? String(numbering.no[sys.measures[0].mi] + 1) : null;
  let firstBaseline = null;
  if (firstNumber !== null) {
    const nx = 0.25; const nw = firstNumber.length * size * 0.55;
    const groups = []; // [{ rect?, text }] in the order the cards were written
    for (const it of existing) {
      if (it.role === 'section-card') groups.push({ rect: it });
      else if (it.role === 'section-card-text') { const g = groups[groups.length - 1]; if (g && g.rect && !g.text) g.text = it; else groups.push({ text: it }); }
    }
    const left = (g) => (g.rect ? g.rect.x : g.text.x);
    if (groups.length && left(groups[0]) < nx + nw + 0.4) {
      let edge = nx + nw + 0.4; // where the next card may begin
      for (const g of groups) {
        const shift = Math.max(0, edge - left(g));
        if (shift) { if (g.rect) g.rect.x += shift; g.text.x += shift; }
        edge = (g.rect ? g.rect.x + g.rect.w : g.text.x + textWidth(g.text.text, g.text.size)) + 0.3;
      }
      firstBaseline = groups[0].text.y;
    }
  }
  const rects = rectsOf(existing, glyphs);
  const out = [];
  sys.measures.forEach((m, k) => {
    const shown = showsMeasureNumber(numbering, m.mi, { ...opts, override: numbering.overrides.get(m.mi), firstInSystem: (i) => ctx.systemFirsts.has(i) });
    if (!shown) return;
    const text = String(numbering.no[m.mi] + 1);
    const x = (k === 0 ? 0 : sys.measures[k - 1].barX) + 0.25;
    const w = text.length * size * 0.55;
    let baseline = topLineY + 2;
    if (k === 0 && firstBaseline !== null) baseline = firstBaseline;
    else for (const r of rects) {
      if (r.x2 < x - 0.1 || r.x1 > x + w + 0.1) continue;
      baseline = Math.max(baseline, r.y2 + 0.5 + size * 0.2);
    }
    out.push({ kind: 'text', text, x, y: baseline, size, italic: ts.italic ?? true, ...(ts.bold ? { bold: true } : {}), ...(ts.underline ? { underline: true } : {}), ...(ts.family ? { family: ts.family } : {}), ...(ts.color ? { tint: ts.color } : {}), anchor: 'start', role: 'measure-number', sel: `mnum|${ctx.movement.masterbars[m.mi].id}` });
  });
  return out;
}
