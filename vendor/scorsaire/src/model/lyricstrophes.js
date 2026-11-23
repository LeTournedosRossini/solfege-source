/*
 * « Lyrics by strophes » (screen 2): a printed part that shows ONLY the words, written as blocks of text (a strophe = a card of structure + its lines) instead of
 * following the music. An optional property of the part, `PID.PART_LYRICS_PAGE`; a part without it is a normal part and nothing else changes.
 *   { columns: 1 | 2, size (pt), cards (bool), strophes: null | [{ id, card: { category, label } | null, lines: [string] }] }
 * `strophes: null` = AUTOMATIC: the strophes are computed from the first « Paroles » track of the work each time (a corrected syllable corrects the page);
 * a list = FIXED: the text was edited by hand in the window, and no longer follows the track.
 *
 * The automatic proposal (`autoStrophes`): the syllables of the track are joined into words (the marks of a note held in the file — « ba--by », « ea-sy », a hyphen
 * at the end of a syllable — are removed), the words are cut into lines at the silences (and after . ? !, and when a line gets too long), and the lines are grouped
 * into strophes by the SECTION of the form that holds most of their syllables (two neighbouring sections of the same category, a chorus in two blocks, make one
 * strophe), or by a long silence. The timing of a file is not always the one of the words (a phrase may begin before its section): the window lets the user move the cuts.
 * PURE (no DOM).
 */
import { PID } from './pid.js';
import { fToNumber } from './fraction.js';
import { measureLengthOf } from './timing.js';
import { lyricEventsOf, isLyricsTrack } from './lyricevents.js';
import { sectionSpans, SECTION_NAMES } from './sections.js';

export const LYRICS_PAGE_DEFAULTS = Object.freeze({ columns: 1, size: 12, cards: true });
export const LYRICS_LIMITS = Object.freeze({ strophes: 200, lines: 200, lineChars: 300, labelChars: 40, minSize: 6, maxSize: 30 });
const LINE_GAP = 0.6; // whole notes between the starts of two words that may start a new line (a little more than two beats in 4/4)
const STROPHE_GAP = 1.5; // … and a new strophe (one bar and a half in 4/4)
const SHORT_LINE = 5; // a gap before a word that does not start with a capital cuts the line only after this many words
const LINE_CHARS = 52; // a line longer than this is cut at the next word
const SENTENCE_END = /[.?!]["')]?$/;

export const isLyricsPart = (part) => !!part?.props?.[PID.PART_LYRICS_PAGE] && typeof part.props[PID.PART_LYRICS_PAGE] === 'object';

/** The settings of a lyrics part with the defaults filled in, and the stored strophes (null = automatic). */
export function lyricsSettings(part) {
  const own = part?.props?.[PID.PART_LYRICS_PAGE] ?? {};
  const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    columns: own.columns === 2 ? 2 : 1,
    size: clamp(own.size, LYRICS_LIMITS.minSize, LYRICS_LIMITS.maxSize, LYRICS_PAGE_DEFAULTS.size),
    cards: own.cards !== false,
    strophes: Array.isArray(own.strophes) ? cleanStrophes(own.strophes) : null,
  };
}

/** A list of strophes made safe: limits, types, no empty strophe. */
export function cleanStrophes(list) {
  const out = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, LYRICS_LIMITS.strophes)) {
    const lines = (Array.isArray(s?.lines) ? s.lines : []).slice(0, LYRICS_LIMITS.lines).map((l) => String(l ?? '').slice(0, LYRICS_LIMITS.lineChars));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.some((l) => l.trim())) continue;
    const card = s?.card && typeof s.card === 'object' && typeof s.card.label === 'string'
      ? { category: typeof s.card.category === 'string' ? s.card.category : 'custom', label: s.card.label.slice(0, LYRICS_LIMITS.labelChars) } : null;
    out.push({ id: typeof s?.id === 'string' ? s.id : `st${out.length + 1}`, card, lines });
  }
  return out;
}

/** The first « Paroles » track of the work: { movement, movementIndex, track } or null. */
export function lyricsSource(work) {
  for (let mi = 0; mi < work.movements.length; mi += 1) {
    const mv = work.movements[mi];
    const track = mv.tracks.find((t) => isLyricsTrack(t) && lyricEventsOf(t.staves[0]).some((e) => e.text.trim()));
    if (track) return { movement: mv, movementIndex: mi, track };
  }
  return null;
}

/**
 * Words of the syllables of a track: the syllables of a word are joined, the marks of a held note removed. `events` = `lyricEventsOf` (measure, position, text) in order.
 * Returns [{ text, at, end }] with `at` / `end` in whole notes from the start of the movement (start of the first and of the last syllable).
 */
export function wordsOfEvents(events, starts) {
  const words = []; let open = null;
  for (const e of events) {
    const raw = String(e.text ?? '');
    const bare = raw.trim();
    if (!bare || /^[-_]+$/.test(bare)) continue; // a held note without text
    const continues = /[^-]-+$/.test(bare);
    const piece = bare.replace(/^-+/, '').replace(/-+$/, '').replace(/^(\p{L})-+\1(?!\p{L})/u, '$1 $1').replace(/(?<=\p{L})-+(?=\p{L})/gu, ''); // « I--I » (a held note) stays two words
    if (!piece) continue;
    const at = (starts[e.measure] ?? 0) + fToNumber(e.position);
    if (open) { open.text += piece; open.end = at; } else { open = { text: piece, at, end: at }; words.push(open); }
    if (!continues) open = null;
  }
  return words;
}

/** The sections of the form, neighbouring sections of the same category joined: [{ id, category, label, from, to }]. */
function sectionRuns(movement) {
  const runs = [];
  for (const s of sectionSpans(movement)) {
    const last = runs[runs.length - 1];
    if (last && last.category === s.category && last.to + 1 === s.from && s.category !== 'custom' && s.category !== 'letter') last.to = s.to;
    else runs.push({ id: s.id, category: s.category, label: s.label, from: s.from, to: s.to });
  }
  return runs;
}

/** The label of the card of a strophe: the name of the section, or its category's name, with a number for the verses (« Couplet 2 »). */
function cardLabel(run, lang, counters) {
  const names = SECTION_NAMES[lang] ?? SECTION_NAMES.fr;
  const own = String(run.label ?? '').trim();
  if (own) return own;
  const base = names[run.category] ?? run.category;
  if (run.category === 'verse') { counters.verse = (counters.verse ?? 0) + 1; return `${base} ${counters.verse}`; }
  return base;
}

/** The strophes proposed from the lyrics track of the work: [{ id, card, lines }] (empty when there is no lyrics track). */
export function autoStrophes(work, { lang = 'fr' } = {}) {
  const source = lyricsSource(work);
  if (!source) return [];
  const { movement, track } = source;
  const starts = []; let at = 0;
  for (const bar of movement.masterbars) { starts.push(at); at += fToNumber(measureLengthOf(bar)); }
  const all = lyricEventsOf(track.staves[0]);
  const verses = [...new Set(all.map((e) => e.line))].sort((a, b) => a - b);
  const runs = sectionRuns(movement);
  const measureOfAt = (t) => { let m = 0; for (let i = 0; i < starts.length; i += 1) if (starts[i] <= t + 1e-9) m = i; return m; };
  const runOf = (t) => { const m = measureOfAt(t); return runs.find((r) => m >= r.from && m <= r.to) ?? null; };
  const out = []; const counters = {};
  for (const verse of verses) {
    const words = wordsOfEvents(all.filter((e) => e.line === verse), starts);
    // lines
    const lines = []; let cur = null;
    const capital = (t) => /^\p{Lu}/u.test(t);
    const pronoun = (t) => /^I($|')/.test(t);
    words.forEach((w, i) => {
      const prev = words[i - 1];
      const gap = prev ? w.at - prev.end : 0;
      let cut = !cur || SENTENCE_END.test(prev.text) || (gap >= LINE_GAP && (capital(w.text) || cur.words.length >= SHORT_LINE));
      if (!cut && cur.text.length + 1 + w.text.length > LINE_CHARS) { // too long: cut before the last capital word of the line (a line begins with one), else here
        let k = -1;
        for (let j = cur.words.length - 1; j >= 2; j -= 1) if (capital(cur.words[j].text) && !pronoun(cur.words[j].text)) { k = j; break; }
        if (k > 0) {
          const moved = cur.words.splice(k);
          cur.text = cur.words.map((x) => x.text).join(' ');
          cur = { words: moved, text: moved.map((x) => x.text).join(' '), gapBefore: moved[0].at - cur.words[cur.words.length - 1].end };
          lines.push(cur);
        } else cut = gap > 0;
      }
      if (cut) {
        // a capitalised little word left at the end of the line (« And », « But ») begins the next one
        let carry = [];
        if (cur && !SENTENCE_END.test(prev.text) && cur.words.length >= 3 && capital(prev.text) && !pronoun(prev.text)) { carry = [cur.words.pop()]; cur.text = cur.words.map((x) => x.text).join(' '); }
        cur = { words: carry, text: carry.map((x) => x.text).join(' '), gapBefore: gap };
        lines.push(cur);
      }
      cur.words.push(w); cur.text = cur.text ? `${cur.text} ${w.text}` : w.text;
    });
    // each line goes to the section that holds most of its words
    for (const l of lines) {
      const votes = new Map();
      for (const w of l.words) { const r = runOf(w.at); votes.set(r, (votes.get(r) ?? 0) + 1); }
      l.run = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    }
    let strophe = null;
    for (const l of lines) {
      if (!strophe || l.run !== strophe.run || l.gapBefore >= STROPHE_GAP) {
        const card = l.run ? { category: l.run.category, label: cardLabel(l.run, lang, counters) } : null;
        strophe = { id: `st${out.length + 1}`, card, lines: [], run: l.run };
        out.push(strophe);
      }
      strophe.lines.push(l.text);
    }
  }
  return out.map(({ id, card, lines }) => ({ id, card, lines }));
}

/** The strophes proposed from the FREE TEXTS of the verses (`PID.LYRIC_TEXTS`): a blank line starts a new strophe, the chord marks [C] are dropped. */
export function freeTextStrophes(work, { lang = 'fr' } = {}) {
  const names = SECTION_NAMES[lang] ?? SECTION_NAMES.fr;
  const out = [];
  const texts = [...(work.props?.[PID.LYRIC_TEXTS] ?? [])].sort((a, b) => (a.verse ?? 0) - (b.verse ?? 0));
  for (const t of texts) {
    const chunks = String(t.text ?? '').replace(/\[[^\]]*\]/g, '').split(/\r?\n\s*\r?\n/).map((c) => c.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)).filter((c) => c.length);
    chunks.forEach((lines, i) => out.push({ id: `st${out.length + 1}`, card: i === 0 ? { category: 'verse', label: `${names.verse} ${(t.verse ?? 0) + 1}` } : null, lines }));
  }
  return out;
}

/** The strophes a lyrics part shows: the stored ones (fixed) or the automatic proposal. */
export function lyricsStrophesOf(work, part, { lang = 'fr' } = {}) {
  const set = lyricsSettings(part);
  return set.strophes ?? autoStrophes(work, { lang });
}

/** Are these strophes the same text and cards as the automatic proposal? (the window then keeps the part automatic) */
export function sameStrophes(a, b) {
  const key = (list) => JSON.stringify(cleanStrophes(list).map((s) => [s.card?.category ?? null, s.card?.label ?? null, s.lines]));
  return key(a) === key(b);
}

/** The value to store for the part: automatic (`strophes: null`) when `strophes` equals the proposal, else the fixed list. */
export function lyricsPageValue(settings, strophes, work, { lang = 'fr' } = {}) {
  const auto = autoStrophes(work, { lang });
  return {
    columns: settings.columns === 2 ? 2 : 1,
    size: settings.size,
    cards: settings.cards !== false,
    strophes: strophes && !sameStrophes(strophes, auto) ? cleanStrophes(strophes) : null,
  };
}

// ---------- editing (inside doc.transaction) ----------

/** Turns the part into a lyrics part (or changes its settings); `value` = `lyricsPageValue(…)`. null makes it a normal part again. */
export function setLyricsPage(doc, part, value) {
  doc.set(part, PID.PART_LYRICS_PAGE, value ? { columns: value.columns === 2 ? 2 : 1, size: value.size, cards: value.cards !== false, strophes: value.strophes ? cleanStrophes(value.strophes) : null } : null);
}
