/*
 * Screen 2 — the text editor that opens just above a printed text (title, credits, free line, header or footer area, measure numbers) on a double click
 * or a double tap: the text itself, and its style like MuseScore's text properties (font, size, bold, italic, underline, alignment, colour).
 * It lives in <body> (the page never moves), is placed above the text (below when there is no room), and commits every control as one undoable
 * transaction; the screen tells it to `refresh()` after every change so that it always shows the document.
 */
import { SID, textStyleOf, defaultTextStyle, TEXT_FAMILIES, TEXT_ALIGNS } from '../model/index.js';
import { PID } from '../model/pid.js';
import { createChoiceMenu } from './choice-menu.js';
import { dismissOnOutside } from './outside-dismiss.js';

const STYLE_ID = 'parts-text-modal-style';
const CSS_TEXT = `
[data-text-modal] { position: fixed; z-index: 3500; width: min(440px, calc(100vw - 16px)); box-sizing: border-box; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); border-radius: 10px; box-shadow: 0 4px 18px rgba(0,0,0,.35); padding: 8px 10px; font: 14px var(--ui-font,sans-serif); }
[data-text-modal] .tm-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--btn-gap, 2px); margin: 6px 0; }
[data-text-modal] textarea { width: 100%; box-sizing: border-box; min-height: calc(var(--ui-target, 44px) * 1.2); font: inherit; font-size: 16px; padding: 6px; resize: vertical; }
[data-text-modal] button, [data-text-modal] input[type="number"] { min-height: var(--ui-target, 44px); min-width: var(--ui-target, 44px); font: inherit; box-sizing: border-box; padding: 0 8px; }
[data-text-modal] input[type="number"] { width: 5em; font-size: 16px; }
[data-text-modal] button[aria-pressed="true"] { background: var(--btn-on, var(--btn-on,#e2e0da)); color: var(--ink,#1c1b1a); border: 1px solid var(--btn-on-line, var(--edge,#b9b4a8)); }
[data-text-modal] .tm-swatch { min-width: 32px; width: 32px; padding: 0; border: 2px solid var(--edge,#999); border-radius: 50%; }
[data-text-modal] .tm-hint { color: var(--ink-soft,#555); font-size: 12px; }
[data-text-modal] .tm-head { display: flex; align-items: center; justify-content: space-between; gap: var(--btn-gap, 2px); }
`;
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
};
let deviceFonts = null; // font families of the device (Local Font Access API), loaded on request; null = not loaded
async function loadDeviceFonts() {
  if (typeof window.queryLocalFonts !== 'function') return 'none';
  try { const list = await window.queryLocalFonts(); deviceFonts = [...new Set(list.map((f) => f.family))].filter((n) => /^[^"'<>&;{}\\]{1,80}$/.test(n)).sort((a, b) => a.localeCompare(b)); return 'ok'; } catch { return 'denied'; }
}
import { SWATCHES } from './swatches.js';
const ALIGNED = (key) => /^(title|subtitle|album|composer|arranger|lyricist|line:|cell:)/.test(key);

/**
 * @param o  { app, label(key, params), getPart() → the active part, anchorOf(key) → the DOM node of the text (for the position), partStyle(part) → (sid) → value }
 * @returns { open(key), refresh(), close(), isOpen(), key() }
 */
export function createTextModal({ app, label, getPart, anchorOf, partStyle }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS_TEXT));
  let box = null; let current = null; let stopDismiss = null; let message = '';
  // in-place editing: a field laid over the text of the page (one-line texts only); written to the document when it is validated
  let inp = null; let inpOrig = ''; let inpAnchor = null;
  const INLINE_KINDS = new Set(['meta', 'line', 'template', 'staffText']);

  function placeInline() {
    if (!inp) return;
    const a = anchorOf(current);
    if (!a || !a.isConnected) return; // the page is being redrawn: the next refresh puts it back
    if (inpAnchor && inpAnchor !== a) inpAnchor.style.visibility = '';
    inpAnchor = a; a.style.visibility = 'hidden';
    const ctm = a.getScreenCTM?.();
    const scale = ctm ? ctm.a : 1;
    const fontPx = (parseFloat(a.getAttribute('font-size')) || 3) * scale;
    const r = a.getBoundingClientRect();
    const vv = window.visualViewport;
    const width = Math.max(r.width + 60, 180); const height = Math.max(fontPx * 1.5, 22);
    const kind = a.getAttribute('text-anchor') || 'start';
    const left = kind === 'middle' ? r.left + r.width / 2 - width / 2 : kind === 'end' ? r.right - width + 4 : r.left - 4;
    const top = r.top + r.height / 2 - height / 2;
    const cs = getComputedStyle(a);
    inp.style.cssText = `position:fixed;z-index:3600;box-sizing:border-box;left:${left + (vv?.offsetLeft ?? 0)}px;top:${top + (vv?.offsetTop ?? 0)}px;width:${width}px;height:${height}px;`
      + `padding:0 4px;margin:0;border:1px solid #4a7bd0;border-radius:3px;background:rgba(255,255,255,.92);outline:none;min-height:0;min-width:0;`
      + `font-family:${cs.fontFamily};font-size:${fontPx}px;font-weight:${a.querySelector('tspan[font-weight]') || cs.fontWeight === 'bold' ? 'bold' : 'normal'};`
      + `font-style:${a.querySelector('tspan[font-style]') ? 'italic' : 'normal'};color:${cs.fill && cs.fill !== 'none' ? cs.fill : '#000'};text-align:${kind === 'middle' ? 'center' : kind === 'end' ? 'right' : 'left'}`;
  }
  function removeInline(commit) {
    if (!inp) return;
    const field = inp; const orig = inpOrig; inp = null;
    if (commit && field.value !== orig) { try { app.setTextContent(getPart().id, current, field.value); } catch (e) { message = String(e?.message ?? e); } }
    field.remove();
    if (inpAnchor) inpAnchor.style.visibility = '';
    inpAnchor = null;
  }
  function syncInline(src) {
    if (!inp) {
      const a = anchorOf(current);
      if (!INLINE_KINDS.has(src.kind) || !a || !src.text || src.text.includes('\n') || a.textContent !== src.text) return false; // not editable in place: the text area of the box
      inp = el('input', { type: 'text', 'data-field': 'tm-inline', 'data-dismiss-keep': '', maxlength: '200', 'aria-label': label('parts.textContent') });
      inp.value = src.text; inpOrig = src.text;
      inp.addEventListener('change', () => run(() => { const v = inp.value; inpOrig = v; app.setTextContent(getPart().id, current, v); }));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      document.body.append(inp);
      placeInline();
      inp.focus(); inp.select();
    } else placeInline();
    return true;
  }
  const onMove = () => { place(); placeInline(); };

  const run = (fn) => { try { message = ''; fn(); } catch (e) { message = String(e?.message ?? e); refresh(); } };

  function place() {
    if (!box) return;
    const anchor = anchorOf(current);
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth; const vh = vv?.height ?? window.innerHeight;
    const r = anchor?.getBoundingClientRect?.() ?? { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2, width: 0 };
    const w = box.offsetWidth; const h = box.offsetHeight;
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, vh - h - 8); // not enough room above: under the text
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, vw - w - 8));
    box.style.left = `${left + (vv?.offsetLeft ?? 0)}px`; box.style.top = `${Math.max(8, top) + (vv?.offsetTop ?? 0)}px`;
  }

  function draw() {
    const part = getPart();
    const src = app.textSource(part.id, current);
    if (!src) { close(); return; }
    const styles = part.props[PID.PART_TEXT_STYLES] ?? {};
    const defaults = defaultTextStyle(current, partStyle(part), part);
    const st = textStyleOf(styles, current, defaults);
    const apply = (patch) => run(() => { app.setTextStyle(part.id, current, patch); });
    const toggle = (name, text, field) => el('button', { type: 'button', 'data-act': `tm-${name}`, 'aria-pressed': String(Boolean(st[field])), title: label(`parts.tag.${name}`), onclick: () => apply({ [field]: !st[field] }) }, text);
    const inline = src.kind !== 'number' && syncInline(src);
    const area = src.kind === 'number'
      ? el('div', { class: 'tm-hint' }, label('parts.textDerived'))
      : inline ? el('div', { class: 'tm-hint' }, label('parts.textInPlace'))
      : (() => { const t = el('textarea', { 'data-field': 'tm-text', rows: src.kind === 'cell' ? '5' : '2', 'aria-label': label('parts.textContent') }); t.value = src.text; t.addEventListener('change', () => run(() => app.setTextContent(part.id, current, t.value))); return t; })();
    const size = el('input', { type: 'number', min: '4', max: '120', step: '0.5', value: String(st.size), 'data-field': 'tm-size', 'aria-label': label('parts.textSize') });
    size.addEventListener('change', () => { const n = Number(size.value); if (Number.isFinite(n)) apply({ size: n }); });
    const color = el('input', { type: 'color', value: st.color ?? '#000000', 'data-field': 'tm-color', 'aria-label': label('parts.colorCustom') });
    color.addEventListener('change', () => apply({ color: color.value }));
    box.replaceChildren(...[
      el('div', { class: 'tm-head' }, el('strong', {}, label('parts.textEditor')), el('button', { type: 'button', 'data-act': 'tm-close', 'aria-label': 'close', onclick: () => close() }, '✕')),
      area,
      src.kind === 'cell' ? el('div', { class: 'tm-hint' }, label('parts.cellTextHint')) : null,
      el('div', { class: 'tm-row' },
        createChoiceMenu({ options: [...TEXT_FAMILIES.map((f) => [f, label(`parts.font.${f}`)]), ...(deviceFonts ?? (TEXT_FAMILIES.includes(st.family) ? [] : [st.family])).map((f) => [f, f])], value: st.family, label: label('parts.textFont'), act: 'tm-font', onPick: (v) => apply({ family: v }) }),
        deviceFonts ? null : el('button', { type: 'button', 'data-act': 'tm-device-fonts', onclick: async () => { const r = await loadDeviceFonts(); message = r === 'none' ? label('parts.fontDeviceNone') : r === 'denied' ? label('parts.fontDeviceDenied') : ''; refresh(); } }, label('parts.fontDevice')),
        size, el('span', { class: 'tm-hint' }, 'pt')),
      el('div', { class: 'tm-row' }, toggle('b', 'B', 'bold'), toggle('i', 'I', 'italic'), toggle('u', 'U', 'underline'),
        ALIGNED(current) ? TEXT_ALIGNS.map((a) => el('button', { type: 'button', 'data-act': `tm-align-${a}`, 'aria-pressed': String(st.align === a), title: label(`parts.align.${a}`), onclick: () => apply({ align: a }) }, a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥')) : null),
      el('div', { class: 'tm-row' },
        el('button', { type: 'button', 'data-act': 'tm-color-auto', 'aria-pressed': String(st.color == null), onclick: () => apply({ color: null }) }, label('parts.colorAuto')),
        SWATCHES.map((c) => el('button', { type: 'button', class: 'tm-swatch', 'data-act': 'tm-color-swatch', 'data-color': c, 'aria-label': c, 'aria-pressed': String(st.color === c), style: `background:${c}`, onclick: () => apply({ color: c }) })),
        color),
      el('div', { class: 'tm-row' }, el('button', { type: 'button', 'data-act': 'tm-reset', onclick: () => apply({ family: null, size: null, bold: null, italic: null, underline: null, align: null, color: null }) }, label('parts.textResetStyle'))),
      el('div', { class: 'tm-hint', 'data-error': '' }, message)].filter((c) => c != null));
    place();
  }

  function refresh() { if (box) draw(); }
  function close(commit = true) {
    removeInline(commit); stopDismiss?.(); stopDismiss = null; box?.remove(); box = null; current = null;
    window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove);
  }
  function open(key) {
    close();
    current = key; message = '';
    window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove);
    box = el('div', { 'data-text-modal': '', 'data-resizable': 'partsText', 'data-zoom-lock': '', role: 'dialog', 'aria-label': label('parts.textEditor') });
    box.style.visibility = 'hidden';
    document.body.append(box);
    draw();
    box.style.visibility = '';
    stopDismiss = dismissOnOutside(() => box, close);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); window.removeEventListener('keydown', onKey, true); } };
    window.addEventListener('keydown', onKey, true);
  }
  return { open, refresh, close, isOpen: () => Boolean(box), key: () => current };
}
