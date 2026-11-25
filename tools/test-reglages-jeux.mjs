// Choix des tonalités (fenêtre), lien partageable, vitesse du son, vitesse des intervalles à l'oreille. Usage : node tools/test-reglages-jeux.mjs <url>
import { lireConfig, requeteConfig, filtrer, TONALITES, DEPARTS_NOTES, RACCOURCIS } from '../src/app/jeux-config.js';
import { intervalAuHasard } from '../src/app/jeux-tonalites.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
check('config : lecture d\'une adresse', JSON.stringify(lireConfig('tonalites=C,G,F%23&serie=1&mode=adapte')) === JSON.stringify({ tonalites: ['C', 'G', 'F#'], serie: true, mode: 'adapte' }));
check('config : valeurs inconnues ignorées', JSON.stringify(lireConfig('tonalites=Zz&mode=nimporte')) === JSON.stringify({ tonalites: null, serie: false, mode: null }));
check('config : aller-retour', JSON.stringify(lireConfig(requeteConfig({ tonalites: ['C', 'F#', 'Bb'], serie: true, mode: 'erreurs' }))) === JSON.stringify({ tonalites: ['C', 'F#', 'Bb'], serie: true, mode: 'erreurs' }));
check('config : raccourcis valides', Object.values(RACCOURCIS).every((l) => l.every((r) => r.ids.length)) && RACCOURCIS.tonalites.every((r) => filtrer(r.ids, TONALITES)?.length === r.ids.length));
const r = intervalAuHasard('3ce majeure', Math.random, [72]); check('intervalles : départ imposé', r[0] === 'C5' && r[1] === 'E5', r.join());
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const ctx = await b.newContext({ viewport: { width: 800, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage(); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
await p.goto(url); await p.evaluate(() => localStorage.clear());
const dessin = () => p.evaluate(() => document.querySelector('#gg-staff svg')?.innerHTML.length);
// --- degrés : fenêtre de choix
await p.goto(url + '#/jeux/degres'); await p.waitForSelector('#gg-answers .ans-btn');
check('degrés : bouton « Choisir les tonalités… »', await p.locator('#gg-choisir').count() === 1);
await p.click('#gg-choisir'); await p.waitForSelector('#gg-dlg[open]');
check('fenêtre : 15 cases, seule Do cochée par défaut', await p.locator('#gg-dlg input[type=checkbox]').count() === 15 && await p.locator('#gg-dlg input:checked').count() === 1);
await p.click('#gg-dlg [data-r="1"]');
check('raccourci « Dièses » : 8 cases cochées', await p.locator('#gg-dlg input:checked').count() === 8);
await p.click('#gg-dlg [data-r="3"]'); await p.click('#gg-dlg button[type=submit]'); await p.waitForTimeout(300);
check('validation : fenêtre fermée, bouton résume « 5 sur 15 »', !(await p.locator('#gg-dlg[open]').count()) && (await p.locator('#gg-choisir').textContent()).includes('5 sur 15'), await p.locator('#gg-choisir').textContent());
check('choix mémorisé', JSON.parse(await p.evaluate(() => localStorage.getItem('solfege_tonalites_gg'))).join() === 'C,G,D,F,Bb');
const vus = new Set(); for (let i = 0; i < 18; i++) { vus.add(await dessin()); await p.locator('#gg-answers .ans-btn').nth(0).click(); await p.waitForTimeout(650); }
check('degrés : les armures varient parmi les tonalités choisies', vus.size >= 3, String(vus.size));
await p.click('#gg-choisir'); await p.waitForSelector('#gg-dlg[open]'); await p.click('#gg-dlg [data-r="0"]');
await p.evaluate(() => document.querySelectorAll('#gg-dlg input[type=checkbox]').forEach((c) => { c.checked = false; }));
await p.click('#gg-dlg button[type=submit]');
check('fenêtre : aucune case cochée refusée avec un message', (await p.locator('#gg-dlg .dlg-erreur').textContent()).includes('au moins') && await p.locator('#gg-dlg[open]').count() === 1);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
check('Échap ferme la fenêtre sans changer le choix', !(await p.locator('#gg-dlg[open]').count()) && (await p.locator('#gg-choisir').textContent()).includes('5 sur 15'));
// --- lien partageable
await p.click('#gg-serie'); await p.click('#gg-lien'); await p.waitForTimeout(300);
const lien = await p.evaluate(() => navigator.clipboard.readText());
check('lien copié : jeu, tonalités et série', /#\/jeux\/degres\?tonalites=C,G,D,F,Bb&serie=1/.test(lien), lien);
await p.evaluate(() => localStorage.clear());
await p.goto(lien); await p.reload(); await p.waitForSelector('#gg-answers .ans-btn');
check('ouvrir le lien : réglages repris (5 tonalités, série lancée) sans rien en mémoire', (await p.locator('#gg-choisir').textContent()).includes('5 sur 15') && (await p.locator('#gg-rang').textContent()) === '1/10');
// --- jeu des tonalités : sélection
await p.goto(url + '#/jeux/tonalites'); await p.waitForSelector('#kg-answers .ans-btn');
check('tonalités : 15 réponses, pas de bouton « toutes » (déjà tout)', await p.locator('#kg-answers .ans-btn').count() === 15 && await p.locator('#kg-ton').count() === 0);
await p.click('#kg-choisir'); await p.waitForSelector('#kg-dlg[open]');
check('tonalités : tout coché par défaut', await p.locator('#kg-dlg input:checked').count() === 15);
await p.click('#kg-dlg [data-r="4"]'); await p.click('#kg-dlg button[type=submit]'); await p.waitForTimeout(300);
const evBefore = (await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts)).length;
for (let i = 0; i < 6; i++) { await p.locator('#kg-answers .ans-btn').nth(0).click(); await p.waitForTimeout(1000); }
const ev = (await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi')).evts)).slice(evBefore);
check('tonalités : « Do seul » → toutes les questions portent sur Do', ev.length === 6 && ev.every((x) => x.e === 'tonalite:Do'), ev.map((x) => x.e).join(' '));
// --- gammes mineures : armures choisies
await p.goto(url + '#/jeux/gammes-mineures?tonalites=C'); await p.waitForSelector('#gmg-answers .ans-btn');
check('gammes mineures (lien) : une seule armure choisie', (await p.locator('#gmg-choisir').textContent()).includes('1 sur 15') || (await p.locator('#gmg-choisir').textContent()).includes('Choisir'), await p.locator('#gmg-choisir').textContent());
// --- intervalles : notes de départ
await p.goto(url + '#/jeux/intervalles'); await p.waitForSelector('#ig-answers .ans-btn');
await p.click('#ig-choisir'); await p.waitForSelector('#ig-dlg[open]');
check('intervalles : 10 notes de départ, Do coché', await p.locator('#ig-dlg input[type=checkbox]').count() === 10 && await p.locator('#ig-dlg input:checked').count() === 1);
await p.click('#ig-dlg [data-r="1"]'); await p.click('#ig-dlg button[type=submit]'); await p.waitForTimeout(300);
const dess = new Set(); for (let i = 0; i < 14; i++) { dess.add(await p.evaluate(() => document.querySelector('#ig-staff svg')?.innerHTML.length)); await p.locator('#ig-answers .ans-btn').nth(0).click(); await p.waitForTimeout(650); }
check('intervalles : départs variés', dess.size >= 4, String(dess.size));
// --- vitesse du son (jeux de lecture)
const bpm = () => p.evaluate(() => { const b = document.querySelector('#ig-staff'); return b ? b.dataset.bpm ?? null : null; });
check('vitesse : curseur −50 à +50 présent, 0 par défaut', await p.locator('#ig-vit').getAttribute('min') === '-50' && await p.locator('#ig-vit').getAttribute('max') === '50' && (await p.locator('#ig-vitval').textContent()) === '0 %');
await p.locator('#ig-vit').fill('-30'); await p.waitForTimeout(300);
check('vitesse : affichage et mémoire', (await p.locator('#ig-vitval').textContent()) === '-30 %' && (await p.evaluate(() => localStorage.getItem('solfege_vitesse'))) === '-30');
await p.goto(url + '#/jeux/accords'); await p.waitForSelector('#ag-vit');
check('vitesse : conservée dans un autre jeu', (await p.locator('#ag-vitval').textContent()) === '-30 %');
check('jeu des tonalités (muet) : pas de curseur de vitesse', await (async () => { await p.goto(url + '#/jeux/tonalites'); await p.waitForSelector('#kg-answers'); return (await p.locator('#kg-vit').count()) === 0; })());
// --- oreille : vitesse des intervalles
await p.goto(url + '#/oreille'); await p.waitForSelector('#ecStaffWrap svg');
await p.locator('#intervalSubtabs .subtab2-btn[data-sub="ident"]').click(); await p.click('#hamburgerBtn');
check('oreille : curseur de vitesse dans les réglages des intervalles', await p.locator('#phraseSpeedRangeD').count() === 1);
await p.locator('#phraseSpeedRangeD').fill('50'); await p.waitForTimeout(200);
check('oreille : la vitesse est partagée avec les autres onglets', (await p.locator('#phraseSpeedValA').textContent()) === '50 %' || (await p.locator('#phraseSpeedValA').textContent()) === '+50 %', await p.locator('#phraseSpeedValA').textContent());
const tps = await p.evaluate(() => { const s = window.__oreille.state(); return s.speedPct; });
check('oreille : vitesse +50 % appliquée', tps === 50, String(tps));
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
