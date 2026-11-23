// Le curseur doit défiler (et revenir) sur un exemple de reprise. Usage : node tools/test-reprise.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 110000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
await p.goto(url + '#/controle'); await p.waitForSelector('.sc svg', { timeout: 20000 });
let ok = true;
for (const id of (process.argv[3] || 'c37,c38').split(',')) {
  const row = p.locator('div', { has: p.locator('code', { hasText: id + ' ' }) }).last();
  const btn = row.locator('button'); await btn.scrollIntoViewIfNeeded(); await btn.click();
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent.includes('Stop')), null, { timeout: 40000 });
  const xs = [];
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(350); const v = await row.locator('.sc div[aria-hidden]').evaluate((e) => (e ? parseFloat(e.style.left) : null)).catch(() => null); if (v != null && !isNaN(v)) xs.push(Math.round(v)); if (!(await btn.textContent()).includes('Stop')) break; }
  const recule = xs.some((x, i) => i && x < xs[i - 1] - 5), max = Math.max(...xs), min = Math.min(...xs);
  console.log(id, 'positions :', xs.join(' '));
  const bon = xs.length > 5 && max - min > 100; if (!bon) ok = false; console.log(bon ? 'OK  ' : 'ECHEC', id, 'le curseur défile', `(de ${min} à ${max} px, retour en arrière : ${recule})`);
  await p.waitForFunction(() => ![...document.querySelectorAll('button')].some((x) => x.textContent.includes('Stop')), null, { timeout: 40000 });
}
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
