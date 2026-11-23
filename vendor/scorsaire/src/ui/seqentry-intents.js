/*
 * SEQUENTIAL entry on a tablature (the pad that stays open): intentions WITHOUT DOM on top of the keyboard entry (`Application.keyboardEntry`), so the notes are written, advanced and
 * heard exactly like typing frets on the keyboard — the pad is a keyboard on the screen. The pad builds ONE chord at a time:
 *  - every string is « not played » (a red cross) or carries a fret (0 = the open string); the strings are the chord that « Advance » writes;
 *  - a tap on a string selects it (a string not played starts at 0); a tap on the selected string adds one fret, past the last fret it goes back to « not played »;
 *  - a fret of the number pad sets the fret of the selected string; a long press on a string puts it back to « not played »;
 *  - « Advance » writes the chord (one undoable step) with the chosen duration, moves the cursor on and puts every string back to « not played »;
 *    with nothing played it writes a rest instead when the rest button is on (nothing happens otherwise).
 */
import { NoteEntryError } from './noteentry-intents.js';

/** The state kept between two notes: `frets` = string (1 = highest) → fret, `current` = the selected string, `rest` = the rest button is on. */
export const createSeqState = () => ({ frets: new Map(), current: null, rest: false });

/** The chord being built, lowest string number first: [{ string, fret }]. */
export const seqPlayed = (state) => [...state.frets].map(([string, fret]) => ({ string, fret })).sort((a, b) => a.string - b.string);

/** Every string back to « not played » (the selection and the rest button too). */
export function seqReset(state) { state.frets.clear(); state.current = null; state.rest = false; }

/**
 * A tap on a string. Returns { action: 'selected' | 'started' | 'added' | 'off', fret } — `fret` is null when the string is not played afterwards. Only
 * 'started', 'added' and 'off' change the chord (the page plays it again).
 */
export function seqTap(state, string, maxFret) {
  const has = state.frets.has(string);
  if (state.current !== string) {
    state.current = string;
    if (has) return { action: 'selected', fret: state.frets.get(string) };
    state.frets.set(string, 0);
    return { action: 'started', fret: 0 };
  }
  if (!has) { state.frets.set(string, 0); return { action: 'started', fret: 0 }; } // selected but not played (after a long press)
  const next = state.frets.get(string) + 1;
  if (next > maxFret) { state.frets.delete(string); return { action: 'off', fret: null }; }
  state.frets.set(string, next);
  return { action: 'added', fret: next };
}

/** A fret of the number pad goes to the selected string (false when no string is selected). */
export function seqSetFret(state, fret, maxFret) {
  if (state.current === null || !Number.isInteger(fret) || fret < 0 || fret > maxFret) return false;
  state.frets.set(state.current, fret);
  return true;
}

/** A long press: the string goes back to « not played » (it stays selected, the next fret of the pad starts it again). */
export function seqClear(state, string) { state.frets.delete(string); state.current = string; }

/** The rest button: on, an « Advance » with nothing played writes a rest of the chosen duration. */
export function seqToggleRest(state) { state.rest = !state.rest; return state.rest; }

/**
 * « Advance ». Returns { action: 'chord' | 'rest' | 'none', count }. Throws `NoteEntryError` like the keyboard entry (not a tablature, a fret beyond the
 * instrument, no cursor…): nothing is then written and the strings stay as they are.
 */
export function seqAdvance(app, state, { viewId = 'main' } = {}) {
  if (app.entryStaffTypeAtCursor() !== 'tab') throw new NoteEntryError('unsupportedKeyboard', 'Saisie séquentielle : portée de tablature seulement');
  const played = seqPlayed(state);
  if (played.length) { app.seqWriteChord(played, viewId); seqReset(state); return { action: 'chord', count: played.length }; }
  if (state.rest) { app.keyboardEntry({ type: 'rest' }, viewId); seqReset(state); return { action: 'rest', count: 0 }; }
  return { action: 'none', count: 0 };
}

/** « Back »: the chord just written goes away whole and the cursor returns to its place; the strings go back to « not played ». */
export function seqBack(app, state, { viewId = 'main' } = {}) {
  const r = app.seqBack(viewId);
  seqReset(state);
  return r;
}

/** The tie, written at the cursor, away from the chord being built. */
export function seqTie(app, { viewId = 'main' } = {}) {
  return app.keyboardEntry({ type: 'tie' }, viewId);
}
