/*
 * All-in-One import (the beat / downbeat / chord / segment analysis of a recording): files of an analysed song → a work whose measures ARE the
 * measures of the recording, plus the time map that ties the score to the audio. PURE (no DOM, no audio).
 *
 *   importAllInOne({ infos, beats, chords, segments, lyrics }, { lang }) → { work, report, errors, sync, meta }   (`lyrics` = dated syllables / words, see lyrics-times.js: a lyrics track)
 *
 * Inputs (all JSON already parsed): `beats` = [{ time, beatNum }] (required), `chords` = [{ curr_beat_time, chord_complex_pop | chord_simple_pop,
 * bass }], `segments` = [{ start, end, label }], `infos` = { titre, artiste, duree_secondes, bpm, tonalite: "C major" }.
 * The score is built FROM the map, so it cannot disagree with it: one masterbar per measure (a measure starts on `beatNum` 1), the time signature
 * is the beat count (a short first or last measure is a pickup / an incomplete measure, `PID.MEASURE_LENGTH`), the tempo follows the beats, the
 * chords become chord symbols on the first track, the segments become parts of the form.
 * `sync.measures[i]` = { start (seconds), end, beats: [seconds] } — the map the synchronisation will use (audio time ↔ measure + fraction).
 */
import { createReport } from './report.js';
import { createSyncMap } from '../audio/syncmap.js';
import { placeSyllables, lyricsTrackFor } from '../model/lyricevents.js';
import { PID } from '../model/pid.js';
import { frac, fMul, fSub, fEq, ZERO } from '../model/fraction.js';
import {
  createWork, createMovement, createMasterbar, createTrack, createStaff, createVoice, createMeasure, createChordSymbol, createSystemContainer, createTempo,
} from '../model/elements.js';
import { createChordQualities, validateChordQualities } from '../model/chordquality.js';
import { derivedInputGrid } from '../model/inputgrid.js';
import { toRhythmicDurationList } from '../model/rhythmsplit.js';
import { validateWork } from '../model/validate.js';
import { setProp } from './musicxml-marks.js';
import { durationOfFraction } from './musicxml-build.js';
import { parseChord } from './ireal.js';

export class AllInOneError extends Error {}

const FIFTHS_OF_MAJOR_PC = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
const PC_OF_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C major", "A minor", "F# minor", "Bb major" → { fifths, mode, name } or null. */
export function parseKey(text) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(major|minor|maj|min|m)?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  const step = m[1].toUpperCase();
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const mode = /^m(in|inor)?$/i.test(m[3] ?? '') && !/^maj/i.test(m[3] ?? '') ? 'minor' : 'major';
  const pc = (PC_OF_STEP[step] + acc + 12) % 12;
  const major = mode === 'minor' ? (pc + 3) % 12 : pc;
  let fifths;
  if (major === 6) fifths = acc >= 0 && mode === 'major' ? 6 : (mode === 'minor' && acc >= 0 ? 6 : -6);
  else fifths = FIFTHS_OF_MAJOR_PC[major];
  return { fifths, mode, name: `${step}${acc > 0 ? '#' : acc < 0 ? 'b' : ''} ${mode}` };
}

// Krumhansl-Kessler key profiles (weight of each pitch class above the tonic in a major / minor key)
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAME_OF_PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * The key a list of chords sits in, when the analysis does not give one: { fifths, mode, name } or null (no chord to judge by).
 * Each chord weighs what it lasts (to the next one), its root and triad are added to a pitch-class histogram, which is compared with the 24 key profiles;
 * the share of the time spent on the tonic chord itself breaks the tie between a key and its relative.
 */
export function estimateKey(chords) {
  const list = (chords ?? []).map((c) => ({ time: Number(c.curr_beat_time), text: c.chord_complex_pop ?? c.chord_simple_pop ?? c.chord_basic_pop })).filter((c) => Number.isFinite(c.time) && typeof c.text === 'string');
  const hist = new Array(12).fill(0);
  let total = 0;
  const own = new Map();
  list.forEach((c, i) => {
    const m = /^([A-G])([#b]?)(.*)$/.exec(c.text);
    if (!m) return;
    const root = (PC_OF_STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    const rest = m[3];
    const minor = /^(m(?!aj)|dim)/.test(rest);
    const weight = i + 1 < list.length ? Math.max(0.05, list[i + 1].time - c.time) : 1;
    hist[root] += weight; hist[(root + (minor ? 3 : 4)) % 12] += 0.7 * weight; hist[(root + (/^dim/.test(rest) ? 6 : /^aug/.test(rest) ? 8 : 7)) % 12] += 0.7 * weight;
    const k = `${root}${minor ? 'm' : 'M'}`;
    own.set(k, (own.get(k) ?? 0) + weight);
    total += weight;
  });
  if (total <= 0) return null;
  const correlation = (a, b) => {
    const ma = a.reduce((x, y) => x + y, 0) / 12; const mb = b.reduce((x, y) => x + y, 0) / 12;
    let num = 0; let da = 0; let db = 0;
    for (let i = 0; i < 12; i += 1) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  let best = null;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const minor of [false, true]) {
      const profile = (minor ? KK_MINOR : KK_MAJOR);
      const rotated = Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12]);
      // the share of the chord tones that sit inside the scale of the key (harmonic minor for a minor key) counts as much as the profile
      const scale = minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
      const inside = hist.reduce((sum, w, pc) => sum + (scale.includes((pc - tonic + 12) % 12) ? w : 0), 0) / hist.reduce((a, b) => a + b, 0);
      const score = correlation(hist, rotated) + 1.2 * inside + 0.4 * ((own.get(`${tonic}${minor ? 'm' : 'M'}`) ?? 0) / total);
      if (!best || score > best.score) best = { score, tonic, minor };
    }
  }
  return parseKey(`${NAME_OF_PC[best.tonic]} ${best.minor ? 'minor' : 'major'}`);
}

/** The analysis names every black-key root with a sharp: re-spell it flat in a flat or neutral key. */
const FLAT_OF_SHARP = { 'A#': 'Bb', 'D#': 'Eb', 'G#': 'Ab', 'C#': 'Db' };
function spellRoot(text, fifths) {
  const m = /^([A-G]#)(.*)$/.exec(text);
  if (!m) return text;
  const flat = fifths < 0 ? { ...FLAT_OF_SHARP, 'F#': 'Gb' } : fifths === 0 ? FLAT_OF_SHARP : null;
  return flat?.[m[1]] ? `${flat[m[1]]}${m[2]}` : text;
}
const spellChord = (text, fifths) => text.split('/').map((p) => spellRoot(p, fifths)).join('/');

const SECTION_CATEGORY = {
  intro: 'intro', verse: 'verse', chorus: 'chorus', bridge: 'bridge', solo: 'solo', inst: 'interlude', instrumental: 'interlude',
  break: 'interlude', outro: 'outro', end: 'outro', prechorus: 'preChorus',
};
const SECTION_FR = { intro: 'Intro', verse: 'Couplet', chorus: 'Refrain', bridge: 'Pont', solo: 'Solo', inst: 'Instrumental', outro: 'Outro', break: 'Break' };
function sectionOf(label, lang) {
  const key = String(label ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const category = SECTION_CATEGORY[key] ?? 'custom';
  const name = lang === 'fr' ? (SECTION_FR[key] ?? label) : String(label ?? '');
  return { label: name, category };
}

/** The usable beats of an analysis, in time order (a beat has a time and a beat number from 1). */
export function cleanBeats(beats) {
  return (beats ?? []).map((b) => ({ time: Number(b.time), beatNum: Number(b.beatNum) })).filter((b) => Number.isFinite(b.time) && Number.isInteger(b.beatNum) && b.beatNum >= 1).sort((a, b) => a.time - b.time);
}

/** Groups the beats into measures: a measure starts on beat number 1 (or when the numbering does not go up). */
export function groupMeasures(beats) {
  const out = [];
  let cur = null; let prev = 0;
  for (const b of beats) {
    if (!cur || b.beatNum === 1 || b.beatNum <= prev) { cur = { beats: [] }; out.push(cur); }
    cur.beats.push(b);
    prev = b.beatNum;
  }
  return out;
}

const mode = (values) => {
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
};
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function importAllInOne({ infos = {}, beats, chords = [], segments = [], lyrics = [] } = {}, { lang = 'en' } = {}) {
  const report = createReport();
  if (!Array.isArray(beats) || beats.length < 2) throw new AllInOneError('The analysis holds no beat map');
  const clean = cleanBeats(beats);
  if (clean.length < 2) throw new AllInOneError('The analysis holds no usable beat');
  const groups = groupMeasures(clean);
  const nominal = mode(groups.map((g) => g.beats.length));
  const beatLength = median(clean.slice(1).map((b, i) => b.time - clean[i].time));

  let key = parseKey(infos.tonalite ?? infos.key);
  if (!key) {
    key = estimateKey(chords);
    if (key) report.info('allinone.keyEstimated', `The analysis gives no key: ${key.name} was estimated from the chords`);
    else report.info('allinone.key', 'The key of the analysis could not be read: C major was used');
  }
  const fifths = key?.fifths ?? 0;

  // measures: time signature = beat count (denominator 4), short first / last measure = pickup / incomplete measure
  const last = groups.length - 1;
  const sync = { duration: Number(infos.duree_secondes) || clean[clean.length - 1].time + beatLength, measures: [], key: key?.name ?? 'C major', bpm: Number(infos.bpm) || null };
  const masterbars = groups.map((g, i) => {
    const n = g.beats.length;
    const start = g.beats[0].time;
    const end = i < last ? groups[i + 1].beats[0].time : g.beats[n - 1].time + beatLength;
    sync.measures.push({ start, end, beats: g.beats.map((b) => b.time) });
    const props = {};
    let ts = [n, 4];
    if (n < nominal && (i === 0 || i === last)) { ts = [nominal, 4]; props[PID.MEASURE_LENGTH] = frac(n, 4); }
    return createMasterbar({ timeSig: ts, keySig: fifths, props });
  });
  const meter = [...new Set(groups.slice(1, -1).map((g) => g.beats.length))]; // a short first / last measure is a pickup / an incomplete measure, not a change of meter
  if (meter.length > 1) report.info('allinone.meter', 'The beat map holds measures of different lengths: the time signature follows the beat count');

  // tempo: one event per measure whose rounded tempo moves by more than 2 % from the last one written
  const tempos = []; let lastBpm = 0;
  const bpmOf = (i) => Math.round((60 * groups[i].beats.length) / Math.max(0.001, sync.measures[i].end - sync.measures[i].start));
  sync.measures.forEach((m, i) => {
    // a short first measure (a pick-up, often cut by the start of the recording) says nothing about the tempo: it takes the one of the measure that follows
    const bpm = i === 0 && groups[0].beats.length < nominal && sync.measures.length > 1 ? bpmOf(1) : bpmOf(i);
    if (bpm < 5 || bpm > 999) return;
    if (!lastBpm || Math.abs(bpm - lastBpm) / lastBpm > 0.02) {
      tempos.push(createTempo({ measureId: masterbars[i].id, position: ZERO, bpm }));
      lastBpm = bpm;
    }
  });

  // chords: one symbol per CHANGE, on the beat where the analysis says it changes
  const beatAt = (t) => {
    let best = null; let bestD = 0.06;
    sync.measures.forEach((m, mi) => m.beats.forEach((bt, k) => { const d = Math.abs(bt - t); if (d < bestD) { bestD = d; best = { mi, k }; } }));
    return best;
  };
  const dict = { current: createChordQualities(), added: false };
  const changes = []; let previous = null; let ignored = 0;
  for (const c of chords) {
    const text = c.chord_complex_pop ?? c.chord_simple_pop ?? c.chord_basic_pop;
    if (text == null || text === previous) continue;
    previous = text;
    const at = beatAt(Number(c.curr_beat_time));
    if (!at) { ignored += 1; continue; }
    if (text === 'N') { changes.push({ ...at, special: 'noChord' }); continue; }
    const withBass = c.bass && !text.includes('/') ? `${text}/${c.bass}` : text;
    const chord = parseChord(spellChord(withBass, fifths), dict, report);
    if (chord) changes.push({ ...at, chord });
  }
  if (ignored) report.warn('allinone.chordtime', 'Some chord changes fall away from every beat and were ignored');
  const lens = groups.map((g, i) => (masterbars[i].props?.[PID.MEASURE_LENGTH] ?? frac(g.beats.length, 4)));
  const symbolMeasures = groups.map((g, mi) => {
    const own = changes.filter((c) => c.mi === mi).sort((a, b) => a.k - b.k);
    const items = []; const starts = [];
    own.forEach((c, idx) => {
      const pos = frac(c.k, 4);
      const endPos = idx + 1 < own.length ? frac(own[idx + 1].k, 4) : lens[mi];
      const span = fSub(endPos, pos);
      let d = durationOfFraction(span);
      if (!d) d = toRhythmicDurationList(span, { isRest: false, start: pos, timeSig: masterbars[mi].timeSig ?? [4, 4], measureLength: lens[mi], allowMeasureRest: false, offset: ZERO, maxDots: 1 })[0] ?? { base: 'quarter', dots: 0 };
      if (c.special) items.push(createChordSymbol({ special: c.special, position: pos, duration: d.base, dots: d.dots }));
      else items.push(createChordSymbol({ root: c.chord.root, quality: c.chord.quality, bass: c.chord.bass, position: pos, duration: d.base, dots: d.dots }));
      starts.push(pos);
    });
    return { items, starts };
  });
  symbolMeasures.forEach((sm, i) => {
    if (!sm.starts.length) return;
    // the input grid follows the beats of the map (one slot per beat, from the start of the measure)
    const slots = groups[i].beats.map((_, k) => frac(k, 4));
    const derived = derivedInputGrid(masterbars[i], i === 0).map((c) => c.start);
    if (derived.length !== slots.length || derived.some((s, k) => !fEq(s, slots[k]))) setProp(masterbars[i], PID.INPUT_GRID, slots);
  });
  const staff = createStaff({ type: 'chord', clef: 'G', voices: [createVoice(symbolMeasures.map((sm) => createMeasure(sm.items)))] });
  const track = createTrack({ name: lang === 'fr' ? 'Accords' : 'Chords', abbreviation: 'Ch', staves: [staff] });

  // the lyrics (dated syllables or words): a lyrics track of events, each on the measure and the exact instant the beat map says
  const lyricEvents = lyrics.length ? placeSyllables(lyrics, createSyncMap(sync.measures), lens) : [];
  const tracks = lyricEvents.length ? [track, lyricsTrackFor(lyricEvents, groups.length, { name: lang === 'fr' ? 'Paroles' : 'Lyrics' })] : [track];
  if (lyrics.length && lyricEvents.length < lyrics.length) report.warn('allinone.lyrics', `${lyrics.length - lyricEvents.length} lyric word(s) fall outside the beat map and were ignored`);

  // parts of the form: each segment starts on the measure whose start is the closest to it
  const containers = [];
  for (const s of segments) {
    let best = 0; let bestD = Infinity;
    sync.measures.forEach((m, i) => { const d = Math.abs(m.start - Number(s.start)); if (d < bestD) { bestD = d; best = i; } });
    if (bestD > beatLength * 2) { report.warn('allinone.segment', 'A segment starts away from every measure and was ignored'); continue; }
    if (containers.some((c) => c.measureId === masterbars[best].id)) continue;
    const sec = sectionOf(s.label, lang);
    containers.push(createSystemContainer({ measureId: masterbars[best].id, kind: 'section', label: sec.label, category: sec.category }));
  }

  const title = infos.titre ?? infos.title ?? '';
  const movement = createMovement({ title, masterbars, tracks, systemContainers: containers, tempos });
  const props = {};
  if (infos.artiste ?? infos.artist) props[PID.SUBTITLE] = infos.artiste ?? infos.artist;
  if (dict.added && !validateChordQualities(dict.current).length) props[PID.CHORD_QUALITIES] = dict.current;
  const work = createWork({ title, movements: [movement], props });
  report.stat('measures', groups.length);
  report.stat('chords', changes.length);
  report.stat('lyrics', lyricEvents.length);
  report.stat('sections', containers.length);
  return { work, report: report.result(), errors: validateWork(work), sync, meta: { title, artist: infos.artiste ?? infos.artist ?? '', key: key?.name ?? null, fifths, bpm: sync.bpm, duration: sync.duration } };
}

export { fMul };
