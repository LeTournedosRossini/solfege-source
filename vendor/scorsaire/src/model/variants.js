// Variants of a track: several tracks tagged as alternatives of the same part (« Rhythm guitar », workshop 1 / workshop 2).
// `PID.TRACK_VARIANT` = { group, label } on each member; the members of a group share the `group` string. Only one member is « active »:
// selecting a variant shows it and unmutes it, and hides and mutes the others (one undo step). Nothing is merged: the tracks stay ordinary tracks.
// ALL WRITING FUNCTIONS HERE MUST BE CALLED INSIDE `doc.transaction`.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';

export class VariantError extends Error {
  constructor(code, message) { super(message); this.name = 'VariantError'; this.code = code; }
}

export const VARIANT_LABEL_MAX = 24;
const cleanLabel = (s) => String(s ?? '').trim().slice(0, VARIANT_LABEL_MAX);

export const variantOf = (track) => getProperty(track, PID.TRACK_VARIANT) ?? null;

/** Members of the group of `track` in movement order (the track itself included), or [] when it is not a variant. */
export function variantPeers(mv, track) {
  const v = variantOf(track);
  return v ? mv.tracks.filter((t) => variantOf(t)?.group === v.group) : [];
}

/** The member of the group that is shown now (the first shown one when several are). */
export const activeVariant = (mv, track) => variantPeers(mv, track).find((t) => getProperty(t, PID.VISIBLE) !== false) ?? null;

const findTrack = (mv, id) => {
  const t = mv.tracks.find((x) => x.id === id);
  if (!t) throw new VariantError('unknown', `Unknown track: ${id}`);
  return t;
};

/** Tags `trackId` as a variant of `baseId` (a new group when the base has none); the base gets the label « 1 » when it had none. */
export function setVariantOf(doc, mv, trackId, baseId, label) {
  if (trackId === baseId) throw new VariantError('self', 'A track cannot be a variant of itself');
  const track = findTrack(mv, trackId), base = findTrack(mv, baseId);
  let group = variantOf(base)?.group;
  if (!group) {
    group = `${newId('var')}-${Math.random().toString(36).slice(2, 6)}`;
    doc.set(base, PID.TRACK_VARIANT, { group, label: '1' });
  }
  const n = mv.tracks.filter((t) => variantOf(t)?.group === group && t.id !== trackId).length + 1;
  doc.set(track, PID.TRACK_VARIANT, { group, label: cleanLabel(label) || String(n) });
}

/** Renames the variant label of a track. */
export function setVariantLabel(doc, mv, trackId, label) {
  const track = findTrack(mv, trackId), v = variantOf(track);
  if (!v) throw new VariantError('notVariant', 'This track is not a variant');
  const text = cleanLabel(label);
  if (!text) throw new VariantError('empty', 'A variant needs a label');
  doc.set(track, PID.TRACK_VARIANT, { group: v.group, label: text });
}

/** Takes a track out of its group; a group left with a single member disappears. */
export function clearVariant(doc, mv, trackId) {
  const track = findTrack(mv, trackId), v = variantOf(track);
  if (!v) return;
  const rest = variantPeers(mv, track).filter((t) => t.id !== trackId);
  doc.reset(track, PID.TRACK_VARIANT);
  if (rest.length === 1) doc.reset(rest[0], PID.TRACK_VARIANT);
}

/** Shows (and unmutes) `trackId`, hides and mutes the other members of its group. */
export function selectVariant(doc, mv, trackId) {
  const track = findTrack(mv, trackId);
  const peers = variantPeers(mv, track);
  if (peers.length < 2) throw new VariantError('notVariant', 'This track has no variant');
  for (const t of peers) {
    const on = t.id === trackId;
    if (on) {
      doc.set(t, PID.VISIBLE, true);
      doc.set(t, PID.MUTE, false);
    }
  }
  for (const t of peers) {
    if (t.id === trackId) continue;
    doc.set(t, PID.VISIBLE, false);
    doc.set(t, PID.MUTE, true);
  }
}

/** Next member of the group after `trackId` (cycles), for the one-tap switch. */
export function nextVariantId(mv, trackId) {
  const track = findTrack(mv, trackId), peers = variantPeers(mv, track);
  if (peers.length < 2) return null;
  const cur = activeVariant(mv, track) ?? track;
  return peers[(peers.findIndex((t) => t.id === cur.id) + 1) % peers.length].id;
}
