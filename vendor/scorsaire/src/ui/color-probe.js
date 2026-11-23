/*
 * Colour probe (a DEBUGGING tool, in the settings): a small floating panel that tells which colour the screen shows at a point you aim at.
 *  - with the browser's eyedropper (`EyeDropper`, Chrome / Edge on a computer) it reads the REAL pixel, whatever draws it (antialiasing, overlays, filters…);
 *  - without it (Safari, Firefox, tablets) an inspector reads, under the pointer, the colour the element says it paints (fill / stroke / background, with
 *    the opacities) : one tap or click records it.
 * The last measures are kept in a list (a click copies the hex code). Nothing is stored or sent.
 */
const STYLE_ID = 'color-probe-style';
const CSS = `
.cp-panel { position: fixed; top: 64px; right: 12px; z-index: 5000; width: min(320px, calc(100vw - 24px)); box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; background: var(--bar,#fff); color: var(--ink,#1c1b1a); border: 1px solid var(--edge,#bbb); border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,.4); font: 13px var(--ui-font,sans-serif); }
.cp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: grab; touch-action: none; }
.cp-title { font: var(--w-bold,700) 13px var(--ui-font,sans-serif); }
.cp-main { display: flex; gap: 10px; align-items: center; min-height: 52px; }
.cp-swatch { width: 52px; height: 52px; flex: none; border-radius: 8px; border: 1px solid var(--edge,#bbb); background: repeating-conic-gradient(#8884 0 25%, transparent 0 50%) 0 0 / 12px 12px; position: relative; overflow: hidden; }
.cp-swatch > i { position: absolute; inset: 0; }
.cp-values { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-variant-numeric: tabular-nums; }
.cp-hex { font: var(--w-bold,700) 18px monospace; }
.cp-note { font-size: 11px; color: var(--ink-faint,#888); line-height: 1.3; }
.cp-actions { display: flex; gap: var(--btn-gap,2px); flex-wrap: wrap; }
.cp-actions button, .cp-head button { min-height: var(--ui-target,40px); padding: 0 10px; font: inherit; border-radius: 8px; }
.cp-hist { display: flex; gap: 6px; flex-wrap: wrap; }
.cp-hist button { width: 34px; height: 34px; min-width: 0; min-height: 0; padding: 0; border-radius: 6px; border: 1px solid var(--edge,#bbb); }
.cp-tip { position: fixed; z-index: 5001; pointer-events: none; max-width: 300px; padding: 6px 8px; border-radius: 8px; background: var(--bar,#fff); color: var(--ink,#1c1b1a); border: 1px solid var(--edge,#bbb); box-shadow: 0 4px 16px rgba(0,0,0,.4); font: 12px/1.35 var(--ui-font,sans-serif); white-space: pre-line; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v)); }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
};

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
/** `rgb(…)` / `rgba(…)` → [r, g, b, a] (a = 1 when absent); null when it is not a colour. */
export function parseCss(c) {
  const m = /rgba?\(([^)]+)\)/.exec(String(c ?? '')); if (!m) return null;
  const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); if (v.length < 3 || v.some(Number.isNaN)) return null;
  return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
}
/** `top` (with its alpha) laid over `bottom` (opaque) → opaque [r, g, b]. */
export const composite = (top, bottom) => { const a = top[3] ?? 1; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)); };

/** What the page says is painted under an element: [r, g, b] and a short description; for a graphic part of an SVG its fill (or stroke), for a box its background. */
export function paintOf(node) {
  const cs = getComputedStyle(node);
  const opacity = (() => { let o = 1; for (let n = node; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; })();
  const page = (() => { let c = [0, 0, 0]; const chain = []; for (let n = node; n; n = n.parentElement) chain.push(parseCss(getComputedStyle(n).backgroundColor)); for (let i = chain.length - 1; i >= 0; i -= 1) if (chain[i]) c = composite(chain[i], c); return c; })();
  const tag = `${node.tagName.toLowerCase()}${node.getAttribute?.('data-role') ? `[${node.getAttribute('data-role')}]` : ''}`;
  if (node instanceof SVGElement && node.tagName.toLowerCase() !== 'svg' && node.tagName.toLowerCase() !== 'g') {
    const fill = parseCss(cs.fill); const stroke = parseCss(cs.stroke);
    const use = fill && cs.fill !== 'none' ? { c: fill, a: Number(cs.fillOpacity), what: 'fill' } : stroke && cs.stroke !== 'none' ? { c: stroke, a: Number(cs.strokeOpacity), what: 'stroke' } : null;
    if (use) { const rgb = composite([use.c[0], use.c[1], use.c[2], use.c[3] * use.a * opacity], page); return { rgb, text: `${tag} ${use.what} ${cs.fill !== 'none' && use.what === 'fill' ? cs.fill : cs.stroke}${use.a * opacity < 1 ? ` · opacity ${(use.a * opacity).toFixed(2)}` : ''}` }; }
  }
  const fg = parseCss(cs.color);
  const bgOwn = parseCss(cs.backgroundColor);
  if (bgOwn && bgOwn[3] > 0) return { rgb: composite(bgOwn, (() => { let c = [0, 0, 0]; const chain = []; for (let n = node.parentElement; n; n = n.parentElement) chain.push(parseCss(getComputedStyle(n).backgroundColor)); for (let i = chain.length - 1; i >= 0; i -= 1) if (chain[i]) c = composite(chain[i], c); return c; })()), text: `${tag} background ${cs.backgroundColor}` };
  return { rgb: page, text: `${tag} (no own colour: the background behind it)${fg ? ` · text ${toHex(fg)}` : ''}` };
}

/** @param o.label (key, params?) → text; returns { open, close } */
export function mountColorProbe({ label = (k) => k } = {}) {
  let panel = null; let stopInspect = null; const history = [];
  const eyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const record = (rgb, how) => { history.unshift({ rgb, how }); history.length = Math.min(history.length, 8); draw(); };
  const copy = async (text) => { try { await navigator.clipboard?.writeText(text); } catch { /* clipboard refused */ } };

  async function aim() {
    try { const r = await new window.EyeDropper().open(); const m = /^#([0-9a-f]{6})$/i.exec(r.sRGBHex); if (m) { const n = parseInt(m[1], 16); record([(n >> 16) & 255, (n >> 8) & 255, n & 255], 'screen'); } } catch { /* Escape: nothing measured */ }
  }
  function inspect() {
    if (stopInspect) { stopInspect(); return; }
    const tip = el('div', { class: 'cp-tip' }); document.body.append(tip);
    const under = (x, y) => document.elementsFromPoint(x, y).find((n) => !panel?.contains(n) && n !== tip && n.nodeType === 1 && n.tagName !== 'HTML');
    const onMove = (e) => { const n = under(e.clientX, e.clientY); if (!n) return; const p = paintOf(n); tip.textContent = `${toHex(p.rgb)}\n${p.text}`; tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 310)}px`; tip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - 70)}px`; };
    const onClick = (e) => { const n = under(e.clientX, e.clientY); if (n) { e.preventDefault(); e.stopPropagation(); record(paintOf(n).rgb, 'element'); } stop(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } };
    function stop() { document.removeEventListener('pointermove', onMove, true); document.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey, true); tip.remove(); stopInspect = null; draw(); }
    stopInspect = stop;
    document.addEventListener('pointermove', onMove, true); document.addEventListener('click', onClick, true); window.addEventListener('keydown', onKey, true);
    draw();
  }

  function draw() {
    if (!panel) return;
    const last = history[0];
    const swatch = el('div', { class: 'cp-swatch' }, last ? Object.assign(el('i'), { style: `background:${toHex(last.rgb)}` }) : null);
    const values = el('div', { class: 'cp-values' }, last
      ? [el('span', { class: 'cp-hex', 'data-probe-hex': '' }, toHex(last.rgb)), el('span', {}, `rgb(${last.rgb.map(Math.round).join(', ')})`), el('span', { class: 'cp-note' }, label(last.how === 'screen' ? 'probe.fromScreen' : 'probe.fromElement'))]
      : [el('span', { class: 'cp-note' }, label('probe.none'))]);
    const actions = el('div', { class: 'cp-actions' },
      eyedropper ? el('button', { type: 'button', 'data-probe-aim': '', onclick: aim }, label('probe.aim')) : null,
      el('button', { type: 'button', 'data-probe-inspect': '', 'aria-pressed': String(!!stopInspect), onclick: inspect }, label(stopInspect ? 'probe.inspecting' : 'probe.inspect')));
    const hist = el('div', { class: 'cp-hist' }, history.slice(1).map((h) => el('button', { type: 'button', title: `${toHex(h.rgb)} — ${label('probe.copy')}`, 'aria-label': toHex(h.rgb), style: `background:${toHex(h.rgb)}`, onclick: () => copy(toHex(h.rgb)) })));
    panel.querySelector('.cp-body').replaceChildren(
      el('div', { class: 'cp-main' }, swatch, values),
      el('div', { class: 'cp-actions' }, last ? el('button', { type: 'button', onclick: () => copy(toHex(last.rgb)) }, label('probe.copy')) : null),
      actions, hist,
      el('span', { class: 'cp-note' }, label(eyedropper ? 'probe.helpScreen' : 'probe.helpNoEyedropper')));
  }

  function open() {
    if (panel) { draw(); return; }
    if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
    const close = el('button', { type: 'button', 'aria-label': label('probe.close'), title: label('probe.close'), onclick: closePanel }, '✕');
    panel = el('div', { class: 'cp-panel', role: 'dialog', 'aria-label': label('probe.title'), 'data-dismiss-keep': '', 'data-color-probe': '' }, el('div', { class: 'cp-head' }, el('span', { class: 'cp-title' }, label('probe.title')), close), el('div', { class: 'cp-body' }));
    // the panel can be dragged by its title (to uncover what is under it)
    const head = panel.querySelector('.cp-head'); let drag = null;
    head.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = panel.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; head.setPointerCapture(e.pointerId); });
    head.addEventListener('pointermove', (e) => { if (!drag) return; panel.style.left = `${Math.max(0, e.clientX - drag.dx)}px`; panel.style.top = `${Math.max(0, e.clientY - drag.dy)}px`; panel.style.right = 'auto'; });
    head.addEventListener('pointerup', () => { drag = null; });
    document.body.append(panel); draw();
  }
  function closePanel() { stopInspect?.(); panel?.remove(); panel = null; }
  return { open, close: closePanel };
}
