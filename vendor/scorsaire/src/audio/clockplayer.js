/*
 * A CLOCK with the interface of a media player (the same as `createYouTubePlayer`): it holds no sound, it only counts time. The synchro reader uses it in « score alone » mode: the sound of the
 * score (`syncreader/score-sound.js`) follows it exactly as it follows the video, but a clock is exact — a loop wraps without any seek, the speed is free, nothing waits for a video to buffer.
 * The time is the one of the RECORDING (the sync map), so a position can pass from the video to the clock and back unchanged.
 * Injectable `now` / timers (tests). The state looks like a video's (`kind: 'youtube'`): the panel that reads it shows the same controls.
 */
export const CLOCK_RATES = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);

export function createClockPlayer({ duration = 0, now = () => performance.now(), poll = 50, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let length = Math.max(0, duration); let playing = false; let rate = 1; let loop = null;
  let reading = { t: 0, at: now() }; // the position at the moment `at` (ms): while playing, the position is that plus the time gone by × the rate
  let timer = null;
  const listeners = new Set(); const seekListeners = new Set();

  /** The position (s) at the performance time `at` (ms), a loop wrapping it. */
  const positionAt = (at) => {
    if (!playing) return reading.t;
    let p = reading.t + ((at - reading.at) / 1000) * rate;
    if (loop && reading.t < loop.end && p >= loop.end) p = loop.start + ((p - loop.start) % (loop.end - loop.start));
    return Math.min(length || Infinity, Math.max(0, p));
  };
  const position = () => positionAt(now());
  const state = () => ({ loaded: true, duration: length, position: position(), playing, buffering: false, rate, rates: [...CLOCK_RATES], error: null, loop, muted: false, semitones: 0, masterVolume: 1, stems: [], kind: 'youtube' });
  const emit = () => { const s = state(); for (const fn of [...listeners]) fn(s); };
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const tick = () => {
    if (playing && length && !loop && position() >= length) { reading = { t: length, at: now() }; playing = false; stopTimer(); } // the end of the piece: it stops
    emit();
  };
  const startTimer = () => { if (timer === null) timer = setTimer(tick, poll); };

  const api = {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSeek(fn) { seekListeners.add(fn); return () => seekListeners.delete(fn); },
    /** The length of the piece in recording time (the end of the sync map); changing it keeps the position inside. */
    setDuration(d) { length = Math.max(0, d); if (reading.t > length) reading = { t: length, at: now() }; emit(); },
    play() {
      if (playing) return;
      if (length && position() >= length - 0.05) { reading = { t: 0, at: now() }; for (const fn of [...seekListeners]) fn(0); }
      reading = { t: position(), at: now() }; playing = true; startTimer(); emit();
    },
    pause() { if (!playing) return; reading = { t: position(), at: now() }; playing = false; stopTimer(); emit(); },
    stop() { playing = false; stopTimer(); reading = { t: 0, at: now() }; emit(); },
    seek(t) {
      const to = Math.min(Math.max(0, t), length || t);
      reading = { t: to, at: now() };
      for (const fn of [...seekListeners]) fn(to);
      emit();
    },
    /** Any speed from 25 % to 200 %, in steps of 5 %. */
    setRate(r) { const best = Math.max(0.25, Math.min(2, Math.round(r * 20) / 20)); reading = { t: position(), at: now() }; rate = best; emit(); },
    setLoop(range) { loop = range && range.end > range.start ? { start: range.start, end: range.end } : null; reading = { t: position(), at: now() }; emit(); },
    /** The performance time (ms) at which the clock is, was or will be at the media position `t` (a loop not wrapped: the lap that is going on). */
    perfOfMedia(t) { return now() + ((t - position()) / rate) * 1000; },
    /** The media position at the performance time `perf` (ms). */
    mediaAtPerf: (perf) => positionAt(perf),
    destroy() { stopTimer(); playing = false; listeners.clear(); seekListeners.clear(); },
    // what a recording of stems has and a clock has not: the panels read these without caring
    setMuted() {}, setSemitones() {}, setStem() {}, setMasterVolume() {}, setPreRoll() {}, peaks: () => null,
  };
  return api;
}
