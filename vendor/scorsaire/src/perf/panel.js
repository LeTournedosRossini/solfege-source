/*
 * The panel of the performance probe (shown only when the probe is on, see probe.js): a small box at the top right of the window with the live numbers of the
 * series being measured, a field to name the series, and the buttons that close a series, copy the whole report and clear it.
 * It never writes in the Document and stays out of the way of the score (fixed, small, can be folded).
 */
const ROWS = 14; // lines of the live table

/**
 * @param o.probe     the probe (probe.js)
 * @param o.label     (key) → text
 * @param o.describe  () → object about the open score (measures, staves…) added to the report
 * @returns {{ destroy() }}
 */
export function mountPerfPanel({ probe, label, describe = () => ({}) }) {
  const box = document.createElement('div');
  box.setAttribute('data-perf-panel', ''); box.setAttribute('data-dismiss-keep', ''); box.setAttribute('data-zoom-lock', '');
  box.style.cssText = 'position:fixed;z-index:9999;right:8px;top:8px;width:min(420px,calc(100vw - 16px));font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;background:rgba(255,255,255,0.97);color:#111;border:1px solid rgba(0,0,0,0.35);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.3);padding:6px';
  const head = document.createElement('div'); head.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap';
  const title = document.createElement('strong'); title.textContent = label('perf.title'); title.style.flex = '1';
  const fold = btn('–', label('perf.fold'));
  head.append(title, fold);
  const name = document.createElement('input'); name.type = 'text'; name.placeholder = label('perf.series'); name.setAttribute('aria-label', label('perf.series')); name.style.cssText = 'flex:1;min-width:0;font:inherit;padding:2px 4px;background:#fff;color:#111;border:1px solid #888;border-radius:4px';
  const close = btn(label('perf.close'), label('perf.closeHint'));
  const copy = btn(label('perf.copy'), label('perf.copyHint'));
  const clear = btn(label('perf.clear'), label('perf.clearHint'));
  const row1 = document.createElement('div'); row1.style.cssText = 'display:flex;gap:4px;margin-top:4px'; row1.append(name, close);
  const row2 = document.createElement('div'); row2.style.cssText = 'display:flex;gap:4px;margin-top:4px'; row2.append(copy, clear);
  const table = document.createElement('pre'); table.style.cssText = 'margin:6px 0 0;white-space:pre;overflow-x:auto;max-height:46vh;overflow-y:auto';
  const note = document.createElement('div'); note.style.cssText = 'margin-top:4px;color:#555'; note.textContent = '';
  const body = document.createElement('div'); body.append(row1, row2, table, note);
  box.append(head, body);
  document.body.append(box);

  function btn(text, hint) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = hint; b.style.cssText = 'font:inherit;padding:2px 8px;cursor:pointer;background:#e8e8e8;color:#111;border:1px solid #888;border-radius:4px'; return b; }
  const pad = (v, n) => String(v).padStart(n);
  const refresh = () => {
    const stats = probe.stats();
    const lines = Object.entries(stats).sort((a, b) => b[1].total - a[1].total).slice(0, ROWS)
      .map(([k, s]) => `${k.padEnd(24).slice(0, 24)} ${pad(s.count, 4)}× avg ${pad(s.mean, 7)} p95 ${pad(s.p95, 7)} max ${pad(s.max, 7)}${s.unit === 'ms' ? '' : ` ${s.unit}`}`);
    const f = probe.framesInfo();
    lines.push(label('perf.frames').replace('{n}', f.frames).replace('{slow}', f.slow).replace('{verySlow}', f.verySlow).replace('{max}', f.maxGap));
    table.textContent = lines.join('\n');
  };
  const timer = setInterval(refresh, 1000); refresh();
  fold.addEventListener('click', () => { const hidden = body.style.display === 'none'; body.style.display = hidden ? '' : 'none'; fold.textContent = hidden ? '–' : '+'; });
  close.addEventListener('click', () => { probe.closeSeries(name.value.trim()); name.value = ''; refresh(); note.textContent = label('perf.closed').replace('{n}', String(probe.series().length)); });
  clear.addEventListener('click', () => { probe.clearSeries(); probe.reset(); refresh(); note.textContent = label('perf.cleared'); });
  copy.addEventListener('click', async () => {
    const text = JSON.stringify(probe.json({ score: describe() }), null, 1);
    try { await navigator.clipboard.writeText(text); note.textContent = label('perf.copied'); } catch {
      // no clipboard access (a file:// page on some browsers): the text is put in a field to be copied by hand
      const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true; ta.style.cssText = 'width:100%;height:8em;margin-top:4px;font:inherit'; body.append(ta); ta.select(); note.textContent = label('perf.copyManual');
    }
  });
  return { destroy() { clearInterval(timer); box.remove(); } };
}
