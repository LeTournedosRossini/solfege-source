/*
 * A small « busy » indicator (a ring and a text) for work that takes a while on the main thread, such as the layout of several parts before printing.
 * `showBusy(text)` returns { update(text), close() }. The browser only paints between two tasks, so the caller yields (`nextPaint()`) after showing it and
 * between two heavy steps.
 */
const STYLE_ID = 'busy-style';

export function showBusy(text) {
  if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = '@keyframes scorsaire-spin { to { transform: rotate(360deg); } }'; document.head.append(st); }
  const box = document.createElement('div');
  box.setAttribute('data-busy', ''); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  box.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:4000;display:flex;align-items:center;gap:12px;padding:14px 20px;background:var(--paper,#fff);color:var(--ink,#222);border:1px solid var(--edge,#bbb);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:15px var(--ui-font,sans-serif)';
  const ring = document.createElement('span');
  ring.style.cssText = 'width:22px;height:22px;border-radius:50%;border:3px solid var(--edge,#cfc8b8);border-top-color:var(--info-ink,#2b6cff);animation:scorsaire-spin .8s linear infinite;flex:none';
  const label = document.createElement('span'); label.textContent = text;
  box.append(ring, label); document.body.append(box);
  return { update(next) { label.textContent = next; }, close() { box.remove(); } };
}

/** Resolves after the browser has had the chance to paint (two frames; a timer as a fallback when the page is hidden). */
export const nextPaint = () => new Promise((resolve) => {
  let done = false; const go = () => { if (!done) { done = true; resolve(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 80);
});
