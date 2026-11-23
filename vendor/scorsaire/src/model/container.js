/*
 * The `.scorsaire` file as a ZIP (the text file of the plain JSON form stays valid): the score and, for a recording synchronised on screen 4, the audio.
 *   score.json            the work (exactly what a plain `.scorsaire` text file holds)
 *   sync.json             the synchronisation: key, offset, pre-roll, the time map (start, end and beats of each measure), the parts of the form, the volumes of the
 *                         stems, and the list of the media (id, name, role, file) ; `measureIds` = the ids of the measures the map was made for
 *   media/<id>-<name>.<ext>   the audio files, stored as they are (already compressed: never recompressed)
 *   images/<id>.<ext>     the pictures of the blocks (model/assets.js), stored as they are; `images/index.json` = { <id>: { name, mime } }. A file with pictures is a ZIP even without synchronisation.
 *   analysis/<name>.json  the files of the analysis (beats, chords, segments, infos), to import again if needed
 * PURE: bytes and objects. The media never go through the document (no undo, no history).
 */
import { zip } from '../export/zip.js';
import { extOfMime } from './assets.js';
import { zipEntries, zipRead, looksLikeZip } from '../import/mxl.js';
import { validExternal } from './externalmedia.js';

export const SYNC_FORMAT = 'scorsaire-sync';
export const SYNC_VERSION = 1;
const enc = new TextEncoder(); const dec = new TextDecoder();
const baseName = (path) => path.split('/').pop();
const extOf = (name) => (/\.[a-z0-9]+$/i.exec(name)?.[0] ?? '.opus').toLowerCase();
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'audio';

/**
 * @param o.scoreText  the text of the work (`serializeWork`)
 * (mode B also keeps `display` = { lead, fade, showBlocks } and `notes` = the cards and annotations of the banner, see audio/banner.js)
 * @param o.sync       null or { source, key, offsetMs, preRoll, preClick, duration, bpm, measureIds, measures, segments, stems: [{ id, volume, mute }], master, media: [{ id, name, role, ext?, bytes }], analysis: { infos, beats, chords, segments } }
 * @returns {Promise<Uint8Array>} the archive
 */
export async function buildScorsaireArchive({ scoreText, sync = null, images = [] }) {
  const files = [{ name: 'score.json', data: enc.encode(scoreText) }];
  if (images.length) {
    const index = {};
    for (const im of images) {
      index[im.id] = { name: im.name ?? '', mime: im.mime };
      files.push({ name: `images/${im.id}.${extOfMime(im.mime)}`, data: im.bytes, store: true });
    }
    files.push({ name: 'images/index.json', data: enc.encode(JSON.stringify(index)) });
  }
  if (sync) {
    const media = sync.media.map((m) => (m.external
      ? { id: m.id, name: m.name, role: m.role, external: m.external } // kept elsewhere: nothing of it in the ZIP (model/externalmedia.js)
      : { id: m.id, name: m.name, role: m.role, file: `media/${m.id}-${safe(m.name)}${m.ext ?? extOf(m.fileName ?? m.name)}` }));
    const info = {
      format: SYNC_FORMAT, version: SYNC_VERSION, source: sync.source ?? 'audio', key: sync.key, offsetMs: sync.offsetMs ?? 0, preRoll: sync.preRoll ?? 0, preClick: sync.preClick !== false,
      duration: sync.duration, bpm: sync.bpm ?? null, measureIds: sync.measureIds ?? [], measures: sync.measures ?? [], order: Array.isArray(sync.order) ? sync.order : null, youtube: sync.youtube ?? null, placements: sync.placements ?? null, scoreSound: sync.scoreSound === true, ...(sync.instruments === true ? { instruments: true } : {}), ...(sync.chords && typeof sync.chords === 'object' ? { chords: { pool: typeof sync.chords.pool === 'string' ? sync.chords.pool : 'reader', ...(sync.chords.variants === 'all' ? { variants: 'all' } : {}) } } : {}), display: sync.display ?? null, reader: sync.reader ?? null, styles: sync.styles ?? null, notes: sync.notes ?? null, segments: sync.segments ?? [], stems: sync.stems ?? [], master: sync.master ?? 1, media,
    };
    files.push({ name: 'sync.json', data: enc.encode(JSON.stringify(info)) });
    sync.media.forEach((m, i) => { if (!m.external) files.push({ name: media[i].file, data: m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes), store: true }); });
    for (const [name, data] of Object.entries(sync.analysis ?? {})) if (data != null && !(Array.isArray(data) && !data.length)) files.push({ name: `analysis/${name}.json`, data: enc.encode(JSON.stringify(data)) });
  }
  return zip(files, { compress: true });
}

/** True for the ZIP form of a Scorsaire file (a `score.json` inside). */
export function isScorsaireArchive(bytes) {
  if (!looksLikeZip(bytes)) return false;
  try { return zipEntries(bytes).some((e) => e.name === 'score.json'); } catch { return false; }
}

/** @returns {Promise<{ images: { id, name, mime, bytes }[], scoreText: string, sync: null | { info: object, media: { id, name, role, bytes: ArrayBuffer }[], analysis: object } }>} */
export async function readScorsaireArchive(bytes) {
  const entries = zipEntries(bytes);
  const find = (name) => entries.find((e) => e.name === name);
  const score = find('score.json');
  if (!score) throw new Error('Not a Scorsaire archive (no score.json)');
  const scoreText = dec.decode(await zipRead(bytes, score));
  const images = [];
  const indexEntry = find('images/index.json');
  if (indexEntry) {
    const index = JSON.parse(dec.decode(await zipRead(bytes, indexEntry)));
    for (const [id, meta] of Object.entries(index)) {
      const e = entries.find((x) => x.name.startsWith(`images/${id}.`));
      if (e && typeof meta?.mime === 'string') images.push({ id, name: meta.name ?? '', mime: meta.mime, bytes: await zipRead(bytes, e) });
    }
  }
  const syncEntry = find('sync.json');
  if (!syncEntry) return { scoreText, sync: null, images };
  const info = JSON.parse(dec.decode(await zipRead(bytes, syncEntry)));
  if (info.format !== SYNC_FORMAT) throw new Error('Unknown synchronisation data');
  const media = [];
  for (const m of info.media ?? []) {
    const e = m.file ? find(m.file) : null;
    if (!e && validExternal(m.external)) { media.push({ id: m.id, name: m.name, role: m.role, bytes: null, external: m.external }); continue; } // the audio is kept elsewhere
    if (!e) continue;
    const raw = await zipRead(bytes, e);
    media.push({ id: m.id, name: m.name, role: m.role, bytes: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) });
  }
  const analysis = {};
  for (const e of entries) if (e.name.startsWith('analysis/') && e.name.endsWith('.json')) analysis[baseName(e.name).replace(/\.json$/, '')] = JSON.parse(dec.decode(await zipRead(bytes, e)));
  return { scoreText, sync: { info, media, analysis }, images };
}
