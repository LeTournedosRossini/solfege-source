#!/usr/bin/env node
/*
 * Build : assemble src/ (modules) en UN SEUL fichier HTML autonome : dist/scorsaire.html
 *   node tools/build.js            build normal (code lisible)
 *   node tools/build.js --min      build minifié
 *
 * Le résultat s'ouvre en double-clic (file://), sans serveur — même habitude que les autres outils.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minify = process.argv.includes('--min');

// AlphaTab (Guitar Pro reader, MPL-2.0, LICENSES/AlphaTab-MPL-2.0.txt) as a SEPARATE minified bundle embedded as text: evaluated on the first Guitar Pro import only
const alphaTab = await build({
  entryPoints: [path.join(root, 'tools', 'alphatab-entry.mjs')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, legalComments: 'none', logLevel: 'error',
});
const alphaTabCode = alphaTab.outputFiles[0].text;

// Police des symboles d'accord (Barlow Condensed 400 / 500 / 600 / 700, puis JetBrains Mono en repli ; SIL OFL — LICENSES/BarlowCondensed-OFL.txt, JetBrainsMono-OFL.txt)
// EMBARQUÉE en base64 : les fichiers restent autonomes, hors ligne. L'éditeur la reçoit par le marqueur /*FONTS*/ de son <style>, les lecteurs par un <style> ajouté.
const woff2 = (file) => fs.readFileSync(path.join(root, 'static', 'fonts', file)).toString('base64');
const face = (family, weight, file) => `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal; font-display: block; src: url(data:font/woff2;base64,${woff2(file)}) format('woff2'); }`;
const fontCss = [400, 500, 600, 700].map((w) => face('Barlow Condensed', w, `BarlowCondensed-${w}.woff2`)).join('\n') + '\n' + face('JetBrains Mono', 400, 'JetBrainsMono-Regular.woff2');
// Inter (variable, weights 100-900, Latin subset, SIL OFL): the interface font of the editor (setting « Police de l'interface ») and of the exported pages
const interCss = `@font-face { font-family: 'Inter'; font-weight: 100 900; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${woff2('Inter-Variable-latin.woff2')}) format('woff2'); }`;
const withFonts = (page) => page.replace('</head>', () => `<style>${fontCss}\n${interCss}</style></head>`);
// The READER (read only: see src/reader): its own bundle. The page `dist/scorsaire-lecteur.html` loads a work by address or from a file; the SAME code is embedded as text
// (`__READER_PAGE__`) so that the editor can export a complete page with a work inside.
const spessa = fs.readFileSync(path.join(root, 'node_modules', 'spessasynth_lib', 'dist', 'spessasynth_processor.min.js'), 'utf8');
// The compressor of the tracks as ONE worklet script: the pure DSP of src/audio/compressor.js (its `export`s removed) followed by the processor (src/audio/compressor-processor.js)
const compressorWorklet = fs.readFileSync(path.join(root, 'src', 'audio', 'compressor.js'), 'utf8').replace(/^export /gm, '') + '\n' + fs.readFileSync(path.join(root, 'src', 'audio', 'compressor-processor.js'), 'utf8');
const readerBundle = await build({
  entryPoints: [path.join(root, 'src', 'reader', 'main.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning',
  define: { __SPESSA_PROCESSOR__: JSON.stringify(spessa) },
});
const readerJs = readerBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const readerPage = withFonts(fs.readFileSync(path.join(root, 'static', 'reader.html'), 'utf8').replace('<!--READER_SCRIPT-->', () => `<script>\n${readerJs}</script>`));

// The SYNCHRO reader (score + recording of screen 4, read only): its own bundle and page, `dist/scorsaire-synchro.html`.
const synchroBundle = await build({
  entryPoints: [path.join(root, 'src', 'syncreader', 'main.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning',
  define: { __SIGNALSMITH__: JSON.stringify(fs.readFileSync(path.join(root, 'node_modules', 'signalsmith-stretch', 'SignalsmithStretch.js'), 'utf8')) },
});
const synchroJs = synchroBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const synchroPage = withFonts(fs.readFileSync(path.join(root, 'static', 'synchro.html'), 'utf8').replace('<!--SYNCHRO_SCRIPT-->', () => `<script>\n${synchroJs}</script>`));

// The YOUTUBE reader (a video with fragments of score placed on it, read only): its own bundle and page, `dist/scorsaire-youtube.html`. No audio engine inside.
const youtubeBundle = await build({
  entryPoints: [path.join(root, 'src', 'ytreader', 'main.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning',
});
const youtubeJs = youtubeBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const youtubePage = withFonts(fs.readFileSync(path.join(root, 'static', 'youtube.html'), 'utf8').replace('<!--YOUTUBE_SCRIPT-->', () => `<script>\n${youtubeJs}</script>`));

// The LECTEUR (songbook reader, an installable application: src/lecteur): its own bundle, written as a FOLDER `dist/lecteur/` (page, manifest, service worker, icons) that any
// static server can publish, because a service worker needs http(s). No audio engine inside, and nothing that edits a work.
const lecteurBundle = await build({
  entryPoints: [path.join(root, 'src', 'lecteur', 'main.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning',
});
const lecteurJs = lecteurBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const lecteurPage = withFonts(fs.readFileSync(path.join(root, 'static', 'lecteur.html'), 'utf8').replace('<!--LECTEUR_SCRIPT-->', () => `<script>\n${lecteurJs}</script>`));

const result = await build({
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify,
  loader: { '.json': 'json' },
  // SpessaSynth's worklet processor (Apache-2.0, LICENSES/SpessaSynth-Apache-2.0.txt) embedded as text: started from a Blob URL, so the file stays standalone
  define: { __COMPRESSOR_WORKLET__: JSON.stringify(compressorWorklet), __READER_PAGE__: JSON.stringify(readerPage), __YOUTUBE_PAGE__: JSON.stringify(youtubePage), __SYNCHRO_PAGE__: JSON.stringify(synchroPage), __ALPHATAB__: JSON.stringify(alphaTabCode), __SIGNALSMITH__: JSON.stringify(fs.readFileSync(path.join(root, 'node_modules', 'signalsmith-stretch', 'SignalsmithStretch.js'), 'utf8')), __SPESSA_PROCESSOR__: JSON.stringify(fs.readFileSync(path.join(root, 'node_modules', 'spessasynth_lib', 'dist', 'spessasynth_processor.min.js'), 'utf8')) },
  legalComments: 'none',
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = fs.readFileSync(path.join(root, 'static', 'index.html'), 'utf8');
if (!template.includes('<!--APP_SCRIPT-->')) throw new Error('Marqueur <!--APP_SCRIPT--> absent du modèle');
if (!template.includes('/*FONTS*/')) throw new Error('Marqueur /*FONTS*/ absent du modèle');
const html = template.replace('/*FONTS*/', () => `${fontCss}\n${interCss}`).replace('<!--APP_SCRIPT-->', () => `<script>\n${js}</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'scorsaire.html');
fs.writeFileSync(out, html);
fs.writeFileSync(path.join(root, 'dist', 'scorsaire-lecteur.html'), readerPage.replace('<!--WORK-->', ''));
fs.writeFileSync(path.join(root, 'dist', 'scorsaire-synchro.html'), synchroPage.replace('<!--FILE-->', ''));
fs.writeFileSync(path.join(root, 'dist', 'scorsaire-youtube.html'), youtubePage.replace('<!--FILE-->', ''));
// the page that makes the links to a reader (published with them): its own small bundle (it reads a `.scorsaire` to list the tracks), inlined in the page
const linksBundle = await build({
  entryPoints: [path.join(root, 'src', 'links', 'page.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning',
});
const linksJs = linksBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(path.join(root, 'dist', 'liens.html'), fs.readFileSync(path.join(root, 'static', 'liens.html'), 'utf8').replace('<!--LIENS_SCRIPT-->', () => `<script>\n${linksJs}</script>`));
const lecteurDir = path.join(root, 'dist', 'lecteur');
fs.mkdirSync(lecteurDir, { recursive: true });
fs.writeFileSync(path.join(lecteurDir, 'index.html'), lecteurPage);
for (const f of ['manifest.json', 'sw.js', 'icon-180.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(root, 'static', 'lecteur', f), path.join(lecteurDir, f));
// The installed EDITOR (a PWA): the same page as `dist/scorsaire.html` with a manifest, written as a FOLDER `dist/editeur/` for a static server (a service worker needs http(s)).
// `scorsaire.html` keeps no manifest and never registers a worker. The cache version is a hash of the page: a different page is a new version offered to the person.
const editeurDir = path.join(root, 'dist', 'editeur');
fs.mkdirSync(editeurDir, { recursive: true });
const editeurHead = '<link rel="manifest" href="manifest.json">\n<meta name="theme-color" content="#faf8f4">\n<meta name="theme-color" content="#101012" media="(prefers-color-scheme: dark)">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Scorsaire">\n<link rel="apple-touch-icon" href="icon-180.png">\n<link rel="icon" href="icon-192.png">\n';
const editeurPage = html.replace('</title>', () => `</title>\n${editeurHead}`);
if (editeurPage === html) throw new Error('Balise </title> absente du modèle');
fs.writeFileSync(path.join(editeurDir, 'index.html'), editeurPage);
const editeurVersion = crypto.createHash('sha256').update(editeurPage).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(editeurDir, 'sw.js'), fs.readFileSync(path.join(root, 'static', 'editeur', 'sw.js'), 'utf8').replace('__CACHE_VERSION__', editeurVersion));
for (const f of ['manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(root, 'static', 'editeur', f), path.join(editeurDir, f));
console.log(`dist/editeur/index.html : ${(Buffer.byteLength(editeurPage) / 1024).toFixed(1)} Ko (version ${editeurVersion}, + manifest, service worker, icônes)`);
console.log(`dist/lecteur/index.html : ${(Buffer.byteLength(lecteurPage) / 1024).toFixed(1)} Ko (+ manifest, service worker, icônes)`);
console.log(`dist/scorsaire-youtube.html : ${(Buffer.byteLength(youtubePage) / 1024).toFixed(1)} Ko`);
console.log(`dist/scorsaire-synchro.html : ${(Buffer.byteLength(synchroPage) / 1024).toFixed(1)} Ko`);
console.log(`dist/scorsaire-lecteur.html : ${(Buffer.byteLength(readerPage) / 1024).toFixed(1)} Ko`);
console.log(`dist/scorsaire.html : ${(Buffer.byteLength(html) / 1024).toFixed(1)} Ko${minify ? ' (minifié)' : ''}`);
