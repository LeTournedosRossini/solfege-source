// Jeux « Modes grecs », « Transposition » et « Cadences » (CON-02) : données (Node) puis jeux dans le navigateur. Usage : node tools/test-jeux-contenu2.mjs <url>
import { POOL_MODES, FORMULES_MODES, MODES_LABELS, POOL_TRANSPOSITIONS, TRANSPOSITIONS_LABELS, POOL_CADENCES, CADENCES_LABELS, accordDuDegre } from '../src/app/jeux-contenu2.js';
import { autoOk } from './aide-tests.mjs';
import { nameToMidi } from '../src/app/oreille-theorie.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
check('modes : chaque gamme suit la formule de son mode', POOL_MODES.every((m) => m.notes.map((n) => nameToMidi(n) - nameToMidi(m.notes[0])).join() === FORMULES_MODES[m.label].join()));
check('modes : sept modes représentés, aucune double altération', MODES_LABELS.every((l) => POOL_MODES.some((m) => m.label === l)) && !POOL_MODES.some((m) => m.notes.some((n) => /x|bb/.test(n))));
check('modes : les gammes sur touches blanches (sans altération) existent pour chaque mode', MODES_LABELS.every((l) => POOL_MODES.some((m) => m.label === l && m.blanche && !m.notes.some((n) => /[#b]/.test(n.slice(1, -1))))));
check('transposition : chaque motif arrive exactement à l\'intervalle annoncé', POOL_TRANSPOSITIONS.every((t) => t.depart.every((d, i) => nameToMidi(t.arrivee[i]) - nameToMidi(d) === t.semis)));
check('transposition : dix intervalles, ambitus raisonnable (Do4 à La5)', TRANSPOSITIONS_LABELS.length === 10 && POOL_TRANSPOSITIONS.flatMap((t) => [...t.depart, ...t.arrivee]).map(nameToMidi).every((m) => m >= 55 && m <= 84));
check('cadences : quatre types, tirage équilibré (3 entrées chacun)', CADENCES_LABELS.every((l) => POOL_CADENCES.filter((c) => c.label === l).length === 3));
check('cadences : accord V de Do = Sol Si Ré, I = Do Mi Sol', accordDuDegre(0, 4).join() === 'G4,B4,D5' && accordDuDegre(0, 0).join() === 'C5,E5,G5');
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
await autoOk(p);
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
for (const [id, gid, nb, prefixe, motif] of [['modes-grecs', 'mg', 7, 'mode:', /Mode|T ST|ST T|majeur|mineur|gamme/i], ['transposition', 'tg', 10, 'transposition:', /Transposer/], ['cadences', 'cg', 4, 'cadence:', /V|dominante|tonique/]]) {
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-answers .ans-btn`);
  check(`${id} : ${nb} réponses fixes, partition dessinée`, await p.locator(`#${gid}-answers .ans-btn`).count() === nb && await p.locator(`#${gid}-staff svg`).count() === 1);
  let texte = '';
  for (let i = 0; i < 12; i++) { await p.locator(`#${gid}-answers .ans-btn`).nth(i % nb).click(); await p.waitForTimeout(80); const t = await p.locator(`#${gid}-feedback`).textContent(); if (/C'était/.test(t)) texte = t; await p.waitForTimeout(900); }
  const e = (await evts()).filter((x) => x.e.startsWith(prefixe));
  check(`${id} : 12 réponses enregistrées (${prefixe}…)`, e.length === 12, [...new Set(e.map((x) => x.e))].slice(0, 4).join(' '));
  check(`${id} : explication après erreur`, motif.test(texte), texte.slice(0, 160));
  check(`${id} : série de 10, lien et vitesse présents`, await p.locator(`#${gid}-serie`).count() === 1 && await p.locator(`#${gid}-lien`).count() === 1 && await p.locator(`#${gid}-vit`).count() === 1);
}
await p.goto(url + '#/jeux/cadences'); await p.waitForSelector('#cg-choisir');
await p.click('#cg-choisir'); await p.waitForSelector('#cg-dlg[open]'); await p.click('#cg-dlg [data-r="1"]'); await p.click('#cg-dlg button[type=submit]'); await p.waitForTimeout(300);
const dess = new Set(); for (let i = 0; i < 12; i++) { dess.add(await p.evaluate(() => document.querySelector('#cg-staff svg')?.innerHTML.length)); await p.locator('#cg-answers .ans-btn').nth(0).click(); await p.waitForTimeout(650); }
check('cadences : tonalités choisies, armures variées', dess.size >= 3, String(dess.size));
check('liens leçon ↔ jeu', await (async () => { await p.goto(url + '#/cours/cadences'); await p.waitForSelector('.liens-croises'); return (await p.locator('.liens-croises').textContent()).includes('cadences'); })());
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
