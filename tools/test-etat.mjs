// Relève l'état du moteur pendant la lecture (position, horloge audio...). Usage : node tools/test-etat.mjs <url>
import { chromium } from 'playwright-core';
setTimeout(() => process.exit(2), 40000);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(process.argv[2]);
await p.locator('button', { hasText: 'Écouter' }).first().click();
for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(400);
  const st = await p.evaluate(() => { const d = window.__dbg; if (!d) return 'pas de dbg'; return { kind: d.kind, playing: d.engine.isPlaying(), pos: +d.engine.position().toFixed(2), end: +d.end.toFixed(2), ctx: d.ctx?.state, t: +d.ctx?.currentTime.toFixed(2), btn: document.querySelectorAll('button')[0].textContent, curseur: (()=>{const c=document.querySelector('#lesson div');return c?c.style.left:null})() }; });
  console.log(JSON.stringify(st));
}
await b.close(); process.exit(0);
