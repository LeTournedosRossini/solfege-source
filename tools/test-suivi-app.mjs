// Suivi dans l'application : chaque réponse des jeux, du rythme et du jeu d'oreille est enregistrée une fois (élément, modalité, juste ou faux), les leçons sont commencées / terminées,
// et les scores existants (clé solfege_progress) sont toujours tenus à jour. Usage : node tools/test-suivi-app.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 170000);
const url = process.argv[2] || 'http://localhost:8123/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 700, height: 900 } })).newPage();
const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
// jeux à réponses : une réponse = un événement, avec l'élément et le verdict affiché
for (const [id, pref, gid] of [['clef-sol', 'note:treble:', 'ng'], ['clef-fa', 'note:bass:', 'ng'], ['intervalles', 'intervalle:', 'ig'], ['accords', 'accord:', 'ag'], ['durees-silences', 'duree:', 'dg'], ['degres', 'degre:', 'gg'], ['tonalites', 'tonalite:', 'kg']]) {
  const avant = (await evts()).length;
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-answers .ans-btn`);
  const btn = p.locator(`#${gid}-answers .ans-btn`).nth(2); const lab = await btn.getAttribute('data-k'); await btn.click(); await p.waitForTimeout(120);
  const juste = await btn.evaluate((x) => x.classList.contains('correct')); const e = await evts();
  const ev = e.at(-1);
  check(`${id} : une réponse enregistrée (${ev?.e}, ${ev?.ok ? 'juste' : 'faux'})`, e.length === avant + 1 && ev.e.startsWith(pref) && ev.m === 'L' && ev.ok === (juste ? 1 : 0) && ev.r === lab, JSON.stringify(ev));
  await p.waitForTimeout(1000);
}
// rythme à vue (frappes quelconques) et à l'oreille
await p.goto(url + '#/jeux/rythme-vue'); await p.waitForSelector('#rv-tap'); for (let i = 0; i < 3; i++) { await p.click('#rv-tap'); await p.waitForTimeout(300); }
await p.waitForSelector('#rv-listen:not([hidden])', { timeout: 15000 });
let ev = (await evts()).at(-1); check('rythme à vue : résultat enregistré (lecture)', ev.j === 'rythme-vue' && ev.m === 'L' && /^rythme:vue-1$/.test(ev.e) && typeof ev.ok === 'number', JSON.stringify(ev));
await p.goto(url + '#/jeux/rythme'); await p.waitForSelector('#rg-tap'); await p.click('#rg-tap');
await p.waitForFunction(() => /À toi/.test(document.getElementById('rg-tap').textContent), null, { timeout: 25000 }); for (let i = 0; i < 4; i++) { await p.click('#rg-tap'); await p.waitForTimeout(450); }
await p.waitForFunction(() => document.getElementById('rg-score').textContent !== '—', null, { timeout: 15000 });
ev = (await evts()).at(-1); check('rythme à l\'oreille : résultat enregistré (oreille)', ev.j === 'rythme' && ev.m === 'O' && /^rythme:oreille-1$/.test(ev.e), JSON.stringify(ev));
// jeu d'oreille : première réponse seulement
await p.goto(url + '#/oreille'); await p.waitForSelector('#ecStaffWrap svg'); await p.locator('#intervalSubtabs .subtab2-btn[data-sub="ident"]').click(); await p.click('#playBtn');
const st = await p.evaluate(() => window.__oreille.state().ivCur.iv.semitones); const avant = (await evts()).length;
await p.locator(`#answersGrid .ans-btn:not(.inactive):not([data-semitones="${st}"])`).first().click(); await p.waitForTimeout(100);
await p.locator(`#answersGrid .ans-btn[data-semitones="${st}"]`).click(); await p.waitForTimeout(100);
let e2 = await evts(); ev = e2.at(-1);
check('oreille, intervalle : seule la première réponse compte (fausse), modalité oreille, sens en contexte', e2.length === avant + 1 && ev.j === 'oreille-intervalles' && ev.m === 'O' && ev.ok === 0 && /^intervalle:/.test(ev.e) && ev.c === 'montant', JSON.stringify(ev));
await p.locator('#tabs .tab-btn[data-tab="phrase"]').click(); await p.locator('#gaSubtabs .subtab2-btn[data-sub="ident"]').click(); await p.click('#gaPlayBtn');
const q = await p.evaluate(() => window.__oreille.state().gaCur.q.key); await p.locator(`#gaAnswersGrid .ans-btn[data-qkey="${q}"]`).click(); await p.waitForTimeout(100);
ev = (await evts()).at(-1); check('oreille, gamme : bonne réponse enregistrée', ev.j === 'oreille-gammes' && ev.e === 'gamme:' + q && ev.ok === 1, JSON.stringify(ev));
await p.locator('#tabs .tab-btn[data-tab="works"]').click(); await p.locator('#worksSubtabs .subtab2-btn[data-sub="ident"]').click(); await p.click('#wkPlayBtn');
const titre = await p.evaluate(() => window.__oreille.state().wkCur.work.title); await p.locator('#wkAnswersGrid .ans-btn', { hasText: titre }).first().click(); await p.waitForTimeout(100);
ev = (await evts()).at(-1); check('oreille, phrase : bonne réponse enregistrée sous un identifiant sans texte libre', ev.j === 'oreille-phrases' && /^phrase:[a-z0-9-]+$/.test(ev.e) && ev.ok === 1, JSON.stringify(ev));
// écoute libre : rien d'enregistré
const n0 = (await evts()).length; await p.locator('#worksSubtabs .subtab2-btn[data-sub="ecoute"]').click(); await p.locator('#tabs .tab-btn[data-tab="interval"]').click(); await p.locator('#intervalSubtabs .subtab2-btn[data-sub="ecoute"]').click(); await p.locator('#ecPlay').click(); await p.waitForTimeout(300);
check('écoute libre : aucun événement', (await evts()).length === n0);
// leçons
await p.goto(url + '#/cours/portee-cles'); await p.waitForSelector('#lecon-fin');
let d = await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi')).lecons['portee-cles']);
check('leçon : commencée à l\'ouverture', d && d.debut > 0 && !d.fin);
await p.click('#lecon-fin'); d = await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi')).lecons['portee-cles']);
check('leçon : terminée par un clic, date affichée', d.fin > 0 && (await p.locator('#lecon-date').textContent()).startsWith('le ') && (await p.locator('#lecon-fin').getAttribute('aria-pressed')) === 'true', await p.locator('#lecon-date').textContent());
await p.reload(); await p.waitForSelector('#lecon-fin'); check('leçon : état conservé après rechargement', (await p.locator('#lecon-fin').textContent()).includes('terminée'));
await p.click('#lecon-fin'); d = await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi')).lecons['portee-cles']); check('leçon : rouverte par un second clic', !d.fin && d.debut > 0);
// anciens scores toujours tenus à jour
const prog = await p.evaluate(() => JSON.parse(localStorage.getItem('solfege_progress') || '{}'));
check('scores existants (solfege_progress) toujours à jour', ['clef-sol', 'intervalles', 'ig', 'rythme'].some((k) => prog.games?.[k]?.played >= 1) && Object.keys(prog.games || {}).length >= 5, Object.keys(prog.games || {}).join(' '));
// aucun contenu libre dans le journal
const tout = JSON.stringify(await evts()); check('journal sans contenu personnel (que des identifiants et des codes)', !/[A-Za-z]{25,}/.test(tout) && (await evts()).every((x) => x.t && x.j && x.e && (x.m === 'L' || x.m === 'O')));
check('aucune erreur', erreurs.length === 0, erreurs.slice(0, 2).join(' / '));
console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); await b.close(); process.exit(ok ? 0 : 1);
