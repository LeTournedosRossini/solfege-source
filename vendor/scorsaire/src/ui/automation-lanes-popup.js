/*
 * The small menu that chooses which automation curves a track shows (volume, pan, expression, reverb, chorus, brightness, modulation: any of them, stacked in that order),
 * and the little icon of the button that opens it. Shared by the mixer column and the floating controls of each track. One menu at a time; it closes on a press outside or Escape.
 */
import { AUTOMATION_LANE_ORDER } from '../model/automation.js';

const NSV = 'http://www.w3.org/2000/svg';

/** The icon of an automation button: a small curve with its points. */
export function automationIcon(size = 18) {
  const svg = document.createElementNS(NSV, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'display:block;margin:auto';
  const line = document.createElementNS(NSV, 'polyline');
  line.setAttribute('points', '2,18 8,8 14,14 22,5'); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linejoin', 'round'); svg.append(line);
  for (const [x, y] of [[8, 8], [14, 14], [22, 5]]) {
    const c = document.createElementNS(NSV, 'circle');
    c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', '2.2'); c.setAttribute('fill', 'currentColor'); svg.append(c);
  }
  return svg;
}

let current = null; // { pop, anchor, off }

export function closeLanesPopup() { if (!current) return; current.off(); current.pop.remove(); current = null; }

/** Opens the menu of track `id` next to `anchor` (a press on the same anchor again closes it). */
export function toggleLanesPopup({ app, label, id, anchor }) {
  if (current && current.anchor === anchor) { closeLanesPopup(); return; }
  closeLanesPopup();
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, String(v)); } e.append(...kids); return e; };
  const pop = el('div', { 'data-automation-lanes-popup': id, role: 'dialog', 'aria-label': label('automation.lanesTitle'), style: 'position:fixed;z-index:3700;display:flex;flex-direction:column;gap:var(--btn-gap,2px);padding:6px;background:var(--field,#fff);color:var(--ink,#111);border:1px solid var(--edge,#888);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);font:13px var(--ui-font,sans-serif)' });
  const buttons = AUTOMATION_LANE_ORDER.map((param) => el('button', {
    type: 'button', 'data-lane': param, style: 'min-height:var(--ui-target,30px);padding:0 12px;text-align:left;font:inherit',
    onclick: () => { const cur = app.automationLanes(id); app.setAutomationLanes(id, cur.includes(param) ? cur.filter((q) => q !== param) : [...cur, param]); paint(); },
  }, label(`automation.lane.${param}`)));
  const paint = () => {
    const on = app.automationLanes(id);
    for (const b of buttons) { const active = on.includes(b.getAttribute('data-lane')); b.setAttribute('aria-pressed', String(active)); b.style.background = active ? 'var(--btn-on,#e2e0da)' : ''; b.style.border = active ? '2px solid var(--btn-on-line,#b9b4a8)' : ''; }
  };
  pop.append(el('div', { style: 'font-size:12px;opacity:.75;margin:0 2px 2px' }, label('automation.lanesTitle')), ...buttons);
  paint();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  const above = r.top - pop.offsetHeight - 4;
  pop.style.top = `${above >= 4 ? above : Math.min(window.innerHeight - pop.offsetHeight - 4, r.bottom + 4)}px`; // above the button when there is room, else below it
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeLanesPopup(); };
  const onKey = (e) => { if (e.key === 'Escape') closeLanesPopup(); };
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey, true);
  current = { pop, anchor, off: () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); } };
}
