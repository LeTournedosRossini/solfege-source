/*
 * YouTube player for mode B of screen 4 (a video with fragments of score placed on its timeline). The IFrame API is injected (`loadApi`: resolves with the `YT` object),
 * so everything here runs under Node with a fake. What the API gives: play, pause, seek, speed (a few rates), a duration and a position that is only refreshed
 * a few times a second (so the position is extrapolated between two readings). What it does NOT give: the sound (no stems, no pitch shift, no waveform).
 * A page opened from `file://` gets error 153 from YouTube: this mode needs a page served over http(s) (spike of 23/10/2026).
 */

/** The video id of a YouTube address (watch, youtu.be, embed, shorts, live) or of a bare id; null when it is not one. */
export function parseYouTubeId(text) {
  const s = String(text ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/.exec(s);
  return m ? m[1] : null;
}

/** Loads the IFrame API once (browser). */
export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (window.__ytApiPromise) return window.__ytApiPromise;
  window.__ytApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => { window.__ytApiPromise = null; reject(new Error('The YouTube API could not be loaded (no network?)')); };
    document.head.append(s);
  });
  return window.__ytApiPromise;
}

export function createYouTubePlayer({ loadApi = loadYouTubeApi, poll = 100, now = () => performance.now(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let yt = null; let loaded = false; let playing = false; let buffering = false; let rate = 1; let rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]; let duration = 0; let error = null;
  let reading = { t: 0, at: 0 }; // the last position read from the player and when
  let muted = false; // the sound of the video (a video that follows the recording is muted)
  let loop = null; // { start, end } seconds: when the video reaches the end it goes back to the start (within the precision of the readings, a tenth of a second)
  let timer = null; let want = false; let quietUntil = 0; // want: the person asked to play ; quietUntil: after a seek made while paused (YouTube starts to play by itself)
  const listeners = new Set(); const seekListeners = new Set();

  const position = () => (playing && !buffering ? Math.min(duration || Infinity, reading.t + ((now() - reading.at) / 1000) * rate) : reading.t); // while the video waits for its data the position does not move
  const state = () => ({ loaded, duration, position: position(), playing, buffering, rate, rates: [...rates], error, loop, muted, semitones: 0, masterVolume: 1, stems: [], kind: 'youtube' });
  const emit = () => { const s = state(); for (const fn of [...listeners]) fn(s); };
  const read = () => {
    if (!yt || !loaded) return;
    const t = yt.getCurrentTime?.() ?? reading.t;
    // the API refreshes slowly: keep the extrapolation while the reading has not moved
    if (Math.abs(t - reading.t) > 1e-3) reading = { t, at: now() };
    else if (!playing) reading = { t, at: now() };
    if (!duration) duration = yt.getDuration?.() ?? 0;
  };
  const tick = () => {
    read();
    if (loop && playing && !buffering && position() >= loop.end) api.seek(loop.start); // `seek` emits
    else emit();
  };
  const startTimer = () => { if (timer === null) timer = setTimer(tick, poll); };
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  async function load(videoId, host, { nativeFullscreen = true, nativeControls = true } = {}) {
    destroy();
    const YT = await loadApi();
    await new Promise((resolve, reject) => {
      yt = new YT.Player(host, {
        videoId, width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, ...(nativeFullscreen ? {} : { fs: 0 }), ...(nativeControls ? {} : { controls: 0, disablekb: 1 }) },
        events: {
          onReady: () => { loaded = true; if (muted) { try { yt.mute?.(); } catch { /* none */ } } duration = yt.getDuration?.() ?? 0; rates = yt.getAvailablePlaybackRates?.() ?? rates; reading = { t: 0, at: now() }; resolve(); emit(); },
          onError: (e) => { error = e?.data ?? true; const msg = e?.data === 153 || e?.data === 101 || e?.data === 150 ? 'embed' : 'video'; if (!loaded) reject(new Error(`YouTube error ${e?.data} (${msg})`)); else emit(); },
          onStateChange: (e) => {
            const s = e?.data;
            if (s === 1 && !want) { if (now() < quietUntil) { yt.pauseVideo(); return; } want = true; } // YouTube played by itself after a seek: paused again ; started by its own controls: accepted
            if (s === 2 || s === 0) want = false;
            const was = playing; const wasBuffering = buffering; playing = s === 1 || s === 3; buffering = s === 3; // playing or buffering
            if (playing) { read(); reading = { t: yt.getCurrentTime?.() ?? reading.t, at: now() }; startTimer(); } // (re)started: the position is read again at that very moment else { read(); if (s === 2 || s === 0 || s === 5 || s === -1) stopTimer(); }
            if (was !== playing || wasBuffering !== buffering) emit();
          },
        },
      });
    });
    startTimer(); // also while paused: a seek made inside the video is seen
  }
  function destroy() { stopTimer(); try { yt?.destroy?.(); } catch { /* the iframe may be gone */ } yt = null; loaded = false; playing = false; duration = 0; reading = { t: 0, at: 0 }; }

  const api = {
    load, destroy, state,
    /** Mutes or unmutes the sound of the video (kept across a new `load`). */
    setMuted(on) { muted = !!on; try { if (loaded) { if (muted) yt.mute?.(); else yt.unMute?.(); } } catch { /* the player may be gone */ } emit(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSeek(fn) { seekListeners.add(fn); return () => seekListeners.delete(fn); },
    play() { if (loaded) { want = true; yt.playVideo(); } },
    pause() { if (loaded) { want = false; yt.pauseVideo(); } },
    stop() { if (!loaded) return; want = false; yt.pauseVideo(); yt.seekTo(0, true); reading = { t: 0, at: now() }; playing = false; emit(); },
    seek(t) {
      if (!loaded) return;
      const to = Math.min(Math.max(0, t), duration || t);
      if (!want) quietUntil = now() + 1500;
      yt.seekTo(to, true); reading = { t: to, at: now() };
      for (const fn of [...seekListeners]) fn(to);
      emit();
    },
    // any rate in steps of 5 % between the lowest and the highest the video offers; what the player really applied is read back a moment later (a rate it refuses is replaced by the one it chose)
    setRate(r) {
      if (!loaded) return;
      const lo = Math.min(...rates); const hi = Math.max(...rates);
      const best = Math.max(lo, Math.min(hi, Math.round(r * 20) / 20)); const here = position();
      yt.setPlaybackRate(best); rate = best; reading = { t: here, at: now() }; emit();
      setTimeout(() => { const real = yt?.getPlaybackRate?.(); if (typeof real === 'number' && real > 0 && Math.abs(real - rate) > 0.001) { const at = position(); rate = real; reading = { t: at, at: now() }; emit(); } }, 300);
    },
    // what a recording of stems has and a video has not: the panels read these without caring
    setLoop(range) { loop = range && range.end > range.start ? { start: range.start, end: range.end } : null; emit(); },
    setSemitones() {}, setStem() {}, setMasterVolume() {}, setPreRoll() {}, peaks: () => null,
  };
  return api;
}
