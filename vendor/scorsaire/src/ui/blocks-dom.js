/*
 * Editor of the band of blocks (screens 1 and 4): boxes over the band of the shown movement. A box is moved by dragging it, stretched by its corner, its text is
 * edited with a double click (or the pencil), its look (bold, italic, underline, alignment, size, colour) with the bar over it. Positions and sizes are written in percent of
 * the WIDTH of the band, in ONE transaction at the end of a gesture; while it lasts only the box moves. Nothing is drawn here: the texts are drawn by the layout, so they
 * are the same as on the other screens. The editing mode is an interface state of the Application (never in the document).
 */
import { applyIconName } from './icons.js';
import { blockLook, MIN_SIZE, MAX_SIZE, FAMILIES, FITS, FULL_CROP, MIN_CROP, cropImageBlock } from '../model/blocks.js';
import { assetHref } from '../model/assets.js';
import { createColorPicker } from './color-picker.js';

const SWATCHES = ['#111111', '#c0392b', '#2b6cff', '#1f7a43', '#b8860b', '#7a3fb8', '#777777'];
function el(tag, css = '', attrs = {}) { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

/** @param o.stage the positioned box of the score; o.view the ScoreView; o.app the Application */
export function mountBlocksEditor({ stage, view, app, label = (k) => k }) {
  const layer = el('div', 'position:absolute;left:0;top:0;width:0;height:0;z-index:6;pointer-events:none;overflow:visible', { 'data-blocks-layer': '' });
  stage.append(layer);
  let selected = null; let cropping = null; let drag = null; let editor = null; let lastTap = null;
  const editing = () => app.blocksEditing();

  const btn = (text, title, fn, extra = '') => {
    const b = el('button', `min-width:30px;min-height:30px;padding:0 6px;font:var(--w-bold,700) 13px var(--ui-font,sans-serif);border:1px solid var(--edge,#888);border-radius:6px;background:var(--btn,#fdfcfa);cursor:pointer;${extra}`, { type: 'button', title, 'aria-label': title });
    b.textContent = text; b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', fn); return b;
  };

  function closeEditor(commit) {
    if (!editor) return;
    const { area, id } = editor; editor = null;
    const text = area.value; area.remove();
    if (commit) app.updateBlock(id, { text });
    refresh();
  }
  function openEditor(b, box, look, px) {
    closeEditor(false);
    const area = el('textarea', `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;box-sizing:border-box;font:${look.italic ? 'italic ' : ''}${look.bold ? 'bold ' : ''}${Math.max(11, px)}px ${look.family};text-align:${look.align};text-decoration:${look.underline ? 'underline' : 'none'};color:${look.color ?? '#111'};background:rgba(255,255,255,.92);border:2px solid #2b6cff;border-radius:3px;padding:2px;resize:none;pointer-events:auto;z-index:8`, { 'data-block-editor': '' });
    area.value = b.text; layer.append(area); editor = { area, id: b.id };
    area.addEventListener('pointerdown', (e) => e.stopPropagation());
    area.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); } else if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeEditor(true); } });
    area.addEventListener('blur', () => setTimeout(() => closeEditor(true), 0));
    area.focus(); area.select();
  }

  function refresh() {
    if (editor) return;
    layer.replaceChildren();
    if (!editing()) return;
    const band = view.bandRect();
    if (!band) return;
    const frame = el('div', `position:absolute;left:${band.x}px;top:${band.y}px;width:${band.w}px;height:${band.h}px;border:1px dashed rgba(43,108,255,.5);box-sizing:border-box;pointer-events:none`);
    layer.append(frame);
    if (band.fitH < band.h - 4 && view.layout().systems[0]?.staves.length === 0) { // what a box on the video shows of this band: down to the lowest of its content
      const vis = el('div', `position:absolute;left:${band.x}px;top:${band.y}px;width:${band.w}px;height:${band.fitH}px;border:1px dashed rgba(224,120,27,.8);box-sizing:border-box;pointer-events:none`);
      const tag = el('div', 'position:absolute;right:4px;bottom:2px;font:11px var(--ui-font,sans-serif);color:var(--warn-ink,#b0560f);background:rgba(255,255,255,.8);padding:0 4px;border-radius:3px'); tag.textContent = label('blocks.visibleOnVideo'); vis.append(tag); layer.append(vis);
      // the author may draw this frame by hand (its height only: its width is that of the box on the video); the handle at the bottom; ↺ gives the automatic height back
      const grip = el('div', 'position:absolute;left:50%;bottom:-8px;width:44px;height:14px;margin-left:-22px;border-radius:7px;background:#e8731a;border:2px solid #fff;cursor:ns-resize;pointer-events:auto;touch-action:none;box-sizing:border-box', { title: label('blocks.fitDrag') });
      let fy = null;
      grip.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); grip.setPointerCapture?.(e.pointerId); fy = { y0: e.clientY, h0: band.fitH }; });
      grip.addEventListener('pointermove', (e) => { if (fy) vis.style.height = `${Math.max(12, fy.h0 + (e.clientY - fy.y0))}px`; });
      const done = (e) => { if (!fy) return; const h = Math.max(12, fy.h0 + (e.clientY - fy.y0)); fy = null; app.setBlockFit(h / band.w); refresh(); };
      grip.addEventListener('pointerup', done); grip.addEventListener('pointercancel', () => { fy = null; refresh(); });
      vis.append(grip);
      if (band.fitManual) { const auto = btn('↺', label('blocks.fitAuto'), () => { app.setBlockFit(null); refresh(); }, 'position:absolute;left:4px;bottom:2px;pointer-events:auto;min-width:24px;min-height:24px;'); auto.addEventListener('pointerdown', (e) => e.stopPropagation()); vis.append(auto); }
    }
    const W = band.w;
    for (const b of app.blocks()) {
      const box = { x: band.x + (b.x / 100) * W, y: band.y + (b.y / 100) * W, w: (b.w / 100) * W, h: (b.h / 100) * W };
      const sel = b.id === selected;
      const d = el('div', `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;box-sizing:border-box;border:${sel ? '2px solid #2b6cff' : '1px dashed rgba(0,0,0,.35)'};background:${sel ? 'rgba(43,108,255,.07)' : 'transparent'};pointer-events:auto;cursor:move;touch-action:none`, { 'data-block': b.id });
      const handle = el('div', `position:absolute;right:-7px;bottom:-7px;width:16px;height:16px;border-radius:50%;background:#2b6cff;border:2px solid #fff;cursor:nwse-resize;touch-action:none;display:${sel ? 'block' : 'none'}`, { 'data-block-handle': b.id });
      if (b.kind === 'image' && !assetHref(b.image)) d.title = label('blocks.imageMissing');
      const cropOn = sel && b.kind === 'image' && cropping === b.id;
      if (cropOn) handle.style.display = 'none';
      d.append(handle);
      if (cropOn) {
        for (const edge of ['left', 'right', 'top', 'bottom']) {
          const horiz = edge === 'left' || edge === 'right';
          const eh = el('div', `position:absolute;${horiz ? `${edge}:-6px;top:50%;margin-top:-16px;width:12px;height:32px;cursor:ew-resize` : `${edge}:-6px;left:50%;margin-left:-16px;height:12px;width:32px;cursor:ns-resize`};background:#2b6cff;border:2px solid #fff;border-radius:4px;touch-action:none;box-sizing:border-box`, { 'data-crop-handle': edge });
          eh.addEventListener('pointerdown', (e) => start('crop', e, edge));
          eh.addEventListener('pointermove', (e) => move(e)); eh.addEventListener('pointerup', () => end()); eh.addEventListener('pointercancel', () => end());
          d.append(eh);
        }
      }
      const start = (kind, e, edge) => {
        e.preventDefault(); e.stopPropagation(); d.setPointerCapture?.(e.pointerId); handle.setPointerCapture?.(e.pointerId);
        selected = b.id; drag = { kind, edge, id: b.id, x0: e.clientX, y0: e.clientY, b, W, d, moved: false };
      };
      d.addEventListener('pointerdown', (e) => { if (e.target === handle) return; start('move', e); });
      handle.addEventListener('pointerdown', (e) => start('resize', e));
      const move = (e) => {
        if (!drag || drag.id !== b.id) return;
        const dx = e.clientX - drag.x0; const dy = e.clientY - drag.y0;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (!drag.moved) return;
        if (drag.kind === 'move') { d.style.left = `${box.x + dx}px`; d.style.top = `${box.y + dy}px`; } else if (drag.kind === 'crop') { // the edge follows the pointer; the picture is redrawn when the gesture ends
          if (drag.edge === 'left') { d.style.left = `${box.x + dx}px`; d.style.width = `${Math.max(10, box.w - dx)}px`; } else if (drag.edge === 'right') d.style.width = `${Math.max(10, box.w + dx)}px`; else if (drag.edge === 'top') { d.style.top = `${box.y + dy}px`; d.style.height = `${Math.max(10, box.h - dy)}px`; } else d.style.height = `${Math.max(10, box.h + dy)}px`;
        } else { d.style.width = `${Math.max(20, box.w + dx)}px`; d.style.height = `${Math.max(14, box.h + dy)}px`; }
        drag.dx = dx; drag.dy = dy;
      };
      const end = () => {
        const g = drag; drag = null;
        if (!g || g.id !== b.id) return;
        if (!g.moved) { // a tap: two quick taps on the same block open its text (the boxes are redrawn at each tap, so a native double click would be lost)
          const now = performance.now(); const again = lastTap && lastTap.id === b.id && now - lastTap.t < 450; lastTap = again ? null : { id: b.id, t: now };
          refresh(); if (again && b.kind !== 'image') { const nb = layer.querySelector(`[data-block="${b.id}"]`); if (nb) openEditor(b, box, blockLook(b), (blockLook(b).size / 100) * W); } return;
        }
        const pc = (px) => (px / g.W) * 100;
        if (g.kind === 'crop') {
          const ratio = g.b.ratio > 0 ? g.b.ratio : 1; const old = g.b.crop ?? FULL_CROP;
          const du = pc(g.dx) / (g.b.w / old.w); const dv = pc(g.dy) / (g.b.w / old.w / ratio); // the move, in units of the whole picture
          const c = { ...old };
          if (g.edge === 'left') { const m = Math.min(Math.max(du, -old.x), old.w - MIN_CROP); c.x += m; c.w -= m; }
          else if (g.edge === 'right') c.w = Math.min(Math.max(old.w + du, MIN_CROP), 1 - old.x);
          else if (g.edge === 'top') { const m = Math.min(Math.max(dv, -old.y), old.h - MIN_CROP); c.y += m; c.h -= m; }
          else c.h = Math.min(Math.max(old.h + dv, MIN_CROP), 1 - old.y);
          app.updateBlock(b.id, cropImageBlock(g.b, c)); refresh(); return;
        }
        app.updateBlock(b.id, g.kind === 'move' ? { x: g.b.x + pc(g.dx), y: g.b.y + pc(g.dy) } : { w: g.b.w + pc(g.dx), h: g.b.h + pc(g.dy) });
        refresh();
      };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
      layer.append(d);
      if (sel) layer.append(toolbar(b, box, W));
    }
  }

  // a button that leaves the editing of the blocks (the bar never had one: it only closed by a tap beside)
  const done = () => { const x = btn('✓', label('blocks.done'), () => app.setBlocksEditing(false)); applyIconName(x, 'x'); return x; };
  /** The bar goes above the box; when the box is at the top of the band (no room above) it goes under it, so that it never hides what is being edited. */
  const barTop = (box) => (box.y - 40 >= 0 ? box.y - 36 : box.y + box.h + 4);
  function toolbar(b, box, W) {
    if (b.kind === 'image') {
      const bar = el('div', `position:absolute;left:${Math.max(0, box.x)}px;top:${barTop(box)}px;display:flex;gap:2px;flex-wrap:nowrap;padding:2px;background:var(--bar,#fdfcfa);border:1px solid var(--edge,#bbb);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:auto;z-index:7`, { 'data-block-bar': '' });
      const fit = b.fit ?? 'contain';
      const fitBtn = btn({ contain: '▭', cover: '◼', stretch: '⤢' }[fit], `${label('blocks.fit')}: ${label(`blocks.fit.${fit}`)}`, () => { app.updateBlock(b.id, { fit: FITS[(FITS.indexOf(fit) + 1) % FITS.length] }); refresh(); });
      const cropBtn = btn('⛶', label('blocks.crop'), () => { cropping = cropping === b.id ? null : b.id; refresh(); });
      cropBtn.setAttribute('aria-pressed', String(cropping === b.id)); if (cropping === b.id) cropBtn.style.background = 'var(--btn-on,#e2e0da)';
      const uncrop = b.crop ? btn('↺', label('blocks.cropReset'), () => { app.updateBlock(b.id, cropImageBlock(b, FULL_CROP)); refresh(); }) : null;
      const rm = btn('🗑', label('blocks.remove'), () => { app.removeBlock(b.id); selected = null; refresh(); });
      applyIconName(rm, 'trash');
      bar.append(fitBtn, cropBtn, ...(uncrop ? [uncrop] : []), rm, done());
      return bar;
    }
    const look = blockLook(b);
    const bar = el('div', `position:absolute;left:${Math.max(0, box.x)}px;top:${barTop(box)}px;display:flex;gap:2px;flex-wrap:nowrap;padding:2px;background:var(--bar,#fdfcfa);border:1px solid var(--edge,#bbb);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:auto;z-index:7`, { 'data-block-bar': '' });
    const flag = (text, key, title, extra) => { const x = btn(text, title, () => { app.updateBlock(b.id, { [key]: !look[key] }); refresh(); }, extra); x.setAttribute('aria-pressed', String(!!look[key])); if (look[key]) x.style.background = 'var(--btn-on,#e2e0da)'; return x; };
    const aligns = ['left', 'center', 'right'];
    const alignBtn = btn({ left: '⇤', center: '↔', right: '⇥' }[look.align], label('blocks.align'), () => { app.updateBlock(b.id, { align: aligns[(aligns.indexOf(look.align) + 1) % 3] }); refresh(); });
    const size = (d) => () => { app.updateBlock(b.id, { size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(look.size * (d > 0 ? 1.15 : 1 / 1.15) * 10) / 10)) }); refresh(); };
    const family = btn('Aa', label('blocks.family'), () => { app.updateBlock(b.id, { family: FAMILIES[(FAMILIES.indexOf(look.family) + 1) % FAMILIES.length] }); refresh(); }, `font-family:${look.family}`);
    const sw = el('div', 'display:flex;gap:2px;align-items:center;padding:0 2px');
    sw.append(createColorPicker({ value: look.color ?? '#111111', title: label('blocks.color'), label, onChange: (c) => { app.updateBlock(b.id, { color: c === '#111111' ? null : c }); refresh(); } }).el); // any colour: the full editor
    for (const c of SWATCHES) { const s = btn('', c, () => { app.updateBlock(b.id, { color: c === '#111111' ? null : c }); refresh(); }, `min-width:18px;min-height:18px;width:18px;height:18px;padding:0;border-radius:50%;background:${c}`); sw.append(s); }
    const edit = btn('✎', label('blocks.edit'), () => openEditor(b, box, look, (look.size / 100) * W));
    const del = btn('🗑', label('blocks.remove'), () => { app.removeBlock(b.id); selected = null; refresh(); });
    applyIconName(del, 'trash'); applyIconName(edit, 'pencil');
    bar.append(edit, flag('B', 'bold', label('blocks.bold'), 'font-weight:900'), flag('I', 'italic', label('blocks.italic'), 'font-style:italic'), flag('U', 'underline', label('blocks.underline'), 'text-decoration:underline'), alignBtn, family, btn('A−', label('blocks.smaller'), size(-1)), btn('A+', label('blocks.bigger'), size(1)), sw, del, done());
    return bar;
  }

  // a tap outside a box (on the layer's frame) clears the selection
  stage.addEventListener('pointerdown', (e) => { if (editing() && selected && !e.target.closest?.('[data-block], [data-block-bar], [data-block-editor]')) { selected = null; refresh(); } }, true);
  const off = app.onBlocksEditing(() => { selected = null; cropping = null; closeEditor(false); refresh(); });
  /** The block under a point (pixels of the drawing), or null: a tap on a text or a picture of the band starts the editing of it. */
  const blockAt = (x, y) => {
    const band = view.bandRect(); if (!band) return null;
    let found = null;
    for (const b of app.blocks()) {
      const bx = band.x + (b.x / 100) * band.w; const by = band.y + (b.y / 100) * band.w; const bw = (b.w / 100) * band.w; const bh = (b.h / 100) * band.w;
      if (x >= bx - 3 && x <= bx + bw + 3 && y >= by - 3 && y <= by + bh + 3) found = b.id;
    }
    return found;
  };
  return { refresh, blockAt, select: (id) => { selected = id; refresh(); }, destroy() { off(); layer.remove(); } };
}
