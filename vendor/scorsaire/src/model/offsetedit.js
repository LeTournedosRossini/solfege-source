/*
 * Manual displacement of elements (step 5): which elements can be moved, and the operations (CALL INSIDE `doc.transaction`).
 * Stored on the movement as `PID.OFFSETS` = { id: [dx, dy] } in staff spaces, y down — see layout/offsets.js for how it is applied.
 * Movable: the marks of a chord (dynamic, articulation, arpeggio, tremolo mark…), list entries (slur, tie, hairpin, trill, breath, fingering,
 * lyric, glissando, pedal, technique line, bend, capo, string tunings, tremolo pair) and the system objects (tempo, gradual tempo change,
 * jump, marker, fermata, swing). Not movable: notes, chords, rests (their place is the rhythm), bar lines, clefs, key / time signatures.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { EditError } from './noteedit.js';

export { EditError };
const SYSTEM_TYPES = new Set(['tempo', 'tempoChange', 'jump', 'marker', 'rehearsal', 'fermata', 'swing']);
const STEP = 0.05; // sp
const LIMIT = 100; // sp

/** The movement an identifier belongs to, or null when it is not a movable element. */
export function movableMovement(doc, id) {
  const entry = doc.findListEntry?.(id);
  if (entry?.owner) return doc.movementOf(entry.owner);
  const el = doc.find(id);
  if (el && SYSTEM_TYPES.has(el.type)) return doc.movementOf(el);
  return null;
}

export const movableIds = (doc, ids) => ids.filter((id) => movableMovement(doc, id));

/** Current offset of an identifier ([0, 0] when none). */
export function offsetOf(doc, id) {
  const mv = movableMovement(doc, id);
  const o = mv ? getProperty(mv, PID.OFFSETS)?.[id] : null;
  return o ? [o[0], o[1]] : [0, 0];
}

const snap = (v) => Math.round(v / STEP) * STEP;
const clean = (v) => Math.round(v * 1000) / 1000;

function withMovement(doc, ids, fn) {
  const byMovement = new Map();
  for (const id of ids) {
    const mv = movableMovement(doc, id);
    if (!mv) continue;
    if (!byMovement.has(mv)) byMovement.set(mv, []);
    byMovement.get(mv).push(id);
  }
  for (const [mv, list] of byMovement) {
    const next = { ...(getProperty(mv, PID.OFFSETS) ?? {}) };
    fn(next, list);
    // forget what no longer resolves (an element deleted after it was moved)
    for (const key of Object.keys(next)) if (!movableMovement(doc, key)) delete next[key];
    if (Object.keys(next).length) doc.set(mv, PID.OFFSETS, next); else if (getProperty(mv, PID.OFFSETS)) doc.reset(mv, PID.OFFSETS);
  }
}

/** Adds `delta` ([dx, dy], spaces) to the offset of every movable identifier (snapped to 0.05 sp, limited to ±100 sp). Returns the number moved. */
export function moveElements(doc, ids, delta) {
  if (!Array.isArray(delta) || delta.length !== 2 || !delta.every(Number.isFinite)) throw new EditError('Invalid displacement');
  let moved = 0;
  withMovement(doc, ids, (map, list) => {
    for (const id of list) {
      const cur = map[id] ?? [0, 0];
      const x = clean(Math.max(-LIMIT, Math.min(LIMIT, snap(cur[0] + delta[0]))));
      const y = clean(Math.max(-LIMIT, Math.min(LIMIT, snap(cur[1] + delta[1]))));
      if (x === 0 && y === 0) delete map[id]; else map[id] = [x, y];
      moved += 1;
    }
  });
  return moved;
}

/** Puts the elements back to their automatic place. Returns the number reset. */
export function resetOffsets(doc, ids) {
  let n = 0;
  withMovement(doc, ids, (map, list) => { for (const id of list) if (map[id]) { delete map[id]; n += 1; } });
  return n;
}
