/*
 * Moves a chord to another voice of its staff (the voice button of the selection bar): the chord is copied at the same instant with the same written
 * duration into the target voice, then removed from its voice (rests are recomputed). The target voice is never overwritten: if something of
 * another span is there, the move is refused with a message. Same span and a chord already there: the notes join it. To be called INSIDE a transaction.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { fEq, fLt } from './fraction.js';
import { measureLengthOf } from './timing.js';
import { measureTimeline, cloneChord, ensureVoice, replaceVoiceMeasure, deleteItem, EditError } from './noteedit.js';

const overlaps = (a, b) => fLt(a.start, b.end) && fLt(b.start, a.end);

/** Voice index (0 to 3) of a chord or rest. */
export function voiceIndexOf(doc, item) {
  const measure = doc.parentOf(item.id);
  const voice = doc.parentOf(measure.id);
  return doc.parentOf(voice.id).voices.indexOf(voice);
}

/**
 * @returns {{ chord, noteIds: Map }|null} the chord now holding the notes, and old note id → new note id; null when the chord is already in that voice.
 */
export function moveChordToVoice(doc, chord, toVoice) {
  if (chord.type !== 'chord') throw new EditError('Accord attendu');
  const measure = doc.parentOf(chord.id);
  const voice = doc.parentOf(measure.id);
  const staff = doc.parentOf(voice.id);
  const from = staff.voices.indexOf(voice);
  if (from === toVoice) return null;
  if (chord.props[PID.TUPLET]) throw new EditError("Un accord de n-olet ne change pas de voix");
  const mi = voice.measures.indexOf(measure);
  const length = measureLengthOf(doc.movementOf(staff).masterbars[mi]);
  const unit = measureTimeline(measure, length).find((x) => x.item === chord);
  ensureVoice(doc, staff, toVoice);
  const target = measureTimeline(staff.voices[toVoice].measures[mi], length);
  const busy = target.filter((x) => (x.item.type === 'chord' || getProperty(x.item, PID.EXPLICIT) === true) && overlaps(x, unit));
  const duration = getProperty(chord, PID.DURATION);
  const copy = cloneChord(chord, duration);
  const noteIds = new Map(chord.notes.map((n, i) => [n.id, copy.notes[i].id]));
  let holder = copy;
  if (busy.length) {
    const same = busy.length === 1 && busy[0].item.type === 'chord' && fEq(busy[0].start, unit.start) && fEq(busy[0].end, unit.end) ? busy[0].item : null;
    if (!same) throw new EditError('Cette voix est déjà occupée à cet endroit');
    for (const n of copy.notes) doc.add(same, 'notes', n);
    holder = same;
  } else {
    const occupants = target.filter((x) => x.item.type === 'chord' || getProperty(x.item, PID.EXPLICIT) === true).map((x) => ({ el: x.item, start: x.start, end: x.end }));
    occupants.push({ el: copy, start: unit.start, end: unit.end });
    occupants.sort((a, b) => (fLt(a.start, b.start) ? -1 : fLt(b.start, a.start) ? 1 : 0));
    replaceVoiceMeasure(doc, { staff, voice: toVoice, measure: mi, occupants });
  }
  deleteItem(doc, chord);
  return { chord: holder, noteIds };
}
