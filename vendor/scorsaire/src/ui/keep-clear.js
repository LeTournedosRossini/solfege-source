/*
 * Floating edit windows must not hide what they edit. `clearOf` (PURE) moves a window that overlaps the thing being edited to the side of it that has room
 * (below, else above; if neither is tall enough the larger side, and the window gets a maximum height so it scrolls); `keepClear` (DOM) applies it to a fixed
 * panel on open, on scroll / resize and when the panel changes size. The anchor is the union of every drawn element that belongs to the edited thing
 * (the diagram, its chord symbol, the frame of its container…), in client pixels.
 */

/**
 * @param box     { x, y, w, h } the window as it stands
 * @param anchor  { x1, y1, x2, y2 } what must stay visible
 * @param visible { left, top, right, bottom } the usable area (window minus fixed bars)
 * @returns null (no overlap: leave it) | { y, maxH? }
 */
export function clearOf({ box, anchor, visible, gap = 8 }) {
  if (!anchor) return null;
  const overlaps = box.x < anchor.x2 && box.x + box.w > anchor.x1 && box.y < anchor.y2 && box.y + box.h > anchor.y1;
  if (!overlaps) return null;
  const below = visible.bottom - (anchor.y2 + gap);
  const above = anchor.y1 - gap - visible.top;
  if (box.h <= below) return { y: anchor.y2 + gap };
  if (box.h <= above) return { y: anchor.y1 - gap - box.h };
  if (below >= above) return { y: anchor.y2 + gap, maxH: Math.max(120, below) };
  return { y: visible.top, maxH: Math.max(120, above) };
}

/** Union of the client rectangles of the drawn elements that carry one of `ids` (`data-ref` / `data-sel`), plus extra rectangles. */
export function anchorOfRefs(ids, extra = []) {
  const rects = [...extra];
  for (const id of ids) {
    const sel = `[data-ref="${window.CSS.escape(id)}"], [data-sel="${window.CSS.escape(id)}"]`;
    for (const node of document.querySelectorAll(sel)) {
      if (node.closest('[data-zoom-lock]')) continue; // an element drawn inside a floating panel (a preview) is not the score
      const r = node.getBoundingClientRect();
      if (r.width || r.height) rects.push({ x1: r.left, y1: r.top, x2: r.right, y2: r.bottom });
    }
  }
  if (!rects.length) return null;
  return { x1: Math.min(...rects.map((r) => r.x1)), y1: Math.min(...rects.map((r) => r.y1)), x2: Math.max(...rects.map((r) => r.x2)), y2: Math.max(...rects.map((r) => r.y2)) };
}

/** Keeps a fixed panel clear of `getAnchor()` (client rect or null). Returns { apply, destroy }. */
export function keepClear(panel, getAnchor, { gap = 8 } = {}) {
  // What the host set (its own placement, which it may redo at any time) is the base; what this function sets is `mine`. The base is read again whenever the
  // inline position is not exactly what this function left, so a host that places its window after the keeper was created (the chord entry window) is never undone.
  let mine = null; let base = { top: panel.style.top, bottom: panel.style.bottom, maxHeight: panel.style.maxHeight };
  const apply = () => {
    if (!panel.isConnected || panel.style.display === 'none') return;
    const cur = { top: panel.style.top, bottom: panel.style.bottom, maxHeight: panel.style.maxHeight };
    if (!mine || cur.top !== mine.top || cur.bottom !== mine.bottom || cur.maxHeight !== mine.maxHeight) base = cur;
    mine = null;
    panel.style.top = base.top; panel.style.bottom = base.bottom; panel.style.maxHeight = base.maxHeight;
    const anchor = getAnchor();
    if (!anchor) return;
    const vv = window.visualViewport;
    const dock = document.querySelector('[data-dock]')?.getBoundingClientRect();
    const visible = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth), bottom: Math.min((vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight), dock?.height ? dock.top : Infinity) };
    const r = panel.getBoundingClientRect();
    const out = clearOf({ box: { x: r.left, y: r.top, w: r.width, h: r.height }, anchor, visible, gap });
    if (!out) return;
    panel.style.top = `${out.y}px`; panel.style.bottom = 'auto';
    if (out.maxH) panel.style.maxHeight = `${out.maxH}px`;
    mine = { top: panel.style.top, bottom: panel.style.bottom, maxHeight: panel.style.maxHeight };
  };
  const again = () => apply();
  window.addEventListener('scroll', again, true); window.addEventListener('resize', again);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(again) : null;
  ro?.observe(panel);
  return { apply, destroy() { window.removeEventListener('scroll', again, true); window.removeEventListener('resize', again); ro?.disconnect(); } };
}

/** Once, right now, for a window that positions itself (`place()`): moves it off `anchor` if it covers it. */
export function clearNow(panel, anchor, { gap = 8 } = {}) {
  if (!panel?.isConnected || !anchor) return;
  const vv = window.visualViewport;
  const dock = document.querySelector('[data-dock]')?.getBoundingClientRect();
  const visible = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth), bottom: Math.min((vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight), dock?.height ? dock.top : Infinity) };
  const r = panel.getBoundingClientRect();
  const out = clearOf({ box: { x: r.left, y: r.top, w: r.width, h: r.height }, anchor, visible, gap });
  if (!out) return;
  panel.style.top = `${out.y}px`; panel.style.bottom = 'auto';
  if (out.maxH) panel.style.maxHeight = `${out.maxH}px`;
}
