/*
 * Editing the grips of a list entry (slur, tie, hammer-on/pull-off, hairpin). TO CALL INSIDE `doc.transaction`.
 * See model/grips.js for the stored shape.
 */
import { getProperty } from './props.js';
import { GRIP_KINDS, CURVE_GRIPS, HAIRPIN_GRIPS, withGrip, withAperture, withoutGrips } from './grips.js';

function locate(doc, entryId) {
  const found = doc.findListEntry(entryId);
  if (!found || !GRIP_KINDS[found.kind]) throw new Error(`gripedit: entry "${entryId}" has no grips`);
  return found;
}

function replace(doc, found, fn) {
  const list = getProperty(found.owner, found.pid) ?? [];
  doc.set(found.owner, found.pid, list.map((e) => (e.id === found.id ? fn(e) : e)));
}

/** Set the offset [dx, dy] (spaces, y down) of one grip of one segment. */
export function setGrip(doc, entryId, seg, key, offset) {
  const found = locate(doc, entryId);
  const allowed = GRIP_KINDS[found.kind] === 'curve' ? CURVE_GRIPS : HAIRPIN_GRIPS;
  if (!allowed.includes(key)) throw new Error(`gripedit: unknown grip "${key}" for a ${found.kind}`);
  if (!Number.isInteger(seg) || seg < 0) throw new Error('gripedit: invalid segment');
  replace(doc, found, (e) => withGrip(e, seg, key, offset));
}

/** Set the opening (spaces) of a hairpin; `null` returns to the style value. */
export function setAperture(doc, entryId, value) {
  const found = locate(doc, entryId);
  if (found.kind !== 'hairpin') throw new Error('gripedit: only a hairpin has an aperture');
  replace(doc, found, (e) => withAperture(e, value));
}

/** Clear grips: everything (no options), one segment (`seg`), or one grip (`seg` + `key`). */
export function resetGrips(doc, entryId, opts = {}) {
  const found = locate(doc, entryId);
  replace(doc, found, (e) => withoutGrips(e, opts));
}

/** Chord ids of the voice (of `staff`) that contains `chordId`, in playing order; [] when not found. */
function voiceChordIds(staff, chordId) {
  for (const voice of staff.voices ?? []) {
    const ids = [];
    for (const m of voice.measures ?? []) for (const it of m.items) if (it.type === 'chord') ids.push(it.id);
    if (ids.includes(chordId)) return ids;
  }
  return [];
}

/** Chords of the voice an anchored spanner (slur, hairpin) lives in: `{ staff, ids }` or null. */
export function spannerVoiceChords(doc, entryId) {
  const found = doc.findListEntry(entryId);
  if (!found || (found.kind !== 'hairpin' && found.kind !== 'slur')) return null;
  const ids = voiceChordIds(found.owner, found.entry.startChordId);
  return ids.length ? { staff: found.owner, ids, entry: found.entry } : null;
}

/**
 * Change the chord a slur or hairpin STARTS (`which` = 'start') or ENDS ('end') on: this is what playback follows (and the drawing).
 * The new chord must be in the same voice and keep start before end. The visual offsets of that grip are cleared (they were set for
 * the old anchor). Returns false when nothing changes. TO CALL INSIDE `doc.transaction`.
 */
export function reanchorSpanner(doc, entryId, which, chordId) {
  const info = spannerVoiceChords(doc, entryId);
  if (!info) throw new Error(`gripedit: entry "${entryId}" cannot be re-anchored`);
  if (which !== 'start' && which !== 'end') throw new Error('gripedit: which must be start or end');
  const { ids, entry } = info;
  const at = ids.indexOf(chordId);
  if (at < 0) throw new Error('gripedit: that chord is not in the voice of the spanner');
  const key = which === 'start' ? 'startChordId' : 'endChordId';
  if (entry[key] === chordId) return false;
  const s = which === 'start' ? at : ids.indexOf(entry.startChordId);
  const e = which === 'start' ? ids.indexOf(entry.endChordId) : at;
  if (s >= e) throw new Error('gripedit: the start must come before the end');
  const found = doc.findListEntry(entryId);
  replace(doc, found, (en) => {
    const next = { ...en, [key]: chordId };
    // the grip of that end (all segments) was tuned for the old anchor
    let out = next;
    for (const seg of Object.keys(en.grips?.segments ?? {})) out = withoutGrips(out, { seg, key: which });
    return out;
  });
  return true;
}
