// Dans une leçon : clic sur le premier ▶, démarrage, fin, relecture. Usage : node tools/test-lecon-son.mjs <url> <id de leçon>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 80000);
const [url, id] = [process.argv[2], process.argv[3] || 'intervalles'];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 760, height: 900 } });
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) erreurs.push(m.text()); });
await p.goto(url + '#/cours/' + id); await p.waitForSelector('.abc-play-btn');
const btn = p.locator('.abc-play-btn').first(); await btn.click();
await p.waitForFunction(() => [...document.querySelectorAll('.abc-play-btn')].some((x) => x.textContent.includes('Stop')), null, { timeout: 40000 });
console.log('démarré :', await p.locator('#sndstatus').textContent());
await p.waitForFunction(() => ![...document.querySelectorAll('.abc-play-btn')].some((x) => x.textContent.includes('Stop')), null, { timeout: 30000 });
console.log('fini :', await p.locator('#sndstatus').textContent());
await btn.click(); await p.waitForTimeout(1200); console.log('relecture :', (await btn.textContent()).trim());
console.log(erreurs.length ? 'ERREURS ' + erreurs.join(' / ') : 'aucune erreur'); await b.close(); process.exit(0);
