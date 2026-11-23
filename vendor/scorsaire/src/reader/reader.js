/*
 * The READER (read only): shows one sheet of a work, as the author prepared it, and plays its cells. It never writes anything into the work.
 *
 *   - The author's settings come from the sheet (`cellSettings`): speed, staff size, transpositions, hidden tracks, loop, track volumes. Each option has a lock;
 *     the reader offers the control of an option ONLY if the author unlocked it, and what the reader changes lives in memory (`state.over`), never in the file.
 *     Optionally ("remember my settings") it is kept in this browser, per work: off by default.
 *   - The page is laid out for the width of the window (`layoutSheet`, a matrix folds into one column on a narrow screen); the size of the staves is the author's
 *     base, or the reader's own when unlocked.
 *   - A cell is chosen by touching it; ▶ ■ act on the chosen cell (`buildCellSequence` + the engine, the playhead follows).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { applyWho } from './pupils.js';
import { mountLyricsPanel, withoutLyrics } from './lyricspanel.js';
import { loadWork } from '../model/serialize.js';
import { createSheet } from '../model/elements.js';
import { resolveStyle } from '../model/props.js';
import { sheetCells, cellSettings, readerOptions, effectivePlayerMode, CAROUSEL_WIDTH, STAFF_SIZE_RANGE, TRANSPOSE_RANGE, SPEED_RANGE } from '../model/sheetedit.js';
import { SID } from '../model/sid.js';
import { sectionSpans, SECTION_NAMES } from '../model/sections.js';
import { layoutSheet } from '../layout/sheetlayout.js';
import { playheadRect, measureZones, measureAt } from '../layout/sheetcursor.js';
import { renderSvgString } from '../render/svg.js';
import { buildCellSequence } from '../audio/sheetplay.js';
import { locate, secondsOf } from '../audio/cursor.js';
import { createContainerPlayback } from '../ui/container-playback.js';
import { createI18n } from '../i18n/index.js';
import glyphs from '../glyphs/bravura-subset.json';
import { BUTTON_KEY, savePortalButtonSize } from './portal-prefs.js';
import { createReaderAudio } from './audio.js';
import { mountReaderViewers } from './viewers.js';
import { strongOf } from '../view/color.js';
import { addSectionCards } from '../ui/sheet-cards.js';
import { prerollPlan, beatClicks } from './preroll.js';
import { iconNodes } from '../model/iconshapes.js';
import { applyIconName } from '../ui/icons.js';
import { markCyclic } from '../ui/button-behavior.js';
import { scaleRecipeOf, scaleContent } from '../scales/display.js';
import { fretboardSvg } from '../scales/fretboard-svg.js';
import { parseInstrument, SCALE_INSTRUMENTS } from '../scales/instruments.js';
import { lib as scaleLib, TUNINGS as SCALE_TUNINGS } from '../scales/index.js';
import { installScaleLayoutHook } from '../scales/layout-hook.js';
installScaleLayoutHook();

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};
const btn = (text, fn, attrs = {}) => el('button', { type: 'button', onclick: fn, 'data-no-icon': '', ...attrs }, text);

const CSS = `
.rd { font: 15px var(--ui-font,sans-serif); color: var(--ink,#1c1b1a); background: var(--paper,#faf8f4); min-height: 100vh; }
.rd-bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 10px; background: var(--field,#fff); border-bottom: 1px solid var(--line,#d8d3c8); }
.rd-bar button, .rd-panel button { min-width: var(--rd-target, 40px); min-height: var(--rd-target, 40px); padding: 0 10px; font: inherit; background: var(--field,#fff); border: 1px solid var(--edge,#bbb); border-radius: 8px; cursor: pointer; }
.rd-bar button:disabled, .rd-panel button:disabled { opacity: .45; cursor: default; }
.rd button[aria-pressed="true"] { background: #1c1b1a; color: #fff; border-color: var(--ink,#1c1b1a); }
.rd-title { font-weight: var(--w-semi,600); margin-right: 8px; }
/* a phone or a tablet: a title of several words is spread over two lines beside the buttons (it takes what the others leave on the row) */
@media (pointer: coarse), (max-width: 900px) { .rd-bar .rd-title { flex: 1 1 7em; min-width: 0; max-width: 16em; margin-right: 4px; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; } }
.rd-grow { flex: 1; }
.rd-val { min-width: 54px; text-align: center; font-variant-numeric: tabular-nums; }
.rd-group { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 4px; white-space: nowrap; } /* the buttons of a group never part: the whole group goes to the next line, or none of it */
.rd-status { font-size: 12px; color: var(--ink-soft,#666); }
.rd-spin { display: inline-block; width: 11px; height: 11px; margin-right: 6px; vertical-align: -1px; border: 2px solid var(--edge,#c9c4b8); border-top-color: var(--ink-soft,#666); border-radius: 50%; animation: rd-spin .8s linear infinite; }
@keyframes rd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .rd-spin { animation-duration: 2.4s; } }
.rd-panel { padding: 8px 12px; background: var(--soft,#f3f0e8); border-bottom: 1px solid var(--line,#d8d3c8); display: flex; flex-direction: column; gap: 8px; }
.rd-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rd-row .rd-label { min-width: 180px; }
.rd-tracks { display: flex; flex-direction: column; gap: 4px; }
.rd-track { display: flex; align-items: center; gap: 6px; }
.rd-track input[type=range] { width: 160px; }
.rd-stage { padding: 12px; }
.rd-frame { display: grid; gap: 12px; }
.rd-cell { display: flex; flex-direction: column; position: relative; background: var(--score,#fff); border: 1px solid var(--line,#ddd); border-radius: 12px; overflow: hidden; cursor: pointer; min-width: 0; }
.rd-cell[aria-selected="true"] { outline: 3px solid #5a9a8a; outline-offset: -1px; }
.rd-cell svg:not(.rd-ic) { display: block; width: 100%; height: auto; }
.rd-cc .rd-ic { width: 20px; height: 20px; display: inline-block; flex: none; }
.rd-cap { padding: 4px 8px; font-size: 13px; color: var(--ink-soft,#555); border-bottom: 1px dashed var(--line,#ddd); }
/* the 'cases' mode: every cell carries its own player, as a bar ABOVE the music (never over it), with the same buttons as the top bar of the reader */
.rd-cell .rd-cc { order: -1; position: static; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line,#ddd); background: var(--module,#fcfbf8); cursor: default; }
.rd-cc .rd-cc-title { flex: 1 1 8em; min-width: 0; font: 13px var(--ui-font,sans-serif); color: var(--ink-soft,#555); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; order: 2; text-align: right; }
.rd-cc .rd-cb { min-width: var(--rd-target, 40px); min-height: var(--rd-target, 40px); padding: 0 10px; font: inherit; background: var(--field,#fff); color: var(--ink,#1c1b1a); border: 1px solid var(--edge,#bbb); border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.rd-cc .rd-cb[aria-pressed="true"] { background: var(--btn-on,#e2e0da); border-color: var(--btn-on-line,#8a857a); }
.rd-cc .rd-cb:disabled { opacity: .45; cursor: default; }
.rd-cc .rd-cb svg { pointer-events: none; }
.rd-cc .rd-cc-val { min-width: 4.2ch; text-align: center; font: 13px var(--ui-font,sans-serif); font-variant-numeric: tabular-nums; }
.rd-cc .rd-cc-group { display: inline-flex; align-items: center; gap: 2px; }
.rd-nav { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 4px 0 10px; }
.rd-nav button { min-width: var(--rd-round, 44px); min-height: var(--rd-round, 44px); border-radius: 8px; padding: 0; font: 22px var(--ui-font,sans-serif); background: var(--field,#fff); border: 1px solid var(--edge,#bbb); cursor: pointer; }
.rd-nav button:disabled { opacity: .35; }
.rd-nav .rd-navtext { min-width: 6em; text-align: center; font-variant-numeric: tabular-nums; }
.rd-pop { position: fixed; z-index: 30; left: 8px; right: 8px; bottom: 8px; margin: 0 auto; max-width: 440px; max-height: 62vh; overflow: auto; box-sizing: border-box; padding: 10px 12px; background: var(--field,#fff); border: 1px solid #aaa; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
.rd-pop .rd-row { margin: 6px 0; }
.rd-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line,#d8d3c8); }
.rd-sheet-close { float: right; position: sticky; top: 0; z-index: 2; margin: 0 0 4px 8px; } /* beside the first row instead of a line of its own */
.rd-controls .rd-ctl { display: flex; align-items: center; gap: 10px; margin: 0; width: 100%; }
.rd-controls .rd-ctl .rd-label { min-width: 9.5em; }
.rd-sum { font-size: .8em; font-weight: 600; white-space: nowrap; }
.rd-pop .rd-panel { padding: 0 0 8px; background: transparent; border-bottom: 1px solid var(--line,#d8d3c8); margin: 0 0 10px; }
.rd-pop .rd-help { margin: 0 0 10px; }
.rd-veil { position: fixed; inset: 0; z-index: 29; background: rgba(0,0,0,.28); }
.rd-tracks-sheet { max-width: 560px; max-height: 72vh; }
.rd-tracks-sheet.rd-rising { animation: rd-rise .2s ease-out; }
@keyframes rd-rise { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
.rd-pop button { min-width: var(--rd-target, 40px); min-height: var(--rd-target, 40px); padding: 0 10px; font: inherit; background: var(--field,#fff); border: 1px solid var(--edge,#bbb); border-radius: 8px; cursor: pointer; }
.rd-pop button[aria-pressed="true"] { background: #1c1b1a; color: #fff; border-color: var(--ink,#1c1b1a); }
.rd-bubble { position: fixed; z-index: 40; padding: 3px 8px; background: #1c1b1a; color: #fff; border-radius: 10px; font: 13px var(--ui-font,sans-serif); pointer-events: none; }
.rd-empty { padding: 40px; text-align: center; color: var(--ink-soft,#666); }
.rd-head { position: sticky; top: 0; z-index: 5; background: var(--field,#fff); border-bottom: 1px solid var(--line,#d8d3c8); }
.rd-head .rd-bar { position: static; border-bottom: 0; }
.rd-strip { position: relative; height: 24px; margin: 0 10px; }
.rd-card { position: absolute; top: 0; height: 22px; box-sizing: border-box; padding: 0 6px; font: 12px/22px var(--ui-font,sans-serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--edge,#b9b4a8); border-radius: 4px; background: var(--soft,#eee); color: var(--ink,#222); cursor: pointer; text-align: left; min-width: 0; }
.rd-card.re { border-style: dashed; text-align: center; padding: 0 3px; }
.rd-prog { position: relative; height: 18px; margin: 2px 10px 8px; background: var(--track,#e9e5da); border-radius: 9px; cursor: pointer; touch-action: none; }
.rd-prog-loop { position: absolute; top: 0; bottom: 0; background: rgba(88,150,134,.4); border-radius: 9px; pointer-events: none; }
.rd-prog-pos { position: absolute; top: -3px; width: 4px; height: 24px; margin-left: -2px; background: #e8731a; border-radius: 2px; pointer-events: none; }
.rd-time { font: 13px var(--ui-font,sans-serif); color: var(--ink-soft,#444); min-width: 92px; text-align: center; font-variant-numeric: tabular-nums; }
.rd-body { display: flex; align-items: flex-start; }
.rd-body > .rd-stage { flex: 1; min-width: 0; }
.rd-side { width: 270px; flex: none; position: sticky; top: 96px; max-height: calc(100vh - 100px); overflow: auto; padding: 8px; background: var(--soft,#f3f0e8); border-left: 1px solid var(--line,#d8d3c8); }
.rd-side h4 { margin: 0 0 6px; font-size: 13px; color: var(--ink-soft,#555); }
.rd-tcard { background: var(--field,#fff); border: 1px solid var(--line,#d8d3c8); border-radius: 8px; padding: 6px; margin-bottom: 6px; }
.rd-tcard.off { opacity: .55; }
.rd-tcard .rd-trow { display: flex; align-items: center; gap: 3px; }
.rd-tcard .rd-tname { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rd-tcard button { min-width: 32px; min-height: 32px; padding: 0 6px; }
.rd-tcard input[type=range] { width: 100%; margin: 4px 0 0; }
.rd-seccard { position: absolute; box-sizing: border-box; border: 1px solid; border-radius: 4px; padding: 0 7px; font: var(--w-semi,600) 11.5px/1.5 var(--ui-font,sans-serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; background: transparent; }
.rd-signs { position: relative; height: 11px; margin: 1px 0 0; }
.rd-sign { position: absolute; top: 0; line-height: 0; }
.rd-sign.end { transform: translateX(-100%); }
.rd-loopband { position: absolute; background: rgba(88,150,134,.2); pointer-events: none; }
.rd-help { position: absolute; z-index: 9; right: 10px; top: 100%; width: min(420px, 92vw); padding: 10px 12px; background: var(--field,#fff); border: 1px solid var(--edge,#bbb); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.2); font-size: 14px; }
input[type=range] { -webkit-appearance: none; appearance: none; height: 16px; background: transparent; margin: 0; cursor: pointer; }
input[type=range]::-webkit-slider-runnable-track { height: 3px; background: #c9c4b8; border-radius: 2px; }
input[type=range]::-moz-range-track { height: 3px; background: #c9c4b8; border-radius: 2px; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5.5px; border-radius: 50%; background: #5a5750; border: 0; }
input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #5a5750; border: 0; }
.rd-help p { margin: 0 0 .9em; } .rd-help p:last-child { margin: 0; }
.rd-master { width: 90px; }
.rd-knob { width: var(--sz, 22px); height: var(--sz, 22px); box-sizing: border-box; border-radius: 50%; border: 2px solid #8a857a; background: var(--field,#fff); position: relative; cursor: ns-resize; touch-action: none; flex: none; --a: 0deg; }
.rd-knob::after { content: ''; position: absolute; left: 50%; top: 2px; width: 2px; height: calc(var(--sz, 22px) * .32); margin-left: -1px; background: #444; border-radius: 1px; transform-origin: 1px calc((var(--sz, 22px) - 4px) / 2 - 2px); transform: rotate(var(--a)); }
.rd-knob:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
.rd-fret svg { width: 100%; height: auto; display: block; color: var(--ink,#1c1b1a); --scale-note: #4a4458; --scale-root: #b3261e; --scale-ink: #7a7468; --scale-board: #f1ece0; }
.rd-scale select { min-height: var(--rd-target, 40px); font: inherit; padding: 0 8px; border: 1px solid var(--edge,#bbb); border-radius: 8px; background: var(--field,#fff); color: inherit; }
.rd-cell svg { -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
`;

/**
 * Mounts the reader into `host`. `source` = the text of a `.scorsaire` file or an already loaded work. → { destroy, open(work, { movement }) }.
 */
export function mountReader(host, { source = null, lang = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2), storage = null } = {}) {
  if (!document.getElementById('rd-style')) { const st = el('style', { id: 'rd-style' }); st.textContent = CSS; document.head.append(st); }
  const t = createI18n(['fr', 'en'].includes(lang) ? lang : 'fr');
  const audio = createReaderAudio();
  const root = el('div', { class: 'rd' }); host.append(root);
  const trackNameOf = (id) => { for (const m of work?.movements ?? []) { const tr = m.tracks.find((x) => x.id === id); if (tr) return tr.props[PID.NAME] || ''; } return ''; };
  const viewers = mountReaderViewers({ host, t, trackName: trackNameOf });
  const fitDock = () => { root.style.paddingBottom = `${viewers.height() + 6}px`; };
  viewers.onChange(() => { fitDock(); for (const b of root.querySelectorAll('[data-send]')) b.setAttribute('aria-pressed', String(viewers.has(b.getAttribute('data-send')))); });
  window.addEventListener('resize', fitDock);
  let controlsBox = null; let work = null; let sheet = null; let laid = null; let panelOpen = false; let status = ''; let raf = 0;
  const FOLLOW_KEY = 'scorsaire.reader.follow';
  let follow = true; try { follow = storage?.getItem(FOLLOW_KEY) !== '0'; } catch { /* storage unavailable: on */ } // the view follows the playhead (on by default)
  let lyricsPanel = null; // the lyrics by strophes (lyricspanel.js)
  const state = { only: null, initial: null, sheetId: null, selected: null, size: null, over: {}, remember: false, start: {}, tracksOpen: true, helpOpen: false, master: null, preroll: 0, metronome: 'pre', clickVolume: 0.6, signs: undefined };

  // the size of the buttons: a setting of THIS device (never in a file), small / medium / large
  const UI_SIZES = { small: ['34px', '38px'], medium: ['40px', '44px'], large: ['52px', '58px'] };
  const UI_KEY = 'scorsaire-reader-ui';
  const PORTAL_SIZE = { compact: 'small', standard: 'medium', grand: 'large' }; // the school portal's names (reader/portal-prefs.js) for these three sizes
  const portalUi = () => { try { return PORTAL_SIZE[storage?.getItem(BUTTON_KEY)] ?? null; } catch { return null; } };
  let uiSize = 'medium';
  try { const v = storage?.getItem(UI_KEY); if (UI_SIZES[v]) uiSize = v; } catch { /* storage unavailable: medium */ }
  uiSize = portalUi() ?? uiSize; // a size chosen on the portal wins: the portal and the reader agree
  const applyUi = () => { root.style.setProperty('--rd-target', UI_SIZES[uiSize][0]); root.style.setProperty('--rd-round', UI_SIZES[uiSize][1]); };
  applyUi();
  function cycleUiSize() {
    const ids = Object.keys(UI_SIZES); uiSize = ids[(ids.indexOf(uiSize) + 1) % ids.length]; applyUi();
    try { storage?.setItem(UI_KEY, uiSize); } catch { /* kept for this page only */ }
    savePortalButtonSize(storage, Object.keys(PORTAL_SIZE).find((k) => PORTAL_SIZE[k] === uiSize)); // the same key as the portal's, so that both stay in agreement
    lastWidth = 0; draw();
  }
  window.addEventListener('storage', (e) => { if (e.key !== BUTTON_KEY && e.key !== null) return; const v = portalUi(); if (v && v !== uiSize) { uiSize = v; applyUi(); lastWidth = 0; draw(); } }); // changed in another tab
  /** 'global' = one set of controls for the page, 'cases' = a player on every cell (the author's choice; 'auto' = by the number of cells). */
  const mode = () => (sheet ? effectivePlayerMode(readerOptions(sheet), cellsNow().length) : 'global');
  const casesMode = () => mode() === 'cases';
  /** The carousel (one cell at a time): forced by the author, or by a window narrower than CAROUSEL_WIDTH. */
  const carouselOn = () => { if (!casesMode() || cellsNow().length < 2) return false; const c = readerOptions(sheet).carousel; return c === 'always' || (c === 'auto' && (root.clientWidth || window.innerWidth) < CAROUSEL_WIDTH); };
  const playback = createContainerPlayback({ getEngine: () => audio.getEngine(), player: null, build: (key) => buildFor(key.split('|')[1]) });
  playback.subscribe(() => { draw(); kick(); if (!playback.cursor()) viewers.tick({ playing: false, position: 0, sequence: null }); });
  audio.onStatus((s) => { status = s.status === 'loading' ? t('reader.soundLoading', { p: Math.round((s.progress ?? 0) * 100) }) : s.status === 'error' ? t('reader.soundError') : ''; const e = root.querySelector('.rd-status[data-sound]'); if (e && !warming) e.textContent = status; watchWarm(); });

  // ---------- SCALE movements: shown for the instrument of the pupil ----------
  // A movement that carries a recipe (`PID.SCALE_RECIPE`) has its content REPLACED here by what suits the instrument (the staff in his clef, or the tablature of a position), from the address
  // (`instrument=`) and then from what the pupil picks in the sheet of the cell. The file is never written; the notes the author wrote stay in the file.
  function prepareScales(instrument, asked = {}) {
    state.scale = {}; const ins = parseInstrument(instrument);
    for (const mv of work.movements) {
      let base = scaleRecipeOf(mv); if (!base) continue;
      // the address may give THIS pupil his own scale and root over the recipe of the file (a wrong one is ignored: the author's stays)
      const own = { ...base, ...(asked.scale ? { scale: asked.scale, alias: undefined, custom: undefined, position: undefined } : {}), ...(asked.root ? { root: asked.root, position: undefined } : {}) };
      try { scaleContent(own, {}); base = own; } catch { /* unknown scale or root: the file's recipe */ }
      applyScale(mv, base, ins ? { instrument: ins } : {});
    }
  }
  function applyScale(mv, base, choice) {
    const merged = { ...base }; if (choice.instrument && choice.view === undefined) delete merged.view; if (choice.instrument || choice.system) delete merged.position;
    const c = scaleContent(merged, choice);
    mv.tracks = c.tracks; mv.masterbars = c.masterbars;
    state.scale[mv.id] = { base, choice, ...c };
    timings.clear();
  }
  /** The fretboard of a scale movement in the view « fretboard » (the playback is the tablature's). */
  function fretboardOf(sc) {
    const ins = SCALE_INSTRUMENTS[sc.recipe.instrument]; if (!ins.lib || !sc.pos) return '';
    return `<div class="rd-fret" data-scale-fretboard>${fretboardSvg({ midi: SCALE_TUNINGS[ins.lib].standard.midi, position: sc.pos.position, label: 'name', title: `${t('reader.fretboard')} · ${sc.recipe.root} ${scaleLib.displayName(sc.recipe.scale, { alias: sc.recipe.alias, lang: lang === 'en' ? 'en' : 'fr' })}` })}</div>`;
  }
  /** Does the work hold a SCALE container (a scale shown above a staff, written for the instrument of that track)? */
  const hasScaleContainers = () => work.movements.some((m) => m.tracks.some((tr) => tr.staves.some((s) => (s.containers ?? []).some((c) => getProperty(c, PID.SCALE_RECIPE)))));
  /** How the scales above the staves are shown: for the instrument of the track (staff or tablature), as a staff, as a tablature, or not at all. */
  function scaleEncartRow() {
    if (!hasScaleContainers()) return null;
    const modes = [['auto', 'scales.encart.auto'], ['score', 'scales.view.score'], ['tab', 'scales.view.tab'], ['hidden', 'scales.encart.hidden']];
    return el('div', { class: 'rd-row', 'data-scale-encart': '' }, el('span', { class: 'rd-label' }, t('scales.encart')),
      ...modes.map(([m, k]) => btn(t(k), () => { state.scaleView = m; lastWidth = 0; draw(); }, { 'data-scale-encart-mode': m, 'aria-pressed': String((state.scaleView ?? 'auto') === m) })));
  }
  /** The part of the sheet of a cell that chooses the instrument, the view and the position of a scale movement (null for another movement). */
  function scalePanel(cell) {
    const sc = state.scale?.[cell.movementId]; if (!sc) return null;
    const r = sc.recipe; const mv = movementOf(cell); const lang2 = lang === 'en' ? 'en' : 'fr';
    const set = (patch) => { if (playback.isPlaying() || countIn) stopPlayback(); applyScale(mv, sc.base, { ...sc.choice, ...patch }); draw(); };
    const box = el('div', { class: 'rd-scale', 'data-scale-panel': cell.movementId });
    box.append(el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, t('scales.instrument')),
      el('select', { 'data-scale-instrument': '', 'aria-label': t('scales.instrument'), onchange: (e) => set({ instrument: e.target.value, view: undefined, position: undefined, system: undefined }) },
        ...Object.keys(SCALE_INSTRUMENTS).map((i) => el('option', { value: i, ...(i === r.instrument ? { selected: '' } : {}) }, t(`scales.inst.${i}`))))));
    if (sc.views.length > 1) box.append(el('div', { class: 'rd-row' }, ...sc.views.map((v) => btn(t(`scales.view.${v}`), () => set({ view: v }), { 'data-scale-view': v, 'aria-pressed': String(r.view === v) }))));
    if (sc.pos && r.view !== 'score') {
      const p = sc.pos; const i = p.list.indexOf(p.position);
      const names = scaleLib.availableSystems(sc.scale, { instrument: SCALE_INSTRUMENTS[r.instrument].lib });
      box.append(el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, t('scales.system')), ...p.systems.map((s) => btn(names.find((x) => x.id === s)?.[lang2] ?? s, () => set({ system: s, position: undefined }), { 'data-scale-system': s, 'aria-pressed': String(p.system === s) }))));
      box.append(el('div', { class: 'rd-row' }, btn('◀', () => set({ position: p.list[i - 1].id }), { 'data-scale-step': '-1', disabled: i <= 0, 'aria-label': t('scales.previous') }),
        el('span', { class: 'rd-val', style: 'min-width:12em', 'aria-live': 'polite' }, `${p.position.label?.[lang2] ?? p.position.id} (${i + 1}/${p.list.length})`),
        btn('▶', () => set({ position: p.list[i + 1].id }), { 'data-scale-step': '1', disabled: i >= p.list.length - 1, 'aria-label': t('scales.next') })));
      if (sc.scale.notes_count === 7 && !p.systems.includes('berklee')) box.append(el('div', { class: 'rd-status' }, t('scales.berkleeOnly6')));
      if (p.system === 'berklee' || p.system === 'caged') box.append(el('div', { class: 'rd-status' }, t('scales.credit')));
    }
    return box;
  }

  // ---------- the work and the sheet ----------
  function open(next, { movement = null, speed = null, transpose = null, loop = null, instrument = null, scale = null, root = null, tracks = null, trackShifts = null, who = null, mute = null, preroll = null, click = null, viewer = null, lyrics = null } = {}) {
    work = typeof next === 'string' ? loadWork(next) : next;
    prepareScales(instrument, { scale, root });
    applyWho(work, who);
    lyricsPanel?.element.remove();
    lyricsPanel = mountLyricsPanel({ work, lang: lang === 'en' ? 'en' : 'fr', t, asked: lyrics, storage, onChange: () => draw() }); // the words as strophes under the music unless asked otherwise
    const sheets = work.sheets ?? [];
    // one movement asked for (by its id, stable in the file): it must exist, and the sheet shown is the first one that holds it
    state.only = movement || null; state.initial = { speed, transpose, loop, tracks, trackShifts, who, mute, preroll, click, viewer };
    if (state.only && !work.movements.some((m) => m.id === state.only)) { const e = new Error(`Unknown movement: ${state.only}`); e.code = 'movement'; state.only = null; throw e; }
    const holder = state.only && sheets.find((s) => cellsOf(s).length);
    state.sheetId = (typeof window !== 'undefined' && sheets.find((s) => s.id === window.__scorsaireSheet)?.id) || holder?.id || (state.only ? null : sheets[0]?.id) || null; // the editor's preview names the sheet on view
    chooseSheet(state.sheetId);
    if (viewer === 'piano' || viewer === 'guitar') { // the viewer asked for by the address, unfolded at once, lighting the tracks asked for (all of them when none)
      viewers.clearTracks();
      const known = new Set(work.movements.flatMap((m) => m.tracks.map((x) => x.id)));
      for (const id of tracks ?? []) if (known.has(id) && !viewers.has(id)) viewers.toggleTrack(id);
      viewers.setView(viewer); viewers.open(true);
    }
  }
  /** A work with no sheet is shown as one cell per movement, everything locked. */
  const defaultSheet = () => {
    const s = createSheet({ id: 'default', name: '' });
    s.props[PID.SHEET_CELLS] = work.movements.filter((m) => !state.only || m.id === state.only).map((m, i) => ({ id: `c${i}`, movementId: m.id, tracks: null }));
    return s;
  };
  /** Warms the sounds of every cell of the sheet (one cell every 40 ms, so the page is not held up), so that the first ▶ does not stutter while the synth decodes them. */
  let warmTimer = null;
  function warmSounds() {
    clearTimeout(warmTimer);
    const list = cellsNow().slice(0, 60); let i = 0;
    const next = () => { if (i >= list.length) return; try { const t = timing(list[i++]); if (t) audio.warm(t.seq); } catch { /* a cell that cannot be built is skipped */ } warmTimer = setTimeout(next, 40); };
    warmTimer = setTimeout(next, 200);
  }
  // The sounds of the cell about to be played are prepared first; until they are, a spinner shows and ▶ waits (never more than WARM_HOLD_MS: the rest is decoded on the way, as before).
  let warming = false; let warmWatch = null; let warmSince = 0;
  const WARM_HOLD_MS = 6000;
  const warmMessage = () => (warming ? `${t('reader.soundPreparing')}` : status);
  const showWarm = () => {
    for (const e of root.querySelectorAll('.rd-status[data-sound]')) { e.replaceChildren(...(warming ? [el('span', { class: 'rd-spin', 'aria-hidden': 'true' }), warmMessage()] : [status])); }
    for (const b of root.querySelectorAll('[data-action="play"], [data-action="case-play"]')) { if (warming) { b.setAttribute('disabled', ''); b.dataset.warmHeld = ''; } else if (b.dataset.warmHeld !== undefined) { delete b.dataset.warmHeld; if (audio.available) b.removeAttribute('disabled'); } }
  };
  let heldFor = null; // the cell (and speed) whose sounds were asked first: asked again only when it changes
  function watchWarm() {
    if (warmWatch || !audio.warming()) return;
    warming = true; warmSince = Date.now(); showWarm();
    warmWatch = setInterval(() => {
      if (audio.warming() && Date.now() - warmSince < WARM_HOLD_MS) return;
      clearInterval(warmWatch); warmWatch = null; warming = false; showWarm();
    }, 150);
  }
  function holdForSound() {
    const cell = selectedCell(); const tm = cell && timing(cell);
    if (!tm || !audio.available) return;
    if (heldFor !== tm.seq) { heldFor = tm.seq; audio.warm(tm.seq, { priority: true }); }
    watchWarm();
  }
  function chooseSheet(id) {
    sheet = (work.sheets ?? []).find((s) => s.id === id) ?? defaultSheet();
    state.sheetId = sheet.id; state.selected = cellsNow()[0]?.id ?? null; state.over = {}; state.size = null; state.names = undefined; state.remember = false; state.start = {}; timings.clear();
    restore();
    applyInitial();
    draw();
    warmSounds();
  }
  /** The values asked for by the address, put on the cells shown as the reader's own choices (so an author's lock still decides). */
  function applyInitial() {
    const ini = state.initial; if (!ini) return;
    if (ini.preroll != null) state.preroll = ini.preroll; // count-in and metronome asked for by the address (the reader can change them)
    if (ini.click) state.metronome = ini.click;
    for (const cell of cellsNow()) {
      const o = over(cell.id); const ids = movementOf(cell).masterbars.map((b) => b.id);
      if (ini.speed != null) o.speed = ini.speed;
      if (ini.transpose != null) { o.transposeDisplay = ini.transpose; o.transposePlay = ini.transpose; }
      const here = new Set(movementOf(cell).tracks.map((x) => x.id));
      const wanted = (ini.tracks ?? []).filter((id) => here.has(id));
      if (wanted.length) { o.shown = wanted; o.hiddenMuted = false; } // the tracks to show first (the reader can show the others); the ones not shown still SOUND: the pupil hears the whole band (an author's lock on this still wins)
      const shifts = Object.fromEntries(Object.entries(ini.trackShifts ?? {}).filter(([id]) => here.has(id)));
      if (Object.keys(shifts).length) o.trackShift = shifts;
      const quiet = (ini.mute ?? []).filter((id) => here.has(id));
      if (quiet.length) o.muted = quiet; // the tracks the pupil plays herself: shown, not heard
      if (ini.who && cellSettings(sheet, cell).unlocked.names) state.names = true; // the name of the player is worth showing
      const a = ini.loop ? ids.indexOf(ini.loop.from) : -1; const b = ini.loop ? ids.indexOf(ini.loop.to) : -1;
      if (a >= 0 && b >= a) { o.loop = { from: ids[a], to: ids[b] }; o.loopActive = true; }
    }
  }
  const key = () => `scorsaire-reader:${work.props?.[PID.TITLE] ?? ''}|${sheet.id}`;
  function restore() {
    try { const raw = storage?.getItem(key()); if (!raw) return; const d = JSON.parse(raw); state.over = d.over ?? {}; state.size = d.size ?? null; state.master = d.master ?? null; state.preroll = d.preroll ?? 0; state.metronome = ['off', 'always'].includes(d.metronome) ? d.metronome : 'pre'; state.clickVolume = d.clickVolume ?? 0.6; state.signs = d.signs; state.names = typeof d.names === 'boolean' ? d.names : undefined; state.remember = true; } catch { /* nothing kept */ }
  }
  function save() {
    try { if (state.remember) storage?.setItem(key(), JSON.stringify({ over: state.over, size: state.size, master: state.master, preroll: state.preroll, metronome: state.metronome, clickVolume: state.clickVolume, signs: state.signs, names: state.names })); else storage?.removeItem(key()); } catch { /* storage unavailable */ }
  }

  // ---------- the settings in force: the author's, with the reader's changes on top (a lock only matters for size, speed, transpositions and the hidden-track rule) ----------
  /** The cells of a sheet, cut to ONE movement when the page was opened for one (`open(work, { movement })`). */
  const cellsOf = (sh) => { const all = sheetCells(work, sh); return state.only ? all.filter((c) => c.movementId === state.only) : all; };
  function cellsNow() { return cellsOf(sheet); }
  const selectedCell = () => cellsNow().find((c) => c.id === state.selected) ?? null;
  const over = (cellId) => (state.over[cellId] ??= {});
  const movementOf = (cell) => work.movements.find((m) => m.id === cell.movementId);
  /** The name of the drawing of a cell for a screen reader (axe `svg-img-alt`): the movement's title, else the work's, else « Score » / « Partition ». */
  const cellName = (cell) => String(movementOf(cell)?.props?.[PID.TITLE] || work.props?.[PID.TITLE] || (lang === 'en' ? 'Score' : 'Partition')).trim() || (lang === 'en' ? 'Score' : 'Partition');
  function effective(cell) {
    const base = cellSettings(sheet, cell); const o = state.over[cell.id] ?? {}; const open = base.unlocked;
    const pick = (lock, k) => (open[lock] && o[k] !== undefined ? o[k] : base[k]);
    const eff = { ...base, speed: pick('speed', 'speed'), hiddenMuted: pick('hiddenMuted', 'hiddenMuted'), unlocked: open };
    eff.staffSize = open.staffSize && state.size != null ? state.size : base.staffSize;
    eff.showNames = open.names && state.names !== undefined ? state.names : base.showNames; // the reader's choice (when the author lets it) over the sheet's and the cell's
    if (open.transposeDisplay && o.transposeDisplay !== undefined) { eff.transposeDisplay = o.transposeDisplay; eff.tracks = {}; }
    if (open.transposeDisplay && o.trackShift) { eff.tracks = { ...eff.tracks }; for (const [id, n] of Object.entries(o.trackShift)) eff.tracks[id] = { ...(eff.tracks[id] ?? {}), transposeDisplay: n }; } // the single tracks asked for by the address
    if (open.transposePlay && o.transposePlay !== undefined) eff.transposePlay = o.transposePlay;
    let shown = o.shown ?? cell.tracks; // choosing the tracks and the loop is always the reader's
    if (o.shown === undefined && lyricsPanel?.staffHidden()) shown = withoutLyrics(movementOf(cell), shown, lyricsPanel.trackIds()); // the words are shown as strophes: their staff stays off unless the person shows it
    const loop = o.loop !== undefined ? o.loop : cell.loop;
    const on = loop && (o.loopActive !== undefined ? o.loopActive : loop.active !== false);
    return { eff, cell: { ...cell, tracks: shown, loop: on ? loop : null }, loop, loopOn: !!on };
  }
  const anyUnlocked = () => cellsNow().some((c) => Object.entries(cellSettings(sheet, c).unlocked).some(([k, v]) => v && (k === 'hiddenMuted' || k === 'signs' || k === 'names')));
  const overridesFor = (cell) => {
    const { eff } = effective(cell); const o = state.over[cell.id] ?? {};
    return { speed: eff.speed, hiddenMuted: eff.hiddenMuted, ...(eff.unlocked.transposePlay && o.transposePlay !== undefined ? { transposePlay: o.transposePlay } : {}), ...(o.volumes ? { volumes: o.volumes } : {}), ...(o.muted?.length ? { muted: o.muted } : {}), ...(o.solo?.length ? { solo: o.solo } : {}), ...(state.master != null ? { master: state.master } : {}) };
  };

  // ---------- the time line of a cell (cached: it only depends on the speed and the loop) ----------
  const timings = new Map();
  function timing(cell) {
    const { cell: shown, eff } = effective(cell); const k = `${cell.id}|${eff.speed}|${shown.loop ? `${shown.loop.from}-${shown.loop.to}` : ''}`;
    let t = timings.get(k);
    if (!t) {
      const r = buildCellSequence(work, sheet, { ...cell, tracks: null, loop: shown.loop }, { overrides: { speed: eff.speed } });
      t = r ? { seq: r.sequence, duration: r.sequence.duration, loop: r.loop } : null; timings.set(k, t);
    }
    return t;
  }

  // ---------- playing a cell ----------
  function buildFor(cellId) {
    const cell = cellsNow().find((c) => c.id === cellId); if (!cell) return null;
    const { cell: shownCell } = effective(cell);
    const r = buildCellSequence(work, sheet, shownCell, { overrides: overridesFor(cell) });
    if (!r) return null;
    if (r.loop) r.sequence.cellLoop = r.loop;
    return r.sequence;
  }
  const keyOf = (c) => `${sheet.id}|${c.id}`;
  const isPlaying = () => { const c = selectedCell(); return !!c && playback.isPlaying(keyOf(c)); };
  const startOf = (cell) => state.start[cell.id] ?? (timing(cell)?.loop?.start ?? 0);
  let countIn = null; // timer of a metronome-only count-in that has not started the music yet
  const cancelClicks = () => { try { audio.getEngine()?.cancelClicks?.(); } catch { /* no metronome in this engine */ } };
  function playSelected() {
    const c = selectedCell(); if (!c) return; audio.start(); userScrollAt = -1e9; // (▶ shows where the music is, whatever was scrolled by hand before)
    const start = startOf(c); const tm = timing(c); const mv = movementOf(c);
    const plan = state.preroll && tm ? prerollPlan(tm.seq, { start, count: state.preroll, metronome: true, timeSig: (mi) => mv.masterbars[mi]?.props[PID.TIME_SIG] }) : null;
    if (!plan) { if (playback.play(keyOf(c), { position: start })) { startClicker(c); followPlayhead(true); } return; }
    const engine = audio.getEngine(); const canClick = typeof engine.clickAt === 'function';
    const startMusic = () => {
      countIn = null;
      if (!playback.play(keyOf(c), { position: plan.playFrom })) { draw(); return; }
      if (canClick && state.metronome === 'pre') { const base = engine.ctxTimeOf?.(plan.playFrom); if (base != null) for (const k of plan.clicks) if (k.t >= plan.playFrom) engine.clickAt(base + (k.t - plan.playFrom), { accent: k.accent, volume: state.clickVolume }); }
      startClicker(c); followPlayhead(true);
    };
    if (plan.lead > 0 && canClick) {
      // the count-in is heard before the music: its clicks are placed on the audio clock, the music starts when the last of them has been heard
      const t0 = engine.audioClock().now() + 0.12;
      if (state.metronome !== 'off') for (const k of plan.clicks) if (k.t < plan.playFrom) engine.clickAt(t0 + plan.lead + (k.t - plan.playFrom), { accent: k.accent, volume: state.clickVolume });
      const latency = engine.options?.startLatency ?? 0.05;
      countIn = setTimeout(startMusic, Math.max(0, (0.12 + plan.lead - latency) * 1000));
      draw();
    } else startMusic();
  }
  let clickTimer = 0; let clickUntil = 0;
  const stopClicker = () => { if (clickTimer) { clearInterval(clickTimer); clickTimer = 0; } };
  /** A metronome that plays all the time (second state of the button): the beats are placed ahead on the audio clock, loop wraps included. */
  function startClicker(cell) {
    stopClicker();
    const engine = audio.getEngine(); const tm = timing(cell); const mv = movementOf(cell);
    if (state.metronome !== 'always' || !tm || typeof engine.audioTimesOf !== 'function') return;
    const beats = beatClicks(tm.seq, (mi) => mv.masterbars[mi]?.props[PID.TIME_SIG]);
    clickUntil = engine.audioClock().now();
    clickTimer = setInterval(() => {
      if (!playback.isPlaying(keyOf(cell))) { stopClicker(); return; }
      const horizon = engine.audioClock().now() + 0.6;
      for (const b of beats) for (const a of engine.audioTimesOf(b.t, horizon)) if (a >= clickUntil && a < horizon) engine.clickAt(a, { accent: b.accent, volume: state.clickVolume });
      clickUntil = horizon;
    }, 100);
  }
  function stopPlayback() {
    stopClicker();
    if (countIn) { clearTimeout(countIn); countIn = null; cancelClicks(); draw(); return; }
    playback.stop(); cancelClicks();
  }

  /** The position the reader is at, in seconds: where the sound is, or the chosen start. */
  const nowSeconds = (cell) => { const cur = playback.cursor(); return cur && cur.id === keyOf(cell) ? cur.seconds : startOf(cell); };
  function goTo(cell, seconds) {
    const t = timing(cell); if (!t) return;
    const s = Math.max(0, Math.min(t.duration, seconds));
    if (playback.isPlaying(keyOf(cell))) { cancelClicks(); playback.seek(s); startClicker(cell); userScrollAt = -1e9; placeOnce(); followPlayhead(true); } else { state.start[cell.id] = s; placeOnce(); followPlayhead(true); }
  }

  // ---------- drawing ----------
  const wide = () => (root.clientWidth || window.innerWidth) >= 900;
  /** A tablet or a phone: a narrow window or a touch screen. The bar then keeps the playback, the loop and the size of the writing; everything else rises from the bottom with the tracks. */
  const compact = () => !wide() || window.matchMedia?.('(pointer: coarse)').matches === true;
  /** In the 'cases' mode every cell has its own small bar: nothing moves there. */
  const sheetControls = () => compact() && !casesMode();
  function width() { return Math.max(300, (root.clientWidth || window.innerWidth) - 24 - (!compact() && state.tracksOpen && !casesMode() ? 270 : 0)); }
  function draw() {
    holdForSound();
    if (!work) return;
    const scrollY = window.scrollY; const sheetScroll = root.querySelector?.('[data-reader-tracks-sheet]')?.scrollTop ?? 0; // a redraw (a step of the speed) must not send the sheet back to its top
    if (state.tracksInit === undefined) { state.tracksInit = true; state.tracksOpen = !compact(); } // phone / tablet: the mixer is a sheet that rises on request, not the first thing seen
    root.replaceChildren(head());
    document.documentElement.toggleAttribute('data-reader-sheet', compact()); // the floating theme button hides when the bar or the sheet carries it
    const cell = selectedCell(); const cases = casesMode();
    if (panelOpen && anyUnlocked() && !sheetControls()) root.append(panel());
    if (cell && !cases && compact() && state.tracksOpen) {
      // narrow screens: the tracks (mute, solo, eye, volume) rise from the bottom as a sheet; a tap outside or the cross closes it
      root.append(el('div', { class: 'rd-veil', 'data-reader-veil': '', onclick: () => { state.tracksOpen = false; lastWidth = 0; draw(); } }),
        el('div', { class: `rd-pop rd-tracks-sheet${state.sheetAnim ? ' rd-rising' : ''}`, role: 'dialog', 'aria-label': t('reader.tracksAndSettings'), 'data-reader-tracks-sheet': '' },
          btn('✕', () => { state.tracksOpen = false; lastWidth = 0; draw(); }, { class: 'rd-sheet-close', 'data-action': 'tracks-close', 'aria-label': t('reader.tracksClose'), title: t('reader.tracksClose') }),
          ...(controlsBox?.childNodes.length ? [controlsBox] : []),
          ...(anyUnlocked() ? [panel()] : []),
          ...(state.helpOpen ? [helpBox()] : []),
          tracksPanel(cell)));
      const sheetEl = root.querySelector('[data-reader-tracks-sheet]'); if (sheetEl) sheetEl.scrollTop = sheetScroll;
    }
    const body = el('div', { class: 'rd-body' }, stage());
    if (cell && !cases && !compact() && state.tracksOpen) body.append(el('div', { class: 'rd-side', 'data-reader-side': '' }, tracksPanel(cell)));
    root.append(body);
    if (lyricsPanel?.available()) root.append(lyricsPanel.element);
    if (cases && state.caseMenu) { const pc = cellsNow().find((c) => c.id === state.caseMenu); if (pc) root.append(casePopover(pc)); else state.caseMenu = null; }
    window.scrollTo(0, scrollY);
    placeOnce();
  }
  function head() {
    const cell = selectedCell();
    const h = el('div', { class: 'rd-head', 'data-reader-head': '' }, bar());
    if (!cell || casesMode()) return h; // in the 'cases' mode every cell has its own controls: the head keeps only the title, the sheet, the size and the help
    const t = timing(cell); if (t) viewers.hint(t.seq);
    // (the repeat signs are too small to read on a phone: their row is left out there)
    if (t && t.duration > 0) { h.append(strip(cell, t)); if (!compact()) h.append(signsRow(cell, t)); h.append(progress(cell, t)); }
    if (state.helpOpen && !sheetControls()) h.append(helpBox());
    return h;
  }
  const helpBox = () => el('div', { class: 'rd-help', 'data-help': '' }, el('p', {}, el('b', {}, t_('reader.helpTitle'))), ...t_('reader.helpText').split('\n').map((x) => el('p', {}, x)));
  const t_ = (k, p) => t(k, p);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  /** The cards above the playback bar: the parts of the form and the rehearsal marks, each one a segment of the bar. */
  function strip(cell, tm) {
    const mv = movementOf(cell); const opts = readerOptions(sheet); const items = [];
    if (opts.showSections) for (const sp of sectionSpans(mv)) { const at = secondsOf(tm.seq, 0, sp.index); if (at != null) items.push({ t: at, text: sp.label || SECTION_NAMES[lang === 'en' ? 'en' : 'fr'][sp.category] || '', color: sp.color, kind: 'sec' }); }
    if (opts.showRehearsal) for (const rm of mv.rehearsalMarks ?? []) { const idx = mv.masterbars.findIndex((b) => b.id === rm.props[PID.MEASURE_ID]); const at = idx >= 0 ? secondsOf(tm.seq, 0, idx) : null; if (at != null) items.push({ t: at, text: rm.props[PID.TEXT] ?? '', kind: 're' }); }
    items.sort((a, b) => a.t - b.t || (a.kind === 'sec' ? -1 : 1));
    const box = el('div', { class: 'rd-strip', 'data-strip': '' });
    items.forEach((it, i) => {
      const next = items.slice(i + 1).find((x) => x.t > it.t)?.t ?? tm.duration;
      const left = (it.t / tm.duration) * 100; const w = Math.max(0.6, ((next - it.t) / tm.duration) * 100);
      const bg = it.kind === 'sec' && opts.sectionColors && it.color ? `background:${it.color};` : '';
      box.append(el('button', { type: 'button', class: `rd-card ${it.kind}`, 'data-card': it.kind, 'data-no-icon': '', style: `left:${left}%;width:calc(${w}% - 2px);${bg}`, title: it.text, onclick: () => goTo(cell, it.t) }, it.text));
    });
    return box;
  }
  function progress(cell, tm) {
    const box = el('div', { class: 'rd-prog', 'data-progress': '' });
    if (tm.loop) box.append(el('div', { class: 'rd-prog-loop', style: `left:${(tm.loop.start / tm.duration) * 100}%;width:${((tm.loop.end - tm.loop.start) / tm.duration) * 100}%` }));
    box.append(el('div', { class: 'rd-prog-pos' }));
    const seek = (e) => { const r = box.getBoundingClientRect(); goTo(cell, ((e.clientX - r.left) / r.width) * tm.duration); };
    let down = false;
    box.addEventListener('pointerdown', (e) => { down = true; box.setPointerCapture?.(e.pointerId); seek(e); });
    box.addEventListener('pointermove', (e) => { if (down) seek(e); });
    const up = () => { down = false; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    return box;
  }

  function bar() {
    const cell = selectedCell(); const open = cell ? cellSettings(sheet, cell).unlocked : {};
    const ef = cell ? effective(cell) : null; const eff = ef?.eff;
    const sheets = work.sheets ?? [];
    const playing = cell ? playback.isPlaying(keyOf(cell)) : false;
    const b = el('div', { class: 'rd-bar', 'data-reader-bar': '' }, el('span', { class: 'rd-title', title: work.props?.[PID.TITLE] || '' }, work.props?.[PID.TITLE] || t('reader.untitled')));
    // a tablet or a phone: what is not the playback, the loop or the size of the writing goes into the sheet that rises from the bottom (`controlsBox`), each control under its name
    controlsBox = sheetControls() ? el('div', { class: 'rd-controls', 'data-reader-controls': '' }) : null;
    const place = (node, labelKey = null) => { if (!controlsBox) b.append(node); else controlsBox.append(labelKey ? el('div', { class: 'rd-row rd-ctl' }, el('span', { class: 'rd-label' }, t(labelKey)), node) : node); };
    if (sheets.length > 1) {
      const sel = el('select', { 'aria-label': t('reader.sheet'), style: 'min-height:40px;font:inherit' }, ...sheets.map((s, i) => el('option', { value: s.id, ...(s.id === sheet.id ? { selected: '' } : {}) }, s.props?.[PID.NAME] || t('reader.sheetN', { n: i + 1 }))));
      sel.addEventListener('change', () => chooseSheet(sel.value)); b.append(sel);
    }
    if (!casesMode()) {
    b.append(el('span', { class: 'rd-group', 'data-group': 'play' }, btn('▶', playSelected, { 'data-action': 'play', 'aria-label': t('reader.play'), title: t('reader.play'), disabled: !cell || playing || !!countIn || !audio.available || warming }), btn('■', stopPlayback, { 'data-action': 'stop', 'aria-label': t('reader.stop'), title: t('reader.stop'), disabled: !playing && !countIn })));
    if (cell) {
      b.append(el('span', { class: 'rd-group', 'data-group': 'loop' }, btn('⟲', toggleLoop, { 'data-action': 'loop', 'aria-pressed': String(ef.loopOn), 'aria-label': t('reader.loopToggle'), title: t('reader.loopToggle') }),
        btn('A', () => markLoop('a'), { 'data-action': 'loop-a', title: t('reader.loopA'), 'aria-label': t('reader.loopA') }),
        btn('B', () => markLoop('b'), { 'data-action': 'loop-b', title: t('reader.loopB'), 'aria-label': t('reader.loopB') })),
        el('span', { class: 'rd-time', 'data-time': '' }, `${fmt(nowSeconds(cell))} / ${fmt(timing(cell)?.duration ?? 0)}`));
    }
    if (cell) {
      place(el('span', { class: 'rd-group', 'data-group': 'preroll' },
        btn(state.preroll ? t('reader.prerollN', { n: state.preroll }) : t('reader.prerollOff'), () => { state.preroll = (state.preroll + 1) % 3; save(); draw(); }, { 'data-action': 'preroll', 'data-no-icon': '', 'aria-pressed': String(state.preroll > 0), title: t('reader.prerollHint') }),
        metronomeButton(), knob(Math.round(state.clickVolume * 100), (v) => { state.clickVolume = v / 100; save(); }, t('reader.clickVolume'))), 'reader.clickLabel');
    }
    }
    if (open.staffSize) {
      const size = eff.staffSize ?? defaultSize();
      b.append(el('span', { class: 'rd-group', 'data-group': 'size' }, btn('A−', () => setSize(size - 1), { 'aria-label': t('reader.smaller'), disabled: size <= STAFF_SIZE_RANGE[0] }), btn('A+', () => setSize(size + 1), { 'aria-label': t('reader.bigger'), disabled: size >= STAFF_SIZE_RANGE[1] })));
    }
    if (!casesMode()) {
    if (open.speed) place(el('span', { class: 'rd-group', 'data-group': 'speed' }, btn('−', () => setOver('speed', Math.max(SPEED_RANGE[0], eff.speed - 5)), { 'aria-label': t('reader.slower') }), el('span', { class: 'rd-val' }, `${eff.speed} %`), btn('+', () => setOver('speed', Math.min(SPEED_RANGE[1], eff.speed + 5)), { 'aria-label': t('reader.faster') })), 'reader.speed');
    const tstep = (kind, short, long) => el('span', { class: 'rd-group', 'data-group': kind, title: long }, el('span', { class: 'rd-status' }, short), btn('−', () => setTranspose(kind, Math.max(-TRANSPOSE_RANGE, eff[kind] - 1)), { 'aria-label': `${long} −` }), el('span', { class: 'rd-val', style: 'min-width:34px' }, eff[kind] > 0 ? `+${eff[kind]}` : String(eff[kind])), btn('+', () => setTranspose(kind, Math.min(TRANSPOSE_RANGE, eff[kind] + 1)), { 'aria-label': `${long} +` }));
    if (open.transposeDisplay) place(tstep('transposeDisplay', t('reader.transposeDisplayShort'), t('reader.transposeDisplay')), 'reader.transposeDisplay');
    if (open.transposePlay) place(tstep('transposePlay', t('reader.transposePlayShort'), t('reader.transposePlay')), 'reader.transposePlay');
    }
    const compact = window.matchMedia?.('(pointer: coarse), (max-width: 900px)').matches;
    let masterControl;
    if (compact) { // a phone or a tablet: a round knob of the size of a button instead of a slider that takes a whole line
      masterControl = knob(Math.round((state.master ?? 100 / 127) * 127), (v) => { state.master = v / 127; mixerChanged(); }, t('reader.master'), { size: 'var(--rd-target, 40px)', max: 127, reset: 100, tag: 'data-master' });
    } else {
      masterControl = el('input', { type: 'range', class: 'rd-master', min: '0', max: '127', step: '1', value: String(Math.round((state.master ?? 100 / 127) * 127)), 'aria-label': t('reader.master'), title: t('reader.master'), 'data-master': '' });
      masterControl.addEventListener('input', () => { state.master = Number(masterControl.value) / 127; mixerChanged(); });
      masterControl.addEventListener('dblclick', () => { state.master = null; masterControl.value = '100'; mixerChanged(); });
    }
    place(btn(controlsBox ? t(follow ? 'reader.yes' : 'reader.no') : t('reader.followShort'), () => { follow = !follow; try { storage?.setItem(FOLLOW_KEY, follow ? '1' : '0'); } catch { /* kept for this page */ } draw(); }, { 'data-action': 'follow', 'aria-pressed': String(follow), title: t('reader.follow'), 'aria-label': t('reader.follow'), 'data-no-icon': '' }), 'reader.follow');
    place(el('span', { class: 'rd-group', title: t('reader.master') }, controlsBox ? null : el('span', { class: 'rd-status' }, t('reader.masterShort')), masterControl), 'reader.master');
    b.append(el('span', { class: 'rd-grow' }), el('span', { class: 'rd-status', 'data-sound': '' }, ...(warming ? [el('span', { class: 'rd-spin', 'aria-hidden': 'true' }), warmMessage()] : [status])));
    if (cell && !casesMode()) {
      const tracksBtn = btn('☰', () => { state.tracksOpen = !state.tracksOpen; state.sheetAnim = state.tracksOpen; lastWidth = 0; draw(); state.sheetAnim = false; }, { 'data-action': 'tracks', 'aria-pressed': String(state.tracksOpen), 'aria-label': t(controlsBox ? 'reader.tracksAndSettings' : 'reader.tracks'), title: t(controlsBox ? 'reader.tracksAndSettings' : 'reader.tracks') });
      // the speed and the transpositions are out of sight in the sheet: what differs from the normal is written beside the button, so nobody plays at 80 % without knowing
      const shift = (n) => (n > 0 ? `+${n}` : String(n));
      const diff = controlsBox ? [eff.speed !== 100 ? `${eff.speed} %` : '', eff.transposeDisplay ? shift(eff.transposeDisplay) : '', eff.transposePlay && eff.transposePlay !== eff.transposeDisplay ? `♪${shift(eff.transposePlay)}` : ''].filter(Boolean) : [];
      if (diff.length) tracksBtn.append(el('span', { class: 'rd-sum', 'data-summary': '' }, ` ${diff.join(' · ')}`));
      b.append(tracksBtn);
    }
    if (anyUnlocked() && !sheetControls()) b.append(btn('⚙', () => { panelOpen = !panelOpen; draw(); }, { 'data-action': 'settings', 'aria-pressed': String(panelOpen), 'aria-label': t('reader.settings'), title: t('reader.settings') }));
    const sizeButton = btn('Aa', cycleUiSize, { 'data-action': 'ui-size', 'data-size': uiSize, 'aria-label': t('reader.uiSize', { size: t(`reader.uiSize.${uiSize}`) }), title: t('reader.uiSize', { size: t(`reader.uiSize.${uiSize}`) }) });
    markCyclic(sizeButton, 3, Object.keys(UI_SIZES).indexOf(uiSize));
    // the round theme button floats over the page and hides the music: on a phone or a tablet it moves into the sheet (or, with no sheet, into the bar)
    let themeBtn = null;
    if (compact && document.querySelector('[data-theme-toggle]')) {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      themeBtn = btn(t(`reader.themeName.${cur}`), () => { document.querySelector('[data-theme-toggle]')?.click(); draw(); }, { 'data-action': 'theme', 'data-no-icon': '', title: t('reader.themeLabel'), 'aria-label': `${t('reader.themeLabel')} : ${t(`reader.themeName.${cur}`)}` });
    }
    const helpButton = btn('?', () => { state.helpOpen = !state.helpOpen; draw(); }, { 'data-action': 'help', 'aria-pressed': String(state.helpOpen), 'aria-label': t('reader.help'), title: t('reader.help') });
    if (controlsBox && cell) controlsBox.append(el('div', { class: 'rd-row rd-ctl' }, sizeButton, ...(themeBtn ? [themeBtn] : []), helpButton)); // the three display buttons share one line
    else { b.append(sizeButton); if (themeBtn) b.append(themeBtn); b.append(helpButton); }
    return b;
  }
  const defaultSize = () => (width() < 500 ? 7 : 9);
  function setSize(n) { state.size = Math.min(STAFF_SIZE_RANGE[1], Math.max(STAFF_SIZE_RANGE[0], n)); save(); draw(); }
  /** A change that needs the sequence to be rebuilt (speed, playback transposition): playback stops. */
  /** A transposition; the two are moved together when the author linked them. */
  function setTranspose(kind, v) {
    const c = selectedCell(); if (!c) return; const linked = cellSettings(sheet, c).linkTranspose;
    if (kind === 'transposeDisplay') delete over(c.id).trackShift; // the reader chooses a transposition for everything: the tracks asked for by the address follow it
    over(c.id)[kind] = v; if (linked) over(c.id)[kind === 'transposeDisplay' ? 'transposePlay' : 'transposeDisplay'] = v;
    save(); if (playback.isPlaying(keyOf(c))) playback.stop(); draw();
  }
  function setOver(k, v) { const c = selectedCell(); if (!c) return; over(c.id)[k] = v; save(); if (playback.isPlaying(keyOf(c))) playback.stop(); draw(); }

  // ---------- the loop ----------
  const lastBar = (mv) => mv.masterbars.at(-1).id;
  /** Applies the loop to what plays now (a live change) and redraws. */
  function loopChanged() {
    const c = selectedCell(); save();
    if (c && playback.isPlaying(keyOf(c))) { const r = buildCellSequence(work, sheet, effective(c).cell, { overrides: { speed: effective(c).eff.speed } }); playback.setLoop(r?.loop ?? null); }
    draw();
  }
  function toggleLoop() {
    const c = selectedCell(); if (!c) return; const mv = movementOf(c); const ef = effective(c); const o = over(c.id);
    if (!ef.loop) o.loop = { from: mv.masterbars[0].id, to: lastBar(mv) };
    o.loopActive = !ef.loopOn;
    loopChanged();
  }
  /** Sets the start (`a`) or the end (`b`) of the loop on measure `mi`; the cursor goes to the start of the loop. */
  function setLoopEdge(edge, mi) {
    const c = selectedCell(); if (!c) return; const mv = movementOf(c); const o = over(c.id); const ids = mv.masterbars.map((b) => b.id); const cur = effective(c).loop;
    const idx = (id) => ids.indexOf(id);
    let from = cur ? idx(cur.from) : 0; let to = cur ? idx(cur.to) : ids.length - 1;
    if (edge === 'a') { from = mi; if (to < from) to = ids.length - 1; } else { to = mi; if (from > to) { from = to; to = cur ? idx(cur.from) : ids.length - 1; if (to < from) to = from; } }
    o.loop = { from: ids[from], to: ids[to] };
    if (edge === 'b') o.loopActive = true; else if (o.loopActive === undefined) o.loopActive = false;
    const t0 = secondsOf(timing(c).seq, 0, from);
    if (edge === 'a' && t0 != null) state.start[c.id] = t0;
    loopChanged();
    if (edge === 'a' && t0 != null && playback.isPlaying(keyOf(c))) playback.seek(t0);
  }
  /** A plain click: the playback starts at this measure. Only the cursor moves: the loop (and its green bands) is left alone. */
  function placeStart(mi) {
    const c = selectedCell(); const t = c && timing(c); if (!t) return;
    const t0 = secondsOf(t.seq, 0, mi); if (t0 == null) return;
    state.start[c.id] = t0;
    draw();
  }
  /** A long press: the loop goes from the measure where the cursor is (or the start of the loop already set, else the first measure) to this measure, and it is switched on. */
  function setLoopEnd(mi) {
    const c = selectedCell(); const t = c && timing(c); if (!c || !t) return;
    const mv = movementOf(c); const o = over(c.id); const ids = mv.masterbars.map((b) => b.id); const cur = effective(c).loop;
    const s = state.start[c.id];
    let from = s != null ? locate(t.seq, s)?.measure ?? null : null;
    if (from == null) from = cur ? ids.indexOf(cur.from) : 0;
    let a = Math.max(0, from); let b = mi;
    if (b < a) [a, b] = [b, a];
    o.loop = { from: ids[a], to: ids[b] }; o.loopActive = true;
    const t0 = secondsOf(t.seq, 0, a); if (t0 != null) state.start[c.id] = t0;
    loopChanged();
    if (t0 != null && playback.isPlaying(keyOf(c))) playback.seek(t0);
  }
  /** The A / B buttons: the measure the reader is at (the sound, or the chosen start). */
  function markLoop(edge) {
    const c = selectedCell(); const t = c && timing(c); if (!t) return;
    const at = locate(t.seq, nowSeconds(c)); if (!at) return;
    setLoopEdge(edge, at.measure);
  }

  // ---------- the score: a click places the start, a long press the end of the loop (never while playing) ----------
  function cellPoint(box, e) {
    const svg = box.querySelector('svg'); const vb = svg?.viewBox.baseVal; const r = svg?.getBoundingClientRect(); if (!vb || !r?.width) return null;
    return { x: ((e.clientX - r.left) / r.width) * vb.width, y: ((e.clientY - r.top) / r.height) * vb.height };
  }
  function wireCell(box, cell, l) {
    let timer = 0; let down = null;
    const clear = () => { clearTimeout(timer); timer = 0; };
    const measureOf = (e) => { const p = cellPoint(box, e); return p ? measureAt(l, p.x, p.y) : null; };
    box.addEventListener('contextmenu', (e) => e.preventDefault());
    box.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; down = { x: e.clientX, y: e.clientY, shift: e.shiftKey, long: false }; clear();
      if (isPlaying()) return; // while playing a touch only places the playback (on release)
      const mine = down;
      timer = setTimeout(() => { timer = 0; mine.long = true; const mi = measureOf(e); if (mi != null && state.selected === cell.id) setLoopEnd(mi); }, 450);
    });
    box.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clear(); });
    box.addEventListener('pointercancel', () => { clear(); down = null; });
    // the long press redraws the page (the box is replaced), so the release lands on a NEW box that saw no press: without `down` it does nothing
    box.addEventListener('pointerup', (e) => {
      const d = down; down = null; clear(); if (!d || d.long) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      if (state.selected !== cell.id && !isPlaying()) { state.selected = cell.id; draw(); return; }
      const mi = measureOf(e); if (mi == null) return;
      if (isPlaying()) { const t = timing(cell); const at = t && secondsOf(t.seq, 0, mi); if (at != null) playback.seek(at); return; }
      if (d.shift) setLoopEnd(mi); else placeStart(mi);
    });
  }
  const addCards = (box, l) => { if (readerOptions(sheet).showSections) addSectionCards(box, l); };
  /** A light band on the measures of the loop, only while the loop is switched on (no band for a loop that is defined but off). */
  function addBands(box, l, cell) {
    const ef = effective(cell); const lp = ef.loopOn ? ef.loop : null; const svg = box.querySelector('svg'); const vb = svg?.viewBox.baseVal; if (!lp || !vb) return;
    const mv = movementOf(cell); const a = mv.masterbars.findIndex((b) => b.id === lp.from); const z = mv.masterbars.findIndex((b) => b.id === lp.to);
    for (const m of measureZones(l)) if (m.index >= a && m.index <= z) svg.parentElement.append(el('div', { class: 'rd-loopband', style: `left:${(m.x1 / vb.width) * 100}%;top:${(m.y1 / vb.height) * 100}%;width:${((m.x2 - m.x1) / vb.width) * 100}%;height:${((m.y2 - m.y1) / vb.height) * 100}%` }));
  }

  // ---------- the tracks: mute, solo, eye, volume (never stops the sound) ----------
  let mixTimer = 0;
  function mixerChanged() { save(); if (mixTimer) return; mixTimer = setTimeout(() => { mixTimer = 0; const c = selectedCell(); if (c && playback.isPlaying(keyOf(c))) playback.refreshMixer(); }, 120); }
  const toggleIn = (o, k, id) => { const set = new Set(o[k] ?? []); if (set.has(id)) set.delete(id); else set.add(id); o[k] = [...set]; };
  function tracksPanel(cell) {
    const mv = movementOf(cell); const o = over(cell.id); const eff = effective(cell).eff; const wrap = el('div', { 'data-tracks': '' }, el('h4', {}, t('reader.tracks')));
    if (!mv) return wrap;
    const shown = new Set(effective(cell).cell.tracks ?? mv.tracks.map((x) => x.id));
    for (const tr of mv.tracks) {
      const muted = (o.muted ?? []).includes(tr.id); const solo = (o.solo ?? []).includes(tr.id); const on = shown.has(tr.id);
      const v = o.volumes?.[tr.id] ?? eff.tracks[tr.id]?.volume ?? 100 / 127;
      const input = el('input', { type: 'range', min: '0', max: '127', step: '1', value: String(Math.round(v * 127)), 'aria-label': t('reader.volume') });
      input.addEventListener('input', () => { o.volumes = { ...(o.volumes ?? {}), [tr.id]: Number(input.value) / 127 }; mixerChanged(); });
      input.addEventListener('dblclick', () => { if (o.volumes) delete o.volumes[tr.id]; input.value = String(Math.round((eff.tracks[tr.id]?.volume ?? 100 / 127) * 127)); mixerChanged(); }); // back to the author's volume
      wrap.append(el('div', { class: `rd-tcard${on ? '' : ' off'}`, 'data-track': tr.id },
        el('div', { class: 'rd-trow' }, el('span', { class: 'rd-tname' }, tr.props[PID.NAME] || tr.id),
          btn('M', (e) => { toggleIn(o, 'muted', tr.id); e.currentTarget.setAttribute('aria-pressed', String((o.muted ?? []).includes(tr.id))); mixerChanged(); }, { 'aria-pressed': String(muted), 'aria-label': t('reader.mute'), title: t('reader.mute'), 'data-mute': tr.id }),
          btn('S', (e) => { toggleIn(o, 'solo', tr.id); e.currentTarget.setAttribute('aria-pressed', String((o.solo ?? []).includes(tr.id))); mixerChanged(); }, { 'aria-pressed': String(solo), 'aria-label': t('reader.solo'), title: t('reader.solo'), 'data-solo': tr.id }),
          btn('⇢', () => { viewers.toggleTrack(tr.id); if (viewers.tracks().length) viewers.open(true); }, { 'aria-label': t('reader.sendToViewer'), title: t('reader.sendToViewer'), 'aria-pressed': String(viewers.has(tr.id)), 'data-send': tr.id, style: `border-bottom:3px solid ${viewers.colorOf(tr.id, timing(cell)?.seq) ?? 'transparent'}` }),
          btn(on ? '👁' : '🙈', () => { const next = new Set(shown); if (next.has(tr.id)) { if (next.size > 1) next.delete(tr.id); } else next.add(tr.id); o.shown = [...next]; mixerChanged(); draw(); }, { 'aria-label': t('reader.showTrack'), title: t('reader.showTrack'), 'data-eye': tr.id })),
        input));
    }
    return wrap;
  }

  /** The metronome button (the icon of a metronome), three states: off, pre-roll only (default), all the time. */
  function metronomeButton() {
    const nodes = iconNodes('metronome') ?? [];
    const b = el('button', { type: 'button', 'data-action': 'metronome', 'data-no-icon': '', 'aria-pressed': String(state.metronome !== 'off'), 'aria-label': t('reader.metronome'), title: t(state.metronome === 'always' ? 'reader.metronomeAlways' : state.metronome === 'off' ? 'reader.metronomeOff' : 'reader.metronomePre'), onclick: () => {
      state.metronome = state.metronome === 'pre' ? 'always' : state.metronome === 'always' ? 'off' : 'pre'; save();
      const c = selectedCell(); // the change is live: the permanent metronome starts or stops while the music plays
      if (c && playback.isPlaying(keyOf(c))) { if (state.metronome === 'always') startClicker(c); else { stopClicker(); cancelClicks(); } }
      draw();
    } });
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle${state.metronome === 'off' ? ';opacity:.45' : ''}">${nodes.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')}${state.metronome === 'off' ? '<line x1="3" y1="21" x2="21" y2="3" stroke-width="2.4"/>' : ''}</svg>${state.metronome === 'always' ? '<small style="margin-left:3px;font-weight:var(--w-bold,700)">∞</small>' : ''}`;
    markCyclic(b, 3, state.metronome === 'off' ? 0 : state.metronome === 'pre' ? 1 : 2);
    return b;
  }
  /** A small round knob 0..100 (drag up or down, wheel, arrows): the metronome volume, in little space. */
  function knob(value, onChange, label, { size = null, max = 100, reset = null, tag = 'data-click-volume' } = {}) {
    const k = el('div', { class: 'rd-knob', role: 'slider', tabindex: '0', 'aria-label': label, title: label, 'aria-valuemin': '0', 'aria-valuemax': String(max), [tag]: '' });
    if (size) k.style.setProperty('--sz', size);
    const paint = (v) => { k.setAttribute('aria-valuenow', String(v)); k.style.setProperty('--a', `${-135 + (v / max) * 270}deg`); };
    let v = value; paint(v);
    const step = Math.max(1, max / 20); const gain = max / 125; // a drag of 125 px covers the whole range
    let bubble = null;
    const showBubble = () => { if (!bubble) { bubble = el('div', { class: 'rd-bubble', 'data-knob-bubble': '' }); document.body.append(bubble); } const r = k.getBoundingClientRect(); bubble.textContent = String(v); bubble.style.left = `${Math.min(window.innerWidth - 60, r.right + 8)}px`; bubble.style.top = `${r.top + r.height / 2 - 12}px`; };
    const hideBubble = () => { bubble?.remove(); bubble = null; };
    const set = (n) => { v = Math.max(0, Math.min(max, Math.round(n))); paint(v); onChange(v); if (bubble) showBubble(); };
    let drag = null; let lastTap = 0;
    k.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, v }; k.setPointerCapture?.(e.pointerId); e.preventDefault(); showBubble();
      const now = e.timeStamp; if (reset !== null && now - lastTap < 350) { drag = null; set(reset); } lastTap = now; // a double tap or double click: back to the default
    });
    k.addEventListener('pointermove', (e) => { if (drag) set(drag.v + (drag.y - e.clientY) * gain); });
    const end = () => { drag = null; hideBubble(); };
    k.addEventListener('pointerup', end); k.addEventListener('pointercancel', end);
    k.addEventListener('wheel', (e) => { e.preventDefault(); set(v + (e.deltaY < 0 ? step : -step)); }, { passive: false });
    k.addEventListener('keydown', (e) => { const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key]; if (d) { e.preventDefault(); set(v + d); } });
    return k;
  }
  /** Are the names of the tracks written for this cell? What the reader sees: the effective choice, else the file's style. */
  const namesOn = (cell) => { const v = effective(cell).eff.showNames; return typeof v === 'boolean' ? v : resolveStyle(SID.SHOW_INSTRUMENT_NAMES, [null, work.movements[0]?.style]) === true; };
  const signsOn = () => { const o = readerOptions(sheet); return o.unlocked.signs && state.signs !== undefined ? state.signs : o.colorSigns; };
  /** The repeat signs under the structure cards: where they are on the time line. */
  function signsRow(cell, tm) {
    const mv = movementOf(cell); const box = el('div', { class: 'rd-signs', 'data-signs': '' });
    const color = signsOn() ? readerOptions(sheet).signsColor : '#666';
    const mark = (kind, at) => {
      const m = el('span', { class: `rd-sign ${kind}`, 'data-sign': kind, style: `left:${(at / tm.duration) * 100}%;color:${color}` });
      m.innerHTML = kind === 'start'
        ? '<svg width="9" height="10" viewBox="0 0 9 10"><rect width="2.4" height="10" fill="currentColor"/><rect x="3.6" width="1" height="10" fill="currentColor"/><circle cx="7" cy="3.6" r="1" fill="currentColor"/><circle cx="7" cy="6.4" r="1" fill="currentColor"/></svg>'
        : '<svg width="9" height="10" viewBox="0 0 9 10"><rect x="6.6" width="2.4" height="10" fill="currentColor"/><rect x="4.4" width="1" height="10" fill="currentColor"/><circle cx="2" cy="3.6" r="1" fill="currentColor"/><circle cx="2" cy="6.4" r="1" fill="currentColor"/></svg>';
      return m;
    };
    mv.masterbars.forEach((bar, i) => {
      if (bar.props[PID.REPEAT_START]) { const at = secondsOf(tm.seq, 0, i); if (at != null) box.append(mark('start', at)); }
      if (bar.props[PID.REPEAT_END]) { const at = secondsOf(tm.seq, 0, i + 1) ?? tm.duration; box.append(mark('end', at)); }
    });
    return box;
  }

  function panel() {
    const cell = selectedCell(); const p = el('div', { class: 'rd-panel', 'data-reader-panel': '' });
    if (!cell) return p;
    const open = cellSettings(sheet, cell).unlocked; const { eff } = effective(cell); const mv = movementOf(cell);
    const stepper = (name, value, min, max, set, fmtv = (v) => (v > 0 ? `+${v}` : String(v))) => el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, name), btn('−', () => set(Math.max(min, value - 1)), { 'aria-label': '−' }), el('span', { class: 'rd-val' }, fmtv(value)), btn('+', () => set(Math.min(max, value + 1)), { 'aria-label': '+' }));
    if (open.hiddenMuted && mv && cell.tracks) p.append(el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, t('reader.hidden')), btn(eff.hiddenMuted ? t('reader.hiddenMuted') : t('reader.hiddenSound'), () => setOver('hiddenMuted', !eff.hiddenMuted), { 'aria-pressed': String(eff.hiddenMuted), 'data-hidden-muted': '' })));
    if (open.signs) p.append(el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, t('reader.signs')), btn(signsOn() ? t('reader.signsOn') : t('reader.signsOff'), () => { state.signs = !signsOn(); save(); draw(); }, { 'aria-pressed': String(signsOn()), 'data-signs-toggle': '', 'data-no-icon': '' })));
    if (open.names) { const on = namesOn(cell); p.append(el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, t('reader.names')), btn(on ? t('reader.namesOn') : t('reader.namesOff'), () => { state.names = !on; save(); draw(); }, { 'aria-pressed': String(on), 'data-names-toggle': '', 'data-no-icon': '' }))); }
    const sp = scalePanel(cell); if (sp) p.append(sp);
    const se = scaleEncartRow(); if (se) p.append(se);
    if (storage) p.append(el('label', { class: 'rd-row' }, el('input', { type: 'checkbox', ...(state.remember ? { checked: '' } : {}), 'data-remember': '', onchange: (e) => { state.remember = e.target.checked; save(); } }), t('reader.remember')));
    return p;
  }

  function stage() {
    const st = el('div', { class: 'rd-stage' });
    const cells = cellsNow();
    if (!cells.length) { st.append(el('p', { class: 'rd-empty' }, t('reader.empty'))); return st; }
    const w = width(); const opts = readerOptions(sheet);
    const device = { width: w, staffSpace: state.size ?? defaultSize() };
    const base = (sid) => resolveStyle(sid, [null, work.movements[0]?.style]);
    const getStyle = (sid) => (sid === SID.SECTION_COLORS_SHOW ? opts.sectionColors : sid === SID.READER_SCALE ? (state.scaleView ?? 'auto') : base(sid));
    const shownCells = cells.map((c) => effective(c).cell);
    laid = layoutSheet(work, sheet, glyphs, { device, getStyle, signsColor: signsOn() ? opts.signsColor : null, cells: shownCells, settingsFor: (cell) => { const b0 = cells.find((c) => c.id === cell.id); const e = effective(b0).eff; return { ...e, staffSize: e.staffSize ?? defaultSize() }; } });
    const frame = el('div', { class: 'rd-frame', 'data-frame': '' });
    frame.style.gridTemplateColumns = `repeat(${laid.frame.columns}, ${laid.frame.cellWidth}px)`;
    const cases = casesMode(); const carousel = carouselOn();
    const shownIdx = carousel ? Math.max(0, cells.findIndex((c) => c.id === state.selected)) : -1;
    if (carousel) frame.style.gridTemplateColumns = `${laid.frame.cellWidth}px`;
    cells.forEach((cell, i) => {
      if (carousel && i !== shownIdx) return; // the carousel shows one cell at a time
      const l = laid.cells[i];
      const svg = el('div'); svg.innerHTML = l ? renderSvgString(l.layout, glyphs, { staffSpace: l.staffSpace, margin: l.margin, ink: 'var(--ink,#000)', paper: 'var(--score,#fff)', skipRoles: ['container-frame', 'container-handle', 'container-warning', 'container-readonly', 'automation', 'automation-bg'], title: cellName(cell) }) : '';
      const mv = movementOf(cell); const scl = state.scale?.[cell.movementId]; const fret = scl && scl.recipe.view === 'fretboard';
      if (fret) svg.innerHTML = fretboardOf(scl);
      const cap = !cases && cells.length > 1 && mv?.props?.[PID.TITLE] ? el('div', { class: 'rd-cap' }, mv.props[PID.TITLE]) : null; // in the 'cases' mode the title is in the bar of the cell
      const bar = cases ? caseControls(cell, cells.length > 1 ? mv?.props?.[PID.TITLE] : '') : null;
      const box = el('div', { class: 'rd-cell', 'data-cell': cell.id, 'aria-selected': String(cell.id === state.selected) }, cap, svg, bar); // the bar comes last in the DOM (what looks for the score's <svg> finds it first) and first on screen (order: -1)
      if (l && !fret) { wireCell(box, cell, l); addBands(box, l, cell); addCards(box, l); }
      frame.append(box);
    });
    if (carousel) { st.append(carouselNav(cells, shownIdx)); wireSwipe(st, cells, shownIdx); }
    st.append(frame);
    return st;
  }

  // ---------- the 'cases' mode: a player on every cell, a carousel on a narrow window ----------
  const isCaseOn = (cell) => playback.isPlaying(keyOf(cell)) || (!!countIn && state.selected === cell.id);
  /** Plays the cell; the one that was playing stops first (only one sounds), and pressing again on the playing cell stops it. */
  function togglePlayOf(cell) {
    if (isCaseOn(cell)) { stopPlayback(); return; }
    if (playback.isPlaying() || countIn) stopPlayback();
    state.selected = cell.id; playSelected();
  }
  function caseControls(cell, title = '') {
    const ef = effective(cell); const open = cellSettings(sheet, cell).unlocked; const on = isCaseOn(cell);
    const box = el('div', { class: 'rd-cc', 'data-case-controls': cell.id });
    for (const ev of ['pointerdown', 'pointerup', 'click', 'contextmenu']) box.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); });
    /** A button of the bar: an icon of Scorsaire (the same as the transport of the editor), or a text. */
    const cb = (icon, text, fn, attrs = {}) => { const b = btn(text, fn, { class: 'rd-cb', ...attrs }); if (icon && applyIconName(b, icon)) b.querySelector('svg')?.classList.add('rd-ic'); return b; };
    // one button that turns from play into stop and back
    box.append(cb(on ? 'square' : 'play', '', () => togglePlayOf(cell), { 'data-action': 'case-play', 'aria-pressed': String(on), 'aria-label': t(on ? 'reader.caseStop' : 'reader.casePlay'), title: t(on ? 'reader.caseStop' : 'reader.casePlay'), disabled: !audio.available && !on }));
    box.append(cb('repeat', '', () => { state.selected = cell.id; toggleLoop(); }, { 'data-action': 'case-loop', 'aria-pressed': String(ef.loopOn), 'aria-label': t('reader.loopToggle'), title: t('reader.loopToggle') }));
    if (open.speed) {
      const step = (d) => () => { state.selected = cell.id; setOver('speed', Math.max(SPEED_RANGE[0], Math.min(SPEED_RANGE[1], ef.eff.speed + d))); };
      box.append(el('span', { class: 'rd-cc-group', 'data-group': 'speed' }, cb(null, '−', step(-5), { 'data-action': 'case-slower', 'aria-label': t('reader.slower'), title: t('reader.slower') }), el('span', { class: 'rd-cc-val', 'data-action': 'case-speed' }, `${ef.eff.speed} %`), cb(null, '+', step(5), { 'data-action': 'case-faster', 'aria-label': t('reader.faster'), title: t('reader.faster') })));
    }
    const more = () => { state.caseMenu = state.caseMenu === cell.id ? null : cell.id; draw(); };
    box.append(cb('ellipsis', '', more, { 'data-action': 'case-more', 'aria-pressed': String(state.caseMenu === cell.id), 'aria-label': t('reader.moreControls'), title: t('reader.moreControls') }));
    if (title) box.append(el('span', { class: 'rd-cc-title' }, title));
    return box;
  }
  /** The small sheet of one cell: speed, transpositions (when the author unlocked them) and its tracks. */
  function casePopover(cell) {
    state.selected = cell.id;
    const open = cellSettings(sheet, cell).unlocked; const { eff } = effective(cell);
    const pop = el('div', { class: 'rd-pop', 'data-case-menu': cell.id });
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.append(el('div', { class: 'rd-row' }, el('strong', { style: 'flex:1' }, movementOf(cell)?.props?.[PID.TITLE] || t('reader.moreControls')), btn('✕', () => { state.caseMenu = null; draw(); }, { 'data-action': 'case-menu-close', 'aria-label': 'close' })));
    if (open.speed) pop.append(el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, t('reader.speed')), btn('−', () => setOver('speed', Math.max(SPEED_RANGE[0], eff.speed - 5)), { 'aria-label': t('reader.slower') }), el('span', { class: 'rd-val' }, `${eff.speed} %`), btn('+', () => setOver('speed', Math.min(SPEED_RANGE[1], eff.speed + 5)), { 'aria-label': t('reader.faster') }), btn('100', () => setOver('speed', 100), { 'aria-label': t('reader.speed100') })));
    const tstep = (kind, long) => el('div', { class: 'rd-row' }, el('span', { class: 'rd-label' }, long), btn('−', () => setTranspose(kind, Math.max(-TRANSPOSE_RANGE, eff[kind] - 1)), { 'aria-label': '−' }), el('span', { class: 'rd-val' }, eff[kind] > 0 ? `+${eff[kind]}` : String(eff[kind])), btn('+', () => setTranspose(kind, Math.min(TRANSPOSE_RANGE, eff[kind] + 1)), { 'aria-label': '+' }));
    if (open.transposeDisplay) pop.append(tstep('transposeDisplay', t('reader.transposeDisplay')));
    if (open.transposePlay) pop.append(tstep('transposePlay', t('reader.transposePlay')));
    const sp = scalePanel(cell); if (sp) pop.append(sp);
    const se = scaleEncartRow(); if (se) pop.append(se);
    pop.append(tracksPanel(cell));
    return pop;
  }
  function carouselNav(cells, idx) {
    const go = (d) => { const n = cells[idx + d]; if (!n) return; if (playback.isPlaying() || countIn) stopPlayback(); state.caseMenu = null; state.selected = n.id; draw(); };
    const title = movementOf(cells[idx])?.props?.[PID.TITLE] ?? '';
    return el('div', { class: 'rd-nav', 'data-carousel': '' },
      btn('‹', () => go(-1), { 'data-action': 'prev-case', 'aria-label': t('reader.prevCase'), disabled: idx <= 0 }),
      el('span', { class: 'rd-navtext', 'data-carousel-text': '' }, `${idx + 1} / ${cells.length}`),
      btn('›', () => go(1), { 'data-action': 'next-case', 'aria-label': t('reader.nextCase'), disabled: idx >= cells.length - 1 }));
  }
  /** A horizontal swipe on the score changes the cell (the touch handlers of the score only act on a tap). */
  function wireSwipe(st, cells, idx) {
    let from = null;
    st.addEventListener('touchstart', (e) => { from = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    st.addEventListener('touchend', (e) => {
      if (!from) return; const t0 = e.changedTouches[0]; const dx = t0.clientX - from.x; const dy = t0.clientY - from.y; from = null;
      if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const n = cells[idx + (dx < 0 ? 1 : -1)]; if (!n) return;
      if (playback.isPlaying() || countIn) stopPlayback(); state.caseMenu = null; state.selected = n.id; draw();
    }, { passive: true });
  }

  // ---------- the playhead (on the score and on the playback bar) ----------
  function placeOnce() {
    for (const e of root.querySelectorAll('.rd-playhead')) e.remove();
    const cell = selectedCell(); if (!cell || !laid) return;
    if (state.scale?.[cell.movementId]?.recipe.view === 'fretboard') return; // (no staff to follow on a fretboard)
    const t = timing(cell); if (!t) return;
    const secs = nowSeconds(cell);
    const at = locate(t.seq, secs); const l = laid.cells.find((c) => c.id === cell.id); const box = root.querySelector(`[data-cell="${cell.id}"]`); const mv = movementOf(cell);
    const r = l && mv ? playheadRect(l, mv, at) : null; const svg = box?.querySelector('svg'); const vb = svg?.viewBox.baseVal;
    if (r && vb) {
      const line = el('div', { class: 'rd-playhead', style: `position:absolute;width:2px;background:#e8731a;pointer-events:none;left:${(r.x / vb.width) * 100}%;top:${(r.y1 / vb.height) * 100}%;height:${((r.y2 - r.y1) / vb.height) * 100}%` });
      svg.parentElement.style.position = 'relative'; svg.parentElement.append(line);
    }
    const pos = root.querySelector('.rd-prog-pos'); if (pos && t.duration) pos.style.left = `${(secs / t.duration) * 100}%`;
    const tm = root.querySelector('[data-time]'); if (tm) tm.textContent = `${fmt(secs)} / ${fmt(t.duration)}`;
  }
  // ---------- following the playhead: the page scrolls to keep it in view (a jump in the bar, a card of the structure, a loop that wraps) ----------
  let userScrollAt = -1e9; let followAt = -1e9;
  for (const ev of ['wheel', 'touchmove']) window.addEventListener(ev, () => { userScrollAt = performance.now(); }, { passive: true }); // the reader scrolls by hand: the follow leaves him alone for a moment
  /** @param force true after a jump asked by the reader (he wants to see where he is), false while playing (then not for 3 s after his own scrolling). */
  function followPlayhead(force) {
    if (!follow) return;
    const now = performance.now(); if (!force && now - userScrollAt < 3000) return; if (now - followAt < 450) return; // (a smooth scroll in progress)
    const line = root.querySelector('.rd-playhead'); if (!line) return;
    const r = line.getBoundingClientRect(); const head = root.querySelector('[data-reader-head]')?.getBoundingClientRect().bottom ?? 0;
    const top = head + 12; const bottom = window.innerHeight - 90; // (the dock of the viewers rests at the bottom)
    if (r.bottom >= top + 40 && r.top <= bottom - 80) return; // (a system taller than the window is never wholly in view: it is enough that part of the playhead is)
    followAt = now;
    window.scrollBy({ top: r.top - top - Math.min(60, (bottom - top) / 6), behavior: force ? 'auto' : 'smooth' });
  }
  function frameLoop() {
    raf = 0; placeOnce(); followPlayhead(false);
    const cur = playback.cursor();
    if (cur) { viewers.tick({ playing: true, position: cur.seconds, sequence: cur.sequence }); raf = requestAnimationFrame(frameLoop); }
  }
  const kick = () => { if (!raf && playback.cursor()) raf = requestAnimationFrame(frameLoop); };

  // the layout follows the width of the window
  let resizeTimer = 0; let lastWidth = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const w = width(); if (Math.abs(w - lastWidth) > 4 && !playback.isPlaying()) { lastWidth = w; draw(); } }, 150); };
  window.addEventListener('resize', onResize);
  // a press on a free zone (not a control, not the score) takes the loop selection away
  const onFree = (e) => {
    if (casesMode() || e.button > 0 || e.target.closest?.('button, input, select, label, a, svg, .rd-knob, .rd-pop, .rd-veil, .rd-cell, .rd-tcard, .rd-prog, .rd-strip, .rd-panel, .rd-help')) return;
    const c = selectedCell(); if (!c) return; const o = over(c.id);
    if (o.loop === null && o.loopActive === false) return;
    o.loop = null; o.loopActive = false; loopChanged();
  };
  root.addEventListener('pointerdown', onFree);
  audio.start();
  if (source) open(source);
  lastWidth = width(); fitDock();
  return { open, destroy() { playback.stop(); clearTimeout(warmTimer); clearInterval(warmWatch); cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); root.remove(); } };
}
