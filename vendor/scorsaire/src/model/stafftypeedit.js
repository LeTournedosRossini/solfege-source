/*
 * Changing the type of an existing staff (step 5, "tracks and staves" panel, slice 3).
 * Pure model operations: CALL `changeStaffType` INSIDE `doc.transaction(name, () => …)`; `planStaffTypeChange` only reads.
 *
 * MuseScore 4.7.5 (read, never guessed): `EditPart::setStaffType` → `ChangeStaffType::flip` swaps ONLY the presentation preset of the staff;
 * notes keep pitch, string and fret, and layout decides what is drawn (`Chord::cmdUpdateNotes` → `StringData::fretChords` assigns a
 * string to a note that has none: `StringData::convertPitch` = the highest string whose open pitch does not exceed the pitch; a second
 * note of the instant goes to the first free string from the top; a note that does not fit is a "fret conflict"). Leaving a tablature
 * adapts the bends (`GuitarBend::adaptBendsFromTabToStandardStaff`, not needed here: bends are drawn on both). The proposed types depend
 * on the instrument (`StaffSettingsModel::allStaffTypes`): percussion only for a drumset instrument, tablature only when the instrument
 * has enough fretted strings.
 *
 * Scorsaire has one note element type PER staff type (`note`, `tabnote`, `percnote`, `rhythmnote`), so the content is converted through
 * the pitch (the MIDI number of a percussion sound), keeping each note's IDENTIFIER (ties, glissandos, bends… keep pointing at it):
 *   score ⇄ tab        pitch kept; string by `convertPitch` (tab → score: spelling from the key signature)
 *   any → rhythm/neutral  one note without pitch per chord (the pitch and the other notes of a chord are LOST)
 *   rhythm/neutral → any  a default pitch (middle line of the clef) or sound (the rhythm staff's sound, else the snare)
 *   score/tab ⇄ percussion  through the MIDI number of the sound in the staff's percussion map
 * Anything that loses information is reported by the plan (`confirm`), and the caller must pass the user's answer in the options.
 * Staves of type `chord` and `accordion-left` hold other content and are never converted.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { isApplicable } from './schema.js';
import { createElement } from './elements.js';
import { defaultSpelling } from './pitch.js';
import { instrumentInfo, maxFretOf } from './instruments.js';
import { staffSoundMap, drumSoundForMidi } from './percmap.js';
import { convertPitch, NO_CAPO, STANDARD_TUNING, staffTimeline, capoTimeline, capoAt } from './capo.js';
import { purgeReferences, deleteItem, EditError } from './noteedit.js';
import { fixStaffMoves, trackOfStaff } from './trackedit.js';
import { isLinkedStaff, linkedStavesOf } from './linkedstaff.js';

export { EditError };

/** Types a staff can be converted between. */
export const CONVERTIBLE_STAFF_TYPES = Object.freeze(['score', 'tab', 'percussion', 'rhythm', 'neutral']);

const NAME_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOfName = (name) => {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NAME_STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

/** MIDI pitch of the middle line of a clef (a rhythm note has no pitch: this is the default one). 71 (B4) for an unknown clef. */
export function clefMiddleLinePitch(clef) {
  const m = /^([GFC])(\d)?(8va|8vb|15ma|15mb)?$/.exec(clef ?? 'G');
  if (!m) return 71;
  const base = { G: 71, F: 50 }[m[1]] ?? { 1: 67, 2: 64, 3: 60, 4: 57, 5: 53 }[m[2]] ?? 60;
  const shift = { '8va': 12, '8vb': -12, '15ma': 24, '15mb': -24 }[m[3]] ?? 0;
  return m[1] === 'C' ? base : base + shift;
}

const typeOf = (staff) => getProperty(staff, PID.STAFF_TYPE);
const isTab = (t) => t === 'tab';

/** Staff tuning as MIDI pitches, string 1 (highest) first: the staff's own, else the instrument's catalogue strings, else standard guitar. */
function tuningOf(staff, track) {
  const own = getProperty(staff, PID.TUNING);
  if (own) return own.map(midiOfName);
  const info = instrumentInfo(getProperty(track, PID.INSTRUMENT_ID));
  if (info?.strings?.length) return [...info.strings].reverse();
  return STANDARD_TUNING.map(midiOfName);
}

/** Target types the panel may offer for this staff (current type excluded). `[]` for staves that are not convertible. */
export function staffTypeChoices(mv, staff) {
  const from = typeOf(staff);
  if (!CONVERTIBLE_STAFF_TYPES.includes(from)) return [];
  if (isLinkedStaff(staff) || linkedStavesOf(mv, staff).length) return []; // unlink first: the type of a linked pair is part of the link
  const track = trackOfStaff(mv, staff);
  const info = track ? instrumentInfo(getProperty(track, PID.INSTRUMENT_ID)) : null;
  return CONVERTIBLE_STAFF_TYPES.filter((t) => t !== from && !(isTab(t) && info && !info.strings?.length));
}

/** Every note of the staff with its chord, in reading order (grace notes included). */
function collectChords(staff) {
  const out = [];
  staff.voices.forEach((voice, vi) => voice.measures.forEach((measure, mi) => {
    for (const item of measure.items) {
      if (item.type !== 'chord') continue;
      out.push({ chord: item, voice: vi, mi, grace: false, host: null });
      for (const g of item.graceNotes) out.push({ chord: g, voice: vi, mi, grace: true, host: item });
    }
  }));
  return out;
}

const PITCH_FREE = new Set([PID.PITCH, PID.SPELLING, PID.STRING, PID.SOUND, PID.ACC_ROW, PID.TECHNIQUES]);

/**
 * Decides, for every note, what it becomes. Pure; used by the plan and by the conversion.
 * @returns {{ jobs, issues }} jobs: [{ chord, host, mi, keep: [{ note, target }], drop: [note], remove: boolean }]
 */
function analyse(mv, staff, to, options = {}) {
  const from = typeOf(staff);
  const track = trackOfStaff(mv, staff);
  const percmap = staffSoundMap(getProperty(staff, PID.PERCMAP));
  const tuning = isTab(to) ? tuningOf(staff, track) : null;
  const maxFret = maxFretOf(track);
  const clefPitch = clefMiddleLinePitch(getProperty(staff, PID.CLEF));
  const rhythmMidi = getProperty(staff, PID.RHYTHM_SOUND);
  const defaultSound = (rhythmMidi != null && drumSoundForMidi(percmap, rhythmMidi)) || drumSoundForMidi(percmap, 38) || percmap.sounds[0] || null;
  // capo (MuseScore `StringData::convertPitch(…, capo)`): the fret of a note is computed with the capo in force at its position
  // (a capo already stored on the staff keeps working: the staff list `PID.CAPOS` is not tied to the staff type)
  let capoParamsOf = () => NO_CAPO;
  if (isTab(to)) {
    const timeline = staffTimeline(mv, staff);
    const keyOf = new Map(timeline.map((t) => [t.item.id, t.key]));
    const capos = capoTimeline(mv, staff, timeline);
    if (capos.length) capoParamsOf = (chord, host) => { const key = keyOf.get((host ?? chord).id); return key ? capoAt(capos, key) : NO_CAPO; };
  }
  const toRhythm = to === 'rhythm' || to === 'neutral';
  const fromRhythm = from === 'rhythm' || from === 'neutral';
  const issues = { pitchLost: 0, chordsCollapsed: 0, defaultPitch: 0, percussionMapped: 0, unmapped: [], outOfRange: [] };
  const jobs = [];

  const pitchOfOld = (note) => {
    if (from === 'percussion') {
      return percmap.sounds.find((x) => x.id === getProperty(note, PID.SOUND))?.midi ?? null;
    }
    if (fromRhythm) return clefPitch;
    return getProperty(note, PID.PITCH);
  };

  for (const entry of collectChords(staff)) {
    const { chord, host, mi } = entry;
    const keep = [];
    const drop = [];
    const usedStrings = [];
    const usedSounds = new Set();
    const keyFifths = getProperty(mv.masterbars[mi], PID.KEY_SIG) ?? 0;
    chord.notes.forEach((note, k) => {
      if (toRhythm && k > 0) { drop.push(note); issues.chordsCollapsed += k === 1 ? 1 : 0; return; }
      const pitch = pitchOfOld(note);
      const target = { props: {}, type: null, outOfRange: false };
      if (toRhythm) {
        target.type = 'rhythmnote';
        if (!fromRhythm) issues.pitchLost += 1;
      } else if (to === 'score') {
        if (pitch === null) { drop.push(note); issues.unmapped.push(note.id); return; }
        target.type = 'note';
        const sp = defaultSpelling(pitch, keyFifths);
        target.props = { [PID.PITCH]: pitch, [PID.SPELLING]: sp };
        if (fromRhythm) issues.defaultPitch += 1;
        if (from === 'percussion') issues.percussionMapped += 1;
      } else if (to === 'tab') {
        if (pitch === null) { drop.push(note); issues.unmapped.push(note.id); return; }
        target.type = 'tabnote';
        const capo = capoParamsOf(chord, host);
        let hit = convertPitch(pitch, tuning, capo, usedStrings);
        if (hit && hit.fret > maxFret) hit = null;
        if (!hit) {
          // nearest string: the lowest one for a pitch below the instrument, the highest one above; a free string only
          const free = tuning.map((open, i) => ({ string: i + 1, d: Math.abs(pitch - open) })).filter((x) => !usedStrings.includes(x.string));
          if (!free.length) { drop.push(note); issues.unmapped.push(note.id); return; }
          const nearest = free.reduce((a, b) => (b.d < a.d ? b : a));
          hit = { string: nearest.string, fret: pitch - tuning[nearest.string - 1] };
          target.outOfRange = true;
          issues.outOfRange.push(note.id);
        }
        usedStrings.push(hit.string);
        target.props = { [PID.PITCH]: pitch, [PID.STRING]: hit.string };
        if (fromRhythm) issues.defaultPitch += 1;
        if (from === 'percussion') issues.percussionMapped += 1;
      } else if (to === 'percussion') {
        let sound;
        if (fromRhythm) { sound = defaultSound; issues.defaultPitch += 1; } else {
          sound = pitch === null ? null : drumSoundForMidi(percmap, pitch);
          issues.percussionMapped += 1;
        }
        if (!sound || usedSounds.has(sound.id)) { drop.push(note); issues.unmapped.push(note.id); return; }
        usedSounds.add(sound.id);
        target.type = 'percnote';
        target.props = { [PID.SOUND]: sound.id };
      }
      keep.push({ note, target });
    });
    jobs.push({ chord, host, mi, keep, drop, remove: keep.length === 0 });
  }
  return { jobs, issues, from };
}

/**
 * Read-only plan of a conversion. `confirm` lists what the user must be told (or asked) before converting.
 * @returns {{ from, to, confirm: string[], outOfRange: number, unmapped: number, notes: number, choices: string[] }}
 */
export function planStaffTypeChange(mv, staff, to) {
  const from = typeOf(staff);
  if (!staffTypeChoices(mv, staff).includes(to)) throw new EditError(`Staff type change not possible: ${from} → ${to}`);
  const { jobs, issues } = analyse(mv, staff, to);
  const confirm = [];
  if (issues.pitchLost) confirm.push('pitchLost');
  if (issues.chordsCollapsed) confirm.push('chordsCollapsed');
  if (issues.defaultPitch) confirm.push('defaultPitch');
  if (issues.percussionMapped || from === 'percussion' || to === 'percussion') confirm.push('percussion');
  if (issues.outOfRange.length) confirm.push('outOfRange');
  if (issues.unmapped.length) confirm.push('unmapped');
  return {
    from, to, confirm, outOfRange: issues.outOfRange.length, unmapped: issues.unmapped.length,
    notes: jobs.reduce((n, j) => n + j.chord.notes.length, 0), chords: jobs.length,
  };
}

/**
 * Converts the staff. CALL INSIDE A TRANSACTION. `options`:
 *   outOfRange: 'nearest' (tablature: notes that do not fit go on the nearest free string, possibly with a negative or too high fret)
 *               | 'remove' (they are removed); required when the plan reports `outOfRange`
 *   unmapped:   'remove' (notes with no string / sound are removed; a chord left empty becomes a rest); required when the plan reports `unmapped`
 * Throws `EditError` ("needs confirmation") when a required answer is missing, so nothing is half done.
 */
export function changeStaffType(doc, mv, staff, to, options = {}) {
  const plan = planStaffTypeChange(mv, staff, to);
  if (plan.outOfRange && options.outOfRange !== 'nearest' && options.outOfRange !== 'remove') throw new EditError('Staff type change needs confirmation: outOfRange');
  if (plan.unmapped && options.unmapped !== 'remove') throw new EditError('Staff type change needs confirmation: unmapped');
  const { jobs } = analyse(mv, staff, to);
  const track = trackOfStaff(mv, staff);
  const fromType = plan.from;
  const removeOutOfRange = options.outOfRange === 'remove';

  const emptied = [];
  for (const job of jobs) {
    const { chord, keep, drop } = job;
    const dropped = [...drop];
    const kept = [];
    for (const k of keep) { if (k.target.outOfRange && removeOutOfRange) dropped.push(k.note); else kept.push(k); }
    // replace each kept note by a new element of the target type, SAME identifier (references stay valid)
    for (const { note, target } of kept) {
      const at = chord.notes.indexOf(note);
      const props = {};
      for (const [pid, value] of Object.entries(note.props)) {
        if (PITCH_FREE.has(pid)) continue;
        if (isApplicable(target.type, pid)) props[pid] = value;
      }
      Object.assign(props, target.props);
      doc.remove(note);
      doc.add(chord, 'notes', createElement(target.type, { id: note.id, props }), at);
    }
    for (const note of dropped) {
      if (chord.notes.length > 1 || kept.length > 0) {
        doc.remove(note);
        purgeReferences(doc, staff, [note]);
      }
    }
    if (kept.length === 0) emptied.push(job);
  }
  // chords left without any note become rests (or disappear, for a grace note), once the other chords are done
  emptied.sort((a, b) => Number(Boolean(b.host)) - Number(Boolean(a.host))); // grace notes first: removing their host takes them along
  for (const { chord, host } of emptied) {
    if (!doc.find(chord.id)) continue;
    if (host) {
      doc.remove(chord);
      purgeReferences(doc, staff, [chord]);
    } else deleteItem(doc, chord);
  }

  doc.set(staff, PID.STAFF_TYPE, to);
  if (to === 'tab') {
    if (getProperty(staff, PID.TUNING) == null) doc.set(staff, PID.TUNING, tuningNames(tuningOf(staff, track)));
  }
  if (to === 'percussion') doc.set(staff, PID.LINE_COUNT, 5);
  else if (to === 'rhythm') { doc.set(staff, PID.LINE_COUNT, 0); if (fromType !== 'rhythm') doc.set(staff, PID.RHYTHM_HEAD, 'slash'); }
  else if (to === 'neutral') { doc.set(staff, PID.LINE_COUNT, 1); doc.set(staff, PID.RHYTHM_HEAD, 'normal'); }
  else if (Object.hasOwn(staff.props, PID.LINE_COUNT)) doc.reset(staff, PID.LINE_COUNT);
  fixStaffMoves(doc, track);
  return plan;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const tuningNames = (pitches) => pitches.map((p) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`);
