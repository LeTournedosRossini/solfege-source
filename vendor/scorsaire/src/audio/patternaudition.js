// Hearing a chord pattern (model/chordpatterns.js) on a reference chord: a small throw-away work — one chord staff holding the chord in every measure, a piano track — played
// through the SAME planner as the real playback, so what the editor lets you hear is what the staff will play. PURE (the page gives the sequence to the engine).
import { PID } from '../model/pid.js';
import { createWork, createMovement, createMasterbar, createTrack, createStaff, createVoice, createMeasure, createChordSymbol, createDocument, createEmptyMeasure } from '../model/index.js';
import { patternBarLength } from '../model/chordpatterns.js';
import { planBake } from '../model/bakeplay.js';
import { resolveDiagram } from '../model/fretdiagram.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { resolveStrumCard, createStrumCard } from '../model/strumcards.js';
import { fretChordResolver } from './rhythmplay.js';
import { buildSequence } from './sequence.js';
import { applyStyle } from '../model/styleedit.js';
import { staffSpecsOfInstrument } from '../model/trackedit.js';
import { instrumentInfo } from '../model/instruments.js';
import { setPlayer } from '../model/player.js';

/** Sound of the track that plays a pattern, by fingering instrument (the piano is the default of a chord pattern). */
const SOUNDS = Object.freeze({ piano: 'piano', guitar: 'guitar-steel', ukulele: 'ukulele', bass: 'bass-guitar', bass5: 'bass-guitar' });


/**
 * @param o { pattern (checked), root { step, alter }, quality (id of the chord-quality dictionary), cardId (card of the staff, null = the default piano card), cards (the user's cards),
 *   instrument ('piano' by default; a fretted instrument needs a strumming card), cycles (times the pattern is played) }
 * @returns the sequence of `buildSequence` ({ tracks, notes, … }); `engine.audition(...)` takes its tracks and notes
 */
export function patternAuditionSequence(o) {
  const { work } = auditionWork(o);
  return buildSequence(work, { speed: 1, chordSymbols: { play: true }, chordPatterns: [o.pattern], strumCards: o.cards ?? [] });
}

/**
 * What the pattern plays on the reference chord, by hit, with the string and fret of each note of a fretted instrument (the same planner as the playback).
 * @returns {{ events: { id, measure, position, duration, notes: { pitch, string, fret, source, hand? }[] }[], voicing: object | null }}  `voicing` = the fingering of the chord (fretted instruments).
 */
export function patternAuditionPlan(o) {
  const { work, movement, staff, instrument } = auditionWork(o);
  const doc = createDocument(work);
  const count = movement.masterbars.length;
  const plan = planBake(doc, movement, staff, { from: 0, to: count - 1 }, { cards: o.cards ?? [], patterns: [o.pattern] });
  const symbol = staff.voices[0].measures[0].items[0];
  let voicing = null;
  if (instrument !== 'piano') {
    // the fingering the planner chooses for this chord: the same bass rules (the pattern's degree, else the card's)
    const dict = workChordQualities(work);
    const { card } = resolveStrumCard(o.cardId ?? null, { user: o.cards ?? [], kind: 'strum' });
    const chordOf = fretChordResolver({ instrument, chordQualities: dict, slashBass: card.slashBass, bassDegree: o.pattern.bassDegree ?? card.bassDegree });
    voicing = resolveDiagram({ chord: chordOf(symbol), instrument, dict })?.voicing ?? null;
  }
  return { events: plan.events, voicing, instrument: plan.instrument };
}

/** The throw-away work of a pattern on a reference chord (see `patternAuditionSequence`): for hearing it and for showing it as notes. */
export const patternAuditionWork = (o) => auditionWork(o);

function auditionWork({ pattern, root = { step: 'C', alter: 0 }, quality = '', cardId = null, cards = [], instrument = 'piano', cycles = 2 }) {
  const bars = pattern.bars ?? 1;
  const metric = patternBarLength(pattern);
  const timeSig = metric[1] < 4 ? [metric[0] * (4 / metric[1]), 4] : [metric[0], metric[1]];
  const count = bars * Math.max(1, cycles);
  const staff = createStaff({
    type: 'chord', voices: [createVoice(Array.from({ length: count }, () => createMeasure([createChordSymbol({ root, quality, position: [0, 1], duration: 'whole' })])))],
  });
  // the player lives on the track: the pattern, the card, the instrument of the fingering and the sound
  const props = { [PID.INSTRUMENT_ID]: SOUNDS[instrument] ?? 'piano', [PID.PLAYER_PATTERN]: pattern.id, ...(cardId ? { [PID.PLAYER_CARD]: cardId } : {}), ...(instrument !== 'piano' ? { [PID.PLAYER_INSTRUMENT]: instrument } : {}) };
  const movement = createMovement({ masterbars: Array.from({ length: count }, () => createMasterbar({ timeSig })), tracks: [createTrack({ staves: [staff], props })] });
  const work = createWork({ movements: [movement] });
  return { work, movement, staff, instrument };
}

/**
 * Hearing a groove (model/grooves.js): a small throw-away work — a drum track whose player plays the groove for `bars` measures — through the SAME planner as the real playback.
 * `variations` false = the groove alone; true = with its breaks, extra hits and crash (the chances at their strongest at the end of the phrase, drawn with the seed `seed`).
 * @returns the sequence of `buildSequence`; `engine.audition(...)` takes its tracks and notes
 */
export function grooveAuditionSequence({ groove, variations = false, bars = 4, seed = 1 }) {
  // with its variations the groove plays each of its versions for 2 bars in turn, alone only the main one
  const { work, card } = grooveAuditionWork({ groove, variations, bars, seed });
  return buildSequence(work, { speed: 1, grooves: [{ ...groove, id: groove.id || 'audition' }], strumCards: [card], drumVersionPhrase: variations ? 2 : 1e9 });
}

/** The throw-away work of a groove (a drum track whose player plays it) and the card it is played with: for hearing it and for showing it as notes. */
export function grooveAuditionWork({ groove, variations = false, bars = 4, seed = 1 }) {
  const metric = groove.length;
  const timeSig = metric[1] < 4 ? [metric[0] * (4 / metric[1]), 4] : [metric[0], metric[1]];
  const count = Math.max(1, bars) * (groove.bars ?? 1);
  const masterbars = Array.from({ length: count }, () => createMasterbar({ timeSig }));
  // the staff has the percussion map of the kit, like the staff of a real drum track (what is written from it refers to those sounds)
  const kit = staffSpecsOfInstrument('drum-kit-5', instrumentInfo('drum-kit-5'))[0];
  const staff = createStaff({ type: 'percussion', props: kit.props, voices: [createVoice(masterbars.map(() => createEmptyMeasure('percussion')))] });
  const props = { [PID.INSTRUMENT_ID]: 'drum-kit-5', [PID.PLAYER_PATTERN]: groove.id || 'audition', [PID.PLAYER_CARD]: 'audition', [PID.PLAYER_SEED]: seed };
  const movement = createMovement({ masterbars, tracks: [createTrack({ staves: [staff], props })] });
  const card = createStrumCard({ id: 'audition', kind: 'drums', variation: variations ? 1 : 0, structureBoost: 3, sectionCrash: 0 });
  return { work: createWork({ movements: [movement] }), movement, staff, card };
}

const C = { step: 'C', alter: 0 }; const A = { step: 'A', alter: 0 }; const F = { step: 'F', alter: 0 }; const G = { step: 'G', alter: 0 };
/** The progressions a style can be heard on, one chord per bar (a small choice can grow here). */
export const AUDITION_PROGRESSIONS = Object.freeze({
  pop: Object.freeze([{ root: C, quality: '' }, { root: A, quality: 'm' }, { root: F, quality: '' }, { root: G, quality: '' }]), // I – vi – IV – V in C
});

/**
 * Hearing a STYLE (model/styles.js): a small throw-away work — a chord track holding a progression, `bars` bars — to which the style is APPLIED exactly as it is to a real movement
 * (`applyStyle`: tracks made, players set, swing at the start), then played through the SAME planner as the real playback.
 * `skip` = indices of the players left out (to hear the style without them). `seed` draws the variations; `user` = the device lists { patterns, grooves, cards } for what the style uses.
 * @returns the sequence of `buildSequence`; `engine.audition(...)` takes its tracks and notes
 */
export function styleAuditionSequence({ style, user = {}, skip = [], seed = 1, bars = 8, progression = 'pop', lang = 'en' }) {
  const chords = AUDITION_PROGRESSIONS[progression] ?? AUDITION_PROGRESSIONS.pop;
  const masterbars = Array.from({ length: bars }, () => createMasterbar({ timeSig: [4, 4] }));
  const chordStaff = createStaff({
    type: 'chord', voices: [createVoice(masterbars.map((_, i) => createMeasure([createChordSymbol({ ...chords[i % chords.length], position: [0, 1], duration: 'whole' })])))],
  });
  const movement = createMovement({ masterbars, tracks: [createTrack({ staves: [chordStaff] })] });
  const doc = createDocument(createWork({ movements: [movement] }));
  const heard = { ...style, players: style.players.filter((_, i) => !skip.includes(i)) };
  if (!heard.players.length) return buildSequence(doc.work, { speed: 1 });
  doc.transaction('Audition: style', () => {
    const { players } = applyStyle(doc, movement, heard, { lang, user });
    players.forEach((p, i) => setPlayer(doc, doc.find(p.trackId), { seed: seed + i }));
  });
  return buildSequence(doc.work, { speed: 1, grooves: user.grooves ?? [], chordPatterns: user.patterns ?? [], strumCards: user.cards ?? [] });
}
