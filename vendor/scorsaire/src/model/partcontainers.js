/*
 * Containers owned by a PART (screen 2) that sit above, or between, the measures of one of its staves — the same containers as on screen 1
 * (`staff.containers`), but kept in `part.containers` with the staff they hang on (`PID.CONTAINER_STAFF_ID`): they appear in that part only, never on
 * screen 1 nor in another part, and are never played. Example: the part of a drummer = the chord track plus containers holding the pattern to play.
 * (The "zone" containers of the same list — between the systems — are in partzones.js; `placement` tells them apart.)
 * Every function writes: call it inside `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';
import { addTextContainer, addSlotContainer, addNestedContainer, addFragmentContainer, addDiagramContainer, setContainerSpan, setContainerText, setFragmentMeasures } from './containeredit.js';
import { EditError } from './noteedit.js';
import { measureLengthOf } from './timing.js';
import { fEq } from './fraction.js';
import { hydrate } from './serialize.js';
import { setElementOverride } from './partedit.js';

export class PartContainerError extends EditError { constructor(message, code = 'partContainer') { super(message); this.code = code; } }

/** A container of a part that hangs on a staff (not a zone cell). */
export const isStaffBound = (c) => getProperty(c, PID.CONTAINER_PLACEMENT) !== 'zone';

/** The staff-bound containers of a part, in the order of the list (the first is nearest the staff). */
export const partContainersOf = (part) => (part.containers ?? []).filter(isStaffBound);

const partOf = (doc, id) => { const p = doc.find(id); if (!p || p.type !== 'part') throw new PartContainerError(`Partie inconnue : ${id}`, 'part'); return p; };

function staffOf(doc, part, staffId) {
  const staff = doc.find(staffId);
  if (!staff || staff.type !== 'staff') throw new PartContainerError('Portée inconnue', 'staff');
  const own = part.props[PID.PART_STAVES];
  if (own && !own.includes(staffId)) throw new PartContainerError('Cette portée n\'est pas montrée dans la partie', 'staff');
  return staff;
}

/**
 * Adds a container to `part`, hung on `staffId` at `measureId`.
 * spec: { kind: 'text' | 'nestedNotation' | 'chordDiagram', chord?, instrument?, voicing?, placement: 'above' | 'between', side?: 'before' | 'after', span?, text?, staffType?, clef?, measures?, grand? }
 * (a text container is created with its text; a nested notation with an empty score of `staffType`, which the nested-score editor then fills).
 */
export function addPartContainer(doc, partId, staffId, measureId, spec = {}) {
  const part = partOf(doc, partId);
  const staff = staffOf(doc, part, staffId);
  const mv = doc.movementOf(staff);
  if (!mv) throw new PartContainerError('Portée sans Mouvement', 'staff');
  const { kind = 'text', placement = 'above', side = 'before' } = spec;
  let c;
  if (kind === 'text') {
    c = placement === 'between'
      ? addSlotContainer(doc, mv, part, { measureId, side, text: spec.text ?? '…', gap: !!spec.gap })
      : addTextContainer(doc, mv, part, { measureId, span: spec.span ?? 1, text: spec.text ?? '…' });
  } else if (kind === 'nestedNotation') {
    c = placement === 'between'
      ? addFragmentContainer(doc, mv, part, { measureId, side, staffType: spec.staffType ?? 'score', measures: spec.measures ?? 1, clef: spec.clef, grand: !!spec.grand })
      : addNestedContainer(doc, mv, part, { measureId, span: spec.span ?? 1, staffType: spec.staffType ?? 'score', clef: spec.clef });
  } else if (kind === 'chordDiagram') {
    c = addDiagramContainer(doc, mv, part, { measureId, span: spec.span ?? 1, placement, side, chord: spec.chord ?? null, instrument: spec.instrument ?? 'guitar', voicing: spec.voicing ?? null });
  } else throw new PartContainerError(`Genre non pris en charge : ${kind}`, 'kind');
  doc.set(c, PID.CONTAINER_STAFF_ID, staffId);
  return c;
}

function containerOf(doc, partId, id) {
  const part = partOf(doc, partId);
  const c = partContainersOf(part).find((x) => x.id === id);
  if (!c) throw new PartContainerError('Conteneur inconnu', 'container');
  return { part, c };
}

export function removePartContainer(doc, partId, id) {
  const { c } = containerOf(doc, partId, id);
  doc.remove(c);
}

/** Number of measures covered by a stacked container (the fragment follows). */
export function setPartContainerSpan(doc, partId, id, span) {
  const { c } = containerOf(doc, partId, id);
  const mv = doc.movementOf(doc.find(getProperty(c, PID.CONTAINER_STAFF_ID)));
  if (!mv) throw new PartContainerError('Portée disparue', 'staff');
  setContainerSpan(doc, mv, c, span);
}

export function setPartContainerText(doc, partId, id, text) {
  const { c } = containerOf(doc, partId, id);
  if (getProperty(c, PID.CONTAINER_KIND) !== 'text') throw new PartContainerError('Ce conteneur n\'est pas un texte', 'kind');
  setContainerText(doc, c, text);
}

/** Moves a container one place in the stack of its staff (the first is nearest the staff): only containers of the same staff are swapped. */
export function movePartContainer(doc, partId, id, delta) {
  const { part, c } = containerOf(doc, partId, id);
  const staffId = getProperty(c, PID.CONTAINER_STAFF_ID);
  const same = partContainersOf(part).filter((x) => getProperty(x, PID.CONTAINER_STAFF_ID) === staffId);
  const at = same.findIndex((x) => x.id === id);
  const other = same[at + delta];
  if (!other) throw new PartContainerError('Déplacement impossible', 'move');
  const list = part.containers;
  const target = list.indexOf(other);
  doc.remove(c);
  doc.add(part, 'containers', c, target);
}

// ---------------------------------------------------------------------------
// Copy / paste of a container (inside a part, or from one part to another)
// ---------------------------------------------------------------------------

/**
 * A deep copy of an element tree with FRESH identifiers: every object that carries an `id` gets a new one (same prefix), and every string that was one of
 * the old identifiers (a tie that names its notes, a measure that names its masterbar…) is rewritten, so the copy is self-consistent.
 */
export function cloneWithFreshIds(node) {
  const copy = structuredClone(node);
  const map = new Map();
  const collect = (v) => {
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && !map.has(v.id)) map.set(v.id, newId(v.id.replace(/[0-9]+$/, '') || 'e'));
      Object.values(v).forEach(collect);
    }
  };
  collect(copy);
  const rewrite = (v) => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = rewrite(v[k]); return v; }
    return typeof v === 'string' && map.has(v) ? map.get(v) : v;
  };
  return rewrite(copy);
}

/**
 * Pastes a copy of the container `sourceId` (a container of any part) into `partId`, hung on `staffId` at `measureId`. Above the measures it keeps its
 * number of measures (they must exist, and a nested score aligned on the measures must find measures of the same length); between measures it keeps its
 * side. Returns the new container.
 */
export function pastePartContainer(doc, sourceId, partId, staffId, measureId) {
  const part = partOf(doc, partId);
  const staff = staffOf(doc, part, staffId);
  const copy = copyOf(doc, sourceId, staff, measureId, { [PID.CONTAINER_STAFF_ID]: staffId });
  doc.add(part, 'containers', copy);
  return copy;
}

/**
 * The same copy for screen 1: the container `sourceId` (hung on a staff, or owned by a part) pasted on `staffId` at `measureId`, as a container of that staff
 * (fresh identifiers, same checks as a paste into a part). Returns the new container.
 */
export function pasteStaffContainer(doc, sourceId, staffId, measureId) {
  const staff = doc.find(staffId);
  if (!staff || staff.type !== 'staff') throw new PartContainerError('Portée inconnue', 'staff');
  const copy = copyOf(doc, sourceId, staff, measureId, { [PID.CONTAINER_STAFF_ID]: null });
  doc.add(staff, 'containers', copy);
  return copy;
}

/** The fresh copy of a staff-bound container for `staff` at `measureId` (checks the room and the lengths); `extra` = the props that say whose it is. */
function copyOf(doc, sourceId, staff, measureId, extra) {
  const source = doc.find(sourceId);
  const sourceParent = doc.parentOf(sourceId)?.type; // a container of a part, or one of a staff (screen 1)
  if (!source || source.type !== 'staffContainer' || (sourceParent !== 'part' && sourceParent !== 'staff') || !isStaffBound(source)) throw new PartContainerError('Conteneur à copier inconnu', 'source');
  const mv = doc.movementOf(staff);
  const at = mv.masterbars.findIndex((b) => b.id === measureId);
  if (at < 0) throw new PartContainerError('Mesure inconnue', 'measure');
  const placement = getProperty(source, PID.CONTAINER_PLACEMENT);
  const span = getProperty(source, PID.SPAN);
  const fragment = source.fragments?.[0];
  let anchor = measureId;
  let side = getProperty(source, PID.CONTAINER_SIDE);
  if (placement === 'between') {
    if (side === 'after' && at < mv.masterbars.length - 1) { anchor = mv.masterbars[at + 1].id; side = 'before'; } // canonical form
  } else {
    if (at + span > mv.masterbars.length) throw new PartContainerError('Le conteneur dépasse la fin du Mouvement', 'span');
    if (fragment && getProperty(source, PID.CONTAINER_LAYOUT) !== 'free') {
      fragment.masterbars.forEach((fb, k) => {
        if (!fEq(measureLengthOf(fb), measureLengthOf(mv.masterbars[at + k]))) throw new PartContainerError(`La mesure ${k + 1} n'a pas la même longueur à cet endroit`, 'length');
      });
    }
  }
  const plain = cloneWithFreshIds(JSON.parse(JSON.stringify(source))); // the JSON form of the element, with fresh identifiers
  plain.props = { ...plain.props, [PID.MEASURE_ID]: anchor, ...extra };
  if (extra[PID.CONTAINER_STAFF_ID] === null) delete plain.props[PID.CONTAINER_STAFF_ID];
  if (placement === 'between') plain.props[PID.CONTAINER_SIDE] = side;
  return hydrate(plain);
}

/**
 * Copies a container of screen 1 (hung on a staff of the piece) into a part, at the same place: the copy belongs to the part (editable there, absent
 * elsewhere). `hideOriginal` (default) hides the original in THIS part so that only the copy shows. Returns the copy.
 */
export function copyContainerToPart(doc, sourceId, partId, { hideOriginal = true } = {}) {
  const part = partOf(doc, partId);
  const source = doc.find(sourceId);
  const staff = source && doc.parentOf(sourceId);
  if (!source || source.type !== 'staffContainer' || staff?.type !== 'staff') throw new PartContainerError('Ce n\'est pas un conteneur de l\'écran 1', 'source');
  const copy = pastePartContainer(doc, sourceId, partId, staff.id, getProperty(source, PID.MEASURE_ID));
  if (hideOriginal) setElementOverride(doc, partId, [sourceId], { hidden: true });
  return copy;
}
