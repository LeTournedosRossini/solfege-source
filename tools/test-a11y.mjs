// Accessibilité : axe-core sur les pages principales, trois thèmes (clair, sombre, contraste) et trois largeurs (téléphone, tablette, ordinateur).
// Usage : node tools/test-a11y.mjs <url> [--tout]   (par défaut : un thème par largeur ; --tout = les 9 combinaisons)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 560000);
const url = process.argv[2] || 'http://localhost:8123/', tout = process.argv.includes('--tout');
const axe = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const PAGES = [...(process.argv.includes('--lecons') ? (await import('../src/app/data/catalogue.js')).CATALOGUE.lessons.map((l) => '#/cours/' + l.id) : []), '#/', '#/cours', '#/cours/portee-cles', '#/jeux', '#/jeux/clef-sol', '#/jeux/rythme', '#/jeux/rythme-vue', '#/jeux/alterations', '#/jeux/gammes-mineures', '#/jeux/modes-grecs', '#/jeux/transposition', '#/jeux/cadences', '#/jeux/dictee-rythme', '#/jeux/dictee-melodie', '#/jeux/chant-note', '#/jeux/nuances-tempo', '#/jeux/signes-reprise', '#/jeux/basse-chiffree', '#/jeux/degres', 'FENETRE:#/jeux/degres', 'QUIZ:#/cours/portee-cles', '#/outils', '#/outils/metronome', '#/outils/accordeur', '#/outils/piano', '#/oreille', '#/progression', '#/donnees'].slice(process.argv.includes('--lecons') ? 0 : 0);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
let total = 0; const vus = new Map();
for (const [w, theme] of [[390, 'light'], [768, 'dark'], [1200, 'contrast'], ...(tout ? [[390, 'dark'], [390, 'contrast'], [768, 'light'], [768, 'contrast'], [1200, 'light'], [1200, 'dark']] : [])]) {
  const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await p.addInitScript((t) => { localStorage.setItem('solfege_theme', t);
    // quelques données de suivi, pour que la page de progression et l'accueil (« Reprendre ») soient audités avec du contenu
    const J = 86400000, n = Date.now(), ev = (d, j, e, m, ok) => ({ t: n - d * J, j, e, m, ok });
    localStorage.setItem('solfege_suivi', JSON.stringify({ v: 1, evts: [...[1, 1, 0, 1, 0].map((o, i) => ev(4 - i * 0.1, 'ig', 'intervalle:M3', 'L', o)), ...[1, 1, 1, 1, 1, 1].map((o, i) => ev(i < 3 ? 6 : 2, 'oreille-intervalles', 'intervalle:P5', 'O', o)), ev(0.1, 'dg', 'duree:Ronde', 'L', 0)], lecons: { 'portee-cles': { debut: n - 3 * J, fin: n - 2 * J }, 'notes-de-musique': { debut: n - J } } }));
  }, theme);
  for (const page of PAGES) {
    const quiz = page.startsWith('QUIZ:');   // une leçon avec une question de quiz affichée
    const fenetre = page.startsWith('FENETRE:');   // jeu des degrés avec la fenêtre « Choisir les tonalités… » ouverte
    await p.goto(url + (fenetre ? page.slice(8) : quiz ? page.slice(5) : page)); await p.waitForTimeout(700);
    if (quiz) { await p.click('#quiz-debut'); await p.locator('.quiz-option').first().click(); await p.waitForSelector('#quiz-retour button'); }
    if (fenetre) { await p.click('#gg-choisir'); await p.waitForSelector('#gg-dlg[open]'); }
    if (page === '#/oreille') { await p.waitForSelector('#ecStaffWrap svg'); }
    await p.evaluate(axe);
    const r = await p.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
    for (const v of r.violations) for (const n of v.nodes) {
      const key = `${v.id} | ${page} | ${n.target.join(' ')}`;
      if (!vus.has(key)) { vus.set(key, `${theme}/${w}`); total++; console.log(`${v.impact?.padEnd(8)} ${v.id} — ${page} — ${theme}/${w} — ${n.target.join(' ')} — ${(n.failureSummary || '').split('\n').slice(1, 2).join('').trim().slice(0, 140)}`); }
    }
  }
  await p.context().close();
}
console.log(total ? `${total} défauts` : 'AUCUN DÉFAUT'); await b.close(); process.exit(total ? 1 : 0);
