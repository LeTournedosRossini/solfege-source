/*
 * The "Molette" (wheel): a written pitch bend on a note of any instrument, the guitar included (guitar bends keep their own place in bend.js / bendedit.js, as MuseScore has them).
 * It works like the pitch wheel of a keyboard, written down: no arrival note, the note keeps its written pitch and `curve` says how far the wheel
 * moves while the note sounds. `scope` 'chord' moves every note of the chord (a real wheel), 'note' only the note it is anchored on.
 * Entries live in PID.WHEELS of the staff, anchored by identity on a real note (so a copy, a deletion or an undo treat them like a bend).
 * ALL WRITES GO THROUGH `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createWheel } from './elements.js';
import { EditError } from './noteedit.js';
import { itemDuration, measureLengthOf } from './timing.js';
import { ZERO, fAdd, fToNumber } from './fraction.js';
import { BEND_CURVE_MAX_POINTS, BEND_CURVE_MAX_SEMITONES, BEND_CURVE_MIN_GAP, isValidBendCurve } from './bend.js';

/** What a new wheel does until the user draws it: up a whole tone in the first half of the note, then held. */
export const defaultWheelCurve = () => [{ t: 0, s: 0 }, { t: 0.5, s: 2 }, { t: 1, s: 2 }];

const WHEEL_NOTE_TYPES = new Set(['note', 'tabnote']);

const unwrap = (x) => (x ? (x.el ?? x) : null);

function staffOf(doc, id) {
  let p = doc.parentOf(id);
  while (p) { const el = unwrap(p); if (el.type === 'staff') return el; p = doc.parentOf(el.id); }
  return null;
}

/** Position of a chord in its staff: { voice, mi } or null. */
function locate(staff, chordId) {
  for (let v = 0; v < (staff.voices?.length ?? 0); v++) {
    const measures = staff.voices[v].measures;
    for (let mi = 0; mi < measures.length; mi++) if (measures[mi].items.some((it) => it.id === chordId)) return { voice: v, mi };
  }
  return null;
}

/** The curve of an entry as stored, or the default one. */
export const wheelCurveOf = (entry) => (isValidBendCurve(entry?.curve) ? entry.curve : defaultWheelCurve());

/** Length of the chord of a note, in quarter notes, plus the chords it is tied to (the curve runs over the whole tied sound). */
export function wheelBeats(doc, noteId) {
  const staff = staffOf(doc, noteId);
  if (!staff) return null;
  const movement = doc.movementOf(staff);
  const ties = getProperty(staff, PID.TIES) ?? [];
  let total = ZERO; let id = noteId; const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const chord = unwrap(doc.parentOf(id));
    const at = chord && locate(staff, chord.id);
    if (!at) return null;
    total = fAdd(total, itemDuration(chord, measureLengthOf(movement.masterbars[at.mi])));
    id = ties.find((t) => t.startNoteId === id)?.endNoteId ?? null;
  }
  return fToNumber(total) * 4;
}

/** Ids of the notes a wheel entry moves: the notes of the chord ('chord') or the note itself ('note'). */
export function wheelNoteIds(doc, entry) {
  if (entry.scope !== 'chord') return [entry.startNoteId];
  const chord = unwrap(doc.parentOf(entry.startNoteId));
  return chord?.notes ? chord.notes.map((n) => n.id) : [entry.startNoteId];
}

/** Adds a wheel on a note. Returns the entry. TO CALL INSIDE `doc.transaction`. */
export function addWheel(doc, noteId, { scope = 'chord' } = {}) {
  const note = doc.find(noteId);
  if (!note || !WHEEL_NOTE_TYPES.has(note.type)) throw new EditError('Sélectionnez une note de portée de notation ou de tablature');
  const staff = staffOf(doc, noteId);
  if (!staff) throw new EditError('Note introuvable');
  const list = getProperty(staff, PID.WHEELS) ?? [];
  const chord = unwrap(doc.parentOf(noteId));
  const chordNotes = new Set((chord?.notes ?? []).map((n) => n.id));
  if (list.some((w) => (w.scope === 'chord' && chordNotes.has(w.startNoteId)) || w.startNoteId === noteId)) throw new EditError('Cette note a déjà une molette');
  const entry = createWheel(noteId, { scope });
  doc.set(staff, PID.WHEELS, [...list, entry]);
  return entry;
}

function entryOf(doc, entryId) {
  const found = doc.findListEntry(entryId);
  if (!found || found.kind !== 'wheel') return null;
  return found;
}

/**
 * What the graph needs: `{ editable, kind: 'wheel', type: 'wheel', scope, chordSize, points, custom, beats, semitones }` or null when the entry is not a wheel.
 * `semitones` = the largest excursion (signed), for the text next to the graph.
 */
export function wheelInfo(doc, entryId) {
  const found = entryOf(doc, entryId);
  if (!found) return null;
  const entry = found.entry;
  const chord = unwrap(doc.parentOf(entry.startNoteId));
  const points = wheelCurveOf(entry).map((p) => ({ ...p, ...(p.h ? { h: [...p.h] } : {}) }));
  const peak = points.reduce((m, p) => (Math.abs(p.s) > Math.abs(m) ? p.s : m), 0);
  return {
    editable: true, kind: 'wheel', type: 'wheel', scope: entry.scope, chordSize: chord?.notes?.length ?? 1, points,
    custom: isValidBendCurve(entry.curve), beats: wheelBeats(doc, entry.startNoteId), semitones: peak, hops: 1,
  };
}

/** Stores the curve (sorted, snapped to half semitones, thinned to a minimum gap, first point at t = 0). Returns the stored points. */
export function setWheelCurve(doc, entryId, points) {
  const found = entryOf(doc, entryId);
  if (!found) throw new EditError('Molette attendue');
  if (!Array.isArray(points) || points.length < 2) throw new EditError('Au moins deux points');
  const clean = points
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.s))
    .map((p) => ({
      t: Math.min(1, Math.max(0, p.t)),
      s: Math.max(-BEND_CURVE_MAX_SEMITONES, Math.min(BEND_CURVE_MAX_SEMITONES, Math.round(p.s * 2) / 2)),
      ...(Array.isArray(p.h) && p.h.every(Number.isFinite) ? { h: [Math.max(-1, Math.min(1, p.h[0])), Math.max(-BEND_CURVE_MAX_SEMITONES, Math.min(BEND_CURVE_MAX_SEMITONES, p.h[1]))] } : {}),
    }))
    .sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of clean) {
    if (out.length && p.t - out[out.length - 1].t < BEND_CURVE_MIN_GAP) { out[out.length - 1] = { ...p, t: out[out.length - 1].t }; continue; }
    out.push({ ...p });
  }
  if (out.length < 2) throw new EditError('Au moins deux points');
  if (out.length > BEND_CURVE_MAX_POINTS) throw new EditError(`Au plus ${BEND_CURVE_MAX_POINTS} points`);
  out[0] = { ...out[0], t: 0 };
  if (!isValidBendCurve(out)) throw new EditError('Courbe invalide');
  mutate(doc, found.entry.id, (e) => ({ ...e, curve: out }));
  return out;
}

/** Back to the default curve. Returns true when something changed. */
export function resetWheelCurve(doc, entryId) {
  const found = entryOf(doc, entryId);
  if (!found || found.entry.curve === undefined) return false;
  mutate(doc, found.entry.id, (e) => { const { curve: _c, ...rest } = e; return rest; });
  return true;
}

/** 'chord' (every note of the chord) or 'note' (the anchored note only). */
export function setWheelScope(doc, entryId, scope) {
  const found = entryOf(doc, entryId);
  if (!found) throw new EditError('Molette attendue');
  if (scope !== 'chord' && scope !== 'note') throw new EditError('Portée de molette inconnue');
  if (found.entry.scope === scope) return scope;
  const staff = staffOf(doc, found.entry.startNoteId);
  const chord = unwrap(doc.parentOf(found.entry.startNoteId));
  const ids = new Set((chord?.notes ?? []).map((n) => n.id));
  const others = (getProperty(staff, PID.WHEELS) ?? []).filter((w) => w.id !== found.entry.id);
  if (others.some((w) => (scope === 'chord' ? ids.has(w.startNoteId) : w.startNoteId === found.entry.startNoteId && w.scope === 'note'))) {
    throw new EditError('Une autre molette agit déjà ici');
  }
  mutate(doc, found.entry.id, (e) => ({ ...e, scope }));
  return scope;
}

function mutate(doc, entryId, fn) {
  const found = entryOf(doc, entryId);
  const staff = staffOf(doc, found.entry.startNoteId);
  doc.set(staff, PID.WHEELS, (getProperty(staff, PID.WHEELS) ?? []).map((e) => (e.id === entryId ? fn(e) : e)));
}

/** Validation errors of a staff's wheels (`noteIds` = every note id of the staff). */
export function validateWheels(list, noteIds) {
  const errors = [];
  for (const w of list) {
    if (w.type !== 'wheel') errors.push(`molette ${w.id} : type inconnu`);
    if (w.scope !== 'chord' && w.scope !== 'note') errors.push(`molette ${w.id} : portée inconnue`);
    if (!noteIds.has(w.startNoteId)) errors.push(`molette ${w.id} : note absente de la portée`);
    if (w.curve !== undefined && !isValidBendCurve(w.curve)) errors.push(`molette ${w.id} : courbe invalide`);
  }
  return errors;
}
