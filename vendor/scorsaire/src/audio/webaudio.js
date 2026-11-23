/*
 * Moteur V1 du contrat audio (`engine.js`) : la sous-fonte légère (`synth.js`) jouée par Web Audio. C'est le SEUL fichier de `src/audio` qui
 * connaisse `AudioContext` ; il le reçoit par injection (`context` ou `createContext`), ce qui permet de le tester sous Node avec un faux contexte.
 *
 * Fonctionnement : les notes de la séquence sont DATÉES en secondes (position de lecture). Un planificateur à anticipation (toutes les 50 ms,
 * 250 ms d'avance) convertit ces dates en dates de l'horloge audio et crée, pour chaque note, une « voix » (oscillateurs → filtre → enveloppe →
 * coupure rapide → gain de piste → maître). Une voix a DEUX gains : l'enveloppe (rampes planifiées d'avance, jamais annulées) et une coupure
 * rapide (pour `allNotesOff`, le déplacement, l'arrêt de la pause) : annuler les rampes de l'enveloppe en plein vol ferait « claquer » le son.
 *
 * Décisions : polyphonie bornée (la plus ancienne voix est coupée en fondu de 20 ms) ; courbe de hauteur (`pitchCurve`) = rampes sur `detune`
 * en centièmes de demi-ton ; pédale (CC64 de la séquence) : les notes à timbre clavier ou cordes pincées sont TENUES jusqu'au relâchement de la
 * pédale de leur piste (intervalles précalculés au chargement) ; au déplacement la pédale est remise à zéro (une pédale commencée avant la
 * nouvelle position n'agit plus) ; boucle (`setLoop`) : le planificateur lui-même revient de la fin au début en prolongeant l'horloge audio
 * (la date de départ du tour suivant = la date exacte de la fin du tour : aucun trou, aucune latence de reprise, aucun `seek`), n'envoie aucune
 * note datée à la fin ou après, et ne coupe rien (les cymbales continuent de sonner par-dessus le tour suivant : choix de Jean, 11/10/2026) ;
 * messages en direct : seul le contrôleur 123 / 120 (tout couper, piste visée si `track`) est compris.
 */
import { createEq } from './eq.js';
import { leslieTarget, leslieSettings, leslieRampSeconds, leslieBaseGain, leslieLfoGain, leslieTimeline, leslieModeAt, leslieTracks, LESLIE_MODES } from './leslie.js';
import { compileGain, compilePan, compileLane, curveAt } from './automation.js';
import { AUTOMATION_PARAMS } from '../model/automation.js';
import { voicePlan, envelopePoints, timbreOf } from './synth.js';

const DEFAULTS = { lookahead: 0.25, interval: 0.05, maxVoices: 48, liteTracks: 24, startLatency: 0.05, masterGain: 0.9, noiseSeconds: 1 };
const PEDAL_TIMBRES = new Set(['keyboard', 'plucked']);
const MAX_PEDAL_HOLD = 20; // secondes : une pédale jamais relevée ne tient pas une note indéfiniment
const FAST_FADE = 0.02;

/** Un AudioContext est-il disponible dans cet environnement ? */
export function webAudioAvailable(globals = globalThis) { return Boolean(globals.AudioContext ?? globals.webkitAudioContext); }

const LATENCY_KEY = 'scorsaire.audioLatency';
/** 'standard' = the browser's own choice for interactive audio; 'minimal' = the smallest buffer the device accepts (may crackle on a weak machine). */
export const LATENCY_MODES = Object.freeze(['standard', 'minimal']);
let latencyModeValue = null;

/** The latency mode kept on this device (read once, then remembered in memory). */
export function latencyMode(globals = globalThis) {
  if (latencyModeValue) return latencyModeValue;
  let v = 'standard';
  try { const raw = globals.localStorage?.getItem(LATENCY_KEY); if (LATENCY_MODES.includes(raw)) v = raw; } catch { /* storage may be blocked */ }
  return (latencyModeValue = v);
}

/** Chooses the latency mode for the contexts created from now on (a running context keeps the one it was made with). */
export function setLatencyMode(mode, globals = globalThis) {
  if (!LATENCY_MODES.includes(mode)) return latencyMode(globals);
  latencyModeValue = mode;
  try { globals.localStorage?.setItem(LATENCY_KEY, mode); } catch { /* storage may be blocked */ }
  return mode;
}

/** A new AudioContext made with the chosen latency mode; a browser that refuses the option gets a plain one. */
export function createLatencyContext(globals = globalThis) {
  const C = globals.AudioContext ?? globals.webkitAudioContext;
  if (!C) throw new Error('Web Audio indisponible dans cet environnement');
  try { return new C({ latencyHint: latencyMode(globals) === 'minimal' ? 0 : 'interactive' }); } catch { return new C(); }
}

function defaultCreateContext(globals = globalThis) { return createLatencyContext(globals); }

/**
 * iPad / iPhone : sans réglage, Web Audio est coupé par l'interrupteur de silence. `navigator.audioSession.type = 'playback'` (WebKit) le lève ;
 * à appeler dans le geste utilisateur qui lance la lecture. Sans effet (et sans erreur) ailleurs.
 */
export function prepareAudioSession(globals = globalThis) {
  try {
    const session = globals.navigator?.audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
    return Boolean(session);
  } catch { return false; }
}

function lowerBound(sorted, t) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t < t - 1e-9) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The Leslie stage of a track (see leslie.js): a gain node `trem` (its base gain is 1 - depth/2) whose gain parameter is also driven by a sine oscillator (frequency = rate) through
 * a gain of depth/2. `input` and `output` are the same node, so the stage is one node in a chain. Shared by the light engine (in the voice path of the track) and the SoundFont
 * engine (on the output of the channel).
 * `set(mode, setting, { at, reassert })`: the rate and depth glide to the target of the mode (`setTargetAtTime`, time constant `leslieRampSeconds` from the previous mode); with `reassert`
 * (a seek, a loop, a start in the middle: the state is known, not reached) everything scheduled from `at` on is cancelled and the values are set at once at `at`.
 */
export function createLeslieStage(ctx, mode = 'chorale', setting = null) {
  const target = leslieTarget(mode, setting);
  const trem = ctx.createGain();
  trem.gain.value = leslieBaseGain(target.depth);
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = leslieLfoGain(target.depth);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = target.rate;
  lfo.connect(lfoGain);
  lfoGain.connect(trem.gain);
  lfo.start(0);
  const stage = {
    input: trem,
    output: trem,
    trem,
    lfo,
    lfoGain,
    mode,
    set(next, cfg, { at = ctx.currentTime, reassert = false } = {}) {
      const to = leslieTarget(next, cfg);
      const params = [[trem.gain, leslieBaseGain(to.depth)], [lfoGain.gain, leslieLfoGain(to.depth)], [lfo.frequency, to.rate]];
      if (reassert) {
        for (const [param, v] of params) { param.cancelScheduledValues?.(at); param.setValueAtTime(v, at); }
      } else {
        const tc = leslieRampSeconds(stage.mode, next, leslieSettings(cfg).speed);
        for (const [param, v] of params) param.setTargetAtTime(v, at, tc);
      }
      stage.mode = next;
    },
    dispose() { try { lfo.stop(0); } catch { /* never started or already stopped */ } try { lfo.disconnect(); lfoGain.disconnect(); trem.disconnect(); } catch { /* already gone */ } },
  };
  return stage;
}

export class WebAudioEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this._ctx = options.context ?? null;
    this._createContext = options.createContext ?? (() => defaultCreateContext(options.globals ?? globalThis));
    this._globals = options.globals ?? globalThis;
    this._setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this._clearTimer = options.clearTimer ?? ((h) => clearInterval(h));
    this._sequence = null;
    this._notes = [];
    this._tracks = new Map();
    this._pedals = new Map();
    this._mixer = {};
    this._activity = new Set(); // listeners of the note activity (the LEDs of the mixer): fn(trackId, played)
    this._trackGains = new Map();
    this._voices = [];
    this._tempo = null;
    this._pos = 0;
    this._playing = false;
    this._startPos = 0;
    this._startCtx = 0;
    this._anchors = []; // points { ctx, pos } de l'horloge audio (un par tour de boucle déjà planifié) : sert à `position()`
    this._loop = null;
    this._pedalFloor = 0;
    this._next = 0;
    this._timer = null;
    this._noise = null;
    this._master = null;
    this._lanes = new Map(); // track id → { volume?: steps, mute?: steps } (mixer automation of the loaded sequence, see automation.js)
    this._curves = new Map(); // track id → compiled gain curve
    this._autoNext = new Map(); // track id → index of the next curve point to schedule
    this._trackPans = new Map(); // track id → its stereo panner (between the track gain and the master)
    this._trackFx = new Map(); // track id → { eq, eqOn, comp }: its equalizer (native filters) and compressor (an AudioWorklet) between the panner and the master, built when the track first asks for them
    this._fxModule = null; // promise: the compressor worklet is loaded in the context (true) or cannot be (false)
    this._panCurves = new Map(); // track id → compiled pan curve (−1 … +1)
    this._panNext = new Map(); // track id → index of the next pan point to schedule
    this._masterCurve = []; // the master volume lane compiled into a multiplier of the master gain: [{ t, v, to? }] (1 = the master fader as it is)
    this._masterNext = 0;
    this._leslieLines = new Map(); // track id → [{ t, mode }] sorted: the rotor changes written on the score (Leslie signs), see leslie.js
    this._leslieEvents = []; // the same, all tracks, sorted by time: { t, track, mode } (the light engine dispatches them from `_flushMessages`)
    this._leslieNext = 0;
    this._ccCurves = new Map(); // track id → Map(param → curve) of the MIDI controller lanes (expression, reverb…): only the SoundFont engine plays them
  }

  // -- contexte -------------------------------------------------------------------------------------------------------------------------

  /** Crée le contexte (à appeler dans un geste utilisateur sur tablette) et le sort de la suspension. */
  unlock() {
    prepareAudioSession(this._globals);
    const ctx = this._context();
    if (ctx.state === 'suspended') ctx.resume?.();
    return ctx;
  }

  _context() {
    if (!this._ctx) this._ctx = this._createContext();
    if (!this._master) {
      const ctx = this._ctx;
      this._master = ctx.createGain();
      this._master.gain.value = this.options.masterGain;
      // output stage (after the synth, whatever the engine): a gain the user sets in the mixer (-24..+12 dB, device setting), then the compressor that limits boosts
      this._out = ctx.createGain();
      this._out.gain.value = 10 ** ((this._outputDb ?? 0) / 20);
      // the balance of the whole mix (the master pan of the mixer): a stereo panner between the master gain and the output stage
      if (ctx.createStereoPanner) { this._masterPan = ctx.createStereoPanner(); this._masterPan.pan.value = this._masterPanValue ?? 0; this._master.connect(this._masterPan); this._masterPan.connect(this._out); } else this._master.connect(this._out);
      if (ctx.createDynamicsCompressor) {
        const comp = ctx.createDynamicsCompressor();
        // a limiter, not a musical compressor: nothing happens below -6 dB, then a hard 20:1 (the LED of the mixer shows when it acts)
        const set = (param, v) => { if (param && 'value' in param) param.value = v; };
        set(comp.threshold, -6); set(comp.knee, 6); set(comp.ratio, 20); set(comp.attack, 0.003); set(comp.release, 0.1);
        this._limiter = comp;
        this._out.connect(comp);
        comp.connect(ctx.destination);
        this._addMeter(comp);
      } else { this._out.connect(ctx.destination); this._addMeter(this._out); }
    }
    return this._ctx;
  }

  /** A meter on what leaves the engine (after the limiter): a branch that only listens, the sound is unchanged. Used by the sound test of the audio settings. */
  _addMeter(from) {
    const ctx = this._ctx;
    if (!ctx?.createAnalyser) return;
    this._meter = ctx.createAnalyser(); this._meter.fftSize = 1024;
    from.connect(this._meter);
  }

  /** Largest sample (0 … 1) of the last moments of the output, 0 before the audio context exists or when there is no meter. */
  outputPeak() {
    const m = this._meter;
    if (!m?.getFloatTimeDomainData) return 0;
    const buf = this._meterBuf ??= new Float32Array(m.fftSize);
    m.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a; }
    return peak;
  }

  /** The state of the browser's audio context: 'none' (not created yet), 'running', 'suspended' or 'closed'. */
  contextState() { return this._ctx?.state ?? 'none'; }

  /** What the browser reports about the delay between a note sent and a note heard: `{ baseMs, outputMs, sampleRate }` (null before the context exists). */
  latencyInfo() {
    const c = this._ctx;
    if (!c) return null;
    const ms = (x) => (Number.isFinite(x) && x >= 0 ? x * 1000 : null);
    return { baseMs: ms(c.baseLatency), outputMs: ms(c.outputLatency), sampleRate: c.sampleRate ?? null };
  }

  _noiseBuffer() {
    if (!this._noise) {
      const ctx = this._context();
      const length = Math.round(ctx.sampleRate * this.options.noiseSeconds);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buffer;
    }
    return this._noise;
  }

  _trackGain(trackId) {
    let node = this._trackGains.get(trackId);
    if (!node) {
      const ctx = this._context();
      node = ctx.createGain();
      const panner = ctx.createStereoPanner?.() ?? null; // the voices go through the track gain, then the stereo position of the track, then the master
      if (panner) { node.connect(panner); panner.connect(this._master); this._trackPans.set(trackId, panner); } else node.connect(this._master);
      this._trackGains.set(trackId, node);
      this._applyTrackGain(trackId);
    }
    return node;
  }

  _applyTrackGain(trackId) {
    const node = this._trackGains.get(trackId);
    if (!node) return;
    const entries = Object.values(this._mixer);
    const anySolo = entries.some((m) => m?.solo);
    const m = this._mixer[trackId] ?? { volume: 1, mute: false, solo: false };
    const audible = !m.mute && (!anySolo || m.solo);
    this._applyTrackPan(trackId);
    this._applyCompressor(trackId);
    if (this._curves.has(trackId)) { this._seekAutomation(trackId); return; }
    node.gain.cancelScheduledValues?.(0); // no lane (any more): what was scheduled ahead for it is dropped
    node.gain.value = audible ? Math.max(0, m.volume ?? 1) : 0;
  }

  /**
   * The equalizer (audio/eq.js: native filters) and the compressor (audio/compressor.js: an AudioWorklet) of a track, in this order between its panner and the master, so they work
   * on what the track sounds like after its fader and pan. Each is built the first time the track asks for it; the equalizer is out of the path while it is off, the compressor
   * stays in and passes the signal through (`on: false`). Without AudioWorklet there is no compressor.
   */
  _applyCompressor(trackId) {
    const comp = this._mixer[trackId]?.compressor ?? null;
    const eq = this._mixer[trackId]?.eq ?? null;
    const leslie = this._mixer[trackId]?.leslie ?? null;
    const wantLeslie = this._needsLeslie(trackId, leslie);
    let fx = this._trackFx.get(trackId);
    if (!fx) {
      if (!comp && !eq && !wantLeslie) return;
      fx = { eq: null, eqOn: false, comp: null, loading: false, leslie: null, leslieOn: false, leslieKey: '' };
      this._trackFx.set(trackId, fx);
    }
    if (eq && !fx.eq) fx.eq = createEq(this._context());
    fx.eq?.apply(eq ?? {});
    if (Boolean(eq) !== fx.eqOn) { fx.eqOn = Boolean(eq); this._wireFx(trackId); }
    this._tuneLeslie(trackId, fx, wantLeslie, leslie);
    if (comp && !fx.comp && !fx.loading) {
      fx.loading = true;
      this._loadFxModule().then((ok) => {
        fx.loading = false;
        if (ok && !fx.comp && this._trackGains.has(trackId)) { fx.comp = this._makeCompressor(trackId); this._wireFx(trackId); }
        fx.comp?.port.postMessage(this._mixer[trackId]?.compressor ?? { on: false });
      });
    }
    fx.comp?.port.postMessage(comp ?? { on: false });
  }

  /**
   * Loads the worklet of the compressor in the context (true / false). The script is started from a Blob URL, then from a data: URL when the Blob is refused (a page opened from a
   * file, some browsers): the same two tries as the synthesizer's processor. When none works the page is told (`{ type: 'unavailable' }`): there is no compressor, the rest goes on.
   */
  _loadFxModule() {
    if (!this._fxModule) {
      const ctx = this._context();
      const text = typeof __COMPRESSOR_WORKLET__ !== 'undefined' ? __COMPRESSOR_WORKLET__ : null;
      const urls = [];
      if (this.options.compressorModuleUrl) urls.push(this.options.compressorModuleUrl);
      else if (text) {
        try { urls.push(URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))); } catch { /* no Blob URL here */ }
        urls.push(`data:text/javascript;charset=utf-8,${encodeURIComponent(text)}`);
      }
      const canRun = urls.length && ctx.audioWorklet && typeof (this.options.createWorkletNode ?? globalThis.AudioWorkletNode) === 'function';
      this._fxModule = (async () => {
        if (canRun) for (const url of urls) { try { await ctx.audioWorklet.addModule(url); return true; } catch { /* the next one */ } }
        this._emitFx({ type: 'unavailable' });
        return false;
      })();
    }
    return this._fxModule;
  }

  _makeCompressor(trackId) {
    const make = this.options.createWorkletNode ?? ((c, name, o) => new AudioWorkletNode(c, name, o));
    const node = make(this._ctx, 'scorsaire-compressor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = (e) => { if (typeof e.data === 'number') this._emitFx({ type: 'reduction', track: trackId, db: e.data }); };
    return node;
  }

  /** Does a track need the Leslie stage? (a setting is stored, or a sign of the score changes its rotor) */
  _needsLeslie(trackId, setting) { return Boolean(setting) || this._leslieSigned?.has(trackId) === true; }

  /** The Leslie settings of a track as the engine sees them (the mixer's, else the one of its sequence entry). */
  _leslieOf(t) { return this._mixer?.[t.id]?.leslie ?? (this._mixer?.[t.id] ? null : t.mixer?.leslie ?? null); }

  /** The rotor changes of the sequence, from its messages (also used by the SoundFont engine, which keeps its own copy in its message list). */
  _loadLeslie(sequence) {
    const signed = leslieTracks(sequence.messages);
    this._leslieSigned = signed;
    this._leslieLines = new Map([...signed].map((id) => [id, leslieTimeline(sequence.messages, id)]));
    this._leslieEvents = [];
    for (const [track, line] of this._leslieLines) for (const e of line) this._leslieEvents.push({ t: e.t, track, mode: e.mode });
    this._leslieEvents.sort((a, b) => a.t - b.t);
    this._leslieNext = lowerBound(this._leslieEvents, this._pos ?? 0);
  }

  /** The state of the rotor of a track at song time `pos`: the last sign before it, else the mode of its setting. */
  _leslieModeAt(trackId, setting, pos) {
    return leslieModeAt(this._leslieLines.get(trackId) ?? [], pos, leslieSettings(setting).mode);
  }

  /** Builds / removes / refreshes the Leslie stage of a track (light engine) and puts it in the state of the current position. */
  _tuneLeslie(trackId, fx, want, setting) {
    const key = JSON.stringify(setting ?? null);
    if (want && !fx.leslie) {
      fx.leslie = createLeslieStage(this._context(), this._leslieModeAt(trackId, setting, this._playing ? this.position() : this._pos), setting);
      fx.leslieKey = key;
    } else if (want && fx.leslieKey !== key) { // the setting changed (rate, depth, vibrato…): the state of the position, set at once
      fx.leslieKey = key;
      this._assertLeslie(trackId, fx);
      if (this._playing) { // the re-assert cancelled the signs already scheduled ahead: send them again
        const pos = this.position();
        for (let i = lowerBound(this._leslieEvents, pos); i < this._leslieNext; i++) {
          const e = this._leslieEvents[i];
          if (e.track === trackId && e.t >= pos) fx.leslie.set(e.mode, setting, { at: Math.max(this._ctxTime(e.t), this._ctx.currentTime) });
        }
      }
    }
    if (!want) fx.leslieKey = '';
    if (want !== fx.leslieOn) { fx.leslieOn = want; this._wireFx(trackId); }
  }

  /** Puts the stage of a track in the state it has at song time `pos` (default: now), values set at once. */
  _assertLeslie(trackId, fx, pos = this._playing ? this.position() : this._pos) {
    if (!fx?.leslie || !this._ctx) return;
    const at = Math.max(this._ctx.currentTime, this._playing ? this._startCtx - 0.001 : 0);
    fx.leslie.set(this._leslieModeAt(trackId, this._mixer[trackId]?.leslie ?? null, pos), this._mixer[trackId]?.leslie ?? null, { at, reassert: true });
  }

  /** The stage of a track, built (with the track gain) if the track needs it and it is not there yet. */
  _leslieStageOf(trackId) {
    if (!this._trackFx.get(trackId)?.leslie && this._needsLeslie(trackId, this._mixer[trackId]?.leslie ?? null)) this._trackGain(trackId);
    return this._trackFx.get(trackId);
  }

  /** The rotor state is re-asserted on every track with a stage after a seek, a loop or a start in the middle. */
  _seekLeslie(pos) {
    this._leslieNext = lowerBound(this._leslieEvents, pos);
    if (!this._ctx) return;
    for (const id of this._leslieSigned ?? []) { const fx = this._leslieStageOf(id); if (fx?.leslie) this._assertLeslie(id, fx, pos); }
    for (const [id, fx] of this._trackFx) if (fx.leslie && !this._leslieSigned?.has(id)) this._assertLeslie(id, fx, pos);
  }

  /** Dispatches the rotor changes due before song time `stop` (the SoundFont engine does it from its own message list). */
  _flushMessages(stop) {
    while (this._leslieNext < this._leslieEvents.length && this._leslieEvents[this._leslieNext].t < stop) {
      const e = this._leslieEvents[this._leslieNext++];
      const fx = this._leslieStageOf(e.track);
      if (fx?.leslie) fx.leslie.set(e.mode, this._mixer[e.track]?.leslie ?? null, { at: Math.max(this._ctxTime(e.t), this._ctx.currentTime) });
    }
  }

  /** panner → [equalizer] → [Leslie] → [compressor] → master, as the track needs it now. */
  _wireFx(trackId) {
    const fx = this._trackFx.get(trackId);
    const tail = this._trackPans.get(trackId) ?? this._trackGains.get(trackId);
    if (!fx || !tail) return;
    try { tail.disconnect(); } catch { /* nothing was connected */ }
    try { fx.eq?.output.disconnect(); } catch { /* idem */ }
    try { fx.comp?.disconnect(); } catch { /* idem */ }
    try { fx.leslie?.output.disconnect(); } catch { /* idem */ }
    let node = tail;
    if (fx.eqOn && fx.eq) { node.connect(fx.eq.input); node = fx.eq.output; }
    if (fx.leslieOn && fx.leslie) { node.connect(fx.leslie.input); node = fx.leslie.output; }
    if (fx.comp) { node.connect(fx.comp); node = fx.comp; }
    node.connect(this._master);
  }

  /** The page listens to what the compressors report: `{ type: 'reduction', track, db }` (the gain reduction of a track, about every 20 ms) and `{ type: 'limit', tracks }`. Returns the way to stop listening. */
  onCompressor(fn) { (this._fxListeners ??= new Set()).add(fn); return () => this._fxListeners.delete(fn); }

  _emitFx(event) { for (const fn of this._fxListeners ?? []) fn(event); }

  /** The stereo position of a track: its own pan, or (with a pan lane) the curve at the current position. */
  _applyTrackPan(trackId) {
    const panner = this._trackPans.get(trackId);
    if (!panner) return;
    if (this._panCurves.has(trackId)) { this._seekPan(trackId); return; }
    panner.pan.cancelScheduledValues?.(0);
    panner.pan.value = Math.min(1, Math.max(-1, this._mixer[trackId]?.pan ?? 0));
  }

  // -- mixer automation (gain curve of a track, scheduled on its gain node) -----------------------------------------------------------------

  _audibleTrack(trackId) {
    const m = this._mixer[trackId] ?? { volume: 1, mute: false, solo: false };
    return !m.mute && (!Object.values(this._mixer).some((x) => x?.solo) || m.solo);
  }

  /** Groups the automation of a sequence by track and compiles one gain curve per track. */
  _loadAutomation(sequence) {
    this._lanes = new Map();
    for (const lane of sequence.automation ?? []) {
      const entry = this._lanes.get(lane.track) ?? {};
      entry[lane.param] = lane.steps;
      if (lane.param === 'master') this._masterRest = lane.rest;
      this._lanes.set(lane.track, entry);
    }
    this._compileAutomation();
  }

  _compileAutomation() {
    this._curves = new Map();
    for (const [id, lanes] of this._lanes) {
      const entry = this._mixer[id];
      if (!entry || entry.override) continue; // `override`: the fader is being recorded, the lane steps aside
      const curve = compileGain(lanes, entry, this._audibleTrack(id));
      if (curve.length) this._curves.set(id, curve);
    }
    // the master volume lane: a multiplier of the master gain (the lane value over the master fader, which is what the lane says where it lets go)
    const rest = this._masterRest ?? 100 / 127;
    this._masterCurve = compileLane(this._lanes.get('*')?.master, rest).map((p) => ({ t: p.t, v: Math.min(4, p.v / (rest || 1)), ...(p.to ? { to: { t: p.to.t, v: Math.min(4, p.to.v / (rest || 1)) } } : {}) }));
    this._ccCurves = new Map();
    for (const [id, lanes] of this._lanes) {
      if (id === '*') continue;
      const per = new Map();
      for (const [param, steps] of Object.entries(lanes)) {
        const spec = AUTOMATION_PARAMS[param];
        if (spec?.cc == null) continue;
        const curve = compileLane(steps, spec.rest);
        if (curve.length) per.set(param, curve);
      }
      if (per.size) this._ccCurves.set(id, per);
    }
    this._panCurves = new Map();
    for (const [id, lanes] of this._lanes) {
      const entry = this._mixer[id];
      if (!entry || !lanes.pan) continue;
      const curve = compilePan(lanes.pan, entry);
      if (curve.length) this._panCurves.set(id, curve);
    }
  }

  /** Puts the master gain at the value of the master lane for song time `pos` and schedules the rest of the ramp in progress (the base gain without a lane). */
  _seekMaster(pos = this._playing ? this.position() : this._pos) {
    const ctx = this._ctx;
    if (!ctx || !this._master) return;
    const base = this.options.masterGain;
    const curve = this._masterCurve;
    const at = this._playing ? Math.max(this._startCtx, ctx.currentTime) : ctx.currentTime;
    this._master.gain.cancelScheduledValues(at);
    if (!curve.length) { this._master.gain.setValueAtTime(base, at); this._masterNext = 0; return; }
    this._master.gain.setValueAtTime(base * curveAt(curve, pos, 1), at);
    let i = 0;
    while (i < curve.length && curve[i].t <= pos) i++;
    const running = i > 0 ? curve[i - 1] : null;
    if (running?.to && running.to.t > pos) this._master.gain.linearRampToValueAtTime(base * running.to.v, Math.max(at, this._startCtx + (running.to.t - this._startPos)));
    this._masterNext = i;
  }

  /** The pan a track has at song time `t`: its curve, or its own pan before the first step. */
  _panAt(trackId, t) {
    return curveAt(this._panCurves.get(trackId), t, this._mixer[trackId]?.pan ?? 0);
  }

  /** Puts the panner of a track at the value of its pan curve for song time `pos` and schedules the rest of the ramp in progress. */
  _seekPan(trackId, pos = this._playing ? this.position() : this._pos) {
    const curve = this._panCurves.get(trackId);
    const ctx = this._ctx;
    const panner = this._trackPans.get(trackId);
    if (!curve || !ctx || !panner) return;
    const at = this._playing ? Math.max(this._startCtx, ctx.currentTime) : ctx.currentTime;
    panner.pan.cancelScheduledValues(at);
    panner.pan.setValueAtTime(this._panAt(trackId, pos), at);
    let i = 0;
    while (i < curve.length && curve[i].t <= pos) i++;
    const running = i > 0 ? curve[i - 1] : null;
    if (running?.to && running.to.t > pos) panner.pan.linearRampToValueAtTime(running.to.v, Math.max(at, this._startCtx + (running.to.t - this._startPos)));
    this._panNext.set(trackId, i);
  }

  /** The gain a track has at song time `t`: its curve, or (before the first step) its static value. */
  _gainAt(trackId, t) {
    const m = this._mixer[trackId] ?? { volume: 1 };
    return curveAt(this._curves.get(trackId), t, this._audibleTrack(trackId) ? Math.max(0, m.volume ?? 1) : 0);
  }

  /** Puts the gain node of a track at the value of its curve for song time `pos` (default: now) and schedules the rest of the ramp in progress. */
  _seekAutomation(trackId, pos = this._playing ? this.position() : this._pos) {
    const curve = this._curves.get(trackId);
    const ctx = this._ctx;
    if (!curve || !ctx) return;
    const node = this._trackGain(trackId);
    const at = this._playing ? Math.max(this._startCtx, ctx.currentTime) : ctx.currentTime;
    node.gain.cancelScheduledValues(at);
    node.gain.setValueAtTime(this._gainAt(trackId, pos), at);
    let i = 0;
    while (i < curve.length && curve[i].t <= pos) i++;
    const running = i > 0 ? curve[i - 1] : null;
    if (running?.to && running.to.t > pos) node.gain.linearRampToValueAtTime(running.to.v, Math.max(at, this._startCtx + (running.to.t - this._startPos)));
    this._autoNext.set(trackId, i);
  }

  _seekAllAutomation(pos) { this._seekLeslie(pos); this._seekMaster(pos); for (const id of this._curves.keys()) this._seekAutomation(id, pos); for (const id of this._panCurves.keys()) this._seekPan(id, pos); }

  /** Schedules the curve points that lie before song time `stop`. */
  _flushAutomation(stop) {
    const ctx = this._ctx;
    if (this._masterCurve.length && this._master) { // the master volume lane
      const curve = this._masterCurve; const base = this.options.masterGain;
      let i = this._masterNext ?? 0;
      while (i < curve.length && curve[i].t < stop) {
        const p = curve[i++];
        const when = Math.max(this._ctxTime(p.t), ctx.currentTime);
        this._master.gain.setValueAtTime(base * p.v, when);
        if (p.to) this._master.gain.linearRampToValueAtTime(base * p.to.v, Math.max(this._ctxTime(p.to.t), when));
      }
      this._masterNext = i;
    }
    for (const [id, curve] of this._curves) {
      const node = this._trackGain(id);
      let i = this._autoNext.get(id) ?? 0;
      while (i < curve.length && curve[i].t < stop) {
        const p = curve[i++];
        const when = Math.max(this._ctxTime(p.t), ctx.currentTime);
        node.gain.setValueAtTime(p.v, when);
        if (p.to) node.gain.linearRampToValueAtTime(p.to.v, Math.max(this._ctxTime(p.to.t), when));
      }
      this._autoNext.set(id, i);
    }
    for (const [id, curve] of this._panCurves) {
      const panner = this._trackPans.get(id) ?? (this._trackGain(id), this._trackPans.get(id));
      if (!panner) continue;
      let i = this._panNext.get(id) ?? 0;
      while (i < curve.length && curve[i].t < stop) {
        const p = curve[i++];
        const when = Math.max(this._ctxTime(p.t), ctx.currentTime);
        panner.pan.setValueAtTime(p.v, when);
        if (p.to) panner.pan.linearRampToValueAtTime(p.to.v, Math.max(this._ctxTime(p.to.t), when));
      }
      this._panNext.set(id, i);
    }
  }

  // -- contrat --------------------------------------------------------------------------------------------------------------------------

  load(sequence, { position = 0 } = {}) {
    this._stopTimer();
    this.allNotesOff();
    this._playing = false;
    this._sequence = sequence;
    this._notes = [...sequence.notes].sort((a, b) => a.t - b.t);
    this._tracks = new Map(sequence.tracks.map((t) => [t.id, t]));
    this._tempo = sequence.tempo;
    // a big score (many tracks) makes many short notes per second: every voice is then built from fewer nodes (see `_startVoice`)
    this._lite = sequence.tracks.length > this.options.liteTracks;
    this._loop = null;
    this._mixer = Object.fromEntries(sequence.tracks.map((t) => [t.id, { ...t.mixer }]));
    this._pedals = pedalIntervals(sequence.messages);
    this._loadLeslie(sequence);
    this._loadAutomation(sequence);
    for (const id of this._trackGains.keys()) this._applyTrackGain(id);
    this._pos = Math.max(0, position);
    this._setNext(this._pos);
    this._pedalFloor = this._pos;
  }

  play() {
    this.stopAudition?.(); // a trial listening never mixes with the piece
    if (!this._sequence) throw new Error('WebAudioEngine : aucune séquence chargée');
    if (this._playing) return;
    const ctx = this.unlock();
    this._anchor(this._pos, ctx);
    this._playing = true;
    this._startTimer();
    this._tick();
  }

  pause() {
    if (!this._playing) return;
    this._pos = this.position();
    this._playing = false;
    this._stopTimer();
    this.allNotesOff();
  }

  stop() {
    this._playing = false;
    this._stopTimer();
    this.allNotesOff();
    this._pos = 0;
    this._next = 0;
    this._pedalFloor = 0;
  }

  seek(seconds) {
    const target = Math.max(0, seconds);
    this.allNotesOff();
    this._pos = target;
    this._pedalFloor = target;
    this._setNext(target);
    if (this._playing) this._anchor(target, this._context());
  }

  position() {
    if (!this._playing || !this._ctx) return this._pos;
    const now = this._ctx.currentTime;
    let a = this._anchors[0];
    for (const x of this._anchors) { if (x.ctx <= now) a = x; else break; }
    return a.pos + Math.max(0, now - a.ctx);
  }

  setLoop(range) {
    const next = range && range.end > range.start ? { start: Math.max(0, range.start), end: range.end } : null;
    const same = (!next && !this._loop) || (next && this._loop && next.start === this._loop.start && next.end === this._loop.end);
    this._loop = next;
    if (!same && this._playing) this._reschedule();
  }

  isPlaying() { return this._playing; }

  updateTempo(table) {
    const accepted = !this._tempo || table.version > this._tempo.version;
    if (accepted) this._tempo = table;
    return accepted;
  }

  /** Level of the output stage after the synth, in dB (clamped to -24..+12; 0 = unchanged). Works before the audio context exists. */
  setOutputGain(db) {
    this._outputDb = Math.min(12, Math.max(-24, Number.isFinite(db) ? db : 0));
    if (this._out) this._out.gain.value = 10 ** (this._outputDb / 20);
  }

  /** Balance of the whole mix (the master pan), −1 … +1; works before the audio context exists. */
  setMasterPan(pan) {
    this._masterPanValue = Math.min(1, Math.max(-1, Number.isFinite(pan) ? pan : 0));
    if (this._masterPan) this._masterPan.pan.value = this._masterPanValue;
  }

  /** Gain reduction of the output limiter in dB (0 = not acting, negative = acting); 0 before the audio context exists. */
  limiterReduction() {
    const r = this._limiter?.reduction;
    return typeof r === 'number' ? r : (r?.value ?? 0);
  }

  setMixer(mixer) {
    this._mixer = mixer;
    this._compileAutomation();
    for (const id of this._trackGains.keys()) this._applyTrackGain(id);
    for (const id of this._curves.keys()) if (!this._trackGains.has(id) && this._ctx) this._seekAutomation(id);
    for (const id of this._panCurves.keys()) if (!this._trackGains.has(id) && this._ctx) this._trackGain(id);
  }

  sendMessage(message) {
    if (message?.kind === 'controller' && (message.data?.number === 123 || message.data?.number === 120)) {
      this._killWhere((v) => message.track == null || v.track === message.track);
    }
  }

  allNotesOff() { this._killWhere(() => true); }

  /** Cuts the piece being heard through `audition` (nothing else). */
  stopAudition() { if (this._ctx) this._killWhere((v) => v.audition); }

  /**
   * Hears a short sequence of notes RIGHT NOW (all at once, `t` ignored — unless `sequence.timed`: then each note keeps its `t`, a small piece) without touching the loaded sequence or the transport (the notes just placed in the
   * editor): `{ tracks, notes }` as built by `audition.js`. The previous audition is cut. Voices use the real track gain (mixer volume, mute).
   */
  audition(sequence) {
    const ctx = this.unlock();
    this._killWhere((v) => v.audition);
    for (const t of sequence.tracks) if (!this._tracks.has(t.id)) this._tracks.set(t.id, t);
    const when = ctx.currentTime + 0.02;
    for (const n of sequence.notes) {
      const before = this._voices.length;
      this._startVoice(n, when + (sequence.timed ? Math.max(0, n.t ?? 0) : 0));
      for (let i = before; i < this._voices.length; i++) this._voices[i].audition = true;
    }
  }

  /**
   * Plays a pre-rendered stereo buffer (`{ left, right, sampleRate }`, see `prerender.js`) starting at the AUDIO time `at`, through the master (gain, balance,
   * limiter) like any voice. One at a time: a new one cuts the previous. Used to hear a backing track while a take is recorded.
   */
  playBacking({ left, right, sampleRate }, at, offset = 0) {
    const ctx = this.unlock();
    this.stopBacking();
    const buffer = ctx.createBuffer(2, left.length, sampleRate);
    buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this._master);
    const when = Math.max(at, ctx.currentTime);
    src.start(when, Math.max(0, offset + (when - at)));
    this._backing = src;
  }

  /** Cuts the backing buffer, if one plays or is waiting to start. */
  stopBacking() {
    const src = this._backing; this._backing = null;
    if (!src) return;
    try { src.stop(); } catch { /* never started or already finished */ }
    try { src.disconnect(); } catch { /* already gone */ }
  }

  /**
   * A key held with the finger (the on-screen keyboard, `piano-keyboard.js`): the note sounds from `liveNoteOn` until `liveNoteOff` (a short release),
   * whatever the loaded sequence does. Not the transport, not the audition: several keys can be held at once, one voice per pitch.
   * @param n { pitch, velocity, track } `track` = a track description as in a sequence (instrument, mixer): its timbre and gain
   */
  liveNoteOn({ pitch, velocity = 90, track }) {
    const ctx = this.unlock();
    const tr = track ?? { id: 'live', kind: 'pitched', mixer: { volume: 1, mute: false, solo: false } };
    this._tracks.set(tr.id, tr);
    this._live ??= new Map();
    this.liveNoteOff(pitch);
    this._startVoice({ id: 'live', track: tr.id, pitch, velocity, t: 0, duration: MAX_PEDAL_HOLD }, ctx.currentTime);
    const voice = this._voices[this._voices.length - 1];
    if (voice) { voice.live = true; this._live.set(pitch, voice); }
  }

  liveNoteOff(pitch) {
    const voice = this._live?.get(pitch);
    if (!voice || !this._ctx) return;
    this._live.delete(pitch);
    const now = this._ctx.currentTime; const fade = 0.14;
    voice.cut.gain.cancelScheduledValues(now);
    voice.cut.gain.setValueAtTime(1, now);
    voice.cut.gain.linearRampToValueAtTime(0, now + fade);
    for (const src of voice.sources) { try { src.stop(now + fade + 0.02); } catch { /* source never started */ } }
    voice.end = Math.min(voice.end, now + fade + 0.03);
  }

  // -- metronome and recording clock (optional methods of the contract, used by the recording window) ---------------------------------------

  /** A metronome click at audio-context time `when` (seconds): a short sine burst, higher on the accent, through the output stage (after the synth). */
  clickAt(when, { accent = false, volume = 0.6 } = {}) {
    const ctx = this.unlock();
    this._clicks ??= new Set();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = accent ? 1568 : 1046;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(gain); gain.connect(this._out);
    osc.start(when); osc.stop(when + 0.06);
    this._clicks.add(osc); osc.onended = () => { this._clicks.delete(osc); try { gain.disconnect(); } catch { /* already gone */ } };
  }

  /** Audio-context time at which position `pos` (seconds of the sequence) is played, from the current anchor (valid until the loop wraps); null when stopped. */
  ctxTimeOf(pos) {
    if (!this._playing || this._startCtx == null) return null;
    return this._startCtx + (pos - this._startPos);
  }

  /**
   * Every audio-context time at which position `c` (seconds of the sequence) is heard from now on up to `horizonCtx`: once for each lap of the loop (the laps
   * already planned and the ones that follow), or once. Used to keep a metronome in time with the music across loop wraps.
   */
  audioTimesOf(c, horizonCtx) {
    if (!this._playing || !this._anchors.length) return [];
    const loop = this._loop;
    const anchors = this._anchors.slice();
    if (loop && loop.end > loop.start) {
      const last = anchors[anchors.length - 1];
      if (last.pos < loop.end) {
        let ctxEnd = last.ctx + (loop.end - last.pos);
        let guard = 0;
        while (ctxEnd < horizonCtx && guard++ < 64) { anchors.push({ ctx: ctxEnd, pos: loop.start }); ctxEnd += loop.end - loop.start; }
      }
    }
    const out = [];
    for (const a of anchors) {
      if (c < a.pos) continue;
      if (loop && a.pos < loop.end && c >= loop.end) continue;
      out.push(a.ctx + (c - a.pos));
    }
    return out;
  }

  /** Cancels the clicks not yet played. */
  cancelClicks() {
    for (const osc of [...(this._clicks ?? [])]) { try { osc.stop(); } catch { /* already stopped */ } }
    this._clicks?.clear();
  }

  /**
   * The audio clock for timing what the user plays: `now()` = audio-context time (seconds), `perfOf(contextTime)` = the `performance.now()` time (ms) at which
   * that audio is HEARD (the browser's output timestamp, which includes the output latency; else an estimate from `outputLatency`), `latencyMs` = what the
   * browser reports for the output (0 when unknown).
   */
  audioClock() {
    const ctx = this.unlock();
    const reported = Math.max(0, ctx.outputLatency ?? 0, 0) * 1000;
    return {
      now: () => ctx.currentTime,
      perfOf: (c) => {
        const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
        if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.performanceTime + (c - ts.contextTime) * 1000;
        return performance.now() + (c - ctx.currentTime) * 1000 + (ctx.outputLatency ?? ctx.baseLatency ?? 0) * 1000;
      },
      latencyMs: reported,
    };
  }

  // -- planificateur --------------------------------------------------------------------------------------------------------------------

  _anchor(position, ctx) {
    this._setAnchor(position, ctx.currentTime + this.options.startLatency);
    this._pedalFloor = position;
    this._setNext(position);
  }

  _setAnchor(pos, ctxTime) {
    this._startPos = pos;
    this._startCtx = ctxTime;
    this._anchors = [{ ctx: ctxTime, pos }];
  }

  /**
   * La boucle change en pleine lecture : on garde l'horloge (même correspondance position ↔ temps audio), on annule les voix qui n'ont pas encore
   * démarré (planifiées avec l'ancienne boucle) et on replanifie à partir de la position courante. Rien de ce qui sonne n'est coupé.
   */
  _reschedule() {
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const pos = this.position();
    this._voices = this._voices.filter((v) => {
      if (v.when < now) return true;
      for (const src of v.sources) { try { src.stop(now); } catch { /* jamais démarrée */ } }
      v.cut.gain.cancelScheduledValues(0);
      v.cut.gain.setValueAtTime(0, now);
      try { v.cut.disconnect(); } catch { /* déjà déconnecté */ }
      return false;
    });
    this._setAnchor(pos, now);
    this._setNext(pos);
    this._tick();
  }

  _startTimer() { this._stopTimer(); this._timer = this._setTimer(() => this._tick(), this.options.interval * 1000); }

  _stopTimer() { if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; } }

  /** Un tour de planificateur (public pour les tests : appelé par le minuteur). */
  _tick() {
    if (!this._playing) return;
    const ctx = this._ctx;
    const horizonCtx = ctx.currentTime + this.options.lookahead;
    for (;;) {
      // La boucle ne vaut que pour un tour qui commence AVANT sa fin ; sinon on joue jusqu'au bout de la séquence.
      const loop = this._loop && this._startPos < this._loop.end ? this._loop : null;
      const limit = this._startPos + (horizonCtx - this._startCtx);
      const stop = loop ? Math.min(limit, loop.end) : limit;
      while (this._next < this._notes.length && this._notes[this._next].t < stop) {
        this._startVoice(this._notes[this._next]);
        this._next++;
      }
      this._flushMessages(stop);
      this._flushAutomation(stop);
      if (!loop || limit < loop.end) break;
      // Le tour suivant démarre à la date audio EXACTE de la fin de celui-ci : pas de seek, pas de latence, pas de coupure.
      const ctxEnd = this._startCtx + (loop.end - this._startPos);
      this._startPos = loop.start;
      this._startCtx = ctxEnd;
      this._anchors.push({ ctx: ctxEnd, pos: loop.start });
        this._pedalFloor = loop.start;
      this._setNext(loop.start);
    }
    // Les points d'horloge déjà dépassés ne servent plus (on garde le dernier).
    while (this._anchors.length > 1 && this._anchors[1].ctx <= ctx.currentTime) this._anchors.shift();
    this._pruneVoices(ctx.currentTime);
    this._afterTick(horizonCtx);
  }

  /** Positions the scheduler at time `pos` (index of the next note; engines that schedule more than notes extend it). */
  _setNext(pos) { this._next = lowerBound(this._notes, pos); this._seekAllAutomation(pos); }

  /** Hooks of the scheduler loop, no-ops here: `_flushMessages(stop)` sends what lies before song time `stop`; `_afterTick(horizonCtx)` runs at the end of a tick. */
  _afterTick() {}

  _ctxTime(t) { return this._startCtx + (t - this._startPos); }

  _sustainedDuration(note, timbre) {
    if (!PEDAL_TIMBRES.has(timbre) || note.pitch == null) return null;
    const end = note.t + note.duration;
    // En boucle, une pédale encore enfoncée à la fin du tour est relevée à cette fin (le tour suivant la remet à zéro, comme un déplacement).
    const cap = this._loop && note.t < this._loop.end ? this._loop.end : Infinity;
    for (const iv of this._pedals.get(note.track) ?? []) {
      if (iv.on < this._pedalFloor) continue;
      const off = Math.min(iv.off, cap);
      if (iv.on <= end && end < off) return Math.min(off, note.t + MAX_PEDAL_HOLD) - note.t;
    }
    return null;
  }

  /** Calls `fn(trackId, played)` each time a note of a track starts (`played` false = the track is muted / not soloed: the note is received but silent). Returns the off function. */
  onActivity(fn) { this._activity.add(fn); return () => this._activity.delete(fn); }
  _pulse(trackId, played) { for (const fn of this._activity) fn(trackId, played); }

  _startVoice(note, whenOverride = null) {
    const track = this._tracks.get(note.track) ?? { kind: note.pitch == null ? 'percussion' : 'pitched' };
    if (note.pitch == null && track.kind !== 'percussion') return;
    if (!whenOverride && note.id !== 'live') this._pulse(note.track, this._audibleTrack(note.track));
    const ctx = this._ctx;
    const timbre = timbreOf(track);
    let plan = voicePlan(note, track, { sustainUntil: this._sustainedDuration(note, timbre) });
    // lite voice: a single oscillator, no filter (about half the nodes): the audio thread of a big score otherwise falls behind real time
    if (this._lite && plan.parts.length > 1) plan = { ...plan, parts: plan.parts.slice(0, 1) };
    if (this._lite && plan.filter && !plan.noise) plan = { ...plan, filter: null };
    const when = whenOverride ?? Math.max(this._ctxTime(note.t), ctx.currentTime);
    if (this._voices.length >= this.options.maxVoices) this._kill(this._voices.shift(), ctx.currentTime);

    const cut = ctx.createGain();
    cut.connect(this._trackGain(note.track));
    const env = ctx.createGain();
    const points = envelopePoints(plan);
    env.gain.setValueAtTime(points[0].v, when);
    for (const p of points.slice(1)) env.gain.linearRampToValueAtTime(p.v, when + p.t);
    env.connect(cut);

    let sink = env;
    if (plan.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = plan.filter.type;
      filter.frequency.value = plan.filter.freq;
      filter.Q.value = plan.filter.q;
      filter.connect(env);
      sink = filter;
    }
    const sources = [];
    const stopAt = when + points[points.length - 1].t + 0.05;
    const norm = plan.oneShot ? 1 : 1 / Math.max(1e-6, plan.parts.reduce((s, p) => s + p.gain, 0));
    for (const part of plan.parts) {
      const osc = ctx.createOscillator();
      osc.type = part.type;
      osc.frequency.setValueAtTime(part.freq, when);
      if (part.freqEnd && part.freqEnd > 0 && part.freqEnd !== part.freq) osc.frequency.exponentialRampToValueAtTime(part.freqEnd, when + part.sweep);
      osc.detune.setValueAtTime(part.detune + (plan.curve?.[0]?.cents ?? 0), when);
      if (plan.curve) for (const c of plan.curve) osc.detune.linearRampToValueAtTime(part.detune + c.cents, when + Math.max(0, c.t));
      const g = ctx.createGain();
      g.gain.value = part.gain * norm;
      osc.connect(g);
      g.connect(sink);
      osc.start(when);
      osc.stop(stopAt);
      sources.push(osc);
    }
    if (plan.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = plan.noise.filter;
      filter.frequency.value = plan.noise.freq;
      filter.Q.value = plan.noise.q;
      const g = ctx.createGain();
      g.gain.value = plan.noise.gain;
      src.connect(filter);
      filter.connect(g);
      g.connect(sink);
      src.start(when);
      src.stop(stopAt);
      sources.push(src);
    }
    this._voices.push({ track: note.track, when, end: stopAt, cut, sources });
  }

  _pruneVoices(now) {
    this._voices = this._voices.filter((v) => {
      if (v.end >= now) return true;
      try { v.cut.disconnect(); } catch { /* déjà déconnecté */ }
      return false;
    });
  }

  _kill(voice, now) {
    voice.cut.gain.cancelScheduledValues(now);
    voice.cut.gain.setValueAtTime(1, now);
    voice.cut.gain.linearRampToValueAtTime(0, now + FAST_FADE);
    for (const s of voice.sources) {
      try { s.stop(now + FAST_FADE + 0.01); } catch { /* source jamais démarrée */ }
    }
    voice.end = Math.min(voice.end, now + FAST_FADE + 0.02);
  }

  _killWhere(predicate) {
    if (!this._ctx) { this._voices = []; return; }
    const now = this._ctx.currentTime;
    const keep = [];
    for (const v of this._voices) {
      if (predicate(v)) this._kill(v, now); else keep.push(v);
    }
    this._voices = keep;
  }

  /** Nombre de voix en cours (tests, diagnostic). */
  get voiceCount() { return this._voices.length; }
}

/** Intervalles de pédale par piste, depuis les messages CC64 de la séquence : { on, off } (off = Infinity si jamais relevée). */
export function pedalIntervals(messages = []) {
  const byTrack = new Map();
  const sorted = messages.filter((m) => m.kind === 'controller' && m.data?.number === 64).sort((a, b) => a.t - b.t);
  const open = new Map();
  for (const m of sorted) {
    const down = (m.data.value ?? 0) >= 64;
    const list = byTrack.get(m.track) ?? [];
    byTrack.set(m.track, list);
    if (down && !open.has(m.track)) { const iv = { on: m.t, off: Infinity }; open.set(m.track, iv); list.push(iv); }
    else if (!down && open.has(m.track)) { open.get(m.track).off = m.t; open.delete(m.track); }
  }
  return byTrack;
}

export function createWebAudioEngine(options) { return new WebAudioEngine(options); }
