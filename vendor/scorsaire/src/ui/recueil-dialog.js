/*
 * The RECUEIL window (songbook / setlist, model/recueil.js): the list of the works of a recueil, to put them in order, take some out, add the open work or files, change the
 * reading adjustments of each (transposition, zoom), open one in the editor or replace it by the work that is open, then write the recueil file the Lecteur reads.
 * The recueil lives in `state` (memory of the page, shared with the file menu): closing the window keeps it, so that a work opened for editing can be put back in its place.
 *   state    { recueil | null, name | null, dirty }   (read and written here; `onChange` tells the page)
 *   actions  { openRecueil(), addFiles(), addCurrent(), replaceWith(entryId), openEntry(entry), save(recueil), currentTitle() }   each returns a Promise (the page asks / reads files)
 */
import { createRecueil, moveEntry, moveEntryNear, removeEntry, setEntrySettings, setEntryTitle, renameRecueil, entryTitle, TRANSPOSE_MIN, TRANSPOSE_MAX, ZOOM_MIN, ZOOM_MAX } from '../model/recueil.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

export function openRecueilDialog({ state, actions, label, onChange = () => {} }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let message = '';
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-recueil-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(720px,100%);max-height:${sheet ? '88vh' : '86vh'};overflow:auto;display:flex;flex-direction:column;gap:8px;${sheet ? 'border-radius:14px 14px 0 0' : 'border-radius:10px'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('recueil.title') });
  if (!sheet) box.setAttribute('data-resizable', 'recueil');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const set = (recueil) => { state.recueil = recueil; state.dirty = true; onChange(); draw(); };
  const attempt = async (fn) => { try { message = (await fn()) ?? ''; } catch (e) { message = e?.message ?? String(e); } draw(); };

  const mk = (text, act, fn, { primary = false, disabled = false, title = null } = {}) => {
    const b = el('button', `min-height:var(--ui-target,34px);min-width:30px;padding:0 10px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.disabled = disabled; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.addEventListener('click', fn); return b;
  };
  const stepper = (text, value, onMinus, onPlus, act) => {
    const w = el('span', 'display:inline-flex;align-items:center;gap:2px;font-size:12px', { 'data-stepper': act });
    const v = el('span', 'min-width:3.2em;text-align:center;font-variant-numeric:tabular-nums'); v.textContent = value;
    w.append(Object.assign(document.createTextNode(`${text} `)), mk('−', `${act}-minus`, onMinus), v, mk('+', `${act}-plus`, onPlus));
    return w;
  };

  // Drag and drop by the handle (the arrows stay as the sure way): the row follows the pointer, a line shows where it lands, the window scrolls near its edges.
  let drag = null;
  const rowsOf = () => [...box.querySelectorAll('[data-recueil-list] > [data-entry]')];
  const markDrop = (drop) => { for (const r of rowsOf()) { r.style.boxShadow = ''; } if (drop) drop.row.style.boxShadow = `inset 0 ${drop.before ? '' : '-'}3px 0 var(--sel-edge,#2d78ff)`; };
  const startDrag = (ev, entryId, row) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    const handle = ev.currentTarget;
    drag = { entryId, row, handle, x: ev.clientX, y: ev.clientY, py: ev.clientY, drop: null, frame: 0 };
    try { handle.setPointerCapture(ev.pointerId); } catch { /* the move still reaches the handle */ }
    row.style.position = 'relative'; row.style.zIndex = '5'; row.style.boxShadow = '0 8px 22px rgba(0,0,0,.35)';
    const tick = () => { if (!drag) return; const b = box.getBoundingClientRect(); if (drag.py < b.top + 48) box.scrollTop -= 10; else if (drag.py > b.bottom - 48) box.scrollTop += 10; drag.frame = requestAnimationFrame(tick); };
    drag.frame = requestAnimationFrame(tick);
    const move = (e) => {
      if (!drag) return;
      drag.py = e.clientY;
      row.style.transform = `translate(${e.clientX - drag.x}px,${e.clientY - drag.y}px)`;
      drag.drop = null;
      for (const r of rowsOf()) {
        if (r === row) continue;
        const b = r.getBoundingClientRect();
        if (e.clientY >= b.top && e.clientY <= b.bottom) { drag.drop = { row: r, before: e.clientY - b.top < b.height / 2 }; break; }
      }
      markDrop(drag.drop);
    };
    const end = (e) => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
      cancelAnimationFrame(drag.frame);
      const d = drag; drag = null;
      row.style.transform = ''; row.style.zIndex = ''; row.style.boxShadow = ''; markDrop(null);
      if (e.type === 'pointerup' && d.drop && state.recueil) set(moveEntryNear(state.recueil, d.entryId, d.drop.row.dataset.entry, d.drop.before));
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };

  function draw() {
    const r = state.recueil;
    const head = el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center');
    const title = el('input', 'flex:1 1 220px;min-height:var(--ui-target,34px);font:var(--w-semi,600) 15px var(--ui-font,sans-serif);padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit', { type: 'text', 'data-recueil-title': '', placeholder: label('recueil.titlePlaceholder'), 'aria-label': label('recueil.titleLabel') });
    title.value = r?.title ?? ''; title.disabled = !r;
    title.addEventListener('change', () => { if (state.recueil) { state.recueil = renameRecueil(state.recueil, title.value.trim()); state.dirty = true; onChange(); } });
    head.append(title,
      mk(label('recueil.new'), 'recueil-new', () => { state.recueil = createRecueil({ title: '' }); state.name = null; state.dirty = false; message = ''; onChange(); draw(); }),
      mk(label('recueil.open'), 'recueil-open', () => attempt(() => actions.openRecueil())),
      mk(label('recueil.save'), 'recueil-save', () => attempt(() => actions.save(state.recueil)), { primary: true, disabled: !r || !r.entries.length }));

    const list = el('div', 'display:flex;flex-direction:column;gap:6px', { 'data-recueil-list': '' });
    if (!r) list.append(Object.assign(el('div', 'padding:14px;color:var(--ink-soft,#555);text-align:center'), { textContent: label('recueil.none') }));
    else if (!r.entries.length) list.append(Object.assign(el('div', 'padding:14px;color:var(--ink-soft,#555);text-align:center'), { textContent: label('recueil.empty') }));
    r?.entries.forEach((e, i) => {
      const row = el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--edge,#bbb);border-radius:8px;padding:6px;background:var(--module,#fff)', { 'data-entry': e.id });
      const n = el('span', 'min-width:1.6em;font-variant-numeric:tabular-nums;color:var(--ink-soft,#555)'); n.textContent = String(i + 1);
      const name = el('input', 'flex:1 1 150px;min-width:0;min-height:var(--ui-target,34px);padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:6px;background:var(--field,#fff);color:inherit;font:14px var(--ui-font,sans-serif)', { type: 'text', 'data-entry-title': '', 'aria-label': label('recueil.entryTitle') });
      name.value = e.title || ''; name.placeholder = entryTitle({ ...e, title: '' }, i);
      name.addEventListener('change', () => set(setEntryTitle(state.recueil, e.id, name.value.trim())));
      const t = e.settings?.transpose ?? 0; const z = e.settings?.zoom ?? 1;
      const handle = el('span', `padding:0 8px;min-height:var(--ui-target,34px);display:inline-flex;align-items:center;font-size:20px;line-height:1;touch-action:none;user-select:none;-webkit-user-select:none;cursor:${r.entries.length > 1 ? 'grab' : 'default'};opacity:${r.entries.length > 1 ? 1 : .3}`, { 'data-act': 'entry-handle', title: label('recueil.handle'), 'aria-hidden': 'true' });
      handle.textContent = '⠿';
      if (r.entries.length > 1) handle.addEventListener('pointerdown', (ev) => startDrag(ev, e.id, row));
      row.append(n, handle, name,
        mk('▲', 'entry-up', () => set(moveEntry(state.recueil, e.id, i - 1)), { disabled: i === 0, title: label('recueil.up') }),
        mk('▼', 'entry-down', () => set(moveEntry(state.recueil, e.id, i + 1)), { disabled: i === r.entries.length - 1, title: label('recueil.down') }),
        mk('✕', 'entry-remove', () => set(removeEntry(state.recueil, e.id)), { title: label('recueil.remove') }),
        stepper(label('recueil.transpose'), `${t > 0 ? '+' : ''}${t}`, () => set(setEntrySettings(state.recueil, e.id, { transpose: Math.max(TRANSPOSE_MIN, t - 1) === 0 ? null : Math.max(TRANSPOSE_MIN, t - 1) })), () => set(setEntrySettings(state.recueil, e.id, { transpose: Math.min(TRANSPOSE_MAX, t + 1) === 0 ? null : Math.min(TRANSPOSE_MAX, t + 1) })), 'entry-transpose'),
        stepper(label('recueil.zoom'), `${Math.round(z * 100)} %`, () => set(setEntrySettings(state.recueil, e.id, { zoom: Math.max(ZOOM_MIN, Math.round((z - 0.1) * 10) / 10) === 1 ? null : Math.max(ZOOM_MIN, Math.round((z - 0.1) * 10) / 10) })), () => set(setEntrySettings(state.recueil, e.id, { zoom: Math.min(ZOOM_MAX, Math.round((z + 0.1) * 10) / 10) === 1 ? null : Math.min(ZOOM_MAX, Math.round((z + 0.1) * 10) / 10) })), 'entry-zoom'),
        mk(label('recueil.openEntry'), 'entry-open', () => attempt(async () => { const ok = await actions.openEntry(e); if (ok) { close(); return ''; } return ''; })),
        mk(label('recueil.replace'), 'entry-replace', () => attempt(() => actions.replaceWith(e.id)), { title: label('recueil.replaceHint') }));
      list.append(row);
    });

    const foot = el('div', 'display:flex;flex-wrap:wrap;gap:6px;align-items:center');
    foot.append(
      mk(label('recueil.addCurrent'), 'recueil-add-current', () => attempt(() => actions.addCurrent()), { disabled: !r }),
      mk(label('recueil.addFiles'), 'recueil-add-files', () => attempt(() => actions.addFiles())),
      el('span', 'flex:1'),
      mk(label('strum.bake.close'), 'recueil-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-recueil-message': '' });
    status.textContent = message || (r ? label('recueil.count', { n: r.entries.length }) : '');
    const heading = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); heading.textContent = label('recueil.title');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('recueil.hint');
    box.replaceChildren(heading, hint, head, list, foot, status);
  }

  document.body.append(veil);
  draw();
  return { close, refresh: draw };
}
