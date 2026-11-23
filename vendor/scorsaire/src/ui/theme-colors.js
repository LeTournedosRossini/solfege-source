/*
 * The interface colours the user can change (a DEVICE setting, never in the document): seven tokens, each with a colour, a saturation and an opacity.
 * A token that was never touched is not applied at all (the CSS fallbacks stay), so the default look is exactly the one the stylesheets have.
 * Pure parts (colour maths, `computeColor`) are testable without a DOM; `applyColors` writes CSS variables on the root element.
 */
export const COLOR_TOKENS = Object.freeze([
  { id: 'score', vars: ['--score'], def: '#ffffff', defDark: '#101012' },               // the surface under the score (screens 1, 2, 3)
  { id: 'paper', vars: ['--paper', '--bg'], def: '#faf8f4', defDark: '#18181b' },     // page and score background
  { id: 'sideTabs', vars: ['--side-tabs'], def: '#f4f1ea', defDark: '#141417' },      // behind the tabs of the side panel
  { id: 'module', vars: ['--module'], def: '#fcfbf8', defDark: '#202024' },           // behind the modules of the side panel (Model / + Track…)
  { id: 'row', vars: ['--row'], def: '#cacad2', defDark: '#2d2d33' },                 // the track bars of the side panel
  { id: 'bar', vars: ['--bar'], def: '#fdfcfa', defDark: '#232328' },                 // floating bars and the bottom dock
  { id: 'btn', vars: ['--btn'], def: '#fdfcfa', defDark: '#2a2a2f' },                 // inside of the buttons
  { id: 'btnOn', vars: ['--btn-on'], line: '--btn-on-line', def: '#e2e0da', defDark: '#3d3829' }, // switched-on two-state buttons
  { id: 'select', vars: ['--select'], def: '#e8964a' },             // the colour of a selected note (soft orange)
  { id: 'selectEdge', vars: ['--select-edge'], def: '#f2780c' },   // the thin outline around a selected note (a livelier orange)
]);
/** Four ready-made looks for a selected note: the body colour and the livelier outline around it. Anything else is picked with the two colour rows. */
export const SELECT_PRESETS = Object.freeze([
  { id: 'orange', color: '#e8964a', edge: '#f2780c' },
  { id: 'blue', color: '#5b9be8', edge: '#1d6fe0' },
  { id: 'green', color: '#6db58a', edge: '#2e9e55' },
  { id: 'brown', color: '#b07a4f', edge: '#8a5429' },
]);
export const COLORS_KEY = 'scorsaire.colors';

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function toHex([r, g, b]) { return `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`; }

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b); const l = (max + min) / 2; const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** `{ color: '#rrggbb', sat (0..2, 1 = as chosen), alpha (0.1..1) }` → the CSS colour (rgb when opaque, rgba otherwise); null for an invalid colour. */
export function computeColor({ color, sat = 1, alpha = 1 }) {
  const rgb = parseHex(color); if (!rgb) return null;
  const [h, s, l] = rgbToHsl(rgb);
  const out = hslToRgb([h, Math.max(0, Math.min(1, s * (Number.isFinite(sat) ? sat : 1))), l]).map(Math.round);
  const a = Math.max(0.1, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return a >= 0.999 ? `rgb(${out.join(',')})` : `rgba(${out.join(',')},${Math.round(a * 100) / 100})`;
}
/** The same colour, a little darker (border of a switched-on button). */
export function darker(css, by = 0.12) {
  const m = /rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/.exec(css); if (!m) return css;
  const [h, s, l] = rgbToHsl([+m[1], +m[2], +m[3]]);
  const [r, g, b] = hslToRgb([h, s, Math.max(0, l - by)]).map(Math.round);
  return m[4] ? `rgba(${r},${g},${b},${m[4]})` : `rgb(${r},${g},${b})`;
}

export function loadColors(storage) {
  try { const raw = JSON.parse(storage?.getItem(COLORS_KEY) ?? '{}'); return raw && typeof raw === 'object' ? raw : {}; } catch { return {}; }
}
export function saveColors(storage, settings) { try { storage?.setItem(COLORS_KEY, JSON.stringify(settings)); } catch { /* storage may be refused */ } }

/** Writes (or removes) the CSS variables of every token. */
export function applyColors(settings, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return;
  for (const t of COLOR_TOKENS) {
    const css = settings[t.id] ? computeColor(settings[t.id]) : null;
    for (const v of t.vars) { if (css) root.style.setProperty(v, css); else root.style.removeProperty(v); }
    if (t.line) { if (css) root.style.setProperty(t.line, darker(css)); else root.style.removeProperty(t.line); }
  }
}

/** Hue range offered by the editor around a token's own tones (± degrees): it stays among the creams / whites / greys of that token. */
export const HUE_SPAN = 30;
export const SAT_MAX = 0.5;   // the pad goes from grey to this saturation
export const LIGHT_MIN = 0.3; // ... and from this lightness up to white

/** What the pad / sliders show for a token: the base colour (hue, saturation, lightness), the multiplier and the opacity, and the final CSS values. */
export function describeColor({ color, sat = 1, alpha = 1 }) {
  const rgb = parseHex(color) ?? [255, 255, 255];
  const [h, s, l] = rgbToHsl(rgb);
  const css = computeColor({ color: toHex(rgb), sat, alpha });
  const m = /rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/.exec(css);
  const final = [+m[1], +m[2], +m[3]]; const a = m[4] != null ? +m[4] : 1;
  const [fh, fs, fl] = rgbToHsl(final);
  const hex = toHex(final);
  return { hue: Math.round(h), sBase: Math.round(s * 100), lBase: Math.round(l * 100), sat, alpha: a, css, hex, hex8: a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex, hsl: `hsl(${Math.round(fh)}, ${Math.round(fs * 100)}%, ${Math.round(fl * 100)}%)` };
}

/** A narrow colour editor: a pad (saturation across, lightness down) at a hue that can only move a little around the token's own tones, plus hue, saturation and opacity sliders with their real values. */
export function openColorEditor({ token, get, set, anchor, label, onClose = () => {} }) {
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); } n.append(...kids.filter((c) => c != null)); return n; };
  const defHue = rgbToHsl(parseHex(token.def))[1] < 0.02 ? 40 : rgbToHsl(parseHex(token.def))[0];
  const W = 240, H = 150;
  const box = el('div', { 'data-color-editor': token.id, role: 'dialog', 'data-dismiss-keep': '', 'aria-label': label(`colors.${token.id}`), style: 'position:fixed;z-index:3600;width:272px;box-sizing:border-box;padding:10px;background:var(--paper,#faf8f4);border:1px solid var(--line,#d8d3c8);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:13px var(--ui-font,sans-serif);display:flex;flex-direction:column;gap:8px' });
  const pad = el('canvas', { width: W, height: H, 'data-color-pad': '', style: `width:${W}px;height:${H}px;border:1px solid var(--edge,#bbb);border-radius:6px;touch-action:none;cursor:crosshair` });
  const thumb = el('div', { style: 'position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none' });
  const padWrap = el('div', { style: `position:relative;width:${W}px;height:${H}px` }, pad, thumb);
  const read = el('div', { 'data-color-readout': '', style: 'font:12px/1.5 monospace;user-select:text;white-space:pre-wrap;word-break:break-all' });
  const rows = {};
  const slider = (id, min, max, step, text) => {
    const input = el('input', { type: 'range', min, max, step, 'data-color-slider': id, style: 'flex:1;min-width:0' });
    const val = el('span', { style: 'min-width:3.6em;text-align:right;font:12px monospace' });
    rows[id] = { input, val };
    return el('label', { style: 'display:flex;align-items:center;gap:6px' }, el('span', { style: 'width:5.5em' }, label(text)), input, val);
  };
  const cur = () => get();
  const hueBounds = () => { const h = rgbToHsl(parseHex(cur().color) ?? [255, 255, 255])[0]; const lo = Math.min(defHue - HUE_SPAN, h), hi = Math.max(defHue + HUE_SPAN, h); return [Math.max(0, Math.floor(lo)), Math.min(360, Math.ceil(hi))]; };
  const hueAt = () => rgbToHsl(parseHex(cur().color) ?? [255, 255, 255])[0];
  const draw = () => {
    const ctx = pad.getContext('2d'); if (!ctx) return;
    const h = hueAt(); const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [r, g, b] = hslToRgb([h, (x / (W - 1)) * SAT_MAX, 1 - (y / (H - 1)) * (1 - LIGHT_MIN)]); const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  const sync = () => {
    const c = cur(); const d = describeColor(c); const [h, s, l] = rgbToHsl(parseHex(c.color) ?? [255, 255, 255]);
    thumb.style.left = `${Math.min(1, s / SAT_MAX) * (W - 1)}px`; thumb.style.top = `${Math.min(1, Math.max(0, (1 - l) / (1 - LIGHT_MIN))) * (H - 1)}px`;
    const [lo, hi] = hueBounds(); rows.hue.input.min = String(lo); rows.hue.input.max = String(hi); rows.hue.input.value = String(Math.round(h)); rows.hue.val.textContent = `${Math.round(h)}°`;
    rows.sat.input.value = String(Math.round(c.sat * 100)); rows.sat.val.textContent = `${Math.round(c.sat * 100)} %`;
    rows.alpha.input.value = String(Math.round(c.alpha * 100)); rows.alpha.val.textContent = `${Math.round(c.alpha * 100)} %`;
    read.textContent = `${label('colors.base')} : ${toHex(parseHex(c.color) ?? [255, 255, 255])}  (${label('colors.hue')} ${d.hue}°, ${label('colors.sat')} ${d.sBase} %, ${label('colors.light')} ${d.lBase} %)\n${label('colors.final')} : ${d.hex8}  ${d.css}  ${d.hsl}`;
    box.style.setProperty('--sw', d.css);
  };
  const apply = (patch) => { set(patch); draw(); sync(); };
  const fromPad = (e) => {
    const r = pad.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    apply({ color: toHex(hslToRgb([hueAt(), x * SAT_MAX, 1 - y * (1 - LIGHT_MIN)])) });
  };
  let dragging = false;
  pad.addEventListener('pointerdown', (e) => { dragging = true; pad.setPointerCapture?.(e.pointerId); fromPad(e); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (dragging) fromPad(e); });
  const end = () => { dragging = false; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  box.append(
    el('div', { style: 'display:flex;align-items:center;gap:8px' }, el('strong', { style: 'flex:1' }, label(`colors.${token.id}`)), el('span', { style: 'width:28px;height:20px;border:1px solid var(--edge,#888);border-radius:4px;background:var(--sw,#fff)' }), el('button', { type: 'button', 'data-color-close': '', 'aria-label': label('colors.close'), onclick: () => close() }, '✕')),
    padWrap,
    slider('hue', 0, 360, 1, 'colors.hue'), slider('sat', 0, 200, 1, 'colors.sat'), slider('alpha', 10, 100, 1, 'colors.alpha'),
    read,
    el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px' }, el('span', {}, label('colors.free')), el('input', { type: 'color', 'data-color-free': '', value: toHex(parseHex(cur().color) ?? [255, 255, 255]), oninput: (e) => apply({ color: e.target.value }) })));
  rows.hue.input.addEventListener('input', () => { const [, s, l] = rgbToHsl(parseHex(cur().color) ?? [255, 255, 255]); apply({ color: toHex(hslToRgb([Number(rows.hue.input.value), s, l])) }); });
  rows.sat.input.addEventListener('input', () => apply({ sat: Number(rows.sat.input.value) / 100 }));
  rows.alpha.input.addEventListener('input', () => apply({ alpha: Number(rows.alpha.input.value) / 100 }));
  document.body.append(box);
  const place = () => { const r = anchor.getBoundingClientRect(); const bw = box.offsetWidth, bh = box.offsetHeight; box.style.left = `${Math.max(8, Math.min(window.innerWidth - bw - 8, r.left - bw - 8 > 8 ? r.left - bw - 8 : r.right + 8))}px`; box.style.top = `${Math.max(8, Math.min(window.innerHeight - bh - 8, r.top - 40))}px`; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  function close() { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); box.remove(); onClose(); }
  document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onDown, true);
  draw(); sync(); place();
  return { close, element: box };
}

/** The "Colours" section of the settings panel. */
export function buildColorSection({ label, storage, onChange = () => {} }) {
  const settings = loadColors(storage);
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); } n.append(...kids.filter((c) => c != null)); return n; };
  const commit = () => { saveColors(storage, settings); applyColors(settings); onChange(settings); };
  let editor = null;
  const rows = COLOR_TOKENS.map((t) => {
    const isDark = () => document.documentElement.hasAttribute('data-dark');
    const cur = () => settings[t.id] ?? { color: (isDark() && t.defDark) || t.def, sat: 1, alpha: 1 };
    const shown = el('span', { style: 'font:12px monospace;color:var(--ink-soft,#555);min-width:5.5em' });
    const swatch = el('button', { type: 'button', 'data-color': t.id, 'aria-label': label(`colors.${t.id}`), title: label('colors.edit'), style: 'width:44px;height:30px;padding:0;border:1px solid var(--edge,#888);border-radius:6px' });
    const paint = () => { const d = describeColor(cur()); swatch.style.background = d.css; shown.textContent = d.hex8; };
    const set = (patch) => { settings[t.id] = { ...cur(), ...patch }; commit(); paint(); };
    swatch.addEventListener('click', () => { editor?.close(); editor = openColorEditor({ token: t, get: cur, set, anchor: swatch, label, onClose: () => { editor = null; } }); });
    const reset = el('button', { type: 'button', 'data-color-reset': t.id, title: label('colors.reset'), 'aria-label': label('colors.reset'), onclick: () => { delete settings[t.id]; commit(); paint(); editor?.close(); } }, '↺');
    paint();
    return { row: el('div', { class: 'st-row', 'data-color-row': t.id, style: 'flex-wrap:wrap;gap:8px' }, el('span', { class: 'st-label', style: 'flex:1 1 11em' }, label(`colors.${t.id}`)), swatch, shown, reset), paint };
  });
  const resetAll = el('button', { type: 'button', 'data-color-reset-all': '', onclick: () => { for (const k of Object.keys(settings)) delete settings[k]; commit(); rows.forEach((r) => r.paint()); editor?.close(); } }, label('colors.resetAll'));
  const presetRow = el('div', { class: 'st-row', 'data-select-presets': '', style: 'flex-wrap:wrap;gap:8px;align-items:center' }, el('span', { class: 'st-label', style: 'flex:1 1 11em' }, label('colors.selectPresets')),
    ...SELECT_PRESETS.map((pr) => el('button', { type: 'button', 'data-select-preset': pr.id, title: label(`colors.preset.${pr.id}`), 'aria-label': label(`colors.preset.${pr.id}`), style: `width:44px;height:30px;border-radius:15px;cursor:pointer;border:3px solid ${pr.edge};background:${pr.color}`,
      onclick: () => { settings.select = { color: pr.color, sat: 1, alpha: 1 }; settings.selectEdge = { color: pr.edge, sat: 1, alpha: 1 }; commit(); rows.forEach((r) => r.paint()); editor?.close(); } })));
  const selectIdx = rows.findIndex((r) => r.row.getAttribute('data-color-row') === 'select');
  const rowEls = rows.map((r) => r.row); rowEls.splice(selectIdx < 0 ? rowEls.length : selectIdx, 0, presetRow);
  return el('section', { class: 'st-section', 'data-section': 'colors' }, el('h3', {}, label('settings.section.colors')), ...rowEls, el('div', { class: 'st-row' }, resetAll));
}
