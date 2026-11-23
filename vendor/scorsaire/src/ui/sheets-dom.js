/*
 * Screen 3 (DOM): the SHEETS the author builds for a reader. A sheet is a presentation of the work (cells, each one a movement with the tracks it
 * shows) in a column or a matrix; the preview shows it on the three devices a reader may use (computer, tablet, phone). The options offered to the reader
 * (display and playback transposition, speed, loop, tracks) each have a lock: everything is LOCKED until the author unlocks it.
 * UI state (the sheet on view, the device) never goes into the document.
 */
import { bindShortLong } from './button-behavior.js';
import { trackAudioButton } from './track-audio-button.js';
import { nextVisualSolo, applyAudioSolo } from './visual-solo.js';
import { trackDisplayRow } from './track-display-dom.js';
import { resolveDisplay, trackLayer } from '../model/trackdisplay.js';
import { PID } from '../model/pid.js';
import { resolveStyle } from '../model/index.js';
import { READER_LOCKS, TRANSPOSE_RANGE, SPEED_RANGE, STAFF_SIZE_RANGE, MAX_COLUMNS, cellSettings } from '../model/sheetedit.js';
import { layoutSheet, DEVICES } from '../layout/sheetlayout.js';
import { SHEET_QUERY } from './panel-mode.js';
import { createTabletPanel, rememberTabletScroll } from './tablet-panel.js';
import { renderSvgString, uniqueSvgIds } from '../render/svg.js';
import { locate } from '../audio/cursor.js';
import { playheadRect } from '../layout/sheetcursor.js';
import { applyIconName, icon } from './icons.js';
import { markCyclic } from './button-behavior.js';
import { confirmDialog } from './confirm-dialog.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { addSectionCards } from './sheet-cards.js';
import { SID } from '../model/sid.js';
import { sheetCells, compositesOf } from '../model/index.js';
import { createChoiceMenu } from './choice-menu.js';
import { dividerRows } from './dividers-spec.js';

const STYLE_ID = 'sheets-screen-style';
const CSS = `
.sh-root { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; width: 100%; box-sizing: border-box; }
.sh-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); }
.sh-row h3 { margin: 0 8px 0 0; font-size: 14px; }
.sh-tab[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.sh-main { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.sh-stage { flex: 1 1 520px; min-width: 0; overflow: hidden; }
.sh-frame { background: var(--score, var(--field,#fff)); border: 1px solid var(--edge,#ccc); border-radius: 14px; box-shadow: 0 1px 6px rgba(0,0,0,.15); transform-origin: top left; box-sizing: border-box; padding: 12px; display: grid; gap: 12px; }
.sh-cell { position: relative; border: 1px dashed var(--edge,#bbb); border-radius: 12px; overflow: hidden; background: var(--score, var(--field,#fff)); min-width: 0; cursor: pointer; }
.sh-cell[aria-selected="true"] { outline: 3px solid #4a7bd0; outline-offset: -1px; }
.sh-side { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.sh-side.sh-docked { padding: 4px 8px; }
.sh-side.sh-docked section { border: 0; background: transparent; padding: 0; }
.sh-side section { border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--soft,#faf8f3); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.sh-cell svg { display: block; width: 100%; height: auto; }
.sh-cellbar { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); padding: 4px; background: var(--soft,#f3f0e8); border-bottom: 1px dashed var(--edge,#bbb); font: 12px var(--ui-font,sans-serif); align-items: center; }
.sh-panel { flex: 0 1 340px; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
.ps-tablet .sh-panel { flex: none; width: 100%; min-width: 0; }
@media (max-width: 900px) {
  .sh-root[data-sheet] { padding-bottom: 56px; }
  .sh-root[data-sheet-open] { padding-bottom: calc(42vh + 56px); }
}
.sh-panel section { border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--soft,#faf8f3); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.sh-panel h4 { margin: 0; font-size: 13px; }
.sh-opt { display: flex; align-items: center; gap: var(--btn-gap, 2px); flex-wrap: wrap; }
.sh-opt .sh-label { flex: 1 1 120px; font-size: 13px; }
.sh-val { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
/* « Col − n + » of the bar: the word and its stepper never separate (when the bar wraps, the whole block moves), and the number takes the room of two digits */
.sh-col { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 4px; white-space: nowrap; flex: none; }
.sh-col .sh-opt { flex-wrap: nowrap; }
.sh-col .sh-label { flex: none; }
.sh-col .sh-val { min-width: 2.2ch; }
.sh-lock[aria-pressed="true"] { background: var(--ok-soft,#e8f3e8); border-color: var(--ok-edge,#5a8f5a); }
.sh-tracks { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); border-top: 1px solid var(--line,#ddd); padding-top: 6px; }
.sh-tracks h5 { margin: 0; font-size: 12px; color: var(--ink-soft,#555); }
.sh-track { border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--soft,#fafafa); }
.sh-thead { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 4px 6px 4px 8px; background: var(--soft,#eef0f4); border-radius: 8px 8px 0 0; font-weight: var(--w-semi,600); }
.sh-track:not([data-open]) .sh-thead { border-radius: 8px; }
.sh-topen { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); padding: 6px 8px; border-top: 1px solid var(--line,#ddd); }
.sh-fold { border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--module, var(--module,#fcfbf8)); }
.sh-foldhead { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 2px 4px 2px 6px; background: var(--soft,#eef0f4); border-radius: 8px; font-weight: var(--w-semi,600); }
.sh-foldhead[data-open] { border-radius: 8px 8px 0 0; }
.sh-foldbody { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); padding: 8px; border-top: 1px solid var(--line,#ddd); }
.sh-fader { flex: 1 1 120px; min-width: 100px; height: var(--ui-target, 30px); }
.sh-hint { font-size: 12px; color: var(--ink-soft,#666); margin: 0; }
.sh-empty { padding: 24px; color: var(--ink-soft,#666); }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};
const soloMemory = new Map(); // « sheet|cell » → the tracks the cell showed before the visual solo (interface state)
const btn = (text, onclick, attrs = {}, iconName = null) => { const b = el('button', { type: 'button', onclick, ...attrs }, text); if (iconName) b.append(icon(iconName)); return b; };


/** A touch screen or a narrow window: the sheet can be shown as THIS device would show it (no frame, no reduction) instead of a reduced 1280 px computer page. */
function touchScreen() { return !!(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches); }

/** Mounts the screen 3 into `host`. On a computer the settings are the tabs Sheet / Cell / Reader of the sidebar; elsewhere they sit in a column beside the preview. */
export function mountSheetsScreen(host, { app, glyphs, label, sidebar = null, onSelect = () => {}, onExport = () => {}, previewHtml = null }) {
  if (!document.getElementById(STYLE_ID)) { const st = el('style', { id: STYLE_ID }); st.textContent = CSS; document.head.append(st); }
  const work = () => app.doc.work;
  // « This device »: the sheet is laid out for the real width of the screen (the window as it is, a staff space as a tablet or a phone has it), so what is drawn here is what the reader will see
  const hereDevice = () => { const beside = !docked() && window.innerWidth > 900 ? 340 + 24 : 0; /* the settings column of a wide tablet takes its width from the page */ const width = Math.max(320, Math.floor((host.clientWidth || window.innerWidth) - 2 * 12 - beside)); return { id: 'here', width, staffSpace: width <= 600 ? DEVICES.phone.staffSpace : DEVICES.tablet.staffSpace }; };
  const devOf = (id = device) => (id === 'here' ? hereDevice() : DEVICES[id]);
  const deviceIds = () => (touchScreen() ? ['here', ...Object.keys(DEVICES)] : Object.keys(DEVICES));
  let lastLaid = null; let sheetId = null; let cellId = null; const tabletState = { tab: 'cell', open: false, scroll: 0 }; // the tab of the settings on a tablet, whether the bottom sheet is open, where it was read: interface state
  let device = touchScreen() ? 'here' : 'pc'; const openTracks = new Set(); const openSections = new Set(['tracks', 'export']); let helpOpen = false;
  const root = el('div', { class: 'sh-root', 'data-sheets': '' });
  host.append(root);
  const TABS = ['cell', 'reader']; // the sheet's own settings (name, columns, add / remove) are in the bar above the sheet
  let raf = 0;
  const tabId = (g) => `sheets-${g}`;
  const docked = () => !!sidebar?.isEnabledForSheets?.();
  if (sidebar) for (const g of TABS) sidebar.addTab(tabId(g), label(`sheets.tab.${g}`), { screen: 'three' });

  const movementName = (mv, i) => `${i + 1}${mv.props[PID.TITLE] ? ` · ${mv.props[PID.TITLE]}` : ''}`;
  const tempoText = (v) => label(v == null ? 'sheets.names.file' : v ? 'sheets.tempo.show' : 'sheets.tempo.hide'); // tempo texts: as the file says, shown, hidden
  const cardStyleText = (v) => label(v === 'text' ? 'sheets.cardStyle.text' : v === 'card' ? 'sheets.cardStyle.card' : 'sheets.names.file');
  const namesText = (v) => label(v == null ? 'sheets.names.file' : v ? 'sheets.names.show' : 'sheets.names.hide'); // a sheet or a cell: as the file says, shown, hidden
  const lockRow = (sheet, key, name, control) => {
    const open = sheet.reader.unlocked[key];
    return el('div', { class: 'sh-opt', 'data-opt': key },
      el('span', { class: 'sh-label' }, name), control,
      btn(open ? label('sheets.unlocked') : label('sheets.locked'), () => app.setReaderUnlock(sheet.id, key, !open), { class: 'sh-lock', 'aria-pressed': String(open), 'data-lock': key, title: label('sheets.lockHint') }));
  };
  const stepper = (value, min, max, step, onSet, format = (v) => String(v)) => el('span', { class: 'sh-opt stp' },
    btn('−', () => onSet(Math.max(min, value - step)), { 'aria-label': '−' }),
    el('span', { class: 'sh-val stp-val' }, format(value)),
    btn('+', () => onSet(Math.min(max, value + step)), { 'aria-label': '+' }));
  const signed = (v) => (v > 0 ? `+${v}` : String(v));
  /** A linear fader 0..127 (one write when the finger lets go; the number follows while it moves). */
  const fader = (value, onSet) => {
    const out = el('span', { class: 'sh-val' }, String(value));
    const input = el('input', { type: 'range', min: '0', max: '127', step: '1', value: String(value), class: 'sh-fader', 'aria-label': label('sheets.volume') });
    input.addEventListener('input', () => { out.textContent = input.value; });
    input.addEventListener('change', () => onSet(Number(input.value)));
    return el('span', { class: 'sh-opt', style: 'flex:1 1 140px' }, input, out);
  };
  /** A section that unfolds, with the look of the track rows of screen 1. `guard` = an async check before it opens (a warning); `extra` = a button next to the title. */
  const fold = (key, title, content, { guard = null, extra = null } = {}) => {
    const open = openSections.has(key);
    const head = el('div', { class: 'sh-foldhead', ...(open ? { 'data-open': '' } : {}) },
      btn(`${open ? '▾' : '▸'} ${title}`, async () => {
        if (open) openSections.delete(key); else { if (guard && !(await guard())) return; openSections.add(key); }
        draw();
      }, { 'aria-expanded': String(open), 'data-fold': key, 'data-no-icon': '', style: 'flex:1;text-align:left;border:0;background:transparent;font-weight:var(--w-semi,600)' }), extra);
    return el('div', { class: 'sh-fold', 'data-section': key }, head, open ? el('div', { class: 'sh-foldbody' }, ...content) : null);
  };

  /** Rename / delete a sheet: a small window under the sheet's name (double click on the name, or the pencil). The name is empty = « Sheet n ». */
  let sheetMenu = null;
  function closeSheetMenu() { sheetMenu?.close(); sheetMenu = null; }
  function openSheetMenu(sheet, anchor) {
    closeSheetMenu();
    const box = el('div', { 'data-sheet-menu': sheet.id, role: 'dialog', 'aria-label': label('sheets.rename'), 'data-zoom-lock': '',
      style: 'position:fixed;z-index:3000;background:var(--paper,#faf8f4);color:var(--ink,#111);border:1px solid var(--edge,#888);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.35);padding:8px;display:flex;gap:var(--btn-gap,2px);align-items:center;flex-wrap:wrap;max-width:94vw' });
    const input = el('input', { type: 'text', value: sheet.name ?? '', placeholder: label('sheets.unnamed', { n: sheet.index + 1 }), 'aria-label': label('sheets.name'), 'data-sheet-name': '',
      style: 'font-size:16px;min-height:var(--ui-target,30px);padding:0 8px;border:1px solid var(--edge,#bbb);border-radius:8px;min-width:12em;flex:1' });
    const commit = () => { const v = input.value.trim(); if (v !== (sheet.name ?? '')) app.renameSheet(sheet.id, v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); closeSheetMenu(); } else if (e.key === 'Escape') { e.stopPropagation(); closeSheetMenu(); } });
    input.addEventListener('change', commit);
    const del = btn('', async () => {
      const name = sheet.name || label('sheets.unnamed', { n: sheet.index + 1 });
      closeSheetMenu();
      if (await confirmDialog({ message: label('sheets.removeConfirm', { name }), label })) { app.removeSheet(sheet.id); draw(); }
    }, { 'data-action': 'sheet-remove', title: label('sheets.remove'), 'aria-label': label('sheets.remove') }, 'trash');
    const ok = btn('', () => { commit(); closeSheetMenu(); }, { 'data-action': 'sheet-menu-close', title: label('sheets.menuClose'), 'aria-label': label('sheets.menuClose') }, 'check');
    box.append(input, del, ok);
    document.body.append(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = `${Math.max(6, Math.min(window.innerWidth - box.offsetWidth - 6, r.left))}px`;
    box.style.top = `${Math.min(window.innerHeight - box.offsetHeight - 6, r.bottom + 4)}px`;
    const off = dismissOnOutside(() => box, () => { commit(); closeSheetMenu(); });
    sheetMenu = { close() { off(); box.remove(); } };
    input.focus({ preventScroll: true }); input.select();
  }

  /** A value of the cell (or of one of its tracks) with a button to go back to the level above. */
  const valueRow = (name, control, own, reset, key) => el('div', { class: 'sh-opt', 'data-cell-opt': key },
    el('span', { class: 'sh-label' }, name), control,
    own ? btn('↺', reset, { title: label('sheets.inherit'), 'aria-label': label('sheets.inherit'), 'data-reset': key }) : el('span', { class: 'sh-hint' }, label('sheets.inherited')));
  const lockCycle = (sheet, cell, key, name) => {
    const own = cell.settings?.unlocked?.[key]; const eff = cellSettings(work().sheets.find((x) => x.id === sheet.id), cell).unlocked[key];
    const text = own == null ? label('sheets.lockFollow', { v: eff ? label('sheets.unlocked') : label('sheets.locked') }) : own ? label('sheets.unlocked') : label('sheets.locked');
    return el('div', { class: 'sh-opt', 'data-cell-lock': key }, el('span', { class: 'sh-label' }, name), btn(text, () => app.setCellUnlock(sheet.id, cell.id, key, own == null ? false : own ? null : true), { class: 'sh-lock', 'aria-pressed': String(eff), 'data-lock': key }));
  };

  /** The selected cell: movement, tracks, loop, its settings and locks, one row per track. */
  /**
   * The play button of ONE cell (the header buttons are gone on screen 3): ONE button, ▶ when the cell is silent and ■ while it plays (pressing it stops it).
   * `withLoop` adds the loop switch of the cell (as in the reader): the cell's loop on / off, a loop over the whole movement when it has none.
   */
  function playRow(sheet, cell, { withLoop = false } = {}) {
    const playing = app.cellPlaying(sheet.id, cell.id);
    const toggle = btn('', () => { if (app.cellPlaying(sheet.id, cell.id)) app.stopCell(); else app.playCell(sheet.id, cell.id); },
      { 'data-action': playing ? 'cell-stop' : 'cell-play', 'aria-label': label(playing ? 'player.stop' : 'player.play'), title: label(playing ? 'player.stop' : 'player.play'), 'aria-pressed': String(playing) }, playing ? 'square' : 'play');
    const row = el('div', { class: 'sh-opt', 'data-play-row': cell.id }, toggle);
    if (withLoop) {
      const mv = work().movements.find((m) => m.id === cell.movementId);
      const loop = cell.loop ?? null; const on = !!loop && loop.active !== false;
      row.append(btn('', () => {
        if (!mv?.masterbars.length) return;
        if (!loop) app.setCellLoop(sheet.id, cell.id, { from: mv.masterbars[0].id, to: mv.masterbars.at(-1).id, active: true });
        else app.setCellLoop(sheet.id, cell.id, { ...loop, active: !on });
      }, { 'data-action': 'cell-loop', 'aria-label': label('reader.loopToggle'), title: label('reader.loopToggle'), 'aria-pressed': String(on) }, 'repeat'));
    }
    return row;
  }

  function cellGroup(sheet) {
    const i = sheet.cells.findIndex((c) => c.id === cellId);
    const cell = sheet.cells[i];
    const sec = el('section', { 'data-group': 'cell' }, docked() ? null : el('h4', {}, label('sheets.tab.cell'))); // in the sidebar the tab above already says « Cell »
    if (!cell) { sec.append(el('p', { class: 'sh-hint' }, label('sheets.pickCell'))); return sec; }
    sec.append(playRow(sheet, cell, { withLoop: true }));
    const mv = work().movements.find((m) => m.id === cell.movementId);
    const st = cellSettings(work().sheets.find((x) => x.id === sheet.id), cell); const cs = cell.settings ?? {};
    sec.append(el('div', { class: 'sh-opt' },
      createChoiceMenu({ options: work().movements.map((m, k) => [m.id, movementName(m, k)]), value: cell.movementId, label: label('sheets.cellMovement'), follow: true, onPick: (v) => app.setSheetCellMovement(sheet.id, cell.id, v) })));
    const set = (key) => (v) => app.setCellOption(sheet.id, cell.id, key, v);
    const clear = (key) => () => app.setCellOption(sheet.id, cell.id, key, null);
    sec.append(
      valueRow(label('sheets.transposeDisplay'), stepper(st.transposeDisplay, -TRANSPOSE_RANGE, TRANSPOSE_RANGE, 1, set('transposeDisplay'), signed), cs.transposeDisplay != null, clear('transposeDisplay'), 'transposeDisplay'),
      valueRow(label('sheets.transposePlay'), stepper(st.transposePlay, -TRANSPOSE_RANGE, TRANSPOSE_RANGE, 1, set('transposePlay'), signed), cs.transposePlay != null, clear('transposePlay'), 'transposePlay'),
      el('div', { class: 'sh-opt' }, el('span', { class: 'sh-label' }, label('sheets.link')), btn(st.linkTranspose ? label('sheets.linked') : label('sheets.unlinked'), () => app.setCellOption(sheet.id, cell.id, 'linkTranspose', !st.linkTranspose), { 'aria-pressed': String(st.linkTranspose), 'data-link': '' })),
      valueRow(label('sheets.speed'), stepper(st.speed, SPEED_RANGE[0], SPEED_RANGE[1], 5, set('speed'), (v) => `${v} %`), cs.speed != null, clear('speed'), 'speed'),
      valueRow(label('sheets.staffSize'), stepper(st.staffSize ?? devOf().staffSpace, STAFF_SIZE_RANGE[0], STAFF_SIZE_RANGE[1], 1, set('staffSize'), (v) => `${v} px`), cs.staffSize != null, clear('staffSize'), 'staffSize'),
      valueRow(label('sheets.names'), btn(namesText(st.showNames), () => app.setCellOption(sheet.id, cell.id, 'showNames', st.showNames == null ? true : !st.showNames), { 'data-names': '', title: label('sheets.names') }), cs.showNames != null, clear('showNames'), 'showNames'),
      valueRow(label('sheets.tempo'), btn(tempoText(st.showTempo), () => app.setCellOption(sheet.id, cell.id, 'showTempo', st.showTempo == null ? true : !st.showTempo), { 'data-tempo': '', title: label('sheets.tempo') }), cs.showTempo != null, clear('showTempo'), 'showTempo'),
      valueRow(label('sheets.cardScale'), stepper(Math.round((st.cardScale ?? 1) * 100), 30, 150, 10, (v) => set('cardScale')(v / 100), (v) => `${v} %`), cs.cardScale != null, clear('cardScale'), 'cardScale'),
      valueRow(label('sheets.cardStyle'), btn(cardStyleText(st.cardStyle), () => app.setCellOption(sheet.id, cell.id, 'cardStyle', st.cardStyle === 'text' ? 'card' : 'text'), { 'data-card-style': '', title: label('sheets.cardStyle') }), cs.cardStyle != null, clear('cardStyle'), 'cardStyle'),
      valueRow(label('sheets.hiddenMuted'), btn(st.hiddenMuted ? label('sheets.hiddenMuted.yes') : label('sheets.hiddenMuted.no'), () => app.setCellOption(sheet.id, cell.id, 'hiddenMuted', !st.hiddenMuted), { 'aria-pressed': String(st.hiddenMuted), 'data-hidden-muted': '' }), cs.hiddenMuted != null, clear('hiddenMuted'), 'hiddenMuted'));
    // the loop proposed for the cell: two measures of its movement
    if (mv) {
      const bars = mv.masterbars.map((b, k) => [b.id, String(k + 1)]);
      const lp = cell.loop;
      sec.append(el('div', { class: 'sh-opt', 'data-cell-loop': '' }, el('span', { class: 'sh-label' }, label('sheets.loop')),
        createChoiceMenu({ options: bars, value: lp?.from ?? bars[0]?.[0], label: label('sheets.loopFrom'), follow: true, onPick: (v) => app.setCellLoop(sheet.id, cell.id, { from: v, to: lp?.to ?? v, active: lp?.active }) }),
        createChoiceMenu({ options: bars, value: lp?.to ?? bars.at(-1)?.[0], label: label('sheets.loopTo'), follow: true, onPick: (v) => app.setCellLoop(sheet.id, cell.id, { from: lp?.from ?? v, to: v, active: lp?.active }) }),
        lp ? btn(lp.active ? label('sheets.loopOn') : label('sheets.loopOff'), () => app.setCellLoop(sheet.id, cell.id, { ...lp, active: !lp.active }), { 'aria-pressed': String(!!lp.active), 'data-loop-active': '' }) : null,
        lp ? btn('✕', () => app.setCellLoop(sheet.id, cell.id, null), { 'aria-label': label('sheets.loopRemove'), 'data-loop-remove': '' }) : btn(label('sheets.loopAdd'), () => app.setCellLoop(sheet.id, cell.id, { from: bars[0][0], to: bars.at(-1)[0] }), { 'data-loop-add': '' })));
    }
    // the tracks, as in the panel of screen 1: an eye (shown in the cell or not) and a name that unfolds the track's own transposition and volume
    if (mv) {
      const all = !cell.tracks;
      const trackBox = el('div', { class: 'sh-tracklist', 'data-track-list': '', style: 'display:flex;flex-direction:column;gap:var(--btn-gap,2px)' });
      for (const t of mv.tracks) {
        const on = all || cell.tracks.includes(t.id); const open = openTracks.has(t.id);
        const own = cell.trackSettings?.[t.id] ?? {}; const eff = st.tracks[t.id] ?? { transposeDisplay: st.transposeDisplay, transposePlay: st.transposePlay, volume: null };
        const tset = (key) => (v) => app.setTrackOption(sheet.id, cell.id, t.id, key, v);
        const tclear = (key) => () => app.setTrackOption(sheet.id, cell.id, t.id, key, null);
        const toggleTrack = () => {
          const cur = all ? mv.tracks.map((x) => x.id) : cell.tracks;
          const next = on ? cur.filter((x) => x !== t.id) : [...cur, t.id];
          if (!next.length) return;
          app.setSheetCellTracks(sheet.id, cell.id, next.length === mv.tracks.length ? null : mv.tracks.map((x) => x.id).filter((x) => next.includes(x)));
        };
        const eye = btn(on ? '👁' : '🙈', () => {}, { 'aria-pressed': String(on), 'data-track': t.id, title: `${label(on ? 'sheets.trackHide' : 'sheets.trackShow')} — ${label('tracks.visualSolo')}` });
        { // a long press = the visual solo of the track in this cell (only it; again = back)
          const ids = mv.tracks.map((x) => x.id);
          const shownNow = all ? ids : ids.filter((x) => cell.tracks.includes(x));
          const key = `${sheet.id}|${cell.id}`;
          bindShortLong(eye, { onShort: toggleTrack, onLong: () => {
            const r = nextVisualSolo({ all: ids, shown: shownNow, target: [t.id], saved: soloMemory.get(key) ?? null });
            if (r.saved) soloMemory.set(key, r.saved); else soloMemory.delete(key);
            app.setSheetCellTracks(sheet.id, cell.id, r.shown.length === ids.length ? null : ids.filter((x) => r.shown.includes(x)));
            applyAudioSolo(app, t.id, r.active);
          } });
          eye.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTrack(); } });
        }
        const name = btn(`${open ? '▾' : '▸'} ${t.props[PID.NAME] || t.id}`, () => { if (open) openTracks.delete(t.id); else openTracks.add(t.id); draw(); }, { 'aria-expanded': String(open), 'data-track-name': t.id, 'data-no-icon': '', style: 'flex:1;text-align:left;border:0;background:transparent;font-weight:var(--w-semi,600)' });
        const row = el('div', { class: 'sh-track', 'data-track-row': t.id, ...(open ? { 'data-open': '' } : {}), style: on ? '' : 'opacity:.55' }, el('div', { class: 'sh-thead' }, eye, trackAudioButton(app, t.id, label), name));
        const body = el('div', { class: 'sh-topen' });
        if (open) { body.append(
          valueRow(label('sheets.transposeDisplay'), stepper(eff.transposeDisplay, -TRANSPOSE_RANGE, TRANSPOSE_RANGE, 1, tset('transposeDisplay'), signed), own.transposeDisplay != null, tclear('transposeDisplay'), `${t.id}:transposeDisplay`),
          valueRow(label('sheets.transposePlay'), stepper(eff.transposePlay, -TRANSPOSE_RANGE, TRANSPOSE_RANGE, 1, tset('transposePlay'), signed), own.transposePlay != null, tclear('transposePlay'), `${t.id}:transposePlay`),
          valueRow(label('sheets.volume'), fader(Math.round((eff.volume ?? 100 / 127) * 127), (v) => app.setTrackOption(sheet.id, cell.id, t.id, 'volume', v / 127)), own.volume != null, tclear('volume'), `${t.id}:volume`),
          compositesOf(t).length ? valueRow(label('composite.pick'), createChoiceMenu({ options: [['', label('composite.real')], ...compositesOf(t).map((c, k) => [c.id, c.name || label('composite.defaultName', { n: k + 1 })])], value: own.composite ?? '', label: label('composite.pick'), act: 'sheet-composite', onPick: (id) => tset('composite')(id || null) }), own.composite != null, tclear('composite'), `${t.id}:composite`) : null,
          trackDisplayRow({ label, own: { showBars: own.showBars, sizePct: own.sizePct, slashes: own.slashes, show: own.show, colors: own.colors }, base: resolveDisplay(trackLayer(t)), sizeable: true, slashes: { ranges: false, explicitEmpty: true }, className: 'sh-value',
            onSet: (patch) => { for (const [k, v] of Object.entries(patch)) tset(k)(v); } })); row.append(body); }
        trackBox.append(row);
      }
      sec.append(fold('tracks', label('sheets.tracks'), [trackBox]));
    }
    // locks of this cell (the sheet's by default)
    sec.append(fold('locks', label('sheets.locks'), READER_LOCKS.map((k) => lockCycle(sheet, cell, k, label(`sheets.lock.${k}`)))));
    sec.append(el('div', { class: 'sh-opt' },
      btn('↑', () => app.moveSheetCell(sheet.id, cell.id, i - 1), { disabled: i === 0, 'aria-label': label('sheets.cellUp') }),
      btn('↓', () => app.moveSheetCell(sheet.id, cell.id, i + 1), { disabled: i === sheet.cells.length - 1, 'aria-label': label('sheets.cellDown') }),
      btn('✕', () => { app.removeSheetCell(sheet.id, cell.id); cellId = null; }, { 'aria-label': label('sheets.cellRemove'), 'data-cell-remove': cell.id })));
    return sec;
  }

  /** The options offered to the reader, each with its lock. */
  function readerGroup(sheet) {
    const r = sheet.reader;
    const pick = (key, values) => createChoiceMenu({ options: values.map((v) => [v, label(`sheets.${key}.${v}`)]), value: r[key], label: label(`sheets.${key}`), follow: true, act: `sheet-${key}`, onPick: (v) => app.setReaderOption(sheet.id, key, v) });
    return el('section', { 'data-group': 'reader', 'data-reader': '' }, sheet.cells.length === 1 ? playRow(sheet, sheet.cells[0]) : null,
      fold('presentation', label('sheets.presentation'), [
        el('p', { class: 'sh-hint' }, label('sheets.presentationHint')),
        el('div', { class: 'sh-opt', 'data-opt': 'playerMode' }, el('span', { class: 'sh-label' }, label('sheets.playerMode')), pick('playerMode', ['auto', 'global', 'cases'])),
        el('div', { class: 'sh-opt', 'data-opt': 'carousel' }, el('span', { class: 'sh-label' }, label('sheets.carousel')), pick('carousel', ['auto', 'always', 'never'])),
      ]),
      fold('transpose', label('sheets.transposeAdvanced'), [
        helpOpen ? el('p', { class: 'sh-hint', 'data-help': '' }, label('sheets.transposeHelp')) : null,
        lockRow(sheet, 'transposeDisplay', label('sheets.transposeDisplay'), stepper(r.transposeDisplay, -TRANSPOSE_RANGE, TRANSPOSE_RANGE, 1, (v) => app.setReaderOption(sheet.id, 'transposeDisplay', v), signed)),
        lockRow(sheet, 'transposePlay', label('sheets.transposePlay'), stepper(r.transposePlay, -TRANSPOSE_RANGE, TRANSPOSE_RANGE, 1, (v) => app.setReaderOption(sheet.id, 'transposePlay', v), signed)),
        el('div', { class: 'sh-opt' }, el('span', { class: 'sh-label' }, label('sheets.link')), btn(r.linkTranspose ? label('sheets.linked') : label('sheets.unlinked'), () => app.setReaderOption(sheet.id, 'linkTranspose', !r.linkTranspose), { 'aria-pressed': String(r.linkTranspose), 'data-link': '' }))],
        { guard: () => confirmDialog({ message: label('sheets.transposeWarn'), label }), extra: btn('?', () => { helpOpen = !helpOpen; openSections.add('transpose'); draw(); }, { 'data-no-icon': '', 'aria-label': label('sheets.transposeWhy'), title: label('sheets.transposeWhy'), 'data-action': 'transpose-help', style: 'min-width:var(--ui-target,30px)' }) }),
      lockRow(sheet, 'speed', label('sheets.speed'), stepper(r.speed, SPEED_RANGE[0], SPEED_RANGE[1], 5, (v) => app.setReaderOption(sheet.id, 'speed', v), (v) => `${v} %`)),
      lockRow(sheet, 'staffSize', label('sheets.staffSize'), stepper(r.staffSize ?? devOf().staffSpace, STAFF_SIZE_RANGE[0], STAFF_SIZE_RANGE[1], 1, (v) => app.setReaderOption(sheet.id, 'staffSize', v), (v) => `${v} px`)),
      lockRow(sheet, 'hiddenMuted', label('sheets.hiddenMuted'), btn(r.hiddenMuted ? label('sheets.hiddenMuted.yes') : label('sheets.hiddenMuted.no'), () => app.setReaderOption(sheet.id, 'hiddenMuted', !r.hiddenMuted), { 'aria-pressed': String(r.hiddenMuted), 'data-hidden-muted': '' })),
      lockRow(sheet, 'names', label('sheets.names'), btn(namesText(r.showNames), () => app.setReaderOption(sheet.id, 'showNames', r.showNames == null ? true : r.showNames ? false : null), { 'data-names': '', title: label('sheets.names') })),
      el('div', { class: 'sh-opt', 'data-opt': 'showTempo' }, el('span', { class: 'sh-label' }, label('sheets.tempo')), btn(tempoText(r.showTempo), () => app.setReaderOption(sheet.id, 'showTempo', r.showTempo == null ? true : r.showTempo ? false : null), { 'data-tempo': '', title: label('sheets.tempo') })),
      lockRow(sheet, 'volume', label('sheets.volume'), el('span', { class: 'sh-hint' }, label('sheets.volumeNote'))),
      lockRow(sheet, 'loop', label('sheets.loop'), el('span', { class: 'sh-hint' }, label('sheets.loopNote'))),
      fold('structure', label('sheets.structure'), [
        el('p', { class: 'sh-hint' }, label('sheets.structureHint')),
      ...[['showSections', 'sheets.showSections'], ['showRehearsal', 'sheets.showRehearsal'], ['sectionColors', 'sheets.sectionColors']].map(([k, name]) => el('div', { class: 'sh-opt', 'data-opt': k }, el('span', { class: 'sh-label' }, label(name)), btn(r[k] ? label('sheets.on') : label('sheets.off'), () => app.setReaderOption(sheet.id, k, !r[k]), { 'aria-pressed': String(r[k]), 'data-structure': k }))),
      el('div', { class: 'sh-opt', 'data-opt': 'cardScale' }, el('span', { class: 'sh-label' }, label('sheets.cardScale')), stepper(Math.round((r.cardScale ?? 1) * 100), 30, 150, 10, (v) => app.setReaderOption(sheet.id, 'cardScale', v / 100), (v) => `${v} %`)),
      el('div', { class: 'sh-opt', 'data-opt': 'cardStyle' }, el('span', { class: 'sh-label' }, label('sheets.cardStyle')), btn(cardStyleText(r.cardStyle ?? 'card'), () => app.setReaderOption(sheet.id, 'cardStyle', r.cardStyle === 'text' ? 'card' : 'text'), { 'data-card-style': '', title: label('sheets.cardStyle') })),
      lockRow(sheet, 'signs', label('sheets.colorSigns'), el('span', { class: 'sh-opt', 'data-opt': 'colorSigns' }, btn(r.colorSigns ? label('sheets.on') : label('sheets.off'), () => app.setReaderOption(sheet.id, 'colorSigns', !r.colorSigns), { 'aria-pressed': String(r.colorSigns), 'data-structure': 'colorSigns' }),
        el('input', { type: 'color', value: r.signsColor, 'aria-label': label('sheets.signsColor'), title: label('sheets.signsColor'), 'data-signs-color': '', onchange: (e) => app.setReaderOption(sheet.id, 'signsColor', e.target.value) }))),
      ]),
      fold('dividers', label('dividers.title'), [
        el('p', { class: 'sh-hint' }, label('dividers.hint')),
        ...dividerRows(sheet.dividers).map((row) => {
          const set = (patch) => app.setSheetDividers(sheet.id, patch);
          if (row.kind === 'bool') return el('div', { class: 'sh-opt', 'data-opt': `divider-${row.key}` }, el('span', { class: 'sh-label' }, label(row.title)), btn(row.value ? label('sheets.on') : label('sheets.off'), () => set({ [row.key]: !row.value }), { 'aria-pressed': String(row.value) }));
          if (row.kind === 'choice') return el('div', { class: 'sh-opt', 'data-opt': `divider-${row.key}` }, el('span', { class: 'sh-label' }, label(row.title)), createChoiceMenu({ options: row.options.map(([v, key]) => [v, label(key)]), value: row.value, label: label(row.title), follow: true, act: `divider-${row.key}`, onPick: (v) => set({ [row.key]: v }) }));
          return el('div', { class: 'sh-opt', 'data-opt': `divider-${row.key}` }, el('span', { class: 'sh-label' }, label(row.title)), stepper(row.value, row.min, row.max, row.step, (v) => set({ [row.key]: v }), row.format));
        }),
      ]),
      fold('export', label('sheets.export'), [
        el('p', { class: 'sh-hint' }, label('sheets.exportHint')),
        el('div', { class: 'sh-opt' }, btn(label('file.exportReader'), () => onExport('reader'), { 'data-export': 'reader' }), btn(label('file.exportReaderOnly'), () => onExport('readeronly'), { 'data-export': 'readeronly' })),
      ]));
  }

  function draw() {
    rememberTabletScroll(root, tabletState);
    root.replaceChildren();
    const sheets = app.sheets();
    if (!sheets.some((s) => s.id === sheetId)) { sheetId = sheets[0]?.id ?? null; cellId = null; }
    const sheet = sheets.find((s) => s.id === sheetId);
    if (sheet && !sheet.cells.some((c) => c.id === cellId)) cellId = null;
    queueMicrotask(onSelect);
    root.append(el('div', { class: 'sh-row' }, el('h3', {}, label('sheets.title')),
      ...sheets.map((s) => {
        const tab = btn(s.name || label('sheets.unnamed', { n: s.index + 1 }), () => { sheetId = s.id; cellId = null; draw(); }, { class: 'sh-tab', 'aria-pressed': String(s.id === sheetId), 'data-sheet': s.id });
        tab.addEventListener('dblclick', () => { sheetId = s.id; cellId = null; draw(); queueMicrotask(() => { const t = root.querySelector(`[data-sheet="${s.id}"]`); if (t) openSheetMenu(s, t); }); }); // double click on the name: rename / delete
        return tab;
      }),
      sheet ? btn('', () => openSheetMenu(sheet, root.querySelector(`[data-sheet="${sheet.id}"]`) ?? root), { 'data-action': 'sheet-edit', title: label('sheets.rename'), 'aria-label': label('sheets.rename') }, 'pencil') : null,
      btn(`+ ${label('sheets.add')}`, () => { const made = app.addSheet({ name: '' }); sheetId = made?.id ?? app.sheets().at(-1)?.id; cellId = null; draw(); }, { 'data-action': 'sheet-add' }),
      // a quick « + Cell » next to « + Sheet » (the one of the Sheet tab stays)
      sheet ? btn(`+ ${label('sheets.addCell')}`, () => app.addSheetCell(sheet.id, work().movements[0].id), { 'data-action': 'cell-add-top', title: label('sheets.addCell') }) : null,
      // the number of columns of the sheet: « Col − n + »
      sheet ? el('span', { class: 'sh-col', 'data-opt': 'columns', title: label('sheets.columnsLabel') }, el('span', { class: 'sh-label' }, label('sheets.colShort')), stepper(sheet.columns, 1, MAX_COLUMNS, 1, (c) => app.setSheetColumns(sheet.id, c), (c) => String(c))) : null,
      sheet ? el('span', { style: 'flex:1' }) : null,
      ...(sheet ? [previewHtml ? btn('', () => openPreview(sheet), { 'data-action': 'sheet-preview', title: label('sheets.preview'), 'aria-label': label('sheets.preview') }, 'eye') : null, deviceButton()] : [])));
    const groups = sheet ? { cell: cellGroup(sheet), reader: readerGroup(sheet) } : null;
    if (sidebar) for (const g of TABS) sidebar.tabBody(tabId(g))?.replaceChildren(...(docked() && groups ? [el('div', { class: 'sh-side sh-docked', 'data-sheets-tab': g }, groups[g])] : []));
    if (!sheet) { root.append(el('p', { class: 'sh-empty' }, label('sheets.none'))); return; }
    const main = el('div', { class: 'sh-main' });
    root.append(main);
    main.append(previewOf(sheet));
    if (!docked()) { // a tablet or a phone: the settings in tabs (Case / Lecteur), a sheet at the bottom or a column beside the sheet (ui/tablet-panel.js)
      main.append(createTabletPanel({
        tabs: TABS.map((g) => ({ id: g, text: label(`sheets.tab.${g}`) })), state: tabletState, attrs: { 'data-sheets-props': '' },
        getShell: () => root,
        build: (tab) => el('div', { class: 'sh-panel' }, groups[tab]),
      }));
    }
  }

  /** ONE button that cycles computer → tablet → phone (its icon shows the device on view). */
  function deviceButton(refresh = () => draw(), extraStyle = '') {
    const ids = deviceIds(); if (!ids.includes(device)) device = ids[0]; const i = ids.indexOf(device);
    const name = label(`sheets.device.${device}`);
    const b = btn('', () => { device = ids[(i + 1) % ids.length]; refresh(b); }, { style: extraStyle, 'data-action': 'sheet-device', 'data-device': device, title: `${label('sheets.device')} : ${name}`, 'aria-label': `${label('sheets.device')} : ${name}` });
    b.append(icon({ here: hereDevice().width <= 600 ? 'smartphone' : 'tablet', pc: 'monitor', tablet: 'tablet', phone: 'smartphone' }[device]));
    markCyclic(b, ids.length, i);
    return b;
  }

  /** The preview: the page the HTML export would write (the reader with this work inside), in a frame of the device on view, over the screen; a round ✕ goes back. */
  let previewEl = null;
  function closePreview() { previewEl?.remove(); previewEl = null; window.removeEventListener('resize', fitPreview); window.removeEventListener('keydown', previewKey, true); }
  const previewKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePreview(); } };
  function fitPreview() {
    if (!previewEl) return;
    const r = host.getBoundingClientRect(); const dockH = document.querySelector('[data-dock]')?.offsetHeight ?? 0;
    const top = Math.max(0, r.top); const bottom = Math.min(window.innerHeight - dockH, r.bottom);
    Object.assign(previewEl.style, { left: `${Math.max(0, r.left)}px`, top: `${top}px`, width: `${r.width}px`, height: `${Math.max(120, bottom - top)}px` });
    const dev = device === 'here' ? { ...devOf(), width: Math.max(320, previewEl.clientWidth - 16) } : devOf(); const stage = previewEl.querySelector('[data-preview-stage]'); const frame = previewEl.querySelector('iframe');
    const availW = previewEl.clientWidth - 16; const availH = previewEl.clientHeight - 16; const k = Math.min(1, availW / dev.width);
    frame.style.width = `${dev.width}px`; frame.style.height = `${availH / k}px`; frame.style.transform = `scale(${k})`;
    stage.style.width = `${dev.width * k}px`; stage.style.height = `${availH}px`;
  }
  function openPreview(sheet) {
    closePreview();
    let html = null; try { html = previewHtml(sheet.id); } catch { html = null; }
    if (!html) return;
    previewEl = el('div', { 'data-sheet-preview': '', role: 'dialog', 'aria-label': label('sheets.preview'), style: 'position:fixed;z-index:60;background:var(--desk,#d9d6cf);overflow:hidden;display:flex;justify-content:center;align-items:flex-start;padding:8px;box-sizing:border-box' });
    const frame = el('iframe', { title: label('sheets.preview'), style: 'border:0;background:var(--field,#fff);transform-origin:top left;display:block;border-radius:10px' });
    frame.srcdoc = html;
    const stage = el('div', { 'data-preview-stage': '', style: 'position:relative;overflow:hidden;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.3)' }, frame);
    const round = 'width:44px;height:44px;min-width:44px;border-radius:50%;padding:0;background:var(--field,#fff);border:1px solid var(--edge,#888);box-shadow:0 1px 6px rgba(0,0,0,.3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer';
    const tools = el('div', { style: 'position:absolute;top:12px;right:14px;display:flex;gap:8px;z-index:2' },
      (() => { const make = () => deviceButton((b) => { fitPreview(); b.replaceWith(make()); }, round); return make(); })(),
      btn('', closePreview, { 'data-action': 'sheet-preview-close', title: label('sheets.previewClose'), 'aria-label': label('sheets.previewClose'), style: round }, 'x'));
    previewEl.append(stage, tools);
    document.body.append(previewEl);
    window.addEventListener('resize', fitPreview); window.addEventListener('keydown', previewKey, true);
    fitPreview();
  }

  function previewOf(sheet) {
    const stage = el('div', { class: 'sh-stage' });
    const dev = devOf();
    const frame = el('div', { class: 'sh-frame', 'data-frame': device });
    frame.style.width = `${dev.width}px`;
    const ropts = sheet.reader;
    const getStyle = (sid) => (sid === SID.SECTION_COLORS_SHOW ? ropts.sectionColors : resolveStyle(sid, [null, work().movements[0]?.style]));
    let laid;
    try { laid = layoutSheet(work(), work().sheets.find((s) => s.id === sheet.id), glyphs, { device: dev, reader: sheet.reader, getStyle, signsColor: ropts.colorSigns ? ropts.signsColor : null }); } catch (e) { stage.append(el('p', { class: 'sh-empty' }, String(e.message))); return stage; }
    frame.style.gridTemplateColumns = `repeat(${laid.frame.columns}, ${laid.frame.cellWidth}px)`;
    if (!laid.cells.length) frame.append(el('p', { class: 'sh-empty' }, label('sheets.noCells')));
    sheet.cells.forEach((cell, i) => {
      const c = laid.cells[i];
      const svg = el('div', { style: '--glyph-erode:var(--paper,#faf8f4)' }); svg.innerHTML = c ? uniqueSvgIds(renderSvgString(c.layout, glyphs, { staffSpace: c.staffSpace, margin: c.margin, ink: 'var(--ink, #000)', paper: 'var(--paper, #faf8f4)' })) : '';
      const box = el('div', { class: 'sh-cell', 'data-cell': cell.id, 'aria-selected': String(cell.id === cellId) }, svg);
      if (c && ropts.showSections) addSectionCards(box, c);
      box.addEventListener('click', () => { cellId = cell.id; draw(); if (docked()) sidebar.show(tabId('cell')); });
      frame.append(box);
    });
    lastLaid = laid;
    stage.append(frame);
    // fit the device frame in the available width (the scale is only a preview; the sheet itself is laid out for the device width)
    requestAnimationFrame(() => {
      const avail = stage.clientWidth || dev.width; const k = device === 'here' ? 1 : Math.min(1, avail / dev.width); // (« this device »: drawn at its own size)
      frame.style.transform = `scale(${k})`; stage.style.height = `${Math.ceil(frame.offsetHeight * k) + 4}px`;
    });
    return stage;
  }

  /** The playing cell's cursor: a thin line over its preview, moved every frame while it sounds. */
  function placeCursor() {
    raf = 0;
    const cur = app.cellCursor();
    for (const e of host.querySelectorAll('.sh-playhead')) e.remove();
    if (!cur) return;
    const [sid, cid] = cur.id.split('|');
    const sheet = work().sheets.find((x) => x.id === sid); const cell = sheet && sheetCells(work(), sheet).find((c) => c.id === cid);
    const box = host.querySelector(`[data-cell="${cid}"]`); const laid = lastLaid?.cells.find((c) => c.id === cid);
    if (!cell || !box || !laid) return;
    const at = locate(cur.sequence, cur.seconds);
    const mv = work().movements.find((m) => m.id === cell.movementId);
    const r = playheadRect(laid, mv, at); const svg = box.querySelector('svg'); const vb = svg?.viewBox.baseVal;
    if (r && vb) {
      const line = el('div', { class: 'sh-playhead', style: `position:absolute;width:2px;background:#e8731a;pointer-events:none;left:${(r.x / vb.width) * 100}%;top:${(r.y1 / vb.height) * 100}%;height:${((r.y2 - r.y1) / vb.height) * 100}%` });
      svg.parentElement.style.position = 'relative'; svg.parentElement.append(line);
    }
    raf = requestAnimationFrame(placeCursor);
  }
  const kick = () => { if (!raf && app.cellCursor()) raf = requestAnimationFrame(placeCursor); };
  const unsubscribe = app.doc.subscribe(() => { if (host.isConnected && host.style.display !== 'none') draw(); });
  const offMixer = app.onMixerChange?.(() => { if (host.isConnected && host.style.display !== 'none') draw(); }) ?? (() => {});
  const offSide = sidebar?.onChange?.(() => { if (host.isConnected) draw(); });
  const offPlay = app.onCellPlay(() => { if (host.isConnected) { draw(); kick(); } }); // the play button shows whether the cell sounds
  draw();
  // a turn of the tablet changes the width « this device » is drawn for
  let resizeTimer = 0;
  const onResize = () => { if (device !== 'here' || !host.isConnected || !host.offsetParent) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (host.isConnected) draw(); }, 200); };
  window.addEventListener('resize', onResize);
  return { destroy() { window.removeEventListener('resize', onResize); clearTimeout(resizeTimer); closePreview(); closeSheetMenu(); app.stopCell(); cancelAnimationFrame(raf); unsubscribe(); offMixer(); offSide?.(); offPlay(); if (sidebar) for (const g of TABS) sidebar.removeTab(tabId(g)); root.remove(); }, refresh: draw, selection: () => ({ sheetId, cellId }), READER_LOCKS };
}
