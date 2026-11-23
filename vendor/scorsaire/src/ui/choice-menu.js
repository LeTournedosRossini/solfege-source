/*
 * Custom choice menu (DOM): a button showing the current choice; when pressed it unfolds one button per option.
 * Replaces the browser's native <select> popup. On phones and tablets (SHEET_QUERY) the options unfold as a sheet
 * sliding up from the bottom of the screen; on desktop they unfold as a popover right under the button.
 * The unfolded list lives in <body> (never inside a panel that redraws) and is closed by a pick, a press outside, or Escape
 * (the Escape is swallowed so that the dialog behind stays open).
 */
import { SHEET_QUERY } from './panel-mode.js';
import { openLibraryDialog } from './library-dialog.js';

const STYLE_ID = 'choice-menu-style';
const CSS = `
.cm-button { min-height: var(--ui-target, 44px); min-width: var(--ui-target, 44px); padding: 0 10px; border: 1px solid var(--edge,#bbb); border-radius: 8px; background: var(--btn, var(--btn,#fdfcfa)); font: inherit; display: inline-flex; align-items: center; justify-content: space-between; gap: var(--btn-gap, 2px); cursor: pointer; }
.cm-button::after { content: '▾'; font-size: 12px; }
.cm-layer { position: fixed; inset: 0; z-index: 3700; } /* above the dialogs (3500) and the colour picker (3600) that open menus */
.cm-list { position: fixed; background: var(--btn, var(--btn,#fdfcfa)); border: 1px solid var(--edge,#bbb); box-shadow: 0 4px 16px rgba(0,0,0,.3); overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); padding: 6px; }
.cm-list[data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 720px; max-height: 60vh; border-radius: 12px 12px 0 0; }
.cm-list[data-mode="popover"] { border-radius: 8px; }
.cm-option { min-height: var(--ui-target, 44px); padding: 0 12px; border: 1px solid transparent; border-radius: 8px; background: var(--btn, var(--btn,#fdfcfa)); font: inherit; text-align: left; cursor: pointer; }
.cm-list[data-columns] { display: grid; grid-template-columns: repeat(var(--cm-cols, 3), 1fr); }
.cm-list[data-columns] .cm-option { display: flex; align-items: center; justify-content: center; padding: 0 6px; text-align: center; }
.cm-hint { display: block; font-size: 11px; font-weight: normal; color: var(--ink-soft,#666); line-height: 1.25; }
.cm-option[aria-checked="true"] { border-color: var(--ink,#1c1b1a); font-weight: var(--w-bold,700); }
.cm-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px 2px; font-size: 11px; font-weight: var(--w-bold,700); color: var(--ink-soft,#666); }
.cm-more { min-height: 28px; padding: 0 10px; border: 1px solid var(--edge,#bbb); border-radius: 6px; background: var(--btn,#fdfcfa); font: inherit; font-size: 12px; font-weight: var(--w-semi,600); cursor: pointer; }
.cm-folder { min-height: var(--ui-target, 44px); padding: 0 12px; border: 1px solid transparent; border-radius: 8px; background: var(--btn, var(--btn,#fdfcfa)); font: inherit; font-weight: var(--w-semi,600); text-align: left; cursor: pointer; }
.cm-folder-items { display: flex; flex-direction: column; gap: var(--btn-gap, 2px); padding-left: 16px; }
`;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
}

/**
 * options: [[value, text]]; returns the trigger button. `follow`: the button shows the option picked last and the list marks it (a menu that chooses a state, like
 * the screen choice); without it the button keeps its label (a menu of actions). `button.setValue(v)` sets the shown choice from outside.
 * The list may be STRUCTURED: `{ heading: 'text' }` is a title (not a choice) and `{ folder: 'name', items: [options] }` is a sub-menu that opens and closes (open when it holds the current choice).
 * An option may have a 4th item, `() => Node` (an icon): it is shown instead of the text (the text stays as tooltip / aria-label). `columns` lays the options out
 * as a grid of that many columns (a palette of icons) instead of a list.
 * `multi`: several options can be ticked; `value` is the array of the ticked ones, a press toggles (the list stays open), and a press outside (or Escape) closes it and calls
 * `onPick(array)` once, when something changed. The button keeps `buttonText`. An `{ action, text, run, title? }` entry is a button that closes the list and calls `run()` (in any menu).
 */
export function createChoiceMenu({ options: structured, value, onPick, label = '', act = '', follow = false, columns = 0, buttonText = null, multi = false }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const options = structured.flatMap((o) => (Array.isArray(o) ? [o] : o.folder ? o.items : [])); // (a `{ action, text, run }` entry is a button, not a choice) the choices, whatever the headings and folders around them
  const current = multi ? null : options.find(([v]) => String(v) === String(value));
  const button = el('button', { type: 'button', class: 'cm-button', 'aria-label': label, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-act': act, 'data-value': String(value ?? '') },
    el('span', {}));
  const fill = (span, c) => { span.replaceChildren(); const node = c?.[3]?.(); if (node) span.append(node); else span.textContent = c ? c[1] : ''; };
  fill(button.firstChild, current ?? (buttonText != null ? [null, buttonText] : null)); // `buttonText`: what the button says when no option is the current one (a menu of actions, "+ Player")
  const show = (v) => { value = v; const c = options.find(([x]) => String(x) === String(v)); const span = button.firstChild; if (c && span) fill(span, c); button.setAttribute('data-value', String(v ?? '')); };
  button.setValue = show;
  button.addEventListener('click', () => {
    const sheet = window.matchMedia(SHEET_QUERY).matches;
    const ticked = new Set(multi ? (value ?? []).map(String) : []); const start = [...ticked].sort().join('|');
    const optionButton = ([v, text, hint, node]) => { const icon = node?.(); return el('button', { type: 'button', class: 'cm-option', role: 'option', 'data-value': String(v), 'aria-checked': String(multi ? ticked.has(String(v)) : String(v) === String(value)),
      onclick: (e) => {
        if (multi) { const on = !ticked.has(String(v)); if (on) ticked.add(String(v)); else ticked.delete(String(v)); e.currentTarget.setAttribute('aria-checked', String(on)); return; }
        close(); if (follow) show(v); onPick(v);
      } }, icon ?? text, hint && !icon ? el('small', { class: 'cm-hint' }, hint) : null); };
    const entryNode = (o) => {
      if (Array.isArray(o)) return optionButton(o);
      if (o.action) { // a button of the list that does something instead of choosing: the menu closes, then `run()`
        return el('button', { type: 'button', class: 'cm-option', 'data-action': o.action, title: o.title ?? null, onclick: () => { close(); o.run(); } }, o.text);
      }
      if (o.heading) {
        const more = o.more && el('button', { type: 'button', class: 'cm-more', 'data-act': 'menu-browse', onclick: () => { close(); openLibraryDialog({ items: o.more.items, text: o.more.text, label: o.more.labelOf, title: o.more.title, value, onPick: (v) => { if (follow) show(v); onPick(v); } }); } }, o.more.label);
        return el('div', { class: 'cm-heading', role: 'presentation' }, el('span', {}, o.heading), more);
      }
      if (o.folder) {
        const holdsCurrent = o.items.some(([v]) => String(v) === String(value));
        const box = el('div', { class: 'cm-folder-items', role: 'group', 'aria-label': o.folder }, o.items.map(optionButton));
        const head = el('button', { type: 'button', class: 'cm-folder', 'aria-expanded': String(holdsCurrent), 'data-folder': o.folder, onclick: () => { const open = box.style.display === 'none'; box.style.display = open ? '' : 'none'; head.setAttribute('aria-expanded', String(open)); head.textContent = `${open ? '▾' : '▸'} ${o.folder}`; } });
        head.textContent = `${holdsCurrent ? '▾' : '▸'} ${o.folder}`; if (!holdsCurrent) box.style.display = 'none';
        return el('div', { class: 'cm-folder-wrap' }, head, box);
      }
      return null;
    };
    const list = el('div', { class: 'cm-list', role: 'listbox', 'aria-multiselectable': multi ? 'true' : null, 'aria-label': label, 'data-mode': sheet ? 'sheet' : 'popover', 'data-choice-menu': act }, structured.map(entryNode));
    if (columns) { list.setAttribute('data-columns', String(columns)); list.style.setProperty('--cm-cols', String(columns)); }
    const layer = el('div', { class: 'cm-layer', onpointerdown: (e) => { if (e.target === layer) close(); } }, list);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    function close() {
      window.removeEventListener('keydown', onKey, true); layer.remove(); button.setAttribute('aria-expanded', 'false'); button.focus?.();
      if (multi && [...ticked].sort().join('|') !== start) onPick(options.map(([v]) => v).filter((v) => ticked.has(String(v))));
    }
    window.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    button.setAttribute('aria-expanded', 'true');
    if (!sheet) {
      const r = button.getBoundingClientRect(); const vh = window.innerHeight;
      const below = vh - r.bottom - 8; const above = r.top - 8;
      list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 8))}px`;
      list.style.minWidth = `${r.width}px`;
      if (below >= Math.min(list.scrollHeight, 220) || below >= above) { list.style.top = `${r.bottom + 2}px`; list.style.maxHeight = `${below}px`; }
      else { list.style.bottom = `${vh - r.top + 2}px`; list.style.maxHeight = `${above}px`; }
    }
    list.querySelector('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest' });
  });
  return button;
}
