/*
 * Paroles — port du MODÈLE de MuseScore 4.7.5 (`dom/lyrics.h/.cpp` : verse, syllabic, ticks de mélisme), adapté au choix de Jean (12/10/2026) :
 * « texte de l'œuvre + liens ».
 *  - `PID.LYRIC_TEXTS` (ŒUVRE, liste) = `{ id, verse, text, placement? }` (`createLyricText`) : le texte LIBRE d'un couplet (`verse` : entier ≥ 0,
 *    0 = premier couplet, comme MuseScore `Lyrics::verse`). `placement` ('below' | 'above') ; absent = style `SID.LYRICS_PLACEMENT`.
 *  - `PID.LYRIC_LINKS` (PORTÉE, liste) = `{ id, textId, index, chordId, endChordId? }` (`createLyricLink`) : la syllabe numéro `index` du texte
 *    `textId` se pose sur l'accord `chordId` (identité, jamais une position). `endChordId` : accord où se termine le mélisme (comme `endChordId` d'un
 *    soufflet ; MuseScore garde une durée `Lyrics::ticks`, ici une identité qui résiste aux insertions).
 * Le texte affiché d'une syllabe est DÉRIVÉ du texte du couplet (rien n'est recopié dans le lien) : corriger une faute dans le texte corrige l'affichage.
 *
 * Découpage d'un texte en syllabes (`parseLyricsText`) : les mots sont séparés par des blancs ; dans un mot, un tiret « - » entre deux morceaux coupe
 * la syllabe (« Al-le-lu-ia » : Al = BEGIN, le = MIDDLE, lu = MIDDLE, ia = END ; un mot sans tiret = SINGLE). Le tiret n'est PAS conservé dans la
 * syllabe (MuseScore non plus : il est dessiné par la ligne de séparation). Un mot réduit à « _ » (mélisme) ou à « - » ne donne pas de syllabe.
 * Un tiret au début ou à la fin d'un mot est gardé comme caractère ordinaire (« -3- »).
 */
import { newId } from './ids.js';

export const SYLLABIC = Object.freeze({ SINGLE: 'single', BEGIN: 'begin', MIDDLE: 'middle', END: 'end' });
/** A word reduced to this is a bar line of a text written on the grid of measures (no syllable). */
export const BAR = '|';
export const LYRICS_PLACEMENTS = Object.freeze(['below', 'above']);

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * `measureId` (optional): the measure where a text written ON THE GRID of bars starts (see `gridSyllables` in lecteur/songbook.js); absent = the first measure.
 * `label` / `category` (optional, a text with no music: an imported ChordPro song): the name of the stanza (« Refrain ») and its kind (a section category), drawn as a card by the Lecteur.
 */
export function createLyricText(verse, text, { placement, measureId, label, category } = {}) {
  return defined({ id: newId('lt'), verse, text: String(text), placement, measureId, label: typeof label === 'string' && label ? label.slice(0, LYRIC_LABEL_MAX) : undefined, category });
}
export const LYRIC_LABEL_MAX = 60;

export function createLyricLink(textId, index, chordId, { endChordId } = {}) {
  return defined({ id: newId('ll'), textId, index, chordId, endChordId });
}

/** Syllabes d'un texte : [{ index, text, syllabic }] (index = rang parmi les syllabes, 0-based). */
export function parseLyricsText(text) {
  const out = [];
  for (const word of String(text ?? '').split(/\s+/)) {
    if (!word || word === '_' || word === '-' || word === BAR) continue;
    const pieces = word.split(/(?<=[^-])-(?=[^-])/);
    pieces.forEach((p, i) => {
      out.push({ index: out.length, text: p, syllabic: pieces.length === 1 ? SYLLABIC.SINGLE : i === 0 ? SYLLABIC.BEGIN : i === pieces.length - 1 ? SYLLABIC.END : SYLLABIC.MIDDLE });
    });
  }
  return out;
}

/**
 * Liens d'une portée résolus : [{ link, verse, placement, syllable: { text, syllabic }, chordId, endChordId }] — liens dont le texte ou la syllabe
 * n'existe plus : ignorés. `texts` = `PID.LYRIC_TEXTS` de l'œuvre. Le résultat est mémoïsé par l'appelant.
 */
export function resolveLyricLinks(links, texts) {
  const byId = new Map();
  for (const t of texts ?? []) byId.set(t.id, { text: t, syllables: parseLyricsText(t.text) });
  const out = [];
  for (const link of links ?? []) {
    const t = byId.get(link.textId);
    const syllable = t?.syllables[link.index];
    if (!syllable) continue;
    out.push({ link, verse: t.text.verse, placement: t.text.placement, syllable, chordId: link.chordId, endChordId: link.endChordId });
  }
  return out;
}

/** Validation : liste de messages. `known(id)` : l'accord existe dans la portée. */
const SECTION_KINDS = ['intro', 'verse', 'preChorus', 'chorus', 'bridge', 'solo', 'interlude', 'outro', 'coda', 'letter', 'custom'];
export function validateLyricTexts(texts) {
  const errors = [];
  const verses = new Set();
  for (const t of texts ?? []) {
    if (!Number.isInteger(t.verse) || t.verse < 0) errors.push(`texte de paroles ${t.id} : couplet invalide (${t.verse})`);
    if (typeof t.text !== 'string') errors.push(`texte de paroles ${t.id} : texte absent`);
    if (t.placement !== undefined && !LYRICS_PLACEMENTS.includes(t.placement)) errors.push(`texte de paroles ${t.id} : côté inconnu (${t.placement})`);
    if (t.label !== undefined && (typeof t.label !== 'string' || t.label.length > LYRIC_LABEL_MAX)) errors.push(`texte de paroles ${t.id} : nom de strophe invalide`);
    if (t.category !== undefined && !SECTION_KINDS.includes(t.category)) errors.push(`texte de paroles ${t.id} : genre de strophe inconnu (${t.category})`);
    if (verses.has(`${t.verse}`)) errors.push(`texte de paroles ${t.id} : deux textes pour le couplet ${t.verse}`);
    verses.add(`${t.verse}`);
  }
  return errors;
}

export function validateLyricLinks(links, texts, known) {
  const errors = [];
  const ids = new Set((texts ?? []).map((t) => t.id));
  const anchors = new Set();
  for (const l of links ?? []) {
    if (!ids.has(l.textId)) errors.push(`lien de paroles ${l.id} : texte inexistant (${l.textId})`);
    if (!Number.isInteger(l.index) || l.index < 0) errors.push(`lien de paroles ${l.id} : rang de syllabe invalide (${l.index})`);
    if (!known(l.chordId)) errors.push(`lien de paroles ${l.id} : accord inexistant dans la portée (${l.chordId})`);
    if (l.endChordId !== undefined && !known(l.endChordId)) errors.push(`lien de paroles ${l.id} : accord de fin de mélisme inexistant (${l.endChordId})`);
    const key = `${l.textId}#${l.index}`;
    if (anchors.has(key)) errors.push(`lien de paroles ${l.id} : la syllabe ${l.index} du texte ${l.textId} est déjà posée`);
    anchors.add(key);
  }
  return errors;
}

/* ---------- a verse written ON THE GRID of measures (no melody): « | » closes a measure ---------- */

/** True when the text uses bar lines (a lone « | »): it is then written on the measures, from `measureId` (default: the first one). */
export const isGridText = (text) => /(^|\s)\|(\s|$)/.test(String(text ?? ''));

/**
 * The text of a grid verse cut into the measures it covers: [{ text, bar }] where `bar` counts from the measure the text starts at, and `text` is what is
 * written in that measure ('' for an empty one). A bar line opening a line right after the one that closed the line before is only decoration.
 */
export function gridSegments(text) {
  const out = [];
  let current = []; let bar = 0; let seen = false; let lastBar = false; let newline = false;
  const flush = () => { out.push({ bar, text: current.join(' ') }); current = []; };
  for (const part of String(text ?? '').split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { if (part.includes('\n')) newline = true; continue; }
    if (part === BAR) {
      if (seen && !(lastBar && newline)) { flush(); bar += 1; }
      seen = true; lastBar = true; newline = false; continue;
    }
    seen = true; lastBar = false; newline = false;
    current.push(part);
  }
  if (current.length) flush();
  return out;
}

/** The segments of a grid text by ABSOLUTE measure index: Map(index → string). `firstIndex` = index of the measure the text starts at. */
export const gridSegmentMap = (text, firstIndex = 0) => new Map(gridSegments(text).map((s) => [firstIndex + s.bar, s.text]));

/** The text written from absolute segments (Map(index → string)): starts at the first non-empty measure, empty measures in between stay empty. Returns { text, first } or null when nothing is written. */
export function gridTextFromMap(map) {
  const filled = [...map].filter(([, s]) => s.trim()).map(([i]) => i);
  if (!filled.length) return null;
  const first = Math.min(...filled); const last = Math.max(...filled);
  const cells = [];
  for (let i = first; i <= last; i += 1) cells.push((map.get(i) ?? '').trim());
  return { first, text: `| ${cells.join(' | ')} |`.replace(/\|  \|/g, '| |') };
}

/** Syllables of a grid text with the measure (`bar`) each one belongs to: [{ text, join, index, bar }] (the same ranks as `parseLyricsText`). */
export function gridSyllables(text) {
  const out = [];
  for (const seg of gridSegments(text)) {
    for (const word of seg.text.split(/\s+/)) {
      if (!word || word === '_' || word === '-') continue;
      const pieces = word.split(/(?<=[^-])-(?=[^-])/);
      pieces.forEach((p, i) => out.push({ text: p, join: i === pieces.length - 1 ? ' ' : '-', index: out.length, bar: seg.bar }));
    }
  }
  return out;
}
