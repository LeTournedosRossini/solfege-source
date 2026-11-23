// Builds the NOTE component bundles into dist/note/ and prints their weights (raw and gzip). Usage: node tools/build-note.mjs [--min]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'note');
fs.mkdirSync(out, { recursive: true });
const minify = process.argv.includes('--min');
// The editor's modules are written as one big graph (barrels that re-export the whole model). The component only needs a few of them: telling esbuild that nothing in
// src/ has side effects lets it drop the rest (icon library, instrument catalog…) for THIS bundle only; the editor's own build is untouched.
const pure = {
  name: 'pure-src',
  setup(b) {
    // Track icons are never drawn in a note (no instrument names): the 400 KB icon library is replaced by an empty one in this bundle.
    b.onLoad({ filter: /src[\\/]model[\\/]icon-library\.js$/ }, () => ({ contents: 'export const LIBRARY = {}; export const RETAINED = {}; export const CUSTOM_RETAINED = {}; export const INSTRUMENT_ICON_OVERRIDES = {};', loader: 'js' }));
    b.onResolve({ filter: /^\.\.?\// }, async (a) => {
      if (a.pluginData?.skip) return undefined;
      const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, importer: a.importer, pluginData: { skip: true } });
      if (r.errors.length) return r;
      if (r.path.startsWith(path.join(root, 'src') + path.sep) && !r.path.endsWith(path.join('painters', 'index.js'))) r.sideEffects = false; // the painters register themselves: a real side effect
      return r;
    });
  },
};
// Barlow Condensed (the chord symbols) goes inside the bundle as base64: nothing to host next to it
const woff2 = (file) => fs.readFileSync(path.join(root, 'static', 'fonts', file)).toString('base64');
const fontCss = [400, 700].map((w) => `@font-face { font-family: 'Barlow Condensed'; font-weight: ${w}; font-style: normal; font-display: block; src: url(data:font/woff2;base64,${woff2(`BarlowCondensed-${w}.woff2`)}) format('woff2'); }`).join('\n');
const kb = (n) => `${(n / 1024).toFixed(1)} Ko`;

// Two entries (the viewer for the pupil, the editor for the teacher). The SoundFont engine is a LAZY chunk (dynamic import at the first ▶): opening a note does not pay for it.
const spessa = fs.readFileSync(path.join(root, 'node_modules', 'spessasynth_lib', 'dist', 'spessasynth_processor.min.js'), 'utf8');
fs.rmSync(path.join(out, 'chunks'), { recursive: true, force: true });
const r = await build({
  entryPoints: { 'scorsaire-note-view': path.join(root, 'src', 'note', 'entry-view.js'), 'scorsaire-note-edit': path.join(root, 'src', 'note', 'entry-edit.js'), 'scorsaire-scale': path.join(root, 'src', 'scales', 'entry.js') },
  outdir: out, entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', splitting: true, write: true,
  bundle: true, format: 'esm', target: 'es2020', minify, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning', metafile: true, plugins: [pure],
  define: { __NOTE_FONTS__: JSON.stringify(fontCss), __SPESSA_PROCESSOR__: JSON.stringify(spessa) },
});
const outputs = Object.entries(r.metafile.outputs).filter(([f]) => f.endsWith('.js'));
const sizeOf = (f) => { const text = fs.readFileSync(path.join(root, f)); return { raw: text.length, gz: zlib.gzipSync(text).length }; };
// what a page loads at once = the entry + the chunks it imports statically; the lazy chunk is the one reached only by a dynamic import
const staticDeps = (f, seen = new Set()) => { if (seen.has(f)) return seen; seen.add(f); for (const i of r.metafile.outputs[f].imports) if (i.kind === 'import-statement') staticDeps(i.path, seen); return seen; };
for (const [f] of outputs) {
  const entry = r.metafile.outputs[f].entryPoint;
  if (!entry || f.includes('/chunks/')) continue;
  const all = [...staticDeps(f)]; const raw = all.reduce((t, g) => t + sizeOf(g).raw, 0); const gz = all.reduce((t, g) => t + sizeOf(g).gz, 0);
  console.log(`${path.relative(root, path.join(root, f))} : opening a note = ${kb(raw)} (gzip ${kb(gz)}, ${all.length} file${all.length > 1 ? 's' : ''})${minify ? '' : '  [not minified]'}`);
}
const dynamic = new Set(outputs.flatMap(([f]) => r.metafile.outputs[f].imports.filter((i) => i.kind === 'dynamic-import').map((i) => i.path)));
for (const f of dynamic) console.log(`${f} : the sound, loaded at the first play = ${kb(sizeOf(f).raw)} (gzip ${kb(sizeOf(f).gz)}), plus the .sf3 files`);
if (process.argv.includes('--why')) {
  for (const [f, v] of outputs) {
    const inputs = Object.entries(v.inputs).sort((x, y) => y[1].bytesInOutput - x[1].bytesInOutput).slice(0, 6);
    console.log(f); for (const [g, w] of inputs) console.log(`   ${kb(w.bytesInOutput).padStart(10)}  ${g}`);
  }
}
fs.copyFileSync(path.join(root, 'static', 'note-demo.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(root, 'static', 'note-edit-demo.html'), path.join(out, 'edit.html'));
fs.copyFileSync(path.join(root, 'static', 'scale-demo.html'), path.join(out, 'scale.html'));
// demo document for the test page (never part of the component)
const { demoMelodyDocument } = await import('../src/note/demo.js');
const { stringifyNoteDocument } = await import('../src/note/document.js');
fs.writeFileSync(path.join(out, 'demo-note.json'), stringifyNoteDocument(demoMelodyDocument()));
