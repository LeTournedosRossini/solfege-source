/*
 * The latency calibration run, WITHOUT DOM (the recording window draws it): idle → running (slow clicks on the audio clock, taps timed with
 * `performance.now()` mapped to the time the first click is HEARD, exactly like a take) → done (`result()` from `audio/calibration.js`).
 * `deps` are injectable for tests: `now()` (ms), `setTimer` / `clearTimer`.
 */
import { CALIBRATION, calibrationClicks, analyzeTaps } from '../audio/calibration.js';

const LEAD = 0.5; // seconds between the button and the first click
const TAIL = 0.4;

export function createCalibrator({ getEngine, clickVolume = () => 0.6, now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) }) {
  let state = 'idle'; let startPerf = 0; let taps = []; let timer = null; let outcome = null;
  const listeners = new Set();
  const set = (next) => { state = next; for (const fn of [...listeners]) fn(state); };
  const api = {
    get state() { return state; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Starts the clicks. Throws 'noMetronome' when the audio engine has none. */
    start() {
      const engine = getEngine();
      if (!engine?.clickAt || !engine?.audioClock) throw new Error('noMetronome');
      if (state === 'running') return;
      const audio = engine.audioClock();
      const clicks = calibrationClicks();
      const startCtx = audio.now() + LEAD;
      for (const c of clicks) engine.clickAt(startCtx + c.t, { accent: c.accent, volume: clickVolume() });
      startPerf = audio.perfOf(startCtx);
      taps = []; outcome = null;
      set('running');
      const last = clicks[clicks.length - 1].t;
      timer = setTimer(() => api.finish(), Math.max(0, startPerf - now()) + (last + TAIL) * 1000);
    },
    /** A key pressed (`perf` = its own hardware timestamp when it has one). */
    press(played = {}) {
      if (state !== 'running') return;
      taps.push(((played.perf ?? now()) - startPerf) / 1000);
      for (const fn of [...listeners]) fn(state);
    },
    /** Seconds since the first click (negative before it); the window shows the beat counter from it. */
    elapsed: () => (now() - startPerf) / 1000,
    tapCount: () => taps.length,
    finish() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      if (state !== 'running') return;
      getEngine()?.cancelClicks?.();
      outcome = analyzeTaps(taps);
      set('done');
    },
    cancel() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      if (state === 'running') getEngine()?.cancelClicks?.();
      outcome = null; taps = [];
      set('idle');
    },
    result: () => outcome,
    destroy() { api.cancel(); listeners.clear(); },
  };
  return api;
}

export { CALIBRATION };
