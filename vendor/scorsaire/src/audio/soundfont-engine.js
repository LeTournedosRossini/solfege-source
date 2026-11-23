/*
 * SoundFont engine: plays a sequence (`sequence.js`) through a SoundFont (SF2 / SF3) synthesizer running in an AudioWorklet (SpessaSynth,
 * Apache-2.0). Same contract as `WebAudioEngine` (`engine.js`); it inherits the scheduler (look-ahead, loop, clock anchors) and only replaces
 * what makes a sound: notes become timed MIDI-like messages, tracks become MIDI channels.
 *
 * Why: the light engine builds ~12 Web Audio nodes per note, which saturates the audio thread on a big score (measured: 96 tracks, ~360 notes/s,
 * clock at 0.7x real time). A sample-based synth renders every voice inside ONE worklet: the same score runs at 1.0x with ~400 voices.
 *
 * Decisions (18/10/2026):
 *  - the library is injected (`prepare({ WorkletSynthesizer, ... })`), so this file loads under Node and tests use a fake synth;
 *  - channels: one per pitched track (the percussion channel 9 of each port is skipped), ALL percussion tracks share channel 9, a pool of extra
 *    channels carries the notes that bend (a pitch wheel is per channel); beyond `maxChannels` tracks share channels;
 *  - a scheduled event of the synth cannot be withdrawn: look-ahead is short (0.12 s) and note-offs are only sent when due (`_offs`). When the
 *    playback is cut (seek, pause, loop change) every pending note-on is followed by a "sound off" at its own time, and the next start waits
 *    until the last of them (`_clearUntil`);
 *  - the sustain pedal (CC64 of the sequence) is sent as MIDI: the synth holds the notes itself; a seek resets every controller;
 *  - mixer: a muted track (or any track when another one is soloed) is simply not scheduled, its volume is CC7; percussion tracks share a channel,
 *    so their volumes are not separate.
 */
import { createEq } from './eq.js';
import { WebAudioEngine, createLeslieStage } from './webaudio.js';
import { LESLIE_MODES } from './leslie.js';
import { programOfTrack, techniqueProgram, modeProgram } from './programs.js';
import { BEND_RANGE, BEND_STEP, wheel, curveAt } from './midi.js';
import { curveAt as laneCurveAt } from './automation.js';
import { AUTOMATION_PARAMS } from '../model/automation.js';

const DRUM_CHANNEL = 9;
const WARM_INTERVAL_MS = 60; const WARM_PER_TICK = 2; const WARM_PER_TICK_PRIORITY = 8; const WARM_SETTLE_MS = 600; const WARM_RESTORE_MS = 1000; const WARM_MAX = 1500; // the background pass of `warm`
const DEFAULT_PERCUSSION_KEY = 37; // a percussion note without a MIDI number
const WHEEL_CENTRE = 8192;

/**
 * Channel plan of a sequence: { channelOf: Map(trackId → channel), bendPool: [channels], total }. `total` is a multiple of 16 (channels are added by ports).
 * Pitched tracks take the channels in order, skipping the percussion channel of every port (those in `processed`, a Set of track ids, first); percussion tracks use channel 9.
 */
export function planChannels(tracks, { maxChannels = 192, bendChannels = 16, processed = null } = {}) {
  const channelOf = new Map();
  const pitched = [];
  for (const t of tracks) { if (t.kind === 'percussion') channelOf.set(t.id, DRUM_CHANNEL); else pitched.push(t); }
  // the tracks that have a sound processor (compressor…) come first: they need an output of their own, and only the 16 first channels have one (see `_syncFx`)
  if (processed?.size) pitched.sort((a, b) => (processed.has(b.id) ? 1 : 0) - (processed.has(a.id) ? 1 : 0));
  const free = [];
  for (let c = 0; free.length < maxChannels && c < maxChannels + 16; c++) if (c % 16 !== DRUM_CHANNEL) free.push(c);
  // keep room for the bend pool when the tracks fit; otherwise tracks share the channels (wrap-around)
  const roomForTracks = Math.max(1, free.length - (pitched.length < free.length ? Math.min(bendChannels, free.length - pitched.length) : 0));
  pitched.forEach((t, i) => channelOf.set(t.id, free[i % roomForTracks]));
  const used = Math.min(pitched.length, roomForTracks);
  const bendPool = free.slice(used, used + bendChannels);
  const top = Math.max(DRUM_CHANNEL, ...channelOf.values(), ...bendPool);
  return { channelOf, bendPool, total: Math.ceil((top + 1) / 16) * 16 };
}

const AUTOMATION_STEP = 0.02; // seconds between two CC7 messages along a volume ramp

export class SoundFontEngine extends WebAudioEngine {
  constructor(options = {}) {
    super({ lookahead: 0.12, interval: 0.03, startLatency: 0.14, voiceCap: 400, maxChannels: 192, bendChannels: 16, ...options });
    this._synth = null;
    this._plan = null;
    this._programOf = new Map(); // trackId → GM program
    this._msgs = []; // timed messages sorted by song time: { t, track, type: 'cc64', value } and { t, track, type: 'program', program } (technique texts)
    this._techs = new Map(); // trackId → [{ t, program }] sorted: the program a technique text switches the track to
    this._msgNext = 0;
    this._pending = []; // { time, ch, bend } events already queued in the synth for a time that has not come yet (note-ons, bends)
    this._offs = []; // { time, onTime, run } messages sent only when due, sorted by time
    this._clearUntil = 0;
    this._bendFree = [];
    this._bendBusy = new Map(); // channel → audio time when it can be reused
    this._pedalDown = new Set();
    this._warmQueue = []; // sounds the synth has not played yet: { drum, program, msb, lsb, key, velocity }, see `warm`
    this._warmSeen = new Set();
    this._warmTimer = null;
    this._warmDirty = new Set(); // synth channels whose volume `warm` set to 0: put back to 100 once the pass is over (a live note does not set it)
    this._warmRestoreTimer = null;
    this._warmSettleUntil = 0;
    this._fx = new Map(); // synth channel (0-15) → { comp, neg, track }: the compressor of the track on that channel, fed by the channel's own output (see `_syncFx`)
  }

  /** True once the synth and its sound bank are loaded. */
  get ready() { return Boolean(this._synth); }

  /**
   * Creates the context, the worklet and the synth, and loads the SoundFont. To call BEFORE playing (the context is created suspended;
   * `play()` resumes it inside the user gesture).
   * @param WorkletSynthesizer class of the library
   * @param font     ArrayBuffer of the .sf2 / .sf3 file
   * @param fonts    several files at once (their sounds add up): [{ data: ArrayBuffer, id?: string }]; used instead of `font`
   * @param processorUrl URL of the worklet module (a Blob URL for the single-file build), or a list of URLs to try in order
   */
  async prepare({ WorkletSynthesizer, font, fonts = null, processorUrl }) {
    const ctx = this._context();
    const add = (url) => (this.options.addModule ? this.options.addModule(ctx, url) : ctx.audioWorklet.addModule(url));
    let lastError = null; let loaded = false;
    for (const url of [].concat(processorUrl)) { try { await add(url); loaded = true; break; } catch (e) { lastError = e; } }
    if (!loaded) throw lastError ?? new Error('The synthesizer worklet could not be loaded');
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(this._master);
    this._trackSynthLag(synth, ctx);
    const banks = fonts ?? [{ data: font, id: 'main' }];
    for (let i = 0; i < banks.length; i++) await synth.soundBankManager.addSoundBank(banks[i].data, banks[i].id ?? (i === 0 ? 'main' : `bank${i}`));
    await synth.isReady;
    synth.setSystemParameter?.('voiceCap', this.options.voiceCap);
    await this._probeSynthLag(synth);
    this._synth = synth;
    if (this._sequence) this._setup(this._sequence);
    this._warmPump();
  }

  /**
   * Plays, SILENTLY and before the music asks for them, the sounds a sequence will use. A SoundFont in the SF3 form keeps its samples compressed and the synth
   * decompresses each one the FIRST time a note uses it, inside the audio thread (measured: 143 ms for the first piano note, 5 to 20 ms for the next sounds, 0.5 ms
   * once decoded; drums have a sample per velocity layer): the first playing of a piece stutters, the second does not. Here a muted channel plays each distinct
   * (sound, key, velocity) once, a couple at a time while nothing is playing, so the decoding is done by the time ▶ is pressed. Safe to call again (what was
   * warmed is not repeated) and before the synth is ready (it starts when it is). `priority`: the sounds of what the person is about to play (they go first, faster,
   * and `warmWaiting` counts them so that the page can show a spinner and hold ▶ for a moment).
   */
  warm(sequence, { priority = false } = {}) {
    const tracks = new Map((sequence?.tracks ?? []).map((t) => [t.id, t]));
    for (const n of sequence?.notes ?? []) {
      const track = tracks.get(n.track);
      if (!track) continue;
      const drum = track.kind === 'percussion';
      if (n.pitch == null && !drum) continue;
      const key = Math.min(127, Math.max(0, Math.round(drum ? (n.pitch ?? DEFAULT_PERCUSSION_KEY) : n.pitch)));
      const velocity = Math.min(127, Math.max(1, Math.round(n.velocity ?? 64)));
      const preset = this._preset(track);
      const modal = !drum && !preset && n.mode ? modeProgram(track, n.mode) : null;
      const program = drum ? 0 : modal ?? this._prog(track);
      const msb = drum ? 0 : preset?.bankMSB ?? 0; const lsb = drum ? 0 : preset?.bankLSB ?? 0;
      const id = `${drum ? 'd' : 'p'}|${msb}/${lsb}|${program}|${key}|${velocity}`;
      if (this._warmSeen.has(id)) { if (priority) { const waiting = this._warmQueue.find((w) => w.id === id); if (waiting) waiting.priority = true; } continue; } // already asked: it only moves up
      if (this._warmSeen.size >= WARM_MAX) continue;
      this._warmSeen.add(id);
      this._warmQueue.push({ id, drum, program, msb, lsb, key, velocity, priority });
    }
    this._warmQueue.sort((a, b) => (b.priority - a.priority) || (a.drum - b.drum) || (a.msb - b.msb) || (a.lsb - b.lsb) || (a.program - b.program));
    this._warmPump();
  }

  /** How many sounds asked with `priority` are still to be prepared (0 = nothing to wait for). */
  get warmWaiting() {
    const queued = this._warmQueue.reduce((n, w) => n + (w.priority ? 1 : 0), 0);
    return queued + (queued === 0 && (this.options.now?.() ?? Date.now()) < this._warmSettleUntil ? 1 : 0); // the last notes were SENT, the synth may still be decoding them: a moment more
  }

  /** Starts the background pass of `warm` (one tick every 60 ms, two sounds per tick, nothing while the music plays or an audition runs). */
  _warmPump() {
    if (this._warmTimer != null || !this._warmQueue.length || !this._synth) return;
    this._warmTimer = this._setTimer(() => this._warmTick(), WARM_INTERVAL_MS);
  }

  _warmTick() {
    const synth = this._synth;
    if (!synth || !this._warmQueue.length) { this._warmStop(); return; }
    if (this._playing || this._audition || this._liveKeys?.size) return; // the audio thread is busy with music, or a key is held: wait
    // two spare channels, taken from the END of the free pool (a live note uses the first one); before any plan, 14 and 15
    const [pch, dch] = this._plan ? [this._bendFree.pop(), this._bendFree.pop()] : [14, 15];
    try {
      if (pch == null) return;
      const batch = this._warmQueue.splice(0, this._warmQueue[0]?.priority ? WARM_PER_TICK_PRIORITY : WARM_PER_TICK);
      for (const w of batch) {
        const ch = w.drum ? dch ?? pch : pch;
        if (w.drum) synth.midiChannels?.[ch]?.setDrums?.(true);
        synth.controllerChange(ch, 7, 0);
        synth.controllerChange(ch, 0, w.msb); synth.controllerChange(ch, 32, w.lsb);
        synth.programChange(ch, w.program);
        synth.noteOn(ch, w.key, w.velocity); // the sample is decoded here
        synth.noteOff(ch, w.key);
        synth.controllerChange(ch, 120, 0); // sound off: a drum sample ignores the note-off and a piano rings on; the voice is cut at once, whatever the volume does next
        if (w.drum) synth.midiChannels?.[ch]?.setDrums?.(false);
        synth.controllerChange(ch, 0, 0); synth.controllerChange(ch, 32, 0);
        this._warmDirty.add(ch); // its volume stays at 0 until the pass is over
      }
      if (batch.some((w) => w.priority)) this._warmSettleUntil = (this.options.now?.() ?? Date.now()) + WARM_SETTLE_MS;
    } finally {
      if (this._plan) for (const c of [dch, pch]) if (c != null) this._bendFree.push(c);
    }
    if (!this._warmQueue.length) { this._warmStop(); this._warmRestoreLater(); }
  }

  /** A second after the last sound: the volume of the channels `warm` muted goes back to 100 (those a note has taken meanwhile are left alone). */
  _warmRestoreLater() {
    const later = this.options.later ?? ((fn, ms) => setTimeout(fn, ms));
    clearTimeout(this._warmRestoreTimer);
    this._warmRestoreTimer = later(() => {
      this._warmRestoreTimer = null;
      const synth = this._synth;
      if (!synth || this._warmQueue.length) return;
      for (const ch of this._warmDirty) if (!this._plan || this._bendFree.includes(ch)) synth.controllerChange(ch, 7, 100);
      this._warmDirty.clear();
    }, WARM_RESTORE_MS);
    this._warmRestoreTimer?.unref?.();
  }

  _warmStop() { if (this._warmTimer != null) { this._clearTimer(this._warmTimer); this._warmTimer = null; } }

  /**
   * The synthesizer keeps its OWN clock (it counts the samples it renders, starting when its processor is first called, after its start-up work), so it can
   * run some tens of milliseconds BEHIND the audio context: an event dated `t` (context time) is then released `lag` seconds late. Every message the
   * processor posts back carries its clock; the smallest gap seen lately (`context time − processor time`, the message trip included) is the lag, and the
   * dates of the timed calls are moved back by it so a note sounds when the engine asked. Measured: 65 to 85 ms late without this.
   */
  _trackSynthLag(synth, ctx) {
    this._synthLag = 0; this._lagSamples = [];
    const port = synth.worklet?.port;
    if (typeof port?.addEventListener === 'function') {
      port.addEventListener('message', (ev) => {
        const ct = ev?.data?.currentTime;
        if (!Number.isFinite(ct)) return;
        const gap = ctx.currentTime - ct;
        this._lagSamples.push(gap);
        if (this._lagSamples.length > 16) this._lagSamples.shift();
        this._synthLag = Math.min(0.5, Math.max(0, Math.min(...this._lagSamples)));
      });
      port.start?.();
      this._lagListening = true;
    }
    for (const name of ['noteOn', 'noteOff', 'controllerChange', 'pitchWheel', 'programChange']) {
      const original = synth[name]?.bind(synth);
      if (!original) continue;
      synth[name] = (...args) => {
        const o = args[args.length - 1];
        if (this._synthLag > 0 && o && typeof o === 'object' && Number.isFinite(o.time)) args[args.length - 1] = { ...o, time: o.time - this._synthLag };
        return original(...args);
      };
    }
  }

  /** Makes the processor talk once (an unused controller on a spare channel) so the lag is known before the first note; waits a moment at most. */
  async _probeSynthLag(synth) {
    if (!this._lagListening) return;
    try { synth.controllerChange(15, 119, 0); } catch { return; }
    for (let i = 0; i < 20 && !this._lagSamples.length; i++) await new Promise((r) => setTimeout(r, 10));
  }

  /** The reported output latency plus the synthesizer's own lag (already compensated in the dates of the notes). */
  latencyInfo() {
    const info = super.latencyInfo();
    return info ? { ...info, synthLagMs: Math.round((this._synthLag ?? 0) * 1000) } : info;
  }

  /** Frees the synth. */
  dispose() {
    this._warmStop(); this._warmQueue = []; clearTimeout(this._warmRestoreTimer);
    this._stopTimer();
    this._playing = false;
    try { this._synth?.destroy?.(); } catch { /* already gone */ }
    this._synth = null;
    for (const e of this._fx.values()) { try { e.tail.disconnect(); e.neg.disconnect(); e.leslie?.dispose(); } catch { /* already gone */ } }
    this._fx.clear();
  }

  // -- contract ---------------------------------------------------------------------------------------------------------------------------

  load(sequence, options) {
    this._pending = []; this._offs = [];
    super.load(sequence, options);
    this._buildMessages(sequence);
    this._msgNext = this._lowerMsg(this._pos);
    if (this._synth) this._setup(sequence);
  }

  /** CC64 (pedal) and technique-text messages of the sequence, as one list sorted by song time. */
  _buildMessages(sequence) {
    const byId = new Map(sequence.tracks.map((t) => [t.id, t]));
    const msgs = [];
    this._techs = new Map();
    for (const m of sequence.messages ?? []) {
      if (m.t == null) continue;
      // a Leslie sign: a rotor state change of the track's stage. BEFORE the technique guard below: it works on a track with its own preset too, and is no program switch
      if (m.kind === 'leslie') {
        if (byId.has(m.track) && LESLIE_MODES.includes(m.data?.mode)) msgs.push({ t: m.t, track: m.track, type: 'leslie', mode: m.data.mode });
        continue;
      }
      if (m.kind === 'controller' && m.data?.number === 64) msgs.push({ t: m.t, track: m.track, type: 'cc64', value: (m.data.value ?? 0) >= 64 ? 127 : 0 });
      else if (m.kind === 'technique' && m.data?.technique) {
        const track = byId.get(m.track);
        if (!track || track.kind === 'percussion' || this._preset(track)) continue; // a track given its own instrument keeps it: technique texts do not switch sounds
        const program = techniqueProgram(track, m.data.technique);
        if (program == null) continue;
        msgs.push({ t: m.t, track: m.track, type: 'program', program });
        const list = this._techs.get(m.track) ?? [];
        list.push({ t: m.t, program });
        this._techs.set(m.track, list);
      }
    }
    // mixer automation: CC7 of each pitched track along its gain curve (a ramp is sampled every 20 ms); percussion tracks share a channel and use the velocity
    for (const [id, curve] of this._curves) {
      const track = byId.get(id);
      if (!track || track.kind === 'percussion') continue;
      for (const p of curve) {
        msgs.push({ t: p.t, track: id, type: 'cc7', value: this._ccOf(p.v) });
        if (p.to) for (let t = p.t + AUTOMATION_STEP; t < p.to.t - 1e-9; t += AUTOMATION_STEP) msgs.push({ t, track: id, type: 'cc7', value: this._ccOf(p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t))) });
      }
    }
    // pan automation: CC10 of each pitched track along its pan curve (same sampling); percussion tracks share a channel (the whole kit moves together: the channel is left alone)
    for (const [id, curve] of this._panCurves) {
      const track = byId.get(id);
      if (!track || track.kind === 'percussion') continue;
      for (const p of curve) {
        msgs.push({ t: p.t, track: id, type: 'cc10', value: this._panCc(p.v) });
        if (p.to) for (let t = p.t + AUTOMATION_STEP; t < p.to.t - 1e-9; t += AUTOMATION_STEP) msgs.push({ t, track: id, type: 'cc10', value: this._panCc(p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t))) });
      }
    }
    // controller lanes (expression CC11, reverb CC91, chorus CC93, brightness CC74, modulation CC1): dated messages along each curve, like the volume
    for (const [id, per] of this._ccCurves) {
      const track = byId.get(id);
      if (!track || track.kind === 'percussion') continue;
      for (const [param, curve] of per) {
        const cc = AUTOMATION_PARAMS[param].cc;
        for (const p of curve) {
          msgs.push({ t: p.t, track: id, type: 'ccn', cc, value: this._laneCc(p.v) });
          if (p.to) for (let t = p.t + AUTOMATION_STEP; t < p.to.t - 1e-9; t += AUTOMATION_STEP) msgs.push({ t, track: id, type: 'ccn', cc, value: this._laneCc(p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t))) });
        }
      }
    }
    this._msgs = msgs.sort((a, b) => a.t - b.t);
    for (const list of this._techs.values()) list.sort((a, b) => a.t - b.t);
  }

  /** The program a track plays with at song time `t` (its normal program, or the one of the last technique text before). */
  _programAt(trackId, t) {
    const list = this._techs.get(trackId);
    let program = this._programOf.get(trackId) ?? 0;
    if (list) for (const e of list) { if (e.t <= t + 1e-9) program = e.program; else break; }
    return program;
  }

  stop() { super.stop(); this._setNext(0); }

  setMixer(mixer) {
    const before = JSON.stringify((this._sequence?.tracks ?? []).map((t) => this._preset(t)));
    super.setMixer(mixer);
    if (!this._synth || !this._plan) return;
    // a track that asks for a compressor but sits on a channel without an output of its own: when the engine is stopped the plan is made again (it gives it a first channel)
    if (!this._playing && this._sequence && this._sequence.tracks.some((t) => (this._compressorOf(t) || this._eqOf(t) || this._leslieWanted(t)) && (this._plan.channelOf.get(t.id) ?? 0) >= 16)) this._setup(this._sequence);
    else this._syncFx();
    if (this._sequence && JSON.stringify(this._sequence.tracks.map((t) => this._preset(t))) !== before) { // a track was given another instrument: switch it now
      this._anyPreset = this._anyPreset || this._sequence.tracks.some((t) => this._preset(t));
      this._buildMessages(this._sequence);
      this._msgNext = this._lowerMsg(this._playing ? this.position() : this._pos);
      for (const t of this._sequence.tracks) {
        const ch = this._plan.channelOf.get(t.id);
        if (ch == null || t.kind === 'percussion') continue;
        this._programOf.set(t.id, this._prog(t));
        this._bank(ch, t);
        this._synth.programChange(ch, this._prog(t));
      }
      this._resetPrograms(this._playing ? this.position() : this._pos);
    }
    if ((this._curves.size || this._panCurves.size || this._ccCurves.size) && this._sequence) { // the automation depends on the mixer (fader, master, mute, solo): rebuild its messages from the current position
      this._buildMessages(this._sequence);
      const pos = this._playing ? this.position() : this._pos;
      this._msgNext = this._lowerMsg(pos);
      this._resetVolumes(pos);
    }
    for (const t of this._sequence?.tracks ?? []) {
      const ch = this._plan.channelOf.get(t.id);
      if (ch == null) continue;
      if (t.kind !== 'percussion' && !this._curves.has(t.id)) this._synth.controllerChange(ch, 7, this._volumeOf(t.id));
      if (t.kind !== 'percussion' && !this._panCurves.has(t.id)) this._synth.controllerChange(ch, 10, this._panOf(t.id));
      if (!this._audible(t.id)) this._soundOff(ch);
    }
  }

  sendMessage(message) {
    if (!this._synth) return;
    if (message?.kind === 'controller' && (message.data?.number === 123 || message.data?.number === 120)) {
      const tracks = message.track == null ? this._sequence?.tracks ?? [] : [{ id: message.track }];
      for (const t of tracks) { const ch = this._plan?.channelOf.get(t.id); if (ch != null) this._soundOff(ch); }
    }
  }

  allNotesOff() {
    if (!this._synth) return;
    this._synth.stopAll(true);
    this._cancelPending({ everything: true });
    // a note-on posted just before the cut can reach the synth after the stop (the messages go through the audio thread's port): cut again shortly after,
    // while nothing plays (a restart cancels this: the timers only act when the engine is still not playing)
    for (const ms of [40, 120, 300]) setTimeout(() => { if (!this._playing && this._synth) this._synth.stopAll(true); }, ms);
  }

  // -- scheduler hooks --------------------------------------------------------------------------------------------------------------------

  _setNext(pos) {
    super._setNext(pos);
    this._msgNext = this._lowerMsg(pos);
    this._resetPrograms(pos);
    this._resetVolumes(pos);
    this._resetLeslie(pos);
    // the pedal state of the previous lap / position is unknown: release it (at the start of the new lap when it is still ahead)
    if (this._synth && this._ctx && this._pedalDown.size) {
      const at = Math.max(this._startCtx, this._ctx.currentTime);
      for (const ch of this._pedalDown) this._synth.controllerChange(ch, 64, 0, { time: at });
      this._pedalDown.clear();
    }
  }

  /** After a repositioning: every track with technique texts gets the program in effect at `pos` (after the queued events of the cut, or at the new lap). */
  _resetPrograms(pos) {
    if (!this._synth || !this._plan || !this._ctx || !this._techs.size) return;
    const at = Math.max(this._clearUntil, this._ctx.currentTime, this._playing ? this._startCtx - 0.001 : 0);
    for (const trackId of this._techs.keys()) {
      const ch = this._plan.channelOf.get(trackId);
      if (ch != null) this._synth.programChange(ch, this._programAt(trackId, pos), { time: at });
    }
  }

  /** After a repositioning (seek, loop, start in the middle): every Leslie stage gets the rotor state in effect at `pos` (last sign before it, else the mode of its setting). */
  _resetLeslie(pos) {
    for (const entry of this._fx.values()) this._assertLeslieFx(entry, pos);
  }

  /** Sends again the rotor signs of a track between `pos` and what the look-ahead already dispatched (a setting change just cancelled them). */
  _replayLeslie(entry, pos) {
    for (let i = this._lowerMsg(pos); i < this._msgNext; i++) {
      const m = this._msgs[i];
      if (m.type === 'leslie' && m.track === entry.track && m.t >= pos) entry.leslie.set(m.mode, entry.leslieSetting, { at: Math.max(this._ctxTime(m.t), this._ctx.currentTime) });
    }
  }

  _assertLeslieFx(entry, pos) {
    if (!entry.leslie || !this._ctx) return;
    const at = Math.max(this._clearUntil, this._ctx.currentTime, this._playing ? this._startCtx - 0.001 : 0);
    entry.leslie.set(this._leslieModeAt(entry.track, entry.leslieSetting, pos), entry.leslieSetting, { at, reassert: true });
  }

  /** A controller lane value 0..1 → 0 … 127. */
  _laneCc(v) { return Math.min(127, Math.max(0, Math.round(127 * v))); }

  /** The controller lanes (expression, reverb…) of a track at song time `pos`, as [cc, value] pairs. */
  _laneCcsAt(trackId, pos) {
    const out = [];
    for (const [param, curve] of this._ccCurves.get(trackId) ?? []) out.push([AUTOMATION_PARAMS[param].cc, this._laneCc(laneCurveAt(curve, pos, AUTOMATION_PARAMS[param].rest))]);
    return out;
  }

  /** CC10 for a pan −1 … +1: 0 = hard left, 64 = centre, 127 = hard right. */
  _panCc(p) { return Math.min(127, Math.max(0, Math.round(63.5 + 63.5 * Math.min(1, Math.max(-1, p))))); }

  /** The CC10 a track has at rest: its own pan (the pan lane, if any, sends its own messages). */
  _panOf(trackId) { return this._panCc(this._mixer[trackId]?.pan ?? 0); }

  /** CC7 for an amplitude gain: 127·√gain (the SoundFont law is squared, see `_volumeOf`). */
  _ccOf(g) { return Math.min(127, Math.max(0, Math.round(127 * Math.sqrt(Math.min(1, Math.max(0, g)))))); }

  // the automation is sent as dated CC7 messages (see `_buildMessages`), not on gain nodes
  _seekAutomation() {}
  _seekAllAutomation(pos) { this._seekMaster(pos); } // the volume and pan are CC messages here; the master volume lane works on the master gain node, as in the light engine

  /** After a repositioning: every automated pitched track gets the CC7 in force at `pos`. */
  _resetVolumes(pos) {
    if (!this._synth || !this._plan || !this._ctx || !(this._curves.size || this._panCurves.size || this._ccCurves.size)) return;
    const at = Math.max(this._clearUntil, this._ctx.currentTime, this._playing ? this._startCtx - 0.001 : 0);
    for (const id of this._curves.keys()) {
      const ch = this._plan.channelOf.get(id);
      if (ch != null && this._tracks.get(id)?.kind !== 'percussion') this._synth.controllerChange(ch, 7, this._ccOf(this._gainAt(id, pos)), { time: at });
    }
    for (const id of this._panCurves.keys()) {
      const ch = this._plan.channelOf.get(id);
      if (ch != null && this._tracks.get(id)?.kind !== 'percussion') this._synth.controllerChange(ch, 10, this._panCc(this._panAt(id, pos)), { time: at });
    }
    for (const id of this._ccCurves.keys()) {
      const ch = this._plan.channelOf.get(id);
      if (ch != null && this._tracks.get(id)?.kind !== 'percussion') for (const [cc, value] of this._laneCcsAt(id, pos)) this._synth.controllerChange(ch, cc, value, { time: at });
    }
  }

  _lowerMsg(pos) {
    let lo = 0; let hi = this._msgs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this._msgs[mid].t < pos - 1e-9) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Start of a (re)start: never before the "sound off" events of the last cut. */
  _anchor(position, ctx) {
    this._setAnchor(position, Math.max(ctx.currentTime + this.options.startLatency, this._clearUntil));
    this._setNext(position);
  }

  /** The loop changes while playing: cancel what is queued ahead, keep what sounds, restart from the current position once the cancel has played. */
  _reschedule() {
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const pos = this.position();
    this._cancelPending({ everything: false });
    const at = Math.max(now + 0.01, this._clearUntil);
    const shifted = pos + (at - now);
    this._setAnchor(shifted, at);
    this._setNext(shifted);
    this._tick();
  }

  _flushMessages(stop) {
    if (!this._synth) return;
    while (this._msgNext < this._msgs.length && this._msgs[this._msgNext].t < stop) {
      const m = this._msgs[this._msgNext++];
      const ch = this._plan?.channelOf.get(m.track);
      if (ch == null) continue;
      if (m.type === 'leslie') {
        const entry = this._fx.get(ch);
        if (entry?.leslie && entry.track === m.track) entry.leslie.set(m.mode, entry.leslieSetting, { at: Math.max(this._ctxTime(m.t), this._ctx.currentTime) });
        continue;
      }
      if (m.type === 'ccn') {
        this._synth.controllerChange(ch, m.cc, m.value, { time: Math.max(this._ctxTime(m.t), this._ctx.currentTime) });
        continue;
      }
      if (m.type === 'cc10') {
        this._synth.controllerChange(ch, 10, m.value, { time: Math.max(this._ctxTime(m.t), this._ctx.currentTime) });
        continue;
      }
      if (m.type === 'cc7') {
        this._synth.controllerChange(ch, 7, m.value, { time: Math.max(this._ctxTime(m.t), this._ctx.currentTime) });
        continue;
      }
      if (m.type === 'program') {
        // one millisecond early, so a note at the same instant already has the new sound
        const time = Math.max(this._ctxTime(m.t) - 0.001, this._ctx.currentTime);
        this._synth.programChange(ch, m.program, { time });
        this._pending.push({ time, ch, program: true });
        continue;
      }
      if (m.value) this._pedalDown.add(ch); else this._pedalDown.delete(ch);
      this._synth.controllerChange(ch, 64, m.value, { time: Math.max(this._ctxTime(m.t), this._ctx.currentTime) });
    }
  }

  _afterTick(horizonCtx) {
    const synth = this._synth;
    if (!synth) return;
    const now = this._ctx.currentTime;
    this._pending = this._pending.filter((p) => p.time > now);
    while (this._offs.length && this._offs[0].time <= horizonCtx) this._offs.shift().run();
    for (const [ch, free] of this._bendBusy) if (free <= now) { this._bendBusy.delete(ch); this._bendFree.push(ch); }
  }

  _pruneVoices() {}

  // -- voices -----------------------------------------------------------------------------------------------------------------------------

  _startVoice(note) {
    const synth = this._synth;
    if (!synth || !this._plan) return;
    const track = this._tracks.get(note.track);
    if (!track) return;
    this._pulse(note.track, this._audible(note.track));
    if (!this._audible(note.track)) return;
    const percussion = track.kind === 'percussion';
    if (note.pitch == null && !percussion) return;
    const key = Math.min(127, Math.max(0, Math.round(percussion ? (note.pitch ?? DEFAULT_PERCUSSION_KEY) : note.pitch)));
    // percussion tracks share one channel (no CC7 per track): their volume scales the velocity
    const velocity = Math.min(127, Math.max(1, Math.round((note.velocity ?? 64) * (percussion ? Math.sqrt(Math.min(1, this._curves.has(note.track) ? this._gainAt(note.track, note.t) : this._mixer[note.track]?.volume ?? 1)) : 1))));
    const when = Math.max(this._ctxTime(note.t), this._ctx.currentTime);
    const length = Math.max(0.02, note.duration ?? 0.1);
    const off = when + length;
    let ch = this._plan.channelOf.get(note.track) ?? 0;
    let bend = false;
    // a note with its own sound (slap, pop, muted, harmonics of an instrument that has that channel) or a pitch curve needs a channel of its own: a program
    // and a pitch wheel belong to the channel, not to the note
    const modal = !percussion && !this._preset(track) && note.mode ? modeProgram(track, note.mode) : null;
    const ownSound = modal !== null && modal !== this._programAt(note.track, note.t);
    const curved = !percussion && note.pitchCurve?.length > 0;
    if ((curved || ownSound) && this._bendFree.length) {
      bend = curved;
      ch = this._bendFree.shift();
      this._bendBusy.set(ch, off + 1.5);
      this._bank(ch, track, when);
      synth.programChange(ch, ownSound ? modal : this._programAt(note.track, note.t), { time: when });
      synth.controllerChange(ch, 7, this._curves.has(note.track) ? this._ccOf(this._gainAt(note.track, note.t)) : this._volumeOf(note.track), { time: when });
      synth.controllerChange(ch, 10, this._panCurves.has(note.track) ? this._panCc(this._panAt(note.track, note.t)) : this._panOf(note.track), { time: when });
      for (const [cc, value] of this._laneCcsAt(note.track, note.t)) synth.controllerChange(ch, cc, value, { time: when }); // a channel of its own: it needs the controller lanes too
      if (curved) synth.pitchWheel(ch, wheel(note.pitchCurve[0].semitones), { time: when });
      this._pending.push({ time: when, ch, bend });
      if (curved) {
        const times = new Set(note.pitchCurve.map((p) => p.t).filter((t) => t > note.t && t < note.t + note.duration));
        for (let t = note.t + BEND_STEP; t < note.t + note.duration; t += BEND_STEP) times.add(t);
        let last = wheel(note.pitchCurve[0].semitones);
        for (const t of [...times].sort((a, b) => a - b)) {
          const v = wheel(curveAt(note.pitchCurve, t));
          if (v === last) continue;
          last = v;
          const at = Math.max(this._ctxTime(t), when);
          this._queueOff({ time: at - this.options.lookahead, onTime: when, run: () => synth.pitchWheel(ch, v, { time: at }) });
        }
        this._queueOff({ time: off, onTime: when, run: () => synth.pitchWheel(ch, WHEEL_CENTRE, { time: off + 0.5 }) });
      }
    }
    synth.noteOn(ch, key, velocity, { time: when });
    this._pending.push({ time: when, ch, bend });
    this._queueOff({ time: off, onTime: when, run: () => synth.noteOff(ch, key, { time: off }) });
  }

  /**
   * Hears the notes of `sequence` right now (see `WebAudioEngine.audition`): a free channel of the bend pool (or channel 0) for each pitched track (so a band keeps one sound per track, as far as the
   * pool allows), the percussion channel for drums. `sequence.timed` = the notes keep their `t` (a small piece, not a chord): they are then sent a moment before they sound, never all at once in
   * advance (an event already queued in the synth cannot be withdrawn, so the piece could not be stopped), and `stopAudition()` cuts it.
   */
  audition(sequence) {
    const synth = this._synth;
    if (!synth) return;
    this.stopAudition();
    const ctx = this.unlock();
    const now = ctx.currentTime + 0.03;
    const pool = this._plan?.bendPool?.length ? this._plan.bendPool : [0];
    for (const c of pool) synth.controllerChange(c, 120, 0); // the previous audition is cut
    const byId = new Map(sequence.tracks.map((t) => [t.id, t]));
    const channelOf = new Map();
    const items = []; // { time, run }: what is sent to the synth, when it is due
    for (const n of sequence.notes) {
      const track = byId.get(n.track) ?? { kind: 'pitched' };
      const percussion = track.kind === 'percussion';
      if (n.pitch == null && !percussion) continue;
      const key = Math.min(127, Math.max(0, Math.round(n.pitch ?? DEFAULT_PERCUSSION_KEY)));
      const velocity = Math.min(127, Math.max(1, Math.round(n.velocity ?? 64)));
      const length = Math.max(0.05, n.duration ?? 0.3);
      const at = now + (sequence.timed ? Math.max(0, n.t ?? 0) : 0);
      let ch = DRUM_CHANNEL;
      if (!percussion) {
        ch = channelOf.get(n.track);
        if (ch === undefined) {
          ch = pool[channelOf.size % pool.length]; channelOf.set(n.track, ch);
          this._bank(ch, track, now);
          synth.programChange(ch, this._prog(track), { time: now });
          synth.controllerChange(ch, 7, Math.min(127, Math.max(0, Math.round(127 * Math.sqrt(Math.min(1, Math.max(0, track.mixer?.volume ?? 1)))))), { time: now });
        }
      }
      items.push({ time: at, run: () => synth.noteOn(ch, key, velocity, { time: at }) }, { time: at + length, run: () => synth.noteOff(ch, key, { time: at + length }) });
    }
    items.sort((x, y) => x.time - y.time);
    this._audition = { items, channels: new Set([...channelOf.values(), DRUM_CHANNEL]), timer: null };
    const pump = () => {
      const run = this._audition;
      if (!run) return;
      const horizon = this._ctx.currentTime + 0.15;
      while (run.items.length && run.items[0].time <= horizon) run.items.shift().run();
      if (run.items.length) { run.timer = setTimeout(pump, 50); run.timer?.unref?.(); } else this._audition = null;
    };
    pump();
  }

  /** Cuts the piece being heard (`audition`), if any: what was not sent yet is forgotten, the notes that sound are cut. Never touches the transport's channels when no audition runs. */
  stopAudition() {
    super.stopAudition();
    const run = this._audition; this._audition = null;
    if (!run || !this._synth) return;
    clearTimeout(run.timer);
    for (const ch of run.channels) this._synth.controllerChange(ch, 120, 0);
  }

  /** A key held with the finger (see `WebAudioEngine.liveNoteOn`): note on now, note off when released, on a free channel of the bend pool. */
  liveNoteOn({ pitch, velocity = 90, track }) {
    const synth = this._synth;
    if (!synth) return;
    const ctx = this.unlock();
    const now = ctx.currentTime; // a key you hear is never delayed on purpose
    const ch = this._plan?.bendPool?.[0] ?? 0;
    const key = Math.min(127, Math.max(0, Math.round(pitch)));
    this._bank(ch, track, now);
    synth.programChange(ch, this._prog(track ?? { kind: 'pitched' }), { time: now });
    synth.noteOn(ch, key, Math.min(127, Math.max(1, Math.round(velocity))), { time: now });
    (this._liveKeys ??= new Map()).set(pitch, { ch, key });
  }

  liveNoteOff(pitch) {
    const held = this._liveKeys?.get(pitch);
    if (!held || !this._synth) return;
    this._liveKeys.delete(pitch);
    this._synth.noteOff(held.ch, held.key, { time: this.unlock().currentTime });
  }

  /** Keeps `_offs` sorted by the time at which each message becomes due. */
  _queueOff(entry) {
    const list = this._offs;
    let lo = 0; let hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].time <= entry.time) lo = mid + 1; else hi = mid; }
    list.splice(lo, 0, entry);
  }

  _audible(trackId) {
    const m = this._mixer[trackId] ?? { volume: 1, mute: false, solo: false };
    const anySolo = Object.values(this._mixer).some((x) => x?.solo);
    return !m.mute && (!anySolo || m.solo);
  }

  // The SoundFont law for CC7 is a squared curve (attenuation 40·log10(cc/127)): sending 127·sqrt(g) makes the AMPLITUDE gain g, like the light engine's gain node
  _volumeOf(trackId) { return Math.min(127, Math.max(0, Math.round(127 * Math.sqrt(Math.min(1, Math.max(0, this._mixer[trackId]?.volume ?? 1)))))); }

  /** Immediate "sound off" on a channel. */
  _soundOff(ch) { this._synth.controllerChange(ch, 120, 0); }

  /**
   * Cuts what is queued: each note-on that has not started is followed by a "sound off" at its own time (the synth cannot withdraw it) and the
   * pedal / wheel states are reset once the last of them has played (`_clearUntil`). `everything`: also forget the note-offs (stop, seek, pause).
   */
  _cancelPending({ everything }) {
    const synth = this._synth;
    const now = this._ctx?.currentTime ?? 0;
    let last = now;
    const touched = new Set(this._pedalDown);
    for (const p of this._pending) {
      if (p.time <= now) continue;
      if (p.program) { last = Math.max(last, p.time + 0.001); continue; } // a queued program change cannot be withdrawn: the reset waits for it
      synth.controllerChange(p.ch, 120, 0, { time: p.time + 0.0005 });
      if (p.bend) synth.pitchWheel(p.ch, WHEEL_CENTRE, { time: p.time + 0.001 });
      last = Math.max(last, p.time + 0.001);
      touched.add(p.ch);
    }
    this._pending = [];
    this._offs = everything ? [] : this._offs.filter((o) => o.onTime <= now);
    if (everything) {
      // sounding notes are gone (stopAll): reset the controllers of every channel in use, after the last cancelled event
      for (const ch of this._plan?.channelOf.values() ?? []) touched.add(ch);
      for (const ch of this._plan?.bendPool ?? []) touched.add(ch);
      const at = last + 0.001;
      for (const ch of touched) {
        synth.controllerChange(ch, 121, 0, { time: at });
        synth.pitchWheel(ch, WHEEL_CENTRE, { time: at });
      }
      this._pedalDown.clear();
      this._clearUntil = Math.max(this._clearUntil, at + 0.002);
      this._bendFree = [...(this._plan?.bendPool ?? [])];
      this._bendBusy.clear();
    } else this._clearUntil = Math.max(this._clearUntil, last + 0.002);
  }

  /** The SoundFont instrument a track was given in the mixer (`{ name, program, bankMSB, bankLSB }`), or null. */
  _preset(t) { const m = this._mixer?.[t?.id]; return m ? (m.preset ?? null) : (t?.mixer?.preset ?? null); }

  /** The program a track plays with: its chosen preset, else the one of its catalogue instrument / timbre. */
  _prog(t) { return this._preset(t)?.program ?? programOfTrack(t); }

  /** Bank select (CC0 / CC32) of a track's preset on a channel; once any track has a preset every channel gets its bank (so a pooled channel never keeps a stale one). */
  _bank(ch, t, time) {
    const p = this._preset(t);
    if (!p && !this._anyPreset) return;
    const o = time == null ? undefined : { time };
    this._synth.controllerChange(ch, 0, p?.bankMSB ?? 0, o);
    this._synth.controllerChange(ch, 32, p?.bankLSB ?? 0, o);
  }

  /** The presets of the loaded SoundFont: [{ name, program, bankMSB, bankLSB, drums }] (empty before it is ready), sorted by bank then program. */
  presets() {
    const list = this._synth?.presetList ?? [];
    return list.filter((p) => p && p.name).map((p) => ({ name: p.name, program: p.program, bankMSB: p.bankMSB ?? 0, bankLSB: p.bankLSB ?? 0, drums: Boolean(p.isGMGSDrum ?? p.isAnyDrums) }))
      .sort((a, b) => a.bankMSB - b.bankMSB || a.bankLSB - b.bankLSB || a.program - b.program);
  }

  /** Channels, programs, volumes and bend ranges for a loaded sequence. */
  _setup(sequence) {
    const synth = this._synth;
    const plan = planChannels(sequence.tracks, { ...this.options, processed: this._processedIds(sequence.tracks) });
    this._plan = plan;
    while ((synth.channelCount ?? 16) < plan.total) synth.addNewChannel();
    this._programOf = new Map();
    this._anyPreset = sequence.tracks.some((t) => this._preset(t));
    for (const t of sequence.tracks) {
      const ch = plan.channelOf.get(t.id);
      const program = this._prog(t);
      this._programOf.set(t.id, program);
      if (t.kind === 'percussion') continue;
      this._bank(ch, t);
      synth.programChange(ch, program);
      synth.controllerChange(ch, 7, this._volumeOf(t.id));
      synth.controllerChange(ch, 10, this._panOf(t.id));
    }
    this._resetPrograms(this._pos);
    this._resetVolumes(this._pos);
    for (const ch of plan.bendPool) synth.pitchWheelRange(ch, BEND_RANGE);
    this._bendFree = [...plan.bendPool];
    this._bendBusy.clear();
    this._syncFx();
  }

  /** The ids of the tracks that ask for a sound processor (compressor or equalizer). */
  _processedIds(tracks) { return new Set((tracks ?? []).filter((t) => this._compressorOf(t) || this._eqOf(t) || this._leslieWanted(t)).map((t) => t.id)); }

  /** Does a track need the Leslie stage (a setting is stored, or a sign of the score changes its rotor)? */
  _leslieWanted(t) { return this._needsLeslie(t.id, this._leslieOf(t)); }

  /** The compressor settings of a track: the mixer's, else the one its sequence entry carries (null = none or off). */
  _compressorOf(t) { return this._mixer?.[t.id]?.compressor ?? (this._mixer?.[t.id] ? null : t.mixer?.compressor ?? null); }

  /** The equalizer settings of a track (same rule). */
  _eqOf(t) { return this._mixer?.[t.id]?.eq ?? (this._mixer?.[t.id] ? null : t.mixer?.eq ?? null); }

  /** The light engine puts its compressor and equalizer in the path of its own voices; here the sound comes out of the synthesizer, so `_syncFx` does it. */
  _applyCompressor() {}

  /**
   * The equalizer and the compressor of the tracks, on the individual outputs of the synthesizer. SpessaSynth gives every channel (0-15) a DRY output next to the main mix (which
   * holds all the channels, with the reverb and the chorus). For each processed track: the output of its channel is subtracted from the main mix (a gain of -1) and added again
   * after the equalizer and the compressor, so the track alone is processed, the other tracks stay in the main mix untouched (however many there are), and the reverb stays
   * where it is. The compressor passes the signal through while it is off and the equalizer is out of the path then, so the two paths cancel exactly and nothing is heard. Only the
   * channels 0-15 have an output of their own: a processed track on a higher channel is not processed (`limit` event says which; the plan gives the processed tracks the first
   * channels, and is made again when the engine is stopped). All the percussion tracks share channel 9: the first of them that asks sets the processors.
   */
  _syncFx() {
    const synth = this._synth;
    if (!synth || !this._plan) return;
    // a synthesizer without individual outputs (the offline renderer of `prerender.js`: a virtual clock and no audio graph) has no processors, Leslie included
    if (typeof synth.connectChannel !== 'function') return;
    const tracks = this._sequence?.tracks ?? [];
    const wanted = new Map(); // channel → { track, comp, eq, leslie }
    const limited = [];
    for (const t of tracks) {
      const comp = this._compressorOf(t); const eq = this._eqOf(t);
      const leslie = this._leslieWanted(t) ? { setting: this._leslieOf(t) } : null;
      if (!comp && !eq && !leslie) continue;
      const ch = this._plan.channelOf.get(t.id);
      if (ch == null || ch >= 16) { limited.push(t.id); continue; }
      if (!wanted.has(ch)) wanted.set(ch, { track: t.id, comp, eq, leslie });
    }
    for (const [ch, w] of wanted) {
      const entry = this._fx.get(ch);
      if (entry) { this._tuneFx(ch, entry, w); continue; }
      this._loadFxModule().then((ok) => { if (this._synth === synth && !this._fx.has(ch)) this._createFx(ch, wanted.get(ch) ?? w, ok); }); // without the compressor module the equalizer still works
    }
    for (const [ch, entry] of this._fx) if (!wanted.has(ch)) this._tuneFx(ch, entry, { track: entry.track, comp: null, eq: null, leslie: null });
    this._emitFx({ type: 'limit', tracks: limited });
  }

  _createFx(ch, w, withCompressor = true) {
    const ctx = this._ctx; const synth = this._synth;
    const make = this.options.createWorkletNode ?? ((c, name, o) => new AudioWorkletNode(c, name, o));
    // the end of the chain: the compressor, or (no compressor module) a plain gain that lets the signal through
    const comp = withCompressor ? make(ctx, 'scorsaire-compressor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' }) : null;
    const tail = comp ?? ctx.createGain();
    const neg = ctx.createGain(); neg.gain.value = -1;
    synth.connectChannel(neg, ch);
    neg.connect(this._master); tail.connect(this._master);
    const entry = { comp, tail, neg, eq: null, eqOn: false, head: null, track: w.track, leslie: null, leslieOn: false, leslieSetting: null, leslieKey: '', down: null };
    if (comp) comp.port.onmessage = (e) => { if (typeof e.data === 'number') this._emitFx({ type: 'reduction', track: entry.track, db: e.data }); };
    this._fx.set(ch, entry);
    this._tuneFx(ch, entry, w);
  }

  /** Sets the processors of one channel and wires its chain: [equalizer] → [Leslie] → compressor, the head being the first of those that are on. */
  _tuneFx(ch, entry, { track, comp, eq, leslie }) {
    entry.track = track;
    if (eq && !entry.eq) entry.eq = createEq(this._ctx);
    entry.eq?.apply(eq ?? {});
    entry.eqOn = Boolean(eq);
    entry.comp?.port.postMessage(comp ?? { on: false });
    // the Leslie stage is built the first time a track needs it and stays out of the path while it does not
    const key = JSON.stringify(leslie?.setting ?? null);
    entry.leslieSetting = leslie?.setting ?? null;
    let fresh = false;
    if (leslie && !entry.leslie) {
      entry.leslie = createLeslieStage(this._ctx, this._leslieModeAt(track, entry.leslieSetting, this._playing ? this.position() : this._pos), entry.leslieSetting);
      fresh = true;
    }
    const leslieOn = Boolean(leslie);
    const down = `${entry.eqOn}|${leslieOn}`;
    if (entry.down !== down) { // the links between the stages follow what is on
      entry.down = down;
      try { entry.eq?.output.disconnect(); } catch { /* nothing was connected */ }
      try { entry.leslie?.output.disconnect(); } catch { /* idem */ }
      if (leslieOn) entry.leslie.output.connect(entry.tail);
      entry.eq?.output.connect(leslieOn ? entry.leslie.input : entry.tail);
    }
    entry.leslieOn = leslieOn;
    if (!leslieOn) entry.leslieKey = ''; // coming back later must re-assert the stage
    const head = entry.eqOn ? entry.eq.input : leslieOn ? entry.leslie.input : entry.tail;
    if (entry.head !== head) {
      if (entry.head) this._synth.disconnectChannel(entry.head, ch);
      this._synth.connectChannel(head, ch);
      entry.head = head;
    }
    if (leslieOn && (fresh || entry.leslieKey !== key)) {
      entry.leslieKey = key;
      const pos = this._playing ? this.position() : this._pos;
      this._assertLeslieFx(entry, pos);
      if (this._playing && !fresh) this._replayLeslie(entry, pos); // the re-assert cancelled the signs already scheduled ahead
    }
  }
}
