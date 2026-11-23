// Typical chord GRIDS (blues, rhythm changes, pop-rock loops), written by degree — the semitones above the tonic — so that one grid fits every key. PURE: data and the spelling of a root in a key.
// A grid is a list of BARS, each bar a list of chords sharing it equally (one chord = the whole bar, two = half a bar each…), and the SECTIONS of the form it brings (a letter, a verse, a chorus).
// `minor` grids are written from the tonic of a minor key. The qualities are ids of the chord-quality dictionary ('' = major triad).
// Applying a grid to a movement (model/gridedit.js) writes its chords in the chord track; transposing it later is a matter of putting it again in another key.

/** One bar from its chords `[degree, quality]` (the chords share the bar equally). */
const bar = (...chords) => chords.map(([d, q]) => ({ d, q }));
const I7 = [0, '7']; const IV7 = [5, '7']; const V7 = [7, '7'];
const sec = (b, category, label) => ({ bar: b, category, ...(label ? { label } : {}) });

export const GRID_FAMILIES = Object.freeze(['blues', 'rhythm', 'pop']);

export const GRID_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'blues12', family: 'blues', minor: false, // the classic twelve bars
    bars: [bar(I7), bar(I7), bar(I7), bar(I7), bar(IV7), bar(IV7), bar(I7), bar(I7), bar(V7), bar(IV7), bar(I7), bar(V7)],
  }),
  Object.freeze({
    id: 'bluesQuick', family: 'blues', minor: false, // quick change: the IV chord in the second bar
    bars: [bar(I7), bar(IV7), bar(I7), bar(I7), bar(IV7), bar(IV7), bar(I7), bar(I7), bar(V7), bar(IV7), bar(I7), bar(V7)],
  }),
  Object.freeze({
    id: 'bluesJazz', family: 'blues', minor: false, // jazz blues with the ii–V's (the "Bb blues" of the standards)
    bars: [bar(I7), bar(IV7), bar(I7), bar([7, 'm7'], I7), bar(IV7), bar([6, 'o7']), bar(I7), bar([4, 'm7'], [2, '7']), bar([2, 'm7']), bar(V7), bar(I7, [2, '7']), bar([2, 'm7'], V7)],
  }),
  Object.freeze({
    id: 'bluesMinor', family: 'blues', minor: true, // minor blues: i, iv, ♭VI, V
    bars: [bar([0, 'm7']), bar([0, 'm7']), bar([0, 'm7']), bar([0, 'm7']), bar([5, 'm7']), bar([5, 'm7']), bar([0, 'm7']), bar([0, 'm7']), bar([8, '7']), bar(V7), bar([0, 'm7']), bar(V7)],
  }),
  Object.freeze({
    id: 'rhythmChanges', family: 'rhythm', minor: false, // AABA, 32 bars: "I Got Rhythm" changes
    bars: (() => {
      const A = [bar([0, 'M7'], [9, '7']), bar([2, 'm7'], V7), bar([4, 'm7'], [9, '7']), bar([2, 'm7'], V7), bar([7, 'm7'], [0, '7']), bar([5, 'M7'], [6, 'o7']), bar([0, 'M7'], [9, '7']), bar([2, 'm7'], V7)];
      const B = [bar([4, '7']), bar([4, '7']), bar([9, '7']), bar([9, '7']), bar([2, '7']), bar([2, '7']), bar(V7), bar(V7)];
      return [...A, ...A, ...B, ...A];
    })(),
    sections: [sec(0, 'letter', 'A'), sec(8, 'letter', 'A'), sec(16, 'letter', 'B'), sec(24, 'letter', 'A')],
  }),
  Object.freeze({ id: 'popI_V_vi_IV', family: 'pop', minor: false, bars: [bar([0, '']), bar([7, '']), bar([9, 'm']), bar([5, ''])] }), // I – V – vi – IV
  Object.freeze({ id: 'popvi_IV_I_V', family: 'pop', minor: false, bars: [bar([9, 'm']), bar([5, '']), bar([0, '']), bar([7, ''])] }), // vi – IV – I – V
  Object.freeze({ id: 'popI_vi_IV_V', family: 'pop', minor: false, bars: [bar([0, '']), bar([9, 'm']), bar([5, '']), bar([7, ''])] }), // the 50s: I – vi – IV – V
  Object.freeze({ id: 'popI_IV_V_I', family: 'pop', minor: false, bars: [bar([0, '']), bar([5, '']), bar([7, '']), bar([0, ''])] }), // I – IV – V – I
  Object.freeze({
    id: 'popVerseChorus', family: 'pop', minor: false, // 16 bars: a verse I V vi IV twice, a chorus IV I V vi twice
    bars: [...[0, 1].flatMap(() => [bar([0, '']), bar([7, '']), bar([9, 'm']), bar([5, ''])]), ...[0, 1].flatMap(() => [bar([5, '']), bar([0, '']), bar([7, '']), bar([9, 'm'])])],
    sections: [sec(0, 'verse'), sec(8, 'chorus')],
  }),
  Object.freeze({ id: 'popMinor', family: 'pop', minor: true, bars: [bar([0, 'm']), bar([8, '']), bar([3, '']), bar([10, ''])] }), // i – ♭VI – ♭III – ♭VII
]);

export const gridById = (id) => GRID_TEMPLATES.find((g) => g.id === id) ?? null;

const SHARP_NAMES = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_NAMES = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const MAJOR_FLAT_KEYS = new Set([1, 3, 5, 8, 10]); // D♭ E♭ F A♭ B♭
const MINOR_FLAT_KEYS = new Set([0, 2, 3, 5, 7, 10]); // Cm Dm E♭m Fm Gm B♭m

/** Whether the notes of a key are spelled with flats: `tonicPc` 0–11, `minor` = the tonic of a minor key. */
export const keyUsesFlats = (tonicPc, minor = false) => (minor ? MINOR_FLAT_KEYS : MAJOR_FLAT_KEYS).has(((tonicPc % 12) + 12) % 12);

/** The root `{ step, alter }` of a pitch class in a key (sharps or flats as the key has them). */
export function spellRoot(pc, tonicPc, minor = false) {
  const [step, alter] = (keyUsesFlats(tonicPc, minor) ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
  return { step, alter };
}

/** The tonics a menu offers for a kind of grid: [{ pc, root }] (the twelve notes, spelled as the key of that mode is). */
export const gridKeys = (minor = false) => Array.from({ length: 12 }, (_, pc) => ({ pc, root: spellRoot(pc, pc, minor) }));

/** The chords of a grid in a key, bar by bar: [[{ root, quality, at: [n, d] (a fraction of the bar) }]]. */
export function gridChords(grid, tonicPc) {
  return grid.bars.map((chords) => chords.map(({ d, q }, i) => ({ root: spellRoot(tonicPc + d, tonicPc, grid.minor), quality: q, at: i === 0 ? [0, 1] : [i, chords.length] })));
}
