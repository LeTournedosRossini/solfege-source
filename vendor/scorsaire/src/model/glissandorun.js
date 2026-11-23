/*
 * Glissando RUN: a white-key run written before an arrival note (organ glissando). PURE model module; the functions that WRITE (`addGlissandoRun`,
 * `removeGlissandoRun`) must be called INSIDE `doc.transaction` (the Application wraps them in `edit(...)`: one undo step).
 *
 * What a run is in the data:
 *  - NO start note is written (the player chooses how to glide; the score only says THAT there is a glissando): the entry of PID.GLISSANDOS hangs on
 *    the arrival note alone: { endNoteId = the arrival note, startInterval = start pitch minus arrival pitch (semitones, an integer, never 0),
 *    glissandoStyle: 'whiteKeys', runDuration | stepDuration }. It is drawn as a short line leading into the arrival note (from below when the run
 *    goes up, from above when it goes down). Because only the INTERVAL is stored, transposing the arrival note moves the start with it.
 *  - Older files (before 19/11/2026 evening) wrote a before-ornament (grace note) at the start pitch and `startNoteId` = that grace note; they still play
 *    and are removed / replaced like the new ones.
 *  Playback (audio/sequence.js): the white keys from the start pitch up to (excluding) the arrival pitch are played one after the other, the first at
 *  `onset - total` and the last ending EXACTLY at the onset of the arrival note, which sounds on its own beat, unchanged. The run steals time from what
 *  precedes it like an acciaccatura (the previous note is not rewritten: it keeps sounding underneath, which is natural on an organ).
 *
 * Timing modes (both give a total length and a step length, as exact fractions of a whole note):
 *  - 'duration': `runDuration` = value; step = value / number of steps (the steps are spread EVENLY over it);
 *  - 'speed': `stepDuration` = value; total = number of steps x value.
 *
 * White keys are those of the pitch numbers (C D E F G A B, pitch class 0 2 4 5 7 9 11), i.e. the same rule as the playback style 'whiteKeys'
 * (audio/glissandos.js): the START note is the first step, the ARRIVAL note is never a step. A start pitch that is a black key is moved to the nearest
 * white key IN THE DIRECTION OF THE ARRIVAL (up when the run goes up, down when it goes down); the written grace note is that white key.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createGlissando } from './elements.js';
import { EditError, purgeReferences } from './noteedit.js';
import { isRunEntry } from './glissando.js';
import { frac, fMul, isFraction } from './fraction.js';

export { isRunEntry };

export const RUN_MODES = Object.freeze(['duration', 'speed']);
/** What the dialog proposes: the whole run lasts an eighth note. */
export const DEFAULT_RUN = Object.freeze({ mode: 'duration', value: frac(1, 8) });
/** Default start: one octave below the arrival (clamped to the MIDI range). */
export const defaultRunStart = (arrivalPitch) => Math.max(0, arrivalPitch - 12);

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
export const isWhiteKey = (pitch) => WHITE_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);

/** Error with a machine-readable `code` (the message is for the person, in French like the other model errors). */
function fail(code, message) {
  const e = new EditError(message);
  e.code = code;
  return e;
}

/**
 * White keys of a run from `startPitch` towards `arrivalPitch`.
 * @returns {{ start: number, pitches: number[], count: number, direction: 1 | -1 | 0 }}  `start` = the pitch really used (a black key is moved one
 *   semitone towards the arrival); `pitches` = the white keys played, in order, the arrival excluded; `count` = pitches.length (0 when there is no step).
 */
export function whiteKeyRun(startPitch, arrivalPitch) {
  const direction = Math.sign(arrivalPitch - startPitch);
  if (!direction) return { start: startPitch, pitches: [], count: 0, direction: 0 };
  const start = isWhiteKey(startPitch) ? startPitch : startPitch + direction;
  const pitches = [];
  for (let p = start; direction > 0 ? p < arrivalPitch : p > arrivalPitch; p += direction) if (isWhiteKey(p)) pitches.push(p);
  return { start, pitches, count: pitches.length, direction };
}

/**
 * Exact timing of a run of `count` steps: { step, total } as fractions of a whole note (null when `count` is 0).
 * Give EITHER `runDuration` OR `stepDuration`.
 */
export function runTiming({ count, runDuration, stepDuration }) {
  if (!count) return null;
  if (runDuration !== undefined) return { step: fMul(runDuration, frac(1, count)), total: runDuration };
  if (stepDuration !== undefined) return { step: stepDuration, total: fMul(stepDuration, frac(count, 1)) };
  return null;
}

// ---------- locating ----------

const unwrap = (p) => (p ? p.el ?? p : null);

function staffOf(doc, id) {
  for (let p = unwrap(doc.parentOf(id)); p; p = unwrap(doc.parentOf(p.id))) if (p.type === 'staff') return p;
  return null;
}

/** { voice, mi } of a MAIN chord of the staff (a grace chord has none), or null. */
function locate(staff, chordId) {
  for (let v = 0; v < (staff.voices?.length ?? 0); v++) {
    const measures = staff.voices[v].measures;
    for (let mi = 0; mi < measures.length; mi++) if (measures[mi]?.items.some((it) => it.id === chordId)) return { voice: v, mi };
  }
  return null;
}

/** The first note id designated by `ids` (a note id, a chord id, or a list of them): a note of a main chord, else the first note found. */
function firstNoteOf(doc, ids) {
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    const el = id ? doc.find(id) : null;
    if (!el) continue;
    if (el.type === 'note' || el.type === 'tabnote' || el.type === 'percnote') return el; // any note: `refusal` says why a non-notation one is refused
    if (el.type === 'chord' && el.notes?.length) return el.notes[0];
  }
  return null;
}

/** The run (if any) whose arrival is `noteId`: { entry, graceNote, graceChord } (the grace may be missing in damaged data). */
function runOn(doc, staff, noteId) {
  const entry = (getProperty(staff, PID.GLISSANDOS) ?? []).find((g) => isRunEntry(g) && g.endNoteId === noteId);
  if (!entry) return null;
  const graceNote = doc.find(entry.startNoteId) ?? null;
  return { entry, graceNote, graceChord: graceNote ? unwrap(doc.parentOf(graceNote.id)) : null };
}

/** Why a note cannot receive a run, or null. */
function refusal(doc, note) {
  if (!note) return 'noNote';
  if (note.type !== 'note') return 'notNotation'; // tablature and percussion notes
  const chord = unwrap(doc.parentOf(note.id));
  const staff = staffOf(doc, note.id);
  if (!chord || chord.type !== 'chord' || !staff) return 'noNote';
  if ((getProperty(staff, PID.STAFF_TYPE) ?? 'score') !== 'score') return 'notNotation';
  if (!locate(staff, chord.id)) return 'grace'; // an ornament cannot be the arrival
  return null;
}

/**
 * What the dialog needs. `ids` = the selection (note ids and / or chord ids); `options.startPitch` asks for the figures of a given start pitch.
 * @returns {{
 *   allowed: boolean, reason: null | 'noNote' | 'notNotation' | 'grace',
 *   noteId?: string, chordId?: string, staffId?: string,
 *   arrivalPitch?: number, defaultStartPitch?: number,
 *   startPitch?: number,        // the pitch asked for (option), else the existing run's, else the default
 *   usedStartPitch?: number,    // the white key really used for `startPitch` (differs when `startPitch` is a black key)
 *   whiteKeys?: number[], whiteKeyCount?: number,   // the steps for `startPitch`
 *   existing: null | { entryId, graceNoteId, startPitch, mode, value, whiteKeyCount },   // the run to edit / remove
 * }}
 */
export function glissandoRunInfo(doc, ids, options = {}) {
  const note = firstNoteOf(doc, ids);
  const reason = refusal(doc, note);
  if (reason) return { allowed: false, reason, existing: null };
  const staff = staffOf(doc, note.id);
  const chord = unwrap(doc.parentOf(note.id));
  const arrivalPitch = getProperty(note, PID.PITCH);
  const run = runOn(doc, staff, note.id);
  let existing = null;
  if (run) {
    const startPitch = run.graceNote ? getProperty(run.graceNote, PID.PITCH)
      : Number.isInteger(run.entry.startInterval) ? arrivalPitch + run.entry.startInterval : defaultRunStart(arrivalPitch);
    const mode = run.entry.stepDuration !== undefined ? 'speed' : 'duration';
    existing = {
      entryId: run.entry.id, graceNoteId: run.graceNote?.id ?? null, startPitch, mode, value: mode === 'speed' ? run.entry.stepDuration : run.entry.runDuration,
      whiteKeyCount: whiteKeyRun(startPitch, arrivalPitch).count,
    };
  }
  const defaultStartPitch = defaultRunStart(arrivalPitch);
  const startPitch = options.startPitch ?? existing?.startPitch ?? defaultStartPitch;
  const keys = whiteKeyRun(startPitch, arrivalPitch);
  return {
    allowed: true, reason: null, noteId: note.id, chordId: chord.id, staffId: staff.id, arrivalPitch, defaultStartPitch,
    startPitch, usedStartPitch: keys.start, whiteKeys: keys.pitches, whiteKeyCount: keys.count, existing,
  };
}

/** Removes the run whose arrival is `noteId` (grace note and entry). Returns true when there was one. TO CALL INSIDE `doc.transaction`. */
export function removeGlissandoRun(doc, noteIdOrIds) {
  const note = firstNoteOf(doc, noteIdOrIds);
  const staff = note ? staffOf(doc, note.id) : null;
  const run = staff ? runOn(doc, staff, note.id) : null;
  if (!run) return false;
  if (run.graceChord && run.graceChord.notes.length === 1) {
    doc.remove(run.graceChord);
    purgeReferences(doc, staff, [run.graceChord]); // the entry, and anything else that named the ornament
  } else if (run.graceNote) {
    doc.remove(run.graceNote);
    purgeReferences(doc, staff, [run.graceNote]);
  }
  // damaged data (the ornament is gone but the entry remains)
  const left = (getProperty(staff, PID.GLISSANDOS) ?? []).filter((g) => g.id !== run.entry.id);
  if (left.length !== (getProperty(staff, PID.GLISSANDOS) ?? []).length) doc.set(staff, PID.GLISSANDOS, left);
  return true;
}

/**
 * Writes a glissando run before the arrival note `noteId` (a note id, or a selection: see `glissandoRunInfo`), REPLACING any previous run on that note.
 * TO CALL INSIDE `doc.transaction`.
 * @param {{ startPitch?: number, mode?: 'duration' | 'speed', value?: number[] }} opts  `startPitch` default = one octave below the arrival;
 *   `mode` 'duration' (value = total length of the run) or 'speed' (value = length of each step), `value` = a fraction [n, d] of a whole note (default 1/8).
 * @throws {EditError} with `code`: 'noNote' | 'notNotation' | 'grace' (the note cannot be an arrival), 'badMode', 'badValue' (not a positive fraction),
 *   'badPitch' (not an integer 0..127), 'noSteps' (no white key between the start and the arrival: nothing to play).
 * @returns {{ entry, graceChordId, graceNoteId, noteId, startPitch, usedStartPitch, whiteKeys, whiteKeyCount, mode, value, step, total }}
 *   `step` / `total` = exact timing (fractions of a whole note).
 */
export function addGlissandoRun(doc, noteIdOrIds, { startPitch, mode = DEFAULT_RUN.mode, value = DEFAULT_RUN.value } = {}) {
  const note = firstNoteOf(doc, noteIdOrIds);
  const why = refusal(doc, note);
  if (why) {
    throw fail(why, why === 'grace' ? 'Une note d\'ornement ne peut pas être la note d\'arrivée' : why === 'notNotation' ? 'Le glissando d\'orgue s\'écrit sur une portée de notation' : 'Sélectionnez une note');
  }
  if (!RUN_MODES.includes(mode)) throw fail('badMode', `Mode inconnu : ${mode}`);
  if (!isFraction(value) || value[0] <= 0) throw fail('badValue', 'La durée doit être une fraction positive de ronde');
  const staff = staffOf(doc, note.id);
  const arrivalPitch = getProperty(note, PID.PITCH);
  const wanted = startPitch ?? defaultRunStart(arrivalPitch);
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 127) throw fail('badPitch', 'Hauteur de départ invalide');
  const keys = whiteKeyRun(wanted, arrivalPitch);
  if (!keys.count) throw fail('noSteps', 'Aucune touche blanche entre la note de départ et la note d\'arrivée');

  removeGlissandoRun(doc, note.id); // replace, never stack
  const entry = {
    ...createGlissando(undefined, note.id, { glissandoStyle: 'whiteKeys' }),
    startInterval: keys.start - arrivalPitch,
    ...(mode === 'speed' ? { stepDuration: value } : { runDuration: value }),
  };
  doc.set(staff, PID.GLISSANDOS, [...(getProperty(staff, PID.GLISSANDOS) ?? []), entry]);
  const timing = runTiming({ count: keys.count, runDuration: entry.runDuration, stepDuration: entry.stepDuration });
  return {
    entry, noteId: note.id, startPitch: wanted, usedStartPitch: keys.start,
    whiteKeys: keys.pitches, whiteKeyCount: keys.count, mode, value, step: timing.step, total: timing.total,
  };
}
