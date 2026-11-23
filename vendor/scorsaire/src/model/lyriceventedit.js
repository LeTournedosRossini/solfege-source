/*
 * Édition de la piste « Paroles » à événements (voir model/lyricevents.js) : toutes les écritures passent par `doc` (le Document ; l'appelant les enveloppe dans UNE transaction).
 *   addLyricEvent          pose une syllabe (mesure, position exacte, texte, ligne)
 *   setLyricEventText      corrige le texte
 *   setLyricEventLine      change de ligne (0 … MAX_LINE)
 *   moveLyricEvent         déplace à (mesure, position) ; hors de la mesure : l'événement change de mesure (il est recréé, son lien est gardé)
 *   shiftLyricEvent        déplace de `steps` pas (la double-croche) en passant d'une mesure à l'autre
 *   removeLyricEvent       supprime
 *   assignWords            remplace les textes de la suite des événements d'une ligne par des mots (corriger une transcription en collant les bons mots)
 *   lyricLinkInfo / applyLyricLinks / realignLyricEvents   LIER des syllabes à des notes : une syllabe liée est posée à l'instant de son accord (PID.LYRIC_TARGET = l'identifiant de l'accord) ;
 *                          « réaligner » la remet là où son accord est aujourd'hui (les notes ont pu bouger), ou la délie si l'accord a disparu
 * Un événement ne sort jamais de la partition : la position reste dans [0, longueur de la mesure).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { frac, fAdd, fSub, fCmp, fEq, fToNumber, ZERO } from './fraction.js';
import { measureLengthOf } from './timing.js';
import { createLyricEvent } from './elements.js';
import { lyricEventsOf } from './lyricevents.js';
import { timed } from './range.js';
import { parseLyricText, normalizeLyricText, removeWords } from './lyrictext.js';
import { sectionList } from './sections.js';

export const MAX_LINE = 7;
export const STEP = frac(1, 16); // un pas de déplacement : la double-croche

export class LyricEditError extends Error {}

const staffMeasures = (staff) => staff.voices[0]?.measures ?? [];
const positionOf = (item) => getProperty(item, PID.POSITION) ?? ZERO;

/** Where an event goes in the items of its measure: after the ones that start before it. */
const insertIndex = (measure, position) => {
  let at = 0;
  measure.items.forEach((it, i) => { if (fCmp(positionOf(it), position) <= 0) at = i + 1; });
  return at;
};

function checkPlace(movement, staff, measure, position) {
  const measures = staffMeasures(staff);
  if (!Number.isInteger(measure) || measure < 0 || measure >= measures.length) throw new LyricEditError(`Measure ${measure} does not exist`);
  const length = measureLengthOf(movement.masterbars[measure]);
  if (fCmp(position, ZERO) < 0 || fCmp(position, length) >= 0) throw new LyricEditError('The position is outside the measure');
  return measures[measure];
}

export function addLyricEvent(doc, movement, staff, { measure, position, text, line = 0, target = null }) {
  const m = checkPlace(movement, staff, measure, position);
  const clean = String(text ?? '');
  const ev = createLyricEvent({ text: clean, position, line: Math.min(MAX_LINE, Math.max(0, line)), target });
  doc.add(m, 'items', ev, insertIndex(m, position));
  return ev;
}

export function setLyricEventText(doc, item, text) {
  doc.set(item, PID.TEXT, String(text ?? ''));
}

export function setLyricEventLine(doc, item, line) {
  const n = Math.min(MAX_LINE, Math.max(0, Math.trunc(line)));
  if (n === 0) { if ((getProperty(item, PID.LYRIC_LINE) ?? 0) !== 0) doc.reset(item, PID.LYRIC_LINE); } else doc.set(item, PID.LYRIC_LINE, n);
}

export function removeLyricEvent(doc, item) {
  doc.remove(item);
}

/** Moves an event; returns the event now (a NEW element when the measure changed). */
export function moveLyricEvent(doc, movement, staff, event, { measure, position }) {
  checkPlace(movement, staff, measure, position);
  if (measure === event.measure) {
    if (!fEq(event.position, position)) doc.set(event.item, PID.POSITION, position); // (the painter orders the syllables by instant: the order of the items does not matter)
    return event.item;
  }
  const fresh = createLyricEvent({ text: event.text, position, line: event.line, target: event.target });
  doc.remove(event.item);
  const m = staffMeasures(staff)[measure];
  doc.add(m, 'items', fresh, insertIndex(m, position));
  return fresh;
}

/** Where `steps` sixteenths from an event are (negative = earlier), across the bar lines: { measure, position }, or null when that leaves the song. */
export function slotFrom(movement, staff, event, steps) {
  let measure = event.measure; let position = event.position;
  for (let i = 0; i < Math.abs(steps); i += 1) {
    if (steps > 0) {
      position = fAdd(position, STEP);
      if (fCmp(position, measureLengthOf(movement.masterbars[measure])) >= 0) { measure += 1; position = ZERO; if (measure >= staffMeasures(staff).length) return null; }
    } else if (fCmp(position, STEP) >= 0) position = fSub(position, STEP);
    else {
      if (measure === 0) return null;
      measure -= 1; position = fSub(measureLengthOf(movement.masterbars[measure]), STEP);
    }
  }
  return { measure, position };
}

/** Moves by `steps` sixteenths (negative = earlier), across the bar lines. Null when it would leave the song. */
export function shiftLyricEvent(doc, movement, staff, event, steps) {
  const slot = slotFrom(movement, staff, event, steps);
  return slot ? moveLyricEvent(doc, movement, staff, event, slot) : null;
}

/**
 * Puts `words` on the texts of the events of line `line` from the one at `startIndex` of that line's list (the events of a line in the order of the score), one word each;
 * returns { replaced, left } (`left` = words that found no event). The events themselves (their instants, links) do not move.
 */
export function assignWords(doc, staff, { line = 0, startIndex = 0, words }) {
  const own = lyricEventsOf(staff).filter((e) => e.line === line);
  let replaced = 0;
  words.forEach((word, i) => {
    const e = own[startIndex + i];
    if (!e) return;
    if (e.text !== word) doc.set(e.item, PID.TEXT, word);
    replaced += 1;
  });
  return { replaced, left: Math.max(0, words.length - replaced) };
}

// ---------- the text kept waiting (PID.LYRIC_RESERVE) ----------
// Plain text: a line is a phrase, a marker line (`[Refrain]`) names a section (see lyrictext.js). Only the words are syllables.

/** The waiting text as written (lines and markers kept). */
export const reserveText = (staff) => String(getProperty(staff, PID.LYRIC_RESERVE) ?? '');

/** The words waiting on a lyrics staff, in order (the markers are not words). */
export const reserveOf = (staff) => parseLyricText(reserveText(staff)).words;

/** Replaces the waiting text: a text (lines and markers kept), or a list of words (one phrase); blank = nothing waits. */
export function setReserve(doc, staff, value) {
  const text = normalizeLyricText(Array.isArray(value) ? value.join(' ') : String(value ?? ''));
  if (text === reserveText(staff)) return;
  if (text) doc.set(staff, PID.LYRIC_RESERVE, text); else if (getProperty(staff, PID.LYRIC_RESERVE)) doc.reset(staff, PID.LYRIC_RESERVE);
}

/** Adds a text (or a list of words, one phrase) at the end of the waiting text. */
export function appendReserve(doc, staff, value) {
  setReserve(doc, staff, [reserveText(staff), Array.isArray(value) ? value.join(' ') : String(value ?? '')].filter(Boolean).join('\n'));
}

/**
 * Takes every syllable of line `line` off the song and puts its words back at the START of the waiting text, in time order (a hyphen at the end of a word stays): the text
 * is whole again, ready to be put on notes anew. Returns { moved }. One undo step with the caller's transaction.
 */
export function unassignAll(doc, staff, { line = 0 } = {}) {
  const own = lyricEventsOf(staff).filter((e) => e.line === line).sort((a, b) => a.measure - b.measure || fToNumber(a.position) - fToNumber(b.position));
  const words = own.map((e) => e.text.trim()).filter(Boolean);
  for (const e of own) doc.remove(e.item);
  setReserve(doc, staff, [words.join(' '), reserveText(staff)].filter(Boolean).join('\n')); // the words come back as one phrase before what already waits
  return { moved: own.length };
}

/** Puts every waiting syllable (null) on the note after the previous syllable's, never past the next one already placed, skipping the ranks in `skip` (tied notes); `chordCount` notes. Pure: returns a new assignment. */
export function autoAssign(assign, chordCount, skip = new Set(), spans = []) {
  const next = assign.slice();
  let prev = -1;
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== null) { prev = next[i] + (spans[i] ?? 0); continue; } // (a held syllable keeps the notes it covers)
    const limit = next.slice(i + 1).find((p) => p !== null) ?? chordCount;
    let at = prev + 1;
    while (at < limit && skip.has(at)) at += 1; // a note tied from the one before keeps the syllable before it
    if (at < limit) { prev = at; next[i] = at; }
  }
  return next;
}

/** The words of a pasted text: separated by blanks; a hyphen at the end of a word stays (« lone- »). */
export const wordsOf = (text) => String(text ?? '').split(/\s+/).filter(Boolean);

// ---------- links to notes ----------

/** Where every chord of a staff is (voice `voice`): Map(chord id → { measure, position }). */
export function chordSlots(movement, staff, voice = 0) {
  const out = new Map();
  const v = staff.voices?.[voice]; if (!v) return out;
  v.measures.forEach((_, mi) => { for (const t of timed(movement, v, mi).out) if (t.item.type === 'chord') out.set(t.item.id, { measure: mi, position: t.start, end: t.end }); });
  return out;
}

export function setLyricEventTarget(doc, item, chordId) {
  if (chordId) doc.set(item, PID.LYRIC_TARGET, chordId);
  else if (getProperty(item, PID.LYRIC_TARGET)) doc.reset(item, PID.LYRIC_TARGET);
}

const byTime = (a, b) => a.measure - b.measure || fToNumber(a.position) - fToNumber(b.position);

/**
 * The syllables of a line of a lyrics staff and the notes (voice 1) of a melody staff, for the window that puts each syllable on its note:
 * { events (in time order), syllables: [{ index, text, join }], chords: [{ id, mi }], assign: (chord rank | null)[], spans }.
 * A syllable is on a note when its target is that chord; its text loses a trailing hyphen (shown as a join).
 */
/** Absolute instant (from the start of the movement) of a measure and position. */
function absOf(movement, measure, position) {
  let at = ZERO;
  for (let m = 0; m < measure; m += 1) at = fAdd(at, measureLengthOf(movement.masterbars[m]));
  return fAdd(at, position);
}

export function lyricLinkInfo(movement, lyricsStaff, melodyStaff, line = 0) {
  const events = lyricEventsOf(lyricsStaff).filter((e) => e.line === line).sort(byTime);
  const chords = [];
  const tiedTo = new Set((getProperty(melodyStaff, PID.TIES) ?? []).map((t) => t.endNoteId));
  // `cont`: the chord goes on a note tied from the one before (it prolongs its syllable: it takes no new one by default)
  (melodyStaff.voices?.[0]?.measures ?? []).forEach((m, mi) => { for (const it of m?.items ?? []) if (it.type === 'chord') chords.push({ id: it.id, mi, cont: (it.notes ?? []).some((n) => tiedTo.has(n.id)) }); });
  const rank = new Map(chords.map((c, i) => [c.id, i]));
  // each chord's absolute start / end: a held syllable (LYRIC_HOLD) covers the notes that start before its hold ends
  const slots = chordSlots(movement, melodyStaff);
  for (const c of chords) { const sl = slots.get(c.id); if (sl) { c.abs = absOf(movement, sl.measure, sl.position); c.absEnd = absOf(movement, sl.measure, sl.end); c.pos = sl.position; } }
  const spanOf = (e) => {
    const hold = getProperty(e.item, PID.LYRIC_HOLD); const q = e.target && rank.has(e.target) ? rank.get(e.target) : -1;
    if (!hold || q < 0 || !chords[q].abs) return 0;
    const until = fAdd(chords[q].abs, hold);
    let n = 0; for (let r = q + 1; r < chords.length && chords[r].abs && fCmp(chords[r].abs, until) < 0; r += 1) n += 1;
    return n;
  };
  const reserve = reserveOf(lyricsStaff); // the text kept waiting: more syllables, after the ones of the song, all waiting
  const syllables = [...events.map((e) => e.text), ...reserve].map((text, index) => ({ index, text: text.replace(/-+$/, '') || '·', join: /-$/.test(text) ? '-' : 'space', waiting: index >= events.length }));
  const assign = [...events.map((e) => (e.target && rank.has(e.target) ? rank.get(e.target) : null)), ...reserve.map(() => null)];
  // the waiting phrases (the lines of the waiting text), as ranges of syllables, with the section marker they stand under and the measure of the matching card of the form, if any
  const phrases = [];
  let marker = null;
  const cards = sectionList(movement);
  for (const item of parseLyricText(reserveText(lyricsStaff)).items) {
    if (item.type === 'marker') { marker = item; continue; }
    phrases.push({ from: events.length + item.from, to: events.length + item.from + item.words.length, section: marker ? marker.name : null, hint: marker ? cardMeasureFor(cards, marker) : null });
  }
  return { events, reserve, phrases, syllables, chords, assign, spans: syllables.map((_, i) => (i < events.length ? spanOf(events[i]) : 0)), grid: false };
}

/** The measure of the card of the form that a section marker points at (same kind, the n-th one for « Couplet 2 », else a same label, else the first of that kind), or null. */
function cardMeasureFor(cards, marker) {
  const same = cards.filter((c) => c.category === marker.kind);
  const number = Number(/(\d+)\s*$/.exec(marker.name)?.[1] ?? 0);
  const byLabel = cards.find((c) => c.label.trim().toLowerCase() === marker.name.trim().toLowerCase());
  const pick = byLabel ?? (marker.kind === 'custom' ? null : (number ? same[number - 1] : same[0]) ?? null);
  return pick ? pick.index : null;
}

/**
 * What the window proposes for waiting phrase `k`: where it starts (the first untied note after the last placed syllable before it; else from the card of the form `hint`, else the start),
 * where its words run out (one per untied note) and how many notes that covers. `fromMeasure` forces the start measure, `fromRank` the first note (a handle dragged onto a note). Returns
 * { startRank, endRank, fromMeasure, toMeasure, syllables, notes, tied, short } or null when there is no note to start on. Pure.
 */
export function proposePhrase(info, assign, k, { fromMeasure = null, fromRank = null } = {}) {
  const ph = info.phrases[k]; if (!ph) return null;
  const waiting = []; for (let i = ph.from; i < ph.to; i += 1) if (assign[i] === null) waiting.push(i);
  let prev = -1; for (let i = ph.from - 1; i >= 0; i -= 1) if (assign[i] !== null) { prev = assign[i]; break; }
  const startMeasure = fromMeasure ?? (prev >= 0 ? info.chords[Math.min(prev + 1, info.chords.length - 1)].mi : (ph.hint ?? 0));
  let startRank = -1;
  for (let r = Math.max(prev + 1, fromRank ?? 0, 0); r < info.chords.length; r += 1) if ((fromRank !== null || info.chords[r].mi >= startMeasure) && !info.chords[r].cont) { startRank = r; break; }
  if (startRank < 0) return null;
  let endRank = startRank; let used = 0;
  for (let r = startRank; r < info.chords.length && used < waiting.length; r += 1) { if (info.chords[r].cont) continue; used += 1; endRank = r; }
  const ranks = info.chords.slice(startRank, endRank + 1);
  return { startRank, endRank, fromMeasure: info.chords[startRank].mi, toMeasure: info.chords[endRank].mi, syllables: waiting.length, notes: ranks.length, tied: ranks.filter((c) => c.cont).length, short: used < waiting.length };
}

/** Puts the waiting syllables of phrase `k` on the notes from `startRank` on (tied notes skipped), in order, never past the next syllable already placed. Pure: a new assignment. */
export function placePhrase(assign, info, k, startRank, spans = []) {
  const ph = info.phrases[k]; if (!ph) return assign;
  const next = assign.slice();
  const limit = next.slice(ph.to).find((p) => p !== null) ?? info.chords.length;
  let r = startRank;
  for (let i = ph.from; i < ph.to; i += 1) {
    if (next[i] !== null) { r = Math.max(r, next[i] + 1 + (spans[i] ?? 0)); continue; }
    while (r < limit && info.chords[r].cont) r += 1;
    if (r >= limit) break;
    next[i] = r; r += 1;
  }
  return next;
}

/** Writes (or clears) the hold of a syllable placed on chord rank `p` that covers `span` more notes: up to the end of the last of them. */
function setHold(doc, info, item, p, span) {
  const last = Math.min(info.chords.length - 1, p + Math.max(0, span));
  const from = info.chords[p], to = info.chords[last];
  if (span > 0 && last > p && from.abs && to.absEnd) doc.set(item, PID.LYRIC_HOLD, fSub(to.absEnd, from.abs));
  else if (getProperty(item, PID.LYRIC_HOLD)) doc.reset(item, PID.LYRIC_HOLD);
}

/** Writes an assignment (see `lyricLinkInfo`): each placed syllable goes to the instant of its chord and remembers it; the ones taken off the notes are unlinked and stay where they are. */
export function applyLyricLinks(doc, movement, lyricsStaff, melodyStaff, line, assign, spans = []) {
  const info = lyricLinkInfo(movement, lyricsStaff, melodyStaff, line);
  if (assign.length !== info.syllables.length) throw new LyricEditError('Inconsistent assignment');
  let previous = -1;
  assign.forEach((p) => { if (p === null) return; if (!(p > previous) || p >= info.chords.length) throw new LyricEditError('Inconsistent assignment'); previous = p; });
  const slots = chordSlots(movement, melodyStaff);
  let linked = 0;
  info.events.forEach((event, i) => {
    const p = assign[i];
    if (p === null) { setLyricEventTarget(doc, event.item, null); return; }
    const chord = info.chords[p]; const slot = slots.get(chord.id);
    const now = slot ? moveLyricEvent(doc, movement, lyricsStaff, event, slot) : event.item;
    setLyricEventTarget(doc, now, chord.id);
    setHold(doc, info, now, p, spans[i] ?? 0);
    linked += 1;
  });
  // the waiting words that were put on a note become syllables there; the others keep waiting
  const placed = new Set();
  info.reserve.forEach((word, k) => {
    const p = assign[info.events.length + k];
    const slot = p === null ? null : slots.get(info.chords[p].id);
    if (!slot) return;
    placed.add(k);
    const made = addLyricEvent(doc, movement, lyricsStaff, { measure: slot.measure, position: slot.position, text: word, line, target: info.chords[p].id });
    setHold(doc, info, made, p, spans[info.events.length + k] ?? 0);
    linked += 1;
  });
  if (placed.size) setReserve(doc, lyricsStaff, removeWords(reserveText(lyricsStaff), placed)); // what is left keeps its lines and markers
  return { linked };
}

/** Puts every linked syllable back on its chord (wherever the chord is now, on any staff of the movement); one whose chord has disappeared is unlinked. Returns { moved, unlinked }. */
export function realignLyricEvents(doc, movement, lyricsStaff) {
  const slots = new Map();
  for (const track of movement.tracks) for (const staff of track.staves) {
    if (staff === lyricsStaff || (staff.props?.staffType ?? '') === 'chord' || (staff.props?.staffType ?? '') === 'lyrics') continue;
    for (const [id, slot] of chordSlots(movement, staff)) slots.set(id, slot);
  }
  let moved = 0; let unlinked = 0;
  for (const event of lyricEventsOf(lyricsStaff)) {
    if (!event.target) continue;
    const slot = slots.get(event.target);
    if (!slot) { setLyricEventTarget(doc, event.item, null); unlinked += 1; continue; }
    if (slot.measure !== event.measure || !fEq(slot.position, event.position)) { moveLyricEvent(doc, movement, lyricsStaff, event, slot); moved += 1; }
  }
  return { moved, unlinked };
}
