// Lists the movements of a `.scorsaire` file as JSON: node tools/list-movements.mjs <file>
// Works on the plain JSON form and on the ZIP form (reads `score.json`). Nothing is executed or written.
import { readFileSync } from 'node:fs';
import { isScorsaireArchive, readScorsaireArchive } from '../src/model/container.js';
import { listMovements } from '../src/model/movementlist.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/list-movements.mjs <file.scorsaire>'); process.exit(2); }
const bytes = new Uint8Array(readFileSync(file));
const text = isScorsaireArchive(bytes) ? (await readScorsaireArchive(bytes)).scoreText : new TextDecoder().decode(bytes);
console.log(JSON.stringify(listMovements(text), null, 2));
