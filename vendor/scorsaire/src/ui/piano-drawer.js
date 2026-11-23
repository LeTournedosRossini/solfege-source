/*
 * The piano button of the bottom dock: opens (or closes) the on-screen keyboard in its panel above the rows (`dock.pianoHost`). The keyboard is created
 * on the first opening and kept; it follows the playback (keys lit while the score plays, `piano-follow.js`) and, played with the finger, it sounds
 * through the current audio engine: a key pressed is a NOTE ON, released a NOTE OFF (`liveNoteOn` / `liveNoteOff` of the engines), or, as the user
 * chooses in the keyboard's menu, one short note per press. The menu also chooses to colour the lit keys by track. It never writes into the document.
 * The frame and the buttons of the keyboard take the colours of the interface; the colours of the KEYS are left to the keyboard.
 */
import { icon } from './icons.js';
import { drawnById } from './mark-icons.js';
import { createPianoKeyboard } from './piano-keyboard.js';
import { createPianoFollow } from './piano-follow.js';
import { createFretboard } from './fretboard.js';
import { createGuitarFollow } from './guitar-follow.js';
import { presetsFor } from '../model/fretboardmap.js';
import { DEFAULT_VOLUME } from '../audio/mixer.js';

import { applyKeyLook, interfaceTheme, fretboardTheme } from './piano-look.js';
export { interfaceTheme, fretboardTheme };

export function applyPianoLook(kb) {
  kb.setColors(interfaceTheme());
  applyKeyLook(kb);
}

// the keyboard belongs to the interface: no drop shadow around it (the module draws one, made for a dark page)
if (typeof document !== 'undefined' && !document.getElementById('pkb-flat-style')) { const st = document.createElement('style'); st.id = 'pkb-flat-style'; st.textContent = '.pkb { box-shadow: none !important; }'; document.head.append(st); }

export function mountPianoDrawer({ dock, label = (k) => k, getEngine = () => null, isPlaying = () => false, storage = null, sidebar = null }) {
  let listTracks = null; // () → [{ id, name }]: the tracks the fretboard can show (the document's, before any sequence exists)
  const button = document.createElement('button');
  button.type = 'button'; button.title = label('dock.piano'); button.setAttribute('aria-label', button.title); button.setAttribute('data-action', 'piano-toggle');
  button.append(icon('piano'));
  button.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative';
  dock.bottomBase.append(button);
  // the instruments follow the theme when it changes
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (keyboard) applyPianoLook(keyboard); if (typeof vkeyboard !== 'undefined' && vkeyboard) applyPianoLook(vkeyboard); board?.setColors(fretboardTheme()); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark', 'data-hc'] });
  let keyboard = null; let follow = null; let board = null; let guitarFollow = null; let lastPlayer = null;
  let vkeyboard = null; let vfollow = null; // the vertical keyboard of the sidebar
  const pianoWrap = document.createElement('div'); pianoWrap.style.cssText = 'width:100%;min-width:0';
  const guitarWrap = document.createElement('div'); guitarWrap.style.cssText = 'width:100%;min-width:0;display:none';
  dock.pianoHost.append(pianoWrap, guitarWrap);
  const KEY = 'scorsaire.pianoOpen'; const PREF = 'scorsaire.piano';
  // device choices (never in the document): held notes (note on / note off) or one short note per press; one colour per track for the lit keys
  const DEFAULTS = { hold: true, colorByTrack: false, view: 'piano', pianoOrientation: 'horizontal', guitar: { track: 'auto', instrument: 'auto', preset: 'standard', limit: 0, frets: 0, start: 0, orientation: 'horizontal', flip: false, nutAtEnd: false } };
  const prefs = (() => {
    try { const raw = JSON.parse(storage?.getItem(PREF) ?? '{}'); return { ...DEFAULTS, ...raw, guitar: { ...DEFAULTS.guitar, ...(raw.guitar ?? {}) } }; } catch { return { ...DEFAULTS, guitar: { ...DEFAULTS.guitar } }; }
  })();
  const savePrefs = () => { try { storage?.setItem(PREF, JSON.stringify(prefs)); } catch { /* storage may be refused */ } };
  const remember = (on) => { try { storage?.setItem(KEY, on ? '1' : '0'); } catch { /* storage may be refused */ } };
  const wasOpen = () => { try { return storage?.getItem(KEY) === '1'; } catch { return false; } };

  const pianoTrack = { id: 'piano-keyboard', name: 'Piano', instrumentId: 'piano', family: 'keyboards', kind: 'pitched', mixer: { volume: DEFAULT_VOLUME, mute: false, solo: false } };
  const guitarSoundId = (key) => (/bass/.test(key ?? '') ? 'bass-guitar' : key === 'ukulele' ? 'ukulele' : 'guitar-nylon');
  /** Where an instrument is shown: 'side' (the sidebar, computers only, when it is set vertical) or 'dock' (the panel above the bottom rows). */
  prefs.guitar.orientation = prefs.pianoOrientation; // saved choices from before the two were linked
  const where = (view) => (sidebar?.isEnabled() && (view === 'piano' ? prefs.pianoOrientation === 'vertical' : prefs.guitar.orientation === 'vertical') ? 'side' : 'dock');
  let guitarTrack = { ...pianoTrack, id: 'fretboard', name: 'Fretboard', instrumentId: 'guitar-nylon', family: 'plucked-strings' };
  const held = new Set();
  /** A key pressed with the finger: note on (held until the key is released) or one short note, never while the score plays (the keys are then driven by it). */
  const pressed = (detail, which = 'piano') => {
    if (isPlaying()) return;
    if (recorderSink) { recorderSink.press({ ...played(detail, which), velocity: detail.velocity, source: 'screen' }); } else entryHook?.press?.(played(detail, which));
    const soundTrack = which === 'guitar' ? guitarTrack : pianoTrack;
    const engine = getEngine(); if (!engine) return;
    if (prefs.hold && typeof engine.liveNoteOn === 'function') {
      try { engine.liveNoteOn({ pitch: detail.midi, velocity: detail.velocity, track: soundTrack }); held.add(detail.midi); } catch { /* hearing a key is never worth an error */ }
      return;
    }
    if (typeof engine.audition !== 'function') return;
    const note = { id: 'pk-0', track: soundTrack.id, staff: 'pk', voice: 0, movement: 0, measure: 0, chord: 'pk', pitch: detail.midi, velocity: detail.velocity, t: 0, duration: 0.9 };
    try { engine.audition({ format: 'scorsaire-sequence', version: 1, speed: 1, duration: 1.2, tracks: [soundTrack], notes: [note], messages: [], tempo: { version: 1, steps: [] }, slots: [], movements: [], automation: [] }); } catch { /* ignored */ }
  };
  // note entry (set by `setEntry`): a key pressed while notes are being entered is also written at the entry cursor
  let entryHook = null; let entryUnsub = null; let entryKey = null;
  let sustain = false; const sustained = new Set(); // the sustain pedal of a MIDI keyboard: key-ups wait for it
  let recorderSink = null; // the recording window: while set, the keys feed it instead of the note entry
  const stringCountOf = () => board?.getTuning().strings.length ?? 0;
  const played = (detail, which) => (which === 'guitar'
    ? { midi: detail.midi, string: stringCountOf() - detail.string, fret: detail.fret, stringCount: stringCountOf() }
    : { midi: detail.midi });
  /** The fretboard shows the tuning and capo of the staff being written (or goes back to following the score). */
  function applyEntryContext() {
    const ctx = entryHook?.context?.() ?? null;
    const key = ctx?.key ?? null;
    if (key === entryKey) return;
    entryKey = key;
    if (!board) return; // `ensureBoard` applies it when the board is created
    if (ctx) { guitarFollow?.lock(); board.setTuning({ strings: ctx.strings, frets: ctx.frets }); board.setCapo(ctx.capo); } else guitarFollow?.unlock();
  }
  const released = (detail) => {
    if (recorderSink) recorderSink.release({ ...(detail.string !== undefined ? played(detail, 'guitar') : { midi: detail.midi }), source: 'screen' }); else entryHook?.release?.(detail);
    if (!held.delete(detail.midi)) return;
    try { getEngine()?.liveNoteOff?.(detail.midi); } catch { /* ignored */ }
  };
  const shared = () => [{ id: 'hold', label: label('piano.menu.hold'), checked: prefs.hold }];
  const orientationItems = () => (sidebar?.isEnabled() ? [
    { heading: label('piano.menu.orientation') },
    { id: 'orientation:horizontal', label: label('piano.menu.horizontal'), checked: prefs.pianoOrientation !== 'vertical' },
    { id: 'orientation:vertical', label: label('piano.menu.vertical'), checked: prefs.pianoOrientation === 'vertical' },
  ] : []);
  /** The piano and the fretboard always share one orientation (both lie in the dock or both stand in the sidebar). */
  const setOrientation = (value) => {
    prefs.pianoOrientation = value; prefs.guitar.orientation = value; savePrefs();
    board?.setLayout({ orientation: value, flip: prefs.guitar.flip, nutAtEnd: prefs.guitar.nutAtEnd });
    menu?.(); board && board.setMenu?.(guitarMenuItems, guitarPick);
  };
  const pianoPick = (id) => {
    if (id === 'view:guitar') { setView('guitar'); return; }
    if (id.startsWith('orientation:')) { setOrientation(id.slice(12)); applyPlacement(); if (where('piano') === 'side') sidebar.show('piano'); else { setView('piano'); dock.setPiano(true); remember(true); } return; }
    prefs[id] = !prefs[id]; savePrefs(); menu(); if (id === 'colorByTrack') { follow?.refresh(); vfollow?.refresh(); }
  };
  const menu = () => {
    const items = [
      { id: 'view:guitar', label: label('guitar.menu.showGuitar') },
      ...shared(),
      { id: 'colorByTrack', label: label('piano.menu.colorByTrack'), checked: prefs.colorByTrack },
      ...orientationItems(),
    ];
    keyboard?.setMenu(items.filter((it) => !it.heading), pianoPick); // the horizontal keyboard's menu has no headings
    vkeyboard?.setMenu(items.filter((it) => !it.heading), pianoPick);
  };
  const guitarMenuItems = () => {
    const gset = prefs.guitar; const hor = gset.orientation === 'horizontal';
    const tracks = guitarFollow?.tracks() ?? [];
    const listed = tracks.length ? tracks : (listTracks?.() ?? []);
    const item = (id, text, checked) => ({ id, label: text, checked });
    return [
      { id: 'view:piano', label: label('guitar.menu.showPiano') },
      ...shared(),
      { heading: label('guitar.menu.track') },
      item('track:auto', label('guitar.menu.auto'), gset.track === 'auto'),
      ...listed.map((tr) => item(`track:${tr.id}`, tr.name, gset.track === tr.id)),
      { heading: label('guitar.menu.instrument') },
      ...['auto', 'guitar', 'guitar7', 'bass', 'bass5', 'ukulele'].map((k) => item(`instrument:${k}`, label(`guitar.instrument.${k}`), gset.instrument === k)),
      { heading: label('guitar.menu.tuning') },
      ...presetsFor(board?.getTuning().strings.length ?? 6).map((pr) => item(`preset:${pr.id}`, label(`guitar.tuning.${pr.id}`), gset.preset === pr.id)),
      { heading: label('guitar.menu.limit') },
      ...[0, 5, 7, 12].map((n) => item(`limit:${n}`, label(n ? 'guitar.limit.first' : 'guitar.limit.free', { n }), gset.limit === n)),
      { heading: label('guitar.menu.frets') },
      ...[0, 4, 5, 7, 9, 12].map((n) => item(`frets:${n}`, label(n ? 'guitar.frets.n' : 'guitar.frets.all', { n }), (gset.frets ?? 0) === n)),
      { heading: label('guitar.menu.orientation') },
      item('orientation:horizontal', label('guitar.menu.horizontal'), hor),
      item('orientation:vertical', label('guitar.menu.vertical'), !hor),
      { heading: label('guitar.menu.bassSide') },
      item('flip:false', label(hor ? 'guitar.menu.bassBottom' : 'guitar.menu.bassLeft'), !gset.flip),
      item('flip:true', label(hor ? 'guitar.menu.bassTop' : 'guitar.menu.bassRight'), !!gset.flip),
      { heading: label('guitar.menu.nut') },
      item('nut:false', label(hor ? 'guitar.menu.nutLeft' : 'guitar.menu.nutTop'), !gset.nutAtEnd),
      item('nut:true', label(hor ? 'guitar.menu.nutRight' : 'guitar.menu.nutBottom'), !!gset.nutAtEnd),
    ];
  };
  const guitarPick = (id) => {
    const gset = prefs.guitar;
    if (id === 'view:piano') { setView('piano'); return; }
    if (id === 'hold') { prefs.hold = !prefs.hold; savePrefs(); return; }
    const [kind, value] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (kind === 'track') gset.track = value;
    else if (kind === 'instrument') gset.instrument = value;
    else if (kind === 'preset') gset.preset = value;
    else if (kind === 'limit') gset.limit = Number(value);
    else if (kind === 'frets') { gset.frets = Number(value); if (!gset.frets) gset.start = 0; board?.setView({ count: gset.frets, start: gset.start }); }
    else if (kind === 'orientation') { setOrientation(value); applyPlacement(); if (where('guitar') === 'side') sidebar.show('guitar'); else { setView('guitar'); dock.setPiano(true); remember(true); } }
    else if (kind === 'flip') gset.flip = value === 'true';
    else if (kind === 'nut') gset.nutAtEnd = value === 'true';
    savePrefs();
    board?.setLayout({ orientation: gset.orientation, flip: gset.flip, nutAtEnd: gset.nutAtEnd });
    if (['track', 'instrument', 'preset', 'limit'].includes(kind)) { guitarFollow?.refresh(); soundFor(); }
  };
  /** The sound a finger press makes on the fretboard follows the instrument shown. */
  function soundFor() {
    const cur = guitarFollow?.current?.(); const key = prefs.guitar.instrument !== 'auto' ? prefs.guitar.instrument : (cur?.tuning?.key ?? 'guitar');
    guitarTrack = { ...pianoTrack, id: 'fretboard', name: 'Fretboard', instrumentId: guitarSoundId(key), family: 'plucked-strings' };
  }
  function ensureBoard() {
    if (board) return board;
    const gset = prefs.guitar;
    board = createFretboard({ host: guitarWrap, orientation: gset.orientation, flip: gset.flip, nutAtEnd: gset.nutAtEnd, theme: fretboardTheme() });
    board.onNoteOn((d) => pressed(d, 'guitar')); board.onNoteOff(released);
    board.setView({ count: gset.frets ?? 0, start: gset.start ?? 0 });
    board.onViewChange((v) => { gset.start = v.start; savePrefs(); });
    board.setMenu(guitarMenuItems, guitarPick);
    guitarFollow = createGuitarFollow({ board, settings: () => prefs.guitar, enabled: () => prefs.view === 'guitar' || where('guitar') === 'side' });
    if (lastPlayer) guitarFollow.attach(lastPlayer);
    guitarFollow.refresh();
    if (entryKey !== null) { const ctx = entryHook?.context?.(); if (ctx) { guitarFollow.lock(); board.setTuning({ strings: ctx.strings, frets: ctx.frets }); board.setCapo(ctx.capo); } }
    soundFor();
    return board;
  }
  /** Shows the keyboard or the fretboard in the panel (the choice is kept on the device). */
  function setView(view) {
    prefs.view = view; savePrefs();
    for (const m of [...held]) { try { getEngine()?.liveNoteOff?.(m); } catch { /* ignored */ } held.delete(m); }
    if (where(view) === 'side') { applyPlacement(); sidebar.show(view); if (dock.pianoOpen()) dock.setPiano(false); sync(); return; }
    applyPlacement(); // hides the other instrument's tab of the sidebar
    pianoWrap.style.display = view === 'piano' ? 'block' : 'none';
    guitarWrap.style.display = view === 'guitar' ? 'block' : 'none';
    if (!dock.pianoOpen()) { dock.setPiano(true); remember(true); } // the other instrument may have been shown in the sidebar: bring this one up in the dock
    if (view === 'guitar') { ensureBoard().refit(); guitarFollow?.refresh(); soundFor(); follow?.refresh(); keyboard?.allNotesOff(); }
    else { board?.allNotesOff(); ensure(); follow?.refresh(); }
  }
  function ensure() {
    if (keyboard) return keyboard;
    keyboard = createPianoKeyboard({ host: pianoWrap, t: label });
    applyPianoLook(keyboard);
    keyboard.setResponsiveKeys({ enabled: true, keyWidth: 40 }); // 37 keys at the usual width, up to 88 when the interface is wide
    keyboard.onNoteOn((d) => pressed(d, 'piano')); keyboard.onNoteOff(released);
    follow = createPianoFollow({ keyboard, enabled: () => prefs.view === 'piano' && where('piano') === 'dock', byTrack: () => prefs.colorByTrack });
    menu();
    if (lastPlayer) follow.attach(lastPlayer);
    return keyboard;
  }
  /**
   * The vertical keyboard of the sidebar: THE SAME keyboard module as the horizontal one (same look, same API, same thickness), turned a quarter turn by a
   * frame (low notes at the bottom, black keys on the left). Its length is the height of the tab; the keys keep the size they have when it lies down (about
   * 40 px per white key). The module does not measure itself under a rotation, so its number of keys is set here, and its pan handle (which reads the screen
   * x) is replaced by two octave buttons.
   */
  const KEY_PX = 40;
  const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
  const keysForWhites = (w) => 12 * Math.floor((w - 1) / 7) + WHITE_PC[(w - 1) % 7] + 1; // keys from a C to the `w`-th white key
  function ensureV(body) {
    if (vkeyboard) return vkeyboard;
    if (!document.getElementById('vpiano-style')) { const st = document.createElement('style'); st.id = 'vpiano-style'; st.textContent = '[data-vpiano-frame] .pan-handle { display: none !important; }'; document.head.append(st); }
    const shell = document.createElement('div'); shell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:var(--btn-gap,2px);padding:4px;box-sizing:border-box;min-height:100%';
    const octaves = document.createElement('div'); octaves.style.cssText = 'display:flex;gap:var(--btn-gap,2px)';
    const frame = document.createElement('div'); frame.setAttribute('data-vpiano-frame', ''); frame.style.cssText = 'position:relative;flex:none';
    const inner = document.createElement('div'); inner.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0';
    frame.append(inner); shell.append(octaves, frame); body.append(shell);
    vkeyboard = createPianoKeyboard({ host: inner, t: label });
    applyPianoLook(vkeyboard);
    vkeyboard.setResponsiveKeys(false);
    vkeyboard.onNoteOn((d) => pressed(d, 'piano')); vkeyboard.onNoteOff(released);
    const octaveBtn = (text, title, dir) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.style.cssText = 'min-width:var(--ui-target,30px);min-height:var(--ui-target,30px);cursor:pointer'; b.addEventListener('click', () => { const k = vkeyboard.getKeys(); vkeyboard.setKeys(k.count, k.startMidi + dir * 12); vfollow?.refresh(); }); return b; };
    octaves.append(octaveBtn('▲', label('piano.octaveUp'), 1), octaveBtn('▼', label('piano.octaveDown'), -1));
    let lastLength = 0;
    const layoutV = () => {
      const length = Math.max(360, Math.floor((body.clientHeight || 600) - 70));
      if (length === lastLength) return;
      lastLength = length;
      const whites = Math.max(14, Math.round(length / KEY_PX));
      const n = Math.min(88, keysForWhites(whites));
      const k = vkeyboard.getKeys();
      inner.style.width = `${length}px`; vkeyboard.setWidth(length);
      vkeyboard.setKeys(n, Math.max(24, Math.min(Math.round(k.startMidi / 12) * 12 || 36, 108 - n + 1)));
      const thick = inner.offsetHeight;
      frame.style.width = `${thick}px`; frame.style.height = `${length}px`;
      sidebar?.setTabFit('piano', thick + 8 + 1); // the sidebar is as wide as the keyboard is thick (4 px of margin each side)
      inner.style.transform = `translateY(${length}px) rotate(-90deg)`;
      vfollow?.refresh();
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layoutV()) : null; ro?.observe(body);
    requestAnimationFrame(layoutV);
    // the lit keys follow the score, but the keys keep their size: "fit the piece" only SLIDES the window (the number of keys stays)
    const BLACK = [1, 3, 6, 8, 10];
    const slidingView = {
      noteOn: (...a) => vkeyboard.noteOn(...a), noteOff: (m) => vkeyboard.noteOff(m), getKeys: () => vkeyboard.getKeys(),
      fitRange(lo, hi) {
        const k = vkeyboard.getKeys();
        let start = Math.round((lo + hi) / 2 - k.count / 2);
        start = Math.max(21, Math.min(start, 108 - k.count + 1));
        while (BLACK.includes(start % 12) && start > 21) start -= 1;
        if (start !== k.startMidi) vkeyboard.setKeys(k.count, start);
        return vkeyboard.getKeys();
      },
    };
    vfollow = createPianoFollow({ keyboard: slidingView, enabled: () => where('piano') === 'side', byTrack: () => prefs.colorByTrack });
    vkeyboard.vdestroy = () => { ro?.disconnect(); shell.remove(); };
    menu();
    if (lastPlayer) vfollow.attach(lastPlayer);
    return vkeyboard;
  }
  let applying = false;
  /** Puts each instrument where it belongs: vertical on a computer = a tab of the sidebar, else the panel above the bottom rows. */
  function applyPlacement() {
    if (applying) return;
    applying = true;
    try {
      const sideP = where('piano') === 'side'; const sideG = where('guitar') === 'side';
      if (sidebar) {
        const pb = sidebar.addTab('piano', label('sidebar.tab.piano'), { visible: false });
        const gb = sidebar.addTab('guitar', label('sidebar.tab.guitar'), { visible: false });
        if (sideP && prefs.view !== 'guitar') ensureV(pb);
        sidebar.setTabVisible('piano', sideP && prefs.view !== 'guitar'); sidebar.setTabVisible('guitar', sideG && prefs.view === 'guitar'); // exclusive: one instrument at a time
        const gParent = sideG ? gb : dock.pianoHost;
        if (guitarWrap.parentNode !== gParent) gParent.append(guitarWrap);
        // in the sidebar the fretboard is always visible in its own tab (the dock's piano / guitar switch must not hide it)
        guitarWrap.style.display = prefs.view === 'guitar' ? 'block' : 'none';
        if (sideG) ensureBoard();
        board?.refit(); guitarFollow?.refresh();
        if (sideP) vfollow?.refresh();
      }
      if (where(prefs.view) === 'side' && dock.pianoOpen()) dock.setPiano(false);
    } finally { applying = false; }
    sync();
  }
  const shownNow = () => (where(prefs.view) === 'side' ? sidebar.isTabShown(prefs.view) : dock.pianoOpen());
  // computers: the piano button floats over the score, bottom left (above the dock when it is open); elsewhere it stays in the dock's bottom row
  const floatStyle = 'position:fixed;left:calc(var(--sb-left,0px) + 10px);bottom:calc(var(--dock-h,0px) + var(--mixer-h,0px) + 10px);z-index:61;min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.25)';
  const placeButton = () => {
    if (dock.inHeader()) { if (button.parentNode !== document.body) document.body.append(button); button.style.cssText = floatStyle; }
    else { if (button.parentNode !== dock.bottomBase) dock.bottomBase.append(button); button.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative'; }
  };
  // a round button next to the piano one opens the mixer panel; the two are exclusive (opening one closes the other)
  let mixer = null; let offMixer = null;
  const mixerButton = document.createElement('button');
  mixerButton.type = 'button'; mixerButton.title = label('mixer.open'); mixerButton.setAttribute('aria-label', mixerButton.title); mixerButton.setAttribute('data-action', 'mixer-float'); mixerButton.setAttribute('data-dismiss-keep', '');
  mixerButton.append(icon('sliders-vertical'));
  const mixerFloat = floatStyle.replace('left:calc(var(--sb-left,0px) + 10px)', 'left:calc(var(--sb-left,0px) + 20px + var(--ui-target,44px))');
  const placeMixerButton = () => {
    const show = dock.inHeader() && !!mixer;
    if (!show) { mixerButton.remove(); return; }
    if (mixerButton.parentNode !== document.body) document.body.append(mixerButton);
    mixerButton.style.cssText = mixerFloat;
    const open = !!mixer?.isOpen();
    mixerButton.setAttribute('aria-pressed', String(open)); mixerButton.style.outline = open ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
  };
  mixerButton.addEventListener('click', () => { if (shownNow()) toggle(false); percmap?.close?.(); mixer?.toggle(); });
  // a third round button (drum map editor) shows while a percussion staff is being edited; exclusive with the keyboard and the mixer (opening it closes them)
  let percmap = null; let offPercmap = null;
  const percButton = document.createElement('button');
  percButton.type = 'button'; percButton.title = label('noteEntry.percmap'); percButton.setAttribute('aria-label', percButton.title); percButton.setAttribute('data-action', 'percmap-float'); percButton.setAttribute('data-dismiss-keep', '');
  percButton.append(icon('drum'));
  const percFloat = floatStyle.replace('left:calc(var(--sb-left,0px) + 10px)', 'left:calc(var(--sb-left,0px) + 30px + 2 * var(--ui-target,44px))');
  const placePercButton = () => {
    const show = dock.inHeader() && !!percmap && !!percmap.staffId(); // always there while the work has a percussion staff
    if (!show) { percButton.remove(); return; }
    if (percButton.parentNode !== document.body) document.body.append(percButton);
    percButton.style.cssText = percFloat;
  };
  percButton.addEventListener('click', () => { const id = percmap?.staffId(); if (!id) return; if (shownNow()) toggle(false); if (mixer?.isOpen()) mixer.close(); percmap.open(id); });
  // screen 2 is the layout of the printed parts: always wrapped lines, and the drum map is not edited there (decided with Jean, 25/10/2026)
  if (typeof document !== 'undefined' && !document.getElementById('float-screen-style')) {
    const st = document.createElement('style'); st.id = 'float-screen-style';
    st.textContent = 'html[data-screen="two"] [data-action="float-view"], html[data-screen="two"] [data-action="percmap-float"] { display: none !important; }\n'
      // screen 3 works cell by cell: the round buttons of the whole score (piano, mixer, drum map, display mode, concert pitch) are not offered
      + 'html[data-screen="three"] [data-action="piano-toggle"], html[data-screen="three"] [data-action="mixer-float"], html[data-screen="three"] [data-action="percmap-float"], html[data-screen="three"] [data-action^="float-"] { display: none !important; }';
    document.head.append(st);
  }
  const screenWatch = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => sync()) : null;
  screenWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-screen'] });
  // extra round buttons (display mode, concert pitch…) to the right of the others: `{ id, title, icon(): Node|string, isOn(), toggle(), subscribe(fn) }`
  let extras = []; let offExtras = [];
  const extraButtons = new Map();
  const reflow = () => {
    const shown = [button, mixerButton, percButton, ...extras.map((x) => extraButtons.get(x.id))].filter((b) => b && b.parentNode === document.body && getComputedStyle(b).display !== 'none'); // the hidden ones leave no gap
    shown.forEach((b, i) => { b.style.left = `calc(var(--sb-left,0px) + ${10 + i * 10}px + ${i} * var(--ui-target,44px))`; });
  };
  const placeExtras = () => {
    for (const x of extras) {
      let b = extraButtons.get(x.id);
      if (!b) {
        b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-action', `float-${x.id}`); b.setAttribute('data-dismiss-keep', '');
        b.addEventListener('click', () => { x.toggle(); sync(); });
        extraButtons.set(x.id, b);
      }
      b.title = x.title; b.setAttribute('aria-label', x.title);
      b.replaceChildren(x.icon());
      if (!dock.inHeader()) { b.remove(); continue; }
      if (b.parentNode !== document.body) document.body.append(b);
      b.style.cssText = `${floatStyle};padding:0;width:var(--ui-target,44px);height:var(--ui-target,44px)`; // exactly round
      const on = !!x.isOn?.();
      b.setAttribute('aria-pressed', String(on)); b.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
    }
  };
  const sync = () => {
    placeButton(); placeMixerButton(); placePercButton(); placeExtras(); reflow();
    const open = shownNow();
    button.setAttribute('aria-pressed', String(open)); button.style.outline = open ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
    const mode = dock.bottomMode();
    button.style.display = mode && mode !== 'piano' && mode !== 'entry' ? 'none' : 'inline-flex'; // stays reachable while notes are entered: the keys write them
  };
  const offMode = dock.onMode(sync); const offPiano = dock.onPiano(sync);
  const toggle = (on) => {
    const v = prefs.view === 'guitar' ? 'guitar' : 'piano';
    if (where(v) === 'side') { if (on) setView(v); else sidebar.setFolded(true); remember(on); sync(); return; }
    if (on) setView(v);
    dock.setPiano(on); remember(on); if (on) follow?.fit(); if (on && prefs.view === 'guitar') board?.refit(); };
  button.setAttribute('data-dismiss-keep', '');
  button.addEventListener('click', () => { if (mixer?.isOpen()) mixer.close(); toggle(!shownNow()); });
  const offSide = sidebar?.onChange(() => applyPlacement());
  applyPlacement();
  if (wasOpen()) toggle(true);
  return {
    button,
    /** The mixer panel the round mixer button opens (null to detach); opening it closes the keyboard. */
    setMixer(panel) { offMixer?.(); offMixer = null; mixer = panel; if (panel?.onOpenChange) offMixer = panel.onOpenChange(() => sync()); sync(); },
    /** The drum map editor behind the third round button: `{ staffId() → id | null (percussion staff being edited), open(id), close?(), subscribe(fn) }` (null to detach). */
    setPercmap(hook) { offPercmap?.(); offPercmap = null; percmap = hook; if (hook?.subscribe) offPercmap = hook.subscribe(() => sync()); sync(); },
    /** The extra round buttons shown after the others (computers only); each one's `subscribe(fn)` returns its unsubscribe function. */
    setExtras(list) { for (const o of offExtras) o?.(); for (const b of extraButtons.values()) b.remove(); extraButtons.clear(); extras = list; offExtras = list.map((x) => x.subscribe?.(() => sync())); sync(); },
    /** Closes the keyboard / fretboard if it is shown (the mixer is about to open). */
    closePiano() { if (shownNow()) toggle(false); },
    /** The keys follow this player (called again for each new document). */
    follow(player, options = {}) { lastPlayer = player; if (options.tracks) listTracks = options.tracks; follow?.attach(player); vfollow?.attach(player); guitarFollow?.attach(player); },
    /**
     * Connects the keys to the note entry of the document (called again for each new document, null to disconnect): `hook.press(played)` and
     * `hook.release({ midi })` when a key / position is pressed and released, `hook.context()` = what the fretboard must show while notes are entered
     * (or null), `hook.subscribe(fn)` = `fn` is called when that may have changed (returns the unsubscribe function).
     */
    setEntry(hook) {
      entryUnsub?.(); entryUnsub = null; entryHook = hook;
      entryKey = undefined; // forces the next context to be applied
      if (hook?.subscribe) entryUnsub = hook.subscribe(applyEntryContext);
      applyEntryContext();
    },
    /**
     * A note from a MIDI keyboard (`midi-input.js`): it sounds (held until the key goes up, or the sustain pedal), lights the key of the on-screen keyboard
     * (the fretboard when it is the one shown), and goes where an on-screen key goes — the recording window with its hardware timestamp, else the note entry.
     */
    midiNote(ev) {
      if (ev.type === 'sustain') {
        sustain = ev.down;
        if (!sustain) { for (const m of [...sustained]) { try { getEngine()?.liveNoteOff?.(m); } catch { /* ignored */ } sustained.delete(m); } }
        return;
      }
      if (isPlaying()) return;
      const guitar = prefs.view === 'guitar';
      if (ev.type === 'on') {
        if (recorderSink) recorderSink.press({ midi: ev.midi, velocity: ev.velocity, source: 'midi', perf: ev.timeStamp }); else entryHook?.press?.({ midi: ev.midi });
        try { sustained.delete(ev.midi); getEngine()?.liveNoteOn?.({ pitch: ev.midi, velocity: ev.velocity, track: guitar ? guitarTrack : pianoTrack }); } catch { /* hearing a key is never worth an error */ }
        keyboard?.noteOn?.(ev.midi, ev.velocity); vkeyboard?.noteOn?.(ev.midi, ev.velocity); if (guitar) board?.noteOn(ev.midi, ev.velocity);
      } else {
        if (recorderSink) recorderSink.release({ midi: ev.midi, source: 'midi', perf: ev.timeStamp }); else entryHook?.release?.({ midi: ev.midi });
        if (sustain) sustained.add(ev.midi); else { try { getEngine()?.liveNoteOff?.(ev.midi); } catch { /* ignored */ } }
        keyboard?.noteOff?.(ev.midi); vkeyboard?.noteOff?.(ev.midi); board?.noteOff(ev.midi);
      }
    },
    /** The recording window takes the keys (`sink.press(played)` / `sink.release({ midi })`), or gives them back (null). */
    setRecorder(sink) { recorderSink = sink; },
    /** Shows the keyboard or the fretboard (opens the panel when it is closed). */
    show(view) { setView(view === 'guitar' ? 'guitar' : 'piano'); },
    keyboard: () => keyboard,
    retext() { keyboard?.retext(); vkeyboard?.retext(); menu(); },
    board: () => board,
    view: () => prefs.view,
    setView,
    destroy() { screenWatch?.disconnect(); entryUnsub?.(); offMode(); offPiano(); offSide?.(); follow?.detach(); vfollow?.detach(); guitarFollow?.detach(); keyboard?.destroy(); vkeyboard?.vdestroy?.(); vkeyboard?.destroy(); board?.destroy(); if (dock.pianoOpen()) dock.setPiano(false); offMixer?.(); mixerButton.remove(); button.remove(); },
  };
}
