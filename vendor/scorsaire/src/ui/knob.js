/*
 * A round knob (DOM): drag up / down, mouse wheel, arrows; a double click goes back to the default value. Used for the volumes of the stems (screen 4).
 * `onChange(v)` is called at every move with the new value; `setValue(v)` moves it from outside without calling `onChange`.
 */
export function createKnob({ min = 0, max = 100, value = 100, def = value, step = 1, size = 38, readout: showReadout = true, label = '', title = label, onChange = () => {}, format = (v) => String(v) } = {}) {
  const el = document.createElement('div');
  el.setAttribute('role', 'slider'); el.tabIndex = 0; el.setAttribute('aria-label', label); el.title = title;
  el.setAttribute('aria-valuemin', String(min)); el.setAttribute('aria-valuemax', String(max)); el.setAttribute('data-knob', '');
  el.style.cssText = `width:${size}px;height:${size}px;box-sizing:border-box;border-radius:50%;border:2px solid #8a857a;background:radial-gradient(circle at 35% 30%, var(--field,#fff), var(--track,#e9e5da));position:relative;cursor:ns-resize;touch-action:none;flex:none;user-select:none;-webkit-user-select:none`;
  const needle = document.createElement('div');
  needle.style.cssText = `position:absolute;left:50%;top:3px;width:3px;height:${Math.round(size * 0.36)}px;margin-left:-1.5px;background:#333;border-radius:2px;transform-origin:1.5px ${Math.round(size * 0.36)}px`;
  el.append(needle);
  const readout = document.createElement('span');
  readout.style.cssText = 'position:absolute;left:0;right:0;bottom:-15px;text-align:center;font:11px var(--ui-font,sans-serif);color:var(--ink-soft,#555);pointer-events:none';
  if (showReadout) el.append(readout);
  let v = value;
  const paint = () => { needle.style.transform = `rotate(${-135 + ((v - min) / (max - min)) * 270}deg)`; el.setAttribute('aria-valuenow', String(v)); readout.textContent = format(v); };
  const set = (n, emit = true) => { const c = Math.max(min, Math.min(max, Math.round(n / step) * step)); if (c === v && emit) return; v = c; paint(); if (emit) onChange(v); };
  let drag = null;
  el.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, v }; el.setPointerCapture?.(e.pointerId); e.preventDefault(); el.focus({ preventScroll: true }); });
  el.addEventListener('pointermove', (e) => { if (drag) set(drag.v + (drag.y - e.clientY) * ((max - min) / 120)); });
  const end = () => { drag = null; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(v + (e.deltaY < 0 ? 1 : -1) * Math.max(step, (max - min) / 40)); }, { passive: false });
  el.addEventListener('keydown', (e) => { const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); set(v + d * Math.max(step, (max - min) / 40)); } });
  el.addEventListener('dblclick', () => set(def));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  paint();
  return { el, value: () => v, setValue: (n) => set(n, false) };
}
