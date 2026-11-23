// Contrast audit of the editor (a developer tool, not part of the app): node tools/contrast-audit.mjs [light|dark|hc] [step]
// Text must reach 7:1 (4.5:1 for large text), the boundary of a button / field 3:1 (WCAG 2.2 AAA 1.4.6, AA 1.4.11). Needs the Chrome of the system (executablePath below).
import { chromium } from 'playwright';
const theme = process.argv[2] || 'hc'; const only = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript((t) => { try { localStorage.setItem('scorsaire.theme', t); } catch {} }, theme);
await p.goto('' + new URL('../dist/scorsaire.html', import.meta.url).href + ''); await p.waitForTimeout(1800);
const audit = (label) => p.evaluate((label) => {
  const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) chain.push(parse(getComputedStyle(n).backgroundColor)); let c = [0, 0, 0, 1]; for (let i = chain.length - 1; i >= 0; i -= 1) c = over(chain[i], c); return c; };
  const fails = new Map();
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('svg') || e.closest('.pkb') || e.closest('[data-piano]')) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const txt = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    const bg = bgOf(e);
    if (txt && !(e.disabled)) {
      const fg = over(parse(cs.color), bg); const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 4.5 : 7; const rt = ratio(fg, bg);
      if (rt < need) fails.set(`T ${rt.toFixed(1)}<${need} ${e.tagName}.${(e.className || '').toString().slice(0, 25)} "${txt.slice(0, 22)}" ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)})`, 1);
    }
    if ((e.tagName === 'BUTTON' || e.tagName === 'INPUT' || e.tagName === 'SELECT') && !e.disabled) {
      const bw = parseFloat(cs.borderTopWidth); const parentBg = bgOf(e.parentElement ?? e);
      const border = over(parse(cs.borderTopColor), parentBg); const fill = bg;
      const textOnly = (bw === 0 || border[3] === 0 || parse(cs.borderTopColor)[3] === 0) && parse(cs.backgroundColor)[3] === 0; if (textOnly) continue; // a control made of its text alone (tab, row title): the text contrast is what identifies it
      const edge = Math.max(bw > 0 ? ratio(border, parentBg) : 0, ratio(fill, parentBg));
      if (edge < 3 && (r.width > 20)) fails.set(`B ${edge.toFixed(1)}<3 ${e.tagName}.${(e.className || '').toString().slice(0, 25)} "${(e.textContent || e.title || '').trim().slice(0, 16)}" border ${cs.borderTopColor} w${bw}`, 1);
    }
  }
  return label + ': ' + (fails.size ? '\n  ' + [...fails.keys()].slice(0, 25).join('\n  ') : 'OK');
}, label);
const step = async (name, fn) => { if (only && only !== name) return; try { await fn(); await p.waitForTimeout(500); console.log(await audit(name)); } catch (e) { console.log(name, 'STEP ERROR', e.message.slice(0, 80)); } };
const go = async (n) => { await p.getByText(/Écran \d :/).first().click(); await p.waitForTimeout(300); await p.getByRole('option', { name: new RegExp('Écran ' + n + ' :') }).click(); await p.waitForTimeout(900); };
await step('screen1', async () => {});
await step('selection', async () => { await p.locator('svg [data-glyph^="notehead"]').first().click({ force: true }); });
await step('settings', async () => { await p.locator('[data-action="file-drawer"]').click(); await p.waitForTimeout(300); await p.locator('[data-action="file-settings"]').click(); });
await step('appearance', async () => { await p.locator('[data-action="file-settings"]').click({ force: true }).catch(() => {}); await p.keyboard.press('Escape'); await p.mouse.click(700, 500); await p.locator('[data-action="appearance"]').click({ force: true }); });
await step('piano', async () => { await p.keyboard.press('Escape'); await p.locator('[data-action="piano-toggle"]').click(); await p.waitForTimeout(500); });
await step('mixer', async () => { await p.locator('[data-action="piano-toggle"]').click(); await p.locator('[data-action="mixer-float"]').click(); });
await step('screen2', async () => { await p.locator('[data-action="mixer-float"]').click().catch(() => {}); await go(2); await p.locator('.ps-zone').first().click({ force: true }); });
await step('screen3', async () => { await go(3); await p.getByText('+ Feuille').first().click(); });
await step('screen3-reader', async () => { await p.getByText('Lecteur', { exact: true }).first().click(); });
await step('screen4', async () => { await go(4); });
await step('screen5', async () => { await go(5); });
console.log(errs);
await b.close();
