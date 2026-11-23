/*
 * Guitar Pro import (GP3, GP4, GP5, GPX = GP6, GP = GP7/8). The files are READ by AlphaTab (MPL-2.0, loaded on demand: alphatab-loader.js);
 * this module translates AlphaTab's score model into Scorsaire's model. PURE except for the loader.
 *
 *   importGuitarProBytes(bytes)   → { work, report, errors, meta }   (async: loads AlphaTab on the first call)
 *   importAlphaTabScore(score)    → the same, from a score already read
 *
 * The rhythm side (durations, tuplets, gaps, tied pieces, measure rests, grace notes) reuses the MusicXML importer's line builder
 * (`buildLineMeasure`): each AlphaTab voice of a bar becomes a list of "events" in the same shape. Conventions (AlphaTab, verified on real files):
 * string 1 is the LOWEST string (Scorsaire: the highest), `staff.tuning` lists the strings from the highest, `realValueWithoutHarmonic` is the sounding
 * pitch with tuning, capo and fret, `beat.dynamics` is the dynamic IN FORCE (default F), a tempo value is in quarter notes per minute.
 * What the file holds that Scorsaire has no place for is counted in the report, never dropped silently.
 */
import { loadAlphaTab } from './alphatab-loader.js';
import { createReport } from './report.js';
import { buildLineMeasure, createMasterbars, voltaSpecs, durationOfFraction } from './musicxml-build.js';
import { setProp, listOf, mergeArticulationsOf } from './musicxml-marks.js';
import { frac, fAdd, fMul, fCmp, fEq, ZERO } from '../model/fraction.js';
import { PID } from '../model/pid.js';
import { newId } from '../model/ids.js';
import { withWrites } from '../model/guard.js';
import {
  createNote, createChord, createTabNote, createPercNote, createRhythmNote, createRest, createTie, createSlur, createHopo, createGlissando, createBend,
  createArticulation, createHairpin, createTechLine, createChordLine, createFingering, createBreath, createCapo, createTempo, createFermata, createMarker,
  createJump, createSwing, createSystemContainer, createTrack, createStaff, createVoice, createMeasure, createMovement, createWork, createVolta,
} from '../model/elements.js';
import { createLyricText, createLyricLink } from '../model/lyrics.js';
import { createStaffText } from '../model/stafftextedit.js';
import { createTrillLine } from '../model/trill.js';
import { defaultSpelling } from '../model/pitch.js';
import { beatUnitText } from '../model/tempo.js';
import { percmapPreset, createPercMap, drumSoundForMidi, createDrumSound } from '../model/percmap.js';
import { validateWork } from '../model/validate.js';
import { zipEntries, looksLikeZip } from './mxl.js';
import { parseChord } from './ireal.js';
import { createChordQualities, validateChordQualities } from '../model/chordquality.js';
import { toRhythmicDurationList } from '../model/rhythmsplit.js';
import { fSub } from '../model/fraction.js';
import { createChordSymbol } from '../model/elements.js';
import catalog from '../model/instrument-catalog.json' with { type: 'json' };

export class GuitarProError extends Error {}

const GP_EXTENSIONS = ['.gp3', '.gp4', '.gp5', '.gpx', '.gp'];

/** True when a picked file is a Guitar Pro file: by extension, by the GPX / GP3-5 signature, or a ZIP holding `Content/score.gpif` (GP7/8). */
export function isGuitarProFile(name, bytes) {
  const n = String(name).toLowerCase();
  if (GP_EXTENSIONS.some((e) => n.endsWith(e))) return true;
  if (bytes.length > 4 && bytes[0] === 0x42 && bytes[1] === 0x43 && bytes[2] === 0x46) return true; // BCFZ / BCFS
  if (bytes.length > 30 && String.fromCharCode(...bytes.subarray(1, 20)).startsWith('FICHIER GUITAR PRO')) return true;
  if (looksLikeZip(bytes)) { try { return zipEntries(bytes).some((e) => /(^|\/)score\.gpif$/i.test(e.name)); } catch { return false; } }
  return false;
}

// ---------- constants of AlphaTab's model (numeric values, see the enumerations of its model) ----------

const TYPE_OF_DURATION = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th', 128: '128th', 256: '256th' };
const HARM = { NATURAL: 1 };
const SLIDE_OUT = { SHIFT: 1, LEGATO: 2, OUT_UP: 3, OUT_DOWN: 4, PICK_DOWN: 5, PICK_UP: 6 };
const SLIDE_IN = { FROM_BELOW: 1, FROM_ABOVE: 2 };
const BEND = { PREBEND: 6, PREBEND_BEND: 7, PREBEND_RELEASE: 8 };
const BRUSH = { BRUSH_UP: 1, BRUSH_DOWN: 2, ARPEGGIO_UP: 3, ARPEGGIO_DOWN: 4 };
const ACCENT = { NORMAL: 1, HEAVY: 2, TENUTO: 3 };
const VIBRATO_WIDE = 2;
const GRACE = { ON_BEAT: 1, BEFORE_BEAT: 2, BEND: 3 };
const DYNAMIC_NAMES = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'pppp', 'ppppp', 'pppppp', 'ffff', 'fffff', 'ffffff', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf', 'sfzp'];
const DEFAULT_DYNAMIC = 5; // F
const TRIPLET_FEEL = { 1: 'tripletSixteenth', 2: 'tripletEighth', 3: 'dottedSixteenth', 4: 'dottedEighth', 5: 'scottishSixteenth', 6: 'scottishEighth' };
const FERMATA_TYPE = { 0: 'fermataShort', 1: 'fermata', 2: 'fermataLong' };
const BAR_LINE = { 1: 'dashed', 2: 'dotted', 3: 'heavy', 4: 'heavyHeavy', 5: 'reverseFinal', 6: 'final', 7: 'double' };
const LEFT_FINGER = ['T', '1', '2', '3', '4'];
const RIGHT_FINGER = ['p', 'i', 'm', 'a', 'c'];
// directions of a bar: markers (targets) and jumps
const DIRECTION_MARKER = { 0: 'fine', 1: 'segno', 2: 'varsegno', 3: 'coda', 4: 'varcoda', 17: 'daCoda', 18: 'daDblCoda' };
const DIRECTION_JUMP = { 5: 'dc', 6: 'dcAlCoda', 7: 'dcAlDblCoda', 8: 'dcAlFine', 9: 'ds', 10: 'dsAlCoda', 11: 'dsAlDblCoda', 12: 'dsAlFine', 13: 'dss', 14: 'dssAlCoda', 15: 'dssAlDblCoda', 16: 'dssAlFine' };

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

const voiceEmpty = (v) => v.beats.every((b) => b.isEmpty);

/** Actual duration of a beat as an exact fraction of a whole note (dots and tuplet included). */
function beatFraction(beat) {
  let f = beat.duration < 0 ? frac(-beat.duration, 1) : frac(1, beat.duration);
  if (beat.dots > 0) f = fMul(f, frac(2 ** (beat.dots + 1) - 1, 2 ** beat.dots));
  if (beat.tupletNumerator > 0 && beat.tupletDenominator > 0 && beat.tupletNumerator !== beat.tupletDenominator) f = fMul(f, frac(beat.tupletDenominator, beat.tupletNumerator));
  return f;
}

const SECTION_RULES = [
  [/pre[-\s]?chorus|pré[-\s]?refrain/i, 'preChorus'], [/chorus|refrain/i, 'chorus'], [/verse|couplet|strophe/i, 'verse'], [/intro/i, 'intro'],
  [/bridge|pont/i, 'bridge'], [/solo/i, 'solo'], [/interlude|instrumental|break/i, 'interlude'], [/outro|ending|fin\b/i, 'outro'], [/coda/i, 'coda'],
];
function sectionCategory(text) {
  if (/^[A-H]$/.test(text.trim())) return 'letter';
  for (const [re, cat] of SECTION_RULES) if (re.test(text)) return cat;
  return 'custom';
}

let programIndex = null;
/** Catalogue instrument for a General MIDI program (0-based): same string count for a tablature, else the lowest catalogue rank. */
function instrumentOfProgram(program, strings) {
  if (program == null || program < 0) return null;
  if (!programIndex) {
    programIndex = new Map();
    for (const [id, info] of Object.entries(catalog.instruments)) {
      if (info.program == null) continue;
      if (!programIndex.has(info.program)) programIndex.set(info.program, []);
      programIndex.get(info.program).push({ id, seq: info.seq ?? 1e9, strings: info.strings?.length ?? 0, group: info.group });
    }
    for (const list of programIndex.values()) list.sort((a, b) => a.seq - b.seq);
  }
  const list = programIndex.get(program);
  if (!list) return null;
  return (strings ? list.find((x) => x.strings === strings) : null)?.id ?? list[0].id;
}

// ---------- percussion map ----------

/** MIDI number of a percussion note: its articulation, or (AlphaTab leaves it at -1 on some grace notes) its plain value. */
const percussionNumber = (n) => (n.percussionArticulation >= 0 ? n.percussionArticulation : n.realValueWithoutHarmonic);

function buildPercMap(atStaff) {
  const preset = percmapPreset('standard:guitar-pro').create();
  const used = new Set();
  for (const b of atStaff.bars) for (const v of b.voices) for (const be of v.beats) for (const n of be.notes) used.add(percussionNumber(n));
  const sounds = []; const soundOf = new Map();
  for (const midi of [...used].filter((m) => m >= 0).sort((a, b) => a - b)) {
    const kit = drumSoundForMidi(preset, midi);
    const sound = kit ? { ...kit } : createDrumSound({ id: `sound${midi}`, name: `Sound ${midi}`, midi, head: 'normal', line: 4, voice: 0, stemDirection: 'up' });
    sounds.push(sound);
    soundOf.set(`midi:${midi}`, sound.id);
  }
  sounds.sort((a, b) => a.line - b.line);
  return { map: sounds.length ? createPercMap({ name: 'Guitar Pro', sounds }) : null, soundOf };
}

// ---------- staves ----------

function makeStaffInfo(atStaff, kind, { muted, bars, report }) {
  const info = {
    no: 1, type: kind, clef: 'G', clefChanges: [], lines: null, tuning: null, tunePitches: null, percmap: null, soundOf: null, ties: [], voices: [], events: [],
    props: {}, at: atStaff, muted, refNote: new Map(), refBeat: new Map(), key: 0,
  };
  if (kind === 'tab') {
    info.tunePitches = [...atStaff.tuning];
    info.tuning = info.tunePitches.map(midiName);
  }
  if (kind === 'percussion') { const { map, soundOf } = buildPercMap(atStaff); info.percmap = map; info.soundOf = soundOf; }
  if (kind === 'score') {
    const keyOf = (c) => ({ 0: 'G', 1: 'C3', 2: 'C4', 3: 'F', 4: 'G' }[c] ?? 'G'); // AlphaTab's Clef: Neutral, C3, C4, F4, G2
    let prev = null;
    atStaff.bars.forEach((b, m) => {
      const c = keyOf(b.clef);
      if (m === 0) info.clef = c;
      else if (c !== prev) info.clefChanges.push({ m, pos: ZERO, key: c });
      prev = c;
    });
  }
  info.makeNote = (ir, taken, rep) => {
    if (kind === 'score') { const sp = defaultSpelling(ir.midi, ir.key); return createNote({ step: sp.step, alter: sp.alter, octave: sp.octave, props: Number.isInteger(ir.string) ? { [PID.TAB_STRING]: ir.string } : {} }); }
    if (kind === 'tab') {
      if (taken.has(ir.string)) { rep.warn('tab.string', 'Two notes of a chord on the same string: the second was ignored'); return null; }
      taken.add(ir.string);
      return createTabNote({ pitch: ir.midi, string: ir.string });
    }
    if (kind === 'percussion') {
      const sound = info.soundOf?.get(ir.instrumentId);
      if (!sound || taken.has(sound)) return null;
      taken.add(sound);
      return createPercNote({ sound });
    }
    return null;
  };
  void bars; void report;
  return info;
}

/** The events (see musicxml-build.js) of voice `vi` of bar `mi` of an AlphaTab staff, for one Scorsaire staff. */
function eventsOfBar(atBar, vi, info, mi, bars) {
  const voice = atBar.voices[vi];
  if (!voice) return [];
  const events = [];
  let pos = ZERO;
  let pending = [];
  const tupletFlags = (beat) => {
    const g = beat.tupletGroup;
    return { start: !!g && g.beats[0] === beat, stop: !!g && g.beats[g.beats.length - 1] === beat };
  };
  for (const beat of voice.beats) {
    const notesIR = [];
    for (const n of beat.notes) {
      const ir = { at: n, kind: 'note', notehead: null, noteheadParens: false, key: bars[mi].key, tuplet: tupletFlags(beat) };
      if (info.type === 'tab') { ir.string = info.tunePitches.length - n.string + 1; ir.fret = n.fret; ir.midi = n.realValueWithoutHarmonic; }
      else if (info.hintStrings) { ir.string = info.hintStrings - n.string + 1; ir.midi = n.realValueWithoutHarmonic; } // notation staff linked to a tablature: it remembers the GP string
      else if (info.type === 'percussion') ir.instrumentId = `midi:${percussionNumber(n)}`;
      else ir.midi = n.realValueWithoutHarmonic;
      notesIR.push(ir);
    }
    if (beat.graceType !== 0) { // a grace beat: it waits for the main beat that follows
      if (notesIR.length) pending.push({ notes: notesIR, info: { slash: beat.graceType === GRACE.BEFORE_BEAT, stealPrevious: 0 }, type: TYPE_OF_DURATION[beat.duration] ?? 'eighth', voice: String(vi), staff: info.no, beat });
      continue;
    }
    const dur = beatFraction(beat);
    const flags = tupletFlags(beat);
    const hasTuplet = beat.tupletNumerator > 0 && beat.tupletDenominator > 0 && beat.tupletNumerator !== beat.tupletDenominator;
    const ev = {
      kind: notesIR.length ? 'chord' : 'rest', pos, dur, notes: notesIR, voice: String(vi), staff: info.no, graceBefore: pending, graceAfter: [], tuplet: null, pieces: [], measureRest: false,
      first: {
        type: TYPE_OF_DURATION[beat.duration] ?? null, dots: beat.dots, mod: hasTuplet ? { actual: beat.tupletNumerator, normal: beat.tupletDenominator, normalType: null, normalDots: 0 } : null,
        printObject: !(beat.isEmpty && vi > 0), tuplet: flags, notehead: null,
      },
      atBeat: beat,
    };
    pending = [];
    events.push(ev);
    pos = fAdd(pos, dur);
  }
  return events;
}

// ---------- the import ----------

/** Imports the bytes of a Guitar Pro file. */
export async function importGuitarProBytes(bytes) {
  const at = await loadAlphaTab();
  let score;
  try {
    score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  } catch (e) {
    throw new GuitarProError(`Not a readable Guitar Pro file: ${e?.message ?? e}`);
  }
  return importAlphaTabScore(score);
}

/** Imports a score read by AlphaTab. */
export function importAlphaTabScore(score) {
  const report = createReport();
  if (!score.tracks.length || !score.masterBars.length) throw new GuitarProError('The file has no track or no bar');
  const nM = score.masterBars.length;
  const pitchedStaff = score.tracks.flatMap((t) => t.staves).find((s) => !s.isPercussion) ?? score.tracks[0].staves[0];

  // ---- bars ----
  const bars = []; let previousFeel = 0;
  const lengths = score.masterBars.map(() => ZERO);
  for (const track of score.tracks) for (const staff of track.staves) staff.bars.forEach((b, m) => {
    b.voices.forEach((v, vi) => {
      if (vi > 0 && voiceEmpty(v)) return;
      let sum = ZERO;
      for (const beat of v.beats) if (beat.graceType === 0) sum = fAdd(sum, beatFraction(beat));
      if (fCmp(sum, lengths[m]) > 0) lengths[m] = sum;
    });
  });
  score.masterBars.forEach((mb, m) => {
    const nominal = frac(mb.timeSignatureNumerator, mb.timeSignatureDenominator);
    let len = nominal;
    if (mb.isAnacrusis && fCmp(lengths[m], ZERO) > 0 && fCmp(lengths[m], nominal) < 0) len = lengths[m];
    else if (fCmp(lengths[m], nominal) > 0) len = lengths[m];
    const bar = {
      timeSig: [mb.timeSignatureNumerator, mb.timeSignatureDenominator], additive: null, timeStyle: mb.timeSignatureCommon && mb.timeSignatureNumerator === 4 && mb.timeSignatureDenominator === 4 ? 'common' : 'normal',
      nominal, len, irregular: !fEq(len, nominal), key: pitchedStaff.bars[m]?.keySignature ?? 0,
      repeatStart: !!mb.isRepeatStart, repeatEnd: mb.repeatCount > 0, repeatTimes: mb.repeatCount > 0 ? Math.max(2, mb.repeatCount) : null,
      barType: mb.isDoubleBar ? 'double' : BAR_LINE[pitchedStaff.bars[m]?.barLineRight] ?? 'simple', voltaStart: null, voltaStop: null,
    };
    bars.push(bar);
  });
  // alternate endings: a run of bars with the same mask is one volta
  for (let m = 0; m < nM; m += 1) {
    const mask = score.masterBars[m].alternateEndings;
    if (!mask) continue;
    if (m > 0 && score.masterBars[m - 1].alternateEndings === mask) continue;
    let end = m;
    while (end + 1 < nM && score.masterBars[end + 1].alternateEndings === mask) end += 1;
    const numbers = []; for (let k = 0; k < 8; k += 1) if (mask & (1 << k)) numbers.push(k + 1);
    bars[m].voltaStart = numbers.length ? numbers : [1];
    bars[end].voltaStop = { open: !bars[end].repeatEnd };
  }
  const masterbars = createMasterbars(bars);
  const barId = (mi) => masterbars[mi].id;

  // ---- tracks and staves ----
  const trackSpecs = [];
  for (const track of score.tracks) {
    const infos = [];
    for (const atStaff of track.staves) {
      let kinds;
      if (atStaff.isPercussion) kinds = ['percussion'];
      else if (atStaff.tuning.length > 0 && atStaff.showTablature) kinds = atStaff.showStandardNotation ? ['score', 'tab'] : ['tab'];
      else if (atStaff.showSlash && !atStaff.showStandardNotation) kinds = ['rhythm'];
      else kinds = ['score'];
      const made = kinds.map((kind) => {
        const info = makeStaffInfo(atStaff, kind, { muted: false, bars, report });
        info.no = infos.length + 1;
        infos.push(info);
        return info;
      });
      if (kinds.length > 1) {
        // a notation staff AND a tablature: the tablature is LINKED to the notation staff (it stores nothing and shows its content; the notation notes remember the GP strings)
        const [notation, tablature] = made;
        notation.hintStrings = atStaff.tuning.length;
        tablature.linkedTo = notation;
        report.info('staves.paired', 'A guitar track gets a notation staff and a tablature linked to it');
      }
    }
    trackSpecs.push({ track, infos });
  }

  // ---- content of the staves (the rhythm side is the MusicXML importer's line builder) ----
  for (const { infos } of trackSpecs) {
    for (const info of infos) {
      if (info.linkedTo) continue; // a linked tablature has no content of its own
      const atStaff = info.at;
      let voiceCount = 1;
      for (const b of atStaff.bars) b.voices.forEach((v, vi) => { if (vi > 0 && !voiceEmpty(v) && v.beats.some((be) => !be.isEmpty && be.notes.length)) voiceCount = Math.max(voiceCount, vi + 1); });
      for (let vi = 0; vi < Math.min(4, voiceCount); vi += 1) {
        const measures = [];
        for (let mi = 0; mi < nM; mi += 1) {
          const events = eventsOfBar(atStaff.bars[mi], vi, info, mi, bars);
          const ctx = { bar: bars[mi], mi, masterbar: masterbars[mi], staffInfo: info, voiceIndex: vi, report };
          let items;
          if (!events.length || events.every((e) => e.kind === 'rest' && e.first.printObject === false && vi > 0)) items = vi === 0 ? buildLineMeasure([], ctx) : [];
          else {
            for (const ev of events) { ev.si = info; ev.mi = mi; ev.line = vi; }
            items = buildLineMeasure(events, ctx);
            for (const ev of events) if (ev.pieces.length) info.events.push(ev);
          }
          measures.push(items);
        }
        info.voices.push(measures);
      }
    }
  }

  // ---- marks and system objects ----
  const system = { jumps: [], markers: [], rehearsalMarks: [], tempos: [], tempoChanges: [], fermatas: [], swings: [], chordNames: [] };
  const sections = [];
  const lyricTexts = [];
  applySystem(score, bars, barId, system, sections, report);
  const verseBase = { n: 0 };
  for (const { infos } of trackSpecs) {
    infos.forEach((info, k) => info.linkedTo || applyMarks(info, { report, barId, system, lyrics: infos.findIndex((i) => i.at === info.at) === k ? { texts: lyricTexts, base: verseBase } : null, bars }));
  }

  // ---- assembly ----
  const tracks = trackSpecs.map(({ track, infos }) => {
    const staves = infos.map((info) => {
      const props = { ...info.props };
      if (info.type === 'tab' && info.tuning) props[PID.TUNING] = info.tuning;
      if (info.type === 'percussion' && info.percmap) props[PID.PERCMAP] = info.percmap;
      if (info.type === 'rhythm') props[PID.LINE_COUNT] = 1;
      if (info.type === 'score' && info.clefChanges.length) props[PID.CLEF_CHANGES] = info.clefChanges.map((c) => ({ id: newId('cc'), measureId: barId(c.m), position: c.pos, clef: c.key }));
      if (info.ties.length) props[PID.TIES] = [...(props[PID.TIES] ?? []), ...info.ties];
      if (info.type === 'tab' && info.at.capo > 0) {
        const first = info.voices[0]?.[0]?.[0];
        if (first) props[PID.CAPOS] = [createCapo(first.id, { fret: info.at.capo, mode: 'tab' })];
      }
      if (info.linkedTo) {
        // the linked tablature: no voices, it points at its notation staff; the capo names a chord of THAT staff
        const primary = info.linkedTo.staffObj;
        props[PID.LINKED_TO] = primary.id;
        delete props[PID.CAPOS];
        if (info.at.capo > 0) {
          const firstItem = primary.voices[0]?.measures[0]?.items[0];
          if (firstItem) props[PID.CAPOS] = [createCapo(firstItem.id, { fret: info.at.capo, mode: 'tab' })];
        }
        return createStaff({ type: 'tab', clef: info.clef, voices: [], props });
      }
      const voices = info.voices.map((measures) => createVoice(measures.map((items) => createMeasure(items))));
      const staff = createStaff({ type: info.type, clef: info.clef, voices, props });
      info.staffObj = staff;
      return staff;
    });
    const atStaff = track.staves[0];
    const strings = atStaff.tuning.length;
    const instrumentId = atStaff.isPercussion ? null : instrumentOfProgram(track.playbackInfo?.program, strings);
    const display = atStaff.displayTranspositionPitch ?? 0;
    const transposition = display && display % 12 === 0 ? { diatonic: (display / 12) * 7, chromatic: display } : (instrumentId ? { diatonic: 0, chromatic: 0 } : null);
    if (display && display % 12 !== 0) report.warn('transpose.odd', 'A transposition that is not a whole number of octaves was ignored');
    const props = {};
    if (instrumentId) props[PID.INSTRUMENT_ID] = instrumentId;
    if (track.playbackInfo?.isMute) props[PID.MUTE] = true;
    return createTrack({ name: track.name ?? '', abbreviation: track.shortName ?? '', transposition, staves, props });
  });

  const voltas = voltaSpecs(bars).map((v) => createVolta({ measureId: barId(v.start), span: v.span, numbers: v.numbers, open: v.open }));
  const containers = sections.map((s) => createSystemContainer({ measureId: barId(s.m), kind: 'section', label: s.label, category: s.category }));
  const chords = chordTrackOf(system.chordNames, masterbars, bars.map((b) => b.len), report);
  if (chords) tracks.unshift(chords.track);
  const movement = createMovement({
    title: score.title ?? '', masterbars, tracks, voltas, systemContainers: containers,
    jumps: system.jumps, markers: system.markers, rehearsalMarks: system.rehearsalMarks, tempos: system.tempos, tempoChanges: system.tempoChanges, fermatas: system.fermatas, swings: system.swings,
  });
  const workProps = {};
  const composer = score.music || score.artist;
  if (score.subTitle) workProps[PID.SUBTITLE] = score.subTitle;
  if (composer) workProps[PID.COMPOSER] = composer;
  if (score.words) workProps[PID.LYRICIST] = score.words;
  if (score.album) workProps[PID.ALBUM] = score.album;
  if (score.copyright) workProps[PID.COPYRIGHT] = score.copyright;
  if (lyricTexts.length) workProps[PID.LYRIC_TEXTS] = lyricTexts;
  if (chords?.dict.added && !validateChordQualities(chords.dict.current).length) workProps[PID.CHORD_QUALITIES] = chords.dict.current;
  const work = createWork({ title: score.title ?? '', movements: [movement], props: workProps });
  report.stat('measures', nM);
  report.stat('tracks', tracks.length);
  const errors = validateWork(work);
  return { work, report: report.result(), errors, meta: { title: score.title ?? '', artist: score.artist ?? '' } };
}

// ---------- system objects ----------

/**
 * The chord names written on the beats (the same name on several tracks counts once) as a chord track: one symbol per name, lasting until the next one of its measure
 * (or the end of the measure). The diagram of a Guitar Pro chord is not read, only its name. Null when no beat carries a name.
 */
function chordTrackOf(names, masterbars, lengths, report) {
  const seen = new Set();
  const unique = names.filter((c) => { const key = `${c.mi}:${c.pos[0]}/${c.pos[1]}:${c.name}`; if (seen.has(key)) return false; seen.add(key); return true; });
  if (!unique.length) return null;
  const dict = { current: createChordQualities(), added: false };
  const parsed = [];
  for (const c of unique) {
    const chord = parseChord(c.name.replace(/^N\.?C\.?$/i, 'N').replace(/\s+/g, ''), dict, report);
    if (chord) parsed.push({ ...c, chord });
  }
  if (!parsed.length) return null;
  const measures = masterbars.map((mb, mi) => {
    const own = parsed.filter((c) => c.mi === mi).sort((a, b) => a.pos[0] * b.pos[1] - b.pos[0] * a.pos[1]);
    const items = own.map((c, k) => {
      const pos = c.pos;
      const end = k + 1 < own.length ? own[k + 1].pos : lengths[mi];
      const span = fSub(end, pos);
      const d = durationOfFraction(span) ?? toRhythmicDurationList(span, { isRest: false, start: pos, timeSig: mb.props?.[PID.TIME_SIG] ?? [4, 4], measureLength: lengths[mi], allowMeasureRest: false, offset: ZERO, maxDots: 1 })[0] ?? { base: 'quarter', dots: 0 };
      return createChordSymbol({ root: c.chord.root, quality: c.chord.quality, bass: c.chord.bass, position: pos, duration: d.base, dots: d.dots });
    });
    return createMeasure(items);
  });
  report.stat('chords', parsed.length);
  const staff = createStaff({ type: 'chord', clef: 'G', voices: [createVoice(measures)] });
  return { track: createTrack({ name: 'Chords', abbreviation: 'Ch', staves: [staff] }), dict };
}

function applySystem(score, bars, barId, system, sections, report) {
  const seenTempo = new Set();
  const addTempo = (mi, ratio, bpm, label) => {
    const len = bars[mi].len;
    const pos = ratio > 0 ? frac(Math.round(ratio * len[0] * 64 / len[1]), 64 * 1) : ZERO;
    const position = fCmp(pos, len) >= 0 ? ZERO : pos;
    const key = `${mi}:${position[0]}/${position[1]}`;
    if (seenTempo.has(key) || !(bpm >= 5 && bpm <= 999)) return;
    seenTempo.add(key);
    const unit = { base: 'quarter', dots: 0 };
    const text = label ? `${label} ${beatUnitText(unit)} = ${Math.round(bpm)}` : undefined;
    system.tempos.push(createTempo({ measureId: barId(mi), position, bpm: Math.round(bpm * 100) / 100, beatUnit: unit, text, followText: text ? true : undefined }));
  };
  const seenFermata = new Set();
  const addFermata = (mi, position, type) => {
    const key = `${mi}:${position[0]}/${position[1]}`;
    if (seenFermata.has(key)) return;
    seenFermata.add(key);
    system.fermatas.push(createFermata({ measureId: barId(mi), position, fermataType: FERMATA_TYPE[type] ?? 'fermata' }));
  };
  let feel = 0;
  score.masterBars.forEach((mb, mi) => {
    for (const a of mb.tempoAutomations ?? []) if (a.type === 0) addTempo(mi, a.ratioPosition ?? 0, a.value, a.text);
    if (mi === 0 && !seenTempo.size && score.tempo) addTempo(0, 0, score.tempo, score.tempoLabel);
    if (mb.section && (mb.section.text || mb.section.marker)) {
      const label = (mb.section.text || mb.section.marker).trim().slice(0, 40);
      sections.push({ m: mi, label, category: sectionCategory(`${mb.section.marker} ${mb.section.text}`) });
    }
    const tf = mb.tripletFeel ?? 0;
    if (tf !== feel) {
      system.swings.push(createSwing({ measureId: barId(mi), position: ZERO, kind: tf === 0 ? 'straight' : TRIPLET_FEEL[tf] ?? 'swing' }));
      feel = tf;
    }
    if (mb.fermata) for (const [offset, f] of mb.fermata) {
      const len = bars[mi].len;
      const pos = frac(Math.round(offset), 3840);
      if (fCmp(pos, len) < 0) addFermata(mi, pos, f.type);
    }
    for (const d of mb.directions ?? []) {
      if (DIRECTION_MARKER[d] !== undefined) system.markers.push(createMarker({ measureId: barId(mi), markerType: DIRECTION_MARKER[d] }));
      else if (DIRECTION_JUMP[d] !== undefined) system.jumps.push(createJump({ measureId: barId(mi), jumpType: DIRECTION_JUMP[d] }));
    }
    if (mb.isFreeTime) report.warn('freetime', 'Free time bars are written as ordinary bars');
    if (mb.syncPoints?.length) report.warn('syncpoints', 'The synchronisation points of the backing track are not imported');
  });
  system.fermatas.addBeat = addFermata;
  system.addTempo = addTempo;
  void score.masterBars;
}

// ---------- marks of one staff ----------

function applyMarks(info, { report, barId, system, lyrics, bars }) {
  const { events } = info;
  const first = (ev) => ev.pieces[0]?.chord ?? null;
  const last = (ev) => ev.pieces[ev.pieces.length - 1]?.chord ?? null;
  const noteEl = (ev, ir, which = 'first') => {
    const piece = which === 'first' ? ev.pieces[0] : ev.pieces[ev.pieces.length - 1];
    return piece?.notes?.find((x) => x.ir === ir)?.el ?? null;
  };
  const chordEvents = events.filter((e) => e.kind === 'chord' && first(e));
  // index of the notes and beats by identity
  const evOfNote = new Map(); const evOfBeat = new Map();
  for (const ev of events) {
    evOfBeat.set(ev.atBeat, ev);
    for (const ir of ev.notes) evOfNote.set(ir.at, { ev, ir });
  }
  const lineOf = (ev) => `${ev.line}`;
  const byLine = new Map();
  for (const ev of events) { const k = lineOf(ev); if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push(ev); }
  const bentDest = new Set(); // tied notes that a bend took over (the tie is replaced by the bend)

  const unsupported = (code, msg) => report.warn(code, msg);

  for (const ev of chordEvents) {
    const chord = first(ev); const beat = ev.atBeat;
    const arts = []; const props = {};
    ev.notes.forEach((ir) => {
      const n = ir.at; const el = noteEl(ev, ir);
      if (!el) return;
      if (n.isDead) setProp(el, PID.MUTED, true);
      if (n.isGhost) setProp(el, PID.GHOST, true);
      if (n.harmonicType) { setProp(el, PID.HARMONIC, true); setProp(el, PID.DISPLAY_FRET, n.harmonicType === HARM.NATURAL ? 'natural' : 'artificial'); }
      if (n.accentuated === ACCENT.NORMAL) arts.push('accent'); else if (n.accentuated === ACCENT.HEAVY) arts.push('marcato'); else if (n.accentuated === ACCENT.TENUTO) arts.push('tenuto');
      if (n.isStaccato) arts.push('staccato');
      if (n.trillValue >= 0) arts.push('trill');
      if (n.leftHandFinger >= 0 && n.leftHandFinger <= 4) setProp(el, PID.FINGERINGS, [...(el.props[PID.FINGERINGS] ?? []), createFingering(LEFT_FINGER[n.leftHandFinger], { kind: 'lhGuitar' })]);
      if (n.rightHandFinger >= 0 && n.rightHandFinger <= 4) setProp(el, PID.FINGERINGS, [...(el.props[PID.FINGERINGS] ?? []), createFingering(RIGHT_FINGER[n.rightHandFinger], { kind: 'rhGuitar' })]);
      if (n.isLeftHandTapped) props[PID.TAPPING] = { hand: 'left' };
      // slides in and out
      if (n.slideInType === SLIDE_IN.FROM_BELOW) props[PID.CHORD_LINE] = createChordLine('scoop', { straight: true });
      else if (n.slideInType === SLIDE_IN.FROM_ABOVE) props[PID.CHORD_LINE] = createChordLine('plop', { straight: true });
      if (n.slideOutType === SLIDE_OUT.OUT_UP || n.slideOutType === SLIDE_OUT.PICK_UP) props[PID.CHORD_LINE] = createChordLine('doit', { straight: true });
      else if (n.slideOutType === SLIDE_OUT.OUT_DOWN || n.slideOutType === SLIDE_OUT.PICK_DOWN) props[PID.CHORD_LINE] = createChordLine('fall', { straight: true });
      else if ((n.slideOutType === SLIDE_OUT.SHIFT || n.slideOutType === SLIDE_OUT.LEGATO) && n.slideTarget) {
        const t = evOfNote.get(n.slideTarget);
        const to = t && noteEl(t.ev, t.ir);
        if (to) listOf(info, PID.GLISSANDOS).push(createGlissando(el.id, to.id)); else unsupported('slide.target', 'A slide without a target note was ignored');
      }
      if (n.ornament) unsupported('ornament', 'A note ornament (turn, mordent…) was ignored');
    });
    // beat-level signs
    if (beat.slap) arts.push('slap');
    if (beat.pop) arts.push('pop');
    if (beat.golpe === 1) arts.push('golpeThumb'); else if (beat.golpe === 2) arts.push('golpe');
    if (beat.tap) props[PID.TAPPING] = { hand: 'right' };
    if (beat.brushType === BRUSH.BRUSH_UP) props[PID.ARPEGGIO] = { type: 'upStraight' };
    else if (beat.brushType === BRUSH.BRUSH_DOWN) props[PID.ARPEGGIO] = { type: 'downStraight' };
    else if (beat.brushType === BRUSH.ARPEGGIO_UP) props[PID.ARPEGGIO] = { type: 'up' };
    else if (beat.brushType === BRUSH.ARPEGGIO_DOWN) props[PID.ARPEGGIO] = { type: 'down' };
    if (beat.tremoloPicking?.marks >= 1) props[PID.TREMOLO] = { strokes: Math.min(6, beat.tremoloPicking.marks) };
    if (beat.pickStroke === 1) arts.push('pickUp'); else if (beat.pickStroke === 2) arts.push('pickDown');
    if (beat.rasgueado) unsupported('rasgueado', 'A rasgueado is not imported');
    if (beat.wahPedal) unsupported('wah', 'A wah pedal sign was ignored');
    if (beat.chordId) {
      const named = beat.chord?.name ?? beat.voice?.bar?.staff?.chords?.get(beat.chordId)?.name;
      if (named && String(named).trim()) system.chordNames.push({ mi: ev.mi, pos: ev.pos, name: String(named).trim() });
      report.stat('diagrams');
    }
    if (beat.ottava) { /* AlphaTab keeps a default Regular value (0): nothing to say */ }
    if (arts.length) setProp(chord, PID.ARTICULATIONS, [...(chord.props[PID.ARTICULATIONS] ?? []), ...mergeArticulationsOf(arts).map((t) => createArticulation(t))]);
    for (const [pid, value] of Object.entries(props)) setProp(chord, pid, value);
    if (beat.text) listOf(info, PID.STAFF_TEXTS).push(createStaffText({ measureId: barId(ev.mi), position: ev.pos, text: String(beat.text).trim().slice(0, 60) || '·', placement: 'above' }));
    if (beat.fermata) system.fermatas.addBeat(ev.mi, ev.pos, beat.fermata.type);
    for (const a of beat.automations ?? []) {
      if (a.type === 0) system.addTempo(ev.mi, bars[ev.mi].len[0] ? (ev.pos[0] / ev.pos[1]) / (bars[ev.mi].len[0] / bars[ev.mi].len[1]) : 0, a.value, a.text);
    }
  }

  // bends and whammy bar
  for (const ev of chordEvents) {
    for (const ir of ev.notes) bendOf(ev, ir);
    if (ev.atBeat.whammyBarPoints?.length) whammyOf(ev);
  }

  // ties, hammer-ons / pull-offs, legato slurs (by identity of the notes)
  for (const ev of chordEvents) {
    for (const ir of ev.notes) {
      const n = ir.at; const el = noteEl(ev, ir, 'last');
      if (!el) continue;
      if (n.isTieDestination && n.tieOrigin && !bentDest.has(n)) {
        const o = evOfNote.get(n.tieOrigin);
        const from = o && noteEl(o.ev, o.ir, 'last'); const to = noteEl(ev, ir, 'first');
        if (from && to && from !== to) info.ties.push(createTie(from.id, to.id));
      }
      if (n.isHammerPullOrigin && n.hammerPullDestination) {
        const d = evOfNote.get(n.hammerPullDestination);
        if (d && first(d.ev) && first(d.ev) !== first(ev)) listOf(info, PID.HOPOS).push(createHopo(first(ev).id, first(d.ev).id));
      } else if ((n.isEffectSlurOrigin && n.effectSlurDestination) || (n.slurDestination && !n.isSlurDestination)) {
        const dn = n.effectSlurDestination ?? n.slurDestination;
        const d = dn && evOfNote.get(dn);
        if (d && first(d.ev) && first(d.ev) !== first(ev) && !listOf(info, PID.SLURS).some((s) => s.startChordId === first(ev).id && s.endChordId === first(d.ev).id)) {
          listOf(info, PID.SLURS).push(createSlur(first(ev).id, first(d.ev).id));
        }
      }
    }
  }

  // runs of beats: palm mute, let ring, vibrato (one line per run), crescendo / decrescendo (one hairpin per run)
  for (const list of byLine.values()) {
    const run = (test) => {
      let start = null; let prev = null;
      const close = () => { if (start) { out.push([start, prev]); start = null; } };
      const out = [];
      for (const ev of list) {
        if (ev.kind === 'chord' && first(ev) && test(ev)) { if (!start) start = ev; prev = ev; } else if (ev.kind === 'chord') close();
      }
      close();
      return out;
    };
    const anyNote = (ev, fn) => ev.notes.some((ir) => fn(ir.at));
    for (const [a, b] of run((ev) => ev.atBeat.isPalmMute || anyNote(ev, (n) => n.isPalmMute))) listOf(info, PID.TECH_LINES).push(createTechLine('palmMute', first(a).id, last(b).id));
    for (const [a, b] of run((ev) => ev.atBeat.isLetRing || anyNote(ev, (n) => n.isLetRing))) listOf(info, PID.TECH_LINES).push(createTechLine('letRing', first(a).id, last(b).id));
    for (const [a, b] of run((ev) => ev.atBeat.vibrato || anyNote(ev, (n) => n.vibrato))) {
      const wide = [a, b].some((e) => e.atBeat.vibrato === VIBRATO_WIDE || anyNote(e, (n) => n.vibrato === VIBRATO_WIDE));
      listOf(info, PID.TECH_LINES).push(createTechLine('vibrato', first(a).id, last(b).id, { vibratoType: wide ? 'guitarVibratoWide' : 'guitarVibrato' }));
    }
    for (const kind of [1, 2]) {
      for (const [a, b] of run((ev) => ev.atBeat.crescendo === kind)) {
        const all = list.filter((e) => e.kind === 'chord' && first(e));
        const end = a === b ? all[all.indexOf(b) + 1] : b;
        if (end && first(end) !== first(a)) listOf(info, PID.HAIRPINS).push(createHairpin(first(a).id, first(end).id, kind === 1 ? 'cresc' : 'decresc'));
      }
    }
    // dynamics: written only where the level in force changes (the default level of the file is F)
    let prev = DEFAULT_DYNAMIC;
    for (const ev of list) {
      if (ev.kind !== 'chord' || !first(ev)) continue;
      const d = ev.atBeat.dynamics;
      if (d !== prev && DYNAMIC_NAMES[d]) { setProp(first(ev), PID.DYNAMIC, DYNAMIC_NAMES[d]); prev = d; } else prev = d;
    }
  }

  void unsupported;

  function curveOf(points) {
    const pts = [];
    for (const p of points) {
      const t = Math.min(1, Math.max(0, p.offset / 60)); const s = Math.max(-12, Math.min(12, p.value / 2));
      if (pts.length && t - pts[pts.length - 1].t < 0.02) { pts[pts.length - 1].s = s; if (t >= 1) pts[pts.length - 1].t = 1; continue; }
      pts.push({ t, s });
    }
    if (!pts.length || pts[0].t !== 0) pts.unshift({ t: 0, s: pts[0]?.s ?? 0 });
    if (pts.length < 2) pts.push({ t: 1, s: pts[0].s });
    while (pts.length > 12) pts.splice(Math.floor(pts.length / 2), 1);
    return pts;
  }

  /**
   * Port of `BendInfoConverter::fillBendInfo` (MuseScore 4.7.5): the points of a GP bend become rising / falling segments. Pitch unit = 25 per
   * quarter tone (AlphaTab values are in quarter tones), time 0..60. Returns { segments: [{ startTime, middleTime, endTime, startPitch, endPitch }],
   * prebend, timeOffset, pitchOffset, slight }.
   */
  function bendSegments(points) {
    const MAX_TIME = 60;
    const pv = points.map((p) => ({ time: p.offset, pitch: p.value * 25 }));
    const info = { segments: [], prebend: false, timeOffset: 0, pitchOffset: 0, slight: false };
    const kind = (a, c) => {
      if (a.pitch === c.pitch) return a.time === c.time ? 'samePT' : 'samePdT';
      if (a.time === c.time) return 'upST';
      return a.pitch < c.pitch ? 'upDT' : 'downDT';
    };
    const startOrHold = (st) => { info.timeOffset = st.time; info.pitchOffset = st.pitch; if (st.pitch > 0) info.prebend = true; };
    let prev = 'none';
    for (let i = 0; i < pv.length - 1; i += 1) {
      const cur = kind(pv[i], pv[i + 1]);
      if (cur === 'samePT') continue;
      if (cur === prev && info.segments.length) {
        const last = info.segments[info.segments.length - 1];
        last.middleTime = pv[i + 1].time; last.endTime = pv[i + 1].time; last.endPitch = pv[i + 1].pitch;
        continue;
      }
      if (cur === 'samePdT' || cur === 'upST') {
        if (!info.segments.length) startOrHold(pv[i]);
        else {
          const last = info.segments[info.segments.length - 1];
          last.middleTime = last.endTime; last.endTime = pv[i + 1].time; last.endPitch = pv[i + 1].pitch;
        }
      } else {
        if (!info.segments.length) startOrHold(pv[i]);
        info.segments.push({ startPitch: pv[i].pitch, endPitch: pv[i + 1].pitch, startTime: pv[i].time, middleTime: pv[i + 1].time, endTime: pv[i + 1].time });
      }
      prev = cur;
    }
    if (info.segments.length) info.segments[info.segments.length - 1].endTime = MAX_TIME;
    for (const seg of info.segments) if (seg.endTime - seg.middleTime === 1) seg.middleTime = seg.endTime;
    if (info.segments.length === 1 && !info.prebend && info.segments[0].endPitch - info.segments[0].startPitch === 25) info.slight = true;
    return info;
  }

  /** Time factors of one segment (`fillNormalBendData`): the first segment is offset by the start of the bend. */
  function segmentFactors(seg, first, timeOffset) {
    const offset = first ? timeOffset : 0;
    const length = seg.endTime - seg.startTime + offset;
    const clamp = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    const startTimeFactor = clamp(offset / length);
    const endTimeFactor = Math.max(startTimeFactor, clamp((offset + seg.middleTime - seg.startTime) / length));
    return { startTimeFactor, endTimeFactor };
  }

  function stringHint(el) { return Number.isInteger(el.props[PID.TAB_STRING]) ? { [PID.TAB_STRING]: el.props[PID.TAB_STRING] } : {}; }
  /** A landing note after the main note: a grace chord "grace8after" without stem (`createGraceChords`), on the string of the start note in a tablature. */
  function landingNote(chord, el, pitch, key) {
    const note = info.type === 'tab'
      ? createTabNote({ pitch, string: el.props[PID.STRING] })
      : (() => { const sp = defaultSpelling(pitch, key); return createNote({ step: sp.step, alter: sp.alter, octave: sp.octave, props: stringHint(el) }); })();
    const g = createChord({ duration: 'eighth', notes: [note], props: { [PID.GRACE_TYPE]: 'grace8after', [PID.NO_STEM]: true } });
    withWrites(() => { chord.graceNotes.push(g); });
    return note;
  }

  function bendOf(ev, ir) {
    const n = ir.at;
    if (!n.bendPoints || n.bendPoints.length < 2 || n.bendPoints.every((p) => p.value === 0)) return;
    const el = noteEl(ev, ir);
    if (!el) return;
    const values = n.bendPoints.map((p) => p.value);
    const first0 = values[0]; const lastV = values[values.length - 1]; const peak = Math.max(...values);
    const semis = (v) => Math.round(v / 2);
    const chord = first(ev);
    const seg = bendSegments(n.bendPoints);
    let chainPitch = el.props[PID.PITCH]; // pitch the segments are counted from (the fretted note, not the pre-bent one)
    // pre-bend: the fretted note as a ghost ornament, the main note sounds the pre-bent pitch
    if (n.bendType >= BEND.PREBEND && n.bendType <= BEND.PREBEND_RELEASE && first0 > 0) {
      const amount = semis(first0);
      if (!amount) return;
      const pitch = el.props[PID.PITCH];
      const grace = info.type === 'tab'
        ? createTabNote({ pitch, string: el.props[PID.STRING] })
        : (() => { const sp = defaultSpelling(pitch, ir.key); return createNote({ step: sp.step, alter: sp.alter, octave: sp.octave, props: stringHint(el) }); })();
      const g = createChord({ duration: 'eighth', notes: [grace], props: { [PID.GRACE_TYPE]: 'appoggiatura' } });
      setProp(grace, PID.GHOST, true);
      shiftNote(el, amount, ir.key);
      withWrites(() => { chord.graceNotes.unshift(g); });
      listOf(info, PID.BENDS).push(createBend('preBend', grace.id, el.id));
      if (first0 % 2) report.warn('bend.quarter', 'A quarter-tone bend amount was rounded to a semitone');
      if (!seg.segments.length) return;
      // the segments that follow the pre-bend (e.g. a release) land on grace notes counted from the unbent pitch
    }
    const dest = ev.notes.length >= 1 ? findTiedDestination(ev, ir) : null;
    // one quarter tone, nothing tied after it: a slight bend that keeps the whole curve for playback
    if (seg.slight && !dest) {
      listOf(info, PID.BENDS).push(createBend('slightBend', el.id, el.id, { curve: curveOf(n.bendPoints) }));
      return;
    }
    if (!seg.segments.length) {
      if (Math.abs(peak) > 0 || Math.abs(lastV) > 0) {
        listOf(info, PID.BENDS).push(createBend('slightBend', el.id, el.id, { curve: curveOf(n.bendPoints) }));
        report.warn('bend.approx', 'A bend with no note to land on is written as a small bend (the exact curve is kept for playback)');
      }
      return;
    }
    const target = (segment) => chainPitch + Math.round(segment.endPitch / 50);
    // one segment onto the tied destination note: the tie becomes the bend, the destination sounds the bent pitch
    if (dest && seg.segments.length === 1 && peak > 0 && lastV > 0) {
      shiftNote(dest.el, semis(lastV), ir.key);
      bentDest.add(dest.at);
      listOf(info, PID.BENDS).push(createBend('bend', el.id, dest.el.id, segmentFactors(seg.segments[0], true, seg.timeOffset)));
      return;
    }
    // otherwise one grace note AFTER the main note per segment, chained by bends; when the note is tied on, the last segment bends from the last
    // grace note to the tied note instead (`LAST_GRACE_CONNECTS`: the tied note keeps its pitch)
    const graceCount = dest ? seg.segments.length - 1 : seg.segments.length;
    let from = el;
    for (let i = 0; i < graceCount; i += 1) {
      const segment = seg.segments[i];
      const note = landingNote(chord, el, target(segment), ir.key);
      listOf(info, PID.BENDS).push(createBend('bend', from.id, note.id, segmentFactors(segment, i === 0, seg.timeOffset)));
      from = note;
    }
    if (dest) {
      bentDest.add(dest.at);
      listOf(info, PID.BENDS).push(createBend('bend', from.id, dest.el.id, segmentFactors(seg.segments[seg.segments.length - 1], seg.segments.length === 1, seg.timeOffset)));
    }
    if (seg.segments.some((sg) => (sg.endPitch / 25) % 2)) report.warn('bend.quarter', 'A quarter-tone bend amount was rounded to a semitone');
  }

  function findTiedDestination(ev, ir) {
    const list = byLine.get(lineOf(ev));
    const next = list[list.indexOf(ev) + 1];
    if (!next || next.kind !== 'chord') return null;
    const dn = next.notes.find((x) => x.at.isTieDestination && x.at.tieOrigin === ir.at);
    if (!dn) return null;
    const el = noteEl(next, dn, 'first');
    return el ? { at: dn.at, el } : null;
  }

  function shiftNote(el, semitones, key) {
    const pitch = el.props[PID.PITCH] + semitones;
    setProp(el, PID.PITCH, pitch);
    if (el.type === 'note') setProp(el, PID.SPELLING, defaultSpelling(pitch, key));
  }

  function whammyOf(ev) {
    const pts = ev.atBeat.whammyBarPoints;
    if (pts.length < 2 || pts.every((p) => p.value === 0)) return;
    const el = ev.pieces[0].notes[0]?.el;
    if (!el) return;
    listOf(info, PID.BENDS).push(createBend('dip', el.id, el.id, { curve: curveOf(pts) }));
    report.warn('whammy.approx', 'A whammy bar effect is written as a dip (the exact curve is kept for playback)');
  }

  // lyrics: one text per verse of the AlphaTab staff, the syllables linked to the chords
  if (lyrics) {
    const lineEvents = byLine.get('0') ?? [];
    const syllabled = lineEvents.filter((e) => e.kind === 'chord' && first(e) && e.atBeat.lyrics?.some((l) => l && l.trim()));
    for (let verse = 0; verse < 5; verse += 1) {
      const tokens = syllabled.map((ev) => ({ ev, text: String(ev.atBeat.lyrics[verse] ?? '').trim() })).filter((t) => t.text && t.text !== '_');
      if (!tokens.length) continue;
      const words = []; let current = [];
      const links = [];
      tokens.forEach((t, i) => {
        const open = t.text.endsWith('-') && t.text.length > 1;
        current.push(t.text.replace(/-+$/, '').replace(/\s+/g, '‿'));
        if (!open || i === tokens.length - 1) { words.push(current.join('-')); current = []; }
        links.push({ ev: t.ev, index: i });
      });
      const text = createLyricText(lyrics.base.n + verse, words.join(' '));
      lyrics.texts.push(text);
      for (const l of links) listOf(info, PID.LYRIC_LINKS).push(createLyricLink(text.id, l.index, first(l.ev).id));
    }
    lyrics.base.n += 5;
  }
  void newId; void createBreath; void createRest; void createRhythmNote; void durationOfFraction; void createTrillLine;
}
