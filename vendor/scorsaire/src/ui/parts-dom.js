/*
 * Screen 2 — parts and page layout (DOM). A part = a print layout of the work: a tab per part on wide screens, a choice menu on phones and
 * tablets (roadmap §7: the tab strip is only the presentation). Properties on the left (name, page format, orientation, margins, staff size,
 * staves shown), the paginated pages stacked on the right. Read-only music: only the layout is edited. Every control = one undoable transaction.
 * The score of screen 1 is never touched by what happens here.
 */
import { openWorkChordsDialog } from './work-chords-dialog.js';
import { openPartStaffTextDialog } from './part-stafftext-dialog.js';
import { partStaffTextsOf } from '../model/partstafftext.js';
import { createSwitch } from './switch.js';
import { confirmDialog } from './confirm-dialog.js';
import { measureOffsetOf, fAdd } from '../model/index.js';
import { SID, PID, resolveStyle, userStyleEpoch, pageGeometry, pageFormatIds, partStaffIds, partBreaks, lockContaining, measureNumbers, partOverrideOf, MUSIC_TYPES, effectiveStaffGap, staffGapKey, partStaffChoices, sectionList, ZONE_BEFORE_BASE, ZONE_MAX_ROWS, isBeforeRow } from '../model/index.js';
import { layoutPart, createPartCache } from '../layout/index.js';
import { PRINT_DEFAULTS } from '../layout/partlayout.js';
import { createRoleSelect } from './role-select.js';
import { pageHintsOf } from '../model/pagehints.js';
import { createReaderPreview } from './reader-preview.js';
import { readerSettingsOf, CONTAINER_CATEGORIES, DEFAULT_CONTAINERS, PER_ROW_MAX, CARD_MODES } from '../model/partreader.js';
import { renderSvgString, uniqueSvgIds } from '../render/svg.js';
import { renderPageChrome } from '../render/pagechrome.js';
import { openNewPartDialog } from './new-part-dialog.js';
import { createChoiceMenu } from './choice-menu.js';
import { placeFloating, visibleArea } from './float-place.js';
import { createScrubPill } from './scrub-pill.js';
import { markShortLongPress, bindShortLong, markDrawerLevel, markCyclic } from './button-behavior.js';
import { applyIconName } from './icons.js';
import { glyphRowIcon } from './mark-icons.js';
import { createTabDrag } from './tab-drag.js';
import { openCanvasDialog } from './canvas-dialog.js';
import { pageSvg } from '../render/pagesvg.js';
import { showBusy, nextPaint } from './busy.js';
import { downloadBlob } from './file-io.js';
import { SHEET_QUERY } from './panel-mode.js';
import { textSections, partStyleOf } from './parts-text-dom.js';
import { createTextModal } from './parts-text-modal.js';
import { SWATCHES } from './swatches.js';
import { mountPartTracksPanel } from './part-tracks-dom.js';
import { extractsSection } from './part-extracts-dom.js';
import { openDiagramListSettings } from './diagram-list-settings.js';
import { lyricsPageSection } from './part-lyrics-dom.js';
import { createTabletPanel, rememberTabletScroll } from './tablet-panel.js';

const STYLE_ID = 'parts-screen-style';
const CSS = `
.ps-root { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); margin-top: 8px; }
.ps-tabs { display: flex; gap: 2px; flex-wrap: wrap; align-items: flex-end; flex: 1 1 auto; min-width: 0; }
.ps-tab { min-height: var(--ui-target, 44px); padding: 0 14px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; font: inherit; cursor: pointer; }
.ps-tab { position: relative; }
.ps-tab .ps-x { display: none; margin-left: 8px; width: 18px; height: 18px; line-height: 16px; text-align: center; border-radius: 50%; font-size: 14px; vertical-align: middle; }
@media (hover: hover) and (pointer: fine) { .ps-tab:hover .ps-x { display: inline-block; } .ps-tab .ps-x:hover { background: rgba(0,0,0,.14); } }
.ps-tab[data-drop="before"] { box-shadow: -4px 0 0 var(--sel-edge,#2878ff); }
.ps-tab[data-drop="after"] { box-shadow: 4px 0 0 var(--sel-edge,#2878ff); }
.ps-tab[data-dragging] { opacity: .5; }
.ps-tab[aria-selected="true"] { font-weight: var(--w-bold,700); border-bottom-color: var(--ink,#1c1b1a); }
.ps-body { display: flex; gap: 12px; align-items: flex-start; }
.ps-props { flex: 0 0 280px; max-width: 320px; background: var(--module, var(--module,#fcfbf8)); border: 1px solid var(--edge,#ccc); border-radius: 8px; padding: 8px 12px; font: 14px var(--ui-font,sans-serif); }
.ps-props h3 { margin: 10px 0 4px; font-size: 14px; }
.ps-props h3:first-child { margin-top: 0; }
.ps-props .ps-fold { margin: 6px 0; border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--module,#fcfbf8); } /* a title that folds and its controls: one box, like the sections of screen 3 */
.ps-props .ps-fold:first-child { margin-top: 0; }
.ps-props h3[data-collapsible] { display: flex; align-items: center; gap: 4px; margin: 0; padding: 2px 8px; min-height: var(--ui-target,30px); box-sizing: border-box; font-size: 13px; line-height: 1.2; background: var(--soft,#eef0f4); border: 0; border-radius: 7px; font-weight: var(--w-semi,600); cursor: pointer; user-select: none; -webkit-touch-callout: none; }
.ps-props .ps-fold[data-open] > h3[data-collapsible] { border-radius: 7px 7px 0 0; }
.ps-props h3[data-collapsible]:hover { background: var(--btn-on,#e2e0da); }
.ps-props h3[data-collapsible]::before { content: '▾'; flex: none; width: 1em; }
.ps-props h3[data-collapsible][aria-expanded="false"]::before { content: '▸'; }
.ps-foldbody { padding: 6px 8px 8px; border-top: 1px solid var(--line,#ddd); }
.ps-props [data-collapsed] { display: none; }
.ps-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); margin: 4px 0; }
.ps-row label { flex: 1 1 7em; }
/* the Lecteur settings: the containers as a grid (every button stretches over its column), then one card per setting: its name on the left, its menu on the right */
.ps-reader .ps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5em, 1fr)); gap: var(--btn-gap, 2px); margin: 4px 0; }
.ps-reader .ps-grid > button { width: 100%; min-width: 0; }
.ps-reader .ps-grid > .ps-wide, .ps-reader .ps-grid > button:last-child:nth-child(even) { grid-column: 1 / -1; } /* an odd one out takes the whole row */
.ps-reader .ps-setting { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; padding: 4px 4px 4px 10px; border: 1px solid var(--line,#ddd); border-radius: 8px; background: var(--soft,transparent); }
.ps-reader .ps-setting > span { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.ps-reader .ps-setting .cm-button { flex: 0 0 auto; max-width: 55%; }
.ps-props select[data-field="role"] { display: block; width: 100%; max-width: 100%; box-sizing: border-box; min-height: var(--ui-target, 30px); padding: 0 8px; border-radius: 8px; text-overflow: ellipsis; }
.ps-stepper { display: inline-flex; align-items: center; gap: var(--btn-gap, 2px); }
.ps-props .ps-stepper input[type="text"] { width: 4.5em; text-align: center; }
.ps-props .ps-stepper.ps-int input[type="text"] { width: 3.6em; }
.ps-props .ps-stepper.ps-int button { width: var(--ui-target, 30px); min-width: 0; padding: 0; }
.ps-props input[type="number"], .ps-props input[type="text"] { min-height: var(--ui-target, 44px); box-sizing: border-box; width: 6em; font: inherit; font-size: 16px; padding: 0 6px; }
.ps-props input[type="text"] { width: 100%; }
.ps-props button { min-height: var(--ui-target, 44px); min-width: var(--ui-target, 44px); padding: 0 10px; font: inherit; }
.ps-props button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.ps-margins { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5em, 1fr)); gap: 4px 8px; } /* a narrow panel puts right under left and bottom under top */
.ps-margins label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.ps-staves label { display: flex; align-items: center; gap: 8px; min-height: var(--ui-target, 44px); }
.ps-staves input { width: 20px; height: 20px; }
.ps-pages { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 18px; background: var(--desk,#8a8a8a); padding: 16px; border-radius: 8px; }
.ps-page { background: var(--score, var(--field,#fff)); box-shadow: 0 2px 10px rgba(0,0,0,.45); width: 100%; box-sizing: border-box; position: relative; }
.ps-page-no { color: var(--desk-ink,#eee); font: 12px var(--ui-font,sans-serif); margin-top: -10px; }
.ps-col { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); }
.ps-top { position: sticky; top: 0; z-index: 5; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); }
.ps-tabsbar { flex-wrap: wrap !important; overflow: visible !important; align-items: flex-end !important; padding-bottom: 0 !important; }
@media (pointer: fine) and (min-width: 901px) {
  .ps-root { margin-top: 0; gap: var(--btn-gap, 2px); }
  .ps-tabsbar { min-height: 0 !important; padding: 0 6px !important; border-top-width: 0; }
  .ps-tabsbar .ps-tab { min-height: calc(var(--ui-target, 44px) - 2px); }
}
.ps-props[data-docked] { flex: none; max-width: none; width: auto; border: 0; border-radius: 0; box-sizing: border-box; }
.ps-bar { display: flex; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; align-items: center; gap: var(--btn-gap, 2px); min-height: calc(var(--ui-target, 44px) + 12px); box-sizing: border-box; padding: 6px; background: var(--field,#fff); border: 1px solid var(--edge,#ccc); border-radius: 8px; font: 14px var(--ui-font,sans-serif); }
.ps-bar > * { flex: 0 0 auto; }
.ps-bar button { min-height: var(--ui-target, 44px); min-width: var(--ui-target, 44px); padding: 0 10px; font: inherit; }
.ps-bar button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.ps-bar .ps-hint { color: var(--ink-soft,#666); }
.ps-sheet { position: absolute; }
.ps-chrome { position: absolute; inset: 0; pointer-events: none; }
.ps-zone { position: absolute; padding: 0; margin: 0; border: 0; background: transparent; cursor: pointer; }
.ps-zone:hover { background: var(--sel-hover,rgba(40,120,255,.08)); }
.ps-zone[data-selected="true"] { background: transparent; } /* the band of the staff (.ps-staffsel) shows the choice */
.ps-zone[data-locked="true"]::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #6a4bd0; }
.ps-brk { position: absolute; transform: translate(-100%, -100%); font: 11px/14px var(--ui-font,sans-serif); color: #9a4a4a; background: rgba(255,255,255,.85); border: 1px solid #c9a0a0; border-radius: 3px; padding: 0 3px; cursor: pointer; white-space: nowrap; }
.ps-brk { touch-action: none; -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
.ps-hintmark { position: absolute; pointer-events: none; border-left: 2px dashed #d9822b; opacity: .85; }
.ps-hintmark::before { content: '⤓'; position: absolute; left: 2px; top: -1px; font: var(--w-semi,600) 11px var(--ui-font,sans-serif); color: #d9822b; }
.ps-gapmark { position: absolute; transform: translate(-2px, -100%); pointer-events: none; font: var(--w-semi,600) 10px var(--ui-font,sans-serif); color: #fff; background: #6a4bd0; border-radius: 8px; padding: 1px 5px; white-space: nowrap; z-index: 5; }
.ps-playcursor { position: absolute; width: 2px; margin-left: -1px; background: #e8590c; pointer-events: none; z-index: 6; }
.ps-staffsel { position: absolute; pointer-events: none; background: var(--sel-fill,rgba(40,120,255,.14)); outline: 2px solid var(--sel-edge,#2878ff); outline-offset: -2px; border-radius: 3px; }
.ps-cbar { width: max-content; position: fixed; z-index: 1500; display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; padding: 5px; max-width: min(96vw, 640px); background: var(--field,#fffefa); border: 1px solid var(--sel-edge,#2878ff); border-radius: 10px; box-shadow: 0 3px 12px rgba(0,0,0,.28); font: 14px var(--ui-font,sans-serif); }
.ps-cbar button { min-height: var(--ui-target, 44px); min-width: var(--ui-target, 44px); padding: 0 10px; font: inherit; cursor: pointer; border: 1px solid var(--edge,#bbb); border-radius: 8px; background: var(--field,#fff); }
.ps-cbar button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.ps-cbar .ps-sep { width: 1px; align-self: stretch; background: #d0ccc4; }
.ps-zone-handle { width: 56px; height: 26px; border-radius: 13px; margin: -13px 0 0 -28px; font-size: 16px; }
.ps-root, .ps-pages { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
.ps-root input, .ps-root textarea { -webkit-user-select: text; user-select: text; }
.ps-brk:active { background: #fdd; text-decoration: line-through; }
.ps-brk[data-break="page"] { color: #6a3a9a; border-color: #b9a0d0; }
.ps-hint { color: var(--ink-soft,#555); font-size: 12px; margin: 4px 0; }
.ps-areas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
.ps-areas input { width: 100% !important; box-sizing: border-box; }
.ps-tpl { margin: 4px 0; }
.ps-line input[type="text"] { flex: 1 1 8em; width: auto; }
.ps-modes { display: inline-flex; gap: 0; margin-right: 6px; }
.ps-modes button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
.ps-pages { touch-action: manipulation; }
.ps-pages[data-mode="elements"] .ps-sheet { cursor: crosshair; }
.ps-swatch { min-width: 32px !important; width: 32px; padding: 0 !important; border: 2px solid var(--edge,#999) !important; border-radius: 50%; }
.ps-handle { position: absolute; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; background: #6a4bd0; color: #fff; display: flex; align-items: center; justify-content: center; font: 20px var(--ui-font,sans-serif); cursor: grab; touch-action: none; z-index: 6; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
.ps-ghost { position: absolute; border: 1px dashed #6a4bd0; background: rgba(106,75,208,.12); pointer-events: none; z-index: 5; }
.ps-bar button:disabled { opacity: .4; }
.ps-copy { min-width: 28px; min-height: 28px; font-size: 15px; padding: 0 6px; margin-left: 4px; vertical-align: middle; }
.ps-info { color: var(--ink-soft,#555); font: 13px var(--ui-font,sans-serif); }
.ps-error { color: var(--danger-ink,#b00020); font: 13px var(--ui-font,sans-serif); min-height: 1.3em; }
/* the properties on a tablet / phone: see ui/tablet-panel.js; the page leaves room under it for the sheet */
@media (max-width: 900px) {
  .ps-root[data-sheet] .ps-col { padding-bottom: 56px; }
  .ps-root[data-sheet-open] .ps-col { padding-bottom: calc(42vh + 56px); }
}
@media (max-width: 900px) { .ps-body { flex-direction: column; align-items: stretch; } .ps-col { width: 100%; max-width: 100%; } .ps-props { flex: none; max-width: none; width: 100%; box-sizing: border-box; } .ps-tablet { width: auto; } .ps-pages { width: 100%; box-sizing: border-box; padding: 8px; } }
`;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
};

const MARGIN_SIDS = [['parts.marginLeft', SID.PAGE_MARGIN_LEFT], ['parts.marginRight', SID.PAGE_MARGIN_RIGHT], ['parts.marginTop', SID.PAGE_MARGIN_TOP], ['parts.marginBottom', SID.PAGE_MARGIN_BOTTOM]];

/**
 * @param host  element that receives the screen
 * @param o     { app, glyphs, label(key, params) → text }
 * @returns { refresh(), destroy() }
 */
const COLLAPSE_KEY = 'scorsaire.partsCollapsed';
function readCollapsed() { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); } }
function writeCollapsed(set) { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* storage unavailable: the state is only kept until the next redraw */ } }

/**
 * Makes every heading of the properties column fold the controls that follow it (up to the next heading or section).
 * The folded headings are remembered on the device (never in the Document).
 */
function collapsible(root) {
  const folded = readCollapsed();
  /** Each heading and the controls that follow it (up to the next heading or section) go into ONE bordered box, like the sections of screen 3: the title, then the controls under a thin line. */
  const wrap = (container) => {
    let body = null;
    for (const child of [...container.children]) {
      if (child.tagName === 'H3') {
        const h = child; // the handler keeps ITS heading
        const id = h.firstChild?.textContent?.trim() || '';
        h.setAttribute('data-collapsible', id);
        const isFolded = folded.has(id);
        h.setAttribute('aria-expanded', String(!isFolded));
        const fold = document.createElement('div'); fold.className = 'ps-fold'; if (!isFolded) fold.setAttribute('data-open', '');
        const mine = document.createElement('div'); mine.className = 'ps-foldbody'; if (isFolded) mine.setAttribute('data-collapsed', '');
        container.insertBefore(fold, h); fold.append(h, mine); body = mine;
        h.addEventListener('click', (e) => {
          if (e.target.closest('button, input, select')) return;
          const next = h.getAttribute('aria-expanded') !== 'true';
          h.setAttribute('aria-expanded', String(next));
          if (next) { mine.removeAttribute('data-collapsed'); fold.setAttribute('data-open', ''); } else { mine.setAttribute('data-collapsed', ''); fold.removeAttribute('data-open'); }
          const set = readCollapsed(); if (next) set.delete(id); else set.add(id); writeCollapsed(set);
          if (next) folded.delete(id); else folded.add(id); // the redraws that follow read this set too: the arrow and the controls stay in step
        });
        h.addEventListener('contextmenu', (e) => e.preventDefault());
        continue;
      }
      if (child.hasAttribute('data-section')) { body = null; wrap(child); continue; }
      if (body) body.append(child);
    }
    for (const empty of container.querySelectorAll(':scope > .ps-fold > .ps-foldbody:empty')) empty.remove(); // a title with nothing under it is only the title
  };
  wrap(root);
  return root;
}
const CSS_ESC = (v) => String(v).replace(/["\\]/g, '\\$&');

export function mountPartsScreen(host, { app, glyphs, label = (k) => k, openFragment = () => {}, openDiagram = () => {}, sidebar = null, onStatus = () => {}, onMeasurePick = () => {} }) {
  const openWorkChords = (opts) => openWorkChordsDialog({ app, label, onDone: () => draw(), ...opts }); // the layers of fingerings are edited in the "Chords of the piece" window
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let activeId = (app.parts().find((p) => !p.props[PID.PART_CANVAS]) ?? app.parts()[0])?.id ?? null;
  const tabletState = { tab: 'page', open: false, scroll: 0 }; // the tab of the properties on a tablet, whether the bottom sheet is open, where it was read: interface state
  let medium = 'paper'; // « Papier » (the layouts for the printer, as ever) or « Tablette » (the layouts of the canvases, the screens a musician reads on): interface state, never in the document
  let canvasId = null; // the canvas shown in the Tablette tab
  let message = '';
  let selected = null; // measure id chosen on a page (interface state, never in the document)
  let lastPicked = null; // the chosen measure the playback was last placed on
  let showHiddenOn = false; // hidden elements shown (grey) so that they can be picked and shown again
  const revealHidden = () => picked.size > 0 || showHiddenOn;
  let rangeTo = null; // other end of a range of measures (same movement): chosen by dragging over the measures, or "→" then a tap
  let dragSuppress = false; // the click that follows a drag over the measures must not change the choice
  let extending = false; // "→" pressed: the next tap on a measure is the end of the range
  /** The chosen range of measures { ids, from, to } (reading order), or null when only one measure is chosen. */
  const rangeOf = () => {
    if (!selected || !rangeTo || rangeTo === selected) return null;
    const a0 = app.doc.find(selected); const b0 = app.doc.find(rangeTo);
    if (!a0 || !b0) return null;
    const mv = app.doc.movementOf(a0);
    if (mv !== app.doc.movementOf(b0)) return null;
    const ids = mv.masterbars.map((b) => b.id);
    const a = ids.indexOf(selected); const b = ids.indexOf(rangeTo);
    if (a < 0 || b < 0) return null;
    const lo = Math.min(a, b); const hi = Math.max(a, b);
    return { ids: ids.slice(lo, hi + 1), from: ids[lo], to: ids[hi] };
  };
  const inSelection = (id) => { const r = rangeOf(); return r ? r.ids.includes(id) : id === selected; };
  let selectedStaff = null; // the staff touched with it (nearest one): where a new container hangs
  let staffLevel = false; // second tap on the chosen measure: the measure OF that staff (a container can hang on it), with its floating bar
  let containerWhere = 'above'; // where a new container goes: 'above' the measure, 'before' it or 'after' it (interface state)
  let mode = 'measures'; // what a tap on a page picks: 'measures' (breaks, fixed systems, numbers) or 'elements' (colour, position, visibility in THIS part)
  const picked = new Set(); // identifiers of the elements picked in 'elements' mode
  let musicUnlocked = false; // notes, chords, rests and staves move by hand only when this lock is open (long press on the lock button)
  let lockHint = false;
  let lastDragEnd = -1e9; // the click that follows a drag of the handle is not a tap
  let lastTap = { id: null, time: 0 }; // double tap on a text opens its editor
  let anchorId = null; // identifier of the text the editor is open on (to find it again after a redraw)
  const perSystemMemo = new Map(); // part id -> the last "measures per system" typed (the model only keeps the resulting breaks)
  let layoutMemo = null; // { key, result }: the last layout of the part and what it was computed for
  let lastResult = null; // the layout shown (page layouts and geometry), for the drag handle
  const layoutCache = createPartCache(app.doc); // what the layout of each part keeps between two drawings (layout/partlayout.js)
  let virtualOff = null; // removes the scroll listeners of the pages shown by the last drawing
  const esc = (id) => window.CSS.escape(id);
  const modal = createTextModal({
    app, label, getPart: () => activePart(), partStyle: partStyleOf,
    anchorOf: () => (anchorId ? host.querySelector(`[data-chrome="${esc(anchorId)}"], [data-sel="${esc(anchorId)}"], [data-role="staff-text"][data-ref="${esc(anchorId)}"]`) : null),
  });
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;

  const partName = (part, index) => part.props[PID.NAME] || (index === 0 ? label('parts.defaultName') : label('parts.partNumber', { n: index + 1 }));
  // on a computer the properties are tabs of the sidebar (the same column as screen 1); elsewhere one column of foldable sections beside the pages
  const GROUPS = ['page', 'texts', 'numbers', 'tracks']; // the layout controls are part of the 'page' tab (one foldable section each)
  const sideTabId = (g) => `p2-${g}`;
  const docked = () => !!sidebar?.isEnabledForParts?.();
  if (sidebar) for (const g of GROUPS) sidebar.addTab(sideTabId(g), label(`parts.tab.${g}`), { screen: 'two' });
  const partTracks = mountPartTracksPanel({ app, label, partName, sidebar, tabId: sideTabId('tracks') });
  const followTracks = () => { if (partTracks.isOpen()) partTracks.open(activeId); }; // the open panel follows the part shown
  // the parts the screen shows: those of the PAPER tab (no canvas), or those of the canvas on view in the TABLET tab
  const currentCanvas = () => { const list = app.canvases(); const c = list.find((x) => x.id === canvasId) ?? list[0] ?? null; canvasId = c?.id ?? null; return c; };
  const shownParts = () => {
    const all = app.parts();
    if (medium !== 'tablet') return all.filter((p) => !p.props[PID.PART_CANVAS]);
    const c = currentCanvas();
    return c ? all.filter((p) => p.props[PID.PART_CANVAS] === c.id) : [];
  };
  const activePart = () => { const list = shownParts(); return list.find((p) => p.id === activeId) ?? list[0] ?? app.parts()[0]; };
  const style = (part, sid) => resolveStyle(sid, [part.style, PRINT_DEFAULTS]);
  const run = (fn) => { try { message = ''; fn(); } catch (e) { message = label('parts.error', { message: String(e?.message ?? e) }); } draw(); };
  const number = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '');

  const numberField = (labelText, value, onCommit, { min = 0, max = 1000, step = 1 } = {}) => {
    // − [value] + : each press shows the new value at once, the change is written (and the pages laid out again) once the presses stop for 330 ms;
    // Enter or leaving the field writes it immediately
    const decimals = (String(step).split('.')[1] ?? '').length;
    const input = el('input', { type: 'text', class: 'stepper-field', value: number(value), inputmode: 'decimal', 'aria-label': labelText, 'data-stepper-input': '' });
    let timer = null; let pending = null;
    const flush = () => { clearTimeout(timer); timer = null; if (pending === null) return; const n = pending; pending = null; run(() => onCommit(n)); };
    const stage = (raw) => {
      const n = Math.min(max, Math.max(min, Number(String(raw).replace(',', '.'))));
      if (!Number.isFinite(n)) return false;
      pending = Number(n.toFixed(decimals)); input.value = number(pending);
      clearTimeout(timer); timer = setTimeout(flush, 330);
      return true;
    };
    const bump = (dir) => stage((Number(String(input.value).replace(',', '.')) || 0) + dir * step);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (stage(input.value)) flush(); } else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); } else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); } });
    input.addEventListener('change', () => { if (!stage(input.value)) draw(); else flush(); });
    const stepBtn = (dir, text) => { const b = el('button', { type: 'button', 'aria-label': `${labelText} ${text}`, 'data-stepper': dir > 0 ? 'up' : 'down' }, text); b.addEventListener('click', () => bump(dir)); return b; };
    return el('span', { class: step >= 1 && Number.isInteger(step) ? 'ps-stepper ps-int stp' : 'ps-stepper stp' }, stepBtn(-1, '−'), input, stepBtn(1, '+'));
  };

  /** Removes a part after a confirmation; the tab shown falls back to the first remaining part when it was the removed one. */
  async function removeAsk(part, index) {
    if (!(await confirmDialog({ message: label('parts.removeConfirm', { name: partName(part, index) }), label }))) return;
    run(() => { const wasActive = activePart().id === part.id; app.removePart(part.id); if (wasActive || !shownParts().some((q) => q.id === activeId)) activeId = shownParts()[0].id; });
  }
  // ---- « Papier » / « Tablette »: above the properties (the sidebar on a computer, the parts bar elsewhere); in « Tablette », one sub-tab per CANVAS (a destination: a tablet shape)
  const afterSwitch = () => { const l = shownParts(); if (l.length) activeId = l[0].id; followTracks(); draw(); };
  const setMedium = (m) => { if (m === medium) return; if (m !== 'tablet') preview.close(); medium = m; picked.clear(); selected = null; rangeTo = null; extending = false; staffLevel = false; selectedStaff = null; afterSwitch(); };
  function mediumRow() {
    // two tabs sharing the whole width (a fixed-height strip: it sits above the tabs of the sidebar, a column that must not stretch it)
    const row = el('div', { role: 'tablist', 'data-medium-tabs': '', style: 'display:flex;flex:none;align-items:stretch;gap:2px;width:100%;box-sizing:border-box;padding:4px 6px 0' });
    for (const [m, key] of [['paper', 'parts.medium.paper'], ['tablet', 'parts.medium.tablet']]) row.append(el('button', { type: 'button', class: 'ps-tab', role: 'tab', 'aria-selected': String(medium === m), 'data-medium': m, style: 'flex:1 1 0;min-width:0;text-align:center;justify-content:center', onclick: () => setMedium(m) }, label(key)));
    return row;
  }
  const preview = createReaderPreview({ app, label, glyphs, getPart: () => activePart(), isVisible: () => host.isConnected && host.style.display !== 'none', cache: layoutCache, revision: () => `${userStyleEpoch()}|${layoutCache.revision()}` }); // beside the pages: what the Lecteur will show
  const newCanvas = () => openCanvasDialog({ label, onSubmit: (spec) => run(() => { const c = app.addCanvas(spec); canvasId = c.id; const l = shownParts(); if (l.length) activeId = l[0].id; }) });
  const editCanvas = (c) => openCanvasDialog({ label, canvas: c, onSubmit: (spec) => run(() => app.setCanvas(c.id, spec)) });
  async function removeCanvasAsk(c) {
    if (!(await confirmDialog({ message: label('canvas.removeConfirm', { name: c.name || label('canvas.unnamed') }), label }))) return;
    run(() => { app.removeCanvas(c.id); canvasId = null; const l = shownParts(); if (l.length) activeId = l[0].id; });
  }
  function canvasRow() {
    const list = app.canvases(); const cur = currentCanvas();
    const row = el('div', { class: 'ps-tabs ps-canvases', role: 'tablist', 'data-canvas-tabs': '' });
    for (const c of list) row.append(el('button', { type: 'button', class: 'ps-tab', role: 'tab', 'aria-selected': String(c.id === cur?.id), 'data-canvas': c.id, onclick: () => { canvasId = c.id; afterSwitch(); } }, c.name || label('canvas.unnamed')));
    row.append(el('button', { type: 'button', class: 'ps-tab', 'data-act': 'reader-preview', 'aria-pressed': String(preview.isOpen()), title: label('preview.title'), onclick: () => { preview.toggle(); draw(); } }, label('preview.button')));
    row.append(el('button', { type: 'button', class: 'ps-tab', 'data-act': 'canvas-new', 'aria-label': label('canvas.new'), title: label('canvas.new'), onclick: newCanvas }, '+'));
    if (cur) row.append(
      el('button', { type: 'button', class: 'ps-tab', 'data-act': 'canvas-edit', title: label('canvas.edit'), onclick: () => editCanvas(cur) }, label('canvas.editShort')),
      el('button', { type: 'button', class: 'ps-tab', 'data-act': 'canvas-remove', title: label('canvas.remove'), 'aria-label': label('canvas.remove'), onclick: () => removeCanvasAsk(cur) }, '×'));
    return row;
  }
  /** The « Tablette » tab before any canvas exists. */
  function emptyTablet() {
    return el('div', { class: 'ps-empty', 'data-tablet-empty': '', style: 'padding:30px 20px;max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px;align-items:flex-start' },
      el('div', { style: 'font-weight:var(--w-semi,600);font-size:16px' }, label('canvas.emptyTitle')),
      el('div', { style: 'color:var(--ink-soft,#555)' }, label('canvas.emptyText')),
      el('button', { type: 'button', 'data-act': 'canvas-new', onclick: newCanvas }, label('canvas.new')));
  }

  function tabs(parts) {
    const compact = media ? media.matches : false;
    // the dialog chooses the staves (and the name); "Each" makes one part per track
    const newPart = () => openNewPartDialog({ outline: app.tracksOutline(), label, onCreate: (list) => run(() => { const made = app.addParts(list.map((o) => ({ ...o, copyFrom: activePart().id, ...(medium === 'tablet' ? { canvasId } : {}) }))); if (made[0]) activeId = made[0].id; }) });
    // duplicates the active part (every setting) right after it, named "<name> (copy)"; the copy becomes the active one
    const duplicate = () => run(() => { const at = Math.max(0, parts.findIndex((p) => p.id === activePart().id)); const made = app.duplicatePart(activePart().id, { name: label('parts.copyName', { name: partName(activePart(), at) }) }); if (made) { activeId = made.id; followTracks(); } });
    if (compact) {
      const options = [...parts.map((p, i) => [p.id, partName(p, i)]), ['__new', `+ ${label('parts.new')}`], ['__dup', `⧉ ${label('parts.duplicate')}`]];
      return el('div', { class: 'ps-tabs' }, createChoiceMenu({ options, value: activePart().id, label: label('parts.page'), act: 'part-menu', onPick: (v) => { if (v === '__new') newPart(); else if (v === '__dup') duplicate(); else { activeId = v; followTracks(); draw(); } } }));
    }
    const row = el('div', { class: 'ps-tabs', role: 'tablist' });
    const drag = createTabDrag({ row, tabs: () => [...row.querySelectorAll('.ps-tab[data-part]')], idOf: (t) => t.dataset.part, onMove: (id, index) => run(() => { const target = parts[index]; app.movePart(id, target ? app.parts().indexOf(target) : index); }) }); // the index is among the tabs shown
    row.append(
      ...parts.map((p, i) => {
        const b = el('button', { type: 'button', class: 'ps-tab', role: 'tab', 'aria-selected': String(p.id === activePart().id), 'data-part': p.id, onclick: () => { if (drag.consumeClick()) return; activeId = p.id; followTracks(); draw(); } }, partName(p, i));
        if (parts.length > 1) {
          b.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.ps-x')) return; drag.start(e, b, p.id); });
          // mouse only (hover): a small cross at the right of the tab removes the part, after a confirmation
          const x = el('span', { class: 'ps-x', 'data-act': 'part-tab-remove', role: 'button', 'aria-label': label('parts.remove'), title: label('parts.remove'),
            onclick: (e) => { e.stopPropagation(); e.preventDefault(); removeAsk(p, i); } }, '×');
          b.append(x);
        }
        return b;
      }),
      el('button', { type: 'button', class: 'ps-tab', 'data-act': 'part-new', 'aria-label': label('parts.new'), title: label('parts.new'), onclick: newPart }, '+'),
      el('button', { type: 'button', class: 'ps-tab', 'data-act': 'part-duplicate', 'aria-label': label('parts.duplicate'), title: label('parts.duplicate'), onclick: duplicate }, '⧉'));
    return row;
  }

  /** The @font-face rule of the chord font (embedded in the page), to embed it in a saved SVG. */
  const chordFontCss = () => { const out = []; for (const st of document.querySelectorAll('style')) for (const m of st.textContent.matchAll(/@font-face\s*\{[^}]*(?:Barlow Condensed|JetBrains Mono)[^}]*\}/g)) out.push(m[0]); return out.join('\n'); };

  // « print as if everything were black » (a device choice, never in the document): the colours are for the screen, the printer often wants plain black
  const printMono = () => { try { return localStorage.getItem('scorsaire.printMono') !== '0'; } catch { return true; } }; // on by default
  const setPrintMono = (on) => { try { localStorage.setItem('scorsaire.printMono', on ? '1' : '0'); } catch { /* the choice is only a convenience */ } };

  /** Prints the pages of the part: a hidden copy of every page (music + title, header, footer) in millimetres, shown only for the printer, one per sheet. */
  function printPart() {
    if (!lastResult) return;
    const part = activePart();
    printResults([lastResult], jobTitleFor(part ? [part] : []));
  }

  /**
   * The name a printer or « Save as PDF » proposes is the title of the page: for the time of the print it is « Title of the piece — Name of the part » (several parts: the names one after the other).
   * The page gets its own title back afterwards.
   */
  function jobTitleFor(list) {
    const all = app.parts();
    const piece = String(app.doc.work.props?.[PID.TITLE] ?? '').trim();
    const names = list.map((p) => partName(p, all.indexOf(p))).filter(Boolean).join(', ');
    return [piece, names].filter(Boolean).join(' — ').slice(0, 120) || document.title;
  }

  /** Prints the layouts `results` one after the other (one sheet per page). Parts of different formats get their own named @page so every sheet has its size. */
  function printResults(results, jobTitle = null) {
    document.getElementById('print-root')?.remove(); document.getElementById('print-style')?.remove(); // never two copies
    const root = el('div', { id: 'print-root', 'aria-hidden': 'true' });
    const sizes = new Map(); // "WxH" -> named page
    for (const res of results) {
      const g = res.geometry; const key = `${g.widthMm}x${g.heightMm}`;
      if (!sizes.has(key)) sizes.set(key, { name: `pg${sizes.size}`, g });
      const { name } = sizes.get(key);
      res.pages.forEach((p) => { const d = el('div', { class: 'print-page', style: `page:${name};width:${g.widthMm}mm;height:${g.heightMm}mm` }); d.innerHTML = pageSvg(p, g, glyphs, { mono: printMono() }); root.append(d); });
    }
    if (!root.childElementCount) return;
    const pageRules = [...sizes.values()].map(({ name, g }) => `@page ${name} { size: ${g.widthMm}mm ${g.heightMm}mm; margin: 0; }`).join('\n');
    const st = el('style', { id: 'print-style' }, `${pageRules} #print-root { display: none; }
@media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } body > *:not(#print-root):not(#print-style) { display: none !important; }
  #print-root { display: block !important; } .print-page { overflow: hidden; break-after: page; page-break-after: always; }
  .print-page:last-child { break-after: auto; page-break-after: auto; } .print-page svg { display: block; } }`);
    document.body.append(st, root);
    const pageTitle = document.title;
    if (jobTitle) document.title = jobTitle; // (the printer dialog and « Save as PDF » propose it as the file name)
    const done = () => { st.remove(); root.remove(); document.title = pageTitle; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  /** Prints the given parts (layout of each one, the cache of the screen is shared). */
  async function printParts(list) {
    if (!list.length) return;
    const all = app.parts(); const today = new Date().toISOString().slice(0, 10);
    // the layout of several parts can take a while: a small indicator says which part is being prepared (it hardly shows when it is quick)
    const busy = showBusy(label('parts.printPreparing', { n: 1, total: list.length }));
    const results = [];
    try {
      await nextPaint();
      for (const [i, part] of list.entries()) {
        busy.update(label('parts.printPreparing', { n: i + 1, total: list.length }));
        if (i > 0) await nextPaint();
        results.push(layoutPart(app.doc.work, part, glyphs, { partName: partName(part, all.indexOf(part)), today, cache: layoutCache, keepHiddenContainers: false, lang: app.lang }));
      }
    } finally { busy.close(); }
    printResults(results, jobTitleFor(list));
  }

  /** « List »: a window with every part, the user ticks the ones to print. */
  function openPrintList() {
    const all = app.parts().filter((q) => !q.props[PID.PART_CANVAS]); // a layout for a tablet is never printed
    const veil = el('div', { 'data-print-list': '', 'data-zoom-lock': '', style: 'position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:center' });
    const box = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label('parts.printList.title'), style: 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:14px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);border-radius:8px;min-width:260px;max-width:min(440px,94vw);max-height:84vh;overflow:auto;display:flex;flex-direction:column;gap:var(--btn-gap,2px)' });
    const checks = all.map((part, i) => { const sw = createSwitch({ checked: true, text: partName(part, i), attrs: { 'data-print-part': part.id } }); return { part, sw }; });
    const close = () => { window.removeEventListener('keydown', onKey, true); veil.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const mkBtn = (text, act, fn) => { const b = el('button', { type: 'button', 'data-act': act }, text); b.addEventListener('click', fn); return b; };
    box.append(el('div', { style: 'font-weight:var(--w-semi,600);font-size:16px' }, label('parts.printList.title')),
      ...checks.map((c) => c.sw),
      el('div', { style: 'display:flex;gap:var(--btn-gap,2px);justify-content:flex-end;margin-top:8px;flex-wrap:wrap' },
        mkBtn(label('parts.printList.cancel'), 'print-list-cancel', close),
        mkBtn(label('parts.printList.print'), 'print-list-go', () => { const chosen = checks.filter((c) => c.sw.checked).map((c) => c.part); close(); printParts(chosen); })));
    veil.append(box);
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(veil);
  }

  /** Saves every page of the part as an SVG file in millimetres (the chord font is embedded). */
  function exportPages(part, parts) {
    if (!lastResult) return;
    const name = (partName(part, parts.indexOf(part)) || 'part').replace(/[^\p{L}\p{N}_-]+/gu, '_');
    const css = chordFontCss();
    lastResult.pages.forEach((p, i) => downloadBlob(`${name}-${String(i + 1).padStart(2, '0')}.svg`, new Blob([pageSvg(p, lastResult.geometry, glyphs, { fontCss: css, mono: printMono() })], { type: 'image/svg+xml' })));
  }

  function properties(part, parts) {
    // small button after a heading: copies THAT group of settings to every other part
    const copyBtn = (group) => (parts.length > 1 ? el('button', { type: 'button', class: 'ps-copy', 'data-copy': group, title: label('parts.copyToAll'), 'aria-label': label('parts.copyToAll'), onclick: () => run(() => app.copyPartSettings(part.id, group)) }, '⇉') : null);
    const geometry = pageGeometry((sid) => style(part, sid));
    const format = style(part, SID.PAGE_FORMAT);
    const name = el('input', { type: 'text', value: part.props[PID.NAME] ?? '', placeholder: partName(part, parts.indexOf(part)), 'aria-label': label('parts.name'), maxlength: '60', 'data-field': 'name' });
    name.addEventListener('change', () => run(() => app.renamePart(part.id, name.value)));
    // a layout for a tablet says what it is FOR (model/partroles.js): the Lecteur finds it by that code, whatever the name
    const role = part.props[PID.PART_CANVAS] ? createRoleSelect({ label, value: part.props[PID.PART_ROLE] ?? '', onChange: (v) => run(() => app.setPartRole(part.id, v)) }) : null;
    // what the author prepares for the Lecteur when it paginates by itself (model/partreader.js): under the choices the musician makes on the device
    const readerBox = part.props[PID.PART_CANVAS] ? (() => {
      const own = readerSettingsOf(part);
      const write = (patch) => run(() => app.setPartReader(part.id, patch));
      const select = (field, options, value, onPick) => createChoiceMenu({ options: options.map(([v, text]) => [String(v), text]), value: String(value), label: label(`parts.reader.${field}`), act: `reader-${field}`, follow: true, onPick });
      const setting = (key, menu) => el('div', { class: 'ps-setting', 'data-field': key }, el('span', {}, label(`parts.reader.${key}`)), menu);
      const deviceLabel = label('parts.reader.device');
      const setContainers = own.containers !== undefined;
      return el('div', { class: 'ps-reader', 'data-reader-settings': '' },
        el('p', { class: 'ps-hint' }, label('parts.reader.hint')),
        el('div', { class: 'ps-grid' },
          (() => { const b = el('button', { type: 'button', class: 'ps-wide', 'data-field': 'reader-containers', 'aria-pressed': String(setContainers), onclick: () => write({ containers: setContainers ? null : [...DEFAULT_CONTAINERS] }) }, label('parts.reader.containers')); if (setContainers) b.style.cssText = 'font-weight:600;outline:2px solid var(--ink,#111)'; return b; })(),
          ...(setContainers ? CONTAINER_CATEGORIES.map((c) => { const on = own.containers.includes(c); const b = el('button', { type: 'button', 'data-field': `reader-container-${c}`, 'aria-pressed': String(on), onclick: () => write({ containers: on ? own.containers.filter((x) => x !== c) : [...own.containers, c] }) }, label(`lecteur.container.${c}`)); if (on) b.style.cssText = 'font-weight:600;outline:2px solid var(--ink,#111)'; return b; }) : [])),
        setting('regular', select('regular', [['', deviceLabel], ['yes', label('parts.reader.yes')], ['no', label('parts.reader.no')]], own.regular === undefined ? '' : own.regular ? 'yes' : 'no', (v) => write({ regular: v === '' ? null : v === 'yes' }))),
        setting('tempo', select('tempo', [['', deviceLabel], ['yes', label('parts.reader.yes')], ['no', label('parts.reader.no')]], own.tempo === undefined ? '' : own.tempo ? 'yes' : 'no', (v) => write({ tempo: v === '' ? null : v === 'yes' }))),
        setting('cards', select('cards', [['', deviceLabel], ...CARD_MODES.map((m) => [m, label(`lecteur.cards.${m}`)])], own.cards ?? '', (v) => write({ cards: v === '' ? null : v }))),
        setting('cardScale', select('cardScale', [['', deviceLabel], ...Array.from({ length: 11 }, (_, i) => [(i + 5) / 10, `${(i + 5) * 10} %`])], own.cardScale ?? '', (v) => write({ cardScale: v === '' ? null : Number(v) }))),
        setting('cardGap', select('cardGap', [['', deviceLabel], ...Array.from({ length: 21 }, (_, i) => [(i + 0) / 10, `${(i + 0) * 10} %`])], own.cardGap ?? '', (v) => write({ cardGap: v === '' ? null : Number(v) }))),
        setting('spacing', select('spacing', [['', deviceLabel], ...Array.from({ length: 19 }, (_, i) => [(i + 2) / 10, `${(i + 2) * 10} %`])], own.spacing ?? '', (v) => write({ spacing: v === '' ? null : Number(v) }))),
        setting('perRow', select('perRow', [['', deviceLabel], ...Array.from({ length: PER_ROW_MAX }, (_, i) => [i + 1, String(i + 1)])], own.perRow ?? '', (v) => write({ perRow: v === '' ? null : Number(v) }))));
    })() : null;
    // a tablet is read at a glance: the names of the tracks stay out of the way unless asked (the foot of the page says what is shown)
    // names of the tracks: each setting is the part's own (a part is read on its own) or, when empty, the Movement's
    const ownStyle = (sid) => part.style?.[sid];
    const nameChoices = (sid, options) => { const own = ownStyle(sid); return createChoiceMenu({ options: [['', label('parts.names.fromMovement')], ...options.map(([v, t]) => [String(v), t])], value: own === undefined ? '' : String(own), label: label(`parts.names.${sid === SID.SHOW_INSTRUMENT_NAMES ? 'show' : sid === SID.INSTRUMENT_NAME_FIRST ? 'first' : sid === SID.INSTRUMENT_NAME_NEXT ? 'next' : 'hideIfOne'}`), act: `names-${sid}`, follow: true,
      onPick: (v) => run(() => app.setPartPage(part.id, { [sid]: v === '' ? null : v === 'true' ? true : v === 'false' ? false : v })) }); };
    const yesNo = [[true, label('parts.reader.yes')], [false, label('parts.reader.no')]];
    const nameModes = ['long', 'short', 'icon', 'none'].map((m) => [m, label(`tracks.names.${m}`)]);
    const namesRow = (text, menu) => el('div', { class: 'ps-row', style: 'flex-wrap:nowrap;justify-content:space-between' }, el('span', { style: 'flex:1 1 auto;min-width:0' }, text), menu);
    const names = el('div', { class: 'ps-col', 'data-field': 'track-names' },
      namesRow(label('parts.names.show'), nameChoices(SID.SHOW_INSTRUMENT_NAMES, yesNo)),
      ...(ownStyle(SID.SHOW_INSTRUMENT_NAMES) === false ? [] : [
        namesRow(label('tracks.names.first'), nameChoices(SID.INSTRUMENT_NAME_FIRST, nameModes)),
        namesRow(label('tracks.names.next'), nameChoices(SID.INSTRUMENT_NAME_NEXT, nameModes)),
        namesRow(label('tracks.names.hideIfOne'), nameChoices(SID.HIDE_INSTRUMENT_NAME_IF_ONE, yesNo))]));
    const allMargins = numberField(label('parts.marginsAll'), geometry.margins.left === geometry.margins.right && geometry.margins.left === geometry.margins.top && geometry.margins.left === geometry.margins.bottom ? geometry.margins.left : NaN,
      (n) => app.setPartPage(part.id, Object.fromEntries(MARGIN_SIDS.map(([, sid]) => [sid, n]))), { max: 100 });
    allMargins.setAttribute('data-field', 'margin-all');
    const formatMenu = createChoiceMenu({
      // the shapes of tablets belong to the canvases (the paper menu keeps one only when a part already has it)
      options: pageFormatIds().filter((id) => !id.startsWith('tablet-') || id === format).map((id) => [id, label(`parts.format.${id}`)]), value: format, label: label('parts.format'), act: 'part-format',
      onPick: (v) => run(() => app.setPartPage(part.id, { [SID.PAGE_FORMAT]: v })),
    });
    const landscape = style(part, SID.PAGE_LANDSCAPE);
    const sheetIcon = (isLandscape) => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
      const r = document.createElementNS(ns, 'rect');
      const [w, h] = isLandscape ? [16, 11] : [11, 16];
      r.setAttribute('x', String(12 - w / 2)); r.setAttribute('y', String(12 - h / 2)); r.setAttribute('width', String(w)); r.setAttribute('height', String(h)); r.setAttribute('rx', '1.5');
      r.setAttribute('fill', 'none'); r.setAttribute('stroke', 'currentColor'); r.setAttribute('stroke-width', '1.5');
      svg.appendChild(r); return svg;
    };
    const orient = (isLandscape) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(landscape === isLandscape), 'data-act': isLandscape ? 'landscape' : 'portrait', title: label(isLandscape ? 'parts.landscape' : 'parts.portrait'), 'aria-label': label(isLandscape ? 'parts.landscape' : 'parts.portrait'), onclick: () => run(() => app.setPartPage(part.id, { [SID.PAGE_LANDSCAPE]: isLandscape })) });
      b.style.cssText = 'width:var(--ui-target,30px);min-width:0;padding:0;display:inline-flex;align-items:center;justify-content:center';
      b.appendChild(sheetIcon(isLandscape)); return b;
    };
    const staffSize = numberField(label('parts.staffSize'), style(part, SID.PAGE_STAFF_SPACE_MM), (n) => app.setPartPage(part.id, { [SID.PAGE_STAFF_SPACE_MM]: n }), { min: 0.8, max: 5, step: 0.05 });
    staffSize.setAttribute('data-field', 'staff-size');
    const perSystem = numberField(label('parts.perSystem'), perSystemMemo.get(part.id) ?? 0, (n) => { perSystemMemo.set(part.id, n); app.setBreaksEvery(part.id, n); }, { min: 0, max: 99, step: 1 });
    perSystem.setAttribute('data-field', 'per-system');

    // the controls, in groups: tabs of the sidebar on a computer, one column of foldable sections elsewhere
    // the number of columns the measure grid would choose for this part (the line cut by the usual width of a measure): written as « Measures per line » when the grid is switched on
    const gridColumns = () => {
      try {
        const res = layoutPart(app.doc.work, part, glyphs, { partName: '', today: '', keepHiddenContainers: false, tweak: (sid, value) => (sid === SID.MEASURE_GRID ? 'columns' : sid === SID.MEASURES_PER_SYSTEM ? 0 : value) });
        for (const pg of res.pages ?? []) for (const sys of pg.layout.systems) if (sys.gridColumns) return sys.gridColumns;
      } catch { /* no layout: the grid chooses by itself (0) */ }
      return null;
    };
    // the free texts of this part (text + optional line above / below a staff, drawn in this part only): the list, with a button to edit each and one to add
    const partTextsList = (p) => {
      const list = app.partStaffTexts(p.id);
      const rows = list.map((t) => el('div', { class: 'ps-row', 'data-part-text': t.id },
        el('button', { type: 'button', 'data-act': 'part-text-edit', title: label('partText.edit'), onclick: () => openPartStaffTextDialog({ app, label, partId: p.id, entry: t, onDone: () => draw() }) }, t.text),
        el('span', { class: 'ps-hint' }, `${t.staffName} · ${label('partText.measureN', { n: t.measure })}${t.line ? ` · ${t.toEnd ? label('partText.lineToEnd') : label('partText.lineMeasures', { n: t.lineSpan })}` : ''}`)));
      return el('div', { 'data-section': 'part-texts' }, el('h3', {}, label('partText.section')),
        ...(rows.length ? rows : [el('div', { class: 'ps-hint' }, label('partText.none'))]),
        el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'part-text-add', title: label('partText.hint'), onclick: () => openPartStaffTextDialog({ app, label, partId: p.id, onDone: () => draw() }) }, `+ ${label('partText.add')}`)));
    };
    const text = textSections({ app, part, label, run, copy: copyBtn, style: partStyleOf(part), stepper: numberField, gridColumns });
    const groups = {
      page: [
      el('h3', {}, label('parts.name')), name, ...(role ? [el('h3', {}, label('parts.role')), role] : []), ...(names ? [names] : []), ...(readerBox ? [el('h3', {}, label('parts.reader')), readerBox] : []),
      el('h3', {}, label('parts.page'), ' ', copyBtn('format')),
      el('div', { class: 'ps-row' }, formatMenu, orient(false), orient(true)),
      format === 'custom' ? el('div', { class: 'ps-row' },
        el('label', {}, label('parts.width'), numberField(label('parts.width'), style(part, SID.PAGE_WIDTH_MM), (n) => app.setPartPage(part.id, { [SID.PAGE_WIDTH_MM]: n }), { min: 30, max: 1000 })),
        el('label', {}, label('parts.height'), numberField(label('parts.height'), style(part, SID.PAGE_HEIGHT_MM), (n) => app.setPartPage(part.id, { [SID.PAGE_HEIGHT_MM]: n }), { min: 30, max: 1000 }))) : null,
      el('h3', {}, label('parts.margins'), ' ', copyBtn('margins')),
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.marginsAll')), allMargins),
      el('div', { class: 'ps-margins' }, MARGIN_SIDS.map(([key, sid]) => el('label', {}, label(key), (() => {
        const f = numberField(label(key), style(part, sid), (n) => app.setPartPage(part.id, { [sid]: n }), { max: 100 });
        f.setAttribute('data-field', sid);
        return f;
      })()))),
      parts.length > 1 ? el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'margins-all-parts', onclick: () => run(() => app.applyPageToAllParts(part.id)) }, label('parts.applyAll'))) : null,
      el('h3', {}, label('parts.staffSize'), ' ', copyBtn('staffSize')), el('div', { class: 'ps-row' }, staffSize),
      parts.length > 1 ? el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'part-remove', onclick: () => removeAsk(part, parts.indexOf(part)) }, label('parts.remove'))) : null,
      ...(part.props[PID.PART_CANVAS] ? [] : extractsSection({ app, label, part, run, numberField, getWarnings: () => (lastResult?.extract ? lastResult.warnings ?? [] : []) })),
      ...(part.props[PID.PART_CANVAS] ? [] : lyricsPageSection({ app, label, part, run, numberField })),
      el('h3', {}, label('parts.output')),
      el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'print', title: label('parts.printHint'), onclick: printPart }, label('parts.print')),
        // a small square switch « N&B » next to Print: print and export as if everything were black (on by default)
        (() => {
          const b = el('button', { type: 'button', 'data-act': 'print-mono', 'data-no-icon': '', 'aria-pressed': String(printMono()), title: label('parts.printMonoHint'), 'aria-label': label('parts.printMono') }, label('parts.printMonoShort'));
          b.style.cssText = 'width:var(--ui-target,30px);height:var(--ui-target,30px);min-width:var(--ui-target,30px);padding:0;font:var(--w-bold,700) 11px var(--ui-font,sans-serif);line-height:1';
          b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); setPrintMono(on); });
          return b;
        })(),
        el('button', { type: 'button', 'data-act': 'print-all', title: label('parts.printAllHint'), onclick: () => printParts(app.parts().filter((q) => !q.props[PID.PART_CANVAS])) }, label('parts.printAll')),
        el('button', { type: 'button', 'data-act': 'print-list', title: label('parts.printListHint'), onclick: openPrintList }, label('parts.printListShort')), el('button', { type: 'button', 'data-act': 'export-svg', onclick: () => exportPages(part, parts) }, label('parts.exportSvg'))),
      el('div', { class: 'ps-hint', 'data-print-hint': '' }, label('parts.printHint')),
      ],
      layout: [
      el('h3', {}, label('parts.layout'), ' ', copyBtn('layout')),
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.perSystem')), perSystem),
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.staffGap')), numberField(label('parts.staffGap'), part.props[PID.PART_STAFF_GAP] ?? 0, (n) => app.setPartStaffGap(part.id, n), { min: -10, max: 40, step: 0.5 })),
      // the room between two systems = the room under the last staff of one + the room above the first staff of the next (kept in the same proportion)
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.systemGap')), (() => {
        const total = style(part, SID.SYSTEM_TOP_MARGIN) + style(part, SID.SYSTEM_BOTTOM_MARGIN);
        const f = numberField(label('parts.systemGap'), Math.round(total * 10) / 10, (n) => { const top = Math.round(n * (5 / 11) * 10) / 10; return app.setPartPage(part.id, { [SID.SYSTEM_TOP_MARGIN]: top, [SID.SYSTEM_BOTTOM_MARGIN]: Math.round((n - top) * 10) / 10, [SID.SYSTEM_EDGE_DISTANCE]: Math.round(style(part, SID.MIN_VERTICAL_DISTANCE) * (n / 11) * 100) / 100 }); }, { min: 1, max: 60, step: 0.5 });
        f.setAttribute('data-field', 'system-gap'); return f;
      })()),
      el('div', { class: 'ps-row' }, createSwitch({ checked: style(part, SID.PAGE_VERTICAL_SPREAD), text: label('parts.spread'), attrs: { 'data-field': 'spread' }, onchange: (e) => run(() => app.setPartPage(part.id, { [SID.PAGE_VERTICAL_SPREAD]: e.target.checked })) })),
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.upperBorder')), numberField(label('parts.upperBorder'), style(part, SID.PAGE_UPPER_BORDER), (n) => app.setPartPage(part.id, { [SID.PAGE_UPPER_BORDER]: n }), { max: 30, step: 0.5 })),
      el('div', { class: 'ps-row' }, el('label', {}, label('parts.lowerBorder')), numberField(label('parts.lowerBorder'), style(part, SID.PAGE_LOWER_BORDER), (n) => app.setPartPage(part.id, { [SID.PAGE_LOWER_BORDER]: n }), { max: 30, step: 0.5 })),
      el('div', { class: 'ps-row' }, createSwitch({ checked: style(part, SID.LAST_SYSTEM_JUSTIFY), text: label('parts.lastJustify'), attrs: { 'data-field': 'last-justify' }, onchange: (e) => run(() => app.setPartPage(part.id, { [SID.LAST_SYSTEM_JUSTIFY]: e.target.checked })) })),
      style(part, SID.LAST_SYSTEM_JUSTIFY) ? el('div', { class: 'ps-row' }, el('label', {}, label('parts.lastFill')),
        (() => { const f = numberField(label('parts.lastFill'), Math.round(style(part, SID.LAST_SYSTEM_FILL_LIMIT) * 100), (n) => app.setPartPage(part.id, { [SID.LAST_SYSTEM_FILL_LIMIT]: n / 100 }), { max: 100, step: 5 }); f.setAttribute('data-field', 'last-fill'); return f; })()) : null,
      ],
      texts: [...text.slice(0, 6), partTextsList(part)],
      numbers: [...text.slice(6)],
      tracks: [
      el('h3', {}, label('parts.staves')),
      el('div', { class: 'ps-row' }, el('button', { type: 'button', 'data-act': 'part-tracks', onclick: () => partTracks.open(part.id) }, label('partTracks.open'))),
      ],
    };
    if (medium === 'tablet') {
      // a layout of a canvas takes the SHAPE of its canvas (changed in the canvas, for all its layouts) and is never printed
      const canvas = currentCanvas();
      groups.page = groups.page.flatMap((n) => {
        if (!n || n.nodeType !== 1) return [n];
        if (n.querySelector('[data-act="part-format"]')) return [el('div', { class: 'ps-hint', 'data-canvas-shape': '' }, label('canvas.shapeIs', { name: canvas?.name || label('canvas.unnamed'), shape: label(`parts.format.${canvas?.format ?? 'custom'}`), way: label(canvas?.landscape === false ? 'canvas.portrait' : 'canvas.landscape') }))];
        if (n.tagName === 'H3' && n.textContent === label('parts.output')) return [];
        if (n.querySelector('[data-act="print"]') || n.hasAttribute('data-print-hint')) return [];
        if (n.querySelector('label') && n.querySelector('[data-stepper-input]') && n.textContent.startsWith(label('parts.width'))) return [];
        return [n];
      });
    }
    groups.page = [...groups.page, ...groups.layout]; delete groups.layout;
    const error = el('div', { class: 'ps-error', 'data-error': '' }, message);
    return { groups, error };
  }

  /** The properties on a tablet or a phone (no sidebar): `ui/tablet-panel.js` (the same tabs as the sidebar of a computer; a column beside the page, or a sheet at the bottom). */
  function propertiesColumn(part, parts) {
    const { groups, error } = properties(part, parts);
    return createTabletPanel({
      tabs: GROUPS.map((g) => ({ id: g, text: label(`parts.tab.${g}`) })), state: tabletState, attrs: { 'data-parts-props': '' },
      getShell: () => host.querySelector('.ps-root'),
      build: (tab) => collapsible(el('div', { class: 'ps-props', 'data-parts-props': tab }, ...groups[tab], tab === 'page' ? error : null)),
    });
  }
  /** The scroll of the tabs of the sidebar and of what holds them: [[element, scrollTop]]. */
  function sidebarScrolls() {
    const out = new Map();
    for (const g of GROUPS) for (let e = sidebar.tabBody(sideTabId(g)); e && e !== document.body; e = e.parentElement) if (e.scrollTop > 0 && !out.has(e)) out.set(e, e.scrollTop);
    return out;
  }
  /** Puts the scroll back (a redraw rebuilds the column: without this the panel jumps away from the stepper that was just pressed). */
  function restoreScrolls(scrolls) {
    if (!scrolls?.size) return;
    const put = () => { for (const [e, top] of scrolls) if (e.isConnected && e.scrollTop !== top) e.scrollTop = top; };
    put(); requestAnimationFrame(put);
  }

  /** The properties in the tabs of the sidebar (computers); the tracks tab is the part's tracks panel itself. */
  function fillSidebar(part, parts) {
    const { groups, error } = properties(part, parts);
    for (const g of GROUPS) {
      if (g === 'tracks') continue;
      sidebar.tabBody(sideTabId(g))?.replaceChildren(collapsible(el('div', { class: 'ps-props', 'data-parts-props': g, 'data-docked': '' }, ...groups[g], g === 'page' ? error : null))); // every heading folds what follows it
    }
    partTracks.open(part.id);
  }

  /** What the title line says on screen 2 (like the counts of screen 1): the pages and what is chosen. */
  function statusText(pageCount) {
    const bits = [label('parts.status.pages', { n: pageCount })];
    const rg = rangeOf();
    const mvSel = selected && app.doc.find(selected) ? app.doc.movementOf(app.doc.find(selected)) : null;
    if (picked.size) bits.push(label('parts.elementsPicked', { n: picked.size }));
    else if (!selected || !mvSel) { selected = null; rangeTo = null; }
    else { const ids = mvSel.masterbars.map((b) => b.id); bits.push(rg ? label('parts.rangeN', { from: ids.indexOf(rg.from) + 1, to: ids.indexOf(rg.to) + 1 }) : label('parts.measureN', { n: ids.indexOf(selected) + 1 })); }
    return bits.join(' · ');
  }


  function elementsBar(part, box) {
    const ids = [...picked];
    if (!ids.length) { box.append(el('span', { class: 'ps-hint' }, label('parts.tapElement'))); return; }
    const single = ids.length === 1 ? app.doc.find(ids[0]) : null;
    // colour, visibility, position and the actions of what is picked are in the floating bar near it (mountPickBar); this bar keeps what needs room: texts
    if (single && (part.containers ?? []).includes(single) && single.props.containerPlacement !== 'zone') { partContainerBar(part, box, single); return; }
    if (single && (part.containers ?? []).includes(single)) { zoneCellBar(part, box, single); return; }
    if (single?.type === 'staffContainer' && app.doc.parentOf(single.id)?.type === 'staff') box.append(el('span', { class: 'ps-hint', 'data-from-screen1': '' }, label('parts.containerFromScreen1')));
    box.append(el('span', { class: 'ps-hint' }, label('parts.elementsPicked', { n: ids.length })));
  }

  // ---------- the floating bar of what is picked: colour, visibility, position (and the actions of a container) ----------
  let pickPage = null; let pickPageFor = null; // null = first level; 'color' | 'move' | 'more'
  function mountPickBar(part) {
    if (!picked.size) return;
    const ids = [...picked];
    const single = ids.length === 1 ? app.doc.find(ids[0]) : null;
    const isCell = single && (part.containers ?? []).includes(single) && single.props.containerPlacement === 'zone';
    if (isCell) return; // has its own bar (mountZoneBar)
    const sel = (id) => `.ps-sheet [data-sel="${window.CSS.escape(id)}"], .ps-sheet [data-ref="${window.CSS.escape(id)}"], .ps-chrome [data-chrome="${window.CSS.escape(id)}"]`;
    const node = host.querySelector(ids.map(sel).join(','));
    if (!node) return; // the page is not written (far from the screen)
    const key = ids.join('|');
    if (pickPageFor !== key) { pickPage = null; pickPageFor = key; }
    unmountContainerBar();
    const partContainer = single && (part.containers ?? []).includes(single) ? single : null;
    const fromScreen1 = single?.type === 'staffContainer' && !partContainer && app.doc.parentOf(single.id)?.type === 'staff' ? single : null;
    const recs = ids.map((id) => partOverrideOf(part, id) ?? {});
    const color = recs.every((r) => r.color === recs[0].color) ? recs[0].color ?? null : undefined;
    const hidden = recs.every((r) => r.hidden);
    const off = recs.length === 1 ? recs[0].offset ?? [0, 0] : null;
    const apply = (patch) => run(() => app.setElementOverride(part.id, ids, patch, { music: musicUnlocked }));
    const needsMusic = ids.some((id) => MUSIC_TYPES.has(app.doc.find(id)?.type));
    const locked = needsMusic && !musicUnlocked;
    const STEP = 0.25;
    const move = (dx, dy) => apply({ offset: [(off?.[0] ?? 0) + dx, (off?.[1] ?? 0) + dy] });
    const pb = (act, tip, onclick, { icon: name = null, text = null, pressed, disabled = false } = {}) => {
      const b = el('button', { type: 'button', 'data-act': act, title: tip, 'aria-label': tip, 'aria-pressed': pressed === undefined ? null : String(pressed), disabled: disabled || null, onclick, 'data-no-icon': '' });
      b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
      if (name) applyIconName(b, name); else if (text !== null) b.textContent = text;
      return b;
    };
    const back = () => pb('pick-back', label('parts.containerClose'), () => { pickPage = null; draw(); }, { icon: 'chevron-left' });
    const go = (name) => () => { pickPage = name; draw(); };
    const hint = (t, attrs = {}) => el('span', { class: 'ps-hint', ...attrs }, t);
    const close = () => pb('deselect-elements', label('parts.containerClose'), () => { picked.clear(); pickPage = null; draw(); }, { icon: 'x' });
    const items = [];
    if (pickPage === 'color') {
      items.push(back(), pb('color-auto', label('parts.colorAuto'), () => apply({ color: null }), { text: 'A', pressed: color === null }),
        ...SWATCHES.map((c) => { const b = pb('color', c, () => apply({ color: c }), { text: '', pressed: color === c }); b.dataset.color = c; b.classList.add('ps-swatch'); b.style.background = c; return b; }),
        (() => { const input = el('input', { type: 'color', value: color ?? '#000000', 'data-act': 'color-custom', 'aria-label': label('parts.colorCustom') }); input.addEventListener('change', () => apply({ color: input.value })); return input; })());
    } else if (pickPage === 'move' && off) {
      items.push(back(), pb('move-left', '←', () => move(-STEP, 0), { icon: 'arrow-left', disabled: locked }), pb('move-right', '→', () => move(STEP, 0), { icon: 'arrow-right', disabled: locked }),
        pb('move-up', '↑', () => move(0, -STEP), { icon: 'arrow-up', disabled: locked }), pb('move-down', '↓', () => move(0, STEP), { icon: 'arrow-down', disabled: locked }),
        hint(`${off[0]}, ${off[1]}`, { 'data-offset': off.join(',') }), pb('move-reset', label('parts.resetElements'), () => apply({ offset: null }), { icon: 'rotate-ccw', disabled: locked }));
      if (single?.type === 'staff') {
        const gap = (part.props[PID.PART_STAFF_GAPS] ?? {})[single.id] ?? 0;
        const setGap = (v) => run(() => app.setStaffGap(part.id, single.id, Math.max(-10, Math.min(40, Math.round(v * 2) / 2))));
        items.push(hint(label('parts.staffGapAbove')), pb('gap-less', '−', () => setGap(gap - 0.5), { icon: 'minus' }), hint(`${gap} sp`, { 'data-staff-gap': String(gap) }), pb('gap-more', '+', () => setGap(gap + 0.5), { icon: 'plus' }));
      }
    } else if (pickPage === 'more' && partContainer) {
      items.push(back(), pb('container-up', label('parts.containerUp'), () => run(() => app.moveContainer(partContainer.id, -1)), { icon: 'arrow-up' }), pb('container-down', label('parts.containerDown'), () => run(() => app.moveContainer(partContainer.id, 1)), { icon: 'arrow-down' }),
        pb('container-copy', label('parts.containerCopy'), () => { app.setContainerClip(partContainer.id); }, { icon: 'copy' }),
        pb('overrides-reset', label('parts.resetElements'), () => apply({ color: null, offset: null, hidden: null }), { icon: 'rotate-ccw' }));
    } else {
      if (partContainer) {
        const kind = partContainer.props.containerKind ?? 'text';
        if (kind !== 'text') {
          const playing = app.containerPlaying(partContainer.id);
          items.push(pb('container-play', label(playing ? 'container.stopListen' : 'container.listen'), () => { app.playContainer(partContainer.id); draw(); }, { icon: playing ? 'square' : 'play' }),
            pb('container-edit', label('parts.zoneEdit'), () => openNested(partContainer.id), { icon: 'pencil' }));
        }
        if ((partContainer.props.containerPlacement ?? 'above') === 'above') {
          const span = partContainer.props.span ?? 1;
          items.push(pb('container-span-less', label('parts.containerSpan', { n: span - 1 }), () => run(() => app.setContainerSpan(partContainer.id, span - 1)), { icon: 'minus', disabled: span <= 1 }), hint(String(span), { 'data-container-span': String(span) }), pb('container-span-more', label('parts.containerSpan', { n: span + 1 }), () => run(() => app.setContainerSpan(partContainer.id, span + 1)), { icon: 'plus' }));
        }
      }
      // a container between two measures takes room in the line: its width (staff spaces), by hand or from its content (like screen 1)
      if (partContainer && partContainer.props.containerPlacement === 'between') {
        const width = partContainer.props.containerWidth ?? null;
        const w = Math.round((width ?? 6) * 2) / 2;
        items.push(pb('container-width-less', label('container.widthLess'), () => run(() => app.setSlotWidth(partContainer.id, Math.max(1, w - 1))), { text: `− ${label('container.wideShort')}` }),
          hint(width === null ? label('container.autoShort') : `${width} sp`, { 'data-container-width': String(width ?? 'auto') }),
          pb('container-width-more', label('container.widthMore'), () => run(() => app.setSlotWidth(partContainer.id, w + 1)), { text: `+ ${label('container.wideShort')}` }),
          pb('container-width-auto', label('container.widthAuto'), () => run(() => app.setSlotWidth(partContainer.id, null)), { text: label('container.autoShort'), pressed: width === null }),
          pb('container-separator', label('container.separator'), () => run(() => app.setSlotSeparator(partContainer.id, !partContainer.props.containerSeparator)), { text: label('container.separatorShort'), pressed: !!partContainer.props.containerSeparator }));
      }
      if (fromScreen1) items.push(pb('container-copy-here', label('parts.containerCopyHereHint'), () => run(() => { const copy = app.copyContainerToPart(part.id, fromScreen1.id, { hideOriginal: true }); picked.clear(); picked.add(copy.id); }), { icon: 'copy' }));
      const colorBtn = pb('color-menu', label('parts.colorMenu'), go('color'), { text: '' });
      colorBtn.append(el('span', { style: `display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid var(--edge,#888);background:${color && color !== undefined ? color : 'conic-gradient(#c62828,#ef6c00,#2e7d32,#1565c0,#6a1b9a,#c62828)'}` }));
      items.push(colorBtn, pb('hide', label(hidden ? 'parts.show' : 'parts.hide'), () => apply({ hidden: hidden ? null : true }), { icon: hidden ? 'eye-off' : 'eye', pressed: hidden }));
      if (off) items.push(pb('move-menu', label('parts.moveMenu'), go('move'), { icon: 'move' }));
      if (needsMusic) {
        let timer = null; let longDone = false;
        const lockBtn = pb('music-lock', label('parts.lockMusic'), () => { if (longDone) { longDone = false; return; } if (musicUnlocked) { musicUnlocked = false; lockHint = false; } else lockHint = true; draw(); }, { icon: musicUnlocked ? 'lock-open' : 'lock', pressed: musicUnlocked });
        lockBtn.addEventListener('pointerdown', () => { longDone = false; timer = setTimeout(() => { longDone = true; musicUnlocked = true; lockHint = false; draw(); }, 600); });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) lockBtn.addEventListener(ev, () => clearTimeout(timer));
        items.push(lockBtn, lockHint && !musicUnlocked ? hint(label('parts.lockHold'), { 'data-lock-hint': '' }) : null);
      }
      if (partContainer) {
        items.push(pb('container-more', label('parts.zoneMore'), go('more'), { icon: 'ellipsis' }),
          pb('container-remove', label('parts.containerRemove'), () => { run(() => app.removePartContainer(part.id, partContainer.id)); picked.clear(); draw(); }, { icon: 'trash' }));
      } else items.push(pb('overrides-reset', label('parts.resetElements'), () => apply({ color: null, offset: null, hidden: null }), { icon: 'rotate-ccw' }));
      items.push(close());
    }
    cbar = el('div', { class: 'ps-cbar', 'data-pick-bar': '', 'data-zoom-lock': '', 'aria-label': label('parts.elementsPicked', { n: ids.length }) }, ...items.filter(Boolean));
    document.body.append(cbar);
    markDrawerLevel(cbar, pickPage ? 'page' : 'menu');
    const place = () => {
      if (!cbar || !node.isConnected) return;
      const r = node.getBoundingClientRect(); const vv = window.visualViewport;
      const view = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth), bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight) };
      const dockBar = document.querySelector('[data-dock]');
      const pos = placeFloating({ anchor: { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }, size: { w: cbar.offsetWidth, h: cbar.offsetHeight }, visible: visibleArea(view, dockBar ? [dockBar.getBoundingClientRect()] : []) });
      cbar.style.left = `${pos.x}px`; cbar.style.top = `${pos.y}px`; cbar.dataset.side = pos.side;
    };
    place();
    window.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    cbarOff = () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }

  /** The container hung on a staff of `part` under a click (a small probe around the point, through the tappable zones that lie over the page), or null. */
  function containerAt(e, sheet, part) {
    const ids = new Set(app.partContainers(part.id).map((c) => c.id));
    if (!ids.size) return null;
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [6, 0], [-6, 0], [0, 6], [0, -6]]) {
      for (const n of document.elementsFromPoint(e.clientX + dx, e.clientY + dy)) {
        if (!sheet.contains(n)) continue;
        const node = n.closest?.('[data-sel],[data-ref]');
        const key = node?.getAttribute('data-sel') ?? node?.getAttribute('data-ref');
        if (key && ids.has(key)) return key;
      }
    }
    return null;
  }

  /** The staff of `sys` nearest to a click (client y), in the layout units of the page: the container that is added hangs on it. */
  function staffNear(sys, sheet, clientY, H) {
    const r = sheet.getBoundingClientRect();
    if (!r.height || !H) return sys.staves[0]?.ref ?? null;
    const y = ((clientY - r.top) / r.height) * H;
    let best = null; let bestD = Infinity;
    for (const st of sys.staves) {
      let h = 0;
      for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
      if (!h) h = 4;
      const bottom = sys.top + st.originY; const top = bottom - h;
      const d = y < top ? top - y : y > bottom ? y - bottom : 0;
      const dc = Math.abs(y - (top + bottom) / 2);
      if (d < bestD || (d === bestD && dc < best.dc)) { bestD = d; best = { ref: st.ref, dc }; }
    }
    return best?.ref ?? null;
  }

  /** Name of a staff of the piece for the hints ("Drums", "Guitar · 2"). */
  function staffName(id) {
    const c = app.partStaffChoices().find((x) => x.id === id);
    return c ? `${c.trackName || c.trackId}${c.indexInTrack ? ` · ${c.indexInTrack + 1}` : ''}` : '';
  }

  // ---------- the floating bar of the staff measure: hang a container on it ----------
  let cbar = null; let cbarOff = null;
  function unmountContainerBar() { cbarOff?.(); cbarOff = null; cbar?.remove(); cbar = null; }
  /** Opens the editor of the nested score of a container; the page it sits on lets the editor find its frame and the scale of the page. */
  const openNested = (id) => { unmountContainerBar(); openFragment(id, { frameRoot: host, staffSpaceFor: (node) => {
    const page = node.closest('.ps-page'); const sheetEl = page?.querySelector('.ps-sheet');
    const lw = Number(page?.dataset.layoutWidth);
    return sheetEl && lw ? sheetEl.getBoundingClientRect().width / lw : null;
  } }); };
  // ---------- the floating bar of the chosen measure / range of measures (one level of buttons; menus replace it, a tap in the void goes back up) ----------
  let gapScope = 'system'; // the room above a staff: for the system touched ('system') or for every system of the part ('all')
  let measurePage = null; let measurePageFor = null; // null = first level; 'lock' | 'zone' | 'numbers' | 'container'
  function mountContainerBar(part) {
    unmountContainerBar();
    if (!staffLevel || !selected || !selectedStaff || !app.doc.find(selected) || !app.doc.find(selectedStaff)) return;
    const node = host.querySelector('.ps-staffsel');
    if (!node) return; // the page is not written (far from the screen)
    const rg = rangeOf();
    const key = `${selected}|${rangeTo ?? ''}`;
    if (measurePageFor !== key) { measurePage = null; measurePageFor = key; }
    const done = () => { staffLevel = false; selected = null; rangeTo = null; extending = false; selectedStaff = null; measurePage = null; };
    const mvSel = app.doc.movementOf(app.doc.find(selected));
    const ids = mvSel.masterbars.map((b) => b.id);
    const add = (spec) => run(() => {
      app.addPartContainer(part.id, selectedStaff, selected, { ...spec, placement: containerWhere === 'above' ? 'above' : 'between', side: containerWhere === 'after' ? 'after' : 'before' });
      const made = app.partContainers(part.id).at(-1);
      done();
      if (!made) return;
      if (made.props.containerKind === 'nestedNotation') queueMicrotask(() => openNested(made.id)); // the score is written in place at once
      else { picked.clear(); picked.add(made.id); } // a text: its field is in the bar above
    });
    const pb = (act, content, onclick, pressed, tip) => {
      const b = el('button', { type: 'button', 'data-act': act, title: tip, 'aria-label': tip, 'aria-pressed': pressed === undefined ? null : String(pressed), onclick, 'data-no-icon': '' });
      if (typeof content === 'string') b.textContent = content; else if (content) b.append(content);
      b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
      return b;
    };
    const iconBtn = (act, name, onclick, pressed, tip) => { const b = pb(act, null, onclick, pressed, tip); applyIconName(b, name); return b; };
    const glyphBtn = (act, glyph, fallback, onclick, tip) => pb(act, glyphRowIcon(glyphs, [glyph], { side0: 3.2, px: 20 }) ?? fallback, onclick, undefined, tip);
    const act = (fn) => () => { run(fn); };
    const page = (name) => () => { measurePage = name; draw(); };
    const back = () => iconBtn('measure-back', 'chevron-left', () => { measurePage = null; draw(); }, undefined, label('parts.containerClose'));
    const hint = (text, attrs = {}) => el('span', { class: 'ps-hint', ...attrs }, text);
    const items = [];
    const last = rg ? rg.to : selected;
    const brk = partBreaks(part).find((b) => b.measureId === last)?.breakKind;
    const lock = rg ? null : lockContaining(app.doc, part, selected);
    if (measurePage === 'lock' && lock) {
      const f = ids.indexOf(lock.from); const t = ids.indexOf(lock.to);
      items.push(back(), iconBtn('unlock', 'lock-open', act(() => { app.unlockSystem(part.id, lock.id); measurePage = null; }), true, label('parts.unlock')),
        pb('lock-from-grow', '◀ +', act(() => app.extendLock(part.id, lock.id, 'from', 1)), undefined, label('parts.lockFromGrow')), pb('lock-from-shrink', '◀ −', act(() => app.extendLock(part.id, lock.id, 'from', -1)), undefined, label('parts.lockFromShrink')),
        pb('lock-to-shrink', '− ▶', act(() => app.extendLock(part.id, lock.id, 'to', -1)), undefined, label('parts.lockToShrink')), pb('lock-to-grow', '+ ▶', act(() => app.extendLock(part.id, lock.id, 'to', 1)), undefined, label('parts.lockToGrow')),
        hint(label('parts.lockRange', { from: f + 1, to: t + 1 })));
    } else if (measurePage === 'zone' && !rg) {
      const end = systemEndOf(selected);
      const all = app.zones(part.id);
      const rows = end ? all.filter((z) => z.measureId === end && !isBeforeRow(z.row)) : [];
      items.push(back());
      if (end) items.push(pb('zone-add', '+', act(() => app.addZoneCell(part.id, end, { kind: 'text', text: '', height: 6, row: rows.length })), undefined, label(rows.length ? 'parts.zoneAddStacked' : 'parts.zoneAdd')));
      if (rows.length) items.push(hint(label('parts.zoneCount', { n: rows.length })));
      if (mvSel.masterbars[0]?.id === selected) {
        const before = all.filter((z) => z.measureId === selected && isBeforeRow(z.row));
        if (before.length < ZONE_MAX_ROWS) items.push(iconBtn('zone-add-before', 'arrow-up', act(() => app.addZoneCell(part.id, selected, { kind: 'text', text: '', height: 6, row: ZONE_BEFORE_BASE + before.length })), undefined, label('parts.zoneAddBefore')));
        if (before.length) items.push(hint(label('parts.zoneCountBefore', { n: before.length })));
      }
    } else if (measurePage === 'gap' && !rg) {
      // extra room above the staff touched, in staff spaces, in this part only: for THIS system or for every system of the part
      const gaps = part.props[PID.PART_STAFF_GAPS] ?? {};
      const sysIds = systemMeasureIds(selected);
      const first = lastResult?.pages.some((pg) => pg.layout.systems.some((sy) => sy.measures.some((m) => m.ref === selected) && sy.staves[0]?.ref === selectedStaff));
      const ownAt = sysIds.find((m) => Object.hasOwn(gaps, staffGapKey(selectedStaff, m)));
      const own = ownAt !== undefined; const anchor = ownAt ?? sysIds[0] ?? selected; // the key of this system's own value (its first measure when there is none yet)
      const shown = gapScope === 'system' ? effectiveStaffGap(gaps, selectedStaff, sysIds) : (gaps[selectedStaff] ?? 0);
      const write = (v) => run(() => (gapScope === 'system' ? app.setStaffGapAt(part.id, selectedStaff, anchor, Math.max(-10, Math.min(40, v))) : app.setStaffGap(part.id, selectedStaff, Math.max(-10, Math.min(40, Math.round(v * 2) / 2)))));
      const scope = pb('gap-scope', gapScope === 'system' ? '1' : '∞', () => { gapScope = gapScope === 'system' ? 'all' : 'system'; draw(); }, undefined, label(gapScope === 'system' ? 'parts.gapThisSystem' : 'parts.gapAllSystems'));
      markCyclic(scope, 2, gapScope === 'system' ? 0 : 1);
      items.push(back(), first ? hint(label('parts.gapFirstStaff')) : null, scope, hint(label('parts.staffGapAbove')),
        pb('gap-less', '−', () => write(shown - 0.5), undefined, label('parts.staffGapAbove')),
        (() => { const pill = createScrubPill({ min: -10, max: 40, value: shown, step: 0.5, pxPerStep: 5, format: (v) => `${v} sp`, title: label('parts.staffGapAbove'), label: { down: label('parts.staffGapAbove'), up: label('parts.staffGapAbove') }, onCommit: (v) => write(v) }); pill.el.setAttribute('data-staff-gap', String(shown)); pill.el.style.flex = 'none'; pill.el.style.whiteSpace = 'nowrap'; return pill.el; })(), pb('gap-more', '+', () => write(shown + 0.5), undefined, label('parts.staffGapAbove')),
        iconBtn('gap-reset', 'rotate-ccw', () => (gapScope === 'system' && own ? run(() => app.setStaffGapAt(part.id, selectedStaff, anchor, null)) : write(0)), undefined, label('parts.resetElements')));
    } else if (measurePage === 'numbers' && !rg) {
      const index = ids.indexOf(selected);
      const own = (part.props[PID.PART_MEASURE_NUMBERS] ?? []).find((o) => o.measureId === selected)?.mode ?? null;
      const next = own === null ? 'show' : own === 'show' ? 'hide' : null;
      const numbering = measureNumbers(mvSel);
      const offset = mvSel.masterbars[index].props[PID.MEASURE_NUMBER_OFFSET] ?? 0;
      items.push(back(),
        pb('number-mode', '#', act(() => app.setMeasureNumberMode(part.id, selected, next)), own !== null, label(own === 'show' ? 'parts.numberShow' : own === 'hide' ? 'parts.numberHide' : 'parts.numberAuto')),
        pb('no-count', '∅', act(() => app.setMeasureCounting(selected, { exclude: !numbering.excluded[index] })), numbering.excluded[index], label('parts.noCount')),
        pb('offset-minus', '−', act(() => app.setMeasureCounting(selected, { offset: offset - 1 })), undefined, label('parts.offset')),
        hint(`${offset > 0 ? '+' : ''}${offset}`, { 'data-offset': String(offset) }),
        pb('offset-plus', '+', act(() => app.setMeasureCounting(selected, { offset: offset + 1 })), undefined, label('parts.offset')));
    } else if (measurePage === 'container' && !rg) {
      items.push(back(),
        ...[['above', 'arrow-up', 'parts.containerAbove'], ['before', 'arrow-left', 'parts.containerBefore'], ['after', 'arrow-right', 'parts.containerAfter']].map(([v, icon, k]) => iconBtn(`where-${v}`, icon, () => { containerWhere = v; draw(); }, containerWhere === v, label(k))),
        el('span', { class: 'ps-sep' }),
        pb('add-text', 'TXT', () => add({ kind: 'text' }), undefined, label('parts.containerText')),
        pb('add-gap', label('container.gapShort'), () => { if (containerWhere === 'above') containerWhere = 'before'; add({ kind: 'text', gap: true }); }, undefined, label('container.gap')),
        glyphBtn('add-score', 'gClef', 'G', () => add({ kind: 'nestedNotation', staffType: 'score', clef: 'G' }), label('parts.containerScore')),
        glyphBtn('add-rhythm', 'noteheadSlashHorizontalEnds', '/', () => add({ kind: 'nestedNotation', staffType: 'rhythm' }), label('parts.containerRhythm')),
        glyphBtn('add-drums', 'unpitchedPercussionClef1', 'D', () => add({ kind: 'nestedNotation', staffType: 'percussion' }), label('parts.containerDrums')),
        app.containerClip() ? iconBtn('container-paste', 'clipboard-paste', () => run(() => {
          app.pastePartContainer(app.containerClip(), part.id, selectedStaff, selected);
          const made = app.partContainers(part.id).at(-1);
          done();
          if (made) { picked.clear(); picked.add(made.id); }
        }), undefined, label('parts.containerPaste')) : null);
    } else {
      items.push(iconBtn('break-system', 'corner-down-left', act(() => app.toggleBreak(part.id, last, 'system')), brk === 'system', label('parts.breakSystem')),
        iconBtn('break-page', 'page-break', act(() => app.toggleBreak(part.id, last, 'page')), brk === 'page', label('parts.breakPage')));
      if (app.pageHintAfterState(selectedStaff, last) !== null) items.push(iconBtn('break-hint', 'file-plus', act(() => app.togglePageHintAfter(selectedStaff, last)), app.pageHintAfterState(selectedStaff, last), label('parts.breakHint')));
      if (rg) items.push(iconBtn('lock', 'lock', act(() => { app.lockSystem(part.id, rg.from, rg.to); rangeTo = null; }), undefined, label('parts.lock')));
      else if (lock) items.push(iconBtn('lock', 'lock-open', page('lock'), true, label('parts.lockEdit')));
      else items.push(iconBtn('lock', 'lock', act(() => app.lockSystem(part.id, selected, selected)), undefined, label('parts.lock')));
      if (!rg) items.push(iconBtn('extend', 'arrow-right', () => { extending = !extending; draw(); }, extending, label('parts.extendRange')),
        pb('part-text-add-bar', 'Aa', () => openPartStaffTextDialog({ app, label, partId: part.id, staffId: selectedStaff, measureId: selected, onDone: () => { done(); draw(); } }), undefined, label('partText.addHere')),
        pb('zone-menu', 'Zone', page('zone'), undefined, label('parts.zoneMenu')), pb('numbers-menu', '#', page('numbers'), undefined, label('parts.numbersMenu')), iconBtn('gap-menu', 'arrow-up-down', page('gap'), undefined, label('parts.staffGapAbove')),
        iconBtn('container-menu', 'square-dashed', page('container'), undefined, label('parts.containerMenu')));
      items.push(hint(rg ? label('parts.rangeN', { from: ids.indexOf(rg.from) + 1, to: ids.indexOf(rg.to) + 1 }) : label('parts.measureN', { n: ids.indexOf(selected) + 1 }), rg ? { 'data-range-hint': '' } : {}),
        iconBtn('container-bar-close', 'x', () => { done(); draw(); }, undefined, label('parts.containerClose')));
    }
    cbar = el('div', { class: 'ps-cbar', 'data-container-bar': '', 'data-zoom-lock': '', 'aria-label': label('parts.containerOn', { staff: staffName(selectedStaff) }) }, ...items);
    document.body.append(cbar);
    markDrawerLevel(cbar, measurePage ? 'page' : 'menu');
    const place = () => {
      if (!cbar || !node.isConnected) return;
      const r = node.getBoundingClientRect();
      const vv = window.visualViewport;
      const view = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth), bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight) };
      const dockBar = document.querySelector('[data-dock]');
      const bars = dockBar ? [dockBar.getBoundingClientRect()] : [];
      // a text of the part sits above the staff the measure belongs to: the bar goes under the measure so that the text (and its line) stay visible
      const textAbove = partStaffTextsOf(activePart()).some((t) => t.placement === 'above' && (!selectedStaff || t.staffId === selectedStaff));
      const pos = placeFloating({ anchor: { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }, size: { w: cbar.offsetWidth, h: cbar.offsetHeight }, visible: visibleArea(view, bars), prefer: textAbove ? 'below' : null });
      cbar.style.left = `${pos.x}px`; cbar.style.top = `${pos.y}px`; cbar.dataset.side = pos.side;
    };
    place();
    window.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    cbarOff = () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }

  /** Controls of a picked container hung on a staff of the part. */
  function partContainerBar(part, box, c) {
    const kind = c.props.containerKind ?? 'text';
    box.append(el('span', { class: 'ps-hint' }, `${label(kind === 'text' ? 'parts.containerText' : 'parts.containerScore')} — ${staffName(c.props.containerStaffId)}`));
    if (kind === 'text') {
      const t = el('textarea', { rows: '2', 'data-field': 'container-text', style: 'min-width:220px;font:inherit;font-size:16px', 'aria-label': label('parts.textContent') });
      t.value = c.props.text ?? '';
      t.addEventListener('change', () => run(() => app.setContainerText(c.id, t.value)));
      box.append(t);
    }
  }

  /** Measure ids of the system of the pages that holds `measureId` (empty when it is not on a written page). */
  function systemMeasureIds(measureId) {
    for (const p of lastResult?.pages ?? []) for (const sys of p.layout.systems) if (sys.measures.some((m) => m.ref === measureId)) return sys.measures.map((m) => m.ref);
    return [];
  }

  /** Last measure (id) of the system of the page that holds `measureId`. */
  function systemEndOf(measureId) {
    for (const p of lastResult?.pages ?? []) for (const sys of p.layout.systems) if (sys.measures.some((m) => m.ref === measureId)) return sys.measures[sys.measures.length - 1].ref;
    return null;
  }

  /** Zone controls of the chosen measure: a new zone under its system (several can be stacked). */
  function zoneControls(part, box, btn) {
    const end = systemEndOf(selected);
    if (!end) return;
    const all = app.zones(part.id);
    const rows = all.filter((z) => z.measureId === end && !isBeforeRow(z.row));
    box.append(btn('zone-add', label(rows.length ? 'parts.zoneAddStacked' : 'parts.zoneAdd'), () => app.addZoneCell(part.id, end, { kind: 'text', text: '', height: 6, row: rows.length })));
    if (rows.length) box.append(el('span', { class: 'ps-hint' }, label('parts.zoneCount', { n: rows.length })));
    // above the first system of the movement: offered when the chosen measure is the first of its movement
    const mv = app.doc.movementOf(app.doc.find(selected));
    if (mv && mv.masterbars[0]?.id === selected) {
      const before = all.filter((z) => z.measureId === selected && isBeforeRow(z.row));
      if (before.length < ZONE_MAX_ROWS) box.append(btn('zone-add-before', label('parts.zoneAddBefore'), () => app.addZoneCell(part.id, selected, { kind: 'text', text: '', height: 6, row: ZONE_BEFORE_BASE + before.length })));
      if (before.length) box.append(el('span', { class: 'ps-hint' }, label('parts.zoneCountBefore', { n: before.length })));
    }
  }

  // ---------- the floating bar of a picked zone cell (same mechanism as the bars of screen 1: near what is picked, menus replace the bar) ----------
  let zonePage = null; let zonePageFor = null; // null = first level, 'kind' = the kinds a cell can become, 'more' = the rest
  function mountZoneBar(part) {
    if (mode !== 'elements' || picked.size !== 1) return;
    const id = [...picked][0];
    const cell = app.doc.find(id);
    if (!cell || !(part.containers ?? []).includes(cell) || cell.props.containerPlacement !== 'zone') return;
    const node = host.querySelector(`.ps-sheet [data-sel="${window.CSS.escape(id)}"], .ps-sheet [data-ref="${window.CSS.escape(id)}"]`);
    if (!node) return; // the page is not written (far from the screen)
    if (zonePageFor !== id) { zonePage = null; zonePageFor = id; }
    unmountContainerBar();
    const kind = cell.props.containerKind; const bar = cell.props.measureId; const row = cell.props.containerZoneRow ?? 0; const column = cell.props.containerZoneColumn ?? 0;
    const zone = app.zones(part.id).find((z) => z.measureId === bar && z.row === row);
    const repick = () => { const z = app.zones(part.id).find((x) => x.measureId === bar && x.row === row); const c = z?.cells.find((x) => (x.props.containerZoneColumn ?? 0) === column); picked.clear(); if (c) picked.add(c.id); zonePage = null; };
    const pb = (act, tip, onclick, { icon: name = null, text = null, pressed, disabled = false } = {}) => {
      const b = el('button', { type: 'button', 'data-act': act, title: tip, 'aria-label': tip, 'aria-pressed': pressed === undefined ? null : String(pressed), disabled: disabled || null, onclick });
      b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; b.setAttribute('data-no-icon', '');
      if (name) applyIconName(b, name); else b.textContent = text ?? '';
      return b;
    };
    const go = (fn) => () => { run(() => { fn(); repick(); }); draw(); };
    const items = [];
    if (zonePage === 'kind') {
      // a score cell is written in place at once (its frame is on the page), as for the containers hung on a staff
      const to = (spec) => () => { go(() => app.replaceZoneCell(part.id, cell.id, spec))(); if (spec.kind === 'nestedNotation') queueMicrotask(() => { const made = [...picked][0]; if (made) openNested(made); }); };
      items.push(pb('zone-back', label('parts.containerClose'), () => { zonePage = null; draw(); }, { icon: 'chevron-left' }),
        pb('zone-to-text', label('parts.zoneToText'), to({ kind: 'text', text: '' }), { text: 'TXT', pressed: kind === 'text' }),
        pb('zone-to-score', label('parts.zoneScore'), to({ kind: 'nestedNotation', staffType: 'score', measures: 1 }), { text: '𝄞' }),
        pb('zone-to-rhythm', label('parts.zoneRhythm'), to({ kind: 'nestedNotation', staffType: 'rhythm', measures: 1 }), { text: '/' }),
        pb('zone-to-percussion', label('parts.zoneDrums'), to({ kind: 'nestedNotation', staffType: 'percussion', measures: 1 }), { text: '▮' }),
        pb('zone-to-structure', label('parts.zoneStructure'), to({ kind: 'structure' }), { icon: 'layers', pressed: kind === 'structure' }),
        pb('zone-to-diagram', label('parts.zoneDiagram'), () => { go(() => app.replaceZoneCell(part.id, cell.id, { kind: 'chordDiagram', chord: app.diagramChordAt(bar) }))(); queueMicrotask(() => { const made = [...picked][0]; if (made) openDiagram(made); }); }, { icon: 'guitar-head', pressed: kind === 'chordDiagram' }),
        pb('zone-to-diagram-list', label('parts.zoneDiagramList'), to({ kind: 'chordDiagramList' }), { text: '▦', pressed: kind === 'chordDiagramList' }));
    } else if (zonePage === 'more') {
      items.push(pb('zone-back', label('parts.containerClose'), () => { zonePage = null; draw(); }, { icon: 'chevron-left' }));
      if (zone) items.push(pb('zone-remove', label('parts.zoneRemove'), () => { run(() => { for (const c of zone.cells) app.removeZoneCell(part.id, c.id); }); picked.clear(); zonePage = null; draw(); }, { icon: 'trash', text: null }),
        pb('zone-height-less', `${label('parts.zoneHeight')} −`, () => run(() => app.setZoneHeight(part.id, bar, Math.max(1, zone.height - 1), row)), { icon: 'minus' }),
        el('span', { class: 'ps-hint', 'data-zone-height': String(zone.height) }, `↕ ${zone.height} sp`),
        pb('zone-height-more', `${label('parts.zoneHeight')} +`, () => run(() => app.setZoneHeight(part.id, bar, zone.height + 1, row)), { icon: 'plus' }));
      if (kind === 'chordDiagram' || kind === 'chordDiagramList') items.push(pb('zone-zoom-out', label('container.zoomOut'), () => run(() => app.zoomContainer(cell.id, -1)), { text: 'A−' }), pb('zone-zoom-in', label('container.zoomIn'), () => run(() => app.zoomContainer(cell.id, 1)), { text: 'A+' }));
      if (kind === 'syncRange') items.push(pb('zone-detach', label('parts.zoneDetach'), go(() => app.detachZoneCell(part.id, cell.id)), { icon: 'copy' }));
    } else {
      items.push(pb('zone-kind', label('parts.zoneKindMenu'), () => { zonePage = 'kind'; draw(); }, { text: kind === 'text' ? 'TXT' : kind === 'structure' ? null : kind === 'syncRange' ? null : '♪', icon: kind === 'structure' ? 'layers' : kind === 'syncRange' ? 'link' : null }));
      if (zone) {
        const cols = pb('zone-cols', label('parts.zoneColumns'), () => {}, { icon: 'columns-2' });
        markShortLongPress(cols);
        bindShortLong(cols, { onShort: () => run(() => app.setZoneColumns(part.id, bar, zone.columns + 1, row)), onLong: () => run(() => app.setZoneColumns(part.id, bar, zone.columns - 1, row)) });
        items.push(cols);
      }
      if (kind === 'chordDiagram') items.push(pb('zone-diagram-edit', label('parts.zoneDiagramEdit'), () => openDiagram(cell.id), { icon: 'pencil' }));
      if (kind === 'chordDiagramList') {
        // every setting of the list (what it lists, grouping, variants, layer, alignment…) is in ONE window, with menus and icons: cycling buttons showed a text that was always cut
        const poolNow = cell.props.diagramListPool ?? '';
        items.push(pb('zone-list-settings', label('parts.listSettings.open'), () => openDiagramListSettings({ app, label, partId: part.id, cellId: cell.id, run, openChords: (o) => openWorkChords(o) }), { icon: 'sliders-vertical' }),
          pb('zone-list-chords', label('chords.openHint'), () => openWorkChords({ pool: poolNow || part.props.partVoicingPool || 'main', instrument: cell.props.diagramInstrument ?? 'guitar' }), { icon: 'pencil' }));
      }
      if (kind === 'nestedNotation') items.push(pb('zone-edit', label('parts.zoneEdit'), () => openNested(cell.id), { icon: 'pencil' }));
      items.push(pb('zone-cell-remove', label('parts.zoneCellRemove'), () => { run(() => app.removeZoneCell(part.id, cell.id)); picked.clear(); draw(); }, { icon: 'trash' }),
        pb('zone-more', label('parts.zoneMore'), () => { zonePage = 'more'; draw(); }, { icon: 'ellipsis' }),
        pb('deselect-elements', label('parts.containerClose'), () => { picked.clear(); draw(); }, { icon: 'x' }));
    }
    cbar = el('div', { class: 'ps-cbar', 'data-zone-bar': '', 'data-zoom-lock': '', 'aria-label': label(`parts.zoneKind.${kind}`) }, ...items);
    document.body.append(cbar);
    markDrawerLevel(cbar, zonePage ? 'page' : 'menu');
    const place = () => {
      if (!cbar || !node.isConnected) return;
      const r = node.getBoundingClientRect(); const vv = window.visualViewport;
      const view = { left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, right: (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth), bottom: (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight) };
      const dockBar = document.querySelector('[data-dock]');
      const pos = placeFloating({ anchor: { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }, size: { w: cbar.offsetWidth, h: cbar.offsetHeight }, visible: visibleArea(view, dockBar ? [dockBar.getBoundingClientRect()] : []) });
      cbar.style.left = `${pos.x}px`; cbar.style.top = `${pos.y}px`; cbar.dataset.side = pos.side;
    };
    place();
    window.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    cbarOff = () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }

  /** Controls of a picked zone cell (a staff container owned by the part). */
  function zoneCellBar(part, box, cell) {
    const kind = cell.props.containerKind;
    const column = cell.props.containerZoneColumn ?? 0; const bar = cell.props.measureId;
    // a change of kind replaces the cell: pick the new one (same zone, same column) so that the bar follows it
    const repick = () => { const z = app.zones(part.id).find((x) => x.measureId === bar && x.row === (cell.props.containerZoneRow ?? 0)); const c = z?.cells.find((x) => (x.props.containerZoneColumn ?? 0) === column); picked.clear(); if (c) picked.add(c.id); };
    const btn = (act, text, fn) => el('button', { type: 'button', 'data-act': act, onclick: () => { run(() => { fn(); repick(); }); draw(); } }, text);
    box.append(el('span', { class: 'ps-hint' }, label(`parts.zoneKind.${kind}`)));
    if (kind === 'text') {
      const t = el('textarea', { rows: '2', 'data-field': 'zone-text', style: 'min-width:220px;font:inherit;font-size:16px', 'aria-label': label('parts.textContent') }); t.value = cell.props.text ?? '';
      t.addEventListener('change', () => run(() => app.setZoneCellText(part.id, cell.id, t.value)));
      // insert a section card at the cursor: the sections of the work (by label), and a card of a free label
      const labels = [...new Set(app.doc.work.movements.flatMap((mv) => sectionList(mv).map((x) => String(x.label))))].filter(Boolean);
      const insertCard = (name) => {
        const a = t.selectionStart ?? t.value.length; const b = t.selectionEnd ?? a;
        t.value = `${t.value.slice(0, a)}{{${name}}}${t.value.slice(b)}`;
        t.dispatchEvent(new Event('change'));
      };
      box.append(t, createChoiceMenu({
        options: [...labels.map((l) => [l, l]), ['__free', label('parts.cardFree')]], value: null, label: label('parts.cardInsert'), act: 'zone-card-insert',
        onPick: (v) => {
          if (v !== '__free') { insertCard(v); return; }
          if (box.querySelector('[data-field="card-name"]')) return;
          const row = el('div', { class: 'ps-row' });
          const inp = el('input', { type: 'text', maxlength: '40', 'data-field': 'card-name', placeholder: label('inline.cardName'), 'aria-label': label('parts.cardFreePrompt'), style: 'font-size:16px;min-height:var(--ui-target,44px);box-sizing:border-box' });
          const ok = () => { const n = inp.value.trim(); row.remove(); if (n) insertCard(`${n}|custom`); };
          inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.preventDefault(); row.remove(); } });
          row.append(inp, el('button', { type: 'button', 'data-act': 'card-name-ok', onclick: ok }, label('inline.validate')));
          box.append(row); inp.focus({ preventScroll: true });
        },
      }));
    }
    // synchronised copy of measures of the piece: staff and measure numbers (of the movement the zone sits in)
    const mv = app.doc.movementOf(app.doc.find(cell.props.measureId));
    const choices = partStaffChoices(app.doc.work).filter((c) => mv && mv.tracks.some((t) => t.staves.some((s) => s.id === c.id)));
    if (choices.length) {
      let staffId = cell.props.rangeStaffId ?? choices[0].id;
      const from = el('input', { type: 'number', min: '1', max: String(mv.masterbars.length), value: String((mv.masterbars.findIndex((b) => b.id === cell.props.rangeFrom) + 1) || 1), 'data-field': 'zone-from', style: 'width:4em;font-size:16px' });
      const to = el('input', { type: 'number', min: '1', max: String(mv.masterbars.length), value: String((mv.masterbars.findIndex((b) => b.id === cell.props.rangeTo) + 1) || 1), 'data-field': 'zone-to', style: 'width:4em;font-size:16px' });
      const staffSel = createChoiceMenu({ options: choices.map((c) => [c.id, `${c.trackName || c.trackId}${c.indexInTrack ? ` · ${c.indexInTrack + 1}` : ''}`]), value: staffId, label: label('parts.zoneSource'), act: 'zone-source', onPick: (v) => { staffId = v; } });
      box.append(el('span', { class: 'ps-hint' }, label('parts.zoneSync')), staffSel, from, to,
        btn('zone-sync', label('parts.zoneSyncApply'), () => app.replaceZoneCell(part.id, cell.id, { kind: 'syncRange', rangeStaffId: staffId, rangeFrom: mv.masterbars[Math.max(0, Math.min(mv.masterbars.length - 1, Number(from.value) - 1))].id, rangeTo: mv.masterbars[Math.max(0, Math.min(mv.masterbars.length - 1, Number(to.value) - 1))].id })));
    }
  }

  /** Above the pages: the tabs of the parts (and the eye of the hidden elements), then, only when something is picked that has fields to type in, those fields. */
  function topBar(part, parts) {
    const row = el('div', { class: 'ps-bar ps-tabsbar', 'data-parts-bar': '' }, tabs(parts));
    const hasHidden = Object.values(part.props[PID.PART_OVERRIDES] ?? {}).some((r) => r.hidden) || (part.containers ?? []).some((c) => part.props[PID.PART_OVERRIDES]?.[c.id]?.hidden);
    if (hasHidden || showHiddenOn) row.append(el('button', { type: 'button', 'data-act': 'show-hidden', 'aria-pressed': String(showHiddenOn), title: label('parts.showHidden'), 'aria-label': label('parts.showHidden'), onclick: () => { showHiddenOn = !showHiddenOn; draw(); } }, '👁'));
    const top = el('div', { class: 'ps-top' });
    if (!docked()) top.append(el('div', { class: 'ps-bar' }, mediumRow())); // on a computer the choice sits above the tabs of the sidebar
    if (medium === 'tablet') top.append(el('div', { class: 'ps-bar' }, canvasRow()));
    top.append(row);
    if (picked.size) {
      const fields = el('div', { class: 'ps-bar ps-fields', 'data-parts-bar': '' });
      elementsBar(part, fields);
      if (fields.querySelector('input, textarea, select, button, .cm-button')) top.append(fields);
    }
    return top;
  }

  /** The element under a point of a page sheet (a small probe around the point helps with thin lines): { key, node } or null. An element with its own
   * identifier (`data-sel`) beats one that only names its staff or measure (`data-ref`), and the lines of the staff itself come last. */
  function elementAt(e, sheet) {
    let best = null;
    let rest = null; // the nearest rest under the point: the transparent frame of a cell (zone, container) covers the nested music, but a rest inside it can be switched off for this part
    [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [6, 0], [-6, 0], [0, 6], [0, -6]].forEach(([dx, dy], probe) => {
      for (const n of document.elementsFromPoint(e.clientX + dx, e.clientY + dy)) {
        if (!sheet.contains(n)) continue;
        const node = n.closest?.('[data-sel],[data-ref]');
        if (!node) continue;
        const sel = node.getAttribute('data-sel');
        const rank = (sel ? 0 : node.getAttribute('data-role') === 'staff-line' ? 2 : 1) * 100 + probe;
        if (!best || rank < best.rank) best = { rank, key: sel ?? node.getAttribute('data-ref'), node };
        if (!sel && (!rest || probe < rest.probe) && app.doc.find(node.getAttribute('data-ref'))?.type === 'rest') rest = { probe, key: node.getAttribute('data-ref'), node };
      }
    });
    if (best?.node.getAttribute('data-role') === 'container-frame' && rest) return { rank: 0, key: rest.key, node: rest.node };
    return best;
  }

  /** 'elements' mode: a tap picks the text or the element under it (shift adds); a second tap on a text opens its editor. */
  /** The key of the object a tap would pick (a text of the page, a container, a clef…), or null: the music, the staff lines and the bar lines choose the measure instead. */
  function pickableAt(e, sheet) {
    const chrome = e.target.closest?.('[data-chrome]');
    if (chrome) return chrome.getAttribute('data-chrome');
    const hit = elementAt(e, sheet);
    if (!hit?.key) return null;
    if (hit.node.getAttribute('data-role') === 'staff-line') return null;
    if (hit.key.startsWith('decor|') && hit.key.split('|')[2] === 'barline') return null;
    const obj = app.doc.find(hit.key);
    const inFragment = obj?.type === 'rest' && !app.doc.work.movements.includes(app.doc.movementOf(obj)); // a rest of a nested score (container, zone): picked like the container
    if (obj && (MUSIC_TYPES.has(obj.type) || obj.type === 'staff') && !inFragment) return null;
    return hit.key;
  }

  function onPageClick(e, sheet) {
    // the page outside the measure zones (under a system: the zones, the margins) also picks the object under the tap
    if (mode !== 'elements' && !e.target.closest?.('.ps-zone') && pickableAt(e, sheet)) mode = 'elements';
    if (mode !== 'elements') { if (selected && !e.target.closest?.('.ps-zone')) { selected = null; rangeTo = null; staffLevel = false; selectedStaff = null; draw(); } return; }
    if (e.timeStamp - lastDragEnd < 400) return;
    const chrome = e.target.closest?.('[data-chrome]');
    let key = null; let node = null;
    if (chrome) { key = chrome.getAttribute('data-chrome'); node = chrome; } else { const hit = elementAt(e, sheet); key = hit?.key ?? null; node = hit?.node ?? null; }
    if (!key) { if (!e.shiftKey) picked.clear(); modal.close(); draw(); return; }
    const now = e.timeStamp; // when the tap happened, not when it was handled: a slow redraw between two taps does not break a double tap
    const part0 = activePart();
    const cellText = (part0.containers ?? []).some((c) => c.id === key && c.props.containerPlacement === 'zone' && (c.props.containerKind ?? 'text') === 'text');
    const partText = partStaffTextsOf(part0).some((t) => t.id === key); // a free staff text of this part: a double tap opens the text editor (size, font, style, colour)
    const textual = key.startsWith('chrome|') || key.startsWith('mnum|') || cellText || partText;
    if (textual && lastTap.id === key && now - lastTap.time < 500) {
      anchorId = key; lastTap = { id: null, time: 0 };
      picked.clear(); picked.add(key); draw();
      modal.open(partText ? `stext:${key}` : cellText ? `cell:${key}` : key.startsWith('chrome|') ? key.slice(7) : 'measureNumber');
      return;
    }
    lastTap = { id: key, time: now };
    if (!e.shiftKey && picked.size === 1 && picked.has(key)) return; // nothing changes: no redraw, so the second tap of a double tap lands on the same text
    if (e.shiftKey) { if (picked.has(key)) picked.delete(key); else picked.add(key); } else { picked.clear(); picked.add(key); }
    draw();
  }

  /** The handle under a picked zone cell: drag it down or up to change the height of the whole zone. */
  function mountZoneHandle(part) {
    if (mode !== 'elements' || picked.size !== 1) return;
    const cell = app.doc.find([...picked][0]);
    if (!cell || !(part.containers ?? []).includes(cell) || cell.props.containerPlacement !== 'zone') return;
    const zone = app.zones(part.id).find((z) => z.measureId === cell.props.measureId && z.row === (cell.props.containerZoneRow ?? 0));
    if (!zone) return;
    const nodes = zone.cells.flatMap((c) => [...host.querySelectorAll(`rect[data-sel="${esc(c.id)}"][data-role="container-frame"]`)]);
    const page = nodes[0]?.closest('.ps-page');
    if (!page) return;
    const pr = page.getBoundingClientRect();
    let x1 = Infinity; let x2 = -Infinity; let y1 = Infinity; let y2 = -Infinity;
    for (const n of nodes) { const r = n.getBoundingClientRect(); x1 = Math.min(x1, r.left); x2 = Math.max(x2, r.right); y1 = Math.min(y1, r.top); y2 = Math.max(y2, r.bottom); }
    const sheet = page.querySelector('.ps-sheet'); const spPerPx = Number(page.dataset.layoutWidth) / sheet.getBoundingClientRect().width;
    const ghost = el('div', { class: 'ps-ghost', style: `left:${x1 - pr.left}px;top:${y1 - pr.top}px;width:${x2 - x1}px;height:${y2 - y1}px;display:none` });
    const handle = el('div', { class: 'ps-handle ps-zone-handle', 'data-zone-handle': '', 'aria-label': label('parts.zoneHeightHandle'), style: `left:${(x1 + x2) / 2 - pr.left}px;top:${y2 - pr.top}px` }, '⇕');
    page.append(ghost, handle);
    let start = null;
    handle.addEventListener('pointerdown', (e) => { start = e.clientY; handle.setPointerCapture?.(e.pointerId); ghost.style.display = 'block'; e.stopPropagation(); e.preventDefault(); });
    handle.addEventListener('pointermove', (e) => { if (start === null) return; const dy = Math.max(-(y2 - y1), e.clientY - start); ghost.style.height = `${y2 - y1 + dy}px`; handle.style.transform = `translateY(${dy}px)`; });
    handle.addEventListener('pointerup', (e) => {
      if (start === null) return;
      const dy = e.clientY - start; start = null; lastDragEnd = e.timeStamp; ghost.style.display = 'none'; handle.style.transform = '';
      if (Math.abs(dy) < 2) return;
      const actual = (y2 - y1) * spPerPx; // what the zone really takes (its content can exceed the height asked for)
      run(() => app.setZoneHeight(part.id, zone.measureId, Math.max(0, Math.round((actual + dy * spPerPx) * 4) / 4), zone.row));
    });
    handle.addEventListener('pointercancel', () => { start = null; ghost.style.display = 'none'; handle.style.transform = ''; });
  }

  /** The handle under the picked element: drag it to move the element (a dashed ghost shows where it lands; the move is one transaction on release). */
  function mountHandle(part) {
    if (mode !== 'elements' || picked.size !== 1) return;
    const id = [...picked][0];
    const music = MUSIC_TYPES.has(app.doc.find(id)?.type);
    if (music && !musicUnlocked) return;
    const nodes = [...host.querySelectorAll(`[data-sel="${esc(id)}"], [data-ref="${esc(id)}"], [data-chrome="${esc(id)}"]`)];
    const page = nodes[0]?.closest('.ps-page');
    if (!page) return;
    const here = nodes.filter((n) => n.closest('.ps-page') === page);
    const pr = page.getBoundingClientRect();
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    for (const n of here) { const r = n.getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); }
    if (!Number.isFinite(x1)) return;
    const ghost = el('div', { class: 'ps-ghost', style: `left:${x1 - pr.left}px;top:${y1 - pr.top}px;width:${x2 - x1}px;height:${y2 - y1}px;display:none` });
    const below = y2 - pr.top + 30 < pr.height;
    const handle = el('div', { class: 'ps-handle', 'data-handle': '', 'aria-label': label('parts.moveHandle'), style: `left:${(x1 + x2) / 2 - pr.left}px;top:${below ? y2 - pr.top + 22 : y1 - pr.top - 22}px` }, '✥');
    page.append(ghost, handle);
    const sheet = page.querySelector('.ps-sheet');
    const layoutWidth = Number(page.dataset.layoutWidth); const widthMm = Number(page.dataset.widthMm); const spaceMm = Number(page.dataset.spaceMm);
    const toSp = id.startsWith('chrome|') ? (px) => (px * widthMm / pr.width) / spaceMm : (px) => px * layoutWidth / sheet.getBoundingClientRect().width;
    let start = null;
    handle.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; handle.setPointerCapture?.(e.pointerId); ghost.style.display = 'block'; e.stopPropagation(); e.preventDefault(); });
    handle.addEventListener('pointermove', (e) => { if (!start) return; const dx = e.clientX - start.x; const dy = e.clientY - start.y; ghost.style.transform = `translate(${dx}px,${dy}px)`; handle.style.transform = `translate(${dx}px,${dy}px)`; });
    const end = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y; start = null;
      lastDragEnd = e.timeStamp;
      ghost.style.display = 'none';
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { handle.style.transform = ''; return; }
      const cur = partOverrideOf(part, id)?.offset ?? [0, 0];
      const round = (v) => Math.round(v * 20) / 20;
      run(() => app.setElementOverride(part.id, [id], { offset: [round(cur[0] + toSp(dx)), round(cur[1] + toSp(dy))] }, { music: musicUnlocked }));
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => { start = null; ghost.style.display = 'none'; handle.style.transform = ''; });
  }

  function pages(part) {
    const tLayout = performance.now();
    // choosing a measure or an element redraws the screen without touching the document: the layout of the same document is not computed again
    const today = new Date().toISOString().slice(0, 10);
    const name = partName(part, app.parts().indexOf(part));
    const memoKey = `${userStyleEpoch()}|${layoutCache.revision()}|${part.id}|${name}|${today}|${revealHidden()}`;
    if (layoutMemo?.key !== memoKey) layoutMemo = { key: memoKey, result: layoutPart(app.doc.work, part, glyphs, { partName: name, today, cache: layoutCache, keepHiddenContainers: revealHidden(), lang: app.lang }) };
    const result = lastResult = layoutMemo.result;
    host.dataset.layoutMs = String(Math.round(performance.now() - tLayout)); // diagnostic: the layout of the part, without the page nodes
    const g = result.geometry;
    const box = el('div', { class: 'ps-pages', 'data-pages': '', 'data-mode': mode });
    if (!result.pages.length) { box.append(el('div', { class: 'ps-info' }, label('parts.empty'))); return box; }
    const px = g.spaceMm * 96 / 25.4; // staff space in CSS px at 96 dpi: only the proportions matter, the svg is scaled to the width of the page
    const pctW = (mm) => `${(mm / g.widthMm) * 100}%`;
    const pctH = (mm) => `${(mm / g.heightMm) * 100}%`; // margins are placed with absolute offsets: a percentage PADDING would be relative to the parent's width, not the page's
    const breaks = new Map(partBreaks(part).map((b) => [b.measureId, b.breakKind]));
    const lockOf = (id) => lockContaining(app.doc, part, id);
    // A page is only WRITTEN (its svg, one zone per measure, its texts) when it is near what is on the screen: with fifty pages the markup of all of them is
    // megabytes of nodes the browser must parse and lay out at every drawing. The others are empty frames of the right size.
    // Dragging over the measures chooses a range: the mouse drags after 5 px, a finger after a short hold (a move before that scrolls the page as usual).
    const beginPress = (e, id, staffId) => {
      if (mode !== 'measures' || e.button > 0) return;
      const start = { x: e.clientX, y: e.clientY }; let timer = null; let on = false;
      const touch = e.pointerType !== 'mouse';
      const target = e.currentTarget; // the touch events of a gesture keep going to the element it started on, even once the page was redrawn: the blocker lives there
      const blockTouch = (ev) => { if (on) ev.preventDefault(); };
      // the pointer is captured by a stable element only once the drag has begun (a capture from the start would send the click of a plain tap to it)
      const enter = () => { try { host.setPointerCapture?.(e.pointerId); } catch { /* not capturable: the window listeners still work */ } on = true; extending = false; selected = id; selectedStaff = staffId; staffLevel = true; rangeTo = null; };
      const move = (ev) => {
        if (!on) {
          if (touch || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) { if (touch && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) end(); return; }
          enter();
        }
        const z = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.ps-zone');
        const target = z?.dataset.measure;
        if (target && target !== (rangeTo ?? selected)) { const before = rangeTo; rangeTo = target === selected ? null : target; if (!rangeOf() && rangeTo) rangeTo = before; draw(); }
      };
      const end = () => {
        clearTimeout(timer);
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true); target.removeEventListener('touchmove', blockTouch);
        if (on) { dragSuppress = true; setTimeout(() => { dragSuppress = false; }, 50); draw(); }
      };
      if (touch) timer = setTimeout(() => { enter(); draw(); }, 350);
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
      target.addEventListener('touchmove', blockTouch, { passive: false });
    };
    // the measures where an advised page turn starts, for the staves this part shows
    const hintIds = new Set(partStaffIds(app.doc.work, part).flatMap((id) => { const st = app.doc.find(id); return st ? pageHintsOf(st).map((h) => h.measureId) : []; }));
    const fill = (p, page) => {
      const sheet = el('div', { class: 'ps-sheet', style: `left:${pctW(g.margins.left)};right:${pctW(g.margins.right)};top:${pctH(g.margins.top)};bottom:${pctH(g.margins.bottom)}` });
      sheet.innerHTML = uniqueSvgIds(renderSvgString(p.layout, glyphs, { staffSpace: px, margin: 0, ink: 'var(--ink, #000)', paper: 'var(--score, #fff)', showHidden: revealHidden(), showResizeHandles: true }));
      const svg = sheet.querySelector('svg');
      if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; }
      // one tappable zone per measure of every system: from the previous bar to its own bar, over the height of the system
      const W = p.layout.width; const H = p.layout.height;
      for (const sys of p.layout.systems) {
        // a small mark at the left of every staff whose room above is not the standard one (screen only, never printed)
        const sysMeasures = sys.measures.map((m) => m.ref); const gapsProp = part.props[PID.PART_STAFF_GAPS];
        sys.staves.forEach((st, i) => {
          if (!i) return;
          const g = effectiveStaffGap(gapsProp, st.ref, sysMeasures);
          if (!g) return;
          let h = 0; for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
          const top = sys.top + st.originY - (h || 4);
          sheet.append(el('div', { class: 'ps-gapmark', 'data-gap-mark': st.ref, title: label('parts.staffGapAbove'), style: `left:0;top:${(top / H) * 100}%` }, `↕ ${g > 0 ? '+' : ''}${g}`));
        });
        // an advised page turn (set for a track of this part, model/pagehints.js) starts at this measure: a dashed orange line with a small arrow, on screen only
        sys.measures.forEach((m, k) => {
          if (!hintIds.has(m.ref)) return;
          const x = k === 0 ? sys.x0 : sys.x0 + sys.measures[k - 1].barX;
          sheet.append(el('div', { class: 'ps-hintmark', 'data-hint-mark': m.ref, title: label('parts.hintMark'), style: `left:${(x / W) * 100}%;top:${(sys.top / H) * 100}%;height:${(sys.height / H) * 100}%` }));
        });
        sys.measures.forEach((m, k) => {
          const left = k === 0 ? sys.x0 : sys.x0 + sys.measures[k - 1].barX;
          const right = sys.x0 + m.barX;
          const zone = el('button', { type: 'button', class: 'ps-zone', 'data-measure': m.ref, 'data-selected': String(inSelection(m.ref)), 'data-locked': String(Boolean(lockOf(m.ref))), 'aria-label': label('parts.measureN', { n: m.index + 1 }),
            style: `left:${(left / W) * 100}%;width:${((right - left) / W) * 100}%;top:${(sys.top / H) * 100}%;height:${(sys.height / H) * 100}%`,
            onclick: (e) => {
              // the zones lie over the whole system, hiding what is under them: a tap on a container hung on a staff (its handle, frame, text or nested staff) picks THAT container
              e.stopPropagation();
              const hung = containerAt(e, sheet, part);
              if (hung) { e.stopPropagation(); mode = 'elements'; picked.clear(); picked.add(hung); selected = null; staffLevel = false; selectedStaff = null; draw(); return; }
              // one mode: an object under the tap (a container, a text, a clef, a mark…) is picked; the music itself, the staff lines and the void choose the measure
              if (!dragSuppress && pickableAt(e, sheet)) { mode = 'elements'; onPageClick(e, sheet); return; }
              if (picked.size) { picked.clear(); mode = 'measures'; }
              // a tap chooses the measure OF THE STAFF touched (floating bar to hang a container on it; the breaks and fixed systems in the bar above act on this
              // measure for the whole system); the same staff again: nothing chosen
              if (dragSuppress) { dragSuppress = false; return; }
              const st = staffNear(sys, sheet, e.clientY, H);
              if (extending && selected && selected !== m.ref) { extending = false; rangeTo = m.ref; if (!rangeOf()) rangeTo = null; draw(); return; }
              extending = false; rangeTo = null;
              if (selected === m.ref && st === selectedStaff) { selected = null; staffLevel = false; selectedStaff = null; }
              else { selected = m.ref; staffLevel = true; selectedStaff = st; }
              draw();
            },
            onpointerdown: (e) => beginPress(e, m.ref, staffNear(sys, sheet, e.clientY, H)),
            oncontextmenu: (e) => e.preventDefault() });
          sheet.append(zone);
          if (staffLevel && inSelection(m.ref) && selectedStaff) {
            const st = sys.staves.find((q) => q.ref === selectedStaff);
            if (st) { // the band of that staff over this measure (a little room above and below for what hangs on it)
              let h = 0; for (const it of st.items) if (it.role === 'staff-line') h = Math.max(h, it.y1);
              if (!h) h = 4;
              const bottom = sys.top + st.originY + 1.5; const top = sys.top + st.originY - h - 1.5;
              sheet.append(el('div', { class: 'ps-staffsel', 'data-staff-selection': st.ref, style: `left:${(left / W) * 100}%;width:${((right - left) / W) * 100}%;top:${(top / H) * 100}%;height:${((bottom - top) / H) * 100}%` }));
            }
          }
          const kind = breaks.get(m.ref);
          if (kind && k === sys.measures.length - 1) {
            let timer = null;
            const chip = el('div', { class: 'ps-brk', 'data-break': kind, title: `${label(kind === 'page' ? 'parts.breakPage' : 'parts.breakSystem')} — ${label('parts.breakRemove')}`,
              onpointerdown: (e) => { e.stopPropagation(); timer = setTimeout(() => { timer = null; run(() => app.toggleBreak(part.id, m.ref, kind)); }, 600); },
              onpointerup: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer), onpointercancel: () => clearTimeout(timer),
              onclick: (e) => e.stopPropagation(), oncontextmenu: (e) => e.preventDefault(),
              style: `left:${((right / W) * 100)}%;top:${((sys.top + sys.height) / H) * 100}%` }, kind === 'page' ? '⤓ page' : '↵');
            sheet.append(chip);
          }
        });
      }
      const decor = el('div', { class: 'ps-chrome' }); decor.innerHTML = renderPageChrome(p.chrome ?? [], g, { ink: 'var(--ink, #000)', showHidden: revealHidden(), pick: true });
      page.append(sheet, decor); // the texts sit above the music so that they can be picked
      page.dataset.filled = 'true';
    };
    const frames = [];
    for (const p of result.pages) {
      const page = el('div', { class: 'ps-page', 'data-page': String(p.number), 'data-layout-width': String(p.layout.width), 'data-width-mm': String(g.widthMm), 'data-space-mm': String(g.spaceMm), style: `max-width:${g.widthMm * 96 / 25.4}px;aspect-ratio:${g.widthMm}/${g.heightMm}` });
      page.addEventListener('click', (e) => { const sheet = page.querySelector('.ps-sheet'); if (sheet) onPageClick(e, sheet); });
      frames.push({ p, page });
      box.append(page, el('div', { class: 'ps-page-no' }, label('parts.pageOf', { n: p.number, total: result.pages.length })));
    }
    // which pages are near the screen: written synchronously after the drawing, then kept up to date while the page scrolls
    box.syncPages = () => {
      const h = window.innerHeight || 800;
      for (const f of frames) {
        const r = f.page.getBoundingClientRect();
        if (!r.width) continue; // the screen is hidden: nothing to measure yet (the next drawing, when it is shown, writes the pages)
        const near = r.bottom > -1.5 * h && r.top < 2.5 * h;
        const far = r.bottom < -4 * h || r.top > 5 * h;
        if (near && !f.page.dataset.filled) fill(f.p, f.page);
        else if (far && f.page.dataset.filled) { f.page.replaceChildren(); delete f.page.dataset.filled; }
      }
    };
    return box;
  }

  // ---------- the playback cursor on the pages (a thin line at the position being played; screen only) ----------
  let playWhere = null; let playSystemKey = null;
  function placePlayCursor(follow = false) {
    host.querySelectorAll('.ps-playcursor').forEach((n) => n.remove());
    if (!playWhere || !lastResult) { playSystemKey = null; return; }
    const mv = app.doc.work.movements[playWhere.movement ?? 0];
    const masterbar = mv?.masterbars[playWhere.measure];
    if (!masterbar) return;
    const nominal = fAdd(playWhere.position ?? [0, 1], measureOffsetOf(masterbar, playWhere.measure === 0));
    for (const p of lastResult.pages) {
      if (p.movementIndex !== (playWhere.movement ?? 0)) continue;
      for (const sys of p.layout.systems) {
        const m = sys.measures.find((x) => x.index === playWhere.measure);
        if (!m || !sys.staves.length) continue;
        const sheet = host.querySelector(`.ps-page[data-page="${p.number}"] .ps-sheet`);
        if (!sheet) return; // the page is not written (far from the screen): the line appears when it is
        const xs = sys.xAt ? sys.xAt(playWhere.measure, nominal) : null;
        const x = sys.x0 + (Number.isFinite(xs) ? xs : m.x ?? 0);
        const W = p.layout.width; const H = p.layout.height;
        const y1 = sys.top + sys.staves[0].originY - 5; const y2 = sys.top + sys.staves[sys.staves.length - 1].originY + 1;
        const line = el('div', { class: 'ps-playcursor', style: `left:${(x / W) * 100}%;top:${(y1 / H) * 100}%;height:${((y2 - y1) / H) * 100}%` });
        sheet.append(line);
        const key = `${p.number}|${sys.index}`;
        if (follow && key !== playSystemKey) { // a new system: keep it in view (the page turns by itself, like the score of screen 1)
          const r = line.getBoundingClientRect(); const vh = window.innerHeight || 0;
          if (vh && (r.top < vh * 0.1 || r.bottom > vh * 0.85)) window.scrollBy({ top: r.top - vh * 0.3, behavior: 'smooth' });
        }
        playSystemKey = key;
        return;
      }
    }
  }

  let lastDocked = null;
  function draw() {
    const tDraw = performance.now();
    const sideScrolls = docked() ? sidebarScrolls() : null; // read before anything is rebuilt: the sidebar keeps its scroll through a redraw
    // a measure chosen on a page puts the playback there (as on screen 1): Play then starts from it
    if (selected !== lastPicked) {
      lastPicked = selected;
      const bar = selected && app.doc.find(selected); const mvPick = bar && app.doc.movementOf(bar);
      if (mvPick) onMeasurePick(app.doc.work.movements.indexOf(mvPick), mvPick.masterbars.indexOf(bar));
    }
    preview.refresh();
    mode = picked.size ? 'elements' : 'measures'; // one mode: what is picked decides what the bar offers
    if (picked.size) { selected = null; rangeTo = null; extending = false; staffLevel = false; selectedStaff = null; }
    sidebar?.setHeader?.('two', docked() ? mediumRow() : null);
    const parts = shownParts();
    if (medium === 'tablet' && !parts.length) { // the Tablette tab before the first canvas
      host.replaceChildren(el('div', { class: 'ps-root', 'data-parts-screen': '' }, el('div', { class: 'ps-body' }, el('div', { class: 'ps-col' }, docked() ? null : el('div', { class: 'ps-top' }, el('div', { class: 'ps-bar' }, mediumRow())), emptyTablet()))));
      onStatus('');
      return;
    }
    rememberTabletScroll(host, tabletState);
    const part = activePart();
    activeId = part.id;
    // highlight of the picked elements (one rule, ids escaped): a halo around every item that carries the identifier
    const rules = [...picked].map((id) => `.ps-sheet [data-sel="${window.CSS.escape(id)}"], .ps-sheet [data-ref="${window.CSS.escape(id)}"] { filter: drop-shadow(0 0 2px var(--sel-edge,#2878ff)) drop-shadow(0 0 1px var(--sel-edge,#2878ff)); }`).join('\n');
    const scrollX = window.scrollX; const scrollY = window.scrollY; // rebuilding the screen must not move what the user is looking at (two taps of a double tap land on the same place)
    const pagesBox = pages(part);
    const dockedNow = docked();
    lastDocked = dockedNow;
    host.replaceChildren(el('style', {}, rules), el('div', { class: 'ps-root', 'data-parts-screen': '' }, el('div', { class: 'ps-body' }, dockedNow ? null : propertiesColumn(part, parts), el('div', { class: 'ps-col' }, topBar(part, parts), pagesBox))));
    if (dockedNow) { fillSidebar(part, parts); restoreScrolls(sideScrolls); }
    onStatus(statusText(lastResult?.pages?.length ?? 0));
    window.scrollTo(scrollX, scrollY);
    virtualOff?.(); virtualOff = null;
    if (pagesBox.syncPages) {
      pagesBox.syncPages();
      let queued = false;
      // (the timer is for a window that is not painted: its animation frames do not come)
      const onScroll = () => { if (queued) return; queued = true; const run = () => { if (!queued) return; queued = false; pagesBox.syncPages(); }; requestAnimationFrame(run); setTimeout(run, 120); };
      window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll);
      virtualOff = () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
    }
    mountHandle(part);
    mountZoneHandle(part);
    mountContainerBar(part);
    mountZoneBar(part);
    mountPickBar(part);
    modal.refresh();
    placePlayCursor();
    host.dataset.drawMs = String(Math.round(performance.now() - tDraw)); // diagnostic: layout + the nodes of the pages near the screen
  }

  // a long press must never open the browser's menu (it is how locks and breaks are taken away); text fields keep theirs
  host.addEventListener('contextmenu', (e) => { if (!e.target.closest?.('input, textarea, [contenteditable="true"]')) e.preventDefault(); });
  const unsubscribe = app.doc.subscribe(() => { if (host.isConnected && host.style.display !== 'none') draw(); });
  // the window crosses the computer / tablet limit: the properties move between the sidebar and the column (a tab change or a fold needs no redraw)
  const offSide = sidebar?.onChange?.(() => { if (host.isConnected && host.style.display !== 'none' && docked() !== lastDocked) draw(); });
  const offContainerPlay = app.onContainerPlay(() => { if (host.isConnected && host.style.display !== 'none' && picked.size) draw(); }); // the play / stop icon of a picked container
  draw();
  return { refresh: draw, setPlayCursor(where, { follow = false } = {}) { playWhere = where; placePlayCursor(follow); }, toggleTracks() { if (docked()) { if (sidebar.isTabShown(sideTabId('tracks'))) sidebar.setFolded(true); else sidebar.show(sideTabId('tracks')); return; } if (partTracks.isOpen()) partTracks.close(); else partTracks.open(activePart().id); }, destroy() { partTracks.destroy(); offSide?.(); if (sidebar) for (const g of GROUPS) sidebar.removeTab(sideTabId(g)); onStatus(''); unmountContainerBar(); unsubscribe?.(); offContainerPlay?.(); virtualOff?.(); layoutCache.dispose(); modal.close(); host.replaceChildren(); } };
}
