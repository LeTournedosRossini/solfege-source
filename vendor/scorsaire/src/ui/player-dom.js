/*
 * Transport (DOM), dans le bandeau du bas (`dock-dom.js`) : lecture / pause toujours visibles ; un tiroir (bouton à l'icône de reprise) ouvre au-dessus du bandeau l'arrêt, la vitesse, les reprises, la boucle (activer / couper / effacer ; le début et la fin se posent en touchant une mesure), le mixeur, le moteur audio, le temps et la mesure. Le curseur
 * à l'écran est dessiné par `mountScoreView(...).setCursor` ; ce fichier relie le lecteur (`player.js`, sans DOM) à la vue et à la page.
 * Tablette : tous les boutons font au moins 44 px ; la barre reste collée en haut de l'écran pendant le défilement ; la lecture démarre dans le
 * geste du clic (AudioContext iPad Safari : créé et relancé par le moteur dans `play()`, appelé de façon synchrone depuis le gestionnaire).
 */
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * @param o.dock   bandeau du bas (`mountDock`) qui reçoit les boutons
 * @param o.player lecteur (`createPlayer`) ; o.view : ScoreView ; o.mounted : retour de `mountScoreView` ; o.label : (clé, params) → texte
 * @returns {{ destroy() }}
 */
import { applyTextIcon, applyIconName, icon } from './icons.js';
import { drawnById } from './mark-icons.js';
import { createScrubPill } from './scrub-pill.js';
import { fitRow } from './dock-dom.js';
import { createSmoothClock } from './smooth-clock.js';
import { locate } from '../audio/cursor.js';
import { placeOfItem } from '../model/range.js';

export function mountPlayer(_host, { dock, player, view, mounted, label = (k) => k, available = true, onMixer = null, concertPitch = null, onMovement = null, route = null, notify = () => {} }) {
  // `route` = { active(), play(), stop(), state() → { playing, enabled } }: on another screen (the sheets) the play / stop buttons drive what that screen plays instead of the piece
  const routed = () => !!route?.active();
  const btn = (text, title, fn, attrs = {}) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    if (!applyTextIcon(b, text)) { if (text === 'repeats') b.replaceChildren(drawnById('repeat:end')); else if (text === 'drawer') applyIconName(b, 'chevron-right'); else applyIconName(b, text); } b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);font-size:16px;display:inline-flex;align-items:center;justify-content:center';
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    b.addEventListener('click', fn);
    return b;
  };
  // play and stop side by side (a pause that did not always cut the sound was replaced by a stop that always does)
  // pressing play while it plays, with a measure selected: the playback stops where it was and starts again at once from that measure
  // the place to restart from: the chosen measure (or range), else the selected note / rest (at its own instant)
  const selectedPlace = () => {
    const id = view.range?.()?.from?.measureId ?? view.targetMeasureId?.();
    const i = id ? view.measureIndexOf(id) : -1;
    if (i >= 0) return { measure: i, position: undefined };
    const mv = view.movement?.();
    const picked = view.selection?.()[0];
    return mv && picked ? placeOfItem(mv, picked) : null;
  };
  const play = btn('play', label('player.play'), () => {
    if (routed()) { route.play(); return; }
    const at = selectedPlace();
    if (!player.state().playing) {
      // stopped: start from what is selected (the playhead only follows a tap in the empty space of a measure, not a range, a note or the handles)
      // — unless the playhead already sits on it (a paused playback resumes where it is)
      const st = player.state(); const where = st.where; const mi = view.movementIndex();
      const here = at && where && where.movement === mi && where.measure === at.measure && (at.position === undefined ? true : (where.position[0] === at.position[0] && where.position[1] === at.position[1]));
      if (!at || here || st.position > 0 && st.position >= st.duration) { player.play(); return; }
      try { player.playFrom(mi, at.measure, at.position); } catch { player.play(); }
      return;
    }
    if (!at) { notify(label('player.restartNothing')); return; }
    try { player.stop(); player.playFrom(view.movementIndex(), at.measure, at.position); notify(label('player.restartFrom', { n: at.measure + 1 })); } // stop first: it always cuts the sound, whatever the engine
    catch (e) { notify(label('player.restartFailed', { message: e?.message ?? String(e) })); }
  }, { 'data-action': 'play', 'data-dismiss-keep': '' }); // a press on play must not clear the selection it restarts from (a press outside the score does, unless kept)
  const stop = btn('square', label('player.stop'), () => { if (routed()) { route.stop(); return; } player.stop(); }, { 'data-action': 'stop' });
  // playback speed: a scrub pill, 1 % per step (drag up / down, tap for the stepper)
  const speedPill = createScrubPill({ min: 25, max: 200, value: player.state().speed, step: 1, pxPerStep: 2, format: (v) => `${v} %`, title: label('player.speed'), label: { down: label('player.slower'), up: label('player.faster') },
    onCommit: (v) => player.setSpeed(v), onLong: () => player.setSpeed(100) }); // a long press goes back to 100 %
  const speed = speedPill.el; speed.setAttribute('data-speed', ''); speed.style.whiteSpace = 'nowrap'; speed.style.flex = 'none';
  const loop = btn('repeat', label('player.loop'), () => player.toggleLoop(), { 'data-action': 'loop' });
  const repeatsBtn = btn('repeats', label('player.repeats'), () => player.setRepeats(!player.repeats()), { 'data-action': 'repeats' });
  // the mixer: on a computer a round button floats over the score (piano-drawer.js); on a tablet or a phone there is no room for it there, so it is a button of the playback drawer
  const mixerBtn = onMixer ? btn('sliders-vertical', label('mixer.open'), () => onMixer(), { 'data-action': 'mixer-open' }) : null;
  // concert pitch: shows the real sound of the transposing instruments (a display setting of the page)
  const concertBtn = concertPitch ? btn('', label('dock.concert'), () => { concertPitch.set(!concertPitch.get()); syncConcert(); }, { 'data-action': 'concert-pitch' }) : null;
  if (concertBtn) { concertBtn.textContent = 'C'; concertBtn.style.fontWeight = '700'; }
  const syncConcert = () => { if (!concertBtn) return; const on = concertPitch.get(); concertBtn.setAttribute('aria-pressed', String(on)); concertBtn.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; };
  syncConcert();
  const info = document.createElement('span');
  info.setAttribute('data-time', ''); info.style.cssText = 'margin-left:6px;font-variant-numeric:tabular-nums;font:14px sans-serif';
  const drawerBtn = btn('drawer', label('player.drawer'), () => dock.setTop(dock.topMode() === 'transport' ? null : 'transport'), { 'data-action': 'transport-drawer' });
  // the arrow says « this unfolds something »: towards the right beside the buttons, upwards on a phone (the drawer opens above the dock)
  let arrow = 'chevron-right';
  const sync = () => {
    const phone = document.documentElement.hasAttribute('data-phone'); const opened = dock.topMode() === 'transport';
    const want = phone ? (opened ? 'chevron-down' : 'chevron-up') : (opened ? 'chevron-left' : 'chevron-right');
    if (want !== arrow) { arrow = want; applyIconName(drawerBtn, want); }
    drawerBtn.style.display = dock.topInHeader() || routed() ? 'none' : ''; const on = dock.topMode() === 'transport'; drawerBtn.setAttribute('aria-pressed', String(on)); drawerBtn.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : ''; };
  const offMode = dock.onMode(sync); sync();
  const offSync = dock.addFitter(sync); // (a change of the display type of the device repaints the arrow)
  dock.topLeft.prepend(play, stop, drawerBtn);
  // the drawer takes the middle of the top row; what does not fit goes behind « › »
  const items = [
    { el: speed, prio: 0 }, { el: loop, prio: 1 }, { el: repeatsBtn, prio: 2 },
    ...(concertBtn ? [{ el: concertBtn, prio: 2 }] : []), { el: info, prio: 6 },
  ];
  const mixerItem = mixerBtn ? { el: mixerBtn, prio: 1 } : null; // (one object: the fitter compares the items it is given)
  const itemsNow = () => (mixerItem && !dock.inHeader() ? [mixerItem, ...items] : items);
  const more = document.createElement('button'); more.type = 'button'; more.title = label('noteEntry.more'); more.setAttribute('aria-label', more.title);
  more.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);flex:none;cursor:pointer';
  const morePanel = document.createElement('div'); dock.topMid.append(morePanel);
  const fitter = fitRow({ row: dock.topMid, getItems: itemsNow, more, panel: morePanel, avail: () => (dock.topMode() === 'transport' || (dock.topInHeader() && !routed()) ? dock.topMid.clientWidth : 0) });
  const offFit = dock.addFitter(fitter.fit);
  if (!available) {
    for (const b of [play, stop, speed, repeatsBtn, loop]) if (b.tagName === 'BUTTON') b.disabled = true;
    info.textContent = label('player.unavailable');
  }

  /** The buttons of the screen that routes them (the sheets): ▶ plays the selected cell, ■ stops it, the transport drawer (speed, loop…: the piece's) is hidden. */
  const syncRoute = () => {
    const on = routed();
    const hide = on && !!route.hideButtons?.(); // screen 4: the transport is in the media panel, these two would only repeat it
    play.style.display = hide ? 'none' : ''; stop.style.display = hide ? 'none' : '';
    dock.showMid = () => !routed(); dock.topMid.style.display = dock.topMode() === 'transport' || (dock.topInHeader() && !on) ? 'flex' : 'none'; sync();
    if (on) {
      if (dock.topMode() === 'transport') dock.setTop(null);
      const st = route.state();
      play.disabled = !st.enabled || st.playing; play.setAttribute('aria-pressed', String(st.playing)); play.style.outline = st.playing ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
      stop.disabled = !st.playing;
    } else if (available) { play.disabled = false; update(player.state()); }
  };
  const update = (s) => {
    if (routed()) return syncRoute();
    play.setAttribute('aria-pressed', String(s.playing)); play.style.outline = s.playing ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
    stop.disabled = !s.playing && s.position <= 0;
    speedPill.setValue(s.speed);
    repeatsBtn.setAttribute('aria-pressed', s.repeats ? 'true' : 'false');
    repeatsBtn.style.opacity = s.repeats ? '1' : '0.55';
    repeatsBtn.style.textDecoration = s.repeats ? '' : 'line-through';
    repeatsBtn.title = s.repeats ? label('player.repeatsOn') : label('player.repeatsOff');
    const on = s.loopOn && s.loop;
    loop.style.outline = on ? '1px solid var(--btn-on-line,#b9b4a8)' : '';
    loop.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (available) {
      const range = s.loop ? ` · ${s.loop.from + 1}–${s.loop.to + 1}` : '';
      info.textContent = `${fmt(s.position)} / ${fmt(s.duration)}${s.where ? ` · ${label('player.measure', { measure: s.where.measure + 1 })}` : ''}${range}`;
    }
    // a chained playback enters another movement: the score follows it
    if (s.playing && s.where && onMovement && s.where.movement !== view.movementIndex()) onMovement(s.where.movement);
    // the cursor is placed from a smoothed copy of the audio clock (even motion); the readouts above keep the exact values
    const seq = player.sequence();
    const shown = s.playing && seq ? locate(seq, cursorClock.read(s.position, true)) ?? s.where : (cursorClock.reset(), s.where);
    const c = shown ? view.playCursor(shown) : null;
    mounted.setCursor(s.playing ? c : null, { follow: s.playing });
  };
  const cursorClock = createSmoothClock();
  const off = player.subscribe(update);
  update(player.state());
  return { refresh: syncRoute, destroy() { off(); offMode(); offSync(); offFit(); fitter.destroy(); if (dock.topMode() === 'transport') dock.setTop(null); mounted.setCursor(null); for (const b of [play, drawerBtn, stop, speed, repeatsBtn, loop, concertBtn, info, more, morePanel]) b?.remove(); } };
}
