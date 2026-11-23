/*
 * The "all of them" window of a picker: when the styles (or grooves, patterns, cards) of the user get numerous, a drop-down list is awkward, so a menu offers this window — a search field, on the left
 * the sections (built in, mine, in the project, and the folders inside them), on the right what is in the chosen section. Picking one gives it to the picker like the menu would.
 */
import { SHEET_QUERY, panelMode } from './panel-mode.js';

const ORIGINS = [['builtin', 'menu.group.builtin'], ['user', 'menu.group.user'], ['project', 'menu.group.project']];
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @param o { items: [{ id, source, folder? }], text(item), label(key), title, value (the current id), onPick(id) }
 */
export function openLibraryDialog({ items, text, label, title, value = null, onPick }) {
  const sheet = panelMode(typeof matchMedia !== 'undefined' && matchMedia(SHEET_QUERY).matches) === 'sheet';
  let origin = null; let folder = null; let query = '';
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const veil = el('div', `position:fixed;inset:0;z-index:3600;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:${sheet ? 'flex-end' : 'center'}`, { 'data-library-dialog': '', 'data-zoom-lock': '' });
  const box = el('div', 'background:var(--paper,#faf8f4);color:var(--ink,#111);padding:12px;font:14px var(--ui-font,sans-serif);box-shadow:0 4px 20px rgba(0,0,0,.4);box-sizing:border-box;width:min(640px,96vw);height:min(460px,92vh);overflow:hidden;display:flex;flex-direction:column;gap:8px;border-radius:8px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  if (!sheet) box.setAttribute('data-resizable', 'library');
  veil.append(box);
  let done = false;
  const close = () => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); veil.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  veil.addEventListener('pointerdown', (e) => { if (e.target === veil) close(); });
  window.addEventListener('keydown', onKey, true);

  const btn = (content, act, fn, on = false, indent = 0) => {
    const b = el('button', `min-height:30px;padding:0 10px 0 ${10 + indent}px;border-radius:6px;font:var(--w-semi,600) 13px var(--ui-font,sans-serif);text-align:left;${on ? 'background:var(--accent-soft,#cfe0ff);border:2px solid var(--sel-edge,#2878ff);' : ''}`, { type: 'button', 'data-act': act });
    b.textContent = content; b.addEventListener('click', fn); return b;
  };

  function draw() {
    const matches = (i) => (origin === null || i.source === origin) && (folder === null || (i.folder ?? '') === folder) && (!query || fold(text(i)).includes(fold(query)));
    const shown = items.filter(matches);
    const head = el('div', 'display:flex;gap:8px;align-items:center');
    const t = el('div', 'font-weight:var(--w-semi,600);font-size:16px;flex:0 0 auto'); t.textContent = title;
    const search = el('input', 'font-size:16px;min-height:30px;box-sizing:border-box;flex:1 1 8em;min-width:6em', { type: 'search', 'data-key': 'library-search', value: query, placeholder: label('library.search') });
    search.addEventListener('input', () => { query = search.value; const at = search.selectionStart; draw(); const again = box.querySelector('[data-key="library-search"]'); again?.focus(); again?.setSelectionRange(at, at); });
    head.append(t, search, btn(label('strum.bake.close'), 'library-close', close));
    const tree = el('div', 'display:flex;flex-direction:column;gap:2px;overflow:auto;flex:0 0 12em;border-right:1px solid var(--edge,#bbb);padding-right:6px');
    tree.append(btn(`${label('library.all')} (${items.length})`, 'library-all', () => { origin = null; folder = null; draw(); }, origin === null));
    for (const [source, key] of ORIGINS) {
      const list = items.filter((i) => i.source === source);
      if (!list.length) continue;
      tree.append(btn(`${label(key)} (${list.length})`, `library-${source}`, () => { origin = source; folder = null; draw(); }, origin === source && folder === null));
      for (const f of [...new Set(list.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b))) {
        tree.append(btn(`▸ ${f} (${list.filter((i) => i.folder === f).length})`, `library-folder-${source}-${f}`, () => { origin = source; folder = f; draw(); }, origin === source && folder === f, 16));
      }
    }
    const listEl = el('div', 'display:flex;flex-direction:column;gap:2px;overflow:auto;flex:1 1 auto', { 'data-library-list': '' });
    for (const i of shown) {
      const b = btn(text(i), `library-pick-${i.id}`, () => { close(); onPick(i.id); }, String(i.id) === String(value));
      b.setAttribute('data-id', String(i.id)); listEl.append(b);
    }
    if (!shown.length) { const none = el('div', 'font-size:12px;color:var(--ink-soft,#555);padding:6px'); none.textContent = label('library.none'); listEl.append(none); }
    const body = el('div', 'display:flex;gap:8px;flex:1 1 auto;min-height:0'); body.append(tree, listEl);
    box.replaceChildren(head, body);
  }

  document.body.append(veil);
  draw();
  return { close };
}
