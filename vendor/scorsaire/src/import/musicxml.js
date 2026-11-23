/*
 * MusicXML import (score-partwise 1.0 – 4.0, plain or compressed .mxl). PURE: no DOM. Mirror of src/export/musicxml.js.
 *
 *   importMusicXml(text)            → { work, report, errors }   (a work with a CLEAN history once wrapped by `createDocument`)
 *   importMusicXmlBytes(bytes)      → same, from the bytes of a .musicxml / .xml / .mxl file (async: .mxl needs inflating)
 *
 * `report` lists what was ignored or approximated (see report.js); `errors` are the problems `validateWork` still finds (empty = valid).
 * Rules follow MuseScore 4.7.5 (`importmusicxmlpass1/2.cpp`); what Scorsaire has no place for is ignored and reported, never guessed.
 * Pipeline: musicxml-read.js (XML → flat IR) → musicxml-build.js (masterbars, staves, voices, chords) → musicxml-marks.js (marks and system
 * objects) → assembly here.
 */
import { parseXml } from './xml.js';
import { readMxl, looksLikeZip, decodeXmlBytes } from './mxl.js';
import { readMusicXml, MusicXmlError } from './musicxml-read.js';
import { buildBars, createMasterbars, voltaSpecs, analyzePart, buildPart, intervalOfTranspose, partInterval } from './musicxml-build.js';
import { applyMarks } from './musicxml-marks.js';
import { createReport } from './report.js';
import { PID } from '../model/pid.js';
import { newId } from '../model/ids.js';
import {
  createWork, createMovement, createTrack, createStaff, createVoice, createMeasure, createVolta, createGroup,
} from '../model/elements.js';
import { validateWork } from '../model/validate.js';
import catalog from '../model/instrument-catalog.json' with { type: 'json' };

export { MusicXmlError };

let soundIndex = null;
/**
 * Catalogue id of an instrument from its MusicXML sound id ('wind.reed.clarinet.bflat'). Several instruments may share an id
 * ('pluck.guitar'): the one whose General MIDI program is the part's wins, then the lowest catalogue rank.
 */
function instrumentOfSound(sound, program) {
  if (!sound) return null;
  if (!soundIndex) {
    soundIndex = new Map();
    for (const [id, info] of Object.entries(catalog.instruments)) {
      if (!info.musicXMLid) continue;
      if (!soundIndex.has(info.musicXMLid)) soundIndex.set(info.musicXMLid, []);
      soundIndex.get(info.musicXMLid).push({ id, seq: info.seq ?? 1e9, program: info.program });
    }
    for (const list of soundIndex.values()) list.sort((a, b) => a.seq - b.seq);
  }
  const list = soundIndex.get(sound);
  if (!list) return null;
  return (program != null ? list.find((x) => x.program === program - 1) : null)?.id ?? list[0].id;
}

const GROUP_SYMBOL = { bracket: 'normal', square: 'square', line: 'line', brace: 'brace' };

/** Groups { start, end (part indices, inclusive), label, symbol, barline } from the part-group events of the part list. */
function groupIntervals(events, partCount) {
  const open = new Map(); const out = [];
  for (const e of events) {
    if (e.type === 'start') open.set(e.number, e);
    else if (e.type === 'stop') {
      const s = open.get(e.number);
      if (!s) continue;
      open.delete(e.number);
      const start = s.at; const end = Math.min(partCount - 1, e.at - 1);
      if (end >= start) out.push({ start, end, label: s.name, symbol: s.symbol, barline: s.barline });
    }
  }
  return out;
}

/** Nests intervals by containment; a partial overlap with an earlier group is dropped. Returns a forest [{ ...interval, children }]. */
function nestGroups(list, report) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const roots = []; const stack = [];
  for (const g of sorted) {
    while (stack.length && stack[stack.length - 1].end < g.start) stack.pop();
    const top = stack[stack.length - 1];
    if (top && g.end > top.end) { report.warn('group.overlap', 'A part group that partly overlaps another was ignored'); continue; }
    const node = { ...g, children: [] };
    (top ? top.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** Imports MusicXML text. */
export function importMusicXml(text) {
  const report = createReport();
  const root = parseXml(text);
  const score = readMusicXml(root);
  if (!score.parts.length) throw new MusicXmlError('The file has no part');
  const bars = buildBars(score, report);
  if (!bars.length) throw new MusicXmlError('The file has no measure');
  const masterbars = createMasterbars(bars);

  // parts → analysis, content
  const built = score.parts.map((part, pi) => {
    const an = analyzePart(part, pi, bars, report);
    const b = buildPart(an, bars, masterbars, report);
    return { an, ...b };
  });

  // marks, system objects, lyrics, chord symbols
  const marks = applyMarks({ score, bars, masterbars, built, report });

  // staves and tracks
  const tracks = [];
  for (const { an, staffInfos } of built) {
    const staves = staffInfos.map((info) => {
      const props = { ...(info.props ?? {}) };
      if (info.type === 'tab' && info.tuning) props[PID.TUNING] = info.tuning;
      if (info.type === 'percussion') {
        if (info.percmap) props[PID.PERCMAP] = info.percmap;
        if (Number.isInteger(info.lines) && info.lines >= 1 && info.lines <= 5) props[PID.LINE_COUNT] = info.lines;
      }
      if (info.type === 'rhythm') props[PID.LINE_COUNT] = info.lines === 1 ? 1 : 0;
      if (info.type === 'score' && info.clefChanges.length) {
        props[PID.CLEF_CHANGES] = info.clefChanges.map((c) => ({ id: newId('cc'), measureId: masterbars[c.m].id, position: c.pos, clef: c.key }));
      }
      if (info.ties.length) props[PID.TIES] = [...(props[PID.TIES] ?? []), ...info.ties];
      const voices = info.voices.map((measures) => createVoice(measures.map((items) => createMeasure(items))));
      return createStaff({ type: info.type === 'neutral' ? 'neutral' : info.type, clef: info.clef, voices, props });
    });
    const sound = [...an.info.instruments.values()].map((i) => i.sound).find(Boolean);
    const program = [...an.info.midi.values()].map((m) => m.program).find((x) => x != null);
    const allPercussion = staffInfos.every((i) => i.type === 'percussion');
    const instrumentId = allPercussion ? null : instrumentOfSound(sound, program);
    const iv = partInterval(an.part);
    const trackProps = {};
    if (instrumentId) trackProps[PID.INSTRUMENT_ID] = instrumentId;
    const transposition = iv ?? (instrumentId ? { diatonic: 0, chromatic: 0 } : null);
    tracks.push(createTrack({ name: an.info.name ?? '', abbreviation: an.info.abbr ?? '', transposition, staves, props: trackProps }));
  }
  // the chord track (symbols of every <harmony>) is always the first
  if (marks.chordTrack) tracks.unshift(marks.chordTrack);

  // groups
  const trackOfPart = (pi) => tracks[pi + (marks.chordTrack ? 1 : 0)];
  const intervals = groupIntervals(score.groupEvents, score.parts.length).filter((g) => GROUP_SYMBOL[g.symbol] !== undefined || g.symbol == null);
  const makeGroup = (g) => createGroup({
    startTrackId: trackOfPart(g.start).id, endTrackId: trackOfPart(g.end).id, label: g.label || undefined,
    bracketStyle: GROUP_SYMBOL[g.symbol] ?? 'normal', groupBarlines: g.barline === 'no' ? false : undefined, groups: g.children.map(makeGroup),
  });
  const groups = nestGroups(intervals, report).map(makeGroup);

  const voltas = voltaSpecs(bars).map((v) => createVolta({ measureId: masterbars[v.start].id, span: v.span, numbers: v.numbers, open: v.open }));

  const mvProps = {};
  const sys = marks.system;
  const movement = createMovement({
    title: score.meta.title ?? '', masterbars, tracks, groups, voltas,
    jumps: sys.jumps, markers: sys.markers, rehearsalMarks: sys.rehearsalMarks, tempos: sys.tempos, tempoChanges: sys.tempoChanges, fermatas: sys.fermatas, swings: sys.swings,
    props: mvProps,
  });
  const workProps = {};
  if (score.meta.subtitle) workProps[PID.SUBTITLE] = score.meta.subtitle;
  if (score.meta.composer) workProps[PID.COMPOSER] = score.meta.composer;
  if (score.meta.lyricist) workProps[PID.LYRICIST] = score.meta.lyricist;
  if (score.meta.arranger) workProps[PID.ARRANGER] = score.meta.arranger;
  if (score.meta.rights) workProps[PID.COPYRIGHT] = score.meta.rights;
  if (marks.lyricTexts.length) workProps[PID.LYRIC_TEXTS] = marks.lyricTexts;
  if (marks.chordQualities) workProps[PID.CHORD_QUALITIES] = marks.chordQualities;
  const work = createWork({ title: score.meta.title ?? '', movements: [movement], props: workProps });
  report.stat('measures', bars.length);
  report.stat('tracks', tracks.length);
  const errors = validateWork(work);
  return { work, report: report.result(), errors, meta: score.meta };
}

/** Imports the bytes of a .musicxml / .xml / .mxl file. */
export async function importMusicXmlBytes(bytes) {
  const text = looksLikeZip(bytes) ? await readMxl(bytes) : decodeXmlBytes(bytes);
  return importMusicXml(text);
}

export { intervalOfTranspose };
