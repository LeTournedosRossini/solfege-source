// Page « Mes données » : information, protection du stockage, téléchargement et rechargement de la progression, effacement en deux temps. Usage : node tools/test-donnees-app.mjs <url>
import { chromium } from 'playwright-core';
import { autoOk } from './aide-tests.mjs';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 100000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 }, acceptDownloads: true })).newPage();
await autoOk(p);
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const suivi = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[],"lecons":{}}'));
const J = 86400000;
await p.goto(url); await p.evaluate((J) => { localStorage.clear(); const n = Date.now(); const ev = (d, j, e, m, ok) => ({ t: n - d * J, j, e, m, ok });
  localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: [ev(2, 'ig', 'intervalle:M3', 'L', 1), ev(1, 'oreille-gammes', 'gamme:maj', 'O', 0), ev(0.5, 'dg', 'duree:Ronde', 'L', 1)], lecons: { 'portee-cles': { debut: n - 3 * J, fin: n - 2 * J } } }));
  localStorage.setItem('solfege_progress', JSON.stringify({ games: { ig: { best: 5, played: 3, last: 4, lastTotal: 5 } } })); localStorage.setItem('solfege_theme', 'dark'); localStorage.setItem('solfege_oreille_import', '[{"title":"Ma phrase"}]'); }, J);
await p.goto(url + '#/progression'); await p.waitForSelector('.prog-bloc');
check('page Progrès : lien vers « Mes données »', await p.locator('a[href="#/donnees"]').count() === 1);
await p.click('a[href="#/donnees"]'); await p.waitForSelector('#d-export');
const info = await p.locator('#d-info + ul').textContent(); check('information claire : ce qui est enregistré, où, et ce qui ne l\'est pas', info.includes('Chaque réponse') && (await p.locator('#d-info ~ p').first().textContent()).includes('Rien d’autre') && (await p.locator('#d-compte').textContent()).includes('3 réponses'));
check('stockage : état indiqué', (await p.locator('#d-stockage').textContent()).length > 20, await p.locator('#d-stockage').textContent());
// export
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#d-export')]);
const texte = fs.readFileSync(await dl.path(), 'utf8'); const json = JSON.parse(texte);
check('export : fichier daté, 3 réponses, 1 leçon, scores', /^solfege-progression-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()) && json.suivi.evts.length === 3 && json.scores.games.ig.best === 5 && Object.keys(json.suivi.lecons).length === 1, dl.suggestedFilename());
check('export : sans le thème ni les phrases personnelles', !texte.includes('"dark"') && !texte.includes('Ma phrase'));
// effacement en deux temps
await p.click('#d-effacer'); check('effacer : confirmation demandée, rien n\'est encore effacé', await p.locator('#d-confirme').isVisible() && (await suivi()).evts.length === 3);
await p.click('#d-non'); check('annuler : rien n\'est effacé', await p.locator('#d-confirme').isHidden() && (await suivi()).evts.length === 3);
await p.click('#d-effacer'); await p.click('#d-oui');
check('confirmer : progression effacée, thème et phrases conservés', (await suivi()).evts.length === 0 && (await p.evaluate(() => localStorage.getItem('solfege_progress'))) === null && (await p.evaluate(() => localStorage.getItem('solfege_theme'))) === 'dark' && (await p.evaluate(() => localStorage.getItem('solfege_oreille_import'))).includes('Ma phrase') && (await p.locator('#d-message').textContent()) === 'Progression effacée.');
// mauvais fichier
await p.setInputFiles('#d-fichier', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"autre"}') }); await p.waitForTimeout(200);
check('mauvais fichier : message clair, rien changé', (await p.locator('#d-message').textContent()).includes('pas une sauvegarde') && (await suivi()).evts.length === 0);
// import : annuler, ajouter, remplacer
await p.setInputFiles('#d-fichier', { name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(texte) }); await p.waitForSelector('#d-choix button');
check('import : résumé du fichier avant de choisir', (await p.locator('#d-choix p').first().textContent()).includes('3 réponses') && (await p.locator('#d-choix p').first().textContent()).includes('1 leçon'));
await p.click('#d-choix [data-mode="annuler"]'); check('import annulé : rien n\'est repris', (await suivi()).evts.length === 0);
await p.setInputFiles('#d-fichier', { name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(texte) }); await p.waitForSelector('#d-choix button'); await p.click('#d-choix [data-mode="fusion"]');
check('import « ajouter » : progression retrouvée', (await suivi()).evts.length === 3 && (await p.locator('#d-compte').textContent()).includes('3 réponses') && (await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_progress')).games.ig.best)) === 5);
await p.setInputFiles('#d-fichier', { name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(texte) }); await p.waitForSelector('#d-choix button'); await p.click('#d-choix [data-mode="fusion"]');
check('import répété : aucun doublon', (await suivi()).evts.length === 3);
await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('solfege_suivi')); d.evts.push({ t: Date.now(), j: 'ag', e: 'accord:Majeur', m: 'L', ok: 1 }); localStorage.setItem('solfege_suivi', JSON.stringify(d)); });
await p.setInputFiles('#d-fichier', { name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(texte) }); await p.waitForSelector('#d-choix button'); await p.click('#d-choix [data-mode="remplace"]');
check('import « remplacer » : la progression devient celle du fichier', (await suivi()).evts.length === 3 && !(await suivi()).evts.some((e) => e.j === 'ag'));
// la progression restaurée est bien affichée
await p.goto(url + '#/progression'); await p.waitForSelector('.prog-bloc'); check('Progrès affiche la progression restaurée', (await p.locator('#p-lecons + p').textContent()).includes('1 sur 25'));
// données d'une version précédente (DON-04) : ancien format des scores seul
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('solfege_progress', JSON.stringify({ games: { 'clef-sol': { best: 7, played: 4, last: 6, lastTotal: 7 } } })); });
await p.goto(url + '#/jeux/clef-sol'); await p.waitForSelector('#ng-answers .ans-btn'); await p.locator('#ng-answers .ans-btn').first().click(); await p.waitForTimeout(100);
check('données de l\'ancienne version conservées : le score existant est repris et complété', (await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_progress')).games['clef-sol'])).played === 5 && (await suivi()).evts.length === 1);
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 2).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
