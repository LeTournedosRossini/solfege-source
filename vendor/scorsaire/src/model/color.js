/** Black or white, whichever reads better on `hex` (a '#rrggbb' fill) — the ink of a number written on a coloured dot. */
export function contrastInk(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#000' : '#fff';
}
