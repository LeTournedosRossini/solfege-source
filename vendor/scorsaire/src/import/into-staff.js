/*
 * Importing a FILE INTO a staff of the open piece, from the chosen measure (« the melody of the verse »): the file is read by the importer of its format into a throw-away work,
 * one of its staves is copied as a clipboard payload (`model/clipboard.js`) and pasted on the chosen staff with the PASTE of the editor (`app.importPayloads`): it overwrites only the
 * measures the melody covers, cuts the notes at the bars (ties), adds empty measures at the end when the melody goes further, and never brings a key or a time signature (the piece's own count).
 * PURE (no DOM). Every importer gives a work, so every format goes through here (MusicXML, Guitar Pro, iReal…).
 *
 *   importableStaves(work)                       → the staves of the file one can take: [{ id, name, type, measures, notes, lyrics }] (the ones with notes first)
 *   importPayload(work, staffId, { lyrics })     → the clipboard payload of that staff (all its measures), with its lyrics or without ; the structure marks (tempo, jumps…) are left out
 *   chordPayloadOf(work)                         → the payload of the first chord staff of the file, or null
 *   timeSignatureDifference(work, movement, at)  → { source, target } ([n, d] each) when the first measure of the file is not in the time signature of the measure it will land on, else null
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { createDocument } from '../model/document.js';
import { copyRange } from '../model/clipboard.js';
import { rangeFromMeasures, flatStaves } from '../model/range.js';
import { isLinkedStaff } from '../model/linkedstaff.js';
import { defaultFilter, setFilterFlag } from '../model/selectionfilter.js';

const trackOf = (mv, staff) => mv.tracks.find((t) => t.staves.some((s) => s.id === staff.id));
const typeOf = (staff) => getProperty(staff, PID.STAFF_TYPE);
const hasNotes = (staff) => staff.voices.some((v) => v.measures.some((m) => m?.items?.some((i) => i.type === 'chord')));
const hasLyrics = (staff) => (getProperty(staff, PID.LYRIC_LINKS) ?? []).length > 0;

export function importableStaves(work) {
  const mv = work.movements[0];
  if (!mv) return [];
  const list = flatStaves(mv).filter((s) => !isLinkedStaff(s)).map((s) => {
    const tr = trackOf(mv, s);
    return { id: s.id, name: tr?.props?.[PID.NAME] ?? '', type: typeOf(s), measures: mv.masterbars.length, notes: hasNotes(s), lyrics: hasLyrics(s) };
  });
  return [...list.filter((s) => s.notes && s.type !== 'chord'), ...list.filter((s) => !s.notes || s.type === 'chord')];
}

/** The filter of an import: no structure marks (tempo, fermatas, jumps… are the piece's business), lyrics as asked, everything else kept. */
function importFilter({ lyrics }) {
  let f = defaultFilter();
  f = setFilterFlag(f, 'elements', 'system', false);
  f = setFilterFlag(f, 'elements', 'lyrics', !!lyrics);
  return f;
}

function payloadOf(work, staffId, filter) {
  const doc = createDocument(work, { checkInvariants: false });
  const mv = work.movements[0];
  const range = rangeFromMeasures(doc, mv, [staffId], 0, mv.masterbars.length - 1);
  return copyRange(doc, range, filter);
}

export function importPayload(work, staffId, { lyrics = true } = {}) {
  return payloadOf(work, staffId, importFilter({ lyrics }));
}

export function chordPayloadOf(work) {
  const mv = work.movements[0];
  const staff = mv && flatStaves(mv).filter((s) => !isLinkedStaff(s)).find((s) => typeOf(s) === 'chord');
  return staff ? payloadOf(work, staff.id, importFilter({ lyrics: false })) : null;
}

export function timeSignatureDifference(work, movement, at) {
  const first = work.movements[0]?.masterbars[0];
  const there = movement?.masterbars[at];
  if (!first || !there) return null;
  const source = getProperty(first, PID.TIME_SIG); const target = getProperty(there, PID.TIME_SIG);
  return source && target && (source[0] !== target[0] || source[1] !== target[1]) ? { source: [...source], target: [...target] } : null;
}
