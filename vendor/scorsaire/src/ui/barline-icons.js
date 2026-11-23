/*
 * Small SVG icons for the barline types and repeat signs of the measure bar (24 x 24, one colour: `currentColor`).
 * Pure drawing data in `BAR_ICONS` (testable without a DOM); only `barIcon` touches the DOM.
 */
const NS = 'http://www.w3.org/2000/svg';
const L = (x, w = 1.3, y1 = 4, y2 = 20, extra = {}) => ['line', { x1: x, x2: x, y1, y2, 'stroke-width': w, ...extra }];
const D = (x, y) => ['circle', { cx: x, cy: y, r: 1.5, fill: 'currentColor', stroke: 'none' }];

export const BAR_ICONS = Object.freeze({
  simple: [L(12)],
  double: [L(9), L(15)],
  final: [L(8), L(15, 4.5)],
  reverseFinal: [L(9, 4.5), L(16)],
  heavy: [L(12, 4.5)],
  heavyHeavy: [L(8.5, 4), L(15.5, 4)],
  dashed: [L(12, 1.8, 4, 20, { 'stroke-dasharray': '3.2 2.6' })],
  dotted: [L(12, 2.2, 4, 20, { 'stroke-dasharray': '0.1 3.8', 'stroke-linecap': 'round' })],
  short: [L(12, 1.6, 8, 16)],
  tick: [L(12, 1.6, 2, 9)],
  repeatStart: [L(6, 4.5), L(11), D(16, 9), D(16, 15)],
  repeatEnd: [D(8, 9), D(8, 15), L(13), L(18, 4.5)],
});

/** The icon `kind` ('simple', 'double', 'final'… 'repeatStart', 'repeatEnd'), or null when unknown. */
export function barIcon(kind, size = '1.3em') {
  const shapes = BAR_ICONS[kind];
  if (!shapes) return null;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('data-bar-icon', kind);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.style.cssText = `width:${size};height:${size};flex:none;display:block`;
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
