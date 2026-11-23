/*
 * Finding again the audio of a LIGHT file (model/externalmedia.js) among files the person picks on the disk: single audio files and/or the ZIP of the piece (its audio entries).
 * A track is recognised by its SHA-256 (the link between the score and the recording); when no file has that fingerprint, a file with the track's NAME is taken, and the caller
 * warns (the time map was made for another recording). A track nothing matches is `missing`. PURE except for the hash.
 */
import { sha256Hex } from './sha256.js';
import { zipEntries, zipRead, looksLikeZip } from '../import/mxl.js';

export const AUDIO_FILE = /\.(opus|ogg|oga|wav|mp3|flac|m4a|aac|webm)$/i;
const baseName = (path) => String(path).split('/').pop();
const stem = (path) => baseName(path).replace(/\.[^.]+$/, '').toLowerCase();

/** @param files [{ name, bytes }] as picked ; a ZIP is opened and gives its audio entries (`name` = the path inside). → [{ name, bytes }] */
export async function expandCandidates(files) {
  const out = [];
  for (const f of files) {
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    if (looksLikeZip(bytes)) {
      for (const e of zipEntries(bytes)) {
        if (e.name.endsWith('/') || e.name.includes('__MACOSX') || baseName(e.name).startsWith('.') || !AUDIO_FILE.test(e.name)) continue;
        out.push({ name: e.name, bytes: await zipRead(bytes, e) });
      }
    } else out.push({ name: f.name, bytes });
  }
  return out;
}

/**
 * @param media tracks of the archive ({ id, name, role, external })
 * @param candidates [{ name, bytes }]
 * @returns {Promise<{ found: Map<string, { bytes: Uint8Array, name: string, how: 'hash' | 'name' }>, missing: object[] }>}
 */
export async function matchExternalMedia(media, candidates, { hash = sha256Hex } = {}) {
  const hashed = [];
  for (const c of candidates) hashed.push({ ...c, sha256: await hash(c.bytes) });
  const found = new Map(); const taken = new Set();
  const wanted = media.filter((m) => m.external && !m.bytes);
  for (const m of wanted) { // first by fingerprint
    const hit = hashed.find((c, i) => c.sha256 === m.external.sha256 && !taken.has(i));
    if (hit) { taken.add(hashed.indexOf(hit)); found.set(m.id, { bytes: hit.bytes, name: hit.name, how: 'hash' }); }
  }
  for (const m of wanted) { // then, for what is left, by name (a track `drums` = a file `drums.opus` / `stems/drums.opus` / the name written in the reference)
    if (found.has(m.id)) continue;
    const names = new Set([stem(m.name), stem(m.external.file)]);
    const i = hashed.findIndex((c, k) => !taken.has(k) && names.has(stem(c.name)));
    if (i >= 0) { taken.add(i); found.set(m.id, { bytes: hashed[i].bytes, name: hashed[i].name, how: 'name' }); }
  }
  return { found, missing: wanted.filter((m) => !found.has(m.id)) };
}
