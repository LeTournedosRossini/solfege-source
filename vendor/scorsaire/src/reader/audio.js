/*
 * The sound of the reader: the same engines as the editor (light oscillators, then the SoundFont synth once its file is ready), chosen the same way by the
 * engine manager. The SoundFont is GeneralUser GS in its light form (SF3, about 9 MB, hosted by Jean on GitHub Pages: a quarter of the 32 MB SF2), downloaded at the
 * first visit, then kept in the browser's cache (IndexedDB, asked to be persistent so that a tablet does not forget it). Nothing is ever written about the person: the preferences live in memory.
 */
import { createWebAudioEngine, webAudioAvailable } from '../audio/webaudio.js';
import { NullAudioEngine } from '../audio/engine.js';
import { SoundFontEngine } from '../audio/soundfont-engine.js';
import { createEngineManager } from '../audio/engine-manager.js';
import { createIndexedDbFontStore, createLazyFontStore, BUILTIN_FONTS } from '../audio/fonts.js';
import { createPreferencesStore } from '../ui/preferences-store.js';
import { WorkletSynthesizer } from 'spessasynth_lib';

/** The worklet processor of the synth is embedded as text by the build (`__SPESSA_PROCESSOR__`) and started from a Blob URL (a data: URL if the Blob is refused). */
const processorUrls = () => {
  if (typeof __SPESSA_PROCESSOR__ === 'undefined') return ['spessasynth_processor.min.js'];
  const urls = [];
  try { urls.push(URL.createObjectURL(new Blob([__SPESSA_PROCESSOR__], { type: 'text/javascript' }))); } catch { /* no Blob URL */ }
  urls.push(`data:text/javascript;charset=utf-8,${encodeURIComponent(__SPESSA_PROCESSOR__)}`);
  return urls;
};

/** The bank of the readers: the SF3 of GeneralUser GS (the first of the catalogue is the 32 MB SF2, left to the editor). */
const READER_FONT = BUILTIN_FONTS.find((f) => f.id === 'generaluser-gs-sf3') ?? BUILTIN_FONTS[0];

/** → { getEngine(), available, onStatus(fn) → off, start(), warm(sequence) }. `start()` asks for the SoundFont (the light engine plays until it is ready); `warm` asks the SoundFont engine to prepare the sounds of a sequence before ▶ (see `SoundFontEngine.warm`). */
export function createReaderAudio() {
  const available = webAudioAvailable();
  let engine = available ? createWebAudioEngine() : new NullAudioEngine();
  const wanted = []; // the sequences whose sounds are to be warmed: kept so that the SoundFont engine, which comes later than the light one, warms them too
  const WANTED_MAX = 80;
  const priorities = new Set(); // the sequences asked with `priority`: the SoundFont engine, when it arrives, prepares them first
  const preferences = createPreferencesStore({}, { storage: null });
  const manager = available ? createEngineManager({
    preferences, store: createLazyFontStore(createIndexedDbFontStore()),
    makeLight: () => engine, makeSoundFont: () => new SoundFontEngine(),
    loadLibrary: async () => ({ WorkletSynthesizer, processorUrl: processorUrls() }),
    onEngine: (next) => { engine = next; for (const seq of wanted) next.warm?.(seq, { priority: priorities.has(seq) }); },
    soundFontAvailable: () => typeof AudioWorkletNode !== 'undefined',
  }) : null;
  let started = false;
  return {
    available,
    getEngine: () => engine,
    warm(sequence, options = {}) {
      if (!sequence) return;
      if (wanted.includes(sequence)) { if (options.priority) { priorities.add(sequence); engine.warm?.(sequence, options); } return; }
      if (wanted.length >= WANTED_MAX) return;
      wanted.push(sequence); if (options.priority) priorities.add(sequence); engine.warm?.(sequence, options);
    },
    /** True while the sounds asked with `priority` are being prepared (only the SoundFont engine prepares anything). */
    warming: () => (engine.warmWaiting ?? 0) > 0,
    onStatus: (fn) => (manager ? manager.subscribe(fn) : () => {}),
    start() { if (started) return Promise.resolve(null); started = true; try { navigator.storage?.persist?.(); } catch { /* best effort */ } if (manager) { preferences.set('audio', { engine: 'soundfont', fontId: READER_FONT.id }); return manager.init(); } return Promise.resolve(null); },
  };
}
