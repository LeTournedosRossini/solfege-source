/*
 * The FREE TEXT SHEET: a verse that is not placed on notes nor on the grid of measures is plain text, one line of the text = one line of the sheet, and the chords are written
 * where the author wants them, between square brackets, right before the word (or the letters) they sound on: « [C]Le so[G]leil se lève » (the ChordPro habit).
 * A line is cut at its chords: each piece is a column of the songbook (chords above, text below). Pure: no DOM.
 */
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** « Am7/G » → { root, bass, rest } (the root and the bass as { step, alter }), or null when the text does not start like a chord. */
export function parseChordName(name) {
  const m = /^([A-G])([#♯b♭]?)(.*)$/.exec(String(name ?? '').trim());
  if (!m) return null;
  const note = (step, acc) => ({ step, alter: acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0 });
  let rest = m[3]; let bass = null;
  const b = /\/([A-G])([#♯b♭]?)$/.exec(rest);
  if (b) { bass = note(b[1], b[2]); rest = rest.slice(0, b.index); }
  return { root: note(m[1], m[2]), bass, rest };
}

const shift = (n, semitones, flats) => {
  const at = (LETTER[n.step] + n.alter + semitones + 120) % 12;
  return (flats ? FLAT : SHARP)[at];
};

/** A chord name moved by `semitones` (the quality and the other signs stay as they were written; sharps or flats like the original, sharps for a natural root). */
export function transposeChordName(name, semitones = 0) {
  const p = parseChordName(name);
  if (!p) return String(name).trim();
  const sharps = p.root.alter > 0 || (p.bass?.alter ?? 0) > 0;
  const flats = p.root.alter < 0 || (p.bass?.alter ?? 0) < 0 || (semitones < 0 && !sharps);
  const spelled = (n) => (semitones ? shift(n, semitones, flats) : `${n.step}${n.alter > 0 ? '♯' : n.alter < 0 ? '♭' : ''}`);
  return `${spelled(p.root)}${p.rest}${p.bass ? `/${spelled(p.bass)}` : ''}`;
}

/** The pieces of one line: [{ chords: string[], text }] — the first piece has no chord when the line starts with text. Chords that follow each other stand on the same piece. */
export function parseFreeLine(line) {
  const out = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0; let pending = [];
  const push = (text) => { out.push({ chords: pending, text }); pending = []; };
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const before = line.slice(last, m.index);
    if (before) push(before);
    if (m[1].trim()) pending.push(m[1].trim());
    last = m.index + m[0].length;
  }
  const tail = line.slice(last);
  if (tail || pending.length) push(tail);
  return out;
}

/** The songbook lines of a free text: [{ type: 'lyrics', cells: [{ text, join, chords }] }] — a blank line is only a gap (no line), the chords are moved by `semitones`. */
export function freeSheetLines(text, semitones = 0) {
  const lines = [];
  for (const raw of String(text ?? '').split('\n')) {
    if (!raw.trim()) continue;
    const cells = parseFreeLine(raw.replace(/\s+$/, '')).map((p) => ({ text: p.text.trim(), join: /\s$/.test(p.text) ? ' ' : '', chords: p.chords.map((c) => transposeChordName(c, semitones)) }));
    if (cells.length) lines.push({ type: 'lyrics', cells });
  }
  return lines;
}

/** True when a verse text is a free sheet: no bar line (grid of measures) and no link to notes is checked by the caller. */
export const hasChordMarks = (text) => /\[[^\]]+\]/.test(String(text ?? ''));
