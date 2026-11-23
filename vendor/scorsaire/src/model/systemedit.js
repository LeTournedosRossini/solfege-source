/*
 * System ("masterbar") objects — placement edits. Pure model operations, TO BE CALLED INSIDE `doc.transaction`.
 * A system object is anchored by the masterbar id (+ an exact fraction of the measure for tempo, swing, fermata), never by a staff:
 * it can be placed from any staff and is drawn on the highest VISIBLE staff (layout). Rules follow MuseScore 4.7.5 (palettes of tempo,
 * repeats and jumps; one object of a kind per instant).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { fEq, ZERO } from './fraction.js';
import { createTempo, createTempoChange, createSwing, createFermata, createJump, createMarker, createVolta, createRehearsalMark } from './elements.js';
import { TEMPO_WORDS, GRADUAL_TYPES, FERMATA_STRETCH, QUARTER_UNIT } from './tempo.js';
import { JUMP_TYPES, MARKER_TYPES } from './repeats.js';
import { SWING_PRESETS } from './swingpresets.js';
import { EditError } from './noteedit.js';
import { createSystemContainer } from './elements.js';
import { SECTION_CATEGORIES } from './sections.js';
import { chordViewAt, setChordView, clearChordView, setChordViewRange, clearChordViewRange } from './chordview.js';

export const FERMATA_CHOICES = Object.freeze(Object.keys(FERMATA_STRETCH));
export const GRADUAL_CHOICES = Object.freeze(Object.keys(GRADUAL_TYPES).filter((k) => k !== 'user'));
export const JUMP_CHOICES = Object.freeze(JUMP_TYPES.map((j) => j.type));
export const MARKER_CHOICES = Object.freeze(MARKER_TYPES.map((m) => m.type));
export const SWING_CHOICES = Object.freeze(['swing', 'straight', 'tripletEighth', 'dottedEighth', 'scottishEighth', 'none']);
export const TEMPO_WORD_CHOICES = Object.freeze(Object.keys(TEMPO_WORDS));

const posOf = (el) => getProperty(el, PID.POSITION) ?? ZERO;
const at = (el, measureId, position) => getProperty(el, PID.MEASURE_ID) === measureId && fEq(posOf(el), position);

function masterbarOf(mv, measureId) {
  const mb = mv.masterbars.find((b) => b.id === measureId);
  if (!mb) throw new EditError(`Unknown measure: ${measureId}`);
  return mb;
}

/** Replaces the element of `list` found by `find` (same instant) with `fresh`, or adds `fresh`. Returns the stored element. */
function put(doc, mv, list, find, fresh) {
  const old = mv[list].find(find);
  if (old) doc.remove(old);
  doc.add(mv, list, fresh);
  return fresh;
}

/** The tempo text anchored at an instant (`{measureId, position}`), or null. */
export const tempoAt = (mv, target) => mv.tempos.find((t) => at(t, target.measureId, target.position)) ?? null;
export const swingAt = (mv, target) => mv.swings.find((s) => at(s, target.measureId, target.position) && !getProperty(s, PID.TARGET_STAFF_ID)) ?? null;
export const fermataAt = (mv, target) => mv.fermatas.find((f) => at(f, target.measureId, target.position)) ?? null;
export const jumpAt = (mv, measureId) => mv.jumps.find((j) => getProperty(j, PID.MEASURE_ID) === measureId) ?? null;
export const markerAt = (mv, measureId) => mv.markers.find((m) => getProperty(m, PID.MEASURE_ID) === measureId) ?? null;
export const voltaAt = (mv, measureId) => mv.voltas.find((v) => getProperty(v, PID.MEASURE_ID) === measureId) ?? null;

/**
 * Sets a tempo at an instant: `{ bpm, beatUnit?, text? }` (a tempo word gives its bpm and the word as text), or `{ kind: 'aTempo' | 'tempoPrimo' }`.
 * One tempo text per instant: an existing one is replaced.
 */
export function setTempo(doc, mv, target, spec) {
  masterbarOf(mv, target.measureId);
  const same = (t) => at(t, target.measureId, target.position);
  if (spec.kind === 'aTempo' || spec.kind === 'tempoPrimo') {
    return put(doc, mv, 'tempos', same, createTempo({ measureId: target.measureId, position: target.position, tempoKind: spec.kind }));
  }
  let { bpm, text } = spec;
  if (spec.word !== undefined) {
    if (!(spec.word in TEMPO_WORDS)) throw new EditError(`Unknown tempo word: ${spec.word}`);
    bpm = TEMPO_WORDS[spec.word]; text = spec.word;
  }
  if (!(bpm >= 5 && bpm <= 999)) throw new EditError('Tempo must be 5..999');
  const beatUnit = spec.beatUnit ?? QUARTER_UNIT;
  return put(doc, mv, 'tempos', same, createTempo({
    measureId: target.measureId, position: target.position, bpm, beatUnit, text, followText: spec.word === undefined && text === undefined ? true : undefined,
  }));
}

/** The beat units a tempo can be written in (the ones the buttons offer): quarter, dotted quarter, eighth, half. */
export const TEMPO_UNITS = Object.freeze([{ base: 'quarter', dots: 0 }, { base: 'quarter', dots: 1 }, { base: 'eighth', dots: 0 }, { base: 'half', dots: 0 }]);
/** Edits a tempo element in place: `{ bpm?, beatUnit? }` (a tempo word or a text of its own stays as written; a tempo that follows its text is written again from the new values). */
export function updateTempo(doc, el, { bpm, beatUnit } = {}) {
  if (!el || el.type !== 'tempo') throw new EditError('Not a tempo');
  if (bpm !== undefined) {
    if (!(bpm >= 5 && bpm <= 999)) throw new EditError('Tempo must be 5..999');
    doc.set(el, PID.TEMPO_BPM, Math.round(bpm));
  }
  if (beatUnit !== undefined) doc.set(el, PID.BEAT_UNIT, { base: beatUnit.base, dots: beatUnit.dots ?? 0 });
}

/** Gradual tempo change (rit., accel.…) between two instants; replaces one that starts at the same instant. */
export function setGradualChange(doc, mv, start, end, changeType) {
  if (!GRADUAL_TYPES[changeType]) throw new EditError(`Unknown gradual change: ${changeType}`);
  masterbarOf(mv, start.measureId); masterbarOf(mv, end.measureId);
  const same = (c) => at(c, start.measureId, start.position);
  return put(doc, mv, 'tempoChanges', same, createTempoChange({
    measureId: start.measureId, position: start.position, endMeasureId: end.measureId, endPosition: end.position, changeType,
  }));
}

/** Swing at an instant (general: applies to all staves). Same kind again = removed (toggle). */
export function toggleSwing(doc, mv, target, kind) {
  if (!SWING_PRESETS[kind]) throw new EditError(`Unknown swing: ${kind}`);
  masterbarOf(mv, target.measureId);
  const old = swingAt(mv, target);
  if (old && getProperty(old, PID.SWING_KIND) === kind) { doc.remove(old); return null; }
  if (old) doc.remove(old);
  const fresh = createSwing({ measureId: target.measureId, position: target.position, kind });
  doc.add(mv, 'swings', fresh);
  return fresh;
}

/** Fermata at an instant. Same type again = removed. */
export function toggleFermata(doc, mv, target, fermataType) {
  if (!(fermataType in FERMATA_STRETCH)) throw new EditError(`Unknown fermata: ${fermataType}`);
  masterbarOf(mv, target.measureId);
  const old = fermataAt(mv, target);
  if (old && getProperty(old, PID.FERMATA_TYPE) === fermataType) { doc.remove(old); return null; }
  if (old) doc.remove(old);
  const fresh = createFermata({ measureId: target.measureId, position: target.position, fermataType });
  doc.add(mv, 'fermatas', fresh);
  return fresh;
}

/** Jump on a measure (one per measure). Same type again = removed. */
export function toggleJump(doc, mv, measureId, jumpType) {
  if (!JUMP_CHOICES.includes(jumpType)) throw new EditError(`Unknown jump: ${jumpType}`);
  masterbarOf(mv, measureId);
  const old = jumpAt(mv, measureId);
  if (old && getProperty(old, PID.JUMP_TYPE) === jumpType) { doc.remove(old); return null; }
  if (old) doc.remove(old);
  const fresh = createJump({ measureId, jumpType });
  doc.add(mv, 'jumps', fresh);
  return fresh;
}

/** Marker on a measure (one per measure). Same type again = removed. */
export function toggleMarker(doc, mv, measureId, markerType) {
  if (!MARKER_CHOICES.includes(markerType)) throw new EditError(`Unknown marker: ${markerType}`);
  masterbarOf(mv, measureId);
  const old = markerAt(mv, measureId);
  if (old && getProperty(old, PID.MARKER_TYPE) === markerType) { doc.remove(old); return null; }
  if (old) doc.remove(old);
  const fresh = createMarker({ measureId, markerType });
  doc.add(mv, 'markers', fresh);
  return fresh;
}

/** Start-repeat flag on a measure (toggle). */
export function toggleRepeatStart(doc, mv, measureId) {
  const mb = masterbarOf(mv, measureId);
  const on = !getProperty(mb, PID.REPEAT_START);
  doc.set(mb, PID.REPEAT_START, on);
  return on;
}

/** End-repeat flag on a measure (toggle); `count` = number of plays (default 2). */
export function toggleRepeatEnd(doc, mv, measureId, count = 2) {
  const mb = masterbarOf(mv, measureId);
  const on = !getProperty(mb, PID.REPEAT_END);
  doc.set(mb, PID.REPEAT_END, on);
  if (on && count !== 2) doc.set(mb, PID.REPEAT_COUNT, count);
  if (!on) { doc.reset(mb, PID.REPEAT_TEXT); doc.reset(mb, PID.REPEAT_COUNT); }
  return on;
}

const AUTO_REPEAT_TEXT = /^[x×]\d+$/i;

/**
 * Number of plays of the repeat that ENDS on a measure (2..99). A text of the form « x4 » follows the number (a free text is left alone).
 * The measure must have an end-repeat bar.
 */
export function setRepeatCount(doc, mv, measureId, count) {
  const mb = masterbarOf(mv, measureId);
  if (!getProperty(mb, PID.REPEAT_END)) throw new EditError('This measure has no end repeat');
  if (!Number.isInteger(count) || count < 2 || count > 99) throw new EditError('A repeat is played 2 to 99 times');
  if (count === 2) doc.reset(mb, PID.REPEAT_COUNT); else doc.set(mb, PID.REPEAT_COUNT, count);
  const text = getProperty(mb, PID.REPEAT_TEXT);
  if (typeof text === 'string' && AUTO_REPEAT_TEXT.test(text)) doc.set(mb, PID.REPEAT_TEXT, `x${count}`);
}

/** Text written above the end-repeat bar (« x4 », « 3 times »…); null or empty removes it. `'auto'` writes « x » + the number of plays. */
export function setRepeatText(doc, mv, measureId, text) {
  const mb = masterbarOf(mv, measureId);
  if (!getProperty(mb, PID.REPEAT_END)) throw new EditError('This measure has no end repeat');
  const value = text === 'auto' ? `x${getProperty(mb, PID.REPEAT_COUNT) ?? 2}` : String(text ?? '').trim().slice(0, 20);
  if (!value) doc.reset(mb, PID.REPEAT_TEXT); else doc.set(mb, PID.REPEAT_TEXT, value);
}

/** Volta bracket from `measureId` over `span` measures with its numbers; the same volta again = removed. */
export function toggleVolta(doc, mv, measureId, { span = 1, numbers = [1], open = false } = {}) {
  masterbarOf(mv, measureId);
  if (span < 1 || measureId && mv.masterbars.findIndex((b) => b.id === measureId) + span > mv.masterbars.length) throw new EditError('The volta goes past the end');
  const old = voltaAt(mv, measureId);
  const sameNumbers = old && JSON.stringify(getProperty(old, PID.VOLTA_NUMBERS)) === JSON.stringify(numbers);
  if (old && sameNumbers && getProperty(old, PID.SPAN) === span) { doc.remove(old); return null; }
  if (old) doc.remove(old);
  const fresh = createVolta({ measureId, span, numbers, open });
  doc.add(mv, 'voltas', fresh);
  return fresh;
}

/** Barline types a measure can end with (the right-hand barline of the measure; a start repeat belongs to the measure on its right). */
export const BAR_TYPE_CHOICES = Object.freeze(['simple', 'double', 'final', 'reverseFinal', 'heavy', 'heavyHeavy', 'dashed', 'dotted', 'short', 'tick']);

/** Barline type of the measure's right-hand bar. A type equal to the default is not stored. Returns the new type. */
export function setBarType(doc, mv, measureId, type) {
  if (!BAR_TYPE_CHOICES.includes(type)) throw new EditError(`Unknown barline type: ${type}`);
  const mb = masterbarOf(mv, measureId);
  if (type === 'simple') doc.reset(mb, PID.BAR_TYPE); else doc.set(mb, PID.BAR_TYPE, type);
  return type;
}

/**
 * Changes of an existing volta: ending numbers (1..9), open end (no closing hook), the text written instead of the numbers, the text size, the line width and
 * the corner radius (a number, or null = back to the style value / the numbers).
 */
export function updateVolta(doc, volta, { numbers, open, text, textSize, lineWidth, corner } = {}) {
  if (numbers !== undefined) {
    if (!Array.isArray(numbers) || !numbers.length || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 9)) throw new EditError('Volta numbers: a list of integers from 1 to 9');
    doc.set(volta, PID.VOLTA_NUMBERS, [...numbers].sort((a, b) => a - b));
  }
  if (open !== undefined) doc.set(volta, PID.VOLTA_OPEN, !!open);
  if (text !== undefined) { const t = String(text ?? '').trim().slice(0, 24); if (t) doc.set(volta, PID.VOLTA_TEXT, t); else doc.reset(volta, PID.VOLTA_TEXT); }
  const real = (pid, v, min, max) => { if (v === undefined) return; if (v === null) { doc.reset(volta, pid); return; } if (!Number.isFinite(v) || v < min || v > max) throw new EditError(`Volta: value out of range (${min} to ${max})`); doc.set(volta, pid, v); };
  real(PID.VOLTA_TEXT_SIZE, textSize, 0.4, 3);
  real(PID.VOLTA_LINE_WIDTH, lineWidth, 0.03, 0.5);
  real(PID.VOLTA_CORNER, corner, 0, 2);
  return volta;
}

export const rehearsalAt = (mv, measureId) => mv.rehearsalMarks.find((r) => getProperty(r, PID.MEASURE_ID) === measureId) ?? null;

/**
 * Text of the next rehearsal mark after `previous` (port of `Score::nextRehearsalMarkText`): A..Z, then AA, BB..ZZ; a..z, aa..zz; numbers
 * 1, 2, 3… (a number equal to the measure number + 1 follows the measure numbers). Anything else: `fallback`.
 */
export function nextRehearsalText(previous, { measureNumber = 0, previousMeasureNumber = 0, fallback = '' } = {}) {
  if (/^[A-Za-z]$/.test(previous)) {
    if (previous === 'Z') return 'AA';
    if (previous === 'z') return 'aa';
    return String.fromCharCode(previous.charCodeAt(0) + 1);
  }
  if (/^[A-Za-z]{2}$/.test(previous)) {
    if (previous[0] === previous[1] && previous.toUpperCase() !== 'ZZ') { const c = String.fromCharCode(previous.charCodeAt(0) + 1); return c + c; }
    return fallback;
  }
  if (/^\d+$/.test(previous)) {
    const n = Number(previous);
    if (n === previousMeasureNumber + 1) return String(measureNumber + 1); // follows the measure numbers
    return String(n + 1);
  }
  return fallback;
}

/** Text suggested for a new rehearsal mark on measure `measureId`: next in the sequence of the previous mark, "A" for the first. */
export function suggestRehearsalText(mv, measureId) {
  const ids = mv.masterbars.map((b) => b.id);
  const here = ids.indexOf(measureId);
  let prev = null; let prevIndex = -1;
  for (const r of mv.rehearsalMarks) {
    const i = ids.indexOf(getProperty(r, PID.MEASURE_ID));
    if (i >= 0 && i < here && i > prevIndex) { prev = r; prevIndex = i; }
  }
  if (!prev) return 'A';
  const text = getProperty(prev, PID.TEXT);
  return nextRehearsalText(text, { measureNumber: here, previousMeasureNumber: prevIndex, fallback: `${text}'` });
}

/** Rehearsal mark on a measure (one per measure): present = removed; absent = added with the next text of the sequence (or `text`). */
export function toggleRehearsalMark(doc, mv, measureId, text) {
  masterbarOf(mv, measureId);
  const old = rehearsalAt(mv, measureId);
  if (old) { doc.remove(old); return null; }
  const fresh = createRehearsalMark({ measureId, text: text ?? suggestRehearsalText(mv, measureId) });
  doc.add(mv, 'rehearsalMarks', fresh);
  return fresh;
}

/** Changes the text of the rehearsal mark of a measure. */
export function setRehearsalText(doc, mv, measureId, text) {
  const old = rehearsalAt(mv, measureId);
  if (!old) throw new EditError('No rehearsal mark on this measure');
  const clean = String(text ?? '').trim().slice(0, 8);
  if (!clean) throw new EditError('A rehearsal mark needs a text');
  doc.set(old, PID.TEXT, clean);
}

/** The section container (kind 'section') anchored to a measure, or null. */
export const sectionAt = (mv, measureId) => mv.systemContainers.find((c) => getProperty(c, PID.CONTAINER_KIND) === 'section' && getProperty(c, PID.MEASURE_ID) === measureId) ?? null;

/**
 * Section (a part of the form) starting on a measure: `{ label, category }`. One per measure: another one is replaced; the same label and
 * category again removes it. `color` (optional) is the section's own colour.
 */
export function toggleSection(doc, mv, measureId, { label, category = 'custom', color } = {}) {
  masterbarOf(mv, measureId);
  if (!SECTION_CATEGORIES.includes(category)) throw new EditError(`Unknown section category: ${category}`);
  const text = String(label ?? '').trim().slice(0, 40);
  if (!text) throw new EditError('A section needs a name');
  const old = sectionAt(mv, measureId);
  if (old && getProperty(old, PID.LABEL) === text && getProperty(old, PID.SECTION_CATEGORY) === category) { doc.remove(old); return null; }
  if (old) doc.remove(old);
  const props = color ? { [PID.COLOR]: color } : {};
  const fresh = createSystemContainer({ measureId, kind: 'section', label: text, category, props });
  doc.add(mv, 'systemContainers', fresh);
  return fresh;
}

/** Replaces ALL the sections of a movement by `list` = [{ measure (index), label, category }] (one transaction's worth of edits: the caller wraps it). */
export function replaceSections(doc, mv, list) {
  for (const old of [...mv.systemContainers]) if (getProperty(old, PID.CONTAINER_KIND) === 'section') doc.remove(old);
  const seen = new Set();
  for (const x of list) {
    const mb = mv.masterbars[x.measure]; const text = String(x.label ?? '').trim().slice(0, 40);
    if (!mb || !text || seen.has(mb.id)) continue;
    seen.add(mb.id);
    doc.add(mv, 'systemContainers', createSystemContainer({ measureId: mb.id, kind: 'section', label: text, category: SECTION_CATEGORIES.includes(x.category) ? x.category : 'custom' }));
  }
}

/**
 * Moves the section `sectionId` so that it starts on `toMeasureId` (its name, category and colour stay). Another section already starting there
 * is NOT replaced: the move is refused with a message. Returns the section.
 */
export function moveSection(doc, mv, sectionId, toMeasureId) {
  const sec = mv.systemContainers.find((c) => c.id === sectionId && getProperty(c, PID.CONTAINER_KIND) === 'section');
  if (!sec) throw new EditError('No such section');
  masterbarOf(mv, toMeasureId);
  if (getProperty(sec, PID.MEASURE_ID) === toMeasureId) return sec;
  if (sectionAt(mv, toMeasureId)) throw new EditError('Another section already starts on this measure');
  doc.set(sec, PID.MEASURE_ID, toMeasureId);
  return sec;
}

/** Removes the section `sectionId` (whatever measure it starts on). */
export function removeSection(doc, mv, sectionId) {
  const sec = mv.systemContainers.find((c) => c.id === sectionId && getProperty(c, PID.CONTAINER_KIND) === 'section');
  if (!sec) throw new EditError('No such section');
  doc.remove(sec);
}

/** Own colour of the section of a measure (null = the default colour of its category). */
export function setSectionColor(doc, mv, measureId, color) {
  const sec = sectionAt(mv, measureId);
  if (!sec) throw new EditError('No section on this measure');
  if (color === null) doc.reset(sec, PID.COLOR);
  else if (/^#[0-9a-fA-F]{6}$/.test(color)) doc.set(sec, PID.COLOR, color);
  else throw new EditError('Invalid colour');
}

/** Renames the section of a measure. */
export function setSectionLabel(doc, mv, measureId, label) {
  const sec = sectionAt(mv, measureId);
  if (!sec) throw new EditError('No section on this measure');
  const text = String(label ?? '').trim().slice(0, 40);
  if (!text) throw new EditError('A section needs a name');
  doc.set(sec, PID.LABEL, text);
}

// ---- display tags of the chord staff (model/chordview.js): how the chord symbols are READ from a measure on, the sound unchanged
/** The first chord staff of a movement, or null. */
export const chordViewStaff = (mv) => mv.tracks.flatMap((t) => t.staves).find((s) => getProperty(s, PID.STAFF_TYPE) === 'chord') ?? null;
/** The display tag that starts on a measure: { mode, shift } or null. */
export function chordViewOn(mv, measureId) { const st = chordViewStaff(mv); const tag = st ? chordViewAt(mv, st, measureId) : null; return tag ? { mode: tag.mode, shift: tag.shift } : null; }
/** Puts a display tag on a measure (the same one again removes it). */
export function toggleChordView(doc, mv, measureId, spec, endMeasureId = null) {
  const st = chordViewStaff(mv); if (!st) throw new EditError('There is no chord track to tag');
  if (endMeasureId && endMeasureId !== measureId) { setChordViewRange(doc, mv, st, measureId, endMeasureId, spec); return null; } // several measures chosen: the tag covers them, the reading before comes back after
  return setChordView(doc, mv, st, measureId, spec);
}
/** Removes the display tag of a measure. */
export function removeChordView(doc, mv, measureId, endMeasureId = null) { const st = chordViewStaff(mv); if (!st) return; if (endMeasureId && endMeasureId !== measureId) clearChordViewRange(doc, mv, st, measureId, endMeasureId); else clearChordView(doc, mv, st, measureId); }
