// Hors-ligne : après une première visite (service worker installé), coupe le réseau et vérifie que tout s'affiche encore :
// accueil, une leçon avec ses partitions, un jeu, les outils, le module d'oreille (partitions, import) ; et que les polices sont locales.
// Le son SoundFont (hébergé sur GitHub) n'est pas disponible hors-ligne : le moteur léger prend le relais (vérifié ici).
// Usage : node tools/test-hors-ligne.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 120000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const ctx = await b.newContext({ viewport: { width: 800, height: 900 } });
const p = await ctx.newPage();
const erreurs = [];
p.on('pageerror', (e) => erreurs.push('pageerror ' + e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
await p.goto(url); await p.waitForSelector('#view .card');
await p.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; const ks = await caches.keys(); let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return !!r.active && n > 10; }, null, { timeout: 60000 });
const nbCache = await p.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; });
check('service worker actif, fichiers en mémoire', nbCache > 10, `${nbCache} fichiers`);
await ctx.setOffline(true);
const externes = []; p.on('request', (r) => { if (!r.url().startsWith(new URL(url).origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) externes.push(r.url()); });
await p.reload(); await p.waitForSelector('#view .card');
check('accueil hors-ligne', await p.locator('#view .card').count() > 3);
await p.goto(url + '#/cours/portee-cles'); await p.waitForSelector('#view svg', { timeout: 15000 });
check('leçon hors-ligne : partitions dessinées', await p.locator('#view .abc-notation svg').count() >= 2, String(await p.locator('#view .abc-notation svg').count()));
await p.goto(url + '#/jeux/clef-sol'); await p.waitForSelector('#view svg', { timeout: 15000 });
check('jeu hors-ligne : question affichée', await p.locator('#view svg').count() >= 1);
await p.goto(url + '#/outils/piano'); await p.waitForSelector('.pkey.white', { timeout: 15000 });
check('outil piano hors-ligne', await p.locator('.pkey.white').count() > 10);
// les SoundFonts sont sur le même domaine que le site en production : on le simule (?sounds=/sons/) pour vérifier que la requête échoue franchement
await p.goto(url + '?sounds=/sons/#/oreille'); await p.waitForSelector('#ecStaffWrap svg', { timeout: 15000 });
check('oreille hors-ligne : partition dessinée', await p.locator('#ecStaffWrap [data-glyph^="notehead"]').count() === 2);
await p.click('#ecPlay'); await p.waitForFunction(() => /léger|SoundFont/.test(window.__oreille.root.getElementById('engineLabel').textContent), null, { timeout: 45000 }).catch(() => {});
const badge = await p.locator('#engineLabel').textContent();
check('oreille hors-ligne : le son bascule sur le moteur léger (SoundFont indisponible)', /léger/.test(badge), badge);
await p.waitForTimeout(500);
check('hors-ligne : aucune erreur de script', erreurs.length === 0, erreurs.slice(0, 2).join(' / '));
check('polices locales (aucune ressource externe sauf SoundFont)', externes.every((u) => /scorsaire-lecteur|sounds/.test(u)), externes.slice(0, 3).join(' '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
