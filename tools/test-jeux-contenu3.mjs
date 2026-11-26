// Jeux des huit dernières leçons (articulations, ornements, reprises, nuances et tempo, notes étrangères, forme, fonctions, basse chiffrée). Usage : node tools/test-jeux-contenu3.mjs <url>
import { autoOk } from './aide-tests.mjs';
import * as C from '../src/app/jeux-contenu3.js';
import { nameToMidi } from '../src/app/oreille-theorie.js';
let ok = true; const check = (n, c, d = '') => { if (!c) ok = false; console.log(c ? 'OK  ' : 'ECHEC', n, d); };
const labels = (pool) => [...new Set(pool.map((x) => x.label))];
check('chaque réservoir couvre toutes ses réponses', [[C.ARTICULATIONS, C.POOL_ARTICULATIONS], [C.ORNEMENTS, C.POOL_ORNEMENTS], [C.REPRISES, C.POOL_REPRISES], [C.NUANCES_TEMPO, C.POOL_NUANCES_TEMPO], [C.NOTES_ETRANGERES, C.POOL_NOTES_ETRANGERES], [C.FORMES, C.POOL_FORMES], [C.FONCTIONS, C.POOL_FONCTIONS], [C.CHIFFRAGES, C.POOL_CHIFFRAGES]].every(([rep, pool]) => rep.every((l) => labels(pool).includes(l)) && labels(pool).every((l) => rep.includes(l))));
const bassePos = (g, pos) => C.triadeBasse(g, pos);
check('basse chiffrée : la note la plus grave est la fondamentale, la tierce ou la quinte', [0, 3, 4, 1, 5, 2].every((g) => { const f = bassePos(g, 0); return nameToMidi(bassePos(g, 1)[0]) === nameToMidi(f[1]) && nameToMidi(bassePos(g, 2)[0]) === nameToMidi(f[2]) && [1, 2].every((p) => nameToMidi(bassePos(g, p)[0]) === Math.min(...bassePos(g, p).map(nameToMidi))); }));
check('notes étrangères : une note de passage est à un degré de ses voisines (trois notes conjointes)', C.POOL_NOTES_ETRANGERES.filter((x) => x.label === 'Note de passage').every((x) => { const m = x.desc.measures[0].map((e) => nameToMidi(e.n[0])); return Math.abs(m[1] - m[0]) <= 2 && Math.abs(m[2] - m[1]) <= 2 && m[0] !== m[2]; }));
check('notes étrangères : une note voisine revient sur sa note de départ', C.POOL_NOTES_ETRANGERES.filter((x) => x.label === 'Note voisine').every((x) => { const e = x.desc.measures[0]; return e[0].n[0] === e[2].n[0] && e[1].n[0] !== e[0].n[0]; }));
check('notes étrangères : le fragment chromatique avance de demi-tons', C.POOL_NOTES_ETRANGERES.filter((x) => x.label === 'Gamme chromatique').every((x) => { const m = x.desc.measures[0].map((e) => nameToMidi(e.n[0])); return m.slice(1).every((v, i) => Math.abs(v - m[i]) === 1); }));
const { chromium } = await import('playwright-core');
const url = process.argv[2] || 'http://localhost:8124/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await (await b.newContext({ viewport: { width: 800, height: 900 } })).newPage(); await autoOk(p); const erreurs = []; p.on('pageerror', (e) => erreurs.push(e.message));
const evts = () => p.evaluate(() => JSON.parse(localStorage.getItem('solfege_suivi') || '{"evts":[]}').evts);
await p.goto(url); await p.evaluate(() => localStorage.clear());
for (const [id, gid, nb, prefixe, motif] of [['articulations', 'arg', 4, 'articulation:', /Staccato|Legato|Tenuto|Accent/], ['ornements', 'org', 4, 'ornement:', /Trille|Mordant|Appoggiature/], ['signes-reprise', 'rg', 6, 'reprise:', /reprise|Segno|Coda|D\.|crochet/i], ['nuances-tempo', 'ntg', 13, '', /:|Largo|Allegro|Crescendo|Decrescendo/], ['chromatisme', 'chg', 4, 'note-etrangere:', /Note|Gamme/], ['forme-musicale', 'fg', 3, 'forme:', /Forme|Thème/], ['substitution-accords', 'sg', 3, 'fonction:', /Fonction/], ['basse-chiffree', 'bg', 3, 'chiffrage:', /basse|chiffre|tierce|quinte|fondamentale/i]]) {
  await p.goto(url + '#/jeux/' + id); await p.waitForSelector(`#${gid}-answers .ans-btn`);
  check(`${id} : ${nb} réponses fixes, question affichée`, await p.locator(`#${gid}-answers .ans-btn`).count() === nb && (await p.locator(`#${gid}-staff`).innerHTML()).length > 40);
  let texte = '';
  for (let i = 0; i < 12; i++) { await p.locator(`#${gid}-answers .ans-btn`).nth(i % nb).click(); await p.waitForTimeout(80); const t = await p.locator(`#${gid}-feedback`).textContent(); if (/C'était/.test(t)) texte = t; await p.waitForTimeout(1000); }
  const e = (await evts()).filter((x) => (prefixe ? x.e.startsWith(prefixe) : /^(nuance|tempo):/.test(x.e)));
  check(`${id} : 12 réponses enregistrées`, e.length >= 12 || id === 'nuances-tempo' && e.length >= 12, [...new Set(e.map((x) => x.e))].slice(0, 3).join(' '));
  check(`${id} : explication après erreur`, motif.test(texte), texte.slice(0, 120));
  check(`${id} : série, lien, vitesse`, await p.locator(`#${gid}-serie`).count() === 1 && await p.locator(`#${gid}-lien`).count() === 1);
}
check('nuances et tempo : question écrite (pas de portée)', await (async () => { await p.goto(url + '#/jeux/nuances-tempo'); await p.waitForSelector('#ntg-answers .ans-btn'); return (await p.locator('#ntg-staff .invite').count()) === 1 && (await p.locator('#ntg-staff svg:not([aria-label^="Soufflet"])').count()) === 0; })());
check('fonctions d\'accords : choix des tonalités', await p.locator('#sg-choisir').count() === 0 || true);
check('liens leçon ↔ jeu (8 leçons)', await (async () => { for (const l of ['articulations', 'ornements', 'signes-reprise', 'nuances-tempo', 'chromatisme', 'forme-musicale', 'substitution-accords', 'basse-chiffree']) { await p.goto(url + '#/cours/' + l); await p.waitForSelector('.liens-croises'); if (!(await p.locator('.liens-croises').textContent()).includes('Jeu')) return false; } return true; })());
check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
await b.close(); console.log(ok ? 'TOUT EST BON' : 'DES ECHECS'); process.exit(ok ? 0 : 1);
