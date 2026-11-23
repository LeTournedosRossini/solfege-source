/*
 * The reader side of audio kept outside the `.scorsaire` (model/externalmedia.js): fetch each referenced track from the base given by `media=` in the page
 * address, with the portal's token (reader/access.js: only to the origin that served the page), and compare its SHA-256 with the one in the file.
 * A track whose fingerprint differs is still used (the person is warned, not stopped: it may only have been re-encoded), but the time map is made for
 * the other recording, so the score may not follow it exactly.
 * Errors carry `code`: 'noBase' (no `media=`), 'denied' (401/403/410: the right is gone), 'missing' (404), 'http' (other status), 'network'.
 */
import { authFetch } from './access.js';
import { sha256Hex } from '../model/sha256.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const encodePath = (file) => file.split('/').map(encodeURIComponent).join('/');

/** The absolute base address with a trailing slash, or null. */
export function mediaBase(params, loc = globalThis.location) {
  const raw = params.get('media');
  if (!raw) return null;
  try { const u = new URL(raw, loc.href); return u.href.endsWith('/') ? u.href : `${u.href}/`; } catch { return null; }
}

async function fetchTrack(url, fetchFn) {
  let r;
  try { r = await fetchFn(url); } catch (e) { throw fail('network', e?.message ?? 'network'); }
  if (r.status === 401 || r.status === 403 || r.status === 410) throw fail('denied', String(r.status));
  if (r.status === 404) throw fail('missing', '404');
  if (!r.ok) throw fail('http', String(r.status));
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * @param media  the tracks read from the archive (those with `external` and no bytes are fetched)
 * @param o.base  absolute base address ; o.onProgress({ done, total }) ; o.fetchFn / o.hash for tests
 * @returns {Promise<{ media: object[], warnings: { id: string, name: string, reason: 'hash' | 'size' }[] }>}
 */
export async function resolveExternalMedia(media, { base, onProgress = null, fetchFn = authFetch, hash = sha256Hex } = {}) {
  const wanted = media.filter((m) => m.external && !m.bytes);
  if (!wanted.length) return { media, warnings: [] };
  if (!base) throw fail('noBase', 'No media base');
  const warnings = []; let done = 0;
  const loaded = new Map();
  await Promise.all(wanted.map(async (m) => {
    let bytes;
    try { bytes = await fetchTrack(base + encodePath(m.external.file), fetchFn); } catch (e) {
      if (e.code !== 'missing') throw e;
      bytes = await fetchTrack(base + m.external.sha256, fetchFn); // the server may also know a track by its fingerprint
    }
    if (await hash(bytes) !== m.external.sha256) warnings.push({ id: m.id, name: m.name, reason: 'hash' });
    else if (m.external.bytes != null && bytes.byteLength !== m.external.bytes) warnings.push({ id: m.id, name: m.name, reason: 'size' });
    loaded.set(m.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    onProgress?.({ done: ++done, total: wanted.length });
  }));
  return { media: media.map((m) => (loaded.has(m.id) ? { ...m, bytes: loaded.get(m.id) } : m)), warnings };
}
