/*
 * Retouches of the note(s) JUST CREATED (the "creation bar"): no DOM. Every function is called inside `doc.transaction` through `Application.edit`.
 *  - accidental: the cycle natural → sharp → flat on the spelling of the note (the pitch follows the letter + alteration);
 *  - dot: the written duration of the chord gets / loses its dot (the chord is placed again at the same instant, same notes copied);
 *  - rest: the chord is replaced by an explicit rest of the same duration.
 * Not available (the bar hides the button): accidental on a transposing instrument or a non-notation staff; dot in a tuplet.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { midiFromSpelling, defaultSpelling } from '../model/pitch.js';
import { trackTransposition } from '../model/instruments.js';
import { createTie } from '../model/elements.js';
import { tieMates } from '../model/tiechain.js';
import { placeChord, placeRest, cloneChord, measureTimeline, EditError } from '../model/noteedit.js';
import { durationValue } from '../model/rhythmsplit.js';
import { measureLengthOf } from '../model/timing.js';
import { fAdd, fLe, fLt } from '../model/fraction.js';
import { cursorOfElement } from './noteentry-cursor.js';
import { tuningPitches, tuningPitchesAt, staffTimeline } from '../model/capo.js';
import { maxFretFor } from './noteentry-intents.js';

const CHORD_OR_REST = new Set(['chord', 'rest']);
const NOTE_TYPES = new Set(['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);

/** Chords (or rests) that hold the given element ids (a note stands for its chord); each chord once. */
export function creationChords(doc, ids) {
  const out = new Map();
  for (const id of ids ?? []) {
    let el = doc.find(id);
    if (el && NOTE_TYPES.has(el.type)) el = doc.parentOf(el.id);
    if (el && CHORD_OR_REST.has(el.type)) out.set(el.id, el);
  }
  return [...out.values()];
}

const spellingOf = (note) => getProperty(note, PID.SPELLING) ?? defaultSpelling(getProperty(note, PID.PITCH) ?? 60, 0);

/** The pitched notation notes among the ids, or [] when the bar must not offer the accidental (transposing instrument, other staff types). */
export function accidentalNotes(doc, ids) {
  const notes = [];
  for (const chord of creationChords(doc, ids)) {
    if (chord.type !== 'chord') return [];
    for (const n of chord.notes ?? []) {
      if (n.type !== 'note') return [];
      const staff = doc.parentOf(doc.parentOf(doc.parentOf(chord.id).id).id);
      const track = staff && doc.parentOf(staff.id);
      const tr = track ? trackTransposition(track) : null;
      if (tr && (tr.chromatic || tr.diatonic)) return [];
      notes.push(n);
    }
  }
  return notes;
}

/** State shown by the cyclic button: 0 natural, 1 sharp, 2 flat (a double alteration counts as its sign). */
export function accidentalState(notes) {
  if (!notes.length) return 0;
  const a = spellingOf(notes[0]).alter ?? 0;
  return a > 0 ? 1 : a < 0 ? 2 : 0;
}

/** Sets the alteration (state 0 / 1 / 2) of the notes: same letter and octave, new pitch. */
export function setAccidental(doc, notes, state) {
  const alter = state === 1 ? 1 : state === 2 ? -1 : 0;
  const done = new Set();
  for (const n of notes) {
    if (done.has(n.id)) continue;
    const sp = spellingOf(n);
    const next = { step: sp.step, alter, octave: sp.octave };
    const before = getProperty(n, PID.PITCH);
    doc.set(n, PID.SPELLING, next);
    doc.set(n, PID.PITCH, midiFromSpelling(next));
    done.add(n.id);
    // the notes tied to it (same pitch) are the same sustained note: same spelling
    for (const m of tieMates(doc, n)) {
      if (done.has(m.id) || m.type !== 'note' || getProperty(m, PID.PITCH) !== before) continue;
      doc.set(m, PID.SPELLING, next);
      doc.set(m, PID.PITCH, midiFromSpelling(next));
      done.add(m.id);
    }
  }
}

const placeOf = (doc, chord) => {
  const at = cursorOfElement(doc, chord.id);
  if (!at) throw new EditError('Accord introuvable');
  return at;
};

/** Where a chord stands { staffId, measureIndex, position, voice }, or null. */
export const positionOf = (doc, chord) => cursorOfElement(doc, chord.id);

/** True when the chord can be dotted / un-dotted here (not a tuplet member). */
export const canDot = (chord) => chord?.type === 'chord' && !getProperty(chord, PID.TUPLET);

/** Toggles the dot of the chord; returns { select } = the notes of the new chord. */
export function toggleDot(doc, chord) {
  if (!canDot(chord)) throw new EditError('Pas de point dans un n-olet');
  const at = placeOf(doc, chord);
  const d = getProperty(chord, PID.DURATION);
  const duration = { base: d.base, dots: d.dots ? 0 : 1 };
  const { chords } = placeChord(doc, { staff: at.staffId, voice: at.voice, measure: at.measureIndex, position: at.position, duration, makeChord: (dd) => cloneChord(chord, dd) });
  return { select: chords.flatMap((c) => c.notes.map((n) => n.id)) };
}

/** Replaces the chord by an explicit rest of the same duration; returns { select } = the rest. */
export function replaceWithRest(doc, chord) {
  const at = placeOf(doc, chord);
  const d = getProperty(chord, PID.DURATION);
  const rest = placeRest(doc, { staff: at.staffId, voice: at.voice, measure: at.measureIndex, position: at.position, duration: { base: d.base, dots: d.dots ?? 0 } });
  return { select: [rest.id] };
}

const BASES = ['sixtyfourth', 'thirtysecond', 'sixteenth', 'eighth', 'quarter', 'half', 'whole', 'breve'];

/** True when the written duration of the chord can be changed here (a chord outside a tuplet). */
export const canChangeLength = (chord) => canDot(chord) || canChangeRestLength(chord);

/** True for a rest outside a tuplet: its written value can be changed (a longer one swallows the rests that follow). */
export const canChangeRestLength = (rest) => rest?.type === 'rest' && !getProperty(rest, PID.TUPLET);

/**
 * Gives a rest a chosen written value. A longer one takes the rests that follow it (4 sixteenth rests + « half » = one half rest); it is refused when a note or a tuplet lies in the way,
 * or when it would run out of the measure. A shorter one leaves a gap that the measure fills with rests. The result is an explicit rest. Returns { select } = the new rest.
 */
export function setRestDuration(doc, rest, duration) {
  if (!canChangeRestLength(rest)) throw new EditError('Pas de changement de durée dans un n-olet');
  const at = placeOf(doc, rest);
  const measure = doc.parentOf(rest.id);
  const mv = doc.movementOf(measure);
  const length = measureLengthOf(mv.masterbars[at.measureIndex]);
  const line = measureTimeline(measure, length);
  const unit = line.find((x) => x.item === rest);
  const end = fAdd(unit.start, durationValue({ base: duration.base, dots: duration.dots ?? 0 }));
  if (!fLe(end, length)) throw new EditError('Cette durée dépasse la mesure');
  for (const x of line) {
    if (x === unit || !(fLt(x.start, end) && fLt(unit.start, x.end))) continue;
    if (x.item.type !== 'rest') throw new EditError('Des notes se trouvent dans cette durée : seuls des silences peuvent être regroupés');
    if (getProperty(x.item, PID.TUPLET)) throw new EditError('Un silence de n-olet ne se regroupe pas');
  }
  const made = placeRest(doc, { staff: at.staffId, voice: at.voice, measure: at.measureIndex, position: unit.start, duration: { base: duration.base, dots: duration.dots ?? 0 } });
  return { select: [made.id] };
}

/**
 * Makes the chord one written value longer / shorter (quarter → half, quarter → eighth; the dot is cleared). A longer chord overwrites what follows;
 * a shorter one leaves a gap that the measure fills with rests. Returns { select } = the notes of the new chord.
 */
export function changeLength(doc, chord, longer) {
  if (!canChangeLength(chord)) throw new EditError('Pas de changement de durée dans un n-olet');
  const d = getProperty(chord, PID.DURATION);
  const i = BASES.indexOf(d.base) + (longer ? 1 : -1);
  if (i < 0 || i >= BASES.length) throw new EditError('Durée limite atteinte');
  return setChordDuration(doc, chord, { base: BASES[i], dots: 0 });
}

/** Gives the chord a chosen written value (a longer one overwrites what follows, a shorter one leaves a gap filled with rests). Returns { select } = the notes of the new chord. */
export function setChordDuration(doc, chord, duration) {
  if (chord.type === 'rest') return setRestDuration(doc, chord, duration); // a rest: the rests that follow are taken
  if (!canChangeLength(chord)) throw new EditError('Pas de changement de durée dans un n-olet');
  const at = placeOf(doc, chord);
  const staff = staffOfChord(doc, chord);
  const own = new Map(chord.notes.map((n, k) => [n.id, k]));
  // ties that touch the old notes (the chord is replaced by a copy with new ids, which would drop them)
  const kept = staff ? (getProperty(staff, PID.TIES) ?? []).filter((x) => own.has(x.startNoteId) || own.has(x.endNoteId)) : [];
  const { chords } = placeChord(doc, { staff: at.staffId, voice: at.voice, measure: at.measureIndex, position: at.position, duration: { base: duration.base, dots: duration.dots ?? 0 }, makeChord: (dd) => cloneChord(chord, dd) });
  if (staff && kept.length) relinkTies(doc, staff, kept, own, chords);
  return { select: chords.flatMap((c) => c.notes.map((n) => n.id)) };
}

const staffOfChord = (doc, chord) => {
  for (let el = doc.parentOf(chord.id); el; el = doc.parentOf(el.id)) if (el.type === 'staff') return el;
  return null;
};

/**
 * Re-attaches the ties of a chord that was replaced by a copy. An incoming tie now ends on the first new piece, an outgoing one starts on the last piece
 * (note by note, same rank in the chord); a tie whose other end no longer exists (swallowed by a longer note) is not restored.
 */
function relinkTies(doc, staff, kept, own, chords) {
  const first = chords[0];
  const last = chords[chords.length - 1];
  const list = getProperty(staff, PID.TIES) ?? [];
  const have = new Set(list.map((x) => x.id));
  const add = [];
  for (const x of kept) {
    if (have.has(x.id)) continue;
    const alive = (id) => !own.has(id) && doc.parentOf(id);
    if (own.has(x.endNoteId) && !own.has(x.startNoteId) && alive(x.startNoteId)) {
      const n = first.notes[own.get(x.endNoteId)];
      if (n) add.push(createTie(x.startNoteId, n.id));
    } else if (own.has(x.startNoteId) && !own.has(x.endNoteId) && alive(x.endNoteId)) {
      const n = last.notes[own.get(x.startNoteId)];
      if (n) add.push(createTie(n.id, x.endNoteId));
    }
  }
  if (add.length) doc.set(staff, PID.TIES, [...list, ...add]);
}

/**
 * Moves tablature notes by a semitone (a fret) or an octave (12 frets) on the SAME string. Refused when a capo changes the displayed frets or when the new fret
 * would leave 0..last fret of the instrument. Returns the number of notes changed.
 */
export function shiftTabNotes(doc, notes, up, octave = false) {
  const step = (up ? 1 : -1) * (octave ? 12 : 1);
  let changed = 0;
  // the notes tied to a moved note are the same sustained note: they move with it (each one on its own string, checked on its own)
  const all = []; const seen = new Set();
  for (const n of notes) for (const m of [n, ...tieMates(doc, n).filter((x) => x.type === 'tabnote' && getProperty(x, PID.PITCH) === getProperty(n, PID.PITCH))]) if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
  for (const n of all) {
    const chord = doc.parentOf(n.id);
    const staff = doc.parentOf(doc.parentOf(doc.parentOf(chord.id).id).id);
    if ((getProperty(staff, PID.CAPOS) ?? []).length) throw new EditError('Tablature avec capo : changez la frette depuis la boîte de saisie');
    const movement = doc.movementOf(staff);
    const at = staffTimeline(movement, staff).find((t) => t.item.id === chord.id);
    const open = (at ? tuningPitchesAt(movement, staff, at.key) : tuningPitches(staff))[(getProperty(n, PID.STRING) ?? 1) - 1];
    const pitch = getProperty(n, PID.PITCH);
    const fret = pitch + step - open;
    if (fret < 0 || fret > maxFretFor(doc, staff)) throw new EditError('Frette hors de la plage de la corde');
    doc.set(n, PID.PITCH, pitch + step);
    changed += 1;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Stem direction chosen by the user (any voice; not on a percussion staff, whose sounds carry their own direction)
// ---------------------------------------------------------------------------

/** Staff types where the user may force the direction of a stem. */
const STEM_STAFF_TYPES = new Set(['score', 'tab', 'rhythm', 'neutral', 'percussion']); // (a percussion chord's own direction wins over the sound's)
export const STEM_STATES = Object.freeze(['auto', 'up', 'down']);

/** The chords of the ids on a staff where the direction can be chosen; [] when one of them sits on another kind of staff (the button is then not offered). */
export function stemChords(doc, ids) {
  const chords = creationChords(doc, ids).filter((c) => c.type === 'chord');
  if (!chords.length) return [];
  for (const c of chords) {
    const staff = doc.parentOf(doc.parentOf(doc.parentOf(c.id).id).id);
    if (!staff || !STEM_STAFF_TYPES.has(getProperty(staff, PID.STAFF_TYPE))) return [];
  }
  return chords;
}

/** State shown by the cyclic button: 0 automatic, 1 up, 2 down (that of the first chord). */
export function stemState(chords) {
  const d = chords.length ? getProperty(chords[0], PID.STEM_DIRECTION) : 'auto';
  return Math.max(0, STEM_STATES.indexOf(d));
}

/** Sets the direction (state 0 = automatic: the local value is removed) of the chords. */
export function setStemState(doc, chords, state) {
  for (const c of chords) {
    if (state === 0) doc.reset(c, PID.STEM_DIRECTION);
    else doc.set(c, PID.STEM_DIRECTION, STEM_STATES[state]);
  }
}
