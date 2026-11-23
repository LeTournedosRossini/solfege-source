/*
 * Confirmation of a staff type change (DOM): lists what the conversion loses and asks the choices the model needs.
 * A centred dialog on desktop, a sheet from the bottom on phones and tablets; in <body>, so the score never moves; `aria-modal`
 * keeps the note-entry shortcuts away. Calls `onConfirm(options)` with { outOfRange?, unmapped? } or `onCancel()`.
 */
import { SHEET_QUERY } from './panel-mode.js';

const STYLE_ID = 'stafftype-dialog-style';
const CSS = `
[data-staff-type-dialog] { position: fixed; z-index: 1000; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 20px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: 10px; --sd-target: var(--ui-target, 30px); }
[data-staff-type-dialog][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 80vh; overflow: auto; border-radius: 12px 12px 0 0; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
[data-staff-type-dialog][data-mode="floating"] { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 460px; max-width: calc(100vw - 16px); max-height: calc(100vh - 32px); overflow: auto; border-radius: 8px; }
[data-staff-type-dialog] h2 { margin: 0; font-size: 15px; }
[data-staff-type-dialog] ul { margin: 0; padding-left: 18px; }
[data-staff-type-dialog] label { display: flex; align-items: center; gap: 8px; min-height: var(--sd-target); }
[data-staff-type-dialog] .sd-actions { display: flex; gap: var(--btn-gap, 2px); justify-content: flex-end; }
[data-staff-type-dialog] button { min-width: var(--sd-target); min-height: var(--sd-target); padding: 0 14px; font: inherit; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
};

/** `plan` comes from `app.planStaffType`; `label(key, params)` resolves a text. Returns { close() }. */
import { dismissOnOutside } from './outside-dismiss.js';

export function openStaffTypeDialog({ plan, label, fromLabel, toLabel, onConfirm, onCancel }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let choice = 'nearest';
  const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false;
  const lines = plan.confirm.filter((c) => c !== 'outOfRange').map((c) => el('li', { 'data-warning': c }, label(`tracks.convert.${c}`, { n: c === 'unmapped' ? plan.unmapped : plan.chordsCollapsed ?? plan.chords })));
  const range = plan.outOfRange ? [
    el('div', { 'data-warning': 'outOfRange' }, label('tracks.convert.outOfRange', { n: plan.outOfRange })),
    ...['nearest', 'remove'].map((v) => el('label', {}, el('input', { type: 'radio', name: 'staff-type-range', value: v, checked: v === choice, onchange: () => { choice = v; } }), label(`tracks.convert.${v}`))),
  ] : [];
  const keyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancel(); } };
  let offOutside = null;
  function close() { offOutside?.(); window.removeEventListener('keydown', keyHandler, true); dialog.remove(); }
  function cancel() { close(); onCancel?.(); }
  const go = () => {
    close();
    const options = {};
    if (plan.outOfRange) options.outOfRange = choice;
    if (plan.unmapped) options.unmapped = 'remove';
    onConfirm(options);
  };
  const dialog = el('div', { 'data-staff-type-dialog': '', 'data-resizable': 'staffTypeDialog', 'data-zoom-lock': '', 'data-mode': sheet ? 'sheet' : 'floating', role: 'dialog', 'aria-modal': 'true', 'aria-label': label('tracks.convert.title', { from: fromLabel, to: toLabel }) },
    el('h2', {}, label('tracks.convert.title', { from: fromLabel, to: toLabel })),
    lines.length ? el('ul', {}, lines) : null,
    ...range,
    el('div', { class: 'sd-actions' },
      el('button', { type: 'button', 'data-act': 'convert-cancel', onclick: cancel }, label('tracks.convert.cancel')),
      el('button', { type: 'button', 'data-act': 'convert-go', onclick: go }, label('tracks.convert.go'))));
  window.addEventListener('keydown', keyHandler, true);
  document.body.append(dialog);
  offOutside = dismissOnOutside(() => dialog, cancel); // pressing outside = cancel (nothing is changed)
  dialog.querySelector('[data-act="convert-go"]').focus({ preventScroll: true });
  return { close };
}
