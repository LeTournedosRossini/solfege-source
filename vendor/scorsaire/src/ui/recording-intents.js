/*
 * Recording a take: the intentions WITHOUT DOM, called by `Application`.
 *  - `recordTarget(doc, range)`: what a selected range lets us record on — the staff (notation or tablature, linked tablature included) and the whole
 *    measures it touches (the first measure to the last, partial measures count as whole).
 *  - `commitTake(doc, { staffId, fromMeasure, toMeasure, chords })` (CALL IT INSIDE `doc.transaction`): empties those measures on the staff and writes the
 *    quantized chords of `quantizeTake` (one voice). A chord is cut into written values and tied across barlines by `placeChord`; the gaps are rests.
 *    A tablature staff gets its strings and frets (the fretboard's, else the pitch converted with the tuning and capo); a notation staff gets the pitch
 *    spelled from the key signature (the string pressed on the fretboard is remembered for a linked tablature).
 */
import {
  PID, getProperty, createChord, createNote, createTabNote, defaultSpelling, placeChord, clearRange, isLinkedStaff, primaryOf,
  fSub, fCmp, ZERO, measureLengthOf, rangeFromMeasures,
} from '../model/index.js';
import { rangeMeasureSpan } from '../model/range.js';
import { NoteEntryError, tabNoteAt } from './noteentry-intents.js';
import { tabStringFor } from './noteentry-keyboard.js';

const RECORDABLE = ['score', 'tab'];

/** { staffId, movement, fromMeasure, toMeasure (excluded) } or null when the range is not on one staff of notation / tablature. */
export function recordTarget(doc, range) {
  if (!range?.staffIds?.length) return null;
  const staff = doc.find(range.staffIds[0]);
  if (!staff || staff.type !== 'staff' || !RECORDABLE.includes(getProperty(staff, PID.STAFF_TYPE))) return null;
  const movement = doc.movementOf(staff);
  const span = movement && rangeMeasureSpan(movement, range);
  if (!span) return null;
  // a range that ends exactly at the start of a measure does not take it
  const last = range.to.position && fCmp(range.to.position, ZERO) === 0 && span.last > span.first ? span.last - 1 : span.last;
  return { staffId: staff.id, movement, fromMeasure: span.first, toMeasure: last + 1 };
}

/** Measure index and position (fraction since the start of its content) of `rel`, a fraction of a whole note since the start of `fromMeasure`. */
function locateIn(movement, fromMeasure, rel) {
  let left = rel; let mi = fromMeasure;
  for (; mi < movement.masterbars.length; mi += 1) {
    const len = measureLengthOf(movement.masterbars[mi]);
    if (fCmp(left, len) < 0) return { measure: mi, position: left };
    left = fSub(left, len);
  }
  return null;
}

/**
 * @returns {{ placed: number, ties: number, skipped: number }} chords written (and ties made); `skipped` = chords that could not be written
 * (a pitch beyond the instrument), the take never fails halfway for one note.
 */
export function commitTake(doc, { staffId, fromMeasure, toMeasure, chords }) {
  const hitStaff = doc.find(staffId);
  const movement = doc.movementOf(hitStaff);
  const linked = isLinkedStaff(hitStaff) ? primaryOf(movement, hitStaff) : null;
  const target = linked ?? hitStaff;
  const type = linked ? 'score' : getProperty(target, PID.STAFF_TYPE);
  if (!RECORDABLE.includes(type)) throw new NoteEntryError('unsupportedPlayed', 'Recording: notation or tablature staff only');
  const range = rangeFromMeasures(doc, movement, [target.id], fromMeasure, toMeasure - 1);
  if (!range) throw new NoteEntryError('noCursor', 'Nothing to record on');
  clearRange(doc, range);
  let placed = 0; let ties = 0; let skipped = 0;
  for (const chord of chords) {
    const at = locateIn(movement, fromMeasure, chord.start);
    if (!at || at.measure >= toMeasure) { skipped += 1; continue; }
    const key = getProperty(movement.masterbars[at.measure], PID.KEY_SIG) ?? 0;
    const pos = { staffId: hitStaff.id, measureIndex: at.measure, position: at.position };
    // the string and fret of each note, once (the chord may be cut into several tied pieces: each piece gets fresh notes with the same choice)
    let specs;
    try {
      const used = [];
      specs = chord.notes.map((n) => {
        if (type === 'tab') {
          const { string, fret } = tabStringFor(doc, pos, n, used);
          used.push(string);
          return { n, string, pitch: tabNoteAt(doc, { ...pos, line: string - 1 }, fret).pitch };
        }
        let string = n.string;
        if (linked) { const r = tabStringFor(doc, pos, n, used); string = r.string; used.push(string); }
        return { n, string, pitch: n.midi };
      });
    } catch (e) {
      if (e instanceof NoteEntryError) { skipped += 1; continue; }
      throw e;
    }
    const makeNotes = () => specs.map(({ string, pitch }) => (type === 'tab'
      ? createTabNote({ pitch, string })
      : createNote({ ...defaultSpelling(pitch, key), ...(string ? { props: { [PID.TAB_STRING]: string } } : {}) })));
    const r = placeChord(doc, {
      staff: target, voice: 0, measure: at.measure, position: at.position, total: chord.duration,
      makeChord: (d) => createChord({ duration: d.base, dots: d.dots ?? 0, notes: makeNotes() }),
    });
    placed += r.chords.length ? 1 : 0; ties += r.ties.length;
  }
  return { placed, ties, skipped };
}
