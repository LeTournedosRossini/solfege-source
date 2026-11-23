/*
 * The SYNCHRO READER (read only): the score follows a recording made of stems. It opens a `.scorsaire` ZIP written by screen 4 (score + time map + audio),
 * from a file the person picks or from an address (`?file=` or `#file=`, served by the same server as the page or by one that allows it).
 * Same pieces as screen 4 (stem player, sync map, media panel) and the same layout pipeline as the sheet reader, but nothing is ever written, and the
 * score itself is silent: the recording is what is heard. The speed, the pitch (the score is shown in the new key), the loop and the stems are free.
 */
import { shiftForDisplay } from '../layout/displayshift.js';
import { createStemPlayer } from '../audio/stemplayer.js';
import { loadStretch } from '../audio/stretch-loader.js';
import { createReaderAudio } from '../reader/audio.js';
import { readWorkBytes, bootReader, drawCell, createPlayhead, trackName, embeddedBytes } from '../reader/core.js';
import { createScoreSound } from './score-sound.js';
import { mountInstrumentBox } from './instrument-box.js';
import { pageParams } from '../reader/access.js';
import { mountPortalButtonSize } from '../reader/portal-prefs.js';
import { mediaBase, resolveExternalMedia } from '../reader/externalmedia.js';
import { createKnob } from '../ui/knob.js';
import { createSyncMap } from '../audio/syncmap.js';
import { parseKey } from '../import/allinone.js';
import { mountSyncPanel } from '../ui/sync-panel.js';
import { normalizeReader } from '../reader/options.js';
import { createZoomControls } from '../reader/zoom-controls.js';
import { createI18n } from '../i18n/index.js';
import { mountThemeToggle } from '../reader/theme-toggle.js';
import { measureZones, measureAt } from '../layout/sheetcursor.js';
import { createYouTubePlayer } from '../audio/youtubeplayer.js';
import { createClockPlayer } from '../audio/clockplayer.js';
import { createSwitchPlayer } from '../audio/switchplayer.js';
import { usableVideos, videoMeasures, sectionSegments } from '../audio/videosync.js';
import { mountVideoViewer } from '../ui/video-sync-viewer.js';
import { measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';
import { SID } from '../model/sid.js';
import { resolveStyle } from '../model/props.js';
import { isLyricsTrack } from '../model/lyricevents.js';
import { PID } from '../model/pid.js';
import { applyWho, startTracks } from '../reader/pupils.js';
import { mountLyricsPanel, withoutLyrics } from '../reader/lyricspanel.js';
import { parseStartParams } from '../reader/startparams.js';
import { getProperty } from '../model/props.js';

const lang = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
const t = createI18n(['fr', 'en'].includes(lang) ? lang : 'fr');

/** Plays `info` (the sync.json of the archive) with `media`, showing `work`. Returns { destroy }. */
export async function mountSynchro(host, { work, sync, onStatus = () => {}, start = null }) {
  applyWho(work, start?.who ?? null); // the names of the players (`who=` of the address) go next to the track names
  const { info, media, analysis } = sync;
  const isVideo = info.source === 'video'; // a song synchronised with a YouTube video: no stems, the video is the clock and the sound
  const barLengths = work.movements[0].masterbars.map((b) => fToNumber(measureLengthOf(b)));
  const order = Array.isArray(info.order) ? info.order : null; // a recording with repeats: the written bar of every PLAYED measure
  const movementLengths = order ? order.map((w) => barLengths[w] ?? 1) : barLengths; // the length of every played measure
  const videos = isVideo ? usableVideos(info.youtube?.videos, movementLengths.length) : [];
  if (isVideo && !videos.length) throw new Error(t('video.noneUsable'));
  if (isVideo && typeof location !== 'undefined' && location.protocol === 'file:') throw new Error(t('youtube.needsHttp'));
  const playable = isVideo ? [] : media.some((m) => m.role === 'stem') ? media.filter((m) => m.role === 'stem') : media.filter((m) => m.role === 'original').slice(0, 1);
  if (!isVideo && !playable.length) throw new Error(t('syncreader.noSync'));
  // a video: the video is the clock and the sound. When the author allowed the sound of the score there is a second mode, « score alone »: the video is paused and the score plays with its own sound
  // on a CLOCK of its own (exact loops, free speed, a volume per part); `player` is then one player in front of the two, and the position passes from one to the other (same recording time).
  const ytPlayer = isVideo ? createYouTubePlayer() : null;
  const clock = isVideo && info.scoreSound === true ? createClockPlayer() : null;
  const player = isVideo ? (clock ? createSwitchPlayer({ video: ytPlayer, clock }) : ytPlayer) : createStemPlayer({ createContext: () => new AudioContext(), loadStretch });
  if (!isVideo) {
    await player.load(playable.map((m) => ({ name: m.name, bytes: m.bytes })));
    for (const [i, m] of playable.entries()) { const saved = info.stems?.find((x) => x.id === m.id); if (saved) player.setStem(i, { volume: saved.volume ?? 1, mute: !!saved.mute }); }
    if (info.master != null) player.setMasterVolume(info.master);
  }
  const session = { key: info.key ?? 'C major', offsetMs: info.offsetMs ?? 0, preRoll: isVideo ? 0 : Number.isInteger(start?.preroll) ? start.preroll : 1, preClick: isVideo ? false : start?.click ? start.click !== 'off' : true }; // the address may ask for the count-in (`pre=`) and the metronome (`click=`) // one measure of lead-in by default (audio); the metronome of the lead-in is on unless the person turns it off
  let chosenVideo = isVideo ? (videos.find((v) => v.videoId === info.youtube?.videoId) ?? videos[0]) : null;
  const videoList = () => (chosenVideo.videoId === info.youtube?.videoId && info.measures?.length === movementLengths.length ? info.measures : videoMeasures(chosenVideo.points, movementLengths));
  let map = createSyncMap(isVideo ? videoList() : info.measures, { offset: session.offsetMs / 1000, order });
  clock?.setDuration(map.end());
  const analysisLive = { segments: isVideo ? sectionSegments(info.youtube?.sections ?? [], videoList()) : (info.segments ?? analysis.segments ?? []) };
  const reader = normalizeReader(info.reader);
  // the sound of the score: with a recording it is always there; with a video it exists only when the AUTHOR allowed it (`scoreSound` of the file), and starts off
  const soundAllowed = !isVideo || info.scoreSound === true;
  let sound = isVideo ? null : createScoreSound({ work, getMap: () => map, stems: player, audio: createReaderAudio() });
  let scoreMode = false; let soundFromMode = false; let unsubMix = null; let paintSoundToggle = () => {}; // the « score alone » mode, and whether its sound was made for it (the switch of the sound of the score, in the other mode, may have made it)
  const mixerOn = () => !!sound && (!isVideo || scoreMode); // the volume / mute / solo of each part: with a recording, or when the score plays alone

  const root = document.createElement('div'); host.append(root);
  const head = document.createElement('div'); head.style.cssText = 'position:sticky;top:0;z-index:5;background:var(--paper,#faf8f4);padding:6px 8px 0;max-height:60vh;overflow:auto';
  const stage = document.createElement('div'); stage.style.cssText = 'padding:8px 12px';
  // with a video: the video on the left, the panel and the bar on the right (they stack on a narrow window)
  const bodyHost = isVideo ? document.createElement('div') : head;
  if (isVideo) { head.style.cssText += ';display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start'; bodyHost.style.cssText = 'flex:1 1 380px;min-width:0'; head.append(bodyHost); }
  root.append(head, stage);

  const movement = work.movements[0];
  const cell = { tracks: startTracks(work.movements[0], start?.tracks) }; // tracks: the ids shown (null = all); the address may ask for some first (`tracks=`)
  if (!cell.tracks) { const visible = movement.tracks.filter((tr) => getProperty(tr, PID.VISIBLE) !== false).map((tr) => tr.id); if (visible.length && visible.length < movement.tracks.length) cell.tracks = visible; } // the tracks the author hid start hidden: their chips are off and can be switched on
  // the words as STROPHES under the music (the usual), the lyrics staff off; a button gives the staff back (and the choice is kept on the device)
  const lyrics = mountLyricsPanel({
    work, lang: lang === 'en' ? 'en' : 'fr', t, asked: start?.lyrics ?? null, storage: (() => { try { return window.localStorage; } catch { return null; } })(),
    onChange: (m) => {
      const ids = lyrics.trackIds(); const all = movement.tracks.map((x) => x.id);
      if (m === 'strophes') cell.tracks = withoutLyrics(movement, cell.tracks, ids);
      else if (cell.tracks) { const set = new Set([...cell.tracks, ...ids]); cell.tracks = set.size === all.length ? null : all.filter((id) => set.has(id)); }
      syncChips(); draw();
    },
  });
  if (lyrics.staffHidden() && !start?.tracks) cell.tracks = withoutLyrics(movement, cell.tracks, lyrics.trackIds());
  stage.after(lyrics.element);
  let drawn = null; let shown = movement;
  // the systems are drawn CLOSE together by default (the room between two systems is the first thing to give up so that the music can be larger and stay on the page); a switch of the settings sheet gives the usual room back
  const TIGHT_KEY = 'scorsaire.sync.tight';
  let tight = true; try { tight = window.localStorage.getItem(TIGHT_KEY) !== 'off'; } catch { /* no storage: tight */ }
  const spacingStyles = () => (tight ? { [SID.SYSTEM_TOP_MARGIN]: 1.6, [SID.SYSTEM_BOTTOM_MARGIN]: 1.2, [SID.STAFF_DISTANCE]: 2.4, [SID.AKKOLADE_DISTANCE]: 2.4, [SID.SYSTEM_EDGE_DISTANCE]: resolveStyle(SID.MIN_VERTICAL_DISTANCE, [null, movement.style]) * 0.3 } : null);
  const playhead = createPlayhead();

  const zoomer = createZoomControls({ reader, label: (k) => t(k), onChange: () => draw() });
  // LOOP A–B ON THE SCORE: a tap on a measure puts the recording there (and it becomes the start A); a long press on another measure loops from A to it and switches the
  // loop on; the loop is the one of the timeline (the panel keeps it). The green bands show the looped measures ONLY while the loop is switched on.
  let panel = null; let startMeasure = null; let loop = { sel: null, on: false }; let ignoreClickUntil = 0;
  const LONG_PRESS_MS = 450;
  const drawBands = () => {
    if (!drawn) return;
    for (const old of drawn.box.querySelectorAll('[data-sr-loopband]')) old.remove();
    if (!loop.on || !loop.sel) return;
    const svg = drawn.box.querySelector('svg'); const vb = svg?.viewBox.baseVal; if (!vb) return;
    const looped = new Set(); for (let k = loop.sel.a; k <= loop.sel.b; k += 1) looped.add(map.writtenOf(k)); // the selection is in PLAYED measures: the bars of the score it passes over
    for (const m of measureZones(drawn.laid)) {
      if (!looped.has(m.index)) continue;
      const band = document.createElement('div'); band.setAttribute('data-sr-loopband', '');
      band.style.cssText = `position:absolute;pointer-events:none;background:rgba(88,150,134,.22);left:${(m.x1 / vb.width) * 100}%;top:${(m.y1 / vb.height) * 100}%;width:${((m.x2 - m.x1) / vb.width) * 100}%;height:${((m.y2 - m.y1) / vb.height) * 100}%`;
      svg.parentElement.append(band);
    }
  };
  const wireLoopGesture = () => {
    const box = drawn.box; let timer = 0; let down = null;
    const clear = () => { clearTimeout(timer); timer = 0; down = null; };
    const measureOf = (e) => { const svg = box.querySelector('svg'); const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; return measureAt(drawn.laid, ((e.clientX - r.left) / r.width) * vb.width, ((e.clientY - r.top) / r.height) * vb.height); };
    box.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; down = { x: e.clientX, y: e.clientY }; clearTimeout(timer);
      timer = setTimeout(() => {
        const m = measureOf({ clientX: down.x, clientY: down.y }); timer = 0;
        if (m == null || !panel) return;
        const from = startMeasure ?? loop.sel?.a ?? map.playedNear(m, player.state().position); const to = map.playedFrom(m, from); const a = Math.min(from, to); const b = Math.max(from, to); // played measures (a bar heard twice: the pass from the start on)
        ignoreClickUntil = performance.now() + 700; // the click that follows the press must not move the recording again
        panel.setSelection(a, b, { loop: true }); player.seek(map.timeOfPlayed(a, 0));
      }, LONG_PRESS_MS);
    });
    box.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clear(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) box.addEventListener(ev, clear);
  };
  const draw = () => {
    const n = player.state().semitones; const fifths = parseKey(session.key)?.fifths ?? 0;
    shown = shiftForDisplay(movement, n, { fifths });
    drawn = drawCell(stage, { work, movement, shown, tracks: cell.tracks, trackShifts: start?.trackShifts ?? null, names: !!start?.who, width: Math.max(320, host.clientWidth || window.innerWidth), staffSpace: window.innerWidth < 700 ? 7 : 9, mode: reader.layout, zoom: zoomer.zoom(), styles: spacingStyles(), onMeasure: (m) => { if (performance.now() < ignoreClickUntil) return; startMeasure = map.playedNear(m, player.state().position); player.seek(map.timeOfPlayed(startMeasure, 0)); } }); // a tap on a measure puts the recording at its start (it is also the start A of a loop)
    wireLoopGesture(); drawBands();
    playhead.reset();
    placeCursor(player.state(), false);
  };
  const placeCursor = (st, follow) => {
    if (!drawn) return;
    if (!st.playing && st.position <= 0) { playhead.clear(); return; }
    const at = map.locate(st.position);
    playhead.place(drawn, at, { follow, top: () => head.getBoundingClientRect().bottom }); // keep the playhead below the sticky panel
  };

  // pre-roll: a start from rest begins N measures before the position, with a click on each beat of the lead-in
  if (!isVideo) player.setPreRoll((pos) => {
    const n = session.preRoll ?? 0; if (!n) return null;
    const at = map.locatePlayed(pos); const mi = at.before ? 0 : at.measure; const ratio = at.before ? 0 : at.ratio; // (played measures: the lead-in of a second pass is what was heard just before)
    const first = Math.max(0, mi - n); const missing = n - (mi - first); // measures asked for that do not exist before the start of the piece: a count-in with the metronome alone
    const from = at.before ? pos : map.timeOfPlayed(first, ratio);
    const beatsOf = (i) => info.measures[Math.min(i, info.measures.length - 1)].beats.length;
    const len0 = Math.max(0.2, map.timeOfPlayed(0, 1) - map.timeOfPlayed(0, 0)); const beat0 = len0 / beatsOf(0);
    const delay = missing > 0 ? missing * len0 : 0;
    if (!(delay > 0) && !(from < pos - 1e-3)) return null;
    const clicks = [];
    if (session.preClick ?? true) {
      for (let k = 0; k < beatsOf(0) * missing; k += 1) clicks.push({ t: from - delay + k * beat0, accent: k % beatsOf(0) === 0 });
      if (!at.before) for (let i = first; i <= mi; i += 1) {
        const beats = beatsOf(i);
        for (let k = 0; k < beats; k += 1) { const tt = map.timeOfPlayed(i, k / beats); if (tt >= from - 1e-6 && tt < pos - 1e-3) clicks.push({ t: tt, accent: k === 0 }); }
      }
    }
    return { from, clicks, delay };
  });
  if (!isVideo && Number.isInteger(start?.transpose) && start.transpose) player.setSemitones(start.transpose); // the transposition asked for by the address (`tr=`, at most an octave either way: the audio is stretched)
  panel = mountSyncPanel(bodyHost, { player, getMap: () => map, analysis: analysisLive, session, label: (k, p) => t(k, p), readOnly: true, onPitch: () => draw(), onKey: () => draw(), onSelection: (sel, on) => { loop = { sel, on }; drawBands(); } });
  // the tracks of the score that are shown (the recording is not affected), and the volume of the metronome of the pre-roll
  const bar = document.createElement('div'); bar.setAttribute('data-sr-tracks', ''); bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0 0 6px;font:13px sans-serif';
  const chips = new Map();
  const shownIds = () => cell.tracks ?? movement.tracks.map((x) => x.id);
  const syncChips = () => { lyricsTrackPaint(); const on = new Set(shownIds()); for (const [id, h] of scoreStrips) h.setShown(on.has(id)); for (const [id, b] of chips) { b.setAttribute('aria-pressed', String(on.has(id))); b.style.background = on.has(id) ? 'var(--btn-on,#e2e0da)' : ''; b.style.opacity = on.has(id) ? '1' : '0.55'; } };
  const label = document.createElement('span'); label.textContent = t('syncreader.tracks');
  const unitCss = 'display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--line,#d8d3c8);border-radius:8px;background:var(--btn,#fdfcfa)';
  const small = (text, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.style.cssText = 'min-width:30px;min-height:30px;padding:0;font-weight:var(--w-bold,700)'; return b; };
  const units = new Map(); const knobs = new Map();
  let lyricsTrackPaint = () => {}; let rebuildStrips = () => {};
  const scoreStrips = new Map(); let scoreMasterStrip = null; let clickStrip = null; // the strips of the mixette (faders in the bottom sheet of a tablet / phone), same controls as the knobs of the page
  const trackBox = document.createElement('span'); trackBox.style.cssText = 'display:contents'; bar.append(trackBox); // the controls of the tracks, built again when the mode changes
  let masterKnob = null;
  function toggleTrack(id) { // show / hide a track of the score (never the last one shown)
    const on = new Set(shownIds()); if (on.has(id)) { if (on.size === 1) return; on.delete(id); } else on.add(id);
    cell.tracks = on.size === movement.tracks.length ? null : movement.tracks.map((x) => x.id).filter((tid) => on.has(tid)); syncChips(); draw();
  }
  /** The controls of the tracks of the score: a chip that shows / hides each track and, when the score has a sound to mix (a recording, or the « score alone » mode), a mute, a solo and a volume knob. */
  function buildTrackBar() {
    units.clear(); knobs.clear(); chips.clear();
    const mix = mixerOn(); const parts = [label];
    masterKnob = null;
    if (mix) {
      const masterBox = document.createElement('span'); masterBox.style.cssText = unitCss; masterBox.setAttribute('data-sr-score-master', '');
      masterKnob = createKnob({ min: 0, max: 127, value: Math.round(sound.state().master * 127), def: 100, size: 30, readout: false, label: t('syncreader.scoreAll'), title: `${t('syncreader.scoreAll')} (100)`, onChange: (v) => sound.setMaster(v / 127) });
      masterBox.append(Object.assign(document.createElement('b'), { textContent: t('syncreader.scoreAll'), style: 'font-size:11px;margin:0 3px' }), masterKnob.el); parts.push(masterBox);
    }
    movement.tracks.forEach((tr, i) => {
      const unit = document.createElement('span'); unit.style.cssText = unitCss; unit.setAttribute('data-sr-unit', tr.id);
      const b = document.createElement('button'); b.type = 'button'; b.textContent = trackName(tr, i); b.title = t('syncreader.showHide', { name: trackName(tr, i) }); b.setAttribute('data-sr-track', tr.id); b.style.cssText = 'min-height:30px;padding:0 8px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      b.addEventListener('click', () => toggleTrack(tr.id));
      if (!mix) { parts.push(b); chips.set(tr.id, b); return; } // the chip that shows / hides the track, no mixer (the sound is the video's)
      const m = small('M', t('sync.mute')); m.addEventListener('click', () => sound?.setTrack(tr.id, { mute: !sound.state().tracks.find((x) => x.id === tr.id).mute }));
      const sBtn = small('S', t('sync.solo')); sBtn.addEventListener('click', () => sound?.setTrack(tr.id, { solo: !sound.state().tracks.find((x) => x.id === tr.id).solo }));
      const knob = createKnob({ min: 0, max: 127, value: Math.round(sound.state().tracks.find((x) => x.id === tr.id).fader * 127), def: 100, size: 30, readout: false, label: `${trackName(tr, i)} ${t('sync.volume')}`, onChange: (v) => sound.setTrack(tr.id, { fader: v / 127 }) });
      unit.append(b, m, sBtn, knob.el); parts.push(unit); chips.set(tr.id, b); units.set(tr.id, { unit, m, s: sBtn }); knobs.set(tr.id, knob);
    });
    trackBox.replaceChildren(...parts);
    syncChips();
  }
  const syncMix = () => { if (!sound) return; const st = sound.state(); scoreMasterStrip?.setFader(Math.round(st.master * 127)); for (const x of st.tracks) { const h = scoreStrips.get(x.id); if (h) { h.setFader(Math.round(x.fader * 127)); h.setMute(x.mute); h.setSolo(x.solo); h.setDim(x.mute || (st.anySolo && !x.solo)); } const u = units.get(x.id); if (!u) continue; u.m.style.background = x.mute ? '#e8b4a8' : ''; u.s.style.background = x.solo ? '#f1d36b' : ''; u.unit.style.opacity = !x.mute && (!st.anySolo || x.solo) ? '1' : '0.55'; } };
  unsubMix = sound ? sound.subscribe(syncMix) : null; buildTrackBar(); syncMix();
  const clickKnob = createKnob({ min: 0, max: 100, value: 50, def: 50, size: 30, readout: false, label: t('syncreader.clickVolume'), title: t('syncreader.clickVolume'), onChange: (v) => player.setClickVolume(v / 100) });
  const clickBox = document.createElement('span'); clickBox.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:12px'; clickBox.append(t('syncreader.clickVolume'), clickKnob.el);
  if (!isVideo) bar.append(clickBox);
  const extra = document.createElement('span'); extra.className = 'sp-extra'; bar.append(extra); // text size, the help line and the score-sound switch: in the settings sheet on a tablet / phone
  if (zoomer.el) extra.append(zoomer.el);
  const hint = document.createElement('span'); hint.setAttribute('data-sr-loop-hint', ''); hint.textContent = t('syncreader.loopHint'); hint.style.cssText = 'flex:1 1 100%;font:12px var(--ui-font,sans-serif);color:var(--ink-soft,#555)'; extra.append(hint);
  if (isVideo && soundAllowed) { // the author allowed the sound of the score: the reader switches it on (off by default); it follows the video
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.setAttribute('data-sr-score-sound', ''); toggle.title = t('syncreader.scoreSound'); toggle.setAttribute('aria-label', t('syncreader.scoreSound'));
    toggle.style.cssText = 'min-height:30px;padding:0 10px;margin-left:8px';
    const paint = () => { const on = !!sound; toggle.style.display = scoreMode ? 'none' : ''; toggle.setAttribute('aria-pressed', String(on)); toggle.textContent = on ? `♪ ${t('syncreader.scoreSoundOn')}` : `♪ ${t('syncreader.scoreSoundOff')}`; toggle.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; };
    toggle.addEventListener('click', () => {
      if (sound) { sound.destroy(); sound = null; paint(); return; }
      sound = createScoreSound({ work, getMap: () => map, stems: player, audio: createReaderAudio() }); paint();
      if (player.state().playing) { player.pause(); player.play(); } // the sound of the score starts with the next start of the video
    });
    paint(); paintSoundToggle = paint; extra.append(toggle);
  }
  { // two switches of the settings sheet (a tablet / phone): the lyrics, and the closeness of the systems
    const sw = (text, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sp-sheet-only'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.style.cssText = 'padding:0 12px;font:inherit'; b.addEventListener('click', fn); return b; };
    const lyricsTrack = movement.tracks.find((tr) => isLyricsTrack(tr));
    if (lyricsTrack) {
      const lyricsBtn = sw(t('syncreader.lyrics'), t('syncreader.lyricsHint'), () => toggleTrack(lyricsTrack.id)); lyricsBtn.setAttribute('data-sr-lyrics-toggle', '');
      const paintLyrics = () => { const on = shownIds().includes(lyricsTrack.id); lyricsBtn.setAttribute('aria-pressed', String(on)); lyricsBtn.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; };
      paintLyrics(); lyricsTrackPaint = paintLyrics; extra.insertBefore(lyricsBtn, hint);
    }
    const tightBtn = sw(t('syncreader.tight'), t('syncreader.tightHint'), () => { tight = !tight; try { window.localStorage.setItem(TIGHT_KEY, tight ? 'on' : 'off'); } catch { /* kept for this page */ } paintTight(); draw(); });
    tightBtn.setAttribute('data-sr-tight-toggle', '');
    const paintTight = () => { tightBtn.setAttribute('aria-pressed', String(tight)); tightBtn.style.background = tight ? 'var(--btn-on,#e2e0da)' : ''; };
    paintTight(); extra.insertBefore(tightBtn, hint);
  }
  bodyHost.append(bar); syncChips();
  const instrumentBox = info.instruments === true || info.chords ? mountInstrumentBox(root, { work, getMap: () => map, player, t, instruments: info.instruments === true, chords: info.chords ? { pool: typeof info.chords.pool === 'string' ? info.chords.pool : 'reader', variants: info.chords.variants === 'all' ? 'all' : 'main', groups: ['sections', 'labels'].includes(info.chords.groups) ? info.chords.groups : 'off' } : null }) : null; // the author offered a keyboard / fretboard that lights the notes, and / or the diagrams of the chords that go by
  bar.classList.add('sp-desktop-only'); // the bar of knobs stays on the page for a computer ; a tablet / phone gets the same controls as faders in the mixette of its sheet
  panel.addToSheet('settings', extra);
  {
    const buildStrips = () => { // the strips of the mixette (a tablet / phone): built again when the mode changes
      const sp = panel.mixette;
      for (const h of scoreStrips.values()) h.el.remove(); scoreStrips.clear(); scoreMasterStrip?.el.remove(); scoreMasterStrip = null; clickStrip?.el.remove(); clickStrip = null;
      const mix = mixerOn();
      if (mix) scoreMasterStrip = sp.addStrip({ name: t('syncreader.scoreAll'), strong: true, fader: { min: 0, max: 127, value: Math.round(sound.state().master * 127), def: 100, onChange: (v) => sound.setMaster(v / 127) } });
      movement.tracks.forEach((tr, i) => {
        const live = () => sound.state().tracks.find((x) => x.id === tr.id);
        const mixer = mix ? { fader: { min: 0, max: 127, value: Math.round(live().fader * 127), def: 100, onChange: (v) => sound.setTrack(tr.id, { fader: v / 127 }) }, mute: () => sound.setTrack(tr.id, { mute: !live().mute }), solo: () => sound.setTrack(tr.id, { solo: !live().solo }) } : { fader: null };
        scoreStrips.set(tr.id, sp.addStrip({ name: trackName(tr, i), toggle: () => toggleTrack(tr.id), ...mixer }));
      });
      if (!isVideo) clickStrip = sp.addStrip({ name: t('syncreader.clickVolume'), fader: { min: 0, max: 100, value: 50, def: 50, onChange: (v) => player.setClickVolume(v / 100) } });
      syncChips(); syncMix();
    };
    rebuildStrips = buildStrips; buildStrips();
  }
  let viewer = null;
  if (isVideo) { // the video above the panel; a menu when the song has several videos (the map is built again from the times of the one chosen)
    const videoHost = document.createElement('div'); videoHost.style.cssText = 'flex:none;width:min(100%,360px)'; head.prepend(videoHost);
    viewer = mountVideoViewer(videoHost, { player: ytPlayer, videos, videoId: chosenVideo.videoId, label: (k, p) => t(k, p), onChoose: (id) => {
      chosenVideo = videos.find((v) => v.videoId === id) ?? chosenVideo;
      session.offsetMs = 0;
      const list = videoMeasures(chosenVideo.points, movementLengths);
      map = createSyncMap(list, { order }); clock?.setDuration(map.end());
      analysisLive.segments = sectionSegments(info.youtube?.sections ?? [], list);
      panel.retarget?.(); panel.refresh?.(); placeCursor(player.state(), false);
      viewer.load(id);
    } });
    viewer.load(chosenVideo.videoId);
    if (clock) { // the two modes: the video leads the score (A), or the score plays alone with its own sound, the video paused (B)
      const modeBar = document.createElement('div'); modeBar.setAttribute('data-sr-mode-bar', ''); modeBar.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;font:13px var(--ui-font,sans-serif)';
      const modeLabel = document.createElement('span'); modeLabel.textContent = t('syncreader.modeLabel');
      const mkMode = (id, text, tip) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = tip; b.setAttribute('aria-label', tip); b.setAttribute('data-sr-mode', id); b.style.cssText = 'min-height:34px;padding:0 12px;font:inherit;font-weight:var(--w-semi,600)'; b.addEventListener('click', () => setScoreMode(id === 'score')); return b; };
      const bVideo = mkMode('video', t('syncreader.modeVideo'), t('syncreader.modeVideoTip')); const bScore = mkMode('score', t('syncreader.modeScore'), t('syncreader.modeScoreTip'));
      const paintMode = () => {
        for (const [b, on] of [[bVideo, !scoreMode], [bScore, scoreMode]]) { b.setAttribute('aria-pressed', String(on)); b.style.background = on ? 'var(--btn-on,#e2e0da)' : ''; b.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; }
        viewer.root.style.opacity = scoreMode ? '.4' : ''; viewer.root.style.pointerEvents = scoreMode ? 'none' : '';
        viewer.setMessage(scoreMode ? t('syncreader.modeScoreNote') : '');
      };
      function setScoreMode(on) {
        if (on === scoreMode) return;
        if (on) {
          if (!sound) { sound = createScoreSound({ work, getMap: () => map, stems: player, audio: createReaderAudio() }); soundFromMode = true; } // the sound of the score is needed here
          unsubMix?.(); unsubMix = sound.subscribe(syncMix);
        } else {
          unsubMix?.(); unsubMix = null;
          if (soundFromMode) { sound.destroy(); sound = null; soundFromMode = false; }
        }
        scoreMode = on;
        player.use(on ? 'clock' : 'video'); // the other player takes over at the same place, speed and loop
        buildTrackBar(); rebuildStrips(); paintSoundToggle(); paintMode(); placeCursor(player.state(), false);
      }
      modeBar.append(modeLabel, bVideo, bScore); videoHost.prepend(modeBar); paintMode();
    }
  }
  draw();

  // what the address asked for (`v=`, `mute=`, `loop=`): speed, tracks that start muted (the sound of the score), a loop between two measures
  try {
    if (start?.speed) player.setRate(start.speed / 100);
    if (start?.mute?.length && sound) for (const id of startTracks(movement, start.mute) ?? []) sound.setTrack(id, { mute: true });
    if (start?.loop && panel) {
      const ids = movement.masterbars.map((b) => b.id); const a = ids.indexOf(start.loop.from); const b = ids.indexOf(start.loop.to);
      if (a >= 0 && b >= a) { const pa = map.playedFrom(a, 0); const pb = map.playedFrom(b, pa); panel.setSelection(Math.min(pa, pb), Math.max(pa, pb), { loop: true }); }
    }
  } catch { /* a value the player cannot take is left out */ }
  const off = player.subscribe((st) => placeCursor(st, st.playing));
  let resizeTimer = 0; let lastW = host.clientWidth;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (Math.abs(host.clientWidth - lastW) > 4) { lastW = host.clientWidth; draw(); } }, 150); };
  window.addEventListener('resize', onResize);
  onStatus('');
  return { player, destroy() { off(); instrumentBox?.destroy(); sound?.destroy(); viewer?.destroy(); window.removeEventListener('resize', onResize); panel.destroy(); player.destroy(); root.remove(); } };
}

function boot() {
  const host = document.getElementById('app');
  mountPortalButtonSize({ storage: (() => { try { return window.localStorage; } catch { return null; } })() }); // the size of the buttons chosen on the school portal (same domain)
  mountThemeToggle({ storage: (() => { try { return window.localStorage; } catch { return null; } })(), label: (next) => t(next === 'dark' ? 'reader.themeDark' : next === 'hc' ? 'reader.themeHc' : 'reader.themeLight') });
  let current = null;
  bootReader(host, {
    t, pickerKey: 'syncreader.openFile', embedded: () => embeddedBytes('scorsaire-file'),
    open: async (bytes) => {
      const r = await readWorkBytes(bytes);
      if (!r.sync || r.sync.info.source === 'youtube' || (!r.sync.media.length && r.sync.info.source !== 'video')) throw new Error(t('syncreader.noSync'));
      let sync = r.sync; let warnings = [];
      if (sync.media.some((m) => m.external && !m.bytes)) { // the audio is kept on the portal: fetched from `media=`, with the token, and checked against its fingerprint
        const progress = ({ done, total }) => { const el = host.querySelector('[data-sr-msg]'); if (el) el.textContent = t('syncreader.audioLoading', { done, total }); };
        const KEYS = { noBase: 'syncreader.audioNeedsBase', denied: 'syncreader.audioDenied', missing: 'syncreader.audioMissing' };
        try { const res = await resolveExternalMedia(sync.media, { base: mediaBase(pageParams()), onProgress: progress }); sync = { ...sync, media: res.media }; warnings = res.warnings; }
        catch (e) { throw new Error(t(KEYS[e.code] ?? 'syncreader.audioError')); }
      }
      current?.destroy();
      current = await mountSynchro(host, { work: r.work, sync, start: parseStartParams(pageParams()) });
      host.querySelector('[data-sr-warn]')?.remove();
      if (warnings.length) { // warned, not stopped: it may be the same recording encoded again
        const w = document.createElement('p'); w.setAttribute('data-sr-warn', ''); w.setAttribute('role', 'alert'); w.textContent = t('syncreader.audioMismatch');
        w.style.cssText = 'margin:8px;padding:10px 14px;border:1px solid var(--warn-edge,#b26a00);background:var(--warn-soft,#fff3d6);color:var(--warn-ink,#5c3a00);border-radius:8px;font:14px var(--ui-font,sans-serif)';
        w.addEventListener('click', () => w.remove()); host.prepend(w);
      }
    },
  });
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
