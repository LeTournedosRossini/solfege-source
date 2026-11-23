/*
 * The content of the "Work" and "Movement" panels, shared by the two places that show it: the sidebar of screen 1 (computers) and the floating panel of the
 * header tabs (tablet / phone sheet, or a screen without those sidebar tabs). Every field validates on change = one undoable transaction (`Application.setWorkMeta`,
 * `setCardText`, `setCardNumber`…); which movement the score shows is view state (`onShow`), never in the document.
 */
import { openTransposeDialog } from './transpose-dialog.js';
import { openSplitDialog } from './split-dialog.js';
import { openTimeSigDialog } from './time-sig-dialog.js';
import { openKeySigDialog } from './key-sig-dialog.js';
import { openScalesDialog } from './scales-dialog.js';
import { openWorkChordsDialog } from './work-chords-dialog.js';
import { PID, getProperty } from '../model/index.js';
import { pickImageFile } from './file-io.js';

const STYLE_ID = 'work-panels-style';
const CSS = `
.ht-content { font: 14px var(--ui-font,sans-serif); color: var(--ink,#111); box-sizing: border-box; }
.ht-content .ht-grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; }
.ht-content input[type="text"] { font: inherit; font-size: 15px; min-height: var(--ui-target, 30px); box-sizing: border-box; padding: 0 8px; border: 1px solid var(--edge,#bbb); border-radius: 6px; width: 100%; min-width: 8em; }
.ht-content .ht-row { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; margin-bottom: 10px; }
.ht-content button { min-width: var(--ui-target, 30px); min-height: var(--ui-target, 30px); padding: 0 10px; font: inherit; }
.ht-content button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.ht-content .ht-num { width: 4.5em; min-width: 0; text-align: center; }
`;
const FIELDS = ['title', 'subtitle', 'composer', 'arranger', 'lyricist', 'album', 'copyright', 'date'];
const FIELD_PIDS = { title: PID.TITLE, subtitle: PID.SUBTITLE, composer: PID.COMPOSER, arranger: PID.ARRANGER, lyricist: PID.LYRICIST, album: PID.ALBUM, copyright: PID.COPYRIGHT, date: PID.DATE };
const CSS_escape = (s) => String(s).replace(/["\\]/g, '\\$&');

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

/** `onShow(movementId)` shows that movement on the score; `shownId()` says which one is shown; `chain` = { get, set } for "chain the movements". */
export function createWorkPanels({ app, label, onShow, shownId, chain = null }) {
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) document.head.append(Object.assign(document.createElement('style'), { id: STYLE_ID, textContent: CSS }));
  let blocksOpen = false; // the "text blocks" zone is folded by default (the side panel is kept compact)
  let helpOpen = false; // the small help on the card number format (shared by all the places)
  const field = (value, placeholder, title, onchange, extra = {}) => el('input', { type: 'text', value, placeholder, title, 'aria-label': title, autocomplete: 'off', spellcheck: 'false', onchange: (e) => onchange(e.target.value), ...extra });

  /** Builds the nodes of a panel; `redraw()` is called after every change (so the caller redraws its own container). */
  function build(kind, redraw) {
    let imageError = '';
    const run = (fn) => { try { fn(); } catch (e) { if (e.name !== 'TrackEditError' && e.name !== 'PartEditError' && e.name !== 'EditError') throw e; } redraw(); };
    if (kind === 'work') {
      const work = app.doc.work;
      // no label next to a field: its name is the grey text inside it
      return [el('div', { class: 'ht-grid' }, FIELDS.map((key) =>
        field(getProperty(work, FIELD_PIDS[key]) ?? '', label(`headerTabs.work.${key}`), label(`headerTabs.work.${key}`), (v) => run(() => app.setWorkMeta({ [key]: v })), { style: 'grid-column:1 / -1' }))),
        // the chords of the piece and the layers of preferred fingerings (an easier set, power chords…)
        el('div', { class: 'ht-row', style: 'margin-top:10px' }, el('button', { type: 'button', 'data-act': 'work-chords', 'data-dismiss-keep': '', title: label('chords.openHint'), onclick: () => openWorkChordsDialog({ app, label, onDone: redraw }) }, label('chords.open')))];
    }
    const outline = app.tracksOutline();
    const current = outline.find((m) => m.id === shownId()) ?? outline[0];
    const name = (m) => `${m.cardNumber} · ${m.title || label('tracks.movement', { n: m.movementIndex + 1 })}`;
    return [
      el('div', { class: 'ht-row', role: 'group', 'aria-label': label('headerTabs.movement.pick') },
        ...outline.map((m) => el('button', { type: 'button', 'data-movement': m.id, 'aria-pressed': String(m.id === current.id), title: name(m), onclick: () => { onShow(m.id); redraw(); } }, name(m))),
        chain && el('button', { type: 'button', 'data-act': 'chain-movements', 'aria-pressed': String(chain.get()), title: label('headerTabs.movement.chainHint'), onclick: () => { chain.set(!chain.get()); redraw(); } }, label('headerTabs.movement.chain')),
        el('button', { type: 'button', 'data-act': 'add-movement', title: label('movements.addTitle'), onclick: () => run(() => { const id = app.addMovement({ from: current.id, measures: 1 }); onShow(id); }) }, label('movements.add'))),
      el('div', { class: 'ht-grid' },
        field(current.title, label('movements.titlePlaceholder'), label('movements.titleField'), (v) => run(() => app.setCardText(current.id, { title: v })), { style: 'grid-column:1 / -1' }),
        field(current.description, label('movements.descriptionPlaceholder'), label('movements.descriptionField'), (v) => run(() => app.setCardText(current.id, { description: v })), { style: 'grid-column:1 / -1' }),
        el('span', {}, label('headerTabs.movement.number')), el('div', { class: 'ht-row', style: 'margin:0' },
          field(current.cardForced ? current.cardNumber : '', current.cardNumber, label('movements.number', { n: current.cardNumber }), (v) => run(() => app.setCardNumber(current.id, v)), { class: 'ht-num', maxlength: '12' }),
          el('button', { type: 'button', 'data-act': 'duplicate-movement', title: label('movements.duplicate'), 'aria-label': label('movements.duplicate'), onclick: () => run(() => { const id = app.duplicateMovement(current.id); onShow(id); }) }, '⧉'),
          el('button', { type: 'button', 'data-act': 'remove-movement', title: label('movements.remove'), 'aria-label': label('movements.remove'), disabled: !current.canRemove, onclick: () => run(() => { app.removeMovement(current.id); onShow(null); }) }, '🗑')),
        el('span', {}, label('movements.format')), el('div', { class: 'ht-row', style: 'margin:0' },
          field(current.cardFormat, '{n}', label('movements.formatHint'), (v) => run(() => app.setCardNumberFormat(v || '{n}')), { class: 'ht-num', style: 'width:8em', maxlength: '24' }),
          el('button', { type: 'button', 'data-act': 'format-help', 'aria-expanded': String(helpOpen), 'aria-label': label('headerTabs.formatHelp.open'), title: label('headerTabs.formatHelp.open'), onclick: () => { helpOpen = !helpOpen; redraw(); } }, '?'))),
      el('div', { class: 'ht-row' }, el('button', { type: 'button', 'data-act': 'transpose-music', 'data-dismiss-keep': '', title: label('transpose.openHint'), onclick: () => openTransposeDialog({ app, label, movement: current.movementIndex }) }, label('transpose.open')),
        el('button', { type: 'button', 'data-act': 'time-signature', 'data-dismiss-keep': '', title: label('timesig.openHint'), onclick: () => openTimeSigDialog({ app, label, movement: current.movementIndex }) }, label('timesig.open')),
        el('button', { type: 'button', 'data-act': 'key-signature', 'data-dismiss-keep': '', title: label('keysig.openHint'), onclick: () => openKeySigDialog({ app, label, movement: current.movementIndex }) }, label('keysig.open')),
        el('button', { type: 'button', 'data-act': 'split-movement', 'data-dismiss-keep': '', title: label('split.openHint'), onclick: () => openSplitDialog({ app, label, movement: current.movementIndex, onDone: (r) => onShow(r.ids[0]) }) }, label('split.open')),
        el('button', { type: 'button', 'data-act': 'scales-open', 'data-dismiss-keep': '', title: label('scales.openHint'), onclick: () => openScalesDialog({ app, label, movement: current.movementIndex, onDone: (id) => onShow(id) }) }, label('scales.open'))),
      helpOpen && el('div', { 'data-format-help': '', role: 'note', style: 'margin:8px 0 0;padding:8px 10px;border:1px solid var(--edge,#ccc);border-radius:8px;background:var(--paper,#faf8f4);font-size:13px;line-height:1.45' },
        el('strong', {}, label('headerTabs.formatHelp.title')),
        el('ul', { style: 'margin:4px 0 0;padding-left:18px' }, ['n', 'a', 'forced', 'examples', 'append'].map((k) => el('li', {}, label(`headerTabs.formatHelp.${k}`)))),
        el('button', { type: 'button', 'data-act': 'format-help-close', style: 'margin-top:6px', onclick: () => { helpOpen = false; redraw(); } }, label('headerTabs.formatHelp.close'))),
      // the band of blocks of the movement: free texts above its first system (every screen that shows the movement shows them)
      el('button', { type: 'button', 'data-act': 'blocks-fold', 'aria-expanded': String(blocksOpen), style: 'margin-top:10px;width:100%;text-align:left', onclick: () => { blocksOpen = !blocksOpen; redraw(); } }, `${blocksOpen ? '▾' : '▸'} ${label('blocks.title')}`),
      blocksOpen && el('div', { class: 'ht-row', 'data-blocks-row': '', style: 'margin-top:6px;align-items:center;flex-wrap:wrap' },
        el('button', { type: 'button', 'data-act': 'add-text-block', title: label('blocks.addHint'), onclick: () => run(() => { onShow(current.id); app.addTextBlock({}); app.setBlocksEditing(true); }) }, `＋ ${label('blocks.addText')}`),
        el('button', { type: 'button', 'data-act': 'add-image-block', title: label('blocks.addImageHint'), onclick: async () => { // the picker opens inside the gesture; the block is added once a picture is chosen
          try { const f = await pickImageFile(); if (!f) return; imageError = ''; run(() => { onShow(current.id); app.addPictureBlock(f); app.setBlocksEditing(true); }); } catch (e) { imageError = e?.message ?? String(e); redraw(); } } }, `＋ ${label('blocks.addImage')}`),
        imageError && el('span', { role: 'alert', style: 'font:12px var(--ui-font,sans-serif);color:var(--danger-ink,#a33)' }, imageError),
        el('button', { type: 'button', 'data-act': 'edit-blocks', 'aria-pressed': String(app.blocksEditing()), title: label('blocks.editHint'), onclick: () => { app.setBlocksEditing(!app.blocksEditing()); redraw(); } }, label('blocks.edit')),
        el('button', { type: 'button', 'data-act': 'band-lower', title: label('blocks.lower'), 'aria-label': label('blocks.lower'), onclick: () => run(() => { onShow(current.id); app.setBlockAspect(Math.max(0.05, Math.round((app.blockAspect() - 0.05) * 100) / 100)); }) }, '−'),
        el('span', { style: 'font:12px var(--ui-font,sans-serif);min-width:32px;text-align:center' }, app.blockAspect().toFixed(2)),
        el('button', { type: 'button', 'data-act': 'band-higher', title: label('blocks.higher'), 'aria-label': label('blocks.higher'), onclick: () => run(() => { onShow(current.id); app.setBlockAspect(Math.min(1.5, Math.round((app.blockAspect() + 0.05) * 100) / 100)); }) }, '+')),
    ];
  }

  /** Fills `container` with the panel `kind`, keeping the keyboard focus on the same field; the container redraws itself after a change. */
  function render(container, kind) {
    container.classList.add('ht-content');
    const focusKey = container.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    container.replaceChildren(...build(kind, () => render(container, kind)).filter(Boolean)); // a closed help is `false`: never written as the text "false"
    if (focusKey) container.querySelector(`[aria-label="${CSS_escape(focusKey)}"]`)?.focus?.({ preventScroll: true });
  }
  return { build, render };
}

/**
 * Puts the "Work" and "Movement" panels into the tabs `workId` / `movementId` of the sidebar (screen 1, computers). They are redrawn when the document
 * changes and when the sidebar changes (tab shown), and only while their tab is shown.
 */
export function mountSidebarWorkPanels({ sidebar, app, label, onShow, shownId, chain, workId = 'work', movementId = 'movement' }) {
  const panels = createWorkPanels({ app, label, onShow, shownId, chain });
  const kinds = [[workId, 'work'], [movementId, 'movement']];
  const draw = () => {
    for (const [id, kind] of kinds) {
      const body = sidebar.tabBody(id);
      if (body && sidebar.isTabShown(id)) { body.style.padding = '12px'; panels.render(body, kind); }
    }
  };
  const offDoc = app.doc.subscribe(draw);
  const offSide = sidebar.onChange(draw);
  draw();
  return { refresh: draw, destroy() { offDoc?.(); offSide?.(); for (const [id] of kinds) sidebar.tabBody(id)?.replaceChildren(); } };
}
