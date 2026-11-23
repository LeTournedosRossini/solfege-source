/*
 * The pictures of the user manual, taken from the real built editor and Lecteur in Chromium, in French and in English (`docs/manuel/img/<name>-<lang>.png`).
 * `npm run manuel:captures` — to run again when the interface changes; the pictures are kept in the repository so that `npm run manuel` needs no browser.
 * Needs the built `dist/` (`npm run build`) and a Chromium (`CHROMIUM_PATH=… ` when Playwright asks for another one).
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const editor = `file://${join(root, 'dist', 'scorsaire.html')}`;
const lecteur = `file://${join(root, 'dist', 'lecteur', 'index.html')}`;
const img = join(root, 'docs', 'manuel', 'img');
fs.mkdirSync(img, { recursive: true });
const SYNC_FILE = process.env.MANUEL_SYNC_FILE ?? join(process.env.HOME ?? '', 'Bureau', 'Bryan_Adams_When_You_re_Gone_opus.zip'); // an All-in-One archive (not in the repository: it is somebody's song); without it the screen 4 picture is left as it is
const PC = { width: 1280, height: 760 }; const PHONE = { width: 390, height: 780 };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const only = process.env.MANUEL_ONLY ? process.env.MANUEL_ONLY.split(',') : null; // `MANUEL_ONLY=ecran4-vide,pistes npm run manuel:captures` takes just those pictures
const shoot = async (locale, name, viewport, setup, { url = editor, wait = 2500, clip = null, touch = false, settle = 400 } = {}) => {
  if (only && !only.includes(name)) return;
  const ctx = await browser.newContext({ viewport, locale, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch });
  const p = await ctx.newPage();
  try {
    await p.goto(url); await p.waitForTimeout(wait);
    await setup(p);
    await p.waitForTimeout(settle);
    await p.screenshot({ path: join(img, `${name}-${locale.slice(0, 2)}.png`), ...(clip ? { clip } : {}) });
    console.log('  ok', `${name}-${locale.slice(0, 2)}`);
  } catch (e) { console.warn(`  (${name} ${locale}: ${e.message.split('\n')[0]})`); }
  await ctx.close();
};

for (const locale of ['fr-FR', 'en-US']) {
  await shoot(locale, 'ecran1', PC, async () => {});
  await shoot(locale, 'saisie', PC, async (p) => { await p.click('[data-action="entry-toggle"]'); await p.waitForTimeout(500); });
  await shoot(locale, 'mesure', PC, async (p) => {
    const box = await p.locator('svg[role="img"]').first().boundingBox();
    for (let y = box.y + 80; y < 700; y += 18) { await p.mouse.click(box.x + 330, y); await p.waitForTimeout(80); if (await p.locator('[data-context-bar]').first().isVisible().catch(() => false)) break; }
  });
  await shoot(locale, 'telephone', PHONE, async () => {}, { touch: true });
  await shoot(locale, 'telephone-tiroir', PHONE, async (p) => { await p.click('[data-action="transport-drawer"]'); await p.waitForTimeout(400); }, { touch: true });
  const goTo = async (p, n) => { await p.click('[data-act="dock-screen"]'); await p.waitForTimeout(300); await p.locator('[role="option"]').nth(n).click(); await p.waitForTimeout(1200); };
  await shoot(locale, 'ecran2', PC, async (p) => { await goTo(p, 1); });
  await shoot(locale, 'ecran3', PC, async (p) => { await goTo(p, 2); await p.getByText(/^\+ (Feuille|Sheet)/).first().click(); await p.waitForTimeout(1500); });
  await shoot(locale, 'pistes', PC, async (p) => {
    await p.getByText(/^(Pistes|Tracks)$/).first().click(); await p.waitForTimeout(400);
    await p.locator('.tp-track').last().locator('[aria-expanded]').first().click(); await p.waitForTimeout(400);
  }, { clip: { x: 0, y: 50, width: 370, height: 560 } });
  const words = locale.startsWith('fr') ? '[Couplet 1]\nLe soleil se lève sur la mer\nLes oiseaux chantent dans le vent\n[Refrain]\nChante avec moi\nTout le long du chemin' : '[Verse 1]\nThe sun is rising over the sea\nThe birds are singing in the wind\n[Chorus]\nSing along with me\nAll along the way';
  await shoot(locale, 'paroles', PC, async (p) => {
    await p.getByText(/^(Pistes|Tracks)$/).first().click(); await p.waitForTimeout(400);
    await p.locator('[data-act="add-track"]').first().click(); await p.waitForTimeout(300);
    await p.locator('[role="option"]').filter({ hasText: /^(Paroles|Lyrics)$/ }).first().click(); await p.waitForTimeout(800);
    await p.locator('[data-act="lyric-paste"]').click(); await p.waitForTimeout(300);
    await p.locator('textarea[data-lyric-paste]').fill(words);
    await p.locator('[data-act="lyric-paste-keep"]').click(); await p.waitForTimeout(500);
    await p.locator('[data-act="lyric-reserve-toggle"]').click(); await p.waitForTimeout(500);
  }, { clip: { x: 250, y: 55, width: 780, height: 655 } });
  await shoot(locale, 'ecran5', { width: 1280, height: 420 }, async (p) => { await goTo(p, 4); });
  await shoot(locale, 'ecran4-vide', PC, async (p) => { await goTo(p, 3); }, { clip: { x: 340, y: 120, width: 600, height: 210 } });
  if (fs.existsSync(SYNC_FILE)) {
    // only the panel (waveform, transport, stems): the score under it would show the words of the song
    await shoot(locale, 'ecran4', PC, async (p) => {
      await goTo(p, 3);
      const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 8000 }), p.getByText(/^(Charger|Load)/).first().click()]);
      await fc.setFiles(SYNC_FILE); await p.waitForTimeout(14000);
      await p.locator('[data-act="sync-staves-skip"], button:has-text("Pas maintenant"), button:has-text("Not now")').first().click(); await p.waitForTimeout(800);
    }, { clip: { x: 0, y: 50, width: 1280, height: 268 } });
  } else console.warn(`  (écran 4 : pas de fichier ${SYNC_FILE})`);
  await shoot(locale, 'lecteur-chordpro', { width: 420, height: 720 }, async (p) => {
    await p.setInputFiles('input[data-act="open-file"]', join(root, 'docs', 'manuel', 'exemple.cho')); await p.waitForTimeout(1200);
  }, { url: lecteur, wait: 1500 });
  await shoot(locale, 'lecteur-metronome', { width: 700, height: 460 }, async (p) => {
    await p.setInputFiles('input[data-act="open-file"]', join(root, 'docs', 'manuel', 'exemple.cho')); await p.waitForTimeout(1200);
    await p.locator('[data-lc-fab="metronome"]').click();
    for (let i = 0; i < 60; i++) { await p.waitForTimeout(30); if (+(await p.evaluate(() => document.querySelector('[data-lc-metronome]')?.style.opacity ?? 0)) > 0.8) break; } // the moment of the flash
  }, { url: lecteur, wait: 1500, settle: 0 });
}
await browser.close();
