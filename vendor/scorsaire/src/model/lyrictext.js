/*
 * The TEXT of the lyrics kept waiting (`PID.LYRIC_RESERVE`): plain text with line breaks and section markers. PURE.
 *   - a line is a PHRASE (one line of the song); its words are the syllables to put on notes, in order;
 *   - a marker line names a section: `[Verse 1]`, `[Refrain]`, or a bare keyword line (« Couplet 2 », « Refrain : », « Pont »…);
 *   - the markers are never syllables.
 * `parseLyricText` reads a text; `formatLyricText` writes it back; the editing helpers return a NEW text (the caller writes it in a transaction).
 */

/** Section kinds a marker can carry (a subset of the form's categories, `model/sections.js`). */
export const LYRIC_SECTION_KINDS = Object.freeze(['verse', 'chorus', 'preChorus', 'bridge', 'intro', 'outro', 'interlude', 'solo', 'custom']);

const KEYWORDS = [
  ['preChorus', /^(pr[ée]\s*-?\s*refrain|pre\s*-?\s*chorus)\b/i],
  ['chorus', /^(refrain|chorus)\b/i],
  ['verse', /^(couplet|verse|strophe)\b/i],
  ['bridge', /^(pont|bridge)\b/i],
  ['intro', /^intro(duction)?\b/i],
  ['outro', /^(outro|fin|ending)\b/i],
  ['interlude', /^interlude\b/i],
  ['solo', /^solo\b/i],
];

/** The kind a section name suggests (« Couplet 2 » → verse), 'custom' when it is none of the usual ones. */
export function kindOfName(name) {
  const text = String(name ?? '').trim();
  for (const [kind, re] of KEYWORDS) if (re.test(text)) return kind;
  return 'custom';
}

/** A line that is a marker: `{ name, kind }`, or null. Bracketed (`[Refrain]`) or a bare keyword with an optional number and colon (« Couplet 2 : »). */
export function markerOf(line) {
  const text = String(line ?? '').trim();
  const bracket = /^\[([^\]]+)\]$/.exec(text);
  if (bracket) { const name = bracket[1].trim(); return name ? { name, kind: kindOfName(name) } : null; }
  const bare = /^([^\d:]+?)\s*(\d+)?\s*:?$/.exec(text);
  // a bare line counts only when it IS the keyword (« Intro », « Couplet 2 : »), not when it merely starts with it (« intro words »)
  const isKeyword = bare && KEYWORDS.some(([, re]) => new RegExp(`^(?:${re.source.replace(/\\b$/, '')})$`, re.flags).test(bare[1].trim()));
  if (isKeyword) {
    const name = `${bare[1].trim()}${bare[2] ? ` ${bare[2]}` : ''}`;
    return { name, kind: kindOfName(name) };
  }
  return null;
}

/**
 * Reads a text: `{ items: [{ type: 'marker', name, kind } | { type: 'line', words, from }], words (all the syllables in order), phrases (the lines), sections }`.
 * `from` = index in `words` of the first word of the line; `sections` = [{ name, kind, from, to (words, to excluded) }] (words before the first marker: name null).
 */
export function parseLyricText(text) {
  const items = [];
  const words = [];
  const sections = [];
  let current = null;
  const open = (name, kind) => { current = { name, kind, from: words.length, to: words.length }; sections.push(current); };
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const marker = markerOf(line);
    if (marker) { items.push({ type: 'marker', ...marker }); open(marker.name, marker.kind); continue; }
    const w = line.split(/\s+/).filter(Boolean);
    if (!w.length) continue;
    if (!current) open(null, 'custom');
    items.push({ type: 'line', words: w, from: words.length });
    words.push(...w);
    current.to = words.length;
  }
  return { items, words, phrases: items.filter((i) => i.type === 'line'), sections: sections.filter((s) => s.name !== null || s.to > s.from) };
}

/** Writes items back as text: markers in brackets, one phrase per line. */
export function formatLyricText(items) {
  return items.map((i) => (i.type === 'marker' ? `[${i.name}]` : i.words.join(' '))).join('\n');
}

/** The same text, normalised (trimmed lines, single blanks, no empty lines, markers in brackets). */
export const normalizeLyricText = (text) => formatLyricText(parseLyricText(text).items);

/** The text from word number `n` on (the first `n` words dropped), lines and the markers that still have words under them kept. */
export function tailAfter(text, n) {
  return removeWords(text, new Set(Array.from({ length: Math.max(0, n) }, (_, i) => i)));
}

/** The text without the words whose index is in `indexes`; a marker with no word left under it goes too. */
export function removeWords(text, indexes) {
  const parsed = parseLyricText(text);
  const out = [];
  for (const item of parsed.items) {
    if (item.type === 'marker') { out.push(item); continue; }
    const kept = item.words.filter((_, k) => !indexes.has(item.from + k));
    if (kept.length) out.push({ type: 'line', words: kept, from: 0 });
  }
  return formatLyricText(out.filter((item, i) => item.type === 'line' || out.slice(i + 1).find((x) => x.type === 'marker' || x.type === 'line')?.type === 'line'));
}

/** The text with a break (a new phrase) before word `index`, or without the one that was there (the line joins the previous one). */
export function toggleBreakBefore(text, index) {
  const parsed = parseLyricText(text);
  const out = [];
  for (const item of parsed.items) {
    if (item.type !== 'line' || index <= item.from || index >= item.from + item.words.length) {
      if (item.type === 'line' && index === item.from && out.at(-1)?.type === 'line') { out.at(-1).words.push(...item.words); continue; } // the break goes away
      out.push(item.type === 'line' ? { ...item, words: item.words.slice() } : item);
      continue;
    }
    const k = index - item.from;
    out.push({ type: 'line', words: item.words.slice(0, k), from: item.from }, { type: 'line', words: item.words.slice(k), from: index });
  }
  return formatLyricText(out);
}

/** The next free number for a marker name: « Verse » → « Verse 1 » when none is there yet, else the next one. */
export function numberedName(text, base) {
  const used = parseLyricText(text).items.filter((i) => i.type === 'marker' && new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+\\d+)?$`, 'i').test(i.name));
  const n = used.reduce((m, i) => Math.max(m, Number(/(\d+)$/.exec(i.name)?.[1] ?? 1)), 0);
  return used.length ? `${base} ${n + 1}` : `${base} 1`;
}

/** The text with a marker line before the line that holds character `offset`. */
export function insertMarker(text, offset, name) {
  const src = String(text ?? '');
  const at = src.lastIndexOf('\n', Math.max(0, offset) - 1) + 1;
  return `${src.slice(0, at)}[${name}]\n${src.slice(at)}`;
}

const END = /[.!?;:…]["'»”)]*$/;
const SOFT = /[,]["'»”)]*$/;
const PRONOUN_I = /^I(['’]|$)/;

/**
 * Proposes phrases for a text with long lines: breaks after a word that ends with a full stop, a question mark…; else before a capital letter when that gives lines of 2 to 12 words
 * (the way a pasted song keeps its capitals); else balanced pieces of about `maxWords` words. A line of at most `maxWords` words, and the markers, stay as they are.
 */
export function suggestPhrases(text, { maxWords = 8 } = {}) {
  const parsed = parseLyricText(text);
  const out = [];
  for (const item of parsed.items) {
    if (item.type === 'marker' || item.words.length <= maxWords) { out.push(item); continue; }
    for (const piece of splitLine(item.words, maxWords)) {
      // a piece still too long after the punctuation is cut again (capitals, then balanced)
      for (const sub of piece.length > maxWords ? splitLine(piece, maxWords) : [piece]) out.push({ type: 'line', words: sub, from: 0 });
    }
  }
  return formatLyricText(out);
}

function splitLine(words, maxWords) {
  const cut = (breaks) => { const pieces = []; let from = 0; for (const b of [...breaks, words.length]) { if (b > from) pieces.push(words.slice(from, b)); from = b; } return pieces; };
  const ok = (pieces) => pieces.length > 1 && pieces.every((p) => p.length >= 2 && p.length <= 12);
  const punct = []; words.forEach((w, i) => { if (i < words.length - 1 && (END.test(w) || (SOFT.test(w) && i >= 3))) punct.push(i + 1); });
  if (ok(cut(punct))) return cut(punct);
  const caps = []; words.forEach((w, i) => { if (i > 0 && /^[A-ZÀ-ÖØ-Þ]/.test(w) && !PRONOUN_I.test(w)) caps.push(i); });
  if (ok(cut(caps))) return cut(caps);
  const n = Math.ceil(words.length / maxWords);
  const size = Math.ceil(words.length / n);
  return cut(Array.from({ length: n - 1 }, (_, i) => (i + 1) * size));
}

/** The text with a marker line before the `index`-th phrase (0-based, markers not counted). */
export function insertMarkerBeforePhrase(text, index, name) {
  const items = parseLyricText(text).items;
  const out = [];
  let n = 0;
  for (const item of items) {
    if (item.type === 'line') { if (n === index) out.push({ type: 'marker', name, kind: kindOfName(name) }); n += 1; }
    out.push(item);
  }
  if (index >= n) out.push({ type: 'marker', name, kind: kindOfName(name) });
  return formatLyricText(out);
}

/** The text without the `index`-th marker (0-based among the markers); its phrases join the section before. */
export function removeMarker(text, index) {
  let n = 0;
  return formatLyricText(parseLyricText(text).items.filter((item) => item.type !== 'marker' || n++ !== index));
}

/** The text as blocks: `[{ marker: { name, kind } | null, phrases: [{ words, from, phrase (index among all phrases) }] }]`, a block per section (words before the first marker: marker null). */
export function lyricBlocks(text) {
  const blocks = [];
  let current = null;
  let phrase = 0;
  for (const item of parseLyricText(text).items) {
    if (item.type === 'marker') { current = { marker: { name: item.name, kind: item.kind }, phrases: [] }; blocks.push(current); continue; }
    if (!current) { current = { marker: null, phrases: [] }; blocks.push(current); }
    current.phrases.push({ words: item.words, from: item.from, phrase });
    phrase += 1;
  }
  return blocks;
}
