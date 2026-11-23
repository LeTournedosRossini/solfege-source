// Fabrique un document Scorsaire de test à trois mouvements (sert au test d'import). Usage : node tools/fabriquer-document-test.mjs <sortie.scorsaire>
import fs from 'node:fs';
import { createScore } from '../vendor/scorsaire/src/model/newscore.js';
import { createNoteChord } from '../vendor/scorsaire/src/model/elements.js';
import { createDocument } from '../vendor/scorsaire/src/model/document.js';
import { placeChord } from '../vendor/scorsaire/src/model/noteedit.js';
import { frac } from '../vendor/scorsaire/src/model/fraction.js';
import { serializeWork } from '../vendor/scorsaire/src/model/serialize.js';
const make = (title, notes, measures) => {
  const work = createScore({ title, measures, parts: [{ staffType: 'score', clef: 'G' }], tempo: { bpm: 100 }, lang: 'fr' });
  const mv = work.movements[0];
  const staff = mv.tracks[0].staves[0], doc = createDocument(work);
  doc.transaction('t', () => notes.forEach((nn, k) => placeChord(doc, { staff, measure: Math.floor(k / 4), position: frac(k % 4, 4), duration: { base: 'quarter', dots: 0 }, makeChord: (d) => createNoteChord([nn], { duration: d.base, dots: d.dots }) })));
  return work;
};
const n = (step, octave, alter = 0) => ({ step, alter, octave });
const a = make('Montée', [n('C', 4), n('D', 4), n('E', 4), n('F', 4)], 1);
const b = make('Retour', [n('G', 4), n('F', 4), n('E', 4), n('D', 4), n('C', 4), n('E', 4), n('G', 4), n('C', 5)], 2);
const c = make('Long (5 mesures)', Array.from({ length: 20 }, (_, i) => n('CDEFGAB'[i % 7], 4)), 5);
a.movements.push(b.movements[0], c.movements[0]);
fs.writeFileSync(process.argv[2], serializeWork(a));
console.log('écrit', process.argv[2], a.movements.length, 'mouvements');
