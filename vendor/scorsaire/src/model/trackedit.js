/*
 * Adding, removing and reordering tracks and staves (step 5, "tracks and staves" panel, slice 1).
 * Pure model operations: CALL THEM INSIDE `doc.transaction(name, () => addTrack(doc, mv, …))` — one gesture = one undoable step.
 *
 * Ported from MuseScore 4.7.5 (read, never guessed): `EditPart::removeParts/removeStaves/moveParts/moveStaves`, `Score::cmdRemovePart`,
 * `cmdRemoveStaff`, `undoRemoveStaff`, `undoInsertStaff`, `Measure::cmdRemoveStaves`, `allowRemoveWhenRemovingStaves`,
 * `LayoutPanelTreeModel::updateRemovingAvailability` (instrumentsscene).
 *
 * Rules (MuseScore → Scorsaire):
 *   - Removing a staff removes everything it carries (notes, spanners, lyrics, annotations): in Scorsaire the staff element owns all of
 *     it, so `doc.remove(staff)` is enough. Removing a track removes all its staves first (`cmdRemovePart`).
 *   - A track keeps at least one staff: the UI forbids removing all the children of a non-root item ("the user is allowed to remove
 *     all children only for the root item"). Removing the last staff of a track = removing the track. All tracks MAY be removed.
 *   - A staff-targeted swing (`PID.TARGET_STAFF_ID`) disappears with its staff (an annotation of the removed staff).
 *   - New staff: empty measures for every masterbar (`undoInsertStaff` → `cmdAddStaves(createRests = true)`): a whole-measure rest in
 *     voice 1, or the recomputed automatic rests in an irregular measure (anacrusis).
 *   - Reordering = a permutation of staves / tracks (`SortStaves`); here a one-step move up or down inside the parent. A staff can
 *     not leave its track (MuseScore can, Scorsaire's cross-staff model is per track) and cross-staff chords whose target would no
 *     longer be a valid neighbour are reset (`staffMove` back to 0), like `ChordRest::checkStaffMoveValidity`.
 *   - Groups (brackets, `movement.groups`) refer to tracks by identifier and are ranges. Removing a track shrinks them
 *     (`adjustBracketsDel`: a group left with no track disappears); moving a track is REFUSED when it would cross the boundary of a
 *     group (it would silently change the group's members): regroup first (slice 4).
 *   - Renaming (`NotationParts::setInstrumentName` → `EditPart::setInstrumentName` → `ChangeInstrumentLong`, and the instrument
 *     settings popup of the layout panel, "Name on main score" + "Abbreviated name"): MuseScore keeps THREE names, `Part::partName`
 *     (track list / mixer, set at creation, never touched by this popup), the long and the short instrument names (drawn on the
 *     score). In Scorsaire `PID.NAME` is the track name (panel, mixer); no instrument name is drawn on the score yet, so the
 *     abbreviation (`PID.ABBREVIATION`, already in the model) is left alone until it is. An empty name = the generic label.
 */
import { pruneSheets } from './sheetedit.js';
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { isApplicable, STAFF_TYPES } from './schema.js';
import { createTrack, createStaff, createVoice, createMeasure, createEmptyMeasure } from './elements.js';
import { isIrregularMeasure } from './timing.js';
import { recomputeAutoRests, EditError } from './noteedit.js';
import { instrumentInfo, instrumentDisplayName } from './instruments.js';
import { percmapPreset } from './percmap.js';
import { defaultSpelling } from './pitch.js';
import { isTrackIcon } from './icons.js';
import { chordTrackOf } from './chordtrack.js';
import { linkedStavesOf } from './linkedstaff.js';

export { EditError };

const STAFF_TYPE_NAMES = ['score', 'tab', 'percussion', 'chord', 'rhythm', 'accordion-left', 'neutral'];
/** Staff types that can be created from the panel ("numbered" is reserved). */
export const CREATABLE_STAFF_TYPES = Object.freeze(STAFF_TYPE_NAMES);

const allStaves = (mv) => mv.tracks.flatMap((t) => t.staves);

/** Track that owns a staff (or null). */
export function trackOfStaff(mv, staff) {
  return mv.tracks.find((t) => t.staves.some((s) => s.id === staff.id)) ?? null;
}

/** One voice with one empty measure per masterbar; irregular measures are left empty here and filled by `fillIrregular`. */
function emptyVoiceFor(mv, type) {
  const measures = mv.masterbars.map((bar) => (isIrregularMeasure(bar) ? createMeasure([]) : createEmptyMeasure(type)));
  return createVoice(measures);
}

/** Irregular measures (anacrusis) can not hold a whole-measure rest: have the automatic rests recomputed. */
function fillIrregular(doc, mv, staff) {
  mv.masterbars.forEach((bar, mi) => {
    if (isIrregularMeasure(bar) && STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)].sequential) recomputeAutoRests(doc, { staff, voice: 0, measure: mi });
  });
}

function newStaff(mv, { type = 'score', clef = 'G', props = {} } = {}) {
  if (!CREATABLE_STAFF_TYPES.includes(type)) throw new EditError(`Unknown staff type: ${type}`);
  return createStaff({ type, clef, props, voices: [emptyVoiceFor(mv, type)] });
}

/**
 * Adds a track with one staff per entry of `staves` ({ type, clef?, props? }), at index `at` (default: the end).
 * @returns {object} the new track
 */
export function addTrack(doc, mv, { staves = [{ type: 'score' }], name = '', abbreviation = '', transposition = null, props = {}, at } = {}) {
  if (!staves.length) throw new EditError('A track needs at least one staff');
  if (at !== undefined && (!Number.isInteger(at) || at < 0 || at > mv.tracks.length)) throw new EditError('Invalid track position');
  // the chord track: only one per movement, always the first track (decided with Jean, 18/10/2026)
  if (staves.some((s) => s.type === 'chord')) {
    if (staves.length > 1) throw new EditError('A chord track holds only its chord staff');
    if (chordTrackOf(mv)) throw new EditError('Only one chord track per movement');
    at = 0;
  } else if (at === 0 && chordTrackOf(mv)) at = 1;
  const created = staves.map((spec) => newStaff(mv, spec));
  const track = createTrack({ name, abbreviation, transposition, staves: created, props });
  doc.add(mv, 'tracks', track, at ?? mv.tracks.length);
  for (const staff of created) fillIrregular(doc, mv, staff);
  return track;
}

/** MIDI pitch → 'E4' / 'F#3' (sharps), the notation of `PID.TUNING`. */
const midiName = (pitch) => { const sp = defaultSpelling(pitch, 0); return `${sp.step}${sp.alter === 1 ? '#' : ''}${sp.octave}`; };

/** Catalogue drum sets whose new staff gets Scorsaire's default drum map. */
const SCORSAIRE_MAP_KITS = new Set(['drum-kit-5', 'drumset']);

/** Staff specs ({ type, clef, props }) of a catalogue instrument: one per catalogue staff, type from its staff-type preset. */
export function staffSpecsOfInstrument(instrumentId, info, wanted = null) {
  const preset = info.staffTypePreset ?? '';
  const catalogKind = preset.startsWith('perc') ? 'percussion' : preset.startsWith('tab') ? 'tab' : 'score';
  const count = wanted?.length ?? Math.max(1, info.staves || 1);
  const clefTypes = new Map((info.clefTypes ?? []).map((c) => [c.staff, c]));
  const clefs = new Map((info.clefs ?? []).map((c) => [c.staff, c.clef]));
  return Array.from({ length: count }, (_, k) => {
    const n = k + 1;
    const want = wanted?.[k] ?? null;
    const kind = want?.type ?? catalogKind;
    let spec;
    if (kind === 'percussion') {
      // the two ordinary drum sets start on Scorsaire's own drum map (Jean's, the one the grid and the accompaniment know), not on MuseScore's kit of the same name; the other kits keep theirs
      const kit = percmapPreset(SCORSAIRE_MAP_KITS.has(instrumentId) ? 'scorsaire-drum-kit' : `musescore:${instrumentId}`);
      const props = { [PID.LINE_COUNT]: want?.lineCount ?? kit?.lines ?? (preset === 'perc1Line' ? 1 : 5) };
      if (kit) props[PID.PERCMAP] = kit.create();
      spec = { type: 'percussion', clef: 'G', props };
    } else if (kind === 'tab') {
      const props = {};
      // the catalogue lists strings from the lowest; `PID.TUNING` goes from the highest string down
      if (info.strings?.length) props[PID.TUNING] = [...info.strings].reverse().map(midiName);
      spec = { type: 'tab', clef: 'G', props };
    } else {
      const types = clefTypes.get(n) ?? clefTypes.get(1);
      const clef = want?.clef ?? types?.transposing ?? clefs.get(n) ?? clefs.get(1) ?? 'G';
      const props = {};
      if (!want?.clef && types && types.concert !== types.transposing) props[PID.CONCERT_CLEF] = types.concert;
      spec = { type: kind, clef, props };
    }
    if (want?.props) Object.assign(spec.props, want.props);
    return spec;
  });
}

/**
 * Adds a track made from a catalogue instrument (`instrument-catalog.json`, MuseScore classification): staves, clefs, concert clefs,
 * names, tuning of a tablature and the percussion set come from the catalogue; the instrument id is kept (transposition, playback
 * profile). Everything stays editable afterwards. The transposition is NOT copied: it is read from the catalogue through `PID.INSTRUMENT_ID`
 * until the user sets their own.
 */
export function addTrackFromInstrument(doc, mv, instrumentId, { at, name, abbreviation, lang = 'en', staves, props } = {}) {
  const info = instrumentInfo(instrumentId);
  if (!info) throw new EditError(`Unknown instrument: ${instrumentId}`);
  return addTrack(doc, mv, {
    staves: staffSpecsOfInstrument(instrumentId, info, staves ?? null),
    name: name ?? instrumentDisplayName(instrumentId, lang, 'trackName') ?? '',
    abbreviation: abbreviation ?? instrumentDisplayName(instrumentId, lang, 'shortName') ?? '',
    props: { [PID.INSTRUMENT_ID]: instrumentId, ...(props ?? {}) },
    at,
  });
}

/** Adds a staff to a track at index `at` (default: after the last one). A staff inserted between others shifts nothing else. */
export function addStaff(doc, mv, track, { type = 'score', clef = 'G', props = {}, at } = {}) {
  if (!mv.tracks.some((t) => t.id === track.id)) throw new EditError('Unknown track');
  if (at !== undefined && (!Number.isInteger(at) || at < 0 || at > track.staves.length)) throw new EditError('Invalid staff position');
  if (type === 'chord') throw new EditError('A chord staff makes a track of its own');
  const staff = newStaff(mv, { type, clef, props });
  const index = at ?? track.staves.length;
  doc.add(track, 'staves', staff, index);
  fillIrregular(doc, mv, staff);
  fixStaffMoves(doc, track);
  return staff;
}

/** Cross-staff chords/rests (`staffMove`) whose target no longer exists or is no notation staff go back to their own staff. */
export function fixStaffMoves(doc, track) {
  track.staves.forEach((staff, k) => {
    for (const voice of staff.voices) {
      for (const measure of voice.measures) {
        for (const item of measure.items) {
          if (!isApplicable(item.type, PID.STAFF_MOVE)) continue;
          const move = getProperty(item, PID.STAFF_MOVE);
          if (!move) continue;
          const target = track.staves[k + move];
          const ok = target && getProperty(staff, PID.STAFF_TYPE) === 'score' && getProperty(target, PID.STAFF_TYPE) === 'score';
          if (!ok) doc.reset(item, PID.STAFF_MOVE);
        }
      }
    }
  });
}

/** Groups (movement-level, nested): ids of the tracks inside a group's range, using the CURRENT track order. */
function groupMembers(mv, group) {
  const ids = mv.tracks.map((t) => t.id);
  const a = ids.indexOf(getProperty(group, PID.START_TRACK_ID));
  const b = ids.indexOf(getProperty(group, PID.END_TRACK_ID));
  return a < 0 || b < 0 ? [] : ids.slice(a, b + 1);
}

function walkGroups(list, fn, parent = null) {
  for (const g of list) { fn(g, parent); walkGroups(g.groups, fn, g); }
}

/** Removes a staff. A track's last staff can not be removed alone (remove the track instead). */
export function removeStaff(doc, mv, staff) {
  const track = trackOfStaff(mv, staff);
  if (!track) throw new EditError('Unknown staff');
  // a notation staff takes the tablatures linked to it with it (they show nothing without it)
  const dependants = linkedStavesOf(mv, staff);
  if (track.staves.length - dependants.length <= 1) throw new EditError('A track keeps at least one staff: remove the track instead');
  for (const gone of [...dependants, staff]) {
    for (const swing of mv.swings) if (getProperty(swing, PID.TARGET_STAFF_ID) === gone.id) doc.remove(swing);
    doc.remove(gone);
  }
  fixStaffMoves(doc, track);
}

/** Removes a track with its staves; groups shrink or disappear. */
export function removeTrack(doc, mv, track) {
  if (!mv.tracks.some((t) => t.id === track.id)) throw new EditError('Unknown track');
  const staffIds = new Set(track.staves.map((s) => s.id));
  for (const cue of [...(mv.cues ?? [])]) if (getProperty(cue, PID.CUE_TRACK) === track.id) doc.remove(cue); // a cue for this track goes with it
  for (const swing of mv.swings) if (staffIds.has(getProperty(swing, PID.TARGET_STAFF_ID))) doc.remove(swing);

  // groups first, from the order BEFORE the removal (deepest groups first so a parent still sees its children)
  const plans = [];
  walkGroups(mv.groups, (g, parent) => {
    const members = groupMembers(mv, g).filter((id) => id !== track.id);
    plans.push({ g, parent, members });
  });
  for (const { g, parent, members } of plans.reverse()) {
    const gone = members.length === 0;
    if (gone) {
      doc.remove(g);
    } else {
      if (getProperty(g, PID.START_TRACK_ID) === track.id) doc.set(g, PID.START_TRACK_ID, members[0]);
      if (getProperty(g, PID.END_TRACK_ID) === track.id) doc.set(g, PID.END_TRACK_ID, members[members.length - 1]);
    }
    void parent;
  }
  doc.remove(track);
  pruneSheets(doc);
}

/**
 * Moves a staff to a final index inside its own track (a staff never leaves its track). Returns false when it is already there.
 * `index` is the position the staff will have once moved (0 .. staves − 1).
 */
export function moveStaffTo(doc, mv, staff, index) {
  const track = trackOfStaff(mv, staff);
  if (!track) throw new EditError('Unknown staff');
  if (!Number.isInteger(index) || index < 0 || index >= track.staves.length) throw new EditError('Invalid position');
  const from = track.staves.findIndex((s) => s.id === staff.id);
  if (from === index) return false;
  doc.remove(staff);
  doc.add(track, 'staves', staff, index);
  fixStaffMoves(doc, track);
  return true;
}

/** Moves a staff one step inside its track (dir −1 = up, +1 = down). Returns false at the edge. */
export function moveStaff(doc, mv, staff, dir) {
  if (dir !== -1 && dir !== 1) throw new EditError('Invalid direction');
  const track = trackOfStaff(mv, staff);
  if (!track) throw new EditError('Unknown staff');
  const to = track.staves.findIndex((s) => s.id === staff.id) + dir;
  if (to < 0 || to >= track.staves.length) return false;
  return moveStaffTo(doc, mv, staff, to);
}

/**
 * Moves a track to a final index in its movement (any distance, one step of the model). Refused when the new order would change the
 * members of a group; only the FINAL order matters (a track may jump over a whole group). Returns false when it is already there.
 */
export function moveTrackTo(doc, mv, track, index) {
  const from = mv.tracks.findIndex((t) => t.id === track.id);
  if (from < 0) throw new EditError('Unknown track');
  if (!Number.isInteger(index) || index < 0 || index >= mv.tracks.length) throw new EditError('Invalid position');
  // the chord track stays first; no other track takes the first place while there is one
  const chord = chordTrackOf(mv);
  if (chord) {
    if (chord.id === track.id) { if (index !== 0) throw new EditError('The chord track stays the first track'); }
    else if (index === 0) index = 1;
  }
  if (from === index) return false;

  // group membership must not change: compare each group's members before and after the move (same bounds, new order)
  const order = mv.tracks.map((t) => t.id);
  order.splice(from, 1);
  order.splice(index, 0, track.id);
  const groups = [];
  walkGroups(mv.groups, (g) => groups.push(g));
  const rewrites = [];
  for (const g of groups) {
    const start = getProperty(g, PID.START_TRACK_ID);
    const end = getProperty(g, PID.END_TRACK_ID);
    let a = order.indexOf(start);
    let b = order.indexOf(end);
    const reversed = a > b;
    if (reversed) [a, b] = [b, a];
    const after = order.slice(a, b + 1);
    const before = new Set(groupMembers(mv, g));
    if (after.length !== before.size || after.some((id) => !before.has(id))) throw new EditError('Moving this track would change a group: regroup first');
    if (reversed) rewrites.push([g, start, end]);
  }

  doc.remove(track);
  doc.add(mv, 'tracks', track, index);
  // a group whose two bounds swapped places keeps start before end
  for (const [g, start, end] of rewrites) {
    doc.set(g, PID.START_TRACK_ID, end);
    doc.set(g, PID.END_TRACK_ID, start);
  }
  return true;
}

/** Moves a track one step (dir −1 = up, +1 = down). Refused when it would cross a group boundary. Returns false at the edge. */
export function moveTrack(doc, mv, track, dir) {
  const from = mv.tracks.findIndex((t) => t.id === track.id);
  if (from < 0) throw new EditError('Unknown track');
  if (dir !== -1 && dir !== 1) throw new EditError('Invalid direction');
  const to = from + dir;
  if (to < 0 || to >= mv.tracks.length) return false;
  return moveTrackTo(doc, mv, track, to);
}

/**
 * Renames a track. The name is trimmed; an empty name goes back to the generic label ("Track n", chosen by the interface).
 * Returns false (and writes nothing, so no undo step) when the name does not change.
 */
export function renameTrack(doc, mv, track, name) {
  if (!mv.tracks.some((t) => t.id === track.id)) throw new EditError('Unknown track');
  if (typeof name !== 'string') throw new EditError('A track name must be a string');
  return doc.set(track, PID.NAME, name.trim());
}

/** Abbreviation (short name) of a track, as drawn on the systems after the first one; empty = none. */
export function setTrackAbbreviation(doc, mv, track, text) {
  if (!mv.tracks.some((t) => t.id === track.id)) throw new EditError('Unknown track');
  if (typeof text !== 'string') throw new EditError('An abbreviation must be a string');
  return doc.set(track, PID.ABBREVIATION, text.trim());
}

/** Icon of a track (glyph name of `icons.js`); null removes it. */
export function setTrackIcon(doc, mv, track, icon) {
  if (!mv.tracks.some((t) => t.id === track.id)) throw new EditError('Unknown track');
  if (icon === null || icon === undefined || icon === '') return doc.reset(track, PID.ICON);
  if (!isTrackIcon(icon)) throw new EditError(`Unknown icon: ${icon}`);
  return doc.set(track, PID.ICON, icon);
}

/** Which operations apply to a track / staff right now (the panel greys the others out). */
export function trackActions(mv, track) {
  const i = mv.tracks.findIndex((t) => t.id === track.id);
  return { canMoveUp: i > 0, canMoveDown: i >= 0 && i < mv.tracks.length - 1, canRemove: i >= 0 };
}
export function staffActions(mv, staff) {
  const track = trackOfStaff(mv, staff);
  const i = track ? track.staves.findIndex((s) => s.id === staff.id) : -1;
  return { canMoveUp: i > 0, canMoveDown: i >= 0 && i < track.staves.length - 1, canRemove: !!track && track.staves.length - linkedStavesOf(mv, staff).length > 1 };
}

export { allStaves };
