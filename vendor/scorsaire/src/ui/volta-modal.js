/*
 * Settings of ONE volta (opened from the volta bar, ✎): the text written instead of the numbers, the text size, the line width and the corner radius of the
 * bracket. Each value starts from the default of the Settings (style) until it is changed here; ↺ gives the default back. Every change is one undoable
 * transaction through `app.systemEdit`. Floating box in <body> (zoom-locked), closed by a tap outside it or by ✕; the score never moves.
 * (The numbers and open / closed are in the volta bar itself, see `dom.js`.)
 */
import { dismissOnOutside } from './outside-dismiss.js';
import { keepClear, anchorOfRefs } from './keep-clear.js';
import { PID } from '../model/pid.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const FIELDS = [
  { key: 'textSize', pid: PID.VOLTA_TEXT_SIZE, label: 'volta.textSize', step: 0.05, min: 0.4, max: 3, digits: 2 },
  { key: 'lineWidth', pid: PID.VOLTA_LINE_WIDTH, label: 'volta.lineWidth', step: 0.01, min: 0.03, max: 0.5, digits: 2 },
  { key: 'corner', pid: PID.VOLTA_CORNER, label: 'volta.corner', step: 0.1, min: 0, max: 2, digits: 1 },
];

export function openVoltaSettings({ app, voltaId, label, viewId = 'main' }) {
  const find = () => app.doc.find(voltaId);
  if (!find()) return null;
  const box = document.createElement('div');
  box.setAttribute('data-volta-modal', ''); box.setAttribute('data-zoom-lock', ''); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', label('volta.settings'));
  // phone / tablet: a sheet from the bottom of the screen; computer: a floating box above the bottom bar
  const sheet = panelMode(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false) === 'sheet';
  box.setAttribute('data-mode', sheet ? 'sheet' : 'floating');
  box.style.cssText = `position:fixed;z-index:3000;left:50%;${sheet ? 'bottom:0;width:min(720px,100vw);max-height:60vh;overflow:auto;border-radius:12px 12px 0 0;padding-bottom:calc(10px + env(safe-area-inset-bottom));' : 'bottom:calc(var(--ui-target,44px) * 3);border-radius:10px;max-width:calc(100vw - 16px);'}transform:translateX(-50%);padding:10px 12px;background:var(--field,#fff);color:var(--ink,#111);border:1px solid rgba(0,0,0,0.3);box-shadow:0 6px 24px rgba(0,0,0,0.3);font:15px system-ui,sans-serif;display:flex;flex-direction:column;gap:8px`;
  const btn = (text, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);font:var(--w-semi,600) 15px system-ui,sans-serif';
    b.addEventListener('click', fn);
    return b;
  };
  let off = () => {};
  let clear = null;
  const close = () => { off(); clear?.destroy(); box.remove(); };
  const edit = (change) => { try { app.systemEdit('Volta', (d, mv, sys) => sys.updateVolta(d, find(), change), viewId); } catch { /* refused: nothing changes */ } draw(); };
  const row = (labelText, ...kids) => {
    const r = document.createElement('div'); r.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center';
    const l = document.createElement('span'); l.textContent = labelText; l.style.cssText = 'min-width:8em;font-size:13px'; r.append(l, ...kids); return r;
  };
  function draw() {
    const v = find();
    if (!v) { close(); return; }
    const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px)';
    const title = document.createElement('strong'); title.textContent = label('volta.settings'); title.style.flex = '1';
    const x = btn('✕', label('volta.close'), close); x.setAttribute('data-act', 'volta-close');
    head.append(title, x);
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 24; input.value = v.props?.voltaText ?? ''; input.placeholder = (v.props?.voltaNumbers ?? [1]).map((n) => `${n}.`).join(', ');
    input.setAttribute('data-volta-text', ''); input.setAttribute('aria-label', label('volta.text'));
    input.style.cssText = 'font:16px system-ui,sans-serif;min-height:var(--ui-target,44px);box-sizing:border-box;padding:0 8px;width:12em;max-width:100%';
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => edit({ text: input.value }));
    const rows = [row(label('volta.text'), input)];
    for (const f of FIELDS) {
      const value = Number(app.doc.get(v, f.pid));
      const isLocal = v.props?.[{ [PID.VOLTA_TEXT_SIZE]: 'voltaTextSize', [PID.VOLTA_LINE_WIDTH]: 'voltaLineWidth', [PID.VOLTA_CORNER]: 'voltaCorner' }[f.pid]] != null;
      const out = document.createElement('output'); out.setAttribute('data-volta-value', f.key); out.textContent = value.toFixed(f.digits); out.style.cssText = `min-width:3em;text-align:center;font-variant-numeric:tabular-nums;${isLocal ? 'font-weight:var(--w-bold,700)' : 'opacity:.75'}`;
      const set = (n) => edit({ [f.key]: Math.round(Math.min(f.max, Math.max(f.min, n)) * 100) / 100 });
      const less = btn('−', label('volta.less'), () => set(value - f.step)); less.setAttribute('data-volta-less', f.key);
      const more = btn('+', label('volta.more'), () => set(value + f.step)); more.setAttribute('data-volta-more', f.key);
      const reset = btn('↺', label('volta.default'), () => edit({ [f.key]: null })); reset.disabled = !isLocal; reset.setAttribute('data-volta-reset', f.key);
      rows.push(row(label(f.label), less, out, more, reset));
    }
    const note = document.createElement('div'); note.textContent = label('volta.defaultsNote'); note.style.cssText = 'font-size:12px;opacity:.7;max-width:22em';
    box.replaceChildren(head, ...rows, note);
  }
  draw();
  document.body.append(box);
  off = dismissOnOutside(() => box, close);
  clear = keepClear(box, () => anchorOfRefs([voltaId])); // never over the volta it edits
  clear.apply();
  return { close, redraw: draw };
}
