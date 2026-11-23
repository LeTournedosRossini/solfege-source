/*
 * Header variants of a system: the clef, key signature and time signature IN FORCE at the start of each measure where one of them changes.
 * A wrapped system draws the one in force at its first measure; the sticky header of the scrolling view (one system, scrolled sideways) needs the
 * one of the measure that is under it. Same drawing code and same x as the real header; items in staff coordinates (y UP), one list per staff.
 * Result: [{ mi, width (sp, to the right of the last glyph + a gap), staves: [items…] }], in measure order; the first is the real header.
 */
import { headerSpec } from './systems.js';
import { glyphItem, keySigItems, timeSigItems } from './header.js';
import { SID, PID, getProperty } from '../model/index.js';

export function buildHeaderVariants(ctx, sys, allColumns) {
  const { glyphs, style } = ctx;
  const variants = [];
  let previous = null;
  for (const m of sys.measures) {
    const signature = JSON.stringify([
      ctx.staves.map((s) => [s.ctx.clefAtMeasureStart ? s.ctx.clefAtMeasureStart(m.mi) : null, s.ctx.keySigs[m.mi]]),
      getProperty(ctx.movement.masterbars[m.mi], PID.TIME_SIG), getProperty(ctx.movement.masterbars[m.mi], PID.TIME_SIG_STYLE),
    ]);
    if (signature === previous) continue;
    previous = signature;
    const h = headerSpec(ctx, m.mi, true, allColumns[m.mi], 1);
    const staves = ctx.staves.map((sref, si) => {
      const { painter, staff } = sref;
      const items = [];
      const letters = h.lettersW > 0 && painter.stringLetters ? painter.stringLetters(staff, sref.ctx, { barline: ctx.staves.length > 1 && Boolean(style(SID.START_BARLINE_MULTIPLE)) }) : null;
      if (letters) items.push(...letters.items(h.leftPad));
      const clef = painter.clef(staff, sref.ctx, m.mi);
      if (clef) items.push(...(clef.items ? clef.items(h.leftPad + h.lettersW, staff.id) : [glyphItem(clef.glyph, h.leftPad + h.lettersW, clef.y, { mag: clef.mag ?? 1, ref: staff.id })]));
      const ks = painter.keySig(staff, sref.ctx, m.mi);
      if (ks && h.ksW > 0) items.push(...keySigItems(glyphs, h.leftPad + h.lettersW + h.clefW, ks.clefKey, h.ksByStaff[si], h.ksByStaff[si]));
      const ts = painter.timeSig(staff, sref.ctx);
      if (ts && h.tsW > 0) items.push(...timeSigItems(glyphs, h.leftPad + h.lettersW + h.clefW + h.ksW, h.ts, ts.yNum, ts.yDen, h.tsStyle));
      return items;
    });
    // x (sp) of the middle of the time signature, else of the whole header: where the sticky header writes the name of a track
    const tsX = h.leftPad + h.lettersW + h.clefW + h.ksW;
    variants.push({ mi: m.mi, width: tsX + h.tsW + 0.8, center: h.tsW > 0 ? tsX + h.tsW / 2 : (tsX + h.tsW) / 2, staves });
  }
  return variants;
}
