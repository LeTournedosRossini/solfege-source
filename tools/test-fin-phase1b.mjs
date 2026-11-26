// Explication après erreur (REV-05), séries de 10 dans l'oreille (SUI-04), enchaînement « Tout réviser » (REV-04). Usage : node tools/test-fin-phase1b.mjs <url>
import { chromium } from 'playwright-core';
import { autoOk } from './aide-tests.mjs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 170000);
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage();
await autoOk(p);
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
await p.goto(url); await p.evaluate(() => localStorage.clear());
// --- explications après erreur
const cas = [['clef-sol', 'ng', /ligne|interligne|espace/], ['accords', 'ag', /Accord|Septième/], ['durees-silences', 'dg', /temps/], ['degres', 'gg', /degré/], ['tonalites', 'kg', /armure/], ['intervalles', 'ig', /demi-ton/]];
for (const [jeu, gid, motif] of cas) {
  await p.goto(url + '#/jeux/' + jeu); await p.waitForSelector(`#${gid}-answers .ans-btn`);
  let texte = '';
  for (let i = 0; i < 6 && !motif.test(texte); i++) { await p.locator(`#${gid}-answers .ans-btn`).nth(i % 3).click(); await p.waitForTimeout(150); texte = await p.locator(`#${gid}-feedback`).textContent(); if (!/C'était|Exact/.test(texte)) await p.waitForTimeout(0); await p.waitForTimeout(1000); }
  check(`explication après erreur : ${jeu}`, motif.test(texte), texte);
}
// --- oreille : série de 10
await p.goto(url + '#/oreille'); await p.waitForSelector('#ecStaffWrap svg');
await p.locator('#intervalSubtabs .subtab2-btn[data-sub="ident"]').click();
await p.click('#hamburgerBtn'); await p.click('#selectAllBtn'); await p.keyboard.press('Escape');
await p.locator('#intervalIdentPanel .chip.serie').click();
check('oreille : série démarrée (compteur 1 / 10)', (await p.locator('#intervalIdentPanel .chip.serie').textContent()) === 'Série : 1 / 10');
for (let i = 0; i < 10; i++) {
  const semi = await p.evaluate(() => window.__oreille.state().ivCur.iv.semitones);
  if (i < 2) { const faux = await p.locator(`#answersGrid .ans-btn:not(.inactive):not([data-semitones="${semi}"])`).first(); await faux.click(); }
  await p.locator(`#answersGrid .ans-btn[data-semitones="${semi}"]`).click();
  await p.waitForTimeout(i === 9 ? 100 : 3400);
}
await p.waitForSelector('#intervalIdentPanel .bilan-o', { timeout: 9000 });
const t = await p.locator('#intervalIdentPanel .bilan-o').textContent();
check('oreille : bilan 8 / 10 avec durée et éléments à retravailler', /Série terminée : 8 \/ 10/.test(t) && /Durée/.test(t) && /À retravailler/.test(t), t.slice(0, 160));
await p.click('#intervalIdentPanel .bilan-o [data-act=encore]'); await p.waitForTimeout(300);
check('oreille : nouvelle série', (await p.locator('#intervalIdentPanel .bilan-o').count()) === 0 && (await p.locator('#intervalIdentPanel .chip.serie').textContent()) === 'Série : 1 / 10');
// --- tout réviser
await p.evaluate(() => { const n = Date.now(), J = 86400000; const e = (d, j, el, o) => ({ t: n - d * J, j, e: el, m: 'L', ok: o }); const l = []; [0, 0, 1, 0].forEach((o, i) => l.push(e(1 - i * 0.01, 'clef-sol', 'note:treble:G4', o))); [0, 0, 0].forEach((o, i) => l.push(e(1 - i * 0.01, 'ag', 'accord:Majeur', o))); localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: l, lecons: {} })); });
await p.goto(url + '#/progression'); await p.waitForSelector('.prog-actions a');
const tout = p.locator('.prog-actions a', { hasText: 'Tout réviser' });
check('progrès : bouton « Tout réviser » (2 jeux)', await tout.count() === 1, await tout.textContent());
await tout.click(); await p.waitForSelector('#ng-answers .ans-btn, #ag-answers .ans-btn');
check('réviser : une série de 10 démarre automatiquement', await p.locator('[id$=-rang]').first().textContent() === '1/10');
const gid = (await p.locator('.game-shell .ans-btn').first().evaluate((el) => el.parentElement.id)).replace('-answers', '');
for (let i = 0; i < 10; i++) { await p.locator(`#${gid}-answers .ans-btn`).nth(i % 3).click(); await p.waitForTimeout(i === 9 ? 1500 : 1000); }
await p.waitForSelector(`#${gid}-bilan`);
const lien = p.locator(`#${gid}-bilan a.btn`);
check('réviser : à la fin, lien vers le jeu suivant à réviser', await lien.count() === 1, await lien.textContent().catch(() => ''));
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
