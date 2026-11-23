// Prend la galerie en plusieurs captures (lots de 12 lignes). Usage : node tools/capture-galerie.mjs <galerie.html> <préfixe>
import { chromium } from 'playwright-core';
setTimeout(() => process.exit(2), 90000);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1', '--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1020, height: 900 } });
await p.goto('file://' + process.argv[2]); await p.waitForTimeout(2500);
const n = await p.locator('.r').count(); const per = 10;
for (let i = 1, k = 1; i < n; i += per, k++) {
  const first = p.locator('.r').nth(i), last = p.locator('.r').nth(Math.min(i + per - 1, n - 1));
  const a = await first.boundingBox(), z = await last.boundingBox();
  await p.screenshot({ path: `${process.argv[3]}-${k}.png`, fullPage: true, clip: { x: 0, y: a.y - 4, width: 1020, height: z.y + z.height - a.y + 8 } });
}
console.log(Math.ceil((n - 1) / per), 'captures'); await b.close(); process.exit(0);
