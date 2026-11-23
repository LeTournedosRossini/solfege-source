/*
 * The NAVIGATOR of the YouTube editor (screen 5): the fragments of the file (each one is a movement of the work) as cards. A card shows the number, the title and
 * where the fragment plays on the video; a tap chooses its first use on the timeline (or just shows its score when it is not placed) and the caller opens the editor tab.
 * Editing (title, number, description, tracks, place / duplicate / delete) lives in the fragment editor (`yt-fragment-editor.js`).
 * No DOM outside its own element; every gesture goes through the callbacks.
 */
const PALETTE = ['#2b6cff', '#e0561b', '#2a9d5c', '#a64dd6', '#c9a000', '#d6336c', '#0f9aa8', '#6b7a8f'];
const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const fmt = (s) => { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };

/** The signature of what the navigator shows (a redraw only happens when it changes). */
export function navigatorSignature(movements, placements, selectedMovementId, shownId) {
  return JSON.stringify([movements.map((m) => [m.id, m.title, m.cardNumber, m.description]), placements.map((p) => [p.movementId, p.start, p.end]), selectedMovementId, shownId]);
}

/**
 * @param o.movements()    [{ id, title, cardNumber, description }] in order
 * @param o.placements()   the placements of the session
 * @param o.selectedId()   id of the selected placement
 * @param o.shownId()      id of the movement the score shows
 * @param o.onChoose(movementId)   a card was tapped
 * @param o.onPlace(movementId) / onAdd() / onDuplicate(id) / onRemove(id)
 * @param o.onText(id, patch)      { title?, description?, number? }
 */
export function mountYtNavigator(host, { label, movements, placements, selectedId, shownId, onChoose, onPlace, onAdd, onDuplicate, onRemove, onText }) {
  const root = el('div', 'display:flex;flex-direction:column;gap:6px', { 'data-yt-navigator': '' });
  host.append(root);
  let sig = '';
  const current = () => placements().find((p) => p.id === selectedId())?.movementId ?? null;
  function field(kind, value, onCommit, css = '') {
    const i = el(kind === 'area' ? 'textarea' : 'input', `font:15px var(--ui-font,sans-serif);border:1px solid var(--line,#d8d3c8);border-radius:6px;padding:4px 6px;box-sizing:border-box;min-width:0;${css}`, kind === 'area' ? { rows: '2' } : { type: 'text' });
    i.value = value ?? ''; i.addEventListener('change', () => onCommit(i.value)); i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && kind !== 'area') i.blur(); }); return i;
  }
  const btn = (text, title, fn, extra = '') => { const b = el('button', `min-height:30px;padding:0 10px;${extra}`, { type: 'button', title, 'aria-label': title }); b.textContent = text; b.addEventListener('click', fn); return b; };
  function draw() {
    const list = movements(); const all = placements(); const chosen = current(); const shown = shownId();
    const next = navigatorSignature(list, all, chosen, shown); if (next === sig) return; sig = next;
    const head = el('div', 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap');
    head.append(btn(`＋ ${label('placement.add')}`, label('placement.addHint'), () => onAdd()));
    const cards = list.map((m, i) => {
      const uses = all.filter((p) => p.movementId === m.id).sort((a, b) => a.start - b.start);
      const open = chosen === m.id || (chosen == null && shown === m.id);
      const card = el('div', `border:1px solid ${open ? PALETTE[i % PALETTE.length] : 'var(--line,#d8d3c8)'};border-left:6px solid ${PALETTE[i % PALETTE.length]};border-radius:8px;background:var(--paper,#faf8f4);padding:6px 8px;display:flex;flex-direction:column;gap:6px`, { 'data-yt-card': m.id, 'aria-current': String(open) });
      const top = el('button', 'all:unset;cursor:pointer;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap', { type: 'button' });
      const num = el('b', 'font:var(--w-bold,700) 14px var(--ui-font,sans-serif)'); num.textContent = m.cardNumber ?? String(i + 1);
      const title = el('span', 'font:14px var(--ui-font,sans-serif);flex:1 1 auto;min-width:0'); title.textContent = m.title || label('ytEditor.untitled');
      const when = el('span', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#666)'); when.textContent = uses.length ? uses.map((p) => `${fmt(p.start)}–${fmt(p.end)}`).join('  ') : label('ytEditor.notPlaced');
      top.append(num, title, when); top.addEventListener('click', () => onChoose(m.id)); card.append(top);
      return card;
    });
    root.replaceChildren(head, ...cards);
  }
  draw();
  return { refresh: draw, redraw() { sig = ''; draw(); }, destroy() { root.remove(); } };
}
