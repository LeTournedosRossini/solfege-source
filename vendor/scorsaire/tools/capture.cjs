#!/usr/bin/env node
/*
 * capture.js — non-régression visuelle du moteur de rendu (Sheet N Ships)
 *
 * Rejoue chaque section de test de prototype-rendu.html à plusieurs largeurs de canevas
 * (et quelques variantes de réglage), capture chaque <svg>, puis :
 *   node tools/capture.cjs              -> écrit les images de RÉFÉRENCE dans captures/reference/
 *   node tools/capture.cjs --compare    -> refait les captures dans captures/courant/, les compare
 *                                   aux références et écrit les écarts dans captures/diff/
 *
 * Options :
 *   --file <chemin>   page à tester (défaut : ../reference/prototype-rendu.html)
 *   --only <texte>    ne traiter que les captures dont le nom contient <texte>
 *   --tolerance <n>   nombre de pixels différents toléré par image (défaut : 0)
 *
 * Règle d'or : générer les références ET les comparaisons sur la MÊME machine
 * (le rendu des polices/anti-aliasing varie légèrement entre systèmes).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

// ---------------------------------------------------------------- configuration

// Sections : nom du fichier -> id du <svg> dans la page.
const SECTIONS = {
  score:     'score',       // portée score (démo principale, ligatures, glissandos, barres, volta...)
  tab:       'tabScore',    // tablature
  perc:      'percScore',   // percussion
  tabmulti:  'tabMvScore',  // tablature multi-voix (indépendante de la largeur)
  accordeon: 'accScore',    // grand staff score + accordéon
};

// 14 largeurs de canevas (px), comme les vérifications manuelles du roadmap (§12).
const WIDTHS = [360, 400, 450, 500, 560, 640, 720, 820, 900, 1000, 1100, 1200, 1300, 1400];

const DEFAULTS = { staffSpace: 14, clef: 'G', keySig: 'sharp3', stringMode: 'number', courtesyTimeSig: true };

// Configurations : les 14 largeurs au réglage par défaut + quelques variantes à 820 px.
const CONFIGS = [
  ...WIDTHS.map(w => ({ name: `w${w}`, width: w })),
  { name: 'w820_ss10',      width: 820, staffSpace: 10 },
  { name: 'w820_ss20',      width: 820, staffSpace: 20 },
  { name: 'w820_clefF',     width: 820, clef: 'F' },
  { name: 'w820_clefC3',    width: 820, clef: 'C3' },
  { name: 'w820_clefC4',    width: 820, clef: 'C4' },
  { name: 'w820_flat4',     width: 820, keySig: 'flat4' },
  { name: 'w820_sharp0',    width: 820, keySig: 'sharp0' },
  { name: 'w820_strColor',  width: 820, stringMode: 'color' },
  { name: 'w820_noCourtesy',width: 820, courtesyTimeSig: false },
];

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const has = f => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const COMPARE = has('--compare');
const FILE = path.resolve(opt('--file', path.join(__dirname, '..', 'reference', 'prototype-rendu.html')));
const ONLY = opt('--only', '');
const TOLERANCE = parseInt(opt('--tolerance', '0'), 10);
const ROOT = path.join(__dirname, '..', 'captures');
const DIR_REF = path.join(ROOT, 'reference');
const DIR_CUR = path.join(ROOT, 'courant');
const DIR_DIFF = path.join(ROOT, 'diff');

// ---------------------------------------------------------------- utilitaires

const rmrf = d => fs.rmSync(d, { recursive: true, force: true });
const mkdir = d => fs.mkdirSync(d, { recursive: true });

async function applyConfig(page, cfg) {
  const c = { ...DEFAULTS, ...cfg };
  await page.evaluate(c => {
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const setVal = (id, v, type) => { const el = document.getElementById(id); el.value = v; fire(el, type); };
    // Réglages « select/checkbox » d'abord, largeur en DERNIER : c'est l'événement input de la
    // largeur qui relance tous les rendus (score, tab, perc, accordéon).
    setVal('stringDisplaySelect', c.stringMode, 'change');
    setVal('clefSelect', c.clef, 'change');
    setVal('keySigSelect', c.keySig, 'change');
    const cb = document.getElementById('courtesyTimeSigCheckbox');
    cb.checked = c.courtesyTimeSig; fire(cb, 'change');
    setVal('staffSpaceSlider', c.staffSpace, 'input');
    setVal('widthNumber', c.width, 'input');
  }, c);
  await page.waitForTimeout(150); // laisse les rendus se terminer
}

async function shootAll(page, outDir) {
  mkdir(outDir);
  const written = [];
  for (const cfg of CONFIGS) {
    await applyConfig(page, cfg);
    for (const [secName, svgId] of Object.entries(SECTIONS)) {
      const name = `${secName}__${cfg.name}`;
      if (ONLY && !name.includes(ONLY)) continue;
      const loc = page.locator('#' + svgId);
      const box = await loc.boundingBox();
      if (!box || box.width < 2 || box.height < 2) {
        console.warn(`  ! ${name} : svg vide ou invisible, ignoré`);
        continue;
      }
      await loc.screenshot({ path: path.join(outDir, name + '.png'), animations: 'disabled' });
      written.push(name);
    }
  }
  return written;
}

function compareImages(refPath, curPath, diffPath) {
  const a = PNG.sync.read(fs.readFileSync(refPath));
  const b = PNG.sync.read(fs.readFileSync(curPath));
  if (a.width !== b.width || a.height !== b.height) {
    return { diff: -1, note: `dimensions différentes : ${a.width}x${a.height} -> ${b.width}x${b.height}` };
  }
  const out = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  if (n > TOLERANCE) fs.writeFileSync(diffPath, PNG.sync.write(out));
  return { diff: n };
}

// ---------------------------------------------------------------- programme

(async () => {
  if (!fs.existsSync(FILE)) { console.error('Fichier introuvable : ' + FILE); process.exit(2); }
  if (COMPARE && !fs.existsSync(DIR_REF)) {
    console.error('Pas de références : lance d\'abord « node tools/capture.cjs » (sans --compare).'); process.exit(2);
  }

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + FILE.replace(/\\/g, '/'));
  await page.waitForSelector('#accScore');
  await page.waitForTimeout(300);

  const outDir = COMPARE ? DIR_CUR : DIR_REF;
  rmrf(outDir); if (COMPARE) rmrf(DIR_DIFF);
  console.log(`${COMPARE ? 'Comparaison' : 'Références'} — ${FILE}`);
  const names = await shootAll(page, outDir);
  await browser.close();

  if (errors.length) console.warn(`\n! ${errors.length} erreur(s) JavaScript dans la page :\n  ` + errors.slice(0, 5).join('\n  '));

  if (!COMPARE) {
    console.log(`\n${names.length} captures de référence écrites dans ${DIR_REF}`);
    process.exit(0);
  }

  mkdir(DIR_DIFF);
  const bad = [];
  let missing = 0;
  for (const name of names) {
    const ref = path.join(DIR_REF, name + '.png');
    if (!fs.existsSync(ref)) { console.log(`  ? ${name} : pas de référence`); missing++; continue; }
    const r = compareImages(ref, path.join(DIR_CUR, name + '.png'), path.join(DIR_DIFF, name + '.png'));
    if (r.diff < 0) bad.push(`${name} : ${r.note}`);
    else if (r.diff > TOLERANCE) bad.push(`${name} : ${r.diff} pixels différents`);
  }
  console.log(`\n${names.length} captures comparées, ${bad.length} différence(s)` + (missing ? `, ${missing} sans référence` : ''));
  bad.forEach(b => console.log('  ✗ ' + b));
  if (bad.length) console.log(`\nImages de différence : ${DIR_DIFF}`);
  process.exit(bad.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
