/*
 * Confirmation dialog replacing `window.confirm` (native dialogs are blocked in some tablet browsers and cannot be styled or tested).
 * `confirmDialog({ message, label, confirmText, cancelText, secondaryText })` resolves to true (continue) or false (cancel, Escape, tap on the veil);
 * with `secondaryText` a middle button is added (« Don't save ») and resolves to the string 'secondary'.
 * Bottom sheet on phones/tablets, centered window on desktop. Nothing is written to the Document.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

export function confirmDialog({ message, label = (k) => k, confirmText = null, cancelText = null, secondaryText = null } = {}) {
  return new Promise((resolve) => {
    const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
    const veil = document.createElement('div');
    veil.setAttribute('data-confirm-dialog', ''); veil.setAttribute('data-zoom-lock', '');
    veil.style.cssText = `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`;
    const box = document.createElement('div');
    box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', message);
    box.style.cssText = `background:var(--field,#fff);color:var(--ink,#111);padding:16px;font:15px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;${sheet ? 'width:100%;border-radius:12px 12px 0 0' : 'min-width:280px;max-width:min(440px,calc(100vw - 24px));border-radius:8px'}`;
    const text = document.createElement('div'); text.textContent = message; text.style.cssText = 'margin-bottom:14px;line-height:1.35';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:var(--btn-gap,2px);justify-content:flex-end;flex-wrap:wrap';
    const mk = (t, act, fn) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('data-act', act);
      b.style.cssText = 'min-height:var(--ui-target,44px);padding:0 16px;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);border:1px solid var(--edge,#888);border-radius:6px;background:var(--soft,#f4f4f4);cursor:pointer';
      b.addEventListener('click', fn); return b;
    };
    let done = false;
    const finish = (v) => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    const ok = mk(confirmText ?? label('dialog.continue'), 'confirm-ok', () => finish(true));
    ok.style.background = 'var(--accent-soft,#d6e6ff)'; ok.style.borderColor = 'var(--sel-edge,#2d78ff)';
    row.append(mk(cancelText ?? label('dialog.cancel'), 'confirm-cancel', () => finish(false)));
    if (secondaryText) row.append(mk(secondaryText, 'confirm-secondary', () => finish('secondary')));
    row.append(ok);
    box.append(text, row); veil.append(box);
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) finish(false); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(veil);
    ok.focus({ preventScroll: true });
  });
}
