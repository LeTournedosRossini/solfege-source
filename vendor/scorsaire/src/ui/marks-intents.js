/*
 * Placing marks on chords (NO DOM): articulations, dynamics, hairpins and slurs. The model, layout and playback already existed; this is the
 * missing editing gesture (context bar + drawer). Pure functions on the Document, called inside `app.edit(...)`.
 *
 * Targets: the chords of the selection (a note selects its chord) or of a range. Rules:
 *  - articulation: toggle. Present on every target chord -> removed from all, otherwise added where missing.
 *  - dynamic: one per chord (`PID.DYNAMIC`). The same value already on every target -> cleared, otherwise set.
 *  - hairpin / slur: span a chord order of ONE staff and ONE voice. One chord selected -> up to the next chord of its voice;
 *    several -> first to last. The same span already present -> removed (same hairpin type) or retyped (other hairpin type).
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { createArticulation, createHairpin, createSlur, createHopo, createTechLine, createChordLine, TECH_LINE_TYPES, GRACE_TYPES } from '../model/elements.js';
import { resolveStaves, rangeItems } from '../model/range.js';
import { DYNAMIC_TYPES } from '../model/dynamics.js';
import { ownerOf } from './play-intents.js';

/** Articulation signs offered by the drawer, in display order. */
export const ARTICULATION_CHOICES = Object.freeze([
  'staccato', 'tenuto', 'accent', 'marcato', 'staccatissimo', 'portato', 'tenutoAccent', 'accentStaccato',
  'fermata', 'mordent', 'mordentInverted', 'turn', 'turnInverted', 'trill',
]);
/** Guitar articulations (same list mechanism, shown in the guitar section of the drawer). */
export const GUITAR_ARTICULATIONS = Object.freeze(['golpe', 'golpeThumb', 'slap', 'pop', 'pickDown', 'pickUp']);
const ALL_ARTICULATIONS = new Set([...ARTICULATION_CHOICES, ...GUITAR_ARTICULATIONS]);
/** Guitar techniques over a range of chords (`PID.TECH_LINES`). */
export const TECH_LINE_CHOICES = Object.freeze([...TECH_LINE_TYPES]);
/** Guitar techniques carried by ONE chord (a property of the chord): key → { pid, value }. */
export const CHORD_PROP_CHOICES = Object.freeze({
  'tapping-left': { pid: PID.TAPPING, value: { hand: 'left' } },
  'tapping-right': { pid: PID.TAPPING, value: { hand: 'right' } },
  'arpeggio-normal': { pid: PID.ARPEGGIO, value: { type: 'normal' } },
  'arpeggio-up': { pid: PID.ARPEGGIO, value: { type: 'up' } },
  'arpeggio-down': { pid: PID.ARPEGGIO, value: { type: 'down' } },
  'arpeggio-bracket': { pid: PID.ARPEGGIO, value: { type: 'bracket' } },
  'slide-fall': { pid: PID.CHORD_LINE, value: createChordLine('fall') },
  'slide-doit': { pid: PID.CHORD_LINE, value: createChordLine('doit') },
  'slide-plop': { pid: PID.CHORD_LINE, value: createChordLine('plop') },
  'slide-scoop': { pid: PID.CHORD_LINE, value: createChordLine('scoop') },
});
/** Note flags (muted / ghost / harmonic): properties of the NOTES of the target chords. */
export const NOTE_FLAG_CHOICES = Object.freeze({ muted: PID.MUTED, ghost: PID.GHOST, harmonic: PID.HARMONIC });

/** Dynamics offered first; the drawer can reveal the rest of `DYNAMIC_TYPES`. */
export const COMMON_DYNAMICS = Object.freeze(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp']);
export const ALL_DYNAMICS = Object.freeze(DYNAMIC_TYPES.filter((t) => t !== 'other'));

/** Hairpin kinds and the slur, as spanner kinds of this module. */
export const SPANNER_KINDS = Object.freeze(['cresc', 'decresc', 'slur', 'hopo']);

const NOTE_TYPES = new Set(['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);

/** Chord elements aimed at by the selection (`ids`) or the range, without duplicates. */
export function markTargets(doc, { ids = [], range = null } = {}) {
  const out = new Map();
  if (range) {
    const mv = doc.movementOf(doc.find(range.from.measureId));
    const staves = (resolveStaves(mv, range.staffIds) ?? []).map((s) => s.id);
    for (const e of rangeItems(mv, { ...range, staffIds: staves })) if (e.item.type === 'chord') out.set(e.item.id, e.item);
    return [...out.values()];
  }
  for (const id of ids) {
    const el = doc.find(id);
    if (!el) continue;
    const chord = el.type === 'chord' ? el : NOTE_TYPES.has(el.type) ? ownerOf(doc, id, 'chord') : null;
    if (chord) out.set(chord.id, chord);
  }
  return [...out.values()];
}

const articulationsOf = (chord) => getProperty(chord, PID.ARTICULATIONS) ?? [];

/** Which articulation types are on EVERY target chord (Set) and which are on at least one (Set). */
export function articulationState(chords) {
  const all = new Set();
  const some = new Set();
  chords.forEach((c, i) => {
    const here = new Set(articulationsOf(c).map((a) => a.type));
    here.forEach((t) => some.add(t));
    if (i === 0) here.forEach((t) => all.add(t));
    else for (const t of [...all]) if (!here.has(t)) all.delete(t);
  });
  return { all, some };
}

/** Toggle one articulation on the target chords (call inside a transaction). Returns the number of chords changed. */
export function toggleArticulation(doc, chords, type) {
  if (!chords.length || !ALL_ARTICULATIONS.has(type)) return 0;
  const remove = articulationState(chords).all.has(type);
  let n = 0;
  for (const chord of chords) {
    const list = articulationsOf(chord);
    if (remove) {
      const next = list.filter((a) => a.type !== type);
      if (next.length === list.length) continue;
      if (next.length) doc.set(chord, PID.ARTICULATIONS, next); else doc.reset(chord, PID.ARTICULATIONS);
    } else {
      if (list.some((a) => a.type === type)) continue;
      doc.set(chord, PID.ARTICULATIONS, [...list, createArticulation(type)]);
    }
    n++;
  }
  return n;
}

/** The dynamic shared by all targets (string), `null` when none or mixed. */
export function dynamicState(chords) {
  if (!chords.length) return null;
  const first = getProperty(chords[0], PID.DYNAMIC) ?? null;
  return chords.every((c) => (getProperty(c, PID.DYNAMIC) ?? null) === first) ? first : null;
}

/** Set a dynamic on every target chord; the value already shared by all clears it; `null` clears. Returns the number changed. */
export function setDynamic(doc, chords, type) {
  if (!chords.length) return 0;
  if (type !== null && !ALL_DYNAMICS.includes(type)) return 0;
  const clear = type === null || dynamicState(chords) === type;
  let n = 0;
  for (const chord of chords) {
    const has = getProperty(chord, PID.DYNAMIC) ?? null;
    if (clear) {
      if (has === null) continue;
      doc.reset(chord, PID.DYNAMIC);
      if (chord.props?.[PID.DYNAMIC_TEXT] !== undefined) doc.reset(chord, PID.DYNAMIC_TEXT);
    } else {
      if (has === type) continue;
      doc.set(chord, PID.DYNAMIC, type);
    }
    n++;
  }
  return n;
}

/** Chord ids of a voice, in playing order (rests ignored). */
function voiceChords(voice) {
  const out = [];
  for (const m of voice.measures ?? []) for (const it of m.items) if (it.type === 'chord') out.push(it.id);
  return out;
}

/**
 * Span for a spanner: `{ staff, startId, endId }` or null (several staves / voices, no next chord).
 */
export function spannerSpan(doc, chords, kind = 'slur') {
  if (!chords.length) return null;
  // ONE ornament (grace note) selected: a slur / hammer-on between it and its main chord — from a "before" ornament to the chord, from the
  // chord to an "after" ornament
  if (chords.length === 1 && (kind === 'slur' || kind === 'hopo')) {
    const parent = doc.parentOf(chords[0].id);
    const main = parent && (parent.el ?? parent);
    const isGrace = main?.type === 'chord' && (main.graceNotes ?? []).some((g) => g.id === chords[0].id);
    if (isGrace) {
      const staff = ownerOf(doc, main.id, 'staff');
      if (!staff) return null;
      const after = GRACE_TYPES[getProperty(chords[0], PID.GRACE_TYPE)]?.after === true;
      return { staff, startId: after ? main.id : chords[0].id, endId: after ? chords[0].id : main.id };
    }
  }
  const staff = ownerOf(doc, chords[0].id, 'staff');
  if (!staff || chords.some((c) => ownerOf(doc, c.id, 'staff')?.id !== staff.id)) return null;
  const voice = (staff.voices ?? []).find((v) => voiceChords(v).includes(chords[0].id));
  if (!voice) return null;
  const order = voiceChords(voice);
  const idx = chords.map((c) => order.indexOf(c.id));
  if (idx.some((i) => i < 0)) return null;
  const lo = Math.min(...idx);
  let hi = Math.max(...idx);
  if (lo === hi) hi = lo + 1;
  if (hi >= order.length) return null;
  return { staff, startId: order[lo], endId: order[hi] };
}

const SPANNER_PID = { cresc: PID.HAIRPINS, decresc: PID.HAIRPINS, slur: PID.SLURS, hopo: PID.HOPOS };

/** State of a span for the buttons: 'present' (same kind on exactly this span), 'other' (other hairpin type), 'none', or null when impossible. */
export function spannerState(doc, chords, kind) {
  const span = spannerSpan(doc, chords, kind);
  if (!span) return null;
  const list = getProperty(span.staff, SPANNER_PID[kind]) ?? [];
  const hit = list.find((e) => e.startChordId === span.startId && e.endChordId === span.endId);
  if (!hit) return 'none';
  if (kind === 'slur' || kind === 'hopo') return 'present';
  return hit.hairpinType === kind ? 'present' : 'other';
}

/** Add, remove or retype a hairpin / slur over the target chords (call inside a transaction). Returns true when something changed. */
export function toggleSpanner(doc, chords, kind) {
  if (!SPANNER_KINDS.includes(kind)) return false;
  const span = spannerSpan(doc, chords, kind);
  if (!span) return false;
  const pid = SPANNER_PID[kind];
  const list = getProperty(span.staff, pid) ?? [];
  const hit = list.find((e) => e.startChordId === span.startId && e.endChordId === span.endId);
  if (!hit) {
    const entry = kind === 'slur' ? createSlur(span.startId, span.endId) : kind === 'hopo' ? createHopo(span.startId, span.endId) : createHairpin(span.startId, span.endId, kind);
    doc.set(span.staff, pid, [...list, entry]);
  } else if (kind !== 'slur' && kind !== 'hopo' && hit.hairpinType !== kind) {
    doc.set(span.staff, pid, list.map((e) => (e === hit ? { ...e, hairpinType: kind } : e)));
  } else {
    doc.set(span.staff, pid, list.filter((e) => e !== hit));
  }
  return true;
}

/** Retype an existing hairpin entry (selected by its list-entry id). Returns true when changed. */
export function setHairpinType(doc, entryId, kind) {
  if (kind !== 'cresc' && kind !== 'decresc') return false;
  const found = doc.findListEntry(entryId);
  if (!found || found.kind !== 'hairpin' || found.entry.hairpinType === kind) return false;
  const list = getProperty(found.owner, found.pid) ?? [];
  doc.set(found.owner, found.pid, list.map((e) => (e.id === entryId ? { ...e, hairpinType: kind } : e)));
  return true;
}

/** State of a guitar technique line over the span: 'present' | 'none' | null (no span possible). */
export function techLineState(doc, chords, type) {
  const span = spannerSpan(doc, chords);
  if (!span) return null;
  const list = getProperty(span.staff, PID.TECH_LINES) ?? [];
  return list.some((e) => e.type === type && e.startChordId === span.startId && e.endChordId === span.endId) ? 'present' : 'none';
}

/** Add or remove a guitar technique line (palm mute, let ring, harmonic mark, whammy bar, vibrato) over the target chords. */
export function toggleTechLine(doc, chords, type) {
  if (!TECH_LINE_CHOICES.includes(type)) return false;
  const span = spannerSpan(doc, chords);
  if (!span) return false;
  const list = getProperty(span.staff, PID.TECH_LINES) ?? [];
  const hit = list.find((e) => e.type === type && e.startChordId === span.startId && e.endChordId === span.endId);
  doc.set(span.staff, PID.TECH_LINES, hit ? list.filter((e) => e !== hit) : [...list, createTechLine(type, span.startId, span.endId)]);
  return true;
}

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The sign of an arpeggio is the same sign whatever step it was given (`stepMs` is a playing detail, see `stepArpeggio`). */
const sameChoice = (pid, a, b) => (pid === PID.ARPEGGIO ? (a?.type ?? null) === (b?.type ?? null) : sameValue(a, b));

/** Chord-property techniques present on EVERY target chord (Set of `CHORD_PROP_CHOICES` keys). */
export function chordPropState(chords) {
  const out = new Set();
  if (!chords.length) return out;
  for (const [key, { pid, value }] of Object.entries(CHORD_PROP_CHOICES)) {
    if (chords.every((c) => sameChoice(pid, getProperty(c, pid), value))) out.add(key);
  }
  return out;
}

/** Toggle a chord-property technique (tapping, arpeggio, slide) on the target chords. Returns the number of chords changed. */
export function toggleChordProp(doc, chords, key) {
  const choice = CHORD_PROP_CHOICES[key];
  if (!choice || !chords.length) return 0;
  const remove = chords.every((c) => sameChoice(choice.pid, getProperty(c, choice.pid), choice.value));
  let n = 0;
  for (const chord of chords) {
    if (remove) doc.reset(chord, choice.pid);
    else {
      const value = structuredClone(choice.value);
      const kept = choice.pid === PID.ARPEGGIO ? getProperty(chord, PID.ARPEGGIO)?.stepMs : undefined; // another kind of arpeggio keeps the step given to the chord
      if (kept) value.stepMs = kept;
      doc.set(chord, choice.pid, value);
    }
    n++;
  }
  return n;
}

const guitarNotes = (chords) => chords.flatMap((c) => c.notes ?? []).filter((n) => n.type === 'note' || n.type === 'tabnote');

/** Note flags (muted / ghost / harmonic) set on EVERY note of the target chords. */
export function noteFlagState(chords) {
  const notes = guitarNotes(chords);
  const out = new Set();
  if (!notes.length) return out;
  for (const [flag, pid] of Object.entries(NOTE_FLAG_CHOICES)) if (notes.every((n) => getProperty(n, pid) === true)) out.add(flag);
  return out;
}

/** Toggle a note flag on all the notes of the target chords. Returns the number of notes changed. */
export function toggleNoteFlag(doc, chords, flag) {
  const pid = NOTE_FLAG_CHOICES[flag];
  const notes = guitarNotes(chords);
  if (!pid || !notes.length) return 0;
  const remove = noteFlagState(chords).has(flag);
  for (const n of notes) {
    if (remove) doc.reset(n, pid); else doc.set(n, pid, true);
    // a harmonic shows its number between angle brackets "<12>" in tablature: that is `PID.DISPLAY_FRET` 'natural' (MuseScore: the
    // harmonic fret display). Set with the flag, cleared with it, never over a choice the user made ('artificial', 'hide').
    if (flag === 'harmonic' && n.type === 'tabnote') {
      const shown = getProperty(n, PID.DISPLAY_FRET);
      if (remove) { if (shown === 'natural') doc.reset(n, PID.DISPLAY_FRET); } else if (shown === 'none' || shown === undefined) doc.set(n, PID.DISPLAY_FRET, 'natural');
    }
  }
  return notes.length;
}

/** True for an ornament (grace chord): it is listed in the `graceNotes` of its main chord. */
export function isGraceChord(doc, chord) {
  const parent = doc.parentOf(chord.id);
  const main = parent && (parent.el ?? parent);
  return main?.type === 'chord' && (main.graceNotes ?? []).some((g) => g.id === chord.id);
}

export const ARPEGGIO_STEP_MIN = 5; export const ARPEGGIO_STEP_MAX = 250; export const ARPEGGIO_STEP_BY = 10;
/** True when at least one of the chords carries an arpeggio sign. */
export const hasArpeggio = (chords) => chords.some((c) => getProperty(c, PID.ARPEGGIO));
/**
 * The step of the arpeggio signs of the chords made `direction` × 10 ms longer (+1) or shorter (−1), starting from `inherited` (the track or movement value; 30 ms when that one is automatic) for a
 * chord that has none of its own. Going under 5 ms gives the chord back to the track / movement value. Returns the number of chords changed.
 */
export function stepArpeggio(doc, chords, direction, inherited = 0) {
  let n = 0;
  for (const chord of chords) {
    const arp = getProperty(chord, PID.ARPEGGIO); if (!arp) continue;
    const base = arp.stepMs ?? (inherited > 0 ? inherited : 30);
    const next = base + direction * ARPEGGIO_STEP_BY;
    const value = { ...arp };
    if (next < ARPEGGIO_STEP_MIN) delete value.stepMs; else value.stepMs = Math.min(ARPEGGIO_STEP_MAX, next);
    doc.set(chord, PID.ARPEGGIO, value); n++;
  }
  return n;
}
