// Degrees of a chord, written the way musicians name them: 1 (root), 2, 3, 4, 5, 6, 7 inside the octave and 8, 9, 10, 11, 12, 13 in the octave above
// (9 = the 2nd an octave up, 11 = the 4th, 13 = the 6th), with ♯ / ♭ in front ("b9", "#9", "#11", "b13"). PURE.
//
// A degree is an interval above the ROOT of the chord, never a pitch: a pattern written with degrees fits every chord. A degree WITHOUT sign
// ("3", "7", "9") means the chord's OWN tone of that degree (the minor third of Cm, the major seventh of Cmaj7); a degree WITH a sign is that exact
// interval whatever the chord ("b9" is always 13 semitones above the root).

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** { n, accidental, signed } of "b9", "#11", "5"… or null. n = 1..15, accidental = −2..2 semitones. */
export function parseDegree(text) {
  const m = /^(#{0,2}|b{0,2})(\d{1,2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1 || n > 15) return null;
  const accidental = m[1] ? (m[1][0] === '#' ? m[1].length : -m[1].length) : 0;
  return { n, accidental, signed: m[1] !== '' };
}

/** A degree a fretted fingering can be asked to have in the bass (a chord tone, 1 to 7: "3", "5", "b7"…). */
export const isBassDegree = (v) => { const d = typeof v === 'string' ? parseDegree(v) : null; return !!d && d.n >= 1 && d.n <= 7; };

/** Semitones above the root of the degree n (1..15) in the major scale, octaves included: 1 → 0, 3 → 4, 7 → 11, 8 → 12, 9 → 14, 13 → 21. */
export const majorInterval = (n) => MAJOR[(n - 1) % 7] + 12 * Math.floor((n - 1) / 7);

/** Exact interval (semitones above the root) of a SIGNED degree: "b9" → 13, "#11" → 18, "b3" → 3. */
export function degreeSemitones(text) {
  const d = parseDegree(text);
  return d ? majorInterval(d.n) + d.accidental : null;
}

/** The name musicians give to a degree an octave up, and back: 2 → 9, 4 → 11, 6 → 13 (and 9 → 2, 11 → 4, 13 → 6). Others: n ± 7. */
export const compoundDegree = (n) => (n <= 7 ? n + 7 : n);
export const simpleDegree = (n) => (n > 7 ? n - 7 : n);

/** Label of an interval in semitones above the root: 0 → "1", 3 → "b3", 13 → "b9", 14 → "9", 18 → "#11", 20 → "b13". */
const LABELS = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', '#5', '6', 'b7', '7'];
const COMPOUND = ['8', 'b9', '9', '#9', '10', '11', '#11', '12', 'b13', '13', 'b14', '14'];
export function degreeLabel(semitones) {
  if (!Number.isInteger(semitones) || semitones < 0 || semitones >= 24) return null;
  return semitones < 12 ? LABELS[semitones] : COMPOUND[semitones - 12];
}

/**
 * Degree number (1..15) a tone of the chord counts as, from its interval above the root, the other tones deciding the ambiguous ones:
 * the tritone is the ♭5 of a diminished chord (no perfect fifth) but the ♯4 / ♯11 of a chord that has one; 8 semitones are the ♯5 without a perfect fifth, else the ♭6 / ♭13;
 * 9 is the 6th, or the ♭♭7 of a diminished seventh (minor third + tritone, no perfect fifth).
 */
function classify(s, has) {
  const pc = ((s % 12) + 12) % 12; const oct = Math.floor(s / 12);
  const fifth = has(7);
  let simple;
  switch (pc) {
    case 0: simple = 1; break;
    case 1: case 2: simple = 2; break;
    case 3: case 4: simple = 3; break;
    case 5: simple = 4; break;
    case 6: simple = fifth ? 4 : 5; break;
    case 7: simple = 5; break;
    case 8: simple = fifth ? 6 : 5; break;
    case 9: simple = !fifth && has(3) && has(6) ? 7 : 6; break;
    default: simple = 7; // 10, 11
  }
  return simple + 7 * oct;
}

/**
 * The chord's OWN tone of the natural degree n: its interval in semitones above the root, or null when the chord has no such tone (no seventh in a triad,
 * no third in a sus chord…). `intervals` as in the chord-quality dictionary (0 first, may go past 12 for a 9th / 11th / 13th).
 */
export function chordOwnTone(intervals, n) {
  if (n === 8 || n === 15) return 12 * ((n - 1) / 7); // the root an octave (two octaves) up: every chord has one
  const set = new Set((intervals ?? [0]).map((i) => ((i % 12) + 12) % 12));
  set.add(0);
  const has = (pc) => set.has(pc);
  for (const s of [...new Set([0, ...(intervals ?? [])])]) if (classify(s, has) === n) return s;
  return null;
}

/** What to sound for a degree when the chord has no tone of that degree and the card says "play it anyway": the usual note (7 is the minor 7th, the others the major scale). */
export function defaultTone(n) {
  const simple = simpleDegree(n); const oct = Math.floor((n - 1) / 7);
  return (simple === 7 ? 10 : MAJOR[simple - 1]) + 12 * oct;
}
