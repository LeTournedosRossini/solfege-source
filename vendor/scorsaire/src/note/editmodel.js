/*
 * What the note editor does to the document, without any DOM (testable under Node). Every write goes through `doc.transaction` like the rest of Scorsaire.
 * A note holds ONE kind of staff, chosen at creation (changing it starts over, the teacher is asked first): notation (treble or bass clef), piano (two staves),
 * guitar tablature, bass tablature (4 or 5 strings) or drums; 1 to 4 measures.
 */
import { createScore } from '../model/newscore.js';
import { createDocument } from '../model/document.js';
import { insertMeasures, deleteMeasures } from '../model/measureedit.js';
import { setStaffTuning } from '../model/tuningedit.js';
import { addTrack } from '../model/trackedit.js';
import { SID } from '../model/sid.js';
import { setMeasureSlots } from '../ui/chordentry-intents.js';
import { createCapo } from '../model/elements.js';
import { insertCapo } from '../model/capo.js';
import { PID } from '../model/pid.js';
import { DEFAULT_PERCMAP, createPercMap } from '../model/percmap.js';
import { getProperty } from '../model/props.js';
import { NOTE_LIMITS } from './document.js';

export const KINDS = Object.freeze(['score', 'piano', 'guitar', 'bass', 'drums']);
export const CLEFS = Object.freeze(['G', 'F', 'C3', 'C4']); // treble, bass, alto (C clef on the 3rd line: viola), tenor (C clef on the 4th)
/** The time signatures offered: the common ones first, the odd ones after (the order of the picker). */
export const TIME_SIGNATURES = Object.freeze([[4, 4], [12, 8], [2, 4], [3, 4], [6, 8], [5, 4], [7, 4], [9, 8], [12, 4]]);
/** Instruments of a notation note (catalogue ids). `none` = no instrument: the clef is chosen and the sound is a piano. The transposing ones write a part that sounds lower than it is written. */
export const INSTRUMENTS = Object.freeze({
  none: { id: null, transposing: false }, flute: { id: 'flute', transposing: false }, violin: { id: 'violin', transposing: false }, viola: { id: 'viola', transposing: false }, cello: { id: 'violoncello', transposing: false }, trombone: { id: 'trombone', transposing: false },
  sopranoSax: { id: 'soprano-saxophone', transposing: true }, altoSax: { id: 'alto-saxophone', transposing: true }, tenorSax: { id: 'tenor-saxophone', transposing: true }, baritoneSax: { id: 'baritone-saxophone', transposing: true },
  clarinet: { id: 'bb-clarinet', transposing: true }, trumpet: { id: 'bb-trumpet', transposing: true }, horn: { id: 'horn', transposing: true },
  // (not in the instrument sheet: used by the scale component)
  oboe: { id: 'oboe', transposing: false }, bassoon: { id: 'bassoon', transposing: false }, tuba: { id: 'tuba', transposing: false }, doubleBass: { id: 'contrabass', transposing: true },
  piccolo: { id: 'piccolo', transposing: true }, bassFlute: { id: 'bass-flute', transposing: true }, ebClarinet: { id: 'eb-clarinet', transposing: true }, bassClarinet: { id: 'bass-clarinet', transposing: true },
});
/** The instruments by section (the order of the instrument sheet); `none` = no instrument, a clef is chosen. */
export const INSTRUMENT_SECTIONS = Object.freeze([
  ['strings', ['violin', 'viola', 'cello']],
  ['woodwinds', ['flute', 'clarinet', 'sopranoSax', 'altoSax', 'tenorSax', 'baritoneSax']],
  ['brass', ['trumpet', 'horn', 'trombone']],
]);
export const NOTE_PREFS_DEFAULTS = Object.freeze({ kind: 'score', clef: 'G', timeSig: [4, 4], keySig: 0, sound: 'electric', strings: 4, tuning: 'standard', capo: 0, instrument: 'none', concert: false });
/** The states the type button of the top bar goes through, one tap at a time: the notation clefs, the piano, the two tablatures, the drums. */
export const STAFF_CYCLE = Object.freeze([
  { kind: 'score', clef: 'G' }, { kind: 'score', clef: 'F' }, { kind: 'score', clef: 'C3' }, { kind: 'score', clef: 'C4' },
  { kind: 'piano' }, { kind: 'guitar' }, { kind: 'bass' }, { kind: 'drums' },
]);
/** Where `prefs` stand in the cycle (-1 when the staff is a notation staff of an instrument: its clef is the instrument's). */
export const cycleIndexOf = (p) => STAFF_CYCLE.findIndex((s) => s.kind === p.kind && (s.kind !== 'score' || (p.instrument === 'none' && s.clef === p.clef)));
/** The choice that follows `prefs` in the cycle, as a patch of the preferences (an instrument is dropped: a clef is chosen). */
export const nextStaffChoice = (p) => { const n = STAFF_CYCLE[(cycleIndexOf(p) + 1) % STAFF_CYCLE.length]; return n.kind === 'score' ? { kind: 'score', clef: n.clef, instrument: 'none', concert: false } : { kind: n.kind }; };
export const isTransposing = (p) => p.kind === 'score' && Boolean(INSTRUMENTS[p.instrument]?.transposing);

/** Catalogue instruments behind each choice (they give the clefs, the tuning, the drum map and the playback sound). */
export const GUITAR_SOUNDS = Object.freeze({ electric: 'electric-guitar-tablature', acoustic: 'guitar-steel-tablature', nylon: 'guitar-nylon-tablature' });
export const BASS_INSTRUMENTS = Object.freeze({ 4: 'electric-bass-4-str-tab', 5: '5-string-electric-bass-tab' });
/** Tunings, highest string first (the order of `PID.TUNING`); the first of each list is the instrument's own. */
export const TUNINGS = Object.freeze({
  guitar: { standard: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], dropD: ['E4', 'B3', 'G3', 'D3', 'A2', 'D2'], halfDown: ['Eb4', 'Bb3', 'Gb3', 'Db3', 'Ab2', 'Eb2'], dadgad: ['D4', 'A3', 'G3', 'D3', 'A2', 'D2'], openG: ['D4', 'B3', 'G3', 'D3', 'G2', 'D2'] },
  bass4: { standard: ['G2', 'D2', 'A1', 'E1'], dropD: ['G2', 'D2', 'A1', 'D1'], halfDown: ['Gb2', 'Db2', 'Ab1', 'Eb1'] },
  bass5: { standard: ['G2', 'D2', 'A1', 'E1', 'B0'], dropD: ['G2', 'D2', 'A1', 'E1', 'A0'] },
});
export const MAX_CAPO = 12;
const tuningsOf = (p) => (p.kind === 'guitar' ? TUNINGS.guitar : Number(p.strings) === 5 ? TUNINGS.bass5 : TUNINGS.bass4);
export const tuningChoices = (p) => Object.keys(tuningsOf(p));
export const hasTablature = (kind) => kind === 'guitar' || kind === 'bass';

export function normalizePrefs(input = {}) {
  const p = { ...NOTE_PREFS_DEFAULTS, ...input };
  if (!KINDS.includes(p.kind)) throw new Error(`Staff kind « ${p.kind} » not offered`);
  if (!CLEFS.includes(p.clef)) throw new Error(`Clef « ${p.clef} » not offered`);
  if (!(p.sound in GUITAR_SOUNDS)) p.sound = 'electric';
  p.strings = Number(p.strings) === 5 ? 5 : 4;
  if (!tuningChoices(p).includes(p.tuning)) p.tuning = 'standard';
  p.capo = Math.max(0, Math.min(MAX_CAPO, Math.round(Number(p.capo) || 0)));
  if (p.kind !== 'score' || !(p.instrument in INSTRUMENTS)) p.instrument = 'none';
  p.concert = isTransposing(p) && p.concert === true; // « written as it sounds » only means something for a transposing instrument
  return p;
}

const partOf = (p) => {
  switch (p.kind) {
    case 'piano': return { instrumentId: 'piano' };
    case 'guitar': return { instrumentId: GUITAR_SOUNDS[p.sound] };
    case 'bass': return { instrumentId: BASS_INSTRUMENTS[p.strings] };
    case 'drums': return { instrumentId: 'drum-kit-5' };
    default: return p.instrument !== 'none' ? { instrumentId: INSTRUMENTS[p.instrument].id } : { staffType: 'score', clef: p.clef };
  }
};

/** A fresh empty note from the choices (`prefs`: the last ones the teacher used). Returns the document (history included). */
export function newNoteDocument(prefs = {}, { lang = 'fr' } = {}) {
  const p = normalizePrefs(prefs);
  const doc = createDocument(createScore({ measures: 1, timeSig: p.timeSig, keySig: p.keySig, parts: [partOf(p)], lang }));
  const mv = doc.work.movements[0]; const staff = mv.tracks[0].staves[0];
  doc.transaction('look', () => {
    doc.setStyle(mv, SID.SHOW_INSTRUMENT_NAMES, false); // a note is a few bars: no names at the left of the staves
    if (p.kind === 'drums') doc.set(staff, PID.PERCMAP, createPercMap(DEFAULT_PERCMAP)); // the drum map of Scorsaire (the application's), not the instrument's own small kit
    if (p.concert) doc.setStyle(mv, SID.CONCERT_PITCH, true); // written as it sounds: what the teacher writes and what the pupil sees, until the pupil asks otherwise
  });
  if (hasTablature(p.kind)) {
    const names = tuningsOf(p)[p.tuning];
    doc.transaction('tuning', () => setStaffTuning(doc, mv, staff, names, { track: mv.tracks[0] }));
    if (p.capo > 0) {
      const first = staff.voices[0].measures[0].items[0];
      doc.transaction('capo', () => insertCapo(doc, mv, staff, createCapo(first.id, { fret: p.capo })));
    }
  }
  return createDocument(doc.work); // a fresh history: the set-up is not something to undo
}

export const movementOf = (doc) => doc.work.movements[0];
export const measureCount = (doc) => movementOf(doc).masterbars.length;
export const canAddMeasure = (doc) => measureCount(doc) < NOTE_LIMITS.maxMeasures;
export const canRemoveMeasure = (doc) => measureCount(doc) > NOTE_LIMITS.minMeasures;
const isChordTrack = (t) => t.staves.some((st) => getProperty(st, PID.STAFF_TYPE) === 'chord');
/** The track the music is written in (the chord track, when there is one, is another track and always comes first). */
export const mainTrack = (doc) => movementOf(doc).tracks.find((t) => !isChordTrack(t));
export const chordTrack = (doc) => movementOf(doc).tracks.find(isChordTrack) ?? null;
/** The staff a tap writes in: the first one of the main track (for the piano, the staff a tap hits is found by the view). */
export const noteStaff = (doc) => mainTrack(doc).staves[0];

/** Are the chords drawn? They are hidden by default: the chord track only exists once the teacher asked for it, and stays (hidden) with its symbols when turned off. */
export const chordsShown = (doc) => { const t = chordTrack(doc); return Boolean(t) && getProperty(t, PID.VISIBLE) !== false; };

/** Shows or hides the chord grid. Creates the chord track the first time; turning it off keeps the symbols, and drops the track when it holds none. To be called inside a transaction. */
export function setChordsShown(doc, on, { lang = 'fr' } = {}) {
  const mv = movementOf(doc); let t = chordTrack(doc);
  if (on) {
    if (!t) {
      t = addTrack(doc, mv, { staves: [{ type: 'chord' }], name: lang === 'fr' ? 'Accords' : 'Chords', abbreviation: 'Ch' });
      for (const mb of mv.masterbars) setMeasureSlots(doc, { staffId: t.staves[0].id, measureId: mb.id }, 1); // a note is a few bars: one chord a measure to begin with (2 or 4 on request)
    } else if (getProperty(t, PID.VISIBLE) === false) doc.set(t, PID.VISIBLE, true);
  } else if (t) {
    const hasSymbols = t.staves.some((st) => st.voices.some((v) => v.measures.some((m) => m.items.some((i) => i.type === 'chordsymbol'))));
    if (hasSymbols) doc.set(t, PID.VISIBLE, false); else doc.remove(t);
  }
}
export const staffKind = (doc) => getProperty(noteStaff(doc), PID.STAFF_TYPE);

/** Appends an empty measure (it keeps the signatures of the last one). Returns false at the limit. */
export function addMeasure(doc) {
  if (!canAddMeasure(doc)) return false;
  doc.transaction('add measure', () => {
    const mv = movementOf(doc); const chords = chordTrack(doc);
    insertMeasures(doc, mv, { at: measureCount(doc), count: 1 });
    if (chords) setMeasureSlots(doc, { staffId: chords.staves[0].id, measureId: mv.masterbars[mv.masterbars.length - 1].id }, 1);
  });
  return true;
}

/** Removes the LAST measure (and what it holds). Returns false when only one is left. */
export function removeLastMeasure(doc) {
  if (!canRemoveMeasure(doc)) return false;
  const last = measureCount(doc) - 1;
  doc.transaction('remove measure', () => deleteMeasures(doc, movementOf(doc), { from: last, to: last }));
  return true;
}

/** Current choices of the document, in the shape of the preferences (what the teacher can change in the top sheet). */
export function notePrefsOf(doc) {
  const mv = movementOf(doc); const first = mv.masterbars[0]; const track = mainTrack(doc); const staff = noteStaff(doc);
  const instrument = getProperty(track, PID.INSTRUMENT_ID);
  const p = { clef: getProperty(staff, PID.CLEF) ?? 'G', timeSig: [...getProperty(first, PID.TIME_SIG)], keySig: getProperty(first, PID.KEY_SIG) };
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (instrument === 'piano') p.kind = 'piano';
  else if (type === 'percussion') p.kind = 'drums';
  else if (type === 'tab') {
    const tuning = (getProperty(staff, PID.TUNING) ?? []).join(' ');
    if (Object.values(BASS_INSTRUMENTS).includes(instrument)) {
      p.kind = 'bass'; p.strings = tuning.split(' ').length === 5 ? 5 : 4;
    } else { p.kind = 'guitar'; p.sound = Object.entries(GUITAR_SOUNDS).find(([, id]) => id === instrument)?.[0] ?? 'electric'; }
    p.tuning = Object.entries(tuningsOf(p)).find(([, names]) => names.join(' ') === tuning)?.[0] ?? 'standard';
    p.capo = (getProperty(staff, PID.CAPOS) ?? [])[0]?.fret ?? 0;
  } else {
    p.kind = 'score';
    p.instrument = Object.entries(INSTRUMENTS).find(([, v]) => v.id && v.id === instrument)?.[0] ?? 'none';
    p.concert = Boolean(doc.getStyle(mv, SID.CONCERT_PITCH));
  }
  return normalizePrefs(p);
}

/** True once something is written (notes or chord symbols): the teacher is asked before the staff is replaced by another choice. Turning the grid on or off is not writing. */
export function hasContent(doc) {
  return movementOf(doc).tracks.some((t) => t.staves.some((st) => st.voices.some((v) => v.measures.some((m) => m.items.some((i) => i.type === 'chord' || i.type === 'chordsymbol')))));
}
