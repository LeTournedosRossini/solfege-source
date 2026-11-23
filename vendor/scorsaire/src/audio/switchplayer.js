/*
 * ONE player in front of two: the video (`createYouTubePlayer`) and the clock (`createClockPlayer`). Everything that reads or drives a player — the panel, the loop, the sound of the score,
 * the cursor — is given this one, and `use('video' | 'clock')` decides which of the two it speaks to. The time of both is the time of the recording, so the position, the speed and the
 * loop pass from one to the other unchanged: leaving a player pauses it, the other takes over at the same place.
 * Only the player that is in use is heard by the listeners.
 */
const DELEGATED = ['play', 'pause', 'stop', 'seek', 'setRate', 'setLoop', 'setSemitones', 'setStem', 'setMasterVolume', 'setPreRoll', 'setMuted'];

export function createSwitchPlayer({ video, clock }) {
  let active = 'video';
  const listeners = new Set(); const seekListeners = new Set();
  const current = () => (active === 'video' ? video : clock);
  const offs = [
    video.subscribe((s) => { if (active === 'video') for (const fn of [...listeners]) fn(s); }),
    clock.subscribe((s) => { if (active === 'clock') for (const fn of [...listeners]) fn(s); }),
    video.onSeek((t) => { if (active === 'video') for (const fn of [...seekListeners]) fn(t); }),
    clock.onSeek((t) => { if (active === 'clock') for (const fn of [...seekListeners]) fn(t); }),
  ];
  const api = {
    mode: () => active,
    state: () => current().state(),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSeek(fn) { seekListeners.add(fn); return () => seekListeners.delete(fn); },
    peaks: () => null,
    perfOfMedia: (t) => current().perfOfMedia?.(t),
    mediaAtPerf: (p) => current().mediaAtPerf?.(p),
    /** The other player takes over at the position, speed and loop of the one that leaves (which is paused). */
    use(which) {
      if (which === active || (which !== 'video' && which !== 'clock')) return;
      const from = current(); const to = which === 'video' ? video : clock;
      const st = from.state();
      from.pause();
      to.setRate(st.rate); to.setLoop(st.loop); to.seek(st.position);
      active = which;
      const now = to.state(); for (const fn of [...listeners]) fn(now);
    },
    destroy() { for (const o of offs) o(); try { video.destroy(); } catch { /* gone */ } clock.destroy(); listeners.clear(); seekListeners.clear(); },
  };
  for (const name of DELEGATED) api[name] = (...args) => current()[name]?.(...args);
  return api;
}
