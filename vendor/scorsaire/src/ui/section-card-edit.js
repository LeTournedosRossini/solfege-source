/*
 * Editing the name cards of the sections of the form (screen 1): a card that sits AT ITS PLACE (see `sections-strip.js`: the start of its section,
 * not pinned to the edge) can be touched. A tap selects it and opens a small floating bar (move one measure left / right, name, remove); dragging it
 * (mouse) or a long press then drag (touch) moves the section to another measure, a vertical line shows where it will land.
 * The bar is `position: fixed`: nothing of the score moves. Every change is one `app.systemEdit` transaction.
 */
import { isTextEditingTarget } from './undoredo.js';

const LONG_PRESS = 400; // ms before a touch starts a drag
const MOVE_SLOP = 4; // px a mouse must travel before a press becomes a drag
const SELECTED = '2px solid var(--sel-edge, #2d78ff)';

export function mountSectionCardEdit({ stage, view, app, label, margin = 10, describeError = (e) => String(e?.message ?? e) }) {
  let selectedId = null;
  let cardEls = new Map();
  let bar = null;
  let input = null;
  let status = null;
  let marker = null;

  const movement = () => view.movement();
  const elOf = () => { for (const el of cardEls.values()) if (el.dataset.sectionId === selectedId && el.dataset.selectable) return el; return null; };
  const firstOf = () => Number(elOf()?.dataset.first);
  const say = (text) => { if (status) status.textContent = text; };

  const edit = (name, fn) => {
    try { app.systemEdit(name, fn, view.id); say(''); return true; } catch (e) { say(/already starts/.test(String(e?.message)) ? label('sectionCard.occupied') : describeError(e)); return false; }
  };
  const masterbarId = (mi) => movement()?.masterbars?.[mi]?.id;

  function shift(delta) {
    const mv = movement(); const to = firstOf() + delta;
    if (!mv?.masterbars?.[to]) { say(label('sectionCard.edge')); return; }
    const id = selectedId;
    edit(label('sectionCard.moved'), (d, m, sys) => sys.moveSection(d, m, id, m.masterbars[to].id));
  }
  function remove() {
    const id = selectedId;
    if (edit(label('sectionCard.removed'), (d, m, sys) => sys.removeSection(d, m, id))) deselect();
  }
  function rename() {
    const text = input.value.trim(); const mi = firstOf(); const mv = movement();
    const current = elOf()?.lastChild?.textContent;
    if (!text) { input.value = current ?? ''; return; }
    if (text === current || !mv?.masterbars?.[mi]) return;
    edit(label('sectionCard.renamed'), (d, m, sys) => sys.setSectionLabel(d, m, m.masterbars[mi].id, text));
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.setAttribute('data-section-card-bar', '');
    bar.style.cssText = 'position:fixed;z-index:3000;display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,6px);padding:6px;box-sizing:border-box;max-width:calc(100vw - 8px);background:var(--bar,#fff);border:1px solid var(--edge,#c9c4b8);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.25);font:var(--w-semi,600) 13px var(--ui-font,sans-serif);color:var(--ink,#222)';
    const size = 'var(--ui-target, 36px)';
    const btn = (text, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
      b.style.cssText = `min-width:${size};height:${size};padding:0 8px;border:1px solid var(--edge,#c9c4b8);border-radius:8px;background:var(--field,#fff);color:inherit;font:inherit;cursor:pointer`;
      b.addEventListener('click', fn);
      return b;
    };
    input = document.createElement('input');
    input.type = 'text'; input.maxLength = 40; input.setAttribute('aria-label', label('sectionCard.name'));
    input.style.cssText = `height:${size};width:9em;box-sizing:border-box;padding:0 8px;border:1px solid var(--field-edge,#767676);border-radius:8px;background:var(--field,#fff);color:inherit;font:inherit`;
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { rename(); input.blur(); } else if (e.key === 'Escape') { input.value = elOf()?.lastChild?.textContent ?? ''; input.blur(); } });
    input.addEventListener('blur', rename);
    status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'flex:1 0 100%;min-height:1.3em;font-weight:400;font-size:12px;color:var(--warn-ink,#9a5b00)'; // the room of the message is always reserved
    bar.append(btn('◀', label('sectionCard.prev'), () => shift(-1)), btn('▶', label('sectionCard.next'), () => shift(1)), input, btn('✕', label('sectionCard.remove'), remove), status);
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(bar);
  }

  function placeBar() {
    const el = elOf();
    if (!bar) return;
    if (!el) { deselect(); return; }
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const top0 = vv ? vv.offsetTop : 0;
    const bh = bar.offsetHeight; const bw = bar.offsetWidth;
    let top = r.top - bh - 6;
    if (top < top0 + 4) top = r.bottom + 6; // no room above: below the card
    const left = Math.max(4, Math.min(r.left, window.innerWidth - bw - 4));
    bar.style.top = `${top}px`; bar.style.left = `${left}px`;
  }

  function paint() {
    for (const el of cardEls.values()) {
      const on = !!selectedId && el.dataset.sectionId === selectedId && !!el.dataset.selectable;
      el.style.outline = on ? SELECTED : ''; el.style.outlineOffset = '1px';
    }
  }

  function select(id) {
    selectedId = id;
    if (!bar) buildBar();
    const el = elOf();
    input.value = el?.lastChild?.textContent ?? '';
    say('');
    paint(); placeBar();
  }
  function deselect() {
    selectedId = null; paint();
    bar?.remove(); bar = null; input = null; status = null;
  }

  // ---------- drag ----------
  const stageRect = () => stage.getBoundingClientRect();
  /** The measure under a point (client pixels): { mi, x0, top, height } in stage pixels, or null. */
  function measureAt(clientX, clientY) {
    const layout = view.layout(); const ss = view.staffSpace(); const sr = stageRect();
    const px = clientX - sr.left; const py = clientY - sr.top;
    let best = null;
    for (const sys of layout.systems) {
      const top = sys.top * ss; const bottom = (sys.top + sys.height) * ss;
      if (!best || Math.abs(py - (top + bottom) / 2) < Math.abs(py - (best.top + best.bottom) / 2)) best = { sys, top, bottom };
    }
    if (!best?.sys.measures?.length) return null;
    const { sys } = best; const sx = (px - margin) / ss - sys.x0;
    let k = sys.measures.findIndex((m) => sx < m.barX);
    if (k < 0) k = sys.measures.length - 1;
    const startX = k === 0 ? 0 : sys.measures[k - 1].barX;
    return { mi: sys.measures[k].index ?? sys.measures[k].mi, // (the view's layout names it `index`)
      x: margin + (sys.x0 + startX) * ss, top: best.top, height: best.bottom - best.top };
  }

  function startPress(el, down) {
    const id = el.dataset.sectionId;
    const startX = down.clientX; const startY = down.clientY;
    const touch = down.pointerType !== 'mouse';
    let dragging = false; let target = null; let timer = null;
    const begin = () => {
      dragging = true;
      el.style.cursor = 'grabbing';
      marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;width:3px;margin-left:-1px;background:var(--sel-edge,#2d78ff);border-radius:2px;pointer-events:none;z-index:2;display:none';
      stage.append(marker);
    };
    if (touch) timer = setTimeout(begin, LONG_PRESS);
    const move = (e) => {
      if (e.pointerId !== down.pointerId) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < (touch ? 10 : MOVE_SLOP)) return;
        if (touch) { clearTimeout(timer); return finish(false); } // the finger moved before the long press: it was a scroll, not a drag
        begin();
      }
      e.preventDefault();
      target = measureAt(e.clientX, e.clientY);
      if (target) { marker.style.display = 'block'; marker.style.left = `${target.x}px`; marker.style.top = `${target.top}px`; marker.style.height = `${target.height}px`; }
    };
    const up = (e) => { if (e.pointerId === down.pointerId) finish(e.type === 'pointerup'); };
    const finish = (ok) => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      el.style.cursor = '';
      const wasDrag = dragging; marker?.remove(); marker = null;
      if (!ok) return;
      if (!wasDrag) { select(id); return; } // a tap
      select(id);
      const to = target ? masterbarId(target.mi) : null;
      if (to) edit(label('sectionCard.moved'), (d, m, sys) => sys.moveSection(d, m, id, to));
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  }

  const onDown = (e) => {
    if (e.button > 0) return;
    const el = e.target.closest?.('[data-section-id]');
    if (!el || !el.dataset.selectable) return;
    e.preventDefault(); // no text selection, no focus change
    startPress(el, e);
  };
  const onOutside = (e) => {
    if (!selectedId) return;
    if (bar?.contains(e.target) || e.target.closest?.('[data-section-id]')) return;
    deselect();
  };
  const onKey = (e) => {
    if (!selectedId) return;
    if (e.key === 'Escape') { deselect(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextEditingTarget(e.target)) { e.preventDefault(); remove(); }
  };
  const onContext = (e) => { if (e.target.closest?.('[data-section-id]')) e.preventDefault(); };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey);

  return {
    /** Called by the strip after each placement of the cards. */
    cards(map) {
      cardEls = map;
      if (!selectedId) return;
      if (!elOf()) { deselect(); return; } // its card was pinned, moved out of reach or removed
      paint(); placeBar();
    },
    destroy() {
      deselect();
      stage.removeEventListener('pointerdown', onDown); stage.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey);
    },
  };
}
