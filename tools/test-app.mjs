// Essais de la coque : pages, thèmes, absence de ressource externe, fonctionnement hors-ligne. Usage : node tools/test-app.mjs <url> [capture.png]
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 60000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
const p = await ctx.newPage();
const externes = [], erreurs = [];
p.on('request', (r) => { if (!r.url().startsWith(new URL(url).origin) && !r.url().startsWith('data:')) externes.push(r.url()); });
p.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
p.on('pageerror', (e) => erreurs.push('pageerror ' + e.message));
let ok = true; const check = (nom, cond, detail = '') => { if (!cond) ok = false; console.log(cond ? 'OK  ' : 'ECHEC', nom, detail); };
await p.goto(url); await p.waitForSelector('.card');
check('accueil : 3 cartes + 3 outils', (await p.locator('.card').count()) === 6, String(await p.locator('.card').count()));
await p.goto(url + '#/cours'); await p.waitForSelector('.card'); check('cours : 25 leçons', (await p.locator('.card').count()) === 25);
await p.goto(url + '#/jeux'); await p.waitForSelector('.card'); check('jeux : 14 (dont deux jeux de rythme)', (await p.locator('.card').count()) === 14);
await p.goto(url + '#/outils'); await p.waitForSelector('.card'); check('outils : 3', (await p.locator('.card').count()) === 3);
await p.goto(url + '#/cours/portee-cles'); check('détail leçon', (await p.locator('h2').first().textContent()).includes('portée'));
// thèmes
await p.goto(url); const seq = [];
for (let i = 0; i < 4; i++) { await p.click('#theme-toggle'); seq.push(await p.evaluate(() => document.documentElement.getAttribute('data-theme') || 'auto')); }
check('thèmes : clair, sombre, contraste, auto', seq.join(',') === 'light,dark,contrast,auto', seq.join(','));
await p.click('#theme-toggle'); await p.reload(); await p.waitForSelector('.card');
check('thème conservé (clé solfege_theme)', (await p.evaluate(() => localStorage.getItem('solfege_theme'))) === 'light');
const polices = await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.style).join(' | '); });
check('polices embarquées chargées', /Inter/.test(polices) && /Fraunces/.test(polices), polices);
// hors-ligne
await p.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(800);
await ctx.setOffline(true);
await p.goto(url + '#/jeux'); await p.reload(); await p.waitForSelector('.card', { timeout: 10000 }).catch(() => {});
check('hors-ligne : la page se recharge', (await p.locator('.card').count()) === 14, 'cartes=' + (await p.locator('.card').count()));
await ctx.setOffline(false);
if (process.argv[3]) { await p.goto(url); await p.waitForSelector('.card'); await p.screenshot({ path: process.argv[3] }); }
check('aucune ressource externe', externes.length === 0, externes.join(' ') || '');
check('aucune erreur console', erreurs.length === 0, erreurs.slice(0, 3).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
