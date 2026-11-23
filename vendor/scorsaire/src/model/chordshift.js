// Re-spelling a chord root / bass some semitones higher (pure): shared by the display shifts of the layouts and by the linked chord staves of the model.
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLATS = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** Key signature (number of accidentals, -7..7) of a key `n` semitones above `fifths`. */
export function shiftedFifths(fifths, n) {
  const f = (((fifths + 7 * n) % 12) + 12) % 12; // 0..11, the circle of fifths folded onto one turn
  return f > 6 ? f - 12 : f;
}

/** { step, alter } `n` semitones higher, spelled for a key of `fifths` accidentals (sharps when positive). */
export function shiftNote(note, n, fifths) {
  if (!note) return note;
  const pc = (((STEP_PC[note.step] + (note.alter ?? 0) + n) % 12) + 12) % 12;
  const [step, alter] = (fifths > 0 ? SHARPS : FLATS)[pc];
  return { step, alter };
}

