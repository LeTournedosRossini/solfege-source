// What a rhythm staff plays (guitar strum or piano comping): the rhythm of its chords + the chord in force on the movement's FIRST chord staff, planned by
// `strum.js` / `comping.js`. Shared by the playback (`sequence.js`) and by the writing of the result into real notes (`model/bakeplay.js`): both give it the
// same inputs, only the clock differs (`tl`, `slots`: seconds for the playback, "whole note" units for the writing).
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { itemDuration, measureLengthOf } from '../model/timing.js';
import { fAdd, ZERO } from '../model/fraction.js';
import { expandChordSymbols, playedChordSymbols, chordSymbolPitches } from './chordsymbols.js';
import { resolveDiagram, diagramChordOf, tuningOfInstrument, pathChordsOf, strumInstrumentOf } from '../model/fretdiagram.js';
import { chooseFretPath, DEFAULT_PATH_MODE } from '../model/fretpath.js';
import { chordSpecFromSymbol, suggestVoicings } from '../model/fretsuggest.js';
import { defaultSpelling } from '../model/pitch.js';
import { planStrum } from './strum.js';
import { planComping, degreeSemis } from './comping.js';
import { resolveStrumCard, strumOptionsFor } from '../model/strumcards.js';
import { planPick } from './riffplay.js';
import { playerInstrumentOf } from '../model/player.js';
import { structureOfSlots, ruleFor } from '../model/variation.js';
import { patternHitsForMeasure, parsePart, patternVoices } from '../model/chordpatterns.js';
import { altPhrases } from './altplay.js';

/** The first chord staff of a movement (the source of the chords), or null. */
export const chordSourceOf = (mv) => mv.tracks.flatMap((tr) => tr.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'chord') ?? null;

/**
 * The chords of a chord voice as the playback hears them (`duration: 'untilNext'`): `played` (dated entries), `indexAt(t)`, `untilOf(i)` (end of the run of the same chord) and, for the piano,
 * `compAt(t)` = the chord in force as a spec { rootPc, intervals, bassPc } with the start / end of its span and the NEXT different chord (for approach chords).
 */
export function chordContext(voice0, { mv, layout, tl, slots, chordQualities }) {
  const played = playedChordSymbols(expandChordSymbols(voice0, mv, layout), { slots, layout, tl, mv, duration: 'untilNext' });
  // the same chord written again (next bar) is not a change: a stroke tied across the bar line keeps ringing
  const same = (e) => JSON.stringify([getProperty(e.item, PID.CHORD_ROOT), getProperty(e.item, PID.CHORD_QUALITY), getProperty(e.item, PID.CHORD_BASS), getProperty(e.item, PID.VOICING)]);
  const indexAt = (t) => played.findIndex((e) => t >= e.start - 1e-6 && t < e.start + e.nominal - 1e-6);
  const untilOf = (ci) => {
    let until = played[ci].start + played[ci].nominal;
    for (let j = ci + 1; j < played.length && same(played[j]) === same(played[ci]) && Math.abs(played[j].start - until) < 1e-6; j++) until = played[j].start + played[j].nominal;
    return until;
  };
  // piano: the chord in force as a spec { rootPc, intervals, bassPc }, with the start / end of its span and the NEXT different chord (for approach chords)
  const compAt = (t) => {
    const ci = indexAt(t);
    if (ci < 0) return null;
    const spec = chordSpecFromSymbol(diagramChordOf(played[ci].item), chordQualities);
    if (!spec) return null;
    const until = untilOf(ci);
    const nextEntry = played.find((e) => Math.abs(e.start - until) < 1e-6);
    return { spec, until, start: played[ci].start, next: nextEntry ? chordSpecFromSymbol(diagramChordOf(nextEntry.item), chordQualities) : null };
  };
  return { played, indexAt, untilOf, compAt };
}

/**
 * The chord symbol with the named degree in its bass ("3" of C = E: C/E), or null when the chord has no such tone. `dict` = the chord-quality dictionary.
 */
function withBassDegree(chord, degree, dict) {
  const spec = chordSpecFromSymbol(chord, dict);
  const part = parsePart(degree);
  const semis = spec && part?.kind === 'degree' ? degreeSemis(part, spec, { absentDegree: 'skip' }) : null;
  if (semis === null) return null;
  const { step, alter } = defaultSpelling(60 + spec.rootPc + semis, chord.root.alter < 0 ? -1 : 0);
  return { ...chord, bass: { step, alter } };
}

/**
 * The fingering in force at a time, for a fretted instrument: `chordAt(t)` → { voicing, until } | { pitches, until } | null.
 * The fingerings of the whole progression are chosen together so that the hand moves as little as it can (a fingering written by the user, or preferred, stays as it is).
 * The bass of a fingering, in order of priority: the fingering drawn by the user; the bass written in the grid (C/E) unless the card says `slashBass: 'root'`;
 * `bassDegree` (the pattern's, else the card's: "3" = a shape with the third in the bass), ignored for a chord that has no such shape; the plain chord.
 */
export function fretChordResolver({ instrument, chordQualities, slashBass = 'follow', bassDegree = null }) {
  const shapes = new Map(); // does the chord have a fingering with this bass? (by chord, asked once)
  const hasShape = (chord) => {
    const key = JSON.stringify(chord);
    if (!shapes.has(key)) { const spec = chordSpecFromSymbol(chord, chordQualities); shapes.set(key, !!spec && suggestVoicings(spec, { instrument, limit: 1 }).length > 0); }
    return shapes.get(key);
  };
  /** The chord a fingering is looked for, from a chord symbol item or a chord object (null when it has none). */
  return (sym) => {
    let chord = sym && sym.type ? diagramChordOf(sym) : sym;
    if (!chord) return null;
    if (slashBass === 'root' && chord.bass) chord = { ...chord, bass: null };
    if (!chord.bass && bassDegree) { const forced = withBassDegree(chord, bassDegree, chordQualities); if (forced && hasShape(forced)) chord = forced; }
    return chord;
  };
}

function fretChordAt({ played, indexAt, untilOf, instrument, pathMode, preferred, chordQualities, voicing, slashBass = 'follow', bassDegree = null }) {
  const chordOf = fretChordResolver({ instrument, chordQualities, slashBass, bassDegree });
  let path = null;
  if (tuningOfInstrument(instrument) !== null && pathMode !== 'off' && instrument !== 'piano') {
    const chords = pathChordsOf(played.map((c) => c.item), { instrument, preferred, dict: chordQualities, chordOf });
    path = chooseFretPath(chords, { mode: pathMode });
  }
  return (t) => {
    const ci = indexAt(t);
    if (ci < 0) return null;
    const c = played[ci];
    const symbol = c.owner ?? c.item;
    const until = untilOf(ci);
    const shown = path?.[ci] ? { voicing: path[ci] } : tuningOfInstrument(instrument) !== null
      ? resolveDiagram({ voicing: getProperty(c.item, PID.DIAGRAM_INSTRUMENT) === instrument ? getProperty(c.item, PID.VOICING) : null, chord: chordOf(c.item), instrument, preferred, dict: chordQualities })
      : null;
    if (shown?.voicing) return { voicing: shown.voicing, until };
    const pitches = chordSymbolPitches(symbol, chordQualities, { voicing });
    return pitches.length ? { pitches, until } : null;
  };
}

/**
 * @param p {
 *   staff, mv, layout, tl           the rhythm staff and the movement clock (`tl.secondsAt`, `secondsEndAt`, `tempoAt`)
 *   slots                           [{ measure, t, end }] played measures in order (all of them: the chords are read from here)
 *   onlyMeasures                    optional Set of measure indices whose rhythm is read (the chords still come from every slot)
 *   chordQualities, voicing, preferred, cards { project, user }
 * }
 * @returns {{ kind: 'piano' | 'strum', instrument, card, items, notes } | null}   `notes` = the planner's notes (each with `event` = id of the rhythm chord)
 */
export function planRhythmStaff({ staff, mv, layout, tl, slots, onlyMeasures = null, chordQualities, voicing = 'auto', preferred = null, cards = { project: [], user: [] } }) {
  const chordSource = chordSourceOf(mv);
  const voice0 = chordSource?.voices[0];
  if (!voice0) return null;
  const instrument = strumInstrumentOf(mv.tracks.find((t) => t.staves.includes(staff)), staff);
  const { played, indexAt, untilOf, compAt } = chordContext(voice0, { mv, layout, tl, slots, chordQualities });
  // The card (project > user > built in) gives the playing values; it is resolved first because the fingerings follow its `slashBass`
  const { card } = resolveStrumCard(getProperty(staff, PID.STRUM_CARD), { project: cards.project ?? [], user: cards.user ?? [], kind: instrument === 'piano' ? 'piano' : 'strum' });
  const chordAt = fretChordAt({ played, indexAt, untilOf, instrument, pathMode: getProperty(staff, PID.STRUM_PATH) ?? DEFAULT_PATH_MODE, preferred, chordQualities, voicing, slashBass: card.slashBass, bassDegree: card.bassDegree });
  // A rhythm chord tied to the previous one is not struck again: the previous stroke keeps ringing through it.
  // On a rhythm staff a slur between two chords reads the same way (guitar charts tie with a slur): its end chord is not struck either.
  const tieEnds = new Set((getProperty(staff, PID.TIES) ?? []).map((t) => t.endNoteId));
  const slurEnds = new Set((getProperty(staff, PID.SLURS) ?? []).map((s) => s.endChordId));
  const items = [];
  staff.voices.forEach((v, voiceIndex) => {
    for (const slot of slots) {
      if (onlyMeasures && !onlyMeasures.has(slot.measure)) continue;
      const measure = v.measures[slot.measure];
      if (!measure) continue;
      const length = measureLengthOf(mv.masterbars[slot.measure]);
      const base = tl.secondsAt(layout.starts[slot.measure]);
      let rel = ZERO;
      for (const item of measure.items) {
        if ((item.type === 'chord' || item.type === 'rest') && !(item.type === 'chord' && (slurEnds.has(item.id) || item.notes?.some((n) => tieEnds.has(n.id))))) {
          const abs = fAdd(layout.starts[slot.measure], rel);
          const lead = item.type === 'chord' ? item.notes?.[0] : null;
          items.push({
            t: slot.t + (tl.secondsAt(abs) - base), kind: item.type, id: item.id, abs, voiceIndex, slot,
            offbeat: (rel[0] * 4) % rel[1] !== 0, bpm: tl.tempoAt(abs) * 240,
            articulations: item.type === 'chord' ? (getProperty(item, PID.ARTICULATIONS) ?? []).map((a) => a.type) : [],
            muted: !!(lead && getProperty(lead, PID.GHOST)),
          });
        }
        rel = fAdd(rel, itemDuration(item, length));
      }
    }
  });
  items.sort((a, b) => a.t - b.t);
  const end = slots.length ? slots[slots.length - 1].end : 0;
  const kind = instrument === 'piano' ? 'piano' : 'strum';
  // the staff's own pattern / delay win over the card
  const options = strumOptionsFor(card, { pattern: getProperty(staff, PID.STRUM_PATTERN), delayMs: getProperty(staff, PID.STRUM_DELAY) });
  const structure = kind === 'piano' ? structureOfSlots(mv, slots) : null;
  const notes = kind === 'piano' ? planComping(items, { chordAt: compAt, end, options, structureOf: (ev) => structure[ev.slot?.k] ?? null }) : planStrum(items, { chordAt, end, options });
  return { kind, instrument, card, items, notes };
}

/**
 * What a TRACK plays by itself when it has a player (`model/player.js`): the rhythm comes from the pattern (`chordpatterns.js`), repeated in every played measure, and the chords from the
 * movement's FIRST chord staff (the table of truth for every track). A keyboard plays it as comping (`comping.js`), a fretted instrument on the fingerings of the chords (`riffplay.js`),
 * both with the card of the track. Same result shape as `planRhythmStaff`, so the playback and the "what this track plays" window share it.
 * Every item carries its exact place (`abs`, `durFrac`) for the writing into notes.
 * @param p { track, mv, layout, tl, slots, onlyMeasures?, chordQualities, pattern (a checked pattern), voicing?, preferred?, cards { project, user } }
 */
export function planPlayerTrack({ track, mv, layout, tl, slots, onlyMeasures = null, chordQualities, pattern, voicing = 'auto', preferred = null, cards = { project: [], user: [] } }) {
  const chordSource = chordSourceOf(mv);
  const voice0 = chordSource?.voices[0];
  if (!voice0 || !pattern) return null;
  const { played, indexAt, untilOf, compAt } = chordContext(voice0, { mv, layout, tl, slots, chordQualities });
  const items = [];
  const voices = patternVoices(pattern);
  // the alternative phrases of the pattern: by a cue on the score, or by the card's options (off unless asked)
  const fretted = playerInstrumentOf(track, cards) !== 'piano';
  const altCard = resolveStrumCard(getProperty(track, PID.PLAYER_CARD), { project: cards.project ?? [], user: cards.user ?? [], kind: fretted ? 'strum' : 'piano' }).card;
  const altOf = altPhrases({ pattern, mv, track, slots, options: strumOptionsFor(altCard), seed: getProperty(track, PID.PLAYER_SEED) ?? 0 });
  slots.forEach((slot, k) => {
    if (onlyMeasures && !onlyMeasures.has(slot.measure)) return;
    const base = tl.secondsAt(layout.starts[slot.measure]);
    patternHitsForMeasure(pattern, measureLengthOf(mv.masterbars[slot.measure]), slot.measure, altOf[k]).forEach((h, j) => {
      const abs = fAdd(layout.starts[slot.measure], h.at);
      const t = slot.t + (tl.secondsAt(abs) - base);
      items.push({
        t, kind: 'chord', id: `${track.id}:p${k}.${j}`, abs, durFrac: h.dur, dur: tl.secondsEndAt(fAdd(abs, h.dur)) - tl.secondsAt(abs), voiceIndex: 0, slot, offbeat: (h.at[0] * 4) % h.at[1] !== 0, bpm: tl.tempoAt(abs) * 240,
        articulations: [...(h.accent ? ['accent'] : []), ...(h.staccato ? ['staccato'] : []), ...(h.stroke === 'up' ? ['pickUp'] : h.stroke === 'down' ? ['pickDown'] : [])], muted: false, parts: h.parts.map(parsePart), voices,
      });
    });
  });
  items.sort((a, b) => a.t - b.t);
  const end = slots.length ? slots[slots.length - 1].end : 0;
  const instrument = playerInstrumentOf(track, cards);
  const cardId = getProperty(track, PID.PLAYER_CARD);
  if (instrument !== 'piano') {
    // a fretted instrument: the fingerings are chosen first (as for a strumming staff), then the notes of the pattern are placed on them
    const { card } = resolveStrumCard(cardId, { project: cards.project ?? [], user: cards.user ?? [], kind: 'strum' });
    const chordAt = fretChordAt({ played, indexAt, untilOf, instrument, pathMode: DEFAULT_PATH_MODE, preferred, chordQualities, voicing, slashBass: card.slashBass, bassDegree: pattern.bassDegree ?? card.bassDegree });
    const notes = planPick(items, { chordAt, compAt, end, options: strumOptionsFor(card) });
    return { kind: 'strum', instrument, card, items, notes };
  }
  const { card } = resolveStrumCard(cardId, { project: cards.project ?? [], user: cards.user ?? [], kind: 'piano' });
  const structure = structureOfSlots(mv, slots);
  const rules = getProperty(track, PID.PLAYER_RULES) ?? [];
  const notes = planComping(items, { chordAt: compAt, end, options: strumOptionsFor(card), seed: getProperty(track, PID.PLAYER_SEED) ?? 0, structureOf: (ev) => structure[ev.slot?.k] ?? null, ruleOf: (kind, ev) => ruleFor(rules, kind, structure[ev.slot?.k]) });
  return { kind: 'piano', instrument: 'piano', card, items, notes };
}
