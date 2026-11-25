// Choix des questions dans les jeux de lecture : au hasard / adapté à la progression / mes erreurs, et « Réviser maintenant » depuis la page Progrès. Usage : node tools/test-adaptatif.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 150000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage();
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
const J = 86400000;
const repondre = async (gid, n) => { for (let i = 0; i < n; i++) { await p.locator(`#${gid}-answers .ans-btn`).nth(i % 5).click(); await p.waitForTimeout(1100); } };
const pressed = (gid) => p.locator(`#${gid}-mode .chip[aria-pressed="true"]`).getAttribute('data-mode');
await p.goto(url); await p.evaluate(() => localStorage.clear());
// --- par défaut : au hasard, comme avant
await p.goto(url + '#/jeux/intervalles'); await p.waitForSelector('#ig-answers .ans-btn');
check('par défaut : « Au hasard »', (await pressed('ig')) === 'libre' && await p.locator('#ig-mode .chip').count() === 3);
check('le sélecteur n\'existe pas dans les jeux de rythme (autre moteur)', await (async () => { await p.goto(url + '#/jeux/rythme-vue'); await p.waitForSelector('#rv-tap'); return (await p.locator('#rv-mode').count()) === 0; })());
// --- mes erreurs sans erreur : message et repli
await p.goto(url + '#/jeux/intervalles'); await p.waitForSelector('#ig-answers .ans-btn'); await p.click('#ig-mode [data-mode="erreurs"]'); await p.waitForTimeout(300);
check('« Mes erreurs » sans erreur : message neutre et retour au mode adapté', (await p.locator('#ig-feedback').textContent()).includes('Aucune erreur') && (await pressed('ig')) === 'adapte', await p.locator('#ig-feedback').textContent());
check('le choix est mémorisé pour ce jeu', (await p.evaluate(() => localStorage.getItem('solfege_mode_ig'))) === 'adapte');
// --- débutant en mode adapté : introduction progressive
await p.evaluate(() => { localStorage.removeItem('solfege_suivi'); });
await p.goto(url + '#/jeux/intervalles'); await p.waitForSelector('#ig-answers .ans-btn');
await repondre('ig', 8); const vus = new Set((await evts()).map((x) => x.e));
check('débutant en mode adapté : peu d\'éléments au départ (introduction progressive)', vus.size >= 2 && vus.size <= 4, [...vus].join(' '));
// --- séance ciblée : seul P5 a des erreurs
await p.evaluate((J) => { const n = Date.now(); const ev = (d, e, ok) => ({ t: n - d * J, j: 'ig', e, m: 'L', ok }); localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: [...[1, 0, 1, 0, 1].map((o, i) => ev(3 - i * 0.1, 'intervalle:P5', o)), ...[1, 1, 1].map((o, i) => ev(2 - i * 0.1, 'intervalle:M3', o))], lecons: {} })); localStorage.removeItem('solfege_mode_ig'); }, J);
await p.goto(url + '#/progression'); await p.waitForSelector('.prog-actions a');
const lien = p.locator('.prog-actions a', { hasText: 'Réviser' });
check('page Progrès : bouton « Réviser » vers le jeu des intervalles en mode révision', await lien.count() === 1 && (await lien.getAttribute('href')) === '#/jeux/intervalles?reviser=1', await lien.textContent());
const avant = (await evts()).length; await lien.click(); await p.waitForSelector('#ig-answers .ans-btn');
check('le bouton ouvre le jeu en mode « Mes erreurs »', (await pressed('ig')) === 'erreurs');
await repondre('ig', 7); const nouvelles = (await evts()).slice(avant);
check('mes erreurs : toutes les questions portent sur la quinte juste (seul élément raté)', nouvelles.length === 7 && nouvelles.every((x) => x.e === 'intervalle:P5'), nouvelles.map((x) => x.e).join(' '));
check('réviser : une série de 10 est lancée d\'office', (await p.locator('#ig-serie').getAttribute('aria-pressed')) === 'true');
await p.click('#ig-serie');
// --- adapté avec un élément raté : il revient souvent mais pas deux fois de suite
await p.click('#ig-mode [data-mode="adapte"]'); await p.waitForTimeout(200); const av2 = (await evts()).length; await repondre('ig', 14);
const suite = (await evts()).slice(av2).map((x) => x.e); const deuxFois = suite.filter((e, i) => i && e === suite[i - 1]).length;
check('adapté : jamais le même élément deux fois d\'affilée', deuxFois === 0, suite.join(' '));
check('adapté : l\'élément raté revient plus que les autres', suite.filter((e) => e === 'intervalle:P5').length >= 3, String(suite.filter((e) => e === 'intervalle:P5').length));
// --- autres jeux : le sélecteur est là et fonctionne (notes, tonalités, accords, durées, degrés)
for (const [id, gid] of [['clef-sol', 'ng'], ['tonalites', 'kg'], ['accords', 'ag'], ['durees-silences', 'dg'], ['degres', 'gg']]) {
  await p.evaluate(() => { localStorage.removeItem('solfege_suivi'); for (const k of Object.keys(localStorage)) if (k.startsWith('solfege_mode_')) localStorage.removeItem(k); });
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-answers .ans-btn`); await p.click(`#${gid}-mode [data-mode="adapte"]`); await repondre(gid, 3);
  const e = await evts(); check(`${id} : mode adapté, trois réponses enregistrées`, e.length === 3 && (await pressed(gid)) === 'adapte', e.map((x) => x.e).join(' '));
}
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 2).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
