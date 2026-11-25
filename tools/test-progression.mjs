// Page « Ma progression », « Reprendre là où tu en étais » et liens leçon ↔ jeu. Usage : node tools/test-progression.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 100000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage();
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const J = 86400000, now = Date.now();
// --- sans données
await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url + '#/progression'); await p.waitForSelector('.prog-bloc');
check('sans données : message d\'accueil et rien d\'inventé', await p.locator('.prog-vide').count() === 1 && (await p.locator('#p-lecons + p').textContent()).includes('0 sur 25'));
await p.goto(url + '#/'); await p.waitForSelector('#view .card'); check('accueil sans activité : pas de zone « Reprendre »', await p.locator('.reprise').count() === 0);
check('menu : lien « Progrès »', await p.locator('#mainnav a[href="#/progression"]').count() === 1);
// --- avec des données connues
await p.evaluate(({ now, J }) => {
  const ev = (jours, j, e, m, ok, r) => ({ t: now - jours * J, j, e, m, ok, r });
  const evts = [
    ...[1, 1, 0, 1, 0].map((o, i) => ev(5 - i * 0.1, 'ig', 'intervalle:M3', 'L', o, 'x')),            // 2 erreurs sur 5 → à retravailler (lecture)
    ...[1, 1, 1, 1, 1, 1].map((o, i) => ev(i < 3 ? 6 : 2, 'oreille-intervalles', 'intervalle:P5', 'O', o)), // maîtrisé à l'oreille, jamais en lecture
    ...[1, 1].map((o) => ev(0.2, 'clef-sol', 'note:treble:G4', 'L', o)),
    ev(0.1, 'dg', 'duree:Ronde', 'L', 0),
  ];
  localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts, lecons: { 'portee-cles': { debut: now - 3 * J, fin: now - 2 * J }, 'notes-de-musique': { debut: now - 1 * J } } }));
}, { now, J });
await p.goto(url + '#/progression'); await p.reload(); await p.waitForSelector('.prog-bloc');
check('leçons : 1 sur 25 terminée, 1 commencée', (await p.locator('#p-lecons + p').textContent()).includes('1 sur 25') && (await p.locator('#p-lecons + p').textContent()).includes('1 commencée'));
const retr = await p.locator('section[aria-labelledby="p-retravailler"] table tbody tr').allTextContents();
check('à retravailler : la tierce majeure (lecture, 3/5) y figure, pas la quinte maîtrisée', retr.some((t) => t.includes('Tierce majeure') && t.includes('Lecture') && t.includes('3/5')) && !retr.some((t) => t.includes('Quinte')), retr.join(' | ').slice(0, 160));
check('éléments : au moins un maîtrisé, un à retravailler', (await p.locator('#p-elements + p').textContent()).includes('Maîtrisé 1'), await p.locator('#p-elements + p').textContent());
const acts = await p.locator('section[aria-labelledby="p-activites"] table tbody tr').allTextContents();
check('réussite par activité : jeu des intervalles 3/5 = 60 %', acts.some((t) => t.includes('intervalles') && t.includes('60 %')), acts.join(' | ').slice(0, 200));
const iv = await p.locator('section[aria-labelledby="p-interv"] table tbody tr').allTextContents();
check('intervalles : quinte maîtrisée à l\'oreille seulement → suggestion de l\'essayer en lecture', iv.some((t) => t.includes('Quinte juste') && t.includes('pas encore travaillé') && t.includes('à essayer : En lecture')), iv.join(' | ').slice(0, 220));
check('activité récente affichée', await p.locator('.prog-recent li').count() >= 2);
check('ton neutre : pas de série de jours ni d\'objectif', !/série|objectif|bravo|félicit/i.test(await p.locator('#view').textContent()));
// --- accueil : reprendre
await p.goto(url + '#/'); await p.waitForSelector('.reprise');
const rep = await p.locator('.reprise a').allTextContents();
check('accueil : reprendre la dernière activité', rep[0].includes('Reprendre') && rep[0].includes('durées et silences'), rep[0]);
check('accueil : prochaine leçon = première non terminée (leçon 2)', rep.some((t) => t.includes('Prochaine leçon') && t.includes('Les notes de musique')), rep.join(' | '));
// --- liens croisés
await p.goto(url + '#/cours/intervalles'); await p.waitForSelector('.liens-croises');
check('fin de leçon : jeux associés (intervalles et oreille)', (await p.locator('.liens-croises a').allTextContents()).join('|').includes('Jeu des intervalles') && (await p.locator('.liens-croises a[href="#/oreille"]').count()) === 1);
await p.goto(url + '#/jeux/accords'); await p.waitForSelector('.liens-croises');
check('dans un jeu : leçons à relire', (await p.locator('.liens-croises a').count()) === 3 && (await p.locator('.liens-croises a[href="#/cours/accords-base"]').count()) === 1, String(await p.locator('.liens-croises a').count()));
await p.goto(url + '#/oreille'); await p.waitForSelector('.liens-croises'); check('jeu d\'oreille : leçon sur les intervalles', await p.locator('.liens-croises a[href="#/cours/intervalles"]').count() === 1);
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 2).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
