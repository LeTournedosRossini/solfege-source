/*
 * Small colour helpers (pure): the strong colour of a pastel one, for the text and the outline of the section name cards.
 */

/** "#rrggbb" → { h (0..360), s (0..1), l (0..1) } ; null when it is not such a colour. */
export function hexToHsl(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * The SAME hue as `hex`, much more saturated and darker (readable on the pale band): `{ text, line, dot }` as CSS colours.
 * A colour that is not "#rrggbb" gives a neutral dark grey.
 */
export function strongOf(hex, { saturation = 0.62, lightness = 0.3 } = {}) {
  const hsl = hexToHsl(hex);
  if (!hsl) return { text: '#444', line: 'rgba(60,60,60,.75)', dot: '#666' };
  const h = Math.round(hsl.h);
  const s = hsl.s === 0 ? 0 : Math.round(saturation * 100);
  return {
    text: `hsl(${h} ${s}% ${Math.round(lightness * 100)}%)`,
    line: `hsl(${h} ${s}% ${Math.round(lightness * 100)}% / 0.7)`,
    dot: `hsl(${h} ${s}% ${Math.round((lightness + 0.12) * 100)}%)`,
  };
}
