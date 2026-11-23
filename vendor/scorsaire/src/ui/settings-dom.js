/*
 * Settings panel — DOM. The style options of a movement (indentation of the first system, spacing, courtesy signatures, tablature options…).
 * Same presentation rules as the staff properties panel: a sheet from the bottom on phones and tablets, a draggable floating window on
 * desktop (`panel-mode.js`); fixed in <body>, so the score never moves. Controls use `--ui-target`. Every control = one undoable transaction.
 */
import { SHEET_QUERY, panelMode, clampWindow } from './panel-mode.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { createChoiceMenu } from './choice-menu.js';
import { ICON_PHOTO_CREDITS } from '../model/icon-photos.js';

const STYLE_ID = 'settings-panel-style';
const CSS = `
[data-settings] { --sp-target: var(--ui-target, 30px); position: fixed; z-index: 60; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 2px 12px rgba(0,0,0,.3); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; overflow: auto; }
[data-settings][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 70vh; max-height: 70dvh; border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-settings][data-mode="floating"] { width: 400px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 8px; }
[data-settings] .st-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-settings][data-mode="floating"] .st-head { cursor: move; touch-action: none; }
[data-settings] .st-title { flex: 1 1 auto; font-weight: var(--w-semi,600); }
[data-settings] .st-section { padding: 8px 12px; border-bottom: 1px solid #e4e4e4; }
[data-settings] .st-section h3 { margin: 0 0 6px; font-size: 14px; }
[data-settings] .st-section > h3[data-fold] { cursor: pointer; display: flex; align-items: center; gap: 6px; min-height: var(--ui-target, 30px); user-select: none; margin: 0; }
[data-settings] .st-section > h3[data-fold]::before { content: '▸'; font-size: 12px; width: 1em; }
[data-settings] .st-section[data-open="true"] > h3[data-fold]::before { content: '▾'; }
[data-settings] .st-section[data-open="true"] > h3[data-fold] { margin-bottom: 6px; }
[data-settings] .st-section[data-open="false"] > :not(h3) { display: none; }
[data-settings] .st-row button:disabled { opacity: .35; }
[data-settings] .st-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); margin: 4px 0; }
[data-settings] .st-label { flex: 1 1 11em; }
[data-settings] .st-row[data-disabled="true"] { opacity: .5; }
[data-settings] button { min-width: var(--sp-target); min-height: var(--sp-target); padding: 0 10px; font: inherit; }
[data-settings] button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
[data-settings] .st-value { min-width: 3.5em; text-align: center; font-variant-numeric: tabular-nums; }
[data-settings] .st-foot { padding: 8px 12px; }
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
 * @param app      Application
 * @param options  { label(key, params) → text, movementIndex() → the movement shown by the main view, extraSections() → section elements placed first (display, interface, audio, demonstrations) }
 * @returns { open(), close(), toggle(), isOpen(), destroy() }
 */
export function mountSettingsPanel({ app, label = (k) => k, movementIndex = () => 0, extraSections = () => [], onChordPlacement = null, chordPlacementFiles = null }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let panel = null;
  let opened = false;
  let message = '';
  let dragged = null;
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  const mode = () => panelMode(media ? media.matches : false);

  const run = (fn) => {
    try { message = ''; fn(); } catch (e) { message = String(e?.message ?? e); }
    draw();
  };

  const place = () => {
    const m = mode();
    panel.setAttribute('data-mode', m);
    if (m === 'sheet') { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = ''; return; }
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
    const start = dragged ?? { left: vw - rect.width - 12, top: 60 };
    const pos = clampWindow({ ...start, width: rect.width, height: rect.height, viewportWidth: vw, viewportHeight: vh });
    panel.style.left = `${pos.left}px`; panel.style.top = `${pos.top}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  };

  const enableDrag = (head) => {
    let start = null;
    head.addEventListener('pointerdown', (e) => {
      if (mode() !== 'floating' || e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      start = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      head.setPointerCapture?.(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!start) return;
      const rect = panel.getBoundingClientRect();
      dragged = clampWindow({ left: e.clientX - start.dx, top: e.clientY - start.dy, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
      panel.style.left = `${dragged.left}px`; panel.style.top = `${dragged.top}px`;
    });
    const end = () => { start = null; };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  };

  const rowOf = (item) => {
    const mv = movementIndex();
    const name = label(`settings.${item.sid}`);
    const control = item.type === 'choice'
      ? createChoiceMenu({ options: item.options.map((o) => [o, label(`settings.${item.sid}.${o}`)]), value: item.value, label: name, act: `setting-${item.sid}`,
        onPick: (v) => run(() => app.setSetting(item.sid, v, mv)) })
      : item.type === 'bool'
      ? el('button', { type: 'button', 'data-setting': item.sid, 'aria-pressed': String(item.value === true), disabled: !item.enabled,
        onclick: () => run(() => app.setSetting(item.sid, !item.value, mv)) }, item.value ? label('settings.on') : label('settings.off'))
      : el('span', { class: 'st-row' },
        el('button', { type: 'button', 'data-setting': `${item.sid}-less`, 'aria-label': '−', disabled: !item.enabled || item.value <= item.min,
          onclick: () => run(() => app.setSetting(item.sid, item.value - item.step, mv)) }, '−'),
        el('span', { class: 'st-value', 'data-value': item.sid }, String(item.value)),
        el('button', { type: 'button', 'data-setting': `${item.sid}-more`, 'aria-label': '+', disabled: !item.enabled || item.value >= item.max,
          onclick: () => run(() => app.setSetting(item.sid, item.value + item.step, mv)) }, '+'));
    const reset = el('button', { type: 'button', 'data-setting': `${item.sid}-reset`, title: label('settings.reset'), 'aria-label': label('settings.reset'), disabled: !item.local,
      onclick: () => run(() => app.resetSetting(item.sid, mv)) }, '↺'); // always there (greyed at the default) so the control never changes place
    return el('div', { class: 'st-row', 'data-disabled': String(!item.enabled) }, el('span', { class: 'st-label' }, name), control, reset);
  };

  function draw() {
    if (!opened) return;
    const mv = movementIndex();
    const sections = app.settings(mv);
    if (!panel) {
      panel = el('div', { 'data-settings': '', 'data-resizable': 'settings', 'data-zoom-lock': '', role: 'dialog', 'aria-label': label('settings.title') });
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } });
      panel.addEventListener('panelmoved', (e) => { dragged = { left: e.detail.left, top: e.detail.top }; });
      document.body.append(panel);
    }
    const head = el('div', { class: 'st-head' }, el('span', { class: 'st-title' }, label('settings.title')),
      el('button', { type: 'button', 'data-setting': 'close', 'aria-label': label('settings.close'), title: label('settings.close'), onclick: () => api.close() }, '✕'));
    enableDrag(head);
    const status = el('div', { role: 'status', style: 'min-height:20px;padding:2px 12px;color:var(--danger-ink,#b00020)', 'data-settings-message': '' }, message);
    const body = [...extraSections(), ...sections.map((s) => el('section', { class: 'st-section', 'data-section': s.id }, el('h3', {}, label(`settings.section.${s.id}`)), ...s.items.map(rowOf),
      s.id === 'chords' && onChordPlacement ? el('div', { class: 'st-row' }, el('button', { type: 'button', 'data-setting': 'chord-placement', onclick: () => onChordPlacement() }, label('chordPlacement.open'))) : null,
      s.id === 'chords' && chordPlacementFiles ? el('div', { class: 'st-row' },
        el('button', { type: 'button', 'data-setting': 'chord-placement-export', onclick: () => chordPlacementFiles.export() }, label('chordPlacement.export')),
        el('button', { type: 'button', 'data-setting': 'chord-placement-import', onclick: async () => { message = await chordPlacementFiles.import(); draw(); } }, label('chordPlacement.import'))) : null))];
    // per-track overrides: one row per track, one 3-state button per option (follows the movement → yes → no → follows…)
    const tracks = app.trackSettings(mv);
    if (tracks.length) {
      const next = (v) => (v === null ? true : v === true ? false : null);
      const text = (o) => (o.value === null ? `${label('settings.follow')} (${o.inherited ? label('settings.on') : label('settings.off')})` : o.value ? label('settings.on') : label('settings.off'));
      body.push(el('section', { class: 'st-section', 'data-section': 'tracks' }, el('h3', {}, label('settings.section.tracks')),
        el('p', { style: 'margin:0 0 6px;font-size:12px;color:var(--ink-soft,#555)' }, label('settings.tracksHint')),
        ...tracks.map((t) => el('div', { class: 'st-track', 'data-track': t.id, style: 'margin:6px 0' },
          el('div', { style: 'font-weight:var(--w-semi,600)' }, t.name),
          ...t.options.map((o) => o.type === 'number' ? el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label(`settings.${o.sid}`)),
            el('button', { type: 'button', 'data-track-setting': `${t.id}|${o.sid}|less`, 'aria-label': '−', disabled: (o.value ?? o.inherited) <= o.min, onclick: () => run(() => app.setTrackSetting(t.id, o.sid, Math.max(o.min, (o.value ?? o.inherited) - o.step))) }, '−'),
            el('span', { class: 'st-value', 'data-track-value': `${t.id}|${o.sid}` }, o.value === null ? `${label('settings.follow')} (${o.inherited || label('settings.auto')})` : (o.value || label('settings.auto'))),
            el('button', { type: 'button', 'data-track-setting': `${t.id}|${o.sid}|more`, 'aria-label': '+', disabled: (o.value ?? o.inherited) >= o.max, onclick: () => run(() => app.setTrackSetting(t.id, o.sid, Math.min(o.max, (o.value ?? o.inherited) + o.step))) }, '+'),
            el('button', { type: 'button', 'data-track-setting': `${t.id}|${o.sid}|reset`, title: label('settings.reset'), 'aria-label': label('settings.reset'), disabled: o.value === null, onclick: () => run(() => app.setTrackSetting(t.id, o.sid, null)) }, '↺'))
          : el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label(`settings.${o.sid}`)),
            el('button', { type: 'button', 'data-track-setting': `${t.id}|${o.sid}`, 'aria-pressed': String(o.value !== null),
              onclick: () => run(() => app.setTrackSetting(t.id, o.sid, next(o.value))) }, text(o))))))));
    }
    // the tracks panel: collapse everything when it opens, or keep what the user opened (a preference of THIS DEVICE)
    const openMode = app.preferences.get('tracksPanel')?.openMode ?? 'closeAll';
    body.push(el('section', { class: 'st-section', 'data-section': 'device' }, el('h3', {}, label('settings.section.device')),
      el('p', { style: 'margin:0 0 6px;font-size:12px;color:var(--ink-soft,#555)' }, label('settings.exportHint')),
      el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('tracksPanel.openMode.label')),
        ...['closeAll', 'remember'].map((mode) => el('button', { type: 'button', 'data-tracks-open-mode': mode, 'aria-pressed': String(openMode === mode),
          onclick: () => { app.preferences.set('tracksPanel', { openMode: mode }); draw(); } }, label(`tracksPanel.openMode.${mode}`))))));
    // the soprano saxophone photograph (a joke): one button switches it off (clarinet icon), the other brings it back
    const photoOn = app.preferences.get('instrumentIcons')?.sopranoPhoto !== false;
    body.push(el('section', { class: 'st-section', 'data-section': 'instrument-icons' }, el('h3', {}, label('instrumentIcons.title')),
      el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('instrumentIcons.soprano')),
        el('button', { type: 'button', 'data-soprano-photo': photoOn ? 'off' : 'on', 'aria-pressed': 'false',
          onclick: () => { app.preferences.set('instrumentIcons', { sopranoPhoto: !photoOn }); draw(); } }, label(photoOn ? 'instrumentIcons.dentist' : 'instrumentIcons.restore'))),
      el('p', { style: 'margin:6px 0 0;font-size:12px;color:var(--ink-soft,#555)', 'data-photo-credit': '' }, el('a', { href: ICON_PHOTO_CREDITS['soprano-photo'].source, target: '_blank', rel: 'noopener' }, label('instrumentIcons.credit')))));
    // exports: a preference of THIS DEVICE (not of the document): what a tablature linked to a notation staff becomes in a MusicXML file
    const linkedMode = app.preferences.get('exportOptions')?.linkedStaves ?? 'twoStaves';
    body.push(el('section', { class: 'st-section', 'data-section': 'export' }, el('h3', {}, label('settings.section.export')),
      el('p', { style: 'margin:0 0 6px;font-size:12px;color:var(--ink-soft,#555)' }, label('settings.exportHint')),
      el('div', { class: 'st-row' }, el('span', { class: 'st-label' }, label('export.linked.label')),
        ...['twoStaves', 'separateParts', 'notationOnly'].map((mode) => el('button', { type: 'button', 'data-export-linked': mode, 'aria-pressed': String(linkedMode === mode),
          onclick: () => { app.preferences.set('exportOptions', { linkedStaves: mode }); draw(); } }, label(`export.linked.${mode}`))))));
    const foot = el('div', { class: 'st-foot' }, el('button', { type: 'button', 'data-setting': 'reset-all', onclick: () => run(() => app.resetAllSettings(mv)) }, label('settings.resetAll')));
    // sections fold (all closed on first opening); what is open is kept on this device
    const openIds = new Set(app.preferences.get('settingsFold')?.open ?? []);
    const folds = [];
    const saveFolds = () => app.preferences.set('settingsFold', { open: [...openIds] });
    for (const sec of body) {
      const h = sec?.querySelector?.(':scope > h3'); if (!h) continue;
      const id = sec.getAttribute('data-section') ?? h.textContent;
      const apply = () => { sec.setAttribute('data-open', String(openIds.has(id))); h.setAttribute('aria-expanded', String(openIds.has(id))); };
      h.setAttribute('data-fold', ''); h.setAttribute('role', 'button'); h.tabIndex = 0;
      const toggle = () => { if (openIds.has(id)) openIds.delete(id); else openIds.add(id); apply(); saveFolds(); };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      apply(); folds.push({ id, apply });
    }
    const setAll = (open) => { for (const f of folds) { if (open) openIds.add(f.id); else openIds.delete(f.id); f.apply(); } saveFolds(); };
    const foldBar = el('div', { class: 'st-row', style: 'padding:4px 12px;margin:0' },
      el('button', { type: 'button', 'data-setting': 'fold-all', onclick: () => setAll(true) }, label('settings.expandAll')),
      el('button', { type: 'button', 'data-setting': 'fold-none', onclick: () => setAll(false) }, label('settings.collapseAll')));
    panel.replaceChildren(head, status, foldBar, ...body, foot);
    place();
  }

  const onResize = () => { if (panel) place(); };
  window.addEventListener('resize', onResize);
  media?.addEventListener?.('change', onResize);
  const off = app.doc.subscribe(() => { if (opened) draw(); });
  let dismissedAt = -1e9; // a press on the button that opens the panel closes it (outside press) then clicks: the click must not reopen it
  const offOutside = dismissOnOutside(() => panel, () => { dismissedAt = Date.now(); api.close(); });

  const api = {
    open(sectionId = null) {
      opened = true; message = ''; draw();
      if (sectionId) panel?.querySelector(`[data-section="${sectionId}"]`)?.scrollIntoView?.({ block: 'start' });
    },
    close() { opened = false; panel?.remove(); panel = null; },
    toggle() { if (opened) api.close(); else if (Date.now() - dismissedAt > 400) api.open(); },
    isOpen: () => opened,
    destroy() { api.close(); off(); offOutside(); window.removeEventListener('resize', onResize); media?.removeEventListener?.('change', onResize); },
  };
  return api;
}
