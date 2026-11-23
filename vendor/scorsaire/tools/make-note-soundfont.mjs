// Builds the small SoundFonts of the note component from GeneralUser GS (S. Christian Collins, GeneralUser GS License v2.0: modification and redistribution allowed).
//   node tools/make-note-soundfont.mjs [--src GeneralUser-GS.sf2] [--out dist/note/sounds] [--quality 4] [--maxrate 0] [--report]
// Which sounds go where: src/note/soundmap.js (shared with the component). Keeps only the presets a note can use, encodes the samples as Ogg Vorbis (SF3) with ffmpeg (libvorbis) and writes
//   note-all.sf3          ONE file with every sound (option 1)
//   note-<family>.sf3     one file per family (option 2): piano, guitars (guitars + bass), strings, winds, drums
// `--maxrate 32000` also lowers the sample rate of the samples above it (smaller files, duller top). Needs ffmpeg in the PATH.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SoundBankLoader } from 'spessasynth_core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : dflt; };
const src = arg('src', path.resolve(root, '..', '..', 'GeneralUser-GS.sf2'));
const out = arg('out', path.join(root, 'dist', 'note', 'sounds'));
const quality = Number(arg('quality', 4));
const maxRate = Number(arg('maxrate', 0));

import { SOUND_FAMILIES as FAMILIES, SINGLE_FILE, soundFile } from '../src/note/soundmap.js';
const programsOf = (families) => families.flatMap((f) => (FAMILIES[f] === 'drums' ? ['drums'] : FAMILIES[f]));

/** Ogg Vorbis encoder for the library: raw float32 mono in, Ogg out, through ffmpeg. */
function encodeVorbis(audio, rate) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', String(quality), '-f', 'ogg', 'pipe:1']);
    const chunks = []; let err = '';
    p.stdout.on('data', (c) => chunks.push(c)); p.stderr.on('data', (c) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`ffmpeg ${code}: ${err}`))));
    p.stdin.end(Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
  });
}

const loadBank = () => { const b = fs.readFileSync(src); return SoundBankLoader.fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const isDrumKit = (p) => p.isGMGSDrum && p.program === 0 && /^Standard 1\b/.test(p.name);
const wanted = (p, programs) => (isDrumKit(p) ? programs.includes('drums') : !p.isGMGSDrum && p.bankMSB === 0 && p.bankLSB === 0 && programs.includes(p.program));

async function build(name, families) {
  const programs = programsOf(families);
  const bank = loadBank();
  // a single drum kit (the first one of that name) and one preset per program
  const seen = new Set();
  for (const p of [...bank.presets]) {
    const key = isDrumKit(p) ? 'drums' : p.program;
    if (!wanted(p, programs) || seen.has(key)) { bank.deletePreset(p); continue; }
    seen.add(key);
  }
  bank.removeUnusedElements();
  if (maxRate > 0) for (const s of bank.samples) if (s.sampleRate > maxRate) s.resampleData(maxRate);
  const before = bank.samples.length;
  let done = 0;
  await bank.setSampleFormat({ format: 'compressed', compressionFunction: encodeVorbis, progressFunction: (f) => { const n = Math.floor(f * 10); if (n > done) { done = n; process.stdout.write('.'); } } });
  bank.soundBankInfo.name = `Scorsaire note — ${name}`;
  const data = Buffer.from(bank.writeSF2({ software: 'Scorsaire (SpessaSynth, ffmpeg libvorbis)' }));
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, name === 'all' ? SINGLE_FILE : soundFile(name));
  fs.writeFileSync(file, data);
  console.log(` ${path.relative(root, file)} : ${(data.length / 1048576).toFixed(2)} Mo, ${bank.presets.length} presets, ${before} samples, ${[...seen].join(' ')}`);
  return { file, size: data.length };
}

console.log(`source ${src}; Vorbis quality ${quality}${maxRate ? `, rate ≤ ${maxRate}` : ''}`);
const sizes = {};
sizes.all = (await build('all', Object.keys(FAMILIES))).size;
for (const f of Object.keys(FAMILIES)) sizes[f] = (await build(f, [f])).size;
const sum = Object.keys(FAMILIES).reduce((t, f) => t + sizes[f], 0);
console.log(`one file: ${(sizes.all / 1048576).toFixed(2)} Mo; by family: ${Object.keys(FAMILIES).map((f) => `${f} ${(sizes[f] / 1048576).toFixed(2)}`).join(', ')} (total ${(sum / 1048576).toFixed(2)} Mo)`);
