/*
 * Which measures of a movement did a set of Document changes touch? (input of the incremental layout, layout/index.js)
 *
 * A change is "local" when it writes inside ONE measure of the movement: the items of the measure, or one of their descendants (chord, note, rest,
 * chord symbol, tuplet…). Everything else — a style, the masterbar (key, time signature, bars), a staff or a track (type, clef, lists of ties,
 * slurs, hairpins…), the work (lyrics, chord qualities), a voice added or removed, a measure added or removed — can change what many measures look
 * like, so it is reported as `all`: the layout is then recomputed in full (always correct, only slower). The rule is deliberately conservative.
 *
 * `changes` are the `info` records of the Document events: { kind: 'property', id, pid } | { kind: 'style', id, sid } | { kind: 'structure', id, parentId, key }.
 * Pure: reads the document only through `find` / `parentOf` / `movementOf`.
 */

import { PID } from './pid.js';

/**
 * Staff lists of RANGE marks that neither the entries of a measure nor its columns depend on (they only shape what is drawn on top of the music): a change
 * to one of them re-draws, it does not re-space. Reported as `paintAll`.
 */
const PAINT_ONLY_LISTS = new Set([PID.SLURS, PID.HAIRPINS, PID.PEDALS, PID.TECH_LINES, PID.HOPOS]); // (not TRILLS: the cue note of an ornament, drawn with the chord, reads them)

/**
 * Properties of a PART (screen 2) that neither the entries, the columns nor the painting of a measure depend on: breaks, fixed systems, picked-element overrides,
 * text styles, the gaps between staves, the header, footer, title block and the numbering. They are applied after the measures are painted (the breaking into systems,
 * the pagination, the page furniture), so a change only needs those steps again.
 */
const PART_AFTER_PAINT = new Set([PID.PART_BREAKS, PID.PART_LOCKS, PID.PART_OVERRIDES, PID.PART_TEXT_STYLES, PID.PART_STAFF_GAP, PID.PART_STAFF_GAPS, PID.PART_HEADER, PID.PART_FOOTER, PID.PART_TITLE, PID.PART_MEASURE_NUMBERS]);

/** Playback-only properties (mixer): nothing drawn depends on them. */
const MIXER_PIDS = new Set([PID.MIXER_VOLUME, PID.MIXER_PAN, PID.MUTE, PID.MASTER_VOLUME, PID.MASTER_PAN, PID.SF_PRESET, PID.MIDI_DYNAMICS, PID.COMPRESSOR, PID.EQUALIZER, PID.LESLIE]);

/** Types of element that live INSIDE a measure (below `measure.items`). */
const MEASURE_LOCAL_TYPES = new Set(['chord', 'note', 'tabnote', 'percnote', 'rhythmnote', 'accnote', 'rest', 'chordsymbol', 'chordSymbol', 'lyricevent']);

/** Index (in the movement) of the measure that contains element `id`, or -1 when it is not inside a measure of `movement`. */
function measureIndexOf(doc, movement, id) {
  let el = doc.find(id);
  let guard = 0;
  while (el && guard++ < 50) {
    if (el.type === 'measure') {
      const voice = doc.parentOf(el.id);
      return voice ? voice.measures.indexOf(el) : -1;
    }
    el = doc.parentOf(el.id);
  }
  return -1;
}

/** Indices of the measures that hold an end of a tie that is in only one of the two lists (a note that is gone is skipped: its own removal marks its measure), or null when unsure. */
function tieMeasures(doc, movement, before = [], after = []) {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const key = (t) => JSON.stringify(t);
  const inBefore = new Set(before.map(key)); const inAfter = new Set(after.map(key));
  const out = new Set();
  for (const t of [...before.filter((x) => !inAfter.has(key(x))), ...after.filter((x) => !inBefore.has(key(x)))]) {
    for (const id of [t.startNoteId, t.endNoteId]) {
      if (!id || !doc.find(id)) continue;
      const mi = measureIndexOf(doc, movement, id);
      if (mi < 0) return null;
      out.add(mi);
    }
  }
  return out;
}

/**
 * @returns {{ all: boolean, measures: Set<number>, paintAll: boolean }} `all` true = recompute everything; else the set of measure indices to recompute, and
 *          `paintAll` when a range mark (slur, hairpin, pedal…) changed: what is drawn must be recomputed everywhere, the spacing need not
 *          (changes of other movements are ignored: they cannot affect this one).
 */
export function describeChanges(doc, movement, changes) {
  const measures = new Set();
  let paintAll = false;
  let staffSet = false; // the SET of shown staves changed (a staff or a track hidden / shown, the staves of a part): the entries and the painting of each staff survive, the columns do not
  const ALL = { all: true, measures, paintAll: true, staffSet: true };
  for (const c of changes ?? []) {
    if (!c) return ALL;
    if (c.kind === 'style') return ALL;
    // the element that was written, and (for a structure change) the parent that gained or lost a child
    const id = c.kind === 'structure' ? c.parentId : c.id;
    const el = id ? doc.find(id) : null;
    if (!el) return ALL;
    if (c.kind === 'property' && MIXER_PIDS.has(c.pid)) continue;
    if (c.kind === 'property' && c.pid === PID.AUTOMATION) { paintAll = true; continue; } // only the automation strip (screen) is drawn from it
    // the zones of a part (containers between its systems) are built after the measures are painted
    if (el.type === 'part' && c.kind === 'structure') continue;
    if (el.type === 'staffContainer' && doc.parentOf(id)?.type === 'part') continue;
    const mv = doc.movementOf(el);
    // another movement of the work: cannot affect this one. But a FRAGMENT (a short score inside a container of this movement) is a `movement` too, and it does
    if (mv && mv !== movement) { if (doc.work.movements.includes(mv)) continue; return ALL; }
    if (c.kind === 'property') {
      if (el.type === 'part' && PART_AFTER_PAINT.has(c.pid)) continue;
      if (el.type === 'movement' && c.pid === PID.VIEWS) continue; // a view is only a saved choice of shown staves
      if (el.type === 'part' && c.pid === PID.PART_STAVES) { staffSet = true; continue; }
      if ((el.type === 'staff' || el.type === 'track') && c.pid === PID.VISIBLE) { staffSet = true; continue; }
      // the ties of a staff: only the measures that hold an end of a tie that was added, removed or changed (their entries show the tie: no accidental on a tied note…)
      if (el.type === 'staff' && c.pid === PID.TIES && 'before' in c) {
        const touched = tieMeasures(doc, movement, c.before, c.after);
        if (!touched) return ALL;
        for (const mi of touched) measures.add(mi);
        continue;
      }
      // the list of range marks of a staff: re-draw only
      if (el.type === 'staff' && PAINT_ONLY_LISTS.has(c.pid)) { paintAll = true; continue; }
      // only a property of an element INSIDE a measure is local
      if (!MEASURE_LOCAL_TYPES.has(el.type)) return ALL;
    } else if (c.kind === 'structure') {
      // a child added to / removed from a measure's items, or a note added to / removed from a chord
      if (!(el.type === 'measure' && c.key === 'items') && !(el.type === 'chord' && c.key === 'notes')) return ALL;
    } else return ALL;
    const mi = measureIndexOf(doc, movement, id);
    if (mi < 0) return ALL;
    measures.add(mi);
  }
  return { all: false, measures, paintAll, staffSet };
}

/** Merges two descriptions (changes accumulated between two layouts). */
export function mergeDirty(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.all || b.all) return { all: true, measures: new Set(), paintAll: true, staffSet: true };
  return { all: false, measures: new Set([...a.measures, ...b.measures]), paintAll: a.paintAll || b.paintAll, staffSet: Boolean(a.staffSet || b.staffSet) };
}

/**
 * The MEASURE ELEMENTS a set of changes wrote inside, or null when something else was written (a style, a masterbar, a staff or its lists, a voice or
 * a measure added or removed, an element of a fragment…): the caller must then check everything. Used by the validation of a transaction, which
 * only needs to look at the measures that were written.
 */
export function touchedMeasures(doc, changes) {
  const out = new Set();
  for (const c of changes ?? []) {
    if (!c || c.kind === 'style') return null;
    const id = c.kind === 'structure' ? c.parentId : c.id;
    const el = id ? doc.find(id) : null;
    if (!el) return null;
    const mv = doc.movementOf(el);
    if (!mv || !doc.work.movements.includes(mv)) return null; // a fragment (or nothing): check everything
    if (c.kind === 'property') { if (!MEASURE_LOCAL_TYPES.has(el.type)) return null; }
    else if (c.kind === 'structure') { if (!(el.type === 'measure' && c.key === 'items') && !(el.type === 'chord' && c.key === 'notes')) return null; }
    else return null;
    let cur = el; let guard = 0;
    while (cur && cur.type !== 'measure' && guard++ < 50) cur = doc.parentOf(cur.id);
    if (!cur || cur.type !== 'measure') return null;
    out.add(cur);
  }
  return out;
}
