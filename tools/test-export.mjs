// Export vers Scorsaire (sous Node) : une phrase du répertoire, une phrase créée, plusieurs phrases (identifiants qui se ressemblent) ; le résultat est relu par le chargeur de Scorsaire.
// Usage : node tools/test-export.mjs <m1.json> <m2.json> (deux fichiers à un mouvement fabriqués dans deux processus séparés, voir fabriquer-document-test.mjs)
import fs from 'node:fs';
import { loadWork } from '../vendor/scorsaire/src/model/serialize.js';
import { buildSequence } from '../vendor/scorsaire/src/audio/sequence.js';
import { documentScorsaire, nomDeFichier } from '../src/app/oreille-export.js';
import { lireDocumentScorsaire } from '../src/app/oreille-import.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const phrases = JSON.parse(fs.readFileSync(new URL('../src/app/data/phrases.json', import.meta.url)));
const notes = (w) => w.movements.map((mv) => buildSequence(mv, { speed: 1 }).notes.length);
// 1) toutes les phrases du répertoire, en un seul document
const tout = documentScorsaire(phrases);
const w = loadWork(tout);
check(`répertoire : ${phrases.length} phrases en ${w.movements.length} mouvements, relus par Scorsaire`, w.movements.length === phrases.length);
const frere = phrases.findIndex((p) => p.title.startsWith('Frère'));
check('répertoire : « Frère Jacques » garde ses 8 notes et son titre', notes(w)[frere] === 8 && lireDocumentScorsaire(tout)[frere].title.startsWith('Frère'), `${notes(w)[frere]} notes`);
check('répertoire : le nombre de notes de chaque phrase est conservé', phrases.every((p, i) => notes(w)[i] === p.desc.measures.flatMap((m) => (Array.isArray(m) ? m : m.events)).reduce((t, e) => t + (e.n?.length ?? 0), 0)));
// 2) allers-retours avec l'import
const [m1, m2] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f)));
const note = (f) => ({ format: 'scorsaire-note', version: 1, work: f }); // une « note » de Scorsaire enveloppe un fichier .scorsaire
const crees = [{ title: 'Première', noteDoc: note(m1) }, { title: 'Seconde', noteDoc: note(m2) }];
const deux = documentScorsaire(crees);
const retour = lireDocumentScorsaire(deux);
check('créées : deux phrases aux identifiants identiques → un seul document valide', retour.length === 2 && retour[0].title === 'Première' && retour[1].title === 'Seconde', retour.map((r) => r.title).join(' | '));
check('créées : leurs notes sont conservées', JSON.stringify(notes(loadWork(deux))) === JSON.stringify(crees.map((c) => notes(loadWork(c.noteDoc.work))[0])), JSON.stringify(notes(loadWork(deux))));
const seule = documentScorsaire([crees[0]]);
check('une seule phrase : un mouvement, relu', loadWork(seule).movements.length === 1 && lireDocumentScorsaire(seule)[0].title === 'Première');
check('noms de fichier', nomDeFichier('Ma petite phrase — été') === 'Ma-petite-phrase-ete.scorsaire' && nomDeFichier('') === 'phrases.scorsaire' && nomDeFichier('???') === 'phrases.scorsaire', nomDeFichier('Ma petite phrase — été'));
check('phrase vide refusée', (() => { try { documentScorsaire([]); return false; } catch { return true; } })());
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
