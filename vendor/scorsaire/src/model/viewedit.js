// Named views of a movement: a saved choice of the tracks (and optionally the staves) shown on the score. Screen 1 only.
// A view never changes what is played. Applying a view writes PID.VISIBLE on tracks and staves (undoable); the ACTIVE view is not stored, it is
// the view whose choice matches what is shown now (so toggling an eye by hand simply leaves no view active).
// ALL FUNCTIONS HERE MUST BE CALLED INSIDE `doc.transaction`.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';

export class ViewEditError extends Error {
  constructor(code, message) { super(message); this.name = 'ViewEditError'; this.code = code; }
}

export const viewsOf = (mv) => mv.props[PID.VIEWS] ?? [];
const writeViews = (doc, mv, list) => doc.set(mv, PID.VIEWS, list.length ? list : null);
const shown = (el) => getProperty(el, PID.VISIBLE) !== false;

/** Staff ids a view shows (a track without a `staves` list shows all its staves). */
export function viewStaffIds(mv, view) {
  const ids = new Set();
  for (const vt of view.tracks) {
    const track = mv.tracks.find((t) => t.id === vt.id);
    if (!track) continue;
    for (const s of track.staves) if (!vt.staves || vt.staves.includes(s.id)) ids.add(s.id);
  }
  return ids;
}

/** The set of staff ids shown now (a staff of a hidden track is not shown). */
function shownStaffIds(mv) {
  const ids = new Set();
  for (const t of mv.tracks) if (shown(t)) for (const s of t.staves) if (shown(s)) ids.add(s.id);
  return ids;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Id of the view that matches what is shown now, or null ('all' is not a stored view). Read-only. */
export function activeViewId(mv) {
  const now = shownStaffIds(mv);
  for (const view of viewsOf(mv)) if (sameSet(viewStaffIds(mv, view), now)) return view.id;
  return null;
}

const uniqueName = (mv, name) => {
  const base = (name ?? '').trim().slice(0, 40) || 'View';
  const names = new Set(viewsOf(mv).map((v) => v.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
};

/** Describes the tracks and staves shown now as a view body. */
function currentBody(mv) {
  const tracks = [];
  for (const t of mv.tracks) {
    if (!shown(t)) continue;
    const visible = t.staves.filter(shown);
    if (!visible.length) continue;
    tracks.push(visible.length === t.staves.length ? { id: t.id } : { id: t.id, staves: visible.map((s) => s.id) });
  }
  return tracks;
}

/** Creates a view from an explicit body ([{ id, staves? }]) → its id. */
export function createView(doc, mv, { name, tracks }) {
  const body = (tracks ?? []).filter((vt) => mv.tracks.some((t) => t.id === vt.id));
  if (!body.length) throw new ViewEditError('empty', 'A view needs at least one track');
  const view = { id: newId('vw'), name: uniqueName(mv, name), tracks: body.map((vt) => (vt.staves?.length ? { id: vt.id, staves: [...vt.staves] } : { id: vt.id })) };
  writeViews(doc, mv, [...viewsOf(mv), view]);
  return view.id;
}

/** Saves what is shown now as a new view → its id. */
export function saveCurrentView(doc, mv, name) {
  return createView(doc, mv, { name, tracks: currentBody(mv) });
}

/** Shows exactly what a view lists (null = everything). Only writes the values that change. */
export function applyView(doc, mv, viewId) {
  const view = viewId == null ? null : viewsOf(mv).find((v) => v.id === viewId);
  if (viewId != null && !view) throw new ViewEditError('unknown', `Unknown view: ${viewId}`);
  const staves = view ? viewStaffIds(mv, view) : null;
  if (view && !staves.size) throw new ViewEditError('empty', 'The view shows nothing');
  for (const t of mv.tracks) {
    const trackShown = staves ? t.staves.some((s) => staves.has(s.id)) : true;
    if (shown(t) !== trackShown) doc.set(t, PID.VISIBLE, trackShown);
    if (!trackShown) continue; // the staves of a hidden track keep their own flags (the eye of the track then works as before)
    for (const s of t.staves) {
      const staffShown = staves ? staves.has(s.id) : true;
      if (shown(s) !== staffShown) doc.set(s, PID.VISIBLE, staffShown);
    }
  }
}

export function renameView(doc, mv, viewId, name) {
  const list = viewsOf(mv);
  if (!list.some((v) => v.id === viewId)) throw new ViewEditError('unknown', `Unknown view: ${viewId}`);
  const clean = (name ?? '').trim().slice(0, 40);
  if (!clean) return;
  writeViews(doc, mv, list.map((v) => (v.id === viewId ? { ...v, name: clean } : v)));
}

export function removeView(doc, mv, viewId) {
  const list = viewsOf(mv);
  if (!list.some((v) => v.id === viewId)) throw new ViewEditError('unknown', `Unknown view: ${viewId}`);
  writeViews(doc, mv, list.filter((v) => v.id !== viewId));
}

/** Moves a view to position `index` of the list of views (tab order). */
export function moveView(doc, mv, viewId, index) {
  const list = viewsOf(mv);
  const from = list.findIndex((v) => v.id === viewId);
  if (from < 0) throw new ViewEditError('unknown', `Unknown view: ${viewId}`);
  const to = Math.max(0, Math.min(list.length - 1, index));
  if (to === from) return;
  const next = list.filter((v) => v.id !== viewId);
  next.splice(to, 0, list[from]);
  writeViews(doc, mv, next);
}

/** Replaces the body of a view (the track / staff choice). */
export function setViewTracks(doc, mv, viewId, tracks) {
  const list = viewsOf(mv);
  if (!list.some((v) => v.id === viewId)) throw new ViewEditError('unknown', `Unknown view: ${viewId}`);
  const body = (tracks ?? []).filter((vt) => mv.tracks.some((t) => t.id === vt.id)).map((vt) => (vt.staves?.length ? { id: vt.id, staves: [...vt.staves] } : { id: vt.id }));
  if (!body.length) throw new ViewEditError('empty', 'A view needs at least one track');
  writeViews(doc, mv, list.map((v) => (v.id === viewId ? { ...v, tracks: body } : v)));
}

/**
 * Call BEFORE adding a track or a staff: returns a function to call AFTER it. While a view is active, the new track (or staff) joins that view,
 * so it is shown at once instead of vanishing because the view does not list it.
 */
export function addToActiveView(doc, mv) {
  const id = activeViewId(mv);
  return ({ trackId, staffId } = {}) => {
    if (!id) return;
    const view = viewsOf(mv).find((v) => v.id === id);
    if (!view) return;
    let tracks = view.tracks;
    if (trackId && !tracks.some((vt) => vt.id === trackId)) tracks = [...tracks, { id: trackId }];
    if (staffId) {
      const track = mv.tracks.find((t) => t.staves.some((s) => s.id === staffId));
      tracks = tracks.map((vt) => (track && vt.id === track.id && vt.staves ? { ...vt, staves: [...vt.staves, staffId] } : vt));
    }
    writeViews(doc, mv, viewsOf(mv).map((v) => (v.id === id ? { ...v, tracks } : v)));
  };
}

/** Removes the ids that no longer exist (call after removing a track or a staff). A view left empty is removed. */
export function pruneViews(doc, mv) {
  const list = viewsOf(mv);
  if (!list.length) return;
  const next = [];
  for (const v of list) {
    const tracks = v.tracks.filter((vt) => mv.tracks.some((t) => t.id === vt.id)).map((vt) => {
      if (!vt.staves) return vt;
      const track = mv.tracks.find((t) => t.id === vt.id);
      const staves = vt.staves.filter((sid) => track.staves.some((s) => s.id === sid));
      return staves.length ? { ...vt, staves } : { id: vt.id };
    });
    if (tracks.length) next.push({ ...v, tracks });
  }
  if (JSON.stringify(next) !== JSON.stringify(list)) writeViews(doc, mv, next);
}
