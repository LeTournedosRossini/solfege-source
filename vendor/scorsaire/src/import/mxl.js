/*
 * Reader for compressed MusicXML (.mxl = a ZIP holding META-INF/container.xml and the score). PURE except `inflateRaw`, which prefers the
 * platform's DecompressionStream and falls back to a small built-in inflate (older Safari, ≥ 15.4 is targeted).
 * No encryption, no Zip64, no multi-disk archives.
 */
import { parseXml, child, childrenOf } from './xml.js';

// ---------- small inflate (RFC 1951) ----------

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Canonical Huffman table from code lengths: { counts, symbols }. */
function buildHuffman(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l] += 1;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i += 1) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((l, sym) => { if (l) { symbols[offs[l]] = sym; offs[l] += 1; } });
  return { counts, symbols };
}

const FIXED_LIT = (() => { const l = []; for (let i = 0; i < 288; i += 1) l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8); return buildHuffman(l); })();
const FIXED_DIST = buildHuffman(new Array(30).fill(5));

/** Inflates a raw deflate stream (synchronous). `sizeHint` = expected output size. */
export function inflateSync(src, sizeHint = 0) {
  let out = new Uint8Array(Math.max(sizeHint, src.length * 4, 1024));
  let outPos = 0;
  let pos = 0; let bitBuf = 0; let bitCnt = 0;
  const need = (extra) => {
    if (outPos + extra <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outPos + extra));
    bigger.set(out.subarray(0, outPos));
    out = bigger;
  };
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('inflate: unexpected end of data');
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n; bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0; let first = 0; let index = 0;
    for (let len = 1; len < 16; len += 1) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('inflate: invalid Huffman code');
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) throw new Error('inflate: truncated stored block');
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      need(len);
      out.set(src.subarray(pos, pos + len), outPos);
      outPos += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit = FIXED_LIT; let dist = FIXED_DIST;
      if (type === 2) {
        const nlen = bits(5) + 257; const ndist = bits(5) + 1; const ncode = bits(4) + 4;
        const cl = new Array(19).fill(0);
        for (let i = 0; i < ncode; i += 1) cl[CL_ORDER[i]] = bits(3);
        const clh = buildHuffman(cl);
        const lengths = [];
        while (lengths.length < nlen + ndist) {
          const sym = decode(clh);
          if (sym < 16) lengths.push(sym);
          else {
            let rep; let val = 0;
            if (sym === 16) { if (!lengths.length) throw new Error('inflate: bad repeat'); val = lengths[lengths.length - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            for (let k = 0; k < rep; k += 1) lengths.push(val);
          }
        }
        lit = buildHuffman(lengths.slice(0, nlen));
        dist = buildHuffman(lengths.slice(nlen));
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { need(1); out[outPos++] = sym; } else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) throw new Error('inflate: bad length symbol');
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const di = decode(dist);
          if (di >= 30) throw new Error('inflate: bad distance symbol');
          const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
          if (d > outPos) throw new Error('inflate: distance too far back');
          need(len);
          for (let k = 0; k < len; k += 1) { out[outPos] = out[outPos - d]; outPos += 1; }
        }
      }
    } else throw new Error('inflate: invalid block type');
  }
  return out.subarray(0, outPos);
}

/** Inflates raw deflate bytes: DecompressionStream when the platform has it, the built-in inflate otherwise. */
export async function inflateRaw(bytes, sizeHint = 0) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* fall through to the built-in inflate */ }
  }
  return inflateSync(bytes, sizeHint);
}

// ---------- ZIP ----------

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export class MxlError extends Error {}

/** Entries of a ZIP archive: [{ name, method, compressedSize, size, offset }]. */
export function zipEntries(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { end = i; break; }
  }
  if (end < 0) throw new MxlError('Not a ZIP archive');
  const count = u16(bytes, end + 10);
  let p = u32(bytes, end + 16);
  const dec = new TextDecoder();
  const entries = [];
  for (let k = 0; k < count; k += 1) {
    if (u32(bytes, p) !== 0x02014b50) throw new MxlError('Corrupt ZIP directory');
    const nameLen = u16(bytes, p + 28); const extraLen = u16(bytes, p + 30); const commentLen = u16(bytes, p + 32);
    entries.push({
      method: u16(bytes, p + 10), compressedSize: u32(bytes, p + 20), size: u32(bytes, p + 24), offset: u32(bytes, p + 42),
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Bytes of one entry of the archive. */
export async function zipRead(bytes, entry) {
  const o = entry.offset;
  if (u32(bytes, o) !== 0x04034b50) throw new MxlError('Corrupt ZIP entry');
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw, entry.size);
  throw new MxlError(`Unsupported ZIP compression method ${entry.method}`);
}

/** Decodes the bytes of an XML file: UTF-8 (with or without BOM), UTF-16 (BOM), or the encoding declared in the prolog when TextDecoder knows it. */
export function decodeXmlBytes(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  if (declared && !/^utf-?8$/i.test(declared)) {
    try { return new TextDecoder(declared).decode(bytes); } catch { /* unknown label: use UTF-8 */ }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** True when the bytes start like a ZIP archive. */
export const looksLikeZip = (bytes) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);

/** Text of the score inside a compressed MusicXML archive (rootfile of container.xml, else the first non-META-INF .xml / .musicxml). */
export async function readMxl(bytes) {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let rootName = null;
  const container = byName.get('META-INF/container.xml');
  if (container) {
    const root = parseXml(decodeXmlBytes(await zipRead(bytes, container)));
    const files = childrenOf(child(root, 'rootfiles'), 'rootfile');
    const score = files.find((f) => !/pdf|image/i.test(f.attrs['media-type'] ?? '')) ?? files[0];
    rootName = score?.attrs['full-path'] ?? null;
  }
  const entry = (rootName && byName.get(rootName))
    ?? entries.find((e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name));
  if (!entry) throw new MxlError('No score found in the archive');
  return decodeXmlBytes(await zipRead(bytes, entry));
}
