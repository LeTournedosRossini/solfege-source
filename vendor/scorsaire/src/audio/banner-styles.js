// The LIBRARY of named looks for the cards and annotations of the banner: the producer's own styles (a preference of the editor, exported with the others),
// not part of any file. A file carries a copy of the styles it uses (see audio/banner.js). PURE.
import { styleProblems, pickStyle, LOOK_KEYS } from './banner.js';

export const MAX_STYLES = 60;
let counter = 0;

export function validateBoxStyleList(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return ['boxStyles: { items: [] } expected'];
  if (v.items.length > MAX_STYLES) return [`boxStyles: at most ${MAX_STYLES} styles`];
  const ids = new Set(); const out = [];
  for (const s of v.items) { out.push(...styleProblems(s)); if (ids.has(s?.id)) out.push(`${s?.id}: duplicate id`); ids.add(s?.id); }
  return out;
}

/** The styles of the library as a list; `lib` = { items } or null. */
export const libraryStyles = (lib) => (Array.isArray(lib?.items) ? lib.items : []);

/** A new style named `name` taking the look values given (only the LOOK_KEYS are kept). Returns the new library and the style. */
export function addStyle(lib, name, look) {
  const items = libraryStyles(lib); let id;
  do { counter += 1; id = `bs${Date.now().toString(36)}${counter}`; } while (items.some((s) => s.id === id));
  const style = pickStyle({ id, name: String(name).trim().slice(0, 40) || id, ...Object.fromEntries(LOOK_KEYS.filter((k) => look?.[k] != null).map((k) => [k, look[k]])) });
  return { lib: { items: [...items, style] }, style };
}
/** Replaces the look of the style `id` (the name stays unless given). */
export const updateStyle = (lib, id, look, name = null) => ({ items: libraryStyles(lib).map((s) => (s.id === id ? pickStyle({ id, name: name ?? s.name, ...Object.fromEntries(LOOK_KEYS.filter((k) => look?.[k] != null).map((k) => [k, look[k]])) }) : s)) });
export const removeStyle = (lib, id) => ({ items: libraryStyles(lib).filter((s) => s.id !== id) });
