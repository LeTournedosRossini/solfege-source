/*
 * MIDI import (Standard MIDI Files, formats 0 and 1). PURE: no DOM. It IMPORTS, it does not TRANSCRIBE: the target is a file made by a machine (a sequencer, a
 * notation program, a drum machine), whose notes sit on a grid; a performance played by hand will come out approximate and needs retouching.
 *
 *   describeMidi(bytes)                         → what the file holds, for the import window: { format, measures, timeSig, bpm, parts: [{ id, name, drums, notes, … }], ignored }
 *   importMidi(bytes, options, { onProgress })  → { work, report, errors, meta }   (same contract as `importMusicXml`)
 *   importMidiBytes(bytes, options, onProgress) → the same, async (lets the interface paint between parts)
 *
 * options: { grid: 8 | 16 | 32 (denominator of the finest plain step, default 16), triplets: 'auto' | 'off' | 'on', durations: 'played' | 'chained',
 *            velocities: 'keep' (the velocity of each note, as an imposed velocity: `PID.USER_VELOCITY`) | 'off', lyrics: 'on' | 'off' (a « Paroles » track of
 *            events), markers: 'on' | 'off' (rehearsal marks), parts: ids of the parts to import (default all), title, maxMeasures: only the first measures (a preview) }
 * One track per (MIDI track, channel) that holds notes; channel 10 is the drums (one percussion staff with the map of Scorsaire). Time signatures, key signatures and
 * tempos of the file are kept; controllers, pitch bend and aftertouch are ignored (the report counts them). See midi-quantize.js for the rules of the grid.
 */
import { frac, fSub, fMul } from '../model/fraction.js';
import { PID } from '../model/pid.js';
import {
  createWork, createMovement, createTrack, createStaff, createVoice, createMeasure, createMasterbar, createNote, createChord, createRest, createPercNote, createTie,
  createTempo, createRehearsalMark,
} from '../model/elements.js';
import { defaultSpelling } from '../model/pitch.js';
import { toRhythmicDurationList } from '../model/rhythmsplit.js';
import { measureOffsetOf } from '../model/timing.js';
import { newId } from '../model/ids.js';
import { createPercMap, DEFAULT_PERCMAP, drumSoundForMidi } from '../model/percmap.js';
import { validateWork } from '../model/validate.js';
import { lyricsTrackFor, placeSyllables } from '../model/lyricevents.js';
import { createReport } from './report.js';
import { readMidi, MidiError } from './midi-read.js';
import { buildTimebase, quantizeNotes, groupChords, assignVoices, drumGroups } from './midi-quantize.js';
import { durationOfFraction } from './musicxml-build.js';
import catalog from '../model/instrument-catalog.json' with { type: 'json' };

export { MidiError };
export const MIDI_DEFAULTS = Object.freeze({ grid: 16, triplets: 'auto', durations: 'played', velocities: 'keep', lyrics: 'on', markers: 'on' });

let programIndex = null;
/** Catalogue id of the instrument of a General MIDI program (0–127): the lowest rank of the pitched instruments that use it. */
export function instrumentOfProgram(program) {
  if (!Number.isInteger(program)) return null;
  if (!programIndex) {
    programIndex = new Map();
    for (const [id, info] of Object.entries(catalog.instruments)) {
      if (info.program == null || info.group === 'unpitched-percussion') continue;
      const old = programIndex.get(info.program);
      if (!old || (info.seq ?? 1e9) < old.seq) programIndex.set(info.program, { id, seq: info.seq ?? 1e9 });
    }
  }
  return programIndex.get(program)?.id ?? null;
}

// ---------- the parts of a file ----------

/** One part per (track, channel) holding notes. Returns [{ id, track, channel, name, program, drums, notes }]. */
function listParts(raw) {
  const program = new Map();
  for (const t of raw.tracks) for (const [ch, p] of t.programs) if (!program.has(ch)) program.set(ch, p);
  const parts = [];
  for (const track of raw.tracks) {
    const channels = [...track.channels].sort((a, b) => a - b);
    for (const channel of channels) {
      const notes = track.notes.filter((n) => n.channel === channel);
      if (!notes.length) continue;
      const drums = channel === 9;
      const prog = program.get(channel);
      const instrument = drums ? null : instrumentOfProgram(prog ?? 0);
      const base = catalog.instruments[instrument]?.trackName;
      const name = (channels.length === 1 && track.name) ? track.name : (drums ? 'Drums' : (base ?? `Channel ${channel + 1}`));
      parts.push({ id: `t${track.index}c${channel}`, trackIndex: track.index, channel, name, program: prog ?? null, instrument, drums, notes });
    }
  }
  return parts;
}

/** What the import window shows before importing. */
export function describeMidi(input) {
  const raw = readMidi(input);
  const parts = listParts(raw);
  if (!parts.length) throw new MidiError('noNotes', 'The MIDI file holds no note');
  const first = raw.timeSigs[0];
  const tb = buildTimebase(raw, Math.max(...parts.map((p) => Math.max(...p.notes.map((n) => n.end)))), { grid: 16 }, createReport()); // (refuses a file that is too long, as the import would)
  return {
    format: raw.format,
    measures: tb.bars.length,
    division: raw.division,
    title: raw.tracks[0] && !raw.tracks[0].notes.length ? raw.tracks[0].name : '',
    timeSig: first ? [first.num, first.den] : [4, 4],
    timeSigChanges: Math.max(0, raw.timeSigs.length - 1),
    bpm: raw.tempos[0] ? Math.round(raw.tempos[0].bpm * 100) / 100 : 120,
    tempoChanges: Math.max(0, raw.tempos.length - 1),
    truncated: !!raw.truncated,
    ignored: raw.ignored,
    lyrics: raw.lyrics.filter((l) => l.text.trim()).length,
    markers: raw.markers.filter((m) => m.text).length,
    varied: parts.some((p) => new Set(p.notes.map((n) => n.velocity)).size > 1),
    parts: parts.map((p) => ({
      id: p.id, name: p.name, channel: p.channel + 1, drums: p.drums, instrument: p.instrument, notes: p.notes.length,
      lowest: Math.min(...p.notes.map((n) => n.midi)), highest: Math.max(...p.notes.map((n) => n.midi)),
    })),
  };
}

// ---------- lyrics and markers ----------

/**
 * Lyric events of the file → syllables [{ text, time (ticks) }]. The text of an event is one syllable; a space before or after it (or a « / » « \\ » line mark, a line
 * break) ends the word, otherwise the word goes on in the next syllable and gets the hyphen Scorsaire writes ("wait-" "ing").
 */
export function syllablesOfLyrics(events) {
  const list = [];
  for (const e of events) {
    const startsNew = /^[/\\]+/.test(e.text);
    const text = e.text.replace(/^[/\\]+/, '');
    const word = text.trim();
    if (!word) { if (list.length) list[list.length - 1].endsWord = true; continue; }
    list.push({ text: word, time: e.tick, startsWord: startsNew || /^\s/.test(text), endsWord: /\s$/.test(text) });
  }
  return list.map((s, i) => {
    const next = list[i + 1];
    const end = s.endsWord || !next || next.startsWord || s.text.endsWith('-');
    return { text: end ? s.text : `${s.text}-`, time: s.time };
  });
}

// ---------- items of one voice ----------

const barFraction = (bar) => frac(bar.num, bar.den);

/**
 * Items of every measure of ONE voice. `events`: [{ s, e (units), make(): fresh notes, tied: used by the pieces of an event }], sorted and without overlap.
 * `ctx`: { tb, trip (Set 'bar:window'), masterbars, voice (0 = first), ties (array to push), report }.
 */
function buildVoice(events, ctx) {
  const { tb, trip, masterbars, voice, ties } = ctx;
  const R = tb.R;
  const tripByBar = new Map();
  for (const key of trip) {
    const [b, w] = key.split(':').map(Number);
    if (!tripByBar.has(b)) tripByBar.set(b, []);
    tripByBar.get(b).push(w);
  }
  for (const list of tripByBar.values()) list.sort((a, b) => a - b);
  const nextTrip = (b, rel) => (tripByBar.get(b) ?? []).map((w) => w * tb.W).find((x) => x > rel);

  // 1. cut the events at barlines and at the edges of triplet windows
  const piecesByBar = tb.bars.map(() => []);
  for (const ev of events) {
    let t = ev.s; let first = true;
    while (t < ev.e) {
      const b = tb.barAt(t); const bar = tb.bars[b];
      const rel = t - bar.startU; const w = Math.floor(rel / tb.W);
      let end = Math.min(ev.e, bar.startU + bar.lenU);
      let inWindow = null;
      if (trip.has(`${b}:${w}`)) { inWindow = w; end = Math.min(end, bar.startU + (w + 1) * tb.W); } else {
        const nx = nextTrip(b, rel);
        if (nx !== undefined) end = Math.min(end, bar.startU + nx);
      }
      piecesByBar[b].push({ ev, s: t, e: end, w: inWindow, cont: !first });
      first = false; t = end;
    }
  }

  // 2. the items of each measure
  const written = (units) => durationOfFraction(fMul(frac(units, R), frac(3, 2)));
  return tb.bars.map((bar, b) => {
    const mb = masterbars[b];
    const timeSig = [bar.num, bar.den];
    const len = barFraction(bar);
    const offset = measureOffsetOf(mb, b === 0);
    const opts = (isRest, start, allowMeasureRest) => ({ isRest, start, timeSig, measureLength: len, allowMeasureRest, offset, maxDots: 1 });
    const items = [];
    const gap = voice > 0;
    const at = (u) => frac(u - bar.startU, R);
    const pushRest = (from, to) => {
      if (to <= from) return;
      const whole = from === bar.startU && to === bar.startU + bar.lenU;
      for (const d of toRhythmicDurationList(fSub(at(to), at(from)), opts(true, at(from), !gap && whole))) items.push(createRest({ duration: d.base, dots: d.dots, gap }));
    };
    const emitChord = (piece, from, to, extra = {}) => {
      const ev = piece.ev;
      const durations = extra.single ? [extra.single] : toRhythmicDurationList(fSub(at(to), at(from)), opts(false, at(from), false));
      for (const d of durations) {
        const notes = ev.make(!!ev.last);
        const chord = createChord({ duration: d.base, dots: d.dots, notes: notes.map((x) => x.el), props: extra.tuplet ? { [PID.TUPLET]: extra.tuplet } : {} });
        items.push(chord);
        if (ev.last) notes.forEach((x, i) => { if (ev.last[i]) ties.push(createTie(ev.last[i].el.id, x.el.id)); });
        ev.last = notes;
      }
    };
    let cursor = bar.startU;
    const pieces = piecesByBar[b];
    for (let i = 0; i < pieces.length;) {
      const p = pieces[i];
      if (p.w === null) {
        pushRest(cursor, p.s);
        emitChord(p, p.s, p.e);
        cursor = p.e; i += 1; continue;
      }
      // the pieces of one triplet window
      const ws = bar.startU + p.w * tb.W; const we = ws + tb.W;
      const group = [];
      while (i < pieces.length && pieces[i].w === p.w) { group.push(pieces[i]); i += 1; }
      pushRest(cursor, ws);
      if (group.length === 1 && group[0].s === ws && group[0].e === we) { emitChord(group[0], ws, we); cursor = we; continue; } // one note fills it: plain
      const unit = durationOfFraction(frac(tb.W, 2 * R));
      const tuplet = { id: newId('tu'), ratio: [3, 2], base: unit };
      const tupProps = { [PID.TUPLET]: tuplet };
      let at0 = ws;
      const restSlots = (to) => {
        while (at0 < to) {
          const k = Math.min(2, (to - at0) / tb.slot);
          const d = written(k * tb.slot);
          items.push(createRest({ duration: d.base, dots: d.dots, gap, props: tupProps }));
          at0 += k * tb.slot;
        }
      };
      for (const g of group) {
        restSlots(g.s);
        const k = (g.e - g.s) / tb.slot;
        const d = written(g.e - g.s);
        if (k > 2 || !d) { emitChord(g, g.s, g.e); at0 = g.e; continue; } // (a member longer than two slots cannot be a triplet member: not reachable with whole-window pieces)
        emitChord(g, g.s, g.e, { single: d, tuplet });
        at0 = g.e;
      }
      restSlots(we);
      cursor = we;
    }
    pushRest(cursor, bar.startU + bar.lenU);
    if (voice > 0 && items.every((it) => it.type === 'rest' && it.props[PID.GAP] === true)) return [];
    return items;
  });
}

// ---------- the work ----------

const CLEF_SPLIT = 55; // below the median of a part: bass clef

function tempoItems(raw, tb, masterbars, report) {
  const out = [];
  let prev = null; let count = 0;
  for (const t of raw.tempos) {
    const u = t.tick * tb.factor;
    if (u >= tb.total) continue;
    const b = tb.barAt(u); const bar = tb.bars[b];
    const rel = Math.max(0, Math.round(u - bar.startU));
    const bpm = Math.round(t.bpm * 100) / 100;
    if (prev !== null && bpm === prev) continue;
    count += 1;
    if (count > 500) { report.warn('tempo.many', 'The file has more than 500 tempo changes: the following ones were ignored'); break; }
    const pos = rel === 0 ? [0, 1] : frac(rel, tb.R);
    out.push(createTempo({ measureId: masterbars[b].id, position: pos, bpm }));
    prev = bpm;
  }
  return out;
}

export function importMidi(input, options = {}, { onProgress } = {}) {
  const opts = { ...MIDI_DEFAULTS, ...options };
  const report = createReport();
  const raw = readMidi(input);
  let parts = listParts(raw);
  if (Array.isArray(opts.parts)) parts = parts.filter((p) => opts.parts.includes(p.id));
  if (!parts.length) throw new MidiError('noNotes', 'There is no note to import');
  if (raw.truncated) report.warn('midi.truncated', 'The MIDI file is cut short: what could be read was imported');
  let lastTick = Math.max(...parts.map((p) => Math.max(...p.notes.map((n) => n.end))));
  let tb = buildTimebase(raw, lastTick, { grid: opts.grid }, createReport());
  if (opts.maxMeasures && tb.bars.length > opts.maxMeasures) { // a preview: only the first measures are written
    const limit = tb.bars[opts.maxMeasures].startTick;
    parts = parts.map((p) => ({ ...p, notes: p.notes.filter((n) => n.tick < limit).map((n) => ({ ...n, end: Math.min(n.end, limit) })) })).filter((p) => p.notes.length);
    lastTick = limit;
  }
  tb = buildTimebase(raw, lastTick, { grid: opts.grid }, report);
  const masterbars = tb.bars.map((bar) => createMasterbar({ timeSig: [bar.num, bar.den], keySig: bar.key }));

  const tracks = [];
  let mixedWindows = 0; let tripletWindows = 0; let droppedDrums = 0; let noteCount = 0; const flatParts = []; let velocityParts = 0;
  parts.forEach((part, pi) => {
    onProgress?.({ stage: 'part', done: pi, total: parts.length, name: part.name });
    const q = quantizeNotes(part.notes, tb, { triplets: opts.triplets });
    // the velocity of each note, unless the whole part is struck at one velocity (a flat file: nothing to keep, the notes stay « automatic »)
    const levels = new Set(part.notes.map((n) => n.velocity));
    const writeVelocity = opts.velocities !== 'off' && levels.size > 1;
    if (opts.velocities !== 'off' && levels.size === 1) flatParts.push({ name: part.name, velocity: [...levels][0] });
    const velocityProps = (v, continued) => (writeVelocity && !continued && v > 0 ? { [PID.USER_VELOCITY]: Math.min(127, v) } : {});
    mixedWindows += q.mixed; tripletWindows += q.triplets.size;
    const ties = [];
    let voices; let staffType; let clef; let props = {};
    if (part.drums) {
      const map = createPercMap(DEFAULT_PERCMAP);
      const { voices: lines, dropped } = drumGroups(q.notes, (midi) => drumSoundForMidi(DEFAULT_PERCMAP, midi), tb);
      droppedDrums += dropped;
      voices = lines.map((groups, v) => ({
        groups: groups.map((g) => ({ s: g.s, e: g.e, make: (cont) => g.sounds.map((id) => ({ el: createPercNote({ sound: id, props: velocityProps(g.vel.get(id), cont) }) })) })),
        index: v,
      })).filter((l) => l.groups.length);
      staffType = 'percussion'; clef = 'PERC'; props = { [PID.PERCMAP]: map };
    } else {
      const groups = groupChords(q.notes, { durations: opts.durations });
      const report2 = report;
      let voiceOf; let merged = new Set();
      if (opts.durations === 'chained') voiceOf = new Array(groups.length).fill(0);
      else ({ voice: voiceOf, merged } = assignVoices(groups, report2));
      const keyOfBar = (u) => tb.bars[tb.barAt(u)].key;
      const mk = (g) => {
        const key = keyOfBar(g.s);
        const spec = g.midis.map((m) => defaultSpelling(m, key));
        return { s: g.s, e: g.e, make: (cont) => spec.map((sp, i) => ({ el: createNote({ ...sp, props: velocityProps(g.vel.get(g.midis[i]), cont) }) })) };
      };
      const lines = [[], [], [], []];
      groups.forEach((g, i) => { if (!merged.has(i)) lines[voiceOf[i]].push(mk(g)); });
      voices = lines.map((groups2, v) => ({ groups: groups2, index: v })).filter((l) => l.groups.length);
      const midis = part.notes.map((n) => n.midi).sort((a, b) => a - b);
      staffType = 'score'; clef = midis[midis.length >> 1] < CLEF_SPLIT ? 'F' : 'G';
    }
    noteCount += q.notes.length;
    if (writeVelocity) velocityParts += 1;
    const built = voices.map((line, k) => {
      line.groups.sort((a, b) => a.s - b.s);
      // after cuts two groups of a line must not overlap
      for (let i = 1; i < line.groups.length; i += 1) if (line.groups[i - 1].e > line.groups[i].s) line.groups[i - 1].e = line.groups[i].s;
      const events = line.groups.filter((g) => g.e > g.s);
      return buildVoice(events, { tb, trip: q.triplets, masterbars, voice: k, ties });
    });
    if (!built.length) built.push(buildVoice([], { tb, trip: new Set(), masterbars, voice: 0, ties }));
    const staffProps = { ...props };
    if (ties.length) staffProps[PID.TIES] = ties;
    const staff = createStaff({ type: staffType, clef, voices: built.map((measures) => createVoice(measures.map((items) => createMeasure(items)))), props: staffProps });
    const trackProps = {};
    if (part.instrument) trackProps[PID.INSTRUMENT_ID] = part.instrument;
    tracks.push(createTrack({
      name: part.name, abbreviation: '', transposition: part.instrument ? { diatonic: 0, chromatic: 0 } : null, staves: [staff], props: trackProps,
    }));
  });
  onProgress?.({ stage: 'done', done: parts.length, total: parts.length });
  const instrumentTracks = tracks.length;

  // lyrics: one « Paroles » track of events, each syllable at its instant (the grid of the lyrics track); markers: rehearsal marks
  const lengths = tb.bars.map(barFraction);
  const timeMap = {
    locate: (tick) => {
      const u = tick * tb.factor;
      if (u < 0) return { before: true };
      if (u >= tb.total) return { after: true };
      const b = tb.barAt(u); const bar = tb.bars[b];
      return { measure: b, ratio: (u - bar.startU) / bar.lenU };
    },
  };
  const limitTick = opts.maxMeasures ? lastTick : Infinity;
  let lyricCount = 0; let lyricsOutside = 0;
  const lyricsAll = syllablesOfLyrics(raw.lyrics);
  if (opts.lyrics !== 'off' && lyricsAll.length) {
    const syllables = lyricsAll.filter((x) => x.time < limitTick);
    const placed = placeSyllables(syllables, timeMap, lengths);
    lyricCount = placed.length; lyricsOutside = syllables.length - placed.length;
    if (placed.length) tracks.push(lyricsTrackFor(placed, tb.bars.length, { name: 'Paroles' }));
  }
  const rehearsalMarks = [];
  let markerCount = 0; let markersOutside = 0;
  if (opts.markers !== 'off') {
    const byBar = new Map();
    for (const m of raw.markers) {
      if (!m.text || m.tick >= limitTick) continue;
      const u = m.tick * tb.factor;
      if (u < 0 || u >= tb.total) { markersOutside += 1; continue; }
      const b = tb.barAt(u);
      const text = m.text.slice(0, 40);
      if (!byBar.has(b)) byBar.set(b, []);
      if (!byBar.get(b).includes(text)) byBar.get(b).push(text);
      markerCount += 1;
    }
    for (const [b, texts] of [...byBar].sort((x, y) => x[0] - y[0])) rehearsalMarks.push(createRehearsalMark({ measureId: masterbars[b].id, text: texts.join(' / ') }));
  }

  if (tripletWindows) report.info('triplets.found', 'Triplets were recognised', { windows: tripletWindows });
  if (mixedWindows) report.warn('triplets.mixed', 'Where triplets and plain values sound together in the same beat, plain values were written');
  if (droppedDrums) report.warn('drum.unmapped', 'Drum sounds that the drum map does not know were ignored', { notes: droppedDrums });
  const ig = raw.ignored;
  const lost = ig.controllers + ig.pitchBend + ig.aftertouch;
  if (lost) report.info('midi.controllers', 'Controllers, pitch bend and aftertouch were ignored', { count: lost });
  if (opts.lyrics === 'off' && lyricsAll.length) report.info('midi.lyrics', 'Lyrics of the file were not imported');
  if (opts.markers === 'off' && raw.markers.some((m) => m.text)) report.info('midi.markers', 'Markers of the file were not imported');
  if (lyricsOutside) for (let i = 0; i < lyricsOutside; i += 1) report.warn('midi.lyrics.outside', 'Some syllables fall after the last bar of the music and were left out');
  if (markersOutside) report.warn('midi.markers.outside', 'Some markers fall after the last bar of the music and were left out');
  if (raw.textsCut) report.warn('midi.texts.cut', 'The file holds more lyrics and markers than can be read: the following ones were left out');
  if (opts.velocities === 'off') { if (parts.some((p) => new Set(p.notes.map((n) => n.velocity)).size > 1)) report.info('velocity.off', 'The velocities of the file were not imported'); }
  for (let i = 0; i < velocityParts; i += 1) report.info('velocity.kept', 'The velocity of each note was kept for playback');
  for (const f of flatParts) report.info('velocity.flat', 'A part struck at one single velocity: no velocity written (the notes stay automatic)', { name: f.name, velocity: f.velocity });

  const title = opts.title ?? (raw.tracks[0] && !raw.tracks[0].notes.length ? raw.tracks[0].name : '');
  const movement = createMovement({ title: title ?? '', masterbars, tracks, rehearsalMarks, tempos: tempoItems(raw, tb, masterbars, report) });
  const work = createWork({ title: title ?? '', movements: [movement] });
  report.stat('measures', tb.bars.length);
  report.stat('tracks', instrumentTracks);
  if (lyricCount) report.stat('midiLyrics', lyricCount);
  if (markerCount) report.stat('midiMarkers', markerCount);
  report.stat('notes', noteCount);
  const errors = validateWork(work);
  return { work, report: report.result(), errors, meta: { title: title ?? '' } };
}

/** The same, asynchronous: yields to the interface between the parts (a progress message can be painted). */
export async function importMidiBytes(bytes, options = {}, onProgress) {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
  onProgress?.({ stage: 'read', done: 0, total: 1 });
  await wait();
  return importMidi(bytes, options, { onProgress });
}
