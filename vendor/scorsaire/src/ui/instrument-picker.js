/*
 * "Add a track" picker (DOM): search the instrument catalogue by text and/or by group, or add an empty staff of a raw type.
 * A centred dialog on desktop, a sheet from the bottom on phones and tablets (`panel-mode.js`); it lives in <body>, so the score never moves.
 * `aria-modal="true"` keeps the note-entry keyboard shortcuts away while it is open.
 * Returns { open({ movements }), close() }. Callbacks: onInstrument(instrumentId, movementIndex), onStaffType(type, movementIndex).
 */
import { SHEET_QUERY } from './panel-mode.js';
import { createChoiceMenu } from './choice-menu.js';
import { instrumentGroups, instrumentGenres, searchInstruments } from '../model/instruments.js';

const STYLE_ID = 'instrument-picker-style';
const MAX_RESULTS = 120;
/** The staff types of the "empty staff" block, two per row; the chord track comes first, alone. */
const EMPTY_ROWS = [['chord'], ['score', 'tab'], ['percussion', 'rhythm'], ['neutral', 'accordion-left']];
/** The pop / rock quick list: a plain instrument, or a drawer of choices { key (label), id (catalogue instrument), options }. */
export const POP_QUICK = Object.freeze([
  { key: 'voice', id: 'voice' },
  { key: 'guitar', drawer: [{ key: 'tab', id: 'electric-guitar-tablature' }, { key: 'score', id: 'electric-guitar' }, { key: 'both', id: 'electric-guitar-tablature', options: { linkedNotation: { clef: 'G' } } }] },
  { key: 'keys', drawer: [{ key: 'piano', id: 'piano' }, { key: 'epiano', id: 'electric-piano' }, { key: 'organ', id: 'hammond-organ' }, { key: 'synth', id: 'poly-synth' }] },
  { key: 'bass', drawer: [{ key: 'tab', id: 'electric-bass-4-str-tab' }, { key: 'score', id: 'electric-bass' }, { key: 'both', id: 'electric-bass-4-str-tab', options: { linkedNotation: { clef: 'F' } } }] },
  { key: 'drums', id: 'drumset', options: { scorsaireKit: true } },
  { key: 'sax', drawer: [{ key: 'saxSoprano', id: 'soprano-saxophone' }, { key: 'saxAlto', id: 'alto-saxophone' }, { key: 'saxTenor', id: 'tenor-saxophone' }, { key: 'saxBaritone', id: 'baritone-saxophone' }] },
  { key: 'strings', drawer: [{ key: 'violin', id: 'violin' }, { key: 'viola', id: 'viola' }, { key: 'cello', id: 'violoncello' }, { key: 'doubleBass', id: 'double-bass' }] },
]);
const CSS = `
[data-instrument-picker] { position: fixed; z-index: 1000; background: var(--field,#fff); color: var(--ink,#111); border: 1px solid var(--edge,#888); box-shadow: 0 4px 20px rgba(0,0,0,.35); font: 14px var(--ui-font,sans-serif); box-sizing: border-box; display: flex; flex-direction: column; --ip-target: var(--ui-target, 30px); }
[data-instrument-picker][data-mode="sheet"] { left: 0; right: 0; bottom: 0; margin: 0 auto; width: min(720px, 100vw); height: min(80vh, 640px); border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom); }
[data-instrument-picker][data-mode="floating"] { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 520px; max-width: calc(100vw - 16px); height: min(640px, calc(100vh - 32px)); border-radius: 8px; }
[data-instrument-picker] .ip-head { display: flex; align-items: center; gap: var(--btn-gap, 2px); padding: 6px 6px 6px 12px; background: var(--soft,#f1f1f1); border-bottom: 1px solid var(--edge,#ccc); }
[data-instrument-picker] .ip-title { flex: 1 1 auto; font-weight: var(--w-semi,600); }
[data-instrument-picker] .ip-controls { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); padding: 8px; border-bottom: 1px solid var(--line,#ddd); }
[data-instrument-picker] .ip-controls input { flex: 1 1 180px; min-width: 0; min-height: var(--ip-target); box-sizing: border-box; padding: 0 8px; font: 16px var(--ui-font,sans-serif); border: 1px solid var(--edge,#888); border-radius: 6px; }
[data-instrument-picker] button { min-width: var(--ip-target); min-height: var(--ip-target); padding: 0 10px; font: inherit; }
[data-instrument-picker] .ip-list { flex: 1 1 auto; overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: var(--btn-gap, 2px); }
[data-instrument-picker] .ip-item { text-align: left; border: 1px solid var(--edge,#ccc); border-radius: 8px; background: var(--soft,#fafafa); display: flex; justify-content: space-between; gap: var(--btn-gap, 2px); align-items: center; }
[data-instrument-picker] .ip-name { flex: 1 1 auto; text-align: left; }
[data-instrument-picker] .ip-meta { color: var(--ink-soft,#666); font-size: 12px; white-space: nowrap; }
[data-instrument-picker] .ip-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--btn-gap, 2px); }
[data-instrument-picker] .ip-drawer { display: flex; flex-wrap: wrap; gap: var(--btn-gap, 2px); padding: 2px 0 4px 18px; }
[data-instrument-picker] .ip-section { font-weight: var(--w-semi,600); color: var(--ink-soft,#555); padding: 6px 2px 0; }
[data-instrument-picker] .ip-note { color: var(--ink-soft,#666); padding: 6px 2px; }
`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null));
  return e;
};

/** Pure: the rows the picker shows for a query (capped), plus whether more matched. */
export function pickerResults({ query = '', group = '', genre = '', lang = 'en' } = {}) {
  // typing words searches EVERY instrument (the genre filter only shapes the list when nothing is typed)
  const all = searchInstruments({ query, group, genre: query.trim() ? '' : genre, lang });
  return { items: all.slice(0, MAX_RESULTS), total: all.length };
}

import { dismissOnOutside } from './outside-dismiss.js';
import { instrumentIconNode } from './icons.js';
import { instrumentIconName } from '../model/instrument-icons.js';

export function createInstrumentPicker({ label = (k) => k, lang = 'en', staffTypes = [], onInstrument, onStaffType, photo = () => true }) {
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) document.head.append(el('style', { id: STYLE_ID }, CSS));
  let dialog = null;
  let state = null;
  let keyHandler = null;
  let offOutside = null;

  function close() {
    offOutside?.(); offOutside = null;
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    dialog?.remove();
    dialog = null;
    state = null;
  }

  function drawList() {
    const list = dialog.querySelector('.ip-list');
    const { items, total } = pickerResults({ query: state.query, group: state.group, genre: state.genre, lang });
    const nodes = [];
    if (!state.query && !state.group) {
      nodes.push(el('div', { class: 'ip-section' }, label('tracks.picker.emptyStaff')));
      const pick = (type) => { const mv = state.movement; close(); onStaffType(type, mv); };
      for (const row of EMPTY_ROWS) {
        const types = row.filter((t) => staffTypes.includes(t));
        if (!types.length) continue;
        const buttons = types.map((type) => el('button', { type: 'button', class: 'ip-item', 'data-staff-type': type, onclick: () => pick(type) },
          // the chord staff is named « chord track »; the parenthesis of the rhythm type ("slashes") is dropped here
          type === 'chord' ? label('tracks.picker.chordTrack') : label(`staffType.${type}`).replace(/\s*\(.*\)\s*$/, '')));
        nodes.push(types.length === 1 ? buttons[0] : el('div', { class: 'ip-pair' }, ...buttons));
      }
      if (state.genre === 'popular') { // the pop / rock quick list, above the whole catalogue
        nodes.push(el('div', { class: 'ip-section' }, label('tracks.picker.quick')));
        const add = (id, options, key) => { const mv = state.movement; close(); onInstrument(id, mv, { ...options, ...(options?.linkedNotation ? { name: label(`tracks.picker.q.${key}`) } : {}) }); }; // the tablature + notation pair is named after the instrument, not « (Tablature) »
        for (const q of POP_QUICK) {
          if (!q.drawer) { nodes.push(el('button', { type: 'button', class: 'ip-item', 'data-quick': q.key, onclick: () => add(q.id, q.options ?? {}, q.key) }, el('span', { class: 'ip-name' }, label(`tracks.picker.q.${q.key}`)))); continue; }
          const open = state.drawer === q.key;
          nodes.push(el('button', { type: 'button', class: 'ip-item', 'data-quick': q.key, 'aria-expanded': String(open), onclick: () => { state.drawer = open ? null : q.key; drawList(); } },
            el('span', { class: 'ip-name' }, label(`tracks.picker.q.${q.key}`)), el('span', { class: 'ip-meta' }, open ? '▾' : '▸')));
          if (open) nodes.push(el('div', { class: 'ip-drawer', 'data-drawer': q.key }, ...q.drawer.map((d) => el('button', { type: 'button', class: 'ip-item', 'data-quick-choice': `${q.key}:${d.key}`, onclick: () => add(d.id, d.options ?? {}, q.key) }, label(`tracks.picker.q.${d.key}`)))));
        }
      }
      nodes.push(el('div', { class: 'ip-section' }, label('tracks.picker.instruments')));
    }
    if (!items.length) nodes.push(el('div', { class: 'ip-note' }, label('tracks.picker.none')));
    for (const it of items) {
      nodes.push(el('button', { type: 'button', class: 'ip-item', 'data-instrument': it.id, onclick: () => { const mv = state.movement; close(); onInstrument(it.id, mv); } },
        (() => { const n = instrumentIconName(it.id, { family: it.family, group: it.group }); return n ? instrumentIconNode(n, { photo: photo(), size: '1.5em' }) : null; })(), el('span', { class: 'ip-name' }, it.name), el('span', { class: 'ip-meta' }, it.staves > 1 ? label('tracks.picker.staves', { n: it.staves }) : '')));
    }
    if (total > items.length) nodes.push(el('div', { class: 'ip-note' }, label('tracks.picker.more', { shown: items.length, total })));
    list.replaceChildren(...nodes);
  }

  function open({ movements = [{ title: '' }], movement = 0 } = {}) {
    close();
    state = { query: '', group: '', genre: 'popular', drawer: null, movement }; // opens on the pop / rock genre
    const sheet = window.matchMedia ? window.matchMedia(SHEET_QUERY).matches : false;
    const groupOptions = [['', label('tracks.picker.allGroups')], ...instrumentGroups(lang).map((g) => [g.id, g.name])];
    const genreOptions = [['', label('tracks.picker.allGenres')], ...instrumentGenres(lang).map((g) => [g.id, g.name])];
    const genreButton = () => createChoiceMenu({ options: genreOptions, value: state.genre, label: label('tracks.picker.genre'), act: 'picker-genre',
      onPick: (v) => { state.genre = v; controls.replaceChild(genreButton(), controls.querySelector('[data-act="picker-genre"]')); drawList(); } });
    const search = el('input', { type: 'search', 'data-key': 'picker-search', placeholder: label('tracks.picker.search'), 'aria-label': label('tracks.picker.search'), autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => { state.query = e.target.value; drawList(); } });
    const groupButton = () => {
      const b = createChoiceMenu({ options: groupOptions, value: state.group, label: label('tracks.picker.group'), act: 'picker-group',
        onPick: (v) => { state.group = v; const next = groupButton(); controls.replaceChild(next, controls.querySelector('[data-act="picker-group"]')); drawList(); } });
      return b;
    };
    const movementButton = () => createChoiceMenu({
      options: movements.map((m, i) => [i, m.title || label('tracks.movement', { n: i + 1 })]), value: state.movement, label: label('tracks.picker.movement'), act: 'picker-movement',
      onPick: (v) => { state.movement = Number(v); const next = movementButton(); controls.replaceChild(next, controls.querySelector('[data-act="picker-movement"]')); },
    });
    const controls = el('div', { class: 'ip-controls' }, search, genreButton(), groupButton(), movements.length > 1 ? movementButton() : null);
    dialog = el('div', { 'data-instrument-picker': '', 'data-resizable': 'instrumentPicker', 'data-zoom-lock': '', 'data-mode': sheet ? 'sheet' : 'floating', role: 'dialog', 'aria-modal': 'true', 'aria-label': label('tracks.picker.title') },
      el('div', { class: 'ip-head' }, el('span', { class: 'ip-title' }, label('tracks.picker.title')),
        el('button', { type: 'button', 'data-act': 'picker-close', 'aria-label': label('tracks.close'), title: label('tracks.close'), onclick: close }, '✕')),
      controls, el('div', { class: 'ip-list' }));
    keyHandler = (e) => { if (e.key === 'Escape' && !document.querySelector('.cm-layer')) { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', keyHandler, true);
    document.body.append(dialog);
    offOutside = dismissOnOutside(() => dialog, close);
    drawList();
    search.focus({ preventScroll: true });
  }

  return { open, close, isOpen: () => !!dialog };
}
