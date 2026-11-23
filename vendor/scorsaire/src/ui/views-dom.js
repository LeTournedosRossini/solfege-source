/*
 * Views bar — DOM. Tabs for the named views of the movement ("All" first), a button to save the current choice as a view, an edit button for the
 * active view and a solo switch (playback only). The bar has a fixed height (one scrolling row), so the score never moves. A view only changes what
 * is shown on the score; every change is one undoable transaction, except the solo switch (session state).
 */
import { createSwitch } from './switch.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { createTabDrag } from './tab-drag.js';

const STYLE_ID = 'views-bar-style';
const CSS = `
[data-views-bar] { display: flex; align-items: center; gap: var(--btn-gap, 2px); overflow-x: auto; white-space: nowrap; min-height: calc(var(--ui-target, 30px) + 6px); padding: 3px 4px; box-sizing: border-box; border-bottom: 1px solid var(--line,#ddd); font: 14px var(--ui-font,sans-serif); -webkit-touch-callout: none; user-select: none; }
[data-views-bar] button { min-width: var(--ui-target, 30px); min-height: var(--ui-target, 30px); padding: 0 10px; font: inherit; flex: 0 0 auto; }
[data-views-bar] button[aria-selected="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); font-weight: var(--w-semi,600); }
[data-views-bar] button:disabled { opacity: .4; }
[data-views-bar] button[aria-pressed="true"] { background: var(--warn-soft,#ffe9b3); border: 2px solid #c58a00; }
[data-views-bar] button[data-drop="before"] { box-shadow: -4px 0 0 var(--sel-edge,#2878ff); }
[data-views-bar] button[data-drop="after"] { box-shadow: 4px 0 0 var(--sel-edge,#2878ff); }
[data-views-bar] button[data-dragging] { opacity: .5; }
[data-views-bar] .vw-sep { flex: 1 1 auto; }
[data-views-dialog] { position: fixed; z-index: 70; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 2px 12px rgba(0,0,0,.3); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; overflow: auto; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(420px, calc(100vw - 16px)); max-height: calc(100vh - 16px); border-radius: 8px; padding: 10px 12px; }
@media (pointer: coarse), (max-width: 900px) { [data-views-dialog] { top: auto; bottom: 0; transform: translateX(-50%); width: min(720px, 100vw); max-height: 75vh; border-radius: 12px 12px 0 0; padding-bottom: calc(10px + env(safe-area-inset-bottom)); } }
[data-views-dialog] h3 { margin: 0 0 8px; font-size: 15px; }
[data-views-dialog] input[type="text"] { font-size: 16px; width: 100%; box-sizing: border-box; min-height: var(--ui-target, 30px); }
[data-views-dialog] label.vw-check { display: flex; align-items: center; gap: var(--btn-gap, 2px); min-height: var(--ui-target, 30px); }
[data-views-dialog] .vw-staves { margin-left: 28px; }
[data-views-dialog] .vw-actions { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); margin-top: 10px; }
[data-views-dialog] button { min-width: var(--ui-target, 30px); min-height: var(--ui-target, 30px); padding: 0 12px; font: inherit; }
[data-views-dialog] input[type="checkbox"] { width: 20px; height: 20px; }
`;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};

/**
 * @param host  element that receives the bar
 * @param app   Application
 * @param label (key, params) → text
 * @param movementIndex () → index of the movement shown
 * @returns { refresh, destroy }
 */
export function mountViewsBar(host, { app, label, movementIndex = () => 0 }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const bar = el('div', { 'data-views-bar': '', role: 'tablist', 'aria-label': label('views.title') });
  host.replaceChildren(bar);
  let dialog = null;
  let stopDismiss = () => {};

  const run = (fn) => { try { return fn(); } catch (e) { if (e?.name === 'ViewEditError' || e?.name === 'TrackEditError') { message(label(`views.error.${e.code}`) ); return undefined; } throw e; } };
  const message = (text) => { bar.querySelector('[data-views-msg]')?.replaceChildren(text); };

  const trackName = (t, i) => t.name || label('tracks.defaultName', { n: i + 1 });

  const closeDialog = () => { dialog?.remove(); dialog = null; stopDismiss(); stopDismiss = () => {}; };

  /** Editor: a name and a checkbox per track (and per staff when a track has several). `viewId` null = a new view from what is shown now. */
  const openEditor = (viewId) => {
    closeDialog();
    const mi = movementIndex();
    const outline = app.tracksOutline()[mi];
    const state = app.namedViews(mi);
    const view = viewId ? state.views.find((v) => v.id === viewId) : null;
    // chosen: trackId → Set of staff ids (all staves of the track when the track is whole)
    const chosen = new Map();
    for (const t of outline.tracks) {
      const entry = view ? view.tracks.find((vt) => vt.id === t.id) : (t.visible && t.staves.some((s) => s.visible) ? { id: t.id, staves: t.staves.every((s) => s.visible) ? undefined : t.staves.filter((s) => s.visible).map((s) => s.id) } : null);
      if (entry) chosen.set(t.id, new Set(entry.staves ?? t.staves.map((s) => s.id)));
    }
    const nameInput = el('input', { type: 'text', 'data-views-name': '', value: view?.name ?? '', maxlength: 40, placeholder: label('views.namePlaceholder'), 'aria-label': label('views.name') });
    const msg = el('div', { 'data-views-dialog-msg': '', role: 'status', style: 'min-height:1.3em;color:var(--danger-ink,#a00)' });
    const list = el('div');
    const drawList = () => {
      list.replaceChildren(...outline.tracks.map((t, i) => {
        const on = chosen.has(t.id);
        const cb = createSwitch({ checked: on, text: trackName(t, i), attrs: { 'data-track': t.id }, onchange: () => { if (cb.checked) chosen.set(t.id, new Set(t.staves.map((s) => s.id))); else chosen.delete(t.id); drawList(); } });
        const rows = [el('div', { class: 'vw-check' }, cb)];
        if (on && t.staves.length > 1) {
          rows.push(el('div', { class: 'vw-staves' }, t.staves.map((s) => {
            const sc = createSwitch({ checked: chosen.get(t.id).has(s.id), text: label(`staffType.${s.type}`), attrs: { 'data-staff': s.id }, onchange: () => { const set = chosen.get(t.id); if (sc.checked) set.add(s.id); else set.delete(s.id); if (!set.size) chosen.delete(t.id); drawList(); } });
            return el('div', { class: 'vw-check' }, sc);
          })));
        }
        return el('div', {}, rows);
      }));
    };
    drawList();
    const body = () => outline.tracks.filter((t) => chosen.has(t.id)).map((t) => {
      const set = chosen.get(t.id);
      return set.size === t.staves.length ? { id: t.id } : { id: t.id, staves: t.staves.filter((s) => set.has(s.id)).map((s) => s.id) };
    });
    const save = () => {
      const tracks = body();
      if (!tracks.length) { msg.textContent = label('views.error.empty'); return; }
      try {
        if (view) {
          if (nameInput.value.trim() && nameInput.value.trim() !== view.name) app.renameNamedView(view.id, nameInput.value, mi);
          app.setNamedViewTracks(view.id, tracks, mi);
        } else {
          const id = app.createNamedView(nameInput.value, tracks, mi);
          app.applyNamedView(id, mi);
        }
        closeDialog();
      } catch (e) { msg.textContent = label(`views.error.${e.code ?? 'refused'}`); }
    };
    const actions = el('div', { class: 'vw-actions' },
      el('button', { type: 'button', 'data-action': 'view-save', onclick: save }, label('views.save')),
      el('button', { type: 'button', 'data-action': 'view-cancel', onclick: closeDialog }, label('views.cancel')),
      view ? el('button', { type: 'button', 'data-action': 'view-delete', onclick: () => { run(() => app.removeNamedView(view.id, mi)); closeDialog(); } }, label('views.delete')) : null);
    dialog = el('div', { 'data-views-dialog': '', 'data-resizable': 'viewsDialog', 'data-zoom-lock': '', role: 'dialog', 'aria-modal': 'false', 'aria-label': label(view ? 'views.edit' : 'views.add') },
      el('h3', {}, label(view ? 'views.edit' : 'views.add')), nameInput, el('p', { style: 'margin:8px 0 2px' }, label('views.tracks')), list, msg, actions);
    dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); } });
    document.body.append(dialog);
    stopDismiss = dismissOnOutside(() => dialog, closeDialog);
    nameInput.focus();
  };

  const tabDrag = createTabDrag({
    row: bar, tabs: () => [...bar.querySelectorAll('[role=tab][data-view]:not([data-view="all"])')], idOf: (t) => t.dataset.view,
    onMove: (id, index) => run(() => app.moveNamedView(id, index, movementIndex())),
  });

  const draw = () => {
    const mi = movementIndex();
    const state = app.namedViews(mi);
    const solo = app.viewSolo();
    const tab = (id, text, selected) => {
      const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(selected), 'data-view': id ?? 'all', onclick: () => { if (tabDrag.consumeClick()) return; if (!selected) run(() => app.applyNamedView(id, mi)); } }, text);
      if (id) b.addEventListener('pointerdown', (e) => tabDrag.start(e, b, id));
      return b;
    };
    const active = state.active;
    bar.replaceChildren(
      tab(null, label('views.all'), !active && state.all),
      ...state.views.map((v) => tab(v.id, v.name, v.id === active)),
      el('button', { type: 'button', 'data-action': 'view-add', title: label('views.add'), 'aria-label': label('views.add'), onclick: () => openEditor(null) }, '＋'),
      el('button', { type: 'button', 'data-action': 'view-edit', title: label('views.edit'), 'aria-label': label('views.edit'), disabled: !active, onclick: () => openEditor(active) }, '✎'),
      el('span', { class: 'vw-sep' }),
      el('button', { type: 'button', 'data-action': 'view-solo', title: label('views.solo'), 'aria-label': label('views.solo'), 'aria-pressed': String(solo), disabled: !active && !solo, onclick: () => app.setViewSolo(!app.viewSolo()) }, '🔊 solo'));
  };

  const stopDoc = app.onHistoryChange(() => draw());
  const stopSolo = app.onViewSoloChange(() => draw());
  draw();
  return {
    refresh: draw,
    destroy() { closeDialog(); stopDoc?.(); stopSolo(); host.replaceChildren(); },
  };
}
