// « Chante la note » (CON-05) : calculs (Node), puis le jeu avec un faux micro qui joue un fichier son. Usage : node tools/test-chant.mjs <url> <c4.wav> <a4.wav> <c5.wav>
import { ecartClasse, freqToNote } from '../src/app/micro.js';
import { nomMidi, NIVEAUX_CHANT } from '../src/app/chant.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const arrondi = (x) => Math.round(x * 100) / 100;
check('écart : 440 Hz contre La (69) = 0 ; contre Sol♯ (68) = +1', arrondi(ecartClasse(440, 69)) === 0 && arrondi(ecartClasse(440, 68)) === 1);
check('écart : sans tenir compte de l\'octave (La3 220 Hz, La5 880 Hz contre La4)', arrondi(ecartClasse(220, 69)) === 0 && arrondi(ecartClasse(880, 69)) === 0);
check('écart : un quart de ton trop bas = −0,25 ; une quinte plus loin reste hors tolérance', arrondi(ecartClasse(440 * 2 ** (-0.25 / 12), 69)) === -0.25 && Math.abs(ecartClasse(440, 62)) > 0.35);
check('noms de notes : 60 → C4, 61 → C#4, 71 → B4', nomMidi(60) === 'C4' && nomMidi(61) === 'C#4' && nomMidi(71) === 'B4');
check('trois niveaux de 3, 7 et 12 notes', [1, 2, 3].map((n) => NIVEAUX_CHANT[n].midis.length).join() === '3,7,12');
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/', [wavC4, wavA4, wavC5] = process.argv.slice(3);
const lancer = (wav) => chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
const evts = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
// --- 1) le micro joue un Do4 et la note demandée est Do4 : réussite
let b = await lancer(wavC4); let p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
await p.goto(url); await p.evaluate(() => localStorage.clear());
await p.goto(url + '#/jeux/chant-note?note=C4'); await p.waitForSelector('#chg-staff svg');
check('page : portée, trois niveaux, micro à activer', await p.locator('#chg-niveau .chip').count() === 3 && await p.locator('#chg-micro').isVisible() && (await p.locator('#chg-etat').textContent()).includes('Active le micro'));
await p.click('#chg-micro');
await p.waitForFunction(() => /Bravo/.test(document.getElementById('chg-feedback')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
const fb = await p.locator('#chg-feedback').textContent();
check('Do joué, Do demandé : « Bravo, c’est bien Do »', /Bravo : c’est bien Do/.test(fb), fb);
check('score 1 / 1', (await p.locator('#chg-score').textContent()) === '1' && (await p.locator('#chg-total').textContent()) === '1');
const e1 = (await evts(p)).filter((x) => x.j === 'chant-note');
check('suivi : une réponse juste « chant:C » en lecture', e1.length >= 1 && e1[0].e === 'chant:C' && e1[0].ok === 1 && e1[0].m === 'L', JSON.stringify(e1[0]));
await b.close();
// --- 2) octave différente (Do5) pour un Do4 demandé : accepté (peu importe l'octave)
b = await lancer(wavC5); p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); p.on('pageerror', (e) => erreurs.push(e.message));
await p.goto(url + '#/jeux/chant-note?note=C4'); await p.waitForSelector('#chg-staff svg'); await p.click('#chg-micro');
await p.waitForFunction(() => /Bravo/.test(document.getElementById('chg-feedback')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
check('Do5 joué pour un Do4 demandé : accepté (octave indifférente)', /Bravo/.test(await p.locator('#chg-feedback').textContent()));
await b.close();
// --- 3) un La est joué alors qu'on demande Do : pas de réussite, message d'écart, puis « Je n'y arrive pas »
b = await lancer(wavA4); p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); p.on('pageerror', (e) => erreurs.push(e.message));
await p.goto(url); await p.evaluate(() => localStorage.clear());
await p.goto(url + '#/jeux/chant-note?note=C4'); await p.waitForSelector('#chg-staff svg'); await p.click('#chg-micro');
await p.waitForFunction(() => /entends/.test(document.getElementById('chg-etat')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
const etat = await p.locator('#chg-etat').textContent();
check('La joué pour un Do demandé : « Je t’entends : La4 », « pas la note demandée », pas de réussite', /La4/.test(etat) && /pas la note demandée/.test(etat) && !/Bravo/.test(await p.locator('#chg-feedback').textContent()), etat);
await p.waitForTimeout(1500);
check('toujours pas validé après 1,5 s', !/Bravo/.test(await p.locator('#chg-feedback').textContent()) && (await p.locator('#chg-score').textContent()) === '0');
await p.click('#chg-passer'); await p.waitForTimeout(200);
check('« Je n’y arrive pas » : la bonne note est donnée et le bouton OK apparaît', /C’était Do/.test(await p.locator('#chg-feedback').textContent()) && await p.locator('#chg-ok').count() === 1);
const e3 = (await evts(p)).filter((x) => x.j === 'chant-note');
check('suivi : une réponse fausse enregistrée', e3.length === 1 && e3[0].ok === 0 && e3[0].e === 'chant:C');
await p.click('#chg-ok'); await p.waitForTimeout(200);
check('OK : nouvelle note, correction effacée', await p.locator('#chg-ok').count() === 0 && !/C’était/.test(await p.locator('#chg-feedback').textContent()));
// --- coupure du micro quand la page est masquée
await p.evaluate(() => window.dispatchEvent(new Event('solfege-pause'))); await p.waitForTimeout(200);
check('page masquée : micro coupé, bouton « Réactiver »', await p.locator('#chg-micro').isVisible() && (await p.locator('#chg-micro').textContent()).includes('Réactiver') && (await p.locator('#chg-etat').textContent()).includes('coupé'));
// --- page Progrès
await p.goto(url + '#/progression'); await p.waitForTimeout(600);
check('page Progrès : « Chante la note » figure dans les activités', (await p.locator('#view').textContent()).includes('Chante la note'));
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
