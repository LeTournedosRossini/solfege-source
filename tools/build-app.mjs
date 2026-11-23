// Construit l'application dans dist/app/ : npm run build:app  (--dev : non minifié)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'app');
const out = path.join(root, 'dist', 'app');
const minify = !process.argv.includes('--dev');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

// Code : le moteur de Scorsaire est copié sous vendor/ ; tout ce qui y est déclaré sans effet de bord est élagué (comme le fait Scorsaire pour ses composants).
// Le moteur de son est un morceau chargé au premier ▶ (import dynamique).
const vsrc = path.join(root, 'vendor', 'scorsaire', 'src');
const pure = {
  name: 'pure-src',
  setup(b) {
    b.onLoad({ filter: /src[\\/]model[\\/]icon-library\.js$/ }, () => ({ contents: 'export const LIBRARY = {}; export const RETAINED = {}; export const CUSTOM_RETAINED = {}; export const INSTRUMENT_ICON_OVERRIDES = {};', loader: 'js' }));
    // Correctif appliqué à la compilation (le fichier copié reste intact, voir VENDOR.md) : la palette de l'éditeur de note envoie « 16th » au modèle, qui nomme la double croche « sixteenth »
    // (toucher la portée avec la double croche choisie répond « Impossible ici »).
    b.onLoad({ filter: /src[\\/]note[\\/]edit\.js$/ }, async (a) => {
      let t = fs.readFileSync(a.path, 'utf8');
      const reps = [['{ base: b.dataset.dur, dots', "{ base: b.dataset.dur === '16th' ? 'sixteenth' : b.dataset.dur, dots"], ['aria-pressed="${e.duration.base === id}"', 'aria-pressed="${e.duration.base === (id === \'16th\' ? \'sixteenth\' : id)}"']];
      for (const [from, to] of reps) { if (!t.includes(from)) throw new Error(`Correctif de la double croche : motif introuvable dans edit.js (${from}) — la copie de Scorsaire a changé`); t = t.replace(from, to); }
      return { contents: t, loader: 'js', resolveDir: path.dirname(a.path) };
    });
    b.onResolve({ filter: /^\.\.?\// }, async (a) => {
      if (a.pluginData?.skip) return undefined;
      const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, importer: a.importer, pluginData: { skip: true } });
      if (r.errors.length) return r;
      if (r.path.startsWith(vsrc + path.sep) && !r.path.endsWith(path.join('painters', 'index.js'))) r.sideEffects = false;
      return r;
    });
  },
};
const spessa = fs.readFileSync(path.join(root, 'node_modules', 'spessasynth_lib', 'dist', 'spessasynth_processor.min.js'), 'utf8');
await build({
  entryPoints: [path.join(src, 'main.js')], outdir: out, entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', splitting: true, bundle: true, format: 'esm', target: 'es2020',
  minify, legalComments: 'none', logLevel: 'warning', loader: { '.json': 'json', '.txt': 'text' }, plugins: [pure], define: { __SPESSA_PROCESSOR__: JSON.stringify(spessa) },
});

// Polices embarquées (Inter : copie de Scorsaire ; Fraunces : paquet npm, licence SIL OFL) + feuille de style de l'application actuelle
const fonts = {
  'Inter-Variable-latin.woff2': path.join(root, 'vendor', 'scorsaire', 'static', 'fonts', 'Inter-Variable-latin.woff2'),
  'Fraunces-wght-normal.woff2': path.join(root, 'node_modules', '@fontsource-variable', 'fraunces', 'files', 'fraunces-latin-wght-normal.woff2'),
  'Fraunces-wght-italic.woff2': path.join(root, 'node_modules', '@fontsource-variable', 'fraunces', 'files', 'fraunces-latin-wght-italic.woff2'),
};
for (const [name, file] of Object.entries(fonts)) fs.copyFileSync(file, path.join(out, 'fonts', name));
const fontFaces = `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(fonts/Inter-Variable-latin.woff2) format('woff2')}
@font-face{font-family:'Fraunces';font-style:normal;font-weight:100 900;font-display:swap;src:url(fonts/Fraunces-wght-normal.woff2) format('woff2')}
@font-face{font-family:'Fraunces';font-style:italic;font-weight:100 900;font-display:swap;src:url(fonts/Fraunces-wght-italic.woff2) format('woff2')}
`;
// Les règles qui fixent l'épaisseur des traits des partitions (0,75 px ; 1,1 px en contraste) valaient pour les dessins d'abcjs. Appliquées aux nôtres, elles amincissent
// les barres épaisses (barres finales, barres de reprise) : on les limite aux SVG sans viewBox (ceux d'abcjs), nos dessins gardent l'épaisseur de leurs traits.
let css = fs.readFileSync(path.join(src, 'app.css'), 'utf8');
const avant = css;
css = css.replace(':root[data-theme="contrast"] .abc-notation svg line,\n:root[data-theme="contrast"] .abc-notation svg path{ stroke-width:1.1px; }', ':root[data-theme="contrast"] .abc-notation svg:not([viewBox]) line,\n:root[data-theme="contrast"] .abc-notation svg:not([viewBox]) path{ stroke-width:1.1px; }')
  .replace('.abc-notation svg line, .abc-notation svg path{ stroke-width:0.75px; }', '.abc-notation svg:not([viewBox]) line, .abc-notation svg:not([viewBox]) path{ stroke-width:0.75px; }');
if (css === avant || (css.match(/svg:not\(\[viewBox\]\)/g) ?? []).length !== 4) throw new Error('Règles d’épaisseur de trait introuvables dans app.css : vérifier tools/build-app.mjs');
fs.writeFileSync(path.join(out, 'app.css'), fontFaces + css + fs.readFileSync(path.join(src, 'surcharges.css'), 'utf8'));
fs.copyFileSync(path.join(src, 'assets', 'icon.svg'), path.join(out, 'icon.svg'));
fs.copyFileSync(path.join(src, 'assets', 'manifest.json'), path.join(out, 'manifest.json'));

// Numéro de version = empreinte du code et du style ; sert d'adresse versionnée (anti-cache) et de nom de cache
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex');
const V = crypto.createHash('sha256').update(sha('main.js') + sha('app.css') + fs.readFileSync(path.join(src, 'squelette.html')) + fs.readFileSync(path.join(src, 'sw.js'))).digest('hex').slice(0, 8);

const skeleton = fs.readFileSync(path.join(src, 'squelette.html'), 'utf8').replace('</footer>', `  <p style="font-size:.75rem;color:var(--fg-soft);text-align:center">Version ${V}</p>\n  </footer>`);
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Solfège — apprendre à lire la musique</title>
<meta name="description" content="Apprends le solfège avec des cours clairs, des jeux de lecture de notes, de rythme et de théorie, et des outils pour musiciens.">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#16141a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Solfège">
<link rel="apple-touch-icon" href="icon.svg">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="app.css?v=${V}">
</head>
<body>
${skeleton}
<script type="module" src="main.js?v=${V}"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);

const chunks = fs.existsSync(path.join(out, 'chunks')) ? fs.readdirSync(path.join(out, 'chunks')).map((n) => `./chunks/${n}`) : [];
const precache = ['./', './index.html', `./main.js?v=${V}`, `./app.css?v=${V}`, './manifest.json', './icon.svg', ...Object.keys(fonts).map((n) => `./fonts/${n}`), ...chunks];
fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(src, 'sw.js'), 'utf8').replace('__VERSION__', V).replace('__PRECACHE__', JSON.stringify(precache)));

const kb = (f) => { const b = fs.readFileSync(path.join(out, f)); return `${(b.length / 1024).toFixed(0)} Ko (gzip ${(zlib.gzipSync(b).length / 1024).toFixed(0)} Ko)`; };
console.log(`Version ${V}`);
for (const f of ['index.html', 'main.js', 'app.css', 'sw.js']) console.log(f.padEnd(11), kb(f));
for (const c of chunks) console.log(c.slice(2).padEnd(30), kb(c.slice(2)));
const total = fs.readdirSync(out, { recursive: true }).filter((f) => fs.statSync(path.join(out, f)).isFile()).reduce((t, f) => t + fs.statSync(path.join(out, f)).size, 0);
console.log(`Total dist/app : ${(total / 1024).toFixed(0)} Ko (dont polices ${Object.values(fonts).reduce((t, f) => t + fs.statSync(f).size, 0) / 1024 | 0} Ko)`);
