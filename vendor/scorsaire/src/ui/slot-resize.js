/*
 * The corner that resizes a container between two measures (the small violet square at the bottom right of its frame, role `container-resize`, drawn by layout/containers.js):
 * pull it sideways and let go. The container keeps its place while the width is chosen; the new width (staff spaces, by half spaces, at least 1) is written once, on release, as
 * one undoable step (`app.setSlotWidth`). Works the same on screen 1 and on screen 2: the scale is read from the corner itself (its width is `HANDLE` staff spaces).
 * A pill beside the pointer says the width, and a dashed line shows where the new edge will be. Escape or a cancelled touch leaves the width as it was.
 */
import { HANDLE } from '../layout/containers.js';

const MIN_WIDTH = 1;
const STEP = 0.5;

export function installSlotResize({ app, doc = document }) {
  let drag = null;
  const pill = doc.createElement('div');
  pill.setAttribute('data-slot-resize-pill', '');
  pill.style.cssText = 'position:fixed;z-index:5000;display:none;pointer-events:none;padding:2px 8px;border-radius:10px;background:#6a4bd0;color:#fff;font:600 12px var(--ui-font,sans-serif)';
  const line = doc.createElement('div');
  line.style.cssText = 'position:fixed;z-index:4999;display:none;pointer-events:none;border-left:2px dashed #6a4bd0';
  doc.body.append(line, pill);

  const frameWidth = (svg, id, pxPerSp) => {
    let max = 0;
    for (const l of svg.querySelectorAll(`[data-role="container-frame"][data-ref="${CSS.escape(id)}"]`)) max = Math.max(max, l.getBoundingClientRect().width);
    return max / pxPerSp + 0.2; // (the frame is drawn 0.1 inside the slot on each side)
  };
  const show = (e) => {
    const sp = Math.max(MIN_WIDTH, Math.round((drag.start + (e.clientX - drag.x0) / drag.pxPerSp) / STEP) * STEP);
    drag.width = sp;
    const edge = drag.left + sp * drag.pxPerSp; // x of the new right edge on the screen
    pill.textContent = `${sp} sp`; pill.style.display = 'block'; pill.style.left = `${Math.round(edge + 8)}px`; pill.style.top = `${Math.round(drag.top - 28)}px`;
    line.style.display = 'block'; line.style.left = `${Math.round(edge)}px`; line.style.top = `${Math.round(drag.top - 16)}px`; line.style.height = `${Math.round(drag.height + 24)}px`;
  };
  const end = (commit) => {
    if (!drag) return;
    const d = drag; drag = null;
    pill.style.display = 'none'; line.style.display = 'none';
    d.handle.style.opacity = '';
    try { d.handle.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    if (commit && Math.abs(d.width - d.start) >= STEP / 2) app.setSlotWidth(d.id, d.width);
  };

  /** The corner under the pointer, or the nearest one around it: on a page shown small the square is only a few pixels wide, so a finger (22 px) or a mouse (10 px) may miss a little. */
  const pick = (e) => {
    const direct = e.target?.closest?.('[data-role="container-resize"]');
    if (direct) return direct;
    const reach = e.pointerType === 'touch' || e.pointerType === 'pen' ? 22 : 10;
    let best = null; let bestD = reach;
    for (const h of doc.querySelectorAll('[data-role="container-resize"]')) {
      const r = h.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bestD) { best = h; bestD = d; }
    }
    return best;
  };
  doc.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const handle = pick(e);
    if (!handle) return;
    const svg = handle.ownerSVGElement; const id = handle.getAttribute('data-ref');
    if (!svg || !id) return;
    e.preventDefault(); e.stopImmediatePropagation(); // the corner is not a click on the container
    const r = handle.getBoundingClientRect();
    const pxPerSp = r.width / HANDLE;
    if (!(pxPerSp > 0)) return;
    const frames = [...svg.querySelectorAll(`[data-role="container-frame"][data-ref="${CSS.escape(id)}"]`)].map((l) => l.getBoundingClientRect());
    const left = frames.length ? Math.min(...frames.map((b) => b.left)) - 0.1 * pxPerSp : r.right - 3 * pxPerSp;
    const top = frames.length ? Math.min(...frames.map((b) => b.top)) : r.top;
    const bottom = frames.length ? Math.max(...frames.map((b) => b.bottom)) : r.bottom;
    const start = Math.round(frameWidth(svg, id, pxPerSp) / STEP) * STEP;
    drag = { id, handle, pointerId: e.pointerId, x0: e.clientX, pxPerSp, start, width: start, left, top, height: bottom - top };
    handle.style.opacity = '.5';
    try { handle.setPointerCapture(e.pointerId); } catch { /* the move events still reach the document */ }
    show(e);
  }, true);
  doc.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.pointerId) { e.preventDefault(); show(e); } }, true);
  doc.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pointerId) { show(e); end(true); } }, true); // (the release point counts: the last move may not have been reported)
  doc.addEventListener('pointercancel', () => end(false), true);
  doc.addEventListener('keydown', (e) => { if (drag && e.key === 'Escape') { e.stopPropagation(); end(false); } }, true);
  return { destroy() { end(false); pill.remove(); line.remove(); } };
}
