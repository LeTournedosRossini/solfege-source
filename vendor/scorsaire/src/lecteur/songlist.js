/*
 * The list of the songs of the recueil, on the whole screen (a recueil may hold 30 or 50 of them). A card per song: its number, its title, a badge when it is transposed,
 * and, once the padlock is open, the handle that moves it (held a moment, then dragged: scrolling never moves a card) and two arrows. The cards are laid out in 1, 2 or 3
 * columns (a whole column is filled before the next): as few columns as it takes for the list to fit the height, never more than the width allows. A search field keeps the
 * songs whose title holds what is typed (the order cannot be changed while the list is filtered). A tap on a card opens the song.
 *
 *   openSongList(host, { songs, current, locked, t, onPick(i), onLock(), onStep(i, d), onDrop(from, to, before), onClose }) → { refresh({ songs, current, locked }), close(), isOpen() }
 */
import { ensureStyle, el, btn, lockButton } from './ui.js';

const DRAG_HOLD_MS = 400; // a handle must be held this long without moving before a card follows the finger
const DRAG_SLOP = 10;
const MIN_COLUMN_PX = 270;
const EDGE_SCROLL = 64; // px from the top / bottom of the list where a dragged card scrolls it

export function openSongList(host, { songs: initial, current: initialCurrent, locked: initialLocked, t, onPick, onLock, onStep, onDrop, onClose = null }) {
  ensureStyle();
  const onResize = () => draw();
  let songs = initial; let current = initialCurrent; let locked = initialLocked; let query = ''; let drag = null; let justDragged = false; let closed = false; let scrollFrame = 0;
  const layer = el('div', { class: 'lc-ui', 'data-lc-songlist': '', role: 'dialog', 'aria-label': t('lecteur.songs'), style: 'position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--paper,#faf8f4);color:var(--ink,#1c1b1a)' });
  const search = el('input', { type: 'search', class: 'lc-input', 'data-act': 'song-search', placeholder: t('lecteur.search'), 'aria-label': t('lecteur.search'), autocomplete: 'off', style: 'flex:1 1 160px', oninput: (e) => { query = e.target.value; draw(); } });
  search.addEventListener('pointerdown', (e) => e.stopPropagation());
  const lockBox = el('span', { style: 'display:inline-flex' });
  const count = el('strong', { style: 'font-size:17px;white-space:nowrap' });
  const head = el('div', { style: 'flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line,#d8d3c8)' }, count, search, lockBox, btn('✕', () => close(), { square: true, act: 'close-songs', title: t('lecteur.close'), label: t('lecteur.close') }));
  const scroller = el('div', { 'data-lc-scroller': '', style: 'flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px 20px' });
  const grid = el('div', { 'data-lc-grid': '', style: 'column-gap:12px' });
  const foot = el('p', { class: 'lc-note', style: 'margin:0;padding:0 14px 10px;flex:none' });
  scroller.append(grid);
  layer.addEventListener('pointerdown', (e) => e.stopPropagation()); // (a touch in the list is never a tap on the stage behind it)
  layer.append(head, scroller, foot);

  const lockButtonNode = () => lockButton({ locked, labels: { locked: t('lecteur.locked'), unlocked: t('lecteur.unlocked') }, hint: t('lecteur.lockHint'), onToggle: onLock });

  const shown = () => { const q = query.trim().toLowerCase(); return songs.map((s, i) => ({ s, i })).filter(({ s }) => !q || s.title.toLowerCase().includes(q)); };
  const filtered = () => query.trim() !== '';

  const card = ({ s, i }) => {
    const tr = s.entry.settings?.transpose ?? 0;
    const move = !locked && !filtered();
    const c = el('div', { class: 'lc-card', 'data-lc-song': String(i), 'data-idx': String(i), style: `display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:8px;break-inside:avoid;-webkit-column-break-inside:avoid;min-height:48px;position:relative;border:1px solid ${i === current ? 'var(--ink,#1c1b1a)' : 'var(--edge,#c9c4b8)'};border-radius:8px;background:${i === current ? 'var(--btn-on,#e2e0da)' : 'var(--btn,#fff)'};cursor:pointer;touch-action:manipulation` },
      el('span', { style: 'min-width:22px;opacity:.5;font-size:13px' }, `${i + 1}.`),
      el('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.title),
      tr ? el('span', { style: 'font-size:12px;border:1px solid currentColor;border-radius:4px;padding:0 5px;opacity:.75' }, tr > 0 ? `+${tr}` : String(tr)) : null,
      move ? btn('▲', (e) => { e.stopPropagation(); onStep(i, -1); }, { square: true, act: 'up', disabled: i === 0, label: t('lecteur.moveUp') }) : null,
      move ? btn('▼', (e) => { e.stopPropagation(); onStep(i, 1); }, { square: true, act: 'down', disabled: i === songs.length - 1, label: t('lecteur.moveDown') }) : null,
      el('span', { class: 'lc-handle', 'data-act': 'handle', title: locked ? t('lecteur.lockedHint') : t('lecteur.handle'), style: `padding:8px 10px;font-size:20px;line-height:1;touch-action:none;cursor:${move ? 'grab' : 'not-allowed'};opacity:${move ? '1' : '.25'}`, onpointerdown: (e) => { e.stopPropagation(); cardDown(e, i, c, move); } }, '⠿'));
    c.addEventListener('click', () => { if (justDragged) return; onPick(i); });
    return c;
  };

  const columns = (n) => {
    grid.style.columnCount = '1';
    const first = grid.firstElementChild; if (!first || n < 1) return;
    const perColumn = Math.max(1, Math.floor(scroller.clientHeight / (first.offsetHeight + 8)));
    const byWidth = Math.max(1, Math.min(3, Math.floor((scroller.clientWidth - 28) / MIN_COLUMN_PX)));
    grid.style.columnCount = String(Math.min(byWidth, Math.max(1, Math.ceil(n / perColumn))));
  };

  function draw() {
    const list = shown();
    count.textContent = `${t('lecteur.songs')} (${filtered() ? `${list.length}/` : ''}${songs.length})`;
    lockBox.replaceChildren(lockButtonNode());
    grid.replaceChildren(...list.map(card));
    if (!list.length) grid.append(el('p', { class: 'lc-note', 'data-lc-nomatch': '' }, t('lecteur.noMatch')));
    foot.textContent = filtered() ? t('lecteur.filteredHint') : (locked ? t('lecteur.lockedHint') : t('lecteur.hint'));
    columns(list.length);
  }

  // ---- drag and drop by the handle: armed after a short hold without moving, never when locked or filtered ----
  const cardDown = (e, i, c, allowed) => {
    if (!allowed || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { i, card: c, armed: false, x: e.clientX, y: e.clientY, pointerId: e.pointerId, drop: null, handleEl: e.currentTarget, py: e.clientY };
    drag.timer = setTimeout(armDrag, DRAG_HOLD_MS);
    drag.handleEl.addEventListener('pointermove', dragMove); drag.handleEl.addEventListener('pointerup', dragUp); drag.handleEl.addEventListener('pointercancel', dragUp);
  };
  const armDrag = () => {
    if (!drag) return;
    drag.armed = true; drag.card.style.zIndex = '10'; drag.card.style.boxShadow = '0 10px 28px rgba(0,0,0,.35)';
    try { drag.handleEl.setPointerCapture(drag.pointerId); } catch { /* the move still reaches the handle */ }
    try { navigator.vibrate?.(15); } catch { /* no vibration */ }
    scrollFrame = requestAnimationFrame(autoScroll);
  };
  const autoScroll = () => { // a card held near the top or the bottom scrolls the list under it
    if (!drag?.armed) return;
    const r = scroller.getBoundingClientRect(); const y = drag.py;
    if (y < r.top + EDGE_SCROLL) scroller.scrollTop -= 10; else if (y > r.bottom - EDGE_SCROLL) scroller.scrollTop += 10;
    scrollFrame = requestAnimationFrame(autoScroll);
  };
  const dropTarget = (x, y) => {
    for (const c of grid.querySelectorAll('.lc-card')) {
      if (c === drag.card) continue;
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { card: c, before: y - r.top < r.height / 2 };
    }
    return null;
  };
  const markDrop = (drop) => { for (const c of grid.querySelectorAll('.lc-card')) { c.style.borderTop = ''; c.style.borderBottom = ''; } if (drop) drop.card.style[drop.before ? 'borderTop' : 'borderBottom'] = '3px solid var(--ink,#1c1b1a)'; };
  const dragMove = (e) => {
    if (!drag) return;
    drag.py = e.clientY;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (!drag.armed) { if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) endDrag(); return; } // a move before the hold ends: scrolling, not a drag
    e.preventDefault();
    drag.card.style.transform = `translate(${dx}px,${dy}px) scale(1.03)`;
    drag.drop = dropTarget(e.clientX, e.clientY); markDrop(drag.drop);
  };
  const dragUp = () => {
    if (!drag) return;
    const d = drag; const wasArmed = d.armed; endDrag();
    if (wasArmed) {
      justDragged = true; setTimeout(() => { justDragged = false; }, 60);
      if (d.drop && d.drop.card !== d.card) onDrop(d.i, Number(d.drop.card.dataset.idx), d.drop.before);
    }
  };
  function endDrag() {
    if (!drag) return;
    clearTimeout(drag.timer); cancelAnimationFrame(scrollFrame);
    try { drag.handleEl.releasePointerCapture(drag.pointerId); } catch { /* not captured */ }
    for (const ev of ['pointermove', 'pointerup', 'pointercancel']) drag.handleEl.removeEventListener(ev, ev === 'pointermove' ? dragMove : dragUp);
    drag.card.style.transform = ''; drag.card.style.zIndex = ''; drag.card.style.boxShadow = ''; markDrop(null);
    drag = null;
  }

  function close() { if (closed) return; closed = true; endDrag(); window.removeEventListener('resize', onResize); layer.remove(); onClose?.(); }
  host.append(layer);
  draw();
  window.addEventListener('resize', onResize);
  return {
    refresh(next) { songs = next.songs; current = next.current; locked = next.locked; draw(); },
    close,
    isOpen: () => !closed,
  };
}
