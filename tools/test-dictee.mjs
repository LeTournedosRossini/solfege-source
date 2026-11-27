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
// la place de la bonne proposition (A, B, C) doit être équilibrée, jamais plus de deux fois de suite la même
for (const g of ['rythme', 'melodie']) for (const n of [1, 2, 3]) {
  const c = [0, 0, 0], h = []; let serie = 0, maxi = 0, prec = -1;
  for (let i = 0; i < 6000; i++) { const q = D.question(g, n, Math.random, h); h.push(q.bonne); c[q.bonne]++; serie = q.bonne === prec ? serie + 1 : 1; prec = q.bonne; maxi = Math.max(maxi, serie); }
  check(`${g} niveau ${n} : bonne proposition équilibrée (chaque place entre 30 % et 37 %) et jamais plus de 2 fois de suite la même`, c.every((x) => x / 6000 > 0.30 && x / 6000 < 0.37) && maxi <= 2, `${c.map((x) => Math.round(x / 60) + '%').join(' / ')} · série max ${maxi}`);
}
const melU = Array(30000).fill(0).map(() => D.melange([0, 1, 2]).join()).reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {});
check('le mélange est uniforme : les six ordres de 3 éléments sortent chacun entre 15 % et 18 %', Object.keys(melU).length === 6 && Object.values(melU).every((x) => x / 30000 > 0.15 && x / 30000 < 0.18));
const ec = D.descEcoute('rythme', ['Q', 'EE', 'H'], 80, true), sans = D.descEcoute('rythme', ['Q', 'EE', 'H'], 80, false);
check('au piano, le précompte est une mesure de 4 silences (les clics de métronome sont joués pendant ce temps) ; sans précompte rien n\'est ajouté', ec.measures.length === 2 && ec.measures[0].length === 4 && ec.measures[0].every((e) => e.rest && e.d === 'quarter') && ec.bpm === sans.bpm && sans.measures.length === 1);
check('positions des attaques en clics : Q EE H → 0, 1, 1,5, 2 ; un silence n\'a pas d\'attaque ; noire pointée + croche → 0 et 1,5', JSON.stringify(D.battements(['Q', 'EE', 'H'])) === '[0,1,1.5,2]' && JSON.stringify(D.battements(['R', 'Q', 'QPE'])) === '[1,2,3.5]' && JSON.stringify(D.battements(['QPE', 'Q', 'Q'])) === '[0,1.5,2,3]');
check('la dictée mélodique n\'a pas de précompte', D.descEcoute('melodie', [0, 1, 2], 80, true).measures.length === 1);
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 }, permissions: ['clipboard-read'] })).newPage();
await p.addInitScript(() => { window.__claques = []; const o = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (t, ...r) { window.__claques.push(t ?? 0); return o.call(this, t, ...r); }; });   // compte les claquements de métronome
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
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
await p.goto(url + '#/jeux/dictee-rythme'); await p.waitForSelector('#drg-precompte');
check('rythme : bouton « Précompte de 4 temps » actif par défaut, désactivable et mémorisé', (await p.locator('#drg-precompte').getAttribute('aria-pressed')) === 'true' && await (async () => { await p.click('#drg-precompte'); return (await p.locator('#drg-precompte').getAttribute('aria-pressed')) === 'false' && (await p.evaluate(() => localStorage.getItem('solfege_dictee_precompte'))) === '0'; })());
await p.click('#drg-precompte');
check('mélodie : pas de bouton de précompte', await (async () => { await p.goto(url + '#/jeux/dictee-melodie'); await p.waitForSelector('#dmg-options'); return (await p.locator('#dmg-precompte').count()) === 0; })());
const lettres = []; await p.goto(url + '#/jeux/dictee-rythme'); await p.waitForSelector('#drg-options .dictee-option');
for (let i = 0; i < 12; i++) { lettres.push(await p.evaluate(() => 0)); await p.locator('#drg-options .dictee-option').first().click(); await p.waitForTimeout(150); if (await p.locator('#drg-ok').count()) await p.click('#drg-ok'); else await p.waitForTimeout(1300); }
// --- sons : piano ou clic de métronome (dictée rythmique)
await p.goto(url + '#/jeux/dictee-rythme'); await p.waitForSelector('#drg-son-clic');
check('sons : « Piano » actif par défaut, « Clic de métronome » proposé', (await p.locator('#drg-son-piano').getAttribute('aria-pressed')) === 'true' && (await p.locator('#drg-son-clic').getAttribute('aria-pressed')) === 'false');
await p.click('#drg-son-clic');
check('sons : le choix « clic » est mémorisé', (await p.evaluate(() => localStorage.getItem('solfege_dictee_son'))) === 'clic' && (await p.locator('#drg-son-clic').getAttribute('aria-pressed')) === 'true');
const claques = () => p.evaluate(() => window.__claques.length), razClaques = () => p.evaluate(() => { window.__claques = []; });
await p.waitForTimeout(600); await razClaques(); await p.click('#drg-ecouter'); await p.waitForTimeout(300);
const st = await p.evaluate(() => window.__dictee.etat());
console.log('   état :', JSON.stringify({ son: st.son, precompte: st.precompte, claques: await claques(), bouton: await p.locator('#drg-ecouter').textContent() }));
check('en clics, avec précompte : 4 clics de précompte + une attaque par note du rythme', st.son === 'clic' && st.precompte && (await claques()) === 4 + st.battements.length, `${await claques()} = 4 + ${st.battements.length}`);
check('pendant la lecture en clics, le bouton devient « Stop »', (await p.locator('#drg-ecouter').textContent()).includes('Stop'));
await p.click('#drg-ecouter'); await p.waitForTimeout(150);
check('un second appui arrête la lecture', (await p.locator('#drg-ecouter').textContent()).includes('Écouter'));
await p.click('#drg-precompte'); await razClaques(); await p.click('#drg-ecouter'); await p.waitForTimeout(300);
const st2 = await p.evaluate(() => window.__dictee.etat());
check('en clics, sans précompte : seulement les attaques du rythme', !st2.precompte && (await claques()) === st2.battements.length, `${await claques()} = ${st2.battements.length}`);
await p.click('#drg-ecouter'); await p.click('#drg-precompte');
await p.click('#drg-son-piano'); await razClaques(); await p.click('#drg-ecouter'); await p.waitForTimeout(2500);
check('au piano, avec précompte : 4 clics de métronome joués avant le rythme', (await claques()) >= 4 && (await p.evaluate(() => window.__claques.slice(0, 4))).every((t, i, a) => i === 0 || Math.abs(t - a[i - 1] - 60 / 80) < 0.01), JSON.stringify(await p.evaluate(() => window.__claques.slice(0, 5).map((t) => Math.round(t * 1000) / 1000))));
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
