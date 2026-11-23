/*
 * The sound of the note component: the SoundFont engine (SpessaSynth in an AudioWorklet) with the small SoundFonts built by tools/make-note-soundfont.mjs.
 * This file is a LAZY chunk: the page only fetches it (and the .sf3 files) at the first tap on ▶, so that opening a note costs nothing. The light engine plays
 * if anything here fails. Nothing is written about the person.
 */
import { SoundFontEngine } from '../audio/soundfont-engine.js';
import { WorkletSynthesizer } from 'spessasynth_lib';
import { familiesOfSequence, soundFile, SINGLE_FILE } from './soundmap.js';

/** The worklet processor of the synth is embedded as text by the build (`__SPESSA_PROCESSOR__`) and started from a Blob URL (a data: URL if the Blob is refused). */
const processorUrls = () => {
  if (typeof __SPESSA_PROCESSOR__ === 'undefined') return ['spessasynth_processor.min.js'];
  const urls = [];
  try { urls.push(URL.createObjectURL(new Blob([__SPESSA_PROCESSOR__], { type: 'text/javascript' }))); } catch { /* no Blob URL */ }
  urls.push(`data:text/javascript;charset=utf-8,${encodeURIComponent(__SPESSA_PROCESSOR__)}`);
  return urls;
};

const files = new Map(); // url → Promise<ArrayBuffer>: a file is downloaded once per page (the service worker / HTTP cache keep it between visits)
function fetchFile(url) {
  if (!files.has(url)) {
    files.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }).catch((e) => { files.delete(url); throw e; }));
  }
  return files.get(url);
}

/**
 * An engine ready to play `sequence`. `mode` 'family' (one small file per family, only what the sequence uses) or 'single' (one file with everything).
 * `previous` = the engine returned before: it is kept when it already holds every family needed, else rebuilt with the union.
 * @returns {Promise<{ engine: SoundFontEngine, families: string[] }>}
 */
export async function soundEngineFor({ context, base, mode = 'family', sequence, previous = null }) {
  const wanted = mode === 'single' ? ['all'] : familiesOfSequence(sequence);
  if (previous && wanted.every((f) => previous.families.includes(f))) return previous;
  const families = [...new Set([...(previous?.families ?? []), ...wanted])].sort();
  const buffers = await Promise.all(families.map((f) => fetchFile(new URL(f === 'all' ? SINGLE_FILE : soundFile(f), base).href)));
  previous?.engine.dispose();
  const engine = new SoundFontEngine({ context });
  await engine.prepare({ WorkletSynthesizer, fonts: buffers.map((data, i) => ({ data: data.slice(0), id: families[i] })), processorUrl: processorUrls() });
  return { engine, families };
}
