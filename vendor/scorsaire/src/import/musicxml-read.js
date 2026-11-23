/*
 * MusicXML import, PASS 1: reads the XML tree (score-partwise) into a flat intermediate representation. No model code here.
 * Positions and durations are exact fractions of a whole note (`fraction.js`), computed from <divisions> at the moment each element is met.
 * Rules follow MuseScore 4.7.5 (`importmusicxmlpass1/2.cpp`): the cursor advances with <duration> of non-grace, non-chord notes, <forward> and
 * <backup>; a <chord/> note shares the start and duration of the PREVIOUS note; <offset> of a direction/harmony shifts it from the cursor.
 */
import { child, childrenOf, childText, childInt, childNum } from './xml.js';
import { frac, fAdd, fSub, fMul, fCmp, fEq, ZERO } from '../model/fraction.js';

export class MusicXmlError extends Error {}

const num = (s, fallback = null) => { const v = Number(s); return Number.isFinite(v) ? v : fallback; };

/** Fraction of a whole note: `n` divisions when a quarter note = `divisions`. */
const divFrac = (n, divisions) => frac(n, 4 * divisions);

function readPartList(root) {
  const list = child(root, 'part-list');
  const parts = []; const groupEvents = [];
  if (!list) return { parts, groupEvents };
  for (const el of list.children) {
    if (el.name === 'part-group') {
      groupEvents.push({
        type: el.attrs.type, number: el.attrs.number ?? '1', at: parts.length,
        name: childText(el, 'group-name'), symbol: childText(el, 'group-symbol'), barline: childText(el, 'group-barline'),
      });
    } else if (el.name === 'score-part') {
      const instruments = new Map(); const midi = new Map();
      for (const si of childrenOf(el, 'score-instrument')) {
        instruments.set(si.attrs.id, { name: childText(si, 'instrument-name'), sound: childText(si, 'instrument-sound') });
      }
      for (const mi of childrenOf(el, 'midi-instrument')) {
        midi.set(mi.attrs.id, {
          channel: childInt(mi, 'midi-channel'), program: childInt(mi, 'midi-program'), unpitched: childInt(mi, 'midi-unpitched'),
          volume: childNum(mi, 'volume'), pan: childNum(mi, 'pan'),
        });
      }
      parts.push({ id: el.attrs.id, name: childText(el, 'part-name'), abbr: childText(el, 'part-abbreviation'), instruments, midi });
    }
  }
  return { parts, groupEvents };
}

function readPitch(el) {
  const p = child(el, 'pitch');
  if (!p) return null;
  const step = childText(p, 'step'); const octave = childInt(p, 'octave');
  if (!step || octave === null) return null;
  return { step, alter: childNum(p, 'alter', 0), octave };
}

function readUnpitched(el) {
  const u = child(el, 'unpitched');
  if (!u) return null;
  return { step: childText(u, 'display-step') ?? 'E', octave: childInt(u, 'display-octave', 4) };
}

/** <time> → { beats (sum), beatType, additive: [..] | null, symbol } */
function readTime(el) {
  const beats = childText(el, 'beats'); const beatType = childInt(el, 'beat-type');
  if (!beats || !beatType) return null;
  const parts = beats.split('+').map((s) => num(s.trim())).filter((v) => v !== null && v > 0);
  if (!parts.length) return null;
  return { beats: parts.reduce((a, b) => a + b, 0), beatType, additive: parts.length > 1 ? parts : null, symbol: el.attrs.symbol ?? null };
}

function readClef(el) {
  return {
    number: num(el.attrs.number, 1), sign: childText(el, 'sign'), line: childInt(el, 'line'), octave: childInt(el, 'clef-octave-change', 0),
  };
}

function readAttributes(el, state, pos) {
  const block = { pos };
  const div = childInt(el, 'divisions');
  if (div && div > 0) { state.divisions = div; block.divisions = div; }
  const key = child(el, 'key');
  if (key) {
    const fifths = childInt(key, 'fifths');
    if (fifths !== null) block.key = { fifths, mode: childText(key, 'mode'), number: num(key.attrs.number, null) };
  }
  const time = childrenOf(el, 'time')[0];
  if (time) { const t = readTime(time); if (t) block.time = t; }
  const staves = childInt(el, 'staves');
  if (staves) block.staves = staves;
  const clefs = childrenOf(el, 'clef').map(readClef).filter((c) => c.sign);
  if (clefs.length) block.clefs = clefs;
  const tr = child(el, 'transpose');
  if (tr) {
    block.transpose = {
      diatonic: childInt(tr, 'diatonic', 0), chromatic: childInt(tr, 'chromatic', 0), octaveChange: childInt(tr, 'octave-change', 0), double: !!child(tr, 'double'),
    };
  }
  const details = childrenOf(el, 'staff-details');
  if (details.length) {
    block.staffDetails = details.map((d) => ({
      number: num(d.attrs.number, 1), lines: childInt(d, 'staff-lines'),
      tuning: childrenOf(d, 'staff-tuning').map((t) => ({ line: num(t.attrs.line, 1), step: childText(t, 'tuning-step'), alter: childNum(t, 'tuning-alter', 0), octave: childInt(t, 'tuning-octave') })),
      capo: childInt(d, 'capo'),
    }));
  }
  const style = childrenOf(el, 'measure-style');
  if (style.length) block.measureStyles = style.map((s) => ({ number: num(s.attrs.number, 1), slash: !!child(s, 'slash'), multipleRest: childInt(s, 'multiple-rest') }));
  return block;
}

function readBarline(el) {
  const rep = child(el, 'repeat');
  const end = child(el, 'ending');
  return {
    location: el.attrs.location ?? 'right',
    style: childText(el, 'bar-style'),
    repeat: rep ? { direction: rep.attrs.direction, times: num(rep.attrs.times, null) } : null,
    ending: end ? { numbers: end.attrs.number ?? '1', type: end.attrs.type } : null,
    segno: child(el, 'segno') ? (child(el, 'segno').attrs.smufl ?? true) : null,
    coda: child(el, 'coda') ? true : null,
    fermata: !!child(el, 'fermata'),
  };
}

function readGrace(el) {
  const g = child(el, 'grace');
  if (!g) return null;
  return { slash: g.attrs.slash === 'yes', stealPrevious: num(g.attrs['steal-time-previous'], 0), stealFollowing: num(g.attrs['steal-time-following'], 0) };
}

function readTimeMod(el) {
  const tm = child(el, 'time-modification');
  if (!tm) return null;
  const actual = childInt(tm, 'actual-notes'); const normal = childInt(tm, 'normal-notes');
  if (!actual || !normal) return null;
  const nt = childText(tm, 'normal-type');
  return { actual, normal, normalType: nt, normalDots: childrenOf(tm, 'normal-dot').length };
}

/** Notations flags that matter to the structure (tuplet start/stop); the rest is read later by the marks pass from the element. */
function tupletFlags(el) {
  const out = { start: false, stop: false };
  const nots = childrenOf(el, 'notations');
  for (const n of nots) for (const t of childrenOf(n, 'tuplet')) {
    if (t.attrs.type === 'start') out.start = true;
    if (t.attrs.type === 'stop') out.stop = true;
  }
  return out;
}

function readNote(el, state) {
  const grace = readGrace(el);
  const isRest = !!child(el, 'rest');
  const durDiv = childNum(el, 'duration');
  const rest = child(el, 'rest');
  const type = childText(el, 'type');
  const dots = childrenOf(el, 'dot').length;
  const note = {
    el,
    kind: isRest ? 'rest' : 'note',
    isChord: !!child(el, 'chord'),
    grace,
    staff: childInt(el, 'staff', 1),
    voice: childText(el, 'voice') ?? '1',
    dur: grace || durDiv === null ? null : divFrac(durDiv, state.divisions),
    type: type && type !== 'measure' ? type : null,
    dots,
    mod: readTimeMod(el),
    tuplet: tupletFlags(el),
    pitch: readPitch(el),
    unpitched: readUnpitched(el),
    measureRest: !!(rest && rest.attrs.measure === 'yes'),
    printObject: el.attrs['print-object'] !== 'no',
    instrumentId: child(el, 'instrument')?.attrs.id ?? null,
    notehead: childText(el, 'notehead'),
    noteheadParens: child(el, 'notehead')?.attrs.parentheses === 'yes',
    stem: childText(el, 'stem'),
    tieStart: childrenOf(el, 'tie').some((t) => t.attrs.type === 'start'),
    tieStop: childrenOf(el, 'tie').some((t) => t.attrs.type === 'stop'),
  };
  for (const nt of childrenOf(el, 'notations')) {
    for (const tech of childrenOf(nt, 'technical')) {
      const string = childInt(tech, 'string'); const fret = childInt(tech, 'fret');
      if (string !== null && fret !== null) { note.string = string; note.fret = fret; }
    }
  }
  return note;
}

function readMeasure(el, part, state) {
  const m = {
    number: el.attrs.number ?? '', implicit: el.attrs.implicit === 'yes', nonControlling: el.attrs['non-controlling'] === 'yes',
    notes: [], dirs: [], harmonies: [], attrs: [], barlines: [], end: ZERO, maxEnd: ZERO,
  };
  let cursor = ZERO;
  let prevNote = null; // for <chord/>
  let lastStart = ZERO;
  for (const c of el.children) {
    switch (c.name) {
      case 'attributes': m.attrs.push(readAttributes(c, state, cursor)); break;
      case 'note': {
        const n = readNote(c, state);
        if (n.isChord && prevNote) { n.pos = prevNote.pos; n.dur = prevNote.dur; }
        else { n.pos = cursor; }
        if (!n.grace && !n.isChord) {
          if (n.dur === null) n.dur = ZERO;
          lastStart = cursor;
          cursor = fAdd(cursor, n.dur);
          if (fCmp(cursor, m.maxEnd) > 0) m.maxEnd = cursor;
        }
        if (n.grace && !n.isChord) lastStart = cursor;
        if (n.grace) n.pos = cursor;
        n.partId = part.id;
        m.notes.push(n);
        prevNote = n;
        break;
      }
      case 'forward': {
        const d = childNum(c, 'duration', 0);
        cursor = fAdd(cursor, divFrac(d, state.divisions));
        if (fCmp(cursor, m.maxEnd) > 0) m.maxEnd = cursor;
        prevNote = null;
        break;
      }
      case 'backup': {
        const d = childNum(c, 'duration', 0);
        cursor = fSub(cursor, divFrac(d, state.divisions));
        if (fCmp(cursor, ZERO) < 0) cursor = ZERO;
        prevNote = null;
        break;
      }
      case 'direction': {
        const off = childNum(c, 'offset', 0);
        const pos = off ? fAdd(cursor, divFrac(off, state.divisions)) : cursor;
        m.dirs.push({ el: c, pos: fCmp(pos, ZERO) < 0 ? ZERO : pos, staff: childInt(c, 'staff', null), voice: childText(c, 'voice'), placement: c.attrs.placement ?? null, part: part.id });
        break;
      }
      case 'harmony': {
        const off = childNum(c, 'offset', 0);
        const pos = off ? fAdd(cursor, divFrac(off, state.divisions)) : cursor;
        m.harmonies.push({ el: c, pos: fCmp(pos, ZERO) < 0 ? ZERO : pos, staff: childInt(c, 'staff', null), part: part.id });
        break;
      }
      case 'barline': m.barlines.push(readBarline(c)); break;
      case 'sound': m.dirs.push({ el: { name: 'direction', attrs: {}, children: [c], text: '' }, pos: cursor, staff: null, voice: null, placement: null, part: part.id }); break;
      default: break;
    }
  }
  m.end = cursor;
  void lastStart;
  return m;
}

function readPart(el, info) {
  const state = { divisions: 1 };
  const measures = [];
  for (const me of childrenOf(el, 'measure')) measures.push(readMeasure(me, info, state));
  return { id: el.attrs.id, info, measures };
}

/** Text of the first <credit> whose <credit-type> is `type`. */
function creditWords(root, type) {
  for (const c of childrenOf(root, 'credit')) {
    if (childrenOf(c, 'credit-type').some((t) => t.text.trim() === type)) {
      const words = childrenOf(c, 'credit-words').map((w) => w.text.trim()).filter(Boolean).join(' ');
      if (words) return words;
    }
  }
  return null;
}

/** Reads the root element of a score-partwise document. */
export function readMusicXml(root) {
  if (root.name === 'score-timewise') throw new MusicXmlError('score-timewise files are not supported (convert to score-partwise)');
  if (root.name !== 'score-partwise') throw new MusicXmlError(`Not a MusicXML score (root element « ${root.name} »)`);
  const { parts: infos, groupEvents } = readPartList(root);
  const byId = new Map(infos.map((p) => [p.id, p]));
  const parts = [];
  for (const pe of childrenOf(root, 'part')) {
    const info = byId.get(pe.attrs.id) ?? { id: pe.attrs.id, name: pe.attrs.id, abbr: null, instruments: new Map(), midi: new Map() };
    parts.push(readPart(pe, info));
  }
  const ident = child(root, 'identification');
  const creators = {};
  for (const c of childrenOf(ident, 'creator')) {
    const t = (c.attrs.type ?? 'composer').toLowerCase();
    if (!creators[t] && c.text.trim()) creators[t] = c.text.trim();
  }
  const meta = {
    title: childText(child(root, 'work'), 'work-title') || childText(root, 'movement-title') || creditWords(root, 'title'),
    subtitle: creditWords(root, 'subtitle'),
    composer: creators.composer ?? creditWords(root, 'composer'),
    lyricist: creators.lyricist ?? creditWords(root, 'lyricist'),
    arranger: creators.arranger ?? creditWords(root, 'arranger'),
    rights: childText(ident, 'rights') ?? creditWords(root, 'rights'),
    software: childText(child(ident, 'encoding'), 'software'),
  };
  return { meta, parts, partInfos: infos, groupEvents, version: root.attrs.version ?? null };
}

export { fEq, fMul };
