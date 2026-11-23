// Chord patterns: named rhythms for the piano accompaniment of a CHORD staff, written with chord DEGREES (see chorddegrees.js), never with pitches. PURE.
// A pattern is one measure (or less: it repeats to fill the measure): a list of hits, each with its place and length (exact fractions of a whole note) and what it
// sounds, `parts`: "B" the bass (left hand: the bass of the chord symbol), "C" the whole chord (right hand, voices led from one chord to the next),
// or a degree "5", "3", "9", "b9", "#11", "13" with an octave shift "5+1" / "3-1" (right hand, above the root); a "L" in front ("L5", "L1-1") puts the degree in the LEFT hand.
// Each hand has a MODE (`voices`): 'literal' = a degree sounds at the octave it is written, 'led' = the degrees only give the notes and the interpreter chooses the octaves so that the hand moves as little as possible from one hit to the next (the octave shifts are then ignored). A pattern without `voices` is literal.
// Like the strum cards, a pattern lives at three levels: built in (this file), the USER's own (device preference) and the PROJECT's (`PID.CHORD_PATTERNS`); lookup project > user > built in.
// A pattern may ask a FRETTED instrument for a degree in the bass of its fingerings (`bassDegree`, "3" = the third in the bass): it changes the shape chosen for the chord, so the riff lies on another position.
// The card (strumcards.js) says HOW to play (velocities, hand compass, what to do with a degree the chord does not have); the pattern says WHEN and WHAT.
import { parseDegree, isBassDegree } from './chorddegrees.js';
import { checkBeats, MAX_STEPS } from './beatgrid.js';
import { PID } from './pid.js';

export const CHORD_PATTERN_NONE = '';
/** A pattern can span up to this many measures (its `bars`); the song measure k plays bar k mod bars of it. */
export const MAX_BARS = 16; // a pattern made from a written part may be this long
/** A pattern may carry up to this many alternative phrases (`alts`). */
export const MAX_ALTS = 7;
export const DEFAULT_ALT_FROM = Object.freeze([1, 2]);
export const VOICE_MODES = Object.freeze(['literal', 'led']);
/** The mode of each hand of a pattern ('literal' when it does not say). */
export const patternVoices = (p) => ({ rh: VOICE_MODES.includes(p?.voices?.rh) ? p.voices.rh : 'literal', lh: VOICE_MODES.includes(p?.voices?.lh) ? p.voices.lh : 'literal' });

/** { kind: 'bass' } | { kind: 'chord' } | { kind: 'degree', hand: 'right' | 'left', n, accidental, signed, oct } or null (bad token). */
export function parsePart(token) {
  const t = String(token ?? '').trim();
  if (t === 'B') return { kind: 'bass' };
  if (t === 'C') return { kind: 'chord' };
  const m = /^(L?)([#b]{0,2}\d{1,2})([+-]\d)?$/.exec(t);
  const d = m ? parseDegree(m[2]) : null;
  return d ? { kind: 'degree', hand: m[1] ? 'left' : 'right', ...d, oct: m[3] ? Number(m[3]) : 0 } : null;
}

const f = (n, d) => [n, d];
const hit = (at, dur, parts, extra = {}) => ({ at, dur, parts, ...extra });

/** Built-in patterns (starting points chosen by Scorsaire, to be tuned by ear). Their names come from the language catalogs (`chordPattern.<id>`). */
export const BUILTIN_CHORD_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'ballad', name: null, length: f(1, 1), // bass and chord on the first beat, the chord on the other beats
    hits: [hit(f(0, 1), f(1, 4), ['B', 'C']), hit(f(1, 4), f(1, 4), ['C']), hit(f(1, 2), f(1, 4), ['C']), hit(f(3, 4), f(1, 4), ['C'])],
  }),
  Object.freeze({
    id: 'waltz', name: null, length: f(3, 4), // bass, chord, chord
    hits: [hit(f(0, 1), f(1, 4), ['B']), hit(f(1, 4), f(1, 4), ['C']), hit(f(1, 2), f(1, 4), ['C'])],
  }),
  Object.freeze({
    id: 'arpeggio', name: null, length: f(1, 1), // 1 – 5 – 8 – 5 in eighth notes, twice
    hits: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => hit(f(k, 8), f(1, 8), [['B', '5', '8', '5'][k % 4]])),
  }),
  Object.freeze({
    id: 'offbeat', name: null, length: f(1, 1), // bass on 1 and 3, chord on every off-beat
    hits: [hit(f(0, 1), f(1, 4), ['B']), hit(f(1, 8), f(1, 8), ['C']), hit(f(3, 8), f(1, 8), ['C']), hit(f(1, 2), f(1, 4), ['B']), hit(f(5, 8), f(1, 8), ['C']), hit(f(7, 8), f(1, 8), ['C'])],
  }),
  Object.freeze({ id: 'pad', name: null, length: f(1, 1), hits: [hit(f(0, 1), f(1, 1), ['C'])] }), // the whole chord held for the bar (keys, strings)
  // short accented chords of a horn section: on the 1, the "and" of 2 and the 4 (an example; whoever knows what they want writes their own)
  Object.freeze({ id: 'brass-stabs', name: null, length: f(1, 1), hits: [hit(f(0, 1), f(1, 8), ['C'], { accent: true, staccato: true }), hit(f(3, 8), f(1, 8), ['C'], { accent: true, staccato: true }), hit(f(3, 4), f(1, 8), ['C'], { staccato: true })] }),
  // for a bass guitar (a strumming card and the bass instrument on the chord staff): the bass of the fingering, and degrees placed near the hand
  Object.freeze({ id: 'bass-root', name: null, length: f(1, 1), hits: [0, 1, 2, 3].map((k) => hit(f(k, 4), f(1, 4), ['B'])) }), // the root on every beat
  Object.freeze({ id: 'bass-root-fifth', name: null, length: f(1, 1), hits: [0, 1, 2, 3].map((k) => hit(f(k, 4), f(1, 4), [['B', '5', 'B', '5'][k]])) }),
  Object.freeze({ id: 'bass-eighths', name: null, length: f(1, 1), hits: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => hit(f(k, 8), f(1, 8), ['B'])) }),
  Object.freeze({ id: 'bass-octaves', name: null, length: f(1, 1), hits: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => hit(f(k, 8), f(1, 8), [k % 2 ? '8' : 'B'])) }), // the root and its octave (disco)
  Object.freeze({ id: 'bass-walking', name: null, length: f(1, 1), hits: [0, 1, 2, 3].map((k) => hit(f(k, 4), f(1, 4), [['B', '3', '5', '3'][k]])) }), // a simple walking line on chord tones
]);

const isFraction = (x) => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[1] > 0 && x[0] >= 0;
const cmp = (a, b) => a[0] * b[1] - b[0] * a[1];
const add = (a, b) => { const d = a[1] * b[1]; const n = a[0] * b[1] + b[0] * a[1]; const g = gcd(n, d); return g ? [n / g, d / g] : [0, 1]; };
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

// OPTIONAL fields kept without being used by Scorsaire, so that a pattern made by another tool (Flibuste: Arpège) comes back unchanged: `vel` (1 to 127, the absolute velocity of a hit),
// `gate` (0.05 to 1, the part of its length a hit sounds) and `x` (any JSON object, by the name of the system that wrote it). A bad value is left out (the hit stays); an `x` too big is left out.
export const HIT_VEL_RANGE = Object.freeze([1, 127]);
export const HIT_GATE_RANGE = Object.freeze([0.05, 1]);
export const X_MAX_BYTES = Object.freeze({ hit: 1024, alt: 2048, pattern: 8192 });
function cleanX(x, max) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  try { const text = JSON.stringify(x); return text && text.length <= max ? JSON.parse(text) : null; } catch { return null; }
}
const keepX = (x, max) => { const c = cleanX(x, max); return c ? { x: c } : {}; };

/** A checked hit of a pattern (or of one of its alternative phrases) or null; `limit` = the length the hit has to start before. */
function cleanHit(h, limit) {
  if (!isFraction(h?.at) || !isFraction(h?.dur) || h.dur[0] === 0 || cmp(h.at, limit) >= 0) return null;
  const parts = (h.parts ?? []).filter((p) => parsePart(p));
  if (!parts.length) return null;
  return { at: h.at, dur: h.dur, parts, ...(h.accent ? { accent: true } : {}), ...(h.staccato ? { staccato: true } : {}), ...(h.stroke === 'down' || h.stroke === 'up' ? { stroke: h.stroke } : {}),
    ...(Number.isInteger(h.vel) && h.vel >= HIT_VEL_RANGE[0] && h.vel <= HIT_VEL_RANGE[1] ? { vel: h.vel } : {}),
    ...(Number.isFinite(h.gate) && h.gate >= HIT_GATE_RANGE[0] && h.gate <= HIT_GATE_RANGE[1] ? { gate: h.gate } : {}), ...keepX(h.x, X_MAX_BYTES.hit) };
}

/** A hit may carry `stroke` ('down' | 'up'): the direction of the strum of a fretted instrument, chosen by the author of the pattern; without it the card decides (down, or alternating). */
/** A complete, checked pattern from a partial one, or null when it is unusable (no valid hit). Bad hits and bad parts are dropped. */
export function createChordPattern(input = {}) {
  const length = isFraction(input.length) && input.length[0] > 0 ? input.length : f(1, 1);
  const hits = (input.hits ?? []).map((h) => cleanHit(h, length)).filter(Boolean);
  // ALTERNATIVE PHRASES: variations of the main pattern, each replacing it from `from` to the end of a bar (a bass fill, a keyboard stop, a guitar lick); `chance` 0 = only when a cue asks for it
  const barLength = patternBarLength({ length, bars: Number.isInteger(input.bars) ? input.bars : 1 });
  const alts = (input.alts ?? []).map((a, i) => {
    const from = isFraction(a?.from) && cmp(a.from, barLength) < 0 ? a.from : [...DEFAULT_ALT_FROM];
    const ah = (a?.hits ?? []).map((h) => cleanHit(h, barLength)).filter((h) => h && cmp(h.at, from) >= 0).sort((x, y) => cmp(x.at, y.at));
    const ab = checkBeats(a?.beats, barLength, 1);
    return ah.length ? { id: String(a.id ?? `alt${i + 1}`), name: a.name == null ? null : String(a.name).slice(0, 40), chance: Number.isFinite(a.chance) ? Math.min(1, Math.max(0, a.chance)) : 0, from, hits: ah, ...(ab ? { beats: ab } : {}), ...keepX(a.x, X_MAX_BYTES.alt) } : null;
  }).filter(Boolean).slice(0, MAX_ALTS);
  if (!hits.length) return null;
  hits.sort((a, b) => cmp(a.at, b.at));
  const bars = Number.isInteger(input.bars) && input.bars >= 1 && input.bars <= MAX_BARS ? input.bars : 1;
  const beats = checkBeats(input.beats, patternBarLength({ length, bars }), bars); // the cut of each beat of the grid of the editor, kept with the pattern
  const voices = input.voices && typeof input.voices === 'object' ? patternVoices(input) : null;
  return { id: String(input.id ?? ''), name: input.name == null ? null : String(input.name).slice(0, 40), ...(input.folder != null && String(input.folder).trim() ? { folder: String(input.folder).trim().slice(0, 40) } : {}), length, ...(isBassDegree(input.bassDegree) ? { bassDegree: input.bassDegree } : {}), ...(bars > 1 ? { bars } : {}), ...(voices && (voices.rh !== 'literal' || voices.lh !== 'literal') ? { voices } : {}), hits , ...(alts.length ? { alts } : {}) , ...(beats ? { beats } : {}), ...keepX(input.x, X_MAX_BYTES.pattern) };
}

/** Pattern by id: project > user > built in; null for none or an unknown id. */
export function resolveChordPattern(id, { project = [], user = [] } = {}) {
  if (!id) return null;
  for (const list of [project, user, BUILTIN_CHORD_PATTERNS]) {
    const found = list.find((p) => p?.id === id);
    if (found) return createChordPattern(found);
  }
  return null;
}

/** Length of ONE bar of the pattern (a fraction of a whole note): its length divided by its number of bars. */
export const patternBarLength = (pattern) => { const bars = pattern.bars ?? 1; const g = gcd(pattern.length[0], pattern.length[1] * bars) || 1; return [pattern.length[0] / g, (pattern.length[1] * bars) / g]; };
const sub = (a, b) => { const d = a[1] * b[1]; const n = a[0] * b[1] - b[0] * a[1]; const g = gcd(n, d); return g ? [n / g, d / g] : [0, 1]; };

/**
 * The hits of a pattern over one measure of length `measureLength` (fraction of a whole note), in order: [{ at, dur, parts, accent?, staccato? }].
 * `measureIndex`: the song measure plays bar `measureIndex mod bars` of a pattern of several bars. The bar repeats to fill the measure (a 3/4 bar in a 4/4 measure
 * starts again at the 4th beat); a hit that would run past the end of the measure is cut at the bar line. `alt` = one of the pattern's alternative phrases, played instead of the end of the bar.
 */
export function patternHitsForMeasure(pattern, measureLength, measureIndex = 0, alt = null) {
  const bars = pattern.bars ?? 1; const barLength = patternBarLength(pattern);
  const bar = ((measureIndex % bars) + bars) % bars;
  const first = [barLength[0] * bar, barLength[1]]; const last = add(first, barLength);
  let source = pattern.hits.filter((h) => cmp(h.at, first) >= 0 && cmp(h.at, last) < 0).map((h) => ({ ...h, at: sub(h.at, first) }));
  // an alternative phrase replaces the bar from its `from` to the end (its hits are written inside one bar)
  if (alt) source = [...source.filter((h) => cmp(h.at, alt.from) < 0), ...alt.hits];
  const out = [];
  for (let start = [0, 1]; cmp(start, measureLength) < 0; start = add(start, barLength)) {
    for (const h of source) {
      const at = add(start, h.at);
      if (cmp(at, measureLength) >= 0) continue;
      let dur = h.dur;
      const end = add(at, dur);
      if (cmp(end, measureLength) > 0) dur = [measureLength[0] * at[1] - at[0] * measureLength[1], measureLength[1] * at[1]];
      const g = gcd(dur[0], dur[1]); out.push({ ...h, at, dur: g ? [dur[0] / g, dur[1] / g] : [0, 1] });
    }
  }
  return out;
}

// ---- editing: lists at the user level (device preference) and the project level (`PID.CHORD_PATTERNS`) ----

/** Problems of a stored pattern: [] when it is usable as it is. */
export function validateChordPattern(p) {
  if (!p || typeof p !== 'object') return ['chord pattern: object expected'];
  const errors = [];
  if (typeof p.id !== 'string' || !p.id) errors.push('chord pattern: id expected');
  if (p.name != null && typeof p.name !== 'string') errors.push('chord pattern: name must be a string');
  if (p.folder != null && typeof p.folder !== 'string') errors.push('chord pattern: folder must be a string');
  if (!isFraction(p.length) || p.length[0] === 0) errors.push(`chord pattern ${p.id}: length must be a fraction of a whole note`);
  if (p.voices !== undefined && !(p.voices && typeof p.voices === 'object' && ['rh', 'lh'].every((k) => p.voices[k] === undefined || VOICE_MODES.includes(p.voices[k])))) errors.push(`chord pattern ${p.id}: voices must say 'literal' or 'led' for rh and lh`);
  if (p.bassDegree != null && !isBassDegree(p.bassDegree)) errors.push(`chord pattern ${p.id}: bassDegree must be a degree from 1 to 7`);
  if (p.bars !== undefined && !(Number.isInteger(p.bars) && p.bars >= 1 && p.bars <= MAX_BARS)) errors.push(`chord pattern ${p.id}: bars must be a whole number from 1 to ${MAX_BARS}`);
  if (!Array.isArray(p.hits) || !p.hits.length) errors.push(`chord pattern ${p.id}: at least one hit expected`);
  else p.hits.forEach((h, i) => {
    if (!isFraction(h?.at) || !isFraction(h?.dur) || h.dur[0] === 0) errors.push(`chord pattern ${p.id}: hit ${i} needs an "at" and a "dur" (fractions)`);
    else if (isFraction(p.length) && cmp(h.at, p.length) >= 0) errors.push(`chord pattern ${p.id}: hit ${i} starts after the end of the pattern`);
    if (!Array.isArray(h?.parts) || !h.parts.length || !h.parts.every((q) => parsePart(q))) errors.push(`chord pattern ${p.id}: hit ${i} has an unknown part`);
  });
  if (p.beats !== undefined && !(Array.isArray(p.beats) && p.beats.every((k) => Number.isInteger(k) && k >= 1 && k <= MAX_STEPS))) errors.push(`chord pattern ${p.id}: beats must be whole step counts`);
  for (const a of p.alts ?? []) if (!Array.isArray(a?.hits) || !a.hits.length || !a.hits.every((h) => isFraction(h?.at) && isFraction(h?.dur) && Array.isArray(h?.parts) && h.parts.length && h.parts.every((q) => parsePart(q)))) errors.push(`chord pattern ${p.id}: an alternative phrase needs hits with an "at", a "dur" and known parts`);
  return errors;
}

export function validateChordPatternList(list) {
  if (!Array.isArray(list)) return ['chord patterns: list expected'];
  const errors = []; const seen = new Set();
  for (const p of list) {
    errors.push(...validateChordPattern(p));
    if (p?.id && seen.has(p.id)) errors.push(`chord patterns: duplicate id ${p.id}`);
    if (p?.id) seen.add(p.id);
    if (p?.id && BUILTIN_CHORD_PATTERNS.some((b) => b.id === p.id)) errors.push(`chord patterns: ${p.id} is a built-in id`);
  }
  return errors;
}

/** The user's patterns as a preference section: { items: [pattern] }. */
export const validateChordPatternPref = (v) => (v && typeof v === 'object' ? validateChordPatternList(v.items ?? []) : ['chordPatterns: { items } expected']);
export const createChordPatternPref = (v) => ({ items: (v.items ?? []).map(createChordPattern).filter(Boolean) });

/** Every pattern a menu offers, complete: [{ ...pattern, source: 'builtin' | 'user' | 'project' }] (a project pattern hides one of the same id); built in first. */
export function allChordPatterns({ project = [], user = [] } = {}) {
  const seen = new Set(); const out = [];
  for (const [list, source] of [[project, 'project'], [user, 'user'], [BUILTIN_CHORD_PATTERNS, 'builtin']]) {
    for (const p of list ?? []) {
      if (!p?.id || seen.has(p.id)) continue;
      const done = createChordPattern(p); if (!done) continue;
      seen.add(p.id); out.push({ ...done, source });
    }
  }
  const order = { builtin: 0, user: 1, project: 2 };
  return out.sort((a, b) => order[a.source] - order[b.source]);
}

/** Call inside `doc.transaction`. */
export function setProjectChordPatterns(doc, work, list) {
  const errors = validateChordPatternList(list);
  if (errors.length) throw new Error(errors[0]);
  if (list.length) doc.set(work, PID.CHORD_PATTERNS, list); else if ((doc.get(work, PID.CHORD_PATTERNS) ?? []).length) doc.reset(work, PID.CHORD_PATTERNS);
}
