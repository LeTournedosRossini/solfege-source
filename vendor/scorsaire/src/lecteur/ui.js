/*
 * The small parts the Lecteur's menu is made of, in the look of the Scorsaire editor (rounded 8 px buttons with a fine edge, steppers « − value + », switches, segmented
 * choices), instead of the plain grey browser buttons it had. Only DOM builders and one style sheet: no state. The colours come from the page's variables (the theme
 * toggle sets them), with the light values as fallbacks.
 */
const STYLE_ID = 'lc-ui-style';
const CSS = `
.lc-ui { --lc-h: 40px; }
@media (pointer: coarse) { .lc-ui { --lc-h: 44px; } }
.lc-btn { min-height: var(--lc-h); padding: 0 14px; border: 1px solid var(--edge,#c9c4b8); border-radius: 8px; background: var(--btn,#fff); color: inherit; font: inherit; font-size: 14px; line-height: 1.1; cursor: pointer; touch-action: manipulation; }
.lc-btn:active { background: var(--btn-on,#e2e0da); }
.lc-btn[aria-pressed="true"], .lc-btn[data-on] { background: var(--btn-on,#e2e0da); border-color: var(--ink,#1c1b1a); font-weight: 600; }
.lc-btn:disabled { opacity: .4; cursor: default; }
.lc-btn.lc-sq { min-width: var(--lc-h); padding: 0; font-size: 18px; }
.lc-seg { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.lc-step { display: inline-flex; align-items: center; gap: 4px; }
.lc-step .lc-val { min-width: 3.6em; text-align: center; font-variant-numeric: tabular-nums; }
.lc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-height: calc(var(--lc-h) + 6px); padding: 4px 0; border-bottom: 1px solid var(--line,#d8d3c8); }
.lc-row:last-child { border-bottom: 0; }
.lc-row > .lc-label { flex: 1 1 140px; font-size: 14px; }
.lc-title { margin: 14px 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; opacity: .6; }
.lc-title:first-child { margin-top: 2px; }
.lc-note { margin: 6px 0 0; font-size: 12px; opacity: .6; line-height: 1.35; }
.lc-sw { position: relative; width: 48px; height: 28px; border: 1px solid var(--edge,#c9c4b8); border-radius: 14px; background: var(--btn,#fff); cursor: pointer; padding: 0; touch-action: manipulation; flex: none; }
.lc-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--ink,#1c1b1a); opacity: .45; transition: transform .12s; }
.lc-sw[aria-checked="true"] { background: var(--btn-on,#e2e0da); border-color: var(--ink,#1c1b1a); }
.lc-sw[aria-checked="true"]::after { transform: translateX(20px); opacity: 1; }
.lc-input { min-height: var(--lc-h); padding: 0 10px; border: 1px solid var(--edge,#c9c4b8); border-radius: 8px; background: var(--field,#fff); color: inherit; font: inherit; font-size: 15px; min-width: 0; }
.lc-veil { position: absolute; inset: 0; z-index: 45; background: transparent; }
.lc-sheet { position: absolute; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 760px; max-height: 58%; display: flex; flex-direction: column; background: var(--paper,#faf8f4); color: var(--ink,#1c1b1a); border: 1px solid var(--edge,#c9c4b8); border-bottom: 0; border-radius: 14px 14px 0 0; box-shadow: 0 -4px 18px rgba(0,0,0,.28); font-size: 15px; }
.lc-sheet-head { flex: none; display: flex; align-items: stretch; gap: 4px; padding: 0 6px 0 4px; border-bottom: 1px solid var(--edge,#c9c4b8); }
.lc-tabs { flex: 1 1 auto; display: flex; overflow-x: auto; }
.lc-tab { flex: 1 1 auto; min-height: 48px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: inherit; font: inherit; font-size: 14px; white-space: nowrap; cursor: pointer; }
.lc-tab[aria-selected="true"] { font-weight: 600; border-bottom-color: var(--ink,#1c1b1a); }
.lc-sheet-title { flex: 1 1 auto; align-self: center; padding: 0 10px; font-weight: 600; }
.lc-sheet-body { overflow-y: auto; overscroll-behavior: contain; padding: 6px 14px 16px; }
`;

export function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st);
}

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

/** A button. `on` marks a pressed / chosen one. `act` and `data` are for the tests and the tools that read the page. */
export const btn = (text, onclick, { on = null, act = null, data = {}, disabled = false, square = false, title = null, label = null } = {}) =>
  el('button', { type: 'button', class: `lc-btn${square ? ' lc-sq' : ''}`, 'aria-pressed': on === null ? null : String(on), 'data-act': act, title, 'aria-label': label ?? title, disabled, onclick, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, String(v)])) }, text);

/** Choices side by side; `options` = [[value, text]], `isOn(value)` says which are chosen (several may be: a set of kinds). */
export const choices = (options, isOn, onPick, { act } = {}) =>
  el('span', { class: 'lc-seg', role: 'group' }, ...options.map(([v, text]) => btn(text, () => onPick(v), { on: isOn(v), act, data: { value: v } })));

/** « − value + ». `onStep(−1 | +1)`; `lo` / `hi` say when a side is spent. */
export const stepper = (text, onStep, { act, disabledLess = false, disabledMore = false, gated = false, valueData = null } = {}) =>
  el('span', { class: 'lc-step' },
    btn('−', () => onStep(-1), { square: true, act: act ? `${act}-minus` : 'minus', disabled: disabledLess || gated, label: '−' }),
    el('span', { class: 'lc-val', ...(valueData ? { [valueData]: '' } : {}) }, text),
    btn('+', () => onStep(1), { square: true, act: act ? `${act}-plus` : 'plus', disabled: disabledMore || gated, label: '+' }));

/** An on / off switch (a state, never a check box). */
export const switchButton = (on, onToggle, { act, label } = {}) => el('button', { type: 'button', class: 'lc-sw', role: 'switch', 'aria-checked': String(on), 'aria-label': label ?? null, 'data-act': act, onclick: () => onToggle(!on) });

/** A line of a sheet: the words on the left, the control on the right. */
export const row = (labelText, ...controls) => el('div', { class: 'lc-row' }, el('span', { class: 'lc-label' }, labelText), ...controls);
export const title = (text) => el('div', { class: 'lc-title' }, text);
export const note = (text, attrs = {}) => el('p', { class: 'lc-note', ...attrs }, text);

/** The padlock: a LONG press (0.7 s) switches it, a plain tap does nothing. The browser's own long-press menu is blocked on it. */
export function lockButton({ locked, labels, hint, onToggle, holdMs = 700 }) {
  let timer = null; let fired = false;
  const b = btn(locked ? labels.locked : labels.unlocked, () => {}, { on: !locked, act: 'lock', title: hint });
  b.style.cssText = 'touch-action:manipulation;-webkit-touch-callout:none;white-space:nowrap';
  b.addEventListener('pointerdown', () => { fired = false; timer = setTimeout(() => { fired = true; onToggle(); }, holdMs); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
  b.addEventListener('click', (e) => { if (fired) e.preventDefault(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

/**
 * A sheet that rises from the bottom of `host` over a transparent veil (a tap on the veil closes it; the page above stays visible, so a change is seen as it is made).
 * `tabs` = [{ id, text, build() → Node[] }] (or a single `build` for a sheet without tabs). Returns { refresh(), setTab(id), close(), isOpen() }.
 */
export function openSheet(host, { title: head = '', tabs = null, build = null, tab = null, closeLabel = 'Close', onClose = null }) {
  ensureStyle();
  let current = tab ?? tabs?.[0]?.id ?? null; let closed = false;
  const veil = el('div', { class: 'lc-veil lc-ui', 'data-lc-sheet': '' });
  const body = el('div', { class: 'lc-sheet-body' });
  const tabBar = tabs ? el('div', { class: 'lc-tabs', role: 'tablist' }) : el('div', { class: 'lc-sheet-title' }, head);
  const sheet = el('div', { class: 'lc-sheet', role: 'dialog', 'aria-label': head || null },
    el('div', { class: 'lc-sheet-head' }, tabBar, btn('✕', () => close(), { square: true, act: 'close-sheet', label: closeLabel, title: closeLabel })), body);
  veil.append(sheet);
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) { e.stopPropagation(); close(); } });
  sheet.addEventListener('pointerdown', (e) => e.stopPropagation());
  const fill = () => {
    if (tabs) for (const b of tabBar.children) b.setAttribute('aria-selected', String(b.dataset.tab === current));
    const keep = body.scrollTop;
    body.replaceChildren(...(tabs ? tabs.find((x) => x.id === current)?.build() ?? [] : build()));
    body.scrollTop = keep;
  };
  if (tabs) for (const t of tabs) tabBar.append(el('button', { type: 'button', class: 'lc-tab', role: 'tab', 'data-tab': t.id, onclick: () => { current = t.id; body.scrollTop = 0; fill(); } }, t.text));
  function close() { if (closed) return; closed = true; veil.remove(); onClose?.(); }
  host.append(veil);
  fill();
  return { refresh: fill, setTab(id) { current = id; fill(); }, close, isOpen: () => !closed };
}
