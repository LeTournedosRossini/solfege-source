// Samples for the school portal: a full synchro file (audio inside), the same file LIGHT (audio referenced by SHA-256) and the audio it refers to, laid out as the portal keeps it.
// The audio is OGG OPUS (what the portal accepts), encoded with ffmpeg (libopus): a pure tone, so these are test files, not a real song.
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const R = new URL('../src/', import.meta.url).href; // run: node tools/make-portal-samples.mjs <output folder>
const { setStrict, createDocument, sampleFullWork } = await import(R + 'model/index.js');
const { buildScorsaireArchive } = await import(R + 'model/container.js');
const { externalizeMedia } = await import(R + 'model/externalmedia.js');
setStrict(true);
const OUT = process.argv[2]; if (!OUT) { console.error('usage: node tools/make-portal-samples.mjs <output folder>'); process.exit(2); }
mkdirSync(OUT + '/audio/stems', { recursive: true });
const doc = createDocument(sampleFullWork());
const mv = doc.work.movements[0];
const ids = mv.masterbars.map((b) => b.id);
const rate = 22050, secs = 8, n = rate * secs;
/** A pure tone of `hz` as Ogg Opus bytes (a WAV made here, encoded by ffmpeg). */
function toneOpus(hz) {
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * hz) * 6000), 44 + i * 2);
  const tmp = `${OUT}/_tone.wav`; const dst = `${OUT}/_tone.opus`;
  writeFileSync(tmp, wav);
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libopus', '-b:a', '48k', '-f', 'ogg', dst]); } catch { console.error('ffmpeg with libopus is needed to write the Opus samples'); process.exit(1); }
  const bytes = new Uint8Array(readFileSync(dst)); rmSync(tmp); rmSync(dst);
  return bytes;
}
const opus = toneOpus(330);
const stem = { id: 'm1', name: 'drums', role: 'stem', ext: '.opus', bytes: opus };
const per = secs / ids.length;
const measures = ids.map((_, i) => ({ start: i * per, end: (i + 1) * per, beats: [0, 1, 2, 3].map((b) => i * per + b * per / 4) }));
const info = { source: 'audio', key: 'C major', duration: secs, bpm: 120, measureIds: ids, measures, stems: [{ id: 'm1', volume: 1, mute: false }] };
const scoreText = doc.save();
writeFileSync(OUT + '/full.scorsaire', await buildScorsaireArchive({ scoreText, sync: { ...info, media: [stem] } }));
const media = await externalizeMedia([stem]);
writeFileSync(OUT + '/light.scorsaire', await buildScorsaireArchive({ scoreText, sync: { ...info, media } }));
writeFileSync(OUT + '/audio/' + media[0].external.file, opus);
// another recording of the same length: the fingerprint differs (to see the warning)
writeFileSync(OUT + '/audio/stems/other.opus', toneOpus(440));
console.log(JSON.stringify(media[0].external));
