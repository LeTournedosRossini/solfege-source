/*
 * Presentation of a secondary panel (no DOM): a sheet that slides up from the bottom of the screen on phones and tablets,
 * a floating window on desktop computers (decision of Jean, 2026-10-14).
 *
 * "Phone or tablet" = the main pointer is coarse (a finger), or the window is narrow. Reading `matchMedia` is left to the caller
 * (the only part that touches the browser), so this rule can be tested under Node.
 */
export const SHEET_MAX_WIDTH = 900; // CSS px: at or below this width the panel is a sheet, whatever the pointer

/** The media query string the caller should watch (its result feeds `panelMode`). */
export const SHEET_QUERY = `(pointer: coarse), (max-width: ${SHEET_MAX_WIDTH}px)`;

/** 'sheet' (bottom sheet) or 'floating' (window). `matchesSheetQuery` = result of `matchMedia(SHEET_QUERY).matches`. */
export function panelMode(matchesSheetQuery) {
  return matchesSheetQuery ? 'sheet' : 'floating';
}

/** Position of a floating window kept inside the viewport: { left, top } clamped so that the window stays reachable. */
export function clampWindow({ left, top, width, height, viewportWidth, viewportHeight, margin = 8 }) {
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  return { left: Math.min(Math.max(left, margin), maxLeft), top: Math.min(Math.max(top, margin), maxTop) };
}
