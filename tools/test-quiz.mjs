// Quiz de fin de leçon (NAV-05) : données (Node) puis parcours dans le navigateur. Usage : node tools/test-quiz.mjs <url>
import { QUIZ } from '../src/app/data/quiz.js';
import { CATALOGUE } from '../src/app/data/catalogue.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const ids = CATALOGUE.lessons.map((l) => l.id);
check('chaque leçon (25) a un quiz de 3 à 5 questions', ids.every((i) => QUIZ[i] && QUIZ[i].length >= 3 && QUIZ[i].length <= 5) && Object.keys(QUIZ).length === ids.length);
check('chaque question : énoncé, 3 ou 4 réponses toutes différentes, explication', Object.values(QUIZ).flat().every(([q, j, f, e]) => q && j && e && f.length >= 2 && f.length <= 3 && new Set([j, ...f]).size === f.length + 1));
const tout = Object.values(QUIZ).flat(), longue = tout.filter(([, j, f]) => j.length > Math.max(...f.map((x) => x.length)));
check("pas d'indice de longueur : jamais plus de 1,6 fois plus longue que les autres, et la plus longue dans moins de 35 % des cas", tout.every(([, j, f]) => j.length <= Math.max(...f.map((x) => x.length)) * 1.6) && longue.length / tout.length < 0.35, `${longue.length}/${tout.length}`);
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
let manque = [];
for (const id of ids) { await p.goto(url + '#/cours/' + id); await p.waitForSelector('#quiz-debut', { timeout: 8000 }).catch(() => manque.push(id)); }
check('la page de chaque leçon propose le quiz', manque.length === 0, manque.join(' '));
await p.goto(url + '#/cours/portee-cles'); await p.waitForSelector('#quiz-debut');
check('avant de commencer : bouton et nombre de questions', (await p.locator('#quiz').textContent()).includes('4 questions'));
await p.click('#quiz-debut');
check('question 1 / 4 avec quatre réponses', (await p.locator('#quiz-corps').textContent()).includes('Question 1 / 4') && await p.locator('.quiz-option').count() === 4);
// question 1 : réponse fausse (on cherche une option différente de la bonne)
const bonne = (n) => QUIZ['portee-cles'][n][1];
const cliquer = async (n, juste) => { const opts = await p.locator('.quiz-option').allTextContents(); const cible = juste ? opts.findIndex((o) => o === bonne(n)) : opts.findIndex((o) => o !== bonne(n)); await p.locator('.quiz-option').nth(cible).click(); };
await cliquer(0, false);
check('réponse fausse : bonne réponse et explication affichées, réponses bloquées', (await p.locator('#quiz-retour').textContent()).includes('La bonne réponse') && (await p.locator('#quiz-retour').textContent()).includes(QUIZ['portee-cles'][0][3]) && await p.locator('.quiz-option:not([disabled])').count() === 0);
check('le bouton « Question suivante » a le focus', await p.evaluate(() => document.activeElement?.textContent === 'Question suivante'));
await p.keyboard.press('Enter'); await p.waitForTimeout(150);
for (let n = 1; n < 4; n++) { check(`question ${n + 1} affichée`, (await p.locator('#quiz-corps').textContent()).includes(`Question ${n + 1} / 4`)); await cliquer(n, true); check(`question ${n + 1} juste : « Exact »`, (await p.locator('#quiz-retour').textContent()).includes('Exact')); await p.click('#quiz-retour button'); await p.waitForTimeout(100); }
check('bilan : 3 / 4 et la question ratée à revoir', (await p.locator('#quiz-score').textContent()) === 'Résultat : 3 / 4' && (await p.locator('#quiz-corps').textContent()).includes(QUIZ['portee-cles'][0][0]));
const ev = (await evts()).filter((x) => x.e.startsWith('quiz:portee-cles:'));
check('suivi : 4 réponses enregistrées (1 fausse, 3 justes)', ev.length === 4 && ev.filter((x) => x.ok).length === 3 && ev[0].e === 'quiz:portee-cles:1', ev.map((x) => `${x.e}=${x.ok}`).join(' '));
await p.click('#quiz-refaire'); check('refaire : retour à la question 1', (await p.locator('#quiz-corps').textContent()).includes('Question 1 / 4'));
await p.goto(url + '#/progression'); await p.waitForTimeout(500);
const t = await p.locator('#view').textContent();
check('page Progrès : activité « Quiz : La portée et les clés »', t.includes('Quiz : La portée et les clés'));
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
