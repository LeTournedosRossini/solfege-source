// Mise à jour automatique : une page déjà ouverte avec l'ancienne version se recharge d'elle-même quand une nouvelle version est publiée.
// Usage : node tools/test-maj.mjs <dossier servi> <port>   (le dossier contient une copie du build ; le test le modifie)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 60000);
const [dir, port] = [process.argv[2], process.argv[3] || '8124'];
const url = `http://localhost:${port}/`;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage();
await p.goto(url); await p.waitForSelector('.card'); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('.card');
const v1 = (await p.locator('footer').innerText()).match(/Version (\w+)/)[1];
let n = 0; await p.exposeFunction('__marque', () => { n++; });
await p.evaluate(() => { window.__avant = true; });
// « publication » d'une nouvelle version : les fichiers servis changent
fs.writeFileSync(`${dir}/sw.js`, fs.readFileSync(`${dir}/sw.js`, 'utf8').replace(/const VERSION = '\w+'/, "const VERSION = 'zzzzzzzz'"));
fs.writeFileSync(`${dir}/index.html`, fs.readFileSync(`${dir}/index.html`, 'utf8').replace(`Version ${v1}`, 'Version zzzzzzzz'));
await p.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
let ok = false, rechargee = false;
for (let i = 0; i < 40 && !ok; i++) {
  await p.waitForTimeout(500);
  try { const t = await p.locator('footer').innerText(); rechargee = !(await p.evaluate(() => window.__avant === true)); ok = t.includes('zzzzzzzz'); } catch (e) { /* navigation en cours */ }
}
console.log(ok ? `OK   la page s'est mise à jour toute seule (${v1} → zzzzzzzz, rechargée : ${rechargee})` : 'ECHEC la page est restée sur l\'ancienne version');
await b.close(); process.exit(ok ? 0 : 1);
