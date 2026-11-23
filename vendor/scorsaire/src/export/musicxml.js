/*
 * MusicXML export (score-partwise 4.0). PURE: returns a string; no DOM. Rules follow MuseScore 4.7.5 (`exportmusicxml.cpp`):
 *  - one <part> per track (several staves → <staves>); measures numbered from 1, an anacrusis is measure 0 with implicit="yes";
 *  - <divisions> chosen so that every duration (tuplets included) is an integer; voices are written one after another with <backup>;
 *  - pitches are WRITTEN pitches: the model stores concert pitch, an instrument's transposition goes to <transpose> and the key is the written key;
 *  - the system ("masterbar") objects (tempo, swing, rehearsal marks, jumps, markers, fermatas) go to the FIRST staff of the FIRST part,
 *    as directions placed with <offset> (MusicXML has no system track);
 *  - repeats, voltas (<ending>) and bar styles are written as barlines.
 * Tranche X1 (core) + X2 (marks: musicxml-marks.js — dynamics, hairpins, slurs, articulations, ornaments, tremolos, glissandos, breaths, pedals,
 * lyrics, fingerings, arpeggios, chord symbols written as <harmony> in the first staff of their track). Not written yet: tablature / percussion /
 * accordion / rhythm staves (X3: those staves are left out and reported in `warnings`), beams, stem directions, displayed accidentals.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { itemDuration, measureLengthOf, isIrregularMeasure } from '../model/timing.js';
import { fAdd, fSub, fMul, fToNumber, fEq, fCmp, ZERO, frac } from '../model/fraction.js';
import { trackTransposition } from '../model/instruments.js';
import { isLinkedStaff, projectLinkedStaff } from '../model/linkedstaff.js';
import { intervalIsZero, writtenKey } from '../model/transpose.js';
import { jumpText, jumpLabels, markerLabel, markerParts } from '../model/repeats.js';
import { beatUnitFraction, GRADUAL_TYPES } from '../model/tempo.js';
import { clefTimeline, clefAt } from '../layout/clefchanges.js';
import { clefKeyOf } from '../layout/painters/common.js';
import { writtenChord } from '../layout/transposed.js';
import { spellingOf } from '../layout/pitchpos.js';
import { defaultSpelling, diatonicIndex } from '../model/pitch.js';
import { tuningPitches, tuningPitchesAt, tuningChanges, capoTimeline, capoAt, derivedFret, NO_CAPO } from '../model/capo.js';
import { drumSound, staffSoundMap } from '../model/percmap.js';
import { ACC_ROW_QUALITY, isChordRow } from '../model/accordion.js';
import { resolveStradellaTable, stradellaChordPitches } from '../model/stradella.js';
import { lyricEventMarks, staffMarkIndex, chordDirections, noteNotations, chordLyrics, noteheadOverride, direction as dirXml, harmonyXml, harmonyXmlOf, frameXml } from './musicxml-marks.js';
import { resolveDiagram, resolveElementDiagram, followedDiagrams, diagramChordOf, chordPathFor } from '../model/fretdiagram.js';
import { workChordQualities } from '../model/chordqualityedit.js';

const TYPE_NAME = { breve: 'breve', whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th', thirtysecond: '32nd', sixtyfourth: '64th' };
const CLEF_SIGN = {
  G: ['G', 2, 0], G8va: ['G', 2, 1], G8vb: ['G', 2, -1], G15ma: ['G', 2, 2], G15mb: ['G', 2, -2],
  F: ['F', 4, 0], F8va: ['F', 4, 1], F8vb: ['F', 4, -1], F15ma: ['F', 4, 2], F15mb: ['F', 4, -2],
  C1: ['C', 1, 0], C2: ['C', 2, 0], C3: ['C', 3, 0], C4: ['C', 4, 0], C5: ['C', 5, 0], PERC: ['percussion', 2, 0],
};
const EXPORTED_STAFF_TYPES = new Set(['score', 'tab', 'percussion', 'rhythm', 'neutral', 'accordion-left']); // 'chord' staves become <harmony> elements
const BAR_STYLE = { simple: null, double: 'light-light', final: 'light-heavy', reverseFinal: 'heavy-light', heavy: 'heavy', heavyHeavy: 'heavy-heavy', dashed: 'dashed', dotted: 'dotted', short: 'short', tick: 'tick' };
const FERMATA_SHAPE = { fermataVeryShort: 'angled', fermataShort: 'angled', fermataShortHenze: 'angled', fermata: 'normal', fermataLong: 'square', fermataLongHenze: 'square', fermataVeryLong: 'double-square' };
const NOTEHEAD_OF_GROUP = { cross: 'x', xcircle: 'circle-x', diamond: 'diamond', 'triangle-down': 'inverted triangle', 'triangle-up': 'triangle', slashed1: 'slashed', slashed2: 'back slashed', slash: 'slash', plus: 'cross', la: 'la', ti: 'ti', do: 'do' };
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const GROUP_SYMBOL = { normal: 'bracket', square: 'square', line: 'line', brace: 'brace' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a, b) => (a / gcd(a, b)) * b;

const posKey = (mi, pos) => `${mi}:${pos[0]}/${pos[1]}`;

/** Staff types the exporter writes in this tranche. */
export const isExportedStaffType = (type) => EXPORTED_STAFF_TYPES.has(type);

/**
 * @param work       the work
 * @param options    { movement = 0 } index of the movement to export (a MusicXML score holds one movement)
 * @returns {{ xml: string, warnings: string[] }}
 * @throws Error when nothing can be exported (no staff of a supported type)
 */
/**
 * `linkedStaves`: what a tablature LINKED to a notation staff becomes in the file — 'twoStaves' (default: one part with both staves, like MuseScore),
 * 'separateParts' (the tablature as a part of its own, after the notation part of its track), 'notationOnly' (the tablature is left out).
 */
/**
 * The fingerings to write as `<frame>`: { frames: symbol id → fretted voicing } for every chord symbol that shows a diagram or is covered by a container that follows the chord
 * staff, and { standalone: [{ mi, chord, voicing, after }] } for the containers of ONE chord (a piano diagram has no frame). A single-chord container whose chord is already
 * written at the start of its measure on the chord staff gives its fingering to that symbol instead.
 */
function diagramFrames(work, mv) {
  const frames = new Map();
  const standalone = [];
  const preferred = getProperty(work, PID.PREFERRED_VOICINGS);
  const dict = workChordQualities(work);
  const fretted = (res) => (res?.voicing?.frets ? res.voicing : null);
  const chordStaves = mv.tracks.flatMap((t) => t.staves).filter((st) => getProperty(st, PID.STAFF_TYPE) === 'chord');
  for (const staff of chordStaves) {
    for (const voice of staff.voices) for (const m of voice.measures) for (const sym of m.items) {
      if (sym.type !== 'chordsymbol' || !getProperty(sym, PID.DIAGRAM_SHOWN)) continue;
      const instrumentOf = getProperty(sym, PID.DIAGRAM_INSTRUMENT);
      const v = fretted(resolveDiagram({ voicing: getProperty(sym, PID.VOICING), chord: diagramChordOf(sym), instrument: instrumentOf, index: getProperty(sym, PID.DIAGRAM_SUGGESTION), preferred, dict, pathVoicing: chordPathFor(mv, instrumentOf, { preferred, dict }).get(sym.id) ?? null }));
      if (v) frames.set(sym.id, v);
    }
  }
  const sameChord = (a, b) => a && b && a.root.step === b.root.step && (a.root.alter ?? 0) === (b.root.alter ?? 0) && (a.quality ?? '') === (b.quality ?? '')
    && ((!a.bass && !b.bass) || (a.bass && b.bass && a.bass.step === b.bass.step && (a.bass.alter ?? 0) === (b.bass.alter ?? 0)));
  for (const staff of mv.tracks.flatMap((t) => t.staves)) {
    for (const c of staff.containers ?? []) {
      if (getProperty(c, PID.CONTAINER_KIND) !== 'chordDiagram') continue;
      if (getProperty(c, PID.DIAGRAM_FOLLOW)) {
        for (const e of followedDiagrams(mv, c, { preferred, dict })) { const v = fretted(e.res); if (v && !frames.has(e.key)) frames.set(e.key, v); }
        continue;
      }
      const chord = getProperty(c, PID.DIAGRAM_CHORD);
      const v = fretted(resolveElementDiagram(c, { preferred, dict }));
      const mi = mv.masterbars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID));
      if (!v || !chord || mi < 0) continue;
      const after = getProperty(c, PID.CONTAINER_PLACEMENT) === 'between' && getProperty(c, PID.CONTAINER_SIDE) === 'after';
      let attached = false;
      if (!after) {
        for (const st of chordStaves) for (const voice of st.voices) for (const sym of voice.measures[mi]?.items ?? []) {
          if (sym.type === 'chordsymbol' && fEq(getProperty(sym, PID.POSITION) ?? ZERO, ZERO) && sameChord(diagramChordOf(sym), chord) && !frames.has(sym.id)) { frames.set(sym.id, v); attached = true; }
        }
      }
      if (!attached) standalone.push({ mi, chord, voicing: v, after });
    }
  }
  return { frames, standalone };
}

export function exportMusicXml(work, { movement = 0, software = 'Scorsaire', linkedStaves = 'twoStaves' } = {}) {
  const mv = work.movements[movement];
  if (!mv) throw new Error(`Unknown movement: ${movement}`);
  const warnings = [];
  const bars = mv.masterbars;
  const n = bars.length;
  const barLengths = bars.map(measureLengthOf);
  const concertKeys = bars.map((b) => getProperty(b, PID.KEY_SIG));

  // exported parts: tracks with at least one staff of a supported type
  const parts = [];
  for (const track of mv.tracks) {
    const staves = []; const tabs = [];
    for (const staff of track.staves) {
      const type = getProperty(staff, PID.STAFF_TYPE);
      if (type === 'chord' && isLinkedStaff(staff)) continue; // the second display of the chord track (capo shapes…) is a way of reading, not music: only the chord staff is exported
      if (!isExportedStaffType(type)) { warnings.push(`Staff ${staff.id} (${type}) of track ${getProperty(track, PID.NAME) ?? track.id} is not exported yet`); continue; }
      if (!isLinkedStaff(staff)) { staves.push(staff); continue; }
      if (linkedStaves === 'notationOnly') continue;
      const projected = projectLinkedStaff(mv, staff); // a linked staff is exported from its projection
      if (linkedStaves === 'separateParts') tabs.push(projected); else staves.push(projected);
    }
    if (staves.length) parts.push({ track, staves, id: `P${parts.length + 1}` });
    if (tabs.length) parts.push({ track, staves: tabs, id: `P${parts.length + 1}`, suffix: ' (tab)' });
  }
  if (!parts.length) throw new Error('Nothing to export: no staff of a supported type');

  // ---- divisions: every duration and position must be an integer number of divisions (quarter note = `divisions`) ----
  let divisions = 1;
  const need = (f) => {
    if (!f) return;
    const q = fMul(f, frac(4, 1)); // quarter notes
    divisions = lcm(divisions, q[1]);
  };
  for (const part of parts) {
    for (const staff of part.staves) {
      for (const voice of staff.voices) {
        voice.measures.forEach((measure, mi) => {
          for (const item of measure.items) {
            if (item.type !== 'chord' && item.type !== 'rest') continue;
            need(itemDuration(item, barLengths[mi]));
          }
        });
      }
    }
  }
  for (const len of barLengths) need(len);
  for (const list of [mv.tempos, mv.swings, mv.fermatas, mv.tempoChanges]) for (const e of list) need(getProperty(e, PID.POSITION));
  divisions = Math.min(divisions, 5040 * 4);
  const dur = (f) => { const q = fMul(f, frac(4, 1)); return Math.round((q[0] * divisions) / q[1]); };

  const out = [];
  const w = (s) => out.push(s);
  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');
  const title = getProperty(work, PID.TITLE);
  if (title) w(`<work><work-title>${esc(title)}</work-title></work>`);
  const composer = getProperty(work, PID.COMPOSER); const lyricist = getProperty(work, PID.LYRICIST);
  w('<identification>');
  if (composer) w(`<creator type="composer">${esc(composer)}</creator>`);
  if (lyricist) w(`<creator type="lyricist">${esc(lyricist)}</creator>`);
  w(`<encoding><software>${esc(software)}</software></encoding>`);
  w('</identification>');

  // ---- part list with the groups (brackets) ----
  w('<part-list>');
  const partIndexOfTrack = new Map();
  parts.forEach((p, i) => { if (!partIndexOfTrack.has(p.track.id)) partIndexOfTrack.set(p.track.id, i); });
  const starts = new Map(); // part index → [group]
  const stops = new Map();
  let groupNumber = 0;
  const visit = (groups) => {
    for (const g of groups) {
      const a = mv.tracks.findIndex((t) => t.id === getProperty(g, PID.START_TRACK_ID));
      const z = mv.tracks.findIndex((t) => t.id === getProperty(g, PID.END_TRACK_ID));
      const inside = parts.map((p, i) => ({ i, ti: mv.tracks.indexOf(p.track) })).filter((x) => x.ti >= a && x.ti <= z);
      if (inside.length && a >= 0 && z >= a) {
        groupNumber += 1;
        const entry = { group: g, number: groupNumber };
        const first = inside[0].i; const last = inside[inside.length - 1].i;
        starts.set(first, [...(starts.get(first) ?? []), entry]);
        stops.set(last, [entry, ...(stops.get(last) ?? [])]);
      }
      visit(g.groups ?? []);
    }
  };
  visit(mv.groups);
  parts.forEach((p, i) => {
    for (const { group, number } of starts.get(i) ?? []) {
      const style = GROUP_SYMBOL[getProperty(group, PID.BRACKET_STYLE)] ?? 'bracket';
      const label = getProperty(group, PID.LABEL);
      w(`<part-group type="start" number="${number}">${label ? `<group-name>${esc(label)}</group-name>` : ''}<group-symbol>${style}</group-symbol><group-barline>${getProperty(group, PID.GROUP_BARLINES) === false ? 'no' : 'yes'}</group-barline></part-group>`);
    }
    const name = `${getProperty(p.track, PID.NAME) ?? ''}${p.suffix ?? ''}`;
    const abbr = `${getProperty(p.track, PID.ABBREVIATION) ?? ''}${p.suffix ? ' (tab)' : ''}`;
    // percussion: the sounds used by the part are its <score-instrument> / <midi-instrument> (a note refers to one with <instrument id>)
    const sounds = new Map();
    for (const staff of p.staves) {
      if (getProperty(staff, PID.STAFF_TYPE) !== 'percussion') continue;
      const map = staffSoundMap(getProperty(staff, PID.PERCMAP));
      for (const voice of staff.voices) for (const measure of voice.measures) for (const item of measure.items) {
        if (item.type !== 'chord') continue;
        for (const note of [...item.notes, ...(item.graceNotes ?? []).flatMap((g2) => g2.notes)]) {
          const sound = drumSound(map, getProperty(note, PID.SOUND));
          if (sound && sound.midi != null) sounds.set(sound.midi, sound.name ?? sound.id);
        }
      }
    }
    p.sounds = sounds;
    const instruments = [...sounds].map(([midi, nm]) => `<score-instrument id="${p.id}-I${midi}"><instrument-name>${esc(nm)}</instrument-name></score-instrument>`).join('');
    const midis = [...sounds].map(([midi]) => `<midi-instrument id="${p.id}-I${midi}"><midi-channel>10</midi-channel><midi-unpitched>${midi + 1}</midi-unpitched></midi-instrument>`).join('');
    w(`<score-part id="${p.id}"><part-name>${esc(name)}</part-name>${abbr ? `<part-abbreviation>${esc(abbr)}</part-abbreviation>` : ''}${instruments}${midis}</score-part>`);
    for (const { number } of stops.get(i) ?? []) w(`<part-group type="stop" number="${number}"/>`);
  });
  w('</part-list>');

  // ---- system objects: collected by measure, written in the first staff of the first part ----
  const barIndex = new Map(bars.map((b, i) => [b.id, i]));
  const sysByMeasure = bars.map(() => []);
  const pushSys = (mi, pos, xml) => { if (mi !== undefined && mi >= 0) sysByMeasure[mi].push({ pos, xml }); };
  const direction = (inner, sound = '') => `<direction placement="above"><direction-type>${inner}</direction-type>${sound}</direction>`;
  const withOffset = (pos, xml) => (fEq(pos, ZERO) ? xml : xml.replace('</direction-type>', `</direction-type><offset>${dur(pos)}</offset>`));
  const beatUnitXml = (u) => `<beat-unit>${TYPE_NAME[u.base]}</beat-unit>${'<beat-unit-dot/>'.repeat(u.dots ?? 0)}`;
  const markerLabels = new Map();
  for (const t of mv.tempos) {
    const mi = barIndex.get(getProperty(t, PID.MEASURE_ID)); const pos = getProperty(t, PID.POSITION) ?? ZERO;
    const kind = getProperty(t, PID.TEMPO_KIND);
    const text = getProperty(t, PID.TEXT);
    if (kind === 'aTempo' || kind === 'tempoPrimo') { pushSys(mi, pos, withOffset(pos, direction(`<words>${kind === 'aTempo' ? 'a tempo' : 'tempo primo'}</words>`))); continue; }
    const bpm = getProperty(t, PID.TEMPO_BPM); const unit = getProperty(t, PID.BEAT_UNIT);
    const qpm = Math.round(bpm * fToNumber(beatUnitFraction(unit)) * 4 * 100) / 100;
    const sound = `<sound tempo="${qpm}"/>`;
    if (text && !/[=]/.test(text)) pushSys(mi, pos, withOffset(pos, direction(`<words>${esc(text)}</words>`, sound)));
    else pushSys(mi, pos, withOffset(pos, direction(`<metronome parentheses="no">${beatUnitXml(unit)}<per-minute>${bpm}</per-minute></metronome>`, sound)));
  }
  for (const c of mv.tempoChanges) {
    const mi = barIndex.get(getProperty(c, PID.MEASURE_ID)); const pos = getProperty(c, PID.POSITION) ?? ZERO;
    const text = getProperty(c, PID.TEXT) || GRADUAL_TYPES[getProperty(c, PID.CHANGE_TYPE)]?.text;
    if (text) pushSys(mi, pos, withOffset(pos, direction(`<words>${esc(text)}</words>`)));
  }
  for (const s of mv.swings) {
    if (getProperty(s, PID.TARGET_STAFF_ID)) continue;
    const mi = barIndex.get(getProperty(s, PID.MEASURE_ID)); const pos = getProperty(s, PID.POSITION) ?? ZERO;
    const unit = getProperty(s, PID.SWING_UNIT); const ratio = getProperty(s, PID.SWING_RATIO);
    const words = getProperty(s, PID.TEXT);
    let swing;
    if (unit === 'none') swing = '<swing><straight/></swing>';
    else { const g = gcd(ratio, 100 - ratio) || 1; swing = `<swing><first>${Math.max(1, ratio / g)}</first><second>${Math.max(1, (100 - ratio) / g)}</second><swing-type>${unit === '16th' ? '16th' : 'eighth'}</swing-type></swing>`; }
    pushSys(mi, pos, withOffset(pos, direction(words ? `<words>${esc(words)}</words>` : '<words/>', `<sound>${swing}</sound>`)));
  }
  for (const r of mv.rehearsalMarks ?? []) {
    const mi = barIndex.get(getProperty(r, PID.MEASURE_ID));
    pushSys(mi, ZERO, direction(`<rehearsal>${esc(getProperty(r, PID.TEXT))}</rehearsal>`));
  }
  for (const m of mv.markers) {
    const mi = barIndex.get(getProperty(m, PID.MEASURE_ID));
    const type = getProperty(m, PID.MARKER_TYPE); const label = markerLabel(m);
    const parts2 = markerParts(m);
    const word = parts2.filter((p) => p.text).map((p) => p.text).join('').trim();
    if (type === 'segno' || type === 'varsegno') pushSys(mi, ZERO, direction('<segno/>', `<sound segno="${esc(label)}"/>`));
    else if (type === 'coda' || type === 'varcoda' || type === 'codetta') pushSys(mi, ZERO, direction('<coda/>', `<sound coda="${esc(label)}"/>`));
    else if (type === 'fine') pushSys(mi, ZERO, direction('<words>Fine</words>', '<sound fine="yes"/>'));
    else pushSys(mi, ZERO, direction(`<words>${esc(word || type)}</words>`, `<sound tocoda="${esc(label)}"/>`));
    markerLabels.set(label, true);
  }
  for (const j of mv.jumps) {
    const mi = barIndex.get(getProperty(j, PID.MEASURE_ID));
    const { jumpTo } = jumpLabels(j);
    const sound = jumpTo === 'start' ? '<sound dacapo="yes"/>' : `<sound dalsegno="${esc(jumpTo)}"/>`;
    pushSys(mi, ZERO, direction(`<words>${esc(jumpText(j))}</words>`, sound));
  }
  // fermatas attach to the first note at their instant of the first staff of the first part (MusicXML: a notation of a note)
  const fermatas = new Map();
  for (const f of mv.fermatas) {
    const mi = barIndex.get(getProperty(f, PID.MEASURE_ID));
    if (mi !== undefined) fermatas.set(posKey(mi, getProperty(f, PID.POSITION) ?? ZERO), FERMATA_SHAPE[getProperty(f, PID.FERMATA_TYPE)] ?? 'normal');
  }
  const usedFermatas = new Set();

  // ---- repeats and endings ----
  const voltaStart = new Map(); const voltaStop = new Map();
  for (const v of mv.voltas) {
    const mi = barIndex.get(getProperty(v, PID.MEASURE_ID));
    if (mi === undefined) continue;
    const numbers = (getProperty(v, PID.VOLTA_NUMBERS) ?? [1]).join(', ');
    const span = getProperty(v, PID.SPAN) ?? 1;
    voltaStart.set(mi, numbers);
    voltaStop.set(Math.min(n - 1, mi + span - 1), { numbers, open: !!getProperty(v, PID.VOLTA_OPEN) });
  }

  // ---- parts ----
  parts.forEach((part, partIndex) => {
    const { track, staves } = part;
    const iv = trackTransposition(track);
    const transposes = iv && !intervalIsZero(iv);
    const prefer = getProperty(track, PID.PREFER_SHARP_FLAT);
    const timelines = staves.map((s) => clefTimeline(s, mv, false));
    // ties of each staff: start / stop by note identity
    const tieStart = new Set(); const tieStop = new Set();
    for (const s of staves) for (const t of getProperty(s, PID.TIES) ?? []) { tieStart.add(t.startNoteId); tieStop.add(t.endNoteId); }
    const tuningChangesOf = staves.map((s) => ((getProperty(s, PID.STRING_TUNINGS) ?? []).some((e) => Array.isArray(e.tuning)) ? tuningChanges(mv, s) : []));
    const capoTimelines = staves.map((s) => ((getProperty(s, PID.CAPOS) ?? []).length ? capoTimeline(mv, s) : []));
    const stradella = resolveStradellaTable(undefined);
    const lyricTexts = getProperty(work, PID.LYRIC_TEXTS) ?? [];
    const marks = staves.map((s) => staffMarkIndex(s, { lyricTexts, measureIndexOf: (id) => barIndex.get(id) ?? -1 }));
    // the syllables of the lyrics tracks (events): those linked to a chord are written as <lyric> on its note, the others as <words> at their instant (in the first part)
    const lyricMarks = lyricEventMarks(mv);
    for (const index of marks) for (const [id, list] of lyricMarks.byChord) index.lyrics.set(id, [...(index.lyrics.get(id) ?? []), ...list]);
    // chord symbols of the chord staves of this track: written in the first exported staff (as <harmony>, with an offset)
    const harmonies = bars.map(() => []);
    // fingerings to write as <frame>: the diagram a chord symbol carries, and the diagrams of the containers that follow the chord staff (one per symbol)
    const { frames, standalone } = diagramFrames(work, mv);
    // chord staves of tracks that have no exported staff: their symbols go to the first part
    const harmonySources = [...track.staves, ...(partIndex === 0 ? mv.tracks.filter((t) => !partIndexOfTrack.has(t.id)).flatMap((t) => t.staves) : [])];
    for (const s of harmonySources) {
      if (getProperty(s, PID.STAFF_TYPE) !== 'chord') continue;
      for (const voice of s.voices) voice.measures.forEach((measure, mi) => {
        for (const sym of measure.items) {
          if (sym.type !== 'chordsymbol') continue;
          const pos = getProperty(sym, PID.POSITION) ?? ZERO;
          const xml = harmonyXml(sym, { offset: fEq(pos, ZERO) ? 0 : dur(pos), staff: staves.length > 1 ? 1 : null, frame: frameXml(frames.get(sym.id)) });
          if (xml) harmonies[mi].push({ pos, xml });
        }
      });
    }
    if (partIndex === 0) for (const e of lyricMarks.loose) harmonies[e.measure]?.push({ pos: e.position, xml: dirXml(`<words>${esc(e.text)}</words>`, { offset: fEq(e.position, ZERO) ? 0 : dur(e.position), staff: staves.length > 1 ? 1 : null }) });
    // a diagram container for ONE chord has no symbol to hang on: its chord is written as a harmony of its own at its measure (in the first part), unless the chord staff already has that chord there
    if (partIndex === 0) for (const e of standalone) harmonies[e.mi].push({ pos: e.after ? barLengths[e.mi] : ZERO, xml: harmonyXmlOf({ root: e.chord.root, quality: e.chord.quality, bass: e.chord.bass }, { offset: e.after ? dur(barLengths[e.mi]) : 0, staff: staves.length > 1 ? 1 : null, frame: frameXml(e.voicing) }) });
    w(`<part id="${part.id}">`);
    for (let mi = 0; mi < n; mi += 1) {
      const bar = bars[mi];
      const irregularFirst = mi === 0 && isIrregularMeasure(bar);
      w(`<measure number="${irregularFirst ? 0 : mi + (isIrregularMeasure(bars[0]) ? 0 : 1)}"${irregularFirst ? ' implicit="yes"' : ''}>`);
      // attributes at the start of the measure: first measure, or whatever changed
      const key = transposes ? writtenKey(concertKeys[mi], iv, prefer) : concertKeys[mi];
      const prevKey = mi > 0 ? (transposes ? writtenKey(concertKeys[mi - 1], iv, prefer) : concertKeys[mi - 1]) : null;
      const ts = getProperty(bar, PID.TIME_SIG);
      const prevTs = mi > 0 ? getProperty(bars[mi - 1], PID.TIME_SIG) : null;
      const style = getProperty(bar, PID.TIME_SIG_STYLE);
      const prevStyle = mi > 0 ? getProperty(bars[mi - 1], PID.TIME_SIG_STYLE) : null;
      const attrs = [];
      if (mi === 0) attrs.push(`<divisions>${divisions}</divisions>`);
      if (mi === 0 || key !== prevKey) attrs.push(`<key><fifths>${key}</fifths></key>`);
      if (mi === 0 || ts[0] !== prevTs[0] || ts[1] !== prevTs[1] || style !== prevStyle) {
        const symbol = ts[0] === 4 && ts[1] === 4 && style === 'common' ? ' symbol="common"' : ts[0] === 2 && ts[1] === 2 && style === 'cut' ? ' symbol="cut"' : '';
        attrs.push(`<time${symbol}><beats>${ts[0]}</beats><beat-type>${ts[1]}</beat-type></time>`);
      }
      if (mi === 0 && staves.length > 1) attrs.push(`<staves>${staves.length}</staves>`);
      staves.forEach((staff, si) => {
        const stype = getProperty(staff, PID.STAFF_TYPE);
        const fixed = { tab: ['TAB', 5, 0], percussion: ['percussion', 2, 0], neutral: ['percussion', 2, 0], rhythm: ['G', 2, 0], 'accordion-left': ['F', 4, 0] }[stype];
        const now = fixed ? stype : clefAt(timelines[si], mi, ZERO);
        const before = fixed ? stype : (mi > 0 ? clefAt(timelines[si], mi - 1, barLengths[mi - 1]) : null);
        if (mi === 0 || now !== before) {
          const [sign, line, oct] = fixed ?? CLEF_SIGN[now] ?? CLEF_SIGN.G;
          attrs.push(`<clef${staves.length > 1 ? ` number="${si + 1}"` : ''}><sign>${sign}</sign><line>${line}</line>${oct ? `<clef-octave-change>${oct}</clef-octave-change>` : ''}</clef>`);
        }
      });
      if (mi === 0) {
        staves.forEach((staff, si) => {
          const stype = getProperty(staff, PID.STAFF_TYPE);
          const number = staves.length > 1 ? ` number="${si + 1}"` : '';
          if (stype === 'tab') {
            const tuning = tuningPitches(staff);
            const tuned = tuning.map((pitch, i) => { const sp = defaultSpelling(pitch, 0); return `<staff-tuning line="${tuning.length - i}"><tuning-step>${sp.step}</tuning-step>${sp.alter ? `<tuning-alter>${sp.alter}</tuning-alter>` : ''}<tuning-octave>${sp.octave}</tuning-octave></staff-tuning>`; }).join('');
            attrs.push(`<staff-details${number}><staff-lines>${tuning.length}</staff-lines>${tuned}</staff-details>`);
          } else if (stype === 'percussion' || stype === 'rhythm' || stype === 'neutral') {
            const lines = getProperty(staff, PID.LINE_COUNT);
            if (Number.isInteger(lines) && lines !== 5) attrs.push(`<staff-details${number}><staff-lines>${lines}</staff-lines></staff-details>`);
          }
        });
      }
      if (mi === 0 && transposes) {
        const oct = Math.trunc(iv.chromatic / 12); const chrom = iv.chromatic - oct * 12;
        const dia = iv.diatonic - Math.trunc(iv.diatonic / 7) * 7;
        attrs.push(`<transpose><diatonic>${dia}</diatonic><chromatic>${chrom}</chromatic>${oct ? `<octave-change>${oct}</octave-change>` : ''}</transpose>`);
      }
      if (attrs.length) w(`<attributes>${attrs.join('')}</attributes>`);

      // left barline: start repeat, ending start
      const left = [];
      if (voltaStart.has(mi)) left.push(`<ending number="${esc(voltaStart.get(mi))}" type="start"/>`);
      if (getProperty(bar, PID.REPEAT_START)) left.unshift('<bar-style>heavy-light</bar-style>');
      if (getProperty(bar, PID.REPEAT_START)) left.push('<repeat direction="forward"/>');
      if (left.length) w(`<barline location="left">${left.join('')}</barline>`);

      // system objects (first staff of the first part)
      if (partIndex === 0) for (const s of sysByMeasure[mi]) w(s.xml);
      for (const h of harmonies[mi].sort((a, b) => fCmp(a.pos, b.pos))) w(h.xml);
      staves.forEach((staff, si) => {
        // free texts and technique texts of the staff: <words> at their instant
        for (const t of getProperty(staff, PID.STAFF_TEXTS) ?? []) {
          if (t.measureId !== bar.id) continue;
          const attrs = `${t.style === 'italic' ? ' font-style="italic"' : ''}${t.style === 'bold' ? ' font-weight="bold"' : ''}`;
          w(dirXml(`<words${attrs}>${esc(t.text)}</words>`, { offset: fEq(t.position, ZERO) ? 0 : dur(t.position), staff: staves.length > 1 ? si + 1 : null, placement: t.placement }));
        }
        for (const p of marks[si].pedals) {
          const staffNo = staves.length > 1 ? si + 1 : null;
          if (p.start.mi === mi) w(dirXml('<pedal type="start" line="yes"/>', { offset: fEq(p.start.position ?? ZERO, ZERO) ? 0 : dur(p.start.position), staff: staffNo }));
          if (p.end.mi === mi) w(dirXml('<pedal type="stop" line="yes"/>', { offset: fEq(p.end.position ?? ZERO, ZERO) ? 0 : dur(p.end.position), staff: staffNo }));
        }
      });

      // content: staves one after another, voices one after another, each followed by a <backup> when something follows
      const groups = [];
      staves.forEach((staff, si) => {
        staff.voices.forEach((voice, v) => {
          const measure = voice.measures[mi];
          if (measure && measure.items.length) groups.push({ staff, si, v, measure });
        });
      });
      groups.forEach((g, gi) => {
        const conv = transposes ? { iv, concertKey: concertKeys[mi], prefer } : null;
        let at = ZERO;
        const items = g.measure.items;
        const tupletIds = items.map((it) => getProperty(it, PID.TUPLET)?.id ?? null);
        items.forEach((item, idx) => {
          if (item.type !== 'chord' && item.type !== 'rest') return;
          const length = itemDuration(item, barLengths[mi]);
          const d = dur(length);
          const voiceNumber = g.si * 4 + g.v + 1;
          const staffTag = staves.length > 1 ? `<staff>${g.si + 1}</staff>` : '';
          const tuplet = getProperty(item, PID.TUPLET);
          const written = getProperty(item, PID.DURATION);
          const isMeasureRest = written?.base === 'measure';
          const typeXml = isMeasureRest ? '' : `<type>${TYPE_NAME[written.base] ?? 'quarter'}</type>${'<dot/>'.repeat(written.dots ?? 0)}`;
          const tmod = tuplet ? `<time-modification><actual-notes>${tuplet.ratio[0]}</actual-notes><normal-notes>${tuplet.ratio[1]}</normal-notes>${tuplet.base?.base && tuplet.base.base !== written.base ? `<normal-type>${TYPE_NAME[tuplet.base.base]}</normal-type>` : ''}</time-modification>` : '';
          const tupletStart = tuplet && tupletIds[idx - 1] !== tuplet.id;
          const tupletStop = tuplet && tupletIds[idx + 1] !== tuplet.id;
          const tupletNotation = tupletStart ? '<tuplet type="start" number="1" bracket="yes"/>' : tupletStop ? '<tuplet type="stop" number="1"/>' : '';
          if (item.type === 'rest') {
            if (getProperty(item, PID.GAP)) { w(`<forward><duration>${d}</duration><voice>${voiceNumber}</voice>${staffTag}</forward>`); at = fAdd(at, length); return; }
            const notations = tupletNotation ? `<notations>${tupletNotation}</notations>` : '';
            w(`<note>${isMeasureRest ? '<rest measure="yes"/>' : '<rest/>'}<duration>${d}</duration><voice>${voiceNumber}</voice>${typeXml}${tmod}${staffTag}${notations}</note>`);
            at = fAdd(at, length);
            return;
          }
          const stypeHere = getProperty(g.staff, PID.STAFF_TYPE);
          const chord = conv && stypeHere === 'score' ? writtenChord(item, conv) : item; // only a staff of notation shows written pitches (tablature, percussion… have no spelling)
          const index = marks[g.si];
          for (const d of chordDirections(item, index, { staff: staves.length > 1 ? g.si + 1 : null })) w(d);
          const pitchedXml = (sp) => `<pitch><step>${sp.step}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`;
          /** What differs by staff type: the <pitch> / <unpitched> element, notehead, instrument, stem, tablature technical. */
          const describe = (note, isGrace) => {
            const base = { stem: '', notehead: noteheadOverride(note), instrument: '', technical: '' };
            if (stypeHere === 'tab') {
              const pitch = getProperty(note, PID.PITCH);
              const string = getProperty(note, PID.STRING) ?? 1;
              const tuning = tuningChangesOf[g.si].length ? tuningPitchesAt(mv, g.staff, [mi, at]) : tuningPitches(g.staff);
              const capo = capoTimelines[g.si].length ? capoAt(capoTimelines[g.si], [mi, at]) : NO_CAPO;
              const fret = Math.max(0, derivedFret(pitch, tuning[string - 1] ?? pitch, capo, string));
              return { ...base, pitch: pitchedXml(defaultSpelling(pitch, concertKeys[mi])), technical: `<technical><string>${string}</string><fret>${fret}</fret></technical>` };
            }
            if (stypeHere === 'percussion') {
              const sound = drumSound(staffSoundMap(getProperty(g.staff, PID.PERCMAP)), getProperty(note, PID.SOUND));
              const lines = getProperty(g.staff, PID.LINE_COUNT) ?? 5;
              const top = 5 * 7 + 3; // F5: the top line of a five-line staff
              const idx = top - (sound ? sound.line : lines - 1);
              const dstep = STEPS[((idx % 7) + 7) % 7]; const doct = Math.floor(idx / 7);
              const head = sound ? NOTEHEAD_OF_GROUP[sound.head] : null;
              return {
                ...base, pitch: `<unpitched><display-step>${dstep}</display-step><display-octave>${doct}</display-octave></unpitched>`,
                notehead: head ? `<notehead>${head}</notehead>` : noteheadOverride(note), instrument: sound && sound.midi != null ? `<instrument id="${part.id}-I${sound.midi}"/>` : '',
                stem: sound && (sound.stemDirection === 'up' || sound.stemDirection === 'down') ? `<stem>${sound.stemDirection}</stem>` : '',
              };
            }
            if (stypeHere === 'rhythm' || stypeHere === 'neutral') {
              const slash = stypeHere === 'rhythm' && getProperty(g.staff, PID.RHYTHM_HEAD) !== 'normal';
              const stem = getProperty(item, PID.STEM_DIRECTION);
              const dir = stem === 'up' || stem === 'down' ? stem : getProperty(g.staff, PID.RHYTHM_STEM) === 'up' ? 'up' : 'down';
              return { ...base, pitch: pitchedXml({ step: 'B', alter: 0, octave: 4 }), notehead: slash ? '<notehead>slash</notehead>' : '', stem: `<stem>${dir}</stem>` };
            }
            if (stypeHere === 'accordion-left') {
              const pitch = getProperty(note, PID.PITCH);
              const row = getProperty(note, PID.ACC_ROW);
              const pitches = isChordRow(row) ? stradellaChordPitches(stradella, ACC_ROW_QUALITY[row], pitch) : [pitch];
              return { ...base, pitches: pitches.map((p2) => pitchedXml(defaultSpelling(p2, concertKeys[mi]))) };
            }
            const pitch = note.pitch ?? getProperty(note, PID.PITCH);
            return { ...base, pitch: pitchedXml(spellingOf(pitch, note.spelling ?? getProperty(note, PID.SPELLING), conv ? conv.concertKey : concertKeys[mi])) };
          };
          const noteXml = (note, isChord, isGrace, notationsExtra, ni0 = 0) => {
            const desc = describe(note, isGrace);
            if (desc.pitches) { // an accordion button of a chord row: several pitches of one note
              return desc.pitches.map((px, k) => noteXml2(note, isChord || k > 0, isGrace, k === 0 ? notationsExtra : '', ni0, { ...desc, pitch: px })).join('');
            }
            return noteXml2(note, isChord, isGrace, notationsExtra, ni0, desc);
          };
          const noteXml2 = (note, isChord, isGrace, notationsExtra, ni0, desc) => {
            const stops = !isGrace && tieStop.has(note.id); const starts = !isGrace && tieStart.has(note.id);
            const tieXml = `${stops ? '<tie type="stop"/>' : ''}${starts ? '<tie type="start"/>' : ''}`;
            const tiedXml = `${stops ? '<tied type="stop"/>' : ''}${starts ? '<tied type="start"/>' : ''}`;
            const notations = [tiedXml, notationsExtra, desc.technical, tupletNotation].filter(Boolean).join('');
            const lyricXml = !isGrace && !isChord && ni0 === 0 ? chordLyrics(item, marks[g.si]) : '';
            return `<note>${isGrace ? `<grace${isGrace === 'slash' ? ' slash="yes"' : ''}${isGrace === 'after' ? ' steal-time-previous="25"' : ''}/>` : ''}${isChord ? '<chord/>' : ''}${desc.pitch}${isGrace ? '' : `<duration>${d}</duration>`}${tieXml}${desc.instrument}<voice>${voiceNumber}</voice>${isGrace ? `<type>${TYPE_NAME[getProperty(item, PID.DURATION)?.base] ?? 'eighth'}</type>` : typeXml}${isGrace ? '' : tmod}${desc.stem}${desc.notehead}${staffTag}${notations ? `<notations>${notations}</notations>` : ''}${lyricXml}</note>`;
          };
          // a bend that starts on a grace note (the next link of a chain of landing notes after the main note)
          const graceBends = (note) => {
            const pieces = (marks[g.si].bends.get(note.id) ?? []).filter((piece) => piece !== '<scoop-articulation/>');
            return pieces.length ? `<technical>${pieces.join('')}</technical>` : '';
          };
          // grace notes before the main chord (the written-chord view carries them)
          for (const gr of chord.graceNotes ?? []) {
            const graceType = getProperty(gr, PID.GRACE_TYPE);
            if (/after$/.test(String(graceType))) continue;
            const slash = graceType === 'acciaccatura' ? 'slash' : true;
            gr.notes.forEach((note, ni) => w(noteXml(note, ni > 0, slash, '').replace(/<type>[^<]*<\/type>/, `<type>${TYPE_NAME[getProperty(gr, PID.DURATION)?.base] ?? 'eighth'}</type>`)));
          }
          const fermataShape = partIndex === 0 && g.si === 0 && g.v === 0 && fermatas.has(posKey(mi, at)) ? fermatas.get(posKey(mi, at)) : null;
          if (fermataShape) usedFermatas.add(posKey(mi, at));
          chord.notes.forEach((note, ni) => {
            const extra = [];
            if (ni === 0 && fermataShape) extra.push(`<fermata type="upright">${fermataShape}</fermata>`);
            extra.push(...noteNotations(item, note, marks[g.si], { first: ni === 0 }));
            w(noteXml(note, ni > 0, false, extra.join(''), ni));
          });
          for (const gr of chord.graceNotes ?? []) {
            const graceType = getProperty(gr, PID.GRACE_TYPE);
            if (!/after$/.test(String(graceType))) continue;
            gr.notes.forEach((note, ni) => w(noteXml(note, ni > 0, 'after', graceBends(note)).replace(/<type>[^<]*<\/type>/, `<type>${TYPE_NAME[getProperty(gr, PID.DURATION)?.base] ?? 'eighth'}</type>`)));
          }
          at = fAdd(at, length);
        });
        if (gi < groups.length - 1) w(`<backup><duration>${dur(at)}</duration></backup>`);
      });

      // right barline: style, ending stop, backward repeat
      const right = [];
      const style2 = BAR_STYLE[getProperty(bar, PID.BAR_TYPE)] ?? null;
      const repeatEnd = !!getProperty(bar, PID.REPEAT_END);
      if (repeatEnd) right.push('<bar-style>light-heavy</bar-style>');
      else if (style2 && !(mi === n - 1 && style2 === 'light-heavy' && false)) right.push(`<bar-style>${style2}</bar-style>`);
      const stop = voltaStop.get(mi);
      if (stop) right.push(`<ending number="${esc(stop.numbers)}" type="${stop.open ? 'discontinue' : 'stop'}"/>`);
      if (repeatEnd) { const times = getProperty(bar, PID.REPEAT_COUNT) ?? 2; right.push(`<repeat direction="backward"${times > 2 ? ` times="${times}"` : ''}/>`); }
      if (right.length) w(`<barline location="right">${right.join('')}</barline>`);
      w('</measure>');
    }
    w('</part>');
  });
  w('</score-partwise>');
  for (const key of fermatas.keys()) if (!usedFermatas.has(key)) warnings.push(`A fermata at ${key} has no note to attach to and is not exported`);
  void fSub; void fCmp; void clefKeyOf;
  return { xml: out.join('\n') + '\n', warnings };
}
