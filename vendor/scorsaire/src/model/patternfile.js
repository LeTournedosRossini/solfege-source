/*
 * The FILE of chord patterns, for exchange with another tool (Flibuste's Arpège) and between devices:
 *   { format: 'scorsaire-chord-patterns', version: 1, from: 'scorsaire' | 'arpege' | …, patterns: [pattern…] }
 * A pattern is the one of model/chordpatterns.js (the optional `vel`, `gate` and `x` of another tool are kept). Written: `scorsaire-chord-patterns`. Read: `scorsaire-chord-patterns` and
 * `flibuste-motifs` (the name Flibuste first gave to the same file), version 1; a file of a NEWER version than this program knows is refused with a clear error, never half read.
 * A bad pattern in a file is left out and counted (`skipped`); a file that holds none that is usable is an error.
 */
import { createChordPattern } from './chordpatterns.js';

export const CHORD_PATTERNS_FORMAT = 'scorsaire-chord-patterns';
export const FLIBUSTE_PATTERNS_FORMAT = 'flibuste-motifs';
export const CHORD_PATTERNS_VERSION = 1;
const READABLE_FORMATS = [CHORD_PATTERNS_FORMAT, FLIBUSTE_PATTERNS_FORMAT];

/** `code`: 'notJson' | 'format' | 'tooNew' | 'empty' (the interface says each in the person's language). */
export class PatternFileError extends Error {
  constructor(code, message) { super(message); this.name = 'PatternFileError'; this.code = code; }
}

/** The text of a file holding `list` (patterns; a `source` marker of the menus is left out). */
export function serializeChordPatterns(list, { from = 'scorsaire' } = {}) {
  const patterns = (list ?? []).map(({ source, ...pattern }) => createChordPattern(pattern)).filter(Boolean);
  return JSON.stringify({ format: CHORD_PATTERNS_FORMAT, version: CHORD_PATTERNS_VERSION, from, patterns }, null, 2);
}

/** { patterns (checked), skipped (how many were left out), from, format } from the text of a file. Throws `PatternFileError`. */
export function parseChordPatterns(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new PatternFileError('notJson', 'The file is not a JSON text'); }
  if (!data || typeof data !== 'object' || !READABLE_FORMATS.includes(data.format)) throw new PatternFileError('format', 'This is not a file of chord patterns');
  if (!Number.isInteger(data.version) || data.version < 1) throw new PatternFileError('format', 'The file has no version');
  if (data.version > CHORD_PATTERNS_VERSION) throw new PatternFileError('tooNew', `The file is of version ${data.version}, this program reads up to ${CHORD_PATTERNS_VERSION}`);
  const raw = Array.isArray(data.patterns) ? data.patterns : data.pattern ? [data.pattern] : [];
  const patterns = raw.map((p) => createChordPattern(p)).filter(Boolean);
  if (!patterns.length) throw new PatternFileError('empty', 'The file holds no usable pattern');
  return { patterns, skipped: raw.length - patterns.length, from: typeof data.from === 'string' ? data.from : null, format: data.format };
}
