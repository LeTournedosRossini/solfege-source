/*
 * « Is this a phone? » in ONE place (decision of Jean, 2026-11-07). The interface lays itself out for a phone (≤ 600 CSS pixels wide: a bottom sheet for the note entry, the staff
 * size in the settings, the piano button in the entry bar…) and for a tablet or a computer otherwise. A small, low-resolution tablet (a 5:3 screen of about 600 px) is taken for a phone;
 * the display type of the settings (`phone` / `tablet`) overrides what the width says, on this device. The root element carries `data-phone` when the phone layout is on, so
 * the style rules can read it (`html[data-phone] …`); the scripts call `isPhone()`. A change is announced to the page by a `resize` event, which every layout already listens to.
 */
export const PHONE_MAX_WIDTH = 600;
let forced = 'auto'; // 'auto' | 'phone' | 'tablet'

/** True when the phone layout applies: forced by the display type, else the width of the page. */
export const isPhone = () => (forced === 'phone' ? true : forced === 'tablet' ? false : typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX_WIDTH);

/** The display type in use ('auto' | 'phone' | 'tablet'). */
export const forcedDisplay = () => forced;

const paint = () => { if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-phone', isPhone()); };

/** Sets the display type and updates the page at once (the attribute for the styles, then a `resize` so that the layouts redo themselves). */
export function setDisplayType(next) {
  forced = next === 'phone' || next === 'tablet' ? next : 'auto';
  paint();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
}

/** Starts following the width of the page (for 'auto'); call once at start-up after `setDisplayType`. */
export function watchDevice() {
  paint();
  if (typeof window !== 'undefined') window.addEventListener('resize', paint);
}
