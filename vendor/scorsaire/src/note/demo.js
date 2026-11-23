// Demo documents for the test page and the tests (never shipped inside the component bundles).
import { createScore } from '../model/newscore.js';
import { createNoteChord } from '../model/elements.js';
import { createDocument } from '../model/document.js';
import { placeChord } from '../model/noteedit.js';
import { frac } from '../model/fraction.js';
import { createNoteDocument } from './document.js';

/** Two measures of 4/4 in treble clef: a rising C major figure, then a falling one. */
export function demoMelodyDocument({ lang = 'fr' } = {}) {
  const work = createScore({ measures: 2, parts: [{ staffType: 'score', clef: 'G' }], tempo: { bpm: 90 }, lang });
  const staff = work.movements[0].tracks[0].staves[0];
  const doc = createDocument(work);
  const rows = [['C4', 'D4', 'E4', 'G4'], ['A4', 'G4', 'E4', 'C4']];
  doc.transaction('demo', () => {
    rows.forEach((row, measure) => row.forEach((name, k) => placeChord(doc, {
      staff, measure, position: frac(k, 4), duration: { base: 'quarter', dots: 0 },
      makeChord: (d) => createNoteChord([{ step: name[0], alter: 0, octave: Number(name[1]) }], { duration: d.base, dots: d.dots }),
    })));
  });
  return createNoteDocument(doc.work);
}
