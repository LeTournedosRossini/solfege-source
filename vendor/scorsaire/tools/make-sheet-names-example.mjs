// Writes a REAL file of the current format (version 57) with the sheet option « staff names » (tools/portail/feuilles-exemples/feuille-noms-portees.scorsaire), for the portal's tests:
// one sheet of two cells showing the same movement; the sheet writes the names of the staves, the second cell hides them (a cell's own choice wins), and the reader may change it (lock `names` open).
// Usage: node tools/make-sheet-names-example.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, createStarterScore, setStrict, serializeWork, addSheet, addCell, setReaderOption, setReaderUnlock, setCellOption, sheetCells } from '../src/model/index.js';
import { buildScorsaireArchive } from '../src/model/container.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'portail', 'feuilles-exemples');
fs.mkdirSync(out, { recursive: true });
setStrict(true);
const doc = createDocument(createStarterScore({ lang: 'fr' }));
doc.transaction('example', () => {
  const sheet = addSheet(doc, { name: 'Noms des portées' });
  setReaderOption(doc, sheet.id, 'showNames', true);
  setReaderUnlock(doc, sheet.id, 'names', true);
  addCell(doc, sheet.id, doc.work.movements[0].id);
  setCellOption(doc, sheet.id, sheetCells(doc.work, sheet)[1].id, 'showNames', false);
});
fs.writeFileSync(path.join(out, 'feuille-noms-portees.scorsaire'), await buildScorsaireArchive({ scoreText: serializeWork(doc.work) }));
console.log('written', path.join(out, 'feuille-noms-portees.scorsaire'));
