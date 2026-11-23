/*
 * Composite staves of one track, in the tracks panel: a composite is ONE staff that shows, measure by measure, one of the track's staves (model/composite.js).
 * Each composite is a small card: name, the staff shown by default (the base), "same height", and a strip of the movement's measures coloured by the staff each one shows.
 * Painting the strip (a click or a drag over measures, with the chosen staff as the brush) writes ONE range. The staves of screen 1 are not touched: this is a display.
 */
import { JUNCTION_STYLES } from '../model/composite.js';

/** A small drawing (SVG) of a junction bar on a five-line staff: what the cycling button shows. */
function junctionPreview(style) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '34'); svg.setAttribute('height', '24'); svg.setAttribute('viewBox', '0 0 34 24'); svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
  for (let k = 0; k < 5; k++) add('line', { x1: 0, x2: 34, y1: 4 + k * 4, y2: 4 + k * 4, stroke: 'currentColor', 'stroke-width': 0.7, opacity: 0.6 });
  const bar = (x, w) => add('line', { x1: x, x2: x, y1: 3, y2: 21, stroke: 'currentColor', 'stroke-width': w });
  const lozenge = (cx, cy, hw, hh, hollow = false) => add('polygon', { points: `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`, fill: hollow ? 'var(--field,#fff)' : 'currentColor', stroke: hollow ? 'currentColor' : 'none', 'stroke-width': 1 });
  if (!style) bar(17, 1.2);
  else if (style === 'double') { bar(14.5, 1.2); bar(19.5, 1.2); }
  else if (style === 'thick') bar(17, 4);
  else { bar(13, 1.2); bar(21, 1.2); if (style === 'lozengeTriple') { lozenge(17, 12, 3, 4.5); lozenge(17, 5.5, 2, 3); lozenge(17, 18.5, 2, 3); } else lozenge(17, 12, style === 'lozengeHollow' ? 3.2 : 3, style === 'lozengeHollow' ? 5 : 4.5, style === 'lozengeHollow'); }
  return svg;
}

const COLORS = ['#8fb4d9', '#e3b569', '#9ccb9c', '#c9a0d8']; // one per staff of the track, in order
/** The staff each composite paints with, kept across redraws of the panel (it is rebuilt after every change). */
const brushes = new Map();
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

/** The "+ composite" block of a track: its cards and a button that creates one. `run(fn)` performs an Application call and redraws the panel. */
export function compositeSection({ app, track, label, run }) {
  const staffName = (s) => label(`staffType.${s.type}`);
  const colorOf = (staffId) => COLORS[track.staves.findIndex((s) => s.id === staffId) % COLORS.length];

  /** ONE button that cycles through every junction bar (plain, double, heavy, the three lozenges), showing a small drawing of the current one. */
  const junctionButton = (c) => {
    const states = [false, ...JUNCTION_STYLES];
    const at = Math.max(0, states.indexOf(c.junction ?? false));
    const next = states[(at + 1) % states.length];
    const name = label(`composite.junction.${c.junction || 'none'}`);
    return el('div', { class: 'tp-row tp-meta' }, el('button', { type: 'button', 'data-act': 'composite-junction', 'data-value': String(c.junction || false), title: label('composite.junction.cycle'), 'aria-label': `${label('composite.junction')} : ${name}. ${label('composite.junction.cycle')}`, style: 'display:flex;align-items:center;gap:10px', onclick: () => run(() => app.setCompositeJunction(track.id, c.id, next)) },
      junctionPreview(c.junction || false), el('span', {}, name), el('span', { 'aria-hidden': 'true', style: 'opacity:.6;font-size:12px' }, `${at + 1}/${states.length}`)));
  };

  const card = (c) => {
    const brush = brushes.get(c.id) ?? track.staves.find((s) => s.id !== c.base)?.id ?? c.base;
    const swatch = (s) => el('span', { 'aria-hidden': 'true', style: `display:inline-block;width:.9em;height:.9em;border-radius:3px;margin-right:6px;vertical-align:-.1em;background:${colorOf(s.id)}` });
    const choice = (act, current, onPick) => el('div', { class: 'tp-row tp-meta', style: 'flex-wrap:wrap;gap:4px' },
      ...track.staves.map((s) => el('button', { type: 'button', 'data-act': act, 'data-staff': s.id, 'aria-pressed': String(current === s.id), onclick: () => onPick(s.id), style: current === s.id ? 'font-weight:var(--w-bold,700)' : '' }, swatch(s), staffName(s))));
    const strip = el('div', { class: 'tp-comp-strip', 'data-composite-strip': c.id, style: 'display:flex;gap:1px;margin:6px 0;touch-action:none;user-select:none' });
    let from = null; let to = null;
    const cells = c.shown.map((staffId, i) => el('div', { 'data-m': String(i), title: `${i + 1} — ${staffName(track.staves.find((s) => s.id === staffId) ?? track.staves[0])}`, style: `flex:1 1 0;min-width:3px;height:22px;background:${colorOf(staffId)};border-radius:2px` }));
    strip.append(...cells);
    const mark = () => cells.forEach((n, i) => { const on = from !== null && i >= Math.min(from, to) && i <= Math.max(from, to); n.style.outline = on ? '2px solid var(--ink,#111)' : ''; n.style.background = on ? colorOf(brush) : colorOf(c.shown[i]); });
    const at = (e) => { const n = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-m]'); return n && strip.contains(n) ? Number(n.dataset.m) : null; };
    strip.addEventListener('pointerdown', (e) => { const i = at(e); if (i === null) return; from = to = i; strip.setPointerCapture?.(e.pointerId); mark(); e.preventDefault(); });
    strip.addEventListener('pointermove', (e) => { if (from === null) return; const i = at(e); if (i !== null && i !== to) { to = i; mark(); } });
    const end = () => { if (from === null) return; const a = Math.min(from, to); const b = Math.max(from, to); from = to = null; run(() => app.setCompositeRange(track.id, c.id, a, b, brush)); };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', () => { from = to = null; mark(); });
    return el('div', { class: 'tp-comp', 'data-composite': c.id, style: 'border:1px solid var(--edge,#888);border-radius:8px;padding:6px 8px;margin:6px 0' },
      el('div', { class: 'tp-row tp-meta' },
        el('input', { type: 'text', 'data-act': 'composite-name', value: c.name, placeholder: label('composite.namePlaceholder'), 'aria-label': label('composite.name'), style: 'flex:1;min-width:0', onchange: (e) => run(() => app.renameComposite(track.id, c.id, e.target.value)) }),
        el('button', { type: 'button', 'data-act': 'composite-remove', title: label('composite.remove'), 'aria-label': label('composite.remove'), onclick: () => run(() => app.removeComposite(track.id, c.id)) }, '🗑')),
      el('div', { class: 'tp-meta-label' }, label('composite.base')),
      choice('composite-base', c.base, (id) => run(() => app.setCompositeBase(track.id, c.id, id))),
      el('div', { class: 'tp-meta-label' }, label('composite.brush')),
      choice('composite-brush', brush, (id) => { brushes.set(c.id, id); run(() => {}); }),
      strip,
      el('div', { class: 'tp-row tp-meta', style: 'font-size:12px;opacity:.75' }, label('composite.hint')),
      el('label', { class: 'tp-row tp-meta', style: 'gap:8px' }, el('input', { type: 'checkbox', 'data-act': 'composite-preview', ...(app.compositePreviewOf(track.id) === c.id ? { checked: '' } : {}), onchange: (e) => { app.setCompositePreview(track.id, e.target.checked ? c.id : null); run(() => {}); } }), label('composite.preview')),
      el('div', { class: 'tp-meta-label' }, label('composite.junction')),
      junctionButton(c),
      el('label', { class: 'tp-row tp-meta', style: 'gap:8px' }, el('input', { type: 'checkbox', 'data-act': 'composite-junction-clef', ...(c.junctionClef ? { checked: '' } : {}), onchange: (e) => run(() => app.setCompositeJunctionClef(track.id, c.id, e.target.checked)) }), label('composite.junctionClef')),
      el('div', { class: 'tp-meta-label' }, label('composite.equal')),
      el('div', { class: 'tp-row tp-meta', style: 'flex-wrap:wrap;gap:4px' },
        ...[[false, 'composite.equal.off'], ['notation', 'composite.equal.notation'], ['tallest', 'composite.equal.tallest']].map(([value, key]) => el('button', { type: 'button', 'data-act': 'composite-equal', 'data-value': String(value), 'aria-pressed': String(c.equal === value), onclick: () => run(() => app.setCompositeEqual(track.id, c.id, value === 'notation' ? true : value)), style: c.equal === value ? 'font-weight:var(--w-bold,700)' : '' }, label(key)))),
      el('div', { class: 'tp-row tp-meta', style: 'font-size:12px;opacity:.75' }, label('composite.equal.hint')));
  };

  return el('div', { class: 'tp-composites', 'data-composites': track.id },
    el('div', { class: 'tp-row tp-meta' }, el('span', { class: 'tp-meta-label' }, label('composite.title')), el('span', { class: 'tp-spacer', style: 'flex:1' }),
      el('button', { type: 'button', 'data-act': 'composite-add', onclick: () => run(() => app.addComposite(track.id, { name: label('composite.defaultName', { n: track.composites.length + 1 }), base: track.staves[0].id })) }, label('composite.add'))),
    ...track.composites.map(card));
}
