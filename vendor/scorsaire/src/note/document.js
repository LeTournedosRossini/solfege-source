/*
 * The NOTE document: a tiny score (one movement, 1 to 4 measures) that a teacher slips into a lesson note and a student reads. Pure: no DOM.
 * It wraps a regular Scorsaire file (`serialize.js`, versioned, migrated) so that nothing is invented: what is stored is what the editor writes.
 *   { format: 'scorsaire-note', version: 1, work: <Scorsaire file>, thumb?: '<svg…>', text?: '<a title or a few sentences>' }
 * `text` = what the teacher writes ABOVE the score (a word, or an instruction of a few sentences): plain text with line breaks, 1000 characters at most, never HTML.
 * The student's own settings (transposition, speed, loop, size) are NOT part of the document: they travel apart (`NOTE_SETTINGS`).
 */
import { loadWork, serializeWork, ScoreFileError } from '../model/serialize.js';

export const NOTE_FORMAT = 'scorsaire-note';
export const NOTE_VERSION = 1;
/** The portal stores the document in a table with a server limit (64 KB advised): the check is here so that an editor refuses before the server does. */
export const NOTE_LIMITS = Object.freeze({ minMeasures: 1, maxMeasures: 4, maxBytes: 64 * 1024, maxThumb: 16 * 1024, maxText: 1000 });
/** Student-side settings, same ranges as the portal's `note_morceaux` (transposition −12..12, speed 50..150 %). */
export const NOTE_SETTINGS = Object.freeze({ transpose: [-12, 12], speed: [50, 150], zoom: [0.6, 2.5], defaults: Object.freeze({ transpose: 0, speed: 100, zoom: 1, loop: false, concert: null, chords: false, theme: 'auto' }) });

export class NoteDocumentError extends Error {
  constructor(code, message) { super(message); this.name = 'NoteDocumentError'; this.code = code; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Wraps a work (already built by the editor or a test) into a note document. */
/** The text as it is kept: line breaks as \n, no control characters, no blank margins; '' when there is nothing. */
export function cleanNoteText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

export function createNoteDocument(work, { thumb = null, text = '' } = {}) {
  const doc = { format: NOTE_FORMAT, version: NOTE_VERSION, work: JSON.parse(serializeWork(work)) };
  if (thumb) doc.thumb = thumb;
  const t = cleanNoteText(text); if (t) doc.text = t;
  return checkNoteDocument(doc);
}

export const stringifyNoteDocument = (doc) => JSON.stringify(checkNoteDocument(doc));

/** Shape and size checks that do not need the work itself. Returns the document. */
export function checkNoteDocument(doc) {
  if (!isObj(doc) || doc.format !== NOTE_FORMAT) throw new NoteDocumentError('format', `Not a « ${NOTE_FORMAT} » document`);
  if (!Number.isInteger(doc.version) || doc.version < 1) throw new NoteDocumentError('version', `Invalid version: ${doc.version}`);
  if (doc.version > NOTE_VERSION) throw new NoteDocumentError('newer', `Document version ${doc.version} is newer than the supported one (${NOTE_VERSION})`);
  if (!isObj(doc.work)) throw new NoteDocumentError('work', 'Missing work');
  if (doc.thumb != null && (typeof doc.thumb !== 'string' || doc.thumb.length > NOTE_LIMITS.maxThumb)) throw new NoteDocumentError('thumb', 'Invalid or too large thumbnail');
  if (doc.text != null && (typeof doc.text !== 'string' || doc.text.length > NOTE_LIMITS.maxText)) throw new NoteDocumentError('text', `The text must be a string of at most ${NOTE_LIMITS.maxText} characters`);
  return doc;
}

/**
 * Reads a document (text or parsed object) and returns `{ doc, work, movement }`.
 * @throws NoteDocumentError — wrong format, newer version, not exactly one movement, measure count outside 1..4, too big
 */
export function parseNoteDocument(input) {
  let data = input;
  if (typeof input === 'string') {
    if (input.length > NOTE_LIMITS.maxBytes) throw new NoteDocumentError('size', 'Document too large');
    try { data = JSON.parse(input); } catch (e) { throw new NoteDocumentError('json', `Unreadable document: ${e.message}`); }
  }
  checkNoteDocument(data);
  let work;
  try { work = loadWork(data.work); } catch (e) { throw e instanceof ScoreFileError ? new NoteDocumentError('work', e.message) : e; }
  if (work.movements.length !== 1) throw new NoteDocumentError('movements', 'A note holds exactly one movement');
  const movement = work.movements[0];
  const n = movement.masterbars.length;
  if (n < NOTE_LIMITS.minMeasures || n > NOTE_LIMITS.maxMeasures) throw new NoteDocumentError('measures', `A note holds ${NOTE_LIMITS.minMeasures} to ${NOTE_LIMITS.maxMeasures} measures (got ${n})`);
  return { doc: data, work, movement };
}

/** Clamps the student's settings to their ranges and fills the defaults; unknown keys are dropped. */
export function normalizeSettings(input = {}) {
  const d = NOTE_SETTINGS.defaults;
  const num = (v, [lo, hi], dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  return {
    transpose: Math.round(num(input.transpose, NOTE_SETTINGS.transpose, d.transpose)),
    speed: Math.round(num(input.speed, NOTE_SETTINGS.speed, d.speed)),
    zoom: num(input.zoom, NOTE_SETTINGS.zoom, d.zoom),
    loop: input.loop === true,
    chords: input.chords === true, // the chords of the grid sound only when the pupil switches them on
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : 'auto', // 'auto' = the portal's own theme (its Material variables); light / dark = the pupil's choice, for this component only
    concert: input.concert === true ? true : input.concert === false ? false : null, // null = as the teacher wrote it; true / false = the pupil's own choice of the display of a transposing instrument
  };
}
