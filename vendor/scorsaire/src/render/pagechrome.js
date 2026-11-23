/*
 * SVG of the decorations of a printed page (title block, header, footer): text items in millimetres on the paper, see layout/pagechrome.js.
 * The SVG covers the whole paper (viewBox in mm), so it can be laid over the music of the page or printed with it. Each text carries its identifier
 * (`data-chrome`) so that the screen can pick it; `pick` = true lets the texts receive the pointer.
 */
const PT_MM = 25.4 / 72;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace']);
const fontOf = (fam) => (!fam ? 'serif' : GENERIC.has(fam) ? fam : `'${fam}', serif`); // a device font keeps a generic fallback
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => (Math.round(n * 1000) / 1000).toString();

export function renderPageChrome(items, geometry, { ink = '#000', showHidden = false, pick = false, mono = false } = {}) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(geometry.widthMm)} ${f(geometry.heightMm)}" width="100%" height="100%" data-page-chrome="">`];
  for (const it of items) {
    if (it.hidden && !showHidden) continue;
    const runs = it.runs.map((r) => `<tspan${r.bold || it.bold ? ' font-weight="bold"' : ''}${r.italic || it.italic ? ' font-style="italic"' : ''}>${esc(r.text)}</tspan>`).join('');
    const color = it.hidden ? '#8a8a8a' : mono ? ink : it.color ?? ink;
    parts.push(`<text x="${f(it.x)}" y="${f(it.y)}" font-family="${fontOf(it.family)}" font-size="${f(it.size * PT_MM)}" text-anchor="${it.anchor}" fill="${color}" data-role="${it.role}"${it.id ? ` data-chrome="${esc(it.id)}"` : ''}${it.underline ? ' text-decoration="underline"' : ''}${pick ? ' style="pointer-events:all;cursor:pointer"' : ''}>${runs}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
