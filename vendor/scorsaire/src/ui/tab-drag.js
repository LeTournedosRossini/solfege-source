/*
 * Drag-to-reorder for a row of tabs (views bar of screen 1, part tabs of screen 2). A mouse drags after 5 px; a finger after a 350 ms hold, so the row
 * can still be scrolled (a move before the hold is a scroll). A blue mark shows where the tab lands; the drop calls `onMove(id, index)` with the final
 * position among the draggable tabs. The click that follows a drag is swallowed (`consumeClick`).
 */
const HOLD_MS = 350;
const MOVE_PX = 5;

/**
 * @param row      element that holds the tabs (receives the drop marks)
 * @param tabs     () → the draggable tab elements, in order
 * @param idOf     (tab element) → id
 * @param onMove   (id, index) → void
 * @returns { start(event, button, id), consumeClick() → true when the click ends a drag }
 */
export function createTabDrag({ row, tabs, idOf, onMove }) {
  let ended = false;
  let drag = null;

  /** Where a drop at pointer x lands: { index (final position among the tabs), mark: [tab, 'before' | 'after'] | null }. */
  const dropAt = (x, id) => {
    const others = tabs().filter((t) => idOf(t) !== id);
    let index = 0;
    for (const t of others) { const r = t.getBoundingClientRect(); if (x > r.left + r.width / 2) index++; }
    const mark = others.length ? (index < others.length ? [others[index], 'before'] : [others[others.length - 1], 'after']) : null;
    return { index, mark };
  };
  const clearMarks = () => row.querySelectorAll('[data-drop]').forEach((t) => t.removeAttribute('data-drop'));

  function start(e, button, id) {
    if (drag) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const touch = e.pointerType !== 'mouse';
    drag = { id, button, x0: e.clientX, y0: e.clientY, active: false, pointerId: e.pointerId, timer: null };
    const activate = () => { drag.active = true; button.setAttribute('data-dragging', ''); try { button.setPointerCapture(drag.pointerId); } catch { /* ignored */ } };
    if (touch) drag.timer = setTimeout(() => { if (drag) activate(); }, HOLD_MS);
    const move = (ev) => {
      if (!drag) return;
      if (!drag.active) {
        if (touch) { if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 10) finish(false); return; }
        if (Math.abs(ev.clientX - drag.x0) < MOVE_PX) return;
        activate();
      }
      ev.preventDefault();
      clearMarks();
      const { mark } = dropAt(ev.clientX, id);
      if (mark) mark[0].setAttribute('data-drop', mark[1]);
    };
    const block = (ev) => { if (drag?.active) ev.preventDefault(); };
    const up = (ev) => finish(true, ev);
    const cancel = () => finish(false);
    const ctx = (ev) => ev.preventDefault();
    const finish = (commit, ev) => {
      clearTimeout(drag?.timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('touchmove', block, true);
      window.removeEventListener('contextmenu', ctx, true);
      const d = drag; drag = null;
      clearMarks(); d?.button.removeAttribute('data-dragging');
      if (d?.active) {
        ended = true;
        setTimeout(() => { ended = false; }, 0);
        if (commit && ev) onMove(id, dropAt(ev.clientX, id).index);
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('touchmove', block, { capture: true, passive: false });
    window.addEventListener('contextmenu', ctx, true);
  }

  return { start, consumeClick() { if (ended) { ended = false; return true; } return false; } };
}
