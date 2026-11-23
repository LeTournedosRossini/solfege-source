/*
 * Creating and changing guitar bends / dives (step 5). TO CALL INSIDE `doc.transaction`. Rules read in MuseScore 4.7.5
 * (`Score::addGuitarBend` cmd.cpp, `GuitarBend::createEndNote`, `fixNotesFrettingForGraceBend` guitarbend.cpp):
 *  - bend / dive: from the note to a note of the NEXT chord of the voice: an existing note of that chord at the target pitch, else a note
 *    ADDED to it (same string in tablature); a following rest is replaced by a chord of the shorter of the two durations. Bend = up, dive = down.
 *  - pre-bend / grace-note bend / pre-dive: a before-ornament (appoggiatura) is added (or the last one reused), a bend runs from it to the note;
 *    pre-bend and grace-note bend: ornament BELOW the note, pre-dive: ABOVE.
 *  - slight bend / dip / scoop: start = end = the note.
 * Deviations: the amount is a number of semitones (MuseScore: one scale step, then edited by changing the fret); the ornament of a pre-bend
 * keeps no "no stem" flag (the drawing hides it); only one dip per chord, one bend / dive per note.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createChord, createBend, createTabNote, createNote, BEND_TYPES } from './elements.js';
import { defaultSpelling } from './pitch.js';
import { placeChord, EditError } from './noteedit.js';
import { itemDuration, measureLengthOf } from './timing.js';
import { ZERO, fAdd } from './fraction.js';
import { BEND_CURVE_MAX_POINTS, BEND_CURVE_MAX_SEMITONES, BEND_CURVE_MIN_GAP, bendCurveOf, bendTimeFactors, isValidBendCurve } from './bend.js';

const NOTE_TYPES = new Set(['note', 'tabnote']);
const GRACE_START = new Set(['preBend', 'graceNoteBend', 'preDive']);
const NO_END_NOTE = new Set(['slightBend', 'dip', 'scoop']);

function staffOf(doc, id) {
  let p = doc.parentOf(id);
  while (p) { const el = p.el ?? p; if (el.type === 'staff') return el; p = doc.parentOf(el.id); }
  return null;
}

/** Position of a chord in its staff: { voice, mi, index } or null (a grace chord has none). */
function locate(staff, chordId) {
  for (let v = 0; v < (staff.voices?.length ?? 0); v++) {
    const measures = staff.voices[v].measures;
    for (let mi = 0; mi < measures.length; mi++) {
      const index = measures[mi].items.findIndex((it) => it.id === chordId);
      if (index >= 0) return { voice: v, mi, index };
    }
  }
  return null;
}

/** The element that follows `chordId` in its voice: { item, mi, start } with `start` = fraction from the start of its measure. */
function nextElement(doc, staff, movement, chordId) {
  const at = locate(staff, chordId);
  if (!at) return null;
  const measures = staff.voices[at.voice].measures;
  let mi = at.mi;
  let index = at.index + 1;
  while (mi < measures.length) {
    const items = measures[mi].items;
    if (index < items.length) {
      const length = measureLengthOf(movement.masterbars[mi]);
      let start = ZERO;
      for (let k = 0; k < index; k++) start = fAdd(start, itemDuration(items[k], length));
      return { item: items[index], mi, start, voice: at.voice };
    }
    mi += 1; index = 0;
  }
  return null;
}

function newNoteLike(note, pitch) {
  if (note.type === 'tabnote') return createTabNote({ pitch, string: getProperty(note, PID.STRING) });
  const s = defaultSpelling(pitch);
  return createNote({ step: s.step, alter: s.alter, octave: s.octave });
}

const samePlace = (a, b) => (a.type === 'tabnote' ? getProperty(a, PID.STRING) === getProperty(b, PID.STRING) : true);

const isDiveType = (t) => t === 'dive' || t === 'preDive' || t === 'dip' || t === 'scoop';

/** Does `note` already start a bend of this class (bend vs dive) ? */
function startsBend(staff, noteId, dive) {
  return (getProperty(staff, PID.BENDS) ?? []).some((b) => b.startNoteId === noteId && b.startNoteId !== b.endNoteId && isDiveType(b.type) === dive);
}

/**
 * Adds a bend of `type` on a note. Returns the new entry. `semitones` (1..12, default 2): size of the bend / dive; a NEGATIVE value
 * with type 'bend' makes a release (arrival note below the start).
 */
export function addBend(doc, noteId, type, { semitones = 2 } = {}) {
  if (!BEND_TYPES.includes(type)) throw new EditError(`Type de bend inconnu : ${type}`);
  const note = doc.find(noteId);
  if (!note || !NOTE_TYPES.has(note.type)) throw new EditError('Sélectionnez une note de portée de notation ou de tablature');
  const chord = doc.parentOf(noteId);
  const main = chord && (chord.el ?? chord);
  const staff = staffOf(doc, noteId);
  if (!main || main.type !== 'chord' || !staff) throw new EditError('Note introuvable');
  const movement = doc.movementOf(staff);
  const amount = Math.min(12, Math.max(1, Math.round(Math.abs(semitones))));
  const release = type === 'bend' && semitones < 0; // a RELEASE: a bend whose arrival note is BELOW the start (after a bend, brings the string back)
  const pitch = getProperty(note, PID.PITCH);
  const list = getProperty(staff, PID.BENDS) ?? [];
  const dive = isDiveType(type);

  if (type === 'dip' && main.notes.some((n) => list.some((b) => b.type === 'dip' && b.startNoteId === n.id))) throw new EditError('Un seul « dip » par accord');
  if ((type === 'bend' || type === 'dive') && startsBend(staff, noteId, dive)) throw new EditError('Cette note a déjà un bend');
  if ((type === 'preBend' || type === 'graceNoteBend' || type === 'preDive') && list.some((b) => b.endNoteId === noteId && b.startNoteId !== b.endNoteId)) {
    throw new EditError('Cette note reçoit déjà un bend');
  }

  let startId = noteId;
  let endId = noteId;

  if (type === 'bend' || type === 'dive') {
    const target = type === 'bend' && !release ? pitch + amount : pitch - amount;
    const next = nextElement(doc, staff, movement, main.id);
    if (!next) throw new EditError('Aucune note après : ajoutez la note d\'arrivée du bend');
    let end = null;
    if (next.item.type === 'chord') {
      end = next.item.notes.find((n) => getProperty(n, PID.PITCH) === target && samePlace(note, n)) ?? null;
      if (!end) {
        end = newNoteLike(note, target);
        if (note.type === 'tabnote' && next.item.notes.some((n) => getProperty(n, PID.STRING) === getProperty(note, PID.STRING))) {
          throw new EditError('La corde de la note d\'arrivée est déjà prise');
        }
        doc.add(next.item, 'notes', end);
      }
    } else if (next.item.type === 'rest') {
      const dur = getProperty(main, PID.DURATION);
      end = newNoteLike(note, target);
      const result = placeChord(doc, {
        staff, voice: next.voice, measure: next.mi, position: next.start, duration: { base: dur.base, dots: dur.dots ?? 0 },
        makeChord: (d) => createChord({ duration: d.base, dots: d.dots ?? 0, notes: [end] }),
      });
      if (!result.chords.length) throw new EditError('Aucune place pour la note d\'arrivée');
    } else throw new EditError('Aucune note après : ajoutez la note d\'arrivée du bend');
    endId = end.id;
  } else if (GRACE_START.has(type)) {
    const gracePitch = type === 'preDive' ? pitch + amount : pitch - amount;
    const before = (main.graceNotes ?? []).filter((g) => !String(getProperty(g, PID.GRACE_TYPE) ?? '').endsWith('after'));
    let graceNote;
    if (before.length) {
      graceNote = newNoteLike(note, gracePitch);
      doc.add(before[before.length - 1], 'notes', graceNote);
    } else {
      graceNote = newNoteLike(note, gracePitch);
      const grace = createChord({ duration: 'eighth', notes: [graceNote], props: { [PID.GRACE_TYPE]: 'appoggiatura' } });
      doc.add(main, 'graceNotes', grace);
    }
    startId = graceNote.id;
    endId = noteId;
  } else if (!NO_END_NOTE.has(type)) throw new EditError(`Type de bend inconnu : ${type}`);

  const entry = createBend(type, startId, endId);
  doc.set(staff, PID.BENDS, [...(getProperty(staff, PID.BENDS) ?? []), entry]);
  return entry;
}

/** Size (semitones, signed: + up) of an existing bend, or null for a bend without one (slight bend, dip, scoop). */
export function bendSemitones(doc, entryId) {
  const found = doc.findListEntry(entryId);
  if (!found || found.kind !== 'bend') return null;
  const { startNoteId, endNoteId, type } = found.entry;
  if (startNoteId === endNoteId || NO_END_NOTE.has(type)) return null;
  const a = doc.find(startNoteId);
  const b = doc.find(endNoteId);
  if (!a || !b) return null;
  return getProperty(b, PID.PITCH) - getProperty(a, PID.PITCH);
}

/**
 * Change the size of an existing bend / dive: moves the END note (bend, dive) or the ORNAMENT note (pre-bend, grace-note bend, pre-dive)
 * so that the difference becomes `semitones` (magnitude, 1..12). The direction of the type is kept.
 */
export function setBendSemitones(doc, entryId, semitones) {
  const found = doc.findListEntry(entryId);
  if (!found || found.kind !== 'bend') throw new EditError('Bend attendu');
  const { startNoteId, endNoteId, type } = found.entry;
  const n = Math.min(12, Math.max(1, Math.round(semitones)));
  if (startNoteId === endNoteId || NO_END_NOTE.has(type)) throw new EditError('Ce bend n\'a pas de taille réglable');
  const start = doc.find(startNoteId);
  const end = doc.find(endNoteId);
  if (!start || !end) throw new EditError('Note introuvable');
  // bend, pre-bend, grace-note bend rise to the end note; dive, pre-dive fall; a RELEASE (a bend whose end note is below its start) keeps falling
  const falling = type === 'dive' || type === 'preDive' || (type === 'bend' && getProperty(end, PID.PITCH) < getProperty(start, PID.PITCH));
  const up = !falling;
  const move = GRACE_START.has(type) ? start : end;
  const fixed = GRACE_START.has(type) ? end : start;
  const base = getProperty(fixed, PID.PITCH);
  let pitch;
  if (GRACE_START.has(type)) pitch = up ? base - n : base + n; // the ornament is the unbent pitch: below for a bend, above for a dive
  else pitch = up ? base + n : base - n;
  doc.set(move, PID.PITCH, pitch);
  if (move.type === 'note') doc.set(move, PID.SPELLING, defaultSpelling(pitch));
  return n;
}

// ---------- bend graph (user curve) ----------
// The graph covers a CHAIN of bends: [pre-bend | bend] then any number of bends / releases that start on the previous arrival note.
// Stored on the HEAD entry as `curve` = [{ t, s, h? }], `s` in semitones relative to the SOUNDING first note (for a pre-bend the unbent
// ornament is silent: the main note sounds from the start, at the bent pitch). The graph SHOWS values relative to the first written note
// (`amount0` = bent pitch above the ornament), so a pre-bend starts high on the graph.
// Rules: the last point is the pitch of the last note (it follows the graph, whole semitones); for a pre-bend the FIRST point is the
// amount of the pre-bend (it moves the ornament); intermediate arrival notes keep their pitch (change them with the − / + of each bend).

const AUX_TYPES = new Set(['slightBend', 'dip', 'scoop']);
const CHAIN_HEAD = new Set(['bend', 'dive', 'preBend', 'preDive', 'graceNoteBend']);
const CHAIN_NEXT = new Set(['bend', 'dive']);
const PRE_TYPES = new Set(['preBend', 'preDive', 'graceNoteBend']);
const isHop = (b) => b.startNoteId !== b.endNoteId;

/** Chain of the bend `entryId`: { head, hops (entries after the head), notes (ids, first written note first), pre, owner, pid } or null. */
function chainOf(doc, entryId) {
  const found = doc.findListEntry(entryId);
  if (!found || found.kind !== 'bend') return null;
  const list = getProperty(found.owner, found.pid) ?? [];
  // slight bend, dip, scoop: no arrival note, the curve is the shape of the pitch around the note
  if (AUX_TYPES.has(found.entry.type)) { // (a slight bend / dip / scoop that names another end note is still read on its first note)
    return { head: found.entry, hops: [], notes: [found.entry.startNoteId], pre: false, aux: true, owner: found.owner, pid: found.pid };
  }
  let head = found.entry;
  for (let guard = 0; guard < 64; guard++) {
    const prev = list.find((b) => b !== head && isHop(b) && b.endNoteId === head.startNoteId && CHAIN_HEAD.has(b.type));
    if (!prev) break;
    head = prev;
  }
  if (!CHAIN_HEAD.has(head.type) || !isHop(head)) return null;
  const hops = [];
  let cur = head;
  for (let guard = 0; guard < 64; guard++) {
    const next = list.find((b) => b !== cur && isHop(b) && b.startNoteId === cur.endNoteId && CHAIN_NEXT.has(b.type));
    if (!next || next === head || hops.includes(next)) break;
    hops.push(next);
    cur = next;
  }
  const notes = [head.startNoteId, head.endNoteId, ...hops.map((h) => h.endNoteId)];
  return { head, hops, notes, pre: PRE_TYPES.has(head.type), owner: found.owner, pid: found.pid };
}

const pitchOf = (doc, id) => getProperty(doc.find(id), PID.PITCH);

/** Written duration of the chord of a note, as a number of whole notes. */
function chordSpan(doc, noteId) {
  const chord = doc.parentOf(noteId);
  const el = chord && (chord.el ?? chord);
  const d = el && getProperty(el, PID.DURATION);
  if (!d) return 0.25;
  const base = { whole: 1, half: 0.5, quarter: 0.25, eighth: 0.125, sixteenth: 0.0625, thirtysecond: 0.03125, sixtyfourth: 0.015625, breve: 2 }[d.base] ?? 0.25;
  let v = base;
  for (let k = 1; k <= (d.dots ?? 0); k++) v += base / 2 ** k;
  return v;
}

/** The curve implied by the notes and the time factors: each hop ramps over the span of its note (MuseScore `buildPitchCurve`). Relative to the SOUNDING first note. */
function chainDefaultCurve(doc, chain) {
  const sounding = chain.pre ? chain.notes.slice(1) : chain.notes;
  const hops = chain.pre ? chain.hops : [chain.head, ...chain.hops];
  const R = pitchOf(doc, sounding[0]);
  const spans = sounding.map((id) => chordSpan(doc, id));
  const total = spans.reduce((a, b) => a + b, 0) || 1;
  const bounds = [0];
  for (const sp of spans) bounds.push(bounds[bounds.length - 1] + sp / total);
  const pts = [{ t: 0, s: 0 }];
  const push = (t, s) => {
    const last = pts[pts.length - 1];
    if (t > last.t + 1e-6) pts.push({ t: Math.min(1, t), s }); else pts[pts.length - 1] = { t: last.t, s };
  };
  hops.forEach((hop, k) => {
    const a = bounds[k]; const b = bounds[k + 1];
    const f = bendTimeFactors(hop);
    const prevS = pitchOf(doc, sounding[k]) - R;
    const nextS = pitchOf(doc, sounding[k + 1]) - R;
    push(a + (b - a) * f.start, prevS);
    push(a + (b - a) * f.end, nextS);
  });
  const lastS = pitchOf(doc, sounding[sounding.length - 1]) - R;
  if (pts[pts.length - 1].t < 1 - 1e-6) pts.push({ t: 1, s: lastS });
  return pts;
}

/** Pitch offset (semitones) of a slight bend / dip / scoop: ½ semitone per quarter tone (`auxAmount`: slight +1, scoop −2, dip −2 by default). */
function auxOffset(entry) {
  const quarter = entry.type === 'slightBend' ? 1 : entry.type === 'scoop' ? -2 : (entry.amount ?? -2);
  return quarter / 2;
}

/** The curve implied by the time factors for a slight bend / dip / scoop (what the playback plays). */
function auxDefaultCurve(entry) {
  const f = bendTimeFactors(entry);
  const o = auxOffset(entry);
  const pts = [];
  const push = (t, s) => {
    if (pts.length && t <= pts[pts.length - 1].t + 1e-6) { pts[pts.length - 1] = { t: pts[pts.length - 1].t, s }; return; }
    pts.push({ t: Math.min(1, t), s });
  };
  if (entry.type === 'slightBend') { push(0, 0); push(f.start, 0); push(f.end, o); push(1, o); }
  else if (entry.type === 'dip') { push(0, 0); push(f.start, 0); push(f.target, o); push(f.end, 0); push(1, 0); }
  else { push(0, o); push(f.start, o); push(f.end, 0); push(1, 0); } // scoop: starts below the note and slides up to it
  return pts;
}

/**
 * What the bend graph shows for the chain of `entryId`:
 * `{ editable, kind: 'single' | 'chain' | 'pre', headId, points (display values), custom, amount0, type, semitones, hops }` or null.
 */
export function bendCurveInfo(doc, entryId) {
  const found = doc.findListEntry(entryId);
  if (!found || found.kind !== 'bend') return null;
  const chain = chainOf(doc, entryId);
  if (!chain) return { editable: false, type: found.entry.type, points: [], custom: false, semitones: bendSemitones(doc, entryId) };
  const amount0 = chain.pre ? pitchOf(doc, chain.notes[1]) - pitchOf(doc, chain.notes[0]) : 0;
  const user = bendCurveOf(chain.head);
  const stored = user ?? (chain.aux ? auxDefaultCurve(chain.head) : chainDefaultCurve(doc, chain));
  const points = stored.map((p) => ({ ...p, s: p.s + amount0, ...(p.h ? { h: [...p.h] } : {}) }));
  const lastNote = chain.notes[chain.notes.length - 1];
  const semitones = chain.aux ? points[points.length - 1].s : pitchOf(doc, lastNote) - pitchOf(doc, chain.notes[0]);
  return {
    editable: true, kind: chain.aux ? 'aux' : chain.pre ? 'pre' : chain.hops.length ? 'chain' : 'single', headId: chain.head.id, type: chain.head.type,
    custom: !!user, points, amount0, semitones, hops: chain.hops.length + 1,
  };
}

const setPitch = (doc, note, pitch) => {
  doc.set(note, PID.PITCH, pitch);
  if (note.type === 'note') doc.set(note, PID.SPELLING, defaultSpelling(pitch));
};

/**
 * Store the user curve (display values, as `bendCurveInfo` returns them). Points are sorted, snapped to half semitones, clamped and
 * thinned to a minimum gap; the first point is at t = 0. Pre-bend: the first point sets the amount (the ornament moves). Otherwise the
 * LAST point sets the pitch of the last note of the chain (whole semitones). TO CALL INSIDE `doc.transaction`. Returns the display points.
 */
export function setBendCurve(doc, entryId, points) {
  const chain = chainOf(doc, entryId);
  if (!chain) throw new EditError('Ce bend n\'a pas de graphique réglable');
  if (!Array.isArray(points) || points.length < 2) throw new EditError('Au moins deux points');
  const clean = points
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.s))
    .map((p) => ({
      t: Math.min(1, Math.max(0, p.t)),
      s: Math.max(-BEND_CURVE_MAX_SEMITONES, Math.min(BEND_CURVE_MAX_SEMITONES, Math.round(p.s * 2) / 2)),
      ...(Array.isArray(p.h) && p.h.every(Number.isFinite) ? { h: [Math.max(-1, Math.min(1, p.h[0])), Math.max(-BEND_CURVE_MAX_SEMITONES, Math.min(BEND_CURVE_MAX_SEMITONES, p.h[1]))] } : {}),
    }))
    .sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of clean) {
    if (out.length && p.t - out[out.length - 1].t < BEND_CURVE_MIN_GAP) { out[out.length - 1] = { ...p, t: out[out.length - 1].t }; continue; }
    out.push({ ...p });
  }
  if (out.length < 2) throw new EditError('Au moins deux points');
  if (out.length > BEND_CURVE_MAX_POINTS) throw new EditError(`Au plus ${BEND_CURVE_MAX_POINTS} points`);
  out[0] = { ...out[0], t: 0 };
  if (chain.aux) {
    // no arrival note: the curve is the whole story. Slight bend / dip start ON the note (first point 0); a scoop starts below it (free).
    const stored = out.map((p, i) => (i === 0 && chain.head.type !== 'scoop' ? { ...p, s: 0 } : p));
    if (!isValidBendCurve(stored)) throw new EditError('Courbe invalide');
    const aux = getProperty(chain.owner, chain.pid) ?? [];
    doc.set(chain.owner, chain.pid, aux.map((e) => (e.id === chain.head.id ? { ...e, curve: stored } : e)));
    return stored;
  }
  const firstNote = doc.find(chain.notes[0]);
  const soundingFirst = doc.find(chain.notes[chain.pre ? 1 : 0]);
  const dive = chain.head.type === 'dive' || chain.head.type === 'preDive';
  let amount0 = chain.pre ? pitchOf(doc, chain.notes[1]) - pitchOf(doc, chain.notes[0]) : 0;
  if (chain.pre) {
    // the first point of a pre-bend = the amount: the ornament (silent) moves
    const size = Math.min(BEND_CURVE_MAX_SEMITONES, Math.max(1, Math.round(Math.abs(out[0].s))));
    amount0 = dive ? -size : size;
    setPitch(doc, firstNote, pitchOf(doc, chain.notes[1]) - amount0);
  }
  const stored = out.map((p) => ({ ...p, s: Math.round((p.s - amount0) * 2) / 2 }));
  stored[0] = { ...stored[0], s: 0 };
  if (!chain.pre || chain.hops.length) {
    // the last point = the last note of the chain (whole semitones, relative to the sounding first note)
    const R = pitchOf(doc, soundingFirst.id);
    const last = stored[stored.length - 1];
    const whole = Math.round(last.s);
    stored[stored.length - 1] = { ...last, s: whole };
    const lastNote = doc.find(chain.notes[chain.notes.length - 1]);
    if (lastNote.id !== soundingFirst.id) setPitch(doc, lastNote, R + whole);
  }
  if (!isValidBendCurve(stored)) throw new EditError('Courbe invalide');
  const list = getProperty(chain.owner, chain.pid) ?? [];
  doc.set(chain.owner, chain.pid, list.map((e) => (e.id === chain.head.id ? { ...e, curve: stored } : e)));
  return stored.map((p) => ({ ...p, s: p.s + amount0 }));
}

/** Remove the user curve of the chain: playback follows the time factors again. Returns true when something changed. */
export function resetBendCurve(doc, entryId) {
  const chain = chainOf(doc, entryId);
  if (!chain || chain.head.curve === undefined) return false;
  const list = getProperty(chain.owner, chain.pid) ?? [];
  doc.set(chain.owner, chain.pid, list.map((e) => { if (e.id !== chain.head.id) return e; const { curve: _c, ...rest } = e; return rest; }));
  return true;
}
