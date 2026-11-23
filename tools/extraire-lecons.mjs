// Extrait les 25 leçons de l'ancienne application : le texte (HTML de la leçon déjà construit par l'application) et, pour chaque partition, la chaîne ABC
// qu'elle dessinait avec ses options. Les partitions sont remplacées dans le HTML par un repère `data-abc="n"`.
// Usage : node tools/extraire-lecons.mjs <url ancienne appli> <sortie brute.json>     (puis : node tools/convertir-lecons.mjs <brute.json>)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
setTimeout(() => { console.log('ARRET FORCE'); process.exit(2); }, 120000);
const [url, outFile] = [process.argv[2], process.argv[3]];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--renderer-process-limit=1'] });
const p = await b.newPage({ viewport: { width: 800, height: 900 } });
await p.goto(url);
await p.waitForFunction(() => typeof ABCJS !== 'undefined', null, { timeout: 20000 });
await p.evaluate(() => {
  window.__rec = [];
  const o = ABCJS.renderAbc.bind(ABCJS);
  ABCJS.renderAbc = (id, s, opts) => { window.__rec.push({ id, abc: s, staffwidth: opts?.staffwidth, scale: opts?.scale, qpm: opts?.qpm, program: opts?.program, play: typeof opts?.play === 'function' }); return o(id, s, opts); };
});
const ids = await p.evaluate(() => LESSONS.map((l) => ({ id: l.id, title: l.title, duration: l.duration, summary: l.summary })));
const out = [];
for (const l of ids) {
  await p.evaluate(() => { window.__rec.length = 0; });
  await p.evaluate((h) => { location.hash = h; }, '#/cours/' + l.id);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const body = document.querySelector('.lesson-body');
    const clone = body.cloneNode(true);
    const scores = [];
    for (const rec of window.__rec) {
      const el = clone.querySelector('#' + CSS.escape(rec.id));
      if (!el) continue;
      el.innerHTML = '';
      el.setAttribute('data-abc', String(scores.length));
      const nxt = el.nextElementSibling; if (nxt && nxt.classList.contains('abc-play-btn')) nxt.remove();
      scores.push(rec);
    }
    clone.querySelectorAll('.abc-play-btn').forEach((e) => e.remove());
    return { html: clone.innerHTML, scores, rendered: window.__rec.length };
  });
  out.push({ ...l, ...r });
  console.log(l.id.padEnd(22), 'partitions', r.scores.length, '/', r.rendered);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await b.close(); process.exit(0);
