/*
 * Song picker (DOM): a playlist file (iReal Pro) holds several songs; the open command asks which one to import.
 * A centred dialog on desktop, a sheet from the bottom on phones and tablets; in <body>, so the score never moves; `aria-modal` keeps the
 * note-entry shortcuts away. Resolves the chosen song, or null (cancel, Escape, a press outside).
 */
import { SHEET_QUERY } from './panel-mode.js';
import { dismissOnOutside } from './outside-dismiss.js';

const STYLE_ID = 'song-picker-style';
const CSS = `
[data-song-picker] { position: fixed; z-index: 1000; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 20px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); --sp-target: var(--ui-target, 30px); }
[data-song-picker][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); max-height: 85vh; border-radius: 12px 12px 0 0; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
[data-song-picker][data-mode="floating"] { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 520px; max-width: calc(100vw - 16px); max-height: calc(100vh - 32px); border-radius: 8px; }
[data-song-picker] h2 { margin: 0; font-size: 15px; }
[data-song-picker] input { font: 16px var(--ui-font,sans-serif); min-height: var(--sp-target); padding: 0 8px; box-sizing: border-box; }
[data-song-picker] .sp-list { overflow: auto; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); min-height: 120px; }
[data-song-picker] .sp-list button { text-align: left; min-height: var(--sp-target); padding: 4px 10px; font: inherit; background: var(--soft,#f4f4f4); border: 1px solid var(--edge,#ccc); border-radius: 4px; }
[data-song-picker] .sp-list small { color: var(--ink-soft,#555); display: block; }
[data-song-picker] .sp-actions { display: flex; justify-content: flex-end; }
[data-song-picker] .sp-actions button { min-width: var(--sp-target); min-height: var(--sp-target); padding: 0 14px; font: inherit; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * `songs` = [{ title, composer, style, key }]; `label(key, params)` resolves a text.
 * `multiple`: a list to tick (resolves { songs, merge }). `allowMerge` (opening ONE song): a button turns the list into ticks to merge the parts of a long song (resolves { songs, merge: true }),
 * else the chosen song itself.
 */
export function pickSong({ songs, label, multiple = false, allowMerge = false }) {
  if (!document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  return new Promise((resolve) => {
    const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false;
    let mode = multiple ? 'many' : 'single'; // 'single' = a press chooses · 'many' = tick, add or merge · 'merge' = tick the parts to merge and open
    let offOutside = null;
    const finish = (value) => { offOutside?.(); window.removeEventListener('keydown', onKey, true); dialog.remove(); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(null); } };
    const list = el('div', { class: 'sp-list', 'data-song-list': '' });
    const checked = new Set();
    const ticks = () => mode !== 'single';
    const draw = (query) => {
      list.replaceChildren(...songs.map((s, i) => ({ s, i })).filter(({ s }) => !query || plain(`${s.title} ${s.composer} ${s.style}`).includes(plain(query)))
        .map(({ s, i }) => (ticks()
          ? el('label', { 'data-song': String(i), style: 'display:flex;gap:8px;align-items:center;min-height:var(--sp-target);padding:4px 10px;background:var(--soft,#f4f4f4);border:1px solid var(--edge,#ccc);border-radius:4px' },
            el('input', { type: 'checkbox', 'data-song-check': String(i), ...(checked.has(i) ? { checked: true } : {}), onchange: (e) => { if (e.target.checked) checked.add(i); else checked.delete(i); paintCount(); } }),
            el('span', { style: 'flex:1' }, `${i + 1}. ${s.title}`, el('small', {}, [s.composer, s.style, s.key].filter(Boolean).join(' · '))))
          : el('button', { type: 'button', 'data-song': String(i), onclick: () => finish(s) },
            `${i + 1}. ${s.title}`, el('small', {}, [s.composer, s.style, s.key].filter(Boolean).join(' · '))))));
    };
    const chosen = () => songs.filter((_, i) => checked.has(i));
    const okBtn = el('button', { type: 'button', 'data-act': 'song-ok', onclick: () => finish({ songs: chosen(), merge: false }) });
    const mergeBtn = el('button', { type: 'button', 'data-act': 'song-merge', title: label('song.mergeHint'), onclick: () => finish({ songs: chosen(), merge: true }) }, label('song.merge'));
    const mergeModeBtn = el('button', { type: 'button', 'data-act': 'song-merge-mode', title: label('song.mergeHint'), onclick: () => { mode = 'merge'; checked.clear(); render(); } }, label('song.mergeMode'));
    const backBtn = el('button', { type: 'button', 'data-act': 'song-back', onclick: () => { mode = 'single'; render(); } }, label('song.back'));
    const paintCount = () => { okBtn.textContent = label('song.addN', { n: checked.size }); okBtn.disabled = !checked.size; mergeBtn.disabled = checked.size < 2; };
    const setAll = (on) => { checked.clear(); if (on) songs.forEach((_, i) => checked.add(i)); draw(search.value); paintCount(); };
    const bulk = el('div', { class: 'sp-actions', style: 'justify-content:flex-start;gap:6px' }, el('button', { type: 'button', 'data-act': 'song-all', onclick: () => setAll(true) }, label('song.all')), el('button', { type: 'button', 'data-act': 'song-none', onclick: () => setAll(false) }, label('song.none')));
    const search = el('input', { type: 'search', placeholder: label('song.filter'), 'aria-label': label('song.filter'), oninput: () => draw(search.value) });
    const foot = el('div', { class: 'sp-actions', style: 'gap:6px;flex-wrap:wrap' });
    const head = el('h2', {}, label('song.title', { n: songs.length }));
    const dialog = el('div', { 'data-song-picker': '', ...(multiple ? { style: 'z-index:3700' } : {}), 'data-resizable': 'songPicker', 'data-zoom-lock': '', 'data-mode': sheet ? 'sheet' : 'floating', role: 'dialog', 'aria-modal': 'true', 'aria-label': label('song.title', { n: songs.length }) }, head, search, bulk, list, foot);
    const render = () => {
      if (mode === 'many') songs.forEach((_, i) => checked.add(i)); // several songs to add: all ticked to begin with
      bulk.style.display = ticks() ? '' : 'none';
      const cancel = el('button', { type: 'button', 'data-act': 'song-cancel', onclick: () => finish(null) }, label('song.cancel'));
      foot.replaceChildren(...(mode === 'many' ? [cancel, mergeBtn, okBtn] : mode === 'merge' ? [backBtn, mergeBtn] : [...(allowMerge && songs.length > 1 ? [mergeModeBtn] : []), cancel]));
      draw(search.value); if (ticks()) paintCount();
    };
    render();
    window.addEventListener('keydown', onKey, true);
    document.body.append(dialog);
    offOutside = dismissOnOutside(() => dialog, () => finish(null));
    dialog.querySelector('input').focus({ preventScroll: true });
  });
}
