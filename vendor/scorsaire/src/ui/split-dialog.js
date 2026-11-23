/*
 * The "Cut into movements" window (model/movementsplit.js, applied by `app.splitMovement`): a sheet of 16 exercises imported as 16 measures in a row becomes 16 movements.
 * An overview shows EVERY measure with its notes (one layout of the whole movement, cropped per measure); two taps choose a range (first measure, last measure), the ranges are
 * listed under it with a title each; shortcuts choose them all at once (every N measures, at double bars, at rehearsal marks). One undo step.
 */
import { drawCell } from '../reader/core.js';
import { measureZones } from '../layout/sheetcursor.js';
import { rangesEvery, rangesAtDoubleBars, rangesAtRehearsalMarks } from '../model/movementsplit.js';
import { createSwitch } from './switch.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const HUES = [210, 28, 140, 330, 50, 260];
const color = (k, a = 1) => `hsl(${HUES[k % HUES.length]} 65% 45% / ${a})`;
const THUMB_H = 54; // px: height of the notes in a cell

export function openSplitDialog({ app, label, movement = 0, onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const mv = app.doc.work.movements[movement];
  const total = mv.masterbars.length;
  let ranges = []; // [{ from, to, title }]
  let pending = null; let every = 1; let keepOriginal = false; let sheets = true; let message = ''; let warn = []; let result = null;
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-split-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(960px,100vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('split.title') });
  if (!sheet) box.setAttribute('data-resizable', 'split');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  // ---- the overview: the movement laid out ONCE, every measure is a crop of that drawing ----
  let zones = []; let fullSvg = null;
  try {
    const stage = el('div');
    const cell = drawCell(stage, { work: app.doc.work, movement: mv, width: 900, staffSpace: 4.2, mode: 'wrap', margin: 6, header: false });
    zones = measureZones(cell.laid);
    fullSvg = cell.box.querySelector('svg');
    if (fullSvg) { fullSvg.setAttribute('id', 'split-full'); fullSvg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'; }
  } catch { zones = []; fullSvg = null; }
  const zoneOf = new Map(zones.map((z) => [z.index, z]));

  const mk = (text, act, fn, { primary = false, on = false, disabled = false } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:1px solid var(--primary,#2a5bd7)' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');
  const rangeOf = (i) => ranges.findIndex((r) => i >= r.from && i <= r.to);
  const addRange = (a, b) => {
    const from = Math.min(a, b); const to = Math.max(a, b);
    ranges = ranges.filter((r) => r.to < from || r.from > to); // a new range replaces what it covers
    ranges.push({ from, to, title: '' }); ranges.sort((x, y) => x.from - y.from);
  };
  const setAll = (list) => { ranges = list.map((r) => ({ ...r, title: '' })); pending = null; message = ''; warn = []; draw(); };
  const defaultTitle = (k) => label('split.defaultTitle', { n: k + 1 });

  function draw() {
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('split.title');
    if (result) { // done: the movement that was cut is gone (unless kept), nothing more can be chosen here
      const lines = el('div', 'display:flex;flex-direction:column;gap:4px', { role: 'status', 'data-split-result': '' });
      for (const t of [label('split.done', { n: result.ids.length }), ...warn]) { const d = el('div'); d.textContent = t; lines.append(d); }
      box.replaceChildren(title, lines, mk(label('strum.bake.close'), 'split-close', close, { primary: true }));
      return;
    }
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('split.hint');
    const quick = row();
    const n = el('span', 'display:inline-flex;align-items:center;gap:2px');
    const val = el('span', 'min-width:2ch;text-align:center;font:600 14px var(--ui-font,sans-serif)'); val.textContent = String(every);
    n.append(mk('−', 'split-less', () => { every = Math.max(1, every - 1); draw(); }), val, mk('+', 'split-more', () => { every = Math.min(total, every + 1); draw(); }));
    const everyLabel = el('span', 'margin:0 4px 0 8px;font-size:13px'); everyLabel.textContent = label('split.every');
    quick.append(mk(label('split.one'), 'split-each', () => setAll(rangesEvery(total, 1))), everyLabel, n, mk(label('split.apply.every'), 'split-every', () => setAll(rangesEvery(total, every))),
      mk(label('split.doubleBars'), 'split-doubles', () => setAll(rangesAtDoubleBars(mv))), mk(label('split.rehearsal'), 'split-rehearsal', () => setAll(rangesAtRehearsalMarks(mv))), mk(label('split.clear'), 'split-clear', () => setAll([])));
    // the overview
    const grid = el('div', 'display:flex;flex-wrap:wrap;gap:4px;max-height:44vh;overflow:auto;padding:4px;border:1px solid var(--edge,#bbb);border-radius:6px;background:var(--score,#fff);position:relative', { 'data-split-overview': '' });
    if (fullSvg) grid.append(fullSvg);
    for (let i = 0; i < total; i++) {
      const k = rangeOf(i); const z = zoneOf.get(i);
      const w = z ? Math.max(48, Math.round((z.x2 - z.x1) * (THUMB_H / (z.y2 - z.y1)))) : 56;
      const cell = el('button', `position:relative;display:flex;flex-direction:column;align-items:stretch;padding:0;border-radius:4px;background:var(--score,#fff);color:inherit;cursor:pointer;border:2px solid ${k >= 0 ? color(k) : 'var(--edge,#bbb)'};${pending === i ? 'outline:3px solid var(--primary,#2a5bd7);' : ''}${k < 0 && ranges.length ? 'opacity:.55;' : ''}`, { type: 'button', 'data-measure': String(i), 'aria-label': label('split.measureLabel', { n: i + 1 }), 'aria-pressed': String(k >= 0) });
      const tag = el('span', `font:600 11px var(--ui-font,sans-serif);padding:1px 4px;text-align:left;${k >= 0 ? `background:${color(k, .18)};` : ''}`); tag.textContent = k >= 0 ? `${i + 1} · ${k + 1}` : String(i + 1);
      cell.append(tag);
      if (fullSvg && z) {
        const view = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        view.setAttribute('viewBox', `${z.x1} ${z.y1} ${z.x2 - z.x1} ${z.y2 - z.y1}`); view.setAttribute('width', String(w)); view.setAttribute('height', String(THUMB_H)); view.setAttribute('preserveAspectRatio', 'xMinYMid meet'); view.style.display = 'block';
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#split-full'); view.append(use); cell.append(view);
      } else cell.style.minWidth = '56px';
      cell.addEventListener('click', () => {
        if (pending === null) { pending = i; message = label('split.pickEnd', { n: i + 1 }); } else { addRange(pending, i); pending = null; message = ''; }
        warn = []; draw();
      });
      grid.append(cell);
    }
    // the ranges
    const list = el('div', 'display:flex;flex-direction:column;gap:4px', { 'data-split-ranges': '' });
    ranges.forEach((r, k) => {
      const line = row(); line.style.gap = '6px';
      const badge = el('span', `min-width:6.5em;font:600 13px var(--ui-font,sans-serif);color:${color(k)}`); badge.textContent = r.from === r.to ? label('split.rangeOne', { k: k + 1, n: r.from + 1 }) : label('split.range', { k: k + 1, from: r.from + 1, to: r.to + 1 });
      const input = el('input', 'flex:1;min-width:8em;min-height:30px;font:14px var(--ui-font,sans-serif);padding:0 6px;border:1px solid var(--field-edge,#767676);border-radius:6px;background:var(--field,#fff);color:inherit', { type: 'text', 'data-split-title': String(k), placeholder: defaultTitle(k), 'aria-label': label('split.titleOf', { k: k + 1 }), maxlength: '80' });
      input.value = r.title; input.addEventListener('input', () => { r.title = input.value; });
      const del = mk('✕', 'split-remove', () => { ranges.splice(k, 1); draw(); }); del.setAttribute('aria-label', label('split.remove'));
      line.append(badge, input, del); list.append(line);
    });
    const left = ranges.length ? total - ranges.reduce((s, r) => s + (r.to - r.from + 1), 0) : 0;
    const info = el('div', 'font-size:12px;color:var(--ink-soft,#555)', { 'data-split-info': '' });
    info.textContent = ranges.length ? `${label('split.count', { n: ranges.length })}${left > 0 ? ` ${label('split.left', { n: left })}` : ''}` : '';
    const opts = row();
    opts.append(createSwitch({ checked: sheets, text: label('split.sheets'), attrs: { 'data-act': 'split-sheets' }, onchange: (e) => { sheets = e.target.checked; } }),
      createSwitch({ checked: keepOriginal, text: label('split.keep'), attrs: { 'data-act': 'split-keep' }, onchange: (e) => { keepOriginal = e.target.checked; } }));
    const actions = row();
    actions.append(mk(label('split.cut'), 'split-apply', apply, { primary: true, disabled: !ranges.length }), mk(label('strum.bake.close'), 'split-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-split-message': '' });
    status.textContent = [message, ...warn].filter(Boolean).join(' ');
    box.replaceChildren(title, hint, quick, grid, list, info, opts, actions, status);
  }

  function apply() {
    if (!ranges.length) { message = label('split.none'); draw(); return; }
    try {
      const r = app.splitMovement(ranges.map(({ from, to }) => ({ from, to })), { movement, titles: ranges.map((x, k) => x.title.trim() || defaultTitle(k)), keepOriginal, sheets });
      const ties = r.warnings.reduce((s, w) => s + w.count, 0);
      warn = ties ? [label('split.tie', { count: ties })] : [];
      result = r; onDone?.(r); draw();
    } catch (e) { message = e.message; draw(); }
  }

  document.body.append(veil);
  draw();
  return { close };
}
