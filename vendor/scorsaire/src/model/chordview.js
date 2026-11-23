/*
 * CHORD VIEWS: how the chord symbols are READ, measure by measure, without touching the sound. The guitarist who plays with a capo on the 2nd fret reads D where the track holds E.
 * A "display tag" (`PID.CHORD_VIEWS` of a chord staff) starts on a measure and lasts until the next one:
 *   'original'  the chords as written                      'capo'  the chords as played with the capo in force (written − its fret)
 *   'shift'     a number of semitones chosen by hand (written + shift)
 * No tag at all = the written chords. The capo in force comes from the capos written on the notation / tablature staves of the movement (`PID.CAPOS`: the first staff that has some).
 * The result is a list of semitones per measure that the layouts apply to the chord symbols (`layout/displayshift.js › shiftChordTrack`). PURE: nothing is written here except by the edit functions.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { capoTimeline, staffTimeline } from './capo.js';
import { EditError } from './noteedit.js';
import { newId } from './ids.js';

export const CHORD_VIEW_MODES = Object.freeze(['original', 'capo', 'shift']);
export const CHORD_VIEW_SHIFT_MAX = 11;

/** The display tags of a chord staff, in measure order: [{ id, measureId, mode, shift, index }] (a tag whose measure no longer exists is ignored). */
export function chordViewTags(mv, staff) {
  const at = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  return (getProperty(staff, PID.CHORD_VIEWS) ?? [])
    .map((e, order) => ({ ...e, shift: Number.isInteger(e.shift) ? e.shift : 0, index: at.get(e.measureId), order }))
    .filter((e) => e.index !== undefined && CHORD_VIEW_MODES.includes(e.mode))
    .sort((a, b) => a.index - b.index || a.order - b.order);
}

/** The staves of the movement that have capos written: [{ id, name }] (the track's name), the candidates for `PID.CHORD_CAPO_STAFF`. */
export function capoStaves(mv) {
  return mv.tracks.flatMap((t) => t.staves.filter((st) => (getProperty(st, PID.CAPOS) ?? []).length).map((st) => ({ id: st.id, name: getProperty(t, PID.NAME) || '—' })));
}

/**
 * The capo fret in force on each measure (0 when none is written yet / a capo switched off). The staff that gives it is `staffId` (the choice of the chord staff, `PID.CHORD_CAPO_STAFF`) when it
 * has capos, else the first staff of the movement that has some.
 */
export function capoFretByMeasure(mv, { staffId = null } = {}) {
  const n = mv.masterbars.length;
  const out = new Array(n).fill(0);
  const wanted = staffId && mv.tracks.some((t) => t.staves.some((st) => st.id === staffId && (getProperty(st, PID.CAPOS) ?? []).length)) ? staffId : null;
  for (const t of mv.tracks) for (const st of t.staves) {
    if (wanted ? st.id !== wanted : !(getProperty(st, PID.CAPOS) ?? []).length) continue;
    // a tablature LINKED to a notation staff stores no content: its capos name chords of the PRIMARY staff, whose timeline places them (the same rule as `linkedstaff.js`)
    const linkedTo = getProperty(st, PID.LINKED_TO);
    const content = linkedTo ? mv.tracks.flatMap((x) => x.staves).find((s) => s.id === linkedTo) ?? st : st;
    const list = capoTimeline(mv, st, staffTimeline(mv, content));
    if (!list.length) continue;
    let k = 0; let fret = 0;
    for (let m = 0; m < n; m += 1) {
      while (k < list.length && list[k].mi <= m) { fret = list[k].params.active ? list[k].params.fret : 0; k += 1; }
      out[m] = fret;
    }
    return out;
  }
  return out;
}

/**
 * Semitones to ADD to the chords of each measure to read them as asked: [n per measure].
 * @param o.view 'author' (the display tags of `staff`, default) | 'original' (nothing changes) | 'capo' (the capo in force on every measure)
 */
export function chordViewShifts(mv, staff, { view = 'author' } = {}) {
  const n = mv.masterbars.length; const out = new Array(n).fill(0);
  if (view === 'original') return out;
  const capo = capoFretByMeasure(mv, { staffId: getProperty(staff, PID.CHORD_CAPO_STAFF) ?? null });
  if (view === 'capo') return out.map((_, m) => 0 - capo[m]);
  const tags = chordViewTags(mv, staff); let k = 0; let tag = null;
  for (let m = 0; m < n; m += 1) {
    while (k < tags.length && tags[k].index <= m) { tag = tags[k]; k += 1; }
    out[m] = !tag || tag.mode === 'original' ? 0 : tag.mode === 'capo' ? 0 - capo[m] : tag.shift;
  }
  return out;
}

/** True when any chord staff of the movement has a display tag (the cards and the part settings only matter then). */
export const hasChordViews = (mv) => mv.tracks.some((t) => t.staves.some((s) => (getProperty(s, PID.CHORD_VIEWS) ?? []).length));

/** The tag that starts on a measure, or null. */
export const chordViewAt = (mv, staff, measureId) => chordViewTags(mv, staff).find((e) => e.measureId === measureId) ?? null;

/**
 * Puts a tag on a measure (one per measure: another one is replaced; the same one again removes it). `mode` 'original' | 'capo' | 'shift' (+ `shift` semitones, -11..11).
 * One transaction's worth of edits: the caller wraps it.
 */
export function setChordView(doc, mv, staff, measureId, { mode, shift = 0 }) {
  if (!mv.masterbars.some((b) => b.id === measureId)) throw new EditError('Unknown measure');
  if (!CHORD_VIEW_MODES.includes(mode)) throw new EditError(`Unknown chord view: ${mode}`);
  const s = mode === 'shift' ? Math.max(-CHORD_VIEW_SHIFT_MAX, Math.min(CHORD_VIEW_SHIFT_MAX, Math.round(shift))) : 0;
  const list = [...(getProperty(staff, PID.CHORD_VIEWS) ?? [])];
  const old = list.findIndex((e) => e.measureId === measureId);
  if (old >= 0 && list[old].mode === mode && (list[old].shift ?? 0) === s) { list.splice(old, 1); doc.set(staff, PID.CHORD_VIEWS, list); return null; }
  const entry = { id: old >= 0 ? list[old].id : newId('cv'), measureId, mode, ...(mode === 'shift' ? { shift: s } : {}) };
  if (old >= 0) list[old] = entry; else list.push(entry);
  doc.set(staff, PID.CHORD_VIEWS, list);
  return entry;
}

/** The reading in force on a measure (index): { mode, shift } — 'original' when no tag has started yet. */
export function chordViewModeAt(mv, staff, index) {
  let tag = null;
  for (const tg of chordViewTags(mv, staff)) { if (tg.index <= index) tag = tg; else break; }
  return tag ? { mode: tag.mode, shift: tag.shift } : { mode: 'original', shift: 0 };
}

/**
 * Puts a tag on a RANGE of measures `fromId`..`toId` (inclusive): the tags inside the range are replaced by the new one, and the reading that was in force at the end of the range comes back
 * on the measure that follows (a tag put there to say so, unless it already has one or reads the same). One transaction's worth of edits: the caller wraps it.
 */
export function setChordViewRange(doc, mv, staff, fromId, toId, { mode, shift = 0 }) {
  const at = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  if (!at.has(fromId) || !at.has(toId)) throw new EditError('Unknown measure');
  if (!CHORD_VIEW_MODES.includes(mode)) throw new EditError(`Unknown chord view: ${mode}`);
  const lo = Math.min(at.get(fromId), at.get(toId)); const hi = Math.max(at.get(fromId), at.get(toId));
  const s = mode === 'shift' ? Math.max(-CHORD_VIEW_SHIFT_MAX, Math.min(CHORD_VIEW_SHIFT_MAX, Math.round(shift))) : 0;
  const before = hi + 1 < mv.masterbars.length ? chordViewModeAt(mv, staff, hi) : null; // what the measure after the range would have read
  const list = (getProperty(staff, PID.CHORD_VIEWS) ?? []).filter((e) => { const i = at.get(e.measureId); return i === undefined || i < lo || i > hi; });
  list.push({ id: newId('cv'), measureId: mv.masterbars[lo].id, mode, ...(mode === 'shift' ? { shift: s } : {}) });
  const next = hi + 1 < mv.masterbars.length ? mv.masterbars[hi + 1].id : null;
  if (next && before && !list.some((e) => e.measureId === next) && !(before.mode === mode && (before.mode !== 'shift' || before.shift === s))) {
    list.push({ id: newId('cv'), measureId: next, mode: before.mode, ...(before.mode === 'shift' ? { shift: before.shift } : {}) });
  }
  doc.set(staff, PID.CHORD_VIEWS, list);
}

/** Removes every tag that starts on the measures `fromId`..`toId` (inclusive). */
export function clearChordViewRange(doc, mv, staff, fromId, toId) {
  const at = new Map(mv.masterbars.map((b, i) => [b.id, i]));
  const lo = Math.min(at.get(fromId), at.get(toId)); const hi = Math.max(at.get(fromId), at.get(toId));
  const all = getProperty(staff, PID.CHORD_VIEWS) ?? [];
  const list = all.filter((e) => { const i = at.get(e.measureId); return i === undefined || i < lo || i > hi; });
  if (list.length !== all.length) doc.set(staff, PID.CHORD_VIEWS, list);
}

/** Removes the tag that starts on a measure (nothing when there is none). */
export function clearChordView(doc, mv, staff, measureId) {
  const list = (getProperty(staff, PID.CHORD_VIEWS) ?? []).filter((e) => e.measureId !== measureId);
  if (list.length !== (getProperty(staff, PID.CHORD_VIEWS) ?? []).length) doc.set(staff, PID.CHORD_VIEWS, list);
}

/** The text of a tag, for its card and its menu: `t` is an i18n lookup. */
export function chordViewText(tag, t) {
  return tag.mode === 'shift' ? t('chordView.shift', { n: `${tag.shift > 0 ? '+' : ''}${tag.shift}` }) : t(`chordView.${tag.mode}`);
}
