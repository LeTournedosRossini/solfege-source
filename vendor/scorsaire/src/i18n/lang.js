/*
 * Interface language preference (per device, never stored in the Document, no undo).
 *   auto → the first language of the browser's preference list that Scorsaire has a catalog for
 *          (primary subtag only: "fr-CA" → "fr"); otherwise the fallback language (DEFAULT_LANG)
 *   fr / en → the language chosen explicitly
 * Reading the browser (navigator, localStorage) is left to the caller; everything here is pure and testable.
 */
export const LANG_KEY = 'scorsaire.lang';
export const LANG_CHOICES = Object.freeze(['auto', 'fr', 'en']);

/** First supported language in a browser preference list (e.g. navigator.languages), or null. */
export function detectLanguage(preferred, supported) {
  const list = Array.isArray(preferred) ? preferred : (typeof preferred === 'string' ? [preferred] : []);
  for (const tag of list) {
    if (typeof tag !== 'string') continue;
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (supported.includes(primary)) return primary;
  }
  return null;
}

/** Language actually used: explicit choice, else detected, else fallback. */
export function resolveLanguage({ choice = 'auto', preferred = [], supported, fallback }) {
  if (choice !== 'auto' && supported.includes(choice)) return choice;
  return detectLanguage(preferred, supported) ?? fallback;
}

export function readLangChoice(storage) {
  try { const v = storage?.getItem(LANG_KEY); return LANG_CHOICES.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}
export function saveLangChoice(storage, choice) {
  try { if (choice === 'auto') storage?.removeItem(LANG_KEY); else storage?.setItem(LANG_KEY, choice); } catch { /* optional */ }
}
