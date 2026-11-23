/*
 * The BAND OF BLOCKS of a movement: free texts (images later) laid out above the first system of the movement, on every screen that shows it (screen 1 and 4: the
 * fragment; screen 3: the case; screen 2: the printed page). A movement belongs to the work, so its blocks travel with it.
 * Every coordinate is a percentage of the WIDTH of the band (x, y, w, h and the size of the text), and the band is `aspect` times as high as it is wide: the composition is
 * the same at any size, like a picture. PURE: lists in, lists out; the document is written by `blockedit.js` / `Application`.
 */
import { newId } from './ids.js';

export const BLOCK_KINDS = Object.freeze(['text', 'image']);
export const FITS = Object.freeze(['contain', 'cover', 'stretch']);
export const DEFAULT_ASPECT = 0.3;
export const ASPECT_RANGE = Object.freeze([0.05, 1.5]);
export const TEXT_DEFAULTS = Object.freeze({ size: 3.2, bold: false, italic: false, underline: false, align: 'left', color: null, family: 'sans-serif' });
export const FAMILIES = Object.freeze(['sans-serif', 'serif', 'monospace']);
export const MAX_TEXT = 2000;
export const MIN_SIZE = 0.8; export const MAX_SIZE = 20;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** A new text block, at (x, y) with the room (w, h), all in percent of the width of the band. */
export function createTextBlock({ x = 5, y = 5, w = 40, h = 12, text = '', ...style } = {}) {
  return { id: newId('bk'), kind: 'text', x, y, w, h, text, ...pickStyle(style) };
}
function pickStyle(s) {
  const out = {};
  for (const k of Object.keys(TEXT_DEFAULTS)) if (s[k] !== undefined && s[k] !== TEXT_DEFAULTS[k]) out[k] = s[k];
  return out;
}

/** A new image block: `image` is the id of the picture in the registry of images (model/assets.js); `ratio` (width / height of the picture) sizes the box when `h` is not given. */
export function createImageBlock({ x = 5, y = 5, w = 30, h, image, ratio = 1, fit, alt } = {}) {
  const out = { id: newId('bk'), kind: 'image', x, y, w, h: h ?? w / (ratio > 0 ? ratio : 1), image };
  if (ratio > 0 && ratio !== 1) out.ratio = ratio; // the picture's width / height: what a crop is measured against
  if (fit && fit !== 'contain') out.fit = fit;
  if (alt) out.alt = String(alt).slice(0, 200);
  return out;
}

/** A crop = the part of the picture that shows, in FRACTIONS of the whole picture: { x, y, w, h } (0..1, at least 2 % each way). */
export const MIN_CROP = 0.02;
export const isValidCrop = (c) => !!c && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(c[k])) && c.x >= 0 && c.y >= 0 && c.w >= MIN_CROP && c.h >= MIN_CROP && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9;
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
const isFull = (c) => c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;

/**
 * The block with its part of the picture changed to `crop`, the box following so that what stays visible does not move or change size:
 * the picture's scale (percent of the band width per unit of picture width) is kept, the box takes the shape of the new part.
 * The old box is first taken as exactly the shape of the old crop (a box stretched by hand is straightened).
 * @returns {object} the patch to apply ({ crop, x, y, w, h }); a full crop is stored as no crop (`crop: undefined`)
 */
export function cropImageBlock(b, crop) {
  const ratio = b.ratio > 0 ? b.ratio : 1;
  const old = b.crop ?? FULL_CROP;
  const scale = b.w / old.w; // width of the WHOLE picture, in percent of the band width
  const next = {
    x: Math.min(1 - MIN_CROP, Math.max(0, crop.x)), y: Math.min(1 - MIN_CROP, Math.max(0, crop.y)),
    w: Math.max(MIN_CROP, crop.w), h: Math.max(MIN_CROP, crop.h),
  };
  next.w = Math.min(next.w, 1 - next.x); next.h = Math.min(next.h, 1 - next.y);
  return {
    crop: isFull(next) ? undefined : next,
    x: b.x + (next.x - old.x) * scale, y: b.y + ((next.y - old.y) * scale) / ratio,
    w: next.w * scale, h: (next.h * scale) / ratio,
  };
}

/** What a block looks like with its defaults filled. */
export const blockLook = (b) => ({ ...TEXT_DEFAULTS, ...b });

/** The problems of a list of blocks (never thrown: a file can hold anything). */
export function blockProblems(list, aspect = DEFAULT_ASPECT) {
  const out = []; const seen = new Set();
  if (!Array.isArray(list)) return ['the blocks are not a list'];
  for (const b of list) {
    if (!b || typeof b.id !== 'string') { out.push('a block has no id'); continue; }
    if (seen.has(b.id)) out.push(`${b.id}: duplicate id`); seen.add(b.id);
    if (!BLOCK_KINDS.includes(b.kind)) out.push(`${b.id}: unknown kind`);
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(b[k])) out.push(`${b.id}: ${k} is not a number`);
    if (!(b.w > 0) || !(b.h > 0)) out.push(`${b.id}: empty box`);
    if (b.kind === 'image') {
      if (typeof b.image !== 'string' || !b.image) out.push(`${b.id}: no image`);
      if (b.fit !== undefined && !FITS.includes(b.fit)) out.push(`${b.id}: bad fit`);
      if (b.ratio !== undefined && !(b.ratio > 0.01 && b.ratio < 100)) out.push(`${b.id}: bad ratio`);
      if (b.crop !== undefined && !isValidCrop(b.crop)) out.push(`${b.id}: bad crop`);
      continue;
    }
    if (typeof b.text !== 'string' || b.text.length > MAX_TEXT) out.push(`${b.id}: bad text`);
    if (b.size !== undefined && !(b.size >= MIN_SIZE && b.size <= MAX_SIZE)) out.push(`${b.id}: bad size`);
    if (b.align !== undefined && !['left', 'center', 'right'].includes(b.align)) out.push(`${b.id}: bad alignment`);
    if (b.family !== undefined && !FAMILIES.includes(b.family)) out.push(`${b.id}: bad family`);
    if (b.color != null && !/^#[0-9a-f]{3,8}$/i.test(b.color)) out.push(`${b.id}: bad colour`);
  }
  if (!(aspect >= ASPECT_RANGE[0] && aspect <= ASPECT_RANGE[1])) out.push('bad aspect');
  return out;
}

/** A block kept inside the band: its box is clamped (it keeps its size when it fits, and at least 3 % of the width). */
export function clampBlock(b, aspect = DEFAULT_ASPECT) {
  const H = 100 * aspect;
  const w = clamp(num(b.w, 40), 3, 100); const h = clamp(num(b.h, 10), 3, H);
  return { ...b, w, h, x: clamp(num(b.x, 0), 0, 100 - w), y: clamp(num(b.y, 0), 0, H - h) };
}

export const addBlock = (list, block, aspect = DEFAULT_ASPECT) => [...list, clampBlock(block, aspect)];
export const updateBlockIn = (list, id, patch, aspect = DEFAULT_ASPECT) => list.map((b) => {
  if (b.id !== id) return b;
  const next = { ...b, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || (k in TEXT_DEFAULTS && next[k] === TEXT_DEFAULTS[k]) || (k === 'fit' && next[k] === 'contain') || (k === 'crop' && !next[k])) delete next[k]; // a default is never stored
  return clampBlock(next, aspect);
});
export const removeBlockIn = (list, id) => list.filter((b) => b.id !== id);

/** The lines of a block's text, wrapped to `maxWidth` (same unit as `size`): an estimate of the width of a letter (the font is not measured). */
export function wrapText(text, size, maxWidth, { bold = false } = {}) {
  const lw = size * (bold ? 0.6 : 0.55);
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) { line += word; continue; }
      if (line.trim() && (line + word).length * lw > maxWidth) { lines.push(line.trimEnd()); line = ''; }
      line += word;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
