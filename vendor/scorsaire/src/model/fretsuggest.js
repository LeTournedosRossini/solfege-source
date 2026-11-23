/*
 * Suggested fingerings for a chord on a fretted instrument. PURE (no DOM).
 *
 * Two sources are combined, then ranked by one scoring function:
 *  - a COMPUTED search (the idea of TuxGuitar's chord creator): every fingering inside a window of a few frets whose sounding notes belong to the chord,
 *    for ANY tuning and number of strings (drop D, ukulele, bass, 7 strings…);
 *  - a LIBRARY of 2086 curated shapes for the standard 6-string guitar (`fret-shapes.json`, extracted from MuseScore's chord-to-diagram table by
 *    `tools/extract-fret-shapes.py`): a library shape gets a bonus, so the familiar open and barre shapes come first. A library shape is accepted
 *    for a chord only if its OWN notes spell that chord: the chord names of MuseScore's table are never read (they are noisy).
 *
 * What the chord needs (`chordNeeds`): the root, the third (or the sus note), the seventh, the alterations and the bass of a slash chord. The fifth is
 * optional when there is a third; with five notes or more the 9th and the 11th may be left out, with six or more only the root, the third and the seventh are required. Coverage of the other notes is rewarded, not required.
 * The user can always edit the result: this is a SUGGESTION.
 */
import { createVoicing, voicingPitches, voicingCode, fretsFromCode, fingerCount, INSTRUMENT_PRESETS } from './fretvoicing.js';
import { chordQualityIntervals } from './chordquality.js';
import shapeLibrary from './fret-shapes.json' with { type: 'json' };

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod12 = (n) => ((n % 12) + 12) % 12;

/** Pitch class of a note { step, alter }. */
export const notePc = (note) => mod12(LETTER_PC[String(note.step).toUpperCase()] + (note.alter ?? 0));

/**
 * What the chord is made of, from a chord symbol { root: {step, alter}, quality, bass: {step, alter}|null }: { rootPc, intervals, bassPc }.
 * `dict` is the chord-quality dictionary (the work's, else the default); null when the quality is not in it.
 */
export function chordSpecFromSymbol(sym, dict) {
  if (!sym?.root) return null;
  const intervals = chordQualityIntervals(dict, sym.quality ?? '');
  if (!intervals) return null;
  return { rootPc: notePc(sym.root), intervals: [...intervals], bassPc: sym.bass ? notePc(sym.bass) : null };
}

/** { notes: Set of pitch classes of the chord, required: Set that every suggestion must sound, rootPc, bassPc }. */
export function chordNeeds({ rootPc, intervals, bassPc = null }, { monophonic = false } = {}) {
  const rel = new Set([0, ...intervals.map(mod12)]);
  const required = new Set(rel);
  if (rel.has(3) || rel.has(4)) required.delete(7); // the fifth is optional when there is a third
  if (rel.size >= 5) {
    if (rel.has(9) || rel.has(10) || rel.has(11)) { required.delete(2); } // 9th may go when a seventh stands
    if (rel.has(3) || rel.has(4)) required.delete(5); // 11th may go
  }
  if (rel.size >= 6) { // six notes or more (altered dominants…): a guitar cannot play them all — keep the root, the third and the seventh, reward the rest
    for (const i of [...required]) if (![0, 3, 4, 9, 10, 11].includes(i)) required.delete(i);
  }
  if (monophonic) { for (const i of [...required]) if (i !== 0) required.delete(i); } // a bass: the root (or the named bass note) is what counts, the rest is rewarded
  const abs = (set) => new Set([...set].map((i) => mod12(rootPc + i)));
  const notes = abs(rel);
  const req = abs(required);
  if (bassPc !== null && bassPc !== undefined) { notes.add(bassPc); req.add(bassPc); }
  return { notes, required: req, rootPc, bassPc: bassPc ?? null };
}

const LIBRARY = new Set(shapeLibrary.shapes);
const STANDARD = shapeLibrary.tuning;
const sameTuning = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Score a fingering for a chord (null when it is not acceptable).
 * @returns { score, coverage } | null
 */
export function evaluateFingering(frets, tuning, needs, { minSounding, maxFingers = 4, maxSpan = 5, library = false } = {}) {
  const n = frets.length;
  const min = minSounding ?? (n >= 5 ? 4 : 3);
  const pitches = frets.map((f, i) => (f < 0 ? null : tuning[i] + f));
  const sounding = pitches.filter((p) => p !== null);
  if (sounding.length < min) return null;
  const sounded = new Set(sounding.map((p) => p % 12));
  for (const pc of sounded) if (!needs.notes.has(pc)) return null; // a foreign note
  for (const pc of needs.required) if (!sounded.has(pc)) return null; // a missing essential note
  const fretted = frets.filter((f) => f > 0);
  const lo = fretted.length ? Math.min(...fretted) : 0;
  const hi = fretted.length ? Math.max(...fretted) : 0;
  const span = fretted.length ? hi - lo + 1 : 0;
  if (span > maxSpan) return null;
  if (fingerCount(frets) > maxFingers) return null;
  // the bass is the lowest SOUNDING PITCH (a re-entrant ukulele has no low string)
  // a re-entrant tuning (ukulele) has no bass string: the lowest pitch says nothing about the harmony, so the bass rules are skipped
  const ascending = tuning.every((p, i) => i === 0 || p >= tuning[i - 1]);
  const bassPc = Math.min(...sounding) % 12;
  if (ascending && needs.bassPc !== null && bassPc !== needs.bassPc) return null; // slash chord: the bass must be the named one
  const coverage = [...needs.notes].filter((pc) => sounded.has(pc)).length / needs.notes.size;
  let score = 20 * coverage;
  if (ascending) score += needs.bassPc === null ? (bassPc === needs.rootPc ? 6 : -4) : 6;
  const first = frets.findIndex((f) => f >= 0);
  const last = frets.length - 1 - [...frets].reverse().findIndex((f) => f >= 0);
  let inner = 0;
  let outer = 0;
  for (let i = 0; i < n; i++) if (frets[i] < 0) { if (i > first && i < last) inner++; else outer++; }
  score -= 3 * inner + 0.5 * outer;
  score -= 0.35 * lo;
  score -= 1.2 * Math.max(0, span - 3);
  score += 1 * frets.filter((f, i) => f === 0 && pitches[i] !== null).length;
  score += 0.8 * (sounding.length - min);
  score -= 1.5 * Math.max(0, fingerCount(frets) - 3);
  if (library) score += 14;
  return { score, coverage };
}

/** Every fingering inside a window of `span` frets (plus open strings) whose notes all belong to the chord. */
function searchWindows(tuning, needs, { span, maxPosition }) {
  const n = tuning.length;
  const found = new Set();
  const out = [];
  for (let w = 1; w <= maxPosition; w++) {
    const options = tuning.map((open) => {
      const o = [-1];
      if (needs.notes.has(mod12(open))) o.push(0);
      for (let f = w; f < w + span; f++) if (needs.notes.has(mod12(open + f))) o.push(f);
      return o;
    });
    const cur = new Array(n);
    const walk = (i) => {
      if (i === n) {
        const code = voicingCode(cur);
        if (!found.has(code)) { found.add(code); out.push([...cur]); }
        return;
      }
      for (const f of options[i]) { cur[i] = f; walk(i + 1); }
    };
    walk(0);
  }
  return out;
}

/**
 * Suggested voicings for a chord, best first.
 * @param spec     { rootPc, intervals, bassPc? } (see `chordSpecFromSymbol`)
 * @param options  { instrument = 'guitar', tuning?, limit = 8, span = 4, maxPosition = 12, minSounding?, maxFingers = 4, useLibrary = true }
 * @returns [{ voicing, score, library }]
 */
/**
 * Piano: the keys of the chord stacked close above a root in the octave of middle C, root position first, then the inversions (the first tones move up an octave); a bass note
 * (slash chord) is added below; last the root position with the root doubled an octave and a half lower. A piano has no string to choose, so the ranking is by closeness.
 */
export function pianoVoicings(spec, limit = 8) {
  const tones = [...new Set([0, ...spec.intervals].map((i) => ((i % 12) + 12) % 12))].sort((a, b) => a - b); // intervals above the root, root first
  const base = 60 + spec.rootPc;
  const out = []; const seen = new Set();
  const add = (notes, score) => {
    const v = createVoicing({ instrument: 'piano', notes });
    const key = v.notes.join(',');
    if (!seen.has(key)) { seen.add(key); out.push({ voicing: v, score, library: false }); }
  };
  const withBass = (notes) => {
    if (spec.bassPc === null || spec.bassPc === undefined) return notes;
    const lowest = Math.min(...notes);
    if (lowest % 12 === spec.bassPc) return notes; // the bass is already the lowest note
    let m = lowest - 1;
    while (m % 12 !== spec.bassPc) m--;
    return [Math.max(m, 24), ...notes];
  };
  for (let k = 0; k < tones.length; k++) add(withBass(tones.map((t, i) => base + t + (i < k ? 12 : 0))), 10 - k);
  if (spec.bassPc === null || spec.bassPc === undefined) add([48 + spec.rootPc, ...tones.map((t) => base + t)], 6); // root doubled in the bass
  else for (let k = 0; k < tones.length; k++) { const notes = tones.map((t, i) => base + t + (i < k ? 12 : 0)); if (Math.min(...notes) % 12 === spec.bassPc) add(notes, 11); } // inversion whose lowest tone is the bass
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function suggestVoicings(spec, options = {}) {
  const { instrument = 'guitar', limit = 8, span = 4, maxPosition = 12, useLibrary = true } = options;
  if (instrument === 'piano') return pianoVoicings(spec, limit);
  const preset = INSTRUMENT_PRESETS[instrument]?.tuning;
  const tuning = options.tuning ?? preset;
  if (!tuning) throw new Error(`No tuning for instrument "${instrument}"`);
  const bassLike = instrument === 'bass' || instrument === 'bass5'; // basses: one to three notes, not a full chord
  const needs = chordNeeds(spec, { monophonic: bassLike });
  const opts = { minSounding: options.minSounding ?? (bassLike ? 1 : undefined), maxFingers: options.maxFingers ?? 4 };
  const candidates = new Map(); // code → { frets, library }
  for (const frets of searchWindows(tuning, needs, { span, maxPosition })) candidates.set(voicingCode(frets), { frets, library: false });
  if (useLibrary && sameTuning(tuning, STANDARD)) {
    for (const code of LIBRARY) {
      const frets = fretsFromCode(code);
      candidates.set(code, { frets, library: true });
    }
  }
  const ranked = [];
  for (const [code, c] of candidates) {
    const e = evaluateFingering(c.frets, tuning, needs, { ...opts, library: c.library });
    if (e) ranked.push({ code, frets: c.frets, score: e.score, library: c.library });
  }
  ranked.sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : 1));
  return ranked.slice(0, limit).map((r) => ({
    voicing: createVoicing({ instrument, tuning: options.tuning, frets: r.frets, barres: undefined }),
    score: r.score,
    library: r.library,
  }));
}

/** The pitch classes of a voicing that are not in the chord (empty = every note belongs to it). */
export function foreignNotes(voicing, spec) {
  const needs = chordNeeds(spec);
  return [...new Set(voicingPitches(voicing).filter((p) => p !== null).map((p) => p % 12))].filter((pc) => !needs.notes.has(pc));
}
