/*
 * The VIEWERS of the reader: a folded strip at the bottom of the page that unfolds into a piano keyboard or a guitar fretboard lighting what the
 * chosen track plays. They are the same modules as the editor's (`ui/piano-keyboard.js`, `ui/fretboard.js` and their "follow" parts), fed by a small
 * adapter that looks like the editor's player (`subscribe`, `sequence()`, `state()`); here the player is the playback of a cell.
 *   viewers.tick({ playing, position, sequence })  → to call on every frame while a cell plays, and once more when it stops
 *   viewers.setTrack(id | null)                    → the track sent to the viewers (null: every track for the piano, the best guess for the guitar)
 */
import { createPianoKeyboard } from '../ui/piano-keyboard.js';
import { applyKeyLook, interfaceTheme, fretboardTheme } from '../ui/piano-look.js';
import { createPianoFollow, trackColors } from '../ui/piano-follow.js';
import { createFretboard } from '../ui/fretboard.js';
import { createGuitarFollow } from '../ui/guitar-follow.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};

const CSS = `
.rv { position: fixed; left: 0; right: 0; bottom: 0; z-index: 8; background: var(--soft,#f3f0e8); border-top: 1px solid var(--line,#d8d3c8); font: 14px var(--ui-font,sans-serif); }
.rv-head { display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
.rv-head button { min-height: 32px; padding: 0 12px; font: inherit; background: var(--field,#fff); border: 1px solid var(--edge,#bbb); border-radius: 8px; cursor: pointer; }
.rv-head button[aria-pressed="true"] { background: #1c1b1a; color: #fff; border-color: var(--ink,#1c1b1a); }
.rv-title { font-weight: var(--w-semi,600); margin-right: 6px; } .rv-track { color: var(--ink-soft,#555); font-size: 13px; margin-left: 6px; }
.rv-body { height: 200px; padding: 0 10px 8px; box-sizing: border-box; overflow: hidden; display: none; }
.rv[data-open] .rv-body { display: block; }
.rv-body > div { height: 100%; }
.pkb { box-shadow: none !important; }
`;

/** → { element, tick, setTrack, track, onChange(fn), open(on), height() } */
export function mountReaderViewers({ host, t, trackName = () => '' }) {
  if (!document.getElementById('rv-style')) { const st = el('style', { id: 'rv-style' }); st.textContent = CSS; document.head.append(st); }
  const state = { open: false, view: 'piano', tracks: [], instrument: 'auto' };
  const listeners = new Set(); const changeListeners = new Set();
  let last = { playing: false, position: 0 }; let lastSeq = null; let filtered = null; let filteredFor = null;
  /** The adapter: what the follow modules expect of the editor's player. */
  const player = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    state: () => last,
    sequence() {
      if (!lastSeq) return null;
      if (!state.tracks.length || state.view !== 'piano') return lastSeq; // the guitar picks its own tracks by id
      const k = state.tracks.join(',');
      if (filtered && filteredFor === lastSeq && filtered.__tracks === k) return filtered;
      const keep = new Set(state.tracks);
      filtered = { ...lastSeq, notes: lastSeq.notes.filter((n) => keep.has(n.track)), __tracks: k }; filteredFor = lastSeq;
      return filtered;
    },
  };
  const root = el('div', { class: 'rv', 'data-reader-viewers': '' });
  const trackLabel = el('span', { class: 'rv-track' });
  const pianoBtn = el('button', { type: 'button', 'data-no-icon': '', 'data-view': 'piano', onclick: () => setView('piano') }, t('reader.piano'));
  const guitarBtn = el('button', { type: 'button', 'data-no-icon': '', 'data-view': 'guitar', onclick: () => setView('guitar') }, t('reader.guitar'));
  const INSTRUMENTS = [['auto', 'reader.inst.auto'], ['guitar', 'reader.inst.guitar'], ['guitar7', 'reader.inst.guitar7'], ['bass', 'reader.inst.bass'], ['bass5', 'reader.inst.bass5'], ['ukulele', 'reader.inst.ukulele']];
  const instrumentSel = el('select', { 'aria-label': t('reader.instrument'), 'data-instrument': '', style: 'min-height:32px;font:inherit;display:none', onchange: (e) => { state.instrument = e.target.value; rebuildGuitar(); } }, ...INSTRUMENTS.map(([v, k]) => el('option', { value: v }, t(k))));
  const fold = el('button', { type: 'button', 'data-no-icon': '', 'data-action': 'viewers', 'aria-pressed': 'false', 'aria-label': t('reader.viewers'), title: t('reader.viewers'), onclick: () => open(!state.open) }, '▴');
  const body = el('div', { class: 'rv-body' });
  const pianoHost = el('div'); const guitarHost = el('div'); guitarHost.style.display = 'none';
  body.append(pianoHost, guitarHost);
  root.append(el('div', { class: 'rv-head' }, el('span', { class: 'rv-title' }, t('reader.viewers')), pianoBtn, guitarBtn, instrumentSel, trackLabel, el('span', { style: 'flex:1' }), fold), body);
  host.append(root);

  let keyboard = null; let pianoFollow = null; let board = null; let guitarFollow = null;
  // the instruments follow the light / dark switch of the page
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (keyboard) { keyboard.setColors(interfaceTheme()); applyKeyLook(keyboard); } board?.setColors(fretboardTheme()); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark', 'data-hc'] });
  function ensurePiano() {
    if (keyboard) return;
    keyboard = createPianoKeyboard({ host: pianoHost, t, readOnly: true });
    keyboard.setColors(interfaceTheme()); applyKeyLook(keyboard); keyboard.setResponsiveKeys({ enabled: true, keyWidth: 40 });
    pianoFollow = createPianoFollow({ keyboard, enabled: () => state.open && state.view === 'piano', byTrack: () => true }); // each track lights its keys in its own colour
    pianoFollow.attach(player);
  }
  /** Each selected track has its own follower on the ONE fretboard (a pitch lit by two tracks stays lit until both stop); the first one sets the tuning. */
  let follows = [];
  const lit = new Map(); // midi → Set of track ids lighting it
  const colorOf = (id) => trackColors(lastSeq).get(id) ?? null;
  function proxyFor(id, primary) {
    return {
      noteOn(midi, velocity, _c, pos) { const who = lit.get(midi) ?? new Set(); who.add(id); lit.set(midi, who); board.noteOn(midi, velocity, state.tracks.length ? colorOf(id) : null, pos); },
      noteOff(midi) { const who = lit.get(midi); who?.delete(id); if (!who || !who.size) { lit.delete(midi); board.noteOff(midi); } },
      allNotesOff() {},
      setTuning(tn) { if (primary) board.setTuning(tn); },
      setCapo(c) { if (primary) board.setCapo?.(c); },
    };
  }
  function rebuildGuitar() {
    if (!board) return;
    for (const f of follows) f.detach();
    for (const midi of [...lit.keys()]) board.noteOff(midi); lit.clear();
    const ids = state.tracks.length ? state.tracks : [null];
    follows = ids.map((id, k) => {
      const f = createGuitarFollow({ board: proxyFor(id, k === 0), settings: () => ({ track: id ?? 'auto', instrument: state.instrument, preset: 'standard', limit: 0 }), enabled: () => state.open && state.view === 'guitar' });
      f.attach(player); return f;
    });
    for (const f of follows) f.refresh();
  }
  function ensureGuitar() {
    if (board) return;
    board = createFretboard({ host: guitarHost, readOnly: true, theme: fretboardTheme() });
    rebuildGuitar();
  }
  function paint() {
    pianoBtn.setAttribute('aria-pressed', String(state.view === 'piano')); guitarBtn.setAttribute('aria-pressed', String(state.view === 'guitar'));
    fold.setAttribute('aria-pressed', String(state.open)); fold.textContent = state.open ? '▾' : '▴';
    instrumentSel.style.display = state.view === 'guitar' ? '' : 'none';
    trackLabel.textContent = state.tracks.length ? `· ${state.tracks.map((id) => trackName(id) || id).join(', ')}` : `· ${t('reader.allTracks')}`;
    if (state.open) { root.setAttribute('data-open', ''); } else root.removeAttribute('data-open');
    pianoHost.style.display = state.view === 'piano' ? '' : 'none'; guitarHost.style.display = state.view === 'guitar' ? '' : 'none';
    if (state.open) { if (state.view === 'piano') { ensurePiano(); pianoFollow?.refresh(); } else { ensureGuitar(); for (const f of follows) f.refresh(); } }
    for (const fn of changeListeners) fn(state);
  }
  function setView(v) { state.view = v; paint(); }
  function open(on) { state.open = Boolean(on); paint(); }
  paint();
  return {
    element: root,
    tick(s) {
      last = { playing: Boolean(s.playing), position: s.position ?? 0 }; if (s.sequence !== undefined) lastSeq = s.sequence;
      for (const fn of [...listeners]) fn(last);
    },
    /** Adds the track to the ones sent to the viewers, or removes it when it is already there. */
    toggleTrack(id) {
      const k = state.tracks.indexOf(id); if (k >= 0) state.tracks.splice(k, 1); else state.tracks.push(id);
      filtered = null; if (state.open) { pianoFollow?.refresh(); rebuildGuitar(); } paint();
    },
    clearTracks() { state.tracks = []; filtered = null; if (state.open) { pianoFollow?.refresh(); rebuildGuitar(); } paint(); },
    has: (id) => state.tracks.includes(id),
    tracks: () => [...state.tracks],
    /** The colour a track lights its keys in (the sequence gives the order). */
    colorOf: (id, sequence = lastSeq) => trackColors(sequence).get(id) ?? null,
    hint(sequence) { if (sequence) lastSeq = sequence; },
    open,
    setView,
    isOpen: () => state.open,
    onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    height: () => root.offsetHeight,
    destroy() { pianoFollow?.detach(); for (const f of follows) f.detach(); keyboard?.destroy?.(); root.remove(); },
  };
}
