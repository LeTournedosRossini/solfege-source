/*
 * Display type of this device (decision of Jean, 2026-11-07): « Auto » follows the screen; « Phone » and « Tablet » force the layout. A low-resolution tablet (a 5:3 screen of about
 * 600 CSS pixels) is taken for a phone in Auto. The choice is kept on the device (never in the Document); `ui/device-class.js` applies it (`isPhone()`, the `data-phone` attribute of the
 * root). A first version told the browser a wider page through the viewport tag: it did nothing on some browsers and could leave the page zoomed, so the rules now read the choice.
 */
import { setDisplayType, watchDevice } from './device-class.js';

export const DISPLAY_MODES = Object.freeze(['auto', 'phone', 'tablet']);
export const DISPLAY_MODE_KEY = 'scorsaire.displayMode';

export function readDisplayMode(storage) {
  try { const v = storage?.getItem(DISPLAY_MODE_KEY); return DISPLAY_MODES.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}
export function saveDisplayMode(storage, choice) {
  try { if (choice === 'auto') storage?.removeItem(DISPLAY_MODE_KEY); else storage?.setItem(DISPLAY_MODE_KEY, choice); } catch { /* optional */ }
}

/** Applies the stored choice; returns { choice(), set(next) } (the new choice is applied at once and kept). */
export function applyDisplayMode({ storage = null } = {}) {
  let choice = readDisplayMode(storage);
  setDisplayType(choice);
  watchDevice();
  return { choice: () => choice, set(next) { if (!DISPLAY_MODES.includes(next)) return; choice = next; saveDisplayMode(storage, next); setDisplayType(next); } };
}
