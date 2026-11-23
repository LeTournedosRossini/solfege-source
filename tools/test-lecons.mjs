// Les 25 leçons : chargement, nombre de partitions dessinées, absence d'erreur et de ressource externe ; captures facultatives.
// Usage : node tools/test-lecons.mjs <url> [dossier de captures] [ids séparés par des virgules]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 150000);
const url = process.argv[2] || 'http://localhost:8123/'; const cap = process.argv[3]; const only = process.argv[4]?.split(',');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 760, height: 900 } });
const externes = [], erreurs = [];
p.on('request', (r) => { if (!r.url().startsWith(new URL(url).origin) && !r.url().startsWith('data:')) externes.push(r.url()); });
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) erreurs.push(m.text()); });
p.on('pageerror', (e) => erreurs.push('pageerror ' + e.message));
await p.goto(url); await p.waitForSelector('.card');
await p.goto(url + '#/cours'); await p.waitForSelector('.card');
const liste = await p.locator('.card').evaluateAll((els) => els.map((e) => e.getAttribute('href').split('/').pop()));
let ok = true, total = 0;
for (const id of liste) {
  if (only && !only.includes(id)) continue;
  await p.goto(url + '#/cours/' + id); await p.waitForSelector('.lesson-body', { timeout: 15000 });
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ hosts: document.querySelectorAll('[data-abc]').length, svgs: document.querySelectorAll('[data-abc] svg').length, btns: document.querySelectorAll('.abc-play-btn').length, textLen: document.querySelector('.lesson-body').innerText.length }));
  total += r.svgs; const bon = r.hosts === r.svgs && r.textLen > 300; if (!bon) ok = false;
  console.log(bon ? 'OK  ' : 'ECHEC', id.padEnd(22), `partitions ${r.svgs}/${r.hosts}, boutons ▶ ${r.btns}, texte ${r.textLen} car.`);
  if (cap) { fs.mkdirSync(cap, { recursive: true }); await p.screenshot({ path: `${cap}/${id}.png`, fullPage: true }); }
}
console.log('partitions dessinées :', total); if (externes.length) { ok = false; console.log('ECHEC ressources externes', externes.join(' ')); } if (erreurs.length) { ok = false; console.log('ECHEC erreurs', erreurs.slice(0, 3).join(' / ')); }
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
