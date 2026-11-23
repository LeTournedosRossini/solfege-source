// Builds the single-file Node module the school portal calls to draw a note (renderNoteSvg) and a scale (renderScaleSvg) as SVG text: dist/note-svg/note-svg.mjs. Usage: node tools/build-note-svg.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'note-svg');
fs.mkdirSync(out, { recursive: true });
const pure = {
  name: 'pure-src',
  setup(b) {
    b.onLoad({ filter: /src[\\/]model[\\/]icon-library\.js$/ }, () => ({ contents: 'export const LIBRARY = {}; export const RETAINED = {}; export const CUSTOM_RETAINED = {}; export const INSTRUMENT_ICON_OVERRIDES = {};', loader: 'js' }));
    b.onResolve({ filter: /^\.\.?\// }, async (a) => {
      if (a.pluginData?.skip) return undefined;
      const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, importer: a.importer, pluginData: { skip: true } });
      if (r.errors.length) return r;
      if (r.path.startsWith(path.join(root, 'src') + path.sep) && !r.path.endsWith(path.join('painters', 'index.js'))) r.sideEffects = false;
      return r;
    });
  },
};
await build({ entryPoints: [path.join(root, 'src', 'note', 'svg-entry.js')], outfile: path.join(out, 'note-svg.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node20', minify: true, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning', plugins: [pure] });
console.log(`note-svg.mjs : ${(fs.statSync(path.join(out, 'note-svg.mjs')).size / 1024).toFixed(0)} Ko`);
