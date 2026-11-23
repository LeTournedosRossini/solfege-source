/*
 * SoundFont files: catalogue, validation, download with progress and a cache in the browser (IndexedDB). No DOM here (every browser API is injected),
 * so the logic runs under Node. The data never goes into the score file or the preferences: only the metadata of the fonts the user added
 * is a preference (`audio` section); the bytes live in the cache.
 */

/**
 * Fonts offered by default. `url` = where the file is downloaded from at launch when it is not cached yet; null = the user picks the file.
 * GeneralUser GS asks not to link to the author's own download files, so the default is Jean's own copy (a fork of the original repository, served by
 * GitHub Pages with `access-control-allow-origin: *`; checked 18/10/2026: HTTP 200, 32 319 396 bytes, RIFF/sfbk header).
 */
export const BUILTIN_FONTS = Object.freeze([
  Object.freeze({
    id: 'generaluser-gs', name: 'GeneralUser GS', url: 'https://letournedosrossini.github.io/GeneralUser-GS/GeneralUser-GS.sf2', sizeMB: 32, builtin: true,
    license: 'GeneralUser GS License v2.0 (free for any use, modification and packaging allowed; the author cannot guarantee the origin of every sample)',
    source: 'https://www.schristiancollins.com',
  }),
  // the same bank with its samples recoded in Ogg Vorbis (SF3, tools/make-full-soundfont.mjs): about a quarter of the download, a little less detail in the noisy sounds (cymbals…)
  Object.freeze({
    id: 'generaluser-gs-sf3', name: 'GeneralUser GS (SF3)', url: 'https://letournedosrossini.github.io/scorsaire-lecteur/sons/GeneralUser-GS.sf3', sizeMB: 9, builtin: true,
    license: 'GeneralUser GS License v2.0 (modification and redistribution allowed); samples recoded in Ogg Vorbis by Scorsaire',
    source: 'https://www.schristiancollins.com',
  }),
  // the sound bank of MuseScore 4 (« MS Basic », a lighter MuseScore_General), copied unchanged with its licence: richer instruments, 51 MB, for a computer
  Object.freeze({
    id: 'ms-basic', name: 'MS Basic (MuseScore 4)', url: 'https://letournedosrossini.github.io/scorsaire-lecteur/sons/MS-Basic.sf3', sizeMB: 51, builtin: true,
    license: 'MIT licence (Frank Wen, Michael Cowgill, S. Christian Collins, Ethan Winer, Michael Schorsch), copied unchanged from MuseScore',
    source: 'https://github.com/musescore/MuseScore',
  }),
]);

/** True when the bytes look like a SoundFont 2 / 3 file (RIFF container of type `sfbk`). */
export function looksLikeSoundFont(buffer) {
  if (!buffer || buffer.byteLength < 12) return false;
  const b = new Uint8Array(buffer, 0, 12);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  return tag(0) === 'RIFF' && tag(8) === 'sfbk';
}

/** Identifier for a font added by the user (stable for a name + size, so adding the same file twice replaces it). */
export function userFontId(name, size) {
  const slug = String(name).toLowerCase().replace(/\.(sf2|sf3)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'font';
  return `user-${slug}-${size}`;
}

/** Cache in memory (tests, and fallback when IndexedDB is unavailable: nothing survives a reload). */
export function createMemoryFontStore() {
  const map = new Map();
  return {
    persistent: false,
    async get(id) { return map.get(id) ?? null; },
    async put(id, data, meta = {}) { map.set(id, { data, size: data.byteLength, date: Date.now(), ...meta }); },
    async delete(id) { map.delete(id); },
    async has(id) { return map.has(id); },
    async list() { return [...map].map(([id, v]) => ({ id, size: v.size, date: v.date })); },
  };
}

/** Cache in IndexedDB (`factory` = `indexedDB`). Falls back to the memory store when it cannot be opened. */
export async function createIndexedDbFontStore(factory = globalThis.indexedDB) {
  if (!factory) return createMemoryFontStore();
  const open = () => new Promise((resolve, reject) => {
    const req = factory.open('scorsaire-fonts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fonts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  let db;
  try { db = await open(); } catch { return createMemoryFontStore(); }
  const tx = (mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction('fonts', mode);
    const store = t.objectStore('fonts');
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return {
    persistent: true,
    get: (id) => tx('readonly', (s) => s.get(id)).then((v) => v ?? null),
    put: (id, data, meta = {}) => tx('readwrite', (s) => s.put({ data, size: data.byteLength, date: Date.now(), ...meta }, id)),
    delete: (id) => tx('readwrite', (s) => s.delete(id)),
    has: (id) => tx('readonly', (s) => s.count(id)).then((n) => n > 0),
    list: () => tx('readonly', (s) => s.getAll()).then(async () => {
      const keys = await tx('readonly', (s) => s.getAllKeys());
      const vals = await tx('readonly', (s) => s.getAll());
      return keys.map((id, i) => ({ id, size: vals[i]?.size ?? 0, date: vals[i]?.date ?? 0 }));
    }),
  };
}

/**
 * Downloads a font with progress. `fetchImpl` = fetch. Resolves to an ArrayBuffer; rejects with an Error whose `code` is `network` (no answer or an
 * error status) or `format` (not a SoundFont).
 */
export async function downloadFont(url, { fetchImpl = globalThis.fetch, onProgress = () => {}, signal } = {}) {
  let response;
  try { response = await fetchImpl(url, { signal }); } catch (e) { throw Object.assign(new Error(`Download failed: ${e.message}`), { code: 'network' }); }
  if (!response.ok) throw Object.assign(new Error(`Download failed: HTTP ${response.status}`), { code: 'network' });
  const total = Number(response.headers?.get?.('content-length')) || 0;
  let buffer;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = []; let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.byteLength;
      onProgress(total ? Math.min(1, received / total) : null, received);
    }
    const all = new Uint8Array(received);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    buffer = all.buffer;
  } else buffer = await response.arrayBuffer();
  if (!looksLikeSoundFont(buffer)) throw Object.assign(new Error('Not a SoundFont file'), { code: 'format' });
  onProgress(1, buffer.byteLength);
  return buffer;
}

/** A store usable at once while the real one (a promise) is still opening. */
export function createLazyFontStore(opening) {
  const call = (name) => (...args) => opening.then((s) => s[name](...args));
  return { get persistent() { return true; }, get: call('get'), put: call('put'), delete: call('delete'), has: call('has'), list: call('list') };
}
