/*
 * Page of a part (screen 2): paper formats and the printable area, in millimetres and in staff spaces.
 * Pure (no DOM). The values live in the style layer of the part (`SID.PAGE_*`), resolved by `getStyle(sid)`.
 */
import { SID } from './sid.js';

/** Paper formats in millimetres, portrait. `screen-*` are for reading on a tablet or a phone (roadmap §7). */
export const PAGE_FORMATS = {
  a3: { w: 297, h: 420 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  letter: { w: 215.9, h: 279.4 },
  legal: { w: 215.9, h: 355.6 },
  tabloid: { w: 279.4, h: 431.8 },
  'screen-tablet': { w: 165, h: 220 },
  // the screens a musician reads on (the Lecteur shows the parts made for them as they are): the shapes of the usual tablets, portrait (the landscape box turns them round)
  'tablet-4-3': { w: 150, h: 200 }, // iPad
  'tablet-16-10': { w: 150, h: 240 }, // Android
  'tablet-5-3': { w: 150, h: 250 }, // Android (5:3)
  'tablet-16-9': { w: 150, h: 266.7 }, // Android
  'screen-phone': { w: 68, h: 147 },
};

export const pageFormatIds = () => [...Object.keys(PAGE_FORMATS), 'custom'];

/**
 * Geometry of a part's page.
 * @param getStyle  (sid) → value (the part's style layer over the movement's)
 * @returns { widthMm, heightMm, margins: { left, right, top, bottom } (mm), spaceMm, contentWidthMm, contentHeightMm, contentWidth, contentHeight }
 *   `contentWidth` / `contentHeight`: the printable area in staff spaces (what the layout engine works in).
 */
export function pageGeometry(getStyle) {
  const id = getStyle(SID.PAGE_FORMAT);
  const base = id === 'custom' || !PAGE_FORMATS[id]
    ? { w: Math.max(30, getStyle(SID.PAGE_WIDTH_MM)), h: Math.max(30, getStyle(SID.PAGE_HEIGHT_MM)) }
    : PAGE_FORMATS[id];
  const landscape = getStyle(SID.PAGE_LANDSCAPE);
  const widthMm = landscape ? base.h : base.w;
  const heightMm = landscape ? base.w : base.h;
  const m = (sid) => Math.max(0, getStyle(sid));
  const margins = { left: m(SID.PAGE_MARGIN_LEFT), right: m(SID.PAGE_MARGIN_RIGHT), top: m(SID.PAGE_MARGIN_TOP), bottom: m(SID.PAGE_MARGIN_BOTTOM) };
  const spaceMm = Math.max(0.5, getStyle(SID.PAGE_STAFF_SPACE_MM));
  // margins can never swallow the page: keep at least 20 mm of printable width and height
  const contentWidthMm = Math.max(20, widthMm - margins.left - margins.right);
  const contentHeightMm = Math.max(20, heightMm - margins.top - margins.bottom);
  return { widthMm, heightMm, margins, spaceMm, contentWidthMm, contentHeightMm, contentWidth: contentWidthMm / spaceMm, contentHeight: contentHeightMm / spaceMm };
}
