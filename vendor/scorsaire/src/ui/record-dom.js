/*
 * The recording window: a panel at the top of the page (it never covers the bottom dock, where the keyboard and the fretboard are played) that records a take
 * against a metronome on the measures of the selected range, shows it quantized and writes it with ONE undoable transaction. The logic is in `recorder.js`
 * (state machine) and `audio/recording.js` (clock, quantization); this file only draws and listens.
 *
 * Settings (grid, pre-roll beats, click volume, latency) are kept on the device (`scorsaire.recording`), never in the document.
 */
import { frac, fToNumber } from '../model/index.js';
import { createRecorder, DEFAULT_SETTINGS } from './recorder.js';
import { createCalibrator } from './calibrator.js';
import { noteZone, dragPatch, pitchName } from './pianoroll.js';

const KEY = 'scorsaire.recording';
const SINGLE_STYLE = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);width:min(720px,calc(100vw - 16px));overflow:auto;z-index:6;display:flex;flex-direction:column;gap:10px;padding:10px 12px;box-sizing:border-box;background:var(--bg,#fff);border:1px solid rgba(0,0,0,0.3);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,0.3)';
const GRID_LABELS = [[[1, 4], '1/4'], [[1, 8], '1/8'], [[1, 16], '1/16'], [[1, 32], '1/32']];

function loadSettings(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? '{}');
    const grid = Array.isArray(raw.grid) && GRID_LABELS.some(([g]) => g[0] === raw.grid[0] && g[1] === raw.grid[1]) ? raw.grid : DEFAULT_SETTINGS.grid;
    const num = (v, a, b, d) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
    return { grid: [...grid], prerollBeats: Math.round(num(raw.prerollBeats, 0, 8, DEFAULT_SETTINGS.prerollBeats)), legato: raw.legato === true, backing: raw.backing !== false, source: raw.source === 'midi' ? 'midi' : 'screen', midiOffsetMs: Math.round(num(raw.midiOffsetMs, -400, 400, 0)), midiDevice: typeof raw.midiDevice === 'string' ? raw.midiDevice : 'all', clickVolume: num(raw.clickVolume, 0.05, 1, DEFAULT_SETTINGS.clickVolume), offsetMs: Math.round(num(raw.offsetMs, -400, 400, 0)) };
  } catch { return { ...DEFAULT_SETTINGS, grid: [...DEFAULT_SETTINGS.grid] }; }
}

/**
 * @param o.app          the Application
 * @param o.getEngine    () → the audio engine (needs `clickAt`, `audioClock`)
 * @param o.pianoDrawer  the keyboard / fretboard drawer: `setRecorder(sink | null)`, `show('piano' | 'guitar')`, `view()`
 * @param o.dock         the bottom dock (its height is kept free)
 */
export function mountRecordWindow({ app, getEngine, backing = null, pianoDrawer, midi = null, dock = null, label = (k) => k, storage = null, viewId = 'main', onMessage = () => {} }) {
  let settings = loadSettings(storage);
  // the latency is one setting PER SOURCE (a MIDI keyboard has none to speak of, the screen a lot): `offsetMs` is the one of the chosen source
  const store = {
    get: () => ({ ...settings, offsetMs: settings.source === 'midi' ? settings.midiOffsetMs : settings.offsetMs }),
    set: (v) => {
      const { offsetMs, ...rest } = v;
      settings = { ...settings, ...rest, ...(offsetMs !== undefined ? (settings.source === 'midi' ? { midiOffsetMs: offsetMs } : { offsetMs }) : {}) };
      try { storage?.setItem(KEY, JSON.stringify(settings)); } catch { /* storage may be refused */ }
    },
  };
  let midiNote = ''; let stopMidi = null;
  let rec = null; let cal = null; let box = null;
  // the pre-rendered backing: status 'idle' | 'rendering' | 'ready' | 'error'; `stale` once the document changed since it was rendered
  let back = { status: 'idle', progress: 0, data: null, stale: true, ctl: null, error: '' }; let stopDocWatch = null;
  const backingOn = () => !!backing && settings.backing && backing.available(); let raf = 0; let selected = null; let message = ''; let stopDock = null; let statusEl = null;

  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
    for (const kid of kids) if (kid) e.append(kid);
    return e;
  };
  const button = (text, title, onClick, { action = '', primary = false, disabled = false, pressed = null } = {}) => {
    const b = h('button', { type: 'button', 'data-no-icon': '', title, 'aria-label': title, 'data-action': action, style: `min-height:var(--ui-target,44px);min-width:var(--ui-target,44px);padding:0 12px;cursor:pointer;${primary ? 'background:#2d78ff;color:#fff;border-color:#1f5fd0;font-weight:var(--w-bold,700)' : ''}` }, document.createTextNode(text));
    if (disabled) { b.disabled = true; b.style.opacity = '0.45'; }
    if (pressed !== null) { b.setAttribute('aria-pressed', String(pressed)); if (pressed) b.style.cssText += ';background:var(--primary,#1c1b1a);color:var(--primary-ink,#fff)'; }
    b.addEventListener('click', onClick);
    return b;
  };
  const stepper = (title, value, onChange, { unit = '', min, max, step = 1, fmt = (v) => String(v) }) => h('span', { class: 'stp', style: 'display:inline-flex;align-items:center;gap:var(--btn-gap,2px)', title },
    button('−', title, () => onChange(Math.max(min, value - step)), { action: `${title}-less`, disabled: value <= min }),
    h('span', { class: 'stp-val', style: 'min-width:3.6em', text: `${fmt(value)}${unit}` }),
    button('+', title, () => onChange(Math.min(max, value + step)), { action: `${title}-more`, disabled: value >= max }));

  const frameDock = () => { if (!box) return; const dh = dock?.el?.getBoundingClientRect().height ?? 0; box.style.maxHeight = `${Math.max(160, Math.round(window.innerHeight - dh - 24))}px`; }; // never over the dock: the keys are played there

  function stateText() {
    const s = rec.state; const clock = rec.clock();
    if (s === 'counting') return label('record.counting');
    if (s === 'recording') return label('record.recording');
    if (s === 'review') return label('record.review', { notes: (rec.quantized ? rec.result() : rec.raw()).chords.reduce((n, c) => n + c.notes.length, 0) });
    return label('record.ready', { from: rec.target().fromMeasure + 1, to: rec.target().toMeasure, seconds: Math.round(clock.length) });
  }
  function frame() {
    raf = 0;
    if (!rec || !statusEl || (rec.state !== 'counting' && rec.state !== 'recording')) return;
    const t = rec.elapsed(); const clicks = rec.clock().clicks(settings.prerollBeats);
    let last = null; for (const c of clicks) { if (c.t <= t + 0.02) last = c; else break; }
    const beat = last ? (last.measure < 0 ? `− ${clicks.filter((c) => c.measure < 0).length - clicks.indexOf(last)}` : `${last.measure + 1}.${last.beat + 1}`) : '…';
    statusEl.textContent = `${stateText()}  ${beat}`;
    raf = requestAnimationFrame(frame);
  }

  // The piano roll. Before quantizing it only shows the take as played. Once quantized it is an editor: the start and the end of a note are dragged (mouse: the
  // pointer turns into a resize cursor on the edges; touch: tap a note, then drag its handles), the body moves it in time and pitch; everything snaps to the
  // grid. A drag is previewed on the note itself and written (`rec.editNote`) when released; the window is redrawn then.
  let zoom = 1; let rollAvail = null; // rollAvail: the width of the left column on a wide screen
  const ROW = 14; const PAD = 6; const EDGE_PX = 9; const HANDLE_PX = 22;
  function roll(result) {
    const clock = rec.clock(); const total = Math.max(1, result.steps); const editable = rec.quantized;
    const ns = 'http://www.w3.org/2000/svg';
    const avail = rollAvail ?? Math.max(280, Math.min(720, window.innerWidth - 16) - 24);
    const W = Math.round(avail * zoom); const gridF = fToNumber(result.grid);
    const pitches = result.chords.flatMap((c) => c.notes.map((n) => n.midi));
    const lo = Math.max(0, Math.min(...pitches, 60) - (editable ? 3 : 1)); const hi = Math.min(127, Math.max(...pitches, 60) + (editable ? 3 : 1));
    const H = (hi - lo + 1) * ROW + 2 * PAD;
    const stepW = (W - 2 * PAD) / total;
    const x = (steps) => PAD + steps * stepW;
    const y = (midi) => H - PAD - (midi - lo + 1) * ROW; // top of the row of `midi`
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('data-piano-roll', '');
    svg.style.cssText = `width:${W}px;height:${H}px;display:block;background:var(--soft,#f7f4ec);user-select:none;-webkit-user-select:none;-webkit-touch-callout:none`;
    const el = (name, attrs, parent = svg) => { const e = document.createElementNS(ns, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); parent.append(e); return e; };
    // pitch rows: C rows are tinted and named
    for (let m = lo; m <= hi; m += 1) {
      const black = [1, 3, 6, 8, 10].includes(m % 12);
      el('rect', { x: 0, y: y(m), width: W, height: ROW, fill: black ? '#efeadf' : '#f7f4ec' });
      if (m % 12 === 0) { el('line', { x1: 0, x2: W, y1: y(m) + ROW, y2: y(m) + ROW, stroke: '#cfc8b8', 'stroke-width': 0.8 }); el('text', { x: 3, y: y(m) + ROW - 3, 'font-size': 9, fill: '#8a847a' }).textContent = pitchName(m); }
    }
    // beats and measure lines, and the grid lines (fainter) when editing
    if (editable) for (let k = 0; k <= total; k += 1) el('line', { x1: x(k), x2: x(k), y1: 0, y2: H, stroke: '#e6e1d4', 'stroke-width': 0.6 });
    for (const c of clock.clicks(0)) {
      const steps = clock.wholeAt(c.t) / gridF;
      el('line', { x1: x(steps), x2: x(steps), y1: 0, y2: H, stroke: c.accent ? '#8a847a' : '#d0cabc', 'stroke-width': c.accent ? 1.4 : 0.8 });
    }
    const toPx = (evt) => { const r = svg.getBoundingClientRect(); const k = W / (r.width || W); return { x: (evt.clientX - r.left) * k, y: (evt.clientY - r.top) * k, k }; };
    const notes = result.chords.flatMap((chord) => chord.notes.map((note) => ({ chord, note })));
    const refs = new Map();
    for (const { chord, note } of notes) {
      const written = chord.startIndex + chord.steps;
      if (editable && (written !== note.end || chord.startIndex !== note.start)) {
        el('rect', { x: x(chord.startIndex), y: y(note.midi), width: Math.max(3, x(written) - x(chord.startIndex)), height: ROW, fill: 'none', stroke: '#8a847a', 'stroke-dasharray': '3 2', 'stroke-width': 1, 'data-written': note.id });
      }
      const on = selected === note.id;
      const r = el('rect', { x: x(note.start), y: y(note.midi) + 1, width: Math.max(3, x(note.end) - x(note.start) - 1), height: ROW - 2, rx: 2, fill: on ? '#e0592b' : '#2d78ff', 'data-note': note.id, style: editable ? 'cursor:grab;touch-action:none' : '' });
      refs.set(note.id, { r, note, chord });
    }
    if (editable) {
      const handles = new Map();
      const drawHandles = (id) => {
        const ref = refs.get(id); if (!ref) return;
        const { note } = ref;
        const hr = { start: el('circle', { cx: x(note.start), cy: y(note.midi) + ROW / 2, r: 5, fill: '#fff', stroke: '#e0592b', 'stroke-width': 2, 'data-handle': 'start' }), end: el('circle', { cx: x(note.end), cy: y(note.midi) + ROW / 2, r: 5, fill: '#fff', stroke: '#e0592b', 'stroke-width': 2, 'data-handle': 'end' }) };
        for (const [mode, c] of Object.entries(hr)) {
          const hit = el('circle', { cx: c.getAttribute('cx'), cy: c.getAttribute('cy'), r: HANDLE_PX, fill: 'transparent', 'data-handle-hit': mode, style: 'cursor:ew-resize;touch-action:none' });
          handles.set(mode, { c, hit });
        }
      };
      if (selected !== null) drawHandles(selected);
      let drag = null;
      const geometry = (note, patch) => {
        const s = patch?.start ? Math.round(fToNumber(patch.start) / gridF) : note.start; const e = patch?.end ? Math.round(fToNumber(patch.end) / gridF) : note.end;
        return { s, e, m: patch?.midi ?? note.midi };
      };
      const showPreview = (patch) => {
        const ref = refs.get(drag.id); const g = geometry(ref.note, patch);
        ref.r.setAttribute('x', x(g.s)); ref.r.setAttribute('width', Math.max(3, x(g.e) - x(g.s) - 1)); ref.r.setAttribute('y', y(g.m) + 1);
        for (const [mode, { c, hit }] of handles) { const cx = mode === 'start' ? x(g.s) : x(g.e); for (const e of [c, hit]) { e.setAttribute('cx', cx); e.setAttribute('cy', y(g.m) + ROW / 2); } }
      };
      const begin = (evt, id, mode) => {
        const ref = refs.get(id); if (!ref) return;
        evt.preventDefault();
        const p = toPx(evt);
        if (selected !== id || !handles.size) { for (const { c, hit } of handles.values()) { c.remove(); hit.remove(); } handles.clear(); selected = id; drawHandles(id); }
        drag = { id, mode, x0: p.x, y0: p.y, pointer: evt.pointerId, moved: false, patch: null, fresh: true };
        try { svg.setPointerCapture(evt.pointerId); } catch { /* not every pointer can be captured */ }
        ref.r.setAttribute('fill', '#e0592b');
      };
      for (const [id, ref] of refs) {
        ref.r.addEventListener('pointermove', (evt) => {
          if (drag || evt.pointerType === 'touch') return;
          const r = ref.r.getBoundingClientRect(); const zone = noteZone(evt.clientX - r.left, r.width, EDGE_PX);
          ref.r.style.cursor = zone === 'body' ? 'grab' : 'ew-resize';
        });
        ref.r.addEventListener('pointerdown', (evt) => {
          const r = ref.r.getBoundingClientRect();
          // a mouse grabs an edge directly; a finger first selects the note (its handles appear), then drags the body
          const zone = evt.pointerType === 'mouse' ? noteZone(evt.clientX - r.left, r.width, EDGE_PX) : 'body';
          begin(evt, id, zone);
        });
      }
      for (const [mode, { hit }] of handles) hit.addEventListener('pointerdown', (evt) => begin(evt, selected, mode));
      svg.addEventListener('pointermove', (evt) => {
        if (!drag || evt.pointerId !== drag.pointer) return;
        const p = toPx(evt); const ref = refs.get(drag.id);
        const dSteps = Math.round((p.x - drag.x0) / stepW); const dPitch = Math.round(-(p.y - drag.y0) / ROW);
        if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) < 4 * p.k) return;
        drag.moved = true;
        drag.patch = dragPatch(ref.note, drag.mode, dSteps, dPitch, { grid: result.grid, total });
        showPreview(drag.patch);
        svg.parentElement?.setAttribute('data-dragging', '');
      });
      const finish = (evt, cancelled) => {
        if (!drag || evt.pointerId !== drag.pointer) return;
        const d = drag; drag = null; svg.parentElement?.removeAttribute('data-dragging');
        try { svg.releasePointerCapture(d.pointer); } catch { /* already released */ }
        if (!cancelled && d.patch) rec.editNote(d.id, d.patch); // redraws the window
        else if (!cancelled && !d.moved && d.mode === 'body') { draw(); } // a tap: the selection changed
        else draw();
      };
      svg.addEventListener('pointerup', (evt) => finish(evt, false));
      svg.addEventListener('pointercancel', (evt) => finish(evt, true));
      // a tap on the empty background clears the selection (a pan of the container does not)
      let bg = null;
      svg.addEventListener('pointerdown', (evt) => { bg = evt.target.closest?.('[data-note],[data-handle-hit]') ? null : { x: evt.clientX, y: evt.clientY }; });
      svg.addEventListener('pointerup', (evt) => { if (bg && Math.hypot(evt.clientX - bg.x, evt.clientY - bg.y) < 6 && selected !== null) { selected = null; draw(); } bg = null; });
      // a finger on a note or a handle must not scroll the page: `touch-action` is often ignored inside an SVG
      const stop = (evt) => { if (evt.target.closest?.('[data-note],[data-handle-hit]') || drag) evt.preventDefault(); };
      svg.addEventListener('touchstart', stop, { passive: false });
      svg.addEventListener('touchmove', stop, { passive: false });
    }
    const wrap = h('div', { style: `overflow:auto;max-height:300px;border-radius:6px;border:1px solid rgba(0,0,0,0.15)` }, svg);
    return wrap;
  }
  function rollZoom() {
    return h('span', { style: 'display:inline-flex;align-items:center;gap:var(--btn-gap,2px)', title: label('record.zoom') },
      h('span', { text: label('record.zoom') }),
      button('−', label('record.zoomOut'), () => { zoom = Math.max(1, zoom / 2); draw(); }, { action: 'record-zoom-out', disabled: zoom <= 1 }),
      h('span', { style: 'min-width:2.4em;text-align:center', text: `×${zoom}` }),
      button('+', label('record.zoomIn'), () => { zoom = Math.min(16, zoom * 2); draw(); }, { action: 'record-zoom-in', disabled: zoom >= 16 }));
  }

  async function chooseMidi() {
    midiNote = '';
    try {
      await midi.enable();
      midi.select(settings.midiDevice);
      store.set({ source: 'midi' });
      if (!midi.devices().length) midiNote = label('record.midiNone');
    } catch (e) { midiNote = e?.code === 'unsupported' ? label('record.midiUnsupported') : label('record.midiDenied'); }
    draw();
  }
  function midiDevices() {
    const list = midi.devices();
    if (!list.length) return [h('span', { style: 'color:var(--danger-ink,#c0392b)', text: label('record.midiNone') })];
    const pick = (id, name) => button(name, name, () => { midi.select(id); store.set({ midiDevice: id }); draw(); }, { action: `record-midi-${id}`, pressed: midi.selected() === id });
    return [...(list.length > 1 ? [pick('all', label('record.midiAll'))] : []), ...list.map((d) => pick(d.id, d.name))];
  }

  function draw() {
    if (!box || !rec) return;
    const s = rec.state; const busy = s === 'counting' || s === 'recording';
    const t = rec.target(); const staffName = app.doc.find(t.staffId) ? (app.doc.parentOf(t.staffId)?.props?.name ?? '') : '';
    const head = h('div', { style: 'display:flex;align-items:center;gap:var(--btn-gap,2px)' },
      h('strong', { style: 'flex:1', text: label('record.title', { name: staffName, from: t.fromMeasure + 1, to: t.toMeasure }) }),
      button('✕', label('record.close'), close, { action: 'record-close' }));
    const grids = h('span', { style: 'display:inline-flex;gap:var(--btn-gap,2px)', title: label('record.grid') }, ...GRID_LABELS.map(([g, text]) => button(text, `${label('record.grid')} ${text}`, () => { store.set({ grid: [...g] }); draw(); }, { action: `record-grid-${g[1]}`, pressed: settings.grid[0] === g[0] && settings.grid[1] === g[1], disabled: busy })));
    const settingsRow = h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px' },
      h('span', { text: label('record.grid') }), grids,
      h('span', { text: label('record.preroll') }), stepper('record-preroll', settings.prerollBeats, (v) => { store.set({ prerollBeats: v }); draw(); }, { min: 0, max: 8, fmt: (v) => String(v), unit: '' }),
      h('span', { text: label('record.latency') }), stepper('record-latency', store.get().offsetMs, (v) => { store.set({ offsetMs: v }); draw(); }, { min: -400, max: 400, step: 5, unit: ' ms', fmt: (v) => (v > 0 ? `+${v}` : String(v)) }),
      button(label('record.calibrate'), label('record.calibrateTitle'), startCalibration, { action: 'record-calibrate', disabled: busy || cal?.state === 'running' }),
      h('span', { text: label('record.durations') }), button(settings.legato ? label('record.legato') : label('record.played'), label('record.durationsTitle'), () => { store.set({ legato: !settings.legato }); draw(); }, { action: 'record-legato', pressed: !!settings.legato }),
      h('span', { text: label('record.click') }), stepper('record-click', Math.round(settings.clickVolume * 100), (v) => { store.set({ clickVolume: v / 100 }); draw(); }, { min: 5, max: 100, step: 10, unit: ' %' }));
    const sourceRow = h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)' }, h('span', { text: label('record.source') }),
      button(label('record.screen'), label('record.screen'), () => { store.set({ source: 'screen' }); draw(); }, { action: 'record-source-screen', pressed: settings.source === 'screen', disabled: busy }),
      midi ? button(label('record.midi'), label('record.midi'), chooseMidi, { action: 'record-source-midi', pressed: settings.source === 'midi', disabled: busy }) : null,
      ...(settings.source === 'midi' && midi?.enabled() ? midiDevices() : []),
      midiNote ? h('span', { style: 'color:var(--danger-ink,#c0392b)', 'data-record-midi-note': '', text: midiNote }) : null);
    const instruments = h('div', { style: 'display:flex;align-items:center;gap:var(--btn-gap,2px)' }, h('span', { text: label('record.play') }),
      button(label('record.piano'), label('record.piano'), () => { pianoDrawer.show('piano'); draw(); }, { action: 'record-piano', pressed: pianoDrawer.view() === 'piano' }),
      button(label('record.guitar'), label('record.guitar'), () => { pianoDrawer.show('guitar'); draw(); }, { action: 'record-guitar', pressed: pianoDrawer.view() === 'guitar' }));
    const calPanel = calibrationPanel(busy);
    statusEl = h('div', { 'data-record-status': '', style: 'font-size:18px;font-weight:var(--w-bold,700);min-height:1.6em', text: stateText() });
    const backRow = backingRow(busy);
    const parts = [head, settingsRow, sourceRow, ...(backRow ? [backRow] : []), ...(settings.source === 'screen' ? [instruments] : []), ...(calPanel ? [calPanel] : []), statusEl];
    if (message) parts.push(h('div', { style: 'color:var(--danger-ink,#c0392b)', 'data-record-message': '', text: message }));
    const controls = h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px)' });
    const rollParts = []; const estParts = []; // the piano roll and its notes / the offset estimate: drawn in the left column on a wide screen
    if (!busy && s !== 'review') controls.append(button('⏺ ' + label('record.start'), label('record.start'), startPressed, { action: 'record-start', primary: true, disabled: back.status === 'rendering' }));
    if (busy) controls.append(button('⏹ ' + label('record.stop'), label('record.stop'), () => { rec.stop(); }, { action: 'record-stop', primary: true }));
    if (s === 'review') {
      const quant = rec.quantized;
      const result = quant ? rec.result() : rec.raw();
      const count = result.chords.reduce((n, c) => n + c.notes.length, 0);
      if (count) { rollParts.push(rollZoom()); rollParts.push(roll(result)); }
      if (quant && count) rollParts.push(h('div', { style: 'color:var(--ink-faint,#7a7466);font-size:13px', 'data-record-edit-hint': '', text: label('record.editHint') }));
      if (!quant) rollParts.push(h('div', { style: 'color:var(--ink-faint,#7a7466)', 'data-record-raw': '', text: label('record.rawHint') }));
      const est = rec.estimate();
      if (est && count) {
        const ms = Math.round(est.seconds * 1000);
        estParts.push(h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)' },
          h('span', { 'data-record-estimate': '', text: label(ms >= 0 ? 'record.estimateLate' : 'record.estimateEarly', { ms: Math.abs(ms), percent: Math.round(est.confidence * 100) }) }),
          Math.abs(ms) >= 3 ? button(label('record.apply'), label('record.applyTitle'), () => { store.set({ offsetMs: store.get().offsetMs + ms }); draw(); }, { action: 'record-apply-offset' }) : null));
      }
      if (quant) {
        controls.append(
          button('↶', label('record.undoEdit'), () => { rec.undoEdit(); }, { action: 'record-undo-edit', disabled: !rec.canUndoEdit() }),
          button('↷', label('record.redoEdit'), () => { rec.redoEdit(); }, { action: 'record-redo-edit', disabled: !rec.canRedoEdit() }));
      }
      if (selected !== null && quant) {
        const chord = result.chords.find((c) => c.notes.some((n) => n.id === selected)); const note = chord?.notes.find((n) => n.id === selected);
        if (note) controls.append(button('🗑 ' + label('record.deleteNote'), label('record.deleteNote'), () => { selected = null; rec.deleteNote(chord, note); }, { action: 'record-delete-note' }));
      }
      controls.append(
        quant
          ? button(label('record.unquantize'), label('record.unquantizeTitle'), () => { selected = null; rec.unquantize(); draw(); }, { action: 'record-unquantize' })
          : button(label('record.quantize', { grid: GRID_LABELS.find(([g]) => g[0] === settings.grid[0] && g[1] === settings.grid[1])?.[1] ?? '' }), label('record.quantizeTitle'), () => { selected = null; rec.quantize(); draw(); }, { action: 'record-quantize', primary: true, disabled: !count }),
        button(label('record.paste'), label('record.pasteTitle'), paste, { action: 'record-paste', primary: quant, disabled: !count || !quant }),
        button(label('record.again'), label('record.again'), () => { selected = null; message = ''; rec.discard(); rec.open(); draw(); }, { action: 'record-again' }),
        button(label('record.restore'), label('record.restore'), () => { rec.restoreNotes(); selected = null; draw(); }, { action: 'record-restore' }));
    }
    layout(parts, rollParts, estParts, controls, head);
    frameDock();
    if (busy && !raf) raf = requestAnimationFrame(frame);
  }

  /**
   * Wide screen with a mouse (a PC): two columns — the piano roll on the left (all the height there is), on the right the title, the settings (they scroll)
   * and, always in view, the buttons. Tablet, phone and narrow windows keep the single column.
   */
  const WIDE_QUERY = '(min-width: 900px) and (hover: hover) and (pointer: fine)';
  const isWide = () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
  const RIGHT_W = 340; const BOX_MAX = 1100; const GAP = 14; const PAD_X = 12;
  let wideNow = null; let lastW = 0;
  const onResize = () => { if (!box || !rec) return; if (isWide() !== wideNow || (wideNow && window.innerWidth !== lastW)) draw(); lastW = window.innerWidth; };
  function layout(parts, rollParts, estParts, controls, head) {
    const wide = isWide(); wideNow = wide;
    if (!wide) {
      rollAvail = null;
      box.style.cssText = SINGLE_STYLE;
      box.replaceChildren(...parts, ...rollParts, ...estParts, controls);
      return;
    }
    const boxW = Math.min(BOX_MAX, window.innerWidth - 16);
    rollAvail = Math.max(280, boxW - 2 * PAD_X - RIGHT_W - GAP);
    box.style.cssText = `${SINGLE_STYLE};width:${boxW}px;flex-direction:row;align-items:stretch;overflow:hidden;gap:${GAP}px`;
    const col = (css, ...kids) => h('div', { style: `min-height:0;box-sizing:border-box;${css}` }, ...kids);
    const left = col('flex:1 1 0;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:10px', ...(rollParts.length ? rollParts : [h('div', { 'data-record-roll-empty': '', style: 'color:var(--ink-faint,#7a7466);padding:12px', text: label('record.rollEmpty') })]));
    const body = col('flex:1 1 auto;overflow:auto;display:flex;flex-direction:column;gap:10px', ...parts.filter((x) => x !== head), ...estParts);
    const right = col(`flex:0 0 ${RIGHT_W}px;width:${RIGHT_W}px;display:flex;flex-direction:column;gap:10px`, head, body, controls);
    box.replaceChildren(left, right);
  }

  /** Keeps the keys on the fast engine while the pre-rendered backing is in use (and back on the chosen one otherwise). */
  function syncLive() { backing?.setLive(box && backingOn() && back.status !== 'error' ? backing.engine() : null); }
  async function renderBackingNow() {
    if (!backingOn() || !rec) return;
    back.ctl?.abort();
    const ctl = new AbortController(); back = { ...back, status: 'rendering', progress: 0, ctl, error: '' };
    syncLive(); draw();
    try {
      const data = await backing.prepare({ target: rec.target(), signal: ctl.signal, onProgress: (p) => { if (back.ctl === ctl) { back.progress = p; const el = box?.querySelector('[data-record-backing-status]'); if (el) el.textContent = backingText(); } } });
      if (back.ctl !== ctl) return;
      back = { status: 'ready', progress: 1, data, stale: false, ctl: null, error: '' };
    } catch (e) {
      if (e?.code === 'aborted' || back.ctl !== ctl) return;
      back = { status: 'error', progress: 0, data: null, stale: true, ctl: null, error: String(e?.message ?? e) };
    }
    syncLive(); draw();
  }
  const backingText = () => (back.status === 'rendering' ? label('record.backingRendering', { percent: Math.round(back.progress * 100) })
    : back.status === 'ready' ? label(back.stale ? 'record.backingStale' : 'record.backingReady', { seconds: Math.round(back.data.buffer.left.length / back.data.buffer.sampleRate) })
      : back.status === 'error' ? label('record.backingError', { message: back.error }) : '');
  function backingRow(busy) {
    if (!backing?.available()) return null;
    return h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--btn-gap,2px)' }, h('span', { text: label('record.backing') }),
      button(label('record.backingOn'), label('record.backingTitle'), () => { store.set({ backing: !settings.backing }); if (settings.backing) { back.stale = true; renderBackingNow(); } else { back.ctl?.abort(); back = { ...back, status: 'idle', ctl: null }; syncLive(); draw(); } }, { action: 'record-backing', pressed: !!settings.backing, disabled: busy }),
      settings.backing ? h('span', { 'data-record-backing-status': '', style: `color:${back.status === 'error' ? 'var(--danger-ink,#c0392b)' : 'var(--ink-faint,#7a7466)'}`, text: backingText() }) : null);
  }
  /** Start pressed: with a pre-rendered backing, make sure it is ready and still matches the score, then go. */
  async function startPressed() {
    if (backingOn() && back.status !== 'error' && (back.stale || back.status !== 'ready')) { await renderBackingNow(); if (!rec) return; }
    start();
  }

  /** The calibration block: the instructions and the beat while it runs, the measured offset (with its spread) when it is done; null when idle. */
  function calibrationPanel(busy) {
    if (!cal || cal.state === 'idle') return null;
    const box2 = (...kids) => h('div', { 'data-record-calibration': cal.state, style: 'display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid var(--edge,rgba(0,0,0,0.25));border-radius:8px;background:var(--soft,rgba(0,0,0,0.04))' }, ...kids);
    if (cal.state === 'running') {
      return box2(h('div', { style: 'font-weight:var(--w-bold,700)', text: label('record.calibrating') }), h('div', { 'data-record-calibration-taps': '', text: label('record.calibrationTaps', { n: cal.tapCount() }) }),
        h('div', { style: 'display:flex;gap:var(--btn-gap,2px)' }, button(label('record.calibrationCancel'), label('record.calibrationCancel'), () => { cal.cancel(); draw(); }, { action: 'record-calibration-cancel' })));
    }
    const r = cal.result();
    const line = r.verdict === 'tooFew' ? label('record.calibrationTooFew', { n: r.count })
      : r.verdict === 'unsteady' ? label('record.calibrationUnsteady', { spread: r.spreadMs })
        : label(r.offsetMs >= 0 ? 'record.calibrationLate' : 'record.calibrationEarly', { ms: Math.abs(r.offsetMs), spread: r.spreadMs, n: r.count });
    const usable = r.verdict === 'ok' || r.verdict === 'rough';
    return box2(h('div', { 'data-record-calibration-result': r.verdict, style: 'font-weight:var(--w-bold,700)', text: line }),
      r.verdict === 'rough' ? h('div', { style: 'color:var(--warn-ink,#a86400)', text: label('record.calibrationRough') }) : null,
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--btn-gap,2px)' },
        usable ? button(label('record.calibrationApply', { ms: r.offsetMs }), label('record.calibrationApply', { ms: r.offsetMs }), () => { store.set({ offsetMs: r.offsetMs }); cal.cancel(); draw(); }, { action: 'record-calibration-apply', primary: true }) : null,
        button(label('record.calibrationAgain'), label('record.calibrationAgain'), startCalibration, { action: 'record-calibration-again' }),
        button(label('record.calibrationClose'), label('record.calibrationClose'), () => { cal.cancel(); draw(); }, { action: 'record-calibration-close' })));
  }
  function startCalibration() {
    message = '';
    cal ??= createCalibrator({ getEngine, clickVolume: () => settings.clickVolume });
    cal.cancel();
    try { cal.start(); } catch (e) { message = e?.message === 'noMetronome' ? label('record.noEngine') : String(e?.message ?? e); }
    draw();
  }

  function start() {
    message = ''; selected = null;
    try { rec.start(); } catch (e) { message = e?.message === 'noMetronome' ? label('record.noEngine') : String(e?.message ?? e); draw(); }
  }
  function paste() {
    try {
      const r = rec.commit();
      onMessage(label('record.done', { notes: r.placed }));
      close();
    } catch (e) { message = String(e?.message ?? e); draw(); }
  }
  function close() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    pianoDrawer.setRecorder(null);
    window.removeEventListener('resize', onResize);
    stopDock?.(); stopDock = null; stopMidi?.(); stopMidi = null; midiNote = '';
    back.ctl?.abort(); back = { status: 'idle', progress: 0, data: null, stale: true, ctl: null, error: '' }; stopDocWatch?.(); stopDocWatch = null; backing?.setLive(null);
    rec?.destroy(); rec = null; cal?.destroy(); cal = null;
    box?.remove(); box = null; selected = null; message = '';
  }

  return {
    /** Opens the window on the selected range; returns false (with a message) when there is nothing to record on. */
    open() {
      if (box) return true;
      if (app.noteEntry().active) app.setNoteEntry({ active: false });
      rec = createRecorder({ app, getEngine: () => (backingOn() && back.status === 'ready' ? backing.engine() : getEngine()), backing: () => (backingOn() && back.status === 'ready' && !back.stale ? { buffer: back.data.buffer, lead: back.data.lead } : null), settings: store, viewId });
      if (!rec.open()) { rec.destroy(); rec = null; onMessage(label('record.nothing')); return false; }
      box = h('div', { 'data-record-window': '', 'data-zoom-lock': '', 'data-dismiss-keep': '', role: 'dialog', 'aria-label': label('record.open') });
      document.body.append(box);
      const wanted = (p) => (p.source ?? 'screen') === settings.source; // only the source chosen in the window is recorded
      if (!cal) { cal = createCalibrator({ getEngine, clickVolume: () => settings.clickVolume }); cal.onChange(() => draw()); }
      pianoDrawer.setRecorder({ press: (p) => { if (wanted(p)) { rec?.press(p); cal?.press(p); } }, release: (p) => { if (wanted(p)) rec?.release(p); } });
      stopMidi = midi?.onChange(() => draw()) ?? null;
      window.addEventListener('resize', onResize);
      if (settings.source === 'midi' && midi && !midi.enabled()) settings = { ...settings, source: 'screen' }; // the permission is asked by a tap on the MIDI button
      if (pianoDrawer.view() !== 'piano' && pianoDrawer.view() !== 'guitar') pianoDrawer.show('piano'); else pianoDrawer.show(pianoDrawer.view());
      rec.onState(() => draw());
      back = { status: 'idle', progress: 0, data: null, stale: true, ctl: null, error: '' };
      stopDocWatch = app.doc.subscribe?.(() => { back.stale = true; }) ?? null;
      const ro = typeof ResizeObserver === 'function' && dock?.el ? new ResizeObserver(frameDock) : null; ro?.observe(dock.el); stopDock = () => ro?.disconnect();
      draw();
      if (backingOn()) renderBackingNow();
      return true;
    },
    close,
    isOpen: () => !!box,
    destroy: close,
  };
}
