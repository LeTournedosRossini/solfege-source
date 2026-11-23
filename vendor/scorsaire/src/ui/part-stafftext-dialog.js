/*
 * The window of a free text of a PRINTED PART (screen 2): a text above / below a staff of the part, at the start of a measure, normal / italic / bold, with an optional line (dashed or solid)
 * that runs over a number of measures or to the end of the piece, with or without a hook at its end. It is drawn in this part only (model/partstafftext.js). Creates a text, or edits one
 * (`entry`). Every validation is one undoable transaction.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';

export function openPartStaffTextDialog({ app, label, partId, staffId = null, measureId = null, entry = null, onDone = null }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const targets = app.partTextTargets(partId);
  if (!targets.length) return null;
  const first = entry?.staffId ?? staffId ?? targets[0].id;
  const state = {
    staff: targets.some((t) => t.id === first) ? first : targets[0].id,
    measure: 0, text: entry?.text ?? '', style: entry?.style ?? 'normal', placement: entry?.placement ?? 'above',
    line: entry?.line ?? null, toEnd: Boolean(entry?.toEnd), span: entry?.lineSpan ?? 2, hook: Boolean(entry?.hook), message: '',
  };
  const idsOf = () => targets.find((t) => t.id === state.staff).ids;
  const wanted = entry?.measureId ?? measureId;
  state.measure = Math.max(0, idsOf().indexOf(wanted));
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-part-text-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(520px,96vw);max-height:88vh;overflow:auto;border-radius:${sheet ? '14px 14px 0 0' : '12px'};display:flex;flex-direction:column;gap:10px`, { role: 'dialog', 'aria-label': label('partText.title') });
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); onDone?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(veil);

  const btnCss = 'min-height:var(--ui-target,30px);min-width:var(--ui-target,30px);padding:0 10px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);border:1px solid var(--edge,#b9b4a8);background:var(--field,#fff);color:inherit;cursor:pointer';
  const mk = (text, act, fn, { on = false, disabled = false, title = '' } = {}) => {
    const b = el('button', btnCss + (on ? ';background:var(--btn-on,#e2e0da);border-width:2px' : '') + (disabled ? ';opacity:.45;cursor:default' : ''), { type: 'button', 'data-act': act });
    b.textContent = text; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.disabled = disabled; if (on) b.setAttribute('aria-pressed', 'true'); b.addEventListener('click', fn); return b;
  };
  const row = (css = '') => el('div', `display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center;${css}`);
  const lab = (text) => { const s = el('span', 'font-size:12px;min-width:5.5em'); s.textContent = text; return s; };
  const stepper = (value, set, min, max, act) => {
    const wrap = el('span', 'display:inline-flex;align-items:center;gap:4px');
    const num = el('span', 'min-width:2.6em;text-align:center'); num.textContent = String(value);
    wrap.append(mk('−', `${act}-less`, () => { set(Math.max(min, value - 1)); draw(); }, { disabled: value <= min }), num, mk('+', `${act}-more`, () => { set(Math.min(max, value + 1)); draw(); }, { disabled: value >= max }));
    return wrap;
  };

  function draw() {
    const ids = idsOf();
    state.measure = Math.min(state.measure, ids.length - 1);
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = entry ? label('partText.titleEdit') : label('partText.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('partText.hint');

    const text = el('input', 'min-height:var(--ui-target,30px);box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:inherit;flex:1;min-width:10em', { type: 'text', maxlength: '60', 'data-act': 'text', 'aria-label': label('partText.text'), placeholder: label('partText.text') });
    text.value = state.text;
    text.addEventListener('input', () => { state.text = text.value; });
    text.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(); });
    const textRow = row('gap:6px'); textRow.append(lab(label('partText.text')), text);

    const staffRow = row('gap:6px');
    staffRow.append(lab(label('partText.staff')), createChoiceMenu({ options: targets.map((t) => [t.id, t.name]), value: state.staff, label: label('partText.staff'), act: 'text-staff', follow: true, onPick: (v) => { state.staff = v; state.measure = 0; draw(); } }));

    const measureRow = row('gap:6px'); measureRow.append(lab(label('partText.measure')), stepper(state.measure + 1, (v) => { state.measure = v - 1; }, 1, ids.length, 'measure'));

    const styleRow = row('gap:4px'); styleRow.append(lab(label('partText.style')));
    for (const s of ['normal', 'italic', 'bold']) styleRow.append(mk(label(`partText.style.${s}`), `style-${s}`, () => { state.style = s; draw(); }, { on: state.style === s }));
    const placeRow = row('gap:4px'); placeRow.append(lab(label('partText.placement')));
    for (const p of ['above', 'below']) placeRow.append(mk(label(`partText.placement.${p}`), `place-${p}`, () => { state.placement = p; draw(); }, { on: state.placement === p }));

    const lineRow = row('gap:4px'); lineRow.append(lab(label('partText.line')));
    for (const l of [null, 'dashed', 'solid']) lineRow.append(mk(label(`partText.line.${l ?? 'none'}`), `line-${l ?? 'none'}`, () => { state.line = l; draw(); }, { on: state.line === l }));
    const nodes = [title, hint, textRow, staffRow, measureRow, styleRow, placeRow, lineRow];
    if (state.line) {
      const endRow = row('gap:6px');
      const maxSpan = Math.max(1, Math.min(64, ids.length - state.measure));
      state.span = Math.min(state.span, maxSpan);
      endRow.append(lab(label('partText.lineEnd')), mk(label('partText.lineSpan'), 'end-span', () => { state.toEnd = false; draw(); }, { on: !state.toEnd }), mk(label('partText.lineToEnd'), 'end-toend', () => { state.toEnd = true; draw(); }, { on: state.toEnd }));
      if (!state.toEnd) endRow.append(stepper(state.span, (v) => { state.span = v; }, 1, maxSpan, 'span'), (() => { const m = el('span', 'font-size:12px'); m.textContent = label('partText.measures'); return m; })());
      const hookRow = row('gap:6px'); hookRow.append(lab(label('partText.hook')), mk(state.hook ? label('partText.hookOn') : label('partText.hookOff'), 'hook', () => { state.hook = !state.hook; draw(); }, { on: state.hook }));
      nodes.push(endRow, hookRow);
    }
    const msg = el('div', 'min-height:1.3em;font-size:12px;color:var(--danger-ink,#b00020)', { role: 'status' }); msg.textContent = state.message;
    const actions = row('gap:6px;justify-content:flex-end');
    if (entry) actions.append(mk(label('partText.remove'), 'remove', () => { try { app.removePartStaffText(partId, entry.id); close(); } catch (e) { state.message = e?.message ?? String(e); draw(); } }));
    actions.append(mk(label('partText.cancel'), 'cancel', close), mk(entry ? label('partText.apply') : label('partText.add'), 'apply', apply, { on: true }));
    box.replaceChildren(...nodes, msg, actions);
    if (!entry && !state.text) queueMicrotask(() => text.focus());
  }

  function apply() {
    try {
      const spec = { staffId: state.staff, measureId: idsOf()[state.measure], text: state.text, style: state.style, placement: state.placement };
      if (state.line) Object.assign(spec, { line: state.line, hook: state.hook, ...(state.toEnd ? { toEnd: true } : { lineSpan: state.span }) });
      if (entry) app.updatePartStaffText(partId, entry.id, { ...spec, ...(state.line ? {} : { line: null }), ...(state.line && !state.toEnd ? { toEnd: false } : {}), ...(state.line && !state.hook ? { hook: false } : {}) });
      else app.addPartStaffText(partId, spec);
      close();
    } catch (e) { state.message = e?.message ?? String(e); draw(); }
  }
  draw();
  return { close };
}
