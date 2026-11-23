/*
 * Seul fichier de la vue/UI qui touche au DOM : montage du SVG de la vue, conversion pointeur → pixels du SVG, surbrillance de la
 * sélection (surcouche SÉPARÉE du SVG du moteur : le rendu du moteur n'est jamais modifié).
 * Geste (tranche 2) : clic = sélection ; Ctrl/⌘ + clic = bascule ; clic dans le vide = désélection (au relâchement, comme MuseScore).
 */
import { mountBlocksEditor } from './blocks-dom.js';
import { mountAutomationLayer } from './automation-dom.js';
import { markIcon, commonSide, glyphRowIcon, drawnById } from './mark-icons.js';
import { isPhone } from './device-class.js';
import { getProperty } from '../model/props.js';
import { mountMeasureFocus } from './measure-focus.js';
import { applyTextIcon, applyIconName, icon } from './icons.js';
import { createScrubPill } from './scrub-pill.js';
import { createChoiceMenu } from './choice-menu.js';
import { similarIds } from '../model/similar.js';
import { openDuplicateDialog } from './duplicate-dialog.js';
import { markLongPress, markShortLongPress, markTwoActions, bindShortLong, markCyclic, markDrawerLevel } from './button-behavior.js';
import { MARK_CATEGORIES, allKeys, categoryOf } from './marks-pages.js';
import { barButtons, packPages } from './bar-capacity.js';
import { barIcon } from './barline-icons.js';
import { openVoltaSettings } from './volta-modal.js';
import { sysLevel, cueKeys } from './sys-pages.js';
import { mountStaffTextEditor } from './stafftext-dom.js';
import { mountInlineText } from './inline-text.js';
const MEASURE_ICON = { 'measure-loop-from': 'loop-start', 'measure-loop-to': 'loop-end', 'measure-play-from': 'play' };
import { ARTICULATION_CHOICES, COMMON_DYNAMICS, ALL_DYNAMICS, GUITAR_ARTICULATIONS, TECH_LINE_CHOICES, CHORD_PROP_CHOICES, NOTE_FLAG_CHOICES } from './marks-intents.js';
import { TOLERANCE } from '../view/score-view.js';
import { GRADUAL_CHOICES, FERMATA_CHOICES, SWING_CHOICES, TEMPO_WORD_CHOICES } from '../model/systemedit.js';
import { GRADUAL_TYPES } from '../model/tempo.js';
import { TEMPO_UNITS } from '../model/systemedit.js';
import { JUMP_TYPES, MARKER_TYPES } from '../model/repeats.js';
import { TECHNIQUES } from '../model/techniques.js';
import { leslieStaffProblem } from './leslie-intents.js';
import { isLeslieSign } from '../model/stafftextedit.js';
import { SECTION_CATEGORIES, SECTION_LETTERS, SECTION_PALETTE, defaultSectionColor } from '../model/sections.js';
import { boundsOfShapes, placeFloating, visibleArea } from './float-place.js';
import { computeScroll, computeRecenter, computePageTurn } from './follow-scroll.js';
import { NoteEntryError, EditError } from './noteentry-intents.js';
import { createSeqState, seqAdvance, seqBack, seqTie, seqTap, seqSetFret, seqClear, seqToggleRest, seqReset, seqPlayed } from './seqentry-intents.js';
import { DIAGRAM_COLORS } from '../layout/fretdiagram.js';
import { inputOptionsOf } from './input-options.js';
import { maxFretOf } from '../model/instruments.js';
import { nestedStaves } from '../model/containerstaves.js';
import { SHEET_QUERY, panelMode } from './panel-mode.js';
import { glyphIcon, DURATIONS, DURATION_CYCLE } from './noteentry-dom.js';
import { entryKeyAction, selectionKeyAction, arrowPressOutcome } from './noteentry-keys.js';
import { buildFilterSheet } from './filter-dom.js';
import { rangeContents } from '../model/rangecontents.js';
import { ledgerLines, previewShape } from '../view/entry-preview.js';
import { orderBarItems } from './bar-order.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { excludedCount } from '../model/selectionfilter.js';
import { openInsertMeasuresDialog } from './measure-insert-dialog.js';
import { openTransposeDialog } from './transpose-dialog.js';
import { openPatternFromNotesDialog } from './pattern-from-notes-dialog.js';
import { openTimeSigDialog } from './time-sig-dialog.js';
import { openGlissandoRunDialog } from './glissando-run-dialog.js';
import { openKeySigDialog } from './key-sig-dialog.js';
import { isTextEditingTarget } from './undoredo.js';
import { clefTapAt, zoneAt } from './clef-tap.js';
import { mountLyrics } from './lyrics-dom.js';
import { mountSectionsStrip } from './sections-strip.js';
import { mountSectionCardEdit } from './section-card-edit.js';
import { mountStickyHeader } from './sticky-header.js';
import { mountTrackControls } from './track-controls.js';
import { parseDecorId } from '../model/decor.js';
import { PID } from '../model/pid.js';
import { fCmp } from '../model/fraction.js';
import { renderSvgString, uniqueSvgIds } from '../render/svg.js';
import { perf, perfCss } from '../perf/probe.js';
import { describeGhost, ghostLayoutItems, ghostLayout, restIntervals, GHOST_INK } from './entry-ghost.js';
import { rangeFromMeasures, rangeFromItem, unionRanges, extendRangeToAllStaves, rangeMeasureSpan, rangeIsWholeMeasures, flatStaves } from '../model/range.js';

const NS = 'http://www.w3.org/2000/svg';

/** @returns {{ refresh(), destroy() }} */
export function mountScoreView(host, view, { scroller = null, app, player = null, label = (k) => k, entryMessage = () => {}, glyphs = null, onPercmap = null, onStaffProps = null, onBendGraph = null, onFragmentEdit = null, onDiagramEdit = null, onLyricEventEdit = null, onRecord = null, onImportHere = null } = {}) {
  host.style.position = 'relative';
  // pas de menu / loupe / sélection de texte du navigateur sur un appui long (tablette) : rien à copier dans la partition
  host.style.webkitTouchCallout = 'none'; host.style.userSelect = 'none'; host.style.webkitUserSelect = 'none';
  let measureFocus = null; // the « measure entry » mode (assigned below, once the page parts it needs exist)
  let opening = false; // a long score whose real layout is still being computed (see the end of this function)
  const afterOpening = []; // what was asked meanwhile and needs the layout: done once it is ready
  const whenReady = (fn) => { if (opening) afterOpening.push(fn); else fn(); };
  const holder = document.createElement('div');
  // rendering experiments for the performance probe (`?perf&perfcss=contain,willchange,speed`): compare series with and without, on the real machine
  // `will-change: transform` (the page keeps the score on its own layer, so scrolling moves a picture instead of painting it again) is ON by default on a screen with a
  // mouse (measured on a 128-measure file: 2.6 % of slow frames while scrolling, 6.5 % without it); not on a touch screen, whose graphics memory is not measured yet.
  // `?perf&perfcss=nowillchange` turns it off to compare.
  const exp = perf.on ? perfCss() : [];
  const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (exp.includes('willchange') || (!touch && !exp.includes('nowillchange'))) holder.style.willChange = 'transform';
  if (perf.on) {
    if (exp.includes('contain')) holder.style.contain = 'layout paint style';
    if (exp.includes('speed')) { const st = document.createElement('style'); st.textContent = '[data-perf-speed] svg{shape-rendering:optimizeSpeed}'; document.head.append(st); holder.setAttribute('data-perf-speed', ''); }
  }
  const overlay = document.createElementNS(NS, 'svg');
  overlay.setAttribute('data-selection-overlay', '');
  overlay.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  // surcouche des éléments non joués (tranche 4) : calque SVG séparé, activable, grisé + hachures
  const muted = document.createElementNS(NS, 'svg');
  muted.setAttribute('data-muted-overlay', '');
  muted.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  let showMuted = true;
  // barre contextuelle : visible quand la sélection n'est pas vide (tablette : pas de clic droit)
  const bar = document.createElement('div');
  bar.setAttribute('data-context-bar', '');
  if (!document.getElementById('bar-family-style')) {
    const st = document.createElement('style'); st.id = 'bar-family-style';
    st.textContent = '[data-context-bar] [data-bar-family-start]{margin-left:10px;position:relative}[data-context-bar] [data-bar-family-start]::before{content:"";position:absolute;left:-6px;top:18%;bottom:18%;width:1px;background:var(--edge,#888);opacity:.8;pointer-events:none}';
    document.head.append(st);
  }
  bar.setAttribute('data-zoom-lock-inline', ''); // keeps its screen size under pinch zoom (zoom-lock.js)
  bar.setAttribute('data-dismiss-keep', ''); // the bar's buttons act on what is open (filter sheet, chord entry window…)
  // Barre FLOTTANTE : en position absolue dans le conteneur de la partition (aucune hauteur réservée : le SVG ne bouge jamais) ; sa position est
  // calculée par `float-place.js` (au-dessus de l'ancre, centrée ; en dessous s'il n'y a pas la place).
  bar.style.cssText = 'display:none;position:absolute;left:0;top:0;z-index:6;gap:var(--btn-gap,2px);flex-wrap:wrap;width:max-content;max-width:100%;padding:4px 6px;font:14px var(--ui-font,sans-serif);background:var(--bar,rgba(255,255,255,0.95));border:1px solid rgba(0,0,0,0.2);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.25);box-sizing:border-box';
  const stage = document.createElement('div');
  stage.style.position = 'relative';
  stage.setAttribute('data-score-stage', ''); // the anchored editor of a nested score is drawn inside it
  // cases de saisie des symboles d'accord (tranche 6) : calque SVG séparé (contours des cases, case active en évidence)
  const cellsLayer = document.createElementNS(NS, 'svg');
  cellsLayer.setAttribute('data-cells-overlay', '');
  cellsLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  let showCells = true;
  let filterOpen = false; // feuille du filtre de sélection (état d'interface, jamais dans le Document)
  let filterSheet = null;
  let keepAt = null; // where the ▭ / « grow » button was pressed ({ left, top, until }): for a moment, the bar puts its « grow » button back under the finger
  const markKeep = (el) => { const r = el?.getBoundingClientRect(); keepAt = r ? { left: r.left, top: r.top, until: performance.now() + 600 } : null; };
  let growBtnEl = null;
  let filterCellRange = null; // the range of the measure of the active chord cell, for the filter sheet when no range is chosen
  let docRevision = 0; // counts the changes of the document (the contents of the selection are recomputed after one)
  let capoOpen = false; // the capo drawer (opened from the guitar marks page): interface state, never in the Document
  let marksPage = null; // marks menu: null = closed, { cat: null } = the menu of the five categories, { cat, page } = a page of buttons (the bar cuts a category into pages by its real width) (interface state, never in the Document)
  let selPage = 0; // page of the selection bar (when the buttons do not all fit)
  let voltaPage = 0; // page of the volta bar (when the buttons do not all fit)
  let barPage = null; // measure bar drawer (barline type, repeats, volta): { page } or null (interface state)
  let marksFor = ''; // what the marks pages were opened for (they close when the selection changes)
  let containerWhere = 'above'; // where a new container goes: over the measures of the target, or between measures (before the first / after the last)
  let slotEveryStaff = false; // containers between measures: one on every staff instead of one on the staff of the gesture (interface state)
  let insertCount = 2; // measures inserted by the « … » page of the insert menu (interface state)
  let rangePage = null; // menu of the measure / range bar: { menu, page } or null
  let keepRetouch = false; // set while a retouch edit runs: the selection changes (new chord ids) but the drawer stays open
  let retouchOpen = false; // the pitch / length retouch drawer of the selection bar (interface state)
  let sysPage = null; // system objects drawer: { path, page } or null (interface state, never in the Document)
  let staffTextUI = null; // staff text written in place (created below)
  let inlineUI = null; // one-line text fields written in place (created below)
  let staffTextPlacement = 'above'; let staffTextStyle = 'normal'; // options of the next staff text (interface state)
  let chordViewShift = -2; // semitones of the next « shift » display tag created from the drawer
  let systemBpm = 120; // value of the next metronome mark created from the drawer
  let bendSemitones = 2; // size of the next bend / dive created from the drawer (interface state)
  let autoLevel = null; let autoFade = 'beat'; // state of the automation gesture on a range (interface state)
  let drawerTarget = null;
  // curseur de lecture (lecteur) : barre fine dans un calque séparé, jamais dans le SVG du moteur
  const cursorLayer = document.createElementNS(NS, 'svg');
  cursorLayer.setAttribute('data-play-cursor-layer', '');
  cursorLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  const cursorLine = document.createElementNS(NS, 'line');
  cursorLine.setAttribute('data-play-cursor', '');
  cursorLine.setAttribute('stroke', 'rgb(220,40,40)'); cursorLine.setAttribute('stroke-width', '2'); cursorLine.setAttribute('stroke-linecap', 'round');
  cursorLine.style.display = 'none';
  cursorLayer.append(cursorLine);
  let cursorSystem = -1;
  // boucle A–B et mesure choisie : calque SVG séparé (bande teintée, repères A et B, mesure choisie), sous le curseur
  const loopLayer = document.createElementNS(NS, 'svg');
  loopLayer.setAttribute('data-loop-layer', '');
  loopLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  // plage (portées × temps) : bande teintée + poignées glissables (calque SVG séparé ; seules les poignées reçoivent le pointeur)
  const rangeLayer = document.createElementNS(NS, 'svg');
  rangeLayer.setAttribute('data-range-layer', '');
  rangeLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  // déplacement manuel : poignée posée sous (ou au-dessus de) l'élément sélectionné, dans un calque séparé (seule la poignée reçoit le pointeur)
  // editor of the automation strips under the tracks (layer above the score; the toolbar is placed with the visible zone, see `stageVisible` below)
  let stageVisibleRef = () => ({ left: 0, right: 1e6, top: 0, bottom: 1e6 });
  const autoUI = app?.automationTracks ? mountAutomationLayer({ app, view, stage, svg: () => holder.querySelector('svg'), stageVisible: () => stageVisibleRef(), label, glyphs, message: (m) => entryMessage(m) })
    : { layer: document.createElementNS(NS, 'svg'), bar: document.createElement('div'), draw() {}, place() {}, destroy() {} };
  const gripLayer = document.createElementNS(NS, 'svg');
  gripLayer.setAttribute('data-grip-layer', '');
  gripLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;touch-action:none';
  const moveLayer = document.createElementNS(NS, 'svg');
  moveLayer.setAttribute('data-move-layer', '');
  moveLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;touch-action:none';
  // aperçu du point de saisie (souris) : calque séparé, un petit repère à l'endroit où la note serait posée
  const previewLayer = document.createElementNS(NS, 'svg');
  previewLayer.setAttribute('data-entry-preview-layer', '');
  previewLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  const previewDot = document.createElementNS(NS, 'circle');
  previewDot.setAttribute('data-entry-preview', ''); previewDot.setAttribute('r', '6');
  previewDot.setAttribute('fill', 'rgba(40,120,255,0.35)'); previewDot.setAttribute('stroke', 'rgb(40,120,255)'); previewDot.setAttribute('stroke-width', '1.5');
  previewDot.style.display = 'none';
  previewLayer.append(previewDot);
  // on a notation staff the mark is the chosen NOTE itself (head, dots, stem, flag) with the ledger lines it needs (view/entry-preview.js); elsewhere the dot above
  // touch devices: no pointer to follow, so the ledger lines a tap can aim at (a few above and below the staff being entered) are drawn in dotted blue instead
  const entryGuides = document.createElementNS(NS, 'g');
  entryGuides.setAttribute('data-entry-guides', ''); entryGuides.style.display = 'none';
  previewLayer.append(entryGuides);
  const previewShapeLayer = document.createElementNS(NS, 'g');
  previewShapeLayer.setAttribute('data-entry-preview-shape', ''); previewShapeLayer.style.display = 'none';
  previewLayer.append(previewShapeLayer);
  // ghost notes of a deferred refresh (burst of keyboard entry): heads, stems and beams drawn on the stale layout, in a layer of their own
  const ghostLayer = document.createElementNS(NS, 'svg');
  ghostLayer.setAttribute('data-entry-ghost-layer', '');
  ghostLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  // repère PERSISTANT de la saisie en tablature (position choisie, tant que la barre flottante est ouverte)
  const pendingDot = document.createElementNS(NS, 'circle');
  pendingDot.setAttribute('data-entry-pending', ''); pendingDot.setAttribute('r', '8');
  pendingDot.setAttribute('fill', 'rgba(255,160,0,0.30)'); pendingDot.setAttribute('stroke', 'rgb(230,140,0)'); pendingDot.setAttribute('stroke-width', '2');
  pendingDot.style.display = 'none';
  previewLayer.append(pendingDot);
  // barre FLOTTANTE de saisie en tablature : durées + frettes 0–12 ; position absolue dans `stage`, jamais dans le flux (le SVG ne bouge pas)
  const tabBar = document.createElement('div');
  tabBar.setAttribute('data-tab-entry-bar', ''); tabBar.setAttribute('role', 'toolbar'); tabBar.setAttribute('data-dismiss-keep', ''); tabBar.setAttribute('data-zoom-lock-inline', '');
  tabBar.style.cssText = 'display:none;position:absolute;left:0;top:0;z-index:8;flex-direction:column;flex-wrap:nowrap;gap:var(--btn-gap,2px);width:max-content;max-width:100%;padding:6px;font:15px var(--ui-font,sans-serif);background:var(--bar,rgba(255,255,255,0.97));border:1px solid rgba(0,0,0,0.25);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.3);box-sizing:border-box;color:var(--ink,#000)';
  const tabBarCss = tabBar.style.cssText;
  // the SEQUENTIAL entry pad of a tablature (durations, strings, frets, place / advance): its own box, because the document changes that follow every note must not close it
  const seqBar = document.createElement('div');
  seqBar.setAttribute('data-seq-entry-bar', ''); seqBar.setAttribute('role', 'toolbar'); seqBar.setAttribute('data-dismiss-keep', ''); seqBar.setAttribute('data-zoom-lock-inline', '');
  seqBar.style.cssText = `${tabBarCss};z-index:7;background:var(--paper,#fff)`;
  let pendingHit = null;
  let lyricsUI = null; // saisie des paroles (créée plus bas, une fois `stageVisible` défini)
  // curseur de saisie au clavier : barre bleue verticale dans un calque séparé (jamais dans le SVG du moteur : rien ne bouge)
  const entryCursorLayer = document.createElementNS(NS, 'svg');
  entryCursorLayer.setAttribute('data-entry-cursor-layer', '');
  entryCursorLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  const entryCursorRect = document.createElementNS(NS, 'rect');
  entryCursorRect.setAttribute('data-entry-cursor', '');
  entryCursorRect.setAttribute('fill', 'rgba(40,120,255,0.85)'); entryCursorRect.setAttribute('rx', '1.5');
  entryCursorRect.style.display = 'none';
  entryCursorLayer.append(entryCursorRect);
  // current string of the keyboard entry on a tablature (a dot on the string, at the cursor)
  const entryStringDot = document.createElementNS(NS, 'circle');
  entryStringDot.setAttribute('data-entry-string', '');
  entryStringDot.setAttribute('fill', 'rgba(255,140,0,0.95)');
  entryStringDot.style.display = 'none';
  entryCursorLayer.append(entryStringDot);
  // Mouvement SANS aucune mesure (MuseScore l'autorise) : rien à toucher, un bouton propose d'en ajouter
  const emptyBtn = document.createElement('button');
  emptyBtn.type = 'button'; emptyBtn.setAttribute('data-action', 'measure-add-first');
  emptyBtn.textContent = '➕'; emptyBtn.title = label('measure.insert'); emptyBtn.setAttribute('aria-label', label('measure.insert'));
  emptyBtn.style.cssText = 'display:none !important;position:absolute;left:8px;top:8px;z-index:6;min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);font:16px var(--ui-font,sans-serif)';
  emptyBtn.addEventListener('click', () => { try { app.insertMeasures({ movement: view.movementIndex(), movementElement: view.movement(), count: 1 }); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } });
  stage.append(holder, loopLayer, rangeLayer, autoUI.layer, autoUI.bar, overlay, muted, cellsLayer, previewLayer, ghostLayer, entryCursorLayer, cursorLayer, moveLayer, gripLayer, bar, tabBar, seqBar, emptyBtn);
  // (la feuille du filtre est ajoutée à `stage` à l'ouverture)
  host.replaceChildren(stage);
  // the stage is its own stacking context: the coloured bands (z-index −1) are the very back, ABOVE nothing else — selection, handles and bars stay in front
  stage.style.isolation = 'isolate';
  muted.style.top = '0';
  // name cards of the sections (sticky along the strip) and the sticky header of the scrolling view; `scroller` = the element that scrolls sideways
  const stickyHeader = mountStickyHeader({ stage, scroller: scroller ?? host, view });
  // mute / solo / volume at the start of each track (the main view only: a fragment editor has no mixer of its own)
  const blocksEditor = app && view.id === 'main' ? mountBlocksEditor({ stage, view, app, label }) : null; // the boxes of the band of blocks (only while they are edited)
  const trackControls = app && view.id === 'main' ? mountTrackControls({ stage, scroller: scroller ?? host, view, app, label }) : null;
  const cardEdit = app && view.id === 'main' ? mountSectionCardEdit({ stage, view, app, label, describeError: (e) => describeEntryError(e) ?? String(e?.message ?? e) }) : null; // select / move / remove a card that sits at its place
  const strip = mountSectionsStrip({ stage, scroller: scroller ?? host, view, inset: () => stickyHeader.width(), onUnder: (t) => stickyHeader.setTint(t), onCards: (cards) => cardEdit?.cards(cards) });
  // the stage is as wide as the score: the sticky header is positioned inside it and must not run out of its box when the score is wider than the page

  // one long system (the scrolling view): only what is near the visible part is in the DOM; it is renewed when the scroll leaves that part
  const sideScroller = () => scroller ?? host;
  let virtualRange = null; // [x1, x2] in SVG pixels of the rendered window, or null when the whole SVG is in the page
  const WINDOW_MIN = 1500; // px kept on each side of the visible part
  // scroll position and size of the scroller, kept up to date by events: reading `scrollLeft` / `clientWidth` right after the page changed forces a
  // full browser layout (measured: ≈ 35 ms on a large score), and the window of the SVG has a margin of at least 1500 px, so a slightly old value does no harm
  const sideSize = { left: sideScroller().scrollLeft || 0, width: Math.max(sideScroller().clientWidth || 0, window.innerWidth || 0) };
  const syncSideSize = () => { const sc = sideScroller(); sideSize.left = sc.scrollLeft || 0; sideSize.width = Math.max(sc.clientWidth || 0, window.innerWidth || 0); };
  // right after an edit only a NARROW window is drawn (the part in view and a small margin): what the browser must parse, lay out and paint grows with the number of
  // elements, and that is half of the time of an edit on a large score (measured, docs/mesure-performance.md). The full window comes back once the hands are off
  // (`scheduleWiden`), and at once when the person scrolls (the scroll handlers draw the full window).
  const WIDEN_DELAY = 250; // ms of quiet before the full window is drawn again
  // The widening, and the renewal of the window while the person scrolls, ADD the elements of the missing side strips to the page (`ScoreView.renderWindowExtra`)
  // instead of replacing every element: what is in the page stays. The page may hold more than one window's worth; past one and a half times that, the window is redrawn whole.
  // `domWindow` remembers which window is in the page (`stamp` changes with every replacement of the SVG).
  let holderStamp = 0;
  let domWindow = null; // { range: [x1, x2], epoch, stamp } or null
  const renderHolder = (narrow = false) => {
    const vis = sideSize.width;
    const pad = narrow ? Math.max(300, Math.round(vis * 0.25)) : Math.max(WINDOW_MIN, vis);
    const a = Math.max(0, sideSize.left - pad); const b = sideSize.left + vis + pad;
    const endSvg = perf.begin('render:svg');
    const win = view.renderWindow ? view.renderWindow(a, b) : null;
    virtualRange = win ? [a, b] : null;
    // the wrapped view of a long score: only the systems near the visible part of the page are in the DOM (the SVG keeps its full size)
    let rows = null;
    virtualRows = null;
    if (!win && view.renderRows && typeof window !== 'undefined') {
      const vh = window.innerHeight || 800;
      const top = holder.getBoundingClientRect().top + (window.scrollY || 0);
      const padY = narrow ? Math.max(400, vh * 0.5) : Math.max(1200, vh * 1.5);
      const y1 = (window.scrollY || 0) - top - padY; const y2 = (window.scrollY || 0) + vh - top + padY;
      rows = view.renderRows(y1, y2);
      if (rows) virtualRows = [y1, y2, top];
    }
    const shown = win ?? rows ?? view.render();
    const windowNow = win ? { range: [a, b], epoch: win.epoch } : null;
    endSvg();
    const markup = perf.span('render:ids', () => uniqueSvgIds(shown.svg));
    if (perf.on) { perf.add('render:size', markup.length / 1024, 'KB'); perf.add('render:elements', (markup.match(/</g)?.length ?? 0) / 2, 'el'); }
    perf.span('render:innerHTML', () => { holder.innerHTML = markup; });
    holderStamp++;
    domWindow = windowNow ? { ...windowNow, stamp: holderStamp } : null;
    perf.span('render:signs', applySigns);
  };
  /** Brings the window in the page to the one the scroll position asks for by appending the missing elements; false when it cannot (the caller redraws the whole window). */
  const extendWindow = () => {
    const dw = domWindow;
    if (!dw || dw.stamp !== holderStamp || !view.renderWindowExtra || typeof document === 'undefined') return false;
    const vis = sideSize.width; const pad = Math.max(WINDOW_MIN, vis);
    const [a, b] = dw.range;
    const A = Math.min(a, Math.max(0, sideSize.left - pad)); const B = Math.max(b, sideSize.left + vis + pad);
    if (A === a && B === b) return true; // nothing is missing
    if (B - A > 1.5 * (vis + 2 * pad)) return false; // the page has grown enough (or the person jumped far): start again from a fresh window
    const svg = holder.querySelector('svg');
    const extra = svg ? perf.span('render:extra', () => view.renderWindowExtra([a, b], [A, B], dw.epoch)) : null;
    if (!extra || extra.svg.includes('<defs>')) return false; // (gradients need the page-unique ids of a whole drawing)
    const part = document.createElement('div');
    perf.span('render:extraParse', () => { part.innerHTML = extra.svg; });
    const groups = [...part.querySelectorAll('g[data-staff]')];
    const staves = [...svg.querySelectorAll('g[data-staff]')];
    const targets = groups.map((g) => staves.find((t) => t.getAttribute('data-staff') === g.getAttribute('data-staff')));
    if (targets.some((t) => !t)) return false;
    groups.forEach((g, i) => targets[i].append(...g.childNodes));
    if (extra.svg.includes('data-syssign')) applySigns();
    dw.range = [A, B];
    virtualRange = [A, B];
    return true;
  };
  // system signs follow the window: above the first complete staff in view (view only, see ScoreView.signTargets)
  let signsBusy = false;
  function applySigns() {
    if (typeof window === 'undefined' || !view.signTargets) return;
    const svg = holder.querySelector('svg');
    if (!svg) return;
    const top = svg.getBoundingClientRect().top;
    const targets = view.signTargets(Math.max(0, 4 - top));
    const dys = new Map(targets.map((t) => [String(t.system), t.dy]));
    for (const g of holder.querySelectorAll('g[data-syssign]')) {
      const dy = dys.get(g.getAttribute('data-sys'));
      if (dy) g.setAttribute('transform', `translate(0,${dy.toFixed(2)})`); else g.removeAttribute('transform');
    }
  }
  const onSignScroll = () => {
    if (signsBusy) return;
    signsBusy = true;
    requestAnimationFrame(() => { signsBusy = false; applySigns(); });
  };
  if (typeof window !== 'undefined') window.addEventListener('scroll', onSignScroll, { passive: true });
  let virtualRows = null; // [y1, y2, top] of the rendered rows in SVG pixels (and the SVG's top in the page), or null when the whole SVG is in the page
  let rowsBusy = false;
  const onPageScroll = () => {
    if (!virtualRows || rowsBusy || moveMode) return;
    const vh = window.innerHeight || 800;
    const y = (window.scrollY || 0) - virtualRows[2]; // top of the visible part in SVG pixels
    const slack = vh * 0.5;
    if (y > virtualRows[0] + slack && y + vh < virtualRows[1] - slack) return;
    rowsBusy = true;
    requestAnimationFrame(() => { rowsBusy = false; renderHolder(); const svg = holder.querySelector('svg'); if (svg) lyricsUI?.draw(svg); });
  };
  if (typeof window !== 'undefined') window.addEventListener('scroll', onPageScroll, { passive: true });
  let virtualBusy = false;
  const onSideScroll = () => {
    syncSideSize();
    if (!virtualRange || virtualBusy || moveMode) return;
    const left = sideSize.left; const right = left + sideSize.width;
    const slack = WINDOW_MIN / 3;
    const needLeft = virtualRange[0] > 0 && left < virtualRange[0] + slack;
    const needRight = right > virtualRange[1] - slack;
    if (!needLeft && !needRight) return;
    virtualBusy = true;
    requestAnimationFrame(() => { virtualBusy = false; perf.span('render:scroll', () => { if (!extendWindow()) renderHolder(); }); const svg = holder.querySelector('svg'); if (svg) lyricsUI?.draw(svg); });
  };
  sideScroller().addEventListener('scroll', onSideScroll, { passive: true });
  window.addEventListener('resize', () => { syncSideSize(); if (virtualRange) onSideScroll(); });
  let widenTimer = null;
  const scheduleWiden = () => {
    if (widenTimer !== null) { clearTimeout(widenTimer); widenTimer = null; }
    if (!virtualRange && !virtualRows) return; // the whole SVG is in the page: nothing to widen
    const widen = () => {
      widenTimer = null;
      if (!host.isConnected || view.isFrozen()) return;
      if (moveMode) { widenTimer = setTimeout(widen, WIDEN_DELAY); return; } // never swap the SVG under a move in progress
      perf.span('render:widen', () => { if (!extendWindow()) renderHolder(); const svg = holder.querySelector('svg'); if (svg) lyricsUI?.draw(svg); });
    };
    widenTimer = setTimeout(widen, WIDEN_DELAY);
  };
  const refresh = (narrow = false) => {
    if (view.isFrozen()) return;
    const tRefresh = perf.on ? performance.now() : 0;
    const endRefresh = perf.begin('refresh:total');
    renderHolder(narrow);
    host.dispatchEvent(new CustomEvent('scorsaire:layout', { bubbles: true, detail: { ms: view.layoutMs?.() ?? 0 } }));
    const svg = holder.querySelector('svg');
    stage.style.width = svg ? `${svg.getAttribute('width')}px` : '';
    perf.span('refresh:chrome', () => { stickyHeader.refresh(svg); trackControls?.refresh(); blocksEditor?.refresh(); strip.refresh(); });
    if (svg) { overlay.setAttribute('width', svg.getAttribute('width')); overlay.setAttribute('height', svg.getAttribute('height')); overlay.setAttribute('viewBox', svg.getAttribute('viewBox')); }
    for (const o of [overlay, muted, cellsLayer, cursorLayer, loopLayer, rangeLayer, previewLayer, ghostLayer, entryCursorLayer, moveLayer, gripLayer]) if (svg) { o.setAttribute('width', svg.getAttribute('width')); o.setAttribute('height', svg.getAttribute('height')); o.setAttribute('viewBox', svg.getAttribute('viewBox')); }
    const endOverlays = perf.begin('refresh:overlays');
    drawSelection();
    drawMoveHandle();
    drawGripHandles();
    drawMuted();
    drawCells();
    drawLoop();
    drawRange();
    drawEntryCursor();
    lyricsUI?.draw(svg);
    autoUI.draw();
    endOverlays();
    endRefresh();
    if (narrow) scheduleWiden(); else if (widenTimer !== null) { clearTimeout(widenTimer); widenTimer = null; }
    measureFocus?.realign();
    perf.afterPaint('refresh:to-paint', tRefresh); // JS done → the browser has parsed, styled, laid out and painted the new SVG
  };
  /**
   * Touch devices (no hover): while notes are entered on a NOTATION staff, the ledger lines a tap can reach are drawn dotted, in the blue of the pointer mark, along
   * the system of the entry cursor: two above and two below on a tablet, one on a phone (the staves are close there). Nothing on a computer (it has the mark that follows
   * the pointer), on a tablature or a percussion staff, or outside note entry.
   */
  const drawEntryGuides = (st, r) => {
    entryGuides.style.display = 'none';
    try {
      if (!r || !st?.active || typeof matchMedia === 'undefined' || !matchMedia('(hover: none), (pointer: coarse)').matches) return;
      const ss = view.staffSpace();
      if (!(ss > 0) || app.entryStaffTypeAtCursor() !== 'score') return;
      const zone = view.staffZones('score').find((z) => z.staffId === st.cursor.staffId && z.systemIndex === r.systemIndex);
      if (!zone) return;
      const count = isPhone() ? 1 : 2;
      const top = r.y1 + 0.5 * ss; const bottom = r.y2 - 0.5 * ss; // the first and the last line of the staff
      const lines = [];
      for (let k = 1; k <= count; k += 1) for (const y of [top - k * ss, bottom + k * ss]) {
        const n = document.createElementNS(NS, 'line');
        for (const [a, v] of Object.entries({ x1: zone.x1, x2: zone.x2, y1: y, y2: y, stroke: 'rgba(40,120,255,0.6)', 'stroke-width': 0.12 * ss, 'stroke-dasharray': `${0.2 * ss} ${0.45 * ss}`, 'stroke-linecap': 'round', 'data-guide': k })) n.setAttribute(a, String(v));
        lines.push(n);
      }
      entryGuides.replaceChildren(...lines);
      entryGuides.style.display = '';
    } catch { entryGuides.style.display = 'none'; }
  };
  /** Curseur de saisie (position d'un instant dans une voix d'une portée) : dessin seul (le suivi de l'affichage est `followEntry`). */
  const drawEntryCursor = () => {
    const st = app?.noteEntry?.();
    const r = st?.active && st.cursor ? view.entryCursorRect(st.cursor) : null;
    drawEntryGuides(st, r);
    if (!r) { entryCursorRect.style.display = 'none'; return; }
    entryCursorRect.setAttribute('x', r.x); entryCursorRect.setAttribute('y', r.y1);
    entryCursorRect.setAttribute('width', r.w); entryCursorRect.setAttribute('height', r.y2 - r.y1);
    entryCursorRect.style.display = '';
    // string marker: only on a tablature staff, with the keyboard entry option on
    const showString = st.tabString && r.stringY !== undefined && (inputOptionsOf(app.preferences).tabKeyboard || st.sequential) && app.entryStaffTypeAtCursor() === 'tab';
    if (showString) {
      const y = r.stringY(st.tabString);
      entryStringDot.setAttribute('cx', r.x + r.w / 2); entryStringDot.setAttribute('cy', y); entryStringDot.setAttribute('r', Math.max(3, r.w * 1.6));
      entryStringDot.style.display = '';
    } else entryStringDot.style.display = 'none';
  };
  // ---------- suivi de l'affichage pendant la saisie (comme MuseScore : `showItem` + `adjustCanvasPosition`, calcul pur : `follow-scroll.js`) ----------
  // Zone de la fenêtre, en pixels CSS de la fenêtre : celle du `visualViewport` (sans le clavier virtuel d'un téléphone) quand il existe.
  const windowViewport = (useVisual) => {
    const vv = useVisual ? window.visualViewport : null;
    return vv ? { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height }
      : { left: 0, top: 0, right: window.innerWidth || 0, bottom: window.innerHeight || 0 };
  };
  /** Barre de transport collante : elle recouvre le haut de la fenêtre dès que la page défile (collée à `top`), même si elle est encore dans le flux
   *  (page non défilée) ; c'est cette position COLLÉE qui compte, puisque le suivi sert à défiler. */
  // the transport lives in the bottom dock now: nothing sticky covers the top of the window
  const transportBar = () => null;
  /** Barre de saisie FIXE en bas (en mode « dans la page » elle ne recouvre rien). */
  const fixedBottomBar = () => {
    const el = document.querySelector('[data-dock]');
    return el && getComputedStyle(el).position === 'fixed' && el.style.display !== 'none' ? { ...el.getBoundingClientRect().toJSON(), edge: 'bottom' } : null;
  };
  /** La page défile pour garder la mesure en cours visible, seulement si elle n'y est plus entièrement ; jamais de centrage. */
  // `lastSystem` : système du curseur au dernier suivi (null = inconnu : rien ne recentre) ; `editedSinceFollow` : une transaction a eu lieu depuis
  let lastSystem = null;
  let editedSinceFollow = false;
  const followEntry = () => {
    if (view.isFrozen()) return; // deferred refresh: redrawn at the flush
    if (typeof window === 'undefined' || !app?.noteEntry) return;
    const st = app.noteEntry();
    if (!st.active || !st.cursor) { lastSystem = null; editedSinceFollow = false; return; }
    const svg = holder.querySelector('svg');
    if (!svg) return;
    const item = view.entryCursorRect(st.cursor);
    if (!item) return;
    const b = svg.getBoundingClientRect();
    const k = svg.viewBox.baseVal.width / b.width; // pixels du SVG par pixel CSS
    if (!Number.isFinite(k) || !(k > 0)) return;
    const toWindow = (x1, y1, x2, y2) => ({ left: b.left + x1 / k, top: b.top + y1 / k, right: b.left + x2 / k, bottom: b.top + y2 / k });
    const visibleZone = visibleArea(windowViewport(true), [transportBar(), fixedBottomBar()].filter(Boolean));
    const system = item.systemIndex;
    // retour à la ligne AUTOMATIQUE : une transaction (note posée, annuler / refaire) a fait passer le curseur à un autre système → recentrage
    // d'un seul coup (quart gauche, milieu en hauteur) ; les flèches et un simple tap sur un autre système ne recentrent jamais
    const wrapped = editedSinceFollow && lastSystem !== null && system !== lastSystem;
    editedSinceFollow = false; lastSystem = system ?? null;
    // Retour à la ligne : on demande au NAVIGATEUR d'amener le trait bleu du curseur au centre de la zone visible. `scrollIntoView` déplace aussi
    // la zone visible d'un écran zoomé au pincement (là où `scrollBy` ne bouge que la page, sans marge horizontale) ; « à peu près » suffit.
    if (wrapped && typeof entryCursorRect.scrollIntoView === 'function') {
      drawEntryCursor();
      entryCursorRect.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      placeBar(); placeTabBar();
      return;
    }
    const d = wrapped ? computeRecenter({ item: toWindow(item.x, item.y1, item.x + item.w, item.y2), visible: visibleZone }) : computeScroll({
      // la mesure entière n'est PAS exigée visible (elle ferait défiler la page alors que la note en cours se voit déjà) : on ne défile que
      // si le curseur lui-même sort de la zone visible, et du minimum nécessaire
      measure: null,
      straddle: 'minimal',
      item: toWindow(item.x, item.y1, item.x + item.w, item.y2),
      visible: visibleZone,
      spatium: view.staffSpace() / k,
    });
    if (!d) return;
    window.scrollBy({ left: d.dx, top: d.dy, behavior: 'instant' });
    // les barres flottantes suivent la partition : repositionnées tout de suite (l'évènement `scroll` n'arrive qu'à l'image suivante)
    placeBar(); placeTabBar();
  };
  // Après CHAQUE transaction de saisie (pose, T, suppression, annuler / refaire, souris, doigt, tablature, accordéon) et après une touche du
  // clavier : une seule vérification, une fois le geste terminé (le curseur de saisie a alors sa valeur finale). Un défilement manuel n'est
  // jamais contrarié : rien ne se déclenche au défilement, au redimensionnement ni au changement d'un réglage de saisie.
  let followQueued = false;
  const scheduleFollow = () => {
    if (followQueued) return;
    followQueued = true;
    queueMicrotask(() => { followQueued = false; followEntry(); });
  };
  /** Bande de la boucle (pleine si la boucle est active, contour seul sinon), repères A et B, mesure choisie. */
  let pendingMark = null; // index of the measure that holds a lone marker A
  const drawLoop = () => {
    const els = [];
    const rect = (b, attrs) => {
      const el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', b.x1); el.setAttribute('y', b.y1); el.setAttribute('width', Math.max(b.x2 - b.x1, 1)); el.setAttribute('height', b.y2 - b.y1);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    const mark = (text, x, y, anchor, b) => {
      const el = document.createElementNS(NS, 'text');
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('text-anchor', anchor);
      el.setAttribute('font-family', 'sans-serif'); el.setAttribute('font-size', '13'); el.setAttribute('font-weight', 'bold');
      el.setAttribute('fill', 'rgb(40,120,255)'); el.setAttribute('data-loop-mark', text);
      el.textContent = text;
      return el;
    };
    const st = player?.state();
    if (st?.loop && st.loop.movement === view.movementIndex()) {
      const on = st.loopOn;
      for (const b of view.loopBands(st.loop)) {
        els.push(rect(b, on
          ? { fill: 'rgba(40,120,255,0.10)', 'data-loop-band': 'on' }
          : { fill: 'none', stroke: 'rgba(40,120,255,0.6)', 'stroke-dasharray': '5 4', 'stroke-width': '1.5', 'data-loop-band': 'off' }));
        if (b.start) els.push(mark('A', b.x1 + 3, b.y1 + 2, 'start', b));
        if (b.end) els.push(mark('B', b.x2 - 3, b.y1 + 2, 'end', b));
      }
    }
    if (pendingMark != null) { // marker A put alone (screen 4): its letter and an edge bar at the start of the measure
      const z = view.measureZones().find((x) => x.index === pendingMark);
      if (z) { els.push(rect({ x1: z.x1, x2: z.x1 + 2, y1: z.y1, y2: z.y2 }, { fill: 'rgb(40,120,255)', 'data-loop-pending': 'a' })); els.push(mark('A', z.x1 + 4, z.y1 + 2, 'start', z)); }
    }
    const chosen = view.chosenMeasure();
    if (chosen) {
      const z = view.measureZones().find((x) => x.measureId === chosen);
      if (z) els.push(rect(z, { fill: 'rgba(255,160,0,0.14)', stroke: 'rgb(230,140,0)', 'stroke-width': '2', 'data-chosen-measure': chosen }));
    }
    loopLayer.replaceChildren(...els);
  };
  // portée touchée en dernier dans une mesure vide (la mesure choisie n'a pas de portée : les poignées s'y posent)
  let chosenStaff = null;
  const movementOfView = () => view.movement();
  /** Poignées d'une mesure choisie : une plage d'UNE mesure sur la portée touchée, calculée sans rien poser. */
  const chosenRange = () => {
    const chosen = view.chosenMeasure();
    if (!app || !chosen || !chosenStaff) return null;
    const mv = movementOfView();
    const index = view.measureIndexOf(chosen);
    return index < 0 ? null : rangeFromMeasures(app.doc, mv, [chosenStaff], index, index);
  };
  /** Copie une plage (presse-papiers interne + système) et l'annonce ; appelé dans le geste de l'utilisateur. */
  const copyToClipboard = (range) => {
    try {
      const r = app.copyRange(range, view.range() ? {} : { filter: null }); // le filtre ne vaut que pour une plage, pas pour la mesure choisie
      // fin en cours de mesure : « 4 mesures + 1 temps » plutôt que le nombre de mesures touchées
      const key = r.partial && r.extraBeats != null ? (r.whole > 0 ? 'range.copiedPartial' : 'range.copiedBeats') : 'range.copied';
      entryMessage(label(key, { measures: r.measures, whole: r.whole, beats: r.extraBeats, staves: r.staves }));
    } catch (e) {
      entryMessage(describeEntryError(e) ?? String(e?.message ?? e));
    }
  };
  /** Coupe une plage : copie puis vide (annulable) ; annonce comme la copie. */
  const cutToClipboard = (range) => {
    try {
      const r = app.cutRange(range, view.id, view.range() ? {} : { filter: null });
      entryMessage(label('range.cutDone', { measures: r.measures, staves: r.staves }));
    } catch (e) {
      entryMessage(describeEntryError(e) ?? String(e?.message ?? e));
    }
  };
  /** Destination du collage : début de la plage, sinon mesure choisie (portée touchée), sinon premier élément sélectionné. */
  const pasteTarget = () => {
    const r = view.range() ?? chosenRange();
    if (r) return { staffId: r.staffIds[0], measureId: r.from.measureId, position: r.from.position };
    const first = view.selection()[0];
    const fr = first ? rangeFromItem(app.doc, movementOfView(), first) : null;
    return fr ? { staffId: fr.staffIds[0], measureId: fr.from.measureId, position: fr.from.position } : null;
  };
  // duplicate: one press = one copy, a long press asks how many; right after a duplication the bar offers « duplicate again » (until the selection changes), to go on copying measure after measure
  let dupQuick = null; // null | 'pending' (a duplication is being made) | the selection key (marksFor) it was made for
  const selectionNow = () => ({ range: view.range(), target: view.targetMeasureId(), staff: chosenStaff }); // (the window of « several copies » is outside the score: a tap there may clear the selection, so it is kept when the window opens)
  const duplicateSelection = (count = 1, sel = selectionNow()) => {
    dupQuick = 'pending';
    try {
      if (sel.range) app.duplicateRange(sel.range, view.id, count); else if (sel.target && sel.staff) app.duplicateMeasure(sel.target, sel.staff, view.id, count); else throw new Error(label('range.pasteNoTarget'));
      entryMessage('');
    } catch (e) { dupQuick = null; entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); }
    if (dupQuick === 'pending') dupQuick = marksFor; // (the selection did not change: the button stays for this one)
    drawBar();
  };
  const askDuplicates = () => { const sel = selectionNow(); openDuplicateDialog({ label: (k, p) => label(k, p), onApply: (n) => duplicateSelection(n, sel) }); };
  const bindDuplicate = (b) => { bindShortLong(b, { onShort: () => duplicateSelection(1), onLong: askDuplicates }); markShortLongPress(b); return b; };
  const tryDo = (fn) => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } };
  const pasteHere = (payload) => {
    const target = pasteTarget();
    if (!target) { entryMessage(label('range.pasteNoTarget')); return; }
    try {
      const content = payload ?? app.clipboard();
      const r = app.paste(target, view.id, content);
      const hook = content?.hooktheory;
      const base = hook ? label('hooktheory.pasted', { n: hook.notes, key: `${hook.key.tonic} ${hook.key.scale}` }) : label('range.pasted');
      const extra = [];
      if (r.addedMeasures) extra.push(label('range.pastedAdded', { n: r.addedMeasures }));
      if (r.skipped?.length) extra.push(label('range.pastedSkipped', { n: r.skipped.length }));
      if (hook?.quantized) extra.push(label('hooktheory.quantized', { n: hook.quantized }));
      if (hook?.chords) extra.push(label('hooktheory.chordsIgnored'));
      entryMessage([base, ...extra].join(' — '));
    } catch (e) {
      entryMessage(describeEntryError(e) ?? String(e?.message ?? e));
    }
  };
  // « Paste from the system clipboard » (tablet: no Ctrl+V): reads the text the person copied (a Hookpad melody, or a range copied in another page)
  const pasteSystem = async () => {
    const target = pasteTarget();
    if (!target) { entryMessage(label('range.pasteNoTarget')); return; }
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { entryMessage(label('range.pasteSystemRefused')); return; }
    let payload = null;
    try { payload = app.parseClipboardText(text, target); } catch (e) { if (e?.hooktheory) { entryMessage(label(`hooktheory.${e.hooktheory}`)); return; } throw e; }
    if (!payload) { entryMessage(label('range.pasteSystemNone')); return; }
    pasteHere(payload);
  };
  const handleEl = (which, pt, k) => {
    const sp = view.staffSpace();
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-range-handle', which);
    g.style.cssText = `pointer-events:all;cursor:${which === 'top' || which === 'bottom' ? 'ns-resize' : 'ew-resize'};touch-action:none`;
    const hit = document.createElementNS(NS, 'circle'); // cible tactile ≥ 44 px CSS
    hit.setAttribute('cx', pt.x); hit.setAttribute('cy', pt.y); hit.setAttribute('r', String(36 * k)); hit.setAttribute('fill', 'transparent');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); dot.setAttribute('r', String(Math.max(sp * 0.7, 9 * k)));
    dot.style.fill = 'var(--range-edge, rgb(150,60,210))'; dot.setAttribute('stroke', 'white'); dot.setAttribute('stroke-width', String(1.5 * k));
    g.append(hit, dot);
    return g;
  };
  const drawRange = () => {
    const svg = holder.querySelector('svg');
    if (!svg || !app) { rangeLayer.replaceChildren(); return; }
    const b = svg.getBoundingClientRect();
    const k = b.width ? svg.viewBox.baseVal.width / b.width : 1;
    const real = view.range();
    const r = real ?? chosenRange();
    const els = [];
    if (r) {
      for (const band of view.rangeBands(r)) {
        if (real) {
          const rect = document.createElementNS(NS, 'rect');
          rect.setAttribute('x', band.x1); rect.setAttribute('y', band.y1); rect.setAttribute('width', Math.max(band.x2 - band.x1, 1)); rect.setAttribute('height', band.y2 - band.y1);
          rect.style.fill = 'var(--range-fill, rgba(150,60,210,0.14))'; rect.style.stroke = 'var(--range-edge, rgb(150,60,210))'; rect.setAttribute('stroke-width', '1.5'); // violet on the light theme, gold on the dark one
          rect.setAttribute('data-range-band', band.staffId);
          els.push(rect);
        }
        const mid = (band.y1 + band.y2) / 2;
        if (band.startHandle) els.push(handleEl('start', { x: band.x1, y: mid }, k));
        if (band.endHandle) els.push(handleEl('end', { x: band.x2, y: mid }, k));
        if (real && band.topHandle) els.push(handleEl('top', band.topHandle, k));
        if (real && band.bottomHandle) els.push(handleEl('bottom', band.bottomHandle, k));
      }
    }
    rangeLayer.replaceChildren(...els);
  };
  // glisser une poignée : la borne opposée reste fixe ; le point glissé s'accroche aux instants des portées de la plage
  let rangeDrag = null;
  // le navigateur ignore souvent `touch-action` sur un élément interne d'un SVG : il prendrait le doigt pour un défilement
  // et enverrait `pointercancel`. On bloque donc le défilement dès le toucher d'une poignée (écouteur non passif).
  rangeLayer.style.touchAction = 'none';
  rangeLayer.addEventListener('touchstart', (e) => { if (e.target.closest?.('[data-range-handle]') && e.cancelable) e.preventDefault(); }, { passive: false });
  rangeLayer.addEventListener('touchmove', (e) => { if (rangeDrag && e.cancelable) e.preventDefault(); }, { passive: false });
  rangeLayer.addEventListener('pointerdown', (e) => {
    const h = e.target.closest?.('[data-range-handle]');
    if (!h || !app) return;
    e.stopPropagation(); e.preventDefault();
    let r = view.range();
    if (!r) { r = chosenRange(); if (!r) return; view.setRange(r); r = view.range(); }
    const which = h.getAttribute('data-range-handle');
    const vertical = which === 'top' || which === 'bottom';
    const bands = vertical ? view.rangeBands(r) : [];
    const sysIndex = vertical ? bands.find((b) => (which === 'top' ? b.topHandle : b.bottomHandle))?.systemIndex : null;
    rangeDrag = { which, vertical, sysIndex, anchor: which === 'start' ? r.to : r.from, staffIds: r.staffIds, pointer: e.pointerId };
    try { rangeLayer.setPointerCapture(e.pointerId); } catch { /* pas de capture : le glissé suit quand même sur le calque */ }
  });
  rangeLayer.addEventListener('pointermove', (e) => {
    if (!rangeDrag || e.pointerId !== rangeDrag.pointer) return;
    const { x, y } = toSvg(e);
    if (rangeDrag.vertical) {
      // poignée haut / bas : la portée sous le pointeur (dans le système de la poignée) devient la nouvelle borne ; au moins une portée reste
      const id = view.staffAtY(y, rangeDrag.sysIndex);
      const cur = view.range();
      if (!id || !cur) return;
      const flat = flatStaves(view.movement());
      const idx = (sid) => flat.findIndex((s) => s.id === sid);
      const mine = cur.staffIds.map(idx).filter((i) => i >= 0);
      let lo = Math.min(...mine), hi = Math.max(...mine);
      const at = idx(id);
      if (at < 0) return;
      if (rangeDrag.which === 'top') lo = Math.min(at, hi); else hi = Math.max(at, lo);
      view.setRange({ ...cur, staffIds: flat.slice(lo, hi + 1).map((s) => s.id) });
      return;
    }
    const p = view.rangePointAt(x, y, rangeDrag.staffIds);
    if (!p) return;
    view.setRange({ staffIds: rangeDrag.staffIds, from: p, to: rangeDrag.anchor });
  });
  // le relâchement d'une poignée remonte jusqu'à l'hôte alors que la poignée a été redessinée (détachée) : on le reconnaît par ce drapeau
  let rangeDragEnded = false;
  const endRangeDrag = (e) => { if (rangeDrag && e.pointerId === rangeDrag.pointer) { rangeDrag = null; rangeDragEnded = true; try { rangeLayer.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ } drawRange(); drawBar(); } };
  rangeLayer.addEventListener('pointerup', endRangeDrag);
  rangeLayer.addEventListener('pointercancel', endRangeDrag);
  const drawCells = () => {
    const zones = view.cellZones();
    cellsLayer.replaceChildren(...zones.filter((z) => showCells || z.active).map((z) => {
      const el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', z.x1); el.setAttribute('y', z.y1);
      el.setAttribute('width', Math.max(z.x2 - z.x1, 1)); el.setAttribute('height', z.y2 - z.y1);
      el.setAttribute('data-cell', `${z.measureId}:${z.cell}`);
      if (z.active) { el.setAttribute('data-active', ''); el.setAttribute('fill', 'rgba(255,160,0,0.18)'); el.setAttribute('stroke', 'rgb(230,140,0)'); el.setAttribute('stroke-width', '2'); }
      else { el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'rgba(120,120,120,0.35)'); el.setAttribute('stroke-dasharray', '3 3'); el.setAttribute('stroke-width', '1'); }
      return el;
    }));
  };
  // Selection look: a soft halo that follows the real shape of the selected item (head, stem, accidental…) plus a light box.
  // `selectionStyle.classic` (settings) brings back the former plain blue box.
  const HALO = 'rgba(40,120,255,0.45)';
  const selectionMode = () => app?.preferences?.get('selectionStyle')?.mode ?? 'colored';
  const haloOf = (ref) => {
    const sel = `[data-ref="${CSS.escape(ref)}"],[data-sel="${CSS.escape(ref)}"]`;
    const out = [];
    for (const src of holder.querySelectorAll(sel)) {
      const c = src.cloneNode(true);
      // the item sits inside the staff / system groups of the engine SVG: carry the full transform up to the SVG root
      const root = src.ownerSVGElement; const m0 = root && src.getScreenCTM?.(); const m1 = root?.getScreenCTM?.();
      const m = m0 && m1 ? m1.inverse().multiply(m0) : null;
      c.removeAttribute('transform');
      for (const n of [c, ...c.querySelectorAll('*')]) {
        for (const a of ['data-ref', 'data-sel', 'data-role', 'data-glyph', 'id']) n.removeAttribute(a);
        if (n.tagName === 'g' || n.tagName === 'defs') continue;
        const w = Number(n.getAttribute('stroke-width')) || 0;
        const filled = n.getAttribute('fill') !== 'none' && n.tagName !== 'line' && n.tagName !== 'polyline';
        n.setAttribute('stroke', HALO); n.setAttribute('fill', filled ? HALO : 'none');
        n.setAttribute('stroke-linejoin', 'round'); n.setAttribute('stroke-linecap', 'round');
        n.setAttribute('stroke-width', String(c.tagName === 'g' ? 5 : w + 5));
        if (c.tagName === 'g') n.setAttribute('vector-effect', 'non-scaling-stroke');
        n.removeAttribute('stroke-dasharray');
      }
      if (m) { const w = document.createElementNS(NS, 'g'); w.style.mixBlendMode = 'multiply'; w.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`); w.append(c); out.push(w); } else { c.style.mixBlendMode = 'multiply'; out.push(c); }
    }
    return out;
  };
  // coloured look: the note and its parts (chord parts too when every note of the chord is selected, or the chord itself)
  const SELECT_INK = 'var(--select, #e8964a)'; const SELECT_EDGE = 'var(--select-edge, #f2780c)'; // both set in the colour settings
  const paintedRefs = (refs) => {
    const out = new Set(refs); const doc = app?.doc;
    if (!doc?.find) return out;
    for (const ref of refs) {
      const el = doc.find(ref);
      if (el?.type === 'chord') for (const n of el.children?.notes ?? []) out.add(n.id);
      const parent = el && el.type !== 'chord' ? doc.parentOf?.(ref) : null;
      if (parent?.type === 'chord' && (parent.children?.notes ?? []).every((n) => refs.includes(n.id))) out.add(parent.id);
    }
    return out;
  };
  const paintOf = (ref) => {
    const out = [];
    for (const src of holder.querySelectorAll(`[data-ref="${CSS.escape(ref)}"],[data-sel="${CSS.escape(ref)}"]`)) {
      const root = src.ownerSVGElement; const m0 = src.getScreenCTM?.(); const m1 = root?.getScreenCTM?.();
      // two copies: the outline (a little wider, livelier colour) under the body, so the note looks a bit bolder and stands out
      const copy = (edge) => {
        const c = src.cloneNode(true); c.removeAttribute('transform');
        for (const n of [c, ...c.querySelectorAll('*')]) {
          for (const a of ['data-ref', 'data-sel', 'data-role', 'data-glyph', 'id']) n.removeAttribute(a);
          if (n.tagName === 'g' || n.tagName === 'defs') continue;
          const stroked = n.getAttribute('stroke') && n.getAttribute('stroke') !== 'none'; const filled = n.getAttribute('fill') != null && n.getAttribute('fill') !== 'none';
          const ink = edge ? SELECT_EDGE : SELECT_INK;
          if (stroked) { n.style.stroke = ink; if (edge) n.setAttribute('stroke-width', String((Number(n.getAttribute('stroke-width')) || 1) + 1.8)); }
          if (filled) { n.style.fill = ink; if (edge) { n.style.stroke = SELECT_EDGE; n.setAttribute('stroke-width', '1.8'); n.setAttribute('vector-effect', 'non-scaling-stroke'); n.setAttribute('stroke-linejoin', 'round'); } }
        }
        return c;
      };
      const w = document.createElementNS(NS, 'g');
      if (m0 && m1) { const m = m1.inverse().multiply(m0); w.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`); }
      w.append(copy(true), copy(false)); out.push({ node: w });
    }
    return out;
  };
  const drawSelection = () => {
    if (view.isFrozen()) return; // deferred refresh: redrawn at the flush
    const mode = selectionMode(); const classic = mode === 'classic'; const colored = mode === 'colored';
    let shapes = view.selectionShapes();
    const rectRefs = [...new Set(shapes.filter((s) => s.kind === 'rect').map((s) => s.ref))];
    let halos = [];
    if (colored) { // the item itself turns blue (a solid copy over it); what has no shape of its own (text, cards…) keeps its box
      const paint = paintedRefs(rectRefs); const drawn = new Set();
      for (const ref of paint) for (const c of paintOf(ref)) { halos.push(c.node); drawn.add(ref); }
      shapes = shapes.filter((s) => s.kind !== 'rect' || !drawn.has(s.ref));
    } else if (!classic) halos = rectRefs.flatMap(haloOf);
    overlay.replaceChildren(...halos, ...shapes.map((s) => {
      if (s.kind === 'path') {
        // liaison, ligne, soufflet… : on retrace la forme elle-même (un halo autour du trait), pas sa boîte englobante
        const el = document.createElementNS(NS, 'path');
        el.setAttribute('d', `M${s.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}${s.closed ? 'Z' : ''}`);
        el.setAttribute('fill', s.closed ? 'rgba(40,120,255,0.35)' : 'none');
        el.setAttribute('stroke', 'rgba(40,120,255,0.55)');
        el.setAttribute('stroke-width', String(Math.max(s.strokeWidth, 1) + 3));
        el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('data-ref', s.ref);
        return el;
      }
      const el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', s.x1 - 2); el.setAttribute('y', s.y1 - 2);
      el.setAttribute('width', s.x2 - s.x1 + 4); el.setAttribute('height', s.y2 - s.y1 + 4);
      el.setAttribute('fill', classic ? 'rgba(40,120,255,0.18)' : 'rgba(40,120,255,0.07)'); el.setAttribute('stroke', classic ? 'rgb(40,120,255)' : 'rgba(40,120,255,0.55)'); el.setAttribute('stroke-width', '1');
      el.setAttribute('data-ref', s.ref);
      return el;
    }));
  };
  app?.preferences?.subscribe?.(() => drawSelection());

  // ---------- déplacement manuel : un bouton de la barre active la poignée ; glisser la poignée déplace la sélection (une transaction au relâchement) ----------
  let moveMode = false;
  let velocityShownFor = null; // selection (ids) for which the velocity bar shows the computed value; the others show « Auto » until asked
  let moveDrag = null;
  const movableSelection = () => (app ? app.movable(view.selection(), view.id) : []);
  // grip mode (slur, tie, hammer-on, hairpin): handles on the end points, the control points and the hairpin aperture
  let gripMode = false;
  let gripDrag = null;
  const gripEntryId = () => {
    const ids = view.selection();
    return ids.length === 1 && !view.range() && app?.gripHandles?.(ids[0], view.id) ? ids[0] : null;
  };
  const drawGripHandles = () => {
    if (view.isFrozen()) return; // deferred refresh: redrawn at the flush
    const svg = holder.querySelector('svg');
    if (!gripMode || !svg || !app) { gripLayer.replaceChildren(); gripMode = gripMode && !!svg && !!gripEntryId(); return; }
    const id = gripEntryId();
    if (!id) { gripMode = false; gripLayer.replaceChildren(); return; }
    const data = app.gripHandles(id, view.id);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-grips', '');
    const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
    const BLUE = 'rgb(150,60,210)'; // same purple as the range handles
    const sp = view.staffSpace();
    const rEnd = Math.max(sp * 0.38, 5); // smaller than the range handles (they were still too big)
    const anchors = app.gripAnchors?.(id, view.id) ?? null;
    if (anchors) {
      // small purple triangles under the staff at the chords the spanner starts and ends on (what playback follows)
      for (const c of anchors.chords) {
        if (c.id !== anchors.startChordId && c.id !== anchors.endChordId) continue;
        const r = Math.max(sp * 0.35, 4.5);
        g.append(mk('path', { d: `M ${c.x - r} ${c.y2 + r * 1.6} L ${c.x + r} ${c.y2 + r * 1.6} L ${c.x} ${c.y2 + 0.2}Z`, fill: BLUE, 'pointer-events': 'none' }));
      }
    }
    for (const segment of data.segments) {
      const byKey = Object.fromEntries(segment.handles.map((h) => [h.key, h]));
      const dots = {};
      const preview = mk('path', { fill: 'none', stroke: BLUE, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' });
      const update = () => {
        const p = (k) => `${dots[k].x} ${dots[k].y}`;
        if (data.kind === 'curve') preview.setAttribute('d', `M ${p('start')} L ${p('c1')} M ${p('end')} L ${p('c2')} M ${p('start')} C ${p('c1')}, ${p('c2')}, ${p('end')}`);
        else preview.setAttribute('d', `M ${p('start')} L ${p('end')}`);
      };
      for (const h of segment.handles) dots[h.key] = { x: h.x, y: h.y };
      update();
      g.append(preview);
      for (const h of segment.handles) {
        const control = h.key === 'c1' || h.key === 'c2';
        const aperture = h.key === 'aperture';
        const hit = mk('circle', { cx: h.x, cy: h.y, r: 15, fill: 'rgba(0,0,0,0.001)' });
        const dot = mk('circle', { cx: h.x, cy: h.y, r: control ? rEnd * 0.8 : rEnd, fill: control ? '#fff' : BLUE, stroke: control ? BLUE : '#fff', 'stroke-width': control ? 2 : 1.5 });
        const node = mk('g', {});
        node.style.pointerEvents = 'auto'; node.style.cursor = 'grab'; node.style.touchAction = 'none';
        node.setAttribute('data-grip', h.key);
        node.append(hit, dot);
        node.addEventListener('click', (e) => e.stopPropagation());
        node.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          try { node.setPointerCapture(e.pointerId); } catch { /* the drag still follows on the layer */ }
          gripDrag = { pointer: e.pointerId, start: toSvg(e), dx: 0, dy: 0 };
        });
        node.addEventListener('pointermove', (e) => {
          if (!gripDrag || e.pointerId !== gripDrag.pointer) return;
          const p = toSvg(e);
          gripDrag.dx = p.x - gripDrag.start.x; gripDrag.dy = p.y - gripDrag.start.y;
          // a hairpin stays level and centred: its start / end move horizontally only, the aperture handle vertically only
          if (aperture) gripDrag.dx = 0;
          else if (data.kind === 'hairpin') gripDrag.dy = 0;
          const nx = h.x + gripDrag.dx; const ny = h.y + gripDrag.dy;
          for (const n of [hit, dot]) { n.setAttribute('cx', nx); n.setAttribute('cy', ny); }
          dots[h.key] = { x: nx, y: ny };
          update();
          if (e.cancelable) e.preventDefault();
        });
        const end = (e) => {
          e.stopPropagation();
          const d = gripDrag; gripDrag = null;
          if (!d || e.pointerId !== d.pointer) return;
          if (Math.hypot(d.dx, d.dy) > 2) {
            try {
              // the start / end of a slur or hairpin dropped nearest ANOTHER chord of its voice: re-anchor (what playback follows)
              const isTrueEnd = h.key === 'start' ? segment.seg === 0 : segment.seg === data.segments.length - 1; // a continuation segment's end is not the anchor
              const nearest = !aperture && (h.key === 'start' || h.key === 'end') && isTrueEnd && anchors
                ? anchors.chords.reduce((best, c) => {
                  const nx = h.x + d.dx; const ny = h.y + d.dy;
                  const dy = ny < c.y1 ? c.y1 - ny : ny > c.y2 ? ny - c.y2 : 0;
                  const dist = Math.hypot(c.x - nx, dy);
                  return !best || dist < best.dist ? { id: c.id, dist } : best;
                }, null)
                : null;
              const current = h.key === 'start' ? anchors?.startChordId : anchors?.endChordId;
              if (nearest && nearest.id !== current) app.reanchorSpanner(id, h.key, nearest.id, view.id);
              else if (aperture) app.setAperture(id, h.value + 4 * (h.outward * d.dy / data.scale), view.id); // the edge at the middle of the wedge follows the finger (it is a quarter of the opening)
              else app.setGrip(id, segment.seg, h.key, [h.offset[0] + d.dx / data.scale, h.offset[1] + d.dy / data.scale], view.id);
            } catch (err) { entryMessage(String(err?.message ?? err)); }
          }
          drawGripHandles(); drawBar();
        };
        node.addEventListener('pointerup', end);
        node.addEventListener('pointercancel', end);
        g.append(node);
        void byKey;
      }
    }
    gripLayer.replaceChildren(g);
  };
  const drawMoveHandle = () => {
    if (view.isFrozen()) return; // deferred refresh: redrawn at the flush
    const ids = moveMode && !moveDrag ? movableSelection() : (moveDrag ? moveDrag.ids : []);
    const svg = holder.querySelector('svg');
    if (!moveMode || !ids.length || !svg) { moveLayer.replaceChildren(); if (moveMode && !ids.length) moveMode = false; return; }
    const b = boundsOfShapes(view.selectionShapes());
    if (!b) { moveLayer.replaceChildren(); return; }
    const H = Number(svg.getAttribute('height')) || 0;
    const cx = (b.x1 + b.x2) / 2;
    let cy = b.y2 + 30;
    if (cy > H - 20) cy = Math.max(20, b.y1 - 30); // no room below: above the element
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-move-handle', '');
    g.style.pointerEvents = 'auto'; g.style.cursor = 'grab'; g.style.touchAction = 'none';
    const leader = document.createElementNS(NS, 'line');
    leader.setAttribute('x1', cx); leader.setAttribute('y1', cy < b.y1 ? b.y1 : b.y2); leader.setAttribute('x2', cx); leader.setAttribute('y2', cy);
    leader.setAttribute('stroke', 'rgb(40,120,255)'); leader.setAttribute('stroke-width', '1.5'); leader.setAttribute('stroke-dasharray', '3 3');
    const hit = document.createElementNS(NS, 'circle'); // large invisible touch target
    hit.setAttribute('cx', cx); hit.setAttribute('cy', cy); hit.setAttribute('r', 26); hit.setAttribute('fill', 'rgba(0,0,0,0.001)');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 13);
    dot.setAttribute('fill', 'rgba(40,120,255,0.9)'); dot.setAttribute('stroke', '#fff'); dot.setAttribute('stroke-width', '2');
    const arrows = document.createElementNS(NS, 'text');
    arrows.setAttribute('x', cx); arrows.setAttribute('y', cy + 5); arrows.setAttribute('text-anchor', 'middle'); arrows.setAttribute('fill', '#fff');
    arrows.setAttribute('font-size', '15'); arrows.setAttribute('font-family', 'sans-serif'); arrows.style.pointerEvents = 'none';
    arrows.textContent = '✥';
    g.append(leader, hit, dot, arrows);
    moveLayer.replaceChildren(g);
    g.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch { /* sans capture : le glissé suit quand même sur le calque */ }
      const start = toSvg(e);
      const targets = [];
      // the elements carry their own `transform` attribute: the preview PREPENDS a translation to it (a CSS transform would replace it)
      for (const id of ids) for (const n of svg.querySelectorAll(`[data-sel="${id}"],[data-ref="${id}"]`)) targets.push({ n, orig: n.getAttribute('transform') });
      moveDrag = { ids, pointer: e.pointerId, start, targets, dx: 0, dy: 0, k: start.k };
      g.style.cursor = 'grabbing';
    });
    const move = (e) => {
      if (!moveDrag || e.pointerId !== moveDrag.pointer) return;
      const p = toSvg(e);
      moveDrag.dx = p.x - moveDrag.start.x; moveDrag.dy = p.y - moveDrag.start.y;
      // live preview: the element itself follows the finger
      for (const { n, orig } of moveDrag.targets) n.setAttribute('transform', `translate(${moveDrag.dx} ${moveDrag.dy})${orig ? ` ${orig}` : ''}`);
      const t = `translate(${moveDrag.dx}px, ${moveDrag.dy}px)`;
      g.style.transform = t; overlay.style.transform = t;
      if (e.cancelable) e.preventDefault();
    };
    const end = (e) => {
      e.stopPropagation(); // a release on the handle must not reach the score (a tap in the empty = deselect)
      if (!moveDrag || e.pointerId !== moveDrag.pointer) return;
      const d = moveDrag; moveDrag = null;
      for (const { n, orig } of d.targets) { if (orig === null) n.removeAttribute('transform'); else n.setAttribute('transform', orig); }
      overlay.style.transform = ''; g.style.transform = '';
      const ss = view.staffSpace();
      if (Math.hypot(d.dx, d.dy) > 2 && ss) {
        try { app.moveElements(d.ids, [d.dx / ss, d.dy / ss], view.id); } catch (err) { entryMessage(String(err?.message ?? err)); }
      }
      drawMoveHandle(); drawBar();
    };
    g.addEventListener('click', (e) => e.stopPropagation());
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  };

  // muted notes are drawn in grey by the renderer itself (render/svg.js, `showMuted`): nothing to overlay any more
  const drawMuted = () => { muted.replaceChildren(); };
  const drawBar = () => {
    filterCellRange = null;
    if (view.isFrozen()) return; // deferred refresh: redrawn at the flush
    const ids = view.selection();
    const cell = view.activeCell();
    const target = view.targetMeasureId();
    if (app && view.movement()?.masterbars.length === 0) emptyBtn.style.removeProperty('display'); else emptyBtn.style.setProperty('display', 'none', 'important'); // (the common button style sets a display: `none` alone would lose)
    const drawerKey = target ?? (view.range() ? view.range().from.measureId : null);
    if (drawerTarget !== drawerKey) { autoLevel = null; drawerTarget = drawerKey; }
    const range = view.range();
    { const mk = `${ids.join(',')}|${range ? `${range.from.measureId}${range.staffIds.join(',')}` : ''}`; if (mk !== marksFor) { marksFor = mk; dupQuick = dupQuick === 'pending' ? mk : null; capoOpen = false; marksPage = null; barPage = null; sysPage = null; rangePage = null; voltaPage = 0; selPage = 0; retouchOpen = retouchOpen && keepRetouch; } }
    // closed bar = collapsed drawers: it reopens folded and each drawer is unfolded again when needed
    if (!app || (!ids.length && !cell && !target && !range)) { retouchOpen = retouchOpen && keepRetouch; capoOpen = false; marksPage = null; barPage = null; sysPage = null; rangePage = null; if (staffTextUI?.isActive()) staffTextUI.cancel(); inlineUI?.cancel(); bar.style.display = 'none'; bar.replaceChildren(); return; }
    const btn = (text, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px)'; applyTextIcon(b, text); b.addEventListener('click', fn); return b; };
    const items = [];
    // Cuts a row of buttons into pages by their REAL widths (they are not all square: a tempo word is long) and by the real width of the bar (padding, border and gap
    // included), draws the current page with « ‹ » / « › », and marks the drawer level. If the browser still wraps the row, the usable width is shrunk and the row redrawn.
    const renderPacked = (all, { page = 0, onPage, breakAt = -1, level = null } = {}) => {
      const cs0 = getComputedStyle(bar);
      const target0 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-target')) || 44;
      bar.style.visibility = 'hidden'; bar.style.display = 'flex'; bar.replaceChildren(...all);
      const widths = all.map((it) => it.offsetWidth);
      bar.style.visibility = '';
      const gap = parseFloat(cs0.columnGap) || parseFloat(cs0.gap) || 6;
      const chrome = (parseFloat(cs0.paddingLeft) || 0) + (parseFloat(cs0.paddingRight) || 0) + (parseFloat(cs0.borderLeftWidth) || 0) + (parseFloat(cs0.borderRightWidth) || 0);
      const vis = stageVisible();
      let avail = vis.right - vis.left - chrome - 2;
      if (barButtons.choice() !== 'auto') avail = Math.min(avail, barButtons.slots(0, target0) * (target0 + gap));
      let tries = 0; let out = [];
      for (;;) {
        const pages = packPages(widths, avail, { arrow: target0, gap, breakAt });
        const no = Math.min(Math.max(page, 0), pages.length - 1);
        const pg = pages[no];
        out = [];
        if (pg.prev) { const b = btn('‹', label('marks.less'), () => onPage(no - 1)); b.setAttribute('data-page', 'first'); out.push(b); }
        out.push(...all.slice(pg.from, pg.to));
        if (pg.next) { const b = btn('›', label('marks.more'), () => onPage(no + 1)); applyIconName(b, 'chevron-right'); b.setAttribute('data-page', 'more'); out.push(b); }
        for (const b of out) b.addEventListener('mousedown', (e) => { if (e.target.closest?.('button')) e.preventDefault(); });
        bar.replaceChildren(...out); bar.style.display = 'flex';
        markDrawerLevel(bar, level);
        const rows = new Set(out.map((el) => el.offsetTop)).size;
        if (rows <= 1 || tries >= 3) break;
        avail -= 30; tries += 1; // still wrapped: less room than measured, try again
      }
      placeBar();
    };
    // lyrics drawer: while syllables are typed in place, the bar holds only their buttons (previous / next, verse, new verse, back)
    if (lyricsUI && app.lyricsEntry().active) {
      const keepFocus = (b) => { b.addEventListener('mousedown', (e) => e.preventDefault()); return b; }; // the text field keeps the focus (the touch keyboard stays open)
      const pair = (a, b2, title, up, down, action) => {
        const b = keepFocus(btn('', title, () => {}));
        b.append(icon(a, { size: '1.1em' }), icon(b2, { size: '1.1em' }));
        b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center;gap:2px';
        b.setAttribute('data-action', action);
        markTwoActions(b, b.children[0], b.children[1]);
        bindShortLong(b, { onShort: up, onLong: down });
        return b;
      };
      const acts = lyricsUI.actions;
      items.push(
        pair('chevron-left', 'chevron-right', label('lyrics.prevNext'), () => acts.go(-1), () => acts.go(1), 'lyrics-prev-next'),
        pair('triangle-up', 'triangle-down', label('lyrics.verseUpDown'), () => acts.verse(-1), () => acts.verse(1), 'lyrics-verse'),
        keepFocus(btn('+', label('lyrics.newVerse'), () => acts.newVerse())),
        keepFocus(btn('✕', label('lyrics.close'), () => acts.close())),
      );
      items[2].setAttribute('data-action', 'lyrics-verse-new'); items[3].setAttribute('data-action', 'lyrics-close');
      bar.replaceChildren(...items); bar.style.display = 'flex'; placeBar();
      return;
    }
    // staff text being written in place: the bar holds its settings (above / below, normal / italic / bold, validate, cancel)
    if (staffTextUI?.isActive()) {
      const stt = staffTextUI.state();
      const keep = (b) => { b.addEventListener('mousedown', (e) => e.preventDefault()); return b; }; // the field keeps the focus (the touch keyboard stays open)
      const tog = (b, on, key) => { b.setAttribute('data-stafftext', key); b.setAttribute('aria-pressed', String(on)); if (on) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; return keep(b); };
      const outT = [
        tog(btn('', label('stafftext.above'), () => staffTextUI.set({ placement: 'above' })), stt.placement === 'above', 'above'),
        tog(btn('', label('stafftext.below'), () => staffTextUI.set({ placement: 'below' })), stt.placement === 'below', 'below'),
        tog(btn('N', label('stafftext.normal'), () => staffTextUI.set({ style: 'normal' })), stt.style === 'normal', 'normal'),
        tog(btn('I', label('stafftext.italic'), () => staffTextUI.set({ style: 'italic' })), stt.style === 'italic', 'italic'),
        tog(btn('B', label('stafftext.bold'), () => staffTextUI.set({ style: 'bold' })), stt.style === 'bold', 'bold'),
        // the line after the text (« solo ––––| »): none → solid → dashed; with a line, a hook at its end and the number of measures it covers
        tog(btn('', label(`stafftext.line.${stt.line ?? 'none'}`), () => staffTextUI.set({ line: stt.line === null ? 'solid' : stt.line === 'solid' ? 'dashed' : null })), stt.line !== null, 'line'),
        ...(stt.line ? [
          tog(btn('', label('stafftext.hook'), () => staffTextUI.set({ hook: !stt.hook })), stt.hook, 'hook'),
          keep(btn('−', label('stafftext.spanLess'), () => staffTextUI.set({ span: Math.max(1, stt.span - 1) }))),
          keep(Object.assign(btn(String(stt.span), label('stafftext.span', { n: stt.span }), () => {}), { disabled: true })),
          keep(btn('+', label('stafftext.spanMore'), () => staffTextUI.set({ span: Math.min(64, stt.span + 1) }))),
        ] : []),
        keep(btn('✓', label('stafftext.validate'), () => { staffTextUI.commit(); drawBar(); })),
        keep(btn('✕', label('stafftext.cancel'), () => { staffTextUI.cancel(); drawBar(); })),
      ];
      applyIconName(outT[0], 'triangle-up'); applyIconName(outT[1], 'triangle-down');
      const lineBtn = outT[5]; lineBtn.textContent = stt.line === 'dashed' ? '╌╌' : stt.line === 'solid' ? '──' : '—'; lineBtn.style.cssText += ';font:var(--w-bold,700) 13px var(--ui-font,sans-serif);letter-spacing:-1px';
      if (stt.line) { outT[6].textContent = '⌐'; outT[6].style.cssText += ';font:var(--w-bold,700) 15px var(--ui-font,sans-serif)'; outT[8].setAttribute('data-stafftext', 'span'); outT[8].style.opacity = '1'; outT[7].setAttribute('data-stafftext', 'span-less'); outT[9].setAttribute('data-stafftext', 'span-more'); }
      outT[2].style.fontWeight = '400'; outT[3].style.cssText += ';font-style:italic;font-weight:600;font-family:Georgia,serif'; outT[4].style.fontWeight = '800';
      outT.at(-2).setAttribute('data-stafftext', 'validate'); outT.at(-1).setAttribute('data-stafftext', 'cancel');
      bar.replaceChildren(...outT); bar.style.display = 'flex'; placeBar();
      return;
    }
    // system objects pages: the bar is replaced by the menu of six, then by the buttons of the chosen one; choosing something goes back to the normal bar
    if (sysPage) {
      const sysT = app.systemTarget ? app.systemTarget(ids, range, target, view.id) : null;
      if (sysT) {
        const stS = app.systemState(sysT, view.id) ?? {};
        const cueInfo = sysPage.path.at(-1) === 'cue' ? app.cueInfo({ movement: view.movementIndex() }) : null; // the cue page: what the drum players have to choose from
        const level = cueInfo ? { kind: 'page', keys: cueKeys(cueInfo) } : sysLevel(sysPage.path, { hasSection: !!stS.section });
        if (level) {
          const at = { measureId: sysT.measureId, position: sysT.position };
          const endAt = { measureId: sysT.endMeasureId, position: sysT.endPosition };
          const guardS = (name, fn, stay = false) => () => {
            if (!stay) sysPage = null;
            let made; try { made = app.systemEdit(name, fn, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); }
            drawBar(); return made;
          };
          const on = (b, active) => { b.setAttribute('aria-pressed', String(!!active)); if (active) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; return b; };
          const textBtn = (text, title, fn) => { const b = btn(text, title, fn); b.style.cssText += ';font:var(--w-semi,600) 12px/1.05 var(--ui-font,sans-serif);padding:0 8px;white-space:nowrap'; return b; };
          const gStaff = app.gestureStaff(ids, range, view.id);
          const tempoIcon = (b) => { b.append(glyphRowIcon(glyphs, ['metNoteQuarterUp'], { side0: 2.4, px: 20 }) ?? '♩', Object.assign(document.createElement('span'), { textContent: '=' })); b.style.cssText += ';display:inline-flex;align-items:center;gap:1px;font:var(--w-bold,700) 16px var(--ui-font,sans-serif)'; };
          const menuBtn = (key) => {
            const name = key.slice(5); // menu:xxx or menu:tempo/xxx
            const title = label(`sys.menu.${name}`);
            let b;
            const open = () => {
              if (name === 'timesig') { openTimeSigDialog({ app, label, movement: view.movementIndex() }); return; }
              if (name === 'keysig') { openKeySigDialog({ app, label, movement: view.movementIndex() }); return; }
              if (name === 'text') { if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; } sysPage = null; staffTextUI.start({ sysTarget: sysT, staffId: gStaff, ids, range }); drawBar(); return; }
              sysPage = { path: name.split('/').length > 1 ? name.split('/') : [name], page: 0 }; drawBar();
            };
            b = btn('', title, open);
            b.setAttribute('data-sys-menu', name);
            if (name === 'tempo' || name === 'tempo/metro') tempoIcon(b);
            else if (name === 'jump') markIcon(b, glyphs, 'marker', 'segno');
            else if (name === 'form') b.textContent = 'intro';
            else if (name === 'text') b.textContent = 'TXT';
            else if (name === 'tech') b.textContent = 'pizz.';
            else if (name === 'leslie') b.textContent = 'Leslie';
            else if (name === 'cue') b.textContent = 'Rep.';
            else if (name === 'chordview') b.textContent = 'Acc.';
            else if (name === 'timesig') b.textContent = '4/4';
            else if (name === 'keysig') b.textContent = '♯♭ 0';
            else if (name === 'container') applyIconName(b, 'square-dashed');
            else if (name === 'tempo/words') b.textContent = 'Allegro';
            else if (name === 'tempo/gradual') b.textContent = 'rit.';
            else if (name === 'tempo/swing') b.textContent = 'swing';
            else if (name === 'tempo/fermata') markIcon(b, glyphs, 'fermata', 'fermata');
            if (tabSheet()) {
              const ic = { form: 'section-card', text: 'staff-text', tech: 'pluck', cue: 'cue-flag' }[name];
              if (ic) applyIconName(b, ic);
              else if (name === 'keysig') { b.replaceChildren(glyphRowIcon(glyphs, ['accidentalSharp'], { side0: 2.6 }) ?? '♯'); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; }
            }
            if (['form', 'text', 'tech', 'leslie', 'cue', 'chordview', 'timesig', 'keysig', 'tempo/words', 'tempo/gradual', 'tempo/swing'].includes(name)) b.style.cssText += ';font:var(--w-bold,700) 12px/1.05 var(--ui-font,sans-serif);padding:0 8px;white-space:nowrap';
            return b;
          };
          const mk = (key) => {
            const i = key.indexOf(':'); const group = key.slice(0, i); const name = key.slice(i + 1);
            let b;
            if (group === 'menu') return menuBtn(key);
            if (group === 'word') b = on(textBtn(name, name, guardS('Tempo', (d, mv, sys) => sys.setTempo(d, mv, at, { word: name }))), stS.tempo?.text === name);
            else if (group === 'metro') {
              if (name === 'val') { b = document.createElement('output'); b.textContent = `♩ = ${systemBpm}`; b.setAttribute('data-system-bpm', ''); b.style.cssText = 'min-width:5em;text-align:center;font-variant-numeric:tabular-nums;align-self:center'; return b; }
              const step = { m10: -10, m1: -1, p1: 1, p10: 10 }[name];
              if (step !== undefined) { b = btn(step > 0 ? `+${step > 1 ? step : ''}` : `−${step < -1 ? -step : ''}`, step > 0 ? label('system.more') : label('system.less'), () => { systemBpm = Math.min(300, Math.max(20, systemBpm + step)); drawBar(); }); }
              else if (name === 'set') b = on(textBtn(label('system.setTempo'), label('system.setTempo'), guardS('Tempo', (d, mv, sys) => sys.setTempo(d, mv, at, { bpm: systemBpm }))), stS.tempo?.kind === 'normal' && stS.tempo?.bpm === systemBpm && !stS.tempo?.text);
              else if (name === 'atempo') b = on(textBtn('a tempo', 'a tempo', guardS('Tempo', (d, mv, sys) => sys.setTempo(d, mv, at, { kind: 'aTempo' }))), stS.tempo?.kind === 'aTempo');
              else b = on(textBtn('tempo primo', 'tempo primo', guardS('Tempo', (d, mv, sys) => sys.setTempo(d, mv, at, { kind: 'tempoPrimo' }))), stS.tempo?.kind === 'tempoPrimo');
            }
            else if (group === 'grad') b = on(textBtn(GRADUAL_TYPES[name].text, name, guardS('Tempo', (d, mv, sys) => sys.setGradualChange(d, mv, at, endAt, name))), stS.gradual === name);
            else if (group === 'swing') b = on(textBtn(label(`system.swing.${name}`), label(`system.swing.${name}`), guardS('Swing', (d, mv, sys) => sys.toggleSwing(d, mv, at, name))), stS.swing === name);
            else if (group === 'ferm') { b = on(btn('', label(`system.fermata.${name}`), guardS('Point d\'orgue', (d, mv, sys) => sys.toggleFermata(d, mv, at, name))), stS.fermata === name); markIcon(b, glyphs, 'fermata', name); }
            else if (group === 'marker') { b = on(btn('', label(`system.marker.${name}`), guardS('Marqueur', (d, mv, sys) => sys.toggleMarker(d, mv, sysT.measureId, name))), stS.marker === name); markIcon(b, glyphs, 'marker', name); }
            else if (group === 'jump') { const j = JUMP_TYPES.find((x) => x.type === name); b = on(textBtn(j.text, j.text, guardS('Saut', (d, mv, sys) => sys.toggleJump(d, mv, sysT.measureId, name))), stS.jump === name); }
            else if (group === 'sect') { const nm = label(`section.${name}`); b = on(textBtn(nm, nm, guardS('Partie', (d, mv, sys) => sys.toggleSection(d, mv, sysT.measureId, { label: nm, category: name }))), stS.section?.category === name && stS.section?.label === nm); }
            else if (group === 'letter') b = on(textBtn(name, name, guardS('Partie', (d, mv, sys) => sys.toggleSection(d, mv, sysT.measureId, { label: name, category: 'letter' }))), stS.section?.category === 'letter' && stS.section?.label === name);
            else if (group === 'reh') b = on(textBtn(stS.rehearsal ?? label('system.rehearsalAdd'), label('system.rehearsalToggle'), guardS('Repère', (d, mv, sys) => sys.toggleRehearsalMark(d, mv, sysT.measureId))), stS.rehearsal !== null && stS.rehearsal !== undefined);
            else if (group === 'form') b = textBtn('✎', label('system.sectionCustom'), () => {
              inlineUI.open({ anchor: () => measureAnchor(sysT.measureId), value: stS.section?.label ?? '', placeholder: label('inline.sectionName'), aria: label('system.sectionCustom'),
                onCommit: (next) => guardS('Partie', (d, mv, sys) => sys.toggleSection(d, mv, sysT.measureId, { label: next, category: stS.section?.category ?? 'custom' }))() });
            });
            else if (group === 'col') {
              b = btn(name === 'auto' ? 'auto' : '', name === 'auto' ? label('system.sectionAuto') : name, guardS('Partie', (d, mv, sys) => sys.setSectionColor(d, mv, sysT.measureId, name === 'auto' ? null : name)));
              if (name === 'auto') { on(b, stS.section?.color === null); b.style.cssText += ';font:var(--w-semi,600) 12px sans-serif'; } else { b.style.cssText += `;background:${name};border:${stS.section?.color === name ? '3px solid var(--sel-edge,#2d78ff)' : '1px solid #888'}`; b.setAttribute('aria-label', name); }
            }
            else if (group === 'tech') { const t = TECHNIQUES.find((x) => x.id === name); b = textBtn(t.text, t.text, () => { if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; } guardS('Technique', () => app.addStaffText(sysT, gStaff, { technique: name, style: 'italic', placement: staffTextPlacement }, view.id))(); }); }
            else if (group === 'leslie') { // rotor speed sign of an organ (audio/leslie.js): only on a pitched keyboard staff, otherwise disabled with the reason as tooltip
              const t = TECHNIQUES.find((x) => x.id === name);
              const problem = leslieStaffProblem(app.doc, gStaff);
              b = textBtn(t.text, label(problem ? `leslie.${problem}` : `leslie.${name.slice(6).toLowerCase()}.tip`), () => { if (problem) { entryMessage(label(`leslie.${problem}`)); return; } guardS('Leslie', () => app.addStaffText(sysT, gStaff, { technique: name, style: 'italic', placement: 'above' }, view.id))(); });
              if (problem) { b.setAttribute('aria-disabled', 'true'); b.style.opacity = '0.45'; }
            }
            else if (group === 'cview') { // how the chords are READ from this measure on (model/chordview.js): as written, as played with the capo, or shifted by hand; the sound does not change
              if (name === 'val') { b = document.createElement('output'); b.textContent = `${chordViewShift > 0 ? '+' : ''}${chordViewShift}`; b.setAttribute('data-cview-shift', ''); b.style.cssText = 'min-width:3em;text-align:center;font-variant-numeric:tabular-nums;align-self:center'; return b; }
              const cv = stS.chordView;
              if (name === 'm1' || name === 'p1') { const step = name === 'p1' ? 1 : -1; b = btn(step > 0 ? '+' : '−', step > 0 ? label('system.more') : label('system.less'), () => { chordViewShift = Math.min(11, Math.max(-11, chordViewShift + step)); drawBar(); }); }
              else if (name === 'original' || name === 'capo') b = on(textBtn(label(`chordView.${name}`), label(`chordView.${name}Tip`), guardS('Accords', (d, mv, s) => s.toggleChordView(d, mv, sysT.measureId, { mode: name }, sysT.endMeasureId))), cv?.mode === name);
              else if (name === 'set') b = on(textBtn(label('chordView.setShift'), label('chordView.shiftTip'), guardS('Accords', (d, mv, s) => s.toggleChordView(d, mv, sysT.measureId, { mode: 'shift', shift: chordViewShift }, sysT.endMeasureId))), cv?.mode === 'shift' && cv.shift === chordViewShift);
              else b = textBtn(label('chordView.clear'), label('chordView.clearTip'), guardS('Accords', (d, mv, s) => s.removeChordView(d, mv, sysT.measureId, sysT.endMeasureId)));
            }
            else if (group === 'cue') {
              // a cue on this measure (model/cueedit.js): for every drum player (groove, break) or for one player (alternative phrase); pressing it puts it, pressing it again takes it off
              const t0 = cueInfo.tracks[0];
              const mi = view.movementIndex();
              const act = (fn) => () => { sysPage = null; try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); };
              const here = (kind, trackId = null) => cueInfo.cues.find((c) => c.measureId === sysT.measureId && c.kind === kind && c.trackId === trackId);
              if (name === 'nodrums') { b = textBtn(label('cues.noDrumsShort'), label('cues.noDrums'), () => {}); b.disabled = true; }
              else if (name === 'clear') b = textBtn(label('cues.clearHere'), label('cues.clearHere'), act(() => { for (const c of cueInfo.cues.filter((x) => x.measureId === sysT.measureId)) app.removeCue(c.id, { movement: mi }); }));
              else {
                const kind = name.slice(0, name.indexOf(':')); let value = name.slice(name.indexOf(':') + 1); let trackId = null; let who = '';
                if (kind === 'alt') { const cut = value.indexOf(':'); trackId = value.slice(0, cut); value = value.slice(cut + 1); who = ` · ${cueInfo.players.find((p) => p.id === trackId)?.name ?? ''}`; }
                const text = kind === 'groove'
                  ? ((v) => v.name ?? label(v.index === 0 ? 'grooveEditor.mainName' : 'grooveEditor.versionN', { n: v.index + 1 }))(t0.versions.find((v) => v.value === value))
                  : kind === 'alt' ? (value === 'none' ? label('cues.noAlt') : ((a) => a.name ?? label('cues.altN', { n: a.index }))(cueInfo.players.find((p) => p.id === trackId).alts.find((a) => a.value === value)))
                  : value === 'none' ? label('cues.noBreak') : ((f) => f.name ?? label('grooveEditor.breakN', { n: f.index }))(t0.fills.find((f) => f.value === value));
                const old = here(kind, trackId);
                b = on(textBtn(`${label(`cues.kind.${kind}`)} · ${text}${who}`, label(`cues.kind.${kind}Hint`), act(() => {
                  if (old && old.value === value) app.removeCue(old.id, { movement: mi });
                  else app.setCue(sysT.measureId, { kind, value, text: `[${text}]`, trackId }, { movement: mi });
                })), !!old && old.value === value);
              }
            }
            else if (group === 'cwhere') { b = btn('', label(`system.container.where.${name}`), () => { containerWhere = name; drawBar(); }); applyIconName(b, { above: 'arrow-up', before: 'arrow-left', after: 'arrow-right' }[name]); on(b, containerWhere === name); }
            else if (group === 'cpaste') {
              if (!app.containerClip()) return null; // nothing copied: no button
              b = btn('', label('container.paste'), () => {
                if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; }
                guardS('Conteneur', () => app.pasteContainer(sysT, gStaff, view.id))();
              });
              applyIconName(b, 'clipboard-paste');
            }
            else if (group === 'cevery') { b = on(textBtn(label('system.container.everyStaff'), label('system.container.everyStaff'), () => { slotEveryStaff = !slotEveryStaff; drawBar(); }), slotEveryStaff); }
            else if (group === 'cnew') {
              if (name === 'text') b = textBtn('TXT', label('system.container.text'), () => {
                if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; }
                inlineUI.open({ anchor: () => measureAnchor(sysT.measureId), placeholder: label('inline.containerText'), aria: label('system.containerText'), onCommit: (text) => guardS('Conteneur', () => {
                  if (containerWhere === 'above') return app.addContainer(sysT, gStaff, { kind: 'text', text }, view.id);
                  return slotEveryStaff ? app.addSlotContainersEveryStaff(sysT, { side: containerWhere, kind: 'text', text }, view.id) : app.addSlotContainer(sysT, gStaff, { side: containerWhere, text }, view.id);
                })() });
              });
              else if (name === 'gap') b = textBtn(label('container.gapShort'), label('container.gap'), () => {
                if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; }
                if (containerWhere === 'above') { entryMessage(label('container.gapNeedsBetween')); return; }
                guardS('Conteneur', () => (slotEveryStaff ? app.addSlotContainersEveryStaff(sysT, { side: containerWhere, kind: 'text', gap: true }, view.id) : app.addSlotContainer(sysT, gStaff, { side: containerWhere, gap: true }, view.id)))();
              });
              else if (name === 'diagram') {
                b = btn('', label('system.container.diagram'), () => {
                  if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; }
                  let created;
                  guardS('Conteneur', () => { created = app.addDiagramContainer(sysT, gStaff, { where: containerWhere }, view.id); })();
                  if (created?.id && onDiagramEdit) onDiagramEdit(created.id, view.id);
                });
                applyIconName(b, 'guitar-head');
              }
              else { b = btn('', label('system.container.score'), () => {
                if (!gStaff) { entryMessage(label('system.staffTextNeedStaff')); return; }
                let created;
                guardS('Conteneur', () => {
                  if (containerWhere === 'above') created = app.addContainer(sysT, gStaff, { kind: 'score' }, view.id);
                  else if (slotEveryStaff) created = app.addSlotContainersEveryStaff(sysT, { side: containerWhere, kind: 'fragment', staffType: 'score' }, view.id);
                  else created = app.addFragmentContainer(sysT, gStaff, { side: containerWhere, staffType: 'score' }, view.id);
                })();
                const first = Array.isArray(created) ? created[0] : created; if (first?.fragments?.length && onFragmentEdit) onFragmentEdit(first.id);
              }); b.append(glyphRowIcon(glyphs, ['gClef'], { side0: 3.2, px: 20 }) ?? 'G'); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; }
            }
            b.setAttribute('data-sys', key);
            return b;
          };
          const mkAll = level.keys.map(mk).filter(Boolean);
          renderPacked(mkAll, { page: sysPage.page ?? 0, onPage: (n) => { sysPage = { ...sysPage, page: n }; drawBar(); }, level: level.kind === 'menu' ? 'menu' : 'page' });
          return;
        }
      }
      sysPage = null;
    }
    // cyclic stem-direction button (automatic → up → down): the icon shows the current state; not offered on percussion, chord, accordion staves
    const stemButton = (state, onClick) => {
      const b = btn('', label(`stem.${['auto', 'up', 'down'][state]}`), onClick); b.setAttribute('data-action', 'stem-direction');
      if (state === 0) applyIconName(b, 'arrow-up-down');
      else { b.append(glyphRowIcon(glyphs, ['noteQuarterUp'], { side0: 3.4, rotate: state === 2 ? 180 : 0 }) ?? (state === 1 ? '↑' : '↓')); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; }
      markCyclic(b, 3, state);
      return b;
    };
    // voice of the selected chords: a cyclic button 1 → 4 (a voice that is busy there is skipped)
    const voiceButton = (voice, onClick) => {
      const b = btn('', label('selection.voice', { n: voice + 1 }), onClick); b.setAttribute('data-action', 'chord-voice');
      b.append(Object.assign(document.createElement('span'), { textContent: `V${voice + 1}` })); b.style.cssText += ';font:var(--w-bold,700) 13px var(--ui-font,sans-serif);display:inline-flex;align-items:center;justify-content:center';
      markCyclic(b, 4, voice);
      return b;
    };
    // the creation bar: right after a note is created (the new note is selected), a short bar of retouches — delete, semitone (short press up, long press down),
    // cyclic accidental, dot, tie, rest. Any other selection brings the normal bar back.
    {
      const cr = app.creation?.();
      if (cr && !range && cr.viewId === view.id && ids.length === cr.ids.length && ids.every((i) => cr.ids.includes(i))) {
        const info = app.creationInfo();
        const guard = (fn) => () => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); };
        const keepFocus = (b) => { b.addEventListener('mousedown', (ev) => ev.preventDefault()); return b; };
        const list = [];
        const del = btn('🗑', label('creation.delete'), guard(() => app.deleteElements(ids, view.id))); del.setAttribute('data-action', 'creation-delete'); list.push(del);
        if (info?.pitched) {
          const semi = btn('', label('creation.semitone'), () => {}); semi.setAttribute('data-action', 'creation-semitone');
          semi.append(drawnById('creation:semitone') ?? '±'); semi.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
          bindShortLong(semi, { onShort: guard(() => app.transposeNotes(ids, { up: true }, view.id)), onLong: guard(() => app.transposeNotes(ids, { up: false }, view.id)) });
          markLongPress(semi); list.push(semi);
        }
        if (info && info.accidental !== null) {
          const names = ['accidentalNatural', 'accidentalSharp', 'accidentalFlat'];
          const acc = btn('', label(`creation.accidental.${info.accidental}`), guard(() => app.creationAccidental(view.id))); acc.setAttribute('data-action', 'creation-accidental');
          acc.append(glyphRowIcon(glyphs, [names[info.accidental]], { side0: 2.6 }) ?? names[info.accidental]); acc.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
          markCyclic(acc, 3, info.accidental); list.push(acc);
        }
        if (info && info.stem !== null && info.stem !== undefined) list.push(stemButton(info.stem, guard(() => app.cycleStem(ids, view.id))));
        { const vi = app.voiceInfo(ids); if (vi !== null) list.push(voiceButton(vi, guard(() => app.cycleVoice(ids, view.id)))); }
        if (info?.dot) { const d = btn('', label('noteEntry.dot'), guard(() => app.creationDot(view.id))); d.setAttribute('data-action', 'creation-dot'); d.append(glyphRowIcon(glyphs, ['metAugmentationDot'], { side0: 1.6 }) ?? '•'); d.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; list.push(d); }
        if (info?.rest || info?.pitched) {
          const t = btn('', label('noteEntry.tie'), guard(() => { app.keyboardEntry({ type: 'tie' }, view.id); })); t.setAttribute('data-action', 'creation-tie');
          t.append(drawnById('span:slur') ?? '⌒'); t.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; list.push(t);
        }
        if (info?.rest) { const r = btn('', label('creation.rest'), guard(() => app.creationRest(view.id))); r.setAttribute('data-action', 'creation-rest'); r.append(glyphRowIcon(glyphs, ['restQuarter'], { side0: 2.6 }) ?? '𝄽'); r.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; list.push(r); }
        for (const b of list) keepFocus(b);
        renderPacked(list, { level: 'page' });
        return;
      }
    }
    // retouch drawer (pitch and length of the selected notes): semitone / octave arrows, longer / shorter, cyclic accidental; the drawer stays open while the selection stays
    if (retouchOpen && !range && ids.length && app.transposableNotes(ids).length) {
      const info = app.retouchInfo(ids);
      const guard = (fn) => () => { keepRetouch = true; try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); setTimeout(() => { keepRetouch = false; }, 80); };
      const list = [];
      for (const up of [true, false]) {
        const b = btn('', label(up ? 'transpose.up' : 'transpose.down'), () => {});
        b.setAttribute('data-action', up ? 'transpose-up' : 'transpose-down'); applyIconName(b, up ? 'triangle-up' : 'triangle-down'); markLongPress(b);
        bindShortLong(b, { onShort: guard(() => app.transposeNotes(ids, { up, octave: false }, view.id)), onLong: guard(() => app.transposeNotes(ids, { up, octave: true }, view.id)) });
        list.push(b);
      }
      if (info.length) {
        const len = btn('', label('retouch.length'), () => {}); len.setAttribute('data-action', 'retouch-length');
        len.append(drawnById('retouch:length') ?? '↔'); len.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
        bindShortLong(len, { onShort: guard(() => app.retouchLength(ids, true, view.id)), onLong: guard(() => app.retouchLength(ids, false, view.id)) });
        markShortLongPress(len); list.push(len);
      }
      if (info.accidental !== null) {
        const names = ['accidentalNatural', 'accidentalSharp', 'accidentalFlat'];
        const acc = btn('', label(`creation.accidental.${info.accidental}`), guard(() => app.cycleAccidental(ids, view.id))); acc.setAttribute('data-action', 'retouch-accidental');
        acc.append(glyphRowIcon(glyphs, [names[info.accidental]], { side0: 2.6 }) ?? names[info.accidental]); acc.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
        markCyclic(acc, 3, info.accidental); list.push(acc);
      }
      if (info.stem !== null && info.stem !== undefined) list.push(stemButton(info.stem, guard(() => app.cycleStem(ids, view.id))));
      { const vi = app.voiceInfo(ids); if (vi !== null) list.push(voiceButton(vi, guard(() => app.cycleVoice(ids, view.id)))); }
      for (const b of list) b.addEventListener('mousedown', (ev) => ev.preventDefault());
      renderPacked(list, { level: 'page' });
      return;
    }
    // a selected volta: the bar becomes its editor (open / closed cycle, ending numbers, delete, settings)
    if (ids.length === 1 && !range && app.doc.find(ids[0])?.type === 'volta') {
      const volta = app.doc.find(ids[0]);
      const numbers = volta.props?.voltaNumbers ?? [1];
      const isOpen = volta.props?.voltaOpen === true;
      const change = (c) => () => { try { app.systemEdit('Volta', (d, mv, sys) => sys.updateVolta(d, volta, c), view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } };
      const hook = (closed) => { // a bracket seen from the side: closed = inverted U, open = inverted L
        const NSV = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NSV, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        svg.style.cssText = 'width:1.3em;height:1.3em;flex:none;display:block';
        const path = document.createElementNS(NSV, 'path'); path.setAttribute('d', closed ? 'M5 19V6H19V19' : 'M5 19V6H19'); svg.append(path);
        return svg;
      };
      const mkv = (key) => {
        let b;
        if (key === 'cycle') {
          b = btn('', label(isOpen ? 'volta.openNow' : 'volta.closedNow'), change({ open: !isOpen }));
          b.append(hook(!isOpen)); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
          markCyclic(b, 2, isOpen ? 1 : 0);
        } else if (key === 'delete') { b = btn('🗑', label('volta.delete'), () => { try { app.deleteElements([volta.id]); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } }); }
        else if (key === 'edit') { b = btn('✎', label('volta.settings'), () => openVoltaSettings({ app, voltaId: volta.id, label, viewId: view.id })); }
        else {
          const n = Number(key.slice(1));
          const active = numbers.includes(n);
          b = btn(`${n}.`, label('volta.number', { n }), () => { const next = active ? numbers.filter((m) => m !== n) : [...numbers, n]; if (next.length) change({ numbers: next })(); });
          b.setAttribute('aria-pressed', String(active)); if (active) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)';
        }
        b.setAttribute('data-volta', key);
        return b;
      };
      renderPacked(['cycle', 'n1', 'n2', 'n3', 'delete', 'edit', 'n4', 'n5'].map(mkv), { page: voltaPage, onPage: (n) => { voltaPage = n; drawBar(); } });
      return;
    }
    // capo drawer (opened by the "Capo" button of the guitar marks page): fret − / + , the strings it presses, how it reads, remove. Each press writes at once
    // (one undoable transaction) and the drawer stays open; a tap in the empty space goes back to the guitar page.
    if (capoOpen && app.markTargets(ids, range, view.id).length) {
      const st = app.capoState(ids, range, view.id);
      if (!st.available) { capoOpen = false; } else {
        const go = (patch) => () => { try { app.setCapo(patch, ids, range, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); };
        const items = [];
        const minus = btn('−', label('capo.fretMinus'), go({ fret: st.fret - 1 })); minus.disabled = st.fret <= 0; items.push(minus);
        const shown = btn(st.fret ? `Capo ${st.fret}` : 'Capo —', label('capo.fret')); shown.disabled = true; shown.style.cssText += ';min-width:calc(var(--ui-target,44px)*1.6);font-weight:var(--w-bold,700);color:var(--ink,#222);opacity:1'; items.push(shown);
        const plus = btn('+', label('capo.fretPlus'), go({ fret: st.fret + 1 })); plus.disabled = st.fret >= st.maxFret; items.push(plus);
        // « no capo from here » (until the next capo): the solo played without it, then the capo again; pressed again it puts the capo back
        const none = btn(label('capo.noneShort'), label('capo.none'), go({ active: !st.active })); none.disabled = !st.active && !st.hasEntry; none.setAttribute('aria-pressed', String(!st.active && st.hasEntry)); none.setAttribute('data-capo-none', '');
        if (!st.active && st.hasEntry) none.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)';
        items.push(none);
        for (let s = 1; s <= st.strings; s++) {
          const pressed = !st.ignored.includes(s);
          const sb = btn(String(s), label(pressed ? 'capo.stringPressed' : 'capo.stringFree', { n: s }), go({ ignored: pressed ? [...st.ignored, s] : st.ignored.filter((x) => x !== s) }));
          sb.disabled = st.fret <= 0; sb.setAttribute('aria-pressed', String(st.fret > 0 && pressed)); sb.setAttribute('data-capo-string', String(s));
          if (st.fret > 0 && pressed) sb.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; else sb.style.opacity = '0.6';
          items.push(sb);
        }
        const modes = ['tab', 'standard', 'playback']; const mi = Math.max(0, modes.indexOf(st.mode));
        const mb = btn(label(`capo.modeShort.${st.mode}`), label(`capo.mode.${st.mode}`), go({ mode: modes[(mi + 1) % 3] })); mb.disabled = st.fret <= 0; markCyclic(mb, 3, mi); mb.setAttribute('data-capo-mode', st.mode); items.push(mb);
        const tc = app.tuningChangeState(ids, range, view.id);
        if (tc.available) {
          const opts = [['', label('guitar.tuningChange.none')], ...tc.presets.map((p) => [p.id, label(`guitar.tuning.${p.id}`)])];
          const menu = createChoiceMenu({ options: opts, value: tc.hereId && tc.hereId !== 'custom' ? tc.hereId : '', label: label('guitar.tuningChange'), act: 'tuning-change', follow: true,
            onPick: (v) => { try { app.setTuningChange(v || null, ids, range, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); } });
          menu.title = label('guitar.tuningChange'); menu.addEventListener('mousedown', (e) => e.preventDefault()); items.push(menu);
        }
        const del = btn('🗑', label('capo.remove'), () => { try { app.removeCapo(ids, range, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); }); del.disabled = !st.hasEntry; items.push(del);
        for (const b of items) b.addEventListener('mousedown', (e) => e.preventDefault());
        renderPacked(items, { level: 'page' });
        return;
      }
    }
    // marks menu / pages: the bar is replaced by the five categories, then by the buttons of the chosen one (the six chosen, "+" for the others);
    // choosing a mark goes back to the normal bar, a tap in the empty space closes the page
    if (marksPage && app.markTargets(ids, range, view.id).length) {
      const st = app.marksState(ids, range, view.id);
      const target = { ids, range };
      const close = () => { marksPage = null; drawBar(); };
      let created = null; // id of the bend just inserted: it is selected so its size / curve controls appear at once
      const run = (fn) => () => {
        marksPage = null;
        try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); }
        if (created) { const id = created; created = null; view.select([id]); }
        drawBar();
      };
      const on = (b, active) => { b.setAttribute('aria-pressed', String(!!active)); if (active) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; return b; };
      const mark = (key) => {
        const i = key.indexOf(':'); const group = key.slice(0, i); const name = key.slice(i + 1);
        if (group === 'capo') { // opens the capo drawer (the tablature staff the capo goes to must exist)
          const cb = btn('Capo', label('marks.capo'), () => { capoOpen = true; marksPage = null; drawBar(); });
          cb.setAttribute('data-mark', 'capo-open'); cb.style.cssText += ';font:var(--w-bold,700) 12px sans-serif';
          if (tabSheet()) applyIconName(cb, 'capo');
          if (!app.capoState(ids, range, view.id).available) { cb.disabled = true; cb.style.opacity = '0.45'; cb.title = label('capo.noTab'); }
          return cb;
        }
        let text = name; let title = name; let active = false; let fn = () => {}; let disabled = false; let iconGroup = group; let iconKey = name;
        if (group === 'artic') { text = title = label(`marks.artic.${name}`); active = st.articulations.all.has(name); fn = () => app.toggleArticulation(name, target, view.id); }
        else if (group === 'dyn' && name === 'clear') { text = '✕'; title = label('marks.dynamicClear'); fn = () => app.setDynamic(null, target, view.id); disabled = st.dynamic === null; iconGroup = null; }
        else if (group === 'dyn') { active = st.dynamic === name; fn = () => app.setDynamic(name, target, view.id); }
        else if (group === 'span') { const k = { ...{ cresc: 'marks.cresc', decresc: 'marks.decresc', slur: 'marks.slur', hopo: 'marks.hopo' } }[name]; text = title = label(k); const state = st.spans[name]; active = state === 'present'; disabled = state === null; fn = () => app.toggleSpanner(name, target, view.id); }
        else if (group === 'tech') { text = title = label(`marks.tech.${name}`); active = st.techLines[name] === 'present'; disabled = st.techLines[name] === null; fn = () => app.toggleTechLine(name, target, view.id); }
        else if (group === 'chord' && (name === 'arpeggio-slower' || name === 'arpeggio-faster')) { text = title = label(`marks.chord.${name}`); disabled = !st.hasArpeggio; fn = () => app.stepArpeggio(name === 'arpeggio-slower' ? 1 : -1, target, view.id); iconGroup = null; }
        else if (group === 'chord') { text = title = label(`marks.chord.${name}`); active = st.chordProps.has(name); fn = () => app.toggleChordProp(name, target, view.id); }
        else if (group === 'flag') { text = title = label(`marks.flag.${name}`); active = st.noteFlags.has(name); fn = () => app.toggleNoteFlag(name, target, view.id); }
        else if (group === 'bend' && name === 'wheel') {
          text = title = label('marks.bend.wheel'); disabled = !app.wheelTargets(ids, view.id).length;
          fn = () => { const made = app.addWheel({ ids }, view.id); created = made?.[0]?.id ?? null; };
        }
        else if (group === 'bend') { text = title = label(`marks.bend.${name}`); fn = () => { const made = app.addBend(name === 'release' ? 'bend' : name, { ids, semitones: name === 'release' ? -bendSemitones : bendSemitones }, view.id); created = made?.[0]?.id ?? null; }; }
        const b = on(btn(text, title, run(fn)), active);
        b.setAttribute('data-mark', `${group}-${name}`);
        if (iconGroup) markIcon(b, glyphs, iconGroup, iconKey);
        if (disabled) { b.disabled = true; b.style.opacity = '0.45'; if (group === 'span' || group === 'tech') b.title = label('marks.noSpan'); }
        return b;
      };
      const pageItems = [];
      if (!marksPage.cat) {
        for (const c of MARK_CATEGORIES) {
          if (c.id === 'bend' && !app.bendTargets(ids, view.id).length) continue;
          const b = btn('', label(c.titleKey), () => { marksPage = { cat: c.id, page: 0 }; drawBar(); });
          markIcon(b, glyphs, c.icon[0], c.icon[1]);
          b.setAttribute('data-marks-category', c.id);
          pageItems.push(b);
        }
      } else {
        const cat = categoryOf(marksPage.cat);
        // every button of the category in the order of Jean's choice; the bar cuts them into pages by their real widths
        // the bends of a guitar (with an arrival note) only for a plucked-string instrument or a tablature; everywhere else the wheel is the way to bend a note
        const guitarBends = cat.id !== 'bend' || app.guitarBendTargets(ids, view.id).length > 0;
        const catItems = allKeys(cat).filter((k) => guitarBends || k === 'bend:wheel').map(mark);
        for (const b of catItems) b.addEventListener('mousedown', (ev) => ev.preventDefault());
        renderPacked(catItems, { page: marksPage.page ?? 0, onPage: (n) => { marksPage = { cat: cat.id, page: n }; drawBar(); }, level: 'page' });
        void close;
        return;
      }
      for (const b of pageItems) b.addEventListener('mousedown', (e) => e.preventDefault());
      renderPacked(pageItems, { level: 'menu' });
      void close;
      return;
    }
    // measure bar page: the right-hand barline of the measure (or of the last measure of the range), the repeat signs and the volta; a start repeat belongs to the first
    // measure (it sits on its left); choosing something goes back to the normal bar, a tap in the empty space goes one step back
    if (barPage) {
      const sysT = app.systemTarget ? app.systemTarget(ids, range, target, view.id) : null;
      if (sysT) {
        const bars = view.movement().masterbars;
        const firstId = sysT.measureId;
        const lastIdBar = bars[Math.min(bars.length - 1, bars.findIndex((b) => b.id === firstId) + sysT.span - 1)].id;
        const lastMb = bars.find((b) => b.id === lastIdBar);
        const st = app.systemState(sysT, view.id) ?? {};
        const stEnd = app.systemState({ measureId: lastIdBar, position: [0, 1] }, view.id) ?? {};
        const curType = app.doc.get(lastMb, PID.BAR_TYPE);
        const on = (b, active) => { b.setAttribute('aria-pressed', String(!!active)); if (active) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; return b; };
        const doEdit = (name, fn) => () => {
          barPage = null;
          let made;
          try { made = app.systemEdit(name, fn, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); }
          drawBar();
          return made;
        };
        const mk = (key) => {
          const [group, name] = key.split(':');
          let title; let active = false; let fn; let icon = null;
          if (group === 'bar') { title = label(`bar.type.${name}`); active = curType === name && !stEnd.repeatEnd; fn = doEdit('Barre', (d, mv, sys) => sys.setBarType(d, mv, lastIdBar, name)); icon = barIcon(name); }
          else if (name === 'start') { title = label('system.repeatStart'); active = !!st.repeatStart; fn = doEdit('Reprise', (d, mv, sys) => sys.toggleRepeatStart(d, mv, firstId)); icon = barIcon('repeatStart'); }
          else if (name === 'end') { title = label('system.repeatEnd'); active = !!stEnd.repeatEnd; fn = doEdit('Reprise', (d, mv, sys) => sys.toggleRepeatEnd(d, mv, lastIdBar)); icon = barIcon('repeatEnd'); }
          else { // volta: a first ending "1." over the measures; the editor opens at once to choose its numbers and whether it is open
            title = label('volta.add'); active = !!st.volta;
            fn = () => { const made = doEdit('Volta', (d, mv, sys) => sys.toggleVolta(d, mv, firstId, { span: sysT.span, numbers: [1] }))(); if (made?.id) view.select([made.id]); }; // the volta is selected: its own bar (numbers, open / closed, delete, settings) takes the place of this one
          }
          const b = on(btn(icon ? '' : '1.', title, fn), active);
          if (icon) { b.append(icon); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; } else markIcon(b, glyphs, 'volta', '1');
          b.setAttribute('data-bar', key);
          return b;
        };
        const keys = ['bar:simple', 'bar:double', 'bar:final', 'rep:start', 'rep:end', 'volta:1', 'bar:reverseFinal', 'bar:heavy', 'bar:heavyHeavy', 'bar:dashed', 'bar:dotted', 'bar:short', 'bar:tick'];
        const buttons = keys.map(mk);
        // the repeat that ENDS on this measure: how many times it is played (− n +) and the text « x4 » written above its bar; the page stays open while these are used
        if (stEnd.repeatEnd) {
          const count = stEnd.repeatCount ?? 2;
          const keep = (name, fn) => () => { try { app.systemEdit(name, fn, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); };
          const step = (d, text, key) => {
            const b = btn(text, label(key), keep('Reprise', (dd, mv, sys) => sys.setRepeatCount(dd, mv, lastIdBar, count + d)));
            b.setAttribute('data-bar', d < 0 ? 'rep:less' : 'rep:more'); b.setAttribute('data-keep', ''); b.style.cssText += ';font:var(--w-bold,700) 18px sans-serif';
            b.disabled = d < 0 ? count <= 2 : count >= 99;
            return b;
          };
          const n = document.createElement('output');
          n.textContent = `${count}×`; n.setAttribute('data-keep', ''); n.setAttribute('data-repeat-count', String(count)); n.setAttribute('role', 'status'); n.setAttribute('aria-label', label('system.repeatCount', { n: count }));
          n.style.cssText = 'min-width:2.4em;text-align:center;align-self:center;font:var(--w-bold,700) 16px sans-serif';
          const txt = on(btn(`x${count}`, label('system.repeatShowText'), keep('Reprise', (dd, mv, sys) => sys.setRepeatText(dd, mv, lastIdBar, stEnd.repeatText ? '' : 'auto'))), !!stEnd.repeatText);
          txt.setAttribute('data-bar', 'rep:text'); txt.setAttribute('data-keep', ''); txt.style.cssText += ';font:var(--w-bold,700) 14px sans-serif';
          buttons.push(step(-1, '−', 'system.repeatLess'), n, step(1, '+', 'system.repeatMore'), txt);
        }
        renderPacked(buttons, { page: barPage.page ?? 0, onPage: (n) => { barPage = { page: n }; drawBar(); }, level: 'page' });
        return;
      }
      barPage = null;
    }
    // active chord cell: every cell action (previous / next, erase, %, %%, N.C., split, restore) lives in the chord entry window at the bottom; the bar keeps only the generic buttons
    // buttons of a measure / range context are grouped in menus: edit, playback, insert measures, automation, more (the bar shows the menu buttons, a page shows a group)
    // insert measures: « +1 », « +4 », « +8 » (short press = after, to the right ; long press = before, to the left) and « … » which swaps the page for
    // « before », « after » and a stepper of the number of measures (the drawer stays open while the stepper is used)
    const insertButtons = (firstId, lastId) => {
      const go = (where, count) => {
        rangePage = null;
        try { app.insertMeasures({ measureId: where === 'before' ? firstId : lastId, where, count }); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); }
        drawBar();
      };
      const out = [];
      if (!(rangePage?.menu === 'insert' && rangePage.many)) {
        for (const n of [1, 4, 8]) {
          const b = btn(`+${n}`, label('measure.insertN', { n }), () => {});
          b.style.cssText += ';font:var(--w-bold,700) 14px sans-serif'; b.setAttribute('data-action', `measure-insert-${n}`);
          markLongPress(b); bindShortLong(b, { onShort: () => go('after', n), onLong: () => go('before', n) });
          out.push(b);
        }
        const dots = btn('', label('measure.insertMany'), () => { rangePage = { menu: 'insert', page: 0, many: true }; drawBar(); });
        applyIconName(dots, 'ellipsis'); dots.setAttribute('data-action', 'measure-insert-many'); dots.setAttribute('data-keep', '');
        out.push(dots);
      } else {
        const side = (where, ic1, ic2, key) => { const b = btn('', label(key), () => go(where, insertCount)); b.append(icon(ic1, { size: '1.1em' }), icon(ic2, { size: '1.1em' })); b.style.cssText += ';display:inline-flex;align-items:center;justify-content:center;gap:1px'; b.setAttribute('data-action', `measure-insert-${where}`); return b; };
        const step = (d, text, key) => { const b = btn(text, label(key), () => { insertCount = Math.min(64, Math.max(1, insertCount + d)); drawBar(); }); b.setAttribute('data-keep', ''); b.setAttribute('data-action', d < 0 ? 'measure-insert-less' : 'measure-insert-more'); return b; };
        const n = document.createElement('output'); n.textContent = String(insertCount); n.setAttribute('data-keep', ''); n.setAttribute('data-insert-count', ''); n.style.cssText = 'min-width:2.2em;text-align:center;align-self:center;font:var(--w-bold,700) 16px sans-serif;font-variant-numeric:tabular-nums';
        out.push(side('before', 'arrow-left', 'plus', 'measure.insertBefore'), side('after', 'plus', 'arrow-right', 'measure.insertAfter'), step(-1, '−', 'system.less'), n, step(1, '+', 'system.more'));
      }
      return out;
    };
    const grp = { edit: [], play: [], insert: [], auto: [], more: [] };
    let filterBtn = null; // the selection filter on the first level of the bar (computers)
    const growHold = []; // the « grow » button: placed after the menus and the filter, before « Sys » (about where the ▭ that made the range sits in the bar of an element)
    let autoActive = false; // the range already has an automation lane (the menu button is outlined)
    if (range) {
      const mv = movementOfView();
      const set = (r) => { if (r) view.setRange(r); };
      const items2 = [
        // (the staves of the range are changed with the handles at its top and bottom: no buttons for that)
        ['✕', 'range.clear', () => view.setRange(null), 'range-clear'],
        ['⧉', 'range.copy', () => copyToClipboard(range), 'range-copy'],
        ['✂', 'range.cut', () => cutToClipboard(range), 'range-cut'],
        ['⎘', 'range.paste', () => pasteHere(), 'range-paste'],
        ['📋', 'range.pasteSystem', () => pasteSystem(), 'range-paste-system'],
        ...(onImportHere ? [['⇩', 'import.here', () => { const t = pasteTarget(); if (t) onImportHere(t, view.id); }, 'range-import']] : []),
        ['⧉+', 'range.duplicate', () => {}, 'range-duplicate'],
        ['⌫', 'range.empty', () => app.clearRange(range, view.id), 'range-empty'],
      ];
      // « Measure entry » (tablet, phone): the measure fills the top of the screen, the entry tools stay at the bottom
      if (tabSheet() && measureFocus && range.from.measureId) items2.push(['', 'focus.open', () => measureFocus.start({ measureId: range.from.measureId, staffId: range.staffIds[0] ?? null }), 'range-focus']);
      // « Grow »: a chord or a part of a measure becomes the whole measure(s), a whole measure becomes the whole staff (one button, three states with the ▭ that made the range)
      const spanG = rangeMeasureSpan(mv, range);
      if (spanG) {
        const total = mv.masterbars.length;
        if (!rangeIsWholeMeasures(mv, range)) items2.splice(1, 0, [label('range.growMeasure.short'), 'range.growMeasure', () => { markKeep(growBtnEl); set(rangeFromMeasures(app.doc, mv, range.staffIds, spanG.first, spanG.last)); }, 'range-grow']);
        else if (spanG.first > 0 || spanG.last < total - 1) items2.splice(1, 0, [label('range.growStaff.short'), 'range.growStaff', () => { markKeep(growBtnEl); set(rangeFromMeasures(app.doc, mv, range.staffIds, 0, total - 1)); }, 'range-grow']);
      }
      // plusieurs mesures : bouton « toute la hauteur » (toutes les portées du Mouvement)
      const spanM = rangeMeasureSpan(mv, range);
      if (spanM && spanM.last > spanM.first && range.staffIds.length < flatStaves(mv).length) {
        items2.splice(0, 0, ['⇕', 'range.extendAll', () => set(extendRangeToAllStaves(app.doc, mv, range)), 'range-extend-all']);
      }
      if (app.canRemoveRangeMeasures(range)) items2.push(['🗑', 'range.removeMeasures', () => app.removeRangeMeasures(range, view.id), 'range-remove-measures']);
      // jouer / couper et masquer le décor : agissent sur ce que le FILTRE vise (une transaction annulable chacun)
      const playNext = app.nextRangePlayValue(range);
      if (playNext !== null) items2.push([playNext ? '♪' : '🔇', playNext ? 'range.playPlay' : 'range.playMute', () => app.toggleRangePlay(range, view.id), 'range-play']);
      const hideNext = app.nextRangeDecorHidden(range);
      if (hideNext !== null) items2.push([hideNext ? '🙈' : '👁', hideNext ? 'range.hideDecor' : 'range.showDecor', () => app.toggleRangeDecorHidden(range, view.id), 'range-decor']);
      const restsNext = app.nextRangeRestsHidden(range);
      if (restsNext !== null) items2.push([restsNext ? '🙈' : '👁', restsNext ? 'range.hideRests' : 'range.showRests', () => app.toggleRangeRestsHidden(range, view.id), 'range-rests']);
      if (app.rangeDiagramsShown(range) !== null) items2.push(['', 'diagram.range', () => app.toggleRangeDiagrams(range, view.id), 'range-diagrams']);
      if (lyricsUI) items2.push(['L', 'lyrics.open', () => lyricsUI.openBlock(range), 'lyrics-block']);
      if (onRecord && app.recordTarget?.(view.id)) items2.push(['⏺', 'record.open', () => onRecord(view.id), 'range-record']);
      for (const [text, key, fn, action] of items2) {
        const b = btn(text, label(key), fn); b.setAttribute('data-action', action);
        if (action === 'range-duplicate') bindDuplicate(b);
        if (action === 'range-focus') applyIconName(b, 'maximize-2');
        if (action === 'range-grow') { growBtnEl = b; if (tabSheet()) applyIconName(b, key === 'range.growMeasure' ? 'grow-measure' : 'grow-staff'); }
        if (action === 'range-diagrams') { applyIconName(b, 'guitar-head'); b.setAttribute('aria-pressed', String(app.rangeDiagramsShown(range))); if (app.rangeDiagramsShown(range)) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:#111;border:2px solid var(--sel-edge,#2d78ff)'; }
        if (text === 'L') b.style.cssText += ';font:italic 700 22px Georgia,"Times New Roman",serif';
        ({ 'range-clear': items, 'range-focus': items, 'range-grow': growHold, 'range-play': grp.play, 'range-record': grp.play, 'range-extend-all': grp.more, 'range-decor': grp.more, 'range-rests': grp.more, 'range-diagrams': grp.more, 'lyrics-block': grp.more }[action] ?? grp.edit).push(b);
      }
      // a range made of whole measures also offers what the chosen measure offered: loop, play from here, insert measures
      if (spanM && rangeIsWholeMeasures(mv, range)) {
        const movementIdx = view.movementIndex();
        const firstId = mv.masterbars[spanM.first].id;
        const lastId = mv.masterbars[spanM.last].id;
        if (player) {
          const mbtn = (text, key, fn, action, index) => {
            const played = player.isPlayed(movementIdx, index);
            const b = btn(text, played ? label(key) : label('measure.notPlayed'), () => { if (played) fn(); });
            b.setAttribute('data-action', action); applyIconName(b, MEASURE_ICON[action]);
            if (!played) { b.disabled = true; b.style.opacity = '0.45'; }
            grp.play.push(b);
          };
          mbtn(label('measure.loopFrom'), 'measure.loopFrom', () => player.markLoopAt('from', movementIdx, spanM.first), 'measure-loop-from', spanM.first);
          mbtn(label('measure.loopTo'), 'measure.loopTo', () => player.markLoopAt('to', movementIdx, spanM.last), 'measure-loop-to', spanM.last);
          mbtn(label('measure.playFrom'), 'measure.playFrom', () => player.playFrom(movementIdx, spanM.first), 'measure-play-from', spanM.first);
        }
        grp.insert.push(...insertButtons(firstId, lastId));
      }
      // mixer automation of the tracks under the range: a level (0..127) or a mute over the range, with a fade, or the fader given back
      {
        const st = app.rangeAutomationState(range);
        if (st.tracks) {
          autoActive = !!(st.hasVolume || st.hasMute);
          {
            const level = autoLevel ?? st.level; // the level in force on the range (the lane's, else the fader)
            const run = (fn) => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } };
            const row = [
              ['−', 'automation.lower', () => run(() => { autoLevel = Math.max(0, level - 1); app.setRangeAutomation(range, { param: 'volume', value: autoLevel / 127, fade: autoFade }, view.id); }), 'automation-less'],
              [null, null, null, 'automation-value'],
              ['+', 'automation.raise', () => run(() => { autoLevel = Math.min(127, level + 1); app.setRangeAutomation(range, { param: 'volume', value: autoLevel / 127, fade: autoFade }, view.id); }), 'automation-more'],
              [`F:${{ beat: 'T', measure: 'M', none: 'I' }[autoFade]}`, 'automation.fade', () => { autoFade = autoFade === 'beat' ? 'measure' : autoFade === 'measure' ? 'none' : 'beat'; drawBar(); }, 'automation-fade'],
              [label('automation.apply'), 'automation.applyTitle', () => run(() => app.setRangeAutomation(range, { param: 'volume', value: level / 127, fade: autoFade }, view.id)), 'automation-apply'],
              ['🔇', 'automation.mute', () => run(() => app.setRangeAutomation(range, { param: 'mute', value: 1 }, view.id)), 'automation-mute'],
              ['↺', 'automation.release', () => run(() => { app.setRangeAutomation(range, { param: 'volume', value: null, fade: autoFade }, view.id); if (st.hasMute) app.setRangeAutomation(range, { param: 'mute', value: null }, view.id); }), 'automation-release'],
            ];
            for (const [text, key, fn, action] of row) {
              if (action === 'automation-value') { const v = document.createElement('span'); v.setAttribute('data-action', action); v.textContent = String(level); v.title = label('automation.level'); v.style.cssText = 'min-width:2.4em;text-align:center;align-self:center;font-variant-numeric:tabular-nums'; grp.auto.push(v); continue; }
              const b = btn(text, label(key), fn); b.setAttribute('data-action', action);
              if (action === 'automation-fade') { b.style.cssText += ';font:var(--w-bold,700) 14px var(--ui-font,sans-serif)'; markCyclic(b, 3, { beat: 0, measure: 1, none: 2 }[autoFade]); }
              grp.auto.push(b);
            }
          }
        }
      }
      // filtre de sélection : bouton à bascule + pastille (nombre de cases décochées) ; la feuille s'ouvre à côté de la barre
      const nOff = excludedCount(app.filter());
      const fb = btn(nOff ? `▽ ${nOff}` : '▽', nOff ? label('filter.active', { n: nOff }) : label('filter.open'), () => { filterOpen = !filterOpen; drawBar(); });
      fb.setAttribute('data-action', 'range-filter'); fb.setAttribute('aria-expanded', String(filterOpen));
      if (nOff) fb.style.cssText += ';background:var(--warn-soft,#ffe9b8);border:2px solid #d08a00;font-weight:var(--w-bold,700)';
      if (tabSheet()) grp.more.push(fb); else filterBtn = fb; // a computer has room for it on the first level of the bar (tablet and phone: in the « … » menu)
      // transposition of the music over the chosen measures (the window reads the selection when it opens)
      const tb = btn('♯♭', label('transpose.openHint'), () => openTransposeDialog({ app, label, movement: view.movementIndex() }));
      tb.setAttribute('data-action', 'range-transpose'); tb.style.cssText += ';font:var(--w-bold,700) 14px var(--ui-font,sans-serif)';
      if (tabSheet()) applyIconName(tb, 'transpose');
      grp.more.push(tb);
      // the time signature of the chosen measures (the window reads the selection when it opens)
      const ts = btn('4/4', label('timesig.openHint'), () => openTimeSigDialog({ app, label, movement: view.movementIndex() }));
      ts.setAttribute('data-action', 'range-timesig'); ts.style.cssText += ';font:var(--w-bold,700) 12px var(--ui-font,sans-serif);padding:0 8px';
      grp.more.push(ts);
      // the key signature of the chosen measures (the window reads the selection when it opens)
      const ks = btn('♯♭ 0', label('keysig.openHint'), () => openKeySigDialog({ app, label, movement: view.movementIndex() }));
      ks.setAttribute('data-action', 'range-keysig'); ks.style.cssText += ';font:var(--w-bold,700) 12px var(--ui-font,sans-serif);padding:0 8px';
      if (tabSheet()) { ks.replaceChildren(glyphRowIcon(glyphs, ['accidentalSharp'], { side0: 2.6 }) ?? '♯'); ks.style.cssText += ';display:inline-flex;align-items:center;justify-content:center'; }
      grp.more.push(ks);
      // what is written over the chosen measures, made into a chord pattern (and a style): the reverse of "write as real tracks"
      const pb = btn('Motif', label('patternFromNotes.openHint'), () => openPatternFromNotesDialog({ app, label, movement: view.movementIndex() }));
      pb.setAttribute('data-action', 'range-pattern'); pb.style.cssText += ';font:var(--w-bold,700) 12px var(--ui-font,sans-serif);padding:0 8px';
      if (tabSheet()) applyIconName(pb, 'pattern');
      grp.more.push(pb);
      // the chosen measures shown as slashes (one per beat) instead of their notes: display only, on the staves of the selection
      const slashState = app.slashesState(range);
      if (slashState) {
        const sb = btn('/ / /', label(slashState === 'all' ? 'range.slashesOff' : 'range.slashes'), () => { try { app.toggleSlashes(range, view.id); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); });
        sb.setAttribute('data-action', 'range-slashes'); sb.setAttribute('aria-pressed', String(slashState === 'all')); sb.style.cssText += ';font:var(--w-bold,700) 12px var(--ui-font,sans-serif);padding:0 8px;white-space:nowrap';
        if (slashState === 'all') sb.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)';
        grp.more.push(sb);
      }
    }
    // un élément déplaçable sélectionné : activer la poignée de déplacement ; et le remettre à sa place s'il a été déplacé
    const movable = !range && ids.length ? app.movable(ids, view.id) : [];
    if (movable.length) {
      const mb = btn('✥', label('move.toggle'), () => { moveMode = !moveMode; drawMoveHandle(); drawBar(); });
      mb.setAttribute('data-action', 'move-toggle'); mb.setAttribute('aria-pressed', String(moveMode));
      if (moveMode) mb.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)';
      items.push(mb);
      if (movable.some((id) => { const o = app.offsetOf(id); return o[0] !== 0 || o[1] !== 0; })) {
        const rb = btn('↺', label('move.reset'), () => { app.resetPositions(movable, view.id); drawMoveHandle(); drawBar(); });
        rb.setAttribute('data-action', 'move-reset');
        items.push(rb);
      }
    } else if (moveMode) { moveMode = false; drawMoveHandle(); }
    // a tempo selected: its number (a pill to drag, tap for the stepper) and its beat unit (a button that goes round) can be edited; the playback reads them
    const tempoSel = !range && ids.length === 1 ? app.tempoInfo(ids[0]) : null;
    if (tempoSel) {
      const tp = createScrubPill({ min: 5, max: 999, value: Math.round(tempoSel.bpm), step: 1, pxPerStep: 2, format: (v) => `${v}`, title: label('tempo.edit'), label: { down: label('tempo.slower'), up: label('tempo.faster') },
        onCommit: (v) => app.setTempoValue(tempoSel.id, { bpm: v }, view.id) });
      tp.el.setAttribute('data-tempo-pill', ''); tp.el.style.minWidth = '52px';
      const units = [['metNoteQuarterUp'], ['metNoteQuarterUp', 'metAugmentationDot'], ['metNote8thUp'], ['metNoteHalfUp']];
      const unitOf = (u) => { const i = TEMPO_UNITS.findIndex((x) => x.base === u.base && (x.dots ?? 0) === (u.dots ?? 0)); return i < 0 ? 0 : i; };
      const k = unitOf(tempoSel.beatUnit);
      const ub = btn('', label('tempo.unit'), () => app.setTempoValue(tempoSel.id, { beatUnit: TEMPO_UNITS[(k + 1) % TEMPO_UNITS.length] }, view.id));
      ub.setAttribute('data-action', 'tempo-unit'); ub.replaceChildren(glyphRowIcon(glyphs, units[k], { side0: 2.4, px: 20 }) ?? document.createTextNode('♩')); markCyclic(ub, TEMPO_UNITS.length, k);
      items.push(ub, tp.el);
    }
    // slur / tie / hammer-on / hairpin selected: grip mode (end points, control points, hairpin aperture) and reset of the grips
    const gripId = gripEntryId();
    if (gripId) {
      const gb = btn('◎', label('grips.toggle'), () => { gripMode = !gripMode; drawGripHandles(); drawBar(); });
      gb.setAttribute('data-action', 'grips-toggle'); gb.setAttribute('aria-pressed', String(gripMode));
      if (gripMode) gb.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)';
      items.push(gb);
      if (app.hasGrips(gripId)) {
        const gr = btn('↺', label('grips.reset'), () => { app.resetGrips(gripId, {}, view.id); drawGripHandles(); drawBar(); });
        gr.setAttribute('data-action', 'grips-reset');
        items.push(gr);
      }
    } else if (gripMode) { gripMode = false; drawGripHandles(); }
    // une note ou un accord sélectionné : saisir les paroles à partir d'ici (geste B)
    if (lyricsUI && ids.length === 1 && !range && app.lyricsCanStart(ids[0])) {
      const lb = btn('L', label('lyrics.start'), () => lyricsUI.start(ids[0])); lb.style.cssText += ';font:italic 700 22px Georgia,"Times New Roman",serif';
      lb.setAttribute('data-action', 'lyrics-start');
      items.push(lb);
    }
    let rangeItemBtn = null;
    // un accord, une note ou un silence sélectionné : en faire une plage (au toucher, pas de Maj + clic)
    if (ids.length === 1 && !range && rangeFromItem(app.doc, movementOfView(), ids[0])) {
      const b = btn('▭', label('range.fromItem'), () => { markKeep(b); view.setRange(rangeFromItem(app.doc, movementOfView(), ids[0])); });
      b.setAttribute('data-action', 'range-from-item');
      rangeItemBtn = b; // placed after the delete button (see below)
    }
    // an active chord cell: a range of one measure of the chord track, to be widened with its handles (several measures cannot be picked on the chord grid)
    if (cell && !range && !rangeItemBtn) {
      const index = view.measureIndexOf(cell.measureId);
      if (index >= 0) {
        const b = btn('▭', label('range.fromCell'), () => { markKeep(b); view.setRange(rangeFromMeasures(app.doc, movementOfView(), [cell.staffId], index, index)); });
        b.setAttribute('data-action', 'range-from-cell');
        rangeItemBtn = b;
        // computers: the selection filter on the bar of an active chord cell too; its sheet shows what the measure of the cell holds (the filter itself is the general one)
        if (!tabSheet()) {
          const nOffCell = excludedCount(app.filter());
          const fcb = btn(nOffCell ? `▽ ${nOffCell}` : '▽', nOffCell ? label('filter.active', { n: nOffCell }) : label('filter.open'), () => { filterOpen = !filterOpen; drawBar(); });
          fcb.setAttribute('data-action', 'range-filter'); fcb.setAttribute('aria-expanded', String(filterOpen));
          if (nOffCell) fcb.style.cssText += ';background:var(--warn-soft,#ffe9b8);border:2px solid #d08a00;font-weight:var(--w-bold,700)';
          filterBtn = fcb;
          filterCellRange = rangeFromMeasures(app.doc, movementOfView(), [cell.staffId], index, index);
        }
      }
    }
    // boucle et lecture : cible = mesure choisie ou mesure de la case active (le masterbar seul, aucun élément en jeu)
    if (player && target && !ids.length) {
      const movement = view.movementIndex();
      const index = view.measureIndexOf(target);
      const played = index >= 0 && player.isPlayed(movement, index);
      const mbtn = (text, key, fn, action) => {
        const b = btn(text, played ? label(key) : label('measure.notPlayed'), () => { if (played) fn(); });
        b.setAttribute('data-action', action); applyIconName(b, MEASURE_ICON[action]);
        if (!played) { b.disabled = true; b.style.opacity = '0.45'; }
        return b;
      };
      grp.play.push(
        mbtn(label('measure.loopFrom'), 'measure.loopFrom', () => player.markLoopAt('from', movement, index), 'measure-loop-from'),
        mbtn(label('measure.loopTo'), 'measure.loopTo', () => player.markLoopAt('to', movement, index), 'measure-loop-to'),
        mbtn(label('measure.playFrom'), 'measure.playFrom', () => player.playFrom(movement, index), 'measure-play-from'),
      );
    }
    // insertion / suppression de mesures : cible = mesure choisie ou mesure de la case active (tiroir : avant, après, plusieurs…)
    if (target && !ids.length) {
      grp.insert.push(...insertButtons(target, target));
      const copyRangeOfMeasure = chosenRange();
      if (copyRangeOfMeasure) {
        const copyBtn = btn('⧉', label('measure.copy'), () => copyToClipboard(copyRangeOfMeasure));
        copyBtn.setAttribute('data-action', 'measure-copy');
        grp.edit.push(copyBtn);
        const cutBtn = btn('✂', label('measure.cut'), () => cutToClipboard(copyRangeOfMeasure));
        cutBtn.setAttribute('data-action', 'measure-cut');
        grp.edit.push(cutBtn);
        const pasteBtn = btn('⎘', label('range.paste'), () => pasteHere());
        pasteBtn.setAttribute('data-action', 'measure-paste');
        grp.edit.push(pasteBtn);
        const pasteSysBtn = btn('📋', label('range.pasteSystem'), () => pasteSystem());
        pasteSysBtn.setAttribute('data-action', 'measure-paste-system');
        grp.edit.push(pasteSysBtn);
        if (onImportHere) {
          const importBtn = btn('⇩', label('import.here'), () => { const t = pasteTarget(); if (t) onImportHere(t, view.id); });
          importBtn.setAttribute('data-action', 'measure-import');
          grp.edit.push(importBtn);
        }
        const dupBtn = btn('⧉+', label('range.duplicate'), () => {});
        dupBtn.setAttribute('data-action', 'measure-duplicate'); bindDuplicate(dupBtn);
        grp.edit.push(dupBtn);
      }
      const delMeasure = btn('🗑', label('measure.delete'), () => run(() => app.deleteMeasure(target)));
      delMeasure.setAttribute('data-action', 'measure-delete');
      grp.edit.push(delMeasure);
      const clearMeasureBtn = btn('⌫', label('measure.clear'), () => run(() => app.clearMeasure(target, view.id)));
      clearMeasureBtn.setAttribute('data-action', 'measure-clear');
      grp.edit.push(clearMeasureBtn);
    }
    // system objects (masterbar): tempo, swing, fermata, jumps, markers, repeats, voltas. Placed from a note, a range or a measure of ANY staff.
    const sysTarget = app.systemTarget ? app.systemTarget(ids, range, target, view.id) : null;
    // menu buttons of the measure / range context (edit, playback, insert measures, automation, more)
    // the mixer automation lives inside the Playback menu (one level deeper: it is not used often)
    if (grp.auto.length) {
      const ab = btn('', label('rangeMenu.auto'), () => { rangePage = { menu: 'auto', page: 0, from: 'play' }; drawBar(); });
      applyIconName(ab, 'sliders-vertical'); ab.setAttribute('data-range-menu', 'auto'); ab.setAttribute('data-keep', '');
      if (autoActive) ab.style.cssText += ';outline:2px solid var(--sel-edge,#2878ff)';
      grp.play.push(ab);
    }
    for (const [name, icon, titleKey] of [['edit', 'scissors', 'rangeMenu.edit'], ['play', 'play', 'rangeMenu.play'], ['insert', 'plus', 'rangeMenu.insert'], ['more', 'ellipsis', 'rangeMenu.more']]) {
      if (!grp[name].length) continue;
      const mb = btn('', label(titleKey), () => { rangePage = { menu: name, page: 0 }; marksPage = null; barPage = null; sysPage = null; drawBar(); });
      applyIconName(mb, icon); mb.setAttribute('data-range-menu', name);
      if (name === 'play' && autoActive) mb.style.cssText += ';outline:2px solid var(--sel-edge,#2878ff)';
      items.push(mb);
    }
    if (filterBtn) items.push(filterBtn);
    if (dupQuick && dupQuick === marksFor && (range || target)) { // just duplicated: the button is back on the first bar
      const again = btn('⧉+', label('range.duplicateAgain'), () => {}); again.setAttribute('data-action', 'duplicate-again'); bindDuplicate(again); items.push(again);
    }
    items.push(...growHold);
    if (sysTarget) {
      const tg = btn('Sys', label('system.toggle'), () => { sysPage = { path: [], page: 0 }; marksPage = null; barPage = null; rangePage = null; drawBar(); }); tg.style.cssText += ';font:var(--w-bold,700) 12px var(--ui-font,sans-serif)';
      tg.setAttribute('data-action', 'system-toggle'); if (tabSheet()) applyIconName(tg, 'system-staves');
      items.push(tg);
      // the container: attached to a staff and measures (not a system object), so it has its own button next to Sys
      const cb = btn('', label('sys.menu.container'), () => { sysPage = { path: ['container'], page: 0, standalone: true }; marksPage = null; barPage = null; rangePage = null; drawBar(); });
      applyIconName(cb, 'container-staff'); cb.setAttribute('data-action', 'container-toggle');
      items.push(cb);
      // the measure bar (barline type, repeats, volta): for a chosen measure or a range of whole measures
      if (target || (range && rangeIsWholeMeasures(movementOfView(), range))) {
        const bb = btn('', label('bar.toggle'), () => { barPage = { page: 0 }; marksPage = null; sysPage = null; rangePage = null; drawBar(); });
        bb.append(barIcon('final', '1.3em')); bb.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
        bb.setAttribute('data-action', 'bar-toggle');
        items.push(bb);
      }
    }
    // marks on chords: articulations, dynamics, hairpins, slurs (one toggle button, then a drawer; every button = one undoable transaction)
    const markCount = app.markTargets ? app.markTargets(ids, range, view.id).length : 0;
    // a selected staff container: span, stack order, text
    // the container itself, or an element of the nested score it holds (a tap on the notes of a nested score must offer the container controls too)
    let containerEl = ids.length === 1 && !range ? app.doc.find(ids[0]) : null;
    while (containerEl && containerEl.type !== 'staffContainer') containerEl = app.doc.parentOf(containerEl.id);
    if (containerEl && app.doc.movementOf(containerEl) !== view.movement()) containerEl = null; // inside the editor of that very score: no container controls
    if (containerEl?.type === 'staffContainer') {
      const guardBox = (fn) => () => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } };
      const span = containerEl.props?.span ?? 1;
      const slot = containerEl.props?.containerPlacement === 'between';
      const width = containerEl.props?.containerWidth ?? null;
      const slotW = Math.round((width ?? 6) * 2) / 2;
      const hasScore = !!containerEl.fragments?.length;
      // a container that holds a score keeps only: edit (opens the full-screen editor, where every setting lives), stack order; a text container has
      // no editor, so its extent (measures / width) stays here
      const defs = [
        ...(hasScore ? [] : slot ? [
          [`− ${label('container.wideShort')}`, 'container.widthLess', 'container-width-less', () => app.setSlotWidth(containerEl.id, Math.max(1, slotW - 1), view.id), false],
          [`+ ${label('container.wideShort')}`, 'container.widthMore', 'container-width-more', () => app.setSlotWidth(containerEl.id, slotW + 1, view.id), false],
          [label('container.autoShort'), 'container.widthAuto', 'container-width-auto', () => app.setSlotWidth(containerEl.id, null, view.id), width === null],
          [label('container.separatorShort'), 'container.separator', 'container-separator', () => app.setSlotSeparator(containerEl.id, !containerEl.props?.containerSeparator, view.id), !!containerEl.props?.containerSeparator],
        ] : [
          ['−', 'container.spanLess', 'container-span-less', () => app.setContainerSpan(containerEl.id, span - 1, view.id), span <= 1],
          ['+', 'container.spanMore', 'container-span-more', () => app.setContainerSpan(containerEl.id, span + 1, view.id), false],
        ]),
        // distance from the staff (stacked containers) — and the order in the stack when two or more share the staff
        ...(slot ? [] : [
          ['↑', 'container.away', 'container-away', () => app.moveContainerAway(containerEl.id, 0.5, view.id), false],
          ['↓', 'container.closer', 'container-closer', () => app.moveContainerAway(containerEl.id, -0.5, view.id), (containerEl.props?.containerGap ?? 0) <= 0],
        ]),
        ...(app.containerSiblings(containerEl.id) > 1 ? [
          ['▲', 'container.up', 'container-up', () => app.moveContainer(containerEl.id, -1, view.id), false],
          ['▼', 'container.down', 'container-down', () => app.moveContainer(containerEl.id, 1, view.id), false],
        ] : []),
        // zoom of what the container holds (a text or a diagram: the frame follows)
        ...(['text', 'chordDiagram', 'chordDiagramList'].includes(containerEl.props?.containerKind) ? [
          ['A−', 'container.zoomOut', 'container-zoom-out', () => app.zoomContainer(containerEl.id, -1, view.id), (containerEl.props?.containerScale ?? 1) <= 0.4],
          ['A+', 'container.zoomIn', 'container-zoom-in', () => app.zoomContainer(containerEl.id, 1, view.id), (containerEl.props?.containerScale ?? 1) >= 3],
        ] : []),
      ];
      for (const [text, key, action, fn, disabled] of defs) {
        const b = btn(text, label(key), guardBox(fn));
        b.setAttribute('data-action', action); b.disabled = disabled;
        items.push(b);
      }
      { // copy the container (it can then be pasted on another measure or staff, in the container page of the bar, and in the parts)
        const cb = btn('', label('container.copy'), guardBox(() => { app.setContainerClip(containerEl.id); entryMessage(label('container.copied')); }));
        applyIconName(cb, 'copy'); cb.setAttribute('data-action', 'container-copy');
        items.push(cb);
      }
      if (hasScore) { // listen to the score of the container alone
        const playing = app.containerPlaying(containerEl.id);
        const pb = btn('', label(playing ? 'container.stopListen' : 'container.listen'), guardBox(() => { if (!app.playContainer(containerEl.id)) entryMessage(label('container.nothingToHear')); }));
        applyIconName(pb, playing ? 'square' : 'play'); pb.setAttribute('data-action', 'container-play');
        items.push(pb);
      }
      if (onFragmentEdit && hasScore) {
        const eb = btn('✎', label('container.edit.fragment'), () => onFragmentEdit(containerEl.id));
        eb.setAttribute('data-action', 'container-edit-fragment');
        items.push(eb);
      }
      if (containerEl.props?.containerKind === 'chordDiagram' && onDiagramEdit) {
        const eb = btn('✎', label('container.edit.diagram'), () => onDiagramEdit(containerEl.id, view.id));
        eb.setAttribute('data-action', 'container-edit-diagram');
        items.push(eb);
      }
      if (containerEl.props?.containerKind === 'text') {
        const eb = btn('✎', label('container.edit'), () => {
          inlineUI.open({ anchor: () => { const r = view.selectionRects()[0]; return r ? { cx: (r.x1 + r.x2) / 2, top: r.y1, bottom: r.y2 } : null; }, value: containerEl.props.text ?? '', placeholder: label('inline.containerText'), aria: label('system.containerText'),
            onCommit: (text) => guardBox(() => app.setContainerText(containerEl.id, text, view.id))() });
        });
        eb.setAttribute('data-action', 'container-edit');
        items.push(eb);
      }
    }
    const hairpinEntry = ids.length === 1 && !range ? app.doc.findListEntry(ids[0]) : null;
    if (hairpinEntry?.kind === 'hairpin') {
      for (const [kind, text, key] of [['cresc', '<', 'marks.cresc'], ['decresc', '>', 'marks.decresc']]) {
        const hb = btn(text, label(key), () => app.setHairpinType(ids[0], kind, view.id));
        hb.setAttribute('data-action', `hairpin-type-${kind}`); hb.setAttribute('aria-pressed', String(hairpinEntry.entry.hairpinType === kind));
        if (hairpinEntry.entry.hairpinType === kind) hb.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)';
        items.push(hb);
      }
    }
    // a staff text already placed (selected): change its text, side, style and its line (« solo ––––| ») in place
    if (hairpinEntry?.kind === 'stafftext') {
      const st = hairpinEntry.entry; const staffId = hairpinEntry.owner.id; const textId = ids[0];
      const guardText = (fn) => () => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } };
      const upd = (patch) => guardText(() => app.updateStaffText(staffId, textId, patch, view.id));
      const pressed = (b, on, key) => { b.setAttribute('data-stafftext-edit', key); b.setAttribute('aria-pressed', String(on)); if (on) b.style.cssText += ';background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)'; return b; };
      const leslieSign = isLeslieSign(st); // its text always comes from the technique: no free-text edit, no line (re-pick a state in the Sys drawer: a new sign at the same instant replaces it)
      const edit = btn('✎', label('stafftext.edit'), () => {
        inlineUI.open({ anchor: () => { const r = view.selectionRects()[0]; return r ? { cx: (r.x1 + r.x2) / 2, top: r.y1, bottom: r.y2 } : null; }, value: st.text ?? '', placeholder: label('stafftext.placeholder'), aria: label('system.staffTextFree'),
          onCommit: (text) => guardText(() => app.updateStaffText(staffId, textId, { text }, view.id))() });
      });
      edit.setAttribute('data-stafftext-edit', 'text');
      const up = pressed(btn('', label('stafftext.above'), upd({ placement: 'above' })), st.placement === 'above', 'above'); applyIconName(up, 'triangle-up');
      const down = pressed(btn('', label('stafftext.below'), upd({ placement: 'below' })), st.placement === 'below', 'below'); applyIconName(down, 'triangle-down');
      const styleBtn = (key, text, title) => pressed(btn(text, label(title), upd({ style: key })), st.style === key, key);
      const n = styleBtn('normal', 'N', 'stafftext.normal'); n.style.fontWeight = '400';
      const i = styleBtn('italic', 'I', 'stafftext.italic'); i.style.cssText += ';font-style:italic;font-weight:600;font-family:Georgia,serif';
      const b = styleBtn('bold', 'B', 'stafftext.bold'); b.style.fontWeight = '800';
      const lineBtn = pressed(btn(st.line === 'dashed' ? '╌╌' : st.line === 'solid' ? '──' : '—', label(`stafftext.line.${st.line ?? 'none'}`), upd({ line: st.line === undefined ? 'solid' : st.line === 'solid' ? 'dashed' : null })), st.line !== undefined, 'line');
      lineBtn.style.cssText += ';font:var(--w-bold,700) 13px var(--ui-font,sans-serif);letter-spacing:-1px';
      items.push(...(leslieSign ? [up, down, n, i, b] : [edit, up, down, n, i, b, lineBtn]));
      if (st.line && !leslieSign) {
        const hook = pressed(btn('⌐', label('stafftext.hook'), upd({ hook: !st.hook })), !!st.hook, 'hook'); hook.style.cssText += ';font:var(--w-bold,700) 15px var(--ui-font,sans-serif)';
        const less = btn('−', label('stafftext.spanLess'), upd({ lineSpan: Math.max(1, (st.lineSpan ?? 1) - 1) })); less.setAttribute('data-stafftext-edit', 'span-less');
        const more = btn('+', label('stafftext.spanMore'), upd({ lineSpan: Math.min(64, (st.lineSpan ?? 1) + 1) })); more.setAttribute('data-stafftext-edit', 'span-more');
        const out = document.createElement('output');
        out.setAttribute('data-stafftext-edit', 'span'); out.textContent = String(st.lineSpan ?? 1); out.title = label('stafftext.span', { n: st.lineSpan ?? 1 });
        out.style.cssText = 'min-width:1.6em;text-align:center;font-variant-numeric:tabular-nums';
        items.push(hook, less, out, more);
      }
    }
    const bendEntry = ids.length === 1 && !range ? app.doc.findListEntry(ids[0]) : null;
    if (bendEntry?.kind === 'bend' && app.bendSemitones(ids[0]) !== null) {
      const size = app.bendSemitones(ids[0]);
      const guardBend = (fn) => () => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } };
      const less = btn('−', label('marks.bend.less'), guardBend(() => app.setBendSemitones(ids[0], Math.abs(size) - 1, view.id)));
      const more = btn('+', label('marks.bend.more'), guardBend(() => app.setBendSemitones(ids[0], Math.abs(size) + 1, view.id)));
      less.setAttribute('data-action', 'bend-size-less'); more.setAttribute('data-action', 'bend-size-more');
      const out = document.createElement('output');
      out.setAttribute('data-bend-amount', ''); out.textContent = `${Math.abs(size)} ${label('marks.bend.unit')}`; out.title = label('marks.bend.size');
      out.style.cssText = 'min-width:3.4em;text-align:center;font-variant-numeric:tabular-nums';
      items.push(less, out, more);
    }
    // bend graph (points over time, optionally curved): bends, dives, pre-bends, chains, and slight bend / dip / scoop
    if ((bendEntry?.kind === 'bend' || bendEntry?.kind === 'wheel') && onBendGraph && app.bendCurve(ids[0])?.editable) {
      const gb = btn('〰', label('bendGraph.open'), () => onBendGraph(ids[0]));
      gb.setAttribute('data-action', 'bend-graph');
      items.push(gb);
    }
    if (markCount) {
      const mt = btn('p·>', label('marks.toggle'), () => { marksPage = { cat: null }; drawBar(); });
      markIcon(mt, glyphs, 'artic', 'accentStaccato');
      mt.style.width = ''; mt.style.height = ''; mt.style.padding = ''; // same box as the other context-bar buttons (the square override made it shorter)
      mt.setAttribute('data-action', 'marks-toggle');
      items.push(mt);
    }
    // select similar: one thing selected → the same ones, or all of its kind, in the staff / track / movement (the selection then takes the usual actions: delete, colour…)
    if (ids.length === 1 && !range && !cell) {
      const options = [{ heading: label('similar.same') }, ...['staff', 'track', 'movement'].map((sc) => [`same:${sc}`, label(`similar.scope.${sc}`)]),
        { heading: label('similar.kind') }, ...['staff', 'track', 'movement'].map((sc) => [`kind:${sc}`, label(`similar.scope.${sc}`)])];
      const sm = createChoiceMenu({ options, value: '', label: label('similar.button'), act: 'select-similar', buttonText: '≈',
        onPick: (v) => { const [match, scope] = v.split(':'); const found = similarIds(app.doc.work, ids[0], { scope, match }); if (found.length) { view.select(found); entryMessage(label('similar.found', { n: found.length })); } } });
      sm.setAttribute('data-action', 'select-similar');
      items.push(sm);
    }
    // pitch and length retouches: ONE button (the sharp sign) opens the drawer (semitone / octave arrows, longer / shorter, cyclic accidental)
    if (ids.length && app.transposableNotes(ids).length) {
      const rb = btn('', label('retouch.open'), () => { retouchOpen = true; marksPage = null; barPage = null; sysPage = null; rangePage = null; drawBar(); });
      rb.setAttribute('data-action', 'retouch-toggle'); rb.append(glyphRowIcon(glyphs, ['accidentalSharp'], { side0: 2.6 }) ?? '♯'); rb.style.cssText += ';display:inline-flex;align-items:center;justify-content:center';
      items.push(rb);
    }
    // organ glissando: a white-key run written before the selected note (notation staves only: the model says whether it is allowed)
    if (!range && ids.length && app.glissandoRunInfo(ids, {}, view.id).allowed) {
      const gb = btn('', label('glissandoRun.open'), () => openGlissandoRunDialog({ app, label, ids, viewId: view.id, onDone: () => { entryMessage(''); drawBar(); } }));
      gb.setAttribute('data-action', 'glissando-run'); if (!applyIconName(gb, 'ramp')) gb.textContent = '⟋';
      items.push(gb);
    }
    // stem direction and voice of the selected chords (drums included: the voice of a note is where the kick goes under the hands…)
    if (!range && ids.length) {
      const guard = (fn) => () => { try { fn(); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } drawBar(); };
      const si = app.stemInfo(ids);
      if (si !== null && si !== undefined) items.push(stemButton(si, guard(() => app.cycleStem(ids, view.id))));
      const vi = app.voiceInfo(ids);
      if (vi !== null) items.push(voiceButton(vi, guard(() => app.cycleVoice(ids, view.id))));
    }
    // chord symbols: show / hide the diagram they carry (above them), and edit it
    if (!range && ids.length && app.symbolDiagramShown(ids) !== null && app.diagramHosts(ids).length > 0 && onDiagramEdit) {
      const shown = app.symbolDiagramShown(ids);
      const sb = btn('', label('diagram.symbol.toggle'), () => { app.toggleSymbolDiagram(ids, view.id); });
      applyIconName(sb, 'guitar-head'); sb.setAttribute('data-action', 'symbol-diagram'); sb.setAttribute('aria-pressed', String(shown));
      if (shown) sb.style.cssText += ';background:var(--accent-soft,#d6e6ff);color:var(--ink,#111);border:2px solid var(--sel-edge,#2d78ff)';
      items.push(sb);
      const hosts = app.diagramHosts(ids);
      if (shown && hosts.length === 1) { const eb = btn('✎', label('diagram.symbol.edit'), () => onDiagramEdit(hosts[0].id, view.id)); eb.setAttribute('data-action', 'symbol-diagram-edit'); items.push(eb); }
    }
    if (ids.length && app.deletable(ids).length) {
      const del = btn('🗑', label('edit.delete'), () => { try { app.deleteElements(ids); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } });
      del.setAttribute('data-action', 'delete');
      items.push(del);
    }
    if (rangeItemBtn) items.push(rangeItemBtn); // the button that turns the element into a range comes right after the delete button
    // décor (barre, clé, armure, chiffrage) : masquer / afficher à la place de la suppression
    const nextHide = ids.length ? app.nextDecorHidden(ids) : null;
    if (nextHide !== null) {
      const eye = btn(nextHide ? '🙈' : '👁', label(nextHide ? 'decor.hide' : 'decor.show'), () => app.toggleDecorHidden(ids));
      eye.setAttribute('data-action', 'toggle-decor');
      items.push(eye);
      const nextAll = app.nextDecorHiddenEverywhere(ids);
      const all = btn(nextAll ? '🙈⇉' : '👁⇉', label(nextAll ? 'decor.hideAll' : 'decor.showAll'), () => app.toggleDecorHiddenEverywhere(ids));
      all.setAttribute('data-action', 'toggle-decor-all');
      items.push(all);
    }
    // silences : non imprimables (masqués partout : écrans 1, 2 et 3 ; grisés tant qu'on affiche les éléments masqués)
    const restsNext = ids.length ? app.nextRestsHidden(ids) : null;
    if (restsNext !== null) {
      const rb = btn(restsNext ? '🙈' : '👁', label(restsNext ? 'rest.hide' : 'rest.show'), () => app.toggleRestsHidden(ids, view.id));
      rb.setAttribute('data-action', 'toggle-rest-hidden');
      items.push(rb);
    }
    // hiding the staff or the track that carries a decor element (clef, key / time signature, barline): one switch each, like the play switches
    if (nextHide !== null && ids.length === 1) {
      const d = parseDecorId(ids[0]);
      for (const [type, key] of [['staff', 'play.staff'], ['track', 'play.track']]) {
        const owner = d ? (type === 'staff' ? app.doc.find(d.staffId) : app.ownerOf(d.staffId, 'track')) : null;
        if (!owner) continue;
        const refusal = app.hideRefusal(owner.id);
        const b = btn('', label(`decor.hide.${type}`), () => { try { app.setVisible(owner.id, false); entryMessage(''); } catch (e) { entryMessage(describeEntryError(e) ?? String(e?.message ?? e)); } });
        b.append(tabSheet() ? icon(type === 'staff' ? 'staff-lines' : 'layers', { size: '1.2em' }) : label(key), icon('eye-off', { size: '1.2em' }));
        b.style.cssText += ';display:inline-flex;align-items:center;gap:var(--btn-gap,2px)';
        b.setAttribute('data-action', `${type}-hide-switch`);
        if (refusal) { b.disabled = true; b.title = label(`decor.hideRefused.${refusal}`); b.setAttribute('aria-label', b.title); }
        items.push(b);
      }
    }
    // clé d'une portée de percussion sélectionnée : ouvre la carte de percussion (hors saisie aussi)
    if (onPercmap && ids.length === 1) {
      const d = parseDecorId(ids[0]);
      const st = d?.kind === 'clef' ? app.doc.find(d.staffId) : null;
      if (st && app.doc.get(st, PID.STAFF_TYPE) === 'percussion') {
        const mb = btn('🥁', label('percmap.open'), () => onPercmap(d.staffId));
        mb.setAttribute('data-action', 'open-percmap');
        items.push(mb);
      }
    }
    // staff properties panel: for the staff of the selection (element, decor, list entry), of a single-staff range, or of the active chord cell
    if (onStaffProps) {
      const sid = cell?.staffId ?? (ids.length ? app.staffIdOf(ids[0]) : (range && range.staffIds.length === 1 ? range.staffIds[0] : null));
      if (sid && app.hasStaffProperties(sid)) {
        const pb = btn('⚙', label('staffProps.open'), () => onStaffProps(sid));
        pb.setAttribute('data-action', 'open-staff-props');
        items.push(pb);
      }
    }
    const next = ids.length && nextHide === null ? app.nextPlayValue(ids) : null;
    if (next !== null) { const pt = btn(next ? '♪' : '🔇', label(next ? 'play.play' : 'play.mute'), () => app.togglePlay(ids)); pt.setAttribute('data-action', 'play-toggle'); items.push(pt); }
    // vélocité imposée des notes sélectionnées : − / curseur / + / Auto (un curseur lâché = UNE transaction)
    const velKey = ids.join(',');
    const vel = ids.length && nextHide === null && app.velocityState ? app.velocityState(ids, { lazy: velocityShownFor !== velKey }) : null;
    if (vel) {
      // one pill: « V• » while the velocity is automatic, « V 90 » once set; drag up / down changes it, a tap opens a stepper, a LONG press gives the
      // automatic mode back (no separate Auto button)
      const pill = createScrubPill({
        min: 1, max: 127, value: vel.auto ? null : vel.value, startAt: vel.lazy ? 64 : vel.value, pxPerStep: 3,
        format: (v) => (v === null ? 'V•' : `V ${v}`),
        title: label('velocity.title'), label: { down: label('velocity.down'), up: label('velocity.up') },
        onCommit: (v) => app.setVelocity(v),
        onLong: vel.auto ? null : () => app.setVelocity(null),
        isLocked: () => Boolean(player?.state().playing), onLocked: () => entryMessage(label('velocity.noPlayback')),
      });
      pill.el.setAttribute('data-velocity-pill', ''); pill.el.setAttribute('data-velocity', ''); pill.el.setAttribute('data-action', 'velocity-pill');
      pill.el.title = label(vel.auto ? 'velocity.pillAuto' : 'velocity.pillSet');
      markLongPress(pill.el);
      items.push(pill.el);
    }
    const first = nextHide === null ? ids[0] : null;
    if (first) for (const [type, key] of [['staff', 'play.staff'], ['track', 'play.track']]) {
      const owner = app.ownerOf(first, type);
      if (!owner) continue;
      // one switch per scope (like the mute button of a note): it shows what a press will do (play everything / mute everything)
      const nextScope = app.nextScopeValue(owner.id);
      if (nextScope === null) continue;
      const b = btn('', label(`${key}${nextScope ? 'Play' : 'Mute'}`), () => app.toggleScope(owner.id));
      b.append(tabSheet() ? icon(type === 'staff' ? 'staff-lines' : 'layers', { size: '1.2em' }) : label(key), icon(nextScope ? 'volume-2' : 'volume-x', { size: '1.2em' }));
      b.style.cssText += ';display:inline-flex;align-items:center;gap:var(--btn-gap,2px)';
      b.setAttribute('data-action', `${type}-play-switch`);
      items.push(b);
    }
    // a menu of the measure / range context is open: the bar shows the buttons of that group (choosing an action closes it; a tap in the empty space goes back)
    if (rangePage) {
      if (grp[rangePage.menu]?.length) {
        if (rangePage.menu !== 'auto') for (const gb of grp[rangePage.menu]) if (!gb.hasAttribute('data-keep')) gb.addEventListener('click', () => setTimeout(() => { rangePage = null; drawBar(); }, 0)); // an action goes back to the bar (the automation stepper stays)
        renderPacked(grp[rangePage.menu], { page: rangePage.page ?? 0, onPage: (n) => { rangePage = { ...rangePage, page: n }; drawBar(); }, level: 'page' });
        return;
      }
      rangePage = null;
    }
    // the buttons in the fixed order of the families (selection, edition, marks, structure, view: ui/bar-order.js), a thin divider before each family but the first
    const ordered = orderBarItems(items);
    items.splice(0, items.length, ...ordered.items);
    for (const e of items) e.removeAttribute('data-bar-family-start');
    for (const e of ordered.firstOfFamily) e.setAttribute('data-bar-family-start', '');
    // selection bar: when the buttons do not all fit in a row, the first page ends right after the edition family, then « › » opens the rest (« ‹ » comes back)
    if (!cell && items.length > 1) {
      renderPacked(items, { page: selPage, onPage: (n) => { selPage = n; drawBar(); }, breakAt: rangeItemBtn ? ordered.endOfEdition : -1 });
      alignGrow();
      drawFilterSheet();
      return;
    }
    const shown = items;
    bar.replaceChildren(...shown);
    bar.style.display = shown.length ? 'flex' : 'none';
    placeBar();
    alignGrow();
    drawFilterSheet();
  };

  // a press outside the filter sheet (not on the bar that opens it) closes it
  const offFilterDismiss = dismissOnOutside(() => filterSheet, () => { filterOpen = false; drawBar(); });
  // a press OUTSIDE the score (page controls, margins) closes what the context bar belongs to: the range / chosen measure / selection
  // (presses in a dialog, a menu, the transport bar and the entry bar do not count — see outside-dismiss.js)
  const offBarDismiss = dismissOnOutside(() => (view.range() || view.chosenMeasure() || view.selection().length ? host : null), () => {
    view.setRange(null); view.setChosenMeasure(null); view.clearSelection();
  });

  // note entry: a press in the MARGIN of the page (anywhere outside the score that is not a bar, a panel, a dialog or a menu) switches the entry mode off
  // On a desktop (mouse) the entry mode stays on until the pencil button is pressed again (decided with Jean, 24/10/2026); tablets/phones keep closing on an outside press.
  // The entry bar appears when the entry button is pressed and stays until it is pressed again (decided with Jean, 25/10/2026): no automatic close here.

  /** Feuille du filtre : seulement avec une plage ; posée à côté de la barre (au-dessus, sinon en dessous), flottante (le SVG ne bouge jamais). */
  let contentsCache = { key: null, value: null };
  /** What the selection holds, by filter category (computed when the sheet opens or the selection / the document changes). */
  const contentsOfRange = () => {
    const r = view.range() ?? filterCellRange;
    const key = `${JSON.stringify(r)}|${docRevision}`;
    if (contentsCache.key !== key) { let value = null; try { value = rangeContents(app.doc, r); } catch { value = null; } contentsCache = { key, value }; }
    return contentsCache.value;
  };
  let chordPanelHidden = null;
  const drawFilterSheet = () => {
    if (chordPanelHidden) { chordPanelHidden.style.visibility = ''; chordPanelHidden = null; }
    if (filterSheet) { filterSheet.remove(); filterSheet = null; }
    if (!app || !filterOpen || !(view.range() ?? filterCellRange)) { if (!(view.range() ?? filterCellRange)) filterOpen = false; return; }
    filterSheet = buildFilterSheet({
      filter: app.filter(), label, contents: contentsOfRange(),
      onChange: (next) => app.setFilter(next),
      onClose: () => { filterOpen = false; drawBar(); },
    });
    stage.append(filterSheet);
    placeFilterSheet();
    // opened from a chord cell: the chord entry window (outside the stage, above it) would cover the sheet, so it gives way while the sheet is open
    if (!view.range()) { const panel = document.querySelector('[data-chord-entry]'); if (panel) { panel.style.visibility = 'hidden'; chordPanelHidden = panel; } }
  };
  const placeFilterSheet = () => {
    if (!filterSheet || typeof window === 'undefined') return;
    const visible = stageVisible();
    filterSheet.style.maxWidth = `${visible.right - visible.left}px`;
    filterSheet.style.maxHeight = `${Math.max(120, visible.bottom - visible.top - 16)}px`;
    const left = bar.offsetLeft, top = bar.offsetTop;
    const anchor = bar.style.display === 'none' ? barAnchor() : { x1: left, y1: top, x2: left + bar.offsetWidth, y2: top + bar.offsetHeight };
    if (!anchor) return;
    const p = placeFloating({ anchor, size: { w: filterSheet.offsetWidth, h: filterSheet.offsetHeight }, visible });
    filterSheet.style.left = `${Math.round(p.x)}px`; filterSheet.style.top = `${Math.round(p.y)}px`;
  };

  /** Ancre de la barre : élément(s) sélectionné(s), sinon case active, sinon mesure choisie / ciblée (au-dessus de la 1re portée du système). */
  const barAnchor = () => {
    const sel = boundsOfShapes(view.selectionShapes());
    if (view.selection().length && sel) {
      // au-dessus de la PORTÉE de l'élément (une note grave ne doit pas donner une barre posée au milieu de la portée)
      // and, when there is no room above, BELOW the staff of the element (never in the middle of the staff): the anchor reaches down to the staff's bottom line
      const sb = view.staffBoundsNear?.((sel.y1 + sel.y2) / 2);
      let a = sb ? { ...sel, y1: Math.min(sel.y1, sb.top), y2: Math.max(sel.y2, sb.bottom) } : sel;
      // les marques de l'accord (articulations, nuance…) restent visibles et sélectionnables : la barre se pose au-dessus d'elles
      const marks = view.selectionMarksBounds?.();
      if (marks) a = { ...a, y1: Math.min(a.y1, marks.y1), y2: Math.max(a.y2, marks.y2) };
      // a chord diagram sits ABOVE what is selected (above a chord symbol / a chord, or the container itself): the bar goes under the staff so it does not hide it
      const hasDiagram = view.selection().some((id) => { const el = app?.doc.find(id); return el && el.props?.containerKind === 'chordDiagram'; }) || (app?.symbolDiagramShown(view.selection()) ?? false);
      return hasDiagram ? { ...a, preferBelow: true } : a;
    }
    const rangeBands = view.rangeBands();
    if (rangeBands.length) {
      const first = rangeBands[0];
      return { x1: Math.min(...rangeBands.map((b) => b.x1)), x2: Math.max(...rangeBands.map((b) => b.x2)), y1: first.y1, y2: Math.max(...rangeBands.map((b) => b.y2)) };
    }
    const cell = view.cellZones().find((z) => z.active);
    if (view.activeCell() && cell) return { x1: cell.x1, y1: cell.y1, x2: cell.x2, y2: cell.y2 };
    const target = view.targetMeasureId();
    const zone = target ? view.measureZones().find((z) => z.measureId === target) : null;
    return zone ? { x1: zone.x1, y1: zone.y1, x2: zone.x2, y2: zone.y2 } : null;
  };
  /** Zone visible des barres flottantes, en coordonnées de la partition : fenêtre moins la barre de transport collante (même calcul que le suivi). */
  const stageVisible = () => {
    const st = stage.getBoundingClientRect();
    const transport = transportBar();
    const area = visibleArea(windowViewport(false), [transport, fixedBottomBar()].filter(Boolean));
    // the sideways-scrolling view clips what it holds: the visible zone is also limited to that scroller
    if (scroller && scroller !== host && getComputedStyle(scroller).overflowX !== 'visible') {
      const r = scroller.getBoundingClientRect();
      area.left = Math.max(area.left ?? 0, r.left); area.right = Math.min(area.right || r.right, r.right);
      area.top = Math.max(area.top, r.top); area.bottom = Math.min(area.bottom, r.bottom);
    }
    return { left: Math.max(0, (area.left ?? 0) - st.left), right: Math.max(1, Math.min(st.width, (area.right || st.width) - st.left)), top: area.top - st.top, bottom: area.bottom - st.top };
  };
  /** Place la barre (visible) : zone visible = fenêtre moins la barre de transport collante, en coordonnées de la partition. */
  const placeBar = () => {
    if (bar.style.display === 'none' || typeof window === 'undefined') return;
    const anchor = barAnchor();
    if (!anchor) return;
    const visible = stageVisible();
    bar.style.maxWidth = `${visible.right - visible.left}px`;
    const size = { w: bar.offsetWidth, h: bar.offsetHeight };
    const p = placeFloating({ anchor, size, visible, prefer: anchor.preferBelow ? 'below' : null });
    // a text field written in place goes where the text will be: the bar steps to the other side of the anchor when they would overlap
    const fr = inlineUI?.isActive() ? inlineUI.rect() : null;
    if (fr && p.x < fr.x + fr.w && p.x + size.w > fr.x && p.y < fr.y + fr.h && p.y + size.h > fr.y) {
      if (p.side === 'above') { p.y = anchor.y2 + 8; p.side = 'below'; } else { p.y = anchor.y1 - 8 - size.h; p.side = 'above'; }
    }
    bar.style.left = `${Math.round(p.x)}px`; bar.style.top = `${Math.round(p.y)}px`;
    bar.setAttribute('data-side', p.side);
    alignGrow();
  };
  /** Once after a press on ▭ / « grow »: the new bar is moved so that its « grow » button comes back where the finger was (the three states of the button are three presses at one spot). */
  const alignGrow = () => {
    const at = keepAt;
    if (!at || performance.now() > at.until) { keepAt = null; return; } // (the bar is drawn and placed more than once after a press: the alignment holds for a moment)
    if (bar.style.display === 'none') return;
    const g = bar.querySelector('[data-action="range-grow"]');
    if (!g) return;
    const r = g.getBoundingClientRect();
    const dx = at.left - r.left; const dy = at.top - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const visible = stageVisible();
    const left = Math.min(Math.max((parseFloat(bar.style.left) || 0) + dx, visible.left), Math.max(visible.left, visible.right - bar.offsetWidth));
    const top = Math.min(Math.max((parseFloat(bar.style.top) || 0) + dy, visible.top), Math.max(visible.top, visible.bottom - bar.offsetHeight));
    bar.style.left = `${Math.round(left)}px`; bar.style.top = `${Math.round(top)}px`;
  };
  lyricsUI = app?.startLyrics ? mountLyrics({ stage, view, app, label, entryMessage, stageVisible: () => stageVisible() }) : null;
  const offBarButtons = barButtons.onChange(() => { if (marksPage?.cat) drawBar(); });
  staffTextUI = mountStaffTextEditor({ stage, view, app, label, entryMessage, stageVisible: () => stageVisible() });
  const offStaffText = staffTextUI.onChange(() => drawBar());
  const offCreation = app?.onCreationChange ? app.onCreationChange(() => drawBar()) : () => {};
  inlineUI = mountInlineText({ stage, label, stageVisible: () => stageVisible(), afterPlace: () => placeBar() });
  const measureAnchor = (measureId) => { const z = view.measureZones().find((q) => q.measureId === measureId); return z ? { cx: (z.x1 + z.x2) / 2, top: z.y1, bottom: z.y2 } : null; };
  const offLyricsBar = lyricsUI && app.onLyricsChange ? app.onLyricsChange(() => drawBar()) : () => {};
  stageVisibleRef = stageVisible;
  // « measure entry » (tablet, phone): one measure enlarged at the top of the screen, the entry tools below (ui/measure-focus.js)
  measureFocus = app && view.id === 'main' ? mountMeasureFocus({
    view, app, scroller: sideScroller(), svg: () => holder.querySelector('svg'), stickyWidth: () => stickyHeader.width(), refresh: () => refresh(), label, message: (m) => entryMessage(m),
    staves: () => view.movement().tracks.flatMap((t) => t.staves.map((s) => ({ id: s.id, type: getProperty(s, PID.STAFF_TYPE), trackId: t.id }))),
    staffName: (id) => {
      const t = view.movement().tracks.find((x) => x.staves.some((s) => s.id === id)); const st = t?.staves.find((s) => s.id === id);
      const kind = st ? getProperty(st, PID.STAFF_TYPE) : null; const key = `focus.type.${kind}`; const kindText = label(key) === key ? '' : ` (${label(key)})`;
      return t ? `${getProperty(t, PID.NAME) ?? ''}${kindText}` : '';
    },
  }) : null;
  const offAutoView = app?.onAutomationViewChange ? app.onAutomationViewChange(() => refresh()) : () => {};
  const onViewportChange = () => { if (marksPage?.cat || sysPage) drawBar(); staffTextUI?.place(); inlineUI?.place(); autoUI.place(); placeBar(); placeFilterSheet(); placeTabBar(); lyricsUI?.place(); };
  // un redimensionnement peut refaire les retours à la ligne : le système mémorisé n'est plus comparable, on l'oublie (sans défiler)
  let lastBarWidth = -1;
  // every bar is cut into pages by its MEASURED width: a window resize re-cuts it (not on scroll)
  const onResizeForget = () => { lastSystem = null; const w = stageVisible().right - stageVisible().left; if (w !== lastBarWidth) { lastBarWidth = w; if (bar.style.display !== 'none') drawBar(); } };
  if (typeof window !== 'undefined') { window.addEventListener('scroll', onViewportChange, { passive: true }); window.addEventListener('resize', onViewportChange); window.addEventListener('resize', onResizeForget); }


  // ---------- barre flottante de saisie en tablature ----------
  const maxFretOfStaff = (staffId) => { const st = app.doc.find(staffId); return st ? maxFretOf(app.doc.parentOf(st.id)) : 24; };
  const closeTabBar = () => { pendingHit = null; tabBar.style.display = 'none'; tabBar.replaceChildren(); pendingDot.style.display = 'none'; };
  // On phones and tablets the box is a sheet that rises from the bottom of the screen (above the bottom bar); on a computer it floats ABOVE or BELOW the staff
  // that is being written (never on it).
  const tabSheet = () => (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-yt')) || (typeof matchMedia !== 'undefined' && panelMode(matchMedia(SHEET_QUERY).matches) === 'sheet'); // screen 5: always the sheet, above the entry bar
  // the entry box is a sheet across the WHOLE width only on a phone (≤ 600 px); a tablet keeps a window of its own that floats beside the staff, like a computer
  const tabPhone = () => tabSheet() && isPhone();
  const hostTabBar = () => {
    if (tabPhone()) {
      if (tabBar.parentNode !== document.body) document.body.append(tabBar);
      tabBar.setAttribute('data-zoom-lock', ''); tabBar.removeAttribute('data-zoom-lock-inline');
      tabBar.style.cssText = `${tabBarCss};position:fixed;left:0;right:0;top:auto;bottom:0;width:auto;max-width:none;z-index:3000;border-radius:12px 12px 0 0;box-shadow:0 -2px 12px rgba(0,0,0,0.35)`;
      tabBar.setAttribute('data-side', 'sheet');
    } else {
      if (tabBar.parentNode !== stage) stage.append(tabBar);
      tabBar.setAttribute('data-zoom-lock-inline', ''); tabBar.removeAttribute('data-zoom-lock');
      tabBar.style.cssText = tabBarCss;
    }
  };
  const placeTabBar = () => {
    if (!pendingHit || tabBar.style.display === 'none' || typeof window === 'undefined') return;
    const staffBox = view.staffBoundsNear?.(pendingHit.y) ?? { top: pendingHit.y - 10, bottom: pendingHit.y + 10 };
    if (tabPhone()) {
      // the staff must stay visible above the sheet: scroll the page when the staff would be hidden under it
      const vv = window.visualViewport; const vh = vv?.height ?? window.innerHeight;
      const staffBottom = stage.getBoundingClientRect().top + staffBox.bottom;
      const limit = vh - tabBar.offsetHeight - 8;
      if (staffBottom > limit) window.scrollBy({ top: staffBottom - limit, behavior: 'instant' });
      return;
    }
    const visible = stageVisible();
    const ui = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-target')) || 44;
    tabBar.style.maxWidth = `${Math.min(visible.right - visible.left, Math.max(260, 5 * (ui + 6) + 16))}px`;
    const anchor = { x1: pendingHit.x - 10, x2: pendingHit.x + 10, y1: staffBox.top - 6, y2: staffBox.bottom + 6 };
    const p = placeFloating({ anchor, size: { w: tabBar.offsetWidth, h: tabBar.offsetHeight }, visible });
    tabBar.style.left = `${Math.round(p.x)}px`; tabBar.style.top = `${Math.round(p.y)}px`;
    tabBar.setAttribute('data-side', p.side);
  };
  const barButton = (title, fn, attrs = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;font:16px var(--ui-font,sans-serif);padding:2px 8px;cursor:pointer';
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    // a press must have STARTED on this button: the entry box is built on the pointer-up of the tap that opens it, right under the finger, and on a slow device
    // the click that follows the same tap lands on the new button (a fret was written by itself). A keyboard « click » has no position (detail 0): it passes.
    let pressedHere = false;
    b.addEventListener('pointerdown', () => { pressedHere = true; });
    b.addEventListener('pointercancel', () => { pressedHere = false; });
    b.addEventListener('click', (e) => { const ghost = e.detail > 0 && !pressedHere; pressedHere = false; if (!ghost) fn(e); });
    return b;
  };
  const pressed = (b, on) => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) { b.style.outline = '1px solid var(--btn-on-line,#b9b4a8)'; b.style.background = 'var(--btn-on,#e2e0da)'; } return b; };
  /** Square button of the interface size (the same as the bottom bar's), for the floating entry boxes. */
  const squareBox = (b) => { b.style.cssText += ';width:var(--ui-target,44px);height:var(--ui-target,44px);min-width:0;padding:0;flex:none'; return b; };
  /**
   * Row of durations shared by the floating entry boxes (tablature, accordion), the same as the bottom bar: the cyclic button (half → whole → 32nd → 64th),
   * quarter, eighth, sixteenth, rest, dot, tie. The rest and the tie act at once on the place touched (the box then closes).
   */
  const durationRow = (redraw, { withClose = false, onRest = null, onTie = null, onClose = null, restOn = false } = {}) => {
    const state = app.noteEntry();
    const flexRow = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);flex:1 1 100%'; return r; };
    const durRow = document.createElement('div');
    durRow.style.cssText = 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);flex:1 1 100%';
    const row1 = flexRow(); const row2 = flexRow(); durRow.append(row1, row2);
    const side = glyphs ? commonSide(glyphs, [...DURATIONS.map(([, g]) => g), 'restQuarter']) : 0;
    const icon = (glyph) => glyphIcon(glyphs, glyph, 26, side);
    const glyphOf = Object.fromEntries(DURATIONS);
    const setBase = (base) => { app.setNoteEntry({ duration: { base, dots: app.noteEntry().duration.dots } }); redraw(); };
    // cyclic duration: the first tap selects the duration shown, the next ones advance
    let idx = Math.max(0, DURATION_CYCLE.indexOf(state.duration.base));
    const cyc = squareBox(barButton(label('noteEntry.dur.cycle'), () => { idx = state.duration.base === DURATION_CYCLE[idx] ? (idx + 1) % DURATION_CYCLE.length : idx; setBase(DURATION_CYCLE[idx]); }, { 'data-action': 'tab-duration-cycle', 'data-duration': DURATION_CYCLE[idx] }));
    if (glyphs) cyc.append(icon(glyphOf[DURATION_CYCLE[idx]])); else cyc.textContent = DURATION_CYCLE[idx];
    markCyclic(cyc, DURATION_CYCLE.length, idx);
    row1.append(pressed(cyc, DURATION_CYCLE.includes(state.duration.base)));
    for (const base of ['quarter', 'eighth', 'sixteenth']) {
      const b = squareBox(barButton(label(`noteEntry.dur.${base}`), () => setBase(base), { 'data-duration': base }));
      if (glyphs) b.append(icon(glyphOf[base])); else b.textContent = base;
      row1.append(pressed(b, state.duration.base === base));
    }
    const guard = (fn) => () => { try { fn(); entryMessage(''); } catch (err) { const text = describeEntryError(err); if (text === null) throw err; entryMessage(text); } };
    const rest = squareBox(barButton(label('noteEntry.rest'), guard(onRest ?? (() => { const hit = pendingHit; if (!hit) return; lastSystem = hit.systemIndex ?? null; app.enterNoteAt(hit, view.id, { rest: true }); setEntryStaff(hit); closeTabBar(); })), { 'data-action': onRest ? 'seq-rest' : 'tab-rest' }));
    if (glyphs) rest.append(icon('restQuarter')); else rest.textContent = 'z';
    const dot = squareBox(barButton(label('noteEntry.dot'), () => { const d = app.noteEntry().duration; app.setNoteEntry({ duration: { base: d.base, dots: d.dots ? 0 : 1 } }); redraw(); }, { 'data-action': 'tab-dot' }));
    if (glyphs) dot.append(glyphIcon(glyphs, 'metAugmentationDot', 26, 1.6)); else dot.textContent = '•';
    const tie = squareBox(barButton(label('noteEntry.tie'), guard(onTie ?? (() => { app.keyboardEntry({ type: 'tie' }, view.id); closeTabBar(); })), { 'data-action': onTie ? 'seq-tie' : 'tab-tie' }));
    tie.append(drawnById('span:slur') ?? '⌒');
    row1.append(restOn ? pressed(rest, true) : rest); row2.append(pressed(dot, state.duration.dots > 0), tie);
    if (withClose) { const close = squareBox(barButton(label('noteEntry.close'), onClose ?? closeTabBar, { 'data-action': onClose ? 'seq-close' : 'tab-close' })); close.textContent = '✕'; row2.append(close); }
    return durRow;
  };
  /** A phone: the box spreads over the whole width: the durations in ONE row, every button takes its share of its row. */
  const stretchTabBar = () => {
    const dur = tabBar.firstElementChild;
    if (dur && dur.children.length === 2) { const [first, second] = dur.children; first.append(...second.children); second.remove(); }
    for (const b of tabBar.querySelectorAll('button')) b.style.cssText += ';flex:1 1 0;width:auto;min-width:0';
    for (const row of tabBar.querySelectorAll(':scope > div, :scope > div > div')) row.style.flexWrap = 'nowrap';
  };
  const finishBar = () => {
    hostTabBar();
    if (tabPhone()) stretchTabBar();
    tabBar.style.display = 'flex';
    sizeDot(pendingDot, 0.15);
    pendingDot.setAttribute('cx', pendingHit.cx ?? pendingHit.x); pendingDot.setAttribute('cy', pendingHit.y); pendingDot.style.display = '';
    placeTabBar();
  };
  // ---------- boîte flottante d'accord (accordéon main gauche) : rangs de boutons à poser d'un coup ----------
  const ACC_CHOICES = [[2, 'noteEntry.acc.bass', 'B'], [1, 'noteEntry.acc.counter', 'CB'], [3, 'noteEntry.acc.major', 'M'], [4, 'noteEntry.acc.minor', 'm'], [5, 'noteEntry.acc.seventh', '7'], [6, 'noteEntry.acc.dim', 'dim']];
  let accRows = new Set([3]);
  let accAlter = null; // null = selon l'armure ; -1 bémol ; 1 dièse ; 0 naturel
  const drawAccBar = () => {
    const rowRow = document.createElement('div');
    rowRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);flex:1 1 100%';
    for (const [row, key, text] of ACC_CHOICES) {
      const b = barButton(label(key), () => { if (accRows.has(row)) accRows.delete(row); else accRows.add(row); drawAccBar(); }, { 'data-acc-row': String(row) });
      b.textContent = text; b.style.fontWeight = 'bold';
      rowRow.append(pressed(b, accRows.has(row)));
    }
    const alterRow = document.createElement('div');
    alterRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);flex:1 1 100%';
    for (const [value, text, key] of [[-1, '♭', 'noteEntry.acc.flat'], [0, '♮', 'noteEntry.acc.natural'], [1, '♯', 'noteEntry.acc.sharp']]) {
      const b = barButton(label(key), () => { accAlter = accAlter === value ? null : value; drawAccBar(); }, { 'data-acc-alter': String(value) });
      b.textContent = text;
      alterRow.append(pressed(b, accAlter === value));
    }
    const ok = barButton(label('noteEntry.acc.place'), placeAccChord, { 'data-action': 'acc-place' });
    ok.textContent = '✓'; ok.style.fontWeight = 'bold'; ok.disabled = accRows.size === 0;
    const close = barButton(label('noteEntry.close'), closeTabBar, { 'data-action': 'tab-close' });
    close.textContent = '✕';
    alterRow.append(ok, close);
    tabBar.replaceChildren(durationRow(drawAccBar), rowRow, alterRow);
    tabBar.setAttribute('data-entry-kind', 'accordion');
    finishBar();
  };
  const placeAccChord = () => {
    const hit = pendingHit;
    if (!hit || !accRows.size) return;
    try {
      lastSystem = hit.systemIndex ?? null; const r = app.enterNoteAt(hit, view.id, { accRows: [...accRows].sort((a, b) => a - b), accAlter: accAlter ?? undefined, rest: false });
      setEntryStaff(hit);
      entryMessage(['added', 'removed', 'none'].includes(r?.action) ? label(`noteEntry.${r.action}`) : '');
    } catch (err) {
      const text = describeEntryError(err);
      if (text === null) throw err;
      entryMessage(text);
    }
    closeTabBar();
  };
  /**
   * The fret pad shared by the floating entry boxes: frets on five columns, page 0 = 0-4 / 5-9 / 10-12 + « more », page 1 (13 up to the last fret, 24 at most) = 13-17 / 18-22 / 23-24 + « back ».
   * `selected` marks the fret chosen (the sequential pad keeps one); a phone spreads the pad over two even rows across the whole width.
   * `all` (the sequential pad, except on a phone): every fret 0 to 24 at once on five columns, no page to turn.
   */
  const fretRowsFor = ({ maxFret, page, setPage, onPick, selected = null, all = false, perRow: columns = null }) => {
    const base = all ? 0 : page ? 13 : 0;
    const cells = [];
    for (let n = base; n <= Math.min(all ? Math.min(maxFret, 24) : maxFret, all ? 24 : base + 12); n++) {
      const b = squareBox(barButton(`${label('noteEntry.fret')} ${n}`, () => onPick(n), { 'data-fret': String(n) }));
      b.textContent = String(n); b.style.fontWeight = 'bold'; cells.push(selected === n ? pressed(b, true) : b);
    }
    if (maxFret >= 13 && !all) {
      const range = label(page ? 'noteEntry.fretPage.low' : 'noteEntry.fretPage.high');
      const flip = squareBox(barButton(label('noteEntry.fretPage.title', { range }), () => setPage(page ? 0 : 1), { 'data-action': 'fret-page', 'data-fret-page': String(page) }));
      flip.textContent = page ? '‹' : '›'; flip.style.fontWeight = 'bold'; flip.style.fontSize = '20px';
      cells.push(flip);
    }
    const rows = [];
    const perRow = columns ?? (tabPhone() ? Math.max(5, Math.ceil(cells.length / 2)) : 5);
    for (let i = 0; i < cells.length; i += perRow) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px);flex:1 1 100%';
      row.append(...cells.slice(i, i + perRow)); rows.push(row);
    }
    return rows;
  };
  const drawTabBar = () => {
    if (!pendingHit) return;
    if (pendingHit.staffType === 'accordion-left') { drawAccBar(); return; }
    const mk = barButton;
    const durRow = durationRow(drawTabBar, { withClose: true });
    const maxFret = maxFretOfStaff(pendingHit.staffId);
    if (fretPage && maxFret < 13) fretPage = 0;
    // frets on five columns: page 0 = 0-4 / 5-9 / 10-12 + « more »; page 1 (13 up to the last fret, 24 at most) = 13-17 / 18-22 / 23-24 + « back »
    const fretRows = fretRowsFor({ maxFret, page: fretPage, setPage: (p) => { fretPage = p; drawTabBar(); }, onPick: placeTabNote });
    tabBar.replaceChildren(durRow, ...fretRows);
    tabBar.setAttribute('data-entry-kind', 'tab');
    finishBar();
  };
  let fretPage = 0; // 0: frets 0-12; 1: frets 13-24 (within the instrument's limit)
  const openTabBar = (hit) => { pendingHit = hit; fretPage = 0; accRows = new Set([3]); accAlter = null; drawTabBar(); };
  const placeTabNote = (fret) => {
    const hit = pendingHit;
    if (!hit) return;
    try {
      lastSystem = hit.systemIndex ?? null; const r = app.enterNoteAt(hit, view.id, { fret, rest: false });
      setEntryStaff(hit);
      entryMessage(['added', 'removed', 'refret', 'none'].includes(r?.action) ? label(`noteEntry.${r.action}`) : '');
    } catch (err) {
      const text = describeEntryError(err);
      if (text === null) throw err;
      entryMessage(text);
    }
    closeTabBar();
  };

  // ---------- saisie SÉQUENTIELLE en tablature : un pavé qui reste ouvert (durées, cordes, frettes, poser / avancer), sous la portée du curseur ----------
  const GP_FRET_DELAY = 900; // ms: how long the second digit of a two-digit fret may wait (Guitar Pro style keys)
  let gpFret = null; // { spot, at, value }: the digit just typed in the Guitar Pro style
  const seqState = createSeqState();
  let seqPage = 0; // a phone keeps the two pages of frets
  let seqPlaced = null; // { system, left, side }: where the pad sits; it only moves when the cursor leaves its width or its system
  const seqOn = () => { const st = app?.noteEntry?.(); return !!(st?.active && st.sequential && app.entryStaffTypeAtCursor?.() === 'tab'); };
  const seqGuard = (fn) => () => { try { fn(); entryMessage(''); } catch (err) { const text = describeEntryError(err); if (text === null) throw err; entryMessage(text); } };
  /** The red cross of a muted string in the chord diagrams, for a string that is not played. */
  const mutedCross = () => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 14 14'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
    for (const [x1, y1, x2, y2] of [[2, 2, 12, 12], [12, 2, 2, 12]]) {
      const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', DIAGRAM_COLORS.muted); l.setAttribute('stroke-width', '2.4'); l.setAttribute('stroke-linecap', 'round'); svg.append(l);
    }
    return svg;
  };
  const placeSeqBar = () => {
    if (seqBar.style.display === 'none' || typeof window === 'undefined') return;
    const st = app.noteEntry();
    const r = st.cursor ? view.entryCursorRect(st.cursor) : null;
    if (!r) return;
    const box = view.staffBoundsNear?.((r.y1 + r.y2) / 2) ?? { top: r.y1, bottom: r.y2 };
    if (tabPhone()) {
      const vv = window.visualViewport; const vh = vv?.height ?? window.innerHeight;
      const staffBottom = stage.getBoundingClientRect().top + box.bottom;
      const limit = vh - seqBar.offsetHeight - 8;
      if (staffBottom > limit) window.scrollBy({ top: staffBottom - limit, behavior: 'instant' });
      return;
    }
    const visible = stageVisible();
    const w = seqBar.offsetWidth; const h = seqBar.offsetHeight; const margin = Math.min(120, w / 4);
    const kept = seqPlaced && seqPlaced.system === r.systemIndex && r.x > seqPlaced.left + margin && r.x < seqPlaced.left + w - margin ? seqPlaced : null;
    if (kept) { // the pad stays under the fingers while the cursor moves along its width; only its height follows the staff
      seqBar.style.left = `${kept.left}px`; seqBar.style.top = `${Math.round(kept.side === 'below' ? box.bottom + 8 : box.top - h - 8)}px`;
    } else {
      const p = placeFloating({ anchor: { x1: r.x - 10, x2: r.x + 10, y1: box.top - 6, y2: box.bottom + 6 }, size: { w, h }, visible, prefer: 'below' });
      seqBar.style.left = `${Math.round(p.x)}px`; seqBar.style.top = `${Math.round(p.y)}px`;
      seqPlaced = { system: r.systemIndex, left: Math.round(p.x), side: p.side };
    }
  };
  const drawSeqBar = () => {
    if (!seqOn()) { seqBar.style.display = 'none'; seqBar.replaceChildren(); seqPlaced = null; seqReset(seqState); return; }
    const st = app.noteEntry();
    const maxFret = maxFretOfStaff(st.cursor.staffId);
    if (seqPage && maxFret < 13) seqPage = 0;
    const strings = app.tabStrings();
    const phone = tabPhone();
    const hear = () => { const played = seqPlayed(seqState); if (played.length) app.seqPreview(played); }; // the chord as it stands, before anything is written
    const durRow = durationRow(drawSeqBar, {
      withClose: true, restOn: seqState.rest,
      onRest: () => { seqToggleRest(seqState); drawSeqBar(); },
      onTie: () => { seqTie(app, { viewId: view.id }); drawSeqBar(); },
      onClose: () => app.setNoteEntry({ sequential: false }),
    });
    // the strings, the highest on top as the staff shows them: the note of the open string, then the fret (a red cross = not played). A tap selects the string, a tap on the selected one
    // adds a fret, a long press puts it back to « not played »
    const stringCol = document.createElement('div');
    stringCol.style.cssText = 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);flex:none';
    for (const { string, name } of strings) {
      const fret = seqState.frets.get(string);
      const b = barButton(label('seq.string', { name }), () => {}, { 'data-seq-string': String(string), 'data-seq-fret': fret === undefined ? '' : String(fret) });
      b.style.cssText += `;gap:6px;justify-content:space-between;min-width:${phone ? 72 : 92}px;padding:2px ${phone ? 6 : 8}px;font-weight:bold`;
      const nm = document.createElement('span'); nm.textContent = name; nm.style.cssText = 'font-size:12px;font-weight:normal;opacity:.7';
      const val = document.createElement('span'); val.style.cssText = 'min-width:1.6em;text-align:right;display:inline-flex;justify-content:flex-end;align-items:center';
      if (fret === undefined) val.append(mutedCross()); else val.textContent = String(fret);
      b.append(nm, val);
      bindShortLong(b, {
        onShort: () => { const r = seqTap(seqState, string, maxFret); app.setNoteEntry({ tabString: string }); if (r.action !== 'selected') hear(); drawSeqBar(); },
        onLong: () => { seqClear(seqState, string); app.setNoteEntry({ tabString: string }); hear(); drawSeqBar(); },
      });
      stringCol.append(pressed(b, seqState.current === string));
    }
    const fretCol = document.createElement('div');
    fretCol.style.cssText = 'display:flex;flex-direction:column;gap:var(--btn-gap,2px);flex:1 1 auto;min-width:0';
    const onPick = (n) => {
      if (seqSetFret(seqState, n, maxFret)) hear(); else entryMessage(label('seq.pickString'));
      drawSeqBar();
    };
    const chosen = seqState.current !== null ? seqState.frets.get(seqState.current) ?? null : null;
    fretCol.append(...fretRowsFor({ maxFret, page: seqPage, setPage: (p) => { seqPage = p; drawSeqBar(); }, onPick, selected: chosen, all: !phone, perRow: phone ? 5 : null })); // the strings take room: five frets a row on a phone
    const pad = document.createElement('div');
    pad.style.cssText = 'display:flex;gap:8px;align-items:flex-start;flex:1 1 100%';
    pad.append(stringCol, fretCol);
    // back (the chord just written goes away) and advance (writes the chord, or a rest when the rest button is on and nothing is played)
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:var(--btn-gap,2px);flex:1 1 100%';
    const back = squareBox(barButton(label('seq.back'), seqGuard(() => { seqBack(app, seqState, { viewId: view.id }); drawSeqBar(); }), { 'data-action': 'seq-back' })); back.textContent = '⌫';
    const go = barButton(label('seq.place.advance'), () => {
      try {
        const r = seqAdvance(app, seqState, { viewId: view.id });
        entryMessage(r.action === 'none' ? label('seq.nothing') : '');
      } catch (err) { const text = describeEntryError(err); if (text === null) throw err; entryMessage(text); }
      drawSeqBar();
    }, { 'data-action': 'seq-advance' });
    go.textContent = `⏭ ${label('seq.place.advance.short')}`; go.style.flex = '1 1 0'; go.style.fontWeight = 'bold';
    actions.append(back, go);
    seqBar.replaceChildren(durRow, pad, actions);
    seqBar.setAttribute('data-entry-kind', 'seq');
    if (phone) {
      if (seqBar.parentNode !== document.body) document.body.append(seqBar);
      seqBar.setAttribute('data-zoom-lock', ''); seqBar.removeAttribute('data-zoom-lock-inline');
      seqBar.style.cssText = `${tabBarCss};background:var(--paper,#fff);z-index:3000;display:flex;position:fixed;left:0;right:0;top:auto;bottom:0;width:auto;max-width:none;border-radius:12px 12px 0 0;box-shadow:0 -2px 12px rgba(0,0,0,0.35)`;
      for (const b of seqBar.querySelectorAll('button')) if (!b.hasAttribute('data-seq-string') && !b.hasAttribute('data-fret')) b.style.flex = b.style.flex || '1 1 0';
    } else {
      if (seqBar.parentNode !== stage) stage.append(seqBar);
      seqBar.setAttribute('data-zoom-lock-inline', ''); seqBar.removeAttribute('data-zoom-lock');
      const keepLeft = seqBar.style.left; const keepTop = seqBar.style.top;
      seqBar.style.cssText = `${tabBarCss};background:var(--paper,#fff);z-index:7;display:flex;max-width:${Math.min(stageVisible().right - stageVisible().left, 420)}px`;
      seqBar.style.left = keepLeft || '0px'; seqBar.style.top = keepTop || '0px';
    }
    placeSeqBar();
  };

  const toSvg = (e) => {
    const svg = holder.querySelector('svg');
    const b = svg.getBoundingClientRect();
    const k = svg.viewBox.baseVal.width / b.width;
    return { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k, k };
  };
  // ---------- saisie de notes : un clic (ou un tap) sur une portée pose une note quand le mode est actif ----------
  const setEntryStaff = (hit) => {
    lastEntryStaff = hit.staffId;
    if (!app?.setNoteEntry) return;
    const s = app.noteEntry();
    const patch = {};
    if (s.entryStaffType !== hit.staffType) patch.entryStaffType = hit.staffType;
    if (s.accArmed != null && s.accArmed !== hit.staffId) patch.accArmed = null; // toucher une autre portée désarme la main gauche
    if (Object.keys(patch).length) app.setNoteEntry(patch);
  };
  // main gauche de l'accordéon : la saisie n'est active qu'après un tap sur la clé de fa (boîte englobante de la clé) — évite les notes involontaires
  // the accordion special mode (entry bar) replaces the tap on the clef: every left-hand staff is open for entry while it is on
  const accArmedFor = (staffId) => app.noteEntry().specialMode === 'acc' || app.noteEntry().accArmed === staffId;
  const clefHit = (x, y) => zoneAt(view.clefZones?.('accordion-left'), x, y);
  // une clé n'est « cliquable » que pendant la saisie (décision de Jean, 14/10/2026) : accordéon = arme la main gauche, percussion = éditeur de carte ;
  // hors saisie elle reste du décor sélectionnable (donc masquable) — voir `ui/clef-tap.js`
  const clefTap = (x, y) => clefTapAt({ entry: entryOn(), x, y, zonesOf: (type) => view.clefZones?.(type) ?? [], percmap: !!onPercmap });
  const toggleAccArmed = (z) => {
    if (app.noteEntry().specialMode === 'acc') return; // the special mode already opens the left hand
    const on = !accArmedFor(z.staffId);
    lastEntryStaff = z.staffId;
    closeTabBar();
    app.setNoteEntry({ entryStaffType: 'accordion-left', accArmed: on ? z.staffId : null });
    entryMessage(label(on ? 'noteEntry.accArmed' : 'noteEntry.accDisarmed'));
  };
  // colonnes cliquables de la voix choisie (sélecteur de la barre) ; accordéon main gauche : voix 1, ou voix 2 pour les accords s'il y a deux voix
  const entryHit = (x, y) => {
    const s = app.noteEntry();
    let hit = view.staffHit(x, y, { preferredStaffId: lastEntryStaff, voice: s.voice ?? 0 });
    if (hit?.staffType === 'accordion-left') {
      const v = (s.accVoices ?? 1) === 2 && s.accMode === 'chord' ? 1 : 0;
      if (v !== hit.voice) hit = view.staffHit(x, y, { preferredStaffId: lastEntryStaff, voice: v });
    }
    // a percussion note goes into the voice of its SOUND (snare and bass drum: voice 2): the clickable columns are those of that voice, else only the beats of
    // voice 1 could be chosen
    if (hit?.staffType === 'percussion') {
      const v = app.entryVoiceFor(hit);
      if (Number.isInteger(v) && v !== hit.voice) hit = view.staffHit(x, y, { preferredStaffId: lastEntryStaff, voice: v }) ?? hit;
    }
    return hit;
  };
  let pressSnapshot = null; // { clientX, clientY, hit, at } read at the press, while the view was still showing the old layout
  let lastEntryStaff = null; // portée de la saisie en cours : garde plus de place quand on clique loin de ses lignes (MuseScore, facteur 0,75)
  let down = null;
  const entryOn = () => !!app?.noteEntry && app.noteEntry().active;
  const describeEntryError = (err) => {
    if (err instanceof NoteEntryError) {
      const key = `noteEntry.error.${err.code}`;
      const text = label(key);
      return text === key ? label('noteEntry.error.other', { message: err.message }) : text;
    }
    if (err instanceof EditError) return label('noteEntry.error.other', { message: err.message });
    return null;
  };
  const tryEnter = (e) => {
    const { x, y } = toSvg(e);
    const clef = clefTap(x, y);
    if (clef?.kind === 'accordion') { toggleAccArmed(clef.zone); return true; }
    // portée de percussion : la clé ouvre l'éditeur du jeu de sons (percmap) — ni note posée, ni curseur déplacé, ni portée de saisie changée
    if (clef?.kind === 'percussion') { closeTabBar(); entryMessage(''); onPercmap(clef.zone.staffId); return true; }
    // a click (the pointer hardly moved since the press): the target is the one read at the press, on the picture the person saw
    const snap = pressSnapshot; pressSnapshot = null;
    const fromPress = snap && snap.hit && performance.now() - snap.at < 2000 && Math.hypot(e.clientX - snap.clientX, e.clientY - snap.clientY) < 8;
    const hit = fromPress ? snap.hit : entryHit(x, y);
    if (!hit) return false;
    if (hit.staffType === 'accordion-left' && !accArmedFor(hit.staffId)) { setEntryStaff(hit); closeTabBar(); entryMessage(label('noteEntry.accNotArmed')); return true; }
    // tablature : le clic choisit l'endroit ; la frette et la durée se choisissent dans la barre flottante
    // sequential entry: the tap only chooses WHERE the cursor is (and the string); the pad writes
    if (hit.staffType === 'tab' && app.noteEntry().sequential) { setEntryStaff(hit); entryMessage(''); seqState.group = null; app.moveEntryCursorTo(hit); return true; }
    if (hit.staffType === 'tab') { setEntryStaff(hit); entryMessage(''); openTabBar(hit); return true; }
    // main gauche de l'accordéon en mode « Accord » : un tap simple ouvre la boîte d'accords (comme le tap long)
    if (hit.staffType === 'accordion-left' && app.noteEntry().accMode === 'chord') { setEntryStaff(hit); entryMessage(''); openTabBar(hit); return true; }
    closeTabBar();
    try {
      // a note (not a rest) on a staff with notes is shown at once as a ghost, the real layout follows; a removal or a re-fret is shown by the real drawing at once
      entryStartedAt = performance.now();
      pendingRests = !app.noteEntry().rest ? restIntervals(app.doc, hit.staffId, app.entryVoiceFor(hit) ?? 0, hit.measureIndex) : null;
      lastSystem = hit.systemIndex ?? null; const r = app.enterNoteAt(hit, view.id, null, { defer: !app.noteEntry().rest });
      if (!['placed', 'added'].includes(r?.action)) flushView();
      setEntryStaff(hit);
      entryMessage(['added', 'removed', 'refret', 'none'].includes(r?.action) ? label(`noteEntry.${r.action}`) : '');
    } catch (err) {
      const text = describeEntryError(err);
      if (text === null) throw err;
      entryMessage(text);
    }
    return true;
  };
  // tap long (≈ 450 ms sans bouger) ou clic droit sur la portée accordéon main gauche : boîte d'accord (le tap simple pose une basse)
  const LONG_PRESS_MS = 450;
  let longTimer = null;
  let longFired = false;
  const cancelLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };
  const openAccordionBox = (e) => {
    if (!entryOn() || !holder.querySelector('svg')) return false;
    const { x, y } = toSvg(e);
    const hit = entryHit(x, y);
    if (!hit || hit.staffType !== 'accordion-left' || clefHit(x, y) || !accArmedFor(hit.staffId)) return false;
    setEntryStaff(hit); entryMessage(''); openTabBar(hit);
    return true;
  };
  /** Maj + clic sur un accord / une note / un silence : plage depuis l'élément sélectionné (ou la plage courante) jusqu'à lui, comme MuseScore. */
  const extendRangeTo = (ref, given = null) => { // `given`: a range to extend to (a measure tapped on its empty space) instead of the range of an element
    const mv = movementOfView();
    const target = given ?? rangeFromItem(app.doc, mv, ref);
    if (!target) return false;
    const current = view.range();
    const sel = view.selection();
    const base = current ?? (sel.length === 1 ? rangeFromItem(app.doc, mv, sel[0]) : null);
    const next = base ? unionRanges(app.doc, mv, base, target) : target;
    if (!next) return false;
    view.setRange(next);
    return true;
  };
  /** A long press (finger, pen) on a chord, a note or a rest chooses its WHOLE MEASURE on its staff: in a dense measure there is hardly any empty space to tap for it. */
  const selectMeasureOfItem = (e) => {
    if (!app || !player || entryOn() || rangeDrag || !holder.querySelector('svg')) return false;
    const { x, y, k } = toSvg(e);
    const tolerance = e.pointerType === 'touch' ? Math.max(TOLERANCE.touch, (Math.max(e.width ?? 1, e.height ?? 1) / 2) * k) : TOLERANCE.mouse * k;
    const hit = view.hitTest(x, y, { tolerance });
    if (!hit) return false;
    const mv = movementOfView();
    const item = rangeFromItem(app.doc, mv, hit.ref);
    if (!item) return false;
    const index = view.measureIndexOf(item.from.measureId);
    if (index < 0) return false;
    view.setActiveCell(null);
    chosenStaff = null; view.clearSelection();
    view.setRange(rangeFromMeasures(app.doc, mv, item.staffIds, index, index));
    drawRange();
    return true;
  };
  let lastPointerType = '';
  const onDown = (e) => {
    lastPointerType = e.pointerType;
    down = { x: e.clientX, y: e.clientY };
    longFired = false;
    cancelLong();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest?.('[data-context-bar], [data-track-controls], [data-filter-sheet], [data-tab-entry-bar], [data-seq-entry-bar], [data-lyrics-field], [data-lyrics-panel], [data-inline-text], [data-range-handle]')) return;
    const at = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType, width: e.width, height: e.height };
    if (entryOn()) longTimer = setTimeout(() => { longTimer = null; if (down && openAccordionBox(at)) longFired = true; }, LONG_PRESS_MS);
    else if (e.pointerType !== 'mouse') longTimer = setTimeout(() => { longTimer = null; if (down && selectMeasureOfItem(at)) longFired = true; }, LONG_PRESS_MS); // finger or pen only
  };
  /** Clic droit à la souris : supprime l'accord / la note / le silence touché (toute la sélection si l'élément en fait partie). Souris seulement :
   * sur tablette, un appui long peut aussi produire `contextmenu`, il ne doit jamais supprimer. */
  const rightClickDelete = (e) => {
    if (lastPointerType !== 'mouse' || !app || !holder.querySelector('svg')) return false;
    const { x, y, k } = toSvg(e);
    const hit = view.hitTest(x, y, { tolerance: TOLERANCE.mouse * k });
    if (!hit || !app.deletable([hit.ref]).length) return false;
    const sel = view.selection();
    const ids = sel.includes(hit.ref) ? sel : [hit.ref];
    try { app.deleteElements(ids); entryMessage(''); } catch (err) { entryMessage(describeEntryError(err) ?? String(err?.message ?? err)); }
    return true;
  };
  const onContextMenu = (e) => {
    if (lastPointerType === 'touch' || e.target.closest?.('[data-range-handle]')) e.preventDefault(); // appui long au doigt : jamais de menu système
    if (e.target.closest?.('[data-context-bar], [data-track-controls], [data-filter-sheet], [data-tab-entry-bar], [data-seq-entry-bar], [data-lyrics-field], [data-lyrics-panel], [data-inline-text]')) { if (entryOn()) e.preventDefault(); return; }
    if (!entryOn()) { if (rightClickDelete(e)) e.preventDefault(); return; }
    e.preventDefault(); // pas de menu système pendant la saisie (tap long sur tablette, clic droit à la souris)
    cancelLong();
    if (openAccordionBox(e)) { longFired = true; return; }
    rightClickDelete(e);
  };
  /** Repères de saisie à l'échelle de la partition : diamètre = 1 espace de portée (unités du SVG), trait proportionnel. */
  const sizeDot = (dot, strokeSp) => {
    const sp = view.staffSpace();
    if (!(sp > 0)) return;
    dot.setAttribute('r', String(sp / 2)); dot.setAttribute('stroke-width', String(sp * strokeSp));
  };
  const PREVIEW_INK = 'rgba(40,120,255,0.75)';
  /** The chosen note drawn at the pointer, with its ledger lines: true when drawn (else the dot is used). Any failure falls back to the dot, never to an error. */
  const drawPreviewNote = (hit) => {
    try {
      const entry = app.noteEntry();
      const ss = view.staffSpace();
      if (!glyphs?.glyphs || !(ss > 0) || hit.staffType !== 'score' || entry.rest || !Number.isInteger(hit.line) || !(hit.lineCount >= 1)) return false;
      const shape = previewShape({ base: entry.duration?.base, dots: entry.duration?.dots ?? 0, line: hit.line, lineCount: hit.lineCount });
      const head = glyphs.glyphs[shape.head];
      if (!head || (shape.flag && !glyphs.glyphs[shape.flag])) return false;
      const k = ss / 250;
      const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, String(v)); return n; };
      const glyphAt = (name, ox, oy) => { const g = glyphs.glyphs[name]; return el('g', { transform: `translate(${ox},${oy - g.bbox.bBoxNE[1] * ss}) scale(${k})`, 'data-glyph': name }).appendChild(el('path', { d: g.path, fill: PREVIEW_INK, 'fill-rule': 'evenodd' })).parentNode; };
      const width = head.bbox.bBoxNE[0] * ss;
      const left = hit.cx - width / 2;
      const nodes = [];
      for (const e of ledgerLines(hit.line, hit.lineCount)) { // each ledger line a little wider than the head
        const y = hit.y + (e - hit.line) * 0.5 * ss;
        nodes.push(el('line', { x1: left - 0.4 * ss, x2: left + width + 0.4 * ss, y1: y, y2: y, stroke: PREVIEW_INK, 'stroke-width': 0.16 * ss, 'data-ledger': '' }));
      }
      nodes.push(glyphAt(shape.head, left, hit.y));
      const t = 0.12 * ss;
      if (shape.stem) {
        const anchor = head.anchors?.[shape.stem.up ? 'stemUpSE' : 'stemDownNW'] ?? [shape.stem.up ? head.bbox.bBoxNE[0] : 0, 0];
        const sx = left + anchor[0] * ss + (shape.stem.up ? -t / 2 : t / 2);
        const y0 = hit.y - anchor[1] * ss;
        const y1 = shape.stem.up ? y0 - 3.5 * ss : y0 + 3.5 * ss;
        nodes.push(el('line', { x1: sx, x2: sx, y1: y0, y2: y1, stroke: PREVIEW_INK, 'stroke-width': t, 'data-stem': '' }));
        if (shape.flag) {
          const fa = glyphs.glyphs[shape.flag].anchors?.[shape.stem.up ? 'stemUpNW' : 'stemDownSW'] ?? [0, 0];
          nodes.push(glyphAt(shape.flag, sx - t / 2 - fa[0] * ss, y1 + fa[1] * ss));
        }
      }
      if (shape.dots && glyphs.glyphs.augmentationDot) { // the dots sit in the space above a line (a note on a line) or beside the head (a note in a space)
        const dy = hit.line % 2 === 0 ? -0.5 * ss : 0;
        for (let i = 0; i < shape.dots; i += 1) nodes.push(glyphAt('augmentationDot', left + width + (0.35 + i * 0.45) * ss, hit.y + dy));
      }
      previewShapeLayer.replaceChildren(...nodes);
      previewShapeLayer.style.display = '';
      return true;
    } catch { return false; }
  };
  const hidePreview = () => { previewDot.style.display = 'none'; previewShapeLayer.style.display = 'none'; };
  const onMove = (e) => {
    if (longTimer && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) cancelLong();
    if (e.pointerType === 'touch' || !entryOn() || !holder.querySelector('svg')) { hidePreview(); return; }
    const { x, y } = toSvg(e);
    const hit = entryHit(x, y);
    if (!hit) { hidePreview(); return; }
    if (drawPreviewNote(hit)) { previewDot.style.display = 'none'; return; }
    previewShapeLayer.style.display = 'none';
    sizeDot(previewDot, 0.12);
    previewDot.setAttribute('cx', hit.cx ?? hit.x); previewDot.setAttribute('cy', hit.y);
    previewDot.style.display = '';
  };
  const onLeave = () => { hidePreview(); };
  const onUp = (e) => {
    cancelLong();
    if (e.pointerType === 'mouse' && e.button !== 0) return; // clic droit / milieu : ni sélection ni saisie (le clic droit supprime, voir `onContextMenu`)
    if (rangeDragEnded) { rangeDragEnded = false; return; }
    if (rangeDrag || e.target.closest?.('[data-context-bar], [data-track-controls], [data-filter-sheet], [data-tab-entry-bar], [data-seq-entry-bar], [data-lyrics-field], [data-lyrics-panel], [data-inline-text], [data-range-handle]')) return; // clic sur une barre ou une poignée : ni sélection ni désélection
    if (!holder.querySelector('svg')) return;
    if (longFired) { longFired = false; down = null; return; } // le tap long a ouvert la boîte : le relâchement ne pose rien
    // saisie de notes : on ignore un geste qui a glissé (défilement au doigt) ; la saisie remplace la sélection tant que le mode est actif
    if (entryOn()) {
      const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10;
      down = null;
      if (!moved && tryEnter(e)) return;
      if (moved) return;
    }
    closeTabBar();
    const { x, y, k } = toSvg(e);
    // (le tap sur la clé d'une portée de percussion n'est plus pris ici : il n'agit que pendant la saisie, voir `tryEnter` ; hors saisie la clé
    // est sélectionnée comme tout décor)
    // doigt : 12 px ; si la surface de contact est rapportée (PointerEvent.width/height, 1 par défaut), le plus grand des deux
    const tolerance = e.pointerType === 'touch' ? Math.max(TOLERANCE.touch, (Math.max(e.width, e.height) / 2) * k) : TOLERANCE.mouse * k;
    const hit = view.hitTest(x, y, { tolerance });
    // portée d'accords : un tap dans une case l'active (la fenêtre de saisie s'ouvre) ; un autre élément touché garde la sélection ordinaire
    const zone = !hit || hit.type === 'chordsymbol' ? view.hitCell(x, y, { tolerance: 0 }) : null;
    if (zone) {
      view.setActiveCell(zone);
      if (zone.symbolId) view.select([zone.symbolId]); else view.clearSelection();
      drawCells(); drawBar();
      return;
    }
    // the diagram drawn above a chord symbol belongs to it: a tap on it selects the symbol AND opens the chord entry window on its cell, like a tap on the symbol
    if (hit?.type === 'chordsymbol' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const own = view.cellZones().find((q) => q.symbolId === hit.ref);
      if (own) { view.setActiveCell(own); view.select([hit.ref]); drawCells(); drawBar(); return; }
    }
    // a tap on a text or a picture of the band of blocks starts their editing (they are not elements of the score: nothing else would answer)
    if (!hit && app && blocksEditor && !app.blocksEditing()) { const bid = blocksEditor.blockAt(x, y); if (bid) { app.setBlocksEditing(true); blocksEditor.select(bid); return; } }
    // a tap on a syllable of a lyrics track (events): its window opens on it (those syllables are not notes: nothing else would answer)
    if (hit && onLyricEventEdit && app && !e.shiftKey && !e.ctrlKey && !e.metaKey && app.doc.find(hit.ref)?.type === 'lyricevent') { onLyricEventEdit(hit.ref); return; }
    if (hit && e.shiftKey && app && extendRangeTo(hit.ref)) { drawBar(); return; }
    if (hit) {
      view.select([hit.ref], { mode: e.ctrlKey || e.metaKey ? 'toggle' : 'replace' });
      if (app && !e.shiftKey && !e.ctrlKey && !e.metaKey) app.auditionSelected([hit.ref]);
    }
    else if (e.shiftKey && !e.ctrlKey && !e.metaKey && app && player && view.hitMeasure(x, y)) {
      // Shift + tap on the empty space of a measure: the selection grows to it (further along the same staff: the measures in between; on another staff: the block of measures)
      const measure = view.hitMeasure(x, y);
      const staffId = view.staffHit(x, y)?.staffId ?? view.staffAtY(y, measure.systemIndex);
      const index = view.measureIndexOf(measure.measureId);
      const target = staffId && index >= 0 ? rangeFromMeasures(app.doc, movementOfView(), [staffId], index, index) : null;
      if (target && extendRangeTo(null, target)) { chosenStaff = null; drawRange(); return; }
    }
    else if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // a marks page is open: a tap in the empty space goes one step back (next page → previous page → … → menu → normal bar); only then does a tap deselect
      if (staffTextUI?.isActive()) { staffTextUI.cancel(); drawBar(); return; }
      if (inlineUI?.isActive()) { inlineUI.cancel(); return; }
      if (rangePage?.many) { rangePage = { ...rangePage, many: false }; drawBar(); return; }
      if (rangePage) { rangePage = (rangePage.page ?? 0) > 0 ? { ...rangePage, page: rangePage.page - 1 } : rangePage.from ? { menu: rangePage.from, page: 0 } : null; drawBar(); return; }
      if (sysPage) { sysPage = (sysPage.page ?? 0) > 0 ? { ...sysPage, page: sysPage.page - 1 } : sysPage.standalone ? null : sysPage.path.length ? { path: sysPage.path.slice(0, -1), page: 0 } : null; drawBar(); return; }
      if (barPage) { barPage = (barPage.page ?? 0) > 0 ? { page: barPage.page - 1 } : null; drawBar(); return; }
      if (retouchOpen) { retouchOpen = false; drawBar(); return; }
      if (capoOpen) { capoOpen = false; marksPage = { cat: 'guitar', page: 0 }; drawBar(); return; }
      if (marksPage) { marksPage = (marksPage.page ?? 0) > 0 ? { cat: marksPage.cat, page: marksPage.page - 1 } : marksPage.cat ? { cat: null } : null; drawBar(); return; } // one tap = one step back
      // zone vide d'une mesure : choisit la mesure (sans interrompre la lecture) ; hors de toute mesure : désélection
      const measure = player ? view.hitMeasure(x, y) : null;
      if (measure) {
        // the tap selects the measure ON THE TAPPED STAFF at once, as a range (purple frame and handles); only a tap that touches no staff
        // falls back to the "chosen measure" of the whole system
        // between two staves (or above the first, below the last) `staffHit` can find nothing: the nearest staff of the system is taken, so a chosen measure always has a staff
        const staffId = view.staffHit(x, y)?.staffId ?? view.staffAtY(y, measure.systemIndex);
        const index = view.measureIndexOf(measure.measureId);
        // the play position moves to the start of the tapped measure (not shown); never while playing
        if (index >= 0 && !player.state?.().playing) { try { player.seekToMeasure(view.movementIndex(), index); } catch { /* measure never played */ } }
        const r = staffId && index >= 0 ? rangeFromMeasures(app.doc, movementOfView(), [staffId], index, index) : null;
        if (r) { chosenStaff = null; view.setRange(r); drawRange(); return; }
        chosenStaff = staffId; view.setChosenMeasure(measure.measureId); drawRange(); return;
      }
      view.clearSelection();
      view.setChosenMeasure(null);
      if (view.range()) view.setRange(null); // a tap in the margin closes the range (and its bar) too
    }
    if (view.activeCell()) view.setActiveCell(null);
  };
  // double click / double tap on a container that holds a nested score: its editor
  const onDouble = (e) => {
    if ((!onFragmentEdit && !onDiagramEdit) || !app || e.target.closest?.('[data-context-bar], [data-lyrics-field], [data-lyrics-panel], [data-inline-text]')) return;
    const { x, y, k } = toSvg(e);
    const hit = view.hitTest(x, y, { tolerance: TOLERANCE.mouse * k });
    // the container itself, or any element of the nested score it holds
    let el = hit ? app.doc.find(hit.ref) : null;
    while (el && el.type !== 'staffContainer') el = app.doc.parentOf(el.id);
    if (el?.fragments?.length) { e.preventDefault(); onFragmentEdit(el.id); }
    else if (el?.props?.containerKind === 'chordDiagram' && onDiagramEdit) { e.preventDefault(); onDiagramEdit(el.id, view.id); }
  };
  host.addEventListener('dblclick', onDouble);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('contextmenu', onContextMenu);
  host.addEventListener('pointercancel', cancelLong);
  host.addEventListener('pointerleave', onLeave);
  const off = view.onSelectionChange(() => { drawSelection(); drawMoveHandle(); drawGripHandles(); drawBar(); });
  const offContainerPlay = app ? app.onContainerPlay(() => drawBar()) : () => {};
  const offCell = view.onCellChange(() => { drawCells(); drawBar(); });
  const offMeasure = view.onMeasureChange(() => { if (!view.chosenMeasure()) chosenStaff = null; drawLoop(); drawRange(); drawBar(); });
  const offRange = view.onRangeChange(() => { drawRange(); drawBar(); });
  // la bande ne se redessine que si la boucle change (le lecteur notifie à chaque image pendant la lecture)
  let loopKey = '';
  const offPlayer = player ? player.subscribe((st) => {
    const key = JSON.stringify([st.loop, st.loopOn]);
    if (key !== loopKey) { loopKey = key; drawLoop(); }
  }) : () => {};
  // toute transaction (pose, T, suppression, annuler / refaire…) : redessin puis suivi de l'affichage (sans effet hors du mode saisie)
  const offFilter = app?.onFilterChange ? app.onFilterChange(() => drawBar()) : () => {};
  // ---------- deferred refresh: one layout after a burst of keyboard entry ----------
  // The model is up to date at once; only the (costly) layout is postponed. While the view is frozen it serves its last layout, the typed notes
  // are shown as light ghosts on it, and everything that reads the layout (a pointer press, undo, any other edit) flushes first.
  const DEFER_MS = 250; // minimum quiet time that ends a burst
  // A burst goes on while notes keep coming within `gap()` of the last activity. The gap grows with the cost of a layout: a slow layout must not make
  // every note of a normal typing speed look like the first of a new burst (then no ghost would ever show), and the wait before the real drawing is
  // about one layout and a half after the last note.
  let lastCost = 0;
  const gap = () => Math.min(1000, Math.max(DEFER_MS, 1.5 * lastCost));
  let burstTimer = null;
  let lastFlushAt = -Infinity;
  const CLICK_FLUSH_MS = (() => { const m = perf.on ? perfCss().find((x) => /^flush\d+$/.test(x)) : null; return m ? Number(m.slice(5)) : 200; })(); // quiet time before the real drawing of a click on the staff (`?perf&perfcss=flush300` to try another)
  let inDeferred = false; // inside an edit made with `deferView`
  let deferAlways = false; // that edit is a click on the staff: defer even outside a burst, draw the ghost in ink, and show the real drawing soon
  let deferChanged = false;
  const ghosts = new Map(); // chord id → ghost description
  const drawGhosts = () => {
    ghostLayer.replaceChildren();
    if (!ghosts.size || !glyphs) return;
    const ss = view.staffSpace();
    const svg = holder.querySelector('svg');
    const w = svg ? Number.parseFloat(svg.getAttribute('width')) : 4000; const h = svg ? Number.parseFloat(svg.getAttribute('height')) : 2000;
    // the notes of a click on the staff are drawn in the ink of the score (the real drawing replaces them a moment later); those of a burst of typing stay light blue
    let markup = '';
    for (const solid of [false, true]) {
      const list = [...ghosts.values()].filter((g) => Boolean(g.solid) === solid);
      if (!list.length) continue;
      markup += renderSvgString(ghostLayout(ghostLayoutItems(list), w, h, ss), glyphs, { staffSpace: ss, margin: 0, ...(solid ? {} : { ink: GHOST_INK }), paper: 'transparent' });
    }
    ghostLayer.innerHTML = markup;
    for (const inner of ghostLayer.querySelectorAll('svg')) inner.style.overflow = 'visible';
  };
  const flushView = () => {
    if (burstTimer !== null) { clearTimeout(burstTimer); burstTimer = null; }
    if (!view.isFrozen() && !ghosts.size) return;
    view.freeze(false);
    ghosts.clear(); ghostLayer.replaceChildren();
    refresh(true); drawBar(); scheduleFollow();
    lastCost = view.layoutMs?.() ?? 0;
    lastFlushAt = performance.now();
  };
  const addGhost = (solid = false) => {
    const sel = view.selection();
    const note = sel.length ? app.doc.find(sel[0]) : null;
    const chord = note?.type === 'chord' ? note : note ? app.doc.parentOf(note.id) : null;
    if (!chord || chord.type !== 'chord') return;
    for (const [id] of ghosts) if (!app.doc.find(id)) ghosts.delete(id); // replaced or removed since
    const g = describeGhost(app.doc, chord.id, (c) => view.ghostAnchor(c));
    if (!g) return;
    for (const [id, o] of ghosts) if (o.staffId === g.staffId && o.voice === g.voice && o.measureIndex === g.measureIndex && fCmp(o.start, g.end) < 0 && fCmp(g.start, o.end) < 0) ghosts.delete(id);
    g.solid = solid;
    ghosts.set(g.id, g);
    drawGhosts();
    // the rests the note replaces are hidden until the real drawing arrives (their elements are those of the old picture, found by the id they had)
    if (solid && pendingRests) {
      for (const r of pendingRests) {
        if (fCmp(r.start, g.end) < 0 && fCmp(g.start, r.end) < 0) for (const el of holder.querySelectorAll(`g[data-staff="${g.staffId}"] [data-ref="${r.id}"]`)) el.style.visibility = 'hidden';
      }
    }
    pendingRests = null;
  };
  let pendingRests = null; // the rests of the voice where a click is writing a note, read before the write
  let entryStartedAt = 0; // when the click that is being written started (for the `entry:to-ghost` measure of the probe)
  const offDefer = app?.onDeferredEdit ? app.onDeferredEdit((phase, info) => {
    if (phase === 'begin') {
      inDeferred = true; deferChanged = false; deferAlways = Boolean(info?.always);
      if (!view.isFrozen() && (deferAlways || performance.now() - lastFlushAt < gap())) view.freeze(true);
    } else {
      inDeferred = false;
      if (view.isFrozen()) {
        if (deferChanged) { addGhost(deferAlways); if (perf.on && deferAlways) perf.afterPaint('entry:to-ghost', entryStartedAt); }
        if (burstTimer !== null) clearTimeout(burstTimer);
        lastFlushAt = performance.now();
        burstTimer = setTimeout(() => { burstTimer = null; flushView(); }, deferAlways ? CLICK_FLUSH_MS : gap());
      } else { lastCost = view.layoutMs?.() ?? 0; lastFlushAt = performance.now(); }
    }
  }) : () => {};
  const onPressAnywhere = (e) => {
    // the person presses on the picture they see: with the layout still deferred that is the OLD one. What is under the pointer is read now, before the view
    // is brought up to date (measures may move), and the click that follows writes the note there (`tryEnter`).
    pressSnapshot = null;
    if ((view.isFrozen() || ghosts.size) && entryOn() && host.contains(e.target) && holder.querySelector('svg')) {
      try { const { x, y } = toSvg(e); pressSnapshot = { clientX: e.clientX, clientY: e.clientY, hit: entryHit(x, y), at: performance.now() }; } catch { pressSnapshot = null; }
    }
    flushView();
  };
  if (typeof window !== 'undefined') window.addEventListener('pointerdown', onPressAnywhere, true);
  // A view that is not on the screen (screen 2 is shown, the other screen is hidden, not destroyed) draws nothing and lays nothing out: its layout is rebuilt lazily from what
  // changed since, when `refresh()` is called as it comes back (main.js `syncScreen`). Without this every edit made on screen 2 laid screen 1 out as well.
  const isHidden = () => typeof host.getClientRects === 'function' && host.getClientRects().length === 0;
  const offDoc = app ? app.doc.subscribe(() => {
    docRevision += 1;
    if (!inDeferred && isHidden()) return;
    if (inDeferred && view.isFrozen()) { deferChanged = true; closeTabBar(); editedSinceFollow = true; return; }
    flushView(); // any other change brings the view up to date first
    closeTabBar(); refresh(true); drawBar(); drawSeqBar(); editedSinceFollow = true; scheduleFollow();
    lastCost = view.layoutMs?.() ?? 0; lastFlushAt = performance.now();
  }) : () => {};
  let wasEntryActive = !!app?.noteEntry?.().active;
  const offEntry = app?.onNoteEntryChange ? app.onNoteEntryChange((st) => {
    if (!st.active) closeTabBar();
    drawEntryCursor();
    drawSeqBar();
    // entrée en mode saisie : le curseur peut être hors de l'écran (MuseScore : `showItem` au démarrage de la saisie) ; ensuite, changer la durée,
    // la voix, etc. ne fait jamais défiler
    if (st.active && !wasEntryActive) scheduleFollow();
    wasEntryActive = st.active;
    // pendant la saisie : ni menu de copie système (iPad) ni sélection de texte par le tap long
    holder.style.webkitTouchCallout = st.active ? 'none' : ''; holder.style.userSelect = st.active ? 'none' : ''; holder.style.webkitUserSelect = st.active ? 'none' : '';
  }) : () => {};
  // saisie au clavier (table de MuseScore 4.7.5 : `noteentry-keys.js`) ; hors saisie seule la touche N (activer) est prise
  let arrowHeld = null; // { key, at, ids }: a plain arrow pressed on a selection, waiting for its release
  const transposeByKey = (ids, up, octave) => {
    try { app.transposeNotes(ids, { up, octave }, view.id); entryMessage(''); } catch (err) { const text = describeEntryError(err); if (text === null) throw err; entryMessage(text); }
    drawBar();
  };
  const onKeyUp = (e) => {
    if (!arrowHeld || e.key !== arrowHeld.key) return;
    const { at, ids } = arrowHeld; arrowHeld = null;
    // the context may have changed while the key was held (note entry started, a window opened)
    if (app?.noteEntry?.().active || document.querySelector('[aria-modal="true"]')?.contains?.(host) === false) return;
    if (!app?.transposableNotes?.(ids).length) return;
    transposeByKey(ids, e.key === 'ArrowUp', arrowPressOutcome(Date.now() - at) === 'octave');
  };
  const onBlur = () => { arrowHeld = null; };
  const onKey = (e) => {
    // fenêtre modale ouverte (éditeur de carte de percussion) : ses touches ne sont jamais des touches de saisie / de copie de la partition
    // (une lettre sur un `select`, Suppr ou une flèche sur un bouton poseraient / effaceraient des notes DERRIÈRE la fenêtre)
    // (a modal that CONTAINS this view — the editor of a nested score — is this view's own window: its keys are taken)
    if (typeof document !== 'undefined') { const modal = document.querySelector('[aria-modal="true"]'); if (modal && !modal.contains(host)) return; }
    // staff properties panel (not modal): keys typed on its controls never reach the score
    if (e.target?.closest?.('[data-staff-props], [data-tracks-panel]')) return;
    if (e.key === 'Escape') closeTabBar();
    // Ctrl/⌘ + C : copie la plage (ou la mesure choisie) ; hors champ de texte, sans texte sélectionné dans la page
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'c' && !isTextEditingTarget(e.target)) {
      const sel = typeof window !== 'undefined' && window.getSelection ? String(window.getSelection()) : '';
      const range = view.range() ?? chosenRange();
      if (range && !sel) { e.preventDefault(); copyToClipboard(range); return; }
    }
    // Ctrl/⌘ + A with a measure (or a range) selected: every measure of every staff
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'a' && !isTextEditingTarget(e.target) && app) {
      const sel = typeof window !== 'undefined' && window.getSelection ? String(window.getSelection()) : '';
      if ((view.range() ?? chosenRange()) && !sel) {
        const mv = movementOfView();
        const all = rangeFromMeasures(app.doc, mv, flatStaves(mv).map((st) => st.id), 0, mv.masterbars.length - 1);
        if (all) { e.preventDefault(); chosenStaff = null; view.setRange(all); drawRange(); drawBar(); return; }
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'x' && !isTextEditingTarget(e.target)) {
      const range = view.range() ?? chosenRange();
      if (range) { e.preventDefault(); cutToClipboard(range); return; }
    }
    // arrows on a selection, note entry off: semitone (short press) / octave (long press, or Ctrl) — as the retouch buttons
    if (app?.noteEntry && !app.noteEntry().active && !e.target?.closest?.('button, select, input, textarea, [contenteditable], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"]')) {
      const sa = selectionKeyAction(e);
      if (sa) {
        const ids = view.selection();
        if (ids.length && !view.range() && app.transposableNotes(ids).length) {
          e.preventDefault();
          if (sa.kind === 'press-start') arrowHeld = { key: e.key, at: Date.now(), ids };
          else if (sa.kind === 'octave-now') transposeByKey(ids, sa.up, true);
          return;
        }
      }
    }
    // Delete (PC) on a selection, note entry off: same as the bin button. Only when the key is free: not in a field, not on a control that uses it.
    if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && app?.noteEntry && !app.noteEntry().active && !e.defaultPrevented && !e.isComposing
      && !isTextEditingTarget(e.target) && !e.target?.closest?.('button, select, input, textarea, [contenteditable], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"]')) {
      const ids = view.selection();
      if (ids.length && !view.range() && app.deletable(ids).length) {
        e.preventDefault();
        try { app.deleteElements(ids, view.id); entryMessage(''); } catch (err) { const text = describeEntryError(err); if (text === null) throw err; entryMessage(text); }
        drawBar();
        return;
      }
    }
    if (!app?.keyboardEntry) return;
    const st = app.noteEntry();
    const inputOptions = inputOptionsOf(app.preferences);
    let action = entryKeyAction(e, { active: st.active, staffType: st.active ? app.entryStaffTypeAtCursor() : null, tabStyle: inputOptions.tabKeyStyle, tabKeyboard: inputOptions.tabKeyboard });
    if (!action) return;
    e.preventDefault();
    // Guitar Pro style: two digits typed one after the other (same place, same string, quickly) make a two-digit fret — the first note is changed, nothing is added
    if (action.type === 'fret' && action.guitarPro) {
      const c = st.cursor; const spot = c ? `${c.staffId}|${c.measureIndex}|${c.position.join('/')}|${st.tabString}` : '';
      const now = Date.now(); const prev = gpFret;
      const two = prev && prev.spot === spot && now - prev.at <= GP_FRET_DELAY && prev.value >= 1 ? prev.value * 10 + action.fret : null;
      if (two !== null && c && two <= maxFretOfStaff(c.staffId)) { action = { ...action, fret: two }; gpFret = null; } else gpFret = { spot, at: now, value: action.fret };
    } else gpFret = null;
    if (action.type === 'toggle') { closeTabBar(); app.setNoteEntry({ active: !st.active }); drawEntryCursor(); scheduleFollow(); return; }
    if (action.type === 'exit') { closeTabBar(); app.setNoteEntry({ active: false }); return; } // Escape closes the entry mode (as the entry button does); an open dialog takes the key first
    closeTabBar();
    try {
      const r = app.keyboardEntry(action, view.id);
      entryMessage(['added', 'removed', 'none', 'tied', 'untied'].includes(r?.action) ? label(`noteEntry.${r.action}`) : '');
    } catch (err) {
      const text = describeEntryError(err);
      if (text === null) throw err;
      entryMessage(text);
    }
    // les touches de déplacement (← → …) ne font pas de transaction : on suit aussi le curseur après elles
    drawEntryCursor(); scheduleFollow();
  };
  // Ctrl/⌘ + V : l'évènement `paste` donne le texte du presse-papiers système (charge copiée dans une autre page), sinon le presse-papiers interne
  const onPaste = (e) => {
    if (isTextEditingTarget(e.target)) return;
    let payload = null;
    try { payload = app.parseClipboardText(e.clipboardData?.getData('text/plain') ?? '', pasteTarget()); } catch (err) {
      if (err?.hooktheory) { e.preventDefault(); entryMessage(label(`hooktheory.${err.hooktheory}`)); return; } // a Hooktheory melody that cannot be written here: say why
      /* foreign text */
    }
    if (!payload && !app.clipboard()) return;
    e.preventDefault();
    pasteHere(payload ?? undefined);
  };
  if (typeof window !== 'undefined') { window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur); window.addEventListener('paste', onPaste); }
  // A long score opened from nothing: the beginning is drawn at once (a picture of the first measures, laid out alone), then the real layout is computed in slices
  // that give the page back between them (`view.prepare`); the page is refreshed when it is ready. Anything that needs the layout sooner (a click, a read) finishes it.
  const PREVIEW_MEASURES = 10;
  const quick = typeof window !== 'undefined' && view.isCold?.() && view.preview ? view.preview(PREVIEW_MEASURES) : null;
  if (quick) {
    opening = true; // until the real layout is ready, the display options and `refresh()` wait (they would force the layout at once)
    holder.innerHTML = uniqueSvgIds(quick.svg);
    const svg = holder.querySelector('svg');
    stage.style.width = svg ? `${svg.getAttribute('width')}px` : '';
    // let the browser paint the picture first: the real layout starts after the next frame (the timer is the fallback for a page that is not painting)
    new Promise((go) => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 120); }).then(() => view.prepare()).then((ready) => {
      opening = false;
      if (host.isConnected && (ready || !view.isCold())) { refresh(); drawBar(); drawMuted(); drawCells(); for (const fn of afterOpening.splice(0)) fn(); }
    });
  } else { refresh(); drawBar(); }
  return {
    /** Text of a note-entry error (null when it is not one). */
    describeError: (err) => describeEntryError(err),
    refresh: () => { if (!opening) { refresh(); drawBar(); } },
    /** Active / désactive la surcouche des éléments non joués (calque d'affichage, jamais dans le modèle). */
    setShowMuted(on) { showMuted = !!on; if (view.setShowMuted(showMuted) && !opening) { refresh(); drawBar(); } if (!opening) drawMuted(); },
    /** Afficher (en gris) les éléments masqués : état de la vue, la mise en page ne bouge pas. */
    setShowHidden(on) { if (view.setShowHidden(on) && !opening) { refresh(); drawBar(); } },
    /**
     * Place le curseur de lecture (`view.playCursor(...)` : { x, y1, y2, systemIndex }) ou le cache (null). `follow` : fait défiler la page pour
     * garder la barre visible (quand elle change de système ou sort de la bande centrale de l'écran).
     */
    /** Marker A alone on a measure (index) or none (null). */
    setPendingMark(index) { pendingMark = index; drawLoop(); },
    setCursor(c, { follow = false } = {}) {
      if (!c) { cursorLine.style.display = 'none'; cursorSystem = -1; return; }
      cursorLine.setAttribute('x1', c.x); cursorLine.setAttribute('x2', c.x);
      cursorLine.setAttribute('y1', c.y1); cursorLine.setAttribute('y2', c.y2);
      cursorLine.style.display = '';
      const changed = c.systemIndex !== cursorSystem;
      cursorSystem = c.systemIndex;
      if (!follow || typeof window === 'undefined') return;
      const r = cursorLine.getBoundingClientRect();
      // the scrolling view (one long system): when the cursor reaches the right of the visible zone the score turns the page, the cursor lands near the left
      // edge (just right of the sticky header); instant, so the reader does not chase a moving line
      const side = sideScroller();
      if (side.scrollWidth > side.clientWidth + 1) {
        const box = side.getBoundingClientRect();
        const turn = computePageTurn({ x: r.left, left: Math.max(box.left, 0) + stickyHeader.width(), right: Math.min(box.right, window.innerWidth || box.right) });
        if (turn) side.scrollTo({ left: side.scrollLeft + turn, behavior: 'instant' });
      }
      const vh = window.innerHeight || 0;
      if (vh && (changed || r.top < vh * 0.1 || r.bottom > vh * 0.9) && (r.top < vh * 0.15 || r.bottom > vh * 0.85)) {
        window.scrollBy({ top: r.top - vh * 0.3, behavior: 'smooth' });
      }
    },
    /** Montre / cache les contours des cases de saisie d'accords (la case active reste visible). */
    setShowCells(on) { showCells = !!on; if (!opening) drawCells(); },
    /** Shows or hides the mute / solo / volume controls at the start of each track. */
    setShowTrackControls(on) { whenReady(() => trackControls?.setEnabled(!!on)); },
    destroy() { tabBar.remove(); seqBar.remove(); offAutoView(); autoUI.destroy(); strip.destroy(); cardEdit?.destroy(); stickyHeader.destroy(); trackControls?.destroy(); blocksEditor?.destroy(); lyricsUI?.dispose(); offLyricsBar(); offStaffText(); offCreation(); staffTextUI?.dispose(); inlineUI?.dispose(); offBarButtons(); offContainerPlay(); if (typeof window !== 'undefined') { window.removeEventListener('scroll', onViewportChange); window.removeEventListener('scroll', onPageScroll); window.removeEventListener('scroll', onSignScroll); window.removeEventListener('resize', onViewportChange); } host.removeEventListener('dblclick', onDouble); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave); off(); offCell(); offMeasure(); offRange(); offPlayer(); offDoc(); offFilter(); offFilterDismiss(); offBarDismiss(); offEntry(); offDefer(); if (burstTimer !== null) clearTimeout(burstTimer); if (widenTimer !== null) clearTimeout(widenTimer); if (typeof window !== 'undefined') window.removeEventListener('pointerdown', onPressAnywhere, true); if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); window.removeEventListener('paste', onPaste); host.replaceChildren(); },
  };
}
