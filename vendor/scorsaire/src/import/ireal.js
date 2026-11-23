/*
 * iReal Pro import (`irealb://` links, as found in the .html files iReal Pro exports): a chord chart → a work with ONE chord track.
 * PURE (no DOM). The decoder (unscrambling, tokenizer, measure builder) is a faithful port of the one of CCE (Jean's chord-chart editor,
 * which has imported many complex charts without error) — the grammar is the community's documented one (pianosnake/ireal-reader,
 * ireal-renderer). What is new here is the translation into Scorsaire's model.
 *
 *   irealSongs(text)                → [{ title, composer, style, key, bpm, … }]   (every song of a link or of a playlist file)
 *   importIrealSong(song, options)  → { work, report, errors, meta }
 *
 * Rules: a measure holds its chords in EQUAL slots (as CCE does); `%` and `%%` are the repeat symbols (the second measure of `%%` stays empty);
 * `{ }` repeats, `N1 N2` endings (voltas), `[ ]` double bars, `Z` final bar, `*A *B *i *v *c` sections → parts of the form, `Txx` time signatures,
 * `f` fermatas, `Q` coda, `S` segno, `<…>` text (jump texts become jumps and markers, the rest is reported). Chord qualities are looked up in the
 * work's dictionary; a quality it lacks is built from its text and ADDED to the dictionary (and reported).
 */
import { createReport } from './report.js';
import { PID } from '../model/pid.js';
import { frac, fAdd, fSub, fMul, fEq, fCmp, ZERO } from '../model/fraction.js';
import {
  createWork, createMovement, createMasterbar, createTrack, createStaff, createVoice, createMeasure, createChordSymbol, createSystemContainer,
  createVolta, createTempo, createFermata, createMarker, createJump,
} from '../model/elements.js';
import { createChordQualities, findChordQuality, chordQualityNames, validateChordQualities } from '../model/chordquality.js';
import { derivedInputGrid } from '../model/inputgrid.js';
import { toRhythmicDurationList } from '../model/rhythmsplit.js';
import { validateWork } from '../model/validate.js';
import { setProp } from './musicxml-marks.js';
import { durationOfFraction } from './musicxml-build.js';

export class IrealError extends Error {}

// ---------- decoding (port of CCE) ----------

/** Block permutation of the scrambled music: the 5 first characters of a 50-character block swapped with the 5 last, 10-23 with 26-39 (its own inverse). */
function obfusc50(s) {
  const a = s.split('');
  for (let i = 0; i < 5; i += 1) { a[49 - i] = s[i]; a[i] = s[49 - i]; }
  for (let i = 10; i < 24; i += 1) { a[49 - i] = s[i]; a[i] = s[49 - i]; }
  return a.join('');
}
function unscrambleCells(s) {
  let r = '';
  while (s.length > 51) { const p = s.substring(0, 50); s = s.substring(50); r += obfusc50(p); }
  r += s;
  // Kcl / LZ / XyQ are not grammar tokens: artefacts of the permutation, translated back to their meaning
  return r.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   ');
}

function tokenizeCells(raw) {
  const tokens = []; let i = 0; const n = raw.length;
  const chordRe = /^([A-Gxnr])([b#]?)((?:sus|alt|add|[+\-^0-9hob#])*)(\/[A-Gb#]+)?/;
  while (i < n) {
    const c = raw[i];
    if (c === '<') {
      const end = raw.indexOf('>', i);
      if (end === -1) { i += 1; continue; }
      let text = raw.slice(i + 1, end);
      if (text[0] === '*' && /^\*\d\d/.test(text)) text = text.slice(3); // a vertical offset of the display
      tokens.push({ type: 'comment', text });
      i = end + 1; continue;
    }
    if (c === '*') {
      const code = raw[i + 1];
      if (code && /[A-Za-z]/.test(code)) { tokens.push({ type: 'section', code }); i += 2; } else i += 1;
      continue;
    }
    if (c === 'N' && /[0-9]/.test(raw[i + 1] || '')) { tokens.push({ type: 'ending', num: raw[i + 1] }); i += 2; continue; }
    if (c === 'T' && /[0-9]/.test(raw[i + 1] || '')) { tokens.push({ type: 'ts', val: raw.slice(i + 1, i + 3) }); i += 3; continue; }
    if (raw.startsWith('XyQ', i)) { i += 3; continue; }
    if (c === 'X' || c === 'y' || c === 'L' || c === 'Y') { i += 1; continue; }
    if (c === '|') { tokens.push({ type: 'bar' }); i += 1; continue; }
    if (c === '[' || c === ']') { tokens.push({ type: 'barDouble' }); i += 1; continue; }
    if (c === '{') { tokens.push({ type: 'repeatLeft' }); i += 1; continue; }
    if (c === '}') { tokens.push({ type: 'repeatRight' }); i += 1; continue; }
    if (c === 'Z' || c === 'U') { tokens.push({ type: 'end' }); i += 1; continue; }
    if (c === 'Q') { tokens.push({ type: 'coda' }); i += 1; continue; }
    if (c === 'S') { tokens.push({ type: 'segno' }); i += 1; continue; }
    if (c === 'f') { tokens.push({ type: 'fermata' }); i += 1; continue; }
    if (c === 'l' || c === 's' || c === ' ' || c === ',') { i += 1; continue; }
    const m = raw.slice(i).match(chordRe);
    if (m && m[0]) { tokens.push({ type: 'chord', raw: m[0] }); i += m[0].length; continue; }
    if (/[A-Za-z0-9]/.test(c)) { const word = raw.slice(i).match(/^[A-Za-z0-9]+/)[0]; tokens.push({ type: 'comment', text: word }); i += word.length; continue; }
    i += 1;
  }
  return tokens;
}

/** The measures of the chart: { chords: [text|null], section, repeatStart, repeatEnd, repeatCount, barType, volta, fermatas, symbols, notes, ts }. */
function tokensToMeasures(tokens) {
  const measures = [];
  const fresh = (ts) => ({ chords: [null], ts: ts ?? null, section: null, repeatStart: false, repeatEnd: false, repeatCount: null, barType: null, volta: null, symbols: [], notes: [], fermatas: [] });
  let buf = []; let pendingSection = null; let pendingRepeatStart = false; let pendingTS = null; let activeVolta = null; let pendingRepeatCount = null;
  let justClosed = true; let pendingNotes = []; let pendingSymbols = []; let pendingFermataSlots = []; let fermataForNext = false;
  const addNote = (text) => {
    if (buf.length) pendingNotes.push(text);
    else if (measures.length) measures[measures.length - 1].notes.push(text);
    else pendingNotes.push(text);
  };
  const addSymbol = (sym) => {
    if (buf.length) pendingSymbols.push(sym);
    else if (measures.length) { const m = measures[measures.length - 1]; if (!m.symbols.includes(sym)) m.symbols.push(sym); } else pendingSymbols.push(sym);
  };
  const finalize = (chords) => {
    const m = fresh(pendingTS); pendingTS = null;
    if (chords && chords.length) m.chords = chords;
    if (pendingSection) { m.section = pendingSection; pendingSection = null; }
    if (pendingRepeatStart) { m.repeatStart = true; pendingRepeatStart = false; }
    if (pendingRepeatCount != null) { m.repeatCount = pendingRepeatCount; pendingRepeatCount = null; }
    if (pendingNotes.length) { m.notes.push(...pendingNotes); pendingNotes = []; }
    for (const s of pendingSymbols) if (!m.symbols.includes(s)) m.symbols.push(s);
    pendingSymbols = [];
    if (pendingFermataSlots.length) { m.fermatas.push(...pendingFermataSlots); pendingFermataSlots = []; }
    if (activeVolta) {
      if (!activeVolta.attached) { m.volta = { text: activeVolta.text, span: 1 }; activeVolta.attached = true; activeVolta.m = m; } else activeVolta.m.volta.span += 1;
    }
    measures.push(m);
    justClosed = true;
  };
  const flush = () => {
    if (buf.length) { finalize(buf); buf = []; } else if (!justClosed) finalize(null);
  };
  const push = (v) => {
    buf.push(v); justClosed = false;
    if (fermataForNext) { pendingFermataSlots.push(buf.length - 1); fermataForNext = false; }
  };
  const simile = (sym) => {
    flush(); buf = [sym]; flush();
    if (sym === '%%') finalize(null); // the double simile spans two measures
  };
  for (const tok of tokens) {
    switch (tok.type) {
      case 'chord': {
        const note = tok.raw[0];
        if (note === 'n') push('N.C.');
        else if (note === 'x') simile('%');
        else if (note === 'r') simile('%%');
        else push(tok.raw);
        break;
      }
      case 'bar': flush(); break;
      case 'barDouble': flush(); if (measures.length) measures[measures.length - 1].barType = 'double'; break;
      case 'repeatLeft': flush(); pendingRepeatStart = true; break;
      case 'repeatRight': flush(); if (measures.length) measures[measures.length - 1].repeatEnd = true; activeVolta = null; break;
      case 'end': flush(); if (measures.length) measures[measures.length - 1].barType = 'final'; break;
      case 'section': pendingSection = tok.code; break;
      case 'ending': activeVolta = { text: tok.num, attached: false }; break;
      case 'ts': pendingTS = tok.val === '12' ? { num: 12, den: 8 } : { num: parseInt(tok.val[0], 10) || 4, den: parseInt(tok.val[1], 10) || 4 }; break;
      case 'coda': addSymbol('coda'); break;
      case 'segno': addSymbol('segno'); break;
      case 'fermata': fermataForNext = true; break;
      case 'comment': {
        const rc = tok.text.trim().match(/^(\d+)\s*x$/i);
        if (rc) {
          const count = parseInt(rc[1], 10);
          if (!buf.length && measures.length) { const last = measures[measures.length - 1]; if (last.repeatCount == null) { last.repeatCount = count; break; } }
          pendingRepeatCount = count;
        } else pendingNotes.push(tok.text);
        break;
      }
      default: break;
    }
  }
  if (buf.length) flush();
  if (measures.length > 1) { // the empty measure that the final bar often leaves at the end
    const last = measures[measures.length - 1];
    if (last.chords.every((c) => !c) && !last.section && !last.volta && !last.notes.length) measures.pop();
  }
  return measures;
}

/** One song of an iReal data block ('=' separated fields). */
function parseSongData(data) {
  const parts = data.split('=');
  const music = (parts[6] || '').split('1r34LbKcu7');
  let cells = '';
  try { cells = unscrambleCells(music[1] || ''); } catch { cells = ''; }
  const composerRaw = parts[1] || '';
  const cs = composerRaw.split(' ');
  return {
    title: parts[0] || '', composer: cs.length === 2 ? `${cs[1]} ${cs[0]}` : composerRaw, style: parts[3] || '', key: parts[4] || '',
    transpose: parseInt(parts[5], 10) || 0, compStyle: parts[7] || '', bpm: parseInt(parts[8], 10) || null, repeats: parseInt(parts[9], 10) || 3, cells,
  };
}

/** Every song of a text holding an `irealb://` link (an iReal Pro .html file, or the link pasted as is). A playlist ends with its own name. */
export function irealSongs(text) {
  if (/irealbook:\/\//.test(text) && !/irealb:\/\//.test(text)) throw new IrealError('The old irealbook:// format is not supported');
  let raw = null;
  const attr = /(["'])irealb:\/\/(.*?)\1/s.exec(text);
  if (attr) raw = attr[2];
  else { const bare = /irealb:\/\/(.*)/s.exec(text); if (bare) raw = bare[1].trim(); }
  if (raw === null) throw new IrealError('No iReal Pro link (irealb://) found in the file');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new IrealError('The iReal Pro link cannot be decoded'); }
  const parts = decoded.split('===').filter((p) => p);
  if (parts.length > 1) parts.pop(); // the name of the playlist
  return parts.map(parseSongData);
}

/** A title without its « part » mark: « Song (1/2) », « Song - Part 1 », « Song [page 1] » → « Song ». */
export const stripPartMark = (title) => String(title).replace(/\s*[-–]?\s*[(\[]?\s*(?:part|partie|page|pt\.?|pg\.?)?\s*\d\s*(?:\/|of|sur)\s*\d+\s*[)\]]?\s*$/i, '').replace(/\s*[-–]?\s*[(\[]?\s*(?:part|partie|page|pt\.?|pg\.?)\s*\d\s*[)\]]?\s*$/i, '').trim() || String(title).trim();

/**
 * Several songs of a setlist made ONE, in the order given: iReal Pro cannot hold a chart of two pages, so a long song is written as « Song (1/2) » and « Song (2/2) ». The chart of the
 * first one loses its final bar, the next ones follow; title (without its part mark), author, style, key and tempo are those of the first.
 */
export function mergeIrealSongs(songs) {
  if (!songs.length) throw new IrealError('No song to merge');
  const first = songs[0];
  const cells = songs.map((s, i) => (i < songs.length - 1 ? String(s.cells).replace(/[ZU\s]+$/, '') : String(s.cells))).join('|');
  return { ...first, title: stripPartMark(first.title), cells };
}

/** The name of the playlist (a setlist) of an iReal Pro file: the last part of the link when it holds several songs, else ''. */
export function irealPlaylistName(text) {
  const attr = /(["'])irealb:\/\/(.*?)\1/s.exec(text);
  const raw = attr ? attr[2] : /irealb:\/\/(.*)/s.exec(text)?.[1]?.trim();
  if (!raw) return '';
  let decoded; try { decoded = decodeURIComponent(raw); } catch { return ''; }
  const parts = decoded.split('===').filter((x) => x);
  return parts.length > 1 ? parts[parts.length - 1].trim() : '';
}

/** True when a text looks like an iReal Pro export (a link in a .html file, or a pasted link). */
export const looksLikeIreal = (text) => /irealb(ook)?:\/\//.test(text);

// ---------- chords ----------

const FIFTHS_MAJOR = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const FIFTHS_MINOR = { A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 };
/** Key signature (−7..7) of an iReal key ('Bb', 'F#-'). */
export function irealKeyFifths(key) {
  const k = String(key ?? '').trim();
  if (!k) return 0;
  const minor = k.endsWith('-');
  const root = minor ? k.slice(0, -1) : k;
  return (minor ? FIFTHS_MINOR : FIFTHS_MAJOR)[root] ?? 0;
}

/** The quality text of an iReal chord in Scorsaire's vocabulary ('-7' → 'm7', '^7' → 'M7', 'h7' → 'm7b5', '0' → 'o7', '+' → 'aug', 'sus' → 'sus4'). */
export function normalizeQuality(q) {
  let s = q;
  s = s.replace(/^h7?/, 'm7b5').replace(/^h9/, 'm9b5');
  s = s.replace(/^-?\^(\d*)/, (m, d) => (m.startsWith('-') ? 'mM' : 'M') + (d || '7'));
  s = s.replace(/^-/, 'm');
  s = s.replace(/^0(?!\d)/, 'o7').replace(/^o7?/, (m) => (m === 'o7' ? 'o7' : 'o'));
  s = s.replace(/^\+/, 'aug');
  s = s.replace(/^(7?)sus(?![24])/, '$1sus4');
  s = s.replace(/^2$/, 'sus2');
  return s;
}

/** Intervals (semitones above the root) of a normalised quality text, or null when it cannot be read. */
export function qualityIntervals(text) {
  let s = text;
  let minor = false; let dim = false; let aug = false; let maj = false; let sus = null; let alt = false;
  if (/^m(?!aj)/.test(s)) { minor = true; s = s.slice(1); } else if (/^o/.test(s)) { dim = true; s = s.slice(1); } else if (/^aug/.test(s)) { aug = true; s = s.slice(3); }
  const susM = /sus(2|4)?/.exec(s);
  if (susM) { sus = susM[1] === '2' ? 2 : 5; s = s.replace(susM[0], ''); }
  if (/^(M|maj)(?=\d|$)/.test(s)) { maj = true; s = s.replace(/^(M|maj)/, ''); }
  if (/alt/.test(s)) { alt = true; s = s.replace('alt', ''); }
  const adds = []; s = s.replace(/add(\d+)/g, (m, d) => { adds.push(Number(d)); return ''; });
  const alters = []; s = s.replace(/([b#])(5|9|11|13)/g, (m, a, d) => { alters.push([a, Number(d)]); return ''; });
  const num = /^(5|69|6|7|9|11|13)/.exec(s);
  if (num) s = s.slice(num[0].length);
  if (s !== '') return null;
  const n = num ? num[1] : null;
  const third = sus ?? (minor || dim ? 3 : 4);
  const fifth = dim ? 6 : aug ? 8 : 7;
  let set = n === '5' ? [0, 7] : [0, third, fifth];
  const seventh = dim ? 9 : maj ? 11 : 10;
  if (n === '6') set.push(9);
  else if (n === '69') set.push(9, 14);
  else if (n === '7') set.push(seventh);
  else if (n === '9') set.push(seventh, 14);
  else if (n === '11') set.push(seventh, 14, 17);
  else if (n === '13') set.push(seventh, 14, 17, 21);
  else if (maj) set.push(11);
  if (alt) set = [0, 4, 6, 8, 10, 13, 15];
  for (const a of adds) set.push(a === 2 || a === 9 ? 14 : a === 4 || a === 11 ? 17 : a === 6 || a === 13 ? 21 : a);
  for (const [a, d] of alters) {
    const base = { 5: 7, 9: 14, 11: 17, 13: 21 }[d]; const to = base + (a === 'b' ? -1 : 1);
    set = set.filter((x) => x !== base); if (d === 5) set = set.filter((x) => x !== 6 && x !== 8);
    set.push(to);
  }
  return [...new Set(set)].sort((a, b) => a - b);
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Chord text of the chart → { root, quality, bass } (quality = identifier in the dictionary). Adds a missing quality to `dict.current`. */
export function parseChord(raw, dict, report) {
  const text = raw.replace(/^W\//, '');
  const m = /^([A-G])([b#]?)(.*?)(?:\/([A-G])([b#]?))?$/.exec(text);
  if (!m) { report.warn('ireal.chord', 'A chord that cannot be read was ignored'); return null; }
  const alter = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
  const quality = normalizeQuality(m[3]);
  let id = '';
  if (quality) {
    const found = findChordQuality(dict.current, quality);
    if (found) id = found.id;
    else {
      const intervals = qualityIntervals(quality);
      if (!intervals) { report.warn('ireal.quality', 'A chord quality that cannot be read was written as a plain chord'); }
      else {
        const byIntervals = dict.current.qualities.find((q) => sameSet([...q.intervals].sort((a, b) => a - b), intervals));
        if (byIntervals) id = byIntervals.id;
        else {
          let newId = quality.length <= 16 ? quality : quality.slice(0, 16);
          while (dict.current.qualities.some((q) => chordQualityNames(q).includes(newId))) newId = `${newId.slice(0, 15)}'`;
          dict.current = createChordQualities({ qualities: [...dict.current.qualities, { id: newId, intervals }] });
          dict.added = true; id = newId;
          report.info('ireal.newquality', 'New chord qualities were added to the work dictionary');
        }
      }
    }
  }
  return { root: { step: m[1], alter: alter(m[2]) }, quality: id, bass: m[4] ? { step: m[4], alter: alter(m[5]) } : null };
}

// ---------- the work ----------

const SECTION_NAMES = {
  en: { i: 'Intro', v: 'Verse', c: 'Chorus', u: 'Bridge' },
  fr: { i: 'Intro', v: 'Couplet', c: 'Refrain', u: 'Pont' },
};
const SECTION_CATEGORY = { i: 'intro', v: 'verse', c: 'chorus', u: 'bridge' };

function sectionOf(code, lang) {
  const names = SECTION_NAMES[lang] ?? SECTION_NAMES.en;
  if (SECTION_CATEGORY[code]) return { label: names[code], category: SECTION_CATEGORY[code] };
  if (/^[A-H]$/.test(code)) return { label: code, category: 'letter' };
  return { label: String(code), category: 'custom' };
}

const JUMP_TEXT = [
  [/^D\.?\s?C\.?\s+al\s+Fine$/i, 'dcAlFine'], [/^D\.?\s?C\.?\s+al\s+Coda$/i, 'dcAlCoda'], [/^D\.?\s?C\.?$/i, 'dc'],
  [/^D\.?\s?S\.?\s+al\s+Fine$/i, 'dsAlFine'], [/^D\.?\s?S\.?\s+al\s+Coda$/i, 'dsAlCoda'], [/^D\.?\s?S\.?$/i, 'ds'],
];

/** Imports one song of `irealSongs`. options: { lang = 'en' } (the language of the section names). */
export function importIrealSong(song, { lang = 'en' } = {}) {
  const report = createReport();
  const tokens = tokenizeCells(song.cells);
  const measures = tokensToMeasures(tokens);
  if (!measures.length) throw new IrealError('The chart holds no measure');
  const dict = { current: createChordQualities(), added: false };
  const key = irealKeyFifths(song.key);

  // time signatures carried forward
  let ts = { num: 4, den: 4 };
  const barTs = measures.map((m) => { if (m.ts) ts = m.ts; return [ts.num, ts.den]; });
  const masterbars = measures.map((m, i) => {
    const props = {};
    if (m.repeatStart) props[PID.REPEAT_START] = true;
    if (m.repeatEnd) { props[PID.REPEAT_END] = true; if (m.repeatCount && m.repeatCount > 2) props[PID.REPEAT_COUNT] = m.repeatCount; }
    return createMasterbar({ timeSig: barTs[i], keySig: key, barType: m.repeatEnd ? 'simple' : (m.barType ?? 'simple'), props });
  });
  const barId = (i) => masterbars[i].id;
  const lens = barTs.map(([n, d]) => frac(n, d));

  // chord symbols
  const symbolMeasures = measures.map((m, i) => {
    const len = lens[i];
    const entries = m.chords.map((c, k) => ({ c, k })).filter((x) => x.c);
    const items = []; const starts = [];
    const slot = (k, n) => fMul(len, frac(k, n));
    entries.forEach((e, k) => {
      const pos = slot(k, entries.length);
      const span = k + 1 < entries.length ? fSub(slot(k + 1, entries.length), pos) : fSub(len, pos);
      let d = durationOfFraction(span);
      if (!d) d = toRhythmicDurationList(span, { isRest: false, start: pos, timeSig: barTs[i], measureLength: len, allowMeasureRest: false, offset: ZERO, maxDots: 1 })[0] ?? { base: 'quarter', dots: 0 };
      if (e.c === '%' || e.c === '%%') items.push(createChordSymbol({ special: e.c === '%' ? 'repeat1' : 'repeat2', position: pos, duration: d.base, dots: d.dots }));
      else if (e.c === 'N.C.') items.push(createChordSymbol({ special: 'noChord', position: pos, duration: d.base, dots: d.dots }));
      else {
        const chord = parseChord(e.c, dict, report);
        if (chord) items.push(createChordSymbol({ root: chord.root, quality: chord.quality, bass: chord.bass, position: pos, duration: d.base, dots: d.dots }));
        else return;
      }
      starts.push(pos);
    });
    return { items, starts };
  });
  // the input grid follows the slots when they differ from the grid of the time signature
  symbolMeasures.forEach((sm, i) => {
    if (!sm.starts.length) return;
    const derived = derivedInputGrid(masterbars[i], i === 0).map((c) => c.start);
    if (derived.length !== sm.starts.length || derived.some((s, k) => !fEq(s, sm.starts[k]))) setProp(masterbars[i], PID.INPUT_GRID, sm.starts);
  });
  const staff = createStaff({ type: 'chord', clef: 'G', voices: [createVoice(symbolMeasures.map((sm) => createMeasure(sm.items)))] });
  const track = createTrack({ name: lang === 'fr' ? 'Accords' : 'Chords', abbreviation: 'Ch', staves: [staff] });

  // sections, voltas, markers, jumps, fermatas
  const containers = []; const voltas = []; const markers = []; const jumps = []; const fermatas = [];
  measures.forEach((m, i) => {
    if (m.section) { const s = sectionOf(m.section, lang); containers.push(createSystemContainer({ measureId: barId(i), kind: 'section', label: s.label, category: s.category })); }
    if (m.volta) {
      const end = Math.min(measures.length - 1, i + m.volta.span - 1);
      const closed = measures[end].repeatEnd;
      voltas.push(createVolta({ measureId: barId(i), span: m.volta.span, numbers: [Number(m.volta.text) || 1], open: !closed }));
    }
    for (const sym of m.symbols) markers.push(createMarker({ measureId: barId(i), markerType: sym }));
    for (const slotIndex of m.fermatas) {
      const entries = m.chords.map((c, k) => ({ c, k })).filter((x) => x.c);
      const at = entries.findIndex((e) => e.k === slotIndex);
      const pos = at <= 0 ? ZERO : fMul(lens[i], frac(at, entries.length));
      fermatas.push(createFermata({ measureId: barId(i), position: pos }));
    }
    for (const text of m.notes) {
      const t = text.trim();
      const jump = JUMP_TEXT.find(([re]) => re.test(t));
      if (jump) jumps.push(createJump({ measureId: barId(i), jumpType: jump[1] }));
      else if (/^fine$/i.test(t)) markers.push(createMarker({ measureId: barId(i), markerType: 'fine' }));
      else if (/^to\s+coda$/i.test(t)) markers.push(createMarker({ measureId: barId(i), markerType: 'toCoda' }));
      else report.warn('ireal.text', 'A text of the chart (instructions, comments) was not imported');
    }
  });
  const tempos = song.bpm && song.bpm >= 5 && song.bpm <= 999 ? [createTempo({ measureId: barId(0), position: ZERO, bpm: song.bpm })] : [];
  const movement = createMovement({ title: song.title, masterbars, tracks: [track], systemContainers: containers, voltas, markers, jumps, fermatas, tempos });
  const props = {};
  if (song.composer) props[PID.COMPOSER] = song.composer;
  if (song.style) props[PID.SUBTITLE] = song.style; // the style (« Jazz-Medium Swing »)
  if (dict.added && !validateChordQualities(dict.current).length) props[PID.CHORD_QUALITIES] = dict.current;
  const work = createWork({ title: song.title, movements: [movement], props });
  report.stat('measures', measures.length);
  report.stat('tracks', 1);
  return { work, report: report.result(), errors: validateWork(work), meta: { title: song.title, composer: song.composer, style: song.style, key: song.key, bpm: song.bpm } };
}

export { fAdd, fCmp };
