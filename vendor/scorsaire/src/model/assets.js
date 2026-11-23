/*
 * The IMAGES of the blocks (and any file a work carries that is not music): a registry of the bytes, kept OUTSIDE the document (no history, no JSON): a block only holds the id of its
 * image. The registry belongs to the page (one work at a time): it is cleared when another work is opened, the file (ZIP form) writes only the images the work uses, and the
 * renderers ask it for an address to draw: a short object URL on screen (the image is not copied into the SVG at each redraw), a `data:` URI for what leaves the page (an exported
 * SVG, a page for the reader). PURE except for the object URLs (browser only).
 */
const assets = new Map();

export const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' });
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const EXT_OF = Object.fromEntries(Object.entries({ png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }).map(([k, v]) => [v, k]));
export const extOfMime = (mime) => EXT_OF[mime] ?? 'bin';
/** The image type of a file name (or null when it is not an image Scorsaire takes). */
export const mimeOfName = (name) => IMAGE_TYPES[(/\.([a-z0-9]+)$/i.exec(String(name ?? ''))?.[1] ?? '').toLowerCase()] ?? null;

/** A stable id from the bytes (FNV-1a): the same picture added twice is ONE asset. */
export function assetIdFor(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `im${h.toString(16).padStart(8, '0')}${bytes.length.toString(16)}`;
}

const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
/** The natural size { w, h } of an image from its header (PNG, GIF, JPEG, WebP) or its text (SVG: width / height or viewBox); null when it cannot be read. */
export function imageSize(mime, bytes) {
  try {
    if (mime === 'image/png' && bytes.length > 24) return { w: be32(bytes, 16), h: be32(bytes, 20) };
    if (mime === 'image/gif' && bytes.length > 10) return { w: le16(bytes, 6), h: le16(bytes, 8) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i += 1; continue; }
        const m = bytes[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: be16(bytes, i + 5), w: be16(bytes, i + 7) };
        i += 2 + be16(bytes, i + 2);
      }
      return null;
    }
    if (mime === 'image/webp' && bytes.length > 30) {
      const tag = String.fromCharCode(...bytes.subarray(12, 16));
      if (tag === 'VP8X') return { w: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), h: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      if (tag === 'VP8 ') return { w: le16(bytes, 26) & 0x3fff, h: le16(bytes, 28) & 0x3fff };
      if (tag === 'VP8L') { const v = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24); return { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
      return null;
    }
    if (mime === 'image/svg+xml') {
      const text = new TextDecoder().decode(bytes.subarray(0, 4000));
      const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
      const num = (name) => { const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px|pt|mm|cm|in)?\\s*["']`, 'i').exec(tag); return m ? Number(m[1]) : null; };
      const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag);
      const w = num('width'); const h = num('height');
      if (w && h) return { w, h };
      if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
    }
  } catch { /* an unreadable header: no size */ }
  return null;
}

export function registerAsset({ id, name = '', mime, bytes }) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  assets.set(id, { id, name, mime, bytes: data, url: null, dataUri: null });
  return id;
}
export const hasAsset = (id) => assets.has(id);
export const getAsset = (id) => assets.get(id) ?? null;
export function clearAssets() {
  for (const a of assets.values()) if (a.url) { try { URL.revokeObjectURL(a.url); } catch { /* browser only */ } }
  assets.clear();
}
const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
/** The address to draw an image from, or null when the registry does not hold it. `inline`: a `data:` URI (what leaves the page); otherwise an object URL when the browser has them. */
export function assetHref(id, { inline = false } = {}) {
  const a = assets.get(id); if (!a) return null;
  if (!inline && typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') { a.url ??= URL.createObjectURL(new Blob([a.bytes], { type: a.mime })); return a.url; }
  a.dataUri ??= `data:${a.mime};base64,${toBase64(a.bytes)}`;
  return a.dataUri;
}

/** The ids of the images a work uses (blocks of every movement). */
export function usedAssetIds(work) {
  const out = new Set();
  for (const mv of work.movements) for (const b of mv.props?.blocks ?? []) if (b.kind === 'image' && b.image) out.add(b.image);
  return [...out];
}
/** The registry entries of the images a work uses (those it holds): what the ZIP form writes. */
export const usedAssets = (work) => usedAssetIds(work).map((id) => assets.get(id)).filter(Boolean);

/** Takes a picture file ({ name, bytes }) into the registry; → { id, ratio } (width / height, 1 when unknown). Throws a message for a file that is not an image Scorsaire takes. */
export function addImageFile({ name, bytes }) {
  const mime = mimeOfName(name);
  if (!mime) throw new Error('Not an image (PNG, JPEG, GIF, WebP or SVG)');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('The picture is too big (8 MB at most)');
  const id = assetIdFor(bytes);
  if (!assets.has(id)) registerAsset({ id, name, mime, bytes });
  const size = imageSize(mime, bytes);
  return { id, ratio: size && size.w > 0 && size.h > 0 ? size.w / size.h : 1 };
}
