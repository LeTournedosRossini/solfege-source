/*
 * The card numbers of the movements of a work (DISPLAY only; read only, so a reader can use them): automatic = rank in the work formatted by `PID.CARD_NUMBER_FORMAT`,
 * forced by hand = any short text. Used by the editing module `movementedit.js` (which re-exports them) and by the readers.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

/** `{n}` → 1, 2, 3…; `{a}` → A, B, C… (AA after Z). Anything else is kept. A format with no placeholder gets the number appended. */
export function formatCardNumber(format, rank) {
  const letters = (n) => { let s = ''; let k = n; while (k > 0) { k -= 1; s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26); } return s; };
  let f = typeof format === 'string' && format ? format : '{n}';
  if (!/\{[na]\}/.test(f)) f += '{n}';
  return f.replace(/\{n\}/g, String(rank)).replace(/\{a\}/g, letters(rank));
}

/** The card numbers shown, in storage order: `[{ id, number, forced }]`. */
export function cardNumbers(work) {
  const format = getProperty(work, PID.CARD_NUMBER_FORMAT);
  return work.movements.map((mv, i) => {
    const own = mv.props[PID.CARD_NUMBER];
    return { id: mv.id, number: own != null && own !== '' ? own : formatCardNumber(format, i + 1), forced: own != null && own !== '' };
  });
}
