/*
 * MusicXML import, PASS 2b: the marks of the notes (ties, slurs, articulations, ornaments, technical marks, lyrics…), the directions
 * (dynamics, wedges, pedals, texts) and the SYSTEM objects (tempo, markers, jumps, rehearsal marks, fermatas, swing), plus the chord symbols
 * (a chord track). Mirror of src/export/musicxml-marks.js. Everything is attached by element IDENTITY through the events that
 * musicxml-build.js recorded (`ev.pieces`, `ev.si`, `ev.mi`, `ev.pos`). Elements MusicXML has that Scorsaire lacks are counted in the report.
 */
import { child, childrenOf, childText, childNum } from './xml.js';
import { frac, fAdd, fSub, fCmp, fEq, fLt, fLe, ZERO } from '../model/fraction.js';
import { PID } from '../model/pid.js';
import { validateVoicing } from '../model/fretvoicing.js';
import { prepareValue } from '../model/props.js';
import { isApplicable } from '../model/schema.js';
import { withWrites } from '../model/guard.js';
import { newId } from '../model/ids.js';
import {
  createArticulation, createHairpin, createSlur, createTie, createBreath, createGlissando, createHopo, createBend, createPedal,
  createFingering, createChordLine, createTechLine, createTwoChordTremolo, createFermata, createTempo, createRehearsalMark, createMarker, createJump,
  createSwing, createChordSymbol, createStaff, createTrack, createVoice, createMeasure, createRest,
} from '../model/elements.js';
import { createLyricText, createLyricLink } from '../model/lyrics.js';
import { createTrillLine } from '../model/trill.js';
import { createStaffText } from '../model/stafftextedit.js';
import { TECHNIQUES } from '../model/techniques.js';
import { LESLIE_TECHNIQUE_MODE } from '../audio/leslie.js';
import { DYNAMIC_TYPES } from '../model/dynamics.js';
import { beatUnitText } from '../model/tempo.js';
import { DEFAULT_CHORD_QUALITIES, createChordQualities, chordQualityNames, validateChordQualities } from '../model/chordquality.js';
import { MEASURE_DURATION, writtenDuration, midiFromSpelling } from '../model/pitch.js';
import { toRhythmicDurationList } from '../model/rhythmsplit.js';
import { measureOffsetOf } from '../model/timing.js';
import { durationOfFraction } from './musicxml-build.js';

const TYPE_BASE = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', '16th': 'sixteenth', '32nd': 'thirtysecond', '64th': 'sixtyfourth', breve: 'breve' };

/** Writes one property directly (the work has no Document yet): validated like `createElement` does. */
export function setProp(el, pid, value) {
  if (!isApplicable(el.type, pid)) return false;
  const v = prepareValue(el, pid, value);
  withWrites(() => { el.props[pid] = v; });
  return true;
}

export function listOf(si, pid) {
  si.props ??= {};
  si.props[pid] ??= [];
  return si.props[pid];
}

/** Combines the separate signs of one chord into Scorsaire's combined articulations (tenuto + accent = tenutoAccent…). */
export function mergeArticulationsOf(list) {
  const set = new Set(list);
  const out = [];
  const take = (t) => { set.delete(t); };
  if (set.has('tenuto') && set.has('accent')) { take('tenuto'); take('accent'); out.push('tenutoAccent'); }
  if (set.has('accent') && set.has('staccato')) { take('accent'); take('staccato'); out.push('accentStaccato'); }
  if (set.has('marcato') && set.has('staccato')) { take('marcato'); take('staccato'); out.push('marcatoStaccato'); }
  if (set.has('marcato') && set.has('tenuto')) { take('marcato'); take('tenuto'); out.push('marcatoTenuto'); }
  return [...out, ...set];
}

/** Open spanners of a part, keyed by (staff, number); a stop that finds nothing on its staff takes any open one with the same number. */
function createPending() {
  const m = new Map();
  return {
    set(si, num, value) { m.set(`${si.no}|${num}`, value); },
    take(si, num) {
      let key = `${si.no}|${num}`;
      if (!m.has(key)) key = [...m.keys()].find((k) => k.endsWith(`|${num}`));
      if (key === undefined) return undefined;
      const v = m.get(key); m.delete(key); return v;
    },
    get(si, num) { return m.get(`${si.no}|${num}`); },
    delete(si, num) { m.delete(`${si.no}|${num}`); },
    values() { return m.values(); },
  };
}

// ---------- tables ----------

const ARTICULATION = {
  accent: 'accent', 'strong-accent': 'marcato', staccato: 'staccato', tenuto: 'tenuto', 'detached-legato': 'portato', staccatissimo: 'staccatissimo',
  spiccato: 'staccatissimo', stress: 'stress', unstress: 'unstress',
};
const CHORD_LINE = { scoop: 'scoop', plop: 'plop', doit: 'doit', falloff: 'fall' };
// MusicXML <mordent> is the glyph WITH a stroke = Scorsaire "mordentInverted" (names of the glyphs are swapped, see the exporter)
const ORNAMENT = { 'inverted-mordent': 'mordent', mordent: 'mordentInverted', turn: 'turn', 'inverted-turn': 'turnInverted' };
const ORNAMENT_IGNORED = new Set(['accidental-mark', 'schleifer', 'haydn', 'delayed-turn', 'delayed-inverted-turn', 'vertical-turn', 'inverted-vertical-turn', 'other-ornament', 'shake', 'tremolo', 'trill-mark', 'wavy-line']);
const FERMATA = { normal: 'fermata', angled: 'fermataShort', square: 'fermataLong', 'double-angled': 'fermataVeryShort', 'double-square': 'fermataVeryLong', 'double-dot': 'fermata', 'half-curve': 'fermata', curlew: 'fermata' };
const GUITAR_TECH_TEXT = { golpe: 'golpe', 'golpe (thumb)': 'golpeThumb', slap: 'slap', pop: 'pop' };
const BREATH = { '': 'breathMarkComma', comma: 'breathMarkComma', tick: 'breathMarkTick', upbow: 'breathMarkUpbow', salzedo: 'breathMarkSalzedo' };
const CAESURA = { normal: 'caesura', thick: 'caesuraThick', short: 'caesuraShort', curved: 'caesuraCurved', single: 'caesuraSingleStroke', '': 'caesura' };

const TECH_LINE_OF_TEXT = { 'p.m.': 'palmMute', 'let ring': 'letRing', 'harm.': 'harmonicMark', 'w/bar': 'whammyBar', 'vib.': 'vibrato' };
const KIND_INTERVALS = {
  major: [0, 4, 7], minor: [0, 3, 7], augmented: [0, 4, 8], diminished: [0, 3, 6], dominant: [0, 4, 7, 10], 'major-seventh': [0, 4, 7, 11],
  'minor-seventh': [0, 3, 7, 10], 'diminished-seventh': [0, 3, 6, 9], 'augmented-seventh': [0, 4, 8, 10], 'half-diminished': [0, 3, 6, 10],
  'major-minor': [0, 3, 7, 11], 'major-sixth': [0, 4, 7, 9], 'minor-sixth': [0, 3, 7, 9], 'dominant-ninth': [0, 4, 7, 10, 14],
  'major-ninth': [0, 4, 7, 11, 14], 'minor-ninth': [0, 3, 7, 10, 14], 'dominant-11th': [0, 4, 7, 10, 14, 17], 'major-11th': [0, 4, 7, 11, 14, 17],
  'minor-11th': [0, 3, 7, 10, 14, 17], 'dominant-13th': [0, 4, 7, 10, 14, 17, 21], 'major-13th': [0, 4, 7, 11, 14, 17, 21],
  'minor-13th': [0, 3, 7, 10, 14, 17, 21], 'suspended-second': [0, 2, 7], 'suspended-fourth': [0, 5, 7], pedal: [0], power: [0, 7],
};
const KIND_SHORT = {
  major: '', minor: 'm', augmented: 'aug', diminished: 'o', dominant: '7', 'major-seventh': 'M7', 'minor-seventh': 'm7', 'diminished-seventh': 'o7',
  'augmented-seventh': 'aug7', 'half-diminished': 'm7b5', 'major-minor': 'mM7', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9',
  'major-ninth': 'M9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'major-11th': 'M11', 'minor-11th': 'm11', 'dominant-13th': '13',
  'major-13th': 'M13', 'minor-13th': 'm13', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4', pedal: 'ped', power: '5',
};
const MAJOR_SCALE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };

/** Intervals (semitones above the root) of a <kind> + its <degree> elements, or null when the kind cannot be turned into intervals. */
function chordIntervals(kind, degrees) {
  const base = KIND_INTERVALS[kind];
  if (!base) return null;
  let set = [...base];
  const notes = [];
  for (const d of degrees) {
    const semi = (MAJOR_SCALE[d.value] ?? Math.round(d.value * 12 / 7)) + d.alter;
    if (d.type === 'add') set.push(semi);
    else if (d.type === 'subtract') set = set.filter((x) => x !== semi && x !== semi - d.alter);
    else if (d.type === 'alter') {
      const b = MAJOR_SCALE[d.value] ?? semi;
      set = set.filter((x) => Math.abs(x - b) > 1);
      set.push(semi);
    }
    notes.push(`${d.type === 'subtract' ? 'no' : d.type === 'add' ? 'add' : ''}${d.alter < 0 ? 'b' : d.alter > 0 ? '#' : ''}${d.value}`);
  }
  return { intervals: [...new Set(set)].sort((a, b) => a - b), suffix: notes.join('') };
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- helpers on events ----------

/** All the events of a part that hold a chord or a rest, grouped by measure and sorted by position (events keep their staff and line). */
function indexPart(infoBuilt, nM) {
  const byMeasure = Array.from({ length: nM }, () => []);
  for (const si of infoBuilt.staffInfos) for (const ev of si.events) byMeasure[ev.mi].push(ev);
  for (const list of byMeasure) list.sort((a, b) => fCmp(a.pos, b.pos) || a.line - b.line);
  return byMeasure;
}

const chordOf = (ev) => ev.pieces[0]?.chord ?? null;
const lastChordOf = (ev) => ev.pieces[ev.pieces.length - 1]?.chord ?? null;
const anchorOf = (ev) => ev.pieces[0]?.chord ?? ev.pieces[0]?.rest ?? null;

/** Candidates for a direction at (measure, position) of an xml staff: events of that staff, chords only unless `any`. */
function pickEvent(evs, pos, staffNo, { any = false, fallback = 'after' } = {}) {
  const inStaff = evs.filter((e) => (staffNo == null || e.staff === staffNo) && (any ? e.pieces.length : e.kind === 'chord' && chordOf(e)));
  const exact = inStaff.find((e) => fEq(e.pos, pos));
  if (exact) return exact;
  if (fallback === 'after') return inStaff.find((e) => fLt(pos, e.pos)) ?? null;
  const before = inStaff.filter((e) => fLe(e.pos, pos));
  return before.length ? before[before.length - 1] : null;
}

// ---------- main ----------

export function applyMarks({ score, bars, masterbars, built, report }) {
  const nM = bars.length;
  const parts = built.map((b) => ({ ...b, byMeasure: indexPart(b, nM) }));
  const system = { jumps: [], markers: [], rehearsalMarks: [], tempos: [], tempoChanges: [], fermatas: [], swings: [] };
  const sysSeen = new Set();
  const once = (key) => { if (sysSeen.has(key)) return false; sysSeen.add(key); return true; };
  const lyricRuns = []; // per staff info: chords with lyric elements, in time order
  const ignored = (name, what = 'notation') => report.warn(`${what}:${name}`, `Ignored MusicXML ${what} element « ${name} »`, { name, kind: what });
  const barId = (mi) => masterbars[mi].id;

  // ---------------- notes ----------------
  for (const [pi, part] of parts.entries()) {
    void pi;
    const pending = { slur: createPending(), glissando: createPending(), tremolo: createPending(), hopo: createPending(), wavy: createPending(), tie: createPending() };
    const openMelisma = new Map();
    const all = part.byMeasure.flat();
    for (const ev of all) {
      if (ev.kind !== 'chord' || !chordOf(ev)) {
        // a rest only carries fermatas and breaths
        for (const n of [ev.first]) fermatasOf(n.el, ev);
        continue;
      }
      const si = ev.si;
      const first = chordOf(ev); const last = lastChordOf(ev);
      const chordArts = []; let chordProps = {}; let fermataShape = null;
      ev.notes.forEach((n, ni) => {
        const noteEl = ev.pieces[0].notes.find((x) => x.ir === n)?.el;
        const lastEl = ev.pieces[ev.pieces.length - 1].notes.find((x) => x.ir === n)?.el;
        if (!noteEl) return;
        // heads
        if (n.notehead === 'x') setProp(noteEl, PID.MUTED, true);
        else if (n.noteheadParens) setProp(noteEl, PID.GHOST, true);
        // ties written in the file
        let tieStart = n.tieStart; let tieStop = n.tieStop;
        for (const nt of childrenOf(n.el, 'notations')) for (const t of childrenOf(nt, 'tied')) { if (t.attrs.type === 'start') tieStart = true; if (t.attrs.type === 'stop') tieStop = true; }
        const tkey = tieKey(n, si);
        if (tieStop) { const p = pending.tie.take(si, tkey); if (p && p.si === si && p.el !== noteEl) listOf(si, PID.TIES).push(createTie(p.el.id, noteEl.id)); }
        if (tieStart) pending.tie.set(si, tkey, { si, el: lastEl ?? noteEl });
        for (const nt of childrenOf(n.el, 'notations')) {
          for (const x of nt.children) {
            switch (x.name) {
              case 'tied': case 'tuplet': break;
              case 'slur': {
                const num = x.attrs.number ?? '1';
                if (x.attrs.type === 'start') pending.slur.set(si, num, { si, chord: first });
                else if (x.attrs.type === 'stop') {
                  const s = pending.slur.take(si, num);
                  if (s && s.si === si && s.chord !== first) listOf(si, PID.SLURS).push(createSlur(s.chord.id, first.id));
                  else if (s && s.si !== si) report.warn('slur.cross', 'A slur between two staves was ignored');
                }
                break;
              }
              case 'articulations':
                for (const a of x.children) {
                  if (ARTICULATION[a.name]) chordArts.push(ARTICULATION[a.name]);
                  else if (CHORD_LINE[a.name]) chordProps[PID.CHORD_LINE] = createChordLine(CHORD_LINE[a.name], { straight: a.attrs['line-shape'] === 'straight', wavy: a.attrs['line-type'] === 'wavy' });
                  else if (a.name === 'breath-mark') listOf(si, PID.BREATHS).push(createBreath(last.id, BREATH[a.text.trim()] ?? 'breathMarkComma'));
                  else if (a.name === 'caesura') listOf(si, PID.BREATHS).push(createBreath(last.id, CAESURA[a.text.trim()] ?? 'caesura'));
                  else ignored(a.name, 'articulation');
                }
                break;
              case 'ornaments': {
                const hasLine = childrenOf(x, 'wavy-line').some((w) => w.attrs.type === 'start');
                for (const o of x.children) {
                  if (ORNAMENT[o.name]) chordArts.push(ORNAMENT[o.name]);
                  else if (o.name === 'trill-mark' && !hasLine) chordArts.push('trill');
                  else if (o.name === 'wavy-line') {
                    const num = o.attrs.number ?? '1';
                    if (o.attrs.type === 'start') pending.wavy.set(si, num, { si, chord: first });
                    else if (o.attrs.type === 'stop') {
                      const s = pending.wavy.take(si, num);
                      if (s && s.si === si && s.chord !== first) listOf(si, PID.TRILLS).push(createTrillLine(s.chord.id, first.id, 'trill'));
                    }
                  } else if (o.name === 'tremolo') {
                    const type = o.attrs.type ?? 'single'; const strokes = Math.max(1, Math.min(6, Math.round(Number(o.text.trim()) || 3)));
                    if (type === 'single') chordProps[PID.TREMOLO] = { strokes };
                    else if (type === 'start') pending.tremolo.set(si, 't', { si, chord: first, strokes });
                    else if (type === 'stop') {
                      const s = pending.tremolo.take(si, 't');
                      if (s && s.si === si && s.chord !== first) listOf(si, PID.TREMOLOS).push(createTwoChordTremolo(s.chord.id, first.id, s.strokes));
                    }
                  } else if (!ORNAMENT_IGNORED.has(o.name)) ignored(o.name, 'ornament');
                  else if (o.name !== 'accidental-mark') ignored(o.name, 'ornament');
                }
                break;
              }
              case 'technical':
                for (const t of x.children) technical(t, n, noteEl, ev, si, first, last, pending, chordArts, chordProps);
                break;
              case 'fermata': fermataShape = FERMATA[x.text.trim() || x.attrs.shape || 'normal'] ?? 'fermata'; break;
              case 'arpeggiate': chordProps[PID.ARPEGGIO] = { type: x.attrs.direction === 'down' ? 'down' : x.attrs.direction === 'up' ? 'up' : 'normal' }; break;
              case 'non-arpeggiate': break;
              case 'glissando': case 'slide': {
                const num = `${x.name}${x.attrs.number ?? '1'}`;
                if (x.attrs.type === 'start') pending.glissando.set(si, num, { si, el: noteEl, wavy: x.attrs['line-type'] === 'wavy' });
                else if (x.attrs.type === 'stop') {
                  const s = pending.glissando.take(si, num);
                  if (s && s.si === si && s.el !== noteEl) listOf(si, PID.GLISSANDOS).push(createGlissando(s.el.id, noteEl.id, s.wavy ? { glissandoType: 'wavy' } : {}));
                }
                break;
              }
              case 'dynamics': {
                const d = dynamicOf(x);
                if (d) applyDynamic(first, d);
                break;
              }
              case 'accidental-mark': case 'other-notation': break;
              default: ignored(x.name, 'notation');
            }
          }
        }
        // lyrics of the first note of the chord
        if (ni === 0) {
          const ly = childrenOf(n.el, 'lyric');
          if (ly.length) lyricRuns.push({ si, ev, chord: first, lyrics: ly });
        }
      });
      // chord-level collection
      if (chordArts.length) {
        const merged = mergeArticulationsOf(chordArts);
        const old = first.props[PID.ARTICULATIONS] ?? [];
        setProp(first, PID.ARTICULATIONS, [...old, ...merged.map((t) => createArticulation(t))]);
      }
      for (const [pid, value] of Object.entries(chordProps)) setProp(first, pid, value);
      if (fermataShape && once(`f:${ev.mi}:${ev.pos}`)) system.fermatas.push(createFermata({ measureId: barId(ev.mi), position: ev.pos, fermataType: fermataShape }));
      void ev;
    }
  }

  function fermatasOf(noteEl, ev) {
    for (const nt of childrenOf(noteEl, 'notations')) for (const f of childrenOf(nt, 'fermata')) {
      if (once(`f:${ev.mi}:${ev.pos}`)) system.fermatas.push(createFermata({ measureId: barId(ev.mi), position: ev.pos, fermataType: FERMATA[f.text.trim() || 'normal'] ?? 'fermata' }));
    }
  }
  function tieKey(n, si) {
    if (si.type === 'tab') return `s${n.string}`;
    if (si.type === 'percussion') return `p${n.instrumentId ?? `${n.unpitched?.step}${n.unpitched?.octave}`}`;
    return n.pitch ? `${n.pitch.step}${Math.round(n.pitch.alter)}${n.pitch.octave}` : 'x';
  }
  function dynamicOf(el) {
    for (const d of el.children) {
      if (d.name === 'other-dynamics') { const t = d.text.trim(); if (t) return DYNAMIC_TYPES.includes(t) ? { type: t } : { type: 'other', text: t }; continue; }
      if (DYNAMIC_TYPES.includes(d.name) && d.name !== 'other') return { type: d.name };
      ignored(d.name, 'dynamic');
    }
    return null;
  }
  function applyDynamic(chord, d) {
    setProp(chord, PID.DYNAMIC, d.type);
    if (d.text) setProp(chord, PID.DYNAMIC_TEXT, d.text);
  }
  function technical(t, n, noteEl, ev, si, first, last, pending, chordArts, chordProps) {
    switch (t.name) {
      case 'fingering': { const s = t.text.trim(); if (s && s.length <= 12) addFingering(noteEl, createFingering(s)); break; }
      case 'pluck': { const s = t.text.trim(); if (s && s.length <= 12) addFingering(noteEl, createFingering(s, { kind: 'rhGuitar' })); break; }
      case 'string': if (si.type !== 'tab') { const s = t.text.trim(); if (s && s.length <= 12) addFingering(noteEl, createFingering(s, { kind: 'stringNumber' })); } break;
      case 'fret': break;
      case 'harmonic':
        setProp(noteEl, PID.HARMONIC, true);
        setProp(noteEl, PID.DISPLAY_FRET, child(t, 'artificial') ? 'artificial' : 'natural');
        break;
      case 'hammer-on': case 'pull-off': {
        const num = t.attrs.number ?? '1';
        if (t.attrs.type === 'start') pending.hopo.set(si, num, { si, chord: first });
        else if (t.attrs.type === 'stop') {
          const s = pending.hopo.take(si, num);
          if (s && s.si === si && s.chord !== first) listOf(si, PID.HOPOS).push(createHopo(s.chord.id, first.id));
        }
        break;
      }
      case 'down-bow': chordArts.push('pickDown'); break;
      case 'up-bow': chordArts.push('pickUp'); break;
      case 'tap': chordProps[PID.TAPPING] = { hand: t.attrs.hand === 'right' ? 'right' : 'left' }; break;
      case 'other-technical': {
        const a = GUITAR_TECH_TEXT[t.text.trim()];
        if (a) chordArts.push(a); else ignored(t.text.trim() || 'other-technical', 'technical');
        break;
      }
      case 'bend': bend(t, n, noteEl, ev, si, first, ev.graceAfter.flatMap((g) => g.noteEls ?? []).map((x) => x.el)); break;
      default: ignored(t.name, 'technical');
    }
  }
  function addFingering(noteEl, entry) {
    const list = noteEl.props[PID.FINGERINGS] ?? [];
    setProp(noteEl, PID.FINGERINGS, [...list, entry]);
  }
  // `afterEls`: the grace notes AFTER the main note that follow the start note (a bend may land on one of them, as MuseScore writes a bend that is not tied on)
  function bend(t, n, noteEl, ev, si, first, afterEls = []) {
    const alter = childNum(t, 'bend-alter', 0);
    const pre = !!child(t, 'pre-bend'); const bar = !!child(t, 'with-bar'); const release = !!child(t, 'release');
    const pitchOf = (el) => el.props[PID.PITCH];
    const nextNote = (targetPitch) => {
      const grace = afterEls.find((el) => pitchOf(el) === targetPitch);
      if (grace) return grace;
      const line = si.events.filter((e) => e.line === ev.line && e.kind === 'chord');
      const nxt = line[line.indexOf(ev) + 1];
      if (!nxt) return null;
      const notes = nxt.pieces[0].notes.map((x) => x.el);
      return notes.find((el) => pitchOf(el) === targetPitch) ?? notes.find((el, i) => si.type === 'tab' && nxt.pieces[0].notes[i].ir.string === n.string) ?? null;
    };
    if (pre) {
      // MuseScore writes a (grace-note) bend on the END note: the grace note before it holds the start pitch = end pitch + bend-alter
      const start = ev.graceBefore.flatMap((g) => g.noteEls ?? []).map((x) => x.el).find((el) => pitchOf(el) === pitchOf(noteEl) + alter);
      if (start) listOf(si, PID.BENDS).push(createBend(start.props[PID.GHOST] === true ? 'preBend' : 'graceNoteBend', start.id, noteEl.id));
      else report.warn('bend.pre', 'A pre-bend with no matching grace note was ignored');
      return null;
    }
    if (bar) {
      const end = nextNote(pitchOf(noteEl) + alter);
      if (end) listOf(si, PID.BENDS).push(createBend('dive', noteEl.id, end.id));
      else listOf(si, PID.BENDS).push(createBend('dip', noteEl.id, noteEl.id)); // no lower note follows: the bar dips and comes back
      return null;
    }
    if (Math.abs(alter) > 0 && Math.abs(alter) <= 0.5) { listOf(si, PID.BENDS).push(createBend('slightBend', noteEl.id, noteEl.id)); return null; }
    const end = nextNote(pitchOf(noteEl) + (release ? -Math.abs(alter) : alter));
    if (end) listOf(si, PID.BENDS).push(createBend('bend', noteEl.id, end.id));
    else report.warn('bend.target', 'A bend with no following note of the right pitch was ignored');
    return null;
  }

  // heads of grace notes (ghost / muted)
  for (const part of parts) for (const ev of part.byMeasure.flat()) {
    const afterAll = ev.graceAfter.flatMap((g) => g.noteEls ?? []);
    for (const g of [...ev.graceBefore, ...ev.graceAfter]) for (const { ir, el } of g.noteEls ?? []) {
      if (ir.notehead === 'x') setProp(el, PID.MUTED, true); else if (ir.noteheadParens) setProp(el, PID.GHOST, true);
      // a bend that starts on a grace note after the main note (the next link of a chain) lands on a later one, or on the next chord
      if (ir.el && afterAll.some((x) => x.el === el)) {
        const later = afterAll.slice(afterAll.findIndex((x) => x.el === el) + 1).map((x) => x.el);
        for (const nt of childrenOf(ir.el, 'notations')) for (const tt of childrenOf(nt, 'technical')) for (const b of childrenOf(tt, 'bend')) bend(b, ir, el, ev, ev.si, null, later);
      }
    }
  }

  // ---------------- directions ----------------
  const tempoWords = /^(a tempo|tempo primo)$/i;
  for (const [pi, part] of parts.entries()) {
    const wedges = new Map(); const pedals = new Map(); const dashes = new Map();
    const lastBarIndex = nM - 1;
    part.an.part.measures.forEach((me, mi) => {
      for (const dir of me.dirs) {
        const staffNo = dir.staff ?? 1;
        const evs = part.byMeasure[mi];
        const si = part.staffInfos[Math.min(part.staffInfos.length, staffNo) - 1] ?? part.staffInfos[0];
        const types = childrenOf(dir.el, 'direction-type');
        const sound = child(dir.el, 'sound');
        const words = types.flatMap((t) => childrenOf(t, 'words'));
        const wordsText = words.map((w) => w.text.trim()).filter(Boolean).join(' ');
        const metros = types.flatMap((t) => childrenOf(t, 'metronome'));
        let tempoDone = false; let wordsUsed = false;

        for (const t of types) for (const x of t.children) {
          switch (x.name) {
            case 'words': break;
            case 'metronome': {
              const unitName = childText(x, 'beat-unit'); const dots = childrenOf(x, 'beat-unit-dot').length;
              const pm = childText(x, 'per-minute');
              const base = TYPE_BASE[unitName];
              const bpm = pm ? parseFloat(pm) : NaN;
              if (base && Number.isFinite(bpm) && bpm > 0 && !child(x, 'beat-unit-tied') && once(`t:${mi}:${dir.pos}`)) {
                const unit = { base, dots };
                const text = wordsText ? `${wordsText} ${beatUnitText(unit)} = ${pm.trim()}` : undefined;
                system.tempos.push(createTempo({ measureId: barId(mi), position: dir.pos, bpm, beatUnit: unit, text, followText: text ? true : undefined }));
                tempoDone = true; wordsUsed = true;
              } else if (!base || !Number.isFinite(bpm)) report.warn('tempo.metronome', 'A metronome mark that is not « note = number » was ignored');
              break;
            }
            case 'rehearsal': { const text = x.text.trim(); if (text && once(`r:${mi}`)) system.rehearsalMarks.push(createRehearsalMark({ measureId: barId(mi), text })); break; }
            case 'segno': if (once(`seg:${mi}`)) system.markers.push(createMarker({ measureId: barId(mi), markerType: 'segno', ...(sound?.attrs.segno && sound.attrs.segno !== 'segno' ? { label: sound.attrs.segno } : {}) })); break;
            case 'coda': if (once(`coda:${mi}`)) system.markers.push(createMarker({ measureId: barId(mi), markerType: 'coda', ...(sound?.attrs.coda && sound.attrs.coda !== 'codab' ? { label: sound.attrs.coda } : {}) })); break;
            case 'dynamics': {
              const d = dynamicOf(x);
              if (d) { const ev = pickEvent(evs, dir.pos, staffNo); const ch = ev && chordOf(ev); if (ch) applyDynamic(ch, d); else report.warn('dynamic.anchor', 'A dynamic with no note to attach to was ignored'); }
              break;
            }
            case 'wedge': {
              const key = `${pi}|${staffNo}|${x.attrs.number ?? '1'}`;
              const type = x.attrs.type;
              if (type === 'crescendo' || type === 'diminuendo') {
                const ev = pickEvent(evs, dir.pos, staffNo);
                if (ev && chordOf(ev)) wedges.set(key, { ev, kind: type });
              } else if (type === 'stop') {
                const w = wedges.get(key);
                wedges.delete(key);
                if (!w) break;
                const end = pickEvent(evs, dir.pos, staffNo, { fallback: 'before' }) ?? pickEvent(evs, dir.pos, staffNo);
                const endChord = end && chordOf(end);
                if (endChord && end.si === w.ev.si && (end.mi > w.ev.mi || (end.mi === w.ev.mi && fCmp(end.pos, w.ev.pos) > 0))) {
                  listOf(w.ev.si, PID.HAIRPINS).push(createHairpin(chordOf(w.ev).id, endChord.id, w.kind === 'crescendo' ? 'cresc' : 'decresc'));
                }
              }
              break;
            }
            case 'pedal': {
              const key = `${pi}|${staffNo}`;
              const type = x.attrs.type;
              const closeAt = () => {
                const p = pedals.get(key);
                if (!p) return;
                pedals.delete(key);
                if (p.mi === mi && !fLt(p.pos, dir.pos)) return;
                listOf(p.si, PID.PEDALS).push(createPedal(barId(p.mi), p.pos, barId(mi), dir.pos));
              };
              if (type === 'start') { closeAt(); pedals.set(key, { si, mi, pos: dir.pos }); }
              else if (type === 'stop') closeAt();
              else if (type === 'change') { closeAt(); pedals.set(key, { si, mi, pos: dir.pos }); }
              break;
            }
            case 'dashes': {
              const key = `${pi}|${staffNo}|${x.attrs.number ?? '1'}`;
              if (x.attrs.type === 'start') {
                const kind = TECH_LINE_OF_TEXT[wordsText.toLowerCase()];
                const ev = pickEvent(evs, dir.pos, staffNo);
                if (kind && ev && chordOf(ev)) { dashes.set(key, { ev, kind }); wordsUsed = true; }
                else ignored('dashes', 'direction');
              } else if (x.attrs.type === 'stop') {
                const d = dashes.get(key);
                dashes.delete(key);
                if (!d) break;
                const end = pickEvent(evs, dir.pos, staffNo, { fallback: 'before' }) ?? pickEvent(evs, dir.pos, staffNo);
                const endChord = end && chordOf(end);
                if (endChord && end.si === d.ev.si && endChord !== chordOf(d.ev)) listOf(d.ev.si, PID.TECH_LINES).push(createTechLine(d.kind, chordOf(d.ev).id, endChord.id));
              }
              break;
            }
            case 'bracket': case 'octave-shift': case 'eyeglasses': case 'damp': case 'damp-all': case 'image': case 'symbol': case 'other-direction':
            case 'percussion': case 'accordion-registration': case 'harp-pedals': case 'scordatura': case 'string-mute': case 'principal-voice': case 'staff-divide':
              ignored(x.name, 'direction'); break;
            default: ignored(x.name, 'direction');
          }
        }
        // sound: tempo, jumps, markers, swing
        if (sound) {
          const tempo = parseFloat(sound.attrs.tempo);
          if (Number.isFinite(tempo) && tempo > 0 && !tempoDone && once(`t:${mi}:${dir.pos}`)) {
            const text = wordsText && !tempoWords.test(wordsText) ? wordsText : undefined;
            system.tempos.push(createTempo({ measureId: barId(mi), position: dir.pos, bpm: Math.round(tempo * 100) / 100, text }));
            if (text) wordsUsed = true;
            tempoDone = true;
          }
          const sw = child(sound, 'swing');
          if (sw && once(`sw:${mi}:${dir.pos}`)) {
            if (child(sw, 'straight')) system.swings.push(createSwing({ measureId: barId(mi), position: dir.pos, kind: 'straight', text: wordsText || undefined }));
            else {
              const a = childNum(sw, 'first', 2); const b = childNum(sw, 'second', 1);
              const unit = childText(sw, 'swing-type') === '16th' ? '16th' : 'eighth';
              system.swings.push(createSwing({ measureId: barId(mi), position: dir.pos, kind: 'custom', unit, ratio: Math.max(0, Math.min(100, Math.round((100 * a) / (a + b)))), text: wordsText || undefined }));
            }
            wordsUsed = true;
          }
          const fine = sound.attrs.fine === 'yes';
          const tocoda = sound.attrs.tocoda;
          const dacapo = sound.attrs.dacapo === 'yes';
          const dalsegno = sound.attrs.dalsegno;
          if (fine && once(`fine:${mi}`)) { system.markers.push(createMarker({ measureId: barId(mi), markerType: 'fine' })); wordsUsed = true; }
          if (tocoda !== undefined && once(`tocoda:${mi}`)) { system.markers.push(createMarker({ measureId: barId(mi), markerType: 'toCoda', ...(tocoda && tocoda !== 'coda' ? { label: tocoda } : {}) })); wordsUsed = true; }
          if ((dacapo || dalsegno !== undefined) && once(`jump:${mi}`)) {
            const alFine = /fine/i.test(wordsText); const alCoda = /coda/i.test(wordsText);
            if (dacapo) system.jumps.push(createJump({ measureId: barId(mi), jumpType: alFine ? 'dcAlFine' : alCoda ? 'dcAlCoda' : 'dc' }));
            else if (!dalsegno || dalsegno === 'segno') system.jumps.push(createJump({ measureId: barId(mi), jumpType: alFine ? 'dsAlFine' : alCoda ? 'dsAlCoda' : 'ds' }));
            else system.jumps.push(createJump({ measureId: barId(mi), jumpType: 'user', jumpTo: dalsegno, playUntil: alFine ? 'fine' : alCoda ? 'coda' : 'end', continueAt: alCoda ? 'codab' : '' }));
            wordsUsed = true;
          }
        }
        // plain words
        if (wordsText && !wordsUsed && !metros.length) {
          if (/^a tempo$/i.test(wordsText) && once(`t:${mi}:${dir.pos}`)) system.tempos.push(createTempo({ measureId: barId(mi), position: dir.pos, tempoKind: 'aTempo', text: 'a tempo' }));
          else if (/^tempo primo$/i.test(wordsText) && once(`t:${mi}:${dir.pos}`)) system.tempos.push(createTempo({ measureId: barId(mi), position: dir.pos, tempoKind: 'tempoPrimo', text: 'tempo primo' }));
          else if (si) {
            const w0 = words[0];
            const style = /italic/.test(w0?.attrs['font-style'] ?? '') ? 'italic' : /bold/.test(w0?.attrs['font-weight'] ?? '') ? 'bold' : 'normal';
            const tech = TECHNIQUES.find((t) => !(t.id in LESLIE_TECHNIQUE_MODE) && t.text.toLowerCase() === wordsText.toLowerCase()); // the Leslie signs are placed by hand: a plain "Tremolo" direction stays a text
            listOf(si, PID.STAFF_TEXTS).push(createStaffText({
              measureId: barId(mi), position: dir.pos, text: wordsText.slice(0, 60), style, placement: dir.placement === 'below' ? 'below' : 'above', technique: tech?.id,
            }));
          }
        }
      }
    });
    // pedals left open: closed at the last instant before the end of the last measure when possible
    for (const p of pedals.values()) {
      const len = bars[lastBarIndex].len;
      const endPos = fSub(len, frac(1, 64));
      if (fLt(p.mi === lastBarIndex ? p.pos : ZERO, endPos)) listOf(p.si, PID.PEDALS).push(createPedal(barId(p.mi), p.pos, barId(lastBarIndex), endPos));
    }
    void dashes;
  }

  // ---------------- lyrics ----------------
  const lyricTexts = [];
  const verseBase = { n: 0 };
  const byStaff = new Map();
  for (const run of lyricRuns) { if (!byStaff.has(run.si)) byStaff.set(run.si, []); byStaff.get(run.si).push(run); }
  for (const [si, runs] of byStaff) {
    const chords = si.events.filter((e) => e.kind === 'chord' && chordOf(e)).sort((a, b) => a.mi - b.mi || fCmp(a.pos, b.pos));
    const order = new Map(chords.map((e, i) => [chordOf(e).id, i]));
    runs.sort((a, b) => order.get(a.chord.id) - order.get(b.chord.id));
    const verses = new Map(); // verse key → { index, words, current, syllables: [{ chord, text }], open }
    for (const run of runs) {
      for (const ly of run.lyrics) {
        const key = ly.attrs.number ?? ly.attrs.name ?? '1';
        let v = verses.get(key);
        if (!v) { v = { index: verseBase.n + verses.size, words: [], current: null, count: 0, links: [] }; verses.set(key, v); }
        const texts = ly.children.filter((c) => c.name === 'text' || c.name === 'elision');
        let text = ''; let any = false;
        for (const c of texts) { if (c.name === 'text') { text += c.text.trim().replace(/\s+/g, '‿'); any = true; } else text += '‿'; }
        const extendEl = child(ly, 'extend');
        if (!any || !text) {
          // a lyric with only <extend> closes the previous melisma at this chord (handled below by position)
          continue;
        }
        const syllabic = childText(ly, 'syllabic') ?? 'single';
        let piece = text;
        if (syllabic === 'begin') { if (v.current) { v.words.push(v.current.join('-')); } v.current = [piece]; }
        else if (syllabic === 'middle') { if (!v.current) v.current = []; v.current.push(piece); }
        else if (syllabic === 'end') { if (!v.current) v.current = []; v.current.push(piece); v.words.push(v.current.join('-')); v.current = null; }
        else { if (v.current) { v.words.push(v.current.join('-')); v.current = null; } v.words.push(piece); }
        v.links.push({ chord: run.chord, index: v.count, extend: extendEl ? (extendEl.attrs.type ?? 'start') : null });
        v.count += 1;
      }
    }
    for (const [, v] of verses) {
      if (v.current) v.words.push(v.current.join('-'));
      const text = createLyricText(v.index, v.words.join(' '));
      lyricTexts.push(text);
      v.links.forEach((l, k) => {
        let endChordId;
        if (l.extend && l.extend !== 'stop') {
          const own = order.get(l.chord.id);
          const nextLink = v.links[k + 1];
          const limit = nextLink ? order.get(nextLink.chord.id) - 1 : chords.length - 1;
          if (limit > own) endChordId = chordOf(chords[limit]).id;
        }
        listOf(si, PID.LYRIC_LINKS).push(createLyricLink(text.id, l.index, l.chord.id, endChordId ? { endChordId } : {}));
      });
    }
    verseBase.n += verses.size;
  }

  // ---------------- chord symbols ----------------
  const chordTrack = harmonyTrack(score, parts, bars, masterbars, report);

  return { chordTrack: chordTrack?.track ?? null, chordQualities: chordTrack?.dictionary ?? null, lyricTexts, system };
}

// ---------- chord symbols ----------

const FRAME_INSTRUMENTS = { 6: 'guitar', 4: 'ukulele', 5: 'bass5' };

/** The fretted voicing of a `<frame>` (strings numbered from the highest, absolute frets), or null (unknown number of strings, invalid fingering). */
function frameVoicing(frame, report) {
  const n = Math.round(childNum(frame, 'frame-strings', 0));
  const instrument = FRAME_INSTRUMENTS[n];
  if (!instrument) { report.warn('harmony.frame', `A chord diagram with ${n} strings is not supported and was ignored`); return null; }
  const first = Math.round(childNum(frame, 'first-fret', 1)) || 1;
  const frets = Array(n).fill(-1);
  const fingers = Array(n).fill(null);
  for (const note of childrenOf(frame, 'frame-note')) {
    const s = Math.round(childNum(note, 'string', 0));
    if (s < 1 || s > n) continue;
    const i = n - s; // string 1 = the highest = the last of the diagram order
    frets[i] = Math.max(0, Math.round(childNum(note, 'fret', 0)));
    const f = Math.round(childNum(note, 'fingering', 0));
    if (f >= 1 && f <= 4) fingers[i] = f;
  }
  void first; // MusicXML frets are already absolute: first-fret only says where the drawn window starts
  const voicing = { instrument, frets, ...(fingers.some((f) => f) ? { fingers } : {}) };
  if (validateVoicing(voicing).length) { report.warn('harmony.frame', 'A chord diagram with an impossible fingering was ignored'); return null; }
  return voicing;
}

function harmonyTrack(score, parts, bars, masterbars, report) {
  const items = Array.from({ length: bars.length }, () => []);
  let dictionary = createChordQualities();
  let added = false;
  const seen = new Set();
  const findByIntervals = (intervals, preferred) => {
    const matches = dictionary.qualities.filter((q) => sameSet([...q.intervals].sort((a, b) => a - b), intervals));
    return matches.find((q) => preferred && chordQualityNames(q).includes(preferred)) ?? matches[0] ?? null;
  };
  let count = 0;
  let frames = 0;
  for (const part of parts) {
    part.an.part.measures.forEach((me, mi) => {
      for (const h of me.harmonies) {
        if (seen.has(`${mi}:${h.pos[0]}/${h.pos[1]}`)) continue;
        seen.add(`${mi}:${h.pos[0]}/${h.pos[1]}`);
        const root = child(h.el, 'root');
        const kindEl = child(h.el, 'kind');
        const kind = kindEl?.text.trim() ?? '';
        const text = kindEl?.attrs.text ?? '';
        const symbol = { position: h.pos, mi };
        const frame = child(h.el, 'frame');
        const voicing = frame ? frameVoicing(frame, report) : null;
        if (voicing) { symbol.voicing = voicing; frames += 1; }
        if (!root || kind === 'none') { symbol.special = 'noChord'; items[mi].push(symbol); count += 1; continue; }
        symbol.root = { step: childText(root, 'root-step'), alter: Math.round(childNum(root, 'root-alter', 0)) };
        const bass = child(h.el, 'bass');
        if (bass) symbol.bass = { step: childText(bass, 'bass-step'), alter: Math.round(childNum(bass, 'bass-alter', 0)) };
        const degrees = childrenOf(h.el, 'degree').map((d) => ({ value: childNum(d, 'degree-value', 0), alter: childNum(d, 'degree-alter', 0), type: childText(d, 'degree-type') ?? 'add' }));
        const info = chordIntervals(kind, degrees);
        if (!info) {
          // 'other' / unknown kinds: the written text is the quality when it fits an identifier; no intervals known
          symbol.quality = text && text.length <= 16 && !/[\s]/.test(text) ? text : '';
          if (kind !== 'other' || !text) report.warn('harmony.kind', `A chord kind « ${kind} » that Scorsaire cannot interpret was written as plain text`);
          items[mi].push(symbol); count += 1; continue;
        }
        const preferred = text.replace(/^[-−]/, 'm');
        let q = findByIntervals(info.intervals, preferred);
        if (!q) {
          let id = KIND_SHORT[kind] !== undefined ? `${KIND_SHORT[kind]}${info.suffix}` : text || info.suffix;
          if (!id || id.length > 16) id = `q${dictionary.qualities.length + 1}`;
          while (dictionary.qualities.some((x) => chordQualityNames(x).includes(id))) id = `${id.slice(0, 14)}'`;
          dictionary = createChordQualities({ qualities: [...dictionary.qualities, { id, intervals: info.intervals }] });
          q = dictionary.qualities[dictionary.qualities.length - 1];
          added = true;
          report.info('harmony.quality', 'New chord qualities were added to the work dictionary');
        }
        symbol.quality = q.id;
        items[mi].push(symbol); count += 1;
      }
    });
  }
  if (!count) return null;
  if (added && validateChordQualities(dictionary).length) { dictionary = createChordQualities(); report.warn('harmony.dictionary', 'The new chord qualities were invalid and dropped'); }
  const measures = items.map((list, mi) => {
    list.sort((a, b) => fCmp(a.position, b.position));
    const offset = measureOffsetOf(masterbars[mi], mi === 0);
    const elements = list.map((s, k) => {
      const nextPos = list[k + 1] ? list[k + 1].position : bars[mi].len;
      const span = fSub(nextPos, s.position);
      let d = durationOfFraction(span);
      if (!d) {
        const pieces = toRhythmicDurationList(span, { isRest: false, start: s.position, timeSig: bars[mi].timeSig, measureLength: bars[mi].len, allowMeasureRest: false, offset, maxDots: 1 });
        d = pieces[0] ?? { base: 'quarter', dots: 0 };
      }
      return createChordSymbol({ root: s.root, quality: s.quality ?? '', bass: s.bass ?? null, special: s.special, position: s.position, duration: d.base, dots: d.dots, props: s.voicing ? { [PID.DIAGRAM_SHOWN]: true, [PID.VOICING]: s.voicing } : {} });
    });
    return createMeasure(elements);
  });
  if (frames) report.info('harmony.frames', `${frames} chord diagram(s) were imported`);
  const staff = createStaff({ type: 'chord', clef: 'G', voices: [createVoice(measures)] });
  const track = createTrack({ name: 'Chords', abbreviation: 'Ch', staves: [staff] });
  return { track, dictionary: added ? dictionary : null };
}

export { MEASURE_DURATION, writtenDuration, midiFromSpelling, createRest, newId, DEFAULT_CHORD_QUALITIES };
