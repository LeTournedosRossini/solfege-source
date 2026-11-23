/*
 * Reads the archive of an analysed song (a ZIP): the All-in-One files (beats, chords, segments, infos) and the audio (the stems, the original mix).
 * PURE: bytes in, parsed objects and audio bytes out. The score is built by `importAllInOne`; the audio goes to the stem player.
 */
import { zipEntries, zipRead, looksLikeZip, MxlError } from './mxl.js';
import { adaptSingleFileAnalysis, isSingleFileAnalysis } from './allinone-single.js';
import { syllablesFromNewFormat, wordsFromFlat } from './lyrics-times.js';

const AUDIO = /\.(opus|ogg|oga|mp3|m4a|aac|wav|flac|webm)$/i;
const baseName = (path) => path.split('/').pop();
const stem = (name) => name.replace(/\.[^.]+$/, '');

const SINGLE_FILE = /(^|[_\-. ])metadonnees\.json$/i;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the bytes are a ZIP that holds a beat map: `beats.json` (several files) or `<song>_metadonnees.json` (a single file, see allinone-single.js). */
export function isAllInOneArchive(bytes) {
  if (!looksLikeZip(bytes)) return false;
  try {
    const entries = zipEntries(bytes);
    if (entries.some((e) => e.name === 'score.json')) return false; // the ZIP form of a Scorsaire file also holds analysis/beats.json
    return entries.some((e) => baseName(e.name).toLowerCase() === 'beats.json' || SINGLE_FILE.test(baseName(e.name)));
  } catch { return false; }
}

/** @returns {Promise<{ analysis: { infos, beats, chords, segments }, stems: { name: string, bytes: ArrayBuffer }[], original: { name: string, bytes: ArrayBuffer } | null }>} */
export async function readAllInOneArchive(bytes) {
  const entries = zipEntries(bytes).filter((e) => !e.name.endsWith('/') && !baseName(e.name).startsWith('.') && !e.name.includes('__MACOSX'));
  const find = (name) => entries.find((e) => baseName(e.name).toLowerCase() === name);
  const json = async (name) => {
    const e = find(name);
    return e ? JSON.parse(new TextDecoder().decode(await zipRead(bytes, e))) : undefined;
  };
  const copy = async (e) => { const raw = await zipRead(bytes, e); return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); };
  const audioEntries = entries.filter((e) => AUDIO.test(e.name));
  const stems = []; let original = null;
  let analysis;
  const beats = await json('beats.json');
  if (Array.isArray(beats)) {
    analysis = { beats, chords: (await json('chords.json')) ?? [], segments: (await json('segments.json')) ?? [], infos: (await json('infos.json')) ?? {} };
    const lyrics = syllablesFromNewFormat(await json('lyrics_new_format.json').catch(() => undefined)) ?? wordsFromFlat(await json('lyrics.json').catch(() => undefined)); // syllables when the archive has them, else words
    if (lyrics) analysis.lyrics = lyrics;
    for (const e of audioEntries) {
      const name = baseName(e.name);
      const inStems = /(^|\/)stems?\//i.test(e.name);
      if (inStems) stems.push({ name: stem(name), bytes: await copy(e) });
      else if (/^original\./i.test(name) || (!original && !/^stems?$/i.test(stem(name)))) original = original ?? { name: stem(name), bytes: await copy(e) };
    }
  } else {
    // the single-file form: one JSON, and the stems next to it, named `<song>_<stem>.<ext>` (the stem names are listed in the JSON, `pistes`)
    const metaEntry = entries.find((e) => SINGLE_FILE.test(baseName(e.name)));
    if (!metaEntry) throw new MxlError('The archive holds no beat map (beats.json or a *_metadonnees.json file)');
    let source;
    try { source = JSON.parse(new TextDecoder().decode(await zipRead(bytes, metaEntry))); } catch { throw new MxlError('The analysis file of the archive cannot be read'); }
    if (!isSingleFileAnalysis(source)) throw new MxlError('The analysis file of the archive holds no beat map (structure.beats)');
    analysis = adaptSingleFileAnalysis(source);
    const names = Array.isArray(source.pistes) ? source.pistes.map(String).filter(Boolean) : [];
    for (const e of audioEntries) {
      const name = baseName(e.name);
      const piste = names.find((n) => new RegExp(`(^|[_\\-. ])${escapeRegExp(n)}\\.[^.]+$`, 'i').test(name)) ?? (names.length ? null : stem(name).split('_').pop());
      if (piste && (names.length || /_/.test(stem(name)))) stems.push({ name: piste, bytes: await copy(e) });
      else if (!original) original = { name: stem(name), bytes: await copy(e) };
    }
  }
  stems.sort((a, b) => a.name.localeCompare(b.name));
  return { analysis, stems, original };
}
