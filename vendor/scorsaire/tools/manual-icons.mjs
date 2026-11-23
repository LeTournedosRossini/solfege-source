/*
 * The icon glossary of the user manual, read from the real interface: the built editor (`dist/scorsaire.html`) is opened in Chromium, put in a series of states (bars open, a
 * measure chosen, the mixer…), and every button that carries an SVG icon is recorded with its tooltip, in French AND in English. Nothing is written by hand: a changed icon or a
 * changed tooltip shows up the next time this runs (`npm run manuel:icones`), and the result, `docs/manuel/glossaire.json`, is what `tools/build-manual.mjs` reads.
 * Needs Playwright and a Chromium (`CHROMIUM_PATH=… npm run manuel:icones` when Playwright asks for another one).
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = `file://${join(root, 'dist', 'scorsaire.html')}`;

/** The zone of the interface a button sits in: the closest ancestor that carries one of these markers. */
const ZONES = [
  ['data-context-bar', 'context'], ['data-sync-panel', 'sync'], ['data-parts-screen', 'parts'], ['data-sheets-screen', 'sheets'], ['data-note-entry-bar', 'entry'], ['data-tab-entry-bar', 'tabentry'], ['data-dock-mid', 'transport'], ['data-dock-top', 'dock'], ['data-dock-bottom', 'dock'],
  ['data-track-controls', 'trackcontrols'], ['data-tracks-panel', 'tracks'], ['data-sidebar', 'sidebar'], ['data-mixer', 'mixer'], ['data-bottom-sheet', 'sheet'], ['data-lc-sheet', 'sheet'], ['data-status-line', 'top'],
];

const collect = (zones) => {
  const zoneOf = (b) => { for (let e = b; e && e !== document.body; e = e.parentElement) for (const [attr, z] of zones) if (e.hasAttribute?.(attr)) return z; return 'other'; };
  const strip = (svg) => { const c = svg.cloneNode(true); c.removeAttribute('style'); c.removeAttribute('aria-hidden'); for (const n of c.querySelectorAll('[style]')) if (/width|height/.test(n.getAttribute('style'))) n.removeAttribute('style'); return c.outerHTML; };
  const out = [];
  for (const b of document.querySelectorAll('button')) {
    if (!b.offsetParent) continue;
    const svgs = [...b.querySelectorAll('svg')]; if (!svgs.length) continue;
    const title = (b.title || b.getAttribute('aria-label') || '').trim(); if (!title) continue;
    out.push({ zone: zoneOf(b), names: svgs.map((s) => s.dataset.icon ?? '').join('+'), svg: svgs.map(strip).join(''), title, action: b.getAttribute('data-action') || b.getAttribute('data-act') || '' });
  }
  return out;
};

/** The states the interface is put in; each one may fail without stopping the others. */
const STATES = {
  pc: [
    ['screen1', async () => {}],
    ['entry', async (p) => { await p.click('[data-action="entry-toggle"]'); await p.waitForTimeout(400); }],
    ['measure', async (p) => {
      const box = await p.locator('svg[role="img"]').first().boundingBox();
      for (let y = box.y + 80; y < Math.min(box.y + 700, 800); y += 18) { await p.mouse.click(box.x + 330, y); await p.waitForTimeout(80); if (await p.locator('[data-context-bar]').first().isVisible().catch(() => false)) break; }
    }],
    ...[1, 2, 3, 4].map((n) => [`screen${n + 1}`, async (p) => {
      await p.keyboard.press('Escape');
      await p.click('[data-act="dock-screen"]'); await p.waitForTimeout(300);
      await p.locator('[role="option"]').nth(n).click(); await p.waitForTimeout(900);
    }]),
    ['transport', async (p) => { await p.keyboard.press('Escape'); const b = p.locator('[data-action="transport-drawer"]'); if (await b.isVisible().catch(() => false)) await b.click(); await p.waitForTimeout(300); }],
  ],
  phone: [
    ['phone', async () => {}],
    ['phone-transport', async (p) => { await p.click('[data-action="transport-drawer"]'); await p.waitForTimeout(300); }],
  ],
};
const VIEWPORTS = { pc: { width: 1280, height: 900 }, phone: { width: 390, height: 800 } };

const run = async (browser, locale) => {
  const result = [];
  for (const [device, states] of Object.entries(STATES)) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[device], locale, hasTouch: device === 'phone', isMobile: false });
    const p = await ctx.newPage();
    await p.goto(page); await p.waitForTimeout(2500);
    for (const [name, step] of states) {
      try {
        await step(p); await p.waitForTimeout(200);
        let items = await p.evaluate(collect, ZONES);
        // the buttons that belong to another screen are filed under it (the bars shared by every screen stay where they are)
        if (/^screen[2-5]$/.test(name)) items = items.map((it) => (['sidebar', 'parts', 'sheets', 'sync', 'other', 'tracks'].includes(it.zone) ? { ...it, zone: name } : it));
        result.push({ state: name, items });
      } catch (e) { console.warn(`  (${locale} ${name}: ${e.message.split('\n')[0]})`); result.push({ state: name, items: [] }); }
    }
    await ctx.close();
  }
  return result;
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const fr = await run(browser, 'fr-FR'); const en = await run(browser, 'en-US');
await browser.close();

const generic = (t) => t.replace(/«[^»]*»/g, '« … »').replace(/“[^”]*”/g, '“…”').replace(/"[^"]*"/g, '" … "');
const STEPPER = {
  minus: { fr: 'Moins : diminue la valeur à côté de laquelle il se trouve (marges, tailles, nombres)', en: 'Minus: lowers the value it sits beside (margins, sizes, numbers)' },
  plus: { fr: 'Plus : augmente la valeur à côté de laquelle il se trouve (marges, tailles, nombres)', en: 'Plus: raises the value it sits beside (margins, sizes, numbers)' },
};
const seen = new Map();
fr.forEach((s, si) => s.items.forEach((it, ii) => {
  const twin = en[si]?.items[ii];
  const english = twin && twin.names === it.names ? twin.title : it.title;
  // the ± buttons that sit beside every number (margins, sizes…) are one entry, not thirty
  const stepper = (it.names === 'minus' || it.names === 'plus') && /[−+]$/.test(it.title);
  const text = stepper ? STEPPER[it.names] : { fr: generic(it.title), en: generic(english) };
  const sharedBar = it.zone.startsWith('screen') && [...seen.values()].some((x) => x.names === it.names && x.fr === text.fr && !x.zone.startsWith('screen'));
  if (sharedBar) return; // a bar that every screen has is listed once, where it first appears
  const key = stepper ? `stepper|${it.names}` : `${it.zone}|${it.names}|${text.fr}`;
  if (!seen.has(key)) seen.set(key, { zone: it.zone, names: it.names, svg: it.svg, fr: text.fr, en: text.en, action: it.action });
}));
const list = [...seen.values()];
writeFileSync(join(root, 'docs', 'manuel', 'glossaire.json'), `${JSON.stringify(list, null, 1)}\n`);
console.log(`${list.length} icônes dans docs/manuel/glossaire.json`);
const byZone = {}; for (const x of list) byZone[x.zone] = (byZone[x.zone] ?? 0) + 1; console.log(byZone);
