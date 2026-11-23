/*
 * The processing window of ONE track (opened from the mixer): the MIDI dynamics, a transfer curve (input velocity → output velocity) with a handle at each
 * end and one at the middle that bends it from concave to convex (audio/velocity.js `cleanDynamics`), then the equalizer (audio/eq.js: a response curve with a handle per band) and the compressor of the sound (audio/compressor.js), in the order the sound goes through them. It floats (no veil: the music keeps playing and the change is heard at the next note); a change is written when the handle is released (one undo step).
 */
import { cleanDynamics, dynamicsOutput, bendForMidOutput, IDENTITY_DYNAMICS } from '../audio/velocity.js';
import { COMPRESSOR_DEFAULTS, COMPRESSOR_RANGES, cleanCompressor, knobToValue, valueToKnob } from '../audio/compressor.js';
import { EQ_DEFAULTS, EQ_RANGES, cleanEq, eqResponseDb, logValue, logPosition } from '../audio/eq.js';
import { LESLIE_MODES, LESLIE_DEFAULTS, LESLIE_RANGES, cleanLeslie, leslieSettings } from '../audio/leslie.js';
import { instrumentInfo } from '../model/instruments.js';
import { isDrumTrack } from '../model/player.js';
import { getProperty } from '../model/props.js';
import { PID } from '../model/pid.js';
import { createSwitch } from './switch.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 240; const PAD = 28; const W = SIZE - 2 * PAD; // the graph: input 1…127 across, output 1…127 up
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let current = null; // the window that is open (one at a time)
/** Radius (in the units of an SVG that is `width` units wide and shown `shownPx` pixels wide) of the invisible disc that catches a finger on a handle: half of the button size of the device. */
const hitRadius = (shownPx, width) => {
  const target = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-target')) || 36;
  return Math.max(12, (target / 2 + 2) * (shownPx > 0 ? width / shownPx : 1));
};
let unavailable = false; // the engine said the compressor worklet could not start (kept for the next windows)

export function openTrackFx({ app, label, trackId }) {
  if (current?.trackId === trackId) { current.close(); return { close() {} }; } // the same button again closes the window
  current?.close();
  const trackName = () => app.mixerState().tracks.find((t) => t.id === trackId)?.name ?? '';
  let dyn = { ...IDENTITY_DYNAMICS, ...(app.trackDynamics(trackId) ?? {}) };
  let dragging = false;

  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
  const gx = (x) => PAD + ((x - 1) / 126) * W;
  const gy = (y) => PAD + W - ((y - 1) / 126) * W;

  const box = el('div', 'position:fixed;right:12px;bottom:12px;z-index:3400;background:var(--paper,#faf8f4);color:var(--ink,#111);border:1px solid var(--edge,#bbb);border-radius:10px;padding:10px 12px;box-shadow:0 4px 20px rgba(0,0,0,.35);font:14px var(--ui-font,sans-serif);box-sizing:border-box;width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:auto;display:flex;flex-direction:column;gap:8px', { 'data-track-fx': trackId, role: 'dialog' });
  const close = () => { window.removeEventListener('keydown', onKey, true); window.visualViewport?.removeEventListener('resize', fitHeight); window.removeEventListener('resize', fitHeight); window.removeEventListener('scorsaire:comp-reduction', onReduction); window.removeEventListener('scorsaire:comp-limit', onLimit); window.removeEventListener('scorsaire:comp-unavailable', onDown); off(); box.remove(); if (current?.box === box) current = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  // the visible part of the screen (a browser bar that shows or hides, the keyboard): the window never grows taller than it, so its top is never hidden behind the browser
  const fitHeight = () => { const h = window.visualViewport?.height ?? window.innerHeight; box.style.maxHeight = `${Math.max(220, Math.round(h) - 24)}px`; };
  window.visualViewport?.addEventListener('resize', fitHeight); window.addEventListener('resize', fitHeight);
  const off = app.doc.subscribe(() => { if (dragging) return; dyn = { ...IDENTITY_DYNAMICS, ...(app.trackDynamics(trackId) ?? {}) }; comp = { ...COMPRESSOR_DEFAULTS, ...(app.trackCompressor(trackId) ?? {}) }; eq = { ...EQ_DEFAULTS, ...(app.trackEq(trackId) ?? {}) }; les = leslieSettings(app.trackLeslie(trackId)); syncLeslie(); sync(); drawEq(); drawGraph(); head.textContent = `${label('trackFx.title')} · ${trackName()}`; });

  const head = el('div', 'flex:1;font-weight:var(--w-semi,600);font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
  head.textContent = `${label('trackFx.title')} · ${trackName()}`;
  const closeBtn = el('button', 'min-width:var(--ui-target,36px);min-height:var(--ui-target,36px);border-radius:6px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:inherit;font-size:16px', { type: 'button', 'aria-label': label('trackFx.close'), title: label('trackFx.close'), 'data-trackfx-close': '' });
  closeBtn.textContent = '✕'; closeBtn.addEventListener('click', close);
  // the title bar with ✕ stays at the top of the window while it scrolls: it can always be reached and closed
  const top = el('div', 'display:flex;align-items:center;gap:6px;position:sticky;top:-10px;z-index:3;background:var(--paper,#faf8f4);margin:-10px -12px 0;padding:10px 12px 6px;border-radius:10px 10px 0 0'); top.append(head, closeBtn);

  const title = el('div', 'font-weight:var(--w-semi,600)'); title.textContent = label('trackFx.midi');
  const hint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); hint.textContent = label('trackFx.midiHint');

  const svg = sv('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: '100%', 'data-trackfx-graph': '' });
  svg.style.cssText = 'touch-action:none;max-width:300px;align-self:center;user-select:none;-webkit-user-select:none';
  const readout = el('div', 'font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink-soft,#555);text-align:center', { 'data-trackfx-readout': '', role: 'status' });
  const bendRow = el('label', 'display:flex;align-items:center;gap:8px;font-size:13px');
  const bendName = el('span', 'flex:none'); bendName.textContent = label('trackFx.bend');
  const slider = el('input', 'flex:1;min-width:0;height:var(--ui-target,36px)', { type: 'range', min: '-100', max: '100', step: '1', 'data-trackfx-bend': '' });
  const ends = el('span', 'display:flex;justify-content:space-between;flex:none;width:100%');
  bendRow.append(bendName, slider);
  const scale = el('div', 'display:flex;justify-content:space-between;font-size:11px;color:var(--ink-faint,#777);margin-top:-4px');
  const sc1 = el('span'); sc1.textContent = label('trackFx.concave'); const sc2 = el('span'); sc2.textContent = label('trackFx.convex'); scale.append(sc1, sc2);
  const reset = el('button', 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:inherit;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);align-self:flex-start', { type: 'button', 'data-trackfx-reset': '' });
  reset.textContent = label('trackFx.reset');

  const commit = () => { try { app.setTrackDynamics(trackId, dyn); } catch { /* a refused value leaves the track as it was */ } };
  const setDyn = (patch) => { dyn = { ...dyn, ...patch }; const c = cleanDynamics(dyn); dyn = c ?? { ...IDENTITY_DYNAMICS }; };

  function drawGraph() {
    svg.replaceChildren();
    const line = (x1, y1, x2, y2, extra = {}) => svg.append(sv('line', { x1, y1, x2, y2, stroke: 'var(--edge,#999)', 'stroke-width': 1, ...extra }));
    svg.append(sv('rect', { x: PAD, y: PAD, width: W, height: W, fill: 'var(--field,#fff)', stroke: 'var(--edge,#888)', 'stroke-width': 1 }));
    for (const v of [32, 64, 96]) { line(gx(v), PAD, gx(v), PAD + W, { 'stroke-dasharray': '2 3', opacity: 0.5 }); line(PAD, gy(v), PAD + W, gy(v), { 'stroke-dasharray': '2 3', opacity: 0.5 }); }
    line(gx(1), gy(1), gx(127), gy(127), { 'stroke-dasharray': '4 4', opacity: 0.7 }); // the straight line, for reference
    const pts = []; for (let v = 1; v <= 127; v += 2) pts.push(`${gx(v).toFixed(1)},${gy(dynamicsOutput(dyn, v)).toFixed(1)}`); pts.push(`${gx(127).toFixed(1)},${gy(dynamicsOutput(dyn, 127)).toFixed(1)}`);
    // the curve runs flat before the first handle and after the last one
    svg.append(sv('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--ink,#111)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    const axis = (x, y, text, anchor = 'middle') => { const t = sv('text', { x, y, 'text-anchor': anchor, 'font-size': 10, fill: 'var(--ink-soft,#555)' }); t.textContent = text; svg.append(t); };
    axis(PAD + W / 2, SIZE - 6, label('trackFx.input')); axis(8, PAD + W / 2, label('trackFx.output'));
    svg.lastChild.setAttribute('transform', `rotate(-90 8 ${PAD + W / 2})`);
    const handle = (name, x, y) => {
      const g = sv('g', { 'data-trackfx-handle': name, style: 'cursor:grab' });
      g.append(sv('circle', { cx: x, cy: y, r: hitRadius(svg.getBoundingClientRect().width, SIZE), fill: 'transparent' }), sv('circle', { cx: x, cy: y, r: 8, fill: 'var(--sel-edge,#2d78ff)', stroke: 'var(--paper,#fff)', 'stroke-width': 2 }));
      svg.append(g); return g;
    };
    handle('a', gx(dyn.x0), gy(dyn.y0)); handle('b', gx(dyn.x1), gy(dyn.y1));
    const mx = (dyn.x0 + dyn.x1) / 2;
    handle('bend', gx(mx), gy(dynamicsOutput(dyn, mx)));
    readout.textContent = label('trackFx.readout', { x0: dyn.x0, y0: dyn.y0, x1: dyn.x1, y1: dyn.y1, bend: (dyn.bend > 0 ? '+' : '') + dyn.bend.toFixed(2) });
    if (document.activeElement !== slider) slider.value = String(Math.round(dyn.bend * 100));
    reset.disabled = !cleanDynamics(dyn);
  }

  // dragging a handle: the value under the finger, live; one write when it is released
  let grab = null;
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest?.('[data-trackfx-handle]'); if (!g) return;
    grab = g.getAttribute('data-trackfx-handle'); dragging = true; svg.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!grab) return;
    const r = svg.getBoundingClientRect(); const k = SIZE / r.width;
    const x = clamp(Math.round(1 + ((e.clientX - r.left) * k - PAD) / W * 126), 1, 127);
    const y = clamp(Math.round(1 + (PAD + W - (e.clientY - r.top) * k) / W * 126), 1, 127);
    if (grab === 'a') setDyn({ x0: Math.min(x, dyn.x1 - 1), y0: y });
    else if (grab === 'b') setDyn({ x1: Math.max(x, dyn.x0 + 1), y1: y });
    else setDyn({ bend: bendForMidOutput(dyn, y) });
    drawGraph();
  });
  const release = () => { if (!grab) return; grab = null; dragging = false; commit(); drawGraph(); };
  svg.addEventListener('pointerup', release); svg.addEventListener('pointercancel', release);
  slider.addEventListener('input', () => { dragging = true; setDyn({ bend: Number(slider.value) / 100 }); drawGraph(); });
  slider.addEventListener('change', () => { dragging = false; commit(); drawGraph(); });
  slider.addEventListener('dblclick', () => { slider.value = '0'; dragging = false; setDyn({ bend: 0 }); commit(); drawGraph(); });
  reset.addEventListener('click', () => { dyn = { ...IDENTITY_DYNAMICS }; commit(); drawGraph(); });

  // ── the equalizer: the response curve (20 Hz … 20 kHz, ±18 dB) with one handle per band (the frequency across, the gain up); the high-pass and the width (Q) of the bells are sliders
  let eq = { ...EQ_DEFAULTS, ...(app.trackEq(trackId) ?? {}) };
  const eqTitle = el('div', 'font-weight:var(--w-semi,600);margin-top:6px;padding-top:8px;border-top:1px solid var(--edge,#bbb)'); eqTitle.textContent = label('trackFx.eq');
  const eqHint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); eqHint.textContent = label('trackFx.eqHint');
  const saveEq = () => { try { app.setTrackEq(trackId, eq); } catch { /* a refused value leaves the track as it was */ } };
  const EW = 300; const EH = 150; const EP = 22; const EIW = EW - 2 * EP; const EIH = EH - 2 * EP; const DB = 18;
  const ex = (hz) => EP + logPosition(hz, 20, 20000) * EIW;
  const ey = (db) => EP + EIH / 2 - (clamp(db, -DB, DB) / DB) * (EIH / 2);
  const eqSvg = sv('svg', { viewBox: `0 0 ${EW} ${EH}`, width: '100%', 'data-trackfx-eq-graph': '' });
  eqSvg.style.cssText = 'touch-action:none;max-width:340px;align-self:center;user-select:none;-webkit-user-select:none';
  const BANDS = [['low', 'lowF', 'lowG', 'trackFx.e.low'], ['m1', 'm1F', 'm1G', 'trackFx.e.m1'], ['m2', 'm2F', 'm2G', 'trackFx.e.m2'], ['high', 'highF', 'highG', 'trackFx.e.high']];
  const eqInfo = el('div', 'font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink-soft,#555);text-align:center;min-height:1.3em', { 'data-trackfx-eq-info': '', role: 'status' });
  const hzText = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);
  const dbText = (g) => `${g > 0 ? '+' : ''}${g} dB`;
  function drawEq() {
    eqSvg.replaceChildren();
    const ln = (x1, y1, x2, y2, extra = {}) => eqSvg.append(sv('line', { x1, y1, x2, y2, stroke: 'var(--edge,#999)', 'stroke-width': 1, ...extra }));
    eqSvg.append(sv('rect', { x: EP, y: EP, width: EIW, height: EIH, fill: 'var(--field,#fff)', stroke: 'var(--edge,#888)', 'stroke-width': 1 }));
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) ln(ex(hz), EP, ex(hz), EP + EIH, { 'stroke-dasharray': '2 3', opacity: 0.45 });
    for (const db of [-12, -6, 6, 12]) ln(EP, ey(db), EP + EIW, ey(db), { 'stroke-dasharray': '2 3', opacity: 0.45 });
    ln(EP, ey(0), EP + EIW, ey(0), { opacity: 0.8 });
    const txt = (x, y, t, anchor = 'middle') => { const e = sv('text', { x, y, 'text-anchor': anchor, 'font-size': 9, fill: 'var(--ink-soft,#555)' }); e.textContent = t; eqSvg.append(e); };
    for (const [hz, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) txt(ex(hz), EH - 6, t);
    txt(EP - 3, ey(12) + 3, '+12', 'end'); txt(EP - 3, ey(0) + 3, '0', 'end'); txt(EP - 3, ey(-12) + 3, '−12', 'end');
    const pts = []; for (let i = 0; i <= 120; i++) { const hz = logValue(i / 120, 20, 20000); pts.push(`${ex(hz).toFixed(1)},${ey(eqResponseDb(eq, hz)).toFixed(1)}`); }
    eqSvg.append(sv('polyline', { points: pts.join(' '), fill: 'none', stroke: eq.on ? 'var(--ink,#111)' : 'var(--ink-faint,#888)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', ...(eq.on ? {} : { 'stroke-dasharray': '5 4' }) }));
    for (const [band, fk, gk] of BANDS) {
      const g = sv('g', { 'data-trackfx-eq-handle': band, style: 'cursor:grab' });
      g.append(sv('circle', { cx: ex(eq[fk]), cy: ey(eq[gk]), r: hitRadius(eqSvg.getBoundingClientRect().width, EW), fill: 'transparent' }), sv('circle', { cx: ex(eq[fk]), cy: ey(eq[gk]), r: 7, fill: 'var(--sel-edge,#2d78ff)', stroke: 'var(--paper,#fff)', 'stroke-width': 2 }));
      eqSvg.append(g);
    }
    for (const r of Object.values(eqRows)) r.set();
    eqOn.checked = eq.on;
  }
  let eqGrab = null;
  eqSvg.addEventListener('pointerdown', (e) => { const g = e.target.closest?.('[data-trackfx-eq-handle]'); if (!g) return; eqGrab = BANDS.find((b) => b[0] === g.getAttribute('data-trackfx-eq-handle')); dragging = true; eqSvg.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  eqSvg.addEventListener('pointermove', (e) => {
    if (!eqGrab) return;
    const r = eqSvg.getBoundingClientRect(); const k = EW / r.width;
    const [, fk, gk, nameKey] = eqGrab;
    const [lo, hi] = EQ_RANGES[fk]; const [glo, ghi] = EQ_RANGES[gk];
    const hz = clamp(Math.round(logValue(((e.clientX - r.left) * k - EP) / EIW, 20, 20000)), lo, hi);
    const db = clamp(Math.round((((EP + EIH / 2 - (e.clientY - r.top) * k) / (EIH / 2)) * DB) * 2) / 2, glo, ghi);
    eq = { ...eq, [fk]: hz, [gk]: db };
    eqInfo.textContent = `${label(nameKey)} · ${hzText(hz)} · ${dbText(db)}`;
    drawEq();
  });
  const eqRelease = () => { if (!eqGrab) return; eqGrab = null; dragging = false; eq = cleanEq(eq) ?? { ...EQ_DEFAULTS, on: eq.on }; saveEq(); drawEq(); };
  eqSvg.addEventListener('pointerup', eqRelease); eqSvg.addEventListener('pointercancel', eqRelease);
  const eqOn = createSwitch({ checked: eq.on, text: label('trackFx.compOn'), attrs: { 'data-trackfx-eq-on': '' }, onchange: () => { eq = { ...eq, on: eqOn.checked }; saveEq(); drawEq(); } });
  eqOn.style.cssText = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;align-self:flex-start';
  const eqRows = {};
  const eqRow = (key, nameKey, format) => {
    const [lo, hi] = EQ_RANGES[key];
    const name = el('span', 'flex:none;width:5.2em'); name.textContent = label(nameKey);
    const input = el('input', 'flex:1;min-width:0;height:var(--ui-target,36px)', { type: 'range', min: '0', max: '1000', step: '1', 'data-trackfx-eq': key });
    const value = el('span', 'flex:none;width:5.6em;text-align:right;font-variant-numeric:tabular-nums;font-size:12px');
    const read = () => Math.round(logValue(Number(input.value) / 1000, lo, hi) * 10) / 10;
    input.addEventListener('input', () => { dragging = true; eq = { ...eq, [key]: read() }; value.textContent = format(eq[key]); drawEqCurveOnly(); });
    input.addEventListener('change', () => { dragging = false; eq = cleanEq(eq) ?? { ...EQ_DEFAULTS, on: eq.on }; saveEq(); drawEq(); });
    input.addEventListener('dblclick', () => { eq = { ...eq, [key]: EQ_DEFAULTS[key] }; saveEq(); drawEq(); });
    const row = el('label', 'display:flex;align-items:center;gap:6px;font-size:13px'); row.append(name, input, value);
    eqRows[key] = { set: () => { input.value = String(Math.round(logPosition(eq[key], lo, hi) * 1000)); value.textContent = format(eq[key]); } };
    return row;
  };
  const drawEqCurveOnly = () => { const line = eqSvg.querySelector('polyline'); if (!line) return; const pts = []; for (let i = 0; i <= 120; i++) { const hz = logValue(i / 120, 20, 20000); pts.push(`${ex(hz).toFixed(1)},${ey(eqResponseDb(eq, hz)).toFixed(1)}`); } line.setAttribute('points', pts.join(' ')); };
  const eqRowsEls = [eqRow('hp', 'trackFx.e.hp', (v) => (v <= EQ_RANGES.hp[0] ? label('trackFx.e.off') : hzText(v))), eqRow('m1Q', 'trackFx.e.m1Q', (v) => `Q ${v}`), eqRow('m2Q', 'trackFx.e.m2Q', (v) => `Q ${v}`)];
  const eqReset = el('button', 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:inherit;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);align-self:flex-start', { type: 'button', 'data-trackfx-eq-reset': '' });
  eqReset.textContent = label('trackFx.compReset');
  eqReset.addEventListener('click', () => { eq = { ...EQ_DEFAULTS, on: eq.on }; saveEq(); drawEq(); });
  drawEq();

  // ── the compressor: one row per setting (a slider and its value); attack and release use the knob law of audio/compressor.js (half of the travel = the first quarter)
  let comp = { ...COMPRESSOR_DEFAULTS, ...(app.trackCompressor(trackId) ?? {}) };
  const compTitle = el('div', 'font-weight:var(--w-semi,600);margin-top:6px;padding-top:8px;border-top:1px solid var(--edge,#bbb)'); compTitle.textContent = label('trackFx.comp');
  const compHint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); compHint.textContent = label('trackFx.compHint');
  const saveComp = () => { try { app.setTrackCompressor(trackId, comp); } catch { /* a refused value leaves the track as it was */ } };
  const onSwitch = createSwitch({ checked: comp.on, text: label('trackFx.compOn'), attrs: { 'data-trackfx-comp-on': '' }, onchange: () => { comp = { ...comp, on: onSwitch.checked }; saveComp(); } });
  onSwitch.style.cssText = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;align-self:flex-start';
  const fmt = {
    threshold: (v) => `${v} dB`, ratio: (v) => `${v.toFixed(1)} : 1`, knee: (v) => `${v} dB`, makeup: (v) => `+${v} dB`, mix: (v) => `${v} %`,
    attack: (v) => (v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`), release: (v) => `${Math.round(v)} ms`,
  };
  const knob = new Set(['attack', 'release']);
  const rows = {};
  const compRow = (key, step) => {
    const [lo, hi] = COMPRESSOR_RANGES[key];
    const name = el('span', 'flex:none;width:5.2em'); name.textContent = label(`trackFx.c.${key}`);
    const input = el('input', 'flex:1;min-width:0;height:var(--ui-target,36px)', knob.has(key)
      ? { type: 'range', min: '0', max: '1000', step: '1', 'data-trackfx-comp': key }
      : { type: 'range', min: String(lo), max: String(hi), step: String(step), 'data-trackfx-comp': key });
    const value = el('span', 'flex:none;width:5.6em;text-align:right;font-variant-numeric:tabular-nums;font-size:12px');
    const read = () => (knob.has(key) ? knobToValue(Number(input.value) / 1000, lo, hi) : Number(input.value));
    const show = () => { value.textContent = fmt[key](knob.has(key) ? Math.round(read() * 10) / 10 : read()); };
    input.addEventListener('input', () => { comp = { ...comp, [key]: Math.round(read() * 100) / 100 }; show(); });
    input.addEventListener('change', () => { comp = { ...(cleanCompressor({ ...comp, on: comp.on }) ?? { ...COMPRESSOR_DEFAULTS, on: comp.on }) }; saveComp(); });
    input.addEventListener('dblclick', () => { comp = { ...comp, [key]: COMPRESSOR_DEFAULTS[key] }; sync(); saveComp(); });
    const row = el('label', 'display:flex;align-items:center;gap:6px;font-size:13px'); row.append(name, input, value);
    rows[key] = { input, show, set: () => { input.value = String(knob.has(key) ? Math.round(valueToKnob(comp[key], lo, hi) * 1000) : comp[key]); show(); } };
    return row;
  };
  const detector = createSwitch({ checked: comp.detector === 'rms', text: label('trackFx.compRms'), attrs: { 'data-trackfx-comp-rms': '', title: label('trackFx.compRmsHint') }, onchange: () => { comp = { ...comp, detector: detector.checked ? 'rms' : 'peak' }; saveComp(); } });
  detector.style.cssText = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px';
  const compButtons = el('div', 'display:flex;gap:var(--btn-gap,4px);flex-wrap:wrap'); compButtons.append(onSwitch, detector);
  const compRows = [compRow('threshold', 0.5), compRow('ratio', 0.1), compRow('knee', 0.5), compRow('attack'), compRow('release'), compRow('makeup', 0.5), compRow('mix', 1)];
  function sync() { onSwitch.checked = comp.on; detector.checked = comp.detector === 'rms'; for (const r of Object.values(rows)) r.set(); }
  sync();
  const compReset = el('button', 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;border:1px solid var(--edge,#bbb);background:var(--field,#fff);color:inherit;font:var(--w-semi,600) 14px var(--ui-font,sans-serif);align-self:flex-start', { type: 'button', 'data-trackfx-comp-reset': '' });
  compReset.textContent = label('trackFx.compReset');
  compReset.addEventListener('click', () => { comp = { ...COMPRESSOR_DEFAULTS }; sync(); saveComp(); });

  // the meter of the gain reduction: what the compressor of THIS track takes off right now (sent by the engine about every 20 ms while it plays)
  const meterText = el('span', 'flex:none;width:5.6em;text-align:right;font-variant-numeric:tabular-nums;font-size:12px'); meterText.textContent = '0.0 dB';
  const meterBar = el('div', 'height:10px;border-radius:5px;background:var(--sel-edge,#2d78ff);width:0;transition:width .06s linear;margin-left:auto');
  const meterTrack = el('div', 'flex:1;height:10px;border-radius:5px;background:var(--track,#ddd);display:flex;overflow:hidden', { 'data-trackfx-gr': '', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '24' });
  meterTrack.append(meterBar);
  const meterName = el('span', 'flex:none;width:5.2em;font-size:13px'); meterName.textContent = label('trackFx.compReduction');
  const meterRow = el('div', 'display:flex;align-items:center;gap:6px'); meterRow.append(meterName, meterTrack, meterText);
  let meterHold = 0; let meterAt = 0;
  const onReduction = (e) => {
    if (e.detail?.track !== trackId) return;
    const depth = Math.min(24, -Math.min(0, e.detail.db)); const now = performance.now();
    if (depth >= meterHold || now - meterAt > 250) { meterHold = depth; meterAt = now; }
    meterBar.style.width = `${(meterHold / 24) * 100}%`; meterText.textContent = `${(-meterHold).toFixed(1)} dB`; meterTrack.setAttribute('aria-valuenow', String(meterHold.toFixed(1)));
  };
  window.addEventListener('scorsaire:comp-reduction', onReduction);
  // the SoundFont engine compresses at most 15 melodic tracks at a time (one output each): the engine says which tracks it could not give one
  const limitNote = el('div', 'font-size:12px;color:var(--warn-ink,#9a5b00);background:var(--warn-soft,#fff3d6);border-radius:6px;padding:6px', { 'data-trackfx-limit': '', role: 'status' });
  limitNote.textContent = label('trackFx.compLimit'); limitNote.hidden = true;
  const onLimit = (e) => { limitNote.hidden = !(e.detail?.tracks ?? []).includes(trackId); };
  window.addEventListener('scorsaire:comp-limit', onLimit);
  // the browser refused the worklet of the compressor (the equalizer still works): said once, here, instead of a compressor that silently does nothing
  const downNote = el('div', 'font-size:12px;color:var(--danger-ink,#a33);background:var(--danger-soft,#fde7e7);border-radius:6px;padding:6px', { 'data-trackfx-unavailable': '', role: 'alert' });
  downNote.textContent = label('trackFx.compUnavailable'); downNote.hidden = !unavailable;
  const onDown = () => { unavailable = true; downNote.hidden = false; };
  window.addEventListener('scorsaire:comp-unavailable', onDown);

  // ── the rotary speaker (Leslie): the state the rotor starts in, the optional vibrato of the chorale, the speed and the depth of the tremolo. The signs Chorale / Tremolo / Brake of the score change the rotor during playback.
  // Rule: the section exists for every pitched track (not percussion; a lyrics track has no mixer entry); it is the FIRST and OPEN one for an organ (instrument family 'organs'), the LAST and folded one for the others.
  const trackEl = app.doc.work.movements[0]?.tracks.find((t) => t.id === trackId);
  const pitched = Boolean(trackEl) && !isDrumTrack(trackEl);
  const organ = pitched && instrumentInfo(getProperty(trackEl, PID.INSTRUMENT_ID))?.family === 'organs';
  let les = leslieSettings(app.trackLeslie(trackId));
  const saveLeslie = () => { try { app.setTrackLeslie(trackId, cleanLeslie(les)); } catch { /* a refused value leaves the track as it was */ } };
  const lesBox = el('details', 'border-top:1px solid var(--edge,#bbb);padding-top:8px', { 'data-trackfx-leslie': '' });
  lesBox.open = organ;
  const lesSummary = el('summary', 'font-weight:var(--w-semi,600);cursor:pointer;min-height:var(--ui-target,36px);display:flex;align-items:center'); lesSummary.textContent = label('trackFx.leslie');
  const lesBody = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:4px');
  const lesHint = el('div', 'font-size:12px;color:var(--ink-soft,#555)'); lesHint.textContent = label('trackFx.leslieHint');
  const modeName = el('div', 'font-size:13px'); modeName.textContent = label('trackFx.leslieMode');
  const modeRow = el('div', 'display:flex;gap:var(--btn-gap,4px);flex-wrap:wrap', { role: 'radiogroup', 'aria-label': label('trackFx.leslieMode') });
  const modeKey = { chorale: 'trackFx.leslieChorale', tremolo: 'trackFx.leslieTremolo', brake: 'trackFx.leslieBrake' };
  const modeBtns = {};
  for (const m of LESLIE_MODES) {
    const b = el('button', 'min-height:var(--ui-target,36px);min-width:var(--ui-target,36px);padding:0 12px;border-radius:6px;border:1px solid var(--edge,#bbb);color:inherit;font:var(--w-semi,600) 14px var(--ui-font,sans-serif)', { type: 'button', role: 'radio', 'data-trackfx-leslie-mode': m });
    b.textContent = label(modeKey[m]);
    b.addEventListener('click', () => { les = { ...les, mode: m }; syncLeslie(); saveLeslie(); });
    modeBtns[m] = b; modeRow.append(b);
  }
  const vibrato = createSwitch({ checked: les.vibrato, text: label('trackFx.leslieVibrato'), attrs: { 'data-trackfx-leslie-vibrato': '' }, onchange: () => { les = { ...les, vibrato: vibrato.checked }; saveLeslie(); } });
  vibrato.style.cssText = 'min-height:var(--ui-target,36px);padding:0 12px;border-radius:6px;align-self:flex-start';
  const lesRows = {};
  const lesRow = (key, nameKey, step, format) => {
    const [lo, hi] = LESLIE_RANGES[key];
    const name = el('span', 'flex:none;width:5.2em'); name.textContent = label(nameKey);
    const input = el('input', 'flex:1;min-width:0;height:var(--ui-target,36px)', { type: 'range', min: String(lo), max: String(hi), step: String(step), 'data-trackfx-leslie': key });
    const value = el('span', 'flex:none;width:5.6em;text-align:right;font-variant-numeric:tabular-nums;font-size:12px');
    input.addEventListener('input', () => { les = { ...les, [key]: Number(input.value) }; value.textContent = format(les[key]); });
    input.addEventListener('change', () => saveLeslie());
    input.addEventListener('dblclick', () => { les = { ...les, [key]: LESLIE_DEFAULTS[key] }; syncLeslie(); saveLeslie(); });
    const row = el('label', 'display:flex;align-items:center;gap:6px;font-size:13px'); row.append(name, input, value);
    lesRows[key] = { set: () => { input.value = String(les[key]); value.textContent = format(les[key]); } };
    return row;
  };
  const lesRowEls = [lesRow('rate', 'trackFx.leslieRate', 0.1, (v) => `${v.toFixed(1)} Hz`), lesRow('depth', 'trackFx.leslieDepth', 0.05, (v) => `${Math.round(v * 100)} %`), lesRow('speed', 'trackFx.leslieSpeed', 0.05, (v) => `× ${v.toFixed(2).replace(/0$/, '')}`)];
  function syncLeslie() {
    for (const m of LESLIE_MODES) { modeBtns[m].setAttribute('aria-checked', String(les.mode === m)); modeBtns[m].style.background = les.mode === m ? 'var(--sel-soft,#d9e6ff)' : 'var(--field,#fff)'; modeBtns[m].style.borderColor = les.mode === m ? 'var(--sel-edge,#2d78ff)' : 'var(--edge,#bbb)'; }
    vibrato.checked = les.vibrato;
    for (const r of Object.values(lesRows)) r.set();
  }
  syncLeslie();
  lesBody.append(lesHint, modeName, modeRow, vibrato, ...lesRowEls);
  lesBox.append(lesSummary, lesBody);

  box.append(top, title, hint, svg, readout, bendRow, scale, reset, eqTitle, eqHint, eqOn, eqSvg, eqInfo, ...eqRowsEls, eqReset, compTitle, compHint, compButtons, ...compRows, meterRow, limitNote, downNote, compReset);
  if (pitched) { if (organ) top.after(lesBox); else box.append(lesBox); }
  fitHeight();
  for (const child of box.children) child.style.flexShrink = '0'; // the window scrolls: nothing is squeezed to fit (an SVG would shrink to nothing)
  document.body.append(box);
  drawGraph();
  current = { close, box, trackId };
  return { close };
}
