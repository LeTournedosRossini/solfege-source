// Construit le prototype : dist/proto/{index.html,proto.js} et affiche le poids.
// Reprend le principe de vendor/scorsaire/tools/build-note.mjs : tout ce qui est sous vendor/scorsaire/src est déclaré sans effet de bord pour que esbuild élague le reste.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vsrc = path.join(root, 'vendor', 'scorsaire', 'src');
const out = path.join(root, 'dist', 'proto');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const pure = {
  name: 'pure-src',
  setup(b) {
    b.onLoad({ filter: /src[\\/]model[\\/]icon-library\.js$/ }, () => ({ contents: 'export const LIBRARY = {}; export const RETAINED = {}; export const CUSTOM_RETAINED = {}; export const INSTRUMENT_ICON_OVERRIDES = {};', loader: 'js' }));
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
const minify = !process.argv.includes('--dev');
await build({ entryPoints: [path.join(root, 'src', 'proto.js')], outdir: out, entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', splitting: true, bundle: true, format: 'esm', metafile: true, target: 'es2020', minify, loader: { '.json': 'json' }, legalComments: 'none', logLevel: 'warning', plugins: [pure], define: { __SPESSA_PROCESSOR__: JSON.stringify(spessa) } }).then((r) => { globalThis.__meta = r.metafile; });
{
  // Numéro de version = empreinte de proto.js : change à chaque modification, évite qu'un navigateur garde une ancienne copie.
  const v = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(path.join(out, 'proto.js'))).digest('hex').slice(0, 8);
  const html = fs.readFileSync(path.join(root, 'proto', 'index.html'), 'utf8').replace('src="proto.js"', `src="proto.js?v=${v}"`).replace('</body>', `<p style="font-size:.75rem;opacity:.6">Version ${v}</p></body>`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
}
const kb = (f) => { const b = fs.readFileSync(f); return `${(b.length / 1024).toFixed(0)} Ko (gzip ${(zlib.gzipSync(b).length / 1024).toFixed(0)} Ko)`; };
console.log('proto.js (ouverture) :', kb(path.join(out, 'proto.js')));
for (const f of fs.readdirSync(path.join(out, 'chunks'), { withFileTypes: true }).length ? fs.readdirSync(path.join(out, 'chunks')) : []) console.log('chunks/' + f, ':', kb(path.join(out, 'chunks', f)), '(chargé au premier ▶)');
