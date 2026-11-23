/*
 * Media panel of screen 4 (synchronised recording), above the score: transport, speed (time stretch), pitch (semitones) with the original key, a
 * global offset of the whole map, the timeline (waveform, parts of the form, measures, loop, playhead) and the stems (volume, mute, solo).
 * `readOnly` (the synchro reader): no offset control.
 * The audio is `createStemPlayer`; the map is `createSyncMap`. This file only draws and forwards: it never writes the document.
 */
import { createReaderOptionsRow } from './reader-options-row.js';
import { createScrubPill } from './scrub-pill.js';
import { createChoiceMenu } from './choice-menu.js';
import { applyIconName } from './icons.js';
import { createKnob } from './knob.js';
import { masterSide, flipMasterSide } from './master-side.js';
import { SHEET_QUERY } from './panel-mode.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const KEY_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'].flatMap((n) => [`${n} major`]).concat(['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'].map((n) => `${n} minor`));
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
/** "C major" moved by n semitones: "D major". Flats for the flat keys. */
export function shiftedKeyName(key, n) {
  const m = /^([A-G][#b]?)\s+(major|minor)$/.exec(key ?? '');
  if (!m) return key ?? '';
  const pc = (((PC[m[1]] + n) % 12) + 12) % 12;
  const major = m[2] === 'major' ? pc : (pc + 3) % 12;
  const useFlat = [5, 10, 3, 8, 1].includes(major);
  return `${(useFlat ? FLAT : SHARP)[pc]} ${m[2]}`;
}

function el(tag, css = '', attrs = {}) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const iconBtn = (name, title, fn) => {
  const b = el('button', 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center', { type: 'button', title, 'aria-label': title });
  applyIconName(b, name); b.addEventListener('click', fn);
  return b;
};
const textBtn = (text, title, fn) => {
  const b = el('button', 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);padding:0 8px;font:inherit', { type: 'button', title, 'aria-label': title });
  b.textContent = text; b.addEventListener('click', fn);
  return b;
};

const SHEET_STYLE_ID = 'sync-sheet-style';
// On a tablet or a phone (the same rule as the editing windows: touch screen or width up to 900 px) the mix and the loop settings do not sit above the score: they are
// MOVED into a sheet that rises from the bottom, opened by a button. On a computer nothing changes (the buttons are hidden, the pieces stay where they were).
const SHEET_CSS = `
.sp-sheet-btn { display: none; }
.sp-sheet-only { display: none; }
.sp-extra { display: contents; }
.sp-timeline { height: 84px; }
@media ${SHEET_QUERY} {
  .sp-readonly .sp-timeline { height: 35px; } /* a reader on a phone / tablet: the part cards (14 px) + a measure strip at 30 % of its usual height */
  .sp-sheet-btn { display: inline-flex; align-items: center; }
  .sp-movable, .sp-desktop-only { display: none !important; }
}
.sp-sheet-veil { position: fixed; inset: 0; z-index: 3500; background: rgba(0,0,0,.25); display: flex; align-items: flex-end; justify-content: center; }
.sp-sheet { box-sizing: border-box; width: min(100%, 720px); max-height: 70vh; overflow: auto; background: var(--paper,#faf8f4); color: var(--ink,#111); border-radius: 12px 12px 0 0; box-shadow: 0 -4px 20px rgba(0,0,0,.35);
  padding: 10px 12px 14px; font: 14px var(--ui-font,sans-serif); transform: translateY(100%); transition: transform .18s ease-out; }
.sp-sheet[data-open] { transform: translateY(0); }
@media (prefers-reduced-motion: reduce) { .sp-sheet { transition: none; } }
.sp-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-weight: var(--w-semi,600); font-size: 16px; }
.sp-sheet-body { display: flex; flex-direction: column; gap: 10px; }
.sp-sheet-body .sp-sheet-only { display: flex; }
.sp-sheet-body button.sp-sheet-only { display: inline-flex; align-items: center; justify-content: center; min-height: var(--ui-target,44px); }
.sp-mixette { flex-direction: column; gap: 6px; }
.sp-mixette > div { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px; }
.sp-strip { display: flex; flex-direction: column; gap: 2px; padding: 5px 8px 3px; border: 1px solid var(--line,#d8d3c8); border-radius: 8px; background: var(--btn,#fdfcfa); box-sizing: border-box; min-width: 0; }
.sp-strip[data-strong] { border-color: #8a857a; }
.sp-strip-head { display: flex; align-items: center; gap: 6px; }
.sp-strip-name { flex: 1 1 auto; min-width: 0; font: var(--w-semi,600) 13px var(--ui-font,sans-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: 0; padding: 0; color: inherit; text-align: left; min-height: 0; }
.sp-strip-name[data-toggle] { cursor: pointer; }
.sp-strip-btns { display: flex; gap: 4px; flex: none; }
.sp-strip-row { display: flex; align-items: center; gap: 8px; }
.sp-strip-value { flex: none; min-width: 3ch; text-align: right; font: 12px var(--ui-font,sans-serif); color: var(--ink-soft,#555); font-variant-numeric: tabular-nums; }
.sp-strip input[type=range] { flex: 1 1 auto; min-width: 0; width: 100%; -webkit-appearance: none; appearance: none; height: 28px; background: transparent; margin: 0; cursor: pointer; touch-action: pan-y; }
.sp-strip input[type=range]::-webkit-slider-runnable-track { height: 3px; background: #c9c4b8; border-radius: 2px; }
.sp-strip input[type=range]::-moz-range-track { height: 3px; background: #c9c4b8; border-radius: 2px; }
.sp-strip input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6.5px; border-radius: 50%; background: #5a5750; border: 0; }
.sp-strip input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #5a5750; border: 0; }
.sp-sheet-body .sp-extra { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap,2px); }
`;

/**
 * @param o.player stem player; o.getMap() → sync map; o.analysis → { segments }; o.session → { key, offsetMs }
 * @param o.onOffset(ms) the global offset changed (the map is rebuilt by the caller); o.onPitch(n) the pitch (semitones) changed; o.onKey(name) the original key was changed
 */
export function mountSyncPanel(host, { player, getMap, analysis = {}, session, label = (k) => k, onOffset = () => {}, onPitch = () => {}, onKey = () => {}, onPreRoll = () => {}, onSelection = () => {}, onPending = () => {}, readOnly = false }) {
  const root = el('div', 'border:1px solid var(--line,#d8d3c8);border-radius:10px;background:var(--module,#fcfbf8);padding:6px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px', { 'data-sync-panel': '' });
  if (readOnly) root.classList.add('sp-readonly');
  host.append(root);
  if (!document.getElementById(SHEET_STYLE_ID)) document.head.append(Object.assign(document.createElement('style'), { id: SHEET_STYLE_ID, textContent: SHEET_CSS }));

  // --- the pieces that go to a bottom sheet on a tablet / phone: `addToSheet('mix' | 'settings', node)`
  const movables = { mix: [], settings: [] };
  const addToSheet = (kind, node) => { node.classList.add('sp-movable'); movables[kind].push(node); };
  let openSheetClose = null;
  function openSheet(kind) {
    openSheetClose?.();
    const title = label(kind === 'mix' ? 'sync.sheet.mix' : 'sync.sheet.settings');
    const veil = el('div', '', { class: 'sp-sheet-veil', 'data-sync-sheet': kind });
    const box = el('div', '', { class: 'sp-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const head = el('div', '', { class: 'sp-sheet-head' }); const h = el('span'); h.textContent = title;
    const closeBtn = textBtn(label('sync.sheet.close'), label('sync.sheet.close'), () => close()); closeBtn.setAttribute('data-sync-sheet-close', '');
    head.append(h, closeBtn);
    const body = el('div', '', { class: 'sp-sheet-body' });
    const homes = movables[kind].map((node) => { const mark = document.createComment('sp'); node.replaceWith(mark); node.classList.remove('sp-movable'); body.append(node); return [node, mark]; });
    box.append(head, body); veil.append(box); document.body.append(veil);
    requestAnimationFrame(() => box.setAttribute('data-open', ''));
    let done = false;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    function close() {
      if (done) return; done = true; window.removeEventListener('keydown', onKey, true);
      for (const [node, mark] of homes) { mark.replaceWith(node); node.classList.add('sp-movable'); }
      veil.remove(); openSheetClose = null;
    }
    veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
    window.addEventListener('keydown', onKey, true);
    openSheetClose = close;
  }

  // --- transport row
  const row1 = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)');
  const playBtn = iconBtn('play', label('sync.play'), () => { const s = player.state(); if (s.playing) player.pause(); else player.play(); });
  const stopBtn = iconBtn('square', label('sync.stop'), () => player.stop());
  playBtn.setAttribute('data-sync-play', ''); stopBtn.setAttribute('data-sync-stop', ''); // found by the mini transport (ui/mini-transport.js) when this panel scrolls out of sight
  const time = el('span', 'font:14px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums;margin:0 8px;min-width:90px', { 'data-sync-time': '' });
  const speedPill = createScrubPill({ min: 25, max: 200, value: 100, step: 1, pxPerStep: 2, format: (v) => `${v} %`, title: label('player.speed'), label: { down: label('player.slower'), up: label('player.faster') },
    onCommit: (v) => player.setRate(v / 100), onLong: () => player.setRate(1) });
  speedPill.el.style.flex = 'none';
  // pitch: − n +, with the original and the shifted keys
  const pitchMinus = textBtn('−', label('sync.pitchDown'), () => setPitch(player.state().semitones - 1));
  const pitchPlus = textBtn('+', label('sync.pitchUp'), () => setPitch(player.state().semitones + 1));
  const pitchVal = el('span', 'min-width:34px;text-align:center;font:14px var(--ui-font,sans-serif)', { 'data-sync-pitch': '' });
  const keyMenu = createChoiceMenu({ options: KEY_NAMES.map((k) => [k, k]), value: session.key, label: label('sync.originalKey'), act: 'sync-key', follow: true, onPick: (k) => { session.key = k; onKey(k); refresh(); } });
  const keyShown = el('span', 'font:13px var(--ui-font,sans-serif);color:var(--ink-soft,#555);margin-left:4px', { 'data-sync-key': '' });
  // global offset of the map
  const offMinus = textBtn('◂', label('sync.offsetEarlier'), () => setOffset(session.offsetMs - 10));
  const offPlus = textBtn('▸', label('sync.offsetLater'), () => setOffset(session.offsetMs + 10));
  const offVal = el('span', 'min-width:64px;text-align:center;font:13px var(--ui-font,sans-serif)', { 'data-sync-offset': '' });
  // pre-roll: a start from rest begins one or two measures earlier (the provider is in main.js); the metronome can sound during it
  const prerollBtn = textBtn('', label('sync.prerollHint'), () => { session.preRoll = ((session.preRoll ?? 0) + 1) % 3; onPreRoll(session); refresh(); });
  prerollBtn.setAttribute('data-sync-preroll', ''); prerollBtn.style.minWidth = '104px';
  const clickBtn = iconBtn('metronome', label('sync.prerollClick'), () => { session.preClick = !(session.preClick ?? true); onPreRoll(session); refresh(); });
  clickBtn.setAttribute('data-sync-preroll-click', '');
  // loop markers: A = the start of the measure under the playhead, B = the end of that measure; the loop itself is switched on with its own button
  // measure boundaries are those the loop uses (timeOf(i, 0)); the map's own `start` can differ by a few ms, so a time sitting ON a boundary (or a section edge
  // analysed a hair before it) must not fall into the previous measure
  const SNAP = 0.03;
  const containing = (map, t) => { let r = 0; for (let i = 0; i < map.playedCount; i += 1) { if (map.timeOfPlayed(i, 0) <= t + SNAP) r = i; else break; } return r; };
  const nearestBoundary = (map, t) => { let best = 0; let d = Infinity; for (let i = 0; i <= map.playedCount; i += 1) { const x = Math.abs((i < map.playedCount ? map.timeOfPlayed(i, 0) : map.end()) - t); if (x < d) { d = x; best = i; } } return best; };
  const measureAtPlayhead = () => { const map = getMap(); return map ? containing(map, player.state().position) : null; };
  const markBtn = (text, title, which) => { const b = textBtn(text, title, () => {
      const m = measureAtPlayhead(); if (m == null) return;
      if (which === 'a') { if (sel) setSel(m, Math.max(m, sel.b)); else setPending(m); return; }
      if (sel) setSel(Math.min(m, sel.a), m); else setSel(Math.min(pendingA ?? m, m), m); // B closes the loop A–B (shown, not yet playing)
    }); b.setAttribute('data-sync-mark', which); b.style.fontWeight = '700'; b.style.minWidth = '34px'; return b; };
  const markA = markBtn('A', label('sync.markA'), 'a'); const markB = markBtn('B', label('sync.markB'), 'b');
  // in the settings sheet of a tablet / phone A and B sit on the line of the pre-roll and of the transposition: copies shown only there (the originals stay under the timeline, for a computer)
  const markA2 = markBtn('A', label('sync.markA'), 'a'); const markB2 = markBtn('B', label('sync.markB'), 'b');
  for (const b of [markA2, markB2]) { b.classList.add('sp-sheet-only'); b.removeAttribute('data-sync-mark'); b.setAttribute('data-sync-mark-sheet', ''); }
  markA.classList.add('sp-desktop-only'); markB.classList.add('sp-desktop-only');
  const transpLabel = el('span', 'font:var(--w-semi,600) 13px var(--ui-font,sans-serif);margin:0 2px 0 8px', { class: 'sp-sheet-only' }); transpLabel.textContent = label('sync.transposeLabel');
  // a video (YouTube) has no stems, no pitch shift and no lead-in: only what it can do is offered
  const isVideo = player.state().kind === 'youtube';
  const extras = el('span', '', { class: 'sp-extra' }); // pre-roll, pitch and offset: on a tablet / phone they are in the settings sheet
  if (readOnly) keyMenu.classList.add('sp-desktop-only'); // the menu of the original key is not needed in the sheet of a reader: the stepper says it all
  extras.append(...(isVideo ? [] : [prerollBtn, clickBtn]), markA2, markB2, ...(isVideo ? [] : [el('span', 'width:12px'), transpLabel, pitchMinus, pitchVal, pitchPlus, keyMenu, keyShown]), el('span', 'width:12px'), offMinus, offVal, offPlus);
  const mixBtn = textBtn(label('sync.sheet.mix'), label('sync.sheet.mix'), () => openSheet('mix')); mixBtn.classList.add('sp-sheet-btn'); mixBtn.setAttribute('data-sync-open-mix', '');
  const settingsBtn = textBtn(label('sync.sheet.settings'), label('sync.sheet.settings'), () => openSheet('settings')); settingsBtn.classList.add('sp-sheet-btn'); settingsBtn.setAttribute('data-sync-open-settings', '');
  row1.append(playBtn, stopBtn, time, speedPill.el, extras, mixBtn, settingsBtn);
  if (readOnly) for (const x of [offMinus, offVal, offPlus]) x.style.display = 'none'; // a reader does not edit the map (the pre-roll stays: it is a way of listening)
  const setPitch = (n) => { player.setSemitones(n); onPitch(player.state().semitones); };
  const setOffset = (ms) => { session.offsetMs = Math.max(-5000, Math.min(5000, Math.round(ms))); onOffset(session.offsetMs); refresh(); };

  // --- timeline
  const canvas = el('canvas', 'width:100%;display:block;border-radius:6px;background:var(--score,#fff);touch-action:none;cursor:pointer', { 'data-sync-timeline': '', class: 'sp-timeline' });
  // selection of measures (always on whole measures) under the timeline: its ends are adjusted by measure, the loop plays it or not
  const selRow = el('div', 'display:flex;align-items:center;flex-wrap:wrap;gap:var(--btn-gap,2px)', { 'data-sync-selection': '' });
  const selLabel = el('span', 'font:13px var(--ui-font,sans-serif);margin:0 8px;min-width:130px', { 'data-sync-selection-label': '' });
  let sel = null; // { a, b } first and last measure (inclusive)
  let loopOn = false;
  let snapOn = false; // the loop ends sit on the nearest attack of the sound instead of exactly on the map's beats (to compare the two by ear)
  const snapped = (t) => { if (!snapOn || !player.attackNear) return t; const r = player.attackNear(t); return r && r.ratio >= 2 ? t + r.offsetMs / 1000 : t; };
  let fineA = 0; let fineB = 0; // manual fine adjustment of each loop end, in ms (on top of the map and of the snap), back to 0 with a new selection
  let curRange = null; // the loop as played { start, end }, worked out when the selection or an adjustment changes (not at every frame)
  const selRange = () => {
    const map = getMap(); if (!sel || !map) return null;
    const start = snapped(map.timeOfPlayed(sel.a, 0)) + fineA / 1000; const end = snapped(sel.b + 1 < map.playedCount ? map.timeOfPlayed(sel.b + 1, 0) : map.end()) + fineB / 1000;
    return end > start ? { start, end } : { start: map.timeOfPlayed(sel.a, 0), end: sel.b + 1 < map.playedCount ? map.timeOfPlayed(sel.b + 1, 0) : map.end() };
  };
  const applySel = () => { curRange = selRange(); player.setLoop(loopOn ? curRange : null); refresh(); onSelection(sel ? { ...sel } : null, loopOn); }; // the score of the synchro reader draws its bands from this
  let pendingA = null; // marker A put alone (no B yet): shown on the score, no loop until B comes
  const setPending = (m) => { pendingA = m; onPending(m); };
  const setSel = (a, b, { loop = loopOn } = {}) => {
    if (pendingA != null) setPending(null);
    const map = getMap(); const n = map?.playedCount ?? 0;
    fineA = 0; fineB = 0;
    sel = n ? { a: Math.max(0, Math.min(a, n - 1)), b: Math.max(0, Math.min(Math.max(a, b), n - 1)) } : null; loopOn = loop; applySel();
  };
  const clearSel = () => { if (pendingA != null) setPending(null); fineA = 0; fineB = 0; sel = null; loopOn = false; applySel(); };
  const nudge = (which, d) => { if (!sel) return; if (which === 'a') setSel(Math.min(sel.a + d, sel.b), sel.b); else setSel(sel.a, Math.max(sel.b + d, sel.a)); };
  const selLoopBtn = iconBtn('repeat', label('sync.loopToggle'), () => { loopOn = !loopOn; applySel(); });
  const selInfo = el('span', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#555);margin:0 8px;white-space:nowrap', { 'data-sync-attack': '' }); // how far the markers are from the nearest attack in the sound
  let infoKey = '';
  const snapBtn = textBtn('⌖', label('sync.snapHint'), () => { snapOn = !snapOn; applySel(); });
  snapBtn.setAttribute('data-sync-snap', ''); snapBtn.style.fontWeight = '700';
  const fineStep = (which) => {
    const val = el('span', 'min-width:58px;text-align:center;font:13px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums', { [`data-sync-fine-${which}`]: '' });
    const move = (d) => { if (which === 'a') fineA = Math.max(-500, Math.min(500, fineA + d)); else fineB = Math.max(-500, Math.min(500, fineB + d)); applySel(); };
    const minus = textBtn('−', label('sync.fine', { m: which.toUpperCase() }), () => move(-5)); const plus = textBtn('+', label('sync.fine', { m: which.toUpperCase() }), () => move(5));
    return { wrap: el('span', 'display:inline-flex;align-items:center;margin-left:6px', {}), val, minus, plus };
  };
  const fineAEl = fineStep('a'); const fineBEl = fineStep('b');
  for (const [which, f] of [['A', fineAEl], ['B', fineBEl]]) { const tag = el('span', 'font:700 13px var(--ui-font,sans-serif);margin-right:3px'); tag.textContent = which; f.wrap.append(tag, f.minus, f.val, f.plus); }
  const selTimes = el('span', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#555);margin:0 8px;white-space:nowrap;font-variant-numeric:tabular-nums', { 'data-sync-times': '' });
  const selDetail = el('span', 'display:none'); // the measure steppers, the loop button and clear: only when markers exist
  selDetail.append(textBtn('◂', label('sync.startEarlier'), () => nudge('a', -1)), selLabel, textBtn('▸', label('sync.startLater'), () => nudge('a', 1)),
    el('span', 'width:10px'), textBtn('◂', label('sync.endEarlier'), () => nudge('b', -1)), textBtn('▸', label('sync.endLater'), () => nudge('b', 1)),
    el('span', 'width:10px'), selLoopBtn, snapBtn, fineAEl.wrap, fineBEl.wrap, selInfo, textBtn('✕', label('sync.clearSelection'), clearSel), selTimes);
  selRow.append(markA, markB, el('span', 'width:10px'), selDetail);
  const row3 = el('div', 'display:flex;flex-wrap:wrap;gap:4px 6px');
  const readerRow = readOnly ? null : createReaderOptionsRow({ session, label }); // what the author offers to the reader
  root.append(...(readerRow ? [readerRow.el] : []), canvas, row1, selRow, row3);
  addToSheet('settings', extras); addToSheet('settings', selRow); if (readerRow) addToSheet('settings', readerRow.el);
  row3.classList.add('sp-desktop-only'); // the knobs of the stems stay on the page for a computer; a tablet / phone gets the mixette (faders) in its sheet

  const SECTION_FILL = { intro: '#e9e4d6', verse: '#dfe7f2', chorus: '#f4dfdc', bridge: '#e4f0df', solo: '#f1e8c9', inst: '#e7dff0', outro: '#e9e4d6' };
  const sectionFill = (name) => SECTION_FILL[String(name).toLowerCase().replace(/[^a-z]/g, '')] ?? '#ece9e1';
  let drag = null;
  const timeAtX = (x) => (x / canvas.clientWidth) * Math.max(0.001, player.state().duration);
  function draw() {
    const st = player.state(); const map = getMap();
    const w = canvas.clientWidth; const h = canvas.clientHeight; if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const D = Math.max(0.001, st.duration); const X = (t) => (t / D) * w;
    for (const s of analysis.segments ?? []) { g.fillStyle = sectionFill(s.label); g.fillRect(X(s.start + session.offsetMs / 1000), 0, X(s.end - s.start), 14); g.fillStyle = '#555'; g.font = '10px sans-serif'; g.fillText(String(s.label), X(s.start + session.offsetMs / 1000) + 3, 10); }
    const peaks = player.peaks();
    if (peaks) { g.fillStyle = '#9aa3b2'; const mid = 14 + (h - 14) / 2; for (let i = 0; i < peaks.length; i += 1) { const x = (i / peaks.length) * w; const a = peaks[i] * (h - 18) / 2; g.fillRect(x, mid - a, Math.max(1, w / peaks.length), a * 2); } }
    if (map) {
      g.strokeStyle = 'rgba(80,60,40,.35)'; g.lineWidth = 1;
      for (let m = 0; m < map.playedCount; m += 1) { const x = X(map.timeOfPlayed(m, 0)); if (w / map.playedCount < 3 && m % 4) continue; g.beginPath(); g.moveTo(x + 0.5, 14); g.lineTo(x + 0.5, h); g.stroke(); }
    }
    for (const s of analysis.partSegments ?? []) { // the parts of the form of the SCORE (while two files are being put together): a second band along the bottom
      g.fillStyle = 'rgba(130,95,175,.22)'; g.fillRect(X(s.start + session.offsetMs / 1000), h - 14, X(s.end - s.start), 14);
      g.fillStyle = '#4a3b6b'; g.font = '10px sans-serif'; g.fillText(String(s.label), X(s.start + session.offsetMs / 1000) + 3, h - 4);
    }
    const range = curRange;
    if (range) {
      if (loopOn) { g.fillStyle = 'rgba(46,160,90,.22)'; g.fillRect(X(range.start), 0, X(range.end - range.start), h); }
      else { g.strokeStyle = 'rgba(46,120,200,.8)'; g.setLineDash([4, 3]); g.strokeRect(X(range.start) + 0.5, 0.5, Math.max(1, X(range.end - range.start)) - 1, h - 1); g.setLineDash([]); g.fillStyle = 'rgba(46,120,200,.10)'; g.fillRect(X(range.start), 0, X(range.end - range.start), h); }
    }
    if (range) { g.fillStyle = loopOn ? 'rgb(30,120,70)' : 'rgb(46,120,200)'; g.font = '700 11px sans-serif'; g.fillText('A', X(range.start) + 3, 26); g.fillText('B', Math.max(X(range.start) + 14, X(range.end) - 11), 26); g.fillRect(X(range.start), 0, 2, h); g.fillRect(X(range.end) - 2, 0, 2, h); }
    if (drag?.moved) { g.fillStyle = 'rgba(46,120,200,.22)'; const a = Math.min(drag.t0, drag.t1); g.fillRect(X(a), 0, X(Math.abs(drag.t1 - drag.t0)), h); }
    g.fillStyle = '#e0561b'; g.fillRect(X(st.position) - 1, 0, 2, h);
  }
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture?.(e.pointerId); const r = canvas.getBoundingClientRect(); drag = { x0: e.clientX, y0: e.clientY - r.top, t0: timeAtX(e.clientX - r.left), t1: 0, moved: false }; drag.t1 = drag.t0; });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; const r = canvas.getBoundingClientRect(); drag.t1 = timeAtX(e.clientX - r.left); if (Math.abs(e.clientX - drag.x0) > 5) drag.moved = true; draw(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    const map = getMap();
    if (d.moved && map) setSel(containing(map, Math.min(d.t0, d.t1)), containing(map, Math.max(d.t0, d.t1)), { loop: true }); // a drag selects whole measures and loops them
    else if (map && (d.y0 <= 14 || (analysis.partSegments?.length && d.y0 >= canvas.clientHeight - 14))) { // a click on a part of the form (the top band: the analysis, the bottom one: the score) goes to its start
      const off = session.offsetMs / 1000;
      const seg = (d.y0 <= 14 ? analysis.segments ?? [] : analysis.partSegments).find((x) => d.t0 >= x.start + off && d.t0 < x.end + off);
      let sectionStart = 0;
      if (seg) { // the markers go to the first and the last measure of the part; the loop is switched on only by its button
        const first = nearestBoundary(map, seg.start + off); const last = Math.max(first, nearestBoundary(map, seg.end + off) - 1);
        setSel(Math.min(first, map.playedCount - 1), Math.min(last, map.playedCount - 1)); sectionStart = map.timeOfPlayed(Math.min(first, map.playedCount - 1), 0);
      }
      player.seek(seg ? sectionStart : d.t0);
    } else player.seek(d.t0);
    draw();
  });
  canvas.addEventListener('dblclick', () => clearSel());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- stems: one card per audio track = its name, M, S and a volume knob (the name, M, S and the knob go together: no doubt about whose solo it is)
  const stemRows = [];
  let masterKnob = null;
  const uiSize = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-target')) || 30;
  const card = (name, strong = false) => {
    const c = el('div', `display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:3px 5px;border:1px solid ${strong ? '#8a857a' : 'var(--line,#d8d3c8)'};border-radius:8px;background:var(--btn,#fdfcfa);box-sizing:border-box`);
    const n = el('span', 'font:var(--w-semi,600) 11px var(--ui-font,sans-serif);max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1'); n.textContent = name; n.title = name;
    c.append(n);
    return c;
  };
  const line = (...kids) => { const l = el('div', 'display:flex;align-items:center;gap:2px'); l.append(...kids); return l; };
  // --- the MIXETTE of the sheet (tablet / phone): one card per audio track (name, M, S and a slider with a round thumb), as in the track sheet of screen 3; the reader adds its own strips (the score)
  const mixette = el('div', '', { class: 'sp-mixette sp-sheet-only', 'data-sync-mixette': '' });
  const mixStems = el('div'); const mixExtra = el('div');
  mixette.append(mixStems, mixExtra);
  addToSheet('mix', mixette);
  /** One strip, in the style of the track cards of screen 3: the name (a button that shows / hides the track when `toggle` is given), M and S, and a thin slider with a round thumb under them.
   * spec: { name, strong?, fader: { min, max, value, def, onChange, format? } | null, mute?: () => void, solo?: () => void, toggle?: () => void } → { el, setFader, setMute, setSolo, setShown, setDim } */
  const title2 = (n) => `${label('syncreader.showHide', { name: n })}`;
  function makeStrip({ name, strong = false, fader, mute = null, solo = null, toggle = null }) {
    const strip = el('div', '', { class: 'sp-strip', 'data-sync-strip': name }); if (strong) strip.setAttribute('data-strong', '');
    const head = el('div', '', { class: 'sp-strip-head' });
    const title = el(toggle ? 'button' : 'span', '', { class: 'sp-strip-name', title: name, ...(toggle ? { type: 'button', 'data-toggle': '' } : {}) }); title.textContent = name;
    if (toggle) title.addEventListener('click', toggle);
    const btns = el('div', '', { class: 'sp-strip-btns' });
    const mk = (text, title2, fn) => { const b = textBtn(text, title2, fn); b.style.minWidth = '36px'; b.style.minHeight = '36px'; b.style.padding = '0'; b.style.fontWeight = '700'; return b; };
    const mBtn = mute ? mk('M', label('sync.mute'), mute) : null; const sBtn = solo ? mk('S', label('sync.solo'), solo) : null;
    if (mBtn) btns.append(mBtn); if (sBtn) btns.append(sBtn);
    const eye = toggle ? iconBtn('eye', title2(name), toggle) : null; // shows / hides the track of the score, like the eye of the track cards of screen 3
    if (eye) { eye.style.minWidth = '36px'; eye.style.minHeight = '36px'; eye.setAttribute('data-strip-eye', ''); btns.append(eye); }
    head.append(title, ...(mBtn || sBtn || eye ? [btns] : []));
    strip.append(head);
    let input = null; let value = null; const fmt = fader?.format ?? ((v) => String(v));
    if (fader) {
      input = el('input', '', { type: 'range', min: String(fader.min), max: String(fader.max), step: '1', value: String(fader.value), 'aria-label': `${name} ${label('sync.volume')}`, title: `${name} ${label('sync.volume')} (${fader.def})` });
      value = el('span', '', { class: 'sp-strip-value' }); value.textContent = fmt(fader.value);
      input.addEventListener('input', () => { const v = Number(input.value); value.textContent = fmt(v); fader.onChange(v); });
      input.addEventListener('dblclick', () => { input.value = String(fader.def); value.textContent = fmt(fader.def); fader.onChange(fader.def); }); // a double tap goes back to the default
      const row = el('div', '', { class: 'sp-strip-row' }); row.append(input, value); strip.append(row);
    }
    return {
      el: strip,
      setFader: (v) => { if (input && document.activeElement !== input) { input.value = String(v); value.textContent = fmt(v); } },
      setMute: (on) => { if (mBtn) { mBtn.setAttribute('aria-pressed', String(on)); mBtn.style.background = on ? '#e8b4a8' : ''; } },
      setSolo: (on) => { if (sBtn) { sBtn.setAttribute('aria-pressed', String(on)); sBtn.style.background = on ? '#f1d36b' : ''; } },
      setShown: (on) => { if (toggle) { title.setAttribute('aria-pressed', String(on)); eye.setAttribute('aria-pressed', String(on)); applyIconName(eye, on ? 'eye' : 'eye-off'); strip.style.opacity = on ? '' : '0.55'; } },
      setDim: (dim) => { strip.style.opacity = dim ? '0.55' : ''; },
    };
  }
  const mixStrips = []; // the strips of the stems, kept up to date by refresh()
  function buildStems() {
    row3.replaceChildren(); stemRows.length = 0;
    const size = uiSize();
    // one knob for ALL the audio tracks: the score (MIDI) cannot be as loud as the recording, so the recording is turned down as a whole
    if (isVideo) return;
    const all = card(label('sync.audioAll'), true); all.setAttribute('data-sync-master', '');
    masterKnob = createKnob({ min: 0, max: 150, value: Math.round(player.state().masterVolume * 100), def: 100, size, readout: false, label: label('sync.audioAll'), title: `${label('sync.audioAll')} (100)`, onChange: (v) => player.setMasterVolume(v / 100) });
    const flip = textBtn(masterSide() === 'left' ? '⇥' : '⇤', label('mixer.masterSide'), () => { flipMasterSide(); buildStems(); refresh(); }); // the master on the left of the tracks or on their right (as in the mixer)
    flip.style.minWidth = `${size}px`; flip.style.minHeight = `${size}px`; flip.style.padding = '0';
    all.append(line(masterKnob.el, flip));
    const right = masterSide() === 'right';
    mixStems.replaceChildren(); mixStrips.length = 0;
    const masterStrip = makeStrip({ name: label('sync.audioAll'), strong: true, fader: { min: 0, max: 150, value: Math.round(player.state().masterVolume * 100), def: 100, onChange: (v) => player.setMasterVolume(v / 100), format: (v) => `${v}` } });
    if (!right) mixStems.append(masterStrip.el);
    mixStrips.push({ master: true, strip: masterStrip });
    if (!right) row3.append(all);
    player.state().stems.forEach((s, i) => {
      const c = card(s.name); c.setAttribute('data-sync-stem', s.name);
      const mute = textBtn('M', label('sync.mute'), () => player.setStem(i, { mute: !player.state().stems[i].mute }));
      const solo = textBtn('S', label('sync.solo'), () => player.setStem(i, { solo: !player.state().stems[i].solo }));
      for (const b of [mute, solo]) { b.style.minWidth = `${size}px`; b.style.minHeight = `${size}px`; b.style.padding = '0'; b.style.fontWeight = '700'; }
      const knob = createKnob({ min: 0, max: 150, value: Math.round(s.volume * 100), def: 100, size, readout: false, label: `${s.name} ${label('sync.volume')}`, onChange: (v) => player.setStem(i, { volume: v / 100 }) });
      c.append(line(mute, solo, knob.el)); row3.append(c); stemRows.push({ card: c, mute, solo, knob });
      const strip = makeStrip({ name: s.name, fader: { min: 0, max: 150, value: Math.round(s.volume * 100), def: 100, onChange: (v) => player.setStem(i, { volume: v / 100 }) },
        mute: () => player.setStem(i, { mute: !player.state().stems[i].mute }), solo: () => player.setStem(i, { solo: !player.state().stems[i].solo }) });
      mixStems.append(strip.el); mixStrips.push({ index: i, strip });
    });
    if (right) { row3.append(all); mixStems.append(masterStrip.el); }
  }
  buildStems();

  function refresh() {
    const st = player.state();
    time.textContent = `${fmt(st.position)} / ${fmt(st.duration)}`;
    playBtn.setAttribute('aria-pressed', String(st.playing)); playBtn.style.outline = st.playing ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
    speedPill.setValue(Math.round(st.rate * 100));
    pitchVal.textContent = `${st.semitones > 0 ? '+' : ''}${st.semitones}`;
    keyMenu.setValue?.(session.key);
    keyShown.textContent = st.semitones ? `→ ${shiftedKeyName(session.key, st.semitones)}` : '';
    prerollBtn.textContent = session.preRoll ? label('sync.prerollN', { n: String(session.preRoll) }) : label('sync.prerollOff');
    prerollBtn.setAttribute('aria-pressed', String(!!session.preRoll)); prerollBtn.style.background = session.preRoll ? 'var(--btn-on,#e2e0da)' : '';
    clickBtn.setAttribute('aria-pressed', String(session.preClick ?? true)); clickBtn.style.background = (session.preClick ?? true) ? 'var(--btn-on,#e2e0da)' : ''; clickBtn.style.opacity = session.preRoll ? '1' : '0.5';
    offVal.textContent = `${session.offsetMs > 0 ? '+' : ''}${session.offsetMs} ms`;
    selDetail.style.display = sel ? 'contents' : 'none';
    if (sel && curRange) {
      const ms = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`;
      selTimes.textContent = `A ${ms(curRange.start)} · B ${ms(curRange.end)}`;
      const sgn = (v) => `${v > 0 ? '+' : ''}${v} ms`; fineAEl.val.textContent = sgn(fineA); fineBEl.val.textContent = sgn(fineB);
    }
    if (sel && !readOnly && player.attackNear) { // a marker sits on the map's first beat; the sound may have its attack a little before or after
      const map = getMap(); const key = `${sel.a}|${sel.b}|${session.offsetMs}`;
      if (map && key !== infoKey) {
        infoKey = key;
        const fmtMs = (r) => (!r || r.ratio < 2 ? '—' : `${r.offsetMs > 0 ? '+' : ''}${r.offsetMs} ms`);
        const tb = sel.b + 1 < map.playedCount ? map.timeOfPlayed(sel.b + 1, 0) : map.end();
        selInfo.textContent = `${label('sync.attackA')} ${fmtMs(player.attackNear(map.timeOfPlayed(sel.a, 0)))} · ${label('sync.attackB')} ${fmtMs(player.attackNear(tb))}`;
        selInfo.title = label('sync.attackHint');
      }
    }
    if (sel) { const mp = getMap(); const nameOf = (k) => { const w = mp?.writtenOf ? mp.writtenOf(k) : k; return mp && mp.passesOf?.(w) > 1 ? label('sync.passLabel', { n: String(w + 1), p: String(mp.passOf(k) + 1) }) : String(w + 1); }; selLabel.textContent = label('sync.selectionLabel', { a: nameOf(sel.a), b: nameOf(sel.b) }); snapBtn.setAttribute('aria-pressed', String(snapOn)); snapBtn.style.background = snapOn ? 'var(--btn-on,#e2e0da)' : ''; snapBtn.style.display = readOnly || !player.attackNear ? 'none' : ''; selLoopBtn.setAttribute('aria-pressed', String(loopOn)); selLoopBtn.style.background = loopOn ? 'var(--btn-on,#e2e0da)' : ''; }
    const anySolo = st.stems.some((x) => x.solo);
    st.stems.forEach((s, i) => {
      const r = stemRows[i]; if (!r) return;
      r.mute.setAttribute('aria-pressed', String(s.mute)); r.mute.style.background = s.mute ? '#e8b4a8' : '';
      r.solo.setAttribute('aria-pressed', String(s.solo)); r.solo.style.background = s.solo ? '#f1d36b' : '';
      r.card.style.opacity = !s.mute && (!anySolo || s.solo) ? '1' : '0.5'; // what is not heard is dimmed
      r.knob.setValue(Math.round(s.volume * 100));
    });
    masterKnob?.setValue(Math.round(st.masterVolume * 100));
    for (const m of mixStrips) {
      if (m.master) { m.strip.setFader(Math.round(st.masterVolume * 100)); continue; }
      const s = st.stems[m.index]; if (!s) continue;
      m.strip.setFader(Math.round(s.volume * 100)); m.strip.setMute(s.mute); m.strip.setSolo(s.solo); m.strip.setDim(s.mute || (anySolo && !s.solo));
    }
    draw();
  }
  const off = player.subscribe(refresh);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null; ro?.observe(canvas);
  refresh();
  return { addToSheet, mixette: { el: mixette, addStrip: (spec) => { const h = makeStrip(spec); mixExtra.append(h.el); return h; } }, setSelection: (a, b, opts) => setSel(a, b, opts), clearSelection: clearSel, selection: () => (sel ? { ...sel, loop: loopOn } : null), refresh, retarget: () => { if (sel) applySel(); }, rebuildStems: () => { buildStems(); refresh(); }, destroy() { off(); ro?.disconnect(); root.remove(); } };
}
