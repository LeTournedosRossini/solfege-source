/*
 * Resizable editing windows. A panel opts in with `data-resizable="<name>"`; a grip appears in its bottom-right corner (on a phone or tablet, where the panel is a
 * sheet at the bottom of the screen, at the top edge: it only changes the height). Dragging the grip sets the width and height of the window; the size is remembered
 * for the next time the same kind of window opens (this session, and this device through localStorage).
 *
 * Whatever the window did to place itself (a corner, the centre of the screen, a transform…) the first drag pins it where it is (`left` / `top` in pixels), so
 * the corner follows the pointer; the panel is told through a `panelmoved` event ({ left, top } in `detail`) so that a window that remembers where the user put it
 * keeps that place when it redraws. The window never grows past the edge of the screen.
 */
const STYLE_ID = 'panel-resize-style';
const CSS = `
[data-resize-grip] { position: absolute; right: 0; bottom: 0; width: 28px; height: 28px; cursor: nwse-resize; touch-action: none; z-index: 5; opacity: .55; }
[data-resize-grip]:hover, [data-resize-grip][data-active] { opacity: 1; }
[data-resize-grip]::before { content: ''; position: absolute; right: 5px; bottom: 5px; width: 14px; height: 14px; background: linear-gradient(135deg, transparent 0 45%, currentColor 45% 52%, transparent 52% 66%, currentColor 66% 73%, transparent 73%); }
[data-mode="sheet"] > [data-resize-grip] { top: 0; bottom: auto; right: calc(50% - 30px); width: 60px; height: 20px; cursor: ns-resize; }
[data-mode="sheet"] > [data-resize-grip]::before { right: 14px; bottom: 6px; width: 32px; height: 5px; border-radius: 3px; background: currentColor; }
`;
const MIN_W = 300; const MIN_H = 180; const EDGE = 6;
const STORAGE = 'scorsaire.panelSizes';

const remembered = new Map();
try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(STORAGE) ?? '{}'))) if (v && v.w > 0 && v.h > 0) remembered.set(k, v); } catch { /* no storage */ }
const remember = (key, w, h) => { remembered.set(key, { w, h }); try { localStorage.setItem(STORAGE, JSON.stringify(Object.fromEntries(remembered))); } catch { /* no storage */ } };

const tell = (panel) => { const r = panel.getBoundingClientRect(); panel.dispatchEvent(new CustomEvent('panelmoved', { detail: { left: r.left, top: r.top } })); };

/** Pins the window where it is: pixels for left / top, no transform, no bottom, no margin, so that its size can change from the corner. */
function pin(panel) {
  const r = panel.getBoundingClientRect();
  Object.assign(panel.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, right: 'auto', bottom: 'auto', transform: 'none', margin: '0', maxWidth: 'none', maxHeight: 'none' });
  return r;
}

function attach(panel) {
  if (panel.__resizable || !panel.isConnected) return; // (a window redrawn again before the watcher saw it is already gone: nothing to equip)
  panel.__resizable = true;
  const key = panel.getAttribute('data-resizable') || 'panel';
  if (getComputedStyle(panel).position === 'static') panel.style.position = 'relative'; // the grip is absolute: without a positioned panel it would sit in the corner of the page
  const grip = document.createElement('div');
  grip.setAttribute('data-resize-grip', '');
  grip.setAttribute('aria-hidden', 'true');
  // a window that redraws itself with `replaceChildren` loses the grip: it comes back. Never on a window that has left the page: appending to it
  // would fire this observer again, and the grip (not connected either) would be appended again, for ever (the page froze)
  const keep = () => { if (panel.isConnected && !grip.isConnected) panel.append(grip); };
  new MutationObserver(keep).observe(panel, { childList: true });
  keep();
  const saved = remembered.get(key);
  if (saved && panel.getAttribute('data-mode') !== 'sheet') {
    const r = pin(panel);
    const w = Math.min(saved.w, window.innerWidth - 2 * EDGE); const h = Math.min(saved.h, window.innerHeight - 2 * EDGE);
    panel.style.width = `${w}px`; panel.style.height = `${h}px`;
    panel.style.left = `${Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE))}px`;
    panel.style.top = `${Math.max(EDGE, Math.min(r.top, window.innerHeight - h - EDGE))}px`;
    tell(panel);
  }
  grip.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sheet = panel.getAttribute('data-mode') === 'sheet';
    const start = sheet ? panel.getBoundingClientRect() : pin(panel);
    const x0 = e.clientX; const y0 = e.clientY;
    try { grip.setPointerCapture(e.pointerId); } catch { /* the move still reaches the grip */ }
    grip.setAttribute('data-active', '');
    const move = (ev) => {
      if (sheet) {
        const h = Math.max(MIN_H, Math.min(start.height - (ev.clientY - y0), window.innerHeight - 2 * EDGE));
        panel.style.maxHeight = 'none'; panel.style.height = `${h}px`;
        return;
      }
      const w = Math.max(MIN_W, Math.min(start.width + (ev.clientX - x0), window.innerWidth - start.left - EDGE));
      const h = Math.max(MIN_H, Math.min(start.height + (ev.clientY - y0), window.innerHeight - start.top - EDGE));
      panel.style.width = `${w}px`; panel.style.height = `${h}px`;
    };
    const stop = (ev) => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', stop); grip.removeEventListener('pointercancel', stop);
      grip.removeAttribute('data-active');
      const r = panel.getBoundingClientRect();
      if (!sheet) { remember(key, Math.round(r.width), Math.round(r.height)); tell(panel); }
      void ev;
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', stop); grip.addEventListener('pointercancel', stop);
  });
}

/** Watches the page: every element carrying `data-resizable` gets its grip as soon as it appears. Returns a function that stops watching. */
export function mountPanelResize(root = document.body) {
  if (!document.getElementById(STYLE_ID)) { const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.append(s); }
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches?.('[data-resizable]') && node.getAttribute('data-mode') !== 'docked') attach(node);
    for (const el of node.querySelectorAll?.('[data-resizable]') ?? []) if (el.getAttribute('data-mode') !== 'docked') attach(el);
  };
  scan(root);
  const mo = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) scan(n); });
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}
