// A chord PATTERN made from what has been WRITTEN: the notes of the staves chosen on the score, over measures of the movement, are turned into a pattern in chord degrees — the same format as the
// built-in patterns (model/chordpatterns.js) — so that they can become the player of a style (model/styles.js) and be played on any chord grid, in any key. PURE (reads the document).
// This is the reverse of "write as real tracks" (model/bakeplay.js).
//   - the CHORD TRACK is the table of truth: each note is read against the chord in force at its place; a note is named by the chord's OWN tone when it is one ("3" of Cm is its minor third), else by
//     an exact signed degree ("b9", "#11", "b4" = a major third over a minor chord…): the user knows what they wrote, nothing is judged;
//   - a hit that holds every tone of the chord (three notes or more) becomes the whole chord, "C", unless the exact voicing is asked for;
//   - the rhythm is kept exactly (position and length of each chord of notes, accents and staccatos), the rests are gaps;
//   - by default the VOICING is left to the solver of the player (the notes only say which degrees, the hand and the octaves are chosen again for each chord: `voices.rh: 'led'`); with `exact` the octave of
//     every note is kept (`3+1`), `voices` are `literal`: the same notes come back on the same grid, one behind the other.
// A bass player (`bass`): the root is the bass of the chord ("B"). With two staves the lower one is the left hand: its lowest note on the root is "B", the others "L" + degree.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { tempoTimeline } from './tempomap.js';
import { measureLengthOf, itemDuration } from './timing.js';
import { fAdd, fCmp, fToNumber, ZERO } from './fraction.js';
import { workChordQualities } from './chordqualityedit.js';
import { chordOwnTone } from './chorddegrees.js';
import { parsePart, createChordPattern, MAX_BARS } from './chordpatterns.js';
import { chordSourceOf, chordContext } from '../audio/rhythmplay.js';
import { chordTones, degreePitch, COMPING_DEFAULTS } from '../audio/comping.js';
import { wholeNoteClock, BakeError } from './bakeplay.js';
import { flatStaves } from './range.js';

const mod12 = (n) => ((n % 12) + 12) % 12;
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const reduce = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
const WRITTEN_TYPES = ['score', 'tab', 'accordion'];
/** The tones that may be named by their own degree, in the order they are tried. */
const OWN_ORDER = [1, 3, 5, 7, 9, 11, 13, 2, 4, 6];
/** The exact signed degree of an interval (semitones above the root) that is NOT a tone of the chord: signed so that it does not mean "the chord's own tone". */
const SIGNED = ['1', 'b2', 'bb3', 'b3', 'b4', '#3', '#4', 'bb6', '#5', 'bb7', 'b7', 'b8'];

/** The degree token of a note: `pitch` over a chord spec { rootPc, intervals, bassPc }. */
export function degreeToken(pitch, spec) {
  const iv = mod12(pitch - spec.rootPc);
  for (const n of OWN_ORDER) {
    const own = chordOwnTone([0, ...spec.intervals], n);
    if (own !== null && mod12(own) === iv) return String(n);
  }
  return SIGNED[iv];
}

/**
 * @param doc the document, `mv` the movement
 * @param o   { staffIds (the staves chosen: only notation, tablature and accordion staves count, a staff linked to another is left out), from, to (measure indices, inclusive), exact (keep the octaves, off by default),
 *   bass (the root is "B"), name, options (the playing values of the card the pattern will be played with: the octaves of an exact voicing are counted from its compass) }
 * @returns {{ pattern, hits: number, skipped: number }} `pattern` is checked (`createChordPattern`, no id: the application gives one when it saves it); `skipped` = notes with no chord to read them against
 */
export function patternFromNotes(doc, mv, { staffIds, from, to, exact = false, bass = false, name = null, options = null }) {
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to < mv.masterbars.length)) throw new BakeError('range', 'Select measures of the movement first');
  const count = to - from + 1;
  if (count > MAX_BARS) throw new BakeError('tooLong', `A pattern has at most ${MAX_BARS} bars`);
  const barLength = measureLengthOf(mv.masterbars[from]);
  for (let i = from; i <= to; i++) if (fCmp(measureLengthOf(mv.masterbars[i]), barLength) !== 0) throw new BakeError('metre', 'The measures of a pattern all have the same metre');
  const staves = flatStaves(mv).filter((s) => staffIds.includes(s.id) && WRITTEN_TYPES.includes(getProperty(s, PID.STAFF_TYPE)) && !getProperty(s, PID.LINKED_TO));
  if (!staves.length) throw new BakeError('staff', 'Choose a staff with written notes');
  const voice0 = chordSourceOf(mv)?.voices[0];
  if (!voice0) throw new BakeError('noChords', 'The movement has no chord track to read the notes against');
  const layout = tempoTimeline(mv).layout;
  const { slots, tl } = wholeNoteClock(mv, layout);
  const { compAt } = chordContext(voice0, { mv, layout, tl, slots, chordQualities: workChordQualities(doc.work) });

  const hits = new Map(); let skipped = 0;
  staves.forEach((staff, staffIndex) => {
    const left = staves.length >= 2 && staffIndex === staves.length - 1; // the lowest of several staves: the left hand
    const tieEnds = new Set((getProperty(staff, PID.TIES) ?? []).map((t) => t.endNoteId));
    for (const voice of staff.voices) {
      for (let mi = from; mi <= to; mi++) {
        let rel = ZERO;
        for (const item of voice.measures[mi]?.items ?? []) {
          const length = itemDuration(item, barLength);
          if (item.type === 'chord' && !item.notes?.some((n) => tieEnds.has(n.id))) {
            const abs = fAdd(layout.starts[mi], rel);
            const chord = compAt(fToNumber(abs));
            const at = fAdd([barLength[0] * (mi - from), barLength[1]], rel); // inside the pattern
            const key = `${at[0]}/${at[1]}`;
            if (!hits.has(key)) hits.set(key, { at, dur: length, notes: [], accent: false, staccato: false });
            const hit = hits.get(key);
            if (fCmp(length, hit.dur) > 0) hit.dur = length;
            const arts = (getProperty(item, PID.ARTICULATIONS) ?? []).map((a) => a.type);
            if (arts.some((a) => ['accent', 'marcato', 'accentStaccato'].includes(a))) hit.accent = true;
            if (arts.some((a) => ['staccato', 'staccatissimo', 'accentStaccato'].includes(a))) hit.staccato = true;
            for (const note of item.notes ?? []) {
              const pitch = getProperty(note, PID.PITCH);
              if (!Number.isFinite(pitch)) continue;
              if (!chord?.spec) { skipped += 1; continue; }
              hit.notes.push({ pitch, spec: chord.spec, left });
            }
          }
          rel = fAdd(rel, length);
        }
      }
    }
  });

  const out = [];
  for (const h of [...hits.values()].sort((a, b) => fCmp(a.at, b.at))) {
    if (!h.notes.length) continue;
    const parts = [];
    const spec = h.notes[0].spec;
    const pcs = new Set(h.notes.map((n) => mod12(n.pitch)));
    const wholeChord = !exact && !bass && h.notes.length >= 3 && chordTones(spec).every((pc) => pcs.has(pc));
    if (wholeChord) parts.push('C');
    else {
      const lowest = Math.min(...h.notes.map((n) => n.pitch));
      for (const n of [...h.notes].sort((a, b) => a.pitch - b.pitch)) {
        const isRoot = mod12(n.pitch) === mod12(n.spec.bassPc ?? n.spec.rootPc);
        let token;
        if ((bass || n.left) && isRoot && (bass || n.pitch === lowest)) token = 'B';
        else {
          token = `${n.left ? 'L' : ''}${degreeToken(n.pitch, n.spec)}`;
          if (exact) {
            const base = degreePitch(parsePart(token), n.spec, { ...COMPING_DEFAULTS, ...(options ?? {}) });
            const shift = base === null ? 0 : Math.round((n.pitch - base) / 12);
            if (shift !== 0 && Math.abs(shift) <= 9) token += `${shift > 0 ? '+' : '-'}${Math.abs(shift)}`;
          }
        }
        if (!parts.includes(token)) parts.push(token);
      }
    }
    out.push({ at: h.at, dur: h.dur, parts, ...(h.accent ? { accent: true } : {}), ...(h.staccato ? { staccato: true } : {}) });
  }
  const length = reduce(barLength[0] * count, barLength[1]);
  const pattern = createChordPattern({
    id: '', name, length, bars: count > 1 ? count : undefined, hits: out, // `length` = the whole pattern, `bars` of it
    voices: exact ? { rh: 'literal', lh: 'literal' } : { rh: 'led', lh: 'literal' },
  });
  if (!pattern) throw new BakeError('empty', 'There are no notes over these measures (or no chord under them)');
  return { pattern, hits: pattern.hits.length, skipped };
}
