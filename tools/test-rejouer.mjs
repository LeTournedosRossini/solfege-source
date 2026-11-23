// Lecture complète puis seconde lecture : le bouton doit repartir. Usage : node tools/test-rejouer.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => process.exit(2), 45000);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage();
await p.goto(process.argv[2]);
const btn = p.locator('button', { hasText: /Écouter|Stop/ }).first();
const etat = async (n) => console.log(n, JSON.stringify(await btn.textContent()), '|', await p.locator('#sndstatus').textContent());
await btn.click(); await p.waitForTimeout(2000); await etat('1re lecture, à 2 s');
await p.waitForTimeout(6500); await etat('1re lecture, après la fin');
await btn.click(); await p.waitForTimeout(2500); await etat('2e lecture, à 2,5 s');
await b.close(); process.exit(0);
