/*
 * Drag-to-scroll with the mouse for the scrolling view (a finger already scrolls natively): press on the score, drag sideways, the score follows.
 * A real click (no movement) still selects; a drag that scrolled never reaches the score's own handlers (no selection is made or cleared by it).
 * Never starts on a handle, a bar or a field.
 */
const KEEP = '[data-range-layer],[data-grip-layer],[data-move-layer],[data-automation-layer],[data-blocks-layer],[data-automation-bar],[data-context-bar],[data-track-controls],[data-tab-entry-bar],[data-seq-entry-bar],[data-accordion-entry-bar],[data-lyrics-panel],button,input,textarea,select';
const THRESHOLD = 6;

export function installPanScroll(scroller, { enabled = () => true } = {}) {
  let start = null;
  let panning = false;
  const down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !enabled()) return;
    if (e.target instanceof Element && e.target.closest(KEEP)) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    start = { x: e.clientX, left: scroller.scrollLeft };
    panning = false;
  };
  const move = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (!panning && Math.abs(dx) < THRESHOLD) return;
    panning = true;
    scroller.scrollLeft = start.left - dx;
    scroller.style.cursor = 'grabbing';
    e.preventDefault();
  };
  const up = (e) => {
    const was = panning;
    start = null; panning = false;
    scroller.style.cursor = '';
    if (was) { e.stopImmediatePropagation(); e.stopPropagation(); } // the drag is a scroll, not a click
  };
  scroller.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  scroller.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', () => { start = null; panning = false; scroller.style.cursor = ''; }, true);
  return { destroy() { scroller.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); scroller.removeEventListener('pointerup', up, true); } };
}
