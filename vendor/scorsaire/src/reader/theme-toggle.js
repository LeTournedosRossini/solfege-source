/*
 * Theme switch of the exported pages (reader, synchronised reader, YouTube reader): a small round button in the top right corner that goes light, dark,
 * high contrast, light… Until the reader chooses, the page FOLLOWS THE SYSTEM (dark when it asks for dark, high contrast when it asks for more contrast, light otherwise);
 * the choice made with the button is kept on the device and wins from then on. The palettes are the ones of
 * static/index.html (copies: keep both in step).
 */
const KEY = 'scorsaire.reader.theme';
// the school portal keeps its theme under this key (same domain): clair | sombre | contraste ; absent = not chosen. It wins when present, and the button writes it too, so both agree.
export const PORTAL_THEME_KEY = 'ecole_theme_choisi';
const FROM_PORTAL = { clair: 'light', sombre: 'dark', contraste: 'hc' };
const TO_PORTAL = { light: 'clair', dark: 'sombre', hc: 'contraste' };
export const portalTheme = (storage) => { try { return FROM_PORTAL[storage?.getItem(PORTAL_THEME_KEY)] ?? null; } catch { return null; } };
const ORDER = ['light', 'dark', 'hc'];
const DARK_VARS = `--ink:#f6f5f3; --paper:#101012; --bg:#101012; --btn:#2a2b2d; --line:#34343a; --score:#101012; --side-tabs:#0e0e10; --module:#1a1a1d; --row:#242427; --bar:#1a1a1d; --btn-on:#3a3222; --btn-on-line:#caa457; --muted-ink:#5a5852; --edge:#4a4b4f; --accent:#e9cd8d; --accent-soft:#3a3222; --field:#26262a; --ink-soft:#d6d5d1; --ink-faint:#8d90a0; --soft:#202023; --track:#2e2f32; --paper-veil:rgba(19,19,19,.85); --tab-active:#e9cd8d; --primary:#caa457; --primary-ink:#14110a; --warn-soft:#3a3222; --danger-soft:#3d2424; --select:#e9cd8d; --select-edge:#caa457; --range-fill:rgba(202,164,87,.16); --range-edge:#caa457; --desk:#26262a; --field-edge:#7d7d82; --band-factor:.3; --sel-fill:rgba(202,164,87,.16); --sel-edge:#caa457; --sel-hover:transparent; --ok-soft:#3a3222; --ok-edge:#caa457; --info-ink:#e0bf72; --staff-line-opacity:.5; --danger-ink:#ff8f85; --ok-ink:#7fd19a; --warn-ink:#e3b05a;`;
const HC_VARS = `--ink:#fff; --paper:#000; --bg:#000; --btn:#000; --line:#bfbfbf; --score:#000; --side-tabs:#000; --module:#000; --row:#141414; --bar:#000; --btn-on:#3a3000; --btn-on-line:#ffd800; --muted-ink:#9a9a9a; --edge:#fff; --accent:#ffd800; --accent-soft:#3a3000; --field:#000; --ink-soft:#f0f0f0; --ink-faint:#d6d6d6; --soft:#141414; --track:#4a4a4a; --paper-veil:rgba(0,0,0,.94); --tab-active:#ffd800; --primary:#ffd800; --primary-ink:#000; --ok-soft:#003a14; --ok-edge:#7dff9a; --warn-soft:#3a2a00; --danger-soft:#4a0000; --danger-ink:#ff9a9a; --ok-ink:#7dff9a; --info-ink:#ffd800; --warn-ink:#ffc04d; --select:#ffd800; --select-edge:#fff; --range-fill:rgba(255,216,0,.22); --range-edge:#ffd800; --desk:#333; --desk-ink:#fff; --band-factor:0; --sel-fill:rgba(255,216,0,.22); --sel-edge:#ffd800; --sel-hover:rgba(255,216,0,.14); --staff-line-opacity:1;`;
const CSS = `html[data-theme="dark"] { color-scheme: dark; ${DARK_VARS} }
html[data-theme="hc"] { color-scheme: dark; ${HC_VARS} }
html[data-theme="dark"] body, html[data-theme="hc"] body { background: var(--paper); color: var(--ink); }
/* on a dark page EVERYTHING that marks a part of the form or a finger is white: the cards (outline and name; the small dot too), the finger dots of the chord diagrams (white, their number black) and the open-string rings (light) */
html[data-dark] [data-role="section-card"] { fill: #fff; fill-opacity: .14; stroke: rgba(255,255,255,.85); stroke-width: 1; }
html[data-dark] [data-role="section-card"] + text, html[data-dark] [data-role="section-card-text"] { fill: #fff; }
html[data-dark] .sheet-seccard { color: #fff !important; border-color: rgba(255,255,255,.85) !important; }
html[data-dark] .sheet-seccard > span:first-child { background: #fff !important; }
html[data-dark] [data-section-card] > span { background: #fff !important; color: #1c1b1a !important; }
html[data-dark] { --diagram-dot: #fff; --diagram-dot-ink: #000; --diagram-open: #e6e4de; }
html[data-theme="hc"] button { border: 2px solid #fff; }
html[data-theme="hc"] :focus-visible { outline: 3px solid #ffd800 !important; outline-offset: 2px; }
[data-theme-toggle] { position: fixed; top: 8px; right: 8px; z-index: 60; width: 34px; height: 34px; padding: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; opacity: .8; background: var(--field,#fff); color: var(--ink,#1c1b1a); border: 1px solid var(--edge,#bbb); }
html[data-reader-sheet] [data-theme-toggle] { display: none; } /* the reader puts the theme in its bottom sheet on a phone or a tablet */
[data-theme-toggle]:hover, [data-theme-toggle]:focus-visible { opacity: 1; }`;

/** @param o.storage localStorage or null; o.label (next: 'light' | 'dark' | 'hc') → the tooltip (what a press switches to); returns the button */
export function mountThemeToggle({ storage = null, label = (next) => `Theme: ${next}` } = {}) {
  if (typeof document === 'undefined') return null;
  const root = document.documentElement;
  const media = (q) => { try { return window.matchMedia?.(q) ?? null; } catch { return null; } };
  const systemTheme = () => (media('(prefers-contrast: more)')?.matches ? 'hc' : media('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light');
  let chosen = false; let theme = systemTheme(); try { const v = storage?.getItem(KEY); if (ORDER.includes(v)) { theme = v; chosen = true; } } catch { /* no storage */ }
  const fromPortal = portalTheme(storage); if (fromPortal) { theme = fromPortal; chosen = true; }
  if (ORDER.includes(window.__SCORSAIRE_THEME__)) { theme = window.__SCORSAIRE_THEME__; chosen = true; } // set by the preview of the editor: it follows the editor's theme
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-theme-toggle', '');
  button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/></svg>';
  const next = () => ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const paint = () => {
    root.setAttribute('data-theme', theme);
    if (theme === 'light') root.removeAttribute('data-dark'); else root.setAttribute('data-dark', '');
    if (theme === 'hc') root.setAttribute('data-hc', ''); else root.removeAttribute('data-hc');
    button.title = label(next()); button.setAttribute('aria-label', button.title);
  };
  button.addEventListener('click', () => { theme = next(); chosen = true; try { storage?.setItem(KEY, theme); storage?.setItem(PORTAL_THEME_KEY, TO_PORTAL[theme]); } catch { /* no storage */ } paint(); });
  window.addEventListener('storage', (e) => { if (e.key !== PORTAL_THEME_KEY && e.key !== null) return; const v = portalTheme(storage); if (v && v !== theme) { theme = v; chosen = true; paint(); } }); // changed on the portal, in another tab
  for (const q of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)']) media(q)?.addEventListener?.('change', () => { if (!chosen) { theme = systemTheme(); paint(); } }); // the system changes while nothing was chosen
  paint(); document.body.append(button);
  return button;
}
