/*
 * The look of the whole page: light, dark (the crisp dark one, after the Luminare mock-up), or the one of the system. A DEVICE setting (never in the document): `data-theme="light|dark"` on <html>
 * (`data-dark` too for the dark one) read by the palette in static/index.html (CSS variables); the colours chosen by the user in the settings are applied on top of it.
 */
export const THEME_KEY = 'scorsaire.theme';
/** `hc` = the high-contrast theme (black, white and yellow, after the logo; WCAG 2.2 AAA contrast, see CLAUDE.md). */
export const THEME_CHOICES = Object.freeze(['system', 'light', 'dark', 'hc']);

/** `luminare` (the name the crisp dark theme had while it was tried next to the first dark one) is the dark theme now. */
export const readTheme = (storage) => { try { const v = storage?.getItem(THEME_KEY); return THEME_CHOICES.includes(v) ? v : v === 'luminare' ? 'dark' : 'system'; } catch { return 'system'; } };
/** The theme shown for a preference: `system` follows the operating system (dark, and « more contrast » = the high-contrast theme). */
export const resolveTheme = (pref, systemDark, systemMoreContrast = false) => (pref === 'dark' || pref === 'light' || pref === 'hc' ? pref : systemMoreContrast ? 'hc' : systemDark ? 'dark' : 'light');

/** Applies the saved preference at once and keeps following the system while it is `system`; returns { get, set }. `data-dark` is set for the dark and the high-contrast themes, `data-hc` for the latter. */
export function applyTheme(storage, root = typeof document !== 'undefined' ? document.documentElement : null, mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null, mqContrast = typeof matchMedia === 'function' ? matchMedia('(prefers-contrast: more)') : null) {
  let pref = readTheme(storage);
  const paint = () => {
    if (!root) return;
    const t = resolveTheme(pref, !!mq?.matches, !!mqContrast?.matches);
    root.setAttribute('data-theme', t);
    if (t === 'light') root.removeAttribute('data-dark'); else root.setAttribute('data-dark', '');
    if (t === 'hc') root.setAttribute('data-hc', ''); else root.removeAttribute('data-hc');
    root.style.colorScheme = t === 'light' ? 'light' : 'dark';
  };
  for (const m of [mq, mqContrast]) m?.addEventListener?.('change', () => { if (pref === 'system') paint(); });
  paint();
  return {
    get: () => pref,
    set(v) { if (!THEME_CHOICES.includes(v)) return; pref = v; try { storage?.setItem(THEME_KEY, v); } catch { /* storage may be refused */ } paint(); },
  };
}

/** How strong the staff lines are drawn (a DEVICE setting, any theme): `auto` = what the theme says, else a fixed opacity; CSS variable on the root. */
export const STAFF_KEY = 'scorsaire.staffLines';
export const STAFF_LEVELS = Object.freeze({ auto: null, full: 1, soft: 0.7, softer: 0.5, faint: 0.35 });
export const STAFF_CHOICES = Object.freeze(Object.keys(STAFF_LEVELS));
export function applyStaffLines(storage, root = typeof document !== 'undefined' ? document.documentElement : null) {
  const read = () => { try { const v = storage?.getItem(STAFF_KEY); return STAFF_CHOICES.includes(v) ? v : 'auto'; } catch { return 'auto'; } };
  let level = read();
  const paint = () => { const o = STAFF_LEVELS[level]; if (!root) return; if (o == null) root.style.removeProperty('--staff-line-opacity'); else root.style.setProperty('--staff-line-opacity', String(o)); };
  paint();
  return {
    get: () => level,
    set(v) { if (!STAFF_CHOICES.includes(v)) return; level = v; try { storage?.setItem(STAFF_KEY, v); } catch { /* storage may be refused */ } paint(); },
  };
}

/** Light theme: the same setting for its own text, `leaner` (very light) by default (`data-lean-light`). */
export const LIGHT_LEAN = Object.freeze({ key: 'scorsaire.lightText', attr: 'data-lean-light', fallback: 'leaner' });
/** Lighter text on the dark themes (a DEVICE setting): bold becomes semi-bold, semi-bold medium; `leaner` goes one step further, `lightest` one more (variable font: 450 / 350 / 300). `data-lean` on the root, read by static/index.html. */
export const LEAN_KEY = 'scorsaire.darkText';
export const LEAN_CHOICES = Object.freeze(['lean', 'leaner', 'lightest', 'normal']);
export function applyLean(storage, root = typeof document !== 'undefined' ? document.documentElement : null, { key = LEAN_KEY, attr = 'data-lean', fallback = 'lean' } = {}) {
  const read = () => { try { const v = storage?.getItem(key); return LEAN_CHOICES.includes(v) ? v : fallback; } catch { return fallback; } };
  let level = read();
  const paint = () => { if (!root) return; if (level === 'normal') root.removeAttribute(attr); else root.setAttribute(attr, level === 'lightest' ? '3' : level === 'leaner' ? '2' : '1'); };
  paint();
  return {
    get: () => level,
    set(v) { if (!LEAN_CHOICES.includes(v)) return; level = v; try { storage?.setItem(key, v); } catch { /* storage may be refused */ } paint(); },
  };
}

/**
 * Thinner music symbols (Bravura: clefs, time signatures, notes…), a DEVICE setting for any theme. The glyphs are filled shapes, so they are thinned by
 * painting a thin line in the colour of the page over their outline (CSS in static/index.html, proportional to the glyph size); `data-glyph-fine` on the root.
 */
/* thinner by default (`finer`); `normal` is kept as a choice */
export const GLYPH_KEY = 'scorsaire.glyphWeight';
export const GLYPH_CHOICES = Object.freeze(['normal', 'fine', 'finer']);
export function applyGlyphWeight(storage, root = typeof document !== 'undefined' ? document.documentElement : null) {
  const read = () => { try { const v = storage?.getItem(GLYPH_KEY); return GLYPH_CHOICES.includes(v) ? v : 'finer'; } catch { return 'finer'; } };
  let level = read();
  const paint = () => { if (!root) return; if (level === 'normal') root.removeAttribute('data-glyph-fine'); else root.setAttribute('data-glyph-fine', level === 'finer' ? '2' : '1'); };
  paint();
  return {
    get: () => level,
    set(v) { if (!GLYPH_CHOICES.includes(v)) return; level = v; try { storage?.setItem(GLYPH_KEY, v); } catch { /* storage may be refused */ } paint(); },
  };
}

/** Interface font (a DEVICE setting): Inter by default on every theme, or the system fonts (the former look). `data-ui-font="system"` on the root. */
export const FONT_KEY = 'scorsaire.uiFont';
export const FONT_CHOICES = Object.freeze(['inter', 'system']);
export function applyUiFont(storage, root = typeof document !== 'undefined' ? document.documentElement : null) {
  const read = () => { try { return storage?.getItem(FONT_KEY) === 'system' ? 'system' : 'inter'; } catch { return 'inter'; } };
  let choice = read();
  const paint = () => { if (!root) return; if (choice === 'system') root.setAttribute('data-ui-font', 'system'); else root.removeAttribute('data-ui-font'); };
  paint();
  return {
    get: () => choice,
    set(v) { if (!FONT_CHOICES.includes(v)) return; choice = v; try { storage?.setItem(FONT_KEY, v); } catch { /* storage may be refused */ } paint(); },
  };
}

/** Contrast of the text and the lines, 4 levels (1 soft, 2 normal, 3 strong, 4 maximal) on the light and the dark theme: `data-contrast` on the root, read by static/index.html. */
export const CONTRAST_KEY = 'scorsaire.contrast';
export const CONTRAST_LEVELS = Object.freeze([1, 2, 3, 4]);
export function applyContrast(storage, root = typeof document !== 'undefined' ? document.documentElement : null) {
  const read = () => { try { const n = Number(storage?.getItem(CONTRAST_KEY)); return CONTRAST_LEVELS.includes(n) ? n : 2; } catch { return 2; } };
  let level = read();
  const paint = () => { if (!root) return; if (level === 2) root.removeAttribute('data-contrast'); else root.setAttribute('data-contrast', String(level)); };
  paint();
  return {
    get: () => level,
    set(v) { const n = Number(v); if (!CONTRAST_LEVELS.includes(n)) return; level = n; try { storage?.setItem(CONTRAST_KEY, String(n)); } catch { /* storage may be refused */ } paint(); },
  };
}
