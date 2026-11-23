/*
 * The options of the keyboard entry on a tablature, as the person sees them: what is stored (`inputOptions`, a device preference) or, when nothing is stored yet, the default of the device.
 * On a computer (a fine pointer) the digits write frets from the start and the keys are Guitar Pro's (12/11/2026, decision of Jean: the usual way to type a tablature); anywhere else
 * (a touch screen: no keyboard to type on) the frets from the keyboard stay off, as before. A choice made in the settings is stored and always wins.
 */
export const DEFAULT_TAB_KEY_STYLE = 'guitarpro';

/** True on a device used with a mouse (a fine pointer); false without `matchMedia` (tests, a server). */
export const hasFinePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

/** { tabKeyboard, tabKeyStyle } in force: the stored values, else the defaults of the device. `fine` overrides the device test (tests). */
export function inputOptionsOf(preferences, { fine = hasFinePointer() } = {}) {
  const stored = preferences?.get?.('inputOptions');
  return { tabKeyboard: typeof stored?.tabKeyboard === 'boolean' ? stored.tabKeyboard : fine, tabKeyStyle: stored?.tabKeyStyle ?? DEFAULT_TAB_KEY_STYLE };
}
