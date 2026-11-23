/*
 * A colour button with a full editor behind it: a button that shows the colour; a press opens a small panel with swatches (one press = that colour) and, under them, the complete
 * editing — hue, saturation, lightness and the hex code — for any colour at all. The colour changes live while a slider moves (`onInput`) and is final when the panel is closed
 * (`onChange`). The helpers `hexToHsl` / `hslToHex` are pure. Writes nothing by itself.
 */
export const PICKER_SWATCHES = Object.freeze(['#000000', '#555555', '#999999', '#dddddd', '#ffffff', '#c62828', '#ef6c00', '#f9a825', '#2e7d32', '#00838f', '#1565c0', '#6a1b9a', '#ad1457', '#6d4c41', '#cfe0f5', '#f5d9d4', '#d8ecd3', '#efe3c2', '#e0d6ef', '#d3ecec']);

export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m) return { h: 0, s: 0, l: 100 };
  const n = parseInt(m[1], 16); const r = (n >> 16) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2; const d = max - min;
  let h = 0; let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToHex({ h, s, l }) {
  const S = s / 100; const L = l / 100; const c = (1 - Math.abs(2 * L - 1)) * S; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function el(tag, css = '', attrs = {}) { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

/**
 * @param o.value     the colour now (`#rrggbb`)
 * @param o.title     the tooltip and accessible name
 * @param o.onInput   called with each colour while it changes
 * @param o.onChange  called with the final colour when the panel closes (only if it changed)
 * @param o.label(k)  the translator (keys `colorPicker.*`), optional
 */
export function createColorPicker({ value = '#ffffff', title = '', swatches = PICKER_SWATCHES, onInput = () => {}, onChange = () => {}, label = (k) => k } = {}) {
  let cur = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ffffff'; let opened = null; let atOpen = cur;
  const button = el('button', 'width:30px;height:30px;min-width:30px;padding:0;border:1px solid var(--line,#bbb);border-radius:6px;cursor:pointer;box-sizing:border-box', { type: 'button', title, 'aria-label': title, 'aria-haspopup': 'dialog' });
  const paint = () => { button.style.background = cur; };
  paint();

  const close = () => {
    if (!opened) return; const { panel, off } = opened; opened = null; off(); panel.remove();
    if (cur !== atOpen) onChange(cur);
  };
  const apply = (hex, final = false) => { cur = hex.toLowerCase(); paint(); onInput(cur); if (final) close(); };
  const open = () => {
    if (opened) { close(); return; }
    atOpen = cur;
    const panel = el('div', 'position:fixed;z-index:3600;width:236px;padding:10px;background:var(--paper,#fff);border:1px solid var(--edge,#999);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:12px var(--ui-font,sans-serif);box-sizing:border-box', { role: 'dialog', 'aria-label': title, 'data-color-picker': '', 'data-dismiss-keep': '', 'data-zoom-lock': '' });
    const grid = el('div', 'display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin-bottom:10px');
    for (const c of swatches) {
      const b = el('button', `height:19px;min-width:0;padding:0;border-radius:4px;border:${c === cur ? '2px solid #2b6cff' : '1px solid rgba(0,0,0,.35)'};background:${c};cursor:pointer`, { type: 'button', title: c, 'aria-label': c });
      b.addEventListener('click', () => apply(c, true)); grid.append(b);
    }
    const hsl = hexToHsl(cur);
    const slider = (name, key, max, bg) => {
      const row = el('div', 'display:flex;align-items:center;gap:6px;margin:4px 0');
      const lab = el('span', 'width:14px;color:var(--ink-soft,#555)'); lab.textContent = name;
      const input = el('input', `flex:1;height:14px;min-width:0;-webkit-appearance:none;appearance:none;border-radius:7px;background:${bg};border:1px solid rgba(0,0,0,.25)`, { type: 'range', min: '0', max: String(max), value: String(hsl[key]), 'aria-label': label(`colorPicker.${key}`) });
      row.append(lab, input); return { row, input };
    };
    const H = slider('H', 'h', 360, 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)');
    const S = slider('S', 's', 100, 'linear-gradient(90deg,#808080,#f00)'); const L = slider('L', 'l', 100, 'linear-gradient(90deg,#000,#fff)');
    const hex = el('input', 'width:84px;height:28px;font:14px monospace;border:1px solid var(--edge,#999);border-radius:6px;padding:0 6px;box-sizing:border-box', { type: 'text', value: cur, maxlength: '7', 'aria-label': label('colorPicker.hex') });
    const preview = el('div', 'flex:1;height:28px;border:1px solid rgba(0,0,0,.35);border-radius:6px'); preview.style.background = cur;
    const bottom = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px'); bottom.append(hex, preview);
    const fromSliders = () => { const c = hslToHex({ h: +H.input.value, s: +S.input.value, l: +L.input.value }); hex.value = c; preview.style.background = c; apply(c); };
    for (const s of [H, S, L]) s.input.addEventListener('input', fromSliders);
    hex.addEventListener('input', () => { let v = hex.value.trim(); if (!v.startsWith('#')) v = `#${v}`; if (/^#[0-9a-f]{6}$/i.test(v)) { const q = hexToHsl(v); H.input.value = q.h; S.input.value = q.s; L.input.value = q.l; preview.style.background = v; apply(v); } });
    S.input.style.background = `linear-gradient(90deg,${hslToHex({ h: hsl.h, s: 0, l: 50 })},${hslToHex({ h: hsl.h, s: 100, l: 50 })})`;
    panel.append(grid, H.row, S.row, L.row, bottom);
    document.body.append(panel);
    const r = button.getBoundingClientRect(); const w = panel.offsetWidth; const h = panel.offsetHeight; const vw = window.visualViewport?.width ?? window.innerWidth; const vh = window.visualViewport?.height ?? window.innerHeight;
    panel.style.left = `${Math.max(6, Math.min(r.left, vw - w - 6))}px`; panel.style.top = `${r.bottom + 6 + h <= vh ? r.bottom + 6 : Math.max(6, r.top - h - 6)}px`;
    const away = (e) => { if (!panel.contains(e.target) && !button.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
    opened = { panel, off: () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); } };
  };
  button.addEventListener('click', open);
  return { el: button, value: () => cur, setValue(v) { if (/^#[0-9a-f]{6}$/i.test(v ?? '') && v.toLowerCase() !== cur) { cur = v.toLowerCase(); paint(); } }, close, destroy: close };
}
