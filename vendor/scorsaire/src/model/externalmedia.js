/*
 * Audio kept OUTSIDE the `.scorsaire`: a track of `sync.json › media` may carry `external: { file, sha256, bytes }` instead of a file of the ZIP.
 *   file    the name of the track at the place that keeps it (the school portal: `original.opus`, `stems/<track>.opus`), relative to a base given to the reader
 *   sha256  the fingerprint of the audio the time map was made for (lowercase hex) ; bytes = its size
 * The fingerprint is the link between the score and the audio: it is how the server finds the recording again, and how a reader notices another audio.
 * PURE except for the hash (`sha256Hex`).
 */
import { sha256Hex } from './sha256.js';

const extOf = (name) => (/\.[a-z0-9]+$/i.exec(name)?.[0] ?? '.opus').toLowerCase();

/** The name a track gets at the place that keeps it (the portal's rule): the mix is `original.<ext>`, every other track is in `stems/`. */
export function externalFileName(m) {
  const ext = m.ext ?? extOf(m.fileName ?? m.name);
  return m.role === 'original' ? `original${ext}` : `stems/${String(m.name).replace(/[\\/]+/g, '_')}${ext}`;
}

/** @param media [{ id, name, role, bytes, ext? }]  @returns the same tracks without their bytes, each with its `external` reference */
export async function externalizeMedia(media) {
  const out = [];
  for (const m of media) {
    const bytes = m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes);
    out.push({ id: m.id, name: m.name, role: m.role, external: { file: externalFileName(m), sha256: await sha256Hex(bytes), bytes: bytes.byteLength } });
  }
  return out;
}

/** True when `external` is shaped as expected (a safe relative name, a 64-digit hex fingerprint). */
export function validExternal(x) {
  return !!x && typeof x.file === 'string' && /^[\w][\w .\-()/]*$/.test(x.file) && !x.file.split('/').includes('..') && /^[0-9a-f]{64}$/.test(String(x.sha256 ?? ''));
}

/**
 * The tracks of a score opened FROM the portal, written back as references: a track the portal gave us keeps the reference it came with, unchanged (`known`: id → `external`);
 * a track with no known reference (it was added here) is referenced by its own bytes, like `externalizeMedia` does — the portal will refuse it if it does not hold that audio.
 * @param media [{ id, name, role, bytes?, external? }]  @param known Map id → { file, sha256, bytes }
 */
export async function referenceMedia(media, known) {
  const out = [];
  for (const m of media) {
    if (known.has(m.id)) out.push({ id: m.id, name: m.name, role: m.role, external: known.get(m.id) });
    else if (m.external && !m.bytes) out.push({ id: m.id, name: m.name, role: m.role, external: m.external });
    else out.push(...await externalizeMedia([m]));
  }
  return out;
}
