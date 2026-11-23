/*
 * The mark that follows the pointer while notes are entered with the mouse (computers): where the note would go, drawn as the note itself.
 *   ledgerLines(line, lineCount)  → the ledger lines the note needs, as positions in HALF-SPACES from the top line (0 = top line, 2 = the next one…; negative above the
 *                                   staff, above `2 × (lineCount − 1)` below it), nearest to the staff first
 *   previewShape({ base, dots, line, lineCount }) → what to draw: { head (glyph), stem: { up } | null, flag (glyph) | null, dots }
 * PURE (no DOM): the geometry is `staff-hit.js` (`line`, `lineCount`), the glyphs are Bravura's.
 */

/** Ledger lines of a note at `line` (half-spaces from the top line) on a staff of `lineCount` lines. A note in a space only needs the lines it has crossed. */
export function ledgerLines(line, lineCount) {
  if (!Number.isInteger(line) || !(lineCount >= 1)) return [];
  const bottom = 2 * (lineCount - 1);
  const out = [];
  if (line < 0) for (let e = -2; e >= Math.ceil(line / 2) * 2; e -= 2) out.push(e);
  else if (line > bottom) for (let e = bottom + 2; e <= Math.floor(line / 2) * 2; e += 2) out.push(e);
  return out;
}

const HEADS = { breve: 'noteheadDoubleWhole', whole: 'noteheadWhole', half: 'noteheadHalf' };
const FLAGS = { eighth: 'flag8th', sixteenth: 'flag16th', thirtysecond: 'flag32nd', sixtyfourth: 'flag32nd' }; // (the subset of Bravura has no 64th flag: the 32nd one stands for it)
const NO_STEM = new Set(['breve', 'whole']);

/** Stem direction: notes on or above the middle line have it down, the others up. */
export const stemIsUp = (line, lineCount) => line > lineCount - 1;

export function previewShape({ base, dots = 0, line, lineCount }) {
  const stem = NO_STEM.has(base) ? null : { up: stemIsUp(line, lineCount) };
  const flag = stem && FLAGS[base] ? `${FLAGS[base]}${stem.up ? 'Up' : 'Down'}` : null;
  return { head: HEADS[base] ?? 'noteheadBlack', stem, flag, dots: Math.max(0, Math.min(3, dots | 0)) };
}
