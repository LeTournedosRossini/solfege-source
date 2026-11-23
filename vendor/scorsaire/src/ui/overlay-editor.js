/*
 * The editing of the fragments placed ON the video, over the video frame: a box is dragged with the pointer (anywhere on it, or by its handles: ✥ top left = move, ⇲ bottom right =
 * width; the height always comes from the music). While the pointer is down only a dashed FRAME follows it, with the size it will have; the music is laid out again once, when the
 * pointer is released. The layer is a SHIELD over the video (the pointer never reaches the iframe of YouTube, which would swallow the moves of a drag). Writes through `setPlacements`.
 * Used by the editor of screen 4 and by the editor of screen 5.
 */
import { isOver, overOf, setPlacementOver } from '../audio/placements.js';
import { itemOver, updateItem, onVideo } from '../audio/banner.js';

function el(tag, css = '', attrs = {}) { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

/**
 * @param o.frame   the video frame (its size is the reference of the percents); o.layer the shield layer (inside the frame, positioned)
 * @returns { placeHandles(): put the handles on the selected box (call it after each redraw), destroy() }
 */
export function mountOverlayEditor({ frame, layer, label = (k) => k, getPlacements, setPlacements, selected, onSelect, refresh, items = null }) {
  // `items` = { get(), set(list), selected(), select(id) }: the cards and annotations placed ON the video are moved and sized the same way
  let layerMoved = false;
  const scaleOf = () => (frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth : 1) || 1;
  const stopClick = (e) => { if (layerMoved) { e.stopPropagation(); e.preventDefault(); layerMoved = false; } };
  layer.addEventListener('click', stopClick, true);
  // dragging: the box itself, or its handles (top left = move, bottom right = width); the height always comes from the music
  // while the pointer is down only a FRAME follows it (with the size it will have); the music is laid out again once, when it is released: nothing jumps meanwhile
  const beginDrag = (e, p, mode, itemId = null) => {
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* the pointer is already gone */ }
    if (itemId) items.select(itemId); else { items?.select?.(null); onSelect(p); }
    const it0 = itemId ? items.get().find((x) => x.id === itemId) : null; const o = itemId ? { ...itemOver(it0), size: 100 } : overOf(p); const r = frame.getBoundingClientRect(); const x0 = e.clientX; const y0 = e.clientY; layerMoved = false;
    const k = scaleOf(); const W = frame.offsetWidth || r.width; const H = frame.offsetHeight || r.height; // the viewer may be scaled down (a transform): the layer's own pixels are the unscaled ones
    const box = itemId ? layer.querySelector(`[data-yr-item="${itemId}"]`) : layer.querySelector(`[data-yr-pid="${p.id}"]`); const br = box?.getBoundingClientRect();
    const ghost = el('div', 'position:absolute;border:2px dashed #2b6cff;background:rgba(43,108,255,.12);pointer-events:none;z-index:31;box-sizing:border-box;display:none');
    const tag = el('div', 'position:absolute;left:0;top:-20px;background:#2b6cff;color:#fff;font:var(--w-semi,600) 11px var(--ui-font,sans-serif);padding:1px 6px;border-radius:4px;white-space:nowrap'); ghost.append(tag); layer.append(ghost);
    const half = (v) => Math.round(v * 2) / 2; let patch = null;
    const move = (ev) => {
      if (!layerMoved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; layerMoved = true;
      const dx = ((ev.clientX - x0) / r.width) * 100; const dy = ((ev.clientY - y0) / r.width) * 100; // both in percent of the WIDTH of the frame
      patch = mode === 'size' ? { w: half(Math.max(10, Math.min(100 - o.x, o.w + dx))), ...(itemId ? {} : { size: Math.max(20, Math.min(200, Math.round(o.size * (1 + (ev.clientY - y0) / Math.max(20, br?.height ?? 60))))) }) } /* across: the width; down / up: the size of the writing, which decides the height */ : { x: half(Math.max(0, Math.min(95, o.x + dx))), y: half(Math.max(0, Math.min(50, o.y + dy))) };
      const n = { ...o, ...patch }; const bw = ((br?.height ?? 60) / k) * (mode === 'size' && !itemId ? n.size / o.size : 1); // resizing: the frame grows or shrinks in height too (in proportion; the music is laid out for real on release)
      ghost.style.cssText += `;display:block;left:${(n.x / 100) * W}px;top:${(n.y / 100) * W}px;width:${(n.w / 100) * W}px;height:${bw}px`;
      tag.textContent = mode === 'size' ? (itemId ? `${n.w} %` : `${n.w} % · ${n.size} %`) : `${n.x} % · ${n.y} %`;
      // the handles stay on the frame being dragged, not on the old box
      const gl = (n.x / 100) * W; const gt = (n.y / 100) * W; const gw = (n.w / 100) * W; const cl = (v, hi) => Math.max(0, Math.min(hi - 22, v));
      moveH.style.left = `${cl(gl + 2, W)}px`; moveH.style.top = `${cl(gt + 2, H)}px`; sizeH.style.left = `${cl(gl + gw - 24, W)}px`; sizeH.style.top = `${cl(gt + bw - 24, H)}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ghost.remove();
      if (patch) { if (itemId) items.set(updateItem(items.get(), itemId, { over: { ...itemOver(it0), ...patch } })); else setPlacements(setPlacementOver(getPlacements(), p.id, patch)); refresh(); }
      setTimeout(() => { layerMoved = false; }, 0);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onDown = (e) => {
    const itemBox = items ? e.target.closest?.('[data-yr-item]') : null;
    const kindH = e.target.closest?.('[data-over-handle]')?.getAttribute('data-over-handle');
    const selItemId = items?.selected?.() ?? null;
    if (itemBox || (kindH && selItemId)) { const id = itemBox ? itemBox.getAttribute('data-yr-item') : selItemId; if (items.get().some((x) => x.id === id && onVideo(x))) { e.preventDefault(); beginDrag(e, null, kindH === 'size' ? 'size' : 'move', id); return; } }
    const kind = e.target.closest?.('[data-over-handle]')?.getAttribute('data-over-handle');
    const pid = kind ? selected() : e.target.closest?.('[data-yr-pid]')?.getAttribute('data-yr-pid'); const p = getPlacements().find((x) => x.id === pid); if (!p || !isOver(p)) return;
    e.preventDefault(); beginDrag(e, p, kind === 'size' ? 'size' : 'move');
  };
  layer.addEventListener('pointerdown', onDown);
  const handleCss = 'position:absolute;display:none;width:22px;height:22px;box-sizing:border-box;border:2px solid #2b6cff;background:rgba(255,255,255,.9);color:var(--info-ink,#2b6cff);border-radius:6px;pointer-events:auto;z-index:30;padding:0;font:14px/18px var(--ui-font,sans-serif);text-align:center;touch-action:none;cursor:';
  const moveH = el('div', `${handleCss}move`, { 'data-over-handle': 'move', title: label('placement.overMove') }); moveH.textContent = '✥';
  const sizeH = el('div', `${handleCss}nwse-resize`, { 'data-over-handle': 'size', title: label('placement.overResize') }); sizeH.textContent = '⇲';
  layer.append(moveH, sizeH);
  const placeHandles = () => {
    const selItemId = items?.selected?.() ?? null; const p = getPlacements().find((x) => x.id === selected());
    const box = selItemId ? layer.querySelector(`[data-yr-item="${selItemId}"]`) : p && isOver(p) ? layer.querySelector(`[data-yr-pid="${p.id}"]`) : null;
    const r = box?.getBoundingClientRect(); const f = frame.getBoundingClientRect();
    if (!box || !r || r.width < 4 || r.height < 4 || (!selItemId && !box.firstChild)) { moveH.style.display = 'none'; sizeH.style.display = 'none'; return; }
    const k = scaleOf(); const FW = frame.offsetWidth || f.width; const FH = frame.offsetHeight || f.height; const clampPx = (v, hi) => Math.max(0, Math.min(hi - 22, v));
    moveH.style.left = `${clampPx((r.left - f.left) / k + 2, FW)}px`; moveH.style.top = `${clampPx((r.top - f.top) / k + 2, FH)}px`;
    sizeH.style.left = `${clampPx((r.right - f.left) / k - 24, FW)}px`; sizeH.style.top = `${clampPx((r.bottom - f.top) / k - 24, FH)}px`;
    moveH.style.display = 'block'; sizeH.style.display = 'block';
  };

  return { placeHandles, destroy() { layer.removeEventListener('click', stopClick, true); layer.removeEventListener('pointerdown', onDown); moveH.remove(); sizeH.remove(); } };
}
