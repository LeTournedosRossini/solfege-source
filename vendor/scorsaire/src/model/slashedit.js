/*
 * Editing the "slashes" display ranges of a track (model/trackdisplay.js key `slashes`, shown by layout/slashfill.js): a list of { staff, from, to } (measure ids, inclusive).
 * Pure helpers on measure INDEXES (a range is stored by measure id, never by number) + the one edit used by the screen-1 range bar. Nothing of the piece itself is written.
 */
import { PID } from './pid.js';
import { trackLayer, setTrackDisplay } from './trackdisplay.js';

/** The set of measure indexes a staff shows as slashes in a list of ranges. */
export function slashMeasures(ids, list, staffId) {
  const set = new Set();
  for (const r of list ?? []) {
    if (r.staff !== staffId) continue;
    const a = ids.indexOf(r.from); const b = ids.indexOf(r.to);
    if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
  }
  return set;
}

/** The list of ranges for a staff from a set of measure indexes (runs of consecutive measures). */
export function rangesFromSet(ids, set, staffId) {
  const out = [];
  const sorted = [...set].filter((i) => i >= 0 && i < ids.length).sort((x, y) => x - y);
  for (let k = 0; k < sorted.length;) {
    let e = k;
    while (e + 1 < sorted.length && sorted[e + 1] === sorted[e] + 1) e += 1;
    out.push({ staff: staffId, from: ids[sorted[k]], to: ids[sorted[e]] });
    k = e + 1;
  }
  return out;
}

/** Replaces the ranges of ONE staff in a list by the measures of `set` (the other staves' ranges stay as they are). */
export function withStaffMeasures(ids, list, staffId, set) {
  return [...(list ?? []).filter((r) => r.staff !== staffId), ...rangesFromSet(ids, set, staffId)];
}

/** 'all' | 'some' | 'none': how much of the measures `from`..`to` (indexes) a staff shows as slashes. */
export function slashCoverage(ids, list, staffId, from, to) {
  const set = slashMeasures(ids, list, staffId);
  let n = 0; let total = 0;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) { total += 1; if (set.has(i)) n += 1; }
  return n === 0 ? 'none' : n === total ? 'all' : 'some';
}

/**
 * Screen 1: shows the measures `from`..`to` (indexes) of the staves as slashes, or stops showing them (`on` false). The track layer is written (every other screen follows it
 * unless it has its own). To be called inside `doc.transaction`.
 */
export function setSlashMeasures(doc, staffIds, ids, from, to, on) {
  const byTrack = new Map();
  for (const sid of staffIds) {
    const staff = doc.find(sid);
    const track = staff && doc.parentOf(staff.id);
    if (!track || track.type !== 'track') continue;
    if (!byTrack.has(track.id)) byTrack.set(track.id, { track, list: [...(trackLayer(track)?.slashes ?? [])] });
    const rec = byTrack.get(track.id);
    const set = slashMeasures(ids, rec.list, sid);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) { if (on) set.add(i); else set.delete(i); }
    rec.list = withStaffMeasures(ids, rec.list, sid, set);
  }
  for (const { track, list } of byTrack.values()) setTrackDisplay(doc, track.id, { slashes: list.length ? list : null });
}
