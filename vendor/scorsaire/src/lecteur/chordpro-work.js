/*
 * A ChordPro song as a Scorsaire work with NO music: its title, its key, and one free text per stanza (the chords in brackets, a name and a kind for the card) — the shape the Lecteur
 * already shows as a songbook sheet. And the way back: the lines of a songbook written as ChordPro. Pure: no DOM.
 *
 * Opening a ChordPro file in the EDITOR (matching its chords with the chord track of a score) is NOT done here: `parseChordPro` gives the chords in order, per stanza, which is what that would start from.
 */
import { createScore } from '../model/newscore.js';
import { createDocument } from '../model/document.js';
import { createLyricText } from '../model/lyrics.js';
import { serializeWork } from '../model/serialize.js';
import { PID } from '../model/pid.js';
import { parseChordPro, serializeChordPro } from './chordpro.js';

const NAMES = {
  fr: { verse: 'Couplet', chorus: 'Refrain', bridge: 'Pont', intro: 'Intro', outro: 'Outro', interlude: 'Interlude', solo: 'Solo', coda: 'Coda', preChorus: 'Pré-refrain', custom: 'Partie' },
  en: { verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', intro: 'Intro', outro: 'Outro', interlude: 'Interlude', solo: 'Solo', coda: 'Coda', preChorus: 'Pre-chorus', custom: 'Section' },
};
// the number of sharps (+) or flats (−) of a key, by the name of its tonic
const MAJOR = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MINOR = { A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 };

/** « Am » → 0, « D » → 2, « Bbm » → −5; 0 when the key is not understood. */
export function fifthsOfKey(key) {
  const m = /^([A-G])([#b♯♭]?)(m|min|minor)?\b/.exec(String(key ?? '').trim());
  if (!m) return 0;
  const tonic = `${m[1]}${m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]}`;
  return (m[3] ? MINOR : MAJOR)[tonic] ?? 0;
}

/** The text of a stanza for the free sheet: a lone « | » would make it a grid text, so it goes. */
const stanzaText = (lines) => lines.map((l) => l.replace(/(^|\s)\|(?=\s|$)/g, '$1').replace(/\s+$/, '')).join('\n');

/** Builds the work of a ChordPro text: { work, title, warnings: { tab, grid, directives }, stanzas }. `lang` names the stanzas that have no name in the file. */
export function chordProToWork(text, { lang = 'fr' } = {}) {
  const { meta, blocks, ignored } = parseChordPro(text);
  const names = NAMES[lang] ?? NAMES.en;
  const built = createScore({
    title: meta.title ?? '', subtitle: meta.subtitle ?? meta.artist ?? undefined, composer: meta.composer, lyricist: meta.lyricist,
    parts: [], measures: 1, keySig: fifthsOfKey(meta.key), lang,
  });
  const counts = {};
  const texts = blocks.map((b, i) => {
    counts[b.category] = (counts[b.category] ?? 0) + 1;
    const label = b.label ?? (b.category === 'verse' || b.category === 'custom' ? `${names[b.category]} ${counts[b.category]}` : names[b.category] ?? names.custom);
    return createLyricText(i, stanzaText(b.lines), { label, category: b.category });
  });
  const doc = createDocument(built);
  doc.transaction('chordpro', () => { doc.set(doc.work, PID.LYRIC_TEXTS, texts); });
  return { work: doc.work, title: meta.title ?? '', warnings: ignored, stanzas: blocks.length };
}

/** The text of a `.scorsaire` file for a ChordPro text (what a recueil entry stores). */
export function chordProToWorkText(text, options) {
  const r = chordProToWork(text, options);
  return { ...r, workText: serializeWork(r.work) };
}

/**
 * A songbook (`buildSongbook`) written as ChordPro: each verse a block, its name and kind from the section it sits in (or its free-text name), chords before the syllable they sit on.
 * `meta` { title, subtitle, composer, key }.
 */
export function songbookToChordPro(data, meta = {}) {
  const blocks = (data?.verses ?? []).map((v) => {
    const sec = v.info?.[0]?.section ?? null;
    const lines = [];
    for (const line of v.lines) {
      if (line.type === 'chords') { lines.push(line.chords.map((c) => `[${c}]`).join(' ')); continue; }
      lines.push(line.cells.map((c) => `${c.chords.map((x) => `[${x}]`).join('')}${c.text}${c.join === ' ' ? ' ' : ''}`).join('').trimEnd());
    }
    return { category: sec?.category ?? v.category ?? 'verse', label: v.label ?? sec?.label ?? null, lines };
  });
  return serializeChordPro({ meta, blocks });
}
