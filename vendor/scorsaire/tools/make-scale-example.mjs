// Writes the example file for the portal's tests (tools/portail/gammes-exemples/gammes-exemple.scorsaire): a score with a SCALE MOVEMENT (D dorian, written here for the guitar: a reader replaces
// it by what suits `instrument=`) and a SCALE CONTAINER (an « encart » of A minor pentatonic above the guitar staff, measures 5 to 8). Usage: node tools/make-scale-example.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, createStarterScore, setStrict, PID, serializeWork } from '../src/model/index.js';
import { buildScorsaireArchive } from '../src/model/container.js';
import { createScaleMovement, addScaleContainer } from '../src/scales/write.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'portail', 'gammes-exemples');
fs.mkdirSync(out, { recursive: true });
setStrict(true);
const doc = createDocument(createStarterScore({ lang: 'fr' }));
const mv = doc.work.movements[0];
doc.transaction('example', () => {
  const track = mv.tracks.find((t) => t.staves.some((s) => s.props[PID.STAFF_TYPE] === 'tab'));
  addScaleContainer(doc, mv, track.staves[0], { recipe: { scale: 'minor_pentatonic', root: 'A' }, measureId: mv.masterbars[4].id, span: 4 });
  createScaleMovement(doc, { recipe: { scale: 'dorian', root: 'D', instrument: 'guitar6' }, title: 'Ré dorien' });
});
// a ZIP with `score.json` (like the other .scorsaire files of the portal), without audio
fs.writeFileSync(path.join(out, 'gammes-exemple.scorsaire'), await buildScorsaireArchive({ scoreText: serializeWork(doc.work) }));
console.log('written', path.join(out, 'gammes-exemple.scorsaire'));
