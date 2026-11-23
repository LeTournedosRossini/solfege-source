/*
 * Editor of the automation strips (DOM) — a layer above the score, never inside it: the SVG of the score does not move. The strip itself (background, curve,
 * mute blocks) is drawn by the layout (layout/automationstrip.js); this layer adds what reacts to the pointer: the points (to select and drag), the empty strip
 * (a tap adds a point or toggles a one-cell mute, or — in "range" mode — a drag selects a stretch) and a small floating toolbar.
 * Every change is ONE undoable transaction (a drag writes once, when released); the preview while dragging is only drawn here.
 */
import { absOfX, xOfAbs, valueOfY, yOfValue, inMuteRow, nextSnap, SNAPS } from '../view/automation-geometry.js';
import { laneOf, sortedEntries, laneAt, faderOf, pitchBendRangeOf, PITCH_BEND_RANGES, shapeRamp, curveForMiddle } from '../model/automation.js';
import { measureLayout } from '../model/tempomap.js';
import { fCmp, fAdd, fSub, ZERO } from '../model/fraction.js';
import { glyphRowIcon } from './mark-icons.js';

const NS = 'http://www.w3.org/2000/svg';
const SHIFT = 5 / 127; // one press of − / + moves a stretch by 5 steps of the 0..127 scale (5 of 126 for the pan)
/** A value of the strip for the screen: 0..127 for the volume, L63 … C … R63 for the pan. */
const fmtValue = (strip, v) => { if (strip?.param === 'pitchbend') { const s = Math.round((v - 0.5) * 2 * (strip.range ?? 2) * 10) / 10; return `${s > 0 ? '+' : ''}${s}`; } if (strip?.param !== 'pan') return String(Math.round(v * 127)); const n = Math.round(v * 126) - 63; return n === 0 ? 'C' : n < 0 ? `L${-n}` : `R${n}`; };
const MODES = ['point', 'range']; // in 'point' mode a drag on the empty strip draws a selection box
const MOVE_PX = 6; // below this a press is a tap
/** The fades the button goes through, written as note values (Bravura glyphs); `none` = an abrupt change. */
const FADE_CYCLE = Object.freeze(['thirtysecond', 'sixteenth', 'eighth', 'quarter', 'none']);
const FADE_GLYPH = { thirtysecond: 'metNote32ndUp', sixteenth: 'metNote16thUp', eighth: 'metNote8thUp', quarter: 'metNoteQuarterUp' };

const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
  n.append(...children.flat().filter((c) => c != null && c !== false));
  return n;
};

/**
 * @param o.app, o.view, o.stage  the Application, the ScoreView and the positioned container of the layers
 * @param o.svg                   () → the main SVG element (for the pixel scale)
 * @param o.stageVisible          () → { left, right, top, bottom } visible zone in stage coordinates (floating toolbar)
 * @param o.message               (text) → shows a message
 * @returns { layer, bar, draw(), place(), destroy() }
 */
export function mountAutomationLayer({ app, view, stage, svg, stageVisible, label = (k) => k, message = () => {}, glyphs = null }) {
  const layer = svgEl('svg');
  layer.setAttribute('data-automation-layer', '');
  layer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
  const bar = el('div', { 'data-automation-bar': '', 'data-dismiss-keep': '', 'data-zoom-lock-inline': '', style: 'display:none;position:absolute;left:0;top:0;z-index:7;gap:var(--btn-gap,2px);flex-direction:column;align-items:stretch;width:max-content;padding:4px;font:13px var(--ui-font,sans-serif);background:var(--bar,rgba(255,255,255,0.97));border:1px solid var(--edge,rgba(0,0,0,0.2));border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);box-sizing:border-box' });
  // ---- interface state (never in the Document) ----
  const state = { trackId: null, param: 'volume', mode: 'point', snap: 'beat', fade: 'thirtysecond', points: new Set(), range: null };
  let strips = [];
  let drag = null;
  view.setMasterAutomation?.(app.masterAutomationShown?.() ?? false, label('automation.master')); // the label written on the master strip, in the language of the interface

  const scale = () => { const s = svg(); if (!s) return 1; const b = s.getBoundingClientRect(); return b.width ? s.viewBox.baseVal.width / b.width : 1; };
  const toSvg = (e) => { const s = svg(); const b = s.getBoundingClientRect(); const k = scale(); return { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k }; };
  const trackOf = (id) => { const t = app.doc.find(id); return t && (t.type === 'track' || t.type === 'movement') ? t : null; }; // a movement owns the lane of the master volume
  const stripAt = (trackId, x, y, param = state.param) => strips.find((s) => s.trackId === trackId && s.param === param && x >= s.x1 - 1 && x <= s.x2 + 1 && y >= s.y1 && y <= s.y2);
  const run = (fn) => { try { message(''); fn(); } catch (e) { message(String(e?.message ?? e)); } };

  /** The points of the volume lane of a track, with their pixel x on a given strip. */
  const pointsOn = (strip) => {
    const track = trackOf(strip.trackId);
    if (!track) return [];
    const layout = measureLayout(view.movement());
    const param = strip.param ?? 'volume';
    return sortedEntries(laneOf(track, param), layout).filter((e) => fCmp(e.abs, strip.firstAbs) >= 0 && fCmp(e.abs, strip.lastAbs) < 0)
      .map((e) => ({ ...e, x: xOfAbs(strip, e.abs), y: yOfValue(strip, e.value ?? app.automationFader(strip.trackId, param)) }));
  };

  // ---- drawing ----
  function draw() {
    strips = view.automationStrips();
    const s = svg();
    if (!s || !strips.length) { layer.replaceChildren(); bar.style.display = 'none'; bar.replaceChildren(); return; }
    layer.setAttribute('width', s.getAttribute('width')); layer.setAttribute('height', s.getAttribute('height')); layer.setAttribute('viewBox', s.getAttribute('viewBox'));
    if (!state.trackId || !strips.some((x) => x.trackId === state.trackId && x.param === state.param)) { state.trackId = strips[0].trackId; state.param = strips[0].param; }
    const k = scale();
    const els = [];
    const alive = new Set();
    const grips = [];
    for (const strip of strips) {
      const bg = svgEl('rect', { x: strip.x1, y: strip.y1, width: strip.x2 - strip.x1, height: strip.y2 - strip.y1, fill: 'transparent', 'data-automation-bg': strip.trackId });
      bg.style.pointerEvents = 'all';
      bg.style.touchAction = 'none'; // a drag on the strip is a gesture of the editor (box or range), never a scroll
      bg.addEventListener('pointerdown', (e) => onBgDown(e, strip));
      els.push(bg);
      if (state.range && state.range.trackId === strip.trackId && state.range.param === strip.param && state.range.systemIndex === strip.systemIndex) {
        const xa = xOfAbs(strip, state.range.from); const xb = xOfAbs(strip, state.range.to);
        // the selected stretch: in range mode a press INSIDE it only moves the whole stretch up or down (the pointer shows it); a press outside makes a new selection
        const zone = svgEl('rect', { x: Math.min(xa, xb), y: strip.y1, width: Math.max(Math.abs(xb - xa), 2), height: strip.y2 - strip.y1, fill: 'rgba(150,60,210,0.16)', stroke: 'rgb(150,60,210)', 'stroke-width': 1.5 * k, 'data-automation-range': '' });
        if (state.mode === 'range') {
          zone.style.pointerEvents = 'all'; zone.style.cursor = 'ns-resize'; zone.style.touchAction = 'none';
          zone.addEventListener('pointerdown', (e) => onRangeDown(e, strip));
        } else zone.setAttribute('pointer-events', 'none');
        els.push(zone);
        if (state.mode === 'range' && !(drag && drag.kind === 'rangeShift')) els.push(Object.assign(svgEl('text', { x: (xa + xb) / 2, y: (strip.y1 + strip.y2) / 2 + 6 * k, 'text-anchor': 'middle', 'font-size': 18 * k, 'font-family': 'sans-serif', fill: 'rgb(150,60,210)', opacity: 0.55, 'pointer-events': 'none' }), { textContent: '↕' }));
      }
      // the height handle under the strip: drag it to make the strips taller or shorter, as much as needed (the new size applies when it is released)
      // the handle sits in the middle of the part of the strip that is on screen (it slides along when the page is scrolled sideways)
      const visNow = stageVisible?.();
      const hx = visNow ? (Math.max(strip.x1, visNow.left) + Math.min(strip.x2, visNow.right)) / 2 : (strip.x1 + strip.x2) / 2; const hy = strip.y2 + 6 * k;
      const grip = svgEl('g', { 'data-automation-resize': strip.trackId });
      grip.append(svgEl('rect', { x: hx - 22 * k, y: hy - 5 * k, width: 44 * k, height: 10 * k, rx: 5 * k, fill: 'var(--auto-bg,#f3f6fb)', stroke: 'var(--auto-border,#b9c4d6)', 'stroke-width': k }),
        svgEl('line', { x1: hx - 10 * k, y1: hy - 1.5 * k, x2: hx + 10 * k, y2: hy - 1.5 * k, stroke: 'var(--auto-label,#5b6b84)', 'stroke-width': k }),
        svgEl('line', { x1: hx - 10 * k, y1: hy + 1.5 * k, x2: hx + 10 * k, y2: hy + 1.5 * k, stroke: 'var(--auto-label,#5b6b84)', 'stroke-width': k }));
      const gripHit = svgEl('rect', { x: hx - 28 * k, y: hy - 12 * k, width: 56 * k, height: 24 * k, fill: 'transparent' });
      grip.append(gripHit);
      grip.style.pointerEvents = 'all'; grip.style.cursor = 'ns-resize'; grip.style.touchAction = 'none';
      grip.addEventListener('pointerdown', (e) => onResizeDown(e, strip));
      grips.push(grip); // drawn after every strip, so that a strip stacked below never covers the handle of the one above
      for (const p of pointsOn(strip)) {
        alive.add(p.id);
        const on = state.points.has(p.id);
        if (on) els.push(svgEl('circle', { cx: p.x, cy: p.y, r: 9 * k, fill: 'rgba(40,120,255,0.25)', stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': 2 * k, 'pointer-events': 'none' }));
        const hit = svgEl('circle', { cx: p.x, cy: p.y, r: 15 * k, fill: 'transparent', 'data-automation-point': p.id });
        hit.style.pointerEvents = 'all'; hit.style.touchAction = 'none';
        hit.addEventListener('pointerdown', (e) => onPointDown(e, strip, p));
        els.push(hit);
      }
    }
    els.push(...grips);
    for (const id of [...state.points]) if (!alive.has(id)) state.points.delete(id);
    // the handle that bows the ramp leaving each selected point (drag it up or down; the ramp is straight when the handle is on the line)
    if (!drag || drag.kind === 'bow') {
      for (const strip of strips) {
        for (const seg of bowSegments(strip)) {
          const curve = drag?.kind === 'bow' && drag.point.id === seg.point.id ? drag.curve : seg.point.curve ?? 0;
          const mid = seg.v0 + (seg.v1 - seg.v0) * shapeRamp(0.5, curve);
          const hx = (seg.point.x + seg.next.x) / 2; const hy = yOfValue(strip, mid);
          const g = svgEl('g', { 'data-automation-bow': seg.point.id });
          g.append(svgEl('circle', { cx: hx, cy: hy, r: 15 * k, fill: 'transparent' }), svgEl('rect', { x: hx - 5 * k, y: hy - 5 * k, width: 10 * k, height: 10 * k, fill: 'var(--field,#fff)', stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': 2 * k }));
          g.style.pointerEvents = 'all'; g.style.touchAction = 'none'; g.style.cursor = 'ns-resize';
          g.addEventListener('pointerdown', (e) => onBowDown(e, strip, seg));
          els.push(g);
        }
      }
    }
    // the move handle of a selection: below the strip, joined to the selected points by a dotted line, so that the finger does not hide what it moves
    if (!drag || drag.handle) {
      for (const strip of strips) {
        const sel = pointsOn(strip).filter((p) => state.points.has(p.id));
        if (!sel.length) continue;
        const cx = sel.reduce((a, p) => a + p.x, 0) / sel.length; const cy = sel.reduce((a, p) => a + p.y, 0) / sel.length;
        const hy = strip.y2 + 26 * k;
        els.push(svgEl('line', { x1: cx, y1: cy, x2: cx, y2: hy, stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': k, 'stroke-dasharray': `${3 * k},${3 * k}`, 'pointer-events': 'none' }));
        const h = svgEl('g', { 'data-automation-handle': strip.trackId });
        h.append(svgEl('circle', { cx, cy: hy, r: 19 * k, fill: 'var(--field,rgba(255,255,255,0.96))', stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': 2 * k }),
          Object.assign(svgEl('text', { x: cx, y: hy + 6 * k, 'text-anchor': 'middle', 'font-size': 18 * k, 'font-family': 'sans-serif', fill: 'var(--auto-curve,rgb(40,120,255))', 'pointer-events': 'none' }), { textContent: '✥' }));
        h.style.pointerEvents = 'all'; h.style.touchAction = 'none';
        h.addEventListener('pointerdown', (e) => onHandleDown(e, strip));
        els.push(h);
      }
    }
    if (drag?.preview) els.push(...drag.preview(k));
    layer.replaceChildren(...els);
    layer.setAttribute('data-selected', String(state.points.size));
    drawBar();
    place();
  }

  /** The moves of a group drag: every selected point shifted by what the dragged one moved (time and value), the time shift limited to the movement. */
  function groupMoves(d) {
    const track = trackOf(d.strip.trackId);
    const mv = view.movement();
    if (!track || !mv) return [];
    const layout = measureLayout(mv);
    const entries = sortedEntries(laneOf(track, d.strip.param ?? 'volume'), layout).filter((e) => state.points.has(e.id));
    const dv = d.value - (d.point.value ?? d.value);
    const sign = fCmp(d.abs, d.point.abs);
    let dt = sign >= 0 ? fSub(d.abs, d.point.abs) : fSub(d.point.abs, d.abs);
    // limit the shift so that the first (or last) selected point stays inside [0, end]
    const first = entries[0]?.abs ?? ZERO; const last = entries[entries.length - 1]?.abs ?? ZERO;
    if (sign < 0 && fCmp(dt, first) > 0) dt = first;
    if (sign > 0 && fCmp(fAdd(last, dt), layout.end) > 0) dt = fSub(layout.end, last);
    return entries.map((e) => ({ pointId: e.id, abs: sign < 0 ? fSub(e.abs, dt) : fAdd(e.abs, dt), value: e.value === null ? null : Math.min(1, Math.max(0, e.value + dv)), onStrip: fCmp(e.abs, d.strip.firstAbs) >= 0 && fCmp(e.abs, d.strip.lastAbs) < 0 }));
  }

  /** The curve of the lane inside the selected stretch as it would be after raising it by `delta`: [{ x, y, point? }] in pixels (steps hold, then jump; linear ramps are straight). */
  function shiftedCurve(strip, r, delta) {
    const track = trackOf(strip.trackId); const mv = view.movement();
    if (!track || !mv) return [];
    const param = strip.param ?? 'volume'; const fader = app.automationFader(strip.trackId, param);
    const entries = sortedEntries(laneOf(track, param), measureLayout(mv));
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const inside = entries.filter((e) => fCmp(e.abs, r.from) > 0 && fCmp(e.abs, r.to) < 0);
    let gov = null; for (const e of entries) { if (fCmp(e.abs, r.from) <= 0) gov = e; else break; }
    const marks = [{ abs: r.from, v: laneAt(entries, r.from, 'after', fader, fader), ramp: gov?.ramp ?? 'step', point: false }, ...inside.map((e) => ({ abs: e.abs, v: e.value ?? fader, ramp: e.ramp, point: true })), { abs: r.to, v: laneAt(entries, r.to, 'before', fader, fader), ramp: 'step', point: false }];
    const out = [];
    marks.forEach((m, i) => {
      const x = xOfAbs(strip, m.abs); const y = yOfValue(strip, clamp(m.v + delta));
      const prev = marks[i - 1];
      if (prev && prev.ramp !== 'linear') out.push({ x, y: yOfValue(strip, clamp(prev.v + delta)) }); // a step: it holds until the next point, then jumps
      out.push({ x, y, point: m.point });
    });
    return out;
  }

  // ---- gestures ----
  function endDrag(e) { if (drag && e.pointerId === drag.pointer) { try { layer.releasePointerCapture(e.pointerId); } catch { /* already released */ } } }

  function onPointDown(e, strip, p) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    state.trackId = strip.trackId; state.param = strip.param;
    const modifier = e.shiftKey || e.ctrlKey || e.metaKey;
    // a point of a selection of several: the press keeps the selection so that dragging moves them all (a tap, without a move, then keeps only this one)
    const group = !modifier && state.points.has(p.id) && state.points.size > 1;
    if (group) { /* keep the selection */ }
    else if (!modifier) state.points = new Set([p.id]);
    else if (state.points.has(p.id)) state.points.delete(p.id); else state.points.add(p.id);
    state.range = null;
    const start = toSvg(e);
    drag = { kind: 'point', pointer: e.pointerId, strip, point: p, start, moved: false, abs: p.abs, value: p.value ?? 0, group };
    try { layer.setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives on the layer */ }
    draw();
  }

  /** The straight or bowed ramps that leave a selected point of the strip and arrive at another point of it: [{ point, next, v0, v1 }] (values 0..1, a point that follows the fader reads as the fader). */
  function bowSegments(strip) {
    const all = pointsOn(strip);
    const fader = app.automationFader(strip.trackId, strip.param ?? 'volume');
    const out = [];
    all.forEach((p, i) => {
      const next = all[i + 1];
      if (!state.points.has(p.id) || !next || p.ramp !== 'linear') return;
      const v0 = p.value ?? fader; const v1 = next.value ?? fader;
      if (Math.abs(v1 - v0) < 1e-9) return; // a flat ramp has nothing to bow
      out.push({ point: p, next, v0, v1 });
    });
    return out;
  }

  /** Pressing the bow handle: dragging it up or down bows the ramp (a ramp curved the other way when dragged past the straight line). */
  function onBowDown(e, strip, seg) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    state.trackId = strip.trackId; state.param = strip.param;
    drag = { kind: 'bow', pointer: e.pointerId, strip, seg, point: seg.point, start: toSvg(e), moved: false, curve: seg.point.curve ?? 0 };
    try { layer.setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives on the layer */ }
  }

  /** Pressing the handle of the selection: the selected points follow the pointer (the handle itself stays out of the way of the finger). */
  function onHandleDown(e, strip) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const sel = pointsOn(strip).filter((p) => state.points.has(p.id));
    if (!sel.length) return;
    const ref = sel[0];
    drag = { kind: 'point', handle: true, group: true, pointer: e.pointerId, strip, point: ref, start: toSvg(e), moved: false, abs: ref.abs, value: valueOfY(strip, ref.y), ref: { x: ref.x, y: ref.y } };
    try { layer.setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives on the layer */ }
  }

  /** Pressing the height handle under a strip: the strips get taller or shorter by what the pointer moved (a dashed line shows where the bottom goes). */
  function onResizeDown(e, strip) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    drag = { kind: 'resize', pointer: e.pointerId, strip, start: toSvg(e), moved: false, scale0: app.automationScale(), scale: app.automationScale(), height: strip.y2 - strip.y1 };
    try { layer.setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives on the layer */ }
  }

  /** Pressing inside the selected stretch (range mode): dragging up or down moves the level of the whole stretch, as the − / + buttons do, continuously. */
  function onRangeDown(e, strip) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    state.trackId = strip.trackId; state.param = strip.param;
    drag = { kind: 'rangeShift', pointer: e.pointerId, strip, start: toSvg(e), moved: false, delta: 0 };
    try { layer.setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives on the layer */ }
  }

  function onBgDown(e, strip) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    state.trackId = strip.trackId; state.param = strip.param;
    const at = toSvg(e);
    drag = { kind: 'bg', pointer: e.pointerId, strip, start: at, moved: false, from: absOfX(strip, at.x, state.snap), to: null };
    e.preventDefault(); try { layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag.add = e.shiftKey || e.ctrlKey || e.metaKey;
  }

  layer.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const at = toSvg(e);
    const k = scale();
    if (!drag.moved && Math.hypot(at.x - drag.start.x, at.y - drag.start.y) < MOVE_PX * k) return;
    drag.moved = true;
    if (drag.kind === 'resize') {
      const height = Math.max(8 * k, drag.height + (at.y - drag.start.y)); // the strip height in pixels of the SVG, never below a few pixels
      drag.scale = Math.min(8, Math.max(0.5, drag.scale0 * (height / drag.height)));
      const y = drag.strip.y1 + height;
      drag.preview = (kk) => [svgEl('line', { x1: drag.strip.x1, y1: y, x2: drag.strip.x2, y2: y, stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': 1.5 * kk, 'stroke-dasharray': `${5 * kk},${3 * kk}`, 'pointer-events': 'none' })];
      draw();
      return;
    }
    if (drag.kind === 'rangeShift') {
      // the level change is the vertical distance of the pointer in steps of the 0..127 scale (the same value scale as the strip), the stretch itself is drawn moved
      drag.delta = valueOfY(drag.strip, at.y) - valueOfY(drag.strip, drag.start.y);
      const r = state.range; const xa = xOfAbs(drag.strip, r.from); const xb = xOfAbs(drag.strip, r.to);
      // the selected zone stays where it is; what moves is the CURVE inside it (the line of the automation as it would become), with the change written next to it
      const curve = shiftedCurve(drag.strip, r, drag.delta);
      drag.preview = (kk) => [
        svgEl('polyline', { points: curve.map((q) => `${q.x},${q.y}`).join(' '), fill: 'none', stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': 2.2 * kk, 'stroke-linejoin': 'round', 'pointer-events': 'none' }),
        ...curve.filter((q) => q.point).map((q) => svgEl('circle', { cx: q.x, cy: q.y, r: 4.5 * kk, fill: 'var(--auto-curve,rgb(40,120,255))', 'pointer-events': 'none' })),
        Object.assign(svgEl('text', { x: (xa + xb) / 2, y: drag.strip.y1 + 14 * kk, 'text-anchor': 'middle', 'font-size': 13 * kk, 'font-family': 'sans-serif', fill: 'var(--auto-ink,rgb(20,70,170))', 'pointer-events': 'none' }), { textContent: `${drag.delta >= 0 ? '+' : '−'}${Math.round(Math.abs(drag.delta) * (drag.strip.steps ?? 127))}` }),
      ];
      draw();
      return;
    }
    if (drag.kind === 'bow') {
      const { seg, strip } = drag;
      drag.curve = curveForMiddle((valueOfY(strip, at.y) - seg.v0) / (seg.v1 - seg.v0));
      const pieces = []; let ax = seg.point.x; let ay = yOfValue(strip, seg.v0);
      for (let q = 1; q <= 16; q++) {
        const u = q / 16; const bx = seg.point.x + (seg.next.x - seg.point.x) * u; const by = yOfValue(strip, seg.v0 + (seg.v1 - seg.v0) * shapeRamp(u, drag.curve));
        pieces.push(`${bx},${by}`); ax = bx; ay = by;
      }
      void ax; void ay;
      drag.preview = (kk) => [svgEl('polyline', { points: `${seg.point.x},${yOfValue(strip, seg.v0)} ${pieces.join(' ')}`, fill: 'none', stroke: 'var(--auto-ink,rgb(20,70,170))', 'stroke-width': 2.4 * kk, 'stroke-linejoin': 'round', 'pointer-events': 'none' })];
      draw();
      return;
    }
    if (drag.kind === 'point') {
      // the handle moves the selection by what the pointer moved, counted from the first selected point (the finger is not on the point)
      const px = drag.handle ? drag.ref.x + (at.x - drag.start.x) : at.x;
      const py = drag.handle ? drag.ref.y + (at.y - drag.start.y) : at.y;
      drag.abs = absOfX(drag.strip, px, state.snap);
      drag.value = valueOfY(drag.strip, py);
      const x = xOfAbs(drag.strip, drag.abs); const y = yOfValue(drag.strip, drag.value);
      if (drag.group) {
        // every selected point of this strip moves by the same amount (the shift in time is limited so that none leaves the movement)
        drag.moves = groupMoves(drag);
        drag.preview = (kk) => [
          svgEl('line', { x1: x, y1: drag.strip.y1, x2: x, y2: drag.strip.y2, stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': kk, 'stroke-dasharray': `${4 * kk},${3 * kk}`, 'pointer-events': 'none' }),
          // what the curve becomes: the points of this strip with the moved ones where they are going
          ...(() => {
            const moved = new Map(drag.moves.map((m) => [m.pointId, m]));
            const pts = pointsOn(drag.strip).map((p) => { const m = moved.get(p.id); return m ? { x: xOfAbs(drag.strip, m.abs), y: yOfValue(drag.strip, m.value ?? 0), moved: true } : { x: p.x, y: p.y, moved: false }; }).sort((a, b) => a.x - b.x);
            return [svgEl('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': 1.5 * kk, 'pointer-events': 'none' }),
              ...pts.filter((p) => p.moved).map((p) => svgEl('circle', { cx: p.x, cy: p.y, r: 6 * kk, fill: 'var(--auto-curve,rgb(40,120,255))', 'pointer-events': 'none' }))];
          })(),
        ];
        draw();
        return;
      }
      drag.preview = (kk) => [
        svgEl('line', { x1: x, y1: drag.strip.y1, x2: x, y2: drag.strip.y2, stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': kk, 'stroke-dasharray': `${4 * kk},${3 * kk}`, 'pointer-events': 'none' }),
        svgEl('circle', { cx: x, cy: y, r: 6 * kk, fill: 'var(--auto-curve,rgb(40,120,255))', 'pointer-events': 'none' }),
        Object.assign(svgEl('text', { x: x + 9 * kk, y: y - 8 * kk, 'font-size': 12 * kk, 'font-family': 'sans-serif', fill: 'var(--auto-ink,rgb(20,70,170))', 'pointer-events': 'none' }), { textContent: fmtValue(drag.strip, drag.value) }),
      ];
      draw();
    } else if (drag.kind === 'bg' && state.mode !== 'range') {
      drag.box = { x1: Math.min(drag.start.x, at.x), y1: Math.min(drag.start.y, at.y), x2: Math.max(drag.start.x, at.x), y2: Math.max(drag.start.y, at.y) };
      drag.preview = (kk) => [svgEl('rect', { x: drag.box.x1, y: drag.box.y1, width: drag.box.x2 - drag.box.x1, height: drag.box.y2 - drag.box.y1, fill: 'rgba(40,120,255,0.10)', stroke: 'var(--auto-curve,rgb(40,120,255))', 'stroke-width': kk, 'stroke-dasharray': `${5 * kk},${3 * kk}`, 'pointer-events': 'none' })];
      draw();
    } else if (drag.kind === 'bg' && state.mode === 'range') {
      drag.to = absOfX(drag.strip, at.x, state.snap);
      state.range = { trackId: drag.strip.trackId, param: drag.strip.param, systemIndex: drag.strip.systemIndex, from: fCmp(drag.from, drag.to) <= 0 ? drag.from : drag.to, to: fCmp(drag.from, drag.to) <= 0 ? drag.to : drag.from };
      state.points = new Set();
      draw();
    }
  });

  const finish = (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag; drag = null;
    endDrag(e);
    if (d.kind === 'resize') {
      if (d.moved) app.setAutomationScale(d.scale);
      draw();
      return;
    }
    if (d.kind === 'bow') {
      if (d.moved) run(() => app.setAutomationCurve(d.strip.trackId, { param: d.strip.param ?? 'volume', pointIds: [d.point.id], curve: d.curve }));
      draw();
      return;
    }
    if (d.kind === 'rangeShift') {
      const r = state.range;
      if (d.moved && r && Math.abs(d.delta) > 1e-9) run(() => app.shiftAutomation(d.strip.trackId, { param: d.strip.param ?? 'volume', from: r.from, to: r.to, delta: d.delta, fade: state.fade }));
      draw();
      return;
    }
    if (d.kind === 'point') {
      if (d.moved && d.group && d.moves) run(() => app.moveAutomationPoints(d.strip.trackId, { param: d.strip.param ?? 'volume', moves: d.moves.map(({ pointId, abs, value }) => ({ pointId, abs, value })) }));
      else if (d.moved) run(() => app.moveAutomationPoint(d.strip.trackId, { param: d.strip.param ?? 'volume', pointId: d.point.id, abs: d.abs, value: d.value }));
      else if (d.group && !d.handle) state.points = new Set([d.point.id]); // a tap on a selected point keeps only it
      draw();
    } else if (d.kind === 'bg') {
      if (state.mode !== 'range' && d.moved) {
        const box = d.box;
        const inside = box ? pointsOn(d.strip).filter((p) => p.x >= box.x1 && p.x <= box.x2 && p.y >= box.y1 && p.y <= box.y2).map((p) => p.id) : [];
        state.points = d.add ? new Set([...state.points, ...inside]) : new Set(inside);
        state.range = null;
        draw();
      } else if (state.mode === 'range') {
        if (!d.moved) { state.range = { trackId: d.strip.trackId, param: d.strip.param, systemIndex: d.strip.systemIndex, from: d.from, to: nextSnap(d.strip, d.from, state.snap) }; state.points = new Set(); }
        draw();
      } else if (!d.moved) {
        const y = d.start.y;
        if (inMuteRow(d.strip, y)) {
          // a tap in the mute row toggles the cell under the finger
          const abs = absOfX(d.strip, d.start.x, state.snap === 'free' ? 'beat' : state.snap);
          const track = trackOf(d.strip.trackId);
          const lane = track ? sortedEntries(laneOf(track, 'mute'), measureLayout(view.movement())) : [];
          const muted = laneAt(lane, abs, 'after', 0) >= 0.5;
          run(() => app.setAutomationSpan(d.strip.trackId, { param: 'mute', from: abs, to: nextSnap(d.strip, abs, state.snap), value: muted ? null : 1 }));
        } else {
          const abs = absOfX(d.strip, d.start.x, state.snap);
          run(() => app.addAutomationPoint(d.strip.trackId, { param: d.strip.param ?? 'volume', abs, value: valueOfY(d.strip, y) }));
        }
        state.points = new Set(); state.range = null;
        draw();
      }
    }
  };
  layer.addEventListener('pointerup', (e) => { if (drag) e.stopPropagation(); finish(e); });
  layer.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointer) { drag = null; draw(); } });
  // a press that reaches the layer must not reach the score underneath (taps, long presses…)
  for (const type of ['click', 'dblclick', 'contextmenu']) layer.addEventListener(type, (e) => { if (e.target.closest?.('[data-automation-bg],[data-automation-point]')) { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); } });
  layer.addEventListener('touchstart', (e) => { if (e.cancelable && e.target.closest?.('[data-automation-bg],[data-automation-point],[data-automation-handle]')) e.preventDefault(); }, { passive: false });
  layer.addEventListener('touchmove', (e) => { if (drag && e.cancelable) e.preventDefault(); }, { passive: false });

  // ---- toolbar ----
  const btn = (text, title, fn, attrs = {}) => {
    const b = el('button', { type: 'button', title, 'aria-label': title, style: 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);padding:0 6px;font:inherit', ...attrs }, text);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  /** The fade button: the note value of the fade as a glyph (a thirty-second, sixteenth, eighth or quarter note), `⎍` for an abrupt change; a press goes to the next one. */
  function fadeButton() {
    const names = { thirtysecond: '1/32', sixteenth: '1/16', eighth: '1/8', quarter: '1/4' };
    const title = `${label('automation.fade')} — ${state.fade === 'none' ? label('automation.fade.none') : names[state.fade] ?? state.fade}`;
    const icon = glyphs && FADE_GLYPH[state.fade] ? glyphRowIcon(glyphs, [FADE_GLYPH[state.fade]], { side0: 3.6, px: 24 }) : null;
    return btn(icon ?? (state.fade === 'none' ? '⎍' : names[state.fade] ?? state.fade), title, () => { const i = FADE_CYCLE.indexOf(state.fade); state.fade = FADE_CYCLE[(i + 1) % FADE_CYCLE.length]; drawBar(); place(); }, { 'data-action': 'automation-fade', 'data-fade': state.fade });
  }

  function drawBar() {
    if (!strips.length) { bar.style.display = 'none'; return; }
    const tid = state.trackId;
    const track = trackOf(tid);
    const param = state.param;
    const shiftStep = 5 / (param === 'pan' || param === 'pitchbend' ? 126 : 127);
    const items = [
      // the button shows the mode a press switches TO (pencil mode: it offers the selection rectangle, and the other way round); its tooltip says which mode is active
      btn(state.mode === 'point' ? '▭' : '✎', `${label(state.mode === 'point' ? 'automation.toRange' : 'automation.toPoint')} — ${label(`automation.mode.${state.mode}`)}`, () => { state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]; if (state.mode !== 'range') state.range = null; draw(); }, { 'data-action': 'automation-mode', 'data-mode': state.mode, 'aria-pressed': String(state.mode !== 'point') }),
      btn(label(`automation.snap.${state.snap}`), label('automation.snap'), () => { state.snap = SNAPS[(SNAPS.indexOf(state.snap) + 1) % SNAPS.length]; drawBar(); place(); }, { 'data-action': 'automation-snap' }),
      fadeButton(),
    ];
    if (param === 'pitchbend' && track) { // the range of the wheel, each way (a press goes to the next one)
      const cur = pitchBendRangeOf(track);
      items.push(btn(`±${cur}`, `${label('automation.pitchRange')} (${label('wheel.unit')})`, () => run(() => app.setPitchBendRange(tid, PITCH_BEND_RANGES[(PITCH_BEND_RANGES.indexOf(cur) + 1) % PITCH_BEND_RANGES.length])), { 'data-action': 'automation-pitch-range' }));
    }
    if (state.points.size) {
      const lane = track ? sortedEntries(laneOf(track, param), measureLayout(view.movement())) : [];
      const first = lane.find((e) => state.points.has(e.id));
      const next = first?.ramp === 'linear' ? 'step' : 'linear';
      items.push(
        btn('−', label('automation.lowerPoints'), () => run(() => app.shiftAutomationPoints(tid, { param, pointIds: [...state.points], delta: -shiftStep })), { 'data-action': 'automation-points-lower' }),
        btn('+', label('automation.raisePoints'), () => run(() => app.shiftAutomationPoints(tid, { param, pointIds: [...state.points], delta: shiftStep })), { 'data-action': 'automation-points-raise' }),
        btn('⌒', label('automation.bow'), () => run(() => app.setAutomationCurve(tid, { param, pointIds: [...state.points], curve: first?.curve ? 0 : 0.5 })), { 'data-action': 'automation-bow', 'aria-pressed': String(Boolean(first?.curve)) }),
        btn(first?.ramp === 'linear' ? '⟋' : '⎍', label(next === 'step' ? 'automation.toStep' : 'automation.toLinear'), () => run(() => app.setAutomationRamp(tid, { param, pointIds: [...state.points], ramp: next })), { 'data-action': 'automation-ramp' }),
        btn('🗑', label('automation.removePoints'), () => { const ids = [...state.points]; state.points = new Set(); run(() => app.removeAutomationPoints(tid, { param, pointIds: ids })); }, { 'data-action': 'automation-remove' }),
      );
    }
    if (state.range && state.range.trackId === tid && state.range.param === param) {
      const r = state.range;
      items.push(
        ...(param === 'master' ? [] : [btn('🔇', label('automation.mute'), () => run(() => app.setAutomationSpan(tid, { param: 'mute', from: r.from, to: r.to, value: 1 })), { 'data-action': 'automation-mute-span' })]),
        btn('↺', label('automation.release'), () => run(() => {
          app.setAutomationSpan(tid, { param, from: r.from, to: r.to, value: null, fade: state.fade });
          if (track && laneOf(track, 'mute')) app.setAutomationSpan(tid, { param: 'mute', from: r.from, to: r.to, value: null });
        }), { 'data-action': 'automation-release-span' }),
        btn('✕', label('automation.clearRange'), () => { state.range = null; draw(); }, { 'data-action': 'automation-clear-range' }),
      );
    }
    // A✕ hides the strip of the lane being edited (the other one, if shown, stays)
    items.push(btn('A✕', label('automation.hide'), () => (param === 'master' ? app.setMasterAutomationShown(false) : app.setAutomationLanes(tid, app.automationLanes(tid).filter((q) => q !== param))), { 'data-action': 'automation-hide' }));
    bar.replaceChildren(...items);
    bar.style.display = 'flex';
  }

  function place() {
    if (bar.style.display === 'none') return;
    const strip = strips.find((s) => s.trackId === state.trackId && s.param === state.param);
    const vis = stageVisible?.();
    if (!strip || !vis) return;
    // a vertical bar, its top level with the top of the strip: OUTSIDE the container on its left when there is room, else floating over it at the left edge of the visible part
    const w = bar.offsetWidth; const h = bar.offsetHeight; const gap = 4;
    let x = strip.x1 - w - gap;
    if (x < vis.left + 2) x = vis.left + 2;
    let y = Math.max(strip.y1, vis.top + 2);
    if (y + h > vis.bottom - 2) y = Math.max(vis.top + 2, vis.bottom - h - 2);
    const p = { x, y };
    bar.style.left = `${Math.round(p.x)}px`; bar.style.top = `${Math.round(p.y)}px`;
  }

  // the bar follows the visible part of the page: once a scroll has stopped (the page, or the scrolling score) it is placed again, without a press on the strip
  let scrollTimer = 0;
  const followScroll = () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { if (!drag) draw(); }, 90); }; // draw: the bar and the height handles are placed again for what is now on screen
  window.addEventListener('scroll', followScroll, true); window.addEventListener('resize', followScroll);

  return {
    layer, bar, draw, place,
    state: () => ({ ...state, points: new Set(state.points) }),
    destroy() { clearTimeout(scrollTimer); window.removeEventListener('scroll', followScroll, true); window.removeEventListener('resize', followScroll); layer.remove(); bar.remove(); },
  };
}
