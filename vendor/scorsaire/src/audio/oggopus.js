/*
 * Ogg Opus (RFC 7845) for the audio export: the muxer is pure (the packets of an Opus stream in, the bytes of a `.opus` file out) and runs under Node; `encodeOpus` makes the packets with the
 * browser's own encoder (WebCodecs `AudioEncoder`), so it only exists where the browser has one.
 */
const OPUS_RATE = 48000; // Opus counts its samples at 48 kHz whatever the rate it was fed
export const OPUS_PRE_SKIP = 312;

let table = null;
/** The CRC of an Ogg page (polynomial 0x04C11DB7, no reflection, no final xor). */
export function oggCrc(bytes) {
  if (!table) { table = new Uint32Array(256); for (let i = 0; i < 256; i += 1) { let r = i << 24; for (let k = 0; k < 8; k += 1) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1); table[i] = r >>> 0; } }
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) crc = ((crc << 8) ^ table[((crc >>> 24) ^ bytes[i]) & 255]) >>> 0;
  return crc;
}

/** One page: `packets` (whole ones) with the granule position of the end of the last of them. */
function page({ packets, granule, serial, sequence, flags }) {
  const segs = [];
  for (const p of packets) { let l = p.length; while (l >= 255) { segs.push(255); l -= 255; } segs.push(l); }
  const size = 27 + segs.length + packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size); const view = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, flags]); // « OggS », version 0
  view.setUint32(6, Number(BigInt.asUintN(32, BigInt(granule))), true); view.setUint32(10, Number(BigInt.asUintN(32, BigInt(granule) >> 32n)), true);
  view.setUint32(14, serial, true); view.setUint32(18, sequence, true);
  out[26] = segs.length; out.set(segs, 27);
  let at = 27 + segs.length;
  for (const p of packets) { out.set(p, at); at += p.length; }
  view.setUint32(22, oggCrc(out), true);
  return out;
}

const textBytes = (s) => new TextEncoder().encode(s);

/**
 * @param packets  [{ data: Uint8Array, samples }] — the packets in order; `samples` = the length of each at 48 kHz (960 for 20 ms)
 * @param o        { channels = 2, inputRate = 48000, preSkip = 312, length (the samples of audio at 48 kHz, so the end is cut where the music ends), serial, vendor }
 * @returns {Uint8Array} an Ogg Opus file
 */
export function muxOggOpus(packets, { channels = 2, inputRate = OPUS_RATE, preSkip = OPUS_PRE_SKIP, length = null, serial = 0x5c0a5a1e, vendor = 'Scorsaire' } = {}) {
  const head = new Uint8Array(19); const hv = new DataView(head.buffer);
  head.set(textBytes('OpusHead')); head[8] = 1; head[9] = channels; hv.setUint16(10, preSkip, true); hv.setUint32(12, inputRate, true); hv.setUint16(16, 0, true); head[18] = 0;
  const v = textBytes(vendor); const tags = new Uint8Array(8 + 4 + v.length + 4); const tv = new DataView(tags.buffer);
  tags.set(textBytes('OpusTags')); tv.setUint32(8, v.length, true); tags.set(v, 12); tv.setUint32(12 + v.length, 0, true);
  const pages = [page({ packets: [head], granule: 0, serial, sequence: 0, flags: 2 }), page({ packets: [tags], granule: 0, serial, sequence: 1, flags: 0 })];
  let sequence = 2; let total = 0; let batch = []; let batchSegs = 0;
  const decoded = packets.reduce((n, p) => n + p.samples, 0);
  const finalGranule = length === null ? decoded : Math.min(decoded, preSkip + length);
  const flush = (last) => {
    if (!batch.length) return;
    total += batch.reduce((n, p) => n + p.samples, 0);
    pages.push(page({ packets: batch.map((p) => p.data), granule: last ? finalGranule : total, serial, sequence, flags: last ? 4 : 0 }));
    sequence += 1; batch = []; batchSegs = 0;
  };
  for (const p of packets) {
    const segs = Math.floor(p.data.length / 255) + 1;
    if (batchSegs + segs > 255 || batch.length >= 50) flush(false); // (about a second a page: a player can seek)
    batch.push(p); batchSegs += segs;
  }
  flush(true);
  const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of pages) { out.set(p, at); at += p.length; }
  return out;
}

/** True where the browser can encode Opus. */
export const canEncodeOpus = async (bitrate = 128000) => {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try { return !!(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 2, bitrate })).supported; } catch { return false; }
};

/**
 * Encodes a stereo buffer at 48 kHz with the browser's Opus encoder and returns the bytes of the `.opus` file.
 * @param o { left, right, bitrate (bits per second), onProgress, signal }
 */
export async function encodeOpus({ left, right, bitrate = 128000, onProgress = () => {}, signal = null }) {
  if (!(await canEncodeOpus(bitrate))) throw Object.assign(new Error('Opus encoding is not available in this browser'), { code: 'unsupported' });
  const packets = []; let failure = null; let preSkip = OPUS_PRE_SKIP;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      packets.push({ data, samples: chunk.duration ? Math.round(chunk.duration * OPUS_RATE / 1e6) : 960 });
      const d = meta?.decoderConfig?.description;
      if (d && packets.length === 1) { const bytes = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength); if (bytes.length >= 12) preSkip = bytes[10] | (bytes[11] << 8); }
    },
    error: (e) => { failure = e; },
  });
  encoder.configure({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 2, bitrate });
  const block = OPUS_RATE; // one second per call
  for (let at = 0; at < left.length; at += block) {
    if (signal?.aborted) { encoder.close(); throw Object.assign(new Error('aborted'), { code: 'aborted' }); }
    if (failure) throw failure;
    const n = Math.min(block, left.length - at);
    const data = new Float32Array(n * 2); data.set(left.subarray(at, at + n), 0); data.set(right.subarray(at, at + n), n);
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: OPUS_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(at * 1e6 / OPUS_RATE), data }));
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5)); // (do not pile the whole piece into the queue)
    onProgress(Math.min(1, (at + n) / left.length));
  }
  await encoder.flush(); encoder.close();
  if (failure) throw failure;
  return muxOggOpus(packets, { preSkip, length: left.length });
}
