// Relève l'état du bouton ▶ toutes les 0,5 s pendant la lecture. Usage : node tools/test-duree.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => process.exit(2), 40000);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage();
await p.goto(process.argv[2]);
await p.locator('button', { hasText: 'Écouter' }).first().click();
const t0 = Date.now(), seen = [];
for (let i = 0; i < 24; i++) { await p.waitForTimeout(500); const s = await p.locator('button').first().textContent(); if (seen.at(-1)?.[1] !== s) seen.push([((Date.now() - t0) / 1000).toFixed(1), s]); }
console.log(JSON.stringify(seen), await p.locator('#sndstatus').textContent());
await b.close(); process.exit(0);
