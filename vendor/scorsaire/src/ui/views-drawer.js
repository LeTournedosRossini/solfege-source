/*
 * The views button of the bottom dock: a third drawer of the bottom row (next to the note entry pencil and the file button). Pressed, it shows the views bar
 * (tabs of the named views, save the current choice as a view, edit the active view, playback solo) over the whole row; pressed again, or with the dock's
 * back button, it leaves. The bar itself is `views-dom.js` (mounted by the page into `dock.viewsHost`, once per document).
 */
import { icon } from './icons.js';
import { SHEET_QUERY } from './panel-mode.js';

export function mountViewsDrawer({ dock, sidebar = null, label = (k) => k }) {
  const button = document.createElement('button');
  button.type = 'button'; button.title = label('dock.views'); button.setAttribute('aria-label', button.title); button.setAttribute('data-action', 'views-drawer');
  button.append(icon('eye'));
  button.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative';
  dock.bottomBase.append(button);
  const sync = () => {
    const mode = dock.bottomMode();
    button.setAttribute('aria-pressed', String(mode === 'views')); button.style.outline = mode === 'views' ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
    button.style.display = mode && mode !== 'views' && !dock.inHeader?.() ? 'none' : '';
  };
  const offMode = dock.onMode(sync); sync();
  // computers: the views bar itself stands in the page header (`#views-slot`, framed by a thin line), no drawer and no menu
  const host = dock.viewsHost; const home = host.parentNode;
  if (!document.getElementById('views-slot-style')) { const st = document.createElement('style'); st.id = 'views-slot-style'; st.textContent = '#views-slot [data-views-bar]{border:0!important;background:transparent!important;min-height:0!important;padding:0 2px!important}'; document.head.append(st); }
  // computers with a sidebar: the bar lives in the 'Views' tab (wrapping rows), not in the header
  const sideBody = sidebar && !window.matchMedia(SHEET_QUERY).matches ? sidebar.addTab('views', label('views.title'), { screen: 'one' }) : null;
  if (sideBody && !document.getElementById('views-side-style')) { const st = document.createElement('style'); st.id = 'views-side-style'; st.textContent = '[data-sidebar] [data-views-bar]{flex-wrap:wrap;white-space:normal;overflow:visible;border:0;background:transparent}[data-sidebar] [data-views-bar] .vw-sep{flex-basis:100%;height:0}'; document.head.append(st); }
  const place = () => {
    if (sideBody) { if (host.parentNode !== sideBody) sideBody.append(host); host.style.display = 'block'; const s = document.getElementById('views-slot'); if (s) s.style.display = 'none'; button.style.display = 'none'; return; }
    const slot = document.getElementById('views-slot');
    if (dock.inHeader?.() && slot) {
      if (host.parentNode !== slot) slot.append(host);
      const screen = dock.el?.getAttribute('data-screen');
      const shown = screen !== 'two' && screen !== 'three';
      host.style.display = shown ? 'block' : 'none'; slot.style.display = shown ? 'flex' : 'none';
      button.style.display = 'none';
    } else if (host.parentNode !== home) { home.append(host); const slot2 = document.getElementById('views-slot'); if (slot2) slot2.style.display = 'none'; }
  };
  const offShown = dock.onMode(place); place();
  button.addEventListener('click', () => { dock.setBottom(dock.bottomMode() === 'views' ? null : 'views'); });
  return { button, destroy() { offShown(); offMode(); if (dock.bottomMode() === 'views') dock.setBottom(null); button.remove(); } };
}
