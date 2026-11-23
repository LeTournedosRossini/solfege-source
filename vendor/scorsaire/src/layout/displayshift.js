// Display transposition of a movement by `n` semitones for a recording played in another key (pitch shift): the notation tracks are written n
// semitones higher (as the sheets screen does) and the chord symbols are re-spelled n semitones higher. A copy; the document is never touched.
import { displayShifted } from './sheetlayout.js';
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { chordViewShifts, hasChordViews } from '../model/chordview.js';
import { shiftedFifths, shiftNote } from '../model/chordshift.js';
export { shiftedFifths, shiftNote };

const copyWith = (el, key, value) => {
  const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el));
  Object.defineProperty(c, key, { value, enumerable: true, writable: true, configurable: true });
  return c;
};

/** @param {number} n semitones (0 = the movement itself) @param {number} [fifths] key signature of the original recording, to spell the chords */
export function shiftForDisplay(mv, n, { fifths = 0 } = {}) {
  if (!n) return mv;
  const target = shiftedFifths(fifths, n);
  const base = displayShifted(mv, n);
  const tracks = base.tracks.map((t) => shiftChordTrack(t, n, target));
  return copyWith(base, 'tracks', tracks);
}

/**
 * The movement with its chord symbols read as asked (model/chordview.js): 'author' = the display tags of the chord staff, 'original' = as written, 'capo' = as played with the capo in force.
 * A copy; the movement itself when nothing changes. The notes are never touched (the capo of a tablature is already in its frets).
 */
export function chordViewForDisplay(mv, view = 'author') {
  if (view === 'original' || !mv.masterbars.length) return mv;
  if (view === 'author' && !hasChordViews(mv)) return mv;
  const key = getProperty(mv.masterbars[0], PID.KEY_SIG) ?? 0; // (the chord symbols are spelled for the key the piece starts in)
  const tracks = mv.tracks.map((t) => {
    const chordStaff = t.staves.find((s) => getProperty(s, PID.STAFF_TYPE) === 'chord'); if (!chordStaff) return t;
    const shifts = chordViewShifts(mv, chordStaff, { view });
    return shiftChordTrack(t, (mi) => shifts[mi] ?? 0, (k) => shiftedFifths(key, k));
  });
  return copyWith(mv, 'tracks', tracks);
}

/** A track whose chord staves have their symbols re-spelled `n` semitones higher, spelled for a key of `target` accidentals (a copy; the track itself when it has no chord staff). */
export function shiftChordTrack(t, n, target) {
  // `n` may be a function of the measure index (a different shift on each measure: the display tags of the chord staff), then `target` is a function of that shift
  const nAt = typeof n === 'function' ? n : () => n; const targetAt = typeof target === 'function' ? target : () => target;
  if ((typeof n !== 'function' && !n) || !t.staves.some((s) => getProperty(s, PID.STAFF_TYPE) === 'chord')) return t;
  const staves = t.staves.map((s) => {
    if (getProperty(s, PID.STAFF_TYPE) !== 'chord') return s;
    const voices = s.voices.map((v) => copyWith(v, 'measures', v.measures.map((m, mi) => {
      const k = nAt(mi); if (!k) return m;
      const tg = targetAt(k);
      return copyWith(m, 'items', m.items.map((it) => {
        const root = getProperty(it, PID.CHORD_ROOT); const bass = getProperty(it, PID.CHORD_BASS);
        if (!root && !bass) return it;
        return copyWith(it, 'props', { ...it.props, ...(root ? { [PID.CHORD_ROOT]: shiftNote(root, k, tg) } : {}), ...(bass ? { [PID.CHORD_BASS]: shiftNote(bass, k, tg) } : {}) });
      }));
    })));
    return copyWith(s, 'voices', voices);
  });
  return copyWith(t, 'staves', staves);
}
