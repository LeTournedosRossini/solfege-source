// Galerie de comparaison : pour chaque cas, l'ancien rendu (abcjs, chargé depuis Internet pour la comparaison seulement) à gauche, le nouveau (Scorsaire) à droite.
// Usage : node tools/galerie.mjs <cas.json> <sortie.html>
import fs from 'node:fs';
import { renderDesc } from '../src/music/describe.js';
const cas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = cas.map((c) => {
  const svg = c.desc ? renderDesc(c.desc, { width: c.desc.width ?? 320, ink: '#1c1b1f' }) : `<p style="color:#c00">${c.erreur}</p>`;
  return `<div class="r"><div class="m">${c.id} · ${c.routes[0]}<br><code>${c.abc.replace(/L:[^\n]*\n|K:C clef=treble\n?/g, '').replace(/\n/g, ' ⏎ ')}</code></div><div class="o" id="o_${c.id}"></div><div class="n">${svg}</div></div>`;
}).join('\n');
const abcs = JSON.stringify(Object.fromEntries(cas.map((c) => ['o_' + c.id, { abc: c.abc, w: c.desc?.width ?? 360 }])));
fs.writeFileSync(process.argv[3], `<!doctype html><meta charset="utf-8"><title>Galerie</title><style>
body{font:13px system-ui;margin:10px;background:#fff;color:#111}.r{display:grid;grid-template-columns:220px 380px 380px;gap:8px;align-items:center;border-bottom:1px solid #ddd;padding:4px 0}
.m{font-size:11px;word-break:break-all}.o,.n{overflow:hidden}svg{max-width:100%}</style>
<script src="https://cdn.jsdelivr.net/npm/abcjs@6.5.1/dist/abcjs-basic-min.js"></script>
<div class="r"><b>Cas</b><b>Ancien (abcjs)</b><b>Nouveau (Scorsaire)</b></div>
${rows}
<script>const A=${abcs};for(const [id,v] of Object.entries(A)){try{ABCJS.renderAbc(id,v.abc,{staffwidth:v.w-40,add_classes:true})}catch(e){}}</script>`);
console.log('galerie écrite');
