// Les jeux : affichage, boutons de réponse, retour, score, nouvelle question (un seul bouton ▶), son, rythme. Usage : node tools/test-jeux.mjs <url> [dossier de captures]
import { chromium } from 'playwright-core';
import { autoOk } from './aide-tests.mjs';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 170000);
const url = process.argv[2] || 'http://localhost:8123/'; const cap = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 760, height: 900 } });
await autoOk(p);
const externes = [], erreurs = [];
p.on('request', (r) => { if (!r.url().startsWith(new URL(url).origin) && !r.url().startsWith('data:') && !/\.sf3/.test(r.url())) externes.push(r.url()); });
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) erreurs.push(m.text()); });
p.on('pageerror', (e) => erreurs.push('pageerror ' + e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const QUIZ = { 'clef-sol': 'ng', 'clef-fa': 'ng', tonalites: 'kg', intervalles: 'ig', accords: 'ag', 'durees-silences': 'dg', degres: 'gg' };
for (const [id, gid] of Object.entries(QUIZ)) {
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-staff svg`, { timeout: 15000 });
  const ordre0 = await p.locator('.ans-btn').allTextContents(); const n0 = ordre0.length;
  check(`${id} : partition + boutons de réponse`, n0 >= 5, `${n0} boutons`);
  const ATTENDU = { 'clef-sol': 7, 'clef-fa': 7, tonalites: 15, intervalles: 12, accords: 5, 'durees-silences': 10, degres: 7 }; check(`${id} : ${ATTENDU[id]} boutons`, n0 === ATTENDU[id], String(n0));
  if (cap) { fs.mkdirSync(cap, { recursive: true }); await p.screenshot({ path: `${cap}/${id}.png` }); }
  let bonnes = 0;
  for (let r = 0; r < 4; r++) {
    const btns = p.locator('.ans-btn'); await btns.nth(r % (await btns.count())).click();
    const fb = (await p.locator(`#${gid}-feedback`).textContent()).trim(); const corr = await p.locator('.ans-btn.correct').count();
    if (/^Exact/.test(fb)) bonnes++;
    check(`${id} : manche ${r + 1}, retour affiché`, corr === 1 && /^(Exact|C'était)/.test(fb), fb);
    await p.waitForTimeout(1000); await p.waitForSelector(`#${gid}-staff svg`);
    const ordre = await p.locator('.ans-btn').allTextContents(); if (ordre.join('|') !== ordre0.join('|')) check(`${id} : ordre des boutons stable`, false, ordre.join(','));
    const boutonsPlay = await p.locator('.abc-play-btn').count();
    if (boutonsPlay !== (id === 'tonalites' ? 0 : 1)) check(`${id} : un seul bouton ▶`, false, String(boutonsPlay));
  }
  const total = await p.locator(`#${gid}-total`).textContent(), score = await p.locator(`#${gid}-score`).textContent();
  check(`${id} : essais et score`, total === '4' && Number(score) === bonnes, `${score}/${total}`);
}
// son : un jeu
await p.goto(url + '#/jeux/accords'); await p.waitForSelector('#ag-staff svg'); await p.locator('.abc-play-btn').click();
await p.waitForFunction(() => [...document.querySelectorAll('.abc-play-btn')].some((x) => x.textContent.includes('Stop')), null, { timeout: 40000 });
check('accords : le son démarre', true);
await p.waitForFunction(() => ![...document.querySelectorAll('.abc-play-btn')].some((x) => x.textContent.includes('Stop')), null, { timeout: 30000 });
check('accords : fin de lecture, bouton ▶ de retour', (await p.locator('.abc-play-btn').textContent()).includes('Écouter'));
// rythme : paliers, écoute puis frappe silencieuse
await p.goto(url + '#/jeux/rythme'); await p.waitForSelector('#rg-tap');
check('rythme : 4 niveaux proposés', (await p.locator('#rg-levels .ans-btn').count()) === 4);
const LIM = { 1: [4, 4, 4], 2: [4, 5, 6], 3: [6, 7, 9], 4: [8, 10, 12] };
for (const [lv, [temps, mn, mx]] of Object.entries(LIM)) {
  await p.locator(`#rg-levels .ans-btn[data-l="${lv}"]`).click();
  const notes = await p.locator('.beat-note').count(), frappes = await p.locator('#rg-hits .hit').count();
  check(`rythme : niveau ${lv} : ${temps} temps, ${mn} à ${mx} notes`, notes === temps && frappes >= mn && frappes <= mx, `${notes} temps, ${frappes} notes`);
}
await p.locator('#rg-levels .ans-btn[data-l="1"]').click();
if (cap) await p.screenshot({ path: `${cap}/rythme.png` });
await p.evaluate(() => { window.__osc = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; });
const pad = async () => (await p.locator('#rg-tap').textContent()).trim();
const box = await p.locator('#rg-tap').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const frappes = async (delais) => { await p.mouse.move(cx, cy); for (const d of delais) { await p.mouse.down(); await p.mouse.up(); if (d) await p.waitForTimeout(d); } };
const lancer = async () => { await p.click('#rg-tap'); await p.waitForFunction(() => document.getElementById('rg-tap').textContent.includes('À toi'), null, { timeout: 20000 }); };
// 1) motif de 4 noires, retapé régulièrement mais plus lentement (800 ms au lieu de 682) et sans repère : bon score
await p.click('#rg-tap'); check('rythme : écoute', (await pad()) === 'Écoute…');
await p.waitForFunction(() => document.getElementById('rg-tap').textContent.includes('À toi'), null, { timeout: 20000 });
const oscEcoute = await p.evaluate(() => window.__osc); check('rythme : 8 sons pendant l\'écoute (4 de décompte + 4 notes)', oscEcoute === 8, String(oscEcoute));
check('rythme : pas de décompte silencieux ni de pulsation', (await p.locator('#rg-count').count()) === 0);
await p.waitForTimeout(700); await frappes([800, 800, 800, 0]);
await p.waitForFunction(() => document.getElementById('rg-tap').textContent.includes('Nouveau'), null, { timeout: 15000 });
const oscFin = await p.evaluate(() => window.__osc); check('rythme : aucun son pendant la frappe', oscFin === oscEcoute, `${oscEcoute} → ${oscFin}`);
let pct = Number((await p.locator('#rg-score').textContent()).replace('%', '')); check('rythme : frappes régulières plus lentes → bon score', pct >= 85, pct + ' % · ' + (await p.locator('#rg-feedback').textContent()));
const tempo = Number(await p.locator('#rg-bpm').textContent()); check('rythme : ton tempo affiché plus lent que 88', tempo > 50 && tempo < 88, String(tempo));
check('rythme : schéma de comparaison affiché', (await p.locator('#rg-compare svg circle').count()) === 8);
check('rythme : niveau suivant proposé', (await p.locator('#rg-level').textContent()) === '2');
check('rythme : « Réécouter ce motif » proposé', await p.locator('#rg-replay').isVisible());
// 1 bis) même motif retapé 1,5 fois moins vite, puis 1,6 fois plus vite : tout autant valide (comparaison relative)
for (const [nom, d] of [['1,5 fois moins vite', 1023], ['1,6 fois plus vite', 426]]) {
  await p.locator('#rg-levels .ans-btn[data-l="1"]').click(); await lancer(); await p.waitForTimeout(600); await frappes([d, d, d, 0]);
  await p.waitForFunction(() => document.getElementById('rg-tap').textContent.includes('Nouveau'), null, { timeout: 15000 });
  const sc = Number((await p.locator('#rg-score').textContent()).replace('%', '')); check(`rythme : 4 noires régulières ${nom} → valide`, sc >= 85, sc + ' %');
}
// 2) frappes irrégulières sur un motif de noires : mauvais score
await p.locator('#rg-levels .ans-btn[data-l="1"]').click(); await lancer(); await p.waitForTimeout(500); await frappes([300, 1200, 300, 0]);
await p.waitForFunction(() => document.getElementById('rg-tap').textContent.includes('Nouveau'), null, { timeout: 15000 });
pct = Number((await p.locator('#rg-score').textContent()).replace('%', '')); check('rythme : frappes irrégulières → score bas', pct < 60, pct + ' % · ' + (await p.locator('#rg-feedback').textContent()));
// 3) frappes manquantes : la manche se termine d'elle-même
await p.locator('#rg-levels .ans-btn[data-l="1"]').click(); await lancer(); await p.waitForTimeout(500); await frappes([700, 0]);
await p.waitForFunction(() => document.getElementById('rg-tap').textContent.includes('Nouveau'), null, { timeout: 15000 });
check('rythme : motif incomplet signalé', /manquait 2 frappes/.test(await p.locator('#rg-feedback').textContent()), await p.locator('#rg-feedback').textContent());
const store = await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_progress') || '{}'));
check('scores enregistrés (clé solfege_progress)', ['clef-sol', 'clef-fa', 'tonalites', 'ig', 'ag', 'dg', 'gg', 'rythme'].every((k) => store.games?.[k]?.played >= 1), Object.keys(store.games ?? {}).join(','));
check('aucune ressource externe', externes.length === 0, externes.join(' '));
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 3).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
