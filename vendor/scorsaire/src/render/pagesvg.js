/*
 * One printed page as a single SVG in millimetres: the music of the page (layout/partlayout.js) and its decorations (title, header, footer) on the
 * paper, ready to print or to save. Pure: no DOM. Screen-only items (frames, handles, warnings, the strip of the name cards) are never drawn; hidden
 * elements are not drawn either.
 */
import { renderSvgString } from './svg.js';
import { renderPageChrome } from './pagechrome.js';

const SCREEN_ONLY = ['chord-view-card', 'chord-view-card-text', 'container-frame', 'container-handle', 'container-warning', 'container-readonly', 'section-strip', 'section-space'];
/** Dark pages: the cards of the sections as tinted glass, their text white (the text that follows a card in the drawing is its label). */
export const DARK_CARDS = '[data-role="section-card"]{fill-opacity:.5}[data-role="section-card"]+text,[data-role="section-card-text"]{fill:#fff}';
const f = (n) => (Math.round(n * 1000) / 1000).toString();

/**
 * @param page      { layout: { width, height, systems }, chrome }
 * @param geometry  page geometry (model/page.js): widthMm, heightMm, margins { left, top… }, spaceMm
 * @param opts      { fontCss, mono } — mono: print as if everything were black (no element colours, no coloured bands)
 *             { fontCss } — @font-face rules embedded in the file (the chord font); other fonts stay named and must exist where the SVG is shown
 */
export function pageSvg(page, geometry, glyphs, { fontCss = '', mono = false, dark = false } = {}) {
  // dark: the music in the ink and on the paper of the page it is shown in (CSS variables), never an inverted picture: the colours of the marks stay what they are, and the
  // cards of the sections turn into a tinted glass with white text so that they can be read
  const PX = 10; // drawing units per staff space inside the nested music SVG (any value: it is scaled to millimetres)
  const music = renderSvgString(page.layout, glyphs, { staffSpace: PX, margin: 0, inlineImages: true, ink: dark ? 'var(--ink,#f2ede2)' : '#000000', paper: dark ? 'var(--score,#000)' : '#ffffff', skipRoles: SCREEN_ONLY, mono });
  const inner = music.slice(music.indexOf('>') + 1, music.lastIndexOf('</svg>'));
  const mw = page.layout.width * geometry.spaceMm; const mh = page.layout.height * geometry.spaceMm;
  const chrome = renderPageChrome(page.chrome ?? [], geometry, { ink: dark ? 'var(--ink,#f2ede2)' : '#000000', mono });
  const W = geometry.widthMm; const H = geometry.heightMm;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">`
    + (fontCss || dark ? `<style>${fontCss}${dark ? DARK_CARDS : ''}</style>` : '')
    + `<rect width="${f(W)}" height="${f(H)}" fill="${dark ? 'var(--score,#000)' : '#ffffff'}"/>`
    + `<svg x="${f(geometry.margins.left)}" y="${f(geometry.margins.top)}" width="${f(mw)}" height="${f(mh)}" viewBox="0 0 ${f(page.layout.width * PX)} ${f(page.layout.height * PX)}">${inner}</svg>`
    + chrome.replace('width="100%" height="100%"', `x="0" y="0" width="${f(W)}" height="${f(H)}"`)
    + '</svg>';
}
