/*
 * Floating panels keep their normal size when the user pinch-zooms on a tablet or a phone (decided with Jean, 15/10/2026). The score canvas
 * zooms; the panels stay as large on the SCREEN as they are without zoom, and follow the visible part of the page.
 *
 * Two kinds of element:
 *  - `[data-zoom-lock]`: `position: fixed` windows and sheets appended to <body> (tracks, settings, staff properties, bend graph, pickers…).
 *    Fixed elements are magnified with the page: we scale them by 1/s and move them so that they sit where they would sit without zoom
 *    relative to the VISIBLE viewport: x' = offsetLeft + x/s, y' = offsetTop + y/s (origin top-left).
 *  - `[data-zoom-lock-inline]`: bars placed inside the score area next to what they act on (context bar, entry bar for tablature…). They
 *    move with the canvas; they are only scaled by 1/s around their edge nearest to the anchor (`data-side` = above → bottom centre).
 *
 * Without pinch zoom (`visualViewport.scale` = 1, also on desktop where the browser zoom changes CSS pixels) nothing is touched.
 */
let installed = false;

export function installZoomLock() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  installed = true;
  const vv = window.visualViewport;
  let frame = 0;

  const clear = (el) => {
    if (el.hasAttribute('data-zl-applied')) {
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.removeAttribute('data-zl-applied');
    }
  };

  const apply = () => {
    frame = 0;
    const s = vv?.scale ?? 1;
    const fixed = document.querySelectorAll('[data-zoom-lock]');
    const inline = document.querySelectorAll('[data-zoom-lock-inline]');
    if (!vv || Math.abs(s - 1) < 0.01) {
      for (const el of fixed) clear(el);
      for (const el of inline) clear(el);
      return;
    }
    for (const el of fixed) {
      if (!el.isConnected) continue;
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) { clear(el); continue; }
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${vv.offsetLeft + r.left / s - r.left}px, ${vv.offsetTop + r.top / s - r.top}px) scale(${1 / s})`;
      el.setAttribute('data-zl-applied', '');
    }
    for (const el of inline) {
      if (getComputedStyle(el).display === 'none') { clear(el); continue; }
      el.style.transformOrigin = el.getAttribute('data-side') === 'below' ? '50% 0' : '50% 100%';
      el.style.transform = `scale(${1 / s})`;
      el.setAttribute('data-zl-applied', '');
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };

  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  // a panel that opens while zoomed is locked at once; its content changing size is followed by the next event
  const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
  observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-side', 'style', 'data-mode'] });
  schedule();
  return () => {
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    observer?.disconnect();
    installed = false;
  };
}
