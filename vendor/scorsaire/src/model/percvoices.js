/*
 * Voices of a percussion staff. The map says which voice each sound belongs to (`voice`: 0 = voice 1, 1 = voice 2…, with the stem direction that
 * goes with it); a note typed in the editor already goes there. Notes that came from elsewhere (a Guitar Pro import, a map that was changed) stay
 * in the voice they were in: `reassignPercussionVoices` moves them to the voice of their sound. To be called INSIDE a transaction.
 *
 * Per measure: every chord is split by the voice its sounds belong to; the part that stays keeps its element (and its identity), the part that
 * leaves becomes a new chord of the same written duration at the same instant in the target voice (merged into the chord that is already there
 * when it has the same span). A measure with a tuplet is left alone, and so is a chord whose target voice is busy with something that overlaps it
 * without being the same span: both are counted. Rests are recomputed by the edit (voice 1 stays full, the other voices are empty where there is nothing).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { fEq, fLt } from './fraction.js';
import { measureLengthOf } from './timing.js';
import { measureTimeline, cloneChord, ensureVoice, replaceVoiceMeasure, MAX_VOICES } from './noteedit.js';
import { drumSound, percmapPreset, DEFAULT_PERCMAP } from './percmap.js';
import { staffPercMap, replacePercMap } from './percmapedit.js';
import { walk } from './store.js';

const isChord = (item) => item.type === 'chord';
const spanKey = (u) => `${u.start[0]}/${u.start[1]}|${u.end[0]}/${u.end[1]}`;
const overlaps = (a, b) => fLt(a.start, b.end) && fLt(b.start, a.end);

/** The voice index of a sound in the staff's map, or `fallback` when the map does not say. */
function targetVoice(map, soundId, fallback) {
  const v = drumSound(map, soundId)?.voice;
  return Number.isInteger(v) && v >= 0 && v < MAX_VOICES ? v : fallback;
}

/** Number of notes that are not in the voice their sound belongs to (read only): lets the interface know whether a reassignment would do something. */
export function misplacedPercussionNotes(staff) {
  const map = staffPercMap(staff);
  let count = 0;
  staff.voices.forEach((voice, vi) => {
    for (const measure of voice.measures) for (const item of measure.items) {
      if (!isChord(item)) continue;
      for (const n of item.notes) if (targetVoice(map, n.props[PID.SOUND], vi) !== vi) count += 1;
    }
  });
  return count;
}

/**
 * Moves every note of the staff to the voice of its sound. Returns `{ moved, skipped }`: notes moved, and notes left where they were
 * (tuplet measure, or a busy target voice).
 */
export function reassignPercussionVoices(doc, staff) {
  const movement = doc.movementOf(staff);
  const map = staffPercMap(staff);
  let moved = 0; let skipped = 0;
  for (let mi = 0; mi < movement.masterbars.length; mi++) {
    const length = measureLengthOf(movement.masterbars[mi]);
    const lines = staff.voices.map((voice) => measureTimeline(voice.measures[mi], length));
    // what has to move in this measure: [{ unit, voice (current), to, notes }]
    const plan = [];
    let tuplet = false;
    lines.forEach((line, vi) => {
      for (const u of line) {
        if (!isChord(u.item)) continue;
        if (u.item.props[PID.TUPLET]) tuplet = true;
        const away = u.item.notes.filter((n) => targetVoice(map, n.props[PID.SOUND], vi) !== vi);
        if (away.length) plan.push({ unit: u, voice: vi, away });
      }
    });
    if (!plan.length) continue;
    if (tuplet) { skipped += plan.reduce((n, p) => n + p.away.length, 0); continue; }

    // occupants of every voice after the move: existing items (kept) and new chords
    const occupants = lines.map((line) => line.filter((u) => u.item.type === 'chord' || (u.item.type === 'rest' && getProperty(u.item, PID.EXPLICIT) === true)).map((u) => ({ el: u.item, start: u.start, end: u.end })));
    const touched = new Set();
    const removals = []; // [note] to take out of the chord they leave
    const fresh = []; // [{ voice, el, start, end }]
    for (const p of plan) {
      // group the leaving notes by target voice
      const byTarget = new Map();
      for (const n of p.away) { const t = targetVoice(map, n.props[PID.SOUND], p.voice); if (!byTarget.has(t)) byTarget.set(t, []); byTarget.get(t).push(n); }
      for (const [t, notes] of byTarget) {
        ensureVoice(doc, staff, t);
        while (occupants.length <= t) occupants.push([]);
        const busy = occupants[t].find((o) => overlaps(o, p.unit));
        if (busy && !(fEq(busy.start, p.unit.start) && fEq(busy.end, p.unit.end) && isChord(busy.el))) { skipped += notes.length; continue; }
        const dur = getProperty(p.unit.item, PID.DURATION);
        // the map's stem direction for the sound applies again (an imported chord carries a forced one)
        const copy = cloneChord(p.unit.item, dur, { only: new Set(notes.map((n) => p.unit.item.notes.indexOf(n))), omit: [PID.STEM_DIRECTION] });
        if (busy) fresh.push({ merge: busy.el, notes: copy.notes });
        else { const o = { el: copy, start: p.unit.start, end: p.unit.end }; occupants[t].push(o); fresh.push({ voice: t, ...o }); }
        removals.push(...notes);
        moved += notes.length;
        touched.add(t);
      }
      touched.add(p.voice);
    }
    // the chords that lose ALL their notes leave their voice
    for (const p of plan) {
      const gone = p.unit.item.notes.filter((n) => removals.includes(n));
      if (gone.length === p.unit.item.notes.length) {
        const list = occupants[p.voice];
        const at = list.findIndex((o) => o.el === p.unit.item);
        if (at >= 0) list.splice(at, 1);
      }
    }
    for (const f of fresh) if (f.merge) for (const n of f.notes) doc.add(f.merge, 'notes', n);
    for (const n of removals) {
      const chord = doc.parentOf(n.id);
      if (chord.notes.length > 1) doc.remove(n);
    }
    for (const vi of touched) {
      occupants[vi].sort((a, b) => (fLt(a.start, b.start) ? -1 : fLt(b.start, a.start) ? 1 : 0));
      replaceVoiceMeasure(doc, { staff, voice: vi, measure: mi, occupants: occupants[vi] });
    }
  }
  return { moved, skipped };
}

const percussionStaves = (work) => { const out = []; walk(work, (el) => { if (el.type === 'staff' && el.props?.[PID.STAFF_TYPE] === 'percussion') out.push(el); }); return out; };

/** The percussion staves of a work that do not use the Scorsaire drum map (a Guitar Pro import has its own): what the import offers to convert. */
export const foreignDrumStaves = (work) => percussionStaves(work).filter((st) => staffPercMap(st).name !== DEFAULT_PERCMAP.name);

/**
 * Gives these staves the Scorsaire drum map (notes follow by MIDI number) and the voices that go with it. Inside a transaction.
 * Returns { converted, failed } (a staff whose notes cannot all follow keeps its map).
 */
export function convertDrumsToScorsaire(doc, staves) {
  let converted = 0; let failed = 0;
  for (const st of staves) {
    try { replacePercMap(doc, st, percmapPreset('scorsaire-drum-kit').create(), { matchByMidi: true }); } catch { failed += 1; continue; }
    reassignPercussionVoices(doc, st);
    converted += 1;
  }
  return { converted, failed };
}
