/*
 * Stem player: plays the stems of a recording (any number of stereo files, plus a mix-down used when there is no stem) in sync, with time stretch
 * (speed) and pitch shift (semitones) independent of each other. One Signalsmith Stretch node per stem (its API takes whole buffers, not a stream),
 * each followed by a gain; all nodes are scheduled together. Time is the time of the RECORDING (seconds of the input), never the stretched time.
 * No DOM: the audio context and the stretch factory are injected (tests use fakes).
 *
 *   const p = createStemPlayer({ createContext, loadStretch });
 *   await p.load([{ name: 'drums', bytes: ArrayBuffer }, …]);        // decodes every file and builds the nodes
 *   p.play(); p.pause(); p.stop(); p.seek(12.5); p.setRate(0.75); p.setSemitones(-2); p.setLoop({ start, end });
 *   p.setStem(i, { volume (0..1.5), mute, solo }); p.subscribe(fn); p.state();
 */
export function createStemPlayer({ createContext, loadStretch, interval = 0.05 } = {}) {
  let ctx = null; let stems = []; let nodes = []; let master = null;
  let position = 0; let duration = 0; let playing = false; let peaks = null; let energy = null; let preRollFn = null; let fresh = true; let clickVolume = 0.5; let clickNodes = []; let anchor = null; // anchor: { ctx, pos, rate } = the audio-context time at which the position `pos` (recording seconds) is heard, while playing
  let rate = 1; let semitones = 0; let loop = null; let masterVolume = 1;
  const listeners = new Set(); const seekListeners = new Set();

  const state = () => ({
    loaded: nodes.length > 0, duration, position, playing, rate, semitones, loop: loop ? { ...loop } : null, masterVolume,
    stems: stems.map((s) => ({ name: s.name, volume: s.volume, mute: s.mute, solo: s.solo })),
  });
  /** A (context time, performance time) pair of the output: what is heard at `ctx` seconds is heard at `perf` ms. */
  const clockRef = () => {
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return { ctx: ts.contextTime, perf: ts.performanceTime };
    return { ctx: ctx.currentTime, perf: performance.now() + (ctx.outputLatency ?? ctx.baseLatency ?? 0) * 1000 };
  };
  const perfOfCtx = (c) => { const ref = clockRef(); return ref.perf + (c - ref.ctx) * 1000; };
  const emit = () => { const s = state(); for (const fn of [...listeners]) fn(s); };
  const each = (fn) => nodes.forEach((n, i) => fn(n, i));

  function applyGains() {
    const anySolo = stems.some((s) => s.solo);
    each((n, i) => { const s = stems[i]; const audible = !s.mute && (!anySolo || s.solo); n.gain.gain.value = audible ? s.volume * masterVolume : 0; });
  }
  const loopArgs = () => (loop ? { loopStart: loop.start, loopEnd: loop.end } : { loopStart: 0, loopEnd: 0 });

  async function load(files) {
    unload(); fresh = true;
    if (!files.length) throw new Error('No audio to load');
    ctx = createContext();
    const create = await loadStretch();
    const buffers = [];
    for (const f of files) buffers.push(await ctx.decodeAudioData(f.bytes.slice(0)));
    master = ctx.createGain(); master.connect(ctx.destination);
    for (let i = 0; i < buffers.length; i += 1) {
      const b = buffers[i];
      const node = await create(ctx);
      await node.addBuffers(Array.from({ length: b.numberOfChannels > 1 ? 2 : 1 }, (_, c) => b.getChannelData(c).slice()).concat(b.numberOfChannels > 1 ? [] : [b.getChannelData(0).slice()]));
      const gain = ctx.createGain(); node.connect(gain); gain.connect(master);
      nodes.push({ node, gain });
      stems.push({ name: files[i].name, volume: 1, mute: false, solo: false });
      duration = Math.max(duration, b.duration);
    }
    peaks = computePeaks(buffers, duration);
    energy = computeEnergy(buffers);
    nodes[0].node.setUpdateInterval(interval, (t) => {
      if (!playing) return;
      position = t;
      if (!loop && duration && t >= duration - 0.02) { pause(); position = duration; }
      emit();
    });
    applyGains(); position = 0; emit();
  }

  /** A short beep on the context at `when` (a pre-roll click; it does not go through the master volume of the stems). */
  function click(when, accent) {
    if (!ctx || clickVolume <= 0) return;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1100; g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.5 * clickVolume), when + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g); g.connect(ctx.destination); osc.start(when); osc.stop(when + 0.06);
    clickNodes.push(osc); osc.onended = () => { clickNodes = clickNodes.filter((x) => x !== osc); };
  }
  function cutClicks() { for (const o of clickNodes) { try { o.stop(); } catch { /* already ended */ } } clickNodes = []; }

  function unload() {
    if (!nodes.length) return;
    each((n) => { try { n.node.stop(); n.node.disconnect(); } catch { /* already gone */ } });
    try { ctx?.close?.(); } catch { /* ignore */ }
    nodes = []; stems = []; ctx = null; position = 0; duration = 0; playing = false; peaks = null; energy = null;
  }

  function play() {
    if (!nodes.length || playing) return;
    if (ctx.state === 'suspended') ctx.resume?.(); // inside the gesture (iPad / Chrome autoplay rules)
    if (position >= duration - 0.05) position = 0;
    let clicks = []; let delay = 0;
    if (fresh && preRollFn) { const p = preRollFn(position); if (p) { position = Math.max(0, p.from); clicks = p.clicks ?? []; delay = Math.max(0, p.delay ?? 0); } } // a start from rest begins earlier (pre-roll)
    fresh = false;
    playing = true;
    const out = ctx.currentTime + 0.05 + delay / rate; // `delay`: seconds of count-in BEFORE the first note of the recording (a start at the very beginning of the piece)
    anchor = { ctx: out, pos: position, rate };
    for (const c of clicks) if (c.t >= position - delay - 1e-6) click(out + (c.t - position) / rate, c.accent);
    each((n) => n.node.schedule({ active: true, input: position, rate, semitones, output: out, ...loopArgs() }));
    emit();
  }
  function pause() {
    if (!playing) return;
    playing = false; cutClicks();
    each((n) => n.node.stop());
    emit();
  }
  function stop() {
    each((n) => n.node.stop());
    playing = false; cutClicks(); fresh = true; position = loop ? loop.start : 0;
    emit();
  }
  function seek(t) {
    fresh = true; cutClicks();
    position = Math.min(Math.max(t, 0), duration);
    if (playing) { anchor = { ctx: ctx.currentTime + 0.02, pos: position, rate }; each((n) => n.node.schedule({ input: position, output: anchor.ctx })); }
    for (const fn of [...seekListeners]) fn(position);
    emit();
  }
  function setRate(r) {
    const next = Math.min(Math.max(r, 0.25), 2);
    if (playing && anchor) { const now = ctx.currentTime; anchor = { ctx: now, pos: anchor.pos + Math.max(0, now - anchor.ctx) * anchor.rate, rate: next }; }
    rate = next; if (playing) each((n) => n.node.schedule({ rate })); emit();
  }
  function setSemitones(s) { semitones = Math.min(Math.max(Math.round(s), -12), 12); if (playing) each((n) => n.node.schedule({ semitones })); emit(); }
  function setLoop(l) {
    loop = l && l.end > l.start ? { start: Math.max(0, l.start), end: Math.min(duration || l.end, l.end) } : null;
    if (playing) each((n) => n.node.schedule(loopArgs())); // the nodes keep playing; only the loop bounds change
    emit();
  }
  function setStem(i, patch) { if (!stems[i]) return; Object.assign(stems[i], patch); applyGains(); emit(); }
  function setMasterVolume(v) { masterVolume = Math.min(Math.max(v, 0), 1.5); applyGains(); emit(); }

  return {
    /** `fn(position)` → { from, clicks: [{ t, accent }], delay? } | null: where a start from rest begins (before the position) and the clicks of the lead-in; `delay` = seconds of count-in before `from` itself (clicks may then have `t` < `from`). */
    setPreRoll(fn) { preRollFn = fn; },
    setClickVolume(v) { clickVolume = Math.max(0, Math.min(1, v)); },
    load, unload, play, pause, stop, seek, setRate, setSemitones, setLoop, setStem, setMasterVolume, state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** `fn(seconds)` each time the position is moved on purpose (a click on the timeline, a jump), not by playing. */
    onSeek(fn) { seekListeners.add(fn); return () => seekListeners.delete(fn); },
    /** `performance.now()` time (ms) at which the recording position `p` is HEARD (output timestamp of the context), or null when not playing. */
    perfOfMedia: (p) => { const c = playing && anchor ? anchor.ctx + (p - anchor.pos) / anchor.rate : null; return c == null ? null : perfOfCtx(c); },
    /** The recording position heard at `performance.now()` time `P` (ms), or null when not playing. */
    mediaAtPerf: (P) => { if (!playing || !anchor) return null; const ref = clockRef(); return anchor.pos + (ref.ctx + (P - ref.perf) / 1000 - anchor.ctx) * anchor.rate; },
    /** Audio-context time at which the recording position `p` is heard (playing, no loop wrap), or null. */
    ctxTimeOf: (p) => (playing && anchor ? anchor.ctx + (p - anchor.pos) / anchor.rate : null),
    attackNear: (t, range) => (energy ? attackNear(energy, t, range) : null),
    peaks: () => peaks, audioContext: () => ctx, destroy: unload,
  };
}

/** Waveform of the whole mix for the timeline: `buckets` values in 0..1 (the loudest sample of each slice, all stems and channels together). */
export function computePeaks(buffers, duration, buckets = 1200) {
  const out = new Float32Array(buckets);
  for (const b of buffers) {
    const len = b.length ?? Math.round(b.duration * b.sampleRate);
    for (let c = 0; c < Math.min(b.numberOfChannels, 2); c += 1) {
      const d = b.getChannelData(c);
      const step = Math.max(1, Math.floor(d.length / buckets));
      for (let i = 0; i < buckets; i += 1) {
        let m = 0;
        for (let k = i * step; k < Math.min(d.length, (i + 1) * step); k += Math.max(1, step >> 6)) { const v = Math.abs(d[k]); if (v > m) m = v; }
        out[i] = Math.min(1, out[i] + m * 0.5);
      }
    }
    void len;
  }
  void duration;
  return out;
}

const ENERGY_HOP = 0.001; // seconds per value of the energy curve

/** Loudness (RMS, all stems and channels together) of every millisecond of the recording: the base of `attackNear`; ≈ 1 MB for a 4-minute song. */
export function computeEnergy(buffers) {
  const rate = buffers[0]?.sampleRate ?? 44100;
  const n = Math.ceil(Math.max(0, ...buffers.map((b) => b.length / b.sampleRate)) / ENERGY_HOP);
  const sum = new Float64Array(n);
  const step = Math.max(1, Math.round(rate * ENERGY_HOP));
  for (const b of buffers) {
    const r = b.sampleRate; const per = Math.max(1, Math.round(r * ENERGY_HOP));
    for (let c = 0; c < Math.min(b.numberOfChannels, 2); c += 1) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i += 1) { let e = 0; const from = i * per; const to = Math.min(d.length, from + per); for (let k = from; k < to; k += 1) e += d[k] * d[k]; sum[i] += e / per; }
    }
  }
  void step;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.sqrt(sum[i]);
  return out;
}

/**
 * The strongest attack (a sudden rise of loudness: 5 ms after against 5 ms before) within ± `range` seconds of `t`: `{ time, offsetMs, ratio }` where `offsetMs` is
 * how much later (+) or earlier (−) than `t` it is, and `ratio` how much stronger it is than the usual attacks of the surrounding 2 seconds (≥ 2: a clear hit;
 * below: nothing reliable to trust). null when the curve does not reach `t`.
 */
export function attackNear(energy, t, range = 0.05) {
  const hop = ENERGY_HOP; const w = 5;
  const rise = (i) => { let a = 0; let b = 0; for (let k = 0; k < w; k += 1) { a += energy[Math.max(0, Math.min(energy.length - 1, i - 1 - k))]; b += energy[Math.max(0, Math.min(energy.length - 1, i + k))]; } return Math.max(0, (b - a) / w); };
  const centre = Math.round(t / hop); if (centre < 0 || centre >= energy.length) return null;
  const span = Math.round(range / hop);
  let best = centre; let top = -1;
  for (let i = Math.max(0, centre - span); i <= Math.min(energy.length - 1, centre + span); i += 1) { const v = rise(i); if (v > top) { top = v; best = i; } }
  let tot = 0; let cnt = 0; const ctx = Math.round(1 / hop);
  for (let i = Math.max(0, centre - ctx); i <= Math.min(energy.length - 1, centre + ctx); i += 5) { tot += rise(i); cnt += 1; }
  const mean = cnt ? tot / cnt : 0;
  return { time: best * hop, offsetMs: Math.round((best * hop - t) * 1000), ratio: mean > 1e-9 ? top / mean : 0 };
}
