/*
 * Performance probe: measures where the time goes (layout, SVG text, insertion in the page, painting, hit index, audio sequence, frames) on a REAL score.
 * OFF by default and free when off: every entry point starts with one boolean test, nothing is recorded, no observer exists. It is switched on by `?perf` in the
 * address (or `#perf`), or by `localStorage['scorsaire.perf'] = '1'`, and only by main.js (the web component and the readers never start it).
 * Nothing here touches the Document or changes what is drawn. Results: `scorsairePerf.report()` in the console, the panel (panel.js), the "Timings" track of the
 * Chrome Performance recording (each span is also a `performance.measure`), and a JSON that can be pasted into a conversation.
 */

const CAP = 2000; // samples kept per name (the oldest are dropped): enough for a long session, bounded in memory

/** count, mean, p50, p95, max, last, total of a list of numbers. */
export function summarize(values) {
  const n = values.length;
  if (!n) return { count: 0, total: 0, mean: 0, p50: 0, p95: 0, max: 0, last: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const total = values.reduce((s, v) => s + v, 0);
  return { count: n, total, mean: total / n, p50: at(0.5), p95: at(0.95), max: sorted[n - 1], last: values[n - 1] };
}

const round = (v) => Math.round(v * 100) / 100;

export function createProbe({ now = () => performance.now(), measure = null, raf = null, after = null } = {}) {
  /** @type {Map<string, { unit: string, values: number[] }>} */
  let samples = new Map();
  let frames = { count: 0, slow: 0, verySlow: 0, max: 0, sum: 0 }; // gaps between animation frames (smoothness)
  let longFrames = []; // the last long animation frames, with the scripts that made them long
  const series = []; // closed series { label, stats, frames }
  let started = false;
  let stopFrames = null;

  const probe = {
    /** true = recording. A plain field: the callers test it before doing any work. */
    on: false,

    add(name, value, unit = 'ms') {
      if (!probe.on || !Number.isFinite(value)) return;
      let s = samples.get(name);
      if (!s) { s = { unit, values: [] }; samples.set(name, s); }
      s.values.push(value);
      if (s.values.length > CAP) s.values.shift();
    },

    /** Runs `fn`, records its duration under `name`, returns its result (also when it throws). */
    span(name, fn) {
      if (!probe.on) return fn();
      const t0 = now();
      try { return fn(); } finally { probe.endSpan(name, t0); }
    },

    /** `const end = probe.begin('x'); …; end()`: for code that is not one function call. */
    begin(name) {
      if (!probe.on) return noop;
      const t0 = now();
      return () => probe.endSpan(name, t0);
    },

    endSpan(name, t0) {
      const t1 = now();
      probe.add(name, t1 - t0);
      if (measure && t1 - t0 >= 1) measure(name, t0, t1); // shows in the Timings track of the Chrome recording
    },

    /** Time from `t0` to the moment the browser has painted what was changed since (next frame + one task): the part no JS timer can see. */
    afterPaint(name, t0) {
      if (!probe.on || !raf || (typeof document !== 'undefined' && document.hidden)) return; // a hidden page does not paint: the wait would be meaningless
      raf(() => (after ?? setTimeout)(() => { probe.add(name, now() - t0); if (measure) measure(name, t0, now()); }, 0));
    },

    reset() { samples = new Map(); frames = { count: 0, slow: 0, verySlow: 0, max: 0, sum: 0 }; longFrames = []; },

    stats() {
      const out = {};
      for (const [name, s] of samples) out[name] = { unit: s.unit, ...Object.fromEntries(Object.entries(summarize(s.values)).map(([k, v]) => [k, round(v)])) };
      return out;
    },

    framesInfo() {
      const f = frames;
      return { frames: f.count, slow: f.slow, verySlow: f.verySlow, maxGap: round(f.max), meanGap: f.count ? round(f.sum / f.count) : 0, longFrames: longFrames.slice(-10) };
    },

    /** Closes the current series under `label` and starts a new one: one series per gesture measured (e.g. "click on a measure"). */
    closeSeries(label) {
      series.push({ label: String(label || `#${series.length + 1}`), stats: probe.stats(), ...probe.framesInfo() });
      probe.reset();
      return series[series.length - 1];
    },

    series: () => series.slice(),
    clearSeries() { series.length = 0; },

    /** Everything as one object, ready to be pasted: environment, closed series, current series. */
    json(extra = {}) {
      return { env: environment(), ...extra, series: probe.series(), current: { stats: probe.stats(), ...probe.framesInfo() } };
    },

    /** Console table (sorted by total time). Returns the same rows. */
    report() {
      const rows = Object.entries(probe.stats()).sort((a, b) => b[1].total - a[1].total).map(([name, s]) => ({ name, unit: s.unit, count: s.count, mean: s.mean, p50: s.p50, p95: s.p95, max: s.max, last: s.last, total: s.total }));
      if (typeof console !== 'undefined') { console.table(rows); console.log('frames', probe.framesInfo()); }
      return rows;
    },

    /** Switches the probe on and installs the browser observers (once). */
    enable() {
      probe.on = true;
      if (!started) { started = true; startObservers(); }
      return probe;
    },

    disable() { probe.on = false; stopFrames?.(); stopFrames = null; started = false; return probe; },
  };

  function startObservers() {
    if (typeof PerformanceObserver === 'undefined') return;
    const watch = (type, handler, extra = {}) => {
      try { new PerformanceObserver((list) => { if (probe.on) for (const e of list.getEntries()) handler(e); }).observe({ type, buffered: false, ...extra }); } catch { /* this browser does not know that entry type */ }
    };
    // from the gesture to the next paint (Event Timing API; durations are rounded to 8 ms by the browser, and only those over 16 ms are reported)
    watch('event', (e) => probe.add(`input:${e.name}`, e.duration), { durationThreshold: 16 });
    // frames that took more than 50 ms, with the scripts responsible (Long Animation Frames; Chrome)
    let hasLoaf = false;
    watch('long-animation-frame', (e) => {
      hasLoaf = true;
      probe.add('frame:long', e.duration);
      probe.add('frame:blocking', e.blockingDuration ?? 0);
      longFrames.push({ duration: round(e.duration), blocking: round(e.blockingDuration ?? 0), scripts: (e.scripts ?? []).slice(0, 3).map((s) => ({ fn: s.sourceFunctionName || s.invoker || '', ms: round(s.duration), src: String(s.sourceURL || '').split('/').pop().slice(0, 40) })) });
      if (longFrames.length > 30) longFrames.shift();
    });
    watch('longtask', (e) => { if (!hasLoaf) probe.add('task:long', e.duration); });
    if (raf) {
      let last = 0; let alive = true;
      const step = (t) => {
        if (!alive) return;
        if (last && probe.on) {
          const gap = t - last;
          if (gap < 1000) { frames.count++; frames.sum += gap; if (gap > frames.max) frames.max = gap; if (gap > 25) frames.slow++; if (gap > 50) frames.verySlow++; } // > 1 s = the tab was hidden
        }
        last = t; raf(step);
      };
      raf(step);
      stopFrames = () => { alive = false; };
    }
  }

  return probe;
}

const noop = () => {};

function environment() {
  if (typeof navigator === 'undefined') return {};
  const w = typeof window !== 'undefined' ? window : {};
  return { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory, pixelRatio: w.devicePixelRatio, viewport: w.innerWidth ? `${w.innerWidth}x${w.innerHeight}` : undefined, date: new Date().toISOString(), css: perfCss() };
}

/** The rendering experiments switched on in the address (`?perf&perfcss=contain,willchange,speed`): a list of names, empty when none. Only read when the probe is on. */
export function perfCss() {
  if (typeof location === 'undefined') return [];
  const m = /(?:[?&#])perfcss=([\w,-]*)/.exec(`${location.search}${location.hash}`);
  return m ? m[1].split(',').filter(Boolean) : [];
}

/** The probe of the page. Off until `enableFromAddress()` finds the switch. */
export const perf = createProbe({
  measure: typeof performance !== 'undefined' && typeof performance.measure === 'function' ? (name, t0, t1) => { try { performance.measure(name, { start: t0, end: t1 }); } catch { /* old browser: the numbers are still kept */ } } : null,
  raf: typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : null,
});

/** Switches `perf` on when the address has `perf` (query or hash) or the device has asked for it; makes it reachable as `window.scorsairePerf`. Returns true when on. */
export function enableFromAddress(storage = null) {
  if (typeof location === 'undefined') return false;
  let flag = /(^|[?&#])perf(=1|=true|&|$)/.test(`${location.search}${location.hash}`);
  if (!flag) { try { flag = (storage ?? window.localStorage)?.getItem('scorsaire.perf') === '1'; } catch { /* no storage: the address is the only switch */ } }
  if (!flag) return false;
  perf.enable();
  window.scorsairePerf = perf;
  return true;
}
