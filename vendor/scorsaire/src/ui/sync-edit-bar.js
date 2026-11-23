/*
 * The bar « Correct the map » (screen 4): a small floating panel, NOT a window — the score stays under the finger so a measure is chosen by touching it. It shows the measure that is chosen and the
 * instant it starts at, and moves that start a little (−/+ 100 ms and 10 ms), puts it where the recording is (« Place it here »), plays from just before it with a click on every measure start,
 * undoes, goes back to the original. The maths are in `audio/mapedit.js`; the session is changed by `main.js` (`startMapEdit`), this file only draws and calls `api`.
 */
import { createSwitch } from './switch.js';

const fmt = (s) => { const sign = s < 0 ? '-' : ''; const a = Math.abs(s); const m = Math.floor(a / 60); const r = a - m * 60; return `${sign}${m}:${r.toFixed(3).padStart(6, '0')}`; };

/**
 * @param o.api  { info() → { count, written, pass, passes, time, offsetMs, canUndo, changed, follow, click }, move(ms), place(), listen(), step(±1), undo(), original(), setFollow(bool), setClick(bool), close() }
 * @returns { refresh(), destroy(), node }
 */
export function mountSyncEditBar({ label, api, host = document.body }) {
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const phone = typeof matchMedia !== 'undefined' && matchMedia('(max-width:600px)').matches;
  const node = el('div', `position:fixed;z-index:3400;left:50%;transform:translateX(-50%);bottom:${phone ? '0' : '64px'};width:min(560px,100vw - ${phone ? '0px' : '16px'});box-sizing:border-box;background:var(--paper,#faf8f4);color:var(--ink,#111);border:1px solid var(--edge,#b9b4a8);border-radius:${phone ? '12px 12px 0 0' : '10px'};box-shadow:0 4px 20px rgba(0,0,0,.35);padding:8px 10px;display:flex;flex-direction:column;gap:6px;font:13px var(--ui-font,sans-serif)`, { 'data-sync-edit': '', 'data-zoom-lock': '', role: 'group', 'aria-label': label('syncEdit.title') });
  const btnCss = 'min-height:var(--ui-target,34px);min-width:var(--ui-target,34px);padding:0 10px;border-radius:8px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);cursor:pointer';
  const mk = (text, act, fn, title = '') => { const b = el('button', btnCss, { type: 'button', 'data-act': act, ...(title ? { title, 'aria-label': title } : {}) }); b.textContent = text; b.addEventListener('click', fn); return b; };
  const row = (css = '') => el('div', `display:flex;flex-wrap:wrap;gap:var(--btn-gap,4px);align-items:center;${css}`);

  const head = row('justify-content:space-between'); const title = el('strong', 'font-size:14px'); title.textContent = label('syncEdit.title');
  const close = mk(label('syncEdit.done'), 'sync-edit-done', () => api.close()); close.style.fontWeight = '700';
  head.append(title, close);
  // the bar can be dragged by its title (it must not hide the measure being corrected)
  head.style.cursor = 'grab'; head.style.touchAction = 'none';
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button > 0) return;
    const r = node.getBoundingClientRect(); const dx = e.clientX - r.left; const dy = e.clientY - r.top;
    node.style.transform = 'none'; node.style.bottom = 'auto'; node.style.left = `${r.left}px`; node.style.top = `${r.top}px`; head.setPointerCapture?.(e.pointerId);
    const move = (ev) => { node.style.left = `${Math.min(window.innerWidth - node.offsetWidth, Math.max(0, ev.clientX - dx))}px`; node.style.top = `${Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy))}px`; };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });
  const where = row('justify-content:center;gap:8px');
  const measureOut = el('output', 'min-width:9em;text-align:center;font:var(--w-bold,700) 15px var(--ui-font,sans-serif)', { 'data-sync-edit-measure': '' });
  const timeOut = el('output', 'min-width:6.5em;text-align:center;font:14px ui-monospace,monospace;font-variant-numeric:tabular-nums', { 'data-sync-edit-time': '' });
  where.append(mk('◂', 'sync-edit-prev', () => api.step(-1), label('syncEdit.prev')), measureOut, mk('▸', 'sync-edit-next', () => api.step(1), label('syncEdit.next')), timeOut);
  const nudge = row('justify-content:center');
  nudge.append(mk('−100', 'sync-edit-m100', () => api.move(-100), label('syncEdit.earlier', { ms: 100 })), mk('−10', 'sync-edit-m10', () => api.move(-10), label('syncEdit.earlier', { ms: 10 })),
    mk('+10', 'sync-edit-p10', () => api.move(10), label('syncEdit.later', { ms: 10 })), mk('+100', 'sync-edit-p100', () => api.move(100), label('syncEdit.later', { ms: 100 })), el('span', 'width:8px'),
    mk(label('syncEdit.place'), 'sync-edit-place', () => api.place(), label('syncEdit.placeHint')), mk(`▶ ${label('syncEdit.listen')}`, 'sync-edit-listen', () => api.listen(), label('syncEdit.listenHint')));
  const followSwitch = createSwitch({ checked: false, text: label('syncEdit.follow'), attrs: { 'data-sync-edit-follow': '', title: label('syncEdit.followHint') }, onchange: () => api.setFollow(followSwitch.checked) });
  const clickSwitch = createSwitch({ checked: true, text: label('syncEdit.click'), attrs: { 'data-sync-edit-click': '', title: label('syncEdit.clickHint') }, onchange: () => api.setClick(clickSwitch.checked) });
  for (const s of [followSwitch, clickSwitch]) s.style.cssText = btnCss;
  const options = row('justify-content:center'); options.append(followSwitch, clickSwitch);
  const undo = mk(label('syncEdit.undo'), 'sync-edit-undo', () => api.undo()); const original = mk(label('syncEdit.original'), 'sync-edit-original', () => api.original());
  const foot = row('justify-content:center'); foot.append(undo, original);
  const status = el('div', 'font-size:12px;color:var(--ink-soft,#555);text-align:center;min-height:1.2em', { role: 'status', 'data-sync-edit-status': '' });
  node.append(head, where, nudge, options, foot, status);
  host.append(node);

  function refresh() {
    const i = api.info();
    measureOut.textContent = i.written == null ? '—' : i.passes > 1 ? label('syncEdit.measurePass', { n: i.written, pass: i.pass }) : label('syncEdit.measure', { n: i.written });
    timeOut.textContent = i.time == null ? '' : fmt(i.time);
    undo.disabled = !i.canUndo; original.disabled = !i.changed; undo.style.opacity = i.canUndo ? '' : '.5'; original.style.opacity = i.changed ? '' : '.5';
    followSwitch.checked = i.follow; clickSwitch.checked = i.click;
    status.textContent = i.message || (i.written == null ? label('syncEdit.hint') : '');
  }
  refresh();
  return { refresh, node, destroy() { node.remove(); } };
}
