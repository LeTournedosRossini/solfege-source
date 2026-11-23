// Writing what a rhythm staff plays (guitar strum / piano comping) as REAL notes in a track, for the chosen measures. The notes come from the same planners as
// the playback (`audio/rhythmplay.js`), run on a clock in "whole note" units so every position stays an exact fraction. A snapshot: the written notes are
// ordinary notes, they do not follow the rhythm staff afterwards. Call `bakeRhythmStaff` inside `doc.transaction`.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { tempoTimeline } from './tempomap.js';
import { fSub, fToNumber, fAdd, fCmp } from './fraction.js';
import { measureLengthOf, measureOffsetOf } from './timing.js';
import { defaultSpelling } from './pitch.js';
import { createNote, createTabNote, createPercNote, createChord, createArticulation } from './elements.js';
import { addTrackFromInstrument } from './trackedit.js';
import { addLinkedStaff } from './linkedstaff.js';
import { placeChord } from './noteedit.js';
import { beatsOf, beatGrid, fitBeatCells, planVoiceMeasure, applyVoiceMeasurePlan } from './gridedit.js';
import { planRhythmStaff, planPlayerTrack } from '../audio/rhythmplay.js';
import { planDrumTrack } from '../audio/drumplay.js';
import { resolveGroove } from './grooves.js';
import { staffSoundMap } from './percmap.js';
import { playerOf, playerKindOf } from './player.js';
import { resolveChordPattern } from './chordpatterns.js';
import { localPlay } from './play.js';
import { expandChordSymbols, chordSymbolPitches } from '../audio/chordsymbols.js';
import { workChordQualities } from './chordqualityedit.js';
import { INSTRUMENT_PRESETS } from './fretvoicing.js';

export class BakeError extends Error { constructor(code, message) { super(message); this.name = 'BakeError'; this.code = code; } }

/** Catalogue instrument made for each kind of rhythm-staff instrument. */
export const BAKE_INSTRUMENTS = Object.freeze({
  piano: 'piano', guitar: 'guitar-steel-tablature', ukulele: 'ukulele-4-str-tab', bass: 'electric-bass-4-str-tab', bass5: '5-string-electric-bass-tab', drums: 'drum-kit-5',
});
const KEPT_SIGNS = new Set(['accent', 'marcato', 'staccato', 'staccatissimo', 'tenuto', 'accentStaccato']);

/** Tracks a result can be written into: all their target staves hold only rests (piano: two notation staves; strings: a tablature). */
export function emptyBakeTargets(mv, kind) {
  return mv.tracks.filter((t) => {
    if (kind === 'drums') { const p = t.staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'percussion'); return !!p && isRestOnly(p); }
    if (kind === 'piano') { const s = t.staves.filter((st) => getProperty(st, PID.STAFF_TYPE) === 'score' && !getProperty(st, PID.LINKED_TO)); return s.length >= 2 && s.slice(0, 2).every(isRestOnly); }
    const tab = t.staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'tab' && !getProperty(st, PID.LINKED_TO));
    return !!tab && isRestOnly(tab);
  });
}

/** Clock in whole-note units: a position of F (a fraction of a whole note) is the number F, so planner times map back exactly to the document. */
export function wholeNoteClock(mv, layout) {
  const slots = layout.starts.map((start, i) => ({ measure: i, t: fToNumber(start), end: fToNumber(fAdd(start, measureLengthOf(mv.masterbars[i]))), k: i }));
  return { slots, tl: { secondsAt: fToNumber, secondsEndAt: fToNumber, tempoAt: () => 1 } };
}

const isRestOnly = (staff) => staff.voices.every((v) => v.measures.every((m) => (m?.items ?? []).every((it) => it.type === 'rest')));

/**
 * Plans what the rhythm staff plays over the measures [from, to] (indices).
 * @returns {{ kind, instrument, events: [{ id, measure, position, duration, articulations, notes }] }} `notes` = planner notes of the hit
 */
export function planBake(doc, mv, staff, { from, to }, user = { cards: [], patterns: [] }) {
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to < mv.masterbars.length)) throw new BakeError('range', 'Select measures of the movement first');
  const layout = tempoTimeline(mv).layout;
  // a staff of a track that has a player (other than a rhythm staff, which plays its own written rhythm) shows what the player plays
  if (getProperty(staff, PID.STAFF_TYPE) !== 'rhythm') {
    const viaPlayer = planPlayerBake(doc, mv, staff, { from, to, layout, user });
    if (viaPlayer) return viaPlayer;
  }
  if (getProperty(staff, PID.STAFF_TYPE) === 'chord') return planChordStaff(doc, mv, staff, { from, to, layout, user });
  const { slots, tl } = wholeNoteClock(mv, layout);
  const only = new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i));
  const work = doc.work;
  const plan = planRhythmStaff({
    staff, mv, layout, tl, slots, onlyMeasures: only, chordQualities: workChordQualities(work), preferred: getProperty(work, PID.PREFERRED_VOICINGS),
    cards: { project: getProperty(work, PID.STRUM_CARDS) ?? [], user: user.cards ?? [] },
  });
  if (!plan) throw new BakeError('noChords', 'The movement has no chord staff to play');
  const rangeEnd = fAdd(layout.starts[to], layout.lengths[to]);
  const items = plan.items.filter((it) => it.voiceIndex === 0);
  const byEvent = new Map();
  for (const n of plan.notes) { if (!byEvent.has(n.event)) byEvent.set(n.event, []); byEvent.get(n.event).push(n); }
  const events = [];
  items.forEach((it, k) => {
    if (it.kind !== 'chord' || !byEvent.has(it.id)) return;
    const end = items[k + 1] ? items[k + 1].abs : rangeEnd;
    events.push({
      id: it.id, measure: it.slot.measure, position: fSub(it.abs, layout.starts[it.slot.measure]), duration: fSub(end, it.abs),
      articulations: it.articulations, muted: it.muted, notes: byEvent.get(it.id),
    });
  });
  return { kind: plan.kind, instrument: plan.instrument, events };
}

/**
 * What the PLAYER of the track of `staff` plays over the measures [from, to] (the same as its playback, `sequence.js`), or null when the track has no player or its pattern is unknown.
 * Same shape as the plan of a rhythm staff.
 */
function planPlayerBake(doc, mv, staff, { from, to, layout, user }) {
  const track = mv.tracks.find((t) => t.staves.includes(staff));
  const player = track ? playerOf(track) : null;
  if (!player) return null;
  const work = doc.work;
  const { slots, tl } = wholeNoteClock(mv, layout);
  const only = new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i));
  const cards = { project: getProperty(work, PID.STRUM_CARDS) ?? [], user: user.cards ?? [] };
  let plan;
  if (playerKindOf(track) === 'drums') {
    const groove = resolveGroove(player.pattern, { project: getProperty(work, PID.GROOVES) ?? [], user: user.grooves ?? [] });
    if (!groove) return null;
    const percStaff = track.staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'percussion') ?? staff;
    plan = planDrumTrack({ track, mv, layout, tl, slots, onlyMeasures: only, groove, percmap: staffSoundMap(getProperty(percStaff, PID.PERCMAP)), cards });
  } else {
    const pattern = resolveChordPattern(player.pattern, { project: getProperty(work, PID.CHORD_PATTERNS) ?? [], user: user.patterns ?? [] });
    if (!pattern) return null;
    plan = planPlayerTrack({ track, mv, layout, tl, slots, onlyMeasures: only, chordQualities: workChordQualities(work), pattern, preferred: getProperty(work, PID.PREFERRED_VOICINGS), cards });
  }
  const byEvent = new Map();
  for (const n of plan?.notes ?? []) { if (!byEvent.has(n.event)) byEvent.set(n.event, []); byEvent.get(n.event).push(n); }
  const events = (plan?.items ?? []).filter((it) => byEvent.has(it.id)).map((it) => ({
    id: it.id, measure: it.slot.measure, position: fSub(it.abs, layout.starts[it.slot.measure]), duration: it.durFrac, articulations: it.articulations, muted: false, notes: byEvent.get(it.id),
  }));
  return { kind: plan?.kind ?? 'piano', instrument: plan?.instrument ?? 'piano', events };
}

/**
 * What a CHORD staff plays (the same as its playback, `sequence.js`) when its track has no player: every symbol gives its
 * realized chord until the next symbol (or the end of the selection); a symbol muted by hand is skipped. The bass goes to the left hand, the other notes to the right hand.
 * Same shape as the plan of a rhythm staff.
 */
function planChordStaff(doc, mv, staff, { from, to, layout, user }) {
  const work = doc.work; const dictionary = workChordQualities(work); const capo = getProperty(staff, PID.CAPO) ?? 0;
  const rangeEnd = fAdd(layout.starts[to], layout.lengths[to]);
  const events = [];
  for (const voice of staff.voices.slice(0, 1)) {
    const stream = expandChordSymbols(voice, mv, layout);
    stream.forEach((entry, k) => {
      if (entry.kind !== 'chord' || (localPlay(entry.owner) ?? localPlay(entry.item)) === false) return;
      const measure = layout.starts.findLastIndex((st) => fCmp(st, entry.abs) <= 0);
      if (measure < from || measure > to) return;
      const next = stream[k + 1]; const end = next && fCmp(next.abs, rangeEnd) < 0 ? next.abs : rangeEnd;
      const pitches = chordSymbolPitches(entry.item, dictionary, { capo });
      if (!pitches.length) return;
      events.push({
        id: entry.item.id, measure, position: fSub(entry.abs, layout.starts[measure]), duration: fSub(end, entry.abs), articulations: [], muted: false,
        notes: pitches.map((pitch, i) => ({ pitch, hand: i === 0 ? 'left' : 'right' })),
      });
    });
  }
  return { kind: 'piano', instrument: 'piano', events };
}

const spell = (doc, mv, measure, pitch) => { const { step, alter, octave } = defaultSpelling(pitch, getProperty(mv.masterbars[measure], PID.KEY_SIG) ?? 0); return { step, alter, octave }; };

function articulationsOf(ev, direction) {
  const list = ev.articulations.filter((a) => KEPT_SIGNS.has(a)).map((a) => createArticulation(a));
  if (direction && !ev.articulations.includes('pickDown') && !ev.articulations.includes('pickUp')) list.push(createArticulation(direction === 'up' ? 'pickUp' : 'pickDown'));
  else for (const a of ev.articulations) if (a === 'pickDown' || a === 'pickUp') list.push(createArticulation(a));
  return list;
}

/**
 * Writes the hits of ONE staff, measure by measure. A measure whose hits all sit on a binary grid is written as before (each hit lasts as long as the planner says, tied across beats and barlines). A measure with
 * a beat that holds a TRIPLET (or any n-tuplet) is written on the grid of its beats (model/gridedit.js, the rule of the grid entry): the beat becomes a real tuplet — three eighth notes in the place of two —, and
 * each hit lasts until the next hit or the end of its beat. `entries` = [{ ev, makeNotes, props }] in time order.
 */
function writeHits(doc, mv, staff, entries) {
  const byMeasure = new Map();
  for (const e of entries) { if (!byMeasure.has(e.ev.measure)) byMeasure.set(e.ev.measure, []); byMeasure.get(e.ev.measure).push(e); }
  for (const [mi, list] of [...byMeasure].sort((a, b) => a[0] - b[0])) {
    const grid = tupletGridOf(mv, mi, list.map((e) => e.ev.position));
    if (!grid) { for (const e of list) writeHit(doc, staff, e.ev, e.makeNotes, e.props); continue; }
    const cellOf = new Map(); // "beat:cell" → entry
    const beats = grid.beats.map((beat, b) => ({ start: beat.start, end: beat.end, cells: beat.cells, hits: [] }));
    for (const e of list) {
      const b = grid.beats.findIndex((x) => fCmp(x.start, e.ev.position) <= 0 && fCmp(e.ev.position, x.end) < 0);
      const cell = grid.cellIn(b, e.ev.position);
      const key = `${b}:${cell}`;
      if (!cellOf.has(key)) { cellOf.set(key, e); beats[b].hits.push(cell); }
    }
    const plan = planVoiceMeasure({ beats, rhythm: grid.rhythm });
    const first = new Set();
    applyVoiceMeasurePlan(doc, {
      staff, voice: 0, measure: mi, plan,
      makeChord: (d, hit) => {
        const e = cellOf.get(`${hit.beat}:${hit.cell}`);
        const key = `${hit.beat}:${hit.cell}`;
        const chord = createChord({ duration: d.base, dots: d.dots ?? 0, notes: e.makeNotes(), props: first.has(key) ? {} : e.props() });
        first.add(key);
        return chord;
      },
    });
  }
}

/**
 * The grid of the beats of measure `mi` when one of them needs a tuplet to hold the starts `positions`: `{ beats: [{ start, end, cells }], cellIn(beat, position), rhythm }`, or null when every beat
 * is binary (or a start fits no grid: the ordinary writer then does what it can).
 */
function tupletGridOf(mv, mi, positions) {
  const mb = mv.masterbars[mi];
  const length = measureLengthOf(mb);
  const rhythm = { timeSig: getProperty(mb, PID.TIME_SIG), length, offset: measureOffsetOf(mb, mi === 0) };
  const beats = beatsOf(rhythm.timeSig, length, rhythm.offset).map((beat) => {
    const cells = fitBeatCells(beat, positions);
    return { ...beat, cells: cells ?? 0 };
  });
  if (beats.some((b) => b.cells === 0)) {
    // a beat with no start (or none that fits) takes the usual binary grid; a start that fits no grid sends the whole measure to the ordinary writer
    for (const b of beats) {
      const inside = positions.filter((p) => fCmp(b.start, p) <= 0 && fCmp(p, b.end) < 0);
      if (inside.length) return null;
      b.cells = 1;
    }
  }
  if (!beats.some((b) => beatGrid(fSub(b.end, b.start), b.cells).tuplet)) return null;
  return {
    beats, rhythm,
    cellIn: (b, position) => { const beat = beats[b]; const g = beatGrid(fSub(beat.end, beat.start), beat.cells); const r = fDivSafe(fSub(position, beat.start), g.cell); return r; },
  };
}
const fDivSafe = (a, b) => { const n = a[0] * b[1]; const d = a[1] * b[0]; return n / d; };

function writeHit(doc, staff, ev, makeNotes, props) {
  let first = true;
  placeChord(doc, {
    staff, measure: ev.measure, position: ev.position, duration: { base: 'quarter', dots: 0 }, total: ev.duration,
    makeChord: (d) => {
      const chord = createChord({ duration: d.base, dots: d.dots ?? 0, notes: makeNotes(), props: first ? props() : {} });
      first = false;
      return chord;
    },
  });
}

/**
 * Writes the plan into a track.
 * @param o { measures: { from, to }, target: { kind: 'new' } | { kind: 'track', trackId }, lang, deactivate }
 * @returns {{ trackId, staffIds: string[], hits: number }}
 */
export function bakeRhythmStaff(doc, mv, staff, { measures, target = { kind: 'new' }, lang = 'en', deactivate = false, user } = {}) {
  const plan = planBake(doc, mv, staff, measures, user);
  if (!plan.events.length) throw new BakeError('empty', 'The rhythm staff plays nothing over these measures');
  let track;
  if (target.kind === 'track') {
    track = mv.tracks.find((t) => t.id === target.trackId);
    if (!track) throw new BakeError('track', 'Unknown track');
  } else {
    track = addTrackFromInstrument(doc, mv, BAKE_INSTRUMENTS[plan.instrument] ?? BAKE_INSTRUMENTS.guitar, { lang });
  }
  const staffIds = [];
  if (plan.kind === 'drums') {
    const perc = track.staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'percussion');
    if (!perc) throw new BakeError('track', 'A drum track needs a percussion staff');
    if (target.kind === 'track' && !isRestOnly(perc)) throw new BakeError('notEmpty', 'The track already has notes');
    staffIds.push(perc.id);
    writeHits(doc, mv, perc, plan.events.map((ev) => {
      const sounds = [...new Set(ev.notes.map((n) => n.sound))];
      return { ev, makeNotes: () => sounds.map((sound) => createPercNote({ sound })), props: () => ({}) };
    }));
  } else if (plan.kind === 'piano') {
    const scores = track.staves.filter((st) => getProperty(st, PID.STAFF_TYPE) === 'score' && !getProperty(st, PID.LINKED_TO));
    if (scores.length < 2) throw new BakeError('track', 'A piano track needs two notation staves (treble and bass)');
    if (target.kind === 'track' && !scores.slice(0, 2).every(isRestOnly)) throw new BakeError('notEmpty', 'The track already has notes');
    const [rh, lh] = scores;
    staffIds.push(rh.id, lh.id);
    for (const [st, hand] of [[rh, 'right'], [lh, 'left']]) {
      writeHits(doc, mv, st, plan.events.flatMap((ev) => {
        const pitches = [...new Set(ev.notes.filter((n) => n.hand === hand).map((n) => n.pitch))].sort((a, b) => a - b);
        if (!pitches.length) return [];
        // the signs of the rhythm chord (accent, staccato…) go on the right hand chord
        return [{ ev, makeNotes: () => pitches.map((p) => createNote(spell(doc, mv, ev.measure, p))), props: () => { const arts = hand === 'right' ? articulationsOf(ev, null) : []; return arts.length ? { [PID.ARTICULATIONS]: arts } : {}; } }];
      }));
    }
  } else {
    let tab = track.staves.find((st) => getProperty(st, PID.STAFF_TYPE) === 'tab' && !getProperty(st, PID.LINKED_TO));
    if (!tab) throw new BakeError('track', 'A guitar track needs a tablature staff');
    if (target.kind === 'track' && !isRestOnly(tab)) throw new BakeError('notEmpty', 'The track already has notes');
    if (target.kind === 'new' && !track.staves.some((st) => getProperty(st, PID.LINKED_TO) === tab.id)) addLinkedStaff(doc, mv, tab, { type: 'score', clef: 'G', before: true });
    staffIds.push(tab.id);
    const stringCount = (getProperty(tab, PID.TUNING) ?? INSTRUMENT_PRESETS[plan.instrument]?.tuning ?? []).length || 6;
    writeHits(doc, mv, tab, plan.events.flatMap((ev) => {
      // a note played as on a keyboard (no string: the pattern asked for something out of reach of the hand) cannot be written in a tablature
      const notes = ev.notes.filter((n) => n.string !== null && n.string !== undefined).sort((a, b) => a.pitch - b.pitch);
      if (!notes.length) return [];
      const direction = notes[0]?.direction ?? 'down';
      const props = () => {
        const out = notes.length > 1 ? { [PID.ARPEGGIO]: { type: direction === 'up' ? 'up' : 'down' } } : {};
        const arts = articulationsOf(ev, direction);
        if (arts.length) out[PID.ARTICULATIONS] = arts;
        return out;
      };
      return [{ ev, makeNotes: () => notes.map((n) => createTabNote({ pitch: n.pitch, string: stringCount - n.string, props: ev.muted ? { [PID.MUTED]: true } : {} })), props }];
    }));
  }
  if (deactivate) {
    // a strumming rhythm staff is switched off; the staff of a track with a player switches the PLAYER off (the notes written now replace it)
    const owner = mv.tracks.find((t) => t.staves.includes(staff));
    if (getProperty(staff, PID.STAFF_TYPE) === 'rhythm') doc.set(staff, PID.STRUM, false);
    else if (owner && playerOf(owner)) doc.set(owner, PID.PLAYER_ACTIVE, false);
  }
  return { trackId: track.id, staffIds, hits: plan.events.length };
}
