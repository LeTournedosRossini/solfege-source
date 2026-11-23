/*
 * Movements of a work (step 5): add, duplicate, remove, reorder, card title / description / number.
 * A movement is the unit of content; a "sheet" (grid / carousel of cards) is only a way of presenting several of them.
 * Pure model operations: CALL THEM INSIDE `doc.transaction(name, () => …)` — one gesture = one undoable step.
 *
 *   - Duplicate = a deep copy with FRESH identifiers (every reference inside the copy is rewritten, `cloneWithFreshIds`), inserted after the original.
 *   - New movement = the structure of a reference movement (tracks, staves, instruments…) with EMPTY measures, `measures` of them (default 1,
 *     the time and key signature of the reference's first measure); without a reference, one empty measure and no track.
 *   - Removing a movement removes everything it owns; the parts (screen 2) forget its staves, tracks, breaks and containers. The last movement
 *     of a work cannot be removed.
 *   - The card number is DISPLAY only: automatic = rank in the work formatted by `PID.CARD_NUMBER_FORMAT`; forced by hand = any short text.
 *     The movement identifier (never the number) is what other documents refer to.
 */
import { pruneSheets } from './sheetedit.js';
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createMovement, createMasterbar } from './elements.js';
import { cloneWithFreshIds } from './partcontainers.js';
import { hydrate } from './serialize.js';
import { purgePartLayout } from './partedit.js';
import { deleteMeasures, insertMeasures } from './measureedit.js';
import { clearRange } from './rangeedit.js';
import { rangeFromMeasures } from './range.js';
import { EditError } from './noteedit.js';
import { formatCardNumber, cardNumbers } from './cardnumbers.js';
export { formatCardNumber, cardNumbers };

export const MAX_CARD_NUMBER_LENGTH = 12;

const movementIndex = (doc, mv) => {
  const i = doc.work.movements.findIndex((m) => m.id === mv.id);
  if (i < 0) throw new EditError('Unknown movement');
  return i;
};

/** A deep copy of `mv` with fresh identifiers (elements are plain JSON-able data). */
const copyOf = (mv) => hydrate(cloneWithFreshIds(JSON.parse(JSON.stringify(mv))));
/** A deep copy of `mv` with fresh identifiers, NOT yet in the document (the caller adds it). */
export const copyMovement = copyOf;

/** Duplicates a movement right after the original (title suffixed by the interface, not here). Returns the copy. */
export function duplicateMovement(doc, mv) {
  const at = movementIndex(doc, mv);
  const copy = copyOf(mv);
  doc.add(doc.work, 'movements', copy, at + 1);
  return copy;
}

/**
 * Adds a movement at `at` (default: the end). With `from` (a movement) it keeps that movement's tracks and staves, with empty measures;
 * `measures` measures (1 to 64, default 1). Returns the new movement.
 */
export function addMovement(doc, { from = null, at, measures = 1, title = '' } = {}) {
  if (!Number.isInteger(measures) || measures < 1 || measures > 64) throw new EditError('Invalid number of measures');
  const total = doc.work.movements.length;
  const index = at ?? (from ? movementIndex(doc, from) + 1 : total);
  if (!Number.isInteger(index) || index < 0 || index > total) throw new EditError('Invalid position');
  const mv = from ? copyOf(from) : createMovement({ masterbars: [createMasterbar({})] });
  doc.add(doc.work, 'movements', mv, index);
  if (from) { // the copy is emptied inside the document (the measure edits need it there)
    const staffIds = mv.tracks.flatMap((t) => t.staves.map((s) => s.id));
    if (mv.masterbars.length > measures) deleteMeasures(doc, mv, { from: measures, to: mv.masterbars.length - 1 });
    if (staffIds.length) {
      const range = rangeFromMeasures(doc, mv, staffIds, 0, mv.masterbars.length - 1);
      if (range) clearRange(doc, range);
    }
    if (mv.masterbars.length < measures) insertMeasures(doc, mv, { at: mv.masterbars.length, count: measures - mv.masterbars.length });
  }
  doc.set(mv, PID.TITLE, title);
  return mv;
}

/** Removes a movement and what refers to it. Refused for the last movement. */
export function removeMovement(doc, mv) {
  movementIndex(doc, mv);
  if (doc.work.movements.length < 2) throw new EditError('A work keeps at least one movement');
  const staffIds = new Set(mv.tracks.flatMap((t) => t.staves.map((s) => s.id)));
  const trackIds = new Set(mv.tracks.map((t) => t.id));
  if (mv.masterbars.length) purgePartLayout(doc, mv, 0, mv.masterbars.length - 1);
  for (const part of doc.work.parts) {
    const staves = part.props[PID.PART_STAVES];
    if (staves) {
      const kept = staves.filter((id) => !staffIds.has(id));
      if (kept.length !== staves.length) { if (kept.length) doc.set(part, PID.PART_STAVES, kept); else doc.reset(part, PID.PART_STAVES); }
    }
    const order = part.props[PID.PART_TRACK_ORDER];
    if (order && order.some((id) => trackIds.has(id))) doc.set(part, PID.PART_TRACK_ORDER, order.filter((id) => !trackIds.has(id)));
    const tr = part.props[PID.PART_TRANSPOSITIONS];
    if (tr && Object.keys(tr).some((id) => trackIds.has(id))) doc.set(part, PID.PART_TRANSPOSITIONS, Object.fromEntries(Object.entries(tr).filter(([id]) => !trackIds.has(id))));
    for (const c of [...(part.containers ?? [])]) if (staffIds.has(getProperty(c, PID.CONTAINER_STAFF_ID))) doc.remove(c);
  }
  doc.remove(mv);
  pruneSheets(doc);
}

/** Moves a movement to the final index `index`. Returns false when it is already there. */
export function moveMovementTo(doc, mv, index) {
  const from = movementIndex(doc, mv);
  if (!Number.isInteger(index) || index < 0 || index >= doc.work.movements.length) throw new EditError('Invalid position');
  if (from === index) return false;
  doc.remove(mv);
  doc.add(doc.work, 'movements', mv, index);
  return true;
}

/** Card title (the movement title) and description; blank = none. Returns false when nothing changes. */
export function setCardText(doc, mv, { title, description } = {}) {
  movementIndex(doc, mv);
  let changed = false;
  if (title !== undefined) {
    if (typeof title !== 'string') throw new EditError('A title is a string');
    changed = doc.set(mv, PID.TITLE, title.trim()) || changed;
  }
  if (description !== undefined) {
    if (description !== null && typeof description !== 'string') throw new EditError('A description is a string');
    const text = (description ?? '').trim();
    if (text) changed = doc.set(mv, PID.DESCRIPTION, text) || changed;
    else if (mv.props[PID.DESCRIPTION] != null) { doc.reset(mv, PID.DESCRIPTION); changed = true; }
  }
  return changed;
}

/** Forces the card number of a movement (short text) or gives it back to the automatic numbering (null / blank). */
export function setCardNumber(doc, mv, text) {
  movementIndex(doc, mv);
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length > MAX_CARD_NUMBER_LENGTH) throw new EditError('A card number is short');
  if (!t) { if (mv.props[PID.CARD_NUMBER] == null) return false; doc.reset(mv, PID.CARD_NUMBER); return true; }
  return doc.set(mv, PID.CARD_NUMBER, t);
}

export function setCardNumberFormat(doc, format) {
  if (typeof format !== 'string' || format.length > 24) throw new EditError('Invalid card number format');
  if (format === '{n}') { if (doc.work.props[PID.CARD_NUMBER_FORMAT] == null) return false; doc.reset(doc.work, PID.CARD_NUMBER_FORMAT); return true; }
  return doc.set(doc.work, PID.CARD_NUMBER_FORMAT, format);
}
