/*
 * A one-line text question (DOM): `askText({ title, help, placeholder, label })` resolves to the text typed, or null (cancel, Escape, tap on the veil).
 * Bottom sheet on phones / tablets, centred window on a computer. Writes nothing.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function askText({ title, help = '', placeholder = '', value = '', label = (k) => k } = {}) {
  return new Promise((resolve) => {
    const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
    const veil = document.createElement('div');
    veil.setAttribute('data-text-dialog', ''); veil.setAttribute('data-zoom-lock', '');
    veil.style.cssText = `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`;
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
    box.style.cssText = `background:var(--paper,#fff);color:var(--ink,#111);padding:16px;font:15px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;${sheet ? 'width:100%;border-radius:12px 12px 0 0' : 'max-width:92vw;width:480px;border-radius:10px'}`;
    const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font-weight:var(--w-bold,700);margin-bottom:6px';
    const p = document.createElement('div'); p.textContent = help; p.style.cssText = 'font-size:13px;color:var(--ink-soft,#555);margin-bottom:10px;line-height:1.35';
    const input = document.createElement('input'); input.type = 'text'; input.value = value; input.placeholder = placeholder; input.setAttribute('aria-label', title);
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:var(--ui-target,44px);padding:0 10px;font:16px var(--ui-font,sans-serif);border:1px solid var(--edge,#888);border-radius:6px';
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:var(--btn-gap,2px);justify-content:flex-end;margin-top:14px';
    const mk = (text, act, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('data-act', act); b.style.cssText = 'min-height:var(--ui-target,44px);padding:0 16px;font:var(--w-semi,600) 14px sans-serif;border:1px solid #888;border-radius:6px;cursor:pointer'; b.addEventListener('click', fn); return b; };
    let done = false;
    const finish = (v) => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } else if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); finish(input.value.trim() || null); } };
    const ok = mk(label('dialog.ok'), 'ok', () => finish(input.value.trim() || null)); ok.style.background = 'var(--btn-on,#d6e6ff)';
    bar.append(mk(label('dialog.cancel'), 'cancel', () => finish(null)), ok);
    box.append(h, p, input, bar); veil.append(box);
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) finish(null); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(veil); input.focus({ preventScroll: true });
  });
}
