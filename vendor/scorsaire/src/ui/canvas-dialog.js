/*
 * The window of a CANVAS (screen 2, « Tablette » tab): the DESTINATION a set of layouts is made for: a name (« iPad », « Android 5:3 »…), the shape of the screen (the usual tablets, or a size of
 * its own) and the way it is held. It makes a new canvas or changes one (its layouts follow the new shape). Nothing is written until « OK »: `onSubmit(spec)` is given
 * { name, format, landscape, widthMm?, heightMm? } and may throw (the message is shown).
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createRoleSelect } from './role-select.js';

export const CANVAS_FORMATS = ['tablet-4-3', 'tablet-16-10', 'tablet-5-3', 'tablet-16-9', 'custom'];

export function openCanvasDialog({ label, canvas = null, onSubmit }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const state = { name: canvas?.name ?? '', format: canvas?.format ?? 'tablet-4-3', landscape: canvas ? canvas.landscape !== false : false, role: '', widthMm: canvas?.widthMm ?? 220, heightMm: canvas?.heightMm ?? 130 };
  let message = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-canvas-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:14px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(480px,100%);display:flex;flex-direction:column;gap:10px;${sheet ? 'border-radius:14px 14px 0 0' : 'border-radius:10px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label(canvas ? 'canvas.edit' : 'canvas.new') });
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const mk = (text, act, fn, { on = false, primary = false } = {}) => {
    const b = el('button', `min-height:var(--ui-target,34px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act, 'aria-pressed': String(on) });
    b.textContent = text; b.addEventListener('click', fn); return b;
  };
  const row = (...kids) => { const r = el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center'); r.append(...kids); return r; };
  const field = (text, input) => { const l = el('label', 'display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--ink-soft,#555)'); l.append(text, input); return l; };
  const inputCss = 'min-height:var(--ui-target,34px);padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:var(--ink,#111);font:14px var(--ui-font,sans-serif);box-sizing:border-box';

  function draw() {
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label(canvas ? 'canvas.edit' : 'canvas.new');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('canvas.hint');
    const name = el('input', `${inputCss};width:100%`, { type: 'text', 'data-canvas-name': '', maxlength: '40', placeholder: label('canvas.namePlaceholder') });
    name.value = state.name; name.addEventListener('input', () => { state.name = name.value; });
    const formats = row(...CANVAS_FORMATS.map((f) => mk(label(`parts.format.${f}`), `canvas-format-${f}`, () => { state.format = f; draw(); }, { on: state.format === f })));
    const orient = row(mk(label('canvas.landscape'), 'canvas-landscape', () => { state.landscape = true; draw(); }, { on: state.landscape }), mk(label('canvas.portrait'), 'canvas-portrait', () => { state.landscape = false; draw(); }, { on: !state.landscape }));
    const size = state.format === 'custom' ? (() => {
      const w = el('input', `${inputCss};width:100px`, { type: 'number', min: '30', max: '1000', 'data-canvas-width': '' }); w.value = String(state.widthMm); w.addEventListener('input', () => { state.widthMm = Number(w.value); });
      const h = el('input', `${inputCss};width:100px`, { type: 'number', min: '30', max: '1000', 'data-canvas-height': '' }); h.value = String(state.heightMm); h.addEventListener('input', () => { state.heightMm = Number(h.value); });
      return row(field(label('canvas.width'), w), field(label('canvas.height'), h));
    })() : null;
    const status = el('div', 'min-height:1.2em;font-size:13px;color:var(--danger-ink,#a33)', { role: 'alert', 'data-canvas-message': '' }); status.textContent = message;
    const actions = row(mk(label(canvas ? 'canvas.save' : 'canvas.create'), 'canvas-ok', () => {
      try { onSubmit({ name: state.name.trim(), format: state.format, landscape: state.landscape, ...(canvas ? {} : { role: state.role }), ...(state.format === 'custom' ? { widthMm: state.widthMm, heightMm: state.heightMm } : {}) }); close(); } catch (e) { message = e?.message ?? String(e); draw(); }
    }, { primary: true }), mk(label('strum.bake.close'), 'canvas-cancel', close));
    box.replaceChildren(...[title, hint, field(label('canvas.name'), name), field(label('canvas.shape'), formats), field(label('canvas.orientation'), orient), canvas ? null : field(label('parts.role'), createRoleSelect({ label, value: state.role, css: inputCss, onChange: (v) => { state.role = v; } })), size, status, actions].filter(Boolean));
  }
  document.body.append(veil);
  draw();
  return { close };
}
