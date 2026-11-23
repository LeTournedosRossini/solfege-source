/*
 * A row of UNDERLINED tabs (the look of the screen-1 sidebar tabs: text, a bar under the active one). Used by the YouTube editor (screen 5) for its right-column
 * tabs, the viewer tabs and the device buttons. No model here.
 * `kind: 'tab'` = ARIA tabs (aria-selected); `kind: 'toggle'` = a choice among buttons (aria-pressed).
 */
const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

const BASE = 'border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;box-shadow:none;min-height:var(--ui-target,30px);padding:0 10px;font:14px var(--ui-font,sans-serif);cursor:pointer;color:var(--ink,#111);display:inline-grid;justify-items:center';

/** Paints a button as active / inactive. */
export function paintUnderlineTab(b, active) {
  b.style.borderBottomColor = active ? 'var(--tab-active,#1c1b1a)' : 'transparent';
  b.style.fontWeight = active ? '700' : '400';
  const shown = b.firstChild; if (shown?.style) shown.style.fontWeight = active ? '700' : '400';
}

/**
 * @param items [{ id, text, title?, attrs? }]
 * @param o.kind 'tab' | 'toggle'
 * @param o.onPick(id)
 * @returns { el, set(id), buttons }
 */
export function createUnderlineTabs(items, { kind = 'tab', onPick = () => {}, selected = null, css = '' } = {}) {
  const root = el('div', `display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);${css}`, kind === 'tab' ? { role: 'tablist' } : { role: 'group' });
  const buttons = {};
  let current = selected;
  const paint = () => {
    for (const [id, b] of Object.entries(buttons)) {
      const on = current === id;
      b.setAttribute(kind === 'tab' ? 'aria-selected' : 'aria-pressed', String(on));
      paintUnderlineTab(b, on);
    }
  };
  for (const it of items) {
    const b = el('button', BASE, { type: 'button', ...(kind === 'tab' ? { role: 'tab' } : {}), ...(it.title ? { title: it.title, 'aria-label': it.title } : {}), ...(it.attrs ?? {}) });
    // two stacked copies of the text: the bold one (invisible) always sets the width, so a tab keeps its size whichever is active
    const shown = el('span', 'grid-area:1/1'); shown.textContent = it.text;
    const ghost = el('span', 'grid-area:1/1;font-weight:var(--w-bold,700);visibility:hidden;height:0;overflow:hidden', { 'aria-hidden': 'true' }); ghost.textContent = it.text;
    b.append(shown, ghost);
    b.addEventListener('click', () => { onPick(it.id); });
    buttons[it.id] = b; root.append(b);
  }
  paint();
  return { el: root, buttons, set(id) { current = id; paint(); }, get: () => current };
}
