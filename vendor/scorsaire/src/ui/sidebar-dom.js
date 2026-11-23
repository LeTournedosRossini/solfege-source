/*
 * The SIDEBAR (computers only; screen 1 and screen 2 each have their own tabs): ONE column beside the score, on the right or on the left (a button switches), that folds (a thin arrow in the margin, which stays at the same place whether it is open or not). It is fixed to the edge, full height.
 * It holds tabs (a thin line under the active one): the tracks panel, the chord-diagram editor, the piano keyboard and the guitar neck when they are
 * set vertical. It PUSHES the score (the score area shrinks). On a tablet or a phone (`SHEET_QUERY`) it does not exist: `isEnabled()` is false and the
 * components keep their floating / bottom-sheet presentation. Everything here is a choice of the DEVICE (storage), never of the document.
 * A tab belongs to a screen (`addTab(id, title, { screen: 'one' | 'two' })`, 'one' by default) and is only shown on it; `setScreen` switches. The side, the
 * width, the full-height choice and the fold are shared by both screens (the column looks and behaves the same way). `isEnabled()` is the screen-1 test
 * the screen-1 components use; `isEnabledForParts()` is the screen-2 one.
 */
import { setEdge } from './edge-reserve.js';
import { SHEET_QUERY } from './panel-mode.js';
import { icon } from './icons.js';

const KEY = 'scorsaire.sidebar';
const MIN_WIDTH = 260; const DEFAULT_WIDTH = 340;
const MARGIN = 18; // the margin between the edge of the window and the panel: always reserved, it holds the fold arrow (which never moves)

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
}

export function mountSidebar(host, { label = (k) => k, storage = null } = {}) {
  const read = () => { try { return JSON.parse(storage?.getItem(KEY) ?? 'null') ?? {}; } catch { return {}; } };
  const saved = read();
  // first launch: unfolded on the tracks tab, on the left of screens 1 and 2 and on the right of screen 3
  let folded = saved.folded === true;
  const sideOf = (v, d) => (v === 'left' ? 'left' : v === 'right' ? 'right' : d);
  const legacy = saved.side ? sideOf(saved.side, null) : null; // before: one side for all the screens
  const sides = { one: sideOf(saved.sides?.one, legacy ?? 'left'), two: sideOf(saved.sides?.two, legacy ?? 'left'), three: sideOf(saved.sides?.three, legacy ?? 'right') }; // each screen keeps its own side
  let side = sides.one;
  // fixed to the edge, whole height of the window (the bottom dock gets narrower); off (the default) = in the page flow, under the title bar, beside the score.
  // Only a choice the person MADE (`fullChosen`) is kept: the old default (full height) was saved with everything else and must not hold the new one back.
  let fullChosen = saved.fullChosen === true;
  let fullHeight = fullChosen ? saved.fullHeight !== false : false;
  let widthPx = Number.isFinite(saved.widthPx) ? saved.widthPx : DEFAULT_WIDTH;
  let screen = 'one';
  const activeBy = { one: typeof saved.tab === 'string' ? saved.tab : 'tracks', two: typeof saved.tab2 === 'string' ? saved.tab2 : null, three: typeof saved.tab3 === 'string' ? saved.tab3 : null };
  const write = () => { try { storage?.setItem(KEY, JSON.stringify({ folded, side: sides.one, sides, widthPx, fullHeight, fullChosen, tab: activeBy.one, tab2: activeBy.two, tab3: activeBy.three })); } catch { /* storage unavailable */ } };
  const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  let hidden = false; // screen 5 has its own right column: the sidebar is out of the way there
  const enabledNow = () => !hidden && !(media?.matches ?? false);
  const tabs = new Map(); // id → { title, visible, body, screen }
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  host.setAttribute('data-sidebar', '');
  const bar = el('div', { 'data-sidebar-bar': '', role: 'tablist', style: 'display:flex;flex-wrap:wrap;align-items:flex-end;gap:2px;padding:4px 6px 0;border-bottom:1px solid var(--line,#d8d3c8);background:var(--side-tabs,#f4f1ea)' });
  const bodies = el('div', { style: 'flex:1;min-height:0;overflow:auto;position:relative' });

  const shown = () => [...tabs.entries()].filter(([, t]) => t.visible && t.screen === screen);
  const current = () => { const a = activeBy[screen]; const t = tabs.get(a); return t?.visible && t.screen === screen ? a : (shown()[0]?.[0] ?? null); };

  const maxWidth = () => Math.max(MIN_WIDTH, Math.round((typeof window !== 'undefined' ? window.innerWidth : 1200) * 0.6));
  const fitOf = () => { const t = tabs.get(current()); return t?.fit ?? null; }; // a tab can ask for an exact width (the vertical keyboard: its own thickness)
  /** Width of the panel itself (0 when folded). */
  const panelWidth = () => (folded ? 0 : fitOf() ?? Math.max(MIN_WIDTH, Math.min(widthPx, maxWidth())));
  /** The room the sidebar takes at the edge of the window: the page and the bottom dock stay clear of it. The margin strip is ALWAYS reserved (folded or not). */
  function reserve(left, right) { setEdge('sidebar', left, right); }
  let reserved = '';
  const panelEl = el('div', { 'data-sidebar-panel': '', style: 'position:relative;display:flex;flex-direction:column;background:var(--paper,#fff);box-sizing:border-box;overflow:hidden;min-width:0' });
  /** The thin arrow in the margin: same place folded or not, only its direction changes (it points to the edge of the window when it folds the panel). */
  const foldBtn = el('button', { type: 'button', 'data-act': 'sidebar-fold', style: `width:${MARGIN}px;min-width:0;height:44px;margin:6px 0 0;padding:0;border:0;border-radius:4px;background:transparent;box-shadow:none;display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--ink,#1c1b1a);opacity:.55;--icon-stroke:1.25`, onclick: () => api.setFolded(!folded) });
  foldBtn.addEventListener('pointerenter', () => { foldBtn.style.opacity = '1'; }); foldBtn.addEventListener('pointerleave', () => { foldBtn.style.opacity = '.55'; });
  /** Switches the panel to the other side: in the margin, under the fold arrow (same place in both states). */
  const sideBtn = el('button', { type: 'button', 'data-act': 'sidebar-side', style: `width:${MARGIN}px;min-width:0;height:28px;margin:2px 0 0;padding:0;border:0;border-radius:4px;background:transparent;box-shadow:none;display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--ink,#1c1b1a);opacity:.55;--icon-stroke:1.25;pointer-events:auto`, onclick: () => api.setSide(side === 'left' ? 'right' : 'left') });
  sideBtn.addEventListener('pointerenter', () => { sideBtn.style.opacity = '1'; }); sideBtn.addEventListener('pointerleave', () => { sideBtn.style.opacity = '.55'; });
  /** Full height (fixed to the edge) or in the flow beside the score: in the margin too, under the side button. */
  const fullBtn = el('button', { type: 'button', 'data-act': 'sidebar-full', style: sideBtn.getAttribute('style'), onclick: () => api.setFullHeight(!fullHeight) });
  fullBtn.addEventListener('pointerenter', () => { fullBtn.style.opacity = '1'; }); fullBtn.addEventListener('pointerleave', () => { fullBtn.style.opacity = '.55'; });
  // in the flow the panel is as tall as what is left of the window under the top of its column (the toolbar above it leaves the window when the page scrolls)
  const placeStick = () => { if (!fullHeight && host.isConnected) host.style.setProperty('--sb-top', `${Math.max(0, Math.round(host.getBoundingClientRect().top))}px`); };
  if (typeof window !== 'undefined') { window.addEventListener('scroll', placeStick, { passive: true }); window.addEventListener('resize', placeStick); }
  function draw() {
    const on = enabledNow();
    host.style.display = on ? 'flex' : 'none';
    if (!on) { reserve(0, 0); reserved = ''; return; }
    const pw = panelWidth();
    const total = folded ? 0 : MARGIN + pw; // folded: the host takes no room (the arrow column overflows it, over the page padding): the score fills the space
    const fixed = fullHeight;
    host.style.cssText = `display:flex;flex-direction:${side === 'left' ? 'row' : 'row-reverse'};align-items:${fixed ? 'stretch' : 'flex-start'};width:${total}px;background:transparent;box-sizing:border-box;`
      + (fixed ? `position:fixed;top:0;bottom:0;${side}:0;z-index:6;pointer-events:none` : `position:relative;flex:none;align-self:stretch;order:${side === 'left' ? 0 : 4};${folded ? '' : 'min-height:min(70vh,520px);'}margin-${side}:-12px`); // in the flow the margin strip goes over the 12 px of page padding: flush with the window edge
    foldBtn.style.pointerEvents = 'auto';
    fullBtn.replaceChildren(icon(fullHeight ? 'minimize-2' : 'maximize-2', { size: '12px' })); fullBtn.setAttribute('aria-label', label('sidebar.fullHeight')); fullBtn.title = label('sidebar.fullHeight');
    sideBtn.replaceChildren(icon('replace', { size: '12px' })); sideBtn.setAttribute('aria-label', label('sidebar.side')); sideBtn.title = label('sidebar.side');
    // pointing toward the edge of the window while the panel is open (a tap folds it); pointing inward while folded (a tap opens it)
    const toEdge = side === 'left' ? 'chevron-left' : 'chevron-right';
    const toInside = side === 'left' ? 'chevron-right' : 'chevron-left';
    foldBtn.replaceChildren(icon(folded ? toInside : toEdge, { size: '14px' }));
    const tip = label(folded ? 'sidebar.unfold' : 'sidebar.fold');
    foldBtn.setAttribute('aria-label', tip); foldBtn.title = tip; foldBtn.setAttribute('aria-expanded', String(!folded));
    const key = fixed ? `${side}:${total}` : '';
    if (key !== reserved) { reserved = key; if (fixed) reserve(side === 'left' ? total : 0, side === 'right' ? total : 0); else reserve(0, 0); queueMicrotask(() => window.dispatchEvent(new Event('resize'))); }
    const marginEl = el('div', { 'data-sidebar-margin': '', style: `width:${MARGIN}px;flex:none;display:flex;flex-direction:column;align-items:center;pointer-events:none${fixed ? '' : ';position:sticky;top:0'}` }, foldBtn, sideBtn, fullBtn);
    if (folded) { panelEl.style.display = 'none'; host.replaceChildren(marginEl, panelEl); return; }
    panelEl.style.cssText = `position:relative;display:flex;flex-direction:column;background:var(--paper,#fff);box-sizing:border-box;overflow:hidden;min-width:0;width:${pw}px;pointer-events:auto;${fixed ? `border:0;border-${side === 'left' ? 'right' : 'left'}:1px solid var(--line)` : 'border:1px solid var(--line);border-radius:10px;position:sticky;top:0;height:calc(100vh - var(--sb-top, 0px));max-height:calc(100vh - var(--sb-top, 0px))'}`; // (in the flow the host is as tall as the page: the panel stays at the top of the window while the pages scroll, like the tabs of the parts)
    const cur = current();
    bar.replaceChildren(
      ...shown().map(([id, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === cur), 'data-tab': id, title: t.hint, 'aria-label': t.hint, onclick: () => api.show(id),
        style: `border:0;border-bottom:2px solid ${id === cur ? 'var(--tab-active,#1c1b1a)' : 'transparent'};border-radius:0;background:transparent;min-height:var(--ui-target,30px);padding:0 10px;font-weight:${id === cur ? '700' : '400'};cursor:pointer` }, t.title)),
      );
    for (const [id, t] of tabs) t.body.style.display = id === cur && t.visible && t.screen === screen ? '' : 'none';
    const head = headers[screen] ?? null; // a strip above the tabs (screen 2: the Paper / Tablet choice)
    panelEl.replaceChildren(...(head ? [head] : []), ...(fitOf() ? [bar, bodies] : [bar, bodies, grip()]));
    host.replaceChildren(marginEl, panelEl);
    placeStick();
  }
  /** The strip on the inner edge: drag it to resize the sidebar (a double tap puts the default width back). */
  function grip() {
    const g = el('div', { 'data-sidebar-grip': '', title: label('sidebar.width'), style: `position:absolute;top:0;bottom:0;${side === 'left' ? 'right' : 'left'}:0;width:8px;cursor:col-resize;touch-action:none;z-index:2;background:transparent` });
    let start = null;
    g.addEventListener('pointerdown', (e) => { start = { x: e.clientX, w: panelWidth() }; g.setPointerCapture?.(e.pointerId); e.preventDefault(); });
    g.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      widthPx = Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth(), start.w + (side === 'left' ? dx : -dx))));
      // no redraw while dragging (the strip being held must stay in the page): only the width and the room reserved at the edge move
      panelEl.style.width = `${widthPx}px`; host.style.width = `${MARGIN + widthPx}px`;
      if (fullHeight) { reserve(side === 'left' ? MARGIN + widthPx : 0, side === 'right' ? MARGIN + widthPx : 0); reserved = `${side}:${MARGIN + widthPx}`; }
    });
    const end = () => { if (start) { start = null; write(); draw(); emit(); window.dispatchEvent(new Event('resize')); } };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    g.addEventListener('dblclick', () => { widthPx = DEFAULT_WIDTH; write(); draw(); emit(); });
    return g;
  }

  const headers = { one: null, two: null, three: null }; // a node above the tabs, per screen
  const api = {
    /** A node shown above the tabs of a screen (null removes it): redrawn by the screen whenever it changes. */
    setHeader(which, node) { if (headers[which] === node) return; headers[which] = node; draw(); },
    isEnabled: () => enabledNow() && screen === 'one',
    isEnabledForParts: () => enabledNow() && screen === 'two',
    isEnabledForSheets: () => enabledNow() && screen === 'three',
    /** Which screen's tabs are shown ('one' = writing, 'two' = parts and page layout). */
    setScreen(next) { const s = next === 'two' || next === 'three' ? next : 'one'; if (s === screen) { draw(); return; } screen = s; side = sides[screen]; draw(); emit(); },
    screen: () => screen,
    setHidden(on) { if (hidden === !!on) return; hidden = !!on; draw(); emit(); },
    /** Registers a tab and returns its body (kept for the life of the page: components draw into it). */
    addTab(id, title, { visible = true, screen: tabScreen = 'one', hint = title } = {}) {
      if (tabs.has(id)) return tabs.get(id).body;
      const body = el('div', { 'data-sidebar-body': id, style: `display:none;min-height:100%${tabScreen === 'three' ? '' : ';background:var(--module,#fcfbf8)'}` });
      tabs.set(id, { title, hint, visible, body, screen: tabScreen });
      bodies.append(body);
      draw();
      return body;
    },
    removeTab(id) { const t = tabs.get(id); if (!t) return; t.body.remove(); tabs.delete(id); draw(); emit(); },
    /** Changes the title of a tab (a language change, a part renamed). */
    setTabTitle(id, title) { const t = tabs.get(id); if (!t || t.title === title) return; t.title = title; draw(); },
    tabBody: (id) => tabs.get(id)?.body ?? null,
    /** An exact width (px) for the sidebar while that tab is the one shown; null = the user's width again. */
    setTabFit(id, px) { const t = tabs.get(id); if (!t) return; const v = Number.isFinite(px) ? Math.round(px) : null; if (t.fit === v) return; t.fit = v; draw(); emit(); },
    setTabVisible(id, visible) { const t = tabs.get(id); if (!t || t.visible === visible) return; t.visible = visible; draw(); emit(); },
    /** Shows a tab (and unfolds the sidebar). */
    show(id) { const t = tabs.get(id); if (!t || t.screen !== screen) return; t.visible = true; activeBy[screen] = id; folded = false; write(); draw(); emit(); },
    /** True when the tab is the one on screen (sidebar enabled, unfolded, that tab current). */
    isTabShown: (id) => enabledNow() && tabs.get(id)?.screen === screen && !folded && current() === id,
    setFullHeight(v) { fullHeight = !!v; fullChosen = true; reserved = null; write(); draw(); emit(); },
    isFullHeight: () => fullHeight,
    setFolded(v) { folded = !!v; write(); draw(); emit(); },
    isFolded: () => folded,
    setSide(s) { side = s === 'left' ? 'left' : 'right'; sides[screen] = side; write(); draw(); emit(); },
    side: () => side,
    refresh: draw,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { reserve(0, 0); media?.removeEventListener?.('change', onMedia); listeners.clear(); host.replaceChildren(); },
  };
  const onMedia = () => { draw(); emit(); };
  media?.addEventListener?.('change', onMedia);
  draw();
  return api;
}
