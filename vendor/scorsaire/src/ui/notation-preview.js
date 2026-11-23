/*
 * A preview of what a groove or a chord pattern gives, written as notes: the same planner as the playback, on a throw-away work (nothing of the score is touched), drawn by the score view like the
 * "What this staff plays" window (bake-dialog.js). A groove is shown on a percussion staff, a piano pattern on its reference chord (the root and the quality are the editor's).
 */
import { createDocument } from '../model/index.js';
import { patternAuditionWork, grooveAuditionWork } from '../audio/patternaudition.js';
import { bakePreviewSvg } from './bake-dialog.js';

/** SVG text of a chord pattern played on `root` / `quality` for `bars` bars, or '' when it cannot be drawn. `o` = the options of `patternAuditionWork`. */
export function patternPreviewSvg({ glyphs, bars = 2, size = 6, ...o }) {
  try {
    const { work, movement, staff } = patternAuditionWork({ ...o, cycles: Math.max(1, Math.ceil(bars / (o.pattern.bars ?? 1))) });
    return bakePreviewSvg({ doc: createDocument(work), glyphs, staffId: staff.id, measures: { from: 0, to: Math.min(bars, movement.masterbars.length) - 1 }, width: 20 + 30 * Math.min(bars, 4), staffSpace: size, user: { patterns: [o.pattern], cards: o.cards ?? [] } });
  } catch { return ''; }
}

/** SVG text of a groove (its main version, no variation) over `bars` bars. */
export function groovePreviewSvg({ glyphs, groove, bars = 2, size = 6 }) {
  try {
    const g = { ...groove, id: groove.id || 'preview', fills: [], extras: [], variants: [] };
    const count = Math.max(1, bars) * (g.bars ?? 1);
    const { work, movement, staff, card } = grooveAuditionWork({ groove: g, variations: false, bars });
    return bakePreviewSvg({ doc: createDocument(work), glyphs, staffId: staff.id, measures: { from: 0, to: Math.min(count, movement.masterbars.length) - 1 }, width: 20 + 30 * Math.min(count, 4), staffSpace: size, user: { grooves: [g], cards: [card] } });
  } catch { return ''; }
}
