#!/usr/bin/env node
/*
 * Publishes the Scorsaire Lecteur (the folder `dist/lecteur/`) into the public repository that GitHub Pages serves: `node tools/publish-lecteur.mjs [folder] [--push]`.
 *   - builds the application first (`npm run build`);
 *   - copies the page, the manifest, the service worker and the icons into the clone of the repository (default: `../scorsaire-lecteur`, or the argument, or $LECTEUR_REPO);
 *   - gives the service worker a NEW cache version (date and time), so that the tablets that installed the application take the new page instead of the cached one;
 *   - commits ("Publication <version>"), and pushes only with `--push`. No CI is involved: Pages serves the files as they are.
 * Also copies the user manual (`manuel/`). The repository holds no work and none of the source: only the built application and the example files kept in its `exemples/` folder.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const push = args.includes('--push');
const target = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.env.LECTEUR_REPO ?? path.join(root, '..', 'scorsaire-lecteur'));
if (!fs.existsSync(path.join(target, '.git'))) { console.error(`Pas de dépôt git dans ${target} : le cloner d'abord (git clone https://github.com/LeTournedosRossini/scorsaire-lecteur.git).`); process.exit(1); }

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const source = path.join(root, 'dist', 'lecteur');
for (const f of fs.readdirSync(source)) fs.copyFileSync(path.join(source, f), path.join(target, f));
// the other readers (empty: they open a file by address, `?file=`), each in its own folder so that the service worker of the Lecteur does not touch them, and the page that makes the links
for (const [from, folder] of [['scorsaire-synchro.html', 'synchro'], ['scorsaire-youtube.html', 'youtube'], ['scorsaire-lecteur.html', 'feuilles'], ['liens.html', 'liens']]) {
  fs.mkdirSync(path.join(target, folder), { recursive: true });
  fs.copyFileSync(path.join(root, 'dist', from), path.join(target, folder, 'index.html'));
}

// the BLOC-NOTES component (the two bundles, their chunks, the small SoundFonts and the two demo pages): built apart, copied into `bloc-notes/`
execFileSync('node', ['tools/build-note.mjs', '--min'], { cwd: root, stdio: 'inherit' });
fs.cpSync(path.join(root, 'dist', 'note'), path.join(target, 'bloc-notes'), { recursive: true });
fs.writeFileSync(path.join(target, 'bloc-notes', 'sounds', 'LISEZMOI.txt'), 'Ces petites SoundFonts (SF3) sont extraites de GeneralUser GS (S. Christian Collins), licence libre : usage, modification et redistribution permis. https://schristiancollins.com/generaluser.php\n');

// the USER MANUAL (French and English in one page, with its pictures): built from `docs/manuel/`, copied into `manuel/`
execFileSync('node', ['tools/build-manual.mjs'], { cwd: root, stdio: 'inherit' });
fs.rmSync(path.join(target, 'manuel'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'dist', 'manuel'), path.join(target, 'manuel'), { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const version = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const swPath = path.join(target, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
if (!/const CACHE_VERSION = '[^']*';/.test(sw)) throw new Error('CACHE_VERSION introuvable dans sw.js');
fs.writeFileSync(swPath, sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'scorsaire-lecteur-${version}';`));
fs.writeFileSync(path.join(target, '.nojekyll'), '');

const git = (...a) => execFileSync('git', a, { cwd: target, stdio: 'inherit' });
git('add', '-A');
try { git('commit', '-m', `Publication ${version}`); } catch { console.log('Rien de nouveau à publier.'); process.exit(0); }
if (push) git('push');
else console.log(`Commit fait dans ${target}. Pour publier : git -C "${target}" push`);
