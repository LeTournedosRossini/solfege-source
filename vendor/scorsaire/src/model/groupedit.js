/*
 * Brackets of track groups (step 5, "tracks and staves" panel, slice 4): group, ungroup, restyle.
 * Pure model operations: CALL THEM INSIDE `doc.transaction(name, () => …)`.
 *
 * Groups are a tree of contiguous track ranges (`movement.groups`, children inside their parent, siblings disjoint). MuseScore 4.7.5 keeps
 * brackets per staff with a column and a span; dropping a bracket on a range adds it on the outermost column and pushes the existing
 * ones outwards (`Score::undoAddBracket`). Here the nesting depth plays the column: the new group becomes the PARENT of the groups
 * it wholly contains and the CHILD of the group that wholly contains it; a partial overlap is refused.
 * Any manual edit switches the movement to `GROUP_ORDER = 'custom'` (the automatic grouping of `scoreorder.js` stops following the tracks).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createGroup } from './elements.js';
import { EditError } from './noteedit.js';

export { EditError };
export const BRACKET_STYLES = Object.freeze(['normal', 'square', 'line', 'brace']);

const indexOfTrack = (mv, id) => mv.tracks.findIndex((t) => t.id === id);
const range = (mv, g) => [indexOfTrack(mv, getProperty(g, PID.START_TRACK_ID)), indexOfTrack(mv, getProperty(g, PID.END_TRACK_ID))];

/** Every group of the movement with its parent (null at top level), depth-first. */
export function walkGroups(mv, fn) {
  const rec = (list, parent, depth) => { for (const g of list) { fn(g, parent, depth); rec(g.groups, g, depth + 1); } };
  rec(mv.groups, null, 0);
}

/** Parent group of a group (null = the movement). */
export function parentOfGroup(mv, group) {
  let found = null;
  walkGroups(mv, (g, parent) => { if (g.id === group.id) found = parent; });
  return found;
}

function switchToCustom(doc, mv) {
  if (getProperty(mv, PID.GROUP_ORDER) !== 'custom') doc.set(mv, PID.GROUP_ORDER, 'custom');
}

/**
 * Groups the tracks `trackIds` (a contiguous range of the movement). Returns the new group.
 * @param opts { style = 'normal', label?, barlines = true, auto = false } — `auto` keeps the automatic order (used by the generator)
 */
export function groupTracks(doc, mv, trackIds, { style = 'normal', label, barlines, auto = false } = {}) {
  if (!BRACKET_STYLES.includes(style)) throw new EditError(`Unknown bracket style: ${style}`);
  const idx = trackIds.map((id) => indexOfTrack(mv, id));
  if (!idx.length || idx.some((i) => i < 0)) throw new EditError('Unknown track');
  const a = Math.min(...idx);
  const b = Math.max(...idx);
  if (new Set(idx).size !== b - a + 1) throw new EditError('A group needs contiguous tracks');

  // descend into the group that wholly contains the range (and is not the same range)
  let container = mv;
  for (;;) {
    const holder = container.groups.find((g) => { const [ga, gb] = range(mv, g); return ga <= a && b <= gb && !(ga === a && gb === b); });
    if (!holder) break;
    container = holder;
  }
  const inside = [];
  for (const g of container.groups) {
    const [ga, gb] = range(mv, g);
    if (ga > b || gb < a) continue;
    if (ga >= a && gb <= b) inside.push(g); else throw new EditError('A group may not overlap another group without containing it');
  }
  if (!auto) switchToCustom(doc, mv);
  const group = createGroup({ startTrackId: mv.tracks[a].id, endTrackId: mv.tracks[b].id, label, bracketStyle: style, groupBarlines: barlines });
  const position = inside.length ? container.groups.indexOf(inside[0])
    : container.groups.filter((g) => range(mv, g)[0] < a).length;
  for (const g of inside) doc.remove(g);
  doc.add(container, 'groups', group, position);
  inside.forEach((g, i) => doc.add(group, 'groups', g, i));
  return group;
}

/** Removes a group's bracket; its children move up to the parent, in place. */
export function ungroup(doc, mv, group) {
  let parent = null;
  let found = false;
  walkGroups(mv, (g, p) => { if (g.id === group.id) { found = true; parent = p; } });
  if (!found) throw new EditError('Unknown group');
  switchToCustom(doc, mv);
  const container = parent ?? mv;
  const at = container.groups.findIndex((g) => g.id === group.id);
  const children = [...group.groups];
  for (const c of children) doc.remove(c);
  doc.remove(group);
  children.forEach((c, i) => doc.add(container, 'groups', c, at + i));
}

function mustBeGroup(mv, group) {
  let ok = false;
  walkGroups(mv, (g) => { if (g.id === group.id) ok = true; });
  if (!ok) throw new EditError('Unknown group');
}

export function setGroupStyle(doc, mv, group, style) {
  if (!BRACKET_STYLES.includes(style)) throw new EditError(`Unknown bracket style: ${style}`);
  mustBeGroup(mv, group);
  switchToCustom(doc, mv);
  doc.set(group, PID.BRACKET_STYLE, style);
}
export function setGroupLabel(doc, mv, group, label) {
  mustBeGroup(mv, group);
  switchToCustom(doc, mv);
  const text = String(label ?? '').trim().slice(0, 60);
  if (text) doc.set(group, PID.LABEL, text); else doc.reset(group, PID.LABEL);
}
export function setGroupBarlines(doc, mv, group, on) {
  mustBeGroup(mv, group);
  switchToCustom(doc, mv);
  doc.set(group, PID.GROUP_BARLINES, Boolean(on));
}

/** Removes every group (used before an automatic regrouping). */
export function clearGroups(doc, mv) {
  for (const g of [...mv.groups]) doc.remove(g);
}

/**
 * Do bar lines continue between two ADJACENT tracks? Yes when the innermost group containing both asks for it (`GROUP_BARLINES`,
 * default true). Staves of one track are always connected (the caller handles that).
 */
export function barlinesConnect(mv, trackA, trackB) {
  const ia = indexOfTrack(mv, trackA.id);
  const ib = indexOfTrack(mv, trackB.id);
  let best = null;
  let bestDepth = -1;
  walkGroups(mv, (g, _p, depth) => {
    const [ga, gb] = range(mv, g);
    if (ga <= Math.min(ia, ib) && gb >= Math.max(ia, ib) && depth > bestDepth) { best = g; bestDepth = depth; }
  });
  return best ? getProperty(best, PID.GROUP_BARLINES) : false;
}
