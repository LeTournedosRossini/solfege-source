#!/usr/bin/env node
/*
 * Builds the folder the school portal deploys: `node tools/publish-portail.mjs [output folder]` (default: dist/portail).
 *   - builds the readers first (`node tools/build.js --min`);
 *   - writes the three readers under VERSIONED names (the name carries the first 8 digits of the SHA-256 of the page, so a new page always has a new name and
 *     a long cache never serves an old one): partitions/feuilles/, partitions/synchro/, partitions/youtube/ ;
 *   - also builds the NOTE component (the musical note pad, `node tools/build-note.mjs --min`) and writes it under `partitions/bloc-notes/`: the two entries under versioned names
 *     (`scorsaire-note-view-<8 digits>.js`, `scorsaire-note-edit-<8 digits>.js`), their `chunks/` and two trial pages (`essai-lecture.html`, `essai-edition.html`); the small SoundFonts stay on GitHub;
 *   - writes `SHA256SUMS` (check with `sha256sum -c SHA256SUMS` from that folder), `manifest.json` (which file is which reader) and `LISEZMOI.txt` (the address parameters);
 *   - also copies, for the people who build the portal side: `outils/` (the movement lister with no dependency), `documents/` (our answers and the message), and `exemples/` (the
 *     files of docs/portail-exemples when they exist: `node tools/make-portal-samples.mjs docs/portail-exemples`, plus any light file written by the editor and put there);
 *   - touches only what it writes (`partitions/`, `outils/`, `documents/`, `exemples/` and those three files). Nothing is sent anywhere, no CI.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrumentsManifest } from '../src/scales/manifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'portail'));
const READERS = [
  { key: 'feuilles', from: 'scorsaire-lecteur.html', what: 'feuilles d\'exercices (écran 3)' },
  { key: 'synchro', from: 'scorsaire-synchro.html', what: 'morceau avec audio ou vidéo et partition (écran 4)' },
  { key: 'youtube', from: 'scorsaire-youtube.html', what: 'vidéo YouTube et fragments de partition (écran 5)' },
];

execFileSync('node', ['tools/build.js', '--min'], { cwd: root, stdio: 'inherit' });
for (const d of ['partitions', 'outils', 'documents', 'exemples']) fs.rmSync(path.join(out, d), { recursive: true, force: true });
const files = {}; const sums = [];
for (const r of READERS) {
  const bytes = fs.readFileSync(path.join(root, 'dist', r.from));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const rel = `partitions/${r.key}/${r.key}-${sha256.slice(0, 8)}.html`;
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.writeFileSync(path.join(out, rel), bytes);
  files[r.key] = { file: rel, sha256, bytes: bytes.length };
  sums.push(`${sha256}  ${rel}`);
}
// ---- the EDITOR (portal mode: the page opened by the portal's « Éditer » button): the same page as dist/scorsaire.html, under a versioned name ----
{
  const bytes = fs.readFileSync(path.join(root, 'dist', 'scorsaire.html'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const rel = `partitions/editeur/editeur-${sha256.slice(0, 8)}.html`;
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.writeFileSync(path.join(out, rel), bytes);
  files.editor = { file: rel, sha256, bytes: bytes.length };
  sums.push(`${sha256}  ${rel}`);
}
// ---- the NOTE component (bloc-notes): the entries get versioned names, the chunks already carry their hash ----
execFileSync('node', ['tools/build-note.mjs', '--min'], { cwd: root, stdio: 'inherit' });
const noteSrc = path.join(root, 'dist', 'note'); const noteOut = path.join(out, 'partitions', 'bloc-notes');
fs.mkdirSync(path.join(noteOut, 'chunks'), { recursive: true });
const noteFiles = {};
const putNote = (rel, bytes) => { const sha256 = createHash('sha256').update(bytes).digest('hex'); fs.mkdirSync(path.dirname(path.join(noteOut, rel)), { recursive: true }); fs.writeFileSync(path.join(noteOut, rel), bytes); sums.push(`${sha256}  partitions/bloc-notes/${rel}`); return { file: `partitions/bloc-notes/${rel}`, sha256, bytes: bytes.length }; };
for (const kind of ['view', 'edit', 'scale']) {
  const bytes = fs.readFileSync(path.join(noteSrc, kind === 'scale' ? 'scorsaire-scale.js' : `scorsaire-note-${kind}.js`));
  const name = `${kind === 'scale' ? 'scorsaire-scale' : `scorsaire-note-${kind}`}-${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.js`;
  noteFiles[kind] = putNote(name, bytes);
}
const chunkList = [];
for (const f of fs.readdirSync(path.join(noteSrc, 'chunks')).sort()) chunkList.push(putNote(`chunks/${f}`, fs.readFileSync(path.join(noteSrc, 'chunks', f))));
const SOUNDS = 'https://letournedosrossini.github.io/scorsaire-lecteur/bloc-notes/sounds/';
const demo = fs.readFileSync(path.join(noteSrc, 'demo-note.json'), 'utf8');
fs.writeFileSync(path.join(noteOut, 'demo-note.json'), demo);
const page = (title, body, script) => `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title>\n<style>html{--md-sys-color-surface:#fff;--md-sys-color-on-surface:#1c1b1f}@media (prefers-color-scheme:dark){html{--md-sys-color-surface:#1c1b1f;--md-sys-color-on-surface:#e6e1e5;--md-sys-color-surface-container:#2b2930;--md-sys-color-outline:#938f99;--md-sys-color-outline-variant:#49454f;--md-sys-color-primary:#d0bcff;--md-sys-color-on-primary:#381e72}}body{margin:0;padding:.5rem;font-family:system-ui,sans-serif}</style></head>\n<body>${body}<script type="module">${script}</script></body></html>\n`;
fs.writeFileSync(path.join(noteOut, 'essai-lecture.html'), page('Scorsaire — bloc-notes, lecture (essai)', `<scorsaire-note id="n" lang="fr" sounds="${SOUNDS}"></scorsaire-note>`, `import './${path.basename(noteFiles.view.file)}'; const el = document.getElementById('n'); el.value = await (await fetch('demo-note.json')).text(); el.addEventListener('settingschange', (e) => console.log('settingschange', e.detail));`));
fs.writeFileSync(path.join(noteOut, 'essai-gamme.html'), page('Scorsaire — gammes (essai)', `<scorsaire-scale id="s" lang="fr" scale="dorian" root="D" instrument="guitare" sounds="${SOUNDS}"></scorsaire-scale>`, `import './${path.basename(noteFiles.scale.file)}'; const el = document.getElementById('s'); el.addEventListener('settingschange', (e) => console.log('settingschange', e.detail));`));
fs.writeFileSync(path.join(noteOut, 'essai-gamme-prof.html'), page('Scorsaire — gammes, choix du prof (essai)', `<scorsaire-scale id="s" mode="edit" lang="fr" scale="major" root="C" instrument="guitar6" sounds="${SOUNDS}"></scorsaire-scale>`, `import './${path.basename(noteFiles.scale.file)}'; document.getElementById('s').addEventListener('change', (e) => console.log('change', e.detail.recipe));`));
fs.writeFileSync(path.join(noteOut, 'essai-edition.html'), page('Scorsaire — bloc-notes, édition (essai)', `<scorsaire-note id="n" mode="edit" lang="fr" fullscreen sounds="${SOUNDS}"></scorsaire-note>`, `import './${path.basename(noteFiles.edit.file)}'; const el = document.getElementById('n'); el.addEventListener('save', (e) => console.log('save', e.detail.value.length, 'octets')); el.addEventListener('change', (e) => console.log('change', e.detail.value.length, 'octets'));`));
files.blocNotes = { view: noteFiles.view, edit: noteFiles.edit, scale: noteFiles.scale, chunks: chunkList, sounds: SOUNDS };
fs.mkdirSync(path.join(out, 'outils'), { recursive: true });
fs.copyFileSync(path.join(root, 'tools', 'portail', 'list-movements.standalone.mjs'), path.join(out, 'outils', 'list-movements.standalone.mjs'));
execFileSync('node', ['tools/build-note-svg.mjs'], { cwd: root, stdio: 'inherit' });
fs.copyFileSync(path.join(root, 'dist', 'note-svg', 'note-svg.mjs'), path.join(out, 'outils', 'note-svg.mjs'));
fs.mkdirSync(path.join(out, 'documents'), { recursive: true });
for (const d of ['instructions-serveur-livraison-4.md', 'reponses-instruments-gammes-pour-portail.md', 'guide-integration-bloc-notes.md', 'reponse-scorsaire-editeur-portail.md', 'instructions-serveur-livraison-3.md', 'instructions-serveur-livraison-2.md', 'reponses-scorsaire-pour-portail.md', 'message-au-portail-premiere-tranche.md', 'questions-portail-complet.md']) fs.copyFileSync(path.join(root, 'docs', d), path.join(out, 'documents', d));
const samples = path.join(root, 'docs', 'portail-exemples');
if (fs.existsSync(samples)) fs.cpSync(samples, path.join(out, 'exemples'), { recursive: true });
fs.cpSync(path.join(root, 'tools', 'portail', 'note-exemples'), path.join(out, 'exemples', 'bloc-notes'), { recursive: true });
fs.cpSync(path.join(root, 'tools', 'portail', 'gammes-exemples'), path.join(out, 'exemples', 'gammes'), { recursive: true });
fs.cpSync(path.join(root, 'tools', 'portail', 'feuilles-exemples'), path.join(out, 'exemples', 'feuilles'), { recursive: true }); // a file really written in the current format with the option « staff names » (tools/make-sheet-names-example.mjs) // a score with a scale movement and a scale container (tools/make-scale-example.mjs) // the example notes (tools/make-note-examples.mjs)
fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
const { blocNotes, editor, ...readers } = files;
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ built: new Date().toISOString(), readers, editor, blocNotes, instruments: instrumentsManifest() }, null, 2)}\n`);
fs.writeFileSync(path.join(out, 'LISEZMOI.txt'), `Lecteurs Scorsaire pour le portail de l'école.

Vérifier avant de déployer :   cd <ce dossier> && sha256sum -c SHA256SUMS
Copier le dossier « partitions » dans le dossier du frontend (hors de la portée du service worker de /lecteur/).
Le nom de chaque page change à chaque nouvelle version : manifest.json dit quel fichier est quel lecteur. Les anciens noms peuvent être supprimés
une fois la nouvelle page déployée.

Pages (une page entière, jamais dans une iframe) :
${READERS.map((r) => `  ${files[r.key].file}   ${r.what}`).join('\n')}

Éditeur (mode portail : le portail ouvre cette page dans un nouvel onglet pour modifier une partition de la bibliothèque ; voir documents/reponse-scorsaire-editeur-portail.md) :
  ${files.editor.file}   l'éditeur complet (${(files.editor.bytes / 1048576).toFixed(1)} Mo) ; déclaré dans manifest.json › editor

Composant « bloc-notes » (une petite partition de 1 à 4 mesures dans une note ; voir documents/guide-integration-bloc-notes.md) :
  ${files.blocNotes.view.file}   la lecture (pour l'élève)
  ${files.blocNotes.edit.file}   l'édition (pour le prof)
  ${files.blocNotes.scale.file}   les gammes (<scorsaire-scale>, lecture et choix par le prof)
  partitions/bloc-notes/essai-lecture.html et essai-edition.html   pages d'essai
  Les petites SoundFonts restent sur GitHub (attribut sounds=...).

Paramètres de l'adresse (en recherche « ?… » ou en fragment « #… » ; un fragment l'emporte ; un paramètre invalide est ignoré) :
  file    adresse du .scorsaire (obligatoire, sinon la page propose de choisir un fichier)
  t       jeton d'accès du portail, envoyé en « Authorization: Bearer » à file= et media= (même origine seulement)
  media   base des pistes audio d'un fichier léger (lecteur synchro) : <base><nom de la piste> est téléchargé, puis <base><sha256> si le nom est inconnu
  m       identifiant du mouvement à montrer seul (feuilles)
  v       vitesse de départ, 25 à 200 (feuilles)
  tr      transposition de départ en demi-tons, -24 à 24 (feuilles ; sans effet si l'auteur l'a verrouillée)
  loop    boucle de départ : deux identifiants de mesure séparés par un tiret (feuilles)
Exemple : /partitions/synchro/synchro-xxxxxxxx.html#t=<jeton>&file=/api/partitions/<id>/v<n>/fichier&media=/api/partitions/<id>/audio

Les pages sont des fichiers uniques et autonomes ; elles n'envoient rien ailleurs que vers les adresses ci-dessus.
`);
console.log(`Dossier prêt : ${out}`);
for (const r of READERS) console.log(`  ${files[r.key].file}  (${(files[r.key].bytes / 1024).toFixed(0)} Ko)`);
