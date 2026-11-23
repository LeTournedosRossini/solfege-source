/*
 * The pages of a LYRICS part (model/lyricstrophes.js): the strophes written as blocks of text, in one or two columns, each under its card of structure. PURE (no DOM).
 * A page is made like the pages of the other parts (`{ layout: { width, height, systems }, chrome }`): here every page holds ONE pseudo-system whose single staff has no
 * lines and carries the text items, so that rendering, printing and the SVG export treat it like any other page.
 *
 * Heights are measured with the same approximate text width as the zones (`wrapItems`, `textWidth`); a strophe is not cut between two columns or pages unless it is
 * higher than a whole column (then it is cut between two lines, the next piece has no card).
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { lyricsSettings, lyricsStrophesOf } from '../model/lyricstrophes.js';
import { inlineCardColor } from '../model/sections.js';
import { textWidth } from './textwidth.js';
import { wrapItems } from './partzones.js';
import { textStyleOf } from '../model/pagetext.js';

const PT_MM = 25.4 / 72;
const GUTTER = 3; // staff spaces between two columns

/**
 * @param o { work, part, geometry, getStyle (the part's style), chrome (makePageChrome), lang }
 * @returns pages [{ number, movementIndex, lyrics: true, layout, chrome }]
 */
export function layoutLyricsPages({ work, part, geometry, getStyle, chrome, lang = 'fr' }) {
  const set = lyricsSettings(part);
  const strophes = lyricsStrophesOf(work, part, { lang });
  const style = textStyleOf(part.props[PID.PART_TEXT_STYLES] ?? {}, 'lyrics', { size: set.size, align: 'left' });
  const size = (set.size * PT_MM) / geometry.spaceMm; // staff spaces
  const lh = size * 1.3;
  const cardH = size * 1.35;
  const gapBetween = size * 1.1;
  const W = geometry.contentWidth;
  const cols = set.columns;
  const colW = (W - GUTTER * (cols - 1)) / cols;
  const upper = getStyle(SID.PAGE_UPPER_BORDER); const lower = getStyle(SID.PAGE_LOWER_BORDER);

  // the blocks: { card, rows: [string] (wrapped), height }
  const blocks = [];
  for (const s of strophes) {
    const rows = [];
    for (const line of s.lines) {
      if (!line.trim()) { rows.push(''); continue; }
      for (const l of wrapItems([{ text: line }], size, colW)) rows.push(l.map((seg) => seg.text).join(''));
    }
    blocks.push({ card: set.cards ? s.card : null, rows });
  }
  const blockHeight = (b, withCard) => (withCard && b.card ? cardH * 1.4 : 0) + b.rows.length * lh;

  // columns of pages: place the blocks one after the other; a block that does not fit in the rest of a column goes to the next (cut between lines only if it is higher than a column)
  const pages = []; // [{ columns: [[{ y, block, from, to, card }]] }]
  const limitsOf = (k) => chrome.limits(k, 0);
  let page = null; let col = 0; let y = 0; let colTop = 0; let colBottom = 0;
  const newPage = () => {
    const lim = limitsOf(pages.length);
    page = { columns: Array.from({ length: cols }, () => []), top: upper + lim.top, bottom: geometry.contentHeight - lim.bottom - lower };
    pages.push(page); col = 0; colTop = page.top; colBottom = page.bottom; y = colTop;
  };
  const nextColumn = () => { if (col + 1 < cols) { col += 1; y = colTop; } else newPage(); };
  newPage();
  for (const b of blocks) {
    let from = 0; let first = true;
    while (from < b.rows.length) {
      const room = colBottom - y;
      const headH = first && b.card ? cardH * 1.4 : 0;
      const fits = headH + (b.rows.length - from) * lh;
      const atTop = y <= colTop + 1e-9;
      if (fits <= room + 1e-9) {
        page.columns[col].push({ y, block: b, from, to: b.rows.length, card: first });
        y += fits + gapBetween; from = b.rows.length; first = false;
      } else if (!atTop && (blockHeight(b, first) <= colBottom - colTop)) { nextColumn(); } // it would fit in an empty column: start the next one
      else { // higher than a column (or at the top already): as many lines as fit
        const n = Math.max(1, Math.floor((room - headH) / lh));
        const to = Math.min(b.rows.length, from + n);
        page.columns[col].push({ y, block: b, from, to, card: first });
        y += headH + (to - from) * lh + gapBetween; from = to; first = false;
        if (from < b.rows.length) nextColumn();
      }
    }
  }
  // (a trailing empty page cannot exist: a page is only created for the first block or by `nextColumn`, which is followed by a push)

  const ink = style.color ?? undefined;
  const result = pages.map((p, k) => {
    const items = [];
    p.columns.forEach((entries, c) => {
      const x = c * (colW + GUTTER);
      for (const e of entries) {
        let top = e.y;
        if (e.card && e.block.card) {
          const label = e.block.card.label;
          const w = size * 0.6 + textWidth(label, size, { bold: true }) + size * 0.55;
          items.push({ kind: 'rect', role: 'section-card', x, y: -(top + cardH), w, h: cardH, fill: inlineCardColor({ ...e.block.card, label }, work) });
          items.push({ kind: 'text', text: label, x: x + size * 0.6, y: -(top + cardH * 0.72), size, anchor: 'start', family: style.family, bold: true, role: 'section-card-text' });
          top += cardH * 1.4;
        }
        for (let r = e.from; r < e.to; r += 1) {
          const text = e.block.rows[r];
          if (!text) continue;
          items.push({ kind: 'text', text, x, y: -(top + (r - e.from) * lh + size * 0.9), size, anchor: 'start', family: style.family, bold: !!style.bold, italic: !!style.italic, ...(ink ? { color: ink } : {}), role: 'lyrics-text' });
        }
      }
    });
    const system = { index: 0, top: 0, height: p.bottom, x0: 0, width: W, overlays: [], measures: [], staves: [{ ref: `lyrics-page-${k}`, type: 'neutral', originY: 0, items }] };
    return { number: k + 1, movementIndex: 0, lyrics: true, layout: { width: W, height: geometry.contentHeight, systems: [system] } };
  });
  result.forEach((p, i) => { p.chrome = chrome.items(i, result.length, 0); });
  return result;
}
