/*
 * A sheet that rises from the bottom of the screen with a list of ACTIONS written out in words (a tablet or a phone: the drawers made of icons only had to be
 * guessed). One layer over the page: a veil (a press on it closes), a title with a close button, sections with a small heading, and one wide row per action
 * (icon + text + an optional hint). Escape closes; the focus goes into the sheet and comes back to the button that opened it. A press on a row closes the sheet, then runs.
 *
 *   openBottomSheet({ title, logo?: Node (shown before the title), sections: [{ heading?, items: [{ icon?: Node, text, hint?, run, act?, disabled? }] }], closeLabel, onClose?, anchor? }) → { close() }
 */
const STYLE_ID = 'bottom-sheet-style';
const CSS = `
.bs-layer { position: fixed; inset: 0; z-index: 3700; background: rgba(0,0,0,.35); } /* above the dialogs (3500) and the colour picker (3600), like the choice menus */
.bs-sheet { position: absolute; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 720px; max-height: 78vh; display: flex; flex-direction: column; box-sizing: border-box; background: var(--btn, var(--paper,#fdfcfa)); color: var(--ink,#1c1b1a); border: 1px solid var(--edge,#bbb); border-bottom: 0; border-radius: 14px 14px 0 0; box-shadow: 0 -4px 18px rgba(0,0,0,.35); font: 15px var(--ui-font,sans-serif); }
.bs-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 16px; border-bottom: 1px solid var(--edge,#ccc); }
.bs-title { font-weight: var(--w-bold,700); }
.bs-close { min-width: var(--ui-target,44px); min-height: var(--ui-target,44px); border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 20px; cursor: pointer; color: inherit; }
.bs-body { overflow-y: auto; overscroll-behavior: contain; padding: 4px 8px calc(10px + env(safe-area-inset-bottom, 0px)); }
.bs-heading { margin: 10px 8px 2px; font-size: 12px; font-weight: var(--w-bold,700); letter-spacing: .03em; text-transform: uppercase; color: var(--ink-soft,#666); }
.bs-row { display: flex; align-items: center; gap: 14px; width: 100%; min-height: max(var(--ui-target,44px), 48px); padding: 6px 10px; border: 0; border-radius: 10px; background: transparent; font: inherit; text-align: left; color: inherit; cursor: pointer; }
.bs-row:active { background: var(--btn-on, #e2e0da); }
.bs-row:disabled { opacity: .45; cursor: default; }
.bs-icon { flex: none; width: 28px; display: inline-flex; justify-content: center; }
.bs-text { flex: 1 1 auto; min-width: 0; }
.bs-hint { display: block; font-size: 12px; color: var(--ink-soft,#666); }
`;

export function openBottomSheet({ title = '', logo = null, sections, closeLabel = 'Close', onClose = null, anchor = null }) {
  if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st); }
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v)); }
    n.append(...kids.flat().filter((x) => x != null));
    return n;
  };
  let closed = false;
  const layer = el('div', { class: 'bs-layer', 'data-bottom-sheet': '', onpointerdown: (e) => { if (e.target === layer) close(); } });
  const body = el('div', { class: 'bs-body' });
  const first = [];
  for (const sec of sections) {
    if (!sec.items?.length) continue;
    if (sec.heading) body.append(el('div', { class: 'bs-heading', role: 'presentation' }, sec.heading));
    for (const it of sec.items) {
      const row = el('button', { type: 'button', class: 'bs-row', 'data-action': it.act ?? null, disabled: it.disabled ? true : null,
        onclick: () => { close(); it.run(); } },
      el('span', { class: 'bs-icon', 'aria-hidden': 'true' }, it.icon ?? null),
      el('span', { class: 'bs-text' }, it.text, it.hint ? el('small', { class: 'bs-hint' }, it.hint) : null));
      body.append(row);
      if (!it.disabled) first.push(row);
    }
  }
  const sheet = el('div', { class: 'bs-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || null },
    el('div', { class: 'bs-head' }, el('span', { class: 'bs-title', style: 'display:flex;align-items:center;gap:10px' }, logo, title), el('button', { type: 'button', class: 'bs-close', 'aria-label': closeLabel, title: closeLabel, onclick: () => close() }, '✕')), body);
  layer.append(sheet);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    layer.remove();
    anchor?.focus?.();
    onClose?.();
  }
  window.addEventListener('keydown', onKey, true);
  document.body.append(layer);
  first[0]?.focus?.();
  return { close };
}
