/*
 * Bend graph editor — DOM. A dialog with a time × pitch grid for ONE bend / dive: the user moves the points of the curve, taps an empty
 * place to add a point, removes the selected one. Same idea as MuseScore 4.2+ (Properties graph) and Guitar Pro 8 (Bend window).
 *  - x: progression over the duration of the merged note (0 → 1); y: semitones from the first written note (grid lines every half semitone =
 *    quarter tone). The last point is the pitch of the last note: it snaps to whole semitones and that note follows. For a pre-bend the first
 *    point is the amount (the silent ornament moves).
 *  - Playback follows the curve. The written bend (arrow, amount) shows the last point.
 * Chains (bend then release…) and pre-bends are covered; a point can be CURVED (Bézier handle, `h`): the playback follows the sampled curve.
 * One undoable transaction per gesture (`app.setBendCurve`). Presentation: a bottom sheet on phones and tablets, a floating window on desktop.
 */
import { contextSpan } from '../audio/contextspan.js';
import { clearNow, anchorOfRefs } from './keep-clear.js';
import { SHEET_QUERY, panelMode, clampWindow } from './panel-mode.js';
import { dismissOnOutside } from './outside-dismiss.js';
import { BEND_CURVE_MAX_POINTS, BEND_CURVE_MIN_GAP, sampleBendCurve } from '../model/bend.js';

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'bend-graph-style';
const CSS = `
[data-bend-graph] { --bg-target: var(--ui-target, 30px); position: fixed; z-index: 2500; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 2px 12px rgba(0,0,0,.3); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; overflow: auto; }
[data-bend-graph][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 85vh; border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-bend-graph][data-mode="floating"] { width: 460px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 8px; }
[data-bend-graph] .bg-head { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-bend-graph][data-mode="floating"] .bg-head { cursor: move; touch-action: none; }
[data-bend-graph] .bg-title { flex: 1 1 auto; font-weight: var(--w-semi,600); }
[data-bend-graph] .bg-body { padding: 8px 12px; }
[data-bend-graph] .bg-row { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); align-items: center; margin: 6px 0; }
[data-bend-graph] button { min-width: var(--bg-target); min-height: var(--bg-target); padding: 0 10px; font: inherit; }
[data-bend-graph] svg { width: 100%; height: auto; touch-action: none; display: block; background: var(--soft,#fafafa); border: 1px solid var(--line,#ddd); }
[data-bend-graph] .bg-hint { font-size: 12px; color: var(--ink-soft,#555); }
`;
const W = 400; const H = 240; const LEFT = 34; const RIGHT = 12; const TOP = 12; const BOTTOM = 26;
const PURPLE = 'rgb(150,60,210)';

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
};
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

/**
 * @returns { open(entryId), close(), isOpen(), destroy() }
 */
export function mountBendGraph({ app, player = null, label = (k) => k }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let panel = null; let entryId = null; let selected = 0; let message = ''; let dragged = null;
  // hearing the bend in its surroundings: how many notes of the track before and after (a per-viewer convenience, remembered)
  const around = { before: 2, after: 2 };
  try { const saved = JSON.parse(localStorage.getItem('scorsaire.bendAround') ?? 'null'); if (saved) for (const k of ['before', 'after']) if (Number.isInteger(saved[k]) && saved[k] >= 0 && saved[k] <= 8) around[k] = saved[k]; } catch { /* no storage */ }
  const saveAround = () => { try { localStorage.setItem('scorsaire.bendAround', JSON.stringify(around)); } catch { /* no storage */ } };
  const hearing = () => Boolean(player?.state().playing);
  const listen = () => {
    if (!player) return;
    if (hearing()) { player.pause(); draw(); return; }
    const anchor = app.bendAnchor(entryId);
    const ok = Boolean(anchor) && player.playWhere((seq) => contextSpan(seq, { ...anchor, ...around }));
    message = ok ? '' : label('bendGraph.noSound');
    draw();
  };
  const media = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  const mode = () => panelMode(media ? media.matches : false);

  const place = () => {
    const m = mode();
    panel.setAttribute('data-mode', m);
    if (m === 'sheet') { panel.style.left = ''; panel.style.top = ''; return; }
    const rect = panel.getBoundingClientRect();
    const start = dragged ?? { left: (window.innerWidth - rect.width) / 2, top: 70 };
    const pos = clampWindow({ ...start, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    panel.style.left = `${pos.left}px`; panel.style.top = `${pos.top}px`;
  };

  const commit = (points) => {
    try { message = ''; app.setBendCurve(entryId, points); } catch (e) { message = String(e?.message ?? e); }
    draw();
  };

  function draw() {
    if (entryId == null) return;
    const info = app.bendCurve(entryId);
    if (!info || !info.editable) { message = info?.chain ? label('bendGraph.chain') : message; if (!info || !info.points.length) { api.close(); return; } }
    const pts = info.points;
    selected = Math.min(selected, pts.length - 1);
    // y range: a bend goes up from 0, a dive down; always room for the points and one semitone above the highest
    const maxS = Math.max(...pts.map((p) => p.s), 0); const minS = Math.min(...pts.map((p) => p.s), 0);
    const aux = info.kind === 'aux'; // slight bend / dip / scoop: small movements around the note, both directions
    const up = info.type !== 'dive';
    const wheel = info.kind === 'wheel'; // a wheel moves both ways around the note, from any start, to any end
    const reach = Math.max(4, Math.ceil(Math.max(maxS, -minS)) + 1);
    const yMax = wheel ? reach : aux ? Math.max(2, Math.ceil(maxS) + 1) : up ? Math.max(4, Math.ceil(maxS) + 1) : 1;
    const yMin = wheel ? -reach : aux ? Math.min(-2, Math.floor(minS) - 1) : up ? -1 : Math.min(-4, Math.floor(minS) - 1);
    const X = (t) => LEFT + t * (W - LEFT - RIGHT);
    const Y = (s) => TOP + ((yMax - s) / (yMax - yMin)) * (H - TOP - BOTTOM);
    const toT = (x) => Math.min(1, Math.max(0, (x - LEFT) / (W - LEFT - RIGHT)));
    const toS = (y) => yMax - ((y - TOP) / (H - TOP - BOTTOM)) * (yMax - yMin);

    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, 'data-graph': '' });
    for (let s = Math.ceil(yMin * 2) / 2; s <= yMax + 1e-9; s += 0.5) {
      const whole = Math.abs(s - Math.round(s)) < 1e-9;
      svg.append(sv('line', { x1: LEFT, x2: W - RIGHT, y1: Y(s), y2: Y(s), stroke: whole ? '#bbb' : '#e4e4e4', 'stroke-width': s === 0 ? 1.6 : 1 }));
      if (whole) { const t = sv('text', { x: LEFT - 6, y: Y(s) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#555' }); t.textContent = String(Math.round(s)); svg.append(t); }
    }
    for (let k = 0; k <= 4; k++) {
      svg.append(sv('line', { x1: X(k / 4), x2: X(k / 4), y1: TOP, y2: H - BOTTOM, stroke: '#ddd' }));
      const t = sv('text', { x: X(k / 4), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#555' });
      t.textContent = info.beats ? `${Math.round((k / 4) * info.beats * 100) / 100}` : `${k * 25}%`; // a wheel shows the real time of its note, in beats
      svg.append(t);
    }
    const polyOf = (list) => sampleBendCurve(list).map((p) => `${X(p.t)},${Y(p.s)}`).join(' ');
    const line = sv('polyline', { fill: 'none', stroke: PURPLE, 'stroke-width': 2.5, points: polyOf(pts) });
    svg.append(line);
    // Bézier handles of the selected point (outgoing and its mirror image)
    const hSel = pts[selected];
    const handleGroup = sv('g', { 'data-handles': '' });
    svg.append(handleGroup);
    const drawHandles = (list, k) => {
      handleGroup.replaceChildren();
      const p = list[k];
      if (!p || !p.h) return;
      for (const sign of [1, -1]) {
        const hx = p.t + sign * p.h[0]; const hs = p.s + sign * p.h[1];
        if ((sign === 1 && k === list.length - 1) || (sign === -1 && k === 0)) continue; // no outgoing handle on the last point, no incoming on the first
        handleGroup.append(sv('line', { x1: X(p.t), y1: Y(p.s), x2: X(hx), y2: Y(hs), stroke: PURPLE, 'stroke-dasharray': '3 3' }));
        const g = sv('g', { 'data-handle': sign === 1 ? 'out' : 'in', style: 'cursor:grab;touch-action:none' });
        g.append(sv('circle', { cx: X(hx), cy: Y(hs), r: 15, fill: 'rgba(0,0,0,0.001)' }));
        g.append(sv('rect', { x: X(hx) - 5, y: Y(hs) - 5, width: 10, height: 10, fill: '#fff', stroke: PURPLE, 'stroke-width': 2 }));
        g.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          hdrag = { sign, pointer: e.pointerId, moved: false };
        });
        g.addEventListener('pointermove', (e) => {
          if (!hdrag || e.pointerId !== hdrag.pointer) return;
          const q = svgPoint(e);
          const dt = Math.max(0, Math.min(1, hdrag.sign * (toT(q.x) - draftPoints[selected].t)));
          const ds = Math.max(-12, Math.min(12, Math.round(hdrag.sign * (toS(q.y) - draftPoints[selected].s) * 2) / 2));
          draftPoints[selected] = { ...draftPoints[selected], h: [Math.round(dt * 100) / 100, ds] };
          hdrag.moved = true;
          line.setAttribute('points', polyOf(draftPoints));
          drawHandles(draftPoints, selected);
        });
        const endH = (e) => { const d = hdrag; hdrag = null; if (d && e.pointerId === d.pointer && d.moved) commit(draftPoints); else if (d) draw(); };
        g.addEventListener('pointerup', endH); g.addEventListener('pointercancel', endH);
        handleGroup.append(g);
      }
    };
    const draftPoints = pts.map((p) => ({ ...p, ...(p.h ? { h: [...p.h] } : {}) }));
    let drag = null;
    let hdrag = null;
    const svgPoint = (e) => { const b = svg.getBoundingClientRect(); const k = W / b.width; return { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k }; };
    pts.forEach((p, i) => {
      const g = sv('g', { 'data-point': i, style: 'cursor:grab;touch-action:none' });
      g.append(sv('circle', { cx: X(p.t), cy: Y(p.s), r: 17, fill: 'rgba(0,0,0,0.001)' }));
      const dot = sv('circle', { cx: X(p.t), cy: Y(p.s), r: i === selected ? 8 : 6, fill: i === selected ? PURPLE : '#fff', stroke: PURPLE, 'stroke-width': 2.5 });
      g.append(dot);
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        selected = i;
        try { g.setPointerCapture(e.pointerId); } catch { /* the drag still follows on the group */ }
        drag = { i, pointer: e.pointerId, moved: false };
      });
      g.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointer) return;
        const q = svgPoint(e);
        const first = drag.i === 0; const last = drag.i === draftPoints.length - 1;
        const lo = first ? 0 : draftPoints[drag.i - 1].t + BEND_CURVE_MIN_GAP;
        const hi = first ? 0 : last ? 1 : draftPoints[drag.i + 1].t - BEND_CURVE_MIN_GAP;
        const t = first ? 0 : Math.min(hi, Math.max(lo, Math.round(toT(q.x) * 20) / 20));
        const raw = toS(q.y);
        // the first point is fixed, except for a pre-bend (it is the amount: whole semitones, vertical only); the last one snaps to whole semitones
        const firstFree = wheel || info.kind === 'pre' || (aux && info.type === 'scoop');
        const lastWhole = !wheel && (info.kind === 'single' || info.kind === 'chain' || (info.kind === 'pre' && info.hops > 1));
        const s = first ? (firstFree ? Math.max(yMin, Math.min(yMax, info.kind === 'pre' ? Math.round(raw) : Math.round(raw * 2) / 2)) : pts[0].s)
          : Math.max(yMin, Math.min(yMax, last && lastWhole ? Math.round(raw) : Math.round(raw * 2) / 2));
        draftPoints[drag.i] = { ...draftPoints[drag.i], t, s };
        drag.moved = true;
        dot.setAttribute('cx', X(t)); dot.setAttribute('cy', Y(s));
        g.firstChild.setAttribute('cx', X(t)); g.firstChild.setAttribute('cy', Y(s));
        line.setAttribute('points', polyOf(draftPoints));
        drawHandles(draftPoints, selected);
      });
      const end = (e) => {
        const d = drag; drag = null;
        if (!d || e.pointerId !== d.pointer) return;
        if (d.moved) commit(draftPoints); else draw();
      };
      g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
      svg.append(g);
    });
    drawHandles(draftPoints, selected);
    // tap on an empty place: add a point there (snapped to 5 % and a half semitone)
    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-point]')) return;
      if (pts.length >= BEND_CURVE_MAX_POINTS) { message = label('bendGraph.tooMany'); draw(); return; }
      const q = svgPoint(e);
      const t = Math.round(toT(q.x) * 20) / 20;
      if (t <= 0 || t >= 1 || pts.some((p) => Math.abs(p.t - t) < BEND_CURVE_MIN_GAP)) return;
      const s = Math.max(yMin, Math.min(yMax, Math.round(toS(q.y) * 2) / 2));
      const next = [...pts, { t, s }].sort((a, b) => a.t - b.t);
      selected = next.findIndex((p) => p.t === t);
      commit(next);
    });

    const head = el('div', { class: 'bg-head' },
      el('span', { class: 'bg-title' }, label(wheel ? 'wheel.title' : 'bendGraph.title')),
      el('button', { type: 'button', 'data-bend-graph-action': 'close', 'aria-label': label('bendGraph.close'), title: label('bendGraph.close'), onclick: () => api.close() }, '✕'));
    head.addEventListener('pointerdown', (e) => {
      if (mode() !== 'floating' || e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      const off = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      const move = (ev) => { dragged = clampWindow({ left: ev.clientX - off.dx, top: ev.clientY - off.dy, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }); panel.style.left = `${dragged.left}px`; panel.style.top = `${dragged.top}px`; };
      const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
    });
    const canDelete = selected > 0 && selected < pts.length - 1;
    const body = el('div', { class: 'bg-body' },
      svg,
      el('div', { class: 'bg-row' },
        el('button', { type: 'button', 'data-bend-graph-action': 'delete-point', disabled: !canDelete,
          onclick: () => commit(pts.filter((_, i) => i !== selected)) }, label('bendGraph.deletePoint')),
        el('button', { type: 'button', 'data-bend-graph-action': 'curve', 'aria-pressed': String(Boolean(hSel?.h)),
          onclick: () => {
            const next = pts.map((p) => ({ ...p, ...(p.h ? { h: [...p.h] } : {}) }));
            const p = next[selected];
            if (p.h) delete p.h;
            else {
              const gaps = [next[selected - 1] ? p.t - next[selected - 1].t : 1, next[selected + 1] ? next[selected + 1].t - p.t : 1];
              p.h = [Math.round(Math.min(...gaps) * 33) / 100, 0]; // horizontal tangent, a third of the nearest gap
            }
            commit(next);
          } }, label('bendGraph.curve')),
        el('button', { type: 'button', 'data-bend-graph-action': 'reset', disabled: !info.custom,
          onclick: () => { try { message = ''; app.resetBendCurve(entryId); } catch (e) { message = String(e?.message ?? e); } draw(); } }, label('bendGraph.reset')),
        el('span', { 'data-bend-graph-amount': '' }, wheel ? `${info.semitones > 0 ? '+' : ''}${info.semitones} ${label('wheel.unit')}` : `${Math.abs(info.semitones)} ${label('marks.bend.unit')}`)),
      player ? el('div', { class: 'bg-row', 'data-bend-graph-listen': '' },
        el('button', { type: 'button', 'data-bend-graph-action': 'play', 'aria-pressed': String(hearing()), title: label(hearing() ? 'bendGraph.stop' : 'bendGraph.play'), onclick: listen }, hearing() ? '■' : '▶'),
        ...['before', 'after'].map((k) => el('span', { class: 'bg-hint', style: 'display:inline-flex;align-items:center;gap:2px;margin-left:14px' },
          el('button', { type: 'button', 'data-bend-graph-action': `${k}-less`, 'aria-label': label(`bendGraph.${k}`), onclick: () => { around[k] = Math.max(0, around[k] - 1); saveAround(); draw(); } }, '−'),
          el('output', { 'data-bend-graph-around': k, style: 'min-width:5.5em;text-align:center' }, label(`bendGraph.${k}Count`, { n: around[k] })),
          el('button', { type: 'button', 'data-bend-graph-action': `${k}-more`, 'aria-label': label(`bendGraph.${k}`), onclick: () => { around[k] = Math.min(8, around[k] + 1); saveAround(); draw(); } }, '+')))) : null,
      wheel && info.chordSize > 1 ? el('div', { class: 'bg-row', role: 'group', 'aria-label': label('wheel.scopeHint'), title: label('wheel.scopeHint') },
        ...['chord', 'note'].map((scope) => el('button', { type: 'button', 'data-bend-graph-action': `scope-${scope}`, 'aria-pressed': String(info.scope === scope),
          style: info.scope === scope ? 'background:var(--accent-soft,#d6e6ff);border:2px solid var(--sel-edge,#2d78ff)' : '',
          onclick: () => { try { message = ''; app.setWheelScope(entryId, scope); } catch (e) { message = String(e?.message ?? e); } draw(); } }, label(scope === 'chord' ? 'wheel.scopeChord' : 'wheel.scopeNote')))) : null,
      wheel && info.beats ? el('div', { class: 'bg-hint', 'data-wheel-length': '' }, label('wheel.length', { beats: Math.round(info.beats * 100) / 100 })) : null,
      el('div', { class: 'bg-hint' }, label(wheel ? 'wheel.hint' : 'bendGraph.hint')),
      el('div', { role: 'status', style: 'min-height:18px;color:var(--danger-ink,#b00020)', 'data-bend-graph-message': '' }, message));
    if (!panel) {
      panel = el('div', { 'data-bend-graph': '', 'data-resizable': 'bendGraph', 'data-zoom-lock': '', role: 'dialog', 'aria-modal': 'true', 'aria-label': label(wheel ? 'wheel.title' : 'bendGraph.title') });
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected > 0) { e.preventDefault(); const cur = app.bendCurve(entryId); if (cur && selected < cur.points.length - 1) commit(cur.points.filter((_, i) => i !== selected)); }
      });
      panel.addEventListener('panelmoved', (e) => { dragged = { left: e.detail.left, top: e.detail.top }; });
      document.body.append(panel);
    }
    panel.replaceChildren(head, body);
    place();
    clearNow(panel, anchorOfRefs([entryId])); // never over the bend it edits
  }

  const onResize = () => { if (panel) place(); };
  window.addEventListener('resize', onResize);
  const off = app.doc.subscribe(() => { if (entryId != null) draw(); });
  let wasPlaying = false; // the ▶ / ■ button follows the player (the stretch ends by itself)
  const offPlayer = player?.subscribe((s) => { if (entryId != null && s.playing !== wasPlaying) { wasPlaying = s.playing; draw(); } });
  const offOutside = dismissOnOutside(() => panel, () => api.close());
  const api = {
    open(id) { entryId = id; selected = 0; message = ''; draw(); },
    close() { if (entryId != null && hearing()) player.pause(); entryId = null; panel?.remove(); panel = null; },
    isOpen: () => entryId != null,
    destroy() { api.close(); off(); offPlayer?.(); offOutside(); window.removeEventListener('resize', onResize); },
  };
  return api;
}
