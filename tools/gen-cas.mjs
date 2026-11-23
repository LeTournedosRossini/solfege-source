// Convertit l'inventaire des partitions ABC de l'ancienne application en descriptions, et vérifie que chacune se construit et se dessine.
// Usage : node tools/gen-cas.mjs <inventaire.json> [sortie.json]
import fs from 'node:fs';
import { parseAbc } from './abc-vers-desc.mjs';
import { renderDesc } from '../src/music/describe.js';
const inv = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const seen = new Map();
for (const x of inv) {
  const k = x.abc + '|' + x.opts.filter((o) => o.startsWith('staffwidth')).join();
  if (!seen.has(k)) seen.set(k, { abc: x.abc, routes: [], opts: x.opts });
  if (!seen.get(k).routes.includes(x.route)) seen.get(k).routes.push(x.route);
}
const cas = []; let ko = 0;
for (const c of seen.values()) {
  const sw = c.opts.find((o) => o.startsWith('staffwidth='))?.split('=')[1];
  const entry = { id: 'c' + String(cas.length + 1).padStart(2, '0'), routes: c.routes, abc: c.abc.replace('X:1\n', '').trim() };
  try { entry.desc = parseAbc(c.abc, { staffwidth: sw }); renderDesc(entry.desc, { width: entry.desc.width ?? 320 }); }
  catch (e) { entry.erreur = e.message.split('\n').slice(0, 2).join(' '); ko++; }
  cas.push(entry);
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(cas, null, 1));
console.log(`${cas.length} cas distincts : ${cas.length - ko} convertis et dessinés, ${ko} en échec`);
for (const c of cas.filter((c) => c.erreur)) console.log(' ', c.id, c.routes[0], '|', c.abc.replace(/\n/g, ' ').slice(0, 70), '=>', c.erreur.slice(0, 140));
