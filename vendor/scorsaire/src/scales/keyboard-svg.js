/*
 * A piano keyboard as an SVG text (PURE: no DOM), for a scale: two octaves from a C, the notes of the scale lit on the keys, the root in another colour. Used by the scale component
 * (the « keyboard » view, for every instrument that has no neck) and by `renderScaleSvg`. Colours are CSS variables with a fallback: `--scale-note`, `--scale-root`, `--scale-ink`.
 *   keyboardSvg({ notes: [{ pc, name, degree, isRoot }], label: 'name' | 'degree' | 'none', width, octaves, title }) → string
 */
const WHITE = [0, 2, 4, 5, 7, 9, 11]; const BLACK_AFTER = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 }; // white pc → the pc of the black key just after it
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function keyboardSvg({ notes = [], label = 'name', width = 620, octaves = 2, title = '' } = {}) {
  const whites = WHITE.length * octaves; const kw = width / whites; const kh = Math.round(kw * 4.2); const bw = kw * 0.62; const bh = kh * 0.62;
  const byPc = new Map(notes.map((n) => [n.pc, n]));
  const text = (n) => (label === 'degree' ? n.degree : label === 'name' ? n.name : '');
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${kh + 2}" width="${width}" height="${kh + 2}" role="img"${title ? ` aria-label="${esc(title).replace(/"/g, '&quot;')}"` : ''} data-scale-keyboard>`];
  const dot = (cx, cy, n, r) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${n.isRoot ? 'var(--scale-root,#d32f2f)' : 'var(--scale-note,#49454f)'}"/>`
    + (text(n) ? `<text x="${cx.toFixed(1)}" y="${(cy + r * 0.36).toFixed(1)}" text-anchor="middle" font-size="${(r * 1.05).toFixed(1)}" fill="#fff" font-family="var(--ui-font,sans-serif)">${esc(text(n))}</text>` : '');
  for (let i = 0; i < whites; i += 1) { // the white keys, with the lit ones marked near the bottom
    const pc = WHITE[i % 7]; const x = i * kw; const n = byPc.get(pc);
    parts.push(`<rect x="${x.toFixed(1)}" y="1" width="${kw.toFixed(1)}" height="${kh}" fill="#fff" stroke="var(--scale-ink,#7a7468)" stroke-width="1"/>`);
    if (n) parts.push(dot(x + kw / 2, kh - kw * 0.55, n, Math.min(kw * 0.36, 13)));
  }
  for (let i = 0; i < whites; i += 1) { // the black keys over them
    const pc = BLACK_AFTER[WHITE[i % 7]]; if (pc === undefined) continue;
    const x = (i + 1) * kw - bw / 2; const n = byPc.get(pc);
    parts.push(`<rect x="${x.toFixed(1)}" y="1" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="#2b2b2b"/>`);
    if (n) parts.push(dot(x + bw / 2, bh - bw * 0.62, n, Math.min(bw * 0.4, 11)));
  }
  parts.push('</svg>');
  return parts.join('');
}
