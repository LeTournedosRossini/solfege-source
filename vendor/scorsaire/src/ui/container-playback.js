/*
 * Playback of the score of ONE container on the current audio engine (the play button of the container editors). No DOM. It borrows the engine: the
 * main player is paused, the nested score is loaded and played, and when it ends (or is stopped) the main player is told to reload its own sequence.
 * `build(containerId)` → a sequence or null (see audio/containerplay.js).
 */
export function createContainerPlayback({ getEngine, player = null, build, every = (fn, ms) => setInterval(fn, ms), cancel = (t) => clearInterval(t) }) {
  let active = null; let sequence = null; let timer = null;
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(active); };

  function finish() {
    if (timer !== null) { cancel(timer); timer = null; }
    const engine = getEngine();
    if (active !== null) { try { engine.stop(); } catch { /* the engine may already be stopped */ } }
    active = null; sequence = null;
    player?.refresh?.(); // the main player reloads its own sequence at its next play
    emit();
  }
  const api = {
    /** Plays the container (pressing again on the one that plays stops it); false when there is nothing to hear. */
    play(containerId, { position = null } = {}) {
      if (active === containerId) { finish(); return true; }
      if (active !== null) finish();
      const seq = build(containerId);
      const engine = getEngine();
      if (!seq || !engine) return false;
      player?.pause?.();
      engine.load(seq, { position: position ?? seq.cellLoop?.start ?? 0 });
      if (seq.cellLoop) engine.setLoop?.(seq.cellLoop);
      engine.play();
      active = containerId; sequence = seq;
      timer = every(() => { if (!getEngine().isPlaying() || (!sequence.cellLoop && getEngine().position() >= sequence.duration)) finish(); }, 150);
      emit();
      return true;
    },
    stop() { if (active !== null) finish(); },
    /** Moves what plays to `seconds` (nothing happens when nothing plays). */
    seek(seconds) { if (active !== null) getEngine().seek(seconds); },
    /** Sets or clears the loop of what plays now (a live change: nothing is cut). */
    setLoop(loop) {
      if (active === null) return;
      if (loop) sequence.cellLoop = loop; else delete sequence.cellLoop;
      getEngine().setLoop?.(loop ?? null);
    },
    /** The mixer of what plays changed (mute, solo, volume): the new sequence is built and only its mixer goes to the engine, so the sound never stops. */
    refreshMixer() {
      if (active === null) return;
      const next = build(active); if (!next) return;
      const mixer = {};
      for (const t of next.tracks ?? []) { mixer[t.id] = { ...(t.mixer ?? {}) }; const mine = sequence.tracks?.find((x) => x.id === t.id); if (mine) mine.mixer = { ...(t.mixer ?? {}) }; }
      getEngine().setMixer?.(mixer);
    },
    /** The sequence and the position (seconds) of what plays now, for a cursor: null when nothing plays. */
    cursor() { return active === null || !sequence ? null : { id: active, sequence, seconds: getEngine().position() }; },
    isPlaying: (containerId) => (containerId === undefined ? active !== null : active === containerId),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}
