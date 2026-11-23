/*
 * The FRAGMENT EDITOR of the YouTube editor (screen 5): everything about the chosen fragment (a movement of the work), in collapsible sections:
 *   Identity   card number, title, description
 *   Display    the options of the placement chosen on the timeline (given by the caller: the panel puts its rows there)
 *   Tracks     the tracks of the fragment: add from the instrument catalogue, rename, show / hide, reorder, remove
 *   Actions    place at the video position, duplicate, delete
 * It is always visible: with no fragment chosen the sections are greyed and a hint says what to do. Every change goes through the Application (one undoable
 * transaction each). It never touches the screen-1 panels: it only reuses their intents.
 */
import { createInstrumentPicker } from './instrument-picker.js';
import { icon, instrumentIconNode } from './icons.js';
import { CREATABLE_STAFF_TYPES } from './tracks-intents.js';

const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const FIELD = 'font:15px var(--ui-font,sans-serif);border:1px solid var(--line,#d8d3c8);border-radius:6px;padding:4px 6px;box-sizing:border-box;min-width:0;background:var(--btn,#fdfcfa)';

/** What the editor shows (a redraw only happens when it changes). */
export function editorSignature(outline, chosenId) {
  const m = outline.find((x) => x.id === chosenId);
  return JSON.stringify([chosenId, m ? [m.title, m.description, m.cardNumber, m.cardForced, m.canRemove, m.tracks.map((t) => [t.id, t.name, t.visible, t.chord, t.instrumentIcon])] : null, outline.length]);
}

/**
 * @param o.app          the Application
 * @param o.label        translator
 * @param o.lang         language of the instrument names
 * @param o.chosenId()   id of the chosen fragment (or null)
 * @param o.displayHost  element that holds the display rows of the placement (moved into the "Display" section)
 * @param o.onPlace(id) / onDuplicate(id) / onRemove(id)
 * @param o.say(text)    a message line
 */
export function mountYtFragmentEditor(host, { app, label, lang = 'en', chosenId, displayHost, itemSelected = () => false, itemKind = () => null, onPlace, onDuplicate, onRemove, say = () => {} }) {
  const root = el('div', 'display:flex;flex-direction:column;gap:6px', { 'data-yt-fragment-editor': '' });
  host.append(root);
  let sig = ''; let renaming = null; const folds = { identity: true, display: true, tracks: true, actions: true, item: true };
  const run = (fn) => { try { fn(); } catch (e) { say(e?.message ?? String(e)); } draw(true); };
  const btn = (content, title, fn, extra = '') => { const b = el('button', `min-height:var(--ui-target,30px);min-width:var(--ui-target,30px);padding:0 8px;${extra}`, { type: 'button', title, 'aria-label': title }); if (typeof content === 'string') b.textContent = content; else b.append(content); b.addEventListener('click', fn); return b; };
  const field = (kind, value, onCommit, css = '', placeholder = '') => {
    const i = el(kind === 'area' ? 'textarea' : 'input', `${FIELD};${css}`, kind === 'area' ? { rows: '3' } : { type: 'text' });
    i.value = value ?? ''; if (placeholder) i.placeholder = placeholder; i.addEventListener('change', () => onCommit(i.value)); i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && kind !== 'area') i.blur(); }); return i;
  };
  const section = (key, title, body) => {
    const d = el('details', 'border:1px solid var(--line,#d8d3c8);border-radius:8px;background:var(--module,#fcfbf8)', { 'data-yt-section': key });
    if (folds[key]) d.open = true;
    d.addEventListener('toggle', () => { folds[key] = d.open; });
    const s = el('summary', 'cursor:pointer;padding:6px 10px;font:var(--w-bold,700) 14px var(--ui-font,sans-serif);min-height:var(--ui-target,30px);display:flex;align-items:center'); s.textContent = title;
    const inner = el('div', 'padding:6px 10px 10px;display:flex;flex-direction:column;gap:6px'); inner.append(...(Array.isArray(body) ? body : [body]));
    d.append(s, inner); return d;
  };

  const picker = createInstrumentPicker({
    label, lang, staffTypes: CREATABLE_STAFF_TYPES,
    onInstrument: (id, movement, options = {}) => run(() => { app.addInstrumentTrack(id, { movement, ...options }); }),
    onStaffType: (type, movement) => run(() => { app.addTrack({ staves: [{ type }], movement, ...(type === 'chord' ? { name: 'Chords' } : {}) }); }),
  });

  function trackRow(m, tr, index, count) {
    const row = el('div', `display:flex;align-items:center;gap:var(--btn-gap,2px);border:1px solid var(--line,#d8d3c8);border-radius:6px;padding:2px 4px;background:var(--row,#cacad2);${tr.visible ? '' : 'opacity:.55'}`, { 'data-yt-track': tr.id });
    const ic = el('span', 'flex:none;display:inline-flex;width:1.6em;justify-content:center'); if (tr.instrumentIcon) ic.append(instrumentIconNode(tr.instrumentIcon, { size: '1.4em' }));
    row.append(ic);
    if (renaming === tr.id) {
      const i = field('line', tr.name, (v) => { renaming = null; run(() => app.renameTrack(tr.id, v)); }, 'flex:1 1 auto'); i.addEventListener('blur', () => { if (renaming === tr.id) { renaming = null; draw(true); } });
      row.append(i); queueMicrotask(() => { i.focus(); i.select(); });
    } else {
      const name = el('button', 'all:unset;cursor:text;flex:1 1 auto;min-width:0;font:14px var(--ui-font,sans-serif);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 2px', { type: 'button', title: label('ytEditor.trackRename') });
      name.textContent = tr.name || String(index + 1); name.addEventListener('click', () => { renaming = tr.id; draw(true); }); row.append(name);
    }
    const first = m.tracks[0]?.chord ? 1 : 0; // the chord track stays the first one
    row.append(
      btn(icon(tr.visible ? 'eye' : 'eye-off'), label('ytEditor.trackVisible'), () => run(() => app.setVisible(tr.id, !tr.visible))),
      btn(icon('arrow-up'), label('ytEditor.trackUp'), () => run(() => app.moveTrackTo(tr.id, index - 1)), tr.chord || index <= first ? 'opacity:.35;pointer-events:none' : ''),
      btn(icon('arrow-down'), label('ytEditor.trackDown'), () => run(() => app.moveTrackTo(tr.id, index + 1)), tr.chord || index >= count - 1 ? 'opacity:.35;pointer-events:none' : ''),
      btn(icon('trash'), label('ytEditor.trackRemove'), () => run(() => app.removeTrack(tr.id))),
    );
    return row;
  }

  function draw(force = false) {
    const outline = app.tracksOutline() ?? []; const id = chosenId();
    const item = itemSelected(); const next = editorSignature(outline, id) + (renaming ?? '') + (item ? `|item:${itemKind()}` : '');
    if (!force && next === sig) return; sig = next;
    const m = outline.find((x) => x.id === id) ?? null;
    if (displayHost.parentElement) displayHost.remove();
    if (item) { // a card or an annotation of the banner is chosen: only its own bar shows, not the fragment's sections
      root.replaceChildren(section('item', label(`ytEditor.secItem.${itemKind() ?? 'card'}`), displayHost)); displayHost.style.display = 'flex'; return;
    } // detached while the tree is rebuilt
    const hint = el('div', 'font:13px var(--ui-font,sans-serif);color:var(--ink-faint,#777);padding:6px 2px', { 'data-yt-editor-hint': '' }); hint.textContent = label(m ? 'ytEditor.editorHint' : 'ytEditor.editorNone');
    const body = el('div', `display:flex;flex-direction:column;gap:6px;${m ? '' : 'opacity:.45;pointer-events:none'}`);
    if (m) {
      const grid = el('div', 'display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;font:13px var(--ui-font,sans-serif)');
      const lab = (k) => { const s = el('span'); s.textContent = label(k); return s; };
      grid.append(lab('ytEditor.fragNumber'), field('line', m.cardForced ? m.cardNumber : '', (v) => run(() => app.setCardNumber(m.id, v)), 'width:6em', m.cardNumber ?? ''),
        lab('ytEditor.fragTitle'), field('line', m.title, (v) => run(() => app.setCardText(m.id, { title: v }))),
        lab('ytEditor.fragDescription'), field('area', m.description, (v) => run(() => app.setCardText(m.id, { description: v }))));
      displayHost.style.display = 'flex';
      const list = el('div', 'display:flex;flex-direction:column;gap:3px', { 'data-yt-tracks': '' });
      m.tracks.forEach((tr, i) => list.append(trackRow(m, tr, i, m.tracks.length)));
      const add = btn(`+ ${label('tracks.addTrack')}`, label('tracks.addTrack'), () => picker.open({ movements: [{ title: m.title }], movement: m.movementIndex }), 'align-self:flex-start');
      const actions = el('div', 'display:flex;gap:var(--btn-gap,2px);flex-wrap:wrap');
      actions.append(btn(label('ytEditor.placeHere'), label('ytEditor.placeHereHint'), () => { onPlace(m.id); draw(true); }), btn(label('ytEditor.duplicate'), label('ytEditor.duplicateHint'), () => onDuplicate(m.id)),
        btn(label('ytEditor.remove'), label('ytEditor.removeHint'), () => onRemove(m.id), m.canRemove ? '' : 'opacity:.45'));
      body.append(section('identity', label('ytEditor.secIdentity'), grid), section('display', label('ytEditor.secDisplay'), displayHost), section('tracks', label('ytEditor.secTracks'), [list, add]), section('actions', label('ytEditor.secActions'), actions));
    } else {
      body.append(section('identity', label('ytEditor.secIdentity'), el('div')), section('display', label('ytEditor.secDisplay'), displayHost), section('tracks', label('ytEditor.secTracks'), el('div')), section('actions', label('ytEditor.secActions'), el('div')));
    }
    root.replaceChildren(...(m ? [] : [hint]), body);
  }
  draw(true);
  return { refresh: () => draw(false), redraw: () => draw(true), destroy() { picker.close(); root.remove(); } };
}
