/*
 * WAV (RIFF, PCM) writer for the audio export: 16 or 24 bits, stereo or mono, from float channels in [-1, 1]. Pure: no DOM.
 */
const clamp = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

/** @returns {Uint8Array} the bytes of the file. `channels` = [Float32Array, …] of the same length (one or two). */
export function encodeWav({ channels, sampleRate, bits = 16 }) {
  if (!channels?.length) throw new Error('no channel');
  if (bits !== 16 && bits !== 24) throw new Error(`unsupported depth: ${bits}`);
  const n = channels[0].length; const count = channels.length; const bytes = bits / 8;
  const dataSize = n * count * bytes;
  const out = new Uint8Array(44 + dataSize); const view = new DataView(out.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * bytes, true); view.setUint16(32, count * bytes, true); view.setUint16(34, bits, true);
  text(36, 'data'); view.setUint32(40, dataSize, true);
  let at = 44;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < count; c += 1) {
      const s = clamp(channels[c][i]);
      if (bits === 16) { view.setInt16(at, Math.round(s < 0 ? s * 32768 : s * 32767), true); at += 2; } else {
        const v = Math.round(s < 0 ? s * 8388608 : s * 8388607);
        out[at] = v & 255; out[at + 1] = (v >> 8) & 255; out[at + 2] = (v >> 16) & 255; at += 3;
      }
    }
  }
  return out;
}
