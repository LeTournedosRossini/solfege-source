// A small map of France (the hexagon and Corsica), the icon of "edit the CARD": a card, a map — in French the same word. It tells the button apart from the one that edits the groove or the pattern.
const NS = 'http://www.w3.org/2000/svg';

export function franceIcon(px = 18) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 22 20'); svg.setAttribute('width', String(px)); svg.setAttribute('height', String(Math.round((px * 20) / 22))); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('data-icon', 'france');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linejoin', 'round'); svg.style.cssText = 'display:block;flex:0 0 auto';
  for (const d of [
    'M9.99 0.38 L13.23 2.09 L15.39 3.23 L17.82 4.18 L17.01 6.84 L14.99 9.5 L16.2 10.07 L16.07 13.49 L16.88 14.06 L14.04 15.01 L10.8 16.53 L8.78 16.34 L4.32 14.82 L5.13 12.35 L5.13 9.5 L3.38 7.41 L0.41 6.08 L0.27 5.32 L4.05 4.75 L4.73 2.85 L6.89 3.42 L9.18 0.57 Z',
    'M18.36 15.58 L19.58 15.96 L19.31 18.62 L18.5 18.24 Z',
  ]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
