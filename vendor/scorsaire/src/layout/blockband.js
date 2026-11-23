// The band of blocks of a movement laid out: overlay items (system coordinates, y down from the top of the band) and the height it takes. Every block is placed and
// sized in percent of the WIDTH of the band (see model/blocks.js), so the picture is the same on every screen. PURE.
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { blockLook, DEFAULT_ASPECT } from '../model/blocks.js';
import { richLines } from '../model/pagetext.js';
import { wrapItems } from './partzones.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param movement
 * @param o.fitOverride  a height chosen by hand for the fitted band (fraction of the width), instead of the one the content gives
 * @param o.fit    true = the band is as high as what it holds (a movement with no staff: the box follows its content) instead of `aspect × width`
 * @param o.left   x of the left edge of the band, o.width its width (staff spaces); o.scale = 1 (a reader's zoom makes the text and the heights bigger)
 * @returns { height, items, box: { x, y, w, h } } or null when the movement has no block
 */
export function blockBand(movement, { left, width, scale = 1, fit = false, fitOverride = null }) {
  const list = getProperty(movement, PID.BLOCKS);
  if (!list?.length || !(width > 0)) return null;
  const aspect = getProperty(movement, PID.BLOCK_ASPECT) ?? DEFAULT_ASPECT;
  const height = aspect * width * scale; // `scale` (a reader's zoom): the text and the vertical extent grow, the horizontal frame stays the width of the screen
  const items = [];
  for (const b of list) {
    if (b.kind === 'image') {
      items.push({ kind: 'image', role: 'block-image', image: b.image, fit: b.fit ?? 'contain', alt: b.alt, ratio: b.ratio ?? 1, crop: b.crop, x: left + (b.x / 100) * width, y: (b.y / 100) * width * scale, w: (b.w / 100) * width, h: (b.h / 100) * width * scale, sel: b.id });
      continue;
    }
    const look = blockLook(b);
    const size = (look.size / 100) * width * scale; const lh = size * 1.25;
    const bx = left + (b.x / 100) * width; const by = (b.y / 100) * width * scale; const bw = (b.w / 100) * width;
    const rows = [];
    for (const line of richLines(b.text, {})) { if (!line.length) rows.push([]); else rows.push(...wrapItems(line, size, bw)); }
    rows.forEach((row, k) => {
      const total = row.reduce((w, seg) => w + seg.w, 0);
      let x = look.align === 'center' ? bx + (bw - total) / 2 : look.align === 'right' ? bx + bw - total : bx;
      const y = by + size * 0.95 + k * lh;
      for (const seg of row) {
        if (seg.text && seg.text.trim()) items.push({ kind: 'text', role: 'block-text', text: esc(seg.text), x, y, size, anchor: 'start', family: look.family, bold: look.bold || seg.item.bold, italic: look.italic || seg.item.italic, underline: look.underline || seg.item.underline, color: look.color ?? undefined, sel: b.id });
        x += seg.w;
      }
    });
  }
  let h = height;
  if (fit && items.length) { // what is drawn reaches this far down; a small margin under it
    const bottom = Math.max(...items.map((it) => (it.kind === 'image' ? it.y + it.h : it.y + it.size * 0.35)));
    h = Math.min(height, Math.max(0.06 * width * scale, bottom + 0.03 * width * scale));
    if (fitOverride > 0) h = fitOverride * width * scale; // the author drew the frame by hand
  }
  const bottomAll = items.length ? Math.max(...items.map((it) => (it.kind === 'image' ? it.y + it.h : it.y + it.size * 0.35))) : 0;
  const fitAuto = Math.min(height, Math.max(0.06 * width * scale, bottomAll + 0.03 * width * scale)); const fitH = fitOverride > 0 ? fitOverride * width * scale : fitAuto; // how high the band would be if it followed its content (what a box on the video shows)
  return { height: h, items, box: { x: left, y: 0, w: width, h, fitH, fitManual: fitOverride > 0 } };
}
