/*
 * MusicXML import, PASS 2a: builds the STRUCTURE of the work from the intermediate representation (musicxml-read.js): masterbars (time, key,
 * repeats, voltas, irregular measures), and for each part its staves, voices and their measures (chords, rests, tuplets, grace notes, ties).
 * The marks (dynamics, slurs, lyrics…) and the system objects are added by musicxml-marks.js, the final assembly is in musicxml.js.
 *
 * Model rules respected here (CLAUDE.md): voice 1 fills every measure exactly; a later voice may be absent from a measure, or hold invisible
 * "gap" rests where the file wrote nothing; tuplets are complete and contiguous; a long note that no single value can write is cut into
 * tied pieces; a rest that alone fills a regular measure is a measure rest; all pitches are stored in CONCERT pitch (the file gives the
 * written pitch and the part's <transpose>).
 */
import { frac, fAdd, fSub, fMul, fDiv, fCmp, fEq, fLt, ZERO } from '../model/fraction.js';
import { PID } from '../model/pid.js';
import {
  createNote, createChord, createRest, createTabNote, createPercNote, createRhythmNote, createTie, createMasterbar,
} from '../model/elements.js';
import { MEASURE_DURATION, actualDuration, writtenDuration, midiFromSpelling, DURATION_BASES } from '../model/pitch.js';
import { toRhythmicDurationList } from '../model/rhythmsplit.js';
import { measureOffsetOf } from '../model/timing.js';
import { newId } from '../model/ids.js';
import { transposeTpc, tpcOfSpelling, spellingFromTpc, transposeKey, PREFER } from '../model/transpose.js';
import { tuningPitches, convertPitch, NO_CAPO, pitchFromName } from '../model/capo.js';
import { createDrumSound, createPercMap, DEFAULT_PERCMAP, drumSoundForMidi } from '../model/percmap.js';

const TYPE_BASE = {
  breve: 'breve', whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', '16th': 'sixteenth', '32nd': 'thirtysecond', '64th': 'sixtyfourth',
};
const NOTE_BASES = DURATION_BASES.filter((b) => b !== MEASURE_DURATION);

/** { base, dots } writing exactly the fraction `f` (dots 0..3), or null. */
export function durationOfFraction(f) {
  if (f[0] <= 0) return null;
  for (const base of NOTE_BASES) {
    for (let dots = 0; dots <= 3; dots += 1) if (fEq(writtenDuration({ base, dots }), f)) return { base, dots };
  }
  return null;
}

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
/** Percussion line (half-spaces below the top line of a five-line staff, F5 = 0) of a display position { step, octave }. */
const drumPositionLine = ({ step, octave }) => 38 - (octave * 7 + (STEP_INDEX[step] ?? 0));

const durationOfType = (type, dots) => (TYPE_BASE[type] ? { base: TYPE_BASE[type], dots } : null);

// ---------- pitches ----------

/** Total interval of a <transpose> (written → sounding): { diatonic, chromatic } with octaves folded in; null when absent or zero. */
export function intervalOfTranspose(tr) {
  if (!tr) return null;
  const iv = { diatonic: tr.diatonic + 7 * tr.octaveChange, chromatic: tr.chromatic + 12 * tr.octaveChange };
  return iv.diatonic === 0 && iv.chromatic === 0 ? null : iv;
}

/** Concert spelling of a written pitch { step, alter, octave } for a part whose instrument interval is `iv` (written → sounding). */
export function concertSpelling(written, iv) {
  const alter = Math.round(written.alter);
  const w = { step: written.step, alter, octave: written.octave };
  if (!iv) return w;
  const pitch = midiFromSpelling(w) + iv.chromatic;
  const tpc = transposeTpc(tpcOfSpelling(w), iv, true);
  return spellingFromTpc(tpc, pitch);
}

// ---------- clefs ----------

/** Model clef key of a MusicXML clef, or null for TAB / percussion (staff types that do not use one). */
export function clefKeyOfXml(c) {
  const oct = c.octave ?? 0;
  if (c.sign === 'G') {
    if (c.line === 1) return 'G';
    return oct === 1 ? 'G8va' : oct === -1 ? 'G8vb' : oct === 2 ? 'G15ma' : oct === -2 ? 'G15mb' : 'G';
  }
  if (c.sign === 'F') return oct === 1 ? 'F8va' : oct === -1 ? 'F8vb' : oct === 2 ? 'F15ma' : oct === -2 ? 'F15mb' : 'F';
  if (c.sign === 'C') return `C${Math.min(5, Math.max(1, c.line ?? 3))}`;
  return null;
}

// ---------- barlines, voltas ----------

const BAR_STYLE = {
  'light-light': 'double', 'light-heavy': 'final', 'heavy-light': 'reverseFinal', heavy: 'heavy', 'heavy-heavy': 'heavyHeavy',
  dashed: 'dashed', dotted: 'dotted', short: 'short', tick: 'tick',
};

function voltaNumbers(text) {
  const out = [];
  for (const piece of String(text ?? '1').split(/[,;]/)) {
    const m = /(\d+)\s*-\s*(\d+)/.exec(piece);
    if (m) for (let k = Number(m[1]); k <= Number(m[2]) && k < 100; k += 1) out.push(k);
    else for (const d of piece.match(/\d+/g) ?? []) out.push(Number(d));
  }
  return out.length ? [...new Set(out)] : [1];
}

/** Interval (written → sounding) of a part: the first <transpose> met, null when the part does not transpose. */
export function partInterval(part) {
  for (const m of part.measures) for (const a of m.attrs) if (a.transpose) return intervalOfTranspose(a.transpose);
  return null;
}

/** Time signature, key, lengths, barlines of every measure of the work (shared by all the parts). */
export function buildBars(score, report) {
  const parts = score.parts;
  const nM = Math.max(0, ...parts.map((p) => p.measures.length));
  const ivs = parts.map(partInterval);
  const refPart = Math.max(0, ivs.findIndex((iv) => !iv));
  const bars = [];
  let time = { beats: 4, beatType: 4, additive: null, symbol: null }; let sawTime = false; void sawTime;
  const keyW = parts.map(() => 0); const keySeen = parts.map(() => false);
  for (let m = 0; m < nM; m += 1) {
    const bar = {
      repeatStart: false, repeatEnd: false, repeatTimes: null, barType: 'simple', voltaStart: null, voltaStop: null, markers: [], len: ZERO,
    };
    for (const [pi, part] of parts.entries()) {
      const me = part.measures[m];
      if (!me) continue;
      for (const a of me.attrs) {
        if (a.time && fEq(a.pos, ZERO)) { if (!bar.timeSet) { time = a.time; sawTime = true; bar.timeSet = true; } }
        else if (a.time) report.warn('time.mid', 'A time signature change in the middle of a measure is ignored');
        if (a.key) { keyW[pi] = a.key.fifths; keySeen[pi] = true; }
      }
      for (const b of me.barlines) {
        if (b.location === 'left') {
          if (b.repeat?.direction === 'forward') bar.repeatStart = true;
          if (b.ending?.type === 'start' && !bar.voltaStart) bar.voltaStart = voltaNumbers(b.ending.numbers);
        } else {
          if (b.repeat?.direction === 'backward') { bar.repeatEnd = true; bar.repeatTimes = b.repeat.times ?? bar.repeatTimes; }
          if (b.ending && (b.ending.type === 'stop' || b.ending.type === 'discontinue') && !bar.voltaStop) bar.voltaStop = { open: b.ending.type === 'discontinue' };
          if (b.style && BAR_STYLE[b.style] && bar.barType === 'simple') bar.barType = BAR_STYLE[b.style];
        }
      }
      if (fLt(bar.len, me.maxEnd)) bar.len = me.maxEnd;
    }
    bar.timeSig = [time.beats, time.beatType];
    bar.additive = time.additive;
    bar.timeStyle = time.symbol === 'common' && time.beats === 4 && time.beatType === 4 ? 'common' : time.symbol === 'cut' && time.beats === 2 && time.beatType === 2 ? 'cut' : 'normal';
    bar.nominal = frac(time.beats, time.beatType);
    // concert key: the key of the first part that does not transpose (else the first part), transposed back to concert pitch
    const written = keyW[refPart] ?? 0;
    bar.key = ivs[refPart] ? transposeKey(written, ivs[refPart], PREFER.NONE) : written;
    if (!(bar.len[0] > 0)) bar.len = bar.nominal;
    bar.irregular = !fEq(bar.len, bar.nominal);
    bars.push(bar);
  }
  void keySeen;
  if (bars.some((b) => b.repeatEnd && b.repeatTimes && b.repeatTimes > 2)) report.stat('repeats.times');
  return bars;
}

/** Masterbar elements of the bars, plus the volta list (needs the masterbar ids). */
export function createMasterbars(bars) {
  return bars.map((bar, m) => {
    const props = {};
    if (bar.repeatStart) props[PID.REPEAT_START] = true;
    if (bar.repeatEnd) { props[PID.REPEAT_END] = true; if (bar.repeatTimes && bar.repeatTimes !== 2 && bar.repeatTimes > 0) props[PID.REPEAT_COUNT] = bar.repeatTimes; }
    if (bar.irregular) props[PID.MEASURE_LENGTH] = bar.len;
    if (bar.additive && bar.additive.length > 1) props[PID.BEAM_GROUPING] = bar.additive;
    if (bar.timeStyle !== 'normal') props[PID.TIME_SIG_STYLE] = bar.timeStyle;
    void m;
    return createMasterbar({ timeSig: bar.timeSig, keySig: bar.key, barType: bar.repeatEnd ? 'simple' : bar.barType, props });
  });
}

/** Volta descriptions { start, span, numbers, open } from the bars. */
export function voltaSpecs(bars) {
  const out = [];
  for (let m = 0; m < bars.length; m += 1) {
    if (!bars[m].voltaStart) continue;
    let end = m; let open = false; let found = false;
    for (let k = m; k < bars.length; k += 1) {
      if (k > m && bars[k].voltaStart) break;
      if (bars[k].voltaStop) { end = k; open = bars[k].voltaStop.open; found = true; break; }
      end = k;
    }
    out.push({ start: m, span: end - m + 1, numbers: bars[m].voltaStart, open: found ? open : true });
  }
  return out;
}

// ---------- part analysis ----------

/** Staff types, clefs, tunings, percussion maps of a part; the per-measure event lists. */
export function analyzePart(part, partIndex, bars, report) {
  const info = part.info;
  const measures = part.measures;
  let nStaves = 1;
  for (const m of measures) {
    for (const a of m.attrs) if (a.staves) nStaves = Math.max(nStaves, a.staves);
    for (const n of m.notes) nStaves = Math.max(nStaves, n.staff);
  }
  const iv = partInterval(part);
  // clefs
  const staffs = [];
  for (let s = 1; s <= nStaves; s += 1) staffs.push({ no: s, clefInit: null, clefs: [], lines: null, tuning: null, hasTabClef: false, hasPercClef: false, pitched: 0, unpitched: 0, slash: 0, fretted: 0, notes: 0, capo: null });
  measures.forEach((m, mi) => {
    for (const a of m.attrs) {
      for (const c of a.clefs ?? []) {
        const st = staffs[(c.number ?? 1) - 1];
        if (!st) continue;
        if (c.sign === 'TAB') st.hasTabClef = true;
        if (c.sign === 'percussion') st.hasPercClef = true;
        st.clefs.push({ m: mi, pos: a.pos, key: clefKeyOfXml(c), xml: c });
      }
      for (const d of a.staffDetails ?? []) {
        const st = staffs[(d.number ?? 1) - 1];
        if (!st) continue;
        if (d.lines) st.lines = d.lines;
        if (d.tuning?.length) st.tuning = d.tuning;
        if (d.capo) st.capo = d.capo;
      }
    }
    for (const n of m.notes) {
      const st = staffs[n.staff - 1];
      if (!st || n.kind !== 'note') continue;
      st.notes += 1;
      if (n.unpitched) st.unpitched += 1; else if (n.pitch) st.pitched += 1;
      if (n.notehead === 'slash') st.slash += 1;
      if (n.string && n.fret !== null && n.fret !== undefined) st.fretted += 1;
    }
  });
  for (const st of staffs) {
    if (st.hasTabClef || (st.fretted > 0 && st.fretted === st.notes)) st.type = 'tab';
    else if (st.hasPercClef && st.unpitched === 0 && st.pitched > 0) st.type = 'neutral'; // pitched notes on a percussion clef: the exporter's single-line rhythm staff
    else if (st.hasPercClef || (st.unpitched > 0 && st.unpitched >= st.pitched)) st.type = 'percussion';
    else if (st.notes > 0 && st.slash === st.notes) st.type = 'rhythm';
    else st.type = 'score';
    st.clefInit = st.clefs.find((c) => c.m === 0 && fEq(c.pos, ZERO) && c.key)?.key ?? st.clefs.find((c) => c.key)?.key ?? 'G';
  }
  return { part, partIndex, info, iv, staffs, nStaves };
}

/** Tab tuning names, highest string first ('E4'…), from <staff-tuning> (line 1 = lowest string). */
export function tuningNames(tuning) {
  const NAMES = (t) => `${t.step}${t.alter > 0 ? '#' : t.alter < 0 ? 'b' : ''}${t.octave}`;
  return [...tuning].sort((a, b) => b.line - a.line).map(NAMES);
}

// ---------- percussion map ----------

/** Builds the percussion map of a part's percussion staff from the instruments its notes use. */
function buildPercMap(an, staffNo, report) {
  const { part } = an;
  const used = new Map(); // key → info
  part.measures.forEach((me) => {
    for (const n of me.notes) {
      if (n.staff !== staffNo || n.kind !== 'note' || !n.unpitched && !n.pitch) continue;
      const key = n.instrumentId ?? `pos:${n.unpitched?.step ?? ''}${n.unpitched?.octave ?? ''}`;
      let u = used.get(key);
      if (!u) {
        const mid = n.instrumentId ? part.info.midi.get(n.instrumentId) : null;
        const inst = n.instrumentId ? part.info.instruments.get(n.instrumentId) : null;
        u = { key, midi: mid?.unpitched != null ? mid.unpitched - 1 : null, name: inst?.name ?? null, line: drumPositionLine(n.unpitched ?? { step: 'E', octave: 4 }), notehead: n.notehead, stem: n.stem, voices: new Map() };
        used.set(key, u);
      }
      u.voices.set(n.voice, (u.voices.get(n.voice) ?? 0) + 1);
    }
  });
  const sounds = []; const ids = new Set(); const byKey = new Map();
  const slug = (s) => String(s).replace(/[^A-Za-z0-9]+(.)?/g, (m, c) => (c ? c.toUpperCase() : '')).replace(/^(.)/, (c) => c.toLowerCase());
  for (const u of [...used.values()].sort((a, b) => a.line - b.line)) {
    const kit = u.midi != null ? drumSoundForMidi(DEFAULT_PERCMAP, u.midi) : null;
    let id = (u.name ? slug(u.name) : '') || kit?.id || (u.midi != null ? `sound${u.midi}` : `sound${sounds.length + 1}`);
    if (!id) id = `sound${sounds.length + 1}`;
    while (ids.has(id)) id += '2';
    ids.add(id);
    const head = HEAD_OF_XML[u.notehead] ?? kit?.head ?? 'normal';
    const main = [...u.voices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const stem = u.stem === 'up' || u.stem === 'down' ? u.stem : 'auto';
    sounds.push(createDrumSound({ id, name: u.name ?? kit?.name ?? id, midi: u.midi, head, line: u.line, voice: Math.max(0, Math.min(3, (Number(main) || 1) - 1)) % 2, stemDirection: stem }));
    byKey.set(u.key, id);
  }
  if (!sounds.length) return { map: null, byKey };
  return { map: createPercMap({ name: 'Imported', sounds }), byKey };
}

const HEAD_OF_XML = {
  x: 'cross', 'circle-x': 'xcircle', diamond: 'diamond', 'inverted triangle': 'triangle-down', triangle: 'triangle-up', slashed: 'slashed1', 'back slashed': 'slashed2',
  slash: 'slash', cross: 'plus', la: 'la', ti: 'ti', do: 'do', normal: 'normal',
};

// ---------- events ----------

/** Groups the notes of a measure into events (a chord = notes sharing the start), with their grace notes. */
function aggregateMeasure(measure, report) {
  const events = [];
  const pending = new Map(); // voice → grace groups waiting for their main note
  const lastByVoice = new Map();
  let last = null; let lastGrace = null;
  for (const n of measure.notes) {
    if (n.grace) {
      if (n.isChord && lastGrace && lastGrace.voice === n.voice) { lastGrace.notes.push(n); continue; }
      lastGrace = { notes: [n], info: n.grace, type: n.type, voice: n.voice, staff: n.staff, isPerc: !!n.unpitched };
      const prev = lastByVoice.get(n.voice);
      if (n.grace.stealPrevious > 0 && prev && prev.kind === 'chord') prev.graceAfter.push(lastGrace);
      else { if (!pending.has(n.voice)) pending.set(n.voice, []); pending.get(n.voice).push(lastGrace); }
      continue;
    }
    if (n.isChord && last && last.kind === 'chord' && n.kind === 'note') { last.notes.push(n); continue; }
    if (n.isChord) continue; // a "chord" rest or an orphan chord note: ignored
    const ev = {
      kind: n.kind === 'rest' ? 'rest' : 'chord', pos: n.pos, dur: n.dur, notes: n.kind === 'note' ? [n] : [], first: n, voice: n.voice, staff: n.staff,
      graceBefore: pending.get(n.voice) ?? [], graceAfter: [], tuplet: null, pieces: [], measureRest: n.measureRest,
    };
    pending.delete(n.voice);
    events.push(ev);
    last = ev;
    lastByVoice.set(n.voice, ev);
  }
  for (const [voice, groups] of pending) {
    const prev = lastByVoice.get(voice);
    if (prev && prev.kind === 'chord') prev.graceAfter.push(...groups);
    else report.warn('grace.dropped', 'Grace notes with no note to attach to were ignored');
  }
  return events;
}

/** Splits events into lines: one per (staff, voice) — a voice that changes staff between two adjacent score staves stays one line (staffMove). */
function assignLines(an, eventsByMeasure, report) {
  const { staffs } = an;
  const home = new Map(); // voice → staff
  const lines = new Map();
  const typeOf = (s) => staffs[s - 1]?.type;
  const lineFor = (ev) => {
    let h = home.get(ev.voice);
    if (h === undefined) { h = ev.staff; home.set(ev.voice, h); }
    let lineStaff = ev.staff; let move = 0;
    if (ev.staff !== h && typeOf(h) === 'score' && typeOf(ev.staff) === 'score' && Math.abs(ev.staff - h) === 1) { lineStaff = h; move = ev.staff - h; }
    else if (ev.staff !== h && ev.kind === 'rest') { lineStaff = h; }
    const key = `${lineStaff}|${ev.voice}`;
    let line = lines.get(key);
    if (!line) { line = { key, staff: lineStaff, label: ev.voice, order: lines.size, measures: [] }; lines.set(key, line); }
    return { line, move };
  };
  eventsByMeasure.forEach((events, mi) => {
    for (const ev of events) {
      const { line, move } = lineFor(ev);
      ev.move = move;
      (line.measures[mi] ??= []).push(ev);
    }
  });
  return [...lines.values()];
}

/** At most 4 voices per staff: the extra lines are merged into a line with no overlap, else dropped. */
function reduceLines(lines, nM, report) {
  const byStaff = new Map();
  for (const l of lines) { if (!byStaff.has(l.staff)) byStaff.set(l.staff, []); byStaff.get(l.staff).push(l); }
  const out = [];
  for (const [, list] of byStaff) {
    if (list.length <= 4) { out.push(...list); continue; }
    const count = (l) => l.measures.reduce((n, evs) => n + (evs?.length ?? 0), 0);
    const sorted = [...list].sort((a, b) => count(b) - count(a));
    const kept = sorted.slice(0, 4);
    for (const extra of sorted.slice(4)) {
      const target = kept.find((k) => extra.measures.every((evs, mi) => !evs || evs.every((e) => !(k.measures[mi] ?? []).some((o) => fLt(o.pos, fAdd(e.pos, e.dur)) && fLt(e.pos, fAdd(o.pos, o.dur))))));
      if (target) {
        extra.measures.forEach((evs, mi) => { if (evs) (target.measures[mi] ??= []).push(...evs); });
        report.info('voices.merged', 'A fifth voice of a staff was merged into another voice');
      } else report.warn('voices.dropped', 'A voice beyond the fourth of a staff overlapped the others and was dropped');
    }
    out.push(...kept);
  }
  return out;
}

/** Voice order inside a staff: numeric label order when all labels are numbers, else first appearance. */
function orderLines(lines) {
  const byStaff = new Map();
  for (const l of lines) { if (!byStaff.has(l.staff)) byStaff.set(l.staff, []); byStaff.get(l.staff).push(l); }
  for (const [, list] of byStaff) {
    const numeric = list.every((l) => /^\d+$/.test(l.label));
    list.sort((a, b) => (numeric ? Number(a.label) - Number(b.label) : a.order - b.order));
    list.forEach((l, i) => { l.voiceIndex = i; });
  }
  return byStaff;
}

// ---------- tuplets ----------

function tupletFlagsOf(ev) {
  let start = false; let stop = false;
  for (const n of ev.kind === 'chord' ? ev.notes : [ev.first]) { if (n.tuplet.start) start = true; if (n.tuplet.stop) stop = true; }
  return { start, stop };
}

/** Sets `ev.tuplet` (+ `ev.written`) for the complete tuplet groups of a line's measure; incomplete groups stay plain (and are reported). */
function assignTuplets(events, report) {
  const groups = [];
  let cur = null;
  for (const ev of events) {
    const mod = ev.first.mod;
    if (!mod) { cur = null; continue; }
    const flags = tupletFlagsOf(ev);
    const key = `${mod.actual}:${mod.normal}`;
    if (cur && (cur.key !== key || flags.start)) cur = null;
    if (!cur) { cur = { key, mod, events: [], sum: ZERO }; groups.push(cur); }
    cur.events.push(ev);
    cur.sum = fAdd(cur.sum, ev.dur);
    if (flags.stop) cur = null;
  }
  for (const g of groups) {
    const { actual, normal, normalType, normalDots } = g.mod;
    let unit = null;
    if (normalType && TYPE_BASE[normalType]) {
      const u = { base: TYPE_BASE[normalType], dots: normalDots };
      if (fEq(fMul(writtenDuration(u), frac(normal, 1)), g.sum)) unit = u;
    }
    if (!unit) unit = durationOfFraction(fDiv(g.sum, frac(normal, 1)));
    const fail = (why) => { report.warn('tuplet.plain', `A tuplet group could not be rebuilt (${why}); its notes are written with plain values`); };
    if (!unit) { fail('unit'); continue; }
    const span = fMul(writtenDuration(unit), frac(normal, 1));
    if (!fEq(span, g.sum)) { fail('incomplete'); continue; }
    const written = [];
    let ok = true;
    for (const ev of g.events) {
      const w = fMul(ev.dur, frac(actual, normal));
      const typed = durationOfType(ev.first.type, ev.first.dots);
      const d = typed && fEq(writtenDuration(typed), w) ? typed : durationOfFraction(w);
      if (!d) { ok = false; break; }
      written.push(d);
    }
    if (!ok) { fail('value'); continue; }
    const tuplet = { id: newId('tu'), ratio: [actual, normal], base: unit };
    g.events.forEach((ev, i) => { ev.tuplet = tuplet; ev.written = written[i]; });
  }
}

// ---------- items ----------

/**
 * Builds the items of ONE line in ONE measure. `ctx`: { bar, mi, masterbar, staffInfo, voiceIndex, an, report }.
 * Fills each event's `pieces` ([{ chord|rest, notes: [{ ir, el }] }]) for the marks pass.
 */
export function buildLineMeasure(events, ctx) {
  const { bar, mi, masterbar, staffInfo, voiceIndex, report } = ctx;
  const items = [];
  const offset = measureOffsetOf(masterbar, mi === 0);
  const timeSig = bar.timeSig;
  const rhythmOpts = (isRest, start, allowMeasureRest) => ({
    isRest, start, timeSig, measureLength: bar.len, allowMeasureRest: allowMeasureRest && !bar.irregular, offset, maxDots: isRest ? 1 : 1,
  });
  const sorted = [...events].sort((a, b) => fCmp(a.pos, b.pos));
  assignTuplets(sorted, report);

  const pushGap = (from, to) => {
    if (!fLt(from, to)) return;
    const gap = voiceIndex > 0;
    const whole = fEq(from, ZERO) && fEq(to, bar.len);
    const list = toRhythmicDurationList(fSub(to, from), rhythmOpts(true, from, !gap && whole));
    for (const d of list) {
      const rest = createRest({ duration: d.base, dots: d.dots, gap });
      items.push(rest);
    }
  };

  const makeNotes = (ev, forGrace = false) => {
    const out = [];
    const irs = ev.notes;
    if (staffInfo.type === 'rhythm' || staffInfo.type === 'neutral') {
      out.push({ ir: irs[0], el: createRhythmNote() });
      return out;
    }
    const taken = new Set();
    for (const ir of irs) {
      const el = staffInfo.makeNote(ir, taken, report);
      if (el) out.push({ ir, el });
    }
    return out;
  };

  const makeGraceChords = (groups) => groups.map((g) => {
    const notes = [];
    const taken = new Set();
    for (const ir of g.notes) { const el = staffInfo.makeNote(ir, taken, report); if (el) notes.push({ ir, el }); }
    if (!notes.length) return null;
    return { g, notes };
  }).filter(Boolean);

  const graceElements = (groups, after) => makeGraceChords(groups).map(({ g, notes }) => {
    const type = g.type ?? 'eighth';
    const base = TYPE_BASE[type] ?? 'eighth';
    let graceType;
    if (after) graceType = base === 'sixteenth' ? 'grace16after' : base === 'thirtysecond' || base === 'sixtyfourth' ? 'grace32after' : 'grace8after';
    else if (g.info.slash) graceType = 'acciaccatura';
    else if (base === 'quarter' || base === 'half') graceType = 'grace4';
    else if (base === 'sixteenth') graceType = 'grace16';
    else if (base === 'thirtysecond' || base === 'sixtyfourth') graceType = 'grace32';
    else graceType = 'appoggiatura';
    const chord = createChord({ duration: ['breve', 'whole', 'half'].includes(base) ? 'quarter' : base, dots: 0, notes: notes.map((x) => x.el), props: { [PID.GRACE_TYPE]: graceType } });
    g.chord = chord; g.noteEls = notes;
    return chord;
  });

  let c = ZERO;
  for (const ev of sorted) {
    if (fLt(ev.pos, c)) { report.warn('overlap', 'Overlapping notes in one voice were dropped'); continue; }
    if (fLt(c, ev.pos)) pushGap(c, ev.pos);
    let dur = ev.dur;
    if (!(dur[0] > 0)) continue;
    const end = fAdd(ev.pos, dur);
    if (fLt(bar.len, end)) {
      report.warn('measure.overrun', 'A note running past the end of its measure was shortened');
      dur = fSub(bar.len, ev.pos);
      if (!(dur[0] > 0)) continue;
      ev.tuplet = null;
    }
    const exact = fEq(dur, ev.dur);
    if (ev.kind === 'rest') {
      if (ev.graceBefore.length) report.warn('grace.dropped', 'Grace notes with no note to attach to were ignored');
      const alone = sorted.length === 1 && fEq(ev.pos, ZERO) && fEq(dur, bar.len);
      if (alone && !bar.irregular && !ev.tuplet) {
        const rest = createRest({ duration: MEASURE_DURATION, gap: false });
        items.push(rest); ev.pieces = [{ rest }]; c = fAdd(ev.pos, dur); continue;
      }
      if (!ev.first.printObject && voiceIndex > 0) { pushGap(ev.pos, fAdd(ev.pos, dur)); c = fAdd(ev.pos, dur); continue; }
      const typed = ev.tuplet ? ev.written : durationOfType(ev.first.type, ev.first.dots);
      const pieces = [];
      const tupProps = ev.tuplet ? { [PID.TUPLET]: ev.tuplet } : {};
      if (exact && typed && (ev.tuplet || fEq(writtenDuration(typed), dur))) {
        const rest = createRest({ duration: typed.base, dots: typed.dots, props: tupProps });
        items.push(rest); pieces.push({ rest });
      } else {
        let t = ev.pos;
        for (const d of toRhythmicDurationList(dur, rhythmOpts(true, ev.pos, false))) {
          const rest = createRest({ duration: d.base, dots: d.dots });
          items.push(rest); pieces.push({ rest }); t = fAdd(t, writtenDuration(d));
        }
        void t;
      }
      ev.pieces = pieces;
      c = fAdd(ev.pos, dur);
      continue;
    }
    // chord
    const typed = ev.tuplet ? ev.written : durationOfType(ev.first.type, ev.first.dots);
    let durations;
    if (exact && typed && (ev.tuplet || fEq(writtenDuration(typed), dur))) durations = [typed];
    else {
      durations = toRhythmicDurationList(dur, rhythmOpts(false, ev.pos, false));
      ev.tuplet = null;
      if (!durations.length) { report.warn('duration.unwritable', 'A duration that cannot be written was dropped'); c = fAdd(ev.pos, dur); continue; }
    }
    const pieces = [];
    durations.forEach((d, k) => {
      const notes = makeNotes(ev);
      if (!notes.length) { items.push(createRest({ duration: d.base, dots: d.dots, props: ev.tuplet ? { [PID.TUPLET]: ev.tuplet } : {} })); return; }
      const props = {};
      if (ev.tuplet) props[PID.TUPLET] = ev.tuplet;
      if (ev.move && k === 0) props[PID.STAFF_MOVE] = ev.move;
      const before = k === 0 ? graceElements(ev.graceBefore, false) : [];
      const after = k === durations.length - 1 ? graceElements(ev.graceAfter, true) : [];
      const chord = createChord({ duration: d.base, dots: d.dots, notes: notes.map((x) => x.el), graceNotes: [...before, ...after], props });
      items.push(chord);
      pieces.push({ chord, notes });
    });
    if (pieces.length > 1) {
      for (let k = 1; k < pieces.length; k += 1) {
        pieces[k].notes.forEach((nn, i) => { const prev = pieces[k - 1].notes[i]; if (prev) staffInfo.ties.push(createTie(prev.el.id, nn.el.id)); });
      }
    }
    if (!pieces.length) ev.kind = 'rest'; // no note could be written in this staff type: rests keep the time
    ev.pieces = pieces.length ? pieces : [{ rest: items[items.length - 1] }];
    c = fAdd(ev.pos, dur);
  }
  if (fLt(c, bar.len)) pushGap(c, bar.len);
  if (voiceIndex > 0 && items.length && items.every((it) => it.type === 'rest' && it.props[PID.GAP] === true)) return [];
  return items;
}

// ---------- the whole part ----------

/**
 * Builds the content of a part. Returns { staffInfos: [{ type, no, clef, tuning, lines, percmap, voices: [[items per measure]], ties, events }],
 * events: all events with their created elements }.
 */
export function buildPart(an, bars, masterbars, report) {
  const { part, staffs, iv } = an;
  const nM = bars.length;
  const eventsByMeasure = [];
  for (let mi = 0; mi < nM; mi += 1) eventsByMeasure.push(part.measures[mi] ? aggregateMeasure(part.measures[mi], report) : []);

  const staffInfos = staffs.map((st) => {
    const info = {
      no: st.no, type: st.type, clef: st.clefInit, clefChanges: st.clefs.filter((c) => c.key && !(c.m === 0 && fEq(c.pos, ZERO))), lines: st.lines,
      tuning: null, percmap: null, ties: [], voices: [], events: [], capo: st.capo, tabCount: 0,
    };
    if (st.type === 'tab') {
      if (st.capo) report.warn('capo.ignored', 'A capo is not imported: the frets are read as written');
      const names = st.tuning?.length ? tuningNames(st.tuning) : null;
      info.tuning = names;
      info.tunePitches = (names ?? ['E4', 'B3', 'G3', 'D3', 'A2', 'E2']).map(pitchFromName);
    }
    if (st.type === 'percussion') {
      const { map, byKey } = buildPercMap(an, st.no, report);
      info.percmap = map; info.soundOf = byKey;
    }
    info.makeNote = (ir, taken, rep) => {
      if (info.type === 'score') {
        if (!ir.pitch) { rep.warn('note.unpitched', 'An unpitched note in a pitched staff was ignored'); return null; }
        const sp = concertSpelling(ir.pitch, iv);
        if (ir.pitch.alter !== Math.round(ir.pitch.alter)) rep.warn('note.microtone', 'Quarter-tone accidentals were rounded');
        return createNote({ step: sp.step, alter: sp.alter, octave: sp.octave });
      }
      if (info.type === 'tab') {
        let string = ir.string; let pitch;
        if (string && ir.fret !== null && ir.fret !== undefined && info.tunePitches[string - 1] !== undefined) pitch = info.tunePitches[string - 1] + ir.fret;
        else if (ir.pitch) {
          const sp = concertSpelling(ir.pitch, iv);
          pitch = midiFromSpelling(sp);
          const found = convertPitch(pitch, info.tunePitches, NO_CAPO, [...taken]);
          if (!found) { rep.warn('tab.range', 'A note outside the range of the strings of a tablature staff was ignored'); return null; }
          string = found.string; pitch = info.tunePitches[string - 1] + found.fret;
        } else return null;
        if (taken.has(string)) { rep.warn('tab.string', 'Two notes of a chord on the same string: the second was ignored'); return null; }
        taken.add(string);
        return createTabNote({ pitch, string });
      }
      if (info.type === 'percussion') {
        const key = ir.instrumentId ?? `pos:${ir.unpitched?.step ?? ''}${ir.unpitched?.octave ?? ''}`;
        const sound = info.soundOf?.get(key);
        if (!sound) return null;
        if (taken.has(sound)) return null;
        taken.add(sound);
        return createPercNote({ sound });
      }
      return null;
    };
    return info;
  });

  let lines = assignLines(an, eventsByMeasure, report);
  lines = reduceLines(lines, nM, report);
  const byStaff = orderLines(lines);

  for (const info of staffInfos) {
    const list = byStaff.get(info.no) ?? [];
    info.lines = list;
    const voiceCount = Math.max(1, list.length);
    for (let v = 0; v < voiceCount; v += 1) {
      const line = list[v];
      const measures = [];
      for (let mi = 0; mi < nM; mi += 1) {
        const events = line?.measures[mi] ?? [];
        const ctx = { bar: bars[mi], mi, masterbar: masterbars[mi], staffInfo: info, voiceIndex: v, an, report };
        let items;
        if (!events.length) {
          items = v === 0 ? buildLineMeasure([], ctx) : [];
        } else {
          for (const ev of events) { ev.si = info; ev.mi = mi; ev.line = v; }
          items = buildLineMeasure(events, ctx);
          for (const ev of events) if (ev.pieces.length) info.events.push(ev);
        }
        measures.push(items);
      }
      info.voices.push(measures);
    }
  }
  return { staffInfos, eventsByMeasure };
}
