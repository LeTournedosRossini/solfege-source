// Converts the WHOLE GeneralUser GS SoundFont into an SF3 (samples as Ogg Vorbis): `node tools/make-full-soundfont.mjs [--src GeneralUser-GS.sf2] [--out GeneralUser-GS.sf3] [--quality 6] [--maxrate 0]`
// Unlike make-note-soundfont.mjs nothing is removed: every preset, every sample (so the editor can play any sound of the bank). GeneralUser GS License v2.0 allows modification and redistribution.
// Vorbis quality 6 (about 192 kb/s) keeps more of the top than the note component's 4. Needs ffmpeg (libvorbis) in the PATH.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SoundBankLoader } from 'spessasynth_core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : dflt; };
const src = arg('src', path.resolve(root, '..', '..', 'GeneralUser-GS.sf2'));
const out = arg('out', path.resolve(root, 'dist', 'GeneralUser-GS.sf3'));
const quality = Number(arg('quality', 6));
const maxRate = Number(arg('maxrate', 0));

function encodeVorbis(audio, rate) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', String(quality), '-f', 'ogg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', (c) => chunks.push(c)); p.stderr.on('data', (c) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`ffmpeg ${code}: ${err}`))));
    p.stdin.end(Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
  });
}

const b = fs.readFileSync(src);
const bank = SoundBankLoader.fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
if (maxRate > 0) for (const s of bank.samples) if (s.sampleRate > maxRate) s.resampleData(maxRate);
console.log(`source ${src} (${(b.length / 1048576).toFixed(1)} Mo), ${bank.presets.length} presets, ${bank.samples.length} samples; Vorbis quality ${quality}`);
const t0 = Date.now(); let done = 0;
await bank.setSampleFormat({ format: 'compressed', compressionFunction: encodeVorbis, progressFunction: (f) => { const n = Math.floor(f * 20); if (n > done) { done = n; process.stdout.write(`${n * 5}% `); } } });
const data = Buffer.from(bank.writeSF2({ software: 'Scorsaire (SpessaSynth, ffmpeg libvorbis)' }));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, data);
console.log(`\n${out} : ${(data.length / 1048576).toFixed(2)} Mo en ${Math.round((Date.now() - t0) / 1000)} s`);
