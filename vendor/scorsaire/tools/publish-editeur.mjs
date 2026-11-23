#!/usr/bin/env node
/*
 * Publishes the installable Scorsaire EDITOR (the folder `dist/editeur/`) into its own public repository, served by GitHub Pages: `node tools/publish-editeur.mjs [folder] [--push]`.
 *   - builds the minified application first (`node tools/build.js --min`);
 *   - copies the page, the manifest, the service worker, the icons and the README (`tools/editeur-README.md`) into the clone of the repository (default: `../scorsaire-editeur`, or the argument, or $EDITEUR_REPO);
 *   - the service worker's cache version is the hash of the page (written by the build): a new page is a new version the installed copies OFFER to their user;
 *   - commits ("Publication <version>"), and pushes only with `--push`. No CI is involved: Pages serves the files as they are.
 * A SEPARATE repository (not a folder of the Lecteur's): the page weighs 17 Mo (6 Mo compressed) and every publication stores a whole new copy in the history.
 * The repository holds only the built application, no work and none of the source.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const push = args.includes('--push');
const target = path.resolve(args.find((a) => !a.startsWith('--')) ?? process.env.EDITEUR_REPO ?? path.join(root, '..', 'scorsaire-editeur'));
if (!fs.existsSync(path.join(target, '.git'))) { console.error(`Pas de dépôt git dans ${target} : le cloner d'abord (git clone https://github.com/LeTournedosRossini/scorsaire-editeur.git).`); process.exit(1); }

execFileSync('node', ['tools/build.js', '--min'], { cwd: root, stdio: 'inherit' });
const source = path.join(root, 'dist', 'editeur');
for (const f of fs.readdirSync(source)) fs.copyFileSync(path.join(source, f), path.join(target, f));
fs.writeFileSync(path.join(target, '.nojekyll'), '');
fs.copyFileSync(path.join(root, 'tools', 'editeur-README.md'), path.join(target, 'README.md')); // the page GitHub shows under the files: links to the editor, the manual and the Lecteur
const version = /const CACHE_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(target, 'sw.js'), 'utf8'))?.[1];
if (!version || version.startsWith('__')) throw new Error('Version du service worker introuvable');

const git = (...a) => execFileSync('git', a, { cwd: target, stdio: 'inherit' });
git('add', '-A');
try { git('commit', '-m', `Publication ${version}`); } catch { console.log('Rien de nouveau à publier.'); process.exit(0); }
if (push) git('push');
else console.log(`Commit fait dans ${target}. Pour publier : git -C "${target}" push`);
