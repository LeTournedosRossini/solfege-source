// Jeu « Rythme à vue » (motif écrit, frappe sans écoute préalable) et interruption des jeux de rythme quand on quitte la page.
// Usage : node tools/test-rythme-vue.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 170000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 700, height: 900 } })).newPage();
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load/.test(m.text())) erreurs.push(m.text()); });
await p.addInitScript(() => { window.__osc = 0; window.__ctx = []; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; const C = window.AudioContext; window.AudioContext = class extends C { constructor(...a) { super(...a); window.__ctx.push(this); } }; });
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };

// --- le jeu à l'oreille s'arrête quand on quitte la page
await p.goto(url + '#/jeux/rythme'); await p.waitForSelector('#rg-tap'); await p.click('#rg-tap'); await p.waitForTimeout(600);
check('à l\'oreille : écoute en cours', (await p.locator('#rg-tap').textContent()) === 'Écoute…');
await p.goto(url + '#/outils'); await p.waitForTimeout(300);
const etats = await p.evaluate(() => window.__ctx.map((c) => c.state));
check('à l\'oreille : quitter la page ferme l\'horloge audio (plus aucun son programmé)', etats.length >= 1 && etats.every((s) => s === 'closed'), JSON.stringify(etats));

// --- le métronome s'arrête aussi
await p.goto(url + '#/outils/metronome'); await p.waitForSelector('#play-btn'); await p.click('#play-btn'); await p.waitForTimeout(1200);
await p.goto(url + '#/jeux'); await p.waitForTimeout(400); const o1 = await p.evaluate(() => window.__osc); await p.waitForTimeout(1500);
check('métronome : plus de clic après avoir quitté la page', (await p.evaluate(() => window.__osc)) === o1);

// --- rythme à vue
await p.goto(url + '#/jeux'); check('liste : les deux jeux de rythme', await p.locator('a.card', { hasText: 'Rythme à l\'oreille' }).count() === 1 && await p.locator('a.card', { hasText: 'Rythme à vue' }).count() === 1);
await p.goto(url + '#/jeux/rythme-vue'); await p.waitForSelector('#rv-tap'); await p.waitForSelector('#rv-score-host svg');
check('à vue : 4 niveaux', await p.locator('#rv-levels .ans-btn').count() === 4);
const heads = () => p.locator('#rv-score-host [data-glyph^="notehead"]').count();
const nbNotes = async () => await p.locator('#rv-hits .hit').count();
check('à vue : la partition est affichée, une frappe attendue par note', (await heads()) === await nbNotes(), `${await heads()} têtes, ${await nbNotes()} frappes`);
const o0 = await p.evaluate(() => window.__osc);
check('à vue : aucun bouton pour écouter avant la frappe', await p.locator('#rv-listen').isHidden());
const sons0 = await p.evaluate(() => window.__osc);
// niveaux : nombre de notes attendues
for (const [lv, mn, mx] of [[1, 3, 4], [2, 3, 8], [3, 3, 10], [4, 5, 20]]) {
  await p.click(`#rv-levels .ans-btn[data-l="${lv}"]`); await p.waitForSelector('#rv-score-host svg');
  const n = await nbNotes(); check(`à vue : niveau ${lv} : ${n} frappes attendues (${mn} à ${mx})`, n >= mn && n <= mx && (await heads()) === n);
}
await p.click('#rv-levels .ans-btn[data-l="1"]'); await p.waitForSelector('#rv-score-host svg');
// frappes régulières lentes sur un motif de noires/blanches : on tape selon les durées écrites
const attendu = await p.evaluate(() => window.__rvdebug?.());
const n = await nbNotes();
// on ne connaît pas les durées : on lit la partition (blanche = tête creuse). On utilise les têtes : une blanche a un glyphe « notehead Half ».
const durees = await p.evaluate(() => [...document.querySelectorAll('#rv-score-host [data-glyph^="notehead"]')].map((h) => (/Half|Whole/.test(h.getAttribute('data-glyph')) ? 2 : 1)));
for (let i = 0; i < n; i++) { await p.click('#rv-tap'); if (i < n - 1) await p.waitForTimeout(450 * durees[i]); }
await p.waitForTimeout(500);
const pct = Number((await p.locator('#rv-score').textContent()).replace('%', ''));
check('à vue : frappes conformes aux durées écrites → bon score', pct >= 85, pct + ' % ; durées ' + durees.join(','));
check('à vue : « écouter le motif » proposé après la manche', await p.locator('#rv-listen').isVisible());
check('à vue : aucun son pendant tout ce temps', (await p.evaluate(() => window.__osc)) === sons0);
check('à vue : niveau suivant proposé', (await p.locator('#rv-level').textContent()) === '2');
await p.click('#rv-listen'); await p.waitForFunction(() => /Stop/.test(document.getElementById('rv-listen').textContent), null, { timeout: 12000 }).catch(() => {});
check('à vue : le motif se joue après la manche', (await p.locator('#rv-listen').textContent()).includes('Stop'));
await p.click('#rv-tap'); await p.waitForSelector('#rv-score-host svg');
check('à vue : « Nouveau motif »', await p.locator('#rv-listen').isHidden() && (await p.locator('#rv-feedback').textContent()).trim() === '');
// rythme faux : tout tapé à intervalles égaux sur un motif qui ne l'est pas → score plus bas qu'un motif juste (au niveau 3, motifs pointés)
await p.click('#rv-levels .ans-btn[data-l="3"]'); await p.waitForSelector('#rv-score-host svg');
let mauvais = 0;
for (let essai = 0; essai < 14 && mauvais === 0; essai++) {
  const nn = await nbNotes(); for (let i = 0; i < nn; i++) { await p.click('#rv-tap'); await p.waitForTimeout(400); } await p.waitForTimeout(500);
  const sc = Number((await p.locator('#rv-score').textContent()).replace('%', '')); if (sc < 85) mauvais = sc; await p.click('#rv-tap'); await p.waitForSelector('#rv-score-host svg');
}
check('à vue : frappes toutes égales sur un rythme inégal → score bas (sur au plus quatorze motifs)', mauvais > 0, String(mauvais));
await p.click('#rv-tap'); await p.click('#rv-tap'); // deux frappes puis rien : la manche se conclut seule
await p.waitForSelector('#rv-listen:not([hidden])', { timeout: 15000 }).catch(() => {});
check('à vue : manche incomplète conclue après un temps sans frappe', await p.locator('#rv-listen').isVisible() && /manquait/.test(await p.locator('#rv-feedback').textContent()), await p.locator('#rv-feedback').textContent());

// --- onglet du navigateur masqué : tout s'arrête
const masquer = () => p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
const montrer = () => p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await p.goto(url + '#/jeux/rythme'); await p.waitForSelector('#rg-tap'); await p.click('#rg-tap'); await p.waitForTimeout(500);
await masquer(); await p.waitForTimeout(200); await montrer();
check('onglet masqué : le jeu à l\'oreille abandonne la manche et se remet à zéro', (await p.locator('#rg-tap').textContent()) === 'Écouter le motif' && await p.locator('#rg-tap').isEnabled());
await p.goto(url + '#/jeux/rythme-vue'); await p.waitForSelector('#rv-score-host svg'); await p.click('#rv-tap'); await p.click('#rv-tap');
await masquer(); await montrer();
check('onglet masqué : le jeu à vue abandonne les frappes (nouveau motif)', (await p.locator('#rv-hits .hit.mid').count()) === 0 && (await p.locator('#rv-feedback').textContent()).trim() === '');
await p.goto(url + '#/outils/metronome'); await p.waitForSelector('#play-btn'); await p.click('#play-btn'); await p.waitForTimeout(700);
await masquer(); await p.waitForTimeout(300); const om = await p.evaluate(() => window.__osc); await p.waitForTimeout(1000); await montrer();
check('onglet masqué : le métronome s\'arrête', (await p.locator('#play-btn').textContent()).includes('Démarrer') && (await p.evaluate(() => window.__osc)) === om, (await p.locator('#play-btn').textContent()) + ' ' + om + ' → ' + (await p.evaluate(() => window.__osc)));
await p.goto(url + '#/cours/gammes-mineures'); await p.waitForSelector('#view .abc-play-btn'); await p.locator('#view .abc-play-btn').first().click();
await p.waitForFunction(() => /Stop/.test(document.querySelector('#view .abc-play-btn').textContent), null, { timeout: 12000 }).catch(() => {});
const avant = await p.locator('#view .abc-play-btn').first().textContent();
await masquer(); await p.waitForTimeout(400); await montrer();
check('onglet masqué : la lecture d\'une partition s\'arrête', avant.includes('Stop') && (await p.locator('#view .abc-play-btn').first().textContent()).includes('Écouter'), avant + ' → ' + (await p.locator('#view .abc-play-btn').first().textContent()));

// quitter la page pendant la lecture arrête le son
await p.goto(url + '#/outils'); await p.waitForTimeout(300);
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 2).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
