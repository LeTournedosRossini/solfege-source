/*
 * A scale written as a NOTE (the document of the note pad, 1 to 4 measures): the staff view and the tablature view of a scale are drawn by the note viewer, with its sound.
 * PURE (the editor's own functions write it, like a tap would): `scaleNoteDocument(recipe)` → { json, kind, measures, truncated?, system?, position?, warnings: [] }.
 */
import { newNoteDocument, addMeasure, noteStaff, movementOf, NOTE_PREFS_DEFAULTS } from '../note/editmodel.js';
import { createNoteDocument, stringifyNoteDocument } from '../note/document.js';
import { enterNote, DEFAULT_ENTRY } from '../ui/noteentry-intents.js';
import { getProperty, PID } from '../model/index.js';
import { lib, TUNINGS } from './index.js';
import { normalizeRecipe, scaleOf } from './recipe.js';
import { SCALE_INSTRUMENTS } from './instruments.js';

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]; const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const at = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };

/** The key signature (number of sharps, flats negative) that spares the most accidentals to the notes of the scale (concert key; the written one follows for a transposing instrument). */
export function keyFifthsFor(recipe) {
  const notes = lib.notes(scaleOf(recipe), recipe.root);
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (the letters of C = 0)
  let best = 0; let bestCost = Infinity;
  for (let f = -7; f <= 7; f += 1) {
    const alter = new Array(7).fill(0);
    for (let i = 0; i < Math.abs(f); i += 1) alter[f > 0 ? SHARP_ORDER[i] : SHARP_ORDER[6 - i]] = f > 0 ? 1 : -1;
    const cost = notes.filter((n) => n.acc !== alter[n.letter]).length * 10 + Math.abs(f);
    if (cost < bestCost) { bestCost = cost; best = f; }
  }
  return notes.length === 7 ? best : 0; // (a scale of 5 or 8 notes has no key: its accidentals are written)
}

/** The notes of the scale from the root up to the octave (and back down unless `descending` is false), as spelled pitches { step, alter, octave, pitch } (concert pitch). */
export function scaleRun(recipe, low, { descending = true } = {}) {
  const notes = lib.notes(scaleOf(recipe), recipe.root);
  const pitchOf = (letter, acc, oct) => 12 * (oct + 1) + LETTER_PC[letter] + acc;
  let oct = 0; while (pitchOf(notes[0].letter, notes[0].acc, oct) < low) oct += 1;
  const up = []; let prev = null;
  for (const n of [...notes, notes[0]]) {
    if (prev !== null && n.letter <= prev) oct += 1; // the letters climb one by one: a letter that does not rise is in the octave above
    up.push({ step: STEP[n.letter], alter: n.acc, octave: oct, pitch: pitchOf(n.letter, n.acc, oct) });
    prev = n.letter;
  }
  return descending ? [...up, ...up.slice(0, -1).reverse()] : up;
}

/** The meter of a run of `n` eighths that fits in ONE measure (n ≤ 8): the pairs make the beats (8 → 4/4, 6 → 3/4, 4 → 2/4), an odd count leaves a rest at the end. Longer runs: 4/4, several measures. */
export function meterFor(n) { return n <= 8 ? { timeSig: [Math.max(1, Math.ceil(n / 2)), 4], slots: Math.max(2, n + (n % 2)) } : { timeSig: [4, 4], slots: 8 }; }

function fill(doc, items, duration, entryFor, slotsPerMeasure = null) {
  const den = duration === 'eighth' ? 8 : 16; const slots = slotsPerMeasure ?? den; // (a position is a fraction of a whole note, whatever the meter)
  const measures = Math.ceil(items.length / slots);
  for (let i = 1; i < measures; i += 1) addMeasure(doc);
  const staff = noteStaff(doc); const mv = movementOf(doc);
  items.forEach((item, k) => {
    const mi = Math.floor(k / slots); const j = k % slots;
    const hit = { staffId: staff.id, staffType: getProperty(staff, PID.STAFF_TYPE), measureId: mv.masterbars[mi].id, measureIndex: mi, position: at(j, den), voice: 0, line: item.line ?? 0 };
    doc.transaction('enter note', () => enterNote(doc, hit, { ...DEFAULT_ENTRY, duration: { base: duration, dots: 0 }, ...entryFor(item) }));
  });
  return measures;
}

/** Marks the root of the scale: its notes get the colour (the head on a staff, the fret number on a tablature). */
export const ROOT_COLOR = '#d32f2f';
function markRoot(doc, recipe) {
  const pc = lib.notes(scaleOf(recipe), recipe.root)[0].pc;
  const mv = movementOf(doc);
  doc.transaction('root colour', () => {
    for (const track of mv.tracks) for (const st of track.staves) for (const v of st.voices) for (const m of v.measures) for (const it of m.items) {
      if (it.type === 'chord') for (const n of it.notes) if (typeof n.pitch === 'number' && ((n.pitch % 12) + 12) % 12 === pc) doc.set(n, PID.COLOR, ROOT_COLOR);
    }
  });
}

/** The staff view: the scale going UP only (to the octave), in eighths, on the staff and in the clef of the instrument; the root in colour. */
function scoreDocument(recipe, { plain = false } = {}) {
  const ins = SCALE_INSTRUMENTS[recipe.instrument];
  const run = scaleRun(recipe, ins.low, { descending: false });
  const meter = meterFor(run.length);
  // `plain`: no instrument of its own (a container takes the transposition of the track that holds it)
  const doc = newNoteDocument({ kind: 'score', clef: ins.clef, instrument: plain ? 'none' : ins.note, concert: false, timeSig: meter.timeSig, keySig: keyFifthsFor(recipe) });
  const measures = fill(doc, run, 'eighth', (n) => ({ played: { pitch: n.pitch, spelling: { step: n.step, alter: n.alter, octave: n.octave } } }), meter.slots);
  markRoot(doc, recipe);
  return { doc, measures };
}

const NOTE_TUNING = Object.freeze({ standard: 'standard', dropD: 'dropD', halfStepDown: 'halfDown', dadgad: 'dadgad', openG: 'openG' });

/** The position of a recipe on the neck (the system and the position it asks for, else the first that suits the scale). */
export function positionOf(recipe, tuningName = 'standard') {
  const ins = SCALE_INSTRUMENTS[recipe.instrument]; const scale = scaleOf(recipe);
  const systems = lib.availableSystems(scale, { instrument: ins.lib, tuningName }).map((s) => s.id);
  const system = systems.includes(recipe.system) ? recipe.system : ['pentatonic', 'caged', '3nps'].find((s) => systems.includes(s)) ?? systems[0];
  const list = lib.positions(scale, recipe.root, { system, instrument: ins.lib, tuningName, ...(recipe.cagedSpan ? { cagedSpan: recipe.cagedSpan } : {}) });
  const position = list.find((p) => p.id === recipe.position) ?? list[0];
  return { system, systems, list, position };
}

/** The tablature view: the notes of ONE position, string by string upward and back (sixteenths when they would not fit in eighths). */
function tabDocument(recipe) {
  const ins = SCALE_INSTRUMENTS[recipe.instrument];
  const { system, position, list } = positionOf(recipe);
  const run = position.strings.flatMap((s) => s.notes.map((n) => ({ fret: n.fret, line: s.number - 1 }))); // going up only
  const kind = ins.family === 'bass' ? 'bass' : 'guitar';
  const meter = meterFor(run.length);
  const doc = newNoteDocument({ kind, strings: ins.strings, tuning: 'standard', timeSig: meter.timeSig, keySig: 0 });
  const total = fill(doc, run.slice(0, 32), 'eighth', (n) => ({ fret: n.fret }), meter.slots);
  markRoot(doc, recipe);
  return { doc, measures: total, system, position: position.id, positions: list.length, truncated: run.length > 32 };
}

/** The scale written as a document (the editor's, in memory): { doc, measures, system?, position?, positions?, truncated? }. A `fretboard` view is written as its tablature (what is played). */
export function buildScaleDoc(recipe, opts = {}) {
  const instrument = SCALE_INSTRUMENTS[recipe.instrument];
  return recipe.view === 'tab' || (recipe.view === 'fretboard' && instrument.views.includes('tab')) ? tabDocument(recipe) : scoreDocument(recipe, opts);
}

export function scaleNoteDocument(input) {
  const recipe = normalizeRecipe(input);
  const warnings = [];
  const built = buildScaleDoc(recipe);
  const json = stringifyNoteDocument(createNoteDocument(built.doc.work, { text: '' }));
  return { json, kind: recipe.view, measures: built.measures, system: built.system ?? null, position: built.position ?? null, truncated: Boolean(built.truncated), warnings };
}
/** The fretboard view shows the WHOLE neck (every note of the scale, 15 frets) unless a position is asked for. */
export const wholeNeck = (recipe) => recipe.view === 'fretboard' && (!recipe.system || recipe.system === 'all');
export { NOTE_PREFS_DEFAULTS, TUNINGS };
