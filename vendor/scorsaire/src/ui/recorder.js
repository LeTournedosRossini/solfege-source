/*
 * The recording of a take, WITHOUT DOM: the state machine behind the recording window (`record-dom.js`).
 *
 *   idle → (start) counting (the pre-roll: metronome clicks before the first measure) → recording → (stop, or the end of the measures) → review
 *   review: the raw events are kept; the grid and the latency can change and the result is recomputed; notes can be deleted; `commit()` writes it.
 *
 * The metronome is scheduled on the AUDIO clock (`engine.clickAt`, all the clicks at once), and the keys are timed with `performance.now()`, mapped to the
 * time the first click is HEARD (`engine.audioClock().perfOf`): so what is measured is the player's offset from the click as heard, which is what the
 * latency setting (and the estimate after a take) corrects. The keys sound by themselves (live notes); nothing else plays during a take.
 * `deps` are injectable for tests: `now()` (ms), `setTimer` / `clearTimer`.
 */
import { frac } from '../model/index.js';
import { takeClock, quantizeTake, estimateOffset } from '../audio/recording.js';

export const GRIDS = Object.freeze([frac(1, 4), frac(1, 8), frac(1, 16), frac(1, 32)]);
const RAW_GRID = frac(1, 256); // the preview before quantizing: positions are as played (to 1/256 of a whole note)
export const DEFAULT_SETTINGS = Object.freeze({ grid: [1, 16], prerollBeats: 4, clickVolume: 0.6, offsetMs: 0, legato: false });
const LEAD = 0.15; // seconds between pressing record and the first click (to schedule them all)
const TAIL = 0.4; // seconds after the last measure during which a key still counts

export function createRecorder({ app, getEngine, settings, backing = () => null, viewId = 'main', now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) }) {
  let state = 'idle'; let target = null; let clock = null; let events = []; let startPerf = 0; let timer = null; let edits = new Map(); let past = []; let future = []; let editVersion = 0; let quantized = false;
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(state); };
  const set = (next) => { state = next; emit(); };
  const grid = () => settings.get().grid;
  let cache = null;
  const result = () => {
    const key = `${events.length}|${grid().join('/')}|${settings.get().offsetMs}|${settings.get().legato ? 1 : 0}|${editVersion}`;
    if (cache?.key !== key) {
      const q = quantizeTake(events, clock, { grid: grid(), offset: settings.get().offsetMs / 1000, legato: !!settings.get().legato, edits });
      cache = { key, q };
    }
    return cache.q;
  };
  let rawCache = null;
  /** The take as played (nothing snapped to the chosen grid), for the preview before the user quantizes. */
  const raw = () => {
    const key = `${events.length}|${settings.get().offsetMs}`;
    if (rawCache?.key !== key) rawCache = { key, q: quantizeTake(events, clock, { grid: RAW_GRID, offset: settings.get().offsetMs / 1000 }) };
    return rawCache.q;
  };
  const api = {
    get state() { return state; },
    /** False after a take until `quantize()` is called (the window pastes only a quantized take); a new take resets it. */
    get quantized() { return quantized; },
    quantize() { if (state === 'review') { quantized = true; emit(); } },
    unquantize() { if (state === 'review') { quantized = false; edits = new Map(); past = []; future = []; editVersion += 1; emit(); } },
    raw,
    onState(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    target: () => target,
    clock: () => clock,
    /** Prepares a take on the range selected in the view. Returns the target ({ staffId, fromMeasure, toMeasure, … }) or null when nothing can be recorded. */
    open() {
      const t = app.recordTarget(viewId);
      if (!t) return null;
      target = t; clock = takeClock(t.movement, t.fromMeasure, t.toMeasure); events = []; edits = new Map(); past = []; future = []; editVersion += 1; cache = null; quantized = false;
      set('idle');
      return t;
    },
    /** Starts the pre-roll and the take. Throws when the audio engine has no metronome. */
    start() {
      const engine = getEngine();
      if (!engine?.clickAt || !engine?.audioClock) throw new Error('noMetronome');
      if (state === 'counting' || state === 'recording') return;
      const preroll = settings.get().prerollBeats;
      const audio = engine.audioClock();
      const clicks = clock.clicks(preroll);
      // a pre-rendered backing starts `lead` seconds BEFORE t = 0 of the take (the measures before the range): the earliest of it and the first click is at `LEAD` from now
      const back = engine.playBacking ? backing() : null;
      const startCtx = audio.now() + LEAD + Math.max(preroll ? -clicks[0].t : 0, back?.lead ?? 0); // t = 0 of the take, in audio time
      for (const c of clicks) engine.clickAt(startCtx + c.t, { accent: c.accent, volume: settings.get().clickVolume });
      if (back) engine.playBacking(back.buffer, startCtx - back.lead);
      startPerf = audio.perfOf(startCtx);
      events = []; edits = new Map(); past = []; future = []; editVersion += 1; cache = null; quantized = false;
      set(preroll ? 'counting' : 'recording');
      const toStart = Math.max(0, startPerf - now());
      timer = setTimer(() => { if (state === 'counting') set('recording'); timer = setTimer(() => api.stop(), (clock.length + TAIL) * 1000); }, toStart);
    },
    /** Seconds since the start of the take (negative during the pre-roll). */
    elapsed: () => (now() - startPerf) / 1000,
    /** A key / position pressed: `played` = { midi, string?, fret?, stringCount?, velocity? }. Counted during the pre-roll and the take. */
    press(played) {
      if (state !== 'counting' && state !== 'recording') return;
      events.push({ ...played, type: 'on', t: ((played.perf ?? now()) - startPerf) / 1000 }); // a MIDI key carries its own (hardware) timestamp
    },
    release(played) {
      if (state !== 'counting' && state !== 'recording') return;
      events.push({ ...played, type: 'off', t: ((played.perf ?? now()) - startPerf) / 1000 });
    },
    /** Ends the take (or cancels the pre-roll): the clicks not yet played are cancelled. */
    stop() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      getEngine()?.cancelClicks?.();
      getEngine()?.stopBacking?.();
      if (state === 'counting' || state === 'recording') set('review');
    },
    /** The quantized take with the current grid and latency (with the user's corrections). */
    result,
    /** How late the notes sit on the grid: { seconds, confidence, count } or null (the latency already applied is taken into account). */
    estimate: () => estimateOffset(events, clock, { grid: grid(), offset: settings.get().offsetMs / 1000 }),
    rawCount: () => events.filter((e) => e.type === 'on').length,
    /**
     * The user's corrections of one note of `result()` (by `note.id`): { midi?, start?, end? } (start / end: exact fractions of a whole note since the start of
     * the take), or `deleted: true`. Each call is one step of the local undo history (not the document's: nothing is written before `commit()`).
     */
    editNote(id, patch) {
      past.push(new Map(edits)); future = [];
      edits = new Map(edits); edits.set(id, { ...(edits.get(id) ?? {}), ...patch });
      editVersion += 1; emit();
    },
    deleteNote(chord, note) { api.editNote(note.id, { deleted: true }); },
    /** Drops every correction (the notes come back as quantized). */
    restoreNotes() { if (!edits.size) return; past.push(new Map(edits)); future = []; edits = new Map(); editVersion += 1; emit(); },
    canUndoEdit: () => past.length > 0,
    canRedoEdit: () => future.length > 0,
    undoEdit() { if (!past.length) return; future.push(edits); edits = past.pop(); editVersion += 1; emit(); },
    redoEdit() { if (!future.length) return; past.push(edits); edits = future.pop(); editVersion += 1; emit(); },
    hasEdits: () => edits.size > 0,
    /** Writes the take (one undoable transaction). Returns { placed, ties, skipped }. */
    commit() {
      const r = result();
      if (!r.chords.length) throw new Error('empty');
      const done = app.commitTake(target, r.chords, viewId);
      set('idle');
      return done;
    },
    discard() { api.stop(); events = []; set('idle'); },
    destroy() { api.stop(); listeners.clear(); },
  };
  return api;
}
