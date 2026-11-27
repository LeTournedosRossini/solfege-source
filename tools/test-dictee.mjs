// Dictées rythmique et mélodique (CON-04) : générateurs (Node), puis les deux jeux dans le navigateur. Usage : node tools/test-dictee.mjs <url>
import * as D from '../src/app/dictee-donnees.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
let mauvais = 0;
for (const g of ['rythme', 'melodie']) for (const n of [1, 2, 3]) for (let i = 0; i < 300; i++) {
  const q = D.question(g, n); const k = q.options.map((o) => o.join());
  if (new Set(k).size !== 3 || q.bonne < 0 || q.bonne > 2) mauvais++;
  if (g === 'rythme' && q.options.some((o) => o.reduce((s, c) => s + D.CELLULES[c].temps, 0) !== 4)) mauvais++;
  if (g === 'rythme' && q.options.some((o) => o[0] === 'R')) mauvais++;
  if (g === 'melodie' && n < 3 && new Set(q.options.map((o) => o[0])).size !== 1) mauvais++;
}
check('générateurs : 3 propositions distinctes, mesures complètes (4 temps), première note commune aux niveaux 1 et 2', mauvais === 0, String(mauvais));
check('rythme niveau 1 : seulement noires et croches', Array.from({ length: 200 }, () => D.question('rythme', 1)).every((q) => q.options.flat().every((c) => c === 'Q' || c === 'EE')));
check('rythme niveau 3 : toutes les cellules apparaissent', ['H', 'R', 'SSSS', 'ESS', 'SSE', 'QPE'].every((c) => Array.from({ length: 300 }, () => D.question('rythme', 3)).some((q) => q.options.flat().includes(c))));
check('mélodie niveau 1 : trois notes par degrés conjoints', Array.from({ length: 200 }, () => D.question('melodie', 1)).every((q) => q.options.every((m) => m.length === 3)));
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 }, permissions: ['clipboard-read'] })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
for (const [id, gid, genre] of [['dictee-rythme', 'drg', 'rythme'], ['dictee-melodie', 'dmg', 'melodie']]) {
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-options .dictee-option svg`);
  check(`${id} : trois propositions dessinées, bouton Écouter, niveau 1 par défaut`, await p.locator(`#${gid}-options .dictee-option`).count() === 3 && await p.locator(`#${gid}-ecouter`).count() === 1 && (await p.locator(`#${gid}-niveau .chip.active`).getAttribute('data-niveau')) === '1');
  check(`${id} : chaque proposition a un nom accessible`, (await p.locator(`#${gid}-options .dictee-option`).first().getAttribute('aria-label')) === 'Proposition A');
  // première réponse volontairement fausse : on ne connaît pas la bonne, on essaie les trois jusqu'à une erreur
  let faux = false;
  for (let essai = 0; essai < 8 && !faux; essai++) {
    await p.locator(`#${gid}-options .dictee-option`).nth(essai % 3).click(); await p.waitForTimeout(200);
    if (await p.locator(`#${gid}-ok`).count()) faux = true; else await p.waitForTimeout(1500);
  }
  check(`${id} : après une erreur, bouton OK, bonne proposition signalée, réponses bloquées`, faux && await p.locator(`#${gid}-options .dictee-option.correct`).count() === 1 && await p.locator(`#${gid}-options .dictee-option.wrong`).count() === 1);
  const texte = await p.locator(`#${gid}-feedback`).textContent();
  await p.waitForTimeout(3000);
  check(`${id} : la correction reste affichée`, (await p.locator(`#${gid}-feedback`).textContent()) === texte && /la bonne réponse est la proposition/.test(texte), texte.slice(0, 70));
  check(`${id} : bouton pour écouter la bonne proposition`, await p.locator(`#${gid}-rejouer`).count() === 1);
  await p.click(`#${gid}-ok`); await p.waitForTimeout(300);
  check(`${id} : OK passe à une nouvelle question`, await p.locator(`#${gid}-ok`).count() === 0 && await p.locator(`#${gid}-options .dictee-option.correct`).count() === 0 && await p.locator(`#${gid}-rejouer`).count() === 0);
  const e = (await evts()).filter((x) => x.j === id);
  check(`${id} : réponses enregistrées en oreille (modalité O)`, e.length >= 1 && e.every((x) => x.m === 'O' && x.e === `dictee:${genre}-1`) && e.some((x) => !x.ok), e.map((x) => `${x.e}=${x.ok}`).join(' '));
  await p.click(`#${gid}-niveau [data-niveau="3"]`); await p.waitForTimeout(300);
  check(`${id} : niveau 3 choisi et mémorisé`, (await p.evaluate((i) => localStorage.getItem('solfege_niveau_' + i), id)) === '3' && (await p.locator(`#${gid}-niveau .chip.active`).getAttribute('data-niveau')) === '3');
}
await p.goto(url + '#/jeux/dictee-melodie?niveau=2'); await p.waitForSelector('#dmg-options .dictee-option'); 
check('lien avec niveau : niveau 2 actif', (await p.locator('#dmg-niveau .chip.active').getAttribute('data-niveau')) === '2');
await p.goto(url + '#/progression'); await p.waitForTimeout(500);
const t = await p.locator('#view').textContent();
check('page Progrès : les deux dictées figurent dans la réussite par activité', t.includes('Dictée rythmique') && t.includes('Dictée mélodique'));
await p.evaluate(() => { const n = Date.now(); localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: [0, 0, 1, 0].map((o, i) => ({ t: n - i * 1000, j: 'dictee-melodie', e: 'dictee:melodie-2', m: 'O', ok: o })), lecons: {} })); });
await p.goto(url + '#/progression'); await p.reload(); await p.waitForTimeout(600);
const t2 = await p.locator('#view').textContent();
check('page Progrès : élément « Dictée mélodique, niveau 2 » à retravailler', t2.includes('Dictée mélodique, niveau 2'));
check('page Progrès : bouton « Réviser » vers la dictée', await p.locator('.prog-actions a[href="#/jeux/dictee-melodie?reviser=1"]').count() === 1);
check('les leçons liées proposent la dictée', await (async () => { await p.goto(url + '#/cours/mesure-temps'); await p.waitForSelector('.liens-croises'); return (await p.locator('.liens-croises').textContent()).includes('Dictée rythmique'); })());
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
