// Writes three realistic example notes for the portal's tests (tools/portail/note-exemples/*.json): a melody of four measures with its chord symbols, a guitar tablature and a drum groove,
// each with a `text` (1000 characters for the first). They are written with the editor's OWN functions (the same `enterNote` / `setCellChord` the taps call), so they are what a teacher
// would write; nothing here needs a browser. Usage: node tools/make-note-examples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newNoteDocument, addMeasure, noteStaff, setChordsShown, movementOf } from '../src/note/editmodel.js';
import { createNoteDocument, stringifyNoteDocument } from '../src/note/document.js';
import { enterNote, DEFAULT_ENTRY } from '../src/ui/noteentry-intents.js';
import { setCellChord } from '../src/ui/chordentry-intents.js';
import { getProperty, PID } from '../src/model/index.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'portail', 'note-exemples');
fs.mkdirSync(out, { recursive: true });

const SENTENCE = "Jouez cette phrase lentement, d'abord en comptant à voix haute ; puis ajoutez le métronome à soixante, et montez de cinq battements par minute chaque fois que vous la jouez deux fois sans erreur. ";
const longText = (n) => { let s = 'Consigne de la semaine. '; while (s.length < n) s += SENTENCE; return s.slice(0, n - 1).trimEnd() + '.'; };
const beat = (b) => [b, 4]; // the position of a beat of a 4/4 measure, as a fraction of a whole note

/** Puts notes on measure `mi`: [[beat, line | sound]]. A drum hit's `line` is its sound's line, found by the editor from `entry.sound`. */
function put(doc, mi, notes, entry) {
  const staff = noteStaff(doc); const mb = movementOf(doc).masterbars[mi];
  for (const [b, where] of notes) {
    const hit = { staffId: staff.id, staffType: getProperty(staff, PID.STAFF_TYPE), measureId: mb.id, measureIndex: mi, position: beat(b), voice: 0, line: Number.isInteger(where) ? where : 0 };
    const sound = typeof where === 'string' ? where : null;
    if (sound) { const line = (getProperty(staff, PID.PERCMAP)?.sounds ?? []).find((s) => s.id === sound)?.line; hit.line = line; }
    doc.transaction('enter note', () => enterNote(doc, hit, { ...DEFAULT_ENTRY, ...entry, ...(sound ? { sound } : {}) }));
  }
}
const only = process.argv.slice(2); // `node tools/make-note-examples.mjs phrase-batterie` rewrites that example only (the others are already recorded at the portal)
const save = (name, doc, text) => {
  if (only.length && !only.includes(name)) return;
  const json = stringifyNoteDocument(createNoteDocument(doc.work, { text }));
  fs.writeFileSync(path.join(out, `${name}.json`), `${json}\n`);
  console.log(name, `${json.length} bytes, text ${text.length} characters`);
};

// 1. a melody in C (treble clef: line 0 = F5 at the top, 8 = E4 at the bottom, 10 = C4) with its chords C – Am – F – G7
{
  const doc = newNoteDocument({ kind: 'score', clef: 'G', timeSig: [4, 4], keySig: 0 });
  for (let i = 0; i < 3; i += 1) addMeasure(doc);
  const e4 = 8; const step = (n) => e4 - n; // n half-spaces above E4 (C4 = −2)
  const melody = [[-2, 0, 2, 4], [5, 4, 2, 0], [-1, 1, 3, 5], [4, 2, 0, -2]];
  melody.forEach((m, mi) => put(doc, mi, m.map((n, b) => [b, step(n)]), { duration: { base: 'quarter', dots: 0 } }));
  doc.transaction('chords', () => setChordsShown(doc, true, { lang: 'fr' }));
  const chords = [['C', ''], ['A', 'm'], ['F', ''], ['G', '7']];
  const chordStaff = movementOf(doc).tracks.find((t) => t.staves[0] && getProperty(t.staves[0], PID.STAFF_TYPE) === 'chord').staves[0];
  chords.forEach(([step, quality], mi) => doc.transaction('chord', () => setCellChord(doc, { staffId: chordStaff.id, measureId: movementOf(doc).masterbars[mi].id, cell: 0 }, { root: { step, alter: 0 }, quality })));
  save('phrase-accords', doc, longText(1000));
}

// 2. a guitar tablature, two measures: an open-position riff (line = string − 1, from the top: 0 = the high E)
{
  const doc = newNoteDocument({ kind: 'guitar' });
  addMeasure(doc);
  const riff = [[[0, 4], [1, 4], [2, 3], [3, 3]], [[0, 5], [1, 5], [2, 4], [3, 4]]]; // [beat, string line]
  const frets = [[0, 2, 0, 3], [0, 2, 0, 3]];
  riff.forEach((m, mi) => m.forEach(([b, line], k) => put(doc, mi, [[b, line]], { duration: { base: 'quarter', dots: 0 }, fret: frets[mi][k] })));
  save('phrase-tablature', doc, 'Riff de la semaine : cordes à vide et deuxième case, bien détaché.');
}

// 3. a drum groove (written with the drum map of Scorsaire, sound ids of its 23 sounds), two measures: kick on 1 and 3, snare on 2 and 4, hi-hat on every beat
{
  const doc = newNoteDocument({ kind: 'drums' });
  addMeasure(doc);
  for (let mi = 0; mi < 2; mi += 1) {
    put(doc, mi, [[0, 'bassDrum1'], [2, 'bassDrum1']], { duration: { base: 'quarter', dots: 0 } });
    put(doc, mi, [[1, 'acousticSnare'], [3, 'acousticSnare']], { duration: { base: 'quarter', dots: 0 } });
    put(doc, mi, [0, 1, 2, 3].map((b) => [b, 'closedHiHat']), { duration: { base: 'quarter', dots: 0 } });
  }
  save('phrase-batterie', doc, 'Groove rock : grosse caisse sur 1 et 3, caisse claire sur 2 et 4, charleston sur chaque temps.');
}
