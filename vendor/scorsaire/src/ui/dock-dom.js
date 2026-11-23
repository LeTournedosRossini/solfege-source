/*
 * The bottom dock (DOM): ONE bar fixed at the bottom of the screen, in two zones separated by a thin line (decided with Jean, 20/10/2026).
 *  - TOP row: play / pause and the playback-options button on the left, undo / redo and the BACK button on the right. The options button turns the
 *    middle of this row into the playback drawer (stop, speed, repeats, loop, mixer, audio, time); pressing it again closes it.
 *  - BOTTOM row: the note entry pencil and the file button. Each is a drawer that takes over the WHOLE row (the other button is hidden): the entry
 *    drawer shows the entry buttons, the file drawer the file actions; pressing the same button again, or the BACK button, leaves it.
 * A third bottom drawer holds the views bar (named views of the score).
 * Drawers never move the score: the dock is fixed. It keeps its size under a pinch zoom (`visualViewport`); the page keeps a margin of its height.
 * Contents that do not fit go behind a « › » button (lowest priority first), see `fitRow`.
 */
import { counterZoom } from './float-place.js';
import { icon } from './icons.js';

/**
 * Keeps a row on ONE line: the items that do not fit (highest `prio` first; `prio` 0 = never) go into a floating panel behind a « › » button.
 * `getItems()` → [{ el, prio, show? }]; returns { fit, destroy }.
 */
export function fitRow({ row, getItems, more, panel, avail }) {
  const panelStyle = 'display:none;position:absolute;bottom:100%;margin-bottom:6px;z-index:8;flex-wrap:wrap;gap:var(--btn-gap,2px);padding:6px;box-sizing:border-box;background:var(--bar,var(--bg,#fff));border:1px solid rgba(0,0,0,0.25);border-radius:8px;box-shadow:0 -2px 10px rgba(0,0,0,0.25);max-width:calc(100vw - 16px)';
  panel.style.cssText = panelStyle;
  more.textContent = '›'; more.style.fontSize = '22px';
  const close = () => { panel.style.display = 'none'; };
  more.addEventListener('click', () => {
    const open = panel.style.display === 'none';
    const header = !!row.closest('.titlebar'); // in the page header (computers) the panel opens downwards
    panel.style.bottom = header ? 'auto' : '100%'; panel.style.top = header ? '100%' : 'auto'; panel.style.marginBottom = header ? '0' : '6px'; panel.style.marginTop = header ? '6px' : '0';
    panel.style.display = open ? 'flex' : 'none';
    if (open) { const host = panel.offsetParent ?? document.body; const hr = host.getBoundingClientRect(); const mr = more.getBoundingClientRect(); panel.style.left = `${Math.max(0, Math.min(mr.left - hr.left, hr.width - panel.offsetWidth))}px`; }
  });
  panel.addEventListener('click', () => setTimeout(close, 0));
  const onOutside = (e) => { if (!row.contains(e.target) && !panel.contains(e.target)) close(); };
  document.addEventListener('pointerdown', onOutside, true);
  function fit() {
    const width = avail();
    if (width <= 0 || !row.isConnected) return;
    const list = getItems().filter((it) => (it.show ? it.show() : true));
    const all = getItems();
    for (const it of all) it.el.style.display = list.includes(it) ? '' : 'none';
    more.style.display = 'none';
    row.replaceChildren(...list.map((it) => it.el), more, panel);
    const widths = new Map(list.map((it) => [it, it.el.getBoundingClientRect().width + 6]));
    let total = [...widths.values()].reduce((a, b) => a + b, 0);
    const hidden = [];
    if (total > width) {
      more.style.display = '';
      const reserve = more.getBoundingClientRect().width + 6;
      for (const it of [...list].sort((a, b) => b.prio - a.prio)) {
        if (total + reserve <= width || it.prio === 0) break;
        hidden.push(it); total -= widths.get(it);
      }
    }
    panel.replaceChildren(...list.filter((it) => hidden.includes(it)).map((it) => it.el));
    more.style.display = hidden.length ? '' : 'none';
    if (!hidden.length) close();
    row.replaceChildren(...list.filter((it) => !hidden.includes(it)).map((it) => it.el), more, panel);
  }
  return { fit, close, destroy() { document.removeEventListener('pointerdown', onOutside, true); } };
}

export function mountDock({ label = (k) => k } = {}) {
  if (!document.getElementById('dock-style')) {
    const st = document.createElement('style'); st.id = 'dock-style';
    // on a computer the buttons of the dock row live in the page header (outside [data-dock]): the page root carries the screen too
    st.textContent = ['two', 'three'].map((n) => `html[data-screen="${n}"] [data-staff-size],html[data-screen="${n}"] [data-action="entry-toggle"],html[data-screen="${n}"] [data-action="views-drawer"],html[data-screen="${n}"] [data-action="piano-toggle"],[data-dock][data-screen="${n}"] [data-action="entry-toggle"],[data-dock][data-screen="${n}"] [data-action="views-drawer"],[data-dock][data-screen="${n}"] [data-action="piano-toggle"],[data-dock][data-screen="${n}"] [data-piano],[data-dock][data-screen="${n}"] [data-staff-size]`).join(',') + '{display:none !important}';
    st.textContent += 'html[data-phone] [data-dock][data-bottom="entry"] [data-action="piano-toggle"]{display:none !important}'; // phone: the note-entry bar needs the room (its « › » menu holds a piano button)
    // phone: the playback drawer has no room beside the buttons, so it unfolds as a panel ABOVE the dock (over the page, nothing moves; no veil: the loop is set by touching measures)
    st.textContent += 'html[data-phone] [data-dock] [data-dock-mid]{position:absolute !important;left:0;right:0;bottom:100%;margin:0;padding:6px 8px;box-sizing:border-box;background:var(--bar,var(--bg,#fff));border-top:1px solid rgba(0,0,0,0.25);box-shadow:0 -2px 8px rgba(0,0,0,0.2)}';
    document.head.append(st);
  }
  const el = document.createElement('div');
  el.setAttribute('data-dock', ''); el.setAttribute('data-dismiss-keep', ''); el.setAttribute('role', 'toolbar');
  el.style.cssText = 'position:fixed;left:var(--sb-left,0px);right:var(--sb-right,0px);bottom:0;z-index:7;display:flex;flex-direction:column;gap:0;padding:6px 8px;box-sizing:border-box;background:var(--bar,var(--bg,#fff));border-top:1px solid rgba(0,0,0,0.25);box-shadow:0 -2px 8px rgba(0,0,0,0.2);transform-origin:0 0;will-change:transform';
  const mkDiv = (css, attr) => { const d = document.createElement('div'); d.style.cssText = css; if (attr) d.setAttribute(attr, ''); return d; };
  // top row: play / options button | playback drawer content | undo, redo, back
  const top = mkDiv('display:flex;align-items:center;gap:var(--btn-gap,2px);min-width:0', 'data-dock-top');
  const topLeft = mkDiv('display:flex;gap:var(--btn-gap,2px);align-items:center;flex:none');
  const topMid = mkDiv('display:none;flex:1 1 auto;min-width:0;align-items:center;gap:var(--btn-gap,2px);position:relative', 'data-dock-mid');
  const topRight = mkDiv('display:flex;gap:var(--btn-gap,2px);align-items:center;margin-left:auto;flex:none');
  const back = document.createElement('button');
  back.type = 'button'; back.setAttribute('data-action', 'dock-back');
  back.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;cursor:pointer';
  back.append(icon('arrow-left')); back.title = label('dock.back'); back.setAttribute('aria-label', back.title);
  topRight.append(back);
  top.append(topLeft, topMid, topRight);
  // thin separator, then the bottom row: [pencil, file] | entry buttons | file actions
  const bottom = mkDiv('display:flex;align-items:center;gap:var(--btn-gap,2px);min-width:0;position:relative;margin-top:5px;padding-top:5px;border-top:1px solid rgba(0,0,0,0.2)', 'data-dock-bottom');
  const bottomBase = mkDiv('display:flex;gap:var(--btn-gap,2px);align-items:center;flex:none');
  const entryHost = mkDiv('display:none;flex:1 1 auto;min-width:0;position:relative');
  const fileHost = mkDiv('display:none;flex:1 1 auto;min-width:0;align-items:center;gap:var(--btn-gap,2px);position:relative');
  const viewsHost = mkDiv('display:none;flex:1 1 auto;min-width:0;position:relative');
  bottom.append(bottomBase, entryHost, fileHost, viewsHost);
  // the on-screen piano keyboard (`piano-keyboard.js`) lives in a panel ABOVE the two rows: it is not a drawer, it stays open whatever the rows do
  const pianoHost = mkDiv('display:none;justify-content:center;align-items:flex-start;margin-bottom:6px;min-width:0', 'data-piano');
  el.append(pianoHost, top, bottom);
  document.body.append(el);

  let topState = null; let bottomState = null; // 'transport' | null ; 'entry' | 'file' | null
  const listeners = new Set(); const pianoListeners = new Set();
  const refresh = () => {
    topMid.style.display = topState === 'transport' || (topInHeader && api.showMid()) ? 'flex' : 'none';
    const railEntry = bottomState === 'entry' && entryHost.hasAttribute('data-rail'); // the note-entry bar stands in a vertical rail: no row here
    entryHost.style.display = bottomState === 'entry' && !railEntry ? 'block' : 'none';
    fileHost.style.display = bottomState === 'file' ? 'flex' : 'none';
    viewsHost.style.display = bottomState === 'views' ? 'block' : 'none';
    bottom.style.display = baseInHeader && (bottomState === null || railEntry) ? 'none' : 'flex'; // in the header the buttons are there: the bottom row only shows an open drawer
    const empty = topInHeader && baseInHeader && (bottomState === null || railEntry) && pianoHost.style.display === 'none';
    el.style.display = empty ? 'none' : 'flex';
    el.setAttribute('data-bottom', bottomState ?? ''); el.setAttribute('data-top', topState ?? '');
    const open = topState !== null || bottomState !== null;
    back.disabled = !open; back.style.opacity = open ? '' : '0.45'; back.style.cursor = open ? 'pointer' : 'default';
    for (const fn of [...listeners]) fn({ top: topState, bottom: bottomState });
    refit();
  };
  const bottomStyle = bottom.style.cssText;
  let baseInHeader = false; let topInHeader = false;
  /**
   * Computers: the top row (play, stop, options, screen choice, undo / redo, back) moves into `host` (the line of the page header that holds the Work and
   * Movement tabs); `null` puts it back above the bottom row (tablets, phones).
   */
  const setTopHost = (host) => {
    if (host) {
      top.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px);min-width:0;flex:1 1 auto';
      host.append(top);
      bottom.style.marginTop = '0'; bottom.style.paddingTop = '0'; bottom.style.borderTop = 'none';
    } else {
      top.style.cssText = 'display:flex;align-items:center;gap:var(--btn-gap,2px);min-width:0';
      el.insertBefore(top, bottom); bottom.style.cssText = bottomStyle;
    }
    topInHeader = !!host;
    document.body.toggleAttribute('data-pc-header', !!host);
    refresh();
    queueMicrotask(refit);
  };
  /** Computers: the drawer buttons (note entry, views, piano, file) move into `host` in the page header; the bottom row then shows only an open drawer. */
  const setBaseHost = (host) => {
    baseInHeader = !!host;
    if (host) { bottomBase.style.cssText = 'display:flex;gap:var(--btn-gap,2px);align-items:center;flex:none'; host.append(bottomBase); } else { bottom.prepend(bottomBase); }
    refresh();
  };
  const api = {
    setTopHost, setBaseHost, inHeader: () => baseInHeader, topInHeader: () => topInHeader, showMid: () => true, el, topLeft, topMid, topRight, bottomBase, entryHost, fileHost, viewsHost, pianoHost, back,
    topMode: () => topState, bottomMode: () => bottomState,
    setTop(name) { topState = name; refresh(); },
    setBottom(name) { bottomState = name; refresh(); },
    onMode(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Shows or hides the piano panel (the dock grows upwards; the page keeps a margin of its height). */
    setPiano(on) { pianoHost.style.display = on ? 'flex' : 'none'; refresh(); for (const fn of [...pianoListeners]) fn(!!on); refit(); },
    pianoOpen: () => pianoHost.style.display !== 'none',
    onPiano(fn) { pianoListeners.add(fn); return () => pianoListeners.delete(fn); },
    /** What the BACK button does for the bottom drawers (set by the entry bar: leaving the entry also switches the entry mode off). */
    onBack: null,
    /** The top row (play, options, screen choice, undo / redo) is on every screen; screen 2 (page layout) has no note entry nor views in the bottom row. */
    setScreen(screen) { el.setAttribute('data-screen', screen); document.documentElement.setAttribute('data-screen', screen); if (screen !== 'one' && (bottomState === 'entry' || bottomState === 'views')) bottomState = null; refresh(); }, // the top row (play, screens, undo) is on every screen
  };
  back.addEventListener('click', () => {
    if (bottomState !== null) { if (bottomState === 'entry' && api.onBack) api.onBack(); else api.setBottom(null); }
    else if (topState !== null) api.setTop(null);
  });

  /** Keeps the bottom at the bottom of the VISIBLE area at a constant size, whatever the pinch zoom. */
  const pin = () => {
    const vv = window.visualViewport;
    if (!vv || Math.abs((vv.scale || 1) - 1) < 0.01) { el.style.top = 'auto'; el.style.bottom = '0'; el.style.transform = ''; return; }
    el.style.bottom = 'auto'; el.style.top = '0';
    el.style.transform = counterZoom(vv, el.offsetHeight).transform;
  };
  const pad = () => { const h = el.style.display === 'none' ? 0 : el.offsetHeight; document.body.style.paddingBottom = h ? `${h + 8}px` : ''; document.documentElement.style.setProperty('--dock-h', `${h}px`); }; // --dock-h: where overlays that sit above the dock start
  const fitters = new Set();
  function refit() { for (const f of fitters) f(); pad(); pin(); }
  api.addFitter = (fn) => { fitters.add(fn); return () => fitters.delete(fn); };
  api.refit = refit;
  api.refresh = refresh;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { pad(); pin(); }) : null;
  ro?.observe(el);
  window.addEventListener('resize', refit);
  window.visualViewport?.addEventListener('resize', refit);
  window.visualViewport?.addEventListener('scroll', pin);
  window.addEventListener('scroll', pin);
  api.destroy = () => { ro?.disconnect(); window.removeEventListener('resize', refit); window.visualViewport?.removeEventListener('resize', refit); window.visualViewport?.removeEventListener('scroll', pin); window.removeEventListener('scroll', pin); document.body.style.paddingBottom = ''; el.remove(); };
  refresh();
  return api;
}
