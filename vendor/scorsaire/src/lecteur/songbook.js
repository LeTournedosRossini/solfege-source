/*
 * The SONGBOOK view of a song: the lyrics as text, line by line, with the chords written above the syllable that sounds when they change (what a singer-guitarist reads).
 * Everything is derived from what the file already holds: the lyric texts and their links to the chords of notes (model/lyrics.js), and the symbols of the first chord track.
 * Both sit on the same grid of beats, so a chord goes above the syllable whose time is the last one before it; a chord that comes more than a measure after the last syllable
 * of a phrase (an instrumental part) is written on a line of its own. Pure: no DOM.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { resolveLyricLinks, BAR } from '../model/lyrics.js';
import { chordSymbolsInSpan } from '../model/fretdiagram.js';
import { findChordQuality } from '../model/chordquality.js';
import { qualityTokens, variantTokens } from '../layout/chorddisplay.js';
import { itemDuration, measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';
import { freeSheetLines } from './freesheet.js';
import { defaultSectionColor } from '../model/sections.js';
import { lyricEventsOf } from '../model/lyricevents.js';
import { sectionSpans } from '../model/sections.js';

const PIECE_CHARS = { csymMinor: '-', csymHalfDiminished: 'ø', csymMajorSeventh: 'Δ', csymMajorSeventhRound: 'Δ', csymAugmented: '+', csymDiminished: '°', csymAccidentalFlat: '♭', csymAccidentalSharp: '♯' };
const PLAIN_STYLE = { minor: 'dash', halfDim: 'sym', delta: 'sym', dash: 'std' };
const ACCIDENTAL = (alter) => (alter > 0 ? '♯'.repeat(alter) : alter < 0 ? '♭'.repeat(-alter) : '');
const MAX_PER_LINE = 10; // syllables, when the text has no line breaks of its own

/** The written name of a chord symbol: root + quality (the work's own spelling when it has one) + /bass. */
export function chordText(sym, dict) {
  const root = getProperty(sym, PID.CHORD_ROOT);
  if (!root) return '';
  const quality = getProperty(sym, PID.CHORD_QUALITY) ?? '';
  const entry = quality ? findChordQuality(dict, quality) : null;
  const tokens = entry?.shown != null ? variantTokens(entry.shown, PLAIN_STYLE) : qualityTokens(quality, PLAIN_STYLE);
  const bass = getProperty(sym, PID.CHORD_BASS);
  return `${root.step}${ACCIDENTAL(root.alter ?? 0)}${tokens.map((t) => t.text ?? PIECE_CHARS[t.glyph] ?? '').join('')}${bass ? `/${bass.step}${ACCIDENTAL(bass.alter ?? 0)}` : ''}`;
}

/** Syllables of a verse text with the line breaks the author typed: [{ text, syllabic, index, newline }] (the same ranks as `parseLyricsText`). */
export function syllablesWithBreaks(text) {
  const out = [];
  const parts = String(text ?? '').split(/(\s+)/);
  let breakBefore = false;
  let bar = 0; let seen = false; let lastBar = false; // the bar lines seen so far (a text written on the grid of measures); one in front of everything only marks the start
  for (let k = 0; k < parts.length; k += 1) {
    const part = parts[k];
    if (k % 2 === 1) { if (part.includes('\n')) breakBefore = true; continue; }
    if (!part) continue;
    // a bar that opens a line right after the bar that closed the line before is only decoration (« … | » then « | … »)
    if (part === BAR) { if (seen && !(lastBar && breakBefore)) bar += 1; seen = true; lastBar = true; continue; }
    seen = true; lastBar = false;
    if (part === '_' || part === '-') continue;
    const pieces = part.split(/(?<=[^-])-(?=[^-])/);
    pieces.forEach((p, i) => {
      out.push({ text: p, join: i === pieces.length - 1 ? ' ' : '-', index: out.length, newline: i === 0 && breakBefore && out.length > 0, bar });
      if (i === 0) breakBefore = false;
    });
  }
  return out;
}

/** Time (whole notes from the start of the movement) of every chord of notes of a staff: Map(chord id → time). */
function chordTimes(movement, staff) {
  const starts = []; let acc = 0;
  for (const mb of movement.masterbars) { starts.push(acc); acc += fToNumber(measureLengthOf(mb)); }
  const out = new Map();
  for (const voice of staff.voices) {
    voice.measures.forEach((m, mi) => {
      const length = movement.masterbars[mi] ? measureLengthOf(movement.masterbars[mi]) : null;
      let at = 0;
      for (const item of m?.items ?? []) {
        if (item.type === 'chord' && !out.has(item.id)) out.set(item.id, (starts[mi] ?? 0) + at);
        if (length) at += fToNumber(itemDuration(item, length));
      }
    });
  }
  return { times: out, starts };
}

/** Gives a time to every syllable of a text written on the grid: measure `bar` after the first one, the syllables of a measure at equal distances. */
export function gridTimes(syls, text, movement, grid) {
  const first = Math.max(0, movement.masterbars.findIndex((mb) => mb.id === text.measureId));
  const perBar = new Map();
  for (const s of syls) perBar.set(s.bar, (perBar.get(s.bar) ?? 0) + 1);
  const seen = new Map();
  for (const s of syls) {
    const g = grid[first + s.bar];
    if (!g) continue; // past the last measure: the syllable keeps the time of the one before it
    const k = seen.get(s.bar) ?? 0; seen.set(s.bar, k + 1);
    s.time = g[0] + ((g[1] - g[0]) * k) / perBar.get(s.bar);
  }
}

/**
 * @param work      the work (lyric texts)
 * @param movement  the movement, already transposed for display when the person transposes
 * @param dict      the chord quality dictionary of the work
 * @param options   { semitones }: how far the Lecteur moves the chords written by hand in a free text sheet (the chords of the music move with the movement)
 * @returns {{ verses: { verse: number, lines: ({ type: 'lyrics', cells: { text, join, chords: string[] }[] } | { type: 'chords', chords: string[] })[] }[], hasLyrics: boolean }}
 */
export function buildSongbook(work, movement, dict, { semitones = 0 } = {}) {
  const texts = (getProperty(work, PID.LYRIC_TEXTS) ?? []).slice().sort((a, b) => a.verse - b.verse);
  const staves = movement.tracks.flatMap((t) => t.staves).filter((s) => (getProperty(s, PID.LYRIC_LINKS) ?? []).length);
  const grid = (() => { let acc = 0; return movement.masterbars.map((mb) => { const s = acc; acc += fToNumber(measureLengthOf(mb)); return [s, acc]; }); })();
  const measureAt = (time) => Math.max(0, grid.findIndex(([a, b]) => time >= a - 1e-9 && time < b - 1e-9));
  const lengthAt = (time) => { const g = grid[measureAt(time)]; return g ? g[1] - g[0] : 1; };
  // the sections of the form (Couplet, Refrain…): a line belongs to the one that holds its first syllable (`info` of a verse, for the cards and the style of the choruses)
  const spans = sectionSpans(movement);
  const spanAt = (time) => { if (time === undefined) return null; const mi = measureAt(time); const sp = spans.find((x) => mi >= x.from && mi <= x.to); return sp ? { id: sp.id, label: sp.label, category: sp.category, color: sp.color } : null; };
  const startOf = new WeakMap(); // line → the time (whole notes) of its first syllable or chord
  const infoOf = (lines) => lines.map((l) => { const time = startOf.get(l); return { time, section: spanAt(time) }; });

  // the chord symbols of the movement, in time order, with their written name
  const first = movement.masterbars[0];
  const symbols = first ? chordSymbolsInSpan(movement, first.id, movement.masterbars.length) : [];
  const events = symbols.map((e) => ({ time: (grid[e.mi]?.[0] ?? 0) + fToNumber(e.position), name: chordText(e.sym, dict) })).filter((e) => e.name);
  events.sort((a, b) => a.time - b.time);

  // each staff with lyrics gives the time of its syllables
  const timeOf = new Map(); // `${textId}#${index}` → time
  for (const staff of staves) {
    const { times } = chordTimes(movement, staff);
    for (const r of resolveLyricLinks(getProperty(staff, PID.LYRIC_LINKS), texts)) {
      const t = times.get(r.chordId);
      if (t !== undefined) timeOf.set(`${r.link.textId}#${r.link.index}`, t);
    }
  }

  /** The lines of one verse from its syllables (each with a `time`, whole notes from the start): cut into lines, with the chords of the first chord track above them. `onGrid`: written on the grid of measures. */
  const linesOfVerse = (syls, placed, onGrid) => {
    // cells in time order; an unplaced syllable keeps the time of the one before it
    let last = placed[0].time;
    const cells = syls.map((s) => { if (s.time !== undefined) last = s.time; return { text: s.text, join: s.join, newline: s.newline, index: s.index, time: s.time ?? last, chords: [] }; });
    const hasBreaks = syls.some((s) => s.newline);
    // lines: the author's line breaks, else a gap of a measure or too many syllables
    const lines = [];
    let current = [];
    cells.forEach((c, i) => {
      const prev = cells[i - 1];
      const gap = prev ? c.time - prev.time : 0;
      const cut = current.length && (hasBreaks ? c.newline : gap >= lengthAt(prev.time) - 1e-9 || current.length >= MAX_PER_LINE);
      if (cut) { lines.push(current); current = []; }
      current.push(c);
    });
    if (current.length) lines.push(current);

    // chords: above the syllable that sounds when they change; a chord just before a line starts leads it; the others are instrumental
    const items = lines.map((cs) => ({ type: 'lyrics', cells: cs, start: cs[0].time, end: onGrid ? (grid[measureAt(cs[cs.length - 1].time)]?.[1] ?? Infinity) : cs[cs.length - 1].time + lengthAt(cs[cs.length - 1].time) }));
    const instrumental = [];
    for (const ev of events) {
      const line = items.find((l) => ev.time >= l.start - lengthAt(l.start) + 1e-9 && ev.time < l.end - 1e-9);
      if (!line) { instrumental.push(ev); continue; }
      const idx = line.cells.reduce((best, c, i) => (c.time <= ev.time + 1e-9 ? i : best), 0);
      const cell = line.cells[idx];
      if (cell.chords.at(-1) !== ev.name) cell.chords.push(ev.name);
    }
    // instrumental chords make lines of their own, between the lines of text by time
    const chordLines = [];
    for (const ev of instrumental) {
      const lastLine = chordLines.at(-1);
      if (lastLine && ev.time - lastLine.end < lengthAt(ev.time) * 2) { if (lastLine.chords.at(-1) !== ev.name) lastLine.chords.push(ev.name); lastLine.end = ev.time; } else chordLines.push({ type: 'chords', chords: [ev.name], start: ev.time, end: ev.time });
    }
    const all = [...items, ...chordLines].sort((a, b) => a.start - b.start);
    return all.map(({ start, end, ...rest }) => { startOf.set(rest, start); return rest; });
  };

  // a free text that has a name (an imported ChordPro stanza) carries it as a card: its own section, so the card, the chorus style and the page breaks work as for a song with music
  const freeVerse = (text, lines) => {
    if (!text.label) return { verse: text.verse, lines };
    const category = text.category ?? 'custom';
    const section = { id: `lt${text.id}`, label: text.label, category, color: defaultSectionColor(category, text.label) };
    return { verse: text.verse, lines, label: text.label, category, ownChords: lines.some((l) => l.cells?.some((c) => c.chords.length)), info: lines.map(() => ({ time: text.verse, section })) };
  };
  const verses = [];
  for (const text of texts) {
    const syls = syllablesWithBreaks(text.text).map((s) => ({ ...s, time: timeOf.get(`${text.id}#${s.index}`) }));
    // a text written ON THE GRID (« | » between measures) and not placed on notes: the syllables of a measure share it evenly, from the measure the text starts at
    const onGrid = !syls.some((s) => s.time !== undefined) && /(^|\s)\|(\s|$)/.test(text.text);
    if (onGrid) gridTimes(syls, text, movement, grid);
    const placed = syls.filter((s) => s.time !== undefined).sort((a, b) => a.time - b.time || a.index - b.index);
    if (!placed.length) {
      // not on notes, not on the grid: a FREE TEXT SHEET (one line of the text = one line, the chords written in brackets by hand)
      if (!onGrid && !/(^|\s)\|(\s|$)/.test(text.text)) { const free = freeSheetLines(text.text, semitones); if (free.length) verses.push(freeVerse(text, free)); }
      continue;
    }
    const lines = linesOfVerse(syls, placed, onGrid);
    verses.push({ verse: text.verse, lines, info: infoOf(lines), group: `v${text.verse}` });
  }

  // the LYRICS TRACKS made of events (imports of an analysed song, of Songsterr; the track « Paroles »): each syllable sits on its own instant; each line of the track is a verse, a track's
  // verses come after the ones above (the old lyric texts); two tracks (Moïses, Songsterr) give their verses one after the other
  let next = verses.length ? Math.max(...verses.map((v) => v.verse)) + 1 : 0;
  for (const staff of movement.tracks.flatMap((t) => t.staves).filter((st) => getProperty(st, PID.STAFF_TYPE) === 'lyrics')) {
    const byLine = new Map();
    for (const e of lyricEventsOf(staff)) {
      const g = grid[e.measure]; if (!g || !e.text) continue;
      const raw = String(e.text).trim(); if (!raw) continue;
      const joined = /[^-]-$/.test(raw); // a hyphen at the end: the word goes on in the next syllable
      const list = byLine.get(e.line) ?? []; byLine.set(e.line, list);
      list.push({ text: joined ? raw.slice(0, -1) : raw, join: joined ? '-' : ' ', time: g[0] + fToNumber(e.position), newline: false, bar: 0 });
    }
    for (const line of [...byLine.keys()].sort((x, y) => x - y)) {
      const syls = byLine.get(line).sort((x, y) => x.time - y.time).map((x, i) => ({ ...x, index: i }));
      if (!syls.length) continue;
      const lines = linesOfVerse(syls, syls, false); const info = infoOf(lines);
      verses.push({ verse: next, lines, info, group: info[0]?.section ? `s${info[0].section.id}` : 'events' }); next += 1; // (each line of an event track is a « verse »: its stanza, for the page breaks, is the section it sings in)
    }
  }
  return { verses, hasLyrics: verses.length > 0 };
}
