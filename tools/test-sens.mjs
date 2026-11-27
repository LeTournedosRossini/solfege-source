// Page Progrès : l'oreille est détaillée par sens (montant, descendant, simultané) pour chaque intervalle (SUI-06). Usage : node tools/test-sens.mjs <url>
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:8124/';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
await p.goto(url);
await p.evaluate(() => { const n = Date.now(), ev = (i, e, c, ok) => ({ t: n - i * 1000, j: 'oreille-intervalles', e, m: 'O', ok, c });
  const l = [...[1, 1, 1, 0].map((o, i) => ev(i, 'intervalle:M3', 'montant', o)), ...[1, 0].map((o, i) => ev(10 + i, 'intervalle:M3', 'descendant', o)), ev(20, 'intervalle:P5', 'simultane', 1), ev(21, 'intervalle:P5', 'montant', 0)];
  localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: l, lecons: {} })); });
await p.goto(url + '#/progression'); await p.reload(); await p.waitForSelector('.prog-table');
const lignes = await p.locator('#p-interv ~ div tr, #p-interv + p + div tr').allTextContents();
const tierce = lignes.find((t) => t.includes('Tierce majeure')) || '', quinte = lignes.find((t) => t.includes('Quinte juste')) || '';
check('tierce majeure : détail montant 3/4 et descendant 1/2', /montant : 3\/4/.test(tierce) && /descendant : 1\/2/.test(tierce) && !/simultané/.test(tierce), tierce.replace(/\s+/g, ' ').slice(0, 160));
check('quinte juste : simultané 1/1 et montant 0/1', /simultané : 1\/1/.test(quinte) && /montant : 0\/1/.test(quinte), quinte.replace(/\s+/g, ' ').slice(0, 160));
check('le total à l\'oreille reste la somme des sens (tierce : 4/6)', /4\/6/.test(tierce));
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
