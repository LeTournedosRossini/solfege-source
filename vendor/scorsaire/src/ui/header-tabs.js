/*
 * The floating panel of the "Work" and "Movement" panels: a sheet from the bottom on a tablet / phone, hanging under the header on a computer screen that
 * has no sidebar tabs (screens 2 and 3). On screen 1 of a computer they are tabs of the sidebar instead (`work-panels.js`, which also holds the shared content).
 * Every field validates on change = one undoable transaction; what the score shows is view state, never in the document.
 */
import { dismissOnOutside } from './outside-dismiss.js';
import { SHEET_QUERY } from './panel-mode.js';
import { createWorkPanels } from './work-panels.js';

const STYLE_ID = 'header-tabs-style';
const CSS = `
[data-header-panel] { position: fixed; z-index: 45; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); border-radius: 0 0 8px 8px; box-shadow: 0 4px 14px rgba(0,0,0,.25); font: 14px var(--ui-font,sans-serif); padding: 10px 12px; box-sizing: border-box; max-width: min(560px, calc(100vw - 16px)); max-height: calc(100vh - 80px); overflow: auto; }
[data-header-panel][data-sheet] { left: 0 !important; right: 0; margin: 0 auto; width: min(720px, 100vw); max-width: 100vw; max-height: 62vh; border-radius: 12px 12px 0 0; padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
[data-header-panel] input[type="text"] { min-width: 14em; }
`;

function el(tag, attrs = {}) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); }
  return n;
}

/** `host` = an empty element in the header (kept hidden: the tabs are in the sidebar / the file drawer); `onShow(movementId)` shows that movement on the score. */
export function mountHeaderTabs(host, { app, label, onShow, shownId, headerEl, chain = null }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(Object.assign(document.createElement('style'), { id: STYLE_ID, textContent: CSS }));
  const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  const enabled = () => !(media?.matches ?? false);
  const panels = createWorkPanels({ app, label, onShow, shownId, chain });
  let open = null; // 'work' | 'movement' | null
  let panel = null;
  let stopOutside = () => {};
  host.style.display = 'none';

  function place() {
    if (!panel) return;
    if (!enabled()) { // tablet / phone: a sheet from the bottom, above the dock
      const dock = document.querySelector('[data-dock]');
      panel.setAttribute('data-sheet', ''); panel.setAttribute('data-zoom-lock', '');
      panel.style.top = 'auto'; panel.style.bottom = `${Math.round(dock ? dock.getBoundingClientRect().height : 0)}px`;
      return;
    }
    panel.removeAttribute('data-sheet'); panel.removeAttribute('data-zoom-lock'); panel.style.bottom = '';
    const bar = (headerEl ?? host).getBoundingClientRect();
    panel.style.top = `${Math.round(bar.bottom)}px`;
    panel.style.left = `${Math.max(8, Math.round(bar.left + 8))}px`;
  }
  function closePanel() { stopOutside(); stopOutside = () => {}; panel?.remove(); panel = null; }
  function draw() {
    if (!open) { closePanel(); return; }
    if (!panel) {
      panel = el('div', { 'data-header-panel': '', role: 'dialog', 'aria-label': label(`headerTabs.${open}`) });
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { open = null; draw(); } });
      document.body.append(panel);
      stopOutside = dismissOnOutside(() => panel, (e) => { if (e?.target?.closest?.('[data-dock]')) return; open = null; draw(); });
    }
    panel.setAttribute('aria-label', label(`headerTabs.${open}`));
    panels.render(panel, open);
    place();
  }
  const unsubscribe = app.doc.subscribe(() => { if (open) draw(); });
  const onResize = () => { draw(); };
  window.addEventListener('resize', onResize);
  return {
    /** Opens (or closes, when it is already open) the panel of a tab: 'work' | 'movement'. */
    toggle(id) { open = open === id ? null : id; draw(); },
    close() { open = null; draw(); },
    refresh: draw,
    destroy() { unsubscribe?.(); window.removeEventListener('resize', onResize); closePanel(); host.replaceChildren(); },
  };
}
