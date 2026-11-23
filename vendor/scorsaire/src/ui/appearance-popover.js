/*
 * The appearance button (page header, right of the back button): a small popover on a computer, a sheet from the bottom on a tablet or a phone (the
 * same rule as the choice menus). It chooses the theme (follow the system / light / dark) and the contrast level (4 levels, light and dark themes).
 * A third row sets the weight of the text for the theme shown (4 levels: normal, lighter, much lighter, lightest). The high-contrast theme ignores the contrast level and the text weight (it is already at the maximum). A change applies at once; the panel stays open until a press outside, Escape or Close.
 */
import { icon } from './icons.js';
import { SHEET_QUERY } from './panel-mode.js';
import { CONTRAST_LEVELS } from './theme.js';

const WEIGHTS = ['normal', 'lean', 'leaner', 'lightest'];

const STYLE_ID = 'appearance-style';
const CSS = `
.ap-layer { position: fixed; inset: 0; z-index: 3200; }
.ap-panel { position: fixed; width: min(300px, calc(100vw - 16px)); box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; background: var(--bar, #fff); color: var(--ink, #1c1b1a); border: 1px solid var(--edge, #bbb); border-radius: 10px; box-shadow: 0 10px 34px rgba(0,0,0,.35); font-size: 12px; }
.ap-panel[data-mode="sheet"] { left: 0; right: 0; bottom: 0; width: auto; max-width: 720px; margin: 0 auto; padding: 12px 16px 16px; gap: 12px; border-radius: 14px 14px 0 0; font-size: 13px; }
.ap-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-title { font: var(--w-bold, 700) 13px var(--ui-font, sans-serif); }
.ap-row { display: flex; flex-direction: column; gap: 4px; }
.ap-label { font-size: 11px; color: var(--ink-soft, #555); }
.ap-seg { display: flex; gap: var(--btn-gap, 2px); }
.ap-seg button { flex: 1 1 0; min-width: 0; min-height: 26px; padding: 0 4px; font: inherit; font-size: 11.5px; line-height: 1.1; border-radius: 7px; }
.ap-head button { min-width: 26px; min-height: 26px; padding: 0; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; }
.ap-head button svg { width: 14px; height: 14px; }
.ap-panel[data-mode="sheet"] .ap-seg button { min-height: var(--ui-target, 44px); font-size: 13px; padding: 0 8px; border-radius: 8px; }
.ap-panel[data-mode="sheet"] .ap-label { font-size: 12px; }
.ap-panel[data-mode="sheet"] .ap-head button { min-width: var(--ui-target, 44px); min-height: var(--ui-target, 44px); }
.ap-panel[data-mode="sheet"] .ap-head button svg { width: auto; height: auto; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v)); }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
};

/** @param o.theme { get(), set(v) } (see theme.js); o.contrast { get(), set(n) }; o.text { get(), set(v) } the text weight of the theme shown; returns the header button */
export function mountAppearance({ theme, contrast, text, label = (k) => k }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  const button = el('button', { type: 'button', 'data-action': 'appearance', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: label('appearance.button'), 'aria-label': label('appearance.button'),
    style: 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;cursor:pointer' });
  button.append(icon('contrast'));

  button.addEventListener('click', () => {
    const sheet = window.matchMedia(SHEET_QUERY).matches;
    const refreshers = []; // a change of theme changes what the weight row shows (each theme has its own weight)
    const inHc = () => theme.get() === 'hc';
    const segment = (options, current, pick, attr, inertInHc = false) => {
      const seg = el('div', { class: 'ap-seg', role: 'group', [attr]: '' });
      const buttons = options.map(([v, caption, disabled]) => el('button', { type: 'button', 'data-value': String(v), 'aria-pressed': String(String(v) === String(current())), disabled: disabled || (inertInHc && inHc()) || null, onclick: () => { pick(v); refreshers.forEach((r) => r()); } }, caption));
      refreshers.push(() => buttons.forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.value === String(current()))); if (inertInHc) b.disabled = inHc(); }));
      seg.append(...buttons);
      return seg;
    };
    const themeSeg = segment([['system', label('theme.system')], ['light', label('theme.light')], ['dark', label('theme.dark')], ['hc', label('theme.contrastHigh')]], theme.get, (v) => theme.set(v), 'data-appearance-theme');
    const contrastSeg = segment(CONTRAST_LEVELS.map((n) => [n, label(`contrast.${n}`)]), contrast.get, (v) => contrast.set(v), 'data-appearance-contrast', true);
    const textSeg = segment(WEIGHTS.map((w) => [w, label(`darkText.${w}`)]), text.get, (v) => text.set(v), 'data-appearance-text', true);
    const closeBtn = el('button', { type: 'button', 'data-action': 'appearance-close', 'aria-label': label('appearance.close'), title: label('appearance.close') });
    closeBtn.append(icon('x'));
    const panel = el('div', { class: 'ap-panel', role: 'dialog', 'aria-label': label('appearance.title'), 'data-mode': sheet ? 'sheet' : 'popover', 'data-appearance': '' },
      el('div', { class: 'ap-head' }, el('span', { class: 'ap-title' }, label('appearance.title')), closeBtn),
      el('div', { class: 'ap-row' }, el('span', { class: 'ap-label' }, label('appearance.theme')), themeSeg),
      el('div', { class: 'ap-row' }, el('span', { class: 'ap-label' }, label('appearance.contrast')), contrastSeg),
      el('div', { class: 'ap-row' }, el('span', { class: 'ap-label' }, label('appearance.text')), textSeg));
    const layer = el('div', { class: 'ap-layer', onpointerdown: (e) => { if (e.target === layer) close(); } }, panel);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    function close() { window.removeEventListener('keydown', onKey, true); layer.remove(); button.setAttribute('aria-expanded', 'false'); button.focus?.(); }
    closeBtn.addEventListener('click', close);
    window.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    button.setAttribute('aria-expanded', 'true');
    if (!sheet) {
      const r = button.getBoundingClientRect();
      panel.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 40)}px`;
      panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    }
  });
  return button;
}
