/*
 * The settings of a screen on a TABLET or a phone (no sidebar): the same tabs as the sidebar of a computer, one tab's sections at a time. A wide window (> 900 px, a tablet held wide) = a column of
 * 340 px beside the page that scrolls by itself; a narrow window = a sheet at the bottom whose tab bar always shows (a tab opens it, the same tab again closes it), so the page is never pushed down.
 * Shared by screen 2 (parts) and screen 3 (sheets). The caller owns `state` ({ tab, open, scroll }: interface state, kept from one redraw to the next) and rebuilds the column at every redraw;
 * `rememberTabletScroll` is called BEFORE the rebuild so that the tab keeps where it was read.
 */
const STYLE_ID = 'tablet-panel-style';
const CSS = `
.ps-tablet { flex: 0 0 340px; max-width: 360px; box-sizing: border-box; display: flex; flex-direction: column; background: var(--module, #fcfbf8); border: 1px solid var(--edge,#ccc); border-radius: 8px; overflow: hidden; }
.ps-tablet .ps-tabs { display: flex; gap: 2px; flex: none; flex-wrap: nowrap; overflow-x: auto; border-bottom: 1px solid var(--edge,#ccc); }
.ps-tablet .ps-tab { flex: 1 1 auto; min-height: var(--ui-target, 44px); padding: 0 8px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; font: inherit; white-space: nowrap; cursor: pointer; }
.ps-tablet .ps-tab[aria-selected="true"] { font-weight: var(--w-bold,700); border-bottom-color: var(--ink,#1c1b1a); }
.ps-tablet .ps-tabbody { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px; }
.ps-tablet .ps-props { border: 0; padding: 0; max-width: none; width: 100%; flex: none; background: transparent; box-sizing: border-box; }
@media (min-width: 901px) { .ps-tablet { position: sticky; top: 0; align-self: flex-start; max-height: calc(100vh - var(--ps-dock, 84px) - 12px); } }
@media (max-width: 900px) {
  .ps-tablet { position: fixed; left: 0; right: 0; bottom: var(--ps-dock, 84px); z-index: 6; max-width: none; border-radius: 12px 12px 0 0; border-bottom: 0; box-shadow: 0 -2px 10px rgba(0,0,0,.25); }
  .ps-tablet .ps-tabbody { display: none; max-height: 42vh; }
  .ps-tablet[data-open] .ps-tabbody { display: block; }
}
`;

const narrow = () => !!window.matchMedia?.('(max-width: 900px)').matches;

/** The height of the bottom bar (the sheet sits on it): the distance from its top to the bottom of the window. */
function dockHeight() {
  let e = document.querySelector('[data-act="dock-screen"]');
  while (e && getComputedStyle(e).position !== 'fixed') e = e.parentElement;
  return e ? Math.round(window.innerHeight - e.getBoundingClientRect().top) : 84;
}

/** Reads the scroll of the column that is about to be rebuilt (a column drawn twice in a row has not been filled yet: nothing to read). */
export function rememberTabletScroll(container, state) {
  const old = container.querySelector('.ps-tabbody');
  if (old?.isConnected && old.childElementCount) state.scroll = old.scrollTop;
}

/**
 * @param o.tabs      [{ id, text }]
 * @param o.state     { tab, open, scroll } owned by the caller
 * @param o.build     (tabId) → Node: the content of a tab (built each time it is shown)
 * @param o.getShell  () → the element of the screen that gets `data-sheet` / `data-sheet-open` (its CSS leaves room under the page for the sheet)
 * @returns the column (an element to put beside the page)
 */
export function createTabletPanel({ tabs, state, build, getShell = () => null, attrs = {} }) {
  if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st); }
  const isNarrow = narrow();
  const el = (tag, a = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); } n.append(...kids.filter((x) => x != null)); return n; };
  if (!tabs.some((t) => t.id === state.tab)) state.tab = tabs[0].id;
  const root = el('div', { class: 'ps-tablet', 'data-tablet-props': '', ...attrs });
  const bar = el('div', { class: 'ps-tabs', role: 'tablist' });
  const body = el('div', { class: 'ps-tabbody' });
  const fill = () => {
    const open = !isNarrow || state.open;
    root.toggleAttribute('data-open', open);
    const shell = getShell();
    if (shell) { shell.toggleAttribute('data-sheet', isNarrow); shell.toggleAttribute('data-sheet-open', isNarrow && state.open); }
    root.style.setProperty('--ps-dock', `${dockHeight()}px`);
    for (const b of bar.children) b.setAttribute('aria-selected', String(open && b.dataset.tab === state.tab));
    body.replaceChildren(open ? build(state.tab) : '');
    const keep = state.scroll ?? 0;
    body.scrollTop = keep; requestAnimationFrame(() => { if (body.isConnected && body.scrollTop !== keep) body.scrollTop = keep; }); // (a body that a later redraw already replaced does nothing)
  };
  for (const t of tabs) {
    bar.append(el('button', { type: 'button', class: 'ps-tab', role: 'tab', 'data-tab': t.id, onclick: () => {
      if (isNarrow && state.open && state.tab === t.id) state.open = false; else { if (state.tab !== t.id) state.scroll = 0; state.tab = t.id; state.open = true; }
      fill();
    } }, t.text));
  }
  root.append(bar, body);
  queueMicrotask(fill); // (the screen's shell exists once the column is in it)
  return root;
}
