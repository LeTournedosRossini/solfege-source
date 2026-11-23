// Instantané des positions horizontales de toutes les démos (régression d'espacement, tranche « PaddingTable »).
//   node tools/spacing-baseline.mjs save <fichier.json>      écrit l'instantané
//   node tools/spacing-baseline.mjs diff <fichier.json> [seuil]  compare l'état courant (écarts > seuil, 0,05 sp par défaut)
import fs from 'node:fs';
import * as S from '../src/model/samples.js';
import { layoutMovement } from '../src/layout/index.js';
const glyphs = JSON.parse(fs.readFileSync(new URL('../src/glyphs/bravura-subset.json', import.meta.url), 'utf8'));
const works = Object.entries(S).filter(([n]) => /^sample\w+Work$/.test(n));
function snapshot() {
  const out = {};
  for (const [name, make] of works) {
    const layout = layoutMovement(make().movements[0], glyphs, { width: 60 });
    const rows = [];
    layout.systems.forEach((sys, si) => sys.staves.forEach((st, ti) => st.items.forEach((it, k) => {
      const x = it.x ?? it.x1 ?? it.cx;
      if (typeof x === 'number') rows.push([`${si}.${ti}.${k}.${it.kind}.${it.name ?? it.role ?? ''}`, Math.round(x * 1000) / 1000]);
    })));
    out[name] = { systems: layout.systems.length, rows };
  }
  return out;
}
const [cmd, file, th = '0.05'] = process.argv.slice(2);
if (cmd === 'save') { fs.writeFileSync(file, JSON.stringify(snapshot())); console.log('instantané écrit', file); }
else if (cmd === 'diff') {
  const base = JSON.parse(fs.readFileSync(file, 'utf8')); const now = snapshot(); let total = 0;
  for (const [name, b] of Object.entries(base)) {
    const n = now[name]; if (!n) { console.log(name, 'absente'); continue; }
    if (n.systems !== b.systems) console.log(name, `systèmes ${b.systems} → ${n.systems}`);
    const m = new Map(n.rows); let count = 0, max = 0;
    for (const [k, x] of b.rows) if (m.has(k)) { const d = Math.abs(m.get(k) - x); if (d > Number(th)) { count++; max = Math.max(max, d); } }
    total += count; console.log(name.padEnd(36), `${count} éléments décalés > ${th} sp (max ${max.toFixed(3)})`);
  }
  console.log('total', total);
}
