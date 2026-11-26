// Après une erreur, la correction reste affichée jusqu'au clic sur « OK » ; une bonne réponse passe seule à la suite. Usage : node tools/test-ok-erreur.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 120000);
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
await p.goto(url); await p.evaluate(() => localStorage.clear());
await p.goto(url + '#/jeux/accords'); await p.waitForSelector('#ag-answers .ans-btn');
// répondre faux : on clique sur chaque bouton jusqu'à voir le bouton OK
let faux = false;
for (let i = 0; i < 5 && !faux; i++) {
  await p.locator('#ag-answers .ans-btn').nth(i).click(); await p.waitForTimeout(150);
  if (await p.locator('#ag-ok').count()) faux = true; else await p.waitForTimeout(1200);
}
check('erreur : un bouton « OK, question suivante » apparaît', faux);
const texte = await p.locator('#ag-feedback').textContent();
await p.waitForTimeout(4000);
check('erreur : la correction est toujours affichée après 4 secondes', (await p.locator('#ag-feedback').textContent()) === texte && /C'était/.test(texte), texte.slice(0, 80));
check('erreur : le bouton a le focus (Entrée suffit)', await p.evaluate(() => document.activeElement?.id === 'ag-ok'));
check('erreur : les réponses ne peuvent plus être cliquées avant OK', await p.evaluate(() => { const s = document.getElementById('ag-total').textContent; document.querySelector('#ag-answers .ans-btn').click(); return document.getElementById('ag-total').textContent === s; }));
await p.keyboard.press('Enter'); await p.waitForTimeout(300);
check('Entrée : question suivante, bouton retiré, correction effacée', (await p.locator('#ag-ok').count()) === 0 && !/C'était/.test(await p.locator('#ag-feedback').textContent()));
// bonne réponse : passage automatique
const bonne = await p.evaluate(() => null);
let passe = false;
for (let i = 0; i < 14 && !passe; i++) {
  await p.locator('#ag-answers .ans-btn').nth(i % 5).click(); await p.waitForTimeout(150);
  if (await p.locator('#ag-ok').count()) { await p.click('#ag-ok'); continue; }
  const avant = await p.locator('#ag-feedback').textContent(); await p.waitForTimeout(1500);
  passe = /Exact/.test(avant) && !(/Exact/.test(await p.locator('#ag-feedback').textContent()));
}
check('bonne réponse : la question suivante vient toute seule, sans bouton OK', passe);
// série de 10 : la dixième erreur attend aussi un OK avant le bilan
await p.click('#ag-serie');
for (let i = 0; i < 10; i++) {
  for (let k = 0; k < 5; k++) { await p.locator('#ag-answers .ans-btn').nth(k).click(); await p.waitForTimeout(120); if (await p.locator('#ag-ok').count()) { if (i === 9) break; await p.click('#ag-ok'); break; } await p.waitForTimeout(1100); break; }
  await p.waitForTimeout(i === 9 ? 100 : 0);
}
await p.waitForTimeout(1500);
const bilanDirect = await p.locator('#ag-bilan').count(), okPresent = await p.locator('#ag-ok').count();
check('série : le bilan ne se montre qu\'après le OK de la dernière erreur (ou tout de suite si juste)', (okPresent === 1 && bilanDirect === 0) || (okPresent === 0 && bilanDirect === 1), `ok=${okPresent} bilan=${bilanDirect}`);
if (okPresent) { await p.click('#ag-ok'); await p.waitForSelector('#ag-bilan'); check('série : OK ouvre le bilan', true); }
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
