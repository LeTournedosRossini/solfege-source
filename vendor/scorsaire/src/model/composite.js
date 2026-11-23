/*
 * Composite staves: ONE staff that shows, measure by measure, one of the staves of its track (notation, tablature, rhythm…). A display only: the track keeps all its
 * staves, a screen picks a composite through the `composite` key of its display layer (model/trackdisplay.js) and then draws that one in place of the track's staves.
 *   composite = { id, name, base: staff id, ranges: [{ from: masterbar id, to: masterbar id, staff: staff id }], equal?: true | 'tallest', junction?: 'double' | 'thick' | 'lozenge' | 'lozengeHollow' | 'lozengeTriple', junctionClef?: true }
 * `base` is shown wherever no range says otherwise, so every measure always shows something. The ranges are the exceptions: sorted, never overlapping, and they hold ids of
 * measures (not indices), so they follow the measures when some are inserted or removed. ALL WRITES GO THROUGH `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';
import { EditError } from './noteedit.js';

/** The composites of a track (always an array). */
export const compositesOf = (track) => getProperty(track, PID.COMPOSITES) ?? [];

/** One composite of a track by id, or null. */
export const compositeById = (track, id) => compositesOf(track).find((c) => c.id === id) ?? null;

/** The staves of a movement that a composite may show: those of its track. */
export const compositeStaffIds = (track) => track.staves.map((s) => s.id);

/** Staff id shown by a composite at each measure index of the movement: array of length `masterbars.length` (unknown staves fall back to the base). */
export function compositeStaffByMeasure(movement, track, composite) {
  const known = new Set(compositeStaffIds(track));
  const base = known.has(composite.base) ? composite.base : track.staves[0]?.id ?? null;
  const out = movement.masterbars.map(() => base);
  const at = new Map(movement.masterbars.map((b, i) => [b.id, i]));
  for (const r of composite.ranges ?? []) {
    const a = at.get(r.from); const b = at.get(r.to);
    if (a === undefined || b === undefined || !known.has(r.staff)) continue;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out[i] = r.staff;
  }
  return out;
}

/** The staff ids a composite uses in this movement (its base and every staff of its ranges), in the order of the track. */
export function compositeUsedStaffIds(movement, track, composite) {
  const used = new Set(compositeStaffByMeasure(movement, track, composite));
  return track.staves.map((s) => s.id).filter((id) => used.has(id));
}

function trackOf(doc, trackId) {
  for (const mv of doc.work.movements) { const t = mv.tracks.find((x) => x.id === trackId); if (t) return { track: t, movement: mv }; }
  throw new EditError('Piste introuvable');
}

const store = (doc, track, list) => { if (list.length) doc.set(track, PID.COMPOSITES, list); else if (getProperty(track, PID.COMPOSITES) != null) doc.reset(track, PID.COMPOSITES); };

/** Creates a composite on a track (`base` = a staff of the track, the first one by default). Returns it. */
export function addComposite(doc, trackId, { name = '', base = null, equal = false, junction = DEFAULT_JUNCTION } = {}) {
  const { track } = trackOf(doc, trackId);
  if (!track.staves.length) throw new EditError('La piste n’a pas de portée');
  const baseId = base ?? track.staves[0].id;
  if (!track.staves.some((s) => s.id === baseId)) throw new EditError('Portée inconnue');
  if (junction && !JUNCTION_STYLES.includes(junction)) throw new EditError('Barre de jonction inconnue');
  const composite = { id: newId('cp'), name: String(name).trim(), base: baseId, ranges: [], ...(equal ? { equal: true } : {}), ...(junction ? { junction } : {}) };
  store(doc, track, [...compositesOf(track), composite]);
  return composite;
}

function change(doc, trackId, compositeId, fn) {
  const { track, movement } = trackOf(doc, trackId);
  const list = compositesOf(track);
  const found = list.find((c) => c.id === compositeId);
  if (!found) throw new EditError('Portée composite introuvable');
  const next = fn(found, movement, track);
  store(doc, track, list.map((c) => (c.id === compositeId ? next : c)));
  return next;
}

export function removeComposite(doc, trackId, compositeId) {
  const { track } = trackOf(doc, trackId);
  store(doc, track, compositesOf(track).filter((c) => c.id !== compositeId));
}

export function renameComposite(doc, trackId, compositeId, name) {
  return change(doc, trackId, compositeId, (c) => ({ ...c, name: String(name).trim() }));
}

/**
 * Same height for every staff of the composite: `false` (each its own), `true` (the tablature is fitted to the notation staff) or 'tallest' (everything is fitted to the
 * tallest staff, the tablature: the notation is scaled up as a whole).
 */
export function setCompositeEqual(doc, trackId, compositeId, on) {
  if (on !== false && on !== true && on !== 'tallest') throw new EditError('Réglage de hauteur inconnu');
  return change(doc, trackId, compositeId, (c) => { const { equal: _e, ...rest } = c; return on ? { ...rest, equal: on } : rest; });
}

export const JUNCTION_STYLES = Object.freeze(['double', 'thick', 'lozenge', 'lozengeHollow', 'lozengeTriple']);
/** What a new composite uses where its staff changes: the three lozenges (Jean's choice). */
export const DEFAULT_JUNCTION = 'lozengeTriple';

/** The bar drawn where the staff shown changes (`false` = the ordinary bar line): 'double' (two thin lines), 'thick' (one heavy line), 'lozenge' (two thin lines and a filled lozenge), 'lozengeHollow' (the lozenge is an outline) or 'lozengeTriple' (a lozenge at each end and one in the middle). */
export function setCompositeJunction(doc, trackId, compositeId, style) {
  if (style !== false && !JUNCTION_STYLES.includes(style)) throw new EditError('Barre de jonction inconnue');
  return change(doc, trackId, compositeId, (c) => { const { junction: _j, ...rest } = c; return style ? { ...rest, junction: style } : rest; });
}

/** Whether the clef of the staff that starts is shown again right after the junction bar (a small clef, like a courtesy clef). */
export function setCompositeJunctionClef(doc, trackId, compositeId, on) {
  return change(doc, trackId, compositeId, (c) => { const { junctionClef: _k, ...rest } = c; return on ? { ...rest, junctionClef: true } : rest; });
}

/** The staff shown where no range says otherwise. The ranges that showed that staff become useless and are dropped. */
export function setCompositeBase(doc, trackId, compositeId, staffId) {
  return change(doc, trackId, compositeId, (c, _mv, track) => {
    if (!track.staves.some((s) => s.id === staffId)) throw new EditError('Portée inconnue');
    return { ...c, base: staffId, ranges: c.ranges.filter((r) => r.staff !== staffId) };
  });
}

/**
 * Shows `staffId` on the measures `fromIndex..toIndex` of the movement. The ranges are kept sorted and disjoint (a new one cuts the ones it overlaps); showing the base
 * is the absence of a range. Returns the composite.
 */
export function setCompositeRange(doc, trackId, compositeId, fromIndex, toIndex, staffId) {
  return change(doc, trackId, compositeId, (c, movement, track) => {
    if (!track.staves.some((s) => s.id === staffId)) throw new EditError('Portée inconnue');
    const n = movement.masterbars.length;
    const a = Math.max(0, Math.min(fromIndex, toIndex)); const b = Math.min(n - 1, Math.max(fromIndex, toIndex));
    if (!(a <= b)) throw new EditError('Mesures hors de la partition');
    const shown = compositeStaffByMeasure(movement, track, c);
    for (let i = a; i <= b; i++) shown[i] = staffId;
    return { ...c, ranges: rangesFromShown(movement, shown, c.base) };
  });
}

/** Back to the base staff on the measures `fromIndex..toIndex`. */
export function clearCompositeRange(doc, trackId, compositeId, fromIndex, toIndex) {
  return setCompositeRange(doc, trackId, compositeId, fromIndex, toIndex, compositeById(trackOf(doc, trackId).track, compositeId)?.base);
}

/** Per-measure staff ids → the list of exception ranges (runs of the same staff other than the base). */
function rangesFromShown(movement, shown, base) {
  const ranges = [];
  let i = 0;
  while (i < shown.length) {
    let j = i;
    while (j + 1 < shown.length && shown[j + 1] === shown[i]) j++;
    if (shown[i] !== base) ranges.push({ from: movement.masterbars[i].id, to: movement.masterbars[j].id, staff: shown[i] });
    i = j + 1;
  }
  return ranges;
}

/** Validation messages of a track's composites (empty = valid). */
export function validateComposites(list, staffIds, masterbarIds) {
  const errors = [];
  if (!Array.isArray(list)) return ['composites : liste attendue'];
  const ids = new Set();
  for (const c of list) {
    if (!c || typeof c.id !== 'string') { errors.push('composite sans identifiant'); continue; }
    if (ids.has(c.id)) errors.push(`composite ${c.id} : identifiant en double`);
    ids.add(c.id);
    if (!staffIds.has(c.base)) errors.push(`composite ${c.id} : portée de base inconnue`);
    for (const r of c.ranges ?? []) {
      if (!staffIds.has(r.staff)) errors.push(`composite ${c.id} : portée inconnue dans une plage`);
      if (!masterbarIds.has(r.from) || !masterbarIds.has(r.to)) errors.push(`composite ${c.id} : mesure inconnue dans une plage`);
    }
  }
  return errors;
}
