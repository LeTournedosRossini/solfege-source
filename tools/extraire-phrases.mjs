// Extrait les phrases du répertoire de l'ancien module d'oreille (FAMOUS_PHRASES, en ABC) et les convertit en descriptions (une fois pour toutes).
// Usage : node tools/extraire-phrases.mjs <ear.html décodé>  → écrit src/app/data/phrases.json
import fs from 'node:fs';
import { parseAbc } from './abc-vers-desc.mjs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const m = /const FAMOUS_PHRASES = (\[[\s\S]*?\n\]);/.exec(html);
const list = new Function(`return ${m[1]}`)();
const out = [], bad = [];
for (const p of list) {
  try {
    const desc = parseAbc(p.abc);
    desc.measures = desc.measures.filter((x) => (Array.isArray(x) ? x : x.events).length);
    out.push({ genre: p.genre, title: p.title, featured: p.featured, desc });
  } catch (e) { bad.push(`${p.title} : ${e.message}`); }
}
fs.writeFileSync(new URL('../src/app/data/phrases.json', import.meta.url), JSON.stringify(out));
console.log(list.length, 'phrases,', out.length, 'converties', bad.length ? '\nÉCHECS :\n' + bad.join('\n') : '');
