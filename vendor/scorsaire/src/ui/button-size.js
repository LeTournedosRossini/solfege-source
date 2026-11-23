/*
 * Control size (decision of Jean, 2026-10-15). One global CSS variable `--ui-target` drives the minimum size of every button and input
 * that appears over the score. The choice is per device (kept in the browser, never in the Document, no undo).
 *   auto   → follows the device: finger on a small screen 44 px, finger on a large screen 37 px, mouse 30 px
 *   small 30 px · medium 37 px (decision of 2026-11-04: 30, 37 and 44) · large 44 px
 * Reading the browser (matchMedia, localStorage) is left to the caller `applyButtonSize`; `targetSize` is pure and testable.
 */
import { isPhone } from './device-class.js';
export const BUTTON_SIZES = Object.freeze({ small: 30, medium: 37, large: 44 });
export const BUTTON_SIZE_CHOICES = Object.freeze(['auto', 'small', 'medium', 'large']);
export const BUTTON_SIZE_KEY = 'scorsaire.buttonSize';
export const PHONE_MAX_WIDTH = 600;
/** Without a stored choice: 30 px with a mouse (decision of Jean, 2026-10-16), and 44 px on a touch device (decision of 2026-11-04: a finger needs it; the choice below is per device and
 * kept, so a small, low-resolution tablet can go back to « Petit »). 'auto' stays available and is stored explicitly. */
export const DEFAULT_CHOICE = 'small';
export const TOUCH_DEFAULT_CHOICE = 'large';
export const defaultChoice = (env = {}) => (env.coarsePointer ? TOUCH_DEFAULT_CHOICE : DEFAULT_CHOICE);

/** Size in CSS px for a choice. env = { coarsePointer: boolean, width: number } (only used by 'auto'). */
export function targetSize(choice, env = {}) {
  if (Object.hasOwn(BUTTON_SIZES, choice)) return BUTTON_SIZES[choice];
  if (!env.coarsePointer) return BUTTON_SIZES.small;
  return (env.phone ?? env.width <= PHONE_MAX_WIDTH) ? BUTTON_SIZES.large : BUTTON_SIZES.medium; // `phone`: the display type of the device (ui/device-class.js) when it is given
}

export function readChoice(storage, env = {}) {
  const fallback = defaultChoice(env);
  try { const v = storage?.getItem(BUTTON_SIZE_KEY); return BUTTON_SIZE_CHOICES.includes(v) ? v : fallback; } catch { return fallback; }
}
export function saveChoice(storage, choice) {
  try { storage?.setItem(BUTTON_SIZE_KEY, choice); } catch { /* optional */ }
}

/** Sets `--ui-target` on the root element from the stored choice; returns { choice, set(choice), size() } and follows window resizes in 'auto'. */
export function applyButtonSize({ root = document.documentElement, storage = null, win = window } = {}) {
  const env = () => ({ coarsePointer: !!win.matchMedia?.('(pointer: coarse)').matches, width: win.innerWidth, phone: isPhone() });
  let choice = readChoice(storage, env());
  const size = () => targetSize(choice, env());
  const paint = () => root.style.setProperty('--ui-target', `${size()}px`);
  win.addEventListener('resize', () => { if (choice === 'auto') paint(); });
  paint();
  return { choice: () => choice, size, set(next) { if (!BUTTON_SIZE_CHOICES.includes(next)) return; choice = next; saveChoice(storage, next); paint(); } };
}
