/*
 * The neck of a guitar or a bass as an SVG text (PURE: no DOM), for a scale: the strings, the frets, the notes of the scale as dots, the root in another colour. Used by the scale
 * component, and by the layout of a scale container later. Colours are CSS variables with a fallback: `--scale-note`, `--scale-root`, `--scale-ink`, `--scale-board`.
 *   fretboardSvg({ midi: [low → high], position?: { strings, minFret, maxFret }, notes?: 'name'|'degree'|'none', width, from?, to? }) → string
 * Without `position` every note of the scale on the neck is drawn (`all`: lib.fretboard(...).strings).
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21]; const DOUBLE = [12, 24];

export function fretboardSvg({ midi, position = null, all = null, label = 'name', width = 620, from = null, to = null, mirror = false, title = '' } = {}) {
  const strings = midi.length;
  const notes = [];
  const source = position ? position.strings : all;
  for (const s of source ?? []) for (const n of s.notes) notes.push({ string: s.index, fret: n.fret, name: n.name, degree: n.degree, isRoot: n.isRoot });
  let lo = from ?? (position ? position.minFret : 0); let hi = to ?? (position ? position.maxFret : 15);
  if (position && from === null) { lo = Math.max(0, lo - 0); if (lo <= 2) lo = 0; }
  if (hi - lo < 4) hi = lo + 4; // a window of at least 4 frets: the frets stay readable
  const left = 34; const right = 10; const top = 24; const gap = 26; const bottom = 24;
  const base = lo === 0 ? 1 : lo; // the first FRET drawn (the nut and the open strings sit left of it)
  const w = width; const boardW = w - left - right; const fw = boardW / Math.max(1, hi - base + 1);
  const h = top + gap * (strings - 1) + bottom;
  // the strings are drawn with the low string at the bottom
  const yOf = (s) => top + gap * (strings - 1 - s);
  const mir = (x) => (mirror ? w - x : x);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"${title ? ` aria-label="${title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"` : ''} data-scale-fretboard>`);
  parts.push(`<rect x="${mir(left)}" y="${top - 8}" width="${boardW * (mirror ? -1 : 1)}" height="${gap * (strings - 1) + 16}" fill="var(--scale-board,#f4efe4)" stroke="none"/>`);
  // frets: a bar at the right of each fret of the window; the nut (thick) when the window starts at the nut
  for (let f = base; f <= hi; f += 1) {
    const x = left + (f - base + 1) * fw;
    parts.push(`<line x1="${mir(x)}" y1="${top - 8}" x2="${mir(x)}" y2="${top + gap * (strings - 1) + 8}" stroke="var(--scale-ink,#7a7468)" stroke-width="${f === 0 ? 0.5 : 1.2}"/>`);
    const shown = f; const cx = left + (f - base) * fw + fw / 2;
    parts.push(`<text x="${mir(cx)}" y="${h - 6}" text-anchor="middle" font-size="11" fill="var(--scale-ink,#7a7468)" font-family="var(--ui-font,sans-serif)">${shown === 0 ? '' : shown}</text>`);
  }
  parts.push(`<line x1="${mir(left)}" y1="${top - 8}" x2="${mir(left)}" y2="${top + gap * (strings - 1) + 8}" stroke="var(--scale-ink,#7a7468)" stroke-width="${lo === 0 ? 4 : 1.2}"/>`);
  // inlays (the dots of the neck) between the middle strings
  for (let f = base; f <= hi; f += 1) {
    const single = INLAYS.includes(f); const dbl = DOUBLE.includes(f);
    if (!single && !dbl) continue;
    const cx = left + (f - base) * fw + fw / 2; const cy = top + gap * (strings - 1) / 2;
    for (const dy of dbl ? [-gap, gap] : [0]) parts.push(`<circle cx="${mir(cx)}" cy="${cy + dy}" r="4" fill="var(--scale-ink,#7a7468)" opacity=".25"/>`);
  }
  for (let s = 0; s < strings; s += 1) parts.push(`<line x1="${mir(left)}" y1="${yOf(s)}" x2="${mir(left + boardW)}" y2="${yOf(s)}" stroke="var(--scale-ink,#7a7468)" stroke-width="${0.8 + (strings - 1 - s) * 0.18}"/>`);
  for (const n of notes) {
    if (n.fret < base - (base === 1 ? 1 : 0) || n.fret > hi) continue;
    const cx = n.fret === 0 ? left - 12 : left + (n.fret - base) * fw + fw / 2; const cy = yOf(n.string);
    const text = label === 'degree' ? n.degree : label === 'name' ? n.name : '';
    parts.push(`<g data-fret="${n.fret}" data-string="${n.string}"${n.isRoot ? ' data-root' : ''}><circle cx="${mir(cx)}" cy="${cy}" r="${gap * 0.4}" fill="${n.isRoot ? 'var(--scale-root,#b3261e)' : 'var(--scale-note,#4a4458)'}" stroke="#fff" stroke-width="1.2"/>`
      + (text ? `<text x="${mir(cx)}" y="${cy + 4}" text-anchor="middle" font-size="${text.length > 2 ? 9 : 11}" fill="#fff" font-weight="600" font-family="var(--ui-font,sans-serif)">${esc(text)}</text>` : '') + '</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
