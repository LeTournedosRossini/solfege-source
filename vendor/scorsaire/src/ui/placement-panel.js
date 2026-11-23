/*
 * Media panel of mode B (screen 4): a video (YouTube) with FRAGMENTS of score placed on its timeline. The movements of the work are the fragments; each placement says
 * from which second of the video to which second a movement is shown. The panel draws the video, the transport, the timeline with the placements (drag a block to move
 * it, drag one of its edges to stretch it, tap an empty place to put the video there) and the buttons that set an edge of the selected block to the playhead.
 * Two tiers (rows) of fragments, a banner of cards and annotations under them, and the options of how fragments are shown (lead, fade, blocks in the reader's timeline).
 * It never writes the document: placements, banner and display options are the session's (`session.display`, `session.notes`; saved in the file by `main.js`).
 */
import { createReaderOptionsRow } from './reader-options-row.js';
import { createChoiceMenu } from './choice-menu.js';
import { createScrubPill } from './scrub-pill.js';
import { createKnob } from './knob.js';
import { applyIconName, icon } from './icons.js';
import { placementCardText, setPlacementCard, NAME_MAX, NUMBER_MAX, PLACEMENT_VIEWS, viewOf, setPlacementView, isOver, overOf, setPlacementOver, setPlacementLane, laneOf, groupOf, MAX_ROWS, OVER_DEFAULTS, addPlacement, movePlacement, resizePlacement, removePlacement, placementAt, rowOf, setPlacementRow, normalizeDisplay, leadOf, tailOf, fadeInOf, fadeOutOf, holdEnd } from '../audio/placements.js';
import { itemOver, onVideo, addItem, updateItem, moveItem, resizeItem, removeItem, styleOf, MAX_TEXT, lookRecord, clearLook } from '../audio/banner.js';
import { libraryStyles, addStyle, updateStyle } from '../audio/banner-styles.js';
import { askText } from './text-dialog.js';
import { createColorPicker } from './color-picker.js';
import { mountOverlayEditor } from './overlay-editor.js';

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const COLORS = ['#cfe0f5', '#f5d9d4', '#d8ecd3', '#efe3c2', '#e0d6ef', '#d3ecec'];
const EDGE = 10; // px: the grip of a block edge
/** A visible grip on the edge of the selected block, card or annotation: a small rounded pill straddling the edge. */
function drawGrip(g, x, top, h) { const w = 7; const hh = Math.max(10, h - 8); g.fillStyle = '#fff'; g.strokeStyle = '#2b6cff'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x - w / 2, top + (h - hh) / 2, w, hh, 3); g.fill(); g.stroke(); }
const snap = (t) => Math.round(t * 20) / 20; // the edges are placed to a twentieth of a second
const STEP = 0.05;
const fmt3 = (v) => `${Math.floor(v / 60)}:${(v % 60).toFixed(3).padStart(6, '0')}`;
const fmt2 = (v) => `${Math.floor(v / 60)}:${(v % 60).toFixed(2).padStart(5, '0')}`;
// geometry of the canvas: the ruler, two tiers of fragments, then the banner (cards, annotations)
// LANES (tracks): 1 to 4 under the video, then (after a gap) 1 to 4 on the video; `CFG` = how many of each are shown now (set at each draw)
const RULER = 22; const ROW_H = 28; const LANE_H = 20; const GROUP_GAP = 8;
let CFG = { under: 2, over: 2 };
const modelLane = (u) => (u < CFG.under ? u : MAX_ROWS + (u - CFG.under)); // the lane of the placements for the slot `u` of the canvas (0 = top)
const uOf = (p) => (groupOf(p) === 0 ? rowOf(p) : CFG.under + rowOf(p));
const rowTop = (u) => RULER + u * ROW_H + (u >= CFG.under ? GROUP_GAP : 0);
const lanesBottom = () => RULER + (CFG.under + CFG.over) * ROW_H + GROUP_GAP;
const laneTop = (kind) => lanesBottom() + 4 + (kind === 'note' ? LANE_H + 2 : 0);
const heightTotal = () => lanesBottom() + 4 + 2 * LANE_H + 10;
const laneAtY = (y) => (y < RULER + CFG.under * ROW_H ? Math.max(0, Math.min(CFG.under - 1, Math.floor((y - RULER) / ROW_H))) : CFG.under + Math.max(0, Math.min(CFG.over - 1, Math.floor((y - RULER - CFG.under * ROW_H - GROUP_GAP) / ROW_H))));
const zoneAt = (y) => (y < RULER ? { z: 'ruler' } : y < lanesBottom() ? { z: 'row', row: modelLane(laneAtY(y)) } : y < laneTop('note') - 1 ? { z: 'item', kind: 'card' } : { z: 'item', kind: 'note' });

function el(tag, css = '', attrs = {}) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const iconBtn = (name, title, fn) => {
  const b = el('button', 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center', { type: 'button', title, 'aria-label': title });
  applyIconName(b, name); b.addEventListener('click', fn); return b;
};
const textBtn = (text, title, fn) => {
  const b = el('button', 'min-height:var(--ui-target,44px);min-width:var(--ui-target,44px);padding:0 8px;font:inherit', { type: 'button', title, 'aria-label': title });
  b.textContent = text; b.addEventListener('click', fn); return b;
};

/**
 * @param o.player      the YouTube adapter (`createYouTubePlayer`), already loaded; `o.videoHost` is the element it draws its iframe in (a child of the panel made here: see `frame`)
 * @param o.getPlacements() / o.setPlacements(list)   the placements of the session
 * @param o.movements() → [{ id, title, number }]   the movements of the work, in order
 * @param o.onAdd() → movement id of a NEW fragment (an empty copy of the structure of the last one)
 * @param o.onSelect(placement | null)   the selected block changed (the score shows its movement)
 * @param o.selected() → id of the selected placement
 * @param o.marks(placement) → fractions 0..1 where the measures of the movement start inside the block (only a visual aid: the time is made by the two edges)
 * @param o.onState()   called at the end of every refresh (the session history looks at the state then)
 * @param o.mountOverlay({ layer, frame }) → { update(state), redraw(), destroy() }   the layer of the fragments placed ON the video (over the video frame of the panel)
 * @param o.styleLibrary { get() → { items } | null, set(lib) }   the producer's named looks for cards and annotations (a preference of the editor); the session keeps a copy of those used (`session.styles`)
 * @param o.onMetronome(on)  the check metronome (a click on every quarter-note beat of the fragments, `session.metronome`; editor only, never saved)
 * @param o.onMetronomeVolume(v 0..1)  the volume of the check metronome changed (`session.metronomeVolume`)
 * @param o.session / o.onSoundOffset(ms) the delay of the sound of the score (ms) against the video
 */
export function mountPlacementPanel(host, { layout = null, onState = null, mountOverlay = null, styleLibrary = null, onMetronome = null, onMetronomeVolume = null, onAddText = null, onAddImage = null, player, getPlacements, setPlacements, movements, onAdd, onSelect, selected, marks = () => [], session = {}, onSoundOffset = () => {}, label = (k) => k }) {
  const root = el('div', 'border:1px solid var(--line,#d8d3c8);border-radius:10px;background:var(--module,#fcfbf8);padding:6px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px', { 'data-placement-panel': '' });
  host.append(root);
  let selectionHint = null;
  const top = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start');
  const frame = el('div', 'width:min(100%,360px);aspect-ratio:16/9;background:#111;border-radius:8px;overflow:hidden;flex:none', { 'data-placement-video': '' });
  // the layer is a SHIELD over the video: the pointer never reaches YouTube's iframe (it would swallow the moves of a drag); the controls of the video are off here, the panel has its own
  const layer = el('div', 'position:absolute;inset:0;pointer-events:auto;touch-action:none;overflow:hidden', { 'data-placement-layer': '' }); frame.style.position = 'relative'; frame.append(layer);
  const side = el('div', 'display:flex;flex-direction:column;gap:6px;flex:1 1 260px;min-width:240px');
  top.append(side); // the video is in the viewer of screen 5; the frame stays alive (detached) for the overlay code that still reads it

  // the layer of the fragments ON the video, over the video frame; a box is dragged with the pointer (the selected fragment moves, in percent of the frame)
  let overlay = null; let overlaySig = '';
  let overlayEd = null;
  if (mountOverlay) {
    overlay = mountOverlay({ layer, frame });
    overlayEd = mountOverlayEditor({ frame, layer, label, getPlacements, setPlacements, selected, onSelect, refresh: () => refresh() });
  }
  const placeHandles = () => overlayEd?.placeHandles();

  // transport
  const row1 = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)');
  const time = el('span', 'font:14px var(--ui-font,sans-serif);font-variant-numeric:tabular-nums;margin:0 8px;min-width:120px', { 'data-placement-time': '' });
  row1.append(time); // the viewer's own controls play, stop and set the speed
  const message = el('span', 'font:13px var(--ui-font,sans-serif);color:var(--danger-ink,#a33);min-height:1.2em', { 'data-placement-message': '' });
  const addBtn = textBtn(`＋ ${label('placement.add')}`, label('placement.addHint'), () => addFragment());
  addBtn.setAttribute('data-placement-add', '');
  const textBtnEl = onAddText ? textBtn(`＋ ${label('blocks.addText')}`, label('blocks.addHint'), () => onAddText()) : null;
  if (textBtnEl) textBtnEl.setAttribute('data-placement-add-text', '');
  const addRow = el('div', 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap');
  const imageBtnEl = onAddImage ? textBtn(`＋ ${label('blocks.addImage')}`, label('blocks.addImageHint'), () => onAddImage()) : null;
  if (imageBtnEl) imageBtnEl.setAttribute('data-placement-add-image', '');
  addRow.append(addBtn, ...(textBtnEl ? [textBtnEl] : []), ...(imageBtnEl ? [imageBtnEl] : []));
  side.append(row1, addRow, message);

  // REUSE: the same fragment (a movement) placed again, anywhere on the timeline (not a copy: a change of its music is heard in every use)
  let reuseMenu = null; let reuseSig = '';
  const reuse = (movementId) => {
    message.textContent = '';
    const st = player.state(); const all = getPlacements();
    const from = [...all].reverse().find((p) => p.movementId === movementId);
    const length = from ? from.end - from.start : undefined; const start = snap(st.position);
    let list = addPlacement(all, { movementId, start, length, duration: st.duration, lane: from ? laneOf(from) : 0 });
    const early = list && list[list.length - 1].start - start > 0.01; // pushed later: the other tier may have room at the very place
    if (!list || early) { const other = addPlacement(all, { movementId, start, length, duration: st.duration, lane: from ? groupOf(from) * 2 + (rowOf(from) === 1 ? 0 : 1) : 1 }); if (other && Math.abs(other[other.length - 1].start - start) < 0.01) list = other; }
    if (!list) { message.textContent = label('placement.noRoom'); return; }
    const added = list[list.length - 1];
    const carried = from ? Object.fromEntries(['lead', 'tail', 'fade', 'fadeOut'].filter((k) => from[k] != null).map((k) => [k, from[k]])) : {}; // its display settings come with it
    list = list.map((p) => (p === added ? { ...p, ...carried } : p));
    setList(list); selItem = null; onSelect(list[list.length - 1]);
  };
  const syncReuse = () => {
    const list = movements(); const sig = JSON.stringify(list.map((m) => [m.id, m.number, m.title]));
    if (reuseMenu && sig === reuseSig) return; reuseSig = sig; reuseMenu?.remove();
    reuseMenu = createChoiceMenu({ options: [['', `↻ ${label('placement.reuse')}`], ...list.map((m) => [m.id, `${m.number} ${m.title}`.trim() || m.id])], value: '', label: label('placement.reuseHint'), act: 'placement-reuse', onPick: (v) => { if (v) reuse(v); } });
    reuseMenu.setAttribute('data-placement-reuse', ''); addBtn.after(reuseMenu);
  };
  // timeline
  const canvas = el('canvas', `width:100%;height:${heightTotal()}px;display:block;border-radius:6px;background:var(--score,#fff);touch-action:none;cursor:pointer`, { 'data-placement-timeline': '' });
  // the selected block
  const edit = el('div', 'display:none;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)', { 'data-placement-edit': '' });
  const editLabel = el('span', 'font:13px var(--ui-font,sans-serif);margin:0 8px 0 4px;min-width:180px');
  const nudge = (edge, d) => { const p = current(); if (!p) return; setList(resizePlacement(getPlacements(), p.id, edge, (edge === 'start' ? p.start : p.end) + d, player.state().duration)); };
  const toHead = (edge) => { const p = current(); if (!p) return; setList(resizePlacement(getPlacements(), p.id, edge, snap(player.state().position), player.state().duration)); };
  // the shift: the whole fragment moves on the timeline by 10 ms a press (held down, it repeats)
  const shiftBy = (ms) => { const p = current(); if (!p) return; setList(movePlacement(getPlacements(), p.id, Math.round((p.start * 1000 + ms) / 10) * 10 / 1000, player.state().duration)); };
  function shiftBtn(text, title, dir) {
    const b = textBtn(text, title, () => {}); b.style.minWidth = '30px'; b.setAttribute('data-placement-shift', dir > 0 ? 'later' : 'earlier');
    let delay = 0; let every = 0; const stop = () => { clearTimeout(delay); clearInterval(every); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); shiftBy(dir * 10); delay = setTimeout(() => { every = setInterval(() => shiftBy(dir * 10), 70); }, 400); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shiftBy(dir * 10); } });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }
  // up / down one track keeping the exact same place in time (a fragment put under the video by mistake goes on it without being placed again)
  function laneBtn(text, title, dir) {
    return textBtn(text, title, () => {
      const p = current(); if (!p) return; syncLanes();
      const u = uOf(p) + dir; if (u < 0 || u >= CFG.under + CFG.over) return;
      const next = setPlacementLane(getPlacements(), p.id, modelLane(u));
      if (next === getPlacements()) { message.textContent = label('placement.noRoom'); return; }
      message.textContent = ''; setList(next);
    });
  }
  // the own name and number of the selected block (empty = those of the fragment it plays, shown as the hint)
  const cardCss = 'min-height:26px;box-sizing:border-box;border:1px solid var(--edge,#bbb);border-radius:8px;padding:0 8px;font:13px var(--ui-font,sans-serif);background:var(--field,#fff);color:var(--ink,#1c1b1a)';
  const numIn = el('input', `${cardCss};width:4.6em;text-align:center`, { type: 'text', maxlength: String(NUMBER_MAX), 'aria-label': label('placement.cardNumber'), title: label('placement.cardNumber'), 'data-placement-card-number': '' });
  const nameIn = el('input', `${cardCss};width:11em;flex:1 1 9em`, { type: 'text', maxlength: String(NAME_MAX), 'aria-label': label('placement.cardName'), title: label('placement.cardName'), 'data-placement-card-name': '' });
  const commitCard = () => { const p = current(); if (!p) return; const next = setPlacementCard(getPlacements(), p.id, { name: nameIn.value, number: numIn.value }); if (JSON.stringify(next) !== JSON.stringify(getPlacements())) setList(next); };
  for (const inp of [numIn, nameIn]) { inp.addEventListener('change', commitCard); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { commitCard(); inp.blur(); } }); }
  const cardReset = textBtn('↺', label('placement.cardReset'), () => { const p = current(); if (p) setList(setPlacementCard(getPlacements(), p.id, { name: '', number: '' })); });
  const cardRow = el('span', 'display:flex;align-items:center;gap:var(--btn-gap,2px);flex:1 1 100%;margin:2px 0', { 'data-placement-card': '' });
  const cardTitle = el('span', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#555);margin:0 2px 0 4px'); cardTitle.textContent = label('placement.cardLabel');
  cardRow.append(cardTitle, numIn, nameIn, cardReset);
  if (layout) { editLabel.style.flex = '1 1 100%'; editLabel.style.minWidth = '0'; editLabel.style.margin = '0 0 2px 2px'; editLabel.style.font = '700 13px sans-serif'; } // screen 5: the title and the times on the first line, the buttons on the second
  edit.append(editLabel, cardRow,
    textBtn('◂', label('placement.startEarlier'), () => nudge('start', -STEP)), textBtn(label('placement.start'), label('placement.startHere'), () => toHead('start')), textBtn('▸', label('placement.startLater'), () => nudge('start', STEP)),
    el('span', 'width:10px'),
    textBtn('◂', label('placement.endEarlier'), () => nudge('end', -STEP)), textBtn(label('placement.end'), label('placement.endHere'), () => toHead('end')), textBtn('▸', label('placement.endLater'), () => nudge('end', STEP)),
    el('span', 'width:10px'), el('span', 'font:12px var(--ui-font,sans-serif);margin-right:2px', { 'data-placement-shift-label': '' }), shiftBtn('−', label('placement.shiftEarlier'), -1), shiftBtn('+', label('placement.shiftLater'), 1),
    el('span', 'width:10px'), laneBtn('↑', label('placement.laneUp'), -1), laneBtn('↓', label('placement.laneDown'), 1),
    el('span', 'width:10px'),
    iconBtn('trash', label('placement.remove'), () => { const p = current(); if (!p) return; setList(removePlacement(getPlacements(), p.id)); onSelect(null); }));
  // zoom of the timeline (to place the edges with more care) and the delay of the sound of the score
  const zoomRow = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)');
  const zoomLabel = el('span', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#555);min-width:44px;text-align:center', { 'data-placement-zoom': '' });
  const pan = el('input', 'flex:1 1 120px;min-width:80px;display:none', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': label('placement.pan'), 'data-placement-pan': '' });
  const offLabel = el('span', 'font:12px var(--ui-font,sans-serif);min-width:62px;text-align:center', { 'data-placement-offset': '' });
  zoomRow.append(textBtn('−', label('placement.zoomOut'), () => setZoom(zoom / 1.6)), zoomLabel, textBtn('+', label('placement.zoomIn'), () => setZoom(zoom * 1.6)),
    textBtn('⤢', label('placement.zoomFit'), () => zoomToSelection()), textBtn('⟷', label('placement.zoomAll'), () => { zoom = 1; viewStart = 0; refresh(); }), pan,
    el('span', 'width:10px'), textBtn('◂', label('placement.soundEarlier'), () => setOffset((session.offsetMs ?? 0) - 10)), offLabel, textBtn('▸', label('placement.soundLater'), () => setOffset((session.offsetMs ?? 0) + 10)));
  // how the fragments are SHOWN in the reader (shown before they play, fade, the blocks in the timeline) and the banner
  const small = (text, title, fn) => { const b = textBtn(text, title, fn); b.style.minWidth = '30px'; b.style.padding = '0 6px'; return b; };
  // on a computer (screen 5) a number is a PILL: drag it up / down, a tap opens the small stepper, a double click a numeric field
  const pillMode = !!layout && typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  const HINT_KEYS = [['lead', 'Lead'], ['tail', 'Tail'], ['fadeIn', 'FadeIn'], ['fadeOut', 'FadeOut'], ['defaultLead', 'Lead'], ['defaultTail', 'Tail'], ['defaultFadeIn', 'FadeIn'], ['defaultFadeOut', 'FadeOut'], ['overX', 'OverX'], ['overY', 'OverY'], ['overW', 'OverW'], ['overSize', 'OverSize'], ['overOpacity', 'OverOpacity'], ['overSoft', 'OverSoft']];
  const hintOf = new Map(HINT_KEYS.map(([k, h]) => [label(`placement.${k}`), label(`placement.hint${h}`)]));
  const stepper = (name, read, change, reset, num = null) => {
    if (pillMode && num) {
      const unit = (v) => Math.round(v / num.step);
      const wrap = el('span', 'display:flex;align-items:center;justify-content:space-between;gap:var(--btn-gap,2px);min-width:0');
      const lab = el('span', 'font:12px var(--ui-font,sans-serif);margin-right:3px;color:var(--ink-soft,#444)'); lab.textContent = name;
      const pill = createScrubPill({ min: unit(num.min), max: unit(num.max), value: 0, pxPerStep: num.step < 1 ? 6 : 4, format: (v) => (v === null ? '–' : num.fmt(Math.round(v * num.step * 100) / 100)), title: name, label: { down: name, up: name },
        onCommit: (v) => change(v - unit(num.get())) });
      pill.el.style.cssText += ';min-width:0;min-height:26px;padding:0 8px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);border-radius:13px';
      const edit = () => { // double click: a numeric field in place of the pill
        pill.close(); // the stepper that the first click opened
        const inp = el('input', 'width:5em;min-height:26px;box-sizing:border-box;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);border:1px solid var(--line,#999);border-radius:6px;padding:0 6px;text-align:center', { type: 'number', step: String(num.step), min: String(num.min), max: String(num.max) });
        inp.value = String(Math.round(num.get() * 100) / 100); pill.el.replaceWith(inp); inp.focus(); inp.select();
        let done = false; const end = (ok) => { if (done) return; done = true; if (ok && inp.value !== '' && Number.isFinite(Number(inp.value))) { const v = Math.max(num.min, Math.min(num.max, Number(inp.value))); change(Math.round((v - num.get()) / num.step)); } if (inp.isConnected) inp.replaceWith(pill.el); update(); };
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
        inp.addEventListener('blur', () => end(true));
      };
      pill.el.addEventListener('dblclick', edit);
      const right = el('span', 'display:inline-flex;align-items:center;gap:var(--btn-gap,2px);margin-left:auto'); right.append(pill.el, ...(reset ? [small('↺', label('placement.auto'), reset)] : []));
      wrap.append(lab, right);
      const update = () => { pill.setValue(unit(num.get())); const dflt = reset && read().startsWith(label('placement.default')); pill.el.style.fontStyle = dflt ? 'italic' : ''; pill.el.style.opacity = dflt ? '.7' : ''; pill.el.title = `${name} — ${read()}${hintOf.get(name) ? `\n${hintOf.get(name)}` : ''}\n${label('placement.pillHelp')}`; };
      return { wrap, update };
    }
    const wrap = el('span', `display:inline-flex;align-items:center;gap:var(--btn-gap,2px);margin-right:${layout ? 6 : 8}px`);
    const lab = el('span', 'font:12px var(--ui-font,sans-serif);margin-right:2px'); lab.textContent = name;
    const val = el('span', layout ? 'min-width:0;padding:0 3px;white-space:nowrap' : 'min-width:76px'); val.classList.add('stp-val');
    const stpb = (b) => { b.classList.add('stp-b'); return b; }; // the shared look of the steppers (static/index.html)
    wrap.append(lab, stpb(small('−', name, () => change(-1))), val, stpb(small('+', name, () => change(1))), ...(reset ? [small('↺', label('placement.auto'), reset)] : []));
    return { wrap, update: () => { val.textContent = read(); } };
  };
  const round1 = (v) => Math.round(v * 10) / 10;
  const patchPlacement = (patch) => { const p = current(); if (!p) return; setList(getPlacements().map((x) => { if (x.id !== p.id) return x; const n = { ...x, ...patch }; for (const k of Object.keys(patch)) if (patch[k] == null) delete n[k]; return n; })); };
  const defTxt = (v) => `${label('placement.default')} (${v} s)`;
  const leadS = stepper(label('placement.lead'), () => { const p = current(); return p?.lead != null ? `${p.lead} s` : defTxt(disp().lead); }, (d) => { const p = current(); if (p) patchPlacement({ lead: Math.max(0, Math.min(30, round1(leadOf(p, disp()) + d * 0.5))) }); }, () => patchPlacement({ lead: null }), { get: () => { const p = current(); return p ? leadOf(p, disp()) : 0; }, min: 0, max: 30, step: 0.5, fmt: (v) => `${v} s` });
  const tailS = stepper(label('placement.tail'), () => { const p = current(); return p?.tail != null ? `${p.tail} s` : defTxt(disp().tail); }, (d) => { const p = current(); if (p) patchPlacement({ tail: Math.max(0, Math.min(60, round1(tailOf(p, disp()) + d * 0.5))) }); }, () => patchPlacement({ tail: null }), { get: () => { const p = current(); return p ? tailOf(p, disp()) : 0; }, min: 0, max: 60, step: 0.5, fmt: (v) => `${v} s` });
  const fadeInS = stepper(label('placement.fadeIn'), () => { const p = current(); return p?.fade != null ? `${p.fade} s` : defTxt(disp().fadeIn); }, (d) => { const p = current(); if (p) patchPlacement({ fade: Math.max(0, Math.min(5, round1(fadeInOf(p, disp()) + d * 0.1))) }); }, () => patchPlacement({ fade: null }), { get: () => { const p = current(); return p ? fadeInOf(p, disp()) : 0; }, min: 0, max: 5, step: 0.1, fmt: (v) => `${v} s` });
  const fadeOutS = stepper(label('placement.fadeOut'), () => { const p = current(); return p?.fadeOut != null ? `${p.fadeOut} s` : defTxt(disp().fadeOut); }, (d) => { const p = current(); if (p) patchPlacement({ fadeOut: Math.max(0, Math.min(5, round1(fadeOutOf(p, disp()) + d * 0.1))) }); }, () => patchPlacement({ fadeOut: null }), { get: () => { const p = current(); return p ? fadeOutOf(p, disp()) : 0; }, min: 0, max: 5, step: 0.1, fmt: (v) => `${v} s` });
  const showRow = el('div', 'display:none;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)', { 'data-placement-show': '' });
  // on the video: a fragment can be shown ON the video (a box in percent of the frame: x, y, width, with its own fill, opacity and soft edge) instead of under it
  const overVal = (key) => { const p = current(); return p ? overOf(p)[key] : 0; };
  const patchOver = (patch) => { const p = current(); if (p) setList(setPlacementOver(getPlacements(), p.id, patch)); };
  const ov = (name, key, step, lo, hi, fmtv = (v) => `${v}`) => stepper(label(name), () => fmtv(overVal(key)), (d) => patchOver({ [key]: Math.max(lo, Math.min(hi, Math.round((overVal(key) + d * step) * 100) / 100)) }), null, { get: () => overVal(key), min: lo, max: hi, step, fmt: fmtv });
  const ovX = ov('placement.overX', 'x', 1, 0, 95, (v) => `${v} %`); const ovY = ov('placement.overY', 'y', 1, 0, 50, (v) => `${v} %`); const ovW = ov('placement.overW', 'w', 1, 10, 100, (v) => `${v} %`); const ovZ = ov('placement.overSize', 'size', 5, 20, 200, (v) => `${v} %`);
  const ovO = ov('placement.overOpacity', 'opacity', 0.02, 0, 1, (v) => `${Math.round(v * 100)} %`); const ovS = ov('placement.overSoft', 'soft', 2, 0, 24);
  const ovColor = createColorPicker({ title: label('placement.overColor'), label, onInput: (c) => { const q = current(); if (q && isOver(q)) { setPlacements(setPlacementOver(getPlacements(), q.id, { color: c })); overlay?.redraw?.(); } }, onChange: (c) => patchOver({ color: c }) }); // the whole editing of a colour, with swatches
  const overRow = el('div', 'display:none;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)', { 'data-placement-over-row': '' });
  const ovInk = createColorPicker({ title: label('placement.overInk'), label, onInput: (c) => { const q = current(); if (q && isOver(q)) { setPlacements(setPlacementOver(getPlacements(), q.id, { ink: c })); overlay?.redraw?.(); } }, onChange: (c) => patchOver({ ink: c }) });
  const ovReset = small('↺', label('placement.overReset'), () => patchOver({ x: OVER_DEFAULTS.x, y: OVER_DEFAULTS.y, w: OVER_DEFAULTS.w })); // puts the box back where a new one starts (when it is lost off the picture)
  overRow.append(ovX.wrap, ovY.wrap, ovW.wrap, ovZ.wrap, ovO.wrap, ovS.wrap, ovColor.el, ovInk.el, ovReset);
  // how the fragment uses the width of the screen (one line as wide as the screen by default, lines, or one long line that scrolls sideways)
  const viewBtn = textBtn('', label('placement.viewHint'), () => { const p = current(); if (!p) return; const next = PLACEMENT_VIEWS[(PLACEMENT_VIEWS.indexOf(viewOf(p)) + 1) % PLACEMENT_VIEWS.length]; setList(setPlacementView(getPlacements(), p.id, next)); });
  viewBtn.setAttribute('data-placement-view', '');
  const viewWrap = el('span', 'display:flex;align-items:center;justify-content:space-between;gap:var(--btn-gap,2px);min-width:0'); const viewLab = el('span', 'font:12px var(--ui-font,sans-serif);margin-right:3px;color:var(--ink-soft,#444);min-width:6.2em'); viewLab.textContent = label('placement.view'); viewBtn.style.marginLeft = 'auto'; viewWrap.append(viewLab, viewBtn);
  const viewUpdate = () => { const p = current(); if (p) viewBtn.textContent = label(`placement.view.${viewOf(p)}`); };
  showRow.append(leadS.wrap, tailS.wrap, fadeInS.wrap, fadeOutS.wrap, viewWrap);
  const blocksBtn = textBtn('', label('placement.blocksHint'), () => setDisp({ showBlocks: !disp().showBlocks })); blocksBtn.setAttribute('data-placement-blocks', '');
  blocksBtn.style.cssText += ';display:inline-flex;align-items:center;gap:4px';
  const paintBlocksBtn = () => { const on = disp().showBlocks; blocksBtn.replaceChildren(icon(on ? 'eye' : 'eye-off'), document.createTextNode(label('placement.blocksShort'))); blocksBtn.setAttribute('aria-pressed', String(on)); blocksBtn.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; };
  const dLead = stepper(label('placement.defaultLead'), () => `${disp().lead} s`, (d) => setDisp({ lead: Math.max(0, Math.min(30, round1(disp().lead + d * 0.5))) }), null, { get: () => disp().lead, min: 0, max: 30, step: 0.5, fmt: (v) => `${v} s` });
  const dTail = stepper(label('placement.defaultTail'), () => `${disp().tail} s`, (d) => setDisp({ tail: Math.max(0, Math.min(60, round1(disp().tail + d * 0.5))) }), null, { get: () => disp().tail, min: 0, max: 60, step: 0.5, fmt: (v) => `${v} s` });
  const dFadeIn = stepper(label('placement.defaultFadeIn'), () => `${disp().fadeIn} s`, (d) => setDisp({ fadeIn: Math.max(0, Math.min(5, round1(disp().fadeIn + d * 0.1))) }), null, { get: () => disp().fadeIn, min: 0, max: 5, step: 0.1, fmt: (v) => `${v} s` });
  const dFadeOut = stepper(label('placement.defaultFadeOut'), () => `${disp().fadeOut} s`, (d) => setDisp({ fadeOut: Math.max(0, Math.min(5, round1(disp().fadeOut + d * 0.1))) }), null, { get: () => disp().fadeOut, min: 0, max: 5, step: 0.1, fmt: (v) => `${v} s` });
  const addNote = (kind) => { const st = player.state(); const r = addItem(notes(), { kind, start: snap(st.position), duration: st.duration || 1, ...(layout && kind !== 'marker' ? { place: 'video' } : {}) }); setNotes(r.list); selItem = r.item.id; onSelect(null); refresh(); setTimeout(() => itemText.focus(), 0); };
  const globRow = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)', { 'data-placement-options': '' });
  const addCard = textBtn(`＋ ${label('banner.addCard')}`, label('banner.addCardHint'), () => addNote('card')); addCard.setAttribute('data-banner-add-card', '');
  const addNoteBtn = textBtn(`＋ ${label('banner.addNote')}`, label('banner.addNoteHint'), () => addNote('note')); addNoteBtn.setAttribute('data-banner-add-note', '');
  const metroBtn = iconBtn('metronome', label('placement.metronomeHint'), () => { session.metronome = !session.metronome; onMetronome?.(!!session.metronome); refresh(); }); metroBtn.setAttribute('data-placement-metronome', '');
  const metroKnob = createKnob({ min: 0, max: 100, value: Math.round((session.metronomeVolume ?? 0.6) * 100), def: 60, size: 30, readout: false, label: label('placement.metronomeVolume'), title: label('placement.metronomeVolume'), onChange: (v) => { session.metronomeVolume = v / 100; onMetronomeVolume?.(session.metronomeVolume); } });
  const readerRow = createReaderOptionsRow({ kind: 'youtube', session, label, onChange: () => { overlay?.redraw?.(); } });
  const laneCount = (g) => Math.max(0, ...getPlacements().filter((q) => groupOf(q) === g).map((q) => rowOf(q) + 1));
  const lanesStep = (name, key, g) => stepper(label(name), () => `${disp().lanes[key]}`, (d) => { const n = Math.max(1, Math.min(MAX_ROWS, disp().lanes[key] + d)); if (n < laneCount(g)) { message.textContent = label('placement.laneInUse'); return; } message.textContent = ''; setDisp({ lanes: { ...disp().lanes, [key]: n } }); });
  const lanesUnderS = lanesStep('placement.lanesUnder', 'under', 0); const lanesOverS = lanesStep('placement.lanesOver', 'over', 1);
  globRow.append(lanesUnderS.wrap, lanesOverS.wrap, readerRow.el, el('span', 'width:8px'), blocksBtn, metroBtn, metroKnob.el, el('span', 'width:8px'), dLead.wrap, dTail.wrap, dFadeIn.wrap, dFadeOut.wrap);
  // the buttons of the banner go under those of the fragments, text and images, with a thin separator between
  const bannerRow = el('div', 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap;border-top:1px solid var(--line,#d8d3c8);padding-top:6px;margin-top:2px', { 'data-placement-banner-row': '' });
  const addMarkerBtn = textBtn(`⚑ ${label('banner.addMarker')}`, label('banner.addMarkerHint'), () => addNote('marker')); addMarkerBtn.setAttribute('data-banner-add-marker', '');
  bannerRow.append(addCard, addNoteBtn, addMarkerBtn); addRow.after(bannerRow);
  // the selected card or annotation
  const itemBar = el('div', 'display:none;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)', { 'data-banner-edit': '' });
  const itemText = el('textarea', 'font:16px var(--ui-font,sans-serif);padding:6px 8px;flex:1 1 100%;min-height:calc(var(--ui-target,44px) * 1.4);border:1px solid var(--line,#d8d3c8);border-radius:8px;resize:vertical;box-sizing:border-box', { rows: '2', maxlength: String(MAX_TEXT), 'aria-label': label('banner.text'), placeholder: label('banner.text'), 'data-banner-text': '' });
  itemText.addEventListener('input', () => { if (selItem) { setNotes(updateItem(notes(), selItem, { text: itemText.value })); draw(); } }); // several lines: Enter makes a new line
  const curItem = () => notes().find((i) => i.id === selItem) ?? null;
  const nudgeItem = (edge, d) => { const it = curItem(); if (!it) return; if (it.kind === 'marker') { setNotes(moveItem(notes(), it.id, it.start + d, player.state().duration)); refresh(); return; } setNotes(resizeItem(notes(), it.id, edge, (edge === 'start' ? it.start : it.end) + d, player.state().duration)); refresh(); };
  const patchItem = (patch) => { if (!selItem) return; setNotes(updateItem(notes(), selItem, patch)); refresh(); };
  const styleNow = () => styleOf(curItem() ?? { kind: 'card' }, session.styles);
  // the style of the item: writing (bold, italic, underline, size) and colours (fill, text, outline) and the thickness of the outline
  const flag = (text, key, title, css) => { const b = small(text, title, () => patchItem({ [key]: !styleNow()[key] })); b.style.cssText += css; return { b, update: () => { const on = styleNow()[key]; b.setAttribute('aria-pressed', String(on)); b.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; } }; };
  const boldF = flag('B', 'bold', label('banner.bold'), ';font-weight:var(--w-bold,700)'); const italicF = flag('I', 'italic', label('banner.italic'), ';font-style:italic;font-family:serif'); const underF = flag('U', 'underline', label('banner.underline'), ';text-decoration:underline');
  const sizeS = stepper(label('banner.size'), () => `${styleNow().size}`, (d) => patchItem({ size: Math.max(8, Math.min(40, styleNow().size + d)) }), null, { get: () => styleNow().size, min: 8, max: 40, step: 1, fmt: (v) => `${v}` });
  const widthS = stepper(label('banner.borderWidth'), () => `${styleNow().borderWidth}`, (d) => patchItem({ borderWidth: Math.max(0, Math.min(6, round1(styleNow().borderWidth + d * 0.5))) }), null, { get: () => styleNow().borderWidth, min: 0, max: 6, step: 0.5, fmt: (v) => `${v}` });
  const colorField = (key, styleKey, title) => {
    const wrap = el('label', 'display:inline-flex;align-items:center;gap:3px;font:12px var(--ui-font,sans-serif);margin-right:6px');
    const picker = createColorPicker({ title, label, onInput: (c) => { const it = curItem(); if (it) { setNotes(updateItem(notes(), it.id, { [key]: c })); draw(); } }, onChange: () => refresh() });
    const txt = el('span'); txt.textContent = title; wrap.append(txt, picker.el);
    return { wrap, update: () => { picker.setValue(styleNow()[styleKey]); } };
  };
  const fillC = colorField('color', 'fill', label('banner.fill')); const inkC = colorField('ink', 'ink', label('banner.ink')); const borderC = colorField('border', 'border', label('banner.border'));
  // opacity of the fill and soft edge (a halo of the fill colour that melts the box into what is behind it)
  const opacityS = stepper(label('banner.opacity'), () => `${Math.round(styleNow().opacity * 100)} %`, (d) => patchItem({ opacity: Math.max(0, Math.min(1, Math.round((styleNow().opacity + d * 0.02) * 100) / 100)) }), null, { get: () => styleNow().opacity, min: 0, max: 1, step: 0.02, fmt: (v) => `${Math.round(v * 100)} %` });
  const softS = stepper(label('banner.soft'), () => `${styleNow().soft}`, (d) => patchItem({ soft: Math.max(0, Math.min(24, styleNow().soft + d * 2)) }), null, { get: () => styleNow().soft, min: 0, max: 24, step: 2, fmt: (v) => `${v}` });
  // named styles: the producer's library (a preference of the editor), copied into the session so that the file carries what it uses
  const getLib = () => (styleLibrary?.get() ?? { items: [] });
  const allStyles = () => ({ ...(session.styles ?? {}), ...Object.fromEntries(libraryStyles(getLib()).map((s) => [s.id, s])) });
  const remember = (rec) => { session.styles = { ...(session.styles ?? {}), [rec.id]: rec }; };
  let styleMenu = null;
  const buildStyleMenu = () => {
    styleMenu?.remove();
    const it = curItem(); const all = allStyles();
    styleMenu = createChoiceMenu({ options: [['', label('banner.noStyle')], ...Object.values(all).map((s) => [s.id, s.name])], value: it?.style ?? '', label: label('banner.style'), act: 'banner-style', follow: true,
      onPick: (id) => { if (!id) { patchItem({ style: null }); return; } const rec = all[id]; if (!rec) return; remember(rec); patchItem({ ...clearLook(), style: id }); } });
    styleRow.insertBefore(styleMenu, styleRow.firstChild);
  };
  const saveStyle = async () => {
    const it = curItem(); if (!it || !styleLibrary) return;
    const name = await askText({ title: label('banner.styleName'), label });
    if (!name?.trim()) return;
    const { lib, style } = addStyle(getLib(), name, lookRecord(styleNow()));
    styleLibrary.set(lib); remember(style); patchItem({ ...clearLook(), style: style.id });
  };
  const updateStyleNow = () => { // the style takes the look of this item, and every item that uses it follows
    const it = curItem(); if (!it?.style || !styleLibrary) return;
    const look = lookRecord(styleNow()); const lib = getLib();
    if (libraryStyles(lib).some((s) => s.id === it.style)) styleLibrary.set(updateStyle(lib, it.style, look)); else styleLibrary.set({ items: [...libraryStyles(lib), { id: it.style, name: session.styles?.[it.style]?.name ?? it.style, ...look }] });
    remember({ id: it.style, name: allStyles()[it.style]?.name ?? it.style, ...look }); patchItem(clearLook());
  };
  const detachStyle = () => { const it = curItem(); if (!it?.style) return; patchItem({ ...lookRecord(styleNow()), style: null }); };
  const itemLabel = el('span', 'font:12px var(--ui-font,sans-serif);margin:0 6px');
  // where the item sits ON the video (percent of the frame) and whether it is on the video or in the banner above the timeline
  const itemOverPatch = (patch) => { const it = curItem(); if (it) { setNotes(updateItem(notes(), it.id, { over: { ...itemOver(it), ...patch } })); refresh(); } };
  const itOv = (name, key, step, lo, hi) => stepper(label(name), () => `${itemOver(curItem()??{})[key]} %`, (d) => itemOverPatch({ [key]: Math.max(lo, Math.min(hi, Math.round((itemOver(curItem() ?? {})[key] + d * step) * 100) / 100)) }), null, { get: () => itemOver(curItem() ?? {})[key], min: lo, max: hi, step, fmt: (v) => `${v} %` });
  const itX = itOv('placement.overX', 'x', 1, 0, 95); const itY = itOv('placement.overY', 'y', 1, 0, 50); const itW = itOv('placement.overW', 'w', 1, 8, 100);
  const placeBtn = textBtn('', label('banner.placeHint'), () => { const it = curItem(); if (!it) return; patchItem(onVideo(it) ? { place: null } : { place: 'video' }); }); placeBtn.setAttribute('data-banner-place', '');
  const styleRow = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px);flex:1 1 100%');
  const libBtns = styleLibrary ? [small('＋', label('banner.saveStyle'), saveStyle), small('⟳', label('banner.updateStyle'), updateStyleNow), small('⛓', label('banner.detachStyle'), detachStyle)] : [];
  const resetBtn = small('↺', label('banner.resetStyle'), () => patchItem({ style: null, opacity: null, soft: null, color: null, ink: null, border: null, borderWidth: null, size: null, bold: null, italic: null, underline: null }));
  styleRow.append(boldF.b, italicF.b, underF.b, el('span', 'width:6px'), sizeS.wrap, widthS.wrap, fillC.wrap, inkC.wrap, borderC.wrap, opacityS.wrap, softS.wrap, ...libBtns, resetBtn);
  itemBar.append(itemText, styleRow, small('◂', label('placement.startEarlier'), () => nudgeItem('start', -STEP)), small('▸', label('placement.startLater'), () => nudgeItem('start', STEP)), el('span', 'width:6px'), small('◂', label('placement.endEarlier'), () => nudgeItem('end', -STEP)), small('▸', label('placement.endLater'), () => nudgeItem('end', STEP)), itemLabel,
    iconBtn('trash', label('banner.remove'), () => { if (!selItem) return; setNotes(removeItem(notes(), selItem)); selItem = null; refresh(); }));
  if (layout) { // screen 5: the timeline stays here; what depends on the chosen fragment goes to `layout.selection`, what is common to the file to `layout.settings`
    const hint = el('div', 'font:13px var(--ui-font,sans-serif);color:var(--ink-faint,#777);padding:6px 2px', { 'data-yt-selection-hint': '' }); hint.textContent = label('ytEditor.selectHint');
    zoomRow.append(el('span', 'width:10px'), textBtn('⚑', label('banner.addMarkerHint'), () => addNote('marker'))); // a marker at the playhead, right where the timeline is
    row1.append(message); const timelineTop = row1; // the message sits on the time line: no empty band over the ruler
    root.append(timelineTop, canvas, zoomRow);
    layout.selection.append(hint, edit, showRow, overRow, itemBar);
    // settings of the file, in framed sections whose columns line up
    const framed = (title, ...kids) => { const b = el('section', 'border:1px solid var(--line,#d8d3c8);border-radius:8px;background:var(--module,#fcfbf8);padding:6px 10px 10px;display:flex;flex-direction:column;gap:6px'); const h = el('div', 'font:var(--w-bold,700) 13px var(--ui-font,sans-serif)'); h.textContent = title; b.append(h, ...kids); return b; };
    const grid = (css) => el('div', `display:grid;gap:4px 10px;align-items:center;${css}`);
    bannerRow.style.cssText = 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap';
    readerRow.el.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px'; for (const b of readerRow.el.querySelectorAll('button')) b.style.width = '100%';
    const defaults = grid('grid-template-columns:repeat(2,minmax(0,1fr))');
    for (const d of [dLead, dTail, dFadeIn, dFadeOut]) { d.wrap.style.cssText += ';margin:0;padding:0;border:0;justify-content:space-between'; defaults.append(d.wrap); }
    const lanes = grid('grid-template-columns:repeat(2,minmax(0,1fr))'); for (const l of [lanesUnderS, lanesOverS]) { l.wrap.style.cssText += ';margin:0;justify-content:space-between'; lanes.append(l.wrap); }
    const tools = el('div', 'display:flex;align-items:center;gap:var(--btn-gap,2px);flex-wrap:wrap'); tools.append(blocksBtn, metroBtn, metroKnob.el);
    for (const r of [showRow, overRow]) { r.style.gridTemplateColumns = 'repeat(auto-fill,minmax(200px,1fr))'; r.style.gap = '4px 12px'; }
    for (const st of [leadS, tailS, fadeInS, fadeOutS, ovX, ovY, ovW, ovZ, ovO, ovS]) { st.wrap.style.cssText += ';margin:0;padding:0;border:0;justify-content:flex-start'; st.wrap.firstChild.style.minWidth = '6.2em'; const rs = st.wrap.lastChild; if (rs !== st.wrap.firstChild && rs.tagName === 'BUTTON') rs.style.marginLeft = 'auto'; }
    const labeled = (text, node) => { const w = el('span', 'display:flex;align-items:center;justify-content:space-between;gap:var(--btn-gap,2px);min-width:0'); const l = el('span', 'font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#444);min-width:6.2em'); l.textContent = text; node.style.marginLeft = 'auto'; w.append(l, node); return w; };
    ovColor.el.parentNode?.removeChild?.(ovColor.el); ovInk.el.parentNode?.removeChild?.(ovInk.el);
    overRow.replaceChildren(ovX.wrap, ovY.wrap, ovW.wrap, ovZ.wrap, ovO.wrap, ovS.wrap, labeled(label('placement.overColor'), ovColor.el), labeled(label('placement.overInk'), ovInk.el), ovReset);
    // the card / annotation bar: text, writing flags, then the same columns
    const itemGrid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px;align-items:center;flex:1 1 100%');
    for (const f of [sizeS, widthS, opacityS, softS, itX, itY, itW]) itemGrid.append(f.wrap);
    for (const c of [[fillC, 'banner.fill'], [inkC, 'banner.ink'], [borderC, 'banner.border']]) { const picker = c[0].wrap.lastChild; itemGrid.append(labeled(label(c[1]), picker)); }
    const flagsRow = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px);flex:1 1 100%'); flagsRow.append(boldF.b, italicF.b, underF.b, el('span', 'width:6px'), placeBtn, ...libBtns, resetBtn);
    styleRow.replaceChildren(flagsRow, itemGrid);
    layout.settings.setAttribute('data-yt-settings', ''); layout.selection.setAttribute('data-yt-selection', '');
    layout.settings.append(
      framed(label('ytEditor.setAdd'), addRow, bannerRow), framed(label('ytEditor.setReader'), readerRow.el),
      framed(label('ytEditor.setTimeline'), lanes, tools), framed(label('ytEditor.setDefaults'), defaults));
    if (!document.getElementById('yt-fonts-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'yt-fonts-style', textContent: '[data-yt-settings] button, [data-yt-selection] button { font: 13px var(--ui-font,sans-serif) !important; }' }));
    selectionHint = hint;
  } else root.append(top, canvas, zoomRow, edit, showRow, overRow, itemBar, globRow);

  const current = () => getPlacements().find((p) => p.id === selected()) ?? null;
  let selItem = null; // the selected card or annotation of the banner
  const notes = () => (session.notes ??= []);
  const setNotes = (list) => { session.notes = list; };
  const disp = () => normalizeDisplay(session.display);
  const setDisp = (patch) => { session.display = { ...disp(), ...patch }; refresh(); };
  const setList = (list) => { setPlacements(list); refresh(); };
  const baseOf = (movementId) => movements().find((x) => x.id === movementId) ?? null;
  const titleOf = (movementId) => { const m = baseOf(movementId); return m ? `${m.number} ${m.title}`.trim() : '?'; };
  const cardOf = (p) => { const m = baseOf(p.movementId); return m ? placementCardText(p, m) : '?'; }; // the own name / number of the placement, else the fragment's
  const colorOf = (movementId) => COLORS[Math.max(0, movements().findIndex((x) => x.id === movementId)) % COLORS.length];

  function addFragment() {
    message.textContent = '';
    const st = player.state();
    const movementId = onAdd(); if (!movementId) return;
    const list = addPlacement(getPlacements(), { movementId, start: snap(st.position), duration: st.duration });
    if (!list) { message.textContent = label('placement.noRoom'); return; }
    setList(list); onSelect(list[list.length - 1]);
  }

  // view of the timeline: zoom ≥ 1 and the first second shown
  let zoom = 1; let viewStart = 0;
  const D = () => Math.max(0.001, player.state().duration);
  const span = () => D() / zoom;
  const clampView = () => { viewStart = Math.max(0, Math.min(viewStart, D() - span())); };
  const setZoom = (z, anchor = null) => {
    const before = anchor ?? viewStart + span() / 2; const rel = (before - viewStart) / span();
    zoom = Math.max(1, Math.min(60, z)); viewStart = before - rel * span(); clampView(); refresh();
  };
  const zoomToSelection = () => { const p = current(); if (!p) { zoom = 1; viewStart = 0; refresh(); return; } const len = p.end - p.start; zoom = Math.max(1, Math.min(60, D() / (len * 1.3))); viewStart = p.start - len * 0.15; clampView(); refresh(); };
  const setOffset = (ms) => { session.offsetMs = Math.max(-2000, Math.min(2000, Math.round(ms))); onSoundOffset(session.offsetMs); refresh(); };
  pan.addEventListener('input', () => { viewStart = (Number(pan.value) / 1000) * Math.max(0, D() - span()); draw(); });

  // drag: a block moves (and changes tier when it is dragged to the other one), an edge stretches, the ruler (and an empty place) moves the video, the handles of the
  // ruler stretch the selected block; in the banner an item moves or stretches the same way
  let drag = null;
  const W = () => canvas.clientWidth;
  const X = (t) => ((t - viewStart) / span()) * W();
  const timeAtX = (x) => viewStart + (x / W()) * span();
  // the handles of the selected fragment: the start of its display (left of the pale band) and the end of its hold (right of the end)
  const HANDLE = 7;
  const leadHandleX = (p) => X(p.start - leadOf(p, disp())) - HANDLE;
  const holdOf = (p) => holdEnd(getPlacements(), p, disp(), D());
  const tailHandleX = (p) => X(holdOf(p)) + HANDLE;
  const handleAt = (p, x, y) => {
    const top = rowTop(uOf(p)); if (y < top || y > top + ROW_H) return null;
    if (Math.abs(x - leadHandleX(p)) <= 9) return 'lead';
    if (Math.abs(x - tailHandleX(p)) <= 9) return 'tail';
    return null;
  };
  const edgeOf = (x, x1, x2) => (x <= x1 + EDGE ? 'start' : x >= x2 - EDGE ? 'end' : 'body');
  const hit = (x, row) => {
    for (const p of getPlacements()) {
      if (laneOf(p) !== row) continue;
      const x1 = X(p.start); const x2 = X(p.end);
      if (x >= x1 - 2 && x <= x2 + 2) return { p, part: edgeOf(x, x1, x2) };
    }
    return null;
  };
  const hitItem = (x, kind) => {
    for (const it of notes().filter((i) => i.kind === kind)) {
      const x1 = X(it.start); const x2 = X(it.end);
      if (x >= x1 - 2 && x <= x2 + 2) return { it, part: edgeOf(x, x1, x2) };
    }
    return null;
  };
  let lastSeek = 0;
  const scrub = (t) => { const now = performance.now(); if (now - lastSeek > 150) { lastSeek = now; player.seek(t); } };
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
    canvas.setPointerCapture?.(e.pointerId); message.textContent = '';
    const sel = current(); const zone = zoneAt(y);
    const grip = zone.z === 'row' && sel ? handleAt(sel, x, y) : null;
    if (grip) { drag = { kind: grip, id: sel.id, x0: x, list: getPlacements(), moved: false, handle: true }; return; }
    if (zone.z === 'ruler') { // the ruler ALWAYS moves the video, except on the handles of the selected block and on a marker (a flag moves along the ruler)
      const mk = notes().find((m) => m.kind === 'marker' && x >= X(m.start) - 3 && x <= X(m.start) + 14 && y >= RULER - 18);
      if (mk) { selItem = mk.id; onSelect(null); drag = { kind: 'item-body', id: mk.id, x0: x, t0: timeAtX(x), list: notes(), start: mk.start, moved: false }; refresh(); return; }
      if (sel && Math.abs(x - X(sel.start)) <= 11) { drag = { kind: 'start', id: sel.id, x0: x, t0: timeAtX(x), list: getPlacements(), moved: false, handle: true }; return; }
      if (sel && Math.abs(x - X(sel.end)) <= 11) { drag = { kind: 'end', id: sel.id, x0: x, t0: timeAtX(x), list: getPlacements(), moved: false, handle: true }; return; }
      drag = { kind: 'scrub', t: timeAtX(x) }; scrub(drag.t); return;
    }
    if (zone.z === 'item') {
      const h = hitItem(x, zone.kind);
      if (!h) { drag = { kind: 'seek', t: timeAtX(x) }; return; }
      selItem = h.it.id; onSelect(null);
      drag = { kind: `item-${h.part}`, id: h.it.id, x0: x, t0: timeAtX(x), list: notes(), start: h.it.start, moved: false };
      refresh(); return;
    }
    const h = hit(x, zone.row);
    if (!h) { drag = { kind: 'seek', t: timeAtX(x) }; return; }
    selItem = null; onSelect(h.p);
    drag = { kind: h.part, id: h.p.id, x0: x, y0: y, t0: timeAtX(x), list: getPlacements(), start: h.p.start, moved: false };
    refresh();
  });
  // the pointer says what a press would do: an edge or a handle stretches (↔), a block moves, elsewhere the video is moved
  const hoverCursor = (x, y) => {
    const sel = current(); const zone = zoneAt(y);
    if (zone.z === 'ruler') return notes().some((m) => m.kind === 'marker' && x >= X(m.start) - 3 && x <= X(m.start) + 14 && y >= RULER - 18) ? 'move' : sel && (Math.abs(x - X(sel.start)) <= 11 || Math.abs(x - X(sel.end)) <= 11) ? 'ew-resize' : 'pointer';
    if (zone.z === 'item') { const h = hitItem(x, zone.kind); return !h ? 'pointer' : h.part === 'body' ? 'move' : 'ew-resize'; }
    if (sel && handleAt(sel, x, y)) return 'ew-resize';
    const h = hit(x, zone.row); return !h ? 'pointer' : h.part === 'body' ? 'move' : 'ew-resize';
  };
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { const r0 = canvas.getBoundingClientRect(); canvas.style.cursor = hoverCursor(e.clientX - r0.left, e.clientY - r0.top); return; }
    const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left; const y = e.clientY - r.top;
    if (drag.kind === 'scrub') { drag.t = Math.max(0, Math.min(D(), timeAtX(x))); scrub(drag.t); return; }
    if (drag.kind === 'seek') return;
    const dt = timeAtX(x) - drag.t0;
    if (Math.abs(x - drag.x0) > 3 || (drag.y0 != null && Math.abs(y - drag.y0) > 4)) drag.moved = true; // a purely vertical drag (to another lane) counts too
    const dur = player.state().duration;
    if (drag.kind.startsWith('item-')) {
      if (!drag.moved) return;
      const it0 = drag.list.find((i) => i.id === drag.id); const part = drag.kind.slice(5);
      setNotes(part === 'body' ? moveItem(drag.list, drag.id, snap(drag.start + dt), dur) : resizeItem(drag.list, drag.id, part, snap((part === 'start' ? it0.start : it0.end) + dt), dur));
      draw(); return;
    }
    if (!drag.moved) return;
    const p0 = drag.list.find((p) => p.id === drag.id);
    if (drag.kind === 'lead' || drag.kind === 'tail') { // the display handles: the lead is the time before the start, the hold the time after the end
      const t = timeAtX(x + (drag.kind === 'lead' ? HANDLE : -HANDLE));
      const v = drag.kind === 'lead' ? Math.min(30, Math.max(0, snap(p0.start - t))) : Math.min(60, Math.max(0, snap(t - p0.end)));
      setPlacements(drag.list.map((p) => (p.id === drag.id ? { ...p, [drag.kind]: v } : p)));
      draw(); return;
    }
    if (drag.kind === 'body') {
      let list = drag.list; const z = zoneAt(y);
      if (z.z === 'row' && z.row !== laneOf(p0)) list = setPlacementLane(list, drag.id, z.row); // dragged to another lane (also from under the video to on it): it goes there if the place is free
      setPlacements(movePlacement(list, drag.id, snap(drag.start + dt), dur));
    } else setPlacements(resizePlacement(drag.list, drag.id, drag.kind, snap((drag.kind === 'start' ? p0.start : p0.end) + dt), dur));
    draw();
  });
  const end = () => { const d = drag; drag = null; if (d?.kind === 'seek') player.seek(d.t); else if (d?.kind === 'scrub') player.seek(d.t); else if (d?.moved) refresh(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // wheel: with Ctrl / ⌘ it zooms around the pointer; otherwise it slides the view when it is zoomed
  canvas.addEventListener('wheel', (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), timeAtX(e.clientX - r.left)); return; }
    if (zoom > 1) { e.preventDefault(); viewStart += ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / W()) * span(); clampView(); refresh(); }
  }, { passive: false });

  /** How many tracks the canvas shows: what the author chose, and at least what the placements already use. */
  function syncLanes() {
    const d = disp(); const list = getPlacements();
    const need = (g) => Math.max(0, ...list.filter((q) => groupOf(q) === g).map((q) => rowOf(q) + 1));
    // screen 5: only the tracks that are used, plus one free to drop a fragment into (never more than the author chose, never less than one)
    CFG = layout ? { under: Math.max(1, Math.min(d.lanes.under, need(0) + 1)), over: Math.max(1, Math.min(d.lanes.over, need(1) + 1)) } : { under: Math.max(d.lanes.under, need(0)), over: Math.max(d.lanes.over, need(1)) };
    const h = `${heightTotal()}px`; if (canvas.style.height !== h) canvas.style.height = h;
  }
  function draw() {
    syncLanes();
    const st = player.state(); const w = W(); const h = canvas.clientHeight; if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const sp = span(); const t0 = viewStart; const t1 = viewStart + sp;
    // the ruler band: ticks and the handles of the selected block
    g.fillStyle = 'rgba(0,0,0,.04)'; g.fillRect(0, 0, w, RULER);
    g.fillStyle = 'rgba(43,108,255,.05)'; g.fillRect(0, rowTop(CFG.under), w, CFG.over * ROW_H); // on the video: a faint blue
    g.fillStyle = 'rgba(0,0,0,.025)'; for (let u = 0; u < CFG.under + CFG.over; u += 1) if ((u < CFG.under ? u : u - CFG.under) % 2 === 1) g.fillRect(0, rowTop(u), w, ROW_H); // every second row of a group
    g.fillStyle = '#7b8aa6'; g.font = '9px sans-serif'; g.fillText(label('placement.laneUnder'), 3, rowTop(0) + 9); g.fillText(label('placement.laneOver'), 3, rowTop(CFG.under) + 9);
    const step = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => (s / sp) * w >= 54) ?? 300;
    g.fillStyle = '#777'; g.font = '10px sans-serif'; g.strokeStyle = 'rgba(0,0,0,.25)';
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) { const x = X(t); g.beginPath(); g.moveTo(x + 0.5, 12); g.lineTo(x + 0.5, RULER); g.stroke(); g.fillText(step < 1 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`, x + 3, 10); }
    const disp = normalizeDisplay(session.display);
    for (const p of getPlacements()) {
      const sel = p.id === selected(); const x = X(p.start); const wd = Math.max(2, X(p.end) - X(p.start)); const top = rowTop(uOf(p)) + 2; const bh = ROW_H - 4;
      // the part of the time where the fragment is already shown before it plays (the lead), as a pale band
      const lead = leadOf(p, disp); if (lead > 0) { g.fillStyle = 'rgba(43,108,255,.12)'; g.fillRect(X(p.start - lead), top, X(p.start) - X(p.start - lead), bh); }
      const hold = holdOf(p); if (hold > p.end) { g.fillStyle = 'rgba(224,120,27,.15)'; g.fillRect(X(p.end), top, X(hold) - X(p.end), bh); } // the time it stays on show after it has played, for every fragment
      g.fillStyle = colorOf(p.movementId); g.fillRect(x, top, wd, bh);
      g.strokeStyle = sel ? '#2b6cff' : '#8a857a'; g.lineWidth = sel ? 2 : 1; g.strokeRect(x + 0.5, top + 0.5, wd - 1, bh - 1);
      if (sel) { drawGrip(g, x, top, bh); drawGrip(g, x + wd, top, bh); }
      // the measures of the movement inside the block (a visual aid only)
      if (wd >= 60) { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; for (const f of marks(p)) { if (f <= 0.001) continue; const mx = x + f * wd; g.beginPath(); g.moveTo(mx + 0.5, top + 2); g.lineTo(mx + 0.5, top + 10); g.stroke(); } }
      g.fillStyle = '#222'; g.font = '11px sans-serif'; g.save(); g.beginPath(); g.rect(x, top, wd, bh); g.clip(); g.fillText(cardOf(p), x + 5, top + 22); g.restore();
      if (sel) { // the handles of the display: start of the display (left) and end of the hold (right); filled when set for this fragment, hollow when automatic
        const grip = (hx, filled) => { g.beginPath(); g.roundRect(hx - 4, top + 6, 8, bh - 12, 3); g.fillStyle = filled ? '#2b6cff' : '#fff'; g.fill(); g.strokeStyle = '#2b6cff'; g.lineWidth = 1.5; g.stroke(); };
        grip(leadHandleX(p), p.lead != null); grip(tailHandleX(p), p.tail != null);
      }
      if (sel) { // the handles: a flag on the ruler at each edge
        g.fillStyle = '#2b6cff';
        for (const [tx, dir] of [[p.start, 1], [p.end, -1]]) { const hx = X(tx); g.beginPath(); g.moveTo(hx, 0); g.lineTo(hx + 9 * dir, 0); g.lineTo(hx, 14); g.closePath(); g.fill(); g.fillRect(hx - 1, 0, 2, RULER); }
      }
    }
    // the banner: cards and annotations
    for (const it of notes()) {
      if (it.kind === 'marker') continue;
      const sel = it.id === selItem; const x = X(it.start); const wd = Math.max(2, X(it.end) - X(it.start)); const top = laneTop(it.kind);
      const st2 = styleOf(it, session.styles);
      g.fillStyle = st2.fill; g.fillRect(x, top, wd, LANE_H);
      g.strokeStyle = sel ? '#2b6cff' : st2.border; g.lineWidth = sel ? 2 : Math.min(2, Math.max(0.5, st2.borderWidth)); g.strokeRect(x + 0.5, top + 0.5, wd - 1, LANE_H - 1);
      if (sel) { drawGrip(g, x, top, LANE_H); drawGrip(g, x + wd, top, LANE_H); }
      g.fillStyle = st2.ink; g.font = `${st2.italic ? 'italic ' : ''}${st2.bold ? '700 ' : ''}11px sans-serif`; g.save(); g.beginPath(); g.rect(x, top, wd, LANE_H); g.clip();
      const first = (it.text || '…').split('\n')[0]; g.fillText(first, x + 5, top + 14);
      if (st2.underline) { const w2 = g.measureText(first).width; g.fillRect(x + 5, top + 16, w2, 1); }
      g.restore();
    }
    // the markers of the timeline (for the person who makes the file only): a flag on the ruler and a thin line down the lanes
    for (const m of notes().filter((x) => x.kind === 'marker')) {
      const sel = m.id === selItem; const x = Math.round(X(m.start)) + 0.5; if (x < -12 || x > w + 12) continue; const col = m.color ?? '#e0a000';
      g.save(); g.strokeStyle = col; g.globalAlpha = sel ? 0.9 : 0.45; g.lineWidth = sel ? 2 : 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, h); g.stroke(); g.restore();
      g.fillStyle = col; g.beginPath(); g.moveTo(x, RULER - 15); g.lineTo(x + 11, RULER - 10.5); g.lineTo(x, RULER - 6); g.closePath(); g.fill(); g.fillRect(x - 1, RULER - 15, 2, 15);
      if (sel) { g.strokeStyle = '#2b6cff'; g.lineWidth = 1.5; g.strokeRect(x - 3, RULER - 17, 17, 14); }
      if (m.text) { g.fillStyle = '#222'; g.font = '10px sans-serif'; g.fillText(m.text.split('\n')[0], x + 14, RULER - 5); }
    }
    const px = X(st.position); g.fillStyle = '#e0561b'; g.fillRect(px - 1, 0, 2, h);
  }

  function refresh() {
    syncLanes();
    const st = player.state();
    time.textContent = `${fmt(st.position)} / ${fmt(st.duration)}`;
    // zoomed: the view follows the video when it goes out of it
    if (zoom > 1 && st.playing && (st.position < viewStart || st.position > viewStart + span())) { viewStart = st.position - span() * 0.1; clampView(); }
    zoomLabel.textContent = `×${zoom.toFixed(zoom < 10 ? 1 : 0)}`;
    pan.style.display = zoom > 1 ? '' : 'none'; if (zoom > 1) pan.value = String(Math.round((viewStart / Math.max(0.001, D() - span())) * 1000));
    offLabel.textContent = `${(session.offsetMs ?? 0) > 0 ? '+' : ''}${session.offsetMs ?? 0} ms`;
    syncReuse();
    const p = current();
    if (p) selItem = null;
    const rowOn = layout ? 'grid' : 'flex'; // screen 5: the display settings are laid out in columns that line up
    showRow.style.display = p ? rowOn : 'none';
    overRow.style.display = p && isOver(p) ? rowOn : 'none';
    if (p && isOver(p)) { ovX.update(); ovY.update(); ovW.update(); ovZ.update(); ovO.update(); ovS.update(); ovColor.setValue(overOf(p).color); ovInk.setValue(overOf(p).ink); }
    if (p) { leadS.update(); tailS.update(); fadeInS.update(); fadeOutS.update(); viewUpdate(); }
    paintBlocksBtn(); lanesUnderS.update(); lanesOverS.update(); dLead.update(); dTail.update(); dFadeIn.update(); dFadeOut.update(); metroBtn.setAttribute('aria-pressed', String(!!session.metronome)); metroBtn.style.background = session.metronome ? 'var(--btn-on,#e2e0da)' : '';
    const it = curItem(); if (selItem && !it) selItem = null;
    if (selectionHint) selectionHint.style.display = p || it ? 'none' : '';
    itemBar.style.display = it ? 'flex' : 'none'; if (it) styleRow.style.display = it.kind === 'marker' ? 'none' : '';
    if (it) { if (document.activeElement !== itemText) itemText.value = it.text; itemLabel.textContent = `${fmt2(it.start)} → ${fmt2(it.end)}`; for (const f of [boldF, italicF, underF, sizeS, widthS, fillC, inkC, borderC, opacityS, softS, itX, itY, itW]) f.update(); placeBtn.textContent = label(onVideo(it) ? 'banner.placeVideo' : 'banner.placeBanner'); itX.wrap.style.display = itY.wrap.style.display = itW.wrap.style.display = onVideo(it) ? (layout ? 'flex' : '') : 'none'; if (styleLibrary && (!styleMenu || styleMenu.dataset.sig !== `${it.style ?? ''}|${Object.keys(allStyles()).join(',')}`)) { buildStyleMenu(); styleMenu.dataset.sig = `${it.style ?? ''}|${Object.keys(allStyles()).join(',')}`; } }
    edit.style.display = p ? 'flex' : 'none';
    if (p) { const base = baseOf(p.movementId); numIn.placeholder = String(base?.number ?? ''); nameIn.placeholder = String(base?.title ?? ''); if (document.activeElement !== numIn) numIn.value = p.number ?? ''; if (document.activeElement !== nameIn) nameIn.value = p.name ?? ''; editLabel.textContent = `${cardOf(p)} : ${fmt3(p.start)} → ${fmt3(p.end)}`; edit.querySelector('[data-placement-shift-label]').textContent = label('placement.shift'); }
    draw();
    // the layer is drawn again when what it shows changes (a box moved, resized, recoloured; another fragment chosen)
    const sigNow = `${selected() ?? ''}|${JSON.stringify(getPlacements().filter(isOver))}`;
    if (sigNow !== overlaySig) { overlaySig = sigNow; overlay?.redraw?.(); }
    overlay?.update?.(player.state()); placeHandles();
    onState?.();
  }
  const off = player.subscribe(refresh);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null; ro?.observe(canvas);
  refresh();
  /** Puts a movement on the timeline at the video position: the same length and settings as its last use, or a new block. */
  const placeMovement = (movementId) => {
    if (getPlacements().some((p) => p.movementId === movementId)) { reuse(movementId); return; }
    message.textContent = ''; const st = player.state();
    const list = addPlacement(getPlacements(), { movementId, start: snap(st.position), duration: st.duration });
    if (!list) { message.textContent = label('placement.noRoom'); return; }
    setList(list); selItem = null; onSelect(list[list.length - 1]);
  };
  return { placeMovement, addFragment, selectedItemKind: () => (selItem ? curItem()?.kind ?? null : null), selectedItemId: () => (selItem && curItem() ? selItem : null), selectItem: (id) => { selItem = id; if (id) onSelect(null); refresh(); }, itemSelected: () => !!(selItem && curItem()), frame, refresh, redrawPreview: () => { overlay?.redraw?.(); }, destroy() { off(); ro?.disconnect(); overlay?.destroy?.(); root.remove(); }, activePlacement: () => placementAt(getPlacements(), player.state().position) };
}
