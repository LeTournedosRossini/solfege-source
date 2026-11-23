/*
 * Room taken at the edges of the window by fixed side panels (the sidebar, the vertical note-entry rail). Each panel reserves its own width; the page margins
 * and the CSS variables `--sb-left` / `--sb-right` (read by the bottom dock, the floating bars…) are the SUM. A panel can ask what another reserves at its side,
 * to stand next to it instead of on top of it.
 */
const parts = new Map(); // name → { left, right }
const listeners = new Set();

export function setEdge(name, left, right) {
  parts.set(name, { left: left || 0, right: right || 0 });
  const sum = (k) => [...parts.values()].reduce((a, p) => a + p[k], 0);
  if (typeof document !== 'undefined') {
    const root = document.documentElement.style;
    root.setProperty('--sb-left', `${sum('left')}px`); root.setProperty('--sb-right', `${sum('right')}px`);
    document.body.style.marginLeft = sum('left') ? `${sum('left')}px` : ''; document.body.style.marginRight = sum('right') ? `${sum('right')}px` : '';
  }
  for (const fn of [...listeners]) fn();
}

/** What panel `name` reserves at `side` ('left' | 'right'). */
export function edgeOf(name, side) { return parts.get(name)?.[side] ?? 0; }
export function onEdgeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
