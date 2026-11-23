// Parcourt l'ancienne application (servie en local, avec abcjs) et note chaque partition ABC qu'elle dessine : sert à lister les cas de notation à couvrir.
// Usage : node tools/inventaire-abc.mjs <url ancienne appli> <sortie.json>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 150000);
const [url, outFile] = [process.argv[2], process.argv[3]];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 700, height: 800 } });
await p.goto(url);
await p.waitForFunction(() => typeof ABCJS !== 'undefined', null, { timeout: 20000 });
await p.evaluate(() => { window.__abc = []; const o = ABCJS.renderAbc.bind(ABCJS); ABCJS.renderAbc = (id, s, opts) => { window.__abc.push({ route: location.hash, id, abc: s, opts: Object.keys(opts || {}).filter((k) => !['add_classes', 'paddingtop', 'paddingbottom', 'paddingleft', 'paddingright', 'scale'].includes(k)).map((k) => k + '=' + (typeof opts[k] === 'function' ? 'fn' : JSON.stringify(opts[k]))) }); return o(id, s, opts); }; });
const ids = await p.evaluate(() => [...new Set([...document.querySelectorAll('a')].map((a) => a.getAttribute('href')))]);
const lessonIds = await p.evaluate(() => LESSONS.map((l) => l.id));
const gameIds = ['clef-sol', 'clef-fa', 'rythme', 'tonalites', 'intervalles', 'accords', 'durees-silences', 'degres'];
const routes = [...lessonIds.map((i) => '#/cours/' + i), ...gameIds.map((i) => '#/jeux/' + i)];
for (const r of routes) {
  await p.evaluate((h) => { location.hash = h; }, r);
  await p.waitForTimeout(400);
  if (r.startsWith('#/jeux')) { for (let k = 0; k < 6; k++) { const btn = p.locator('.choice, .answer, button.choice, #view button').nth(1); await btn.click({ timeout: 1000 }).catch(() => {}); await p.waitForTimeout(150); } }
}
const data = await p.evaluate(() => window.__abc);
fs.writeFileSync(outFile, JSON.stringify(data, null, 1));
console.log(data.length, 'partitions notées sur', routes.length, 'pages');
await b.close(); process.exit(0);
