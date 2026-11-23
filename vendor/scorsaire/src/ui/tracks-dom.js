/*
 * Tracks and staves panel — DOM (slice 1: list, add, remove, reorder; opens the staff properties panel).
 *
 * Presentation as the staff properties panel: a sheet from the bottom on phones and tablets, a draggable floating window on desktop
 * (`panel-mode.js`), added to <body> so the score never moves. Controls follow the global `--ui-target` size.
 * A track row holds its staves (a grand staff is ONE track with two staves). Every control calls one intent of the Application
 * (one undoable transaction); a refused gesture shows a message in the panel instead of crashing.
 */
import { createSwitch } from './switch.js';
import { bindShortLong } from './button-behavior.js';
import { trackAudioButton } from './track-audio-button.js';
import { trackDisplayRow } from './track-display-dom.js';
import { DEFAULT_DISPLAY } from '../model/trackdisplay.js';
import { SHEET_QUERY, panelMode, clampWindow } from './panel-mode.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { createChoiceMenu } from './choice-menu.js';
import { CREATABLE_STAFF_TYPES, BRACKET_STYLES, SCORE_ORDERS, ICONS, transpositionOptions, semitoneChoiceId } from './tracks-intents.js';
import { icon, instrumentIconNode } from './icons.js';
import { createInstrumentPicker } from './instrument-picker.js';
import { openStaffTypeDialog } from './stafftype-dialog.js';
import { createTemplatePicker } from './template-picker.js';
import { compositeSection } from './composite-dom.js';
import { playerSection } from './accompaniment-dom.js';
import { ACCOMPANIMENT_ROLES } from '../model/player.js';

const STYLE_ID = 'tracks-panel-style';
const CSS = `
[data-tracks-panel] { --tp-target: var(--ui-target, 30px); position: fixed; z-index: 60; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 2px 12px rgba(0,0,0,.3); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; overflow: auto; }
[data-tracks-panel][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 70vh; border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-tracks-panel][data-mode="docked"] { position: static; width: auto; max-height: none; border: 0; box-shadow: none; overflow: visible; }
[data-tracks-panel][data-mode="floating"] { width: 420px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 8px; }
[data-tracks-panel] .tp-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: var(--btn-gap, 2px); flex-wrap: wrap; padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-tracks-panel][data-mode="floating"] .tp-head { cursor: move; touch-action: none; }
[data-tracks-panel] .tp-title { flex: 1 1 auto; font-weight: var(--w-semi,600); }
[data-tracks-panel] .tp-head button { white-space: nowrap; }
[data-tracks-panel][data-mode="docked"] { background: var(--module, var(--module,#fcfbf8)); }
[data-tracks-panel] .tp-toggle[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border-color: var(--btn-on-line, #b9b4a8); }
[data-tracks-panel] .tp-drop::after { content: '▾'; margin-left: 6px; font-size: 12px; }
[data-tracks-panel] .tp-drop[aria-expanded="true"]::after { content: '▴'; }
[data-tracks-panel][data-mode="docked"] .tp-head button { flex: 1 1 0; }
[data-tracks-panel] button, [data-tracks-panel] .cm-button { min-width: var(--tp-target); min-height: var(--tp-target); padding: 0 10px; font: inherit; }
[data-tracks-panel] button[disabled] { opacity: .35; }
[data-tracks-panel] .tp-movement { padding: 6px 4px 0 6px; font-weight: var(--w-semi,600); color: var(--ink-soft,#555); }
[data-tracks-panel] .tp-movement .tp-row { padding-left: 4px; }
[data-tracks-panel] .tp-movement input { min-height: var(--tp-target); box-sizing: border-box; font: inherit; font-size: 16px; padding: 0 8px; border: 1px solid var(--edge,#bbb); border-radius: 6px; background: var(--field,#fff); color: var(--ink,#111); }
[data-tracks-panel] .tp-numformat label { display: flex; align-items: center; gap: var(--btn-gap, 2px); }
[data-tracks-panel] .tp-numformat input { width: 9em; min-height: var(--tp-target); box-sizing: border-box; font-size: 16px; padding: 0 8px; border: 1px solid var(--edge,#bbb); border-radius: 6px; }
[data-tracks-panel] .tp-card-num { width: 4.5em; flex: 0 0 auto; text-align: center; }
[data-tracks-panel] .tp-card-title, [data-tracks-panel] .tp-card-desc { flex: 1 1 auto; min-width: 0; }
[data-tracks-panel] .tp-card-desc { font-weight: 400; font-size: 14px; }
[data-tracks-panel] .tp-track { margin: 6px 8px; border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--soft,#fafafa); }
[data-tracks-panel] .tp-row button[data-key$="-visible"], [data-tracks-panel] .tp-row button[data-key$="-remove"], [data-tracks-panel] .tp-row button[data-key="staff-props"] { width: var(--ui-target, 30px); min-width: var(--ui-target, 30px); padding: 0; flex: none; display: inline-flex; align-items: center; justify-content: center; }
[data-tracks-panel] .tp-row { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 4px 6px 4px 10px; }
[data-tracks-panel] .tp-track > .tp-row:first-child { background: var(--row, #cacad2); border-radius: 8px 8px 0 0; font-weight: var(--w-semi,600); }
[data-tracks-panel] .tp-staff { padding-left: 22px; }
/* track cards: a little lower, the grip close to the left edge and to the arrow that opens the zone */
[data-tracks-panel] .tp-track > .tp-row:first-child { --tp-small: calc(var(--tp-target) - 6px); padding: 1px 6px 1px 2px; }
[data-tracks-panel] .tp-track > .tp-row:first-child button[data-ms] { min-height: var(--tp-small) !important; min-width: var(--tp-small) !important; height: var(--tp-small); padding: 0 !important; font-size: 10px !important; }
[data-tracks-panel] .tp-track > .tp-row:first-child button { min-height: var(--tp-small); }
[data-tracks-panel] .tp-track > .tp-row:first-child button[data-key$="-visible"], [data-tracks-panel] .tp-track > .tp-row:first-child button[data-key$="-shown"], [data-tracks-panel] .tp-track > .tp-row:first-child button[data-key$="-remove"] { width: var(--tp-small); min-width: var(--tp-small); }
[data-tracks-panel] .tp-track > .tp-row:first-child button.tp-grip { width: 16px; min-width: 16px; }
[data-tracks-panel] .tp-track > .tp-row:first-child button.tp-toggle { padding: 0 4px 0 0; }
[data-tracks-panel] .tp-open { border-top: 1px solid var(--line,#ddd); }
[data-tracks-panel] button.tp-toggle { display: flex; align-items: center; gap: var(--btn-gap, 2px); cursor: pointer; font-weight: var(--w-semi,600); }
[data-tracks-panel] button.tp-toggle .tp-toggle-text { overflow: hidden; text-overflow: ellipsis; }
[data-tracks-panel] .tp-spacer { flex: 1 1 auto; }
[data-tracks-panel] [data-transposed="true"] button { background: var(--accent-soft,#d6e6ff); border-color: var(--sel-edge,#2d78ff); }
[data-tracks-panel] .tp-hidden { opacity: .55; }
[data-tracks-panel] .tp-silent { opacity: .55; }
[data-tracks-panel] .tp-accomp { margin-top: 8px; border-top: 1px solid var(--edge, #b9b4a8); padding-top: 4px; }
[data-tracks-panel] .tp-accomp-head { justify-content: space-between; flex-wrap: wrap; }
[data-tracks-panel] .tp-accomp-names { opacity: .55; font-size: 12px; padding: 2px 10px 4px 28px; }
[data-tracks-panel] .tp-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-tracks-panel] button.tp-name { min-width: 0; text-align: left; border: 1px solid transparent; background: transparent; padding: 0 6px; cursor: text; }
[data-tracks-panel] button.tp-name[data-default] { color: var(--ink-soft,#666); font-style: italic; }
[data-tracks-panel] input.tp-name-input { flex: 1 1 auto; min-width: 0; min-height: var(--tp-target); box-sizing: border-box; padding: 0 8px; font: 16px var(--ui-font,sans-serif); color: var(--ink,#111); border: 1px solid #1c1b1a; border-radius: 6px; background: var(--field,#fff); }
[data-tracks-panel] button.tp-grip { flex: 0 0 auto; min-width: var(--tp-target); padding: 0; border: 1px solid transparent; background: transparent; color: var(--ink-soft,#666); font-size: 18px; line-height: 1; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
[data-tracks-panel] button.tp-grip:active { cursor: grabbing; }
[data-tracks-panel] .tp-dragging { opacity: .45; }
[data-tracks-panel] .tp-drop-before { box-shadow: 0 -3px 0 0 #0b6bcb; }
[data-tracks-panel] .tp-drop-after { box-shadow: 0 3px 0 0 #0b6bcb; }
[data-tracks-panel][data-dragging] { user-select: none; -webkit-user-select: none; }
[data-tracks-panel] .tp-meta { flex-wrap: wrap; font-weight: 400; background: var(--soft,#f6f6f6); }
[data-tracks-panel] .tp-meta-label { color: var(--ink-soft,#555); font-size: 13px; }
[data-tracks-panel] button.tp-abbr { min-width: 5em; text-align: left; border: 1px solid var(--edge,#ccc); border-radius: 6px; background: var(--field,#fff); padding: 0 8px; }
[data-tracks-panel] button.tp-abbr[data-default] { color: var(--ink-faint,#888); font-style: italic; }
[data-tracks-panel] .tp-status { min-height: 20px; padding: 2px 12px; color: var(--danger-ink,#b00020); }
[data-tracks-panel] .tp-status:empty { min-height: 0; padding: 0; }
[data-tracks-panel] .tp-empty { padding: 12px; color: var(--ink-soft,#666); }
[data-tracks-panel] .tp-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 12px; border-bottom: 1px solid var(--line,#ddd); }
[data-tracks-panel] .tp-tools label { display: inline-flex; align-items: center; gap: var(--btn-gap, 2px); min-height: var(--tp-target); }
[data-tracks-panel] .tp-group { margin: 6px 8px; padding: 0 0 4px; border: 2px solid #8a93a8; border-radius: 10px; background: var(--soft,#f3f5fa); }
[data-tracks-panel] .tp-group > .tp-row { flex-wrap: wrap; font-weight: var(--w-semi,600); }
[data-tracks-panel] .tp-group .tp-track { margin: 6px 8px; }
[data-tracks-panel] input.tp-group-label { flex: 1 1 8em; min-width: 6em; min-height: var(--tp-target); box-sizing: border-box; padding: 0 8px; font: 16px var(--ui-font,sans-serif); border: 1px solid #aaa; border-radius: 6px; background: var(--field,#fff); }
[data-tracks-panel] .tp-pick { display: inline-flex; align-items: center; justify-content: center; min-width: var(--tp-target); min-height: var(--tp-target); }
[data-tracks-panel] .tp-pick input { width: 22px; height: 22px; }
[data-tracks-panel] .tp-grouping { padding: 8px 12px; background: var(--warn-soft,#fff7dd); border-bottom: 1px solid #e0cf8a; display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; }
`;

/** Injects the panel stylesheet once (shared by the per-part panel of screen 2, which looks the same). */
export function ensureTracksStyle() {
  if (!document.getElementById(STYLE_ID)) document.head.append(Object.assign(document.createElement('style'), { id: STYLE_ID, textContent: CSS }));
}

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
 * @param options  { label(key, params) → text, onStaffProps(staffId) }
 * @returns { open(), close(), toggle(), isOpen(), destroy() }
 */
export function mountTracksPanel({ app, label = (k) => k, onStaffProps = null, onPlayer = null, onStyles = null, onCues = null, onGrids = null, onRealize = null, onLyricEvents = null, lang = 'en', sidebar = null }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let panel = null;
  let opened = false;
  let message = '';
  let dragged = null;
  /** Ids of the tracks whose zone is open (names, icon, transposition, staves). Collapsed by default: only the grey row shows. */
  const openTracks = new Set();
  const photoOn = () => app.preferences.get('instrumentIcons')?.sopranoPhoto !== false;
  const openMode = () => app.preferences.get('tracksPanel')?.openMode ?? 'closeAll';
  /** { trackId, draft, fresh } while a track name is being typed; `fresh` = focus and select the field on the next draw. */
  let editing = null;
  /** True while draw() swaps the DOM: the blur fired by removing the focused field must not commit. */
  let redrawing = false;
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  // on a computer the panel lives in the sidebar (a tab), never as a floating window
  const docked = () => !!sidebar?.isEnabled();
  const mode = () => (docked() ? 'docked' : panelMode(media ? media.matches : false));

  const typeOptions = () => CREATABLE_STAFF_TYPES.map((type) => [type, label(`staffType.${type}`)]);
  const run = (fn) => {
    try { message = ''; fn(); } catch (e) {
      if (e.name !== 'TrackEditError') throw e;
      message = label(`tracks.refused.${e.code}`);
    }
    draw();
  };
  const iconButton = (key, text, title, onclick, disabled = false) =>
    el('button', { type: 'button', 'data-key': key, 'aria-label': title, title, disabled, onclick }, text);
  const menu = (act, text, options, onPick, { columns = 0, current = null } = {}) => {
    const b = createChoiceMenu({ options, value: '', onPick, label: text, act, columns });
    const shown = current ? options.find((o) => o[0] === current)?.[3] : null;
    if (shown) b.firstChild.replaceChildren(shown()); else b.firstChild.textContent = text;
    return b;
  };

  const trackName = (track, n) => track.name || label('tracks.defaultName', { n });
  const hasProps = (staffId) => !!onStaffProps && app.hasStaffProperties(staffId);

  // ---------- track name: a tap on the name turns it into a text field; Enter / leaving the field validates, Escape cancels ----------
  // One validation = one transaction (nothing is written while typing); an unchanged or empty name writes nothing / goes back to "Track n".
  const startEdit = (track, field = 'name') => { editing = { trackId: track.id, field, draft: field === 'abbr' ? track.abbreviation : track.name, fresh: true }; message = ''; draw(); };
  const commitEdit = () => {
    if (!editing) return;
    const { trackId, draft, field } = editing;
    editing = null;
    run(() => (field === 'abbr' ? app.setTrackAbbreviation(trackId, draft) : app.renameTrack(trackId, draft)));
  };
  const cancelEdit = () => { if (!editing) return; editing = null; draw(); };
  const onNameKey = (e) => {
    if (e.isComposing) return; // an IME is still choosing the text
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  };
  /** Short name (abbreviation) of a track: written on the systems after the first one; a tap turns it into a field like the name. */
  const abbrCell = (track) => {
    if (editing?.trackId === track.id && editing.field === 'abbr') {
      return el('input', { type: 'text', class: 'tp-name-input', 'data-field': 'abbr', 'data-key': `track-abbr-${track.id}`, value: editing.draft, placeholder: label('tracks.abbr.placeholder'),
        'aria-label': label('tracks.abbr.label'), enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false',
        oninput: (e) => { if (editing) editing.draft = e.target.value; }, onkeydown: onNameKey, onblur: () => { if (!redrawing) commitEdit(); } });
    }
    return el('button', { type: 'button', class: 'tp-abbr', 'data-key': `track-abbr-${track.id}`, 'data-default': !track.abbreviation, title: label('tracks.abbr.label'),
      'aria-label': label('tracks.abbr.label'), onclick: () => startEdit(track, 'abbr') }, track.abbreviation || label('tracks.abbr.placeholder'));
  };
  const iconMenu = (track) => menu('track-icon', track.icon ? label(`icon.${track.icon}`) : label('tracks.icon.auto'),
    [['', label('tracks.icon.auto')], ...ICONS.map((i) => [i, label(`icon.${i}`)])], (icon) => run(() => app.setTrackIcon(track.id, icon || null)));

  // variants: tracks tagged as alternatives of one part; the pill on the track row switches to the next one (shows it and plays it, hides and mutes the others)
  const variantPill = (track) => el('button', { type: 'button', class: 'tp-variant', 'data-key': 'track-variant', 'aria-pressed': String(track.variant.active),
    title: label('tracks.variant.switch'), 'aria-label': label('tracks.variant.switch'), style: `flex:none;min-height:var(--ui-target,30px);padding:0 8px;border-radius:8px;border:1px solid var(--edge,#c9c4b8);background:${track.variant.active ? 'var(--accent-soft,#f3e7c8)' : 'var(--field,#fff)'};font-weight:${track.variant.active ? 600 : 400};max-width:7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`,
    onclick: () => run(() => app.nextVariant(track.id)) }, track.variant.label);
  const variantRow = (track, siblings) => {
    const others = siblings.filter((t) => t.id !== track.id);
    const options = [['', label('tracks.variant.none')], ...others.map((t) => [t.id, label('tracks.variant.of', { name: t.name || label('tracks.defaultName', { n: siblings.indexOf(t) + 1 }) })])];
    return el('div', { class: 'tp-row tp-meta', 'data-variant-row': track.id },
      el('span', { class: 'tp-meta-label' }, label('tracks.variant.label')),
      menu('track-variant-of', track.variant ? label('tracks.variant.in') : label('tracks.variant.none'), options, (id) => run(() => (id ? app.setVariantOf(track.id, id) : app.clearVariant(track.id)))),
      track.variant ? el('input', { type: 'text', class: 'tp-name-input', 'data-key': `track-variant-label-${track.id}`, value: track.variant.label, maxlength: 24, 'aria-label': label('tracks.variant.labelName'),
        autocomplete: 'off', spellcheck: 'false', onchange: (e) => { const v = e.target.value.trim(); if (v) run(() => app.setVariantLabel(track.id, v)); else draw(); } }) : null);
  };

  const nameCell = (track, n) => {
    if (editing?.trackId === track.id && editing.field !== 'abbr') {
      return el('input', { type: 'text', class: 'tp-name-input', 'data-key': `track-name-${track.id}`, value: editing.draft, placeholder: label('tracks.fullName.label'),
        'aria-label': label('tracks.nameLabel'), enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false',
        oninput: (e) => { if (editing) editing.draft = e.target.value; },
        onkeydown: onNameKey,
        onblur: () => { if (!redrawing) commitEdit(); } });
    }
    const shown = trackName(track, n);
    return el('button', { type: 'button', class: 'tp-name', 'data-key': `track-name-${track.id}`, 'data-default': !track.name, title: label('tracks.rename', { name: shown }),
      'aria-label': label('tracks.rename', { name: shown }), onclick: () => startEdit(track) }, track.name || label('tracks.fullName.label'));
  };

  // ---------- drag and drop: a grip (≥ --tp-target) starts the drag; the drop slot is the gap nearest the pointer ----------
  // Tracks move among the tracks of their movement, a staff only among the staves of its own track. One drop = one transaction.
  // Pointer events with `touch-action: none` on the grip only, so the rest of the panel still scrolls under the finger.
  let drag = null;
  const clearMarks = () => panel?.querySelectorAll('.tp-drop-before, .tp-drop-after, .tp-dragging').forEach((n) => n.classList.remove('tp-drop-before', 'tp-drop-after', 'tp-dragging'));
  const slotAt = (y) => {
    let slot = 0;
    for (const row of drag.rows) { const r = row.getBoundingClientRect(); if (y > r.top + r.height / 2) slot += 1; else break; }
    return slot;
  };
  /** Index the item will have after the drop (null = nothing changes). */
  const finalIndex = (slot) => { const to = slot > drag.from ? slot - 1 : slot; return to === drag.from ? null : to; };
  const markDrop = () => {
    clearMarks();
    drag.rows[drag.from].classList.add('tp-dragging');
    if (finalIndex(drag.slot) === null) return;
    if (drag.slot < drag.rows.length) drag.rows[drag.slot].classList.add('tp-drop-before'); else drag.rows[drag.rows.length - 1].classList.add('tp-drop-after');
  };
  const autoScroll = () => {
    if (!drag || !panel) return;
    const box = panel.getBoundingClientRect();
    const top = box.top + (panel.querySelector('.tp-head')?.getBoundingClientRect().height ?? 0) + 24;
    const bottom = box.bottom - 24;
    const dy = drag.y < top ? -10 : drag.y > bottom ? 10 : 0;
    if (!dy) return;
    const before = panel.scrollTop;
    panel.scrollTop += dy;
    if (panel.scrollTop !== before) { drag.slot = slotAt(drag.y); markDrop(); }
  };
  const endDrag = (apply) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearInterval(d.timer);
    window.removeEventListener('pointermove', d.onMove, true);
    window.removeEventListener('pointerup', d.onUp, true);
    window.removeEventListener('pointercancel', d.onCancel, true);
    window.removeEventListener('keydown', d.onKey, true);
    try { d.handle.releasePointerCapture?.(d.pointerId); } catch { /* the handle may already be gone */ }
    panel?.removeAttribute('data-dragging');
    clearMarks();
    if (!apply) return;
    const to = (() => { const t = d.slot > d.from ? d.slot - 1 : d.slot; return t === d.from ? null : t; })();
    if (to === null) return;
    run(() => (d.kind === 'track' ? app.moveTrackTo(d.id, to) : d.kind === 'movement' ? app.moveMovementTo(d.id, to) : app.moveStaffTo(d.id, to)));
  };
  const startDrag = (e, kind, id) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    if (editing) { commitEdit(); } // a pending name is validated first (the redraw replaces the grip)
    const handle = panel.querySelector(`[data-grip="${kind}:${id}"]`);
    const item = handle?.closest(kind === 'track' ? '.tp-track' : kind === 'movement' ? '.tp-movement' : '.tp-staff');
    if (!item) return;
    const scope = kind === 'staff' ? item.closest('.tp-track') : panel;
    const rows = [...scope.querySelectorAll(kind === 'track' ? '.tp-track' : kind === 'movement' ? '.tp-movement' : '.tp-staff')]
      .filter((n) => kind !== 'track' || n.getAttribute('data-movement') === item.getAttribute('data-movement'));
    const from = rows.indexOf(item);
    if (from < 0 || rows.length < 2) return;
    drag = { kind, id, handle, rows, from, slot: from, y: e.clientY, pointerId: e.pointerId };
    drag.onMove = (ev) => { if (ev.pointerId !== drag.pointerId) return; drag.y = ev.clientY; drag.slot = slotAt(ev.clientY); markDrop(); };
    drag.onUp = (ev) => { if (ev.pointerId === drag?.pointerId) { drag.y = ev.clientY; drag.slot = slotAt(ev.clientY); endDrag(true); } };
    drag.onCancel = (ev) => { if (ev.pointerId === drag?.pointerId) endDrag(false); };
    drag.onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endDrag(false); } };
    window.addEventListener('pointermove', drag.onMove, true);
    window.addEventListener('pointerup', drag.onUp, true);
    window.addEventListener('pointercancel', drag.onCancel, true);
    window.addEventListener('keydown', drag.onKey, true);
    drag.timer = setInterval(autoScroll, 30);
    try { handle.setPointerCapture?.(e.pointerId); } catch { /* best effort */ }
    panel.setAttribute('data-dragging', '');
    markDrop();
  };
  const grip = (kind, id, disabled) =>
    el('button', { type: 'button', class: 'tp-grip', 'data-key': `grip-${id}`, 'data-grip': `${kind}:${id}`, 'aria-label': label(kind === 'track' ? 'tracks.dragTrack' : kind === 'movement' ? 'movements.drag' : 'tracks.dragStaff'),
      title: label(kind === 'track' ? 'tracks.dragTrack' : kind === 'movement' ? 'movements.drag' : 'tracks.dragStaff'), disabled, onpointerdown: (e) => startDrag(e, kind, id) }, '⠿');

  // A type change that loses nothing runs at once; otherwise the dialog shows what is lost and asks the model's questions first.
  let typeDialog = null;
  const changeType = (staff, type) => {
    if (type === staff.type) return;
    let plan;
    try { plan = app.planStaffType(staff.id, type); } catch (e) {
      if (e.name !== 'TrackEditError') throw e;
      message = label(`tracks.refused.${e.code}`); draw(); return;
    }
    if (!plan.confirm.length) { run(() => app.changeStaffType(staff.id, type, {})); return; }
    typeDialog?.close();
    typeDialog = openStaffTypeDialog({
      plan, label, fromLabel: label(`staffType.${staff.type}`), toLabel: label(`staffType.${type}`),
      onConfirm: (options) => { typeDialog = null; run(() => app.changeStaffType(staff.id, type, options)); },
      onCancel: () => { typeDialog = null; },
    });
  };

  /** Eye: shown (open eye) / hidden (the eye is crossed out). A hidden row is dimmed. */
  // chord track: do its chord symbols sound? (the whole track at once; the global default is in Settings › Audio)
  const chordPlayButton = (track) => {
    const silent = app.nextScopeValue(track.id) === true; // nothing audible left: the next gesture plays them
    const b = iconButton('chord-play', silent ? '🔇' : '🔊', label(silent ? 'tracks.chordPlay' : 'tracks.chordMute'), () => run(() => app.toggleScope(track.id)));
    b.setAttribute('aria-pressed', String(silent));
    return b;
  };
  const eyeButton = (key, item, { solo = false } = {}) => {
    const toggle = () => run(() => app.setVisible(item.id, !item.visible));
    const b = iconButton(key, item.visible ? '👁' : '🙈', label(item.visible ? 'tracks.hide' : 'tracks.show'), solo ? () => {} : toggle);
    b.setAttribute('aria-pressed', String(!item.visible));
    if (solo) { // a long press = the visual solo of the track (only it is shown; again = back)
      const on = app.visualSoloActive(item.id);
      b.setAttribute('data-vsolo', String(on)); if (on) b.style.outline = '2px solid #2e78c8';
      b.title = `${b.title} — ${label('tracks.visualSolo')}`;
      bindShortLong(b, { onShort: toggle, onLong: () => run(() => app.toggleVisualSolo(item.id)) });
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    }
    return b;
  };

  // Linking: a free tablature offers "Link" (to the notation staff of its track); when the contents differ the first press only says so (second press = replace)
  let pendingLink = null;
  const linkTo = (staff, target = staff.linkTargets[0]) => {
    if (!target) return;
    let plan;
    try { plan = app.planLink(staff.id, target); } catch (e) { if (e.name !== 'TrackEditError') throw e; message = label(`tracks.refused.${e.code}`); draw(); return; }
    if (!plan.same && pendingLink !== staff.id) { pendingLink = staff.id; message = label('tracks.link.differs').replace('{n}', String(plan.mismatches)); draw(); return; }
    pendingLink = null;
    run(() => app.linkStaff(staff.id, target, { force: !plan.same }));
  };

  const staffRow = (staff, count, siblings = []) => el('div', { class: `tp-row tp-staff${staff.visible ? '' : ' tp-hidden'}`, 'data-staff': staff.id },
    grip('staff', staff.id, count < 2),
    staff.types.length
      ? el('span', { class: 'tp-name' }, createChoiceMenu({ options: [[staff.type, label(`staffType.${staff.type}`)], ...staff.types.map((t) => [t, label(`staffType.${t}`)])], value: staff.type,
        label: label('tracks.changeType'), act: 'staff-type', onPick: (type) => changeType(staff, type) }))
      : el('span', { class: 'tp-name' }, label(`staffType.${staff.type}`)),
    staff.linked ? iconButton('staff-unlink', '⛓', label('tracks.link.unlink'), () => run(() => app.unlinkStaff(staff.id))) : null,
    staff.linkTargets.length > 1 // several staves to link to (a rhythm staff can follow the notation, the tablature…): the user picks
      ? menu('staff-link', pendingLink === staff.id ? '⚠⛓' : '⛓', staff.linkTargets.map((id) => [id, label(`staffType.${siblings.find((s) => s.id === id)?.type ?? 'score'}`)]), (id) => linkTo(staff, id))
      : staff.linkTargets.length ? iconButton('staff-link', pendingLink === staff.id ? '⚠⛓' : '⛓', label(pendingLink === staff.id ? 'tracks.link.confirm' : 'tracks.link.link'), () => linkTo(staff)) : null,
    hasProps(staff.id) ? iconButton('staff-props', '⚙', label('staffProps.open'), () => onStaffProps(staff.id)) : null,
    eyeButton('staff-visible', staff),
    iconButton('staff-remove', '🗑', label('tracks.removeStaff'), () => run(() => app.removeStaff(staff.id)), !staff.canRemove));

  // ---------- groups: frames around their tracks; a "group" mode with a checkbox per track ----------
  /** { movement, picked: Set(trackId), style } while the user chooses the tracks of a new group. */
  let grouping = null;
  const openNames = new Set(); // movements whose names controls are open
  /** Small drawing of a bracket style (the staves are the thin lines on its right): shown in the style menus instead of the name. */
  const bracketIcon = (style) => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.style.display = 'block';
    const shape = {
      normal: 'M9 3 H6 V21 H9 M6 3 H4 V21 H6',
      square: 'M10 3 H6 V21 H10',
      line: 'M6 3 V21',
      brace: 'M10 3 C5 6 8 10 4 12 C8 14 5 18 10 21',
    }[style];
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    for (const y of [8, 12, 16]) svg.append(mk('line', { x1: 13, x2: 22, y1: y, y2: y, stroke: 'currentColor', 'stroke-width': 1, opacity: 0.45 }));
    svg.append(mk('path', { d: shape, fill: style === 'normal' ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': style === 'normal' ? 1.2 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return svg;
  };
  const styleOptions = () => BRACKET_STYLES.map((s) => [s, label(`tracks.bracket.${s}`), null, () => bracketIcon(s)]);
  const orderOptions = () => [['custom', label('tracks.groups.manual')], ...SCORE_ORDERS.map((o) => [o.id, label(`scoreOrder.${o.id}`)])];
  const canCreateGroup = (mv) => {
    const idx = mv.tracks.filter((t) => grouping.picked.has(t.id)).map((t) => t.index);
    return idx.length > 0 && Math.max(...idx) - Math.min(...idx) + 1 === idx.length;
  };
  /** Header of a movement (a card): grip, number (empty = automatic, the placeholder shows it), title, duplicate, remove, then the description. */
  const movementHeader = (mv, mi, count) => {
    const field = (key, cls, value, placeholder, title, onchange, extra = {}) =>
      el('input', { type: 'text', class: cls, 'data-key': `${key}-${mv.id}`, value, placeholder, title, 'aria-label': title, autocomplete: 'off', spellcheck: 'false', onchange: (e) => onchange(e.target.value), ...extra });
    return el('div', { class: 'tp-movement', 'data-movement-id': mv.id },
      el('div', { class: 'tp-row' },
        grip('movement', mv.id, count < 2),
        field('mv-number', 'tp-card-num', mv.cardForced ? mv.cardNumber : '', mv.cardNumber, label('movements.number', { n: mv.cardNumber }), (v) => run(() => app.setCardNumber(mv.id, v)), { maxlength: 12 }),
        field('mv-title', 'tp-card-title', mv.title, label('movements.titlePlaceholder'), label('movements.titleField'), (v) => run(() => app.setCardText(mv.id, { title: v }))),
        iconButton(`mv-dup-${mv.id}`, '⧉', label('movements.duplicate'), () => run(() => app.duplicateMovement(mv.id))),
        iconButton(`mv-rm-${mv.id}`, '🗑', label('movements.remove'), () => run(() => app.removeMovement(mv.id)), !mv.canRemove)),
      el('div', { class: 'tp-row' }, field('mv-desc', 'tp-card-desc', mv.description, label('movements.descriptionPlaceholder'), label('movements.descriptionField'), (v) => run(() => app.setCardText(mv.id, { description: v })))));
  };
  /** A two-state button (replaces a check box): `on` = the state now; the corner ticks of the button show the two states, as in the editor bars. */
  const toggle = (act, text, on, onChange, title = null) => {
    const b = el('button', { type: 'button', 'data-act': act, 'aria-pressed': String(!!on), title: title ?? text, onclick: () => onChange(!on) }, text);
    b.classList.add('tp-toggle'); // two states only: no corner ticks, a light grey when on
    return b;
  };
  const movementTools = (mv, mi) => {
    if (grouping && grouping.movement === mi) {
      return el('div', { class: 'tp-grouping', 'data-grouping': '' },
        el('span', {}, label('tracks.groups.hint')),
        menu('group-new-style', label(`tracks.bracket.${grouping.style}`), styleOptions(), (s) => { grouping.style = s; draw(); }, { columns: 4, current: grouping.style }),
        el('button', { type: 'button', 'data-act': 'group-create', disabled: !canCreateGroup(mv), onclick: () => {
          const ids = mv.tracks.filter((t) => grouping.picked.has(t.id)).map((t) => t.id);
          const style = grouping.style;
          grouping = null;
          run(() => app.groupTracks(ids, { style }));
        } }, label('tracks.groups.create')),
        el('button', { type: 'button', 'data-act': 'group-cancel', onclick: () => { grouping = null; draw(); } }, label('tracks.groups.cancel')));
    }
    const names = mv.names;
    const nameModes = ['long', 'short', 'icon', 'none'].map((m) => [m, label(`tracks.names.${m}`)]);
    // one button with a down arrow: it opens the controls of the names of the tracks in place (the panel gets taller only when asked)
    const namesOpen = openNames.has(mi);
    const namesBody = [
      toggle('names-show', label('tracks.names.show'), names.show, (v) => run(() => app.setNameStyle(mi, { show: v }))),
      ...(names.show ? [
        menu('names-first', `${label('tracks.names.first')} : ${label(`tracks.names.${names.first}`)}`, nameModes, (m) => run(() => app.setNameStyle(mi, { first: m }))),
        menu('names-next', `${label('tracks.names.next')} : ${label(`tracks.names.${names.next}`)}`, nameModes, (m) => run(() => app.setNameStyle(mi, { next: m }))),
        toggle('names-hide-one', label('tracks.names.hideIfOne'), names.hideIfOne, (v) => run(() => app.setNameStyle(mi, { hideIfOne: v }))),
      ] : [])];
    const namesRow = el('div', { class: 'tp-tools', 'data-name-tools': mi },
      el('button', { type: 'button', class: 'tp-drop', 'data-act': 'names-drop', 'aria-expanded': String(namesOpen), onclick: () => { if (openNames.has(mi)) openNames.delete(mi); else openNames.add(mi); draw(); } }, label('tracks.names.title')),
      ...(namesOpen ? namesBody : []));
    const groupRow = el('div', { class: 'tp-tools', 'data-group-tools': mi },
      // ONE button: its menu holds the choice of the grouping (manual, an orchestra order…) and the way to make a group by hand
      menu('group-order', label('tracks.groups.start'), [[NEW_GROUP, label('tracks.groups.newByHand')], ...orderOptions().map(([id, text]) => [id, `${id === mv.groupOrder ? '● ' : ''}${text}`])],
        (id) => { if (id === NEW_GROUP) { if (mv.tracks.length) { grouping = { movement: mi, picked: new Set(), style: 'normal' }; message = ''; draw(); } } else run(() => app.setGroupOrder(mi, id)); }),
      toggle('group-labels', label('tracks.groups.labels'), mv.groupLabels, (v) => run(() => app.setGroupLabels(mi, v))));
    // the system row: tempo, repeats, jumps, markers, voltas… live in the masterbar; they are drawn on the highest VISIBLE staff
    const sysRow = el('div', { class: `tp-tools${mv.system.visible ? '' : ' tp-hidden'}`, 'data-system-row': mi },
      el('span', { class: 'tp-name', title: label('tracks.system.note') }, `${label('tracks.system.indication')} (${mv.system.count})`),
      (() => {
        const b = iconButton('system-visible', mv.system.visible ? '👁' : '🙈', label(mv.system.visible ? 'tracks.system.hide' : 'tracks.system.show'), () => run(() => app.setSystemVisible(mi, !mv.system.visible)));
        b.setAttribute('aria-pressed', String(!mv.system.visible));
        return b;
      })());
    return el('div', { class: 'tp-toolset' }, sysRow, groupRow, namesRow);
  };
  const REMOVE = '__remove';
  const NEW_GROUP = '__new-group';
  const groupFrame = (g, mi, inner) => el('div', { class: 'tp-group', 'data-group': g.id },
    el('div', { class: 'tp-row' },
      // the last entry removes the bracket (the tracks stay, inner groups move up)
      menu('group-style', label(`tracks.bracket.${g.style}`), [...styleOptions(), [REMOVE, label('tracks.groups.remove'), null, () => icon('trash')]],
        (s) => run(() => (s === REMOVE ? app.ungroup(g.id) : app.setGroupStyle(g.id, s))), { columns: 5, current: g.style }),
      el('input', { type: 'text', class: 'tp-group-label', 'data-key': `group-label-${g.id}`, value: g.label, placeholder: label('tracks.groups.labelPlaceholder'), 'aria-label': label('tracks.groups.label'),
        enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false', onchange: (e) => run(() => app.setGroupLabel(g.id, e.target.value)) }),
      toggle('group-barlines', label('tracks.groups.barlinesShort'), g.barlines, (v) => run(() => app.setGroupBarlines(g.id, v)), label('tracks.groups.barlines')),
    ),
    ...inner);
  /** Tracks `from..to` of a movement with the groups that live in that range, as nested frames. */
  const renderRange = (mv, mi, from, to, groups) => {
    const nodes = [];
    let i = from;
    for (const g of [...groups].sort((a, b) => a.from - b.from)) {
      for (; i < g.from; i += 1) if (!mv.tracks[i].accompaniment) nodes.push(trackBlock(mv.tracks[i], i + 1, mi, mv.tracks.length, mv.tracks));
      nodes.push(groupFrame(g, mi, renderRange(mv, mi, g.from, g.to, g.groups)));
      i = g.to + 1;
    }
    for (; i <= to; i += 1) if (!mv.tracks[i].accompaniment) nodes.push(trackBlock(mv.tracks[i], i + 1, mi, mv.tracks.length, mv.tracks));
    return nodes;
  };

  /** Short text of a transposition: "+2", "−9", "±0". */
  const transposeText = (t) => (t.chromatic === 0 ? '±0' : `${t.chromatic > 0 ? '+' : '−'}${Math.abs(t.chromatic)}`);
  /** Display transposition of a track (only tracks that have a notation staff): shows the interval, a tap chooses another one. */
  const transposeCell = (track) => {
    if (!track.hasNotation) return null;
    const t = track.transposition;
    const current = !t.own ? 'follow' : semitoneChoiceId(t);
    const options = transpositionOptions(label, { current });
    const m = createChoiceMenu({ options, value: current, label: transposeText(t), act: 'track-transpose',
      onPick: (id) => { if (id === 'custom' || id === current) return; run(() => app.setTrackTransposition(track.id, id === 'follow' ? null : id)); } });
    m.firstChild.textContent = transposeText(t);
    m.firstChild.title = `${label('tracks.transpose.title')} : ${options.find(([v]) => v === current)?.[1] ?? ''}`;
    m.setAttribute('data-transposed', String(t.chromatic !== 0));
    return m;
  };
  /** The grey row's name opens / closes the track's zone (the name itself is edited inside the zone). */
  const toggleOpen = (track) => { commitEdit(); if (openTracks.has(track.id)) openTracks.delete(track.id); else openTracks.add(track.id); draw(); };
  const nameToggle = (track, n) => {
    const shown = trackName(track, n);
    const isOpen = openTracks.has(track.id);
    const t = label(isOpen ? 'tracks.closeTrack' : 'tracks.open', { name: shown });
    return el('button', { type: 'button', class: 'tp-name tp-toggle', 'data-key': `track-toggle-${track.id}`, 'data-default': !track.name, 'aria-expanded': String(isOpen), title: t, 'aria-label': t,
      onclick: () => toggleOpen(track) }, icon(isOpen ? 'chevron-down' : 'chevron-right', { size: '1.1em' }), track.instrumentIcon ? instrumentIconNode(track.instrumentIcon, { photo: photoOn(), size: '1.5em' }) : null, el('span', { class: 'tp-toggle-text' }, shown));
  };

  /**
   * The ACCOMPANIMENT zone of a movement: the tracks that play by themselves (a player and no written notes) shown apart from the tracks where one writes. Open: their usual rows; folded: one grey line of
   * names. "Write as real tracks" turns what they play into tracks with notes.
   */
  const foldedZones = new Set();
  const accompanimentZone = (mv, mi) => {
    const tracks = mv.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.accompaniment);
    if (!tracks.length) return null;
    const open = !foldedZones.has(mi);
    const text = label('accompaniment.zone', { n: tracks.length });
    const head = el('div', { class: 'tp-row tp-accomp-head' },
      el('button', { type: 'button', class: 'tp-name tp-toggle', 'data-key': `accomp-toggle-${mi}`, 'aria-expanded': String(open), title: text, 'aria-label': text,
        onclick: () => { commitEdit(); if (open) foldedZones.add(mi); else foldedZones.delete(mi); draw(); } }, icon(open ? 'chevron-down' : 'chevron-right', { size: '1.1em' }), el('span', { class: 'tp-toggle-text' }, text)),
      onRealize ? el('button', { type: 'button', 'data-key': `accomp-realize-${mi}`, title: label('accompaniment.realizeHint'), onclick: () => onRealize(mi) }, label('accompaniment.realizeShort')) : null);
    const body = open ? tracks.map(({ t, i }) => trackBlock(t, i + 1, mi, mv.tracks.length, mv.tracks))
      : [el('div', { class: 'tp-accomp-names', 'data-accomp-names': mi }, tracks.map(({ t, i }) => trackName(t, i + 1)).join(' · '))];
    return el('div', { class: 'tp-accomp', 'data-accompaniment': mi }, head, ...body);
  };

  const trackBlock = (track, n, mvIndex, count, siblings = []) => el('div', { class: `tp-track${track.visible ? '' : ' tp-hidden'}${track.player?.silent ? ' tp-silent' : ''}`, 'data-track': track.id, 'data-movement': mvIndex },
    el('div', { class: 'tp-row' },
      grouping && grouping.movement === mvIndex
        ? createSwitch({ checked: grouping.picked.has(track.id), text: '✓', attrs: { 'data-pick': track.id, 'aria-label': label('tracks.groups.pick'), title: label('tracks.groups.pick') },
          onchange: (e) => { if (e.target.checked) grouping.picked.add(track.id); else grouping.picked.delete(track.id); draw(); } })
        : null,
      grip('track', track.id, count < 2 || track.chord),
      nameToggle(track, n),
      track.chord ? chordPlayButton(track) : null,
      track.lyrics && onLyricEvents ? iconButton('lyrics-edit', '✎', label('lyricEvents.open'), () => onLyricEvents(track.id)) : null,
      track.lyrics ? null : trackAudioButton(app, track.id, label), // a lyrics track makes no sound: no mute / solo
      track.variant ? variantPill(track) : null,
      eyeButton('track-visible', track, { solo: true }),
      iconButton('track-remove', '🗑', label('tracks.removeTrack'), () => run(() => app.removeTrack(track.id)), !track.canRemove)),
    openTracks.has(track.id) ? el('div', { class: 'tp-open', 'data-open': track.id },
      el('div', { class: 'tp-row tp-meta' }, nameCell(track, n)),
      el('div', { class: 'tp-row tp-meta' }, abbrCell(track), el('span', { class: 'tp-meta-label' }, label('tracks.icon.label')), iconMenu(track)),
      variantRow(track, siblings),
      el('div', { class: 'tp-row tp-meta' },
        transposeCell(track) ? el('span', { class: 'tp-meta-label' }, label('tracks.transpose.short')) : null, transposeCell(track),
        el('span', { class: 'tp-spacer' }),
        menu('add-staff', label('tracks.addStaff.short'), [...typeOptions().filter(([type]) => type !== 'chord'), ...track.linkTypes.map((lt) => [`linked:${lt}`, label(lt === 'score' ? 'tracks.linkedScore' : lt === 'tab' ? 'tracks.linkedTab' : lt === 'chord' ? 'tracks.linkedChord' : 'tracks.linkedRhythm')])], (type) => run(() => (type.startsWith('linked:') ? app.addLinkedStaff(track.id, type.slice(7)) : app.addStaff(track.id, { type }))))),
      trackDisplayRow({ label, own: track.display, base: DEFAULT_DISPLAY, sizeable: track.sizeable, slashes: { ...app.slashInfo(track.id), ranges: true, explicitEmpty: false }, onSet: (patch) => run(() => app.setTrackDisplay(track.id, patch)) }),
      ...track.staves.map((staff) => staffRow(staff, track.staves.length, track.staves)),
      track.staves.length > 1 ? compositeSection({ app, track, label, run }) : null,
      track.lyrics ? null : playerSection({ app, track, label, run, ...(onPlayer ?? {}) })) : null);

  function place() {
    const m = mode();
    panel.setAttribute('data-mode', m);
    if (m === 'docked') { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = ''; return; }
    if (m === 'sheet') { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = ''; return; }
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const start = dragged ?? { left: vw - rect.width - 12, top: 64 };
    const pos = clampWindow({ ...start, width: rect.width, height: rect.height, viewportWidth: vw, viewportHeight: vh });
    panel.style.left = `${pos.left}px`; panel.style.top = `${pos.top}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }

  function enableDrag(head) {
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
  }

  function draw() {
    if (!opened && !docked()) return;
    const outline = app.tracksOutline();
    const active = document.activeElement;
    const focusKey = active?.closest?.('[data-tracks-panel]') ? active.getAttribute('data-key') : null;
    const caret = active?.matches?.('input.tp-name-input') ? { start: active.selectionStart, end: active.selectionEnd } : null;
    if (!panel) {
      panel = el('div', { 'data-tracks-panel': '', 'data-resizable': 'tracks', 'data-zoom-lock': '', role: 'dialog', 'aria-label': label('tracks.titleScreen1') });
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editing && !docked()) { e.stopPropagation(); api.close(); } });
      // While a name is typed, a press elsewhere in the panel must not blur the field before the click lands (a blur-triggered redraw would
      // swallow the tap): keep the focus on mousedown, then validate the edit when the click arrives.
      panel.addEventListener('mousedown', (e) => { if (editing && !e.target.closest('input.tp-name-input')) e.preventDefault(); }, true);
      panel.addEventListener('click', (e) => {
        if (!editing || e.target.closest('input.tp-name-input')) return;
        // A choice-menu trigger must be opened from the live DOM: validate right after the click was handled.
        if (e.target.closest('.cm-button')) setTimeout(commitEdit, 0); else commitEdit();
      }, true);
      panel.addEventListener('panelmoved', (e) => { dragged = { left: e.detail.left, top: e.detail.top }; });
      (docked() ? sidebar.tabBody('tracks') : document.body).append(panel);
    }
    const head = el('div', { class: 'tp-head' },
      docked() ? null : el('span', { class: 'tp-title' }, label('tracks.titleScreen1')), // in the sidebar the tab already names the panel
      addTrackMenu(outline),
      compositeMenu(outline),
      accompanimentMenu(outline),
      docked() ? null : iconButton('close', '✕', label('tracks.close'), () => api.close()));
    enableDrag(head);
    const blocks = [];
    if (outline.length > 1) {
      blocks.push(el('div', { class: 'tp-numformat tp-row' }, el('label', { title: label('movements.formatHint') }, label('movements.format'),
        el('input', { type: 'text', 'data-key': 'mv-format', value: outline[0].cardFormat, maxlength: 24, autocomplete: 'off', spellcheck: 'false', 'aria-label': label('movements.format'), title: label('movements.formatHint'), onchange: (e) => run(() => app.setCardNumberFormat(e.target.value || '{n}')) }))));
    }
    outline.forEach((mv, mi) => {
      if (outline.length > 1) blocks.push(movementHeader(mv, mi, outline.length));
      blocks.push(movementTools(mv, mi));
      if (!mv.tracks.length) blocks.push(el('div', { class: 'tp-empty' }, label('tracks.empty')));
      blocks.push(...renderRange(mv, mi, 0, mv.tracks.length - 1, mv.groups));
      const zone = accompanimentZone(mv, mi);
      if (zone) blocks.push(zone);
    });
    redrawing = true;
    try { panel.replaceChildren(head, el('div', { class: 'tp-status', role: 'status', 'data-tracks-message': '' }, message), ...blocks); } finally { redrawing = false; }
    place();
    const input = editing ? panel.querySelector('input.tp-name-input') : null;
    if (input) {
      input.focus({ preventScroll: true });
      if (editing.fresh) { input.select(); editing.fresh = false; } else if (caret) input.setSelectionRange(caret.start, caret.end);
    } else if (focusKey) panel.querySelector(`[data-key="${focusKey}"]`)?.focus?.({ preventScroll: true });
  }
  // "+ Track": ONE menu — a template, then the tracks of a band (chords, guitar, bass, keys, drums, lyrics) added as they are, then « More… » (the whole instrument catalogue)
  const addTrackMenu = (outline) => {
    const movements = () => outline.map((mv) => ({ title: mv.title }));
    const add = (id, options = {}) => run(() => { created(app.addInstrumentTrack(id, { movement: pickMovement, ...options })); });
    const quick = {
      template: () => templatePicker.open({ movements: movements(), movement: pickMovement }),
      chords: () => run(() => { created(app.addTrack({ staves: [{ type: 'chord' }], movement: pickMovement, name: 'Chords' })); }),
      guitar: () => add('electric-guitar-tablature', { linkedNotation: { clef: 'G' }, name: label('tracks.picker.q.guitar') }), // a tablature with its notation staff linked above it, like the quick pick « both »
      bass: () => add('electric-bass-4-str-tab', { linkedNotation: { clef: 'F' }, name: label('tracks.picker.q.bass') }),
      keys: () => add('piano'),
      drums: () => add('drumset', { scorsaireKit: true }),
      lyrics: () => run(() => { const id = app.addLyricsTrack({ movement: pickMovement }); if (id) { openTracks.add(id); onLyricEvents?.(id); } }),
      more: () => picker.open({ movements: movements(), movement: pickMovement }),
    };
    const m = menu('add-track', `+ ${label('tracks.addTrack')}`, [['template', label('templates.open')], ['chords', label('tracks.quick.chords')], ['guitar', label('tracks.quick.guitar')], ['bass', label('tracks.quick.bass')], ['keys', label('tracks.quick.keys')], ['drums', label('tracks.quick.drums')], ['lyrics', label('lyricEvents.newItem')], ['more', label('tracks.quick.more')]], (what) => { commitEdit(); quick[what]?.(); });
    m.title = label('tracks.addTrackTitle'); m.style.minWidth = '0'; m.style.flex = '1 1 0';
    return m;
  };
  // "Composite staff": picks the track (with at least two staves) whose staves the new composite will alternate between
  const compositeMenu = (outline) => {
    const eligible = outline.flatMap((m) => m.tracks).filter((t) => t.staves.length > 1);
    if (!eligible.length) return el('button', { type: 'button', 'data-act': 'composite-new', disabled: '', title: label('composite.needsTwo') }, label('composite.new'));
    const m = menu('composite-new', label('composite.new'), eligible.map((t) => [t.id, t.name || label('tracks.defaultName', { n: t.index + 1 })]), (trackId) => run(() => {
      const t = eligible.find((x) => x.id === trackId);
      app.addComposite(trackId, { name: label('composite.defaultName', { n: t.composites.length + 1 }), base: t.staves[0].id });
      openTracks.add(trackId);
    }));
    m.title = label('composite.newTitle'); m.style.minWidth = '0'; m.style.flex = '1 1 0'; // (the short label must never push the head out of the panel)
    return m;
  };
  // "Accompaniment": a track with its own automatic player (model/player.js); the chords come from the movement's chord track, so there has to be one
  const accompanimentMenu = (outline) => {
    const hasChords = !!outline[pickMovement]?.tracks.some((t) => t.chord);
    if (!hasChords) return el('button', { type: 'button', 'data-act': 'accompaniment-new', disabled: '', title: label('player.needsChords') }, label('player.add'));
    const m = menu('accompaniment-new', label('player.add'), [...ACCOMPANIMENT_ROLES.map((r) => [r, label(`player.add.${r}`)]), ...(onStyles ? [['__styles', label('player.add.styles')]] : []), ...(onCues ? [['__cues', label('player.add.cues')]] : []), ...(onGrids ? [['__grids', label('player.add.grids')]] : [])], (role) => {
      if (role === '__styles') { onStyles(pickMovement); return; }
      if (role === '__cues') { onCues(pickMovement); return; }
      if (role === '__grids') { onGrids(pickMovement); return; }
      run(() => { const id = app.addAccompaniment(role, { movement: pickMovement }); openTracks.add(id); });
    });
    m.title = label('player.addTitle'); m.style.minWidth = '0'; m.style.flex = '1 1 0';
    m.setAttribute('data-dismiss-keep', ''); // pressing it must not clear the selection on the score: the grids, cues and transposition read it
    return m;
  };
  let pickMovement = 0; // the movement chosen last in the picker
  // The new track gets its name right away, in its own row (creation and naming are two undo steps).
  const created = (id) => {
    // the field opens on the track's current name (an instrument from the catalogue already has one): validating it unchanged writes nothing
    const name = app.tracksOutline().flatMap((m) => m.tracks).find((t) => t.id === id)?.name ?? '';
    openTracks.add(id); // its zone shows the name field
    editing = { trackId: id, draft: name, fresh: true };
  };
  const templatePicker = createTemplatePicker({ app, label, onDone: () => { message = ''; draw(); } });
  const picker = createInstrumentPicker({
    label, lang, staffTypes: CREATABLE_STAFF_TYPES, photo: photoOn,
    onInstrument: (instrumentId, movement, options = {}) => { pickMovement = movement; run(() => { created(app.addInstrumentTrack(instrumentId, { movement, ...options })); }); },
    onStaffType: (type, movement) => { pickMovement = movement; run(() => { created(app.addTrack({ staves: [{ type }], movement, ...(type === 'chord' ? { name: 'Chords' } : {}) })); }); }, // the chord track is named « Chords » by default
  });

  const onResize = () => { if (panel) place(); };
  window.addEventListener('resize', onResize);
  media?.addEventListener?.('change', onResize);
  const off = app.doc.subscribe(() => { if (opened || (docked() && sidebar.isTabShown('tracks'))) draw(); });
  const offMixer = app.onMixerChange?.(() => { if (opened || (docked() && sidebar.isTabShown('tracks'))) draw(); }) ?? (() => {});
  let dismissedAt = -1e9; // see settings-dom.js
  const offOutside = dismissOnOutside(() => (docked() ? null : panel), () => { dismissedAt = Date.now(); api.close(); });

  // the sidebar appears / disappears (the window crosses the computer / tablet limit): the panel changes parent
  const offSide = sidebar?.onChange(() => {
    if (panel && (panel.getAttribute('data-mode') === 'docked') !== docked()) { panel.remove(); panel = null; }
    if (docked() || opened) draw();
  });
  const api = {
    open() {
      message = ''; if (openMode() === 'closeAll') openTracks.clear();
      if (docked()) { draw(); sidebar.show('tracks'); return; }
      opened = true; draw();
    },
    close() { picker.close(); templatePicker.close(); typeDialog?.close(); typeDialog = null; grouping = null; endDrag(false); commitEdit(); opened = false; message = ''; panel?.remove(); panel = null; },
    toggle() {
      if (docked()) { if (sidebar.isTabShown('tracks')) sidebar.setFolded(true); else api.open(); return; }
      if (opened) api.close(); else if (Date.now() - dismissedAt > 400) api.open();
    },
    isOpen: () => (docked() ? sidebar.isTabShown('tracks') : opened),
    destroy() { api.close(); off(); offMixer(); offOutside(); offSide?.(); window.removeEventListener('resize', onResize); media?.removeEventListener?.('change', onResize); },
  };
  if (docked()) draw();
  return api;
}
