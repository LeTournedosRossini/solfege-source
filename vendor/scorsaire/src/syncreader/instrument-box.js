/*
 * The INSTRUMENT BOX of the synchro reader (offered by the author at the export, `sync.instruments`): a keyboard or a fretboard that lights the notes of the score
 * while the video plays. Collapsed at first (a single button), so a phone loses no room; the reader chooses the instrument and the track it shows.
 * It reuses the viewers of the editor (`piano-keyboard.js` + `piano-follow.js`, `fretboard.js` + `guitar-follow.js`) and gives them a small adapter in place of a
 * player: the sequence of the score re-timed on the sync map (as the sound of the score does) and the position of the recording / video. Nothing is ever written.
 */
import { buildSequence } from '../audio/sequence.js';
import { retimeSequence } from '../audio/syncscore.js';
import { measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';
import { createPianoKeyboard } from '../ui/piano-keyboard.js';
import { createPianoFollow } from '../ui/piano-follow.js';
import { createFretboard } from '../ui/fretboard.js';
import { createGuitarFollow, trackChoices } from '../ui/guitar-follow.js';
import { mountChordStrip } from './chord-strip.js';
import { applyKeyLook, interfaceTheme, fretboardTheme } from '../ui/piano-look.js';

const PREF_KEY = 'scorsaire.sync.instruments';
const readPref = () => { try { return JSON.parse(window.localStorage.getItem(PREF_KEY) ?? '{}') ?? {}; } catch { return {}; } };
const writePref = (v) => { try { window.localStorage.setItem(PREF_KEY, JSON.stringify(v)); } catch { /* kept for this page */ } };

/** The sequence of the movement on the time of the recording (rate 1, no transposition); `track` = a track id keeps only its notes (null = all). Pure of the DOM. */
export function scoreSequenceOn(work, map, track = null) {
  const movement = work.movements[0];
  const base = buildSequence(work, { speed: 1, playRepeats: !!map.order, chordSymbols: { play: false } });
  const seq = retimeSequence(base, map, { rate: 1, semitones: 0, lengths: movement.masterbars.map((b) => fToNumber(measureLengthOf(b))) });
  return track ? { ...seq, notes: seq.notes.filter((n) => n.track === track) } : seq;
}

/**
 * @param host the element the box goes into (its last child: the box sticks to the bottom of the window) · o.work · o.getMap() the sync map · o.player the clock (`subscribe`, `state`) · o.t i18n lookup
 * @param o.instruments the keyboard / fretboard are offered (default true) · o.chords null | { pool } the chord strip is offered, with the author's layer of fingerings (or 'reader')
 * @returns { destroy() }
 */
export function mountInstrumentBox(host, { work, getMap, player, t, instruments = true, chords = null }) {
  const pref = { open: false, view: 'piano', track: 'all', ...readPref() };
  const save = () => writePref(pref);
  const el = (tag, css = '', attrs = {}) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const btnCss = 'min-height:30px;padding:0 10px;font:inherit';
  const box = el('div', 'position:sticky;bottom:0;z-index:6;background:var(--paper,#faf8f4);border-top:1px solid var(--line,#d8d3c8);padding:4px 8px', { 'data-sr-instruments': '' }); // docked at the bottom of the window while the score scrolls
  const toggle = el('button', btnCss, { type: 'button', 'data-sr-instruments-toggle': '' });
  const body = el('div', 'display:none;margin-top:4px');
  const bar = el('div', 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:4px');
  const bPiano = el('button', btnCss, { type: 'button', 'data-sr-instrument': 'piano' }); bPiano.textContent = t('syncreader.instrumentPiano');
  const bGuitar = el('button', btnCss, { type: 'button', 'data-sr-instrument': 'guitar' }); bGuitar.textContent = t('syncreader.instrumentGuitar');
  const pick = el('select', 'min-height:30px;font:inherit;max-width:60%', { 'data-sr-instrument-track': '', 'aria-label': t('syncreader.instrumentTrack') });
  const pianoWrap = el('div', '', { class: 'sr-pianobox' }); const guitarWrap = el('div');
  if (!document.getElementById('sr-pianobox-style')) document.head.append(Object.assign(el('style'), { id: 'sr-pianobox-style', textContent: '.sr-pianobox .icon-btn, .sr-pianobox .pan-handle { display: none !important; }' })); // the keyboard\'s own buttons (range, menu) are of the editor
  const chordHost = el('div');
  const chordStrip = chords ? mountChordStrip(chordHost, { work, getMap, player, t, pool: chords.pool, variants: chords.variants, groups: chords.groups }) : null;
  if (instruments) bar.append(bPiano, bGuitar, pick);
  body.append(chordHost, ...(instruments ? [bar, pianoWrap, guitarWrap] : [])); box.append(toggle, body); host.append(box);

  // what the viewers take for a player: the position of the recording and the sequence of the score on its time (rebuilt when the map or the track changes)
  const cache = new Map();
  const sequenceFor = (track) => {
    const map = getMap(); const hit = cache.get(track ?? '');
    if (hit && hit.map === map) return hit.seq;
    const seq = scoreSequenceOn(work, map, track); cache.set(track ?? '', { map, seq }); return seq;
  };
  const adapter = (trackOf) => ({ subscribe: (fn) => player.subscribe(fn), state: () => player.state(), sequence: () => sequenceFor(trackOf()) });
  const pianoTrack = () => (pref.track === 'all' ? null : pref.track);

  let keyboard = null; let pianoFollow = null; let board = null; let guitarFollow = null;
  const settings = { track: 'auto', instrument: 'auto', preset: 'standard', limit: 0 };
  const look = () => { keyboard?.setColors(interfaceTheme()); if (keyboard) applyKeyLook(keyboard); board?.setColors(fretboardTheme()); };
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(look) : null; mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark', 'data-hc', 'data-theme'] });

  function ensurePiano() {
    if (keyboard) return;
    keyboard = createPianoKeyboard({ host: pianoWrap, t, readOnly: true }); look();
    pianoFollow = createPianoFollow({ keyboard, enabled: () => pref.open && pref.view === 'piano', byTrack: () => false });
    pianoFollow.attach(adapter(pianoTrack));
  }
  function ensureGuitar() {
    if (board) return;
    board = createFretboard({ host: guitarWrap, theme: fretboardTheme(), readOnly: true });
    guitarFollow = createGuitarFollow({ board, settings: () => settings, enabled: () => pref.open && pref.view === 'guitar' });
    guitarFollow.attach(adapter(() => null));
    guitarFollow.refresh();
  }
  function fillTracks() { // the pitched tracks of the score: « all » (piano) or one of them (it is also the track the fretboard shows)
    const choices = trackChoices(sequenceFor(null));
    pick.replaceChildren(...[{ id: 'all', name: pref.view === 'guitar' ? t('syncreader.instrumentAuto') : t('syncreader.instrumentAll') }, ...choices].map((c) => { const o = el('option'); o.value = c.id; o.textContent = c.name; return o; }));
    if (pref.track !== 'all' && !choices.some((c) => c.id === pref.track)) pref.track = 'all';
    pick.value = pref.track;
  }
  const apply = () => {
    toggle.textContent = `${pref.open ? '▾' : '▸'} ${t(chords ? (instruments ? 'syncreader.chordsAndInstruments' : 'syncreader.chords') : 'syncreader.instruments')}`; toggle.setAttribute('aria-expanded', String(pref.open));
    body.style.display = pref.open ? 'block' : 'none';
    if (!pref.open) { pianoFollow?.refresh(); guitarFollow?.refresh(); return; }
    if (!instruments) return;
    for (const [b, v] of [[bPiano, 'piano'], [bGuitar, 'guitar']]) { b.setAttribute('aria-pressed', String(pref.view === v)); b.style.background = pref.view === v ? 'var(--btn-on,#e2e0da)' : ''; }
    pianoWrap.style.display = pref.view === 'piano' ? 'block' : 'none'; guitarWrap.style.display = pref.view === 'guitar' ? 'block' : 'none';
    if (pref.view === 'piano') { ensurePiano(); board?.allNotesOff(); } else { ensureGuitar(); keyboard?.allNotesOff(); }
    fillTracks();
    settings.track = pref.track === 'all' ? 'auto' : pref.track;
    if (pref.view === 'piano') { pianoFollow.refresh(); pianoFollow.fit(); } else { board.refit(); guitarFollow.refresh(); }
  };
  toggle.addEventListener('click', () => { pref.open = !pref.open; save(); apply(); });
  bPiano.addEventListener('click', () => { pref.view = 'piano'; save(); apply(); });
  bGuitar.addEventListener('click', () => { pref.view = 'guitar'; save(); apply(); });
  pick.addEventListener('change', () => { pref.track = pick.value; save(); apply(); });
  apply();
  return { destroy() { mo?.disconnect(); chordStrip?.destroy(); pianoFollow?.detach(); guitarFollow?.detach(); board?.destroy(); box.remove(); } };
}
