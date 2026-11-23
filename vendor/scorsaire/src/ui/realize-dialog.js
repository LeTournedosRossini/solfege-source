/*
 * "Write as real tracks": what the accompaniment tracks of a movement play (an automatic player, no written notes) is written out as tracks with notes you can edit. You choose the tracks, the part of
 * the piece (all of it, or the selected measures) and whether the accompaniment tracks are removed afterwards (by default they stay, switched off and grey, so you can compare or go back).
 */
import { createSwitch } from './switch.js';
import { createChoiceMenu } from './choice-menu.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function openRealizeDialog({ app, label, movement = 0 }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  const tracks = (app.tracksOutline()[movement]?.tracks ?? []).filter((t) => t.accompaniment);
  const picked = new Set(tracks.map((t) => t.id));
  let scope = 'all'; let removeAfter = false; let message = ''; const targets = {}; // accompaniment track id → id of the track of yours to write into (none = a new track)
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-realize-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(560px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('accompaniment.realize') });
  if (!sheet) box.setAttribute('data-resizable', 'realize');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  const mk = (text, act, fn, { primary = false, on = false, disabled = false } = {}) => {
    const b = el('button', `min-height:30px;padding:0 12px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);${primary || on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = text; b.disabled = disabled; b.addEventListener('click', fn); return b;
  };
  const row = () => el('div', 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);align-items:center');

  function draw() {
    const selection = app.bakeMeasures();
    if (scope === 'selection' && !selection) scope = 'all';
    const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('accompaniment.realize');
    const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('accompaniment.realizeHint');
    const list = el('div', 'display:flex;flex-direction:column;gap:2px;border:1px solid var(--edge,#bbb);border-radius:6px;padding:6px');
    for (const t of tracks) {
      const line = row();
      line.append(createSwitch({ checked: picked.has(t.id), text: t.name || t.id, attrs: { 'data-realize-track': t.id }, onchange: (e) => { if (e.target.checked) picked.add(t.id); else picked.delete(t.id); draw(); } }));
      // where it is written: a new track, or one of your empty tracks (a guitar, a bass, a drum kit kept for writing)
      const mine = app.realizeTargets(t.id);
      if (targets[t.id] && !mine.some((m) => m.id === targets[t.id])) delete targets[t.id];
      line.append(createChoiceMenu({ options: [['', label('accompaniment.toNew')], ...mine.map((m) => [m.id, label('accompaniment.toTrack', { name: m.name || m.id })])], value: targets[t.id] ?? '', label: label('accompaniment.destination'), act: `realize-target-${t.id}`, follow: true, onPick: (v) => { if (v) targets[t.id] = v; else delete targets[t.id]; } }));
      list.append(line);
    }
    const scopeRow = row();
    scopeRow.append(mk(label('accompaniment.scopeAll'), 'realize-all', () => { scope = 'all'; draw(); }, { on: scope === 'all' }),
      mk(selection ? label('accompaniment.scopeSelection', { from: selection.from + 1, to: selection.to + 1 }) : label('accompaniment.scopeSelectionNone'), 'realize-selection', () => { scope = 'selection'; draw(); }, { on: scope === 'selection', disabled: !selection }));
    const removeRow = row();
    removeRow.append(createSwitch({ checked: removeAfter, text: label('accompaniment.removeAfter'), attrs: { 'data-realize-remove': '' }, onchange: (e) => { removeAfter = e.target.checked; draw(); } }));
    const actions = row();
    actions.append(mk(label('accompaniment.write'), 'realize-write', () => {
      try {
        const r = app.realizeAccompaniment({ movement, trackIds: [...picked], measures: scope === 'selection' ? selection : null, removeAfter, targets });
        message = label('accompaniment.written', { n: r.written.length, failed: r.failed.length });
        if (r.written.length) { setTimeout(close, 0); return; }
      } catch (e) { message = e.message; }
      draw();
    }, { primary: true, disabled: !picked.size }), mk(label('strum.bake.close'), 'realize-close', close));
    const status = el('div', 'min-height:1.2em;font-size:13px', { role: 'status', 'data-realize-message': '' }); status.textContent = message;
    box.replaceChildren(title, hint, list, scopeRow, removeRow, actions, status);
  }
  document.body.append(veil);
  draw();
  return { close };
}
