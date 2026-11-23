/*
 * What a RANGE holds, by the categories of the selection filter (model/selectionfilter.js): which voices, which notes of the chords and which kinds of elements
 * (dynamics, slurs, lyrics, chord symbols, structure…) are present in it. PURE: nothing is written.
 * A category is present when leaving it out of the copy of the range changes the copy (the same code decides what the filter keeps when copying, cutting or
 * emptying, so the answer is exactly what the filter would act on).
 *
 *   rangeContents(doc, range) → { voices: [bool × 4], notes: { <id>: bool }, elements: { <category>: bool } }
 */
import { copyRange } from './clipboard.js';
import { defaultFilter, setFilterFlag, NOTE_FILTER_IDS, ELEMENT_CATEGORY_IDS } from './selectionfilter.js';

export function rangeContents(doc, range) {
  const all = defaultFilter();
  const size = (f) => JSON.stringify(copyRange(doc, range, f)).length;
  const full = size(all);
  const without = (group, key) => size(setFilterFlag(all, group, key, false)) !== full;
  return {
    voices: [0, 1, 2, 3].map((i) => without('voices', i)),
    notes: Object.fromEntries([...NOTE_FILTER_IDS, 'single'].map((k) => [k, without('notes', k)])),
    elements: Object.fromEntries(ELEMENT_CATEGORY_IDS.map((k) => [k, without('elements', k)])),
  };
}
