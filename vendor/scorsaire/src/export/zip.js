/*
 * Minimal ZIP writer (PKZIP, no encryption, no Zip64): enough for a compressed MusicXML file (.mxl). PURE except `deflateRaw`, which uses the
 * platform's CompressionStream when it exists (Node ≥ 18, Safari ≥ 16.4, Chrome ≥ 80); otherwise the entries are STORED (still a valid archive).
 */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Raw deflate of `bytes` with CompressionStream, or null when the platform has none. */
export async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const le16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** @param files [{ name, data: Uint8Array }] @returns {Promise<Uint8Array>} the archive. */
export async function zip(files, { compress = true } = {}) {
  const chunks = []; const central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let body = f.data; let method = 0;
    if (compress && !f.store) { const d = await deflateRaw(f.data); if (d && d.length < f.data.length) { body = d; method = 8; } }
    const local = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...le16(20), ...le16(0x0800), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(body.length), ...le32(f.data.length), ...le16(name.length), ...le16(0), ...name]);
    chunks.push(local, body);
    central.push(Uint8Array.from([0x50, 0x4b, 0x01, 0x02, ...le16(20), ...le16(20), ...le16(0x0800), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(body.length), ...le32(f.data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name]));
    offset += local.length + body.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(centralSize), ...le32(offset), ...le16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/** The bytes of a compressed MusicXML file (`.mxl`) holding `xml` as `score.musicxml`. */
export async function buildMxl(xml, { name = 'score.musicxml' } = {}) {
  const enc = new TextEncoder();
  const container = '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="' + name + '" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n';
  return zip([{ name: 'META-INF/container.xml', data: enc.encode(container) }, { name, data: enc.encode(xml) }]);
}
