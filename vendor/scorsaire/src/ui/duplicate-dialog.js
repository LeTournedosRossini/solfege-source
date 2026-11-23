/*
 * « Duplicate N times »: a small window opened by a long press on the duplicate button. A stepper (− n +) chooses how many copies follow the chosen measures; « Duplicate » makes them in ONE
 * undo step. `onApply(n)` runs the duplication. The last number is kept for the next time (this device).
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const KEY = 'scorsaire.duplicateCount';
export const DUPLICATE_MAX = 32;

export function openDuplicateDialog({ label, onApply }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let n = 2; try { const v = Number(window.localStorage.getItem(KEY)); if (Number.isInteger(v) && v >= 1 && v <= DUPLICATE_MAX) n = v; } catch { /* no storage */ }
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-duplicate-dialog': '' });
  const box = el('div', `background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(360px,100%);display:flex;flex-direction:column;gap:10px;border-radius:${sheet ? '12px 12px 0 0' : '8px'}`);
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);
  const btnCss = 'min-height:var(--ui-target,40px);min-width:var(--ui-target,40px);padding:0 12px;border-radius:6px;font:var(--w-semi,600) 15px var(--ui-font,sans-serif)';
  const mk = (text, act, fn, primary = false) => { const b = el('button', `${btnCss}${primary ? ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : ''}`, { type: 'button', 'data-act': act }); b.textContent = text; b.addEventListener('click', fn); return b; };
  const title = el('div', 'font-weight:var(--w-semi,600);font-size:16px'); title.textContent = label('duplicate.title');
  const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('duplicate.hint');
  const value = el('output', 'min-width:3em;text-align:center;font:var(--w-bold,700) 20px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums', { 'data-duplicate-count': '' });
  const row = el('div', 'display:flex;align-items:center;justify-content:center;gap:10px');
  const minus = mk('−', 'duplicate-minus', () => { n = Math.max(1, n - 1); paint(); });
  const plus = mk('+', 'duplicate-plus', () => { n = Math.min(DUPLICATE_MAX, n + 1); paint(); });
  const apply = mk('', 'duplicate-apply', () => { try { window.localStorage.setItem(KEY, String(n)); } catch { /* kept for this window */ } close(); onApply(n); }, true);
  const paint = () => { value.textContent = String(n); apply.textContent = label('duplicate.apply', { n }); minus.disabled = n <= 1; plus.disabled = n >= DUPLICATE_MAX; };
  row.append(el('span', '', {}), minus, value, plus);
  row.firstChild.textContent = label('duplicate.copies');
  const foot = el('div', 'display:flex;gap:6px;justify-content:flex-end');
  foot.append(mk(label('dialog.cancel'), 'duplicate-cancel', close), apply);
  box.append(title, hint, row, foot);
  paint();
  document.body.append(veil);
  apply.focus({ preventScroll: true });
  return { close };
}
