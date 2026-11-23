/*
 * ChordPro (https://www.chordpro.org): the plain-text song sheet that most songbook applications read and write. Chords sit between square brackets right before the syllable
 * they sound on (« [Am]Le so[G]leil se lève »), directives sit between curly brackets (« {title: …} », « {start_of_chorus: Refrain} »). Pure: no DOM.
 *
 * `parseChordPro(text)` → { meta, blocks: [{ category, label, lines }], ignored }: `lines` are the lines of one stanza, chords still in brackets (the free sheet of the Lecteur reads them
 * as they are); `label` is null when the file gives none (the builder names it). A text that has its chords on a line of their own ABOVE the words (the habit of lyric sites) is read too.
 * `serializeChordPro({ meta, blocks })` writes it back.
 */

/** Extensions of the files read as ChordPro (a plain « .txt » only when it looks like one, see `looksLikeChordPro`). */
export const CHORDPRO_EXT = /\.(cho|chopro|chordpro|crd|pro)$/i;

const ROOT = '[A-G][#b♯♭]?';
const CHORD_TOKEN = new RegExp(`^${ROOT}(?:m|maj|min|M|dim|aug|sus|add|alt|°|ø|\\+|-|\\d|[#b♯♭]|\\(|\\))*(?:/${ROOT})?$`);
const isChordLine = (line) => { const t = line.trim().split(/\s+/); return !!line.trim() && t.every((x) => CHORD_TOKEN.test(x)); };

/** True when a file is ChordPro: a known extension, or a text with directives or bracketed chords (a « .txt » that is plain lyrics stays a plain file). */
export function looksLikeChordPro(name, text) {
  if (CHORDPRO_EXT.test(String(name ?? ''))) return true;
  const t = String(text ?? '');
  if (/\.json$|\.scorsaire/i.test(String(name ?? ''))) return false;
  return /^\s*\{\s*(title|t|start_of_\w+|so[cvb]|comment|c)\b/im.test(t) && !t.trimStart().startsWith('{"');
}

const ALIAS = {
  t: 'title', st: 'subtitle', su: 'subtitle', c: 'comment', ci: 'comment', cb: 'comment',
  soc: 'start_of_chorus', eoc: 'end_of_chorus', sov: 'start_of_verse', eov: 'end_of_verse', sob: 'start_of_bridge', eob: 'end_of_bridge',
  sot: 'start_of_tab', eot: 'end_of_tab', sog: 'start_of_grid', eog: 'end_of_grid', chord: 'define',
};
const CATEGORY = { verse: 'verse', chorus: 'chorus', bridge: 'bridge', intro: 'intro', outro: 'outro', interlude: 'interlude', solo: 'solo', coda: 'coda', prechorus: 'preChorus', pre_chorus: 'preChorus' };

/** The category a label like « Refrain », « Pont » or « Verse 2 » points at (null when it says nothing). */
export function categoryOfLabel(label) {
  const s = String(label ?? '').toLowerCase();
  if (/pre[- ]?chorus|pré[- ]?refrain/.test(s)) return 'preChorus';
  if (/chorus|refrain/.test(s)) return 'chorus';
  if (/bridge|pont/.test(s)) return 'bridge';
  if (/intro/.test(s)) return 'intro';
  if (/outro|fin\b|ending/.test(s)) return 'outro';
  if (/interlude/.test(s)) return 'interlude';
  if (/solo/.test(s)) return 'solo';
  if (/coda/.test(s)) return 'coda';
  if (/verse|couplet|strophe/.test(s)) return 'verse';
  return null;
}

/** « C       G » over « Le soleil » → « [C]Le so[G]leil » (the chords go in at their column; a chord line with no words under it stays a line of chords). */
function mergeChordLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isChordLine(line)) { out.push(line); continue; }
    const next = lines[i + 1];
    if (next === undefined || !next.trim() || isChordLine(next)) { out.push(line.trim().split(/\s+/).map((c) => `[${c}]`).join(' ')); continue; }
    const marks = [...line.matchAll(/\S+/g)].map((m) => ({ at: m.index, chord: m[0] }));
    let words = next.replace(/\s+$/, '');
    for (const m of marks.reverse()) {
      if (words.length < m.at) words = words.padEnd(m.at, ' ');
      words = `${words.slice(0, m.at)}[${m.chord}]${words.slice(m.at)}`;
    }
    out.push(words); i += 1;
  }
  return out;
}

export function parseChordPro(input) {
  let text = String(input ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const raw = text.split('\n');
  if (!/\[[^\]]*\]/.test(text) && !/^\s*\{/m.test(text)) text = mergeChordLines(raw).join('\n'); // chords over the words (no brackets, no directives)
  const meta = {}; const blocks = []; const ignored = { tab: 0, grid: 0, directives: 0 };
  let open = null; let skipping = null; let stanza = []; let label = null; let lastChorus = null;
  const push = (category, lab, lines) => {
    if (!lines.length) return;
    const b = { category, label: lab ?? null, lines };
    blocks.push(b); if (category === 'chorus') lastChorus = b;
  };
  const flush = () => { if (stanza.length) { push(categoryOfLabel(label) ?? 'verse', label, stanza); stanza = []; label = null; } };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (skipping) { if (new RegExp(`^\\s*\\{\\s*(end_of_${skipping}|${skipping === 'tab' ? 'eot' : 'eog'})\\b`, 'i').test(line)) skipping = null; continue; }
    if (line.trimStart().startsWith('#')) continue;
    const d = /^\s*\{\s*([A-Za-z_]+)\s*(?:[:\s]\s*(.*?))?\s*\}\s*$/.exec(line);
    if (d) {
      const name = ALIAS[d[1].toLowerCase()] ?? d[1].toLowerCase(); const arg = (d[2] ?? '').trim();
      if (name === 'title' || name === 'subtitle' || name === 'artist' || name === 'composer' || name === 'lyricist' || name === 'key' || name === 'capo' || name === 'tempo' || name === 'time') { if (arg) meta[name] = arg; continue; }
      if (name === 'comment') { if (open) open.lines.push(`(${arg})`); else { flush(); label = arg || null; } continue; }
      let m = /^start_of_(\w+)$/.exec(name);
      if (m) {
        if (m[1] === 'tab' || m[1] === 'grid') { ignored[m[1]] += 1; skipping = m[1]; continue; }
        flush(); open = { category: CATEGORY[m[1]] ?? categoryOfLabel(m[1]) ?? 'custom', label: arg || label || null, lines: [] }; label = null; continue;
      }
      m = /^end_of_(\w+)$/.exec(name);
      if (m) { if (open) { push(open.category, open.label, open.lines); open = null; } continue; }
      if (name === 'chorus') { flush(); if (lastChorus) push('chorus', arg || lastChorus.label, [...lastChorus.lines]); continue; }
      ignored.directives += 1; continue;
    }
    if (!line.trim()) { if (!open) flush(); continue; }
    if (open) open.lines.push(line); else stanza.push(line);
  }
  if (open) push(open.category, open.label, open.lines); // a block the file forgot to close
  flush();
  return { meta, blocks, ignored };
}

/** Writes a song as ChordPro: `meta` { title, subtitle, composer, key } and `blocks` [{ category, label, lines: string[] with [chords] }]. */
export function serializeChordPro({ meta = {}, blocks = [] }) {
  const out = [];
  for (const [k, v] of [['title', meta.title], ['subtitle', meta.subtitle], ['composer', meta.composer], ['key', meta.key]]) if (v) out.push(`{${k}: ${v}}`);
  for (const b of blocks) {
    if (out.length) out.push('');
    const std = ['verse', 'chorus', 'bridge'].includes(b.category);
    if (std) out.push(`{start_of_${b.category}${b.label ? `: ${b.label}` : ''}}`); else if (b.label) out.push(`{comment: ${b.label}}`);
    out.push(...b.lines);
    if (std) out.push(`{end_of_${b.category}}`);
  }
  return `${out.join('\n')}\n`;
}
