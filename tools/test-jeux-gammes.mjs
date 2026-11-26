// Jeux « Altérations » et « Gammes mineures » (CON-02) : données (Node) puis jeux dans le navigateur. Usage : node tools/test-jeux-gammes.mjs <url>
import { POOL_GAMMES, POOL_ALTERATIONS, GAMMES_LABELS, notesDeGamme } from '../src/app/jeux-gammes.js';
import { autoOk } from './aide-tests.mjs';
import { nameToMidi } from '../src/app/oreille-theorie.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const demi = (g) => g.notes.map((n, i) => nameToMidi(n) - nameToMidi(g.notes[0]));
const F = { 'Majeure': [0, 2, 4, 5, 7, 9, 11, 12], 'Mineure naturelle': [0, 2, 3, 5, 7, 8, 10, 12], 'Mineure harmonique': [0, 2, 3, 5, 7, 8, 11, 12], 'Mineure mélodique': [0, 2, 3, 5, 7, 9, 11, 12] };
check('gammes : chaque gamme a la bonne formule en demi-tons', POOL_GAMMES.every((g) => demi(g).join() === F[g.label].join()));
check('gammes : huit notes, lettres successives, aucune double altération', POOL_GAMMES.every((g) => g.notes.length === 8 && !g.notes.some((n) => /x|bb|##/.test(n))));
const par = POOL_GAMMES.reduce((a, g) => (a[g.label] = (a[g.label] || 0) + 1, a), {});
check('gammes : les quatre types sont représentés', GAMMES_LABELS.every((l) => par[l] >= 7), JSON.stringify(par));
check('gammes : une gamme à double altération est refusée', notesDeGamme('G', 1, F['Mineure harmonique']) === null);
const dem = (a) => nameToMidi(a.notes[1]) - nameToMidi(a.notes[0]);
check('altérations : dièse +1, bémol −1, bécarre ±1', POOL_ALTERATIONS.every((a) => (a.label === 'Dièse' ? dem(a) === 1 : a.label === 'Bémol' ? dem(a) === -1 : Math.abs(dem(a)) === 1)));
check('altérations : un bécarre part toujours d\'une note altérée', POOL_ALTERATIONS.filter((a) => a.label === 'Bécarre').every((a) => /[#b]/.test(a.notes[0]) && !/[#b]/.test(a.notes[1])));
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
await autoOk(p);
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
for (const [id, gid, nb, prefixe, motif] of [['alterations', 'alg', 3, 'alteration:', /♯|♭|♮/], ['gammes-mineures', 'gmg', 4, 'gamme:', /Gamme|Mineure|majeure|degré/]]) {
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-answers .ans-btn`);
  check(`${id} : ${nb} réponses fixes, partition dessinée`, await p.locator(`#${gid}-answers .ans-btn`).count() === nb && await p.locator(`#${gid}-staff svg`).count() === 1);
  let texte = '';
  for (let i = 0; i < 12; i++) { await p.locator(`#${gid}-answers .ans-btn`).nth(i % nb).click(); await p.waitForTimeout(80); const t = await p.locator(`#${gid}-feedback`).textContent(); if (/C'était/.test(t)) texte = t; await p.waitForTimeout(900); }
  const e = (await evts()).filter((x) => x.e.startsWith(prefixe));
  check(`${id} : 12 réponses enregistrées avec des éléments « ${prefixe}… »`, e.length === 12, [...new Set(e.map((x) => x.e))].join(' '));
  check(`${id} : explication après erreur`, motif.test(texte), texte);
  check(`${id} : option série de 10 présente`, await p.locator(`#${gid}-serie`).count() === 1);
}
check('la page Progrès nomme ces jeux', await (async () => { await p.goto(url + '#/progression'); await p.waitForTimeout(500); const t = await p.locator('main, #view').first().textContent(); return t.includes('Jeu des altérations') && t.includes('Jeu des gammes mineures'); })());
check('liens leçon ↔ jeu', await (async () => { await p.goto(url + '#/cours/alterations'); await p.waitForSelector('.liens-croises'); const a = (await p.locator('.liens-croises').textContent()).includes('altérations'); await p.goto(url + '#/jeux/gammes-mineures'); await p.waitForSelector('.liens-croises'); return a && (await p.locator('.liens-croises').textContent()).includes('Les gammes mineures'); })());
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
