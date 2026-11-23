/*
 * The controls of the system dividers (model/dividers.js), as DATA: both screens (the part settings of screen 2, the sheet settings of screen 3) draw the same rows with their
 * own widgets. Each side has its switch; once on, its symbol, size, offsets and alignment follow.
 */
import { DIVIDER_SYMBOLS, DIVIDER_OFFSET_MAX, DIVIDER_SIZE_MIN, DIVIDER_SIZE_MAX } from '../model/dividers.js';

/** Rows for the settings `s` (resolved): [{ key, kind: 'bool' | 'choice' | 'number', title, ... }]. */
export function dividerRows(s) {
  const rows = [];
  for (const side of ['left', 'right']) {
    rows.push({ key: side, kind: 'bool', title: `dividers.${side}`, value: s[side] });
    if (!s[side]) continue;
    rows.push({ key: `${side}Sym`, kind: 'choice', title: 'dividers.sym', value: s[`${side}Sym`], options: DIVIDER_SYMBOLS.map((v) => [v, `dividers.sym.${v}`]) });
    rows.push({ key: `${side}Size`, kind: 'number', title: 'dividers.size', value: s[`${side}Size`], min: DIVIDER_SIZE_MIN, max: DIVIDER_SIZE_MAX, step: 0.25, format: (v) => `${Math.round(v * 100)} %` });
    rows.push({ key: `${side}X`, kind: 'number', title: 'dividers.x', value: s[`${side}X`], min: -DIVIDER_OFFSET_MAX, max: DIVIDER_OFFSET_MAX, step: 0.5, format: (v) => `${v}` });
    rows.push({ key: `${side}Y`, kind: 'number', title: 'dividers.y', value: s[`${side}Y`], min: -DIVIDER_OFFSET_MAX, max: DIVIDER_OFFSET_MAX, step: 0.5, format: (v) => `${v}` });
    rows.push({ key: `${side}Align`, kind: 'bool', title: 'dividers.align', value: s[`${side}Align`] });
  }
  return rows;
}
