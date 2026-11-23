/*
 * The colour of the title bar of an INSTALLED app window (a PWA on a computer): the browser takes it from `<meta name="theme-color">`. It follows the theme of the page
 * (light, dark, high contrast): the colour of the page itself, read again whenever the theme changes. Nothing happens on a page without that tag (the standalone file, the portal).
 */

/** `rgb(…)` / `rgba(…)` → `#rrggbb`, or null for a transparent or unreadable colour. */
export function colorToHex(css) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(String(css ?? '').trim());
  if (!m) return /^#[0-9a-f]{6}$/i.test(String(css ?? '').trim()) ? String(css).trim().toLowerCase() : null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
}

export function mountThemeColor({ doc = globalThis.document, win = globalThis.window } = {}) {
  const metas = [...(doc?.querySelectorAll?.('meta[name="theme-color"]') ?? [])];
  if (!metas.length || !win?.getComputedStyle) return null;
  const [meta, ...extra] = metas;
  for (const m of extra) m.remove(); // the tags that only served the first paint (a media query on the system theme): this one now follows the page
  meta.removeAttribute('media');
  let last = null;
  const apply = () => {
    const css = win.getComputedStyle(doc.body ?? doc.documentElement).backgroundColor;
    const hex = colorToHex(css) ?? colorToHex(win.getComputedStyle(doc.documentElement).backgroundColor);
    if (hex && hex !== last) { last = hex; meta.setAttribute('content', hex); }
  };
  apply();
  const observer = new win.MutationObserver(apply);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-dark', 'data-hc', 'data-contrast', 'class', 'style'] });
  win.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => win.setTimeout(apply, 50));
  return { refresh: apply, dispose: () => observer.disconnect() };
}
