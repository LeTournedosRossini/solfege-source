// Capture d'écran de la leçon en cours de lecture (pour vérifier le curseur). Usage : node tools/capture-curseur.mjs <url> <fichier.png>
import { chromium } from 'playwright-core';
setTimeout(() => process.exit(2), 40000);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 700, height: 520 } });
await p.goto(process.argv[2]);
await p.locator('button', { hasText: 'Écouter' }).first().click();
await p.waitForTimeout(3600);
await p.screenshot({ path: process.argv[3] });
await b.close(); process.exit(0);
