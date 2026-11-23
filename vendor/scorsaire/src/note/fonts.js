/*
 * The chord font (Barlow Condensed, SIL OFL) travels INSIDE the bundle (`__NOTE_FONTS__` is the @font-face CSS with the woff2 files in base64, filled by tools/build-note.mjs).
 * A @font-face written inside a shadow root is ignored by browsers, so it is added ONCE to the page's <head>; the score's SVG text then finds the font by name.
 */
let done = false;
export function ensureNoteFonts() {
  if (done || typeof document === 'undefined' || typeof __NOTE_FONTS__ === 'undefined') return;
  done = true;
  if (document.querySelector('style[data-scorsaire-note-fonts]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-scorsaire-note-fonts', '');
  style.textContent = __NOTE_FONTS__;
  document.head.append(style);
}
