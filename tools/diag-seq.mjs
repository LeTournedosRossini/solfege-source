// Diagnostic en Node : la séquence de la leçon, et ce que contient son automation.
import { createScore } from '../vendor/scorsaire/src/model/newscore.js';
import { createNoteChord } from '../vendor/scorsaire/src/model/elements.js';
import { createDocument } from '../vendor/scorsaire/src/model/document.js';
import { placeChord } from '../vendor/scorsaire/src/model/noteedit.js';
import { frac } from '../vendor/scorsaire/src/model/fraction.js';
import { createNoteDocument, parseNoteDocument } from '../vendor/scorsaire/src/note/document.js';
import { buildSequence } from '../vendor/scorsaire/src/audio/sequence.js';
const work = createScore({ measures: 2, parts: [{ staffType: 'score', clef: 'G' }], tempo: { bpm: 90 }, lang: 'fr' });
const staff = work.movements[0].tracks[0].staves[0];
const doc = createDocument(work);
const rows = [['C4', 'D4', 'E4', 'F4'], ['G4', 'A4', 'B4', 'C5']];
doc.transaction('d', () => rows.forEach((row, m) => row.forEach((n, k) => placeChord(doc, { staff, measure: m, position: frac(k, 4), duration: { base: 'quarter', dots: 0 }, makeChord: (d) => createNoteChord([{ step: n[0], alter: 0, octave: Number(n[1]) }], { duration: d.base, dots: d.dots }) }))));
const nd = createNoteDocument(doc.work);
const seq = buildSequence(parseNoteDocument(nd).movement, { speed: 1 });
console.log('clés de la séquence :', Object.keys(seq));
console.log('pistes :', JSON.stringify(seq.tracks).slice(0, 300));
for (const k of Object.keys(seq)) if (/auto|curve|mix/i.test(k)) console.log(k, JSON.stringify(seq[k]).slice(0, 600));
console.log('notes :', seq.notes.length, 'fin :', Math.max(...seq.notes.map((n) => n.t + n.duration)));

// Le moteur SoundFont, sans synthé (Node), peut-il charger cette séquence ?
const { SoundFontEngine } = await import('../vendor/scorsaire/src/audio/soundfont-engine.js');
const fakeCtx = { currentTime: 0, state: 'running', destination: {}, sampleRate: 44100 };
const t0 = Date.now();
try {
  const e = new SoundFontEngine({ context: fakeCtx });
  console.log('engine créé');
  e.load(seq);
  console.log('load terminé en', Date.now() - t0, 'ms');
} catch (err) { console.log('erreur :', err.message); }
