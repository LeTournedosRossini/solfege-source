// Comparaison : le composant officiel de Scorsaire (servi en lecture seule) joue-t-il dans le même Chromium ?
import { chromium } from 'playwright-core';
const T = Date.now(); const t = () => `[${((Date.now() - T) / 1000).toFixed(1)}s]`;
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 50000);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage();
page.on('console', (m) => console.log(t(), m.type(), m.text().slice(0, 160)));
page.on('request', (r) => { if (/sf3|sound/.test(r.url())) console.log(t(), 'requete', r.url().split('/').pop()); });
await page.goto('http://localhost:8124/bloc-notes/index.html');
await page.waitForTimeout(1500);
console.log(t(), 'page chargée');
await page.locator('[data-act=play]').first().click();
console.log(t(), 'clic ▶');
await page.waitForTimeout(8000);
console.log(t(), 'fin attente');
await browser.close(); process.exit(0);
