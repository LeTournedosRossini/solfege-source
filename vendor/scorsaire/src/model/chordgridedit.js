// Putting a chord GRID (model/gridtemplates.js) in a movement: the chords go into the chord track, with the sections of the form the grid brings. Call `applyGrid` INSIDE `doc.transaction`.
// Two ways: `wholeTrack` — the grid REPLACES the chord track of the movement (all its chords and all its sections) and starts on the first measure; or from a measure — the measures it covers are
// replaced and nothing else is touched. The movement grows (empty measures at its end) when the grid is longer than what is left of it. `gridConflicts` tells what would be replaced, for the question asked first.
import { PID } from './pid.js';
import { createChordSymbol } from './elements.js';
import { chordTrackOf } from './chordtrack.js';
import { insertMeasures } from './measureedit.js';
import { measureLengthOf } from './timing.js';
import { fitDuration } from './inputgrid.js';
import { toggleSection, sectionAt } from './systemedit.js';
import { workChordQualities } from './chordqualityedit.js';
import { chordQualityNames } from './chordquality.js';
import { gridChords } from './gridtemplates.js';
import { EditError } from './noteedit.js';

export const MAX_CHORUSES = 16;
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const reduce = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };

/** The voice of the chord track that holds the chord symbols, or null. */
function chordVoice(mv) {
  const track = chordTrackOf(mv);
  const staff = track?.staves.find((s) => (s.props?.[PID.STAFF_TYPE] ?? s.type) === 'chord' || s.type === 'chord') ?? track?.staves[0];
  return staff?.voices?.[0] ?? null;
}

const symbolsOf = (measure) => (measure?.items ?? []).filter((it) => it.type === 'chordsymbol');

/** How much a grid of `count` measures from `start` would replace: `{ chords, sections }` (0 and 0 = nothing there). `wholeTrack` looks at the whole movement. */
export function gridConflicts(mv, { start = 0, count = 0, wholeTrack = false } = {}) {
  const voice = chordVoice(mv);
  if (!voice) return { chords: 0, sections: 0 };
  const from = wholeTrack ? 0 : Math.max(0, start); const to = wholeTrack ? mv.masterbars.length : Math.min(mv.masterbars.length, start + count);
  let chords = 0; let sections = 0;
  for (let i = from; i < to; i++) {
    chords += symbolsOf(voice.measures[i]).length;
    if (mv.masterbars[i] && sectionAt(mv, mv.masterbars[i].id)) sections += 1;
  }
  return { chords, sections };
}

/**
 * @param grid a template of `gridtemplates.js`; `o` = { tonicPc (0–11), choruses (grids in a row, ≥ 1), start (index of the first measure), wholeTrack, labelOf?(section) → the text of a section }
 * @returns {{ from, count, added: number }} the measures written and how many measures were added at the end of the movement
 */
export function applyGrid(doc, mv, grid, { tonicPc = 0, choruses = 1, start = 0, wholeTrack = false, labelOf = null } = {}) {
  if (!grid) throw new EditError('Unknown grid');
  if (!(Number.isInteger(choruses) && choruses >= 1 && choruses <= MAX_CHORUSES)) throw new EditError(`A grid is repeated 1 to ${MAX_CHORUSES} times`);
  const voice0 = chordVoice(mv);
  if (!voice0) throw new EditError('The movement has no chord track');
  const first = wholeTrack ? 0 : start;
  if (!(Number.isInteger(first) && first >= 0 && first < mv.masterbars.length)) throw new EditError('Unknown measure');
  const length = grid.bars.length; const count = length * choruses;
  const known = new Set(workChordQualities(doc.work).qualities.flatMap((q) => chordQualityNames(q)));
  for (const b of grid.bars) for (const c of b) if (c.q !== '' && !known.has(c.q)) throw new EditError(`The chord quality "${c.q}" is not in the dictionary`);
  const missing = first + count - mv.masterbars.length;
  if (missing > 0) insertMeasures(doc, mv, { at: mv.masterbars.length, count: missing, moveSignatures: false });
  const voice = chordVoice(mv);
  const last = first + count; // exclusive
  // what the grid replaces: the whole track, or only the measures it covers
  const clearTo = wholeTrack ? mv.masterbars.length : last;
  for (let i = first; i < clearTo; i++) {
    for (const s of [...symbolsOf(voice.measures[i])]) doc.remove(s);
    const sec = sectionAt(mv, mv.masterbars[i].id);
    if (sec) doc.remove(sec);
  }
  const chords = gridChords(grid, tonicPc);
  for (let k = 0; k < count; k++) {
    const i = first + k; const measure = voice.measures[i];
    const bar = chords[k % length]; const len = measureLengthOf(mv.masterbars[i]);
    for (const c of bar) {
      const share = reduce(len[0], len[1] * bar.length);
      const position = reduce(len[0] * c.at[0], len[1] * c.at[1]);
      doc.add(measure, 'items', createChordSymbol({ root: c.root, quality: c.quality, position, duration: fitDuration(share).base, props: { [PID.DURATION]: fitDuration(share) } }));
    }
  }
  for (let c = 0; c < choruses; c++) {
    for (const s of grid.sections ?? []) {
      const i = first + c * length + s.bar;
      toggleSection(doc, mv, mv.masterbars[i].id, { label: labelOf ? labelOf(s) : (s.label ?? s.category), category: s.category });
    }
  }
  return { from: first, count, added: Math.max(0, missing) };
}
