/*
 * Audio engine manager: which engine plays (the light oscillator engine, always available, or the SoundFont engine) and which SoundFont it uses.
 * The choice is a user preference (`audio` section), never part of the score. No DOM: the browser pieces are injected.
 *
 * A switch is safe: the light engine keeps playing until the SoundFont engine is READY (font downloaded or read from the cache, worklet started,
 * bank loaded); any failure (no network, bad file, no AudioWorklet) leaves the light engine in place and reports the error.
 */
import { BUILTIN_FONTS, downloadFont, looksLikeSoundFont, userFontId } from './fonts.js';

/** Default level after the synth: the faders sit at 100/127 (about -2 dB) to leave headroom, this gives it back. */
export const DEFAULT_OUTPUT_DB = 2;
/** The SF3 (9 MB) is the default bank: the SoundFont engine starts at launch with it; the light engine plays until it is ready (or when it cannot load). */
export const DEFAULT_FONT_ID = 'generaluser-gs-sf3';
export const DEFAULT_AUDIO_PREFERENCE = Object.freeze({ engine: 'soundfont', fontId: DEFAULT_FONT_ID, fonts: [], outputDb: DEFAULT_OUTPUT_DB });

/**
 * @param preferences  store with get(name) / set(name, value) (`preferences-store.js`)
 * @param store        font cache (`fonts.js`)
 * @param makeLight    () → light engine
 * @param makeSoundFont () → SoundFontEngine
 * @param loadLibrary  async () → { WorkletSynthesizer, processorUrl }
 * @param onEngine     (engine, oldEngine) → void: the player uses the new engine
 * @param fetchImpl    fetch
 * @param soundFontAvailable () → boolean: AudioWorklet is usable here
 */
export function createEngineManager({ preferences, store, makeLight, makeSoundFont, loadLibrary, onEngine = () => {}, fetchImpl = globalThis.fetch, soundFontAvailable = () => true }) {
  const listeners = new Set();
  let light = makeLight();
  let current = light;
  let masterPanValue = 0; // the master pan of the open work (see `setMasterPan`)
  let active = 'light';
  const state = { active: 'light', requested: 'light', fontId: null, status: 'idle', progress: null, error: null };
  let token = 0; // a newer request cancels the effect of an older one

  const pref = () => ({ ...DEFAULT_AUDIO_PREFERENCE, ...(preferences.get('audio') ?? {}) });
  const save = (patch) => preferences.set('audio', { ...pref(), ...patch });
  const emit = () => { const snapshot = { ...state }; for (const l of listeners) l(snapshot); };
  const set = (patch) => { Object.assign(state, patch); emit(); };

  /** Fonts the user can pick: the built-in ones, then those added (metadata). */
  function fonts() {
    const user = (pref().fonts ?? []).filter((f) => !BUILTIN_FONTS.some((b) => b.id === f.id));
    return [...BUILTIN_FONTS, ...user.map((f) => ({ ...f, builtin: false }))];
  }
  const fontById = (id) => fonts().find((f) => f.id === id) ?? null;

  /** Cache state of each font: Map(id → bytes cached). */
  async function cached() {
    const out = new Map();
    for (const f of fonts()) if (await store.has(f.id)) out.set(f.id, true);
    return out;
  }

  async function dataOf(font, mine) {
    const hit = await store.get(font.id);
    if (hit?.data) return hit.data;
    if (!font.url) throw Object.assign(new Error('No file for this font: pick it from a file'), { code: 'nofile' });
    const data = await downloadFont(font.url, { fetchImpl, onProgress: (p) => { if (mine === token) set({ progress: p }); } });
    await store.put(font.id, data, { name: font.name, source: font.url });
    return data;
  }

  /** Makes `engineId` the active engine (with `fontId` for the SoundFont engine). Resolves to the final state; never throws. */
  async function select({ engine: engineId, fontId }) {
    const mine = ++token;
    if (engineId === 'light') {
      save({ engine: 'light' });
      useEngine(light, 'light');
      set({ requested: 'light', status: 'idle', progress: null, error: null, fontId: pref().fontId });
      return { ...state };
    }
    const id = fontId ?? pref().fontId ?? DEFAULT_FONT_ID;
    const font = id ? fontById(id) : null;
    save({ engine: 'soundfont', fontId: id });
    set({ requested: 'soundfont', fontId: id, status: 'loading', progress: 0, error: null });
    try {
      if (!soundFontAvailable()) throw Object.assign(new Error('AudioWorklet is not available'), { code: 'unsupported' });
      if (!font) throw Object.assign(new Error('No SoundFont chosen'), { code: 'nofile' });
      const data = await dataOf(font, mine);
      if (mine !== token) return { ...state };
      set({ progress: null });
      const { WorkletSynthesizer, processorUrl } = await loadLibrary();
      const engine = makeSoundFont();
      await engine.prepare({ WorkletSynthesizer, font: data, processorUrl });
      if (mine !== token) { engine.dispose?.(); return { ...state }; }
      useEngine(engine, 'soundfont');
      set({ status: 'ready', error: null });
    } catch (e) {
      if (mine !== token) return { ...state };
      useEngine(light, 'light');
      set({ status: 'error', progress: null, error: e?.code ?? 'failed', message: e?.message ?? String(e) });
    }
    return { ...state };
  }

  function useEngine(engine, id) {
    if (engine === current) { active = id; state.active = id; return; }
    const old = current;
    current = engine; active = id; state.active = id;
    engine.setOutputGain?.(pref().outputDb);
    engine.setMasterPan?.(masterPanValue);
    onEngine(engine, old);
    if (old !== light) old.dispose?.();
  }

  /** Reads a SoundFont file picked by the user, caches it and adds it to the list → its id. */
  async function addFile(name, data) {
    if (!looksLikeSoundFont(data)) throw Object.assign(new Error('Not a SoundFont file'), { code: 'format' });
    const id = userFontId(name, data.byteLength);
    await store.put(id, data, { name });
    const others = (pref().fonts ?? []).filter((f) => f.id !== id);
    save({ fonts: [...others, { id, name: name.replace(/\.(sf2|sf3)$/i, ''), url: null, size: data.byteLength }] });
    emit();
    return id;
  }

  /** Adds a font by address (downloaded now, cached) → its id. */
  async function addUrl(url, name = '') {
    const clean = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(clean)) throw Object.assign(new Error('An http(s) address is needed'), { code: 'url' });
    set({ status: 'loading', progress: 0, error: null });
    try {
      const data = await downloadFont(clean, { fetchImpl, onProgress: (p) => set({ progress: p }) });
      const label = name.trim() || decodeURIComponent(clean.split('/').pop() || 'font').replace(/\.(sf2|sf3)$/i, '');
      const id = userFontId(label, data.byteLength);
      await store.put(id, data, { name: label, source: clean });
      const others = (pref().fonts ?? []).filter((f) => f.id !== id);
      save({ fonts: [...others, { id, name: label, url: clean, size: data.byteLength }] });
      set({ status: state.active === 'soundfont' ? 'ready' : 'idle', progress: null });
      return id;
    } catch (e) {
      set({ status: 'error', progress: null, error: e?.code ?? 'failed', message: e?.message ?? String(e) });
      throw e;
    }
  }

  /** Forgets a font: removes its bytes from the cache and, for a user font, from the list. The font in use cannot be removed. */
  async function remove(id) {
    if (state.active === 'soundfont' && state.fontId === id) throw Object.assign(new Error('This font is in use'), { code: 'inuse' });
    await store.delete(id);
    const font = fontById(id);
    if (font && !font.builtin) save({ fonts: (pref().fonts ?? []).filter((f) => f.id !== id) });
    if (pref().fontId === id) save({ fontId: null });
    emit();
  }

  /** At launch: applies the saved choice (the light engine plays meanwhile). */
  async function init() {
    const p = pref();
    current.setOutputGain?.(p.outputDb);
    state.fontId = p.fontId; state.requested = p.engine;
    if (p.engine === 'soundfont') return select({ engine: 'soundfont', fontId: p.fontId });
    emit();
    return { ...state };
  }

  return {
    state: () => ({ ...state }),
    /** The bytes of the SoundFont of the active SoundFont engine, in the engine's `fonts` format ([] when the light engine is active); read again from the store each call (a copy the caller may hand over). */
    async activeFontData() {
      if (active !== 'soundfont') return [];
      const font = fontById(pref().fontId);
      if (!font) return [];
      return [{ data: await dataOf(font, token), id: 'main' }];
    },
    current: () => current,
    fonts, fontById, cached, select, addFile, addUrl, remove, init,
    /** Output level after the synth in dB (-24..+12): saved in the preferences (a device setting) and applied to the current and the next engines. */
    /** The master pan of the work (−1 … +1): kept here so that an engine that replaces the playing one gets it too. */
    setMasterPan: (v) => { masterPanValue = Number.isFinite(v) ? v : 0; current.setMasterPan?.(masterPanValue); },
    outputDb: () => pref().outputDb,
    /** Reduction of the output limiter of the current engine in dB (0 = not acting). */
    limiterReduction: () => current.limiterReduction?.() ?? 0,
    /** Largest sample (0 … 1) of what the current engine sends to the output right now, and the state of its audio context (the sound test). */
    outputPeak: () => current.outputPeak?.() ?? 0,
    contextState: () => current.contextState?.() ?? 'none',
    setOutputDb(db) {
      const v = Math.min(12, Math.max(-24, Math.round((Number.isFinite(db) ? db : 0) * 2) / 2));
      save({ outputDb: v });
      current.setOutputGain?.(v);
      return v;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    preference: pref,
  };
}
