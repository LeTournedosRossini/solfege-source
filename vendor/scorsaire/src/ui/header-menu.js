/*
 * A traditional drop-down menu that opens under a button of the page header (computers). `open()` builds the content with `build(menu, close)` and
 * places the menu under the button; an appearance outside, Escape or a choice closes it; pressing the button again also closes it.
 */
const STYLE = 'position:fixed;z-index:3000;background:var(--btn,#fdfcfa);color:var(--ink,#111);border:1px solid #aaa;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.28);padding:4px;box-sizing:border-box;min-width:200px;max-width:min(360px,calc(100vw - 16px));max-height:calc(100vh - 80px);overflow:auto;font:14px var(--ui-font,sans-serif)';

/** A menu row: an icon, a text; `run` is called after the menu has closed. */
export function menuRow({ icon = null, text, run, act = '', disabled = false }, close) {
  const b = document.createElement('button');
  b.type = 'button'; if (act) b.setAttribute('data-action', act);
  b.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;min-height:var(--ui-target,30px);padding:0 10px;border:0;border-radius:6px;background:transparent;text-align:left;cursor:pointer;font:inherit';
  b.disabled = disabled;
  if (icon) { const holder = document.createElement('span'); holder.style.cssText = 'flex:none;width:1.4em;display:inline-flex;justify-content:center'; holder.append(icon); b.append(holder); }
  const t = document.createElement('span'); t.textContent = text; b.append(t);
  b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = '#efece4'; });
  b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
  b.addEventListener('click', () => { close(); run(); });
  return b;
}

export function menuSeparator() { const d = document.createElement('div'); d.style.cssText = 'height:1px;background:#ddd;margin:4px 2px'; return d; }

/**
 * @param o.button  the header button the menu hangs from
 * @param o.build   (menu, close) → fills the menu
 * @param o.onClose called once when the menu closes
 */
export function createHeaderMenu({ button, build, onClose = () => {}, above = false }) {
  let menu = null; let off = null;
  const close = () => {
    if (!menu) return;
    off?.(); off = null; menu.remove(); menu = null;
    button.setAttribute('aria-expanded', 'false');
    onClose();
  };
  const place = () => {
    const r = button.getBoundingClientRect();
    menu.style.top = above ? `${Math.max(8, Math.round(r.top - menu.offsetHeight - 4))}px` : `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - menu.offsetWidth - 8))}px`;
  };
  const open = () => {
    if (menu) return;
    menu = document.createElement('div');
    menu.setAttribute('data-header-menu', ''); menu.setAttribute('role', 'menu'); menu.setAttribute('data-dismiss-keep', ''); menu.style.cssText = STYLE;
    build(menu, close);
    document.body.append(menu);
    place();
    button.setAttribute('aria-expanded', 'true');
    const onDown = (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    off = () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close); };
  };
  return { open, close, toggle: () => (menu ? close() : open()), isOpen: () => !!menu, element: () => menu };
}
