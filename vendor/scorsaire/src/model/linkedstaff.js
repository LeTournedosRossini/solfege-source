/*
 * Linked staves (design validated with Jean, 18/10/2026; MuseScore 4.7.5 `Staff::linkedStaves`, `Excerpt::createLinkedTabs`, `Staff::isPrimaryStaff`).
 *
 * A LINKED staff stores no content: `PID.LINKED_TO` names its PRIMARY staff (same track, a notation staff), and the content of the linked staff is a
 * pure PROJECTION of the primary one, computed when it is read (`projectLinkedStaff`): same voices, measures, chords and notes with the SAME identifiers
 * (so ties, slurs, bends, selection… that name an element work on both staves), the notes converted to the type of the linked staff.
 *   notation → tablature  `note` becomes `tabnote`: pitch kept, string = the one hinted by `PID.TAB_STRING` on the note, else the automatic one
 *                         (`StringData::convertPitch` with the tuning and the capo of the LINKED staff, a second note of a chord takes the next free string)
 * Shared with the primary staff: the lists that name elements (ties, slurs, hairpins, glissandos, bends, hammer-ons, trills, technique lines, breaths,
 * two-chord tremolos, pedals, lyric links, staff texts). Own to each staff: type, tuning, capos, tablature style, visibility, hidden decor, offsets.
 * Only the primary staff is played (MuseScore: "the primary staff is the one that is played back").
 *
 * Pure functions, no DOM. Writing goes through the primary staff (`doc.transaction`), never through the projection.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { isApplicable } from './schema.js';
import { createElement, createStaff } from './elements.js';
import { defaultSpelling } from './pitch.js';
import { tuningPitches, staffTimeline, capoTimeline, capoAt, convertPitch, NO_CAPO, tuningChanges, tuningAt } from './capo.js';
import { maxFretOf, instrumentInfo } from './instruments.js';
import { newId } from './ids.js';
import { chordViewShifts } from './chordview.js';
import { shiftNote, shiftedFifths } from './chordshift.js';
import { EditError } from './noteedit.js';

/**
 * Types a linked staff can have, and types it can be linked to. Pairs (`canLink`): a notation or tablature staff can get a linked notation, tablature or rhythm
 * staff (the tablature holds MORE information than the notation: strings, frets), any other type (percussion, neutral, accordion) only a linked rhythm staff.
 */
export const LINKABLE = Object.freeze({ linked: ['tab', 'rhythm', 'score', 'chord'], primary: ['score', 'tab', 'percussion', 'neutral', 'accordion-left', 'chord'] });
/** Linking two EXISTING staves (`linkStaff`, the old pairs of the Guitar Pro import) stays limited to a free tablature / rhythm staff and a notation staff. */
const LINK_EXISTING = Object.freeze({ linked: ['tab', 'rhythm'], primary: ['score'] });

/** The types of linked staff a primary staff of type `primaryType` can have. */
export function linkTypesFor(primaryType) {
  if (primaryType === 'chord') return ['chord']; // a second, read-only display of the chord staff (capo shapes, a shift…)
  if (primaryType === 'score' || primaryType === 'tab') return ['score', 'tab', 'rhythm'];
  return LINKABLE.primary.includes(primaryType) ? ['rhythm'] : [];
}
export const canLink = (primaryType, linkedType) => linkTypesFor(primaryType).includes(linkedType);

/** Lists of the primary staff that the linked staff shares (they name elements by identifier, and the projection keeps the identifiers). */
export const SHARED_LISTS = Object.freeze([
  PID.TIES, PID.SLURS, PID.HAIRPINS, PID.GLISSANDOS, PID.BENDS, PID.HOPOS, PID.TRILLS, PID.TECH_LINES, PID.BREATHS, PID.TREMOLOS, PID.PEDALS, PID.LYRIC_LINKS, PID.STAFF_TEXTS,
]);

/**
 * Lists a linked staff of the given type shares. A rhythm staff keeps only the rhythm (one slash per chord, no ornament, no pitch): what names notes other than the
 * first of a chord (bends, glissandos, hammer-ons…) or has no meaning without pitch is not shared.
 */
export const sharedListsFor = (type) => (type === 'chord' ? [] : type === 'rhythm'
  ? [PID.TIES, PID.SLURS, PID.HAIRPINS, PID.BREATHS, PID.TREMOLOS, PID.STAFF_TEXTS]
  : SHARED_LISTS);

export const isLinkedStaff = (staff) => Boolean(getProperty(staff, PID.LINKED_TO));

/** The primary staff of a linked staff (null when absent or itself linked). */
export function primaryOf(mv, staff) {
  const id = getProperty(staff, PID.LINKED_TO);
  if (!id) return null;
  for (const t of mv.tracks) for (const s of t.staves) if (s.id === id) return isLinkedStaff(s) ? null : s;
  return null;
}

/** The staff that holds the content shown by `staff`: its primary staff when it is linked, else itself. */
export const contentStaff = (mv, staff) => primaryOf(mv, staff) ?? staff;

/** Staves of the movement that show the content of `primary`. */
export function linkedStavesOf(mv, primary) {
  const out = [];
  for (const t of mv.tracks) for (const s of t.staves) if (getProperty(s, PID.LINKED_TO) === primary.id) out.push(s);
  return out;
}

/** Problems of a linked staff (for `validate.js`): messages, [] when valid. `track` = the track that holds it. */
export function linkedStaffProblems(mv, track, staff) {
  const id = getProperty(staff, PID.LINKED_TO);
  if (!id) return [];
  const out = [];
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (!LINKABLE.linked.includes(type)) out.push(`portée ${staff.id} : une portée « ${type} » ne peut pas être liée`);
  const primary = track.staves.find((s) => s.id === id);
  if (!primary) out.push(`portée ${staff.id} : sa portée principale ${id} n'est pas dans la même piste`);
  else if (primary === staff) out.push(`portée ${staff.id} : liée à elle-même`);
  else if (isLinkedStaff(primary)) out.push(`portée ${staff.id} : sa portée principale ${id} est elle-même liée`);
  else if (!canLink(getProperty(primary, PID.STAFF_TYPE), type)) out.push(`portée ${staff.id} : une portée « ${type} » ne peut pas être liée à une portée « ${getProperty(primary, PID.STAFF_TYPE)} »`);
  if (staff.voices.length) out.push(`portée ${staff.id} : une portée liée ne porte aucune voix (son contenu est celui de sa portée principale)`);
  return out;
}

/** Automatic string of a note (`convertPitch`, avoiding the strings already taken). */
function assignString(pitch, tuning, capo, taken, maxFret) {
  let hit = convertPitch(pitch, tuning, capo, taken);
  if (hit && hit.fret > maxFret) hit = null;
  if (hit) return hit.string;
  // a pitch that does not fit: the free string whose open pitch is nearest
  const free = tuning.map((open, i) => ({ string: i + 1, d: Math.abs(pitch - open) })).filter((x) => !taken.includes(x.string));
  if (!free.length) return Math.min(tuning.length, taken.length ? Math.max(...taken) : 1);
  return free.reduce((a, b) => (b.d < a.d ? b : a)).string;
}

/**
 * A chord staff linked to a chord staff: the same symbols (same identifiers), READ another way: as played with the capo in force, as the author's display tags say, or shifted by a fixed
 * number of semitones. Only the display: the written chords and the sound are the primary staff's.
 */
function projectChordReading(mv, linked, primary) {
  const view = getProperty(linked, PID.CHORD_STAFF_VIEW) ?? 'capo';
  const fixed = Math.max(-11, Math.min(11, getProperty(linked, PID.CHORD_STAFF_SHIFT) ?? 0));
  const shifts = view === 'shift' ? mv.masterbars.map(() => fixed) : chordViewShifts(mv, primary, { view: view === 'author' ? 'author' : 'capo' });
  const key = getProperty(mv.masterbars[0], PID.KEY_SIG) ?? 0; // (the chord symbols are spelled for the key the piece starts in)
  const voices = primary.voices.map((voice) => createElement('voice', {
    id: voice.id, props: voice.props,
    children: {
      measures: voice.measures.map((measure, mi) => {
        const n = shifts[mi] ?? 0;
        return createElement('measure', {
          id: measure.id,
          children: {
            items: measure.items.map((item) => {
              if (!n || item.type !== 'chordsymbol') return item;
              const root = getProperty(item, PID.CHORD_ROOT); const bass = getProperty(item, PID.CHORD_BASS);
              if (!root && !bass) return item;
              const target = shiftedFifths(key, n);
              return createElement('chordsymbol', { id: item.id, props: { ...item.props, ...(root ? { [PID.CHORD_ROOT]: shiftNote(root, n, target) } : {}), ...(bass ? { [PID.CHORD_BASS]: shiftNote(bass, n, target) } : {}) } });
            }),
          },
        });
      }),
    },
  }));
  return createElement('staff', { id: linked.id, props: { ...linked.props }, children: { voices, containers: [...linked.containers] } });
}

/**
 * The content of a linked staff, as a staff element (same id as the linked staff) whose voices are the projection of the primary staff.
 * Cheap to throw away: build it where the content is read (layout context), never store it.
 */
export function projectLinkedStaff(mv, linked, primary = primaryOf(mv, linked), reuse = null) {
  if (!primary) return linked;
  if (getProperty(linked, PID.STAFF_TYPE) === 'chord' && getProperty(primary, PID.STAFF_TYPE) === 'chord') return projectChordReading(mv, linked, primary);
  const track = mv.tracks.find((t) => t.staves.includes(linked)) ?? null;
  const baseTuning = tuningPitches(linked);
  const maxFret = maxFretOf(track);
  // the timeline is only read to place capos and tuning changes written on the linked staff: without any, skip it (same result, no walk over every item)
  const timed = (getProperty(linked, PID.CAPOS) ?? []).length > 0 || (getProperty(linked, PID.STRING_TUNINGS) ?? []).length > 0;
  const timeline = timed ? staffTimeline(mv, primary) : [];
  const keyOf = new Map(timeline.map((t) => [t.item.id, t.key]));
  const capos = timed ? capoTimeline(mv, linked, timeline) : [];
  const tunes = timed ? tuningChanges(mv, linked, timeline) : [];
  const capoFor = (chord, host) => { if (!capos.length) return NO_CAPO; const key = keyOf.get((host ?? chord).id); return key ? capoAt(capos, key) : NO_CAPO; };
  // INCREMENTAL projection (layout/context.js): a measure that no change touched keeps the projected measure of the previous layout. Only when nothing on the
  // linked staff reaches across measures (a capo or a tuning change is anchored to a chord and applies to every later one).
  const prev = reuse && !timed && reuse.prev?.primaryId === primary.id ? reuse.prev.staff : null;

  const pType = getProperty(primary, PID.STAFF_TYPE);
  const type = getProperty(linked, PID.STAFF_TYPE);
  let fifths = 0; // key signature (concert) of the measure being projected: the spelling of a note made from a tablature note
  const projectNote = (note, string) => {
    if (note.type === 'tabnote' && pType === 'tab') { // tablature → tablature: the string is recomputed with the tuning and the capo of the LINKED staff
      return createElement('tabnote', { id: note.id, props: { ...note.props, [PID.STRING]: string } });
    }
    const props = {};
    for (const [pid, value] of Object.entries(note.props)) if (pid !== PID.SPELLING && pid !== PID.TAB_STRING && isApplicable('tabnote', pid)) props[pid] = value;
    props[PID.STRING] = string;
    return createElement('tabnote', { id: note.id, props });
  };
  const projectChord = (chord, host) => {
    const capo = capoFor(chord, host);
    const keyHere = tunes.length ? keyOf.get((host ?? chord).id) : null;
    const tuning = (keyHere && tuningAt(tunes, keyHere)) || baseTuning;
    const hintOf = (n) => { if (n.type === 'tabnote') return null; const h = getProperty(n, PID.TAB_STRING); return Number.isInteger(h) && h >= 1 && h <= tuning.length ? h : null; };
    // hinted strings are taken first, so that an automatic choice never takes the string another note asks for
    const used = chord.notes.map(hintOf).filter((h) => h !== null);
    const notes = chord.notes.map((n) => {
      if (type === 'score') { // tablature → notation: a plain note (pitch kept, spelling by the key signature)
        const props = {};
        for (const [pid, value] of Object.entries(n.props)) if (pid !== PID.STRING && isApplicable('note', pid)) props[pid] = value;
        props[PID.SPELLING] = defaultSpelling(getProperty(n, PID.PITCH), fifths);
        return createElement('note', { id: n.id, props });
      }
      if (n.type === 'tabnote' && pType !== 'tab') return n;
      let string = pType === 'tab' ? null : hintOf(n);
      if (string === null) { string = assignString(getProperty(n, PID.PITCH), tuning, capo, used, maxFret); used.push(string); }
      return projectNote(n, string);
    });
    return createElement('chord', { id: chord.id, props: chord.props, children: { notes, graceNotes: chord.graceNotes.map((g) => projectChord(g, chord)) } });
  };
  // rhythm: one note without pitch per chord (it takes the id of the first note), no ornament
  const rhythmChord = (chord) => createElement('chord', {
    id: chord.id, props: chord.props,
    children: { notes: [createElement('rhythmnote', { id: chord.notes[0].id, props: Object.fromEntries(Object.entries(chord.notes[0].props).filter(([pid]) => isApplicable('rhythmnote', pid))) })], graceNotes: [] },
  });
  const sameContent = type === 'score' && pType === 'score'; // notation → notation: the very same content (only the staff's own properties differ: clef, transposition…)
  const voices = sameContent ? primary.voices : primary.voices.map((voice, vi) => {
    const old = prev?.voices[vi];
    const same = old && old.id === voice.id && old.measures.length === voice.measures.length;
    return createElement('voice', {
      id: voice.id,
      props: voice.props,
      children: {
        measures: voice.measures.map((measure, mi) => {
          if (same && reuse.isClean(mi) && old.measures[mi].id === measure.id) return old.measures[mi];
          return createElement('measure', {
            id: measure.id,
            children: { items: measure.items.map((item) => { fifths = getProperty(mv.masterbars[mi], PID.KEY_SIG) ?? 0; return item.type !== 'chord' ? item : type === 'rhythm' ? rhythmChord(item) : projectChord(item, null); }) },
          });
        }),
      },
    });
  });
  const props = { ...linked.props };
  const firstNotes = new Set(primary.voices.flatMap((v) => v.measures.flatMap((m) => m.items.filter((i) => i.type === 'chord').map((i) => i.notes[0]?.id))));
  for (const pid of sharedListsFor(type)) {
    if (primary.props[pid] === undefined) continue;
    // a tie names notes: on a rhythm staff only the ties between the first notes of chords survive
    props[pid] = pid === PID.TIES && type === 'rhythm' ? primary.props[pid].filter((t) => firstNotes.has(t.startNoteId) && firstNotes.has(t.endNoteId)) : primary.props[pid];
  }
  return createElement('staff', { id: linked.id, props, children: { voices, containers: [...linked.containers] } });
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (p) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;

/**
 * Adds a linked tablature right after `primary` (a notation staff of `track`). Its tuning comes from the instrument of the track when the catalogue knows
 * its strings. CALL INSIDE `doc.transaction`.
 */
export function addLinkedStaff(doc, mv, primary, { props = {}, type = 'tab', clef = 'G', before = false } = {}) {
  if (!LINKABLE.linked.includes(type)) throw new Error(`A ${type} staff cannot be linked`);
  const track = mv.tracks.find((t) => t.staves.includes(primary));
  if (!track) throw new Error('Unknown staff');
  if (isLinkedStaff(primary) || !canLink(getProperty(primary, PID.STAFF_TYPE), type)) throw new Error(`A ${type} staff cannot be linked to that staff`);
  const own = { [PID.LINKED_TO]: primary.id, ...(type === 'chord' ? { [PID.CHORD_STAFF_VIEW]: 'capo' } : {}), ...props };
  const strings = type === 'tab' ? instrumentInfo(getProperty(track, PID.INSTRUMENT_ID))?.strings : null;
  if (strings?.length && own[PID.TUNING] === undefined) own[PID.TUNING] = [...strings].reverse().map(midiName);
  const staff = createStaff({ type, clef: type === 'score' ? clef : 'G', voices: [], props: own });
  doc.add(track, 'staves', staff, track.staves.indexOf(primary) + (before ? 0 : 1));
  return staff;
}

/** Strings the linked staff gives to the notes of a chord of its primary staff: Map(note id → string). */
export function projectedStrings(mv, linked, chordId) {
  const projected = projectLinkedStaff(mv, linked);
  const out = new Map();
  for (const voice of projected.voices) for (const measure of voice.measures) for (const item of measure.items) {
    if (item.id !== chordId || item.type !== 'chord') continue;
    for (const n of item.notes) out.set(n.id, getProperty(n, PID.STRING));
  }
  return out;
}

// ───────────────────────── link / unlink ─────────────────────────

/**
 * Staves of the track of `staff` that it could be linked to (the staff must be a free tablature or rhythm staff). A free tablature links to a notation staff only; a free RHYTHM
 * staff links to any staff that can have a linked rhythm staff (notation, tablature, percussion, neutral, accordion), even when its own rhythm differs: `planLink` counts what
 * would be replaced and `linkStaff` asks for `force`.
 */
export function linkCandidates(mv, staff) {
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (!LINK_EXISTING.linked.includes(type) || isLinkedStaff(staff) || linkedStavesOf(mv, staff).length) return [];
  const track = mv.tracks.find((t) => t.staves.includes(staff));
  const fits = (s) => (type === 'rhythm' ? canLink(getProperty(s, PID.STAFF_TYPE), 'rhythm') : LINK_EXISTING.primary.includes(getProperty(s, PID.STAFF_TYPE)));
  return track ? track.staves.filter((s) => s !== staff && !isLinkedStaff(s) && fits(s)) : [];
}

const sameDuration = (a, b) => JSON.stringify(getProperty(a, PID.DURATION)) === JSON.stringify(getProperty(b, PID.DURATION));

/**
 * What linking the tablature `tab` to the notation staff `primary` would do (read only). `same`: both staves hold the same rhythm and pitches, so nothing is
 * lost but the tablature's own copy; `mismatches`: how many chords, rests, notes or voices differ (they are replaced by the notation staff's content);
 * `hints`: the strings the tablature used, to be remembered on the notation notes; `chordMap`: tablature chord id → notation chord id (for the capos).
 */
export function planLink(mv, tab, primary) {
  const rhythmOnly = getProperty(tab, PID.STAFF_TYPE) === 'rhythm'; // a rhythm staff has no pitch to compare
  const hints = new Map(); const chordMap = new Map();
  let mismatches = 0;
  const voices = Math.max(primary.voices.length, tab.voices.length);
  for (let vi = 0; vi < voices; vi += 1) {
    const pv = primary.voices[vi]; const tv = tab.voices[vi];
    const count = Math.max(pv?.measures.length ?? 0, tv?.measures.length ?? 0);
    for (let mi = 0; mi < count; mi += 1) {
      const pi = pv?.measures[mi]?.items ?? []; const ti = tv?.measures[mi]?.items ?? [];
      if (pi.length !== ti.length) { mismatches += Math.max(pi.length, ti.length); continue; }
      pi.forEach((a, k) => {
        const b = ti[k];
        if (a.type !== b.type || !sameDuration(a, b)) { mismatches += 1; return; }
        if (a.type !== 'chord') return;
        chordMap.set(b.id, a.id);
        if (rhythmOnly) return;
        if (a.notes.length !== b.notes.length) { mismatches += 1; return; }
        const free = [...b.notes];
        for (const n of a.notes) {
          const i = free.findIndex((t) => getProperty(t, PID.PITCH) === getProperty(n, PID.PITCH));
          if (i < 0) { mismatches += 1; continue; }
          hints.set(n.id, getProperty(free[i], PID.STRING));
          free.splice(i, 1);
        }
      });
    }
  }
  return { same: mismatches === 0, mismatches, hints, chordMap, ownLists: sharedListsFor(getProperty(tab, PID.STAFF_TYPE)).reduce((n, pid) => n + (getProperty(tab, pid) ?? []).length, 0) };
}

/**
 * Links the tablature `tab` to the notation staff `primary`: the tablature stops storing anything and shows the notation staff (its own copy is dropped),
 * the notation notes remember the strings the tablature used. A muted notation staff (the old pairs of the Guitar Pro import) is unmuted, since it is now
 * the staff that plays. Refused when the content differs unless `force`. CALL INSIDE `doc.transaction`.
 */
export function linkStaff(doc, mv, tab, primary, { force = false } = {}) {
  if (!linkCandidates(mv, tab).includes(primary)) throw new EditError('This tablature cannot be linked to that staff');
  const plan = planLink(mv, tab, primary);
  if (!plan.same && !force) throw new EditError('The contents differ: the tablature would be replaced by the notation staff');
  for (const voice of primary.voices) for (const measure of voice.measures) for (const item of measure.items) {
    if (item.type !== 'chord') continue;
    for (const chord of [item, ...item.graceNotes]) {
      if (Object.hasOwn(chord.props, PID.PLAY) && chord.props[PID.PLAY] === false) doc.reset(chord, PID.PLAY);
      for (const n of chord.notes) {
        const hint = plan.hints.get(n.id);
        if (Number.isInteger(hint) && getProperty(n, PID.TAB_STRING) !== hint) doc.set(n, PID.TAB_STRING, hint);
        if (Object.hasOwn(n.props, PID.PLAY) && n.props[PID.PLAY] === false) doc.reset(n, PID.PLAY);
      }
    }
  }
  for (const pid of [PID.CAPOS, PID.STRING_TUNINGS]) {
    const list = getProperty(tab, pid) ?? [];
    if (!list.length) continue;
    const moved = list.map((e) => ({ ...e, itemId: plan.chordMap.get(e.itemId) })).filter((e) => e.itemId);
    if (moved.length) doc.set(tab, pid, moved); else doc.reset(tab, pid);
  }
  for (const voice of [...tab.voices]) doc.remove(voice);
  for (const pid of SHARED_LISTS) if (Object.hasOwn(tab.props, pid)) doc.reset(tab, pid); // (any list a free staff of either type may have kept)
  doc.set(tab, PID.LINKED_TO, primary.id);
  return plan;
}

const REFERENCE = /(Note|Chord)Id$|^afterId$/;

/**
 * Unlinks a staff: its projection becomes its own content (copied with NEW identifiers) and the lists it shared are copied with their references
 * remapped, so the two staves are independent from now on. Lyrics stay on the notation staff. CALL INSIDE `doc.transaction`.
 */
export function unlinkStaff(doc, mv, linked) {
  const primary = primaryOf(mv, linked);
  if (!primary) throw new EditError('This staff is not linked');
  const projected = projectLinkedStaff(mv, linked, primary);
  const idMap = new Map();
  let tuplets = new Map();
  // a list of objects with an `id` (articulations, fingerings…) or one object with an `id` (a tuplet): new identifiers, consistent inside the staff
  const freshProps = (props) => {
    const out = {};
    for (const [pid, value] of Object.entries(props)) {
      if (pid === PID.TUPLET && value?.id) {
        if (!tuplets.has(value.id)) tuplets.set(value.id, newId('tu'));
        out[pid] = { ...value, id: tuplets.get(value.id) };
      } else if (Array.isArray(value) && value.some((x) => x && typeof x === 'object' && typeof x.id === 'string')) {
        out[pid] = value.map((x) => (x && typeof x === 'object' && typeof x.id === 'string' ? { ...x, id: newId(x.id.replace(/\d+$/, '') || 'e') } : x));
      } else out[pid] = value;
    }
    return out;
  };
  const cloneNote = (n) => { const el = createElement(n.type, { props: freshProps(n.props) }); idMap.set(n.id, el.id); return el; };
  const cloneItem = (item) => {
    if (item.type !== 'chord') { const el = createElement(item.type, { props: freshProps(item.props) }); idMap.set(item.id, el.id); return el; }
    const el = createElement('chord', { props: freshProps(item.props), children: { notes: item.notes.map(cloneNote), graceNotes: item.graceNotes.map(cloneItem) } });
    idMap.set(item.id, el.id);
    return el;
  };
  const voices = projected.voices.map((voice) => {
    tuplets = new Map(); // a tuplet lives in one measure: new identifiers per voice are enough
    return createElement('voice', {
      props: voice.props,
      children: { measures: voice.measures.map((measure) => createElement('measure', { children: { items: measure.items.map(cloneItem) } })) },
    });
  });
  const remapEntry = (e) => {
    const out = { ...e, id: newId(String(e.id).replace(/\d+$/, '') || 'e') };
    for (const [k, v] of Object.entries(e)) if (REFERENCE.test(k) && typeof v === 'string') { if (!idMap.has(v)) return null; out[k] = idMap.get(v); }
    return out;
  };
  const lists = new Map();
  for (const pid of sharedListsFor(getProperty(linked, PID.STAFF_TYPE))) {
    if (pid === PID.LYRIC_LINKS) continue;
    const entries = (primary.props[pid] ?? []).map(remapEntry).filter(Boolean);
    if (entries.length) lists.set(pid, entries);
  }
  for (const pid of [PID.CAPOS, PID.STRING_TUNINGS]) {
    const entries = (getProperty(linked, pid) ?? []).map((e) => ({ ...e, itemId: idMap.get(e.itemId) })).filter((e) => e.itemId);
    if (entries.length) lists.set(pid, entries); else if (Object.hasOwn(linked.props, pid)) doc.reset(linked, pid);
  }
  for (const voice of voices) doc.add(linked, 'voices', voice);
  for (const [pid, entries] of lists) doc.set(linked, pid, entries);
  doc.reset(linked, PID.LINKED_TO);
}
