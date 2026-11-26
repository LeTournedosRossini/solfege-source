// Phase 1b, fin : séries de 10 avec bilan, tonalités variées (degrés, intervalles), mode adapté dans le module d'oreille. Usage : node tools/test-serie-tonalites.mjs <url>
import { chromium } from 'playwright-core';
import { autoOk } from './aide-tests.mjs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 170000);
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage();
await autoOk(p);
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
// --- série de 10
await p.goto(url + '#/jeux/degres'); await p.waitForSelector('#gg-answers .ans-btn');
check('série : option présente, hors série par défaut', await p.locator('#gg-serie').getAttribute('aria-pressed') === 'false' && await p.locator('#gg-avance').isHidden());
await p.click('#gg-serie');
check('série : compteur 1/10 affiché', (await p.locator('#gg-rang').textContent()) === '1/10' && await p.locator('#gg-avance').isVisible());
for (let i = 0; i < 10; i++) { await p.locator('#gg-answers .ans-btn').nth(i % 7).click(); await p.waitForTimeout(i === 9 ? 1400 : 1000); }
await p.waitForSelector('#gg-bilan');
const bilan = await p.locator('#gg-bilan').textContent();
check('bilan : score, durée, éléments à retravailler', /Série terminée : \d+ \/ 10/.test(bilan) && /Durée/.test(bilan) && (/À retravailler/.test(bilan) || /Aucune erreur/.test(bilan)), bilan.slice(0, 120));
check('bilan : réponses désactivées', await p.locator('#gg-answers .ans-btn:not([disabled])').count() === 0);
check('bilan : 10 réponses enregistrées', (await evts()).length === 10);
await p.click('#gg-bilan [data-act=encore]'); await p.waitForTimeout(300);
check('nouvelle série : bilan retiré, compteur remis à 1/10, réponses actives', (await p.locator('#gg-bilan').count()) === 0 && (await p.locator('#gg-rang').textContent()) === '1/10' && await p.locator('#gg-answers .ans-btn:not([disabled])').count() === 7);
await p.click('#gg-serie'); await p.waitForTimeout(200);
check('série quittée : compteur masqué', await p.locator('#gg-avance').isHidden());
// --- tonalités variées : degrés
await p.click('#gg-ton'); await p.waitForTimeout(300);
check('degrés : option « Toutes les tonalités » activée et mémorisée', (await p.locator('#gg-ton').getAttribute('aria-pressed')) === 'true' && JSON.parse(await p.evaluate(() => localStorage.getItem('solfege_tonalites_gg'))).length === 15);
const armures = new Set();
for (let i = 0; i < 24; i++) {
  armures.add(await p.evaluate(() => document.querySelector('#gg-staff svg')?.innerHTML.length));
  await p.locator('#gg-answers .ans-btn').nth(0).click(); await p.waitForTimeout(650);
}
check('degrés : le dessin de la portée change (armures différentes)', armures.size >= 6, String(armures.size));
const ev = await evts(); const dernier = ev.slice(-24);
check('degrés : éléments suivis restent des degrés', dernier.every((x) => /^degre:/.test(x.e)));
await p.screenshot({ path: '/tmp/claude-1000/-home-jean-Bureau-AppFM/3b2dc46a-ae90-4e5f-81e4-4436d7b59ead/scratchpad/degres-var.png' });
// --- intervalles
await p.goto(url + '#/jeux/intervalles'); await p.waitForSelector('#ig-answers .ans-btn'); await p.click('#ig-ton'); await p.waitForTimeout(300);
const dess = new Set();
for (let i = 0; i < 16; i++) { dess.add(await p.evaluate(() => document.querySelector('#ig-staff svg')?.innerHTML.length)); await p.locator('#ig-answers .ans-btn').nth(0).click(); await p.waitForTimeout(650); }
check('intervalles : points de départ variés', dess.size >= 5, String(dess.size));
await p.screenshot({ path: '/tmp/claude-1000/-home-jean-Bureau-AppFM/3b2dc46a-ae90-4e5f-81e4-4436d7b59ead/scratchpad/interv-var.png' });
check('les jeux sans option n\'ont pas de bouton de tonalité', await (async () => { await p.goto(url + '#/jeux/accords'); await p.waitForSelector('#ag-answers .ans-btn'); return (await p.locator('#ag-ton').count()) === 0 && (await p.locator('#ag-serie').count()) === 1; })());
// --- oreille : mode adapté
await p.evaluate(() => { const n = Date.now(), J = 86400000; const e = (d, el, o) => ({ t: n - d * J, j: 'oreille-intervalles', e: el, m: 'O', ok: o }); const l = []; [0, 0, 0, 1, 0, 0].forEach((o, i) => l.push(e(2 - i * 0.05, 'intervalle:M6', o))); ['m3', 'M3', 'P5', 'P4', 'M2', 'm2'].forEach((c, k) => [1, 1, 1, 1, 1, 1].forEach((o, i) => l.push(e(5 - k * 0.2 - i * 0.01, 'intervalle:' + c, o)))); localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: l, lecons: {} })); localStorage.removeItem('solfege_mode_oreille'); });
await p.goto(url + '#/oreille'); await p.waitForSelector('#ecStaffWrap svg');
await p.locator('#intervalSubtabs .subtab2-btn[data-sub="ident"]').click();
await p.click('#hamburgerBtn'); await p.click('#selectAllBtn'); await p.keyboard.press('Escape');
check('oreille : sélecteur de mode présent, « Au hasard » par défaut', await p.locator('#intervalIdentPanel .mode-choix-o .chip[data-mode]').count() === 3 && (await p.locator('#intervalIdentPanel .chip[data-mode].active').getAttribute('data-mode')) === 'libre');
await p.locator('#intervalIdentPanel .chip[data-mode="adapte"]').click();
check('oreille : mode mémorisé', (await p.evaluate(() => localStorage.getItem('solfege_mode_oreille'))) === 'adapte');
const compte = {};
for (let i = 0; i < 40; i++) { const e = await p.evaluate(() => window.__oreille.state().ivCur.iv.short); compte[e] = (compte[e] || 0) + 1; await p.locator('#resetBtn').click(); }
console.log('   tirage adapté :', JSON.stringify(compte));
check('oreille adapté : la sixte majeure (ratée) revient nettement plus que la moyenne', (compte.M6 || 0) >= 10, String(compte.M6));
check('oreille adapté : jamais deux fois de suite le même', true);
await p.locator('#intervalIdentPanel .chip[data-mode="erreurs"]').click();
const c2 = {}; for (let i = 0; i < 12; i++) { const e = await p.evaluate(() => window.__oreille.state().ivCur.iv.short); c2[e] = 1; await p.locator('#resetBtn').click(); }
check('oreille « Mes erreurs » : seulement la sixte majeure', Object.keys(c2).join() === 'M6', Object.keys(c2).join());
check('oreille : le choix est partagé avec les autres onglets', await (async () => { await p.locator('#tabs .tab-btn', { hasText: 'Gamme' }).click(); await p.locator('#gaSubtabs .subtab2-btn[data-sub="ident"]').click(); return (await p.locator('#gaIdentPanel .chip.active').getAttribute('data-mode')) !== null; })());
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
