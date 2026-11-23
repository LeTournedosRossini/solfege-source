/*
 * Tracks and staves panel — intents without DOM (slice 1: list, add, remove, reorder).
 * Reads an outline of the work for the panel and wraps the pure model operations (`model/trackedit.js`), addressed by identifier.
 * Every write runs inside the caller's `doc.transaction` (see `Application`), so one gesture = one undoable step.
 */
import { nextVisualSolo } from './visual-solo.js';
import { PID, getProperty, trackTransposition, instrumentInfo, trackLayer, compositesOf, compositeStaffByMeasure } from '../model/index.js';
import { intervalOfSemitones } from '../model/transpose.js';
import { instrumentIconName } from '../model/instrument-icons.js';
import {
  addTrack, addTrackFromInstrument, addStaff, removeTrack, removeStaff, moveTrack, moveStaff, moveTrackTo, moveStaffTo, renameTrack, setTrackAbbreviation, setTrackIcon, trackActions, staffActions, CREATABLE_STAFF_TYPES, EditError,
} from '../model/trackedit.js';
import { playerOf, playerIsSilent, hasWrittenNotes, setPlayer, playerKindOf, isAccompanimentTrack, ACCOMPANIMENTS } from '../model/player.js';
import { sectionList } from '../model/sections.js';
import { autoStrumInstrument } from '../model/fretdiagram.js';
import { linkCandidates, planLink, linkStaff, unlinkStaff, isLinkedStaff, addLinkedStaff, canLink, linkTypesFor } from '../model/linkedstaff.js';
import { staffTypeChoices, planStaffTypeChange, changeStaffType } from '../model/stafftypeedit.js';
import { groupTracks, ungroup, setGroupStyle, setGroupLabel, setGroupBarlines, clearGroups, BRACKET_STYLES, walkGroups } from '../model/groupedit.js';
import { SCORE_ORDERS, applyScoreOrder, refreshAutoGroups, hasScoreOrder, tracksFollowOrder } from '../model/scoreorder.js';
import { SID } from '../model/sid.js';
import { addToActiveView, pruneViews } from '../model/viewedit.js';
import { variantOf, variantPeers, activeVariant, setVariantOf, setVariantLabel, clearVariant, selectVariant, nextVariantId } from '../model/variants.js';
import { ensureChordFirst, isChordTrack } from '../model/chordtrack.js';
import { addMovement, duplicateMovement, removeMovement, moveMovementTo, setCardText, setCardNumber, setCardNumberFormat, cardNumbers } from '../model/movementedit.js';

export { CREATABLE_STAFF_TYPES, BRACKET_STYLES, SCORE_ORDERS };
export { ICONS } from '../model/icons.js';

/**
 * Display transpositions offered for a track (instrument interval, WRITTEN → SOUNDING, MuseScore's convention: a B♭ clarinet is
 * { diatonic: -1, chromatic: -2 }: it sounds a major second below what is written). `none` = concert pitch, written as it sounds.
 */
export const TRANSPOSITION_PRESETS = Object.freeze([
  { id: 'none', diatonic: 0, chromatic: 0 },
  { id: 'bb', diatonic: -1, chromatic: -2 }, // B♭ clarinet / trumpet / soprano and tenor sax (the tenor an octave lower: bbLow)
  { id: 'a', diatonic: -2, chromatic: -3 }, // A clarinet
  { id: 'eb', diatonic: -5, chromatic: -9 }, // E♭ alto sax
  { id: 'f', diatonic: -4, chromatic: -7 }, // F horn, cor anglais
  { id: 'd', diatonic: 1, chromatic: 2 }, // D trumpet
  { id: 'ebHigh', diatonic: 2, chromatic: 3 }, // E♭ clarinet
  { id: 'bbLow', diatonic: -8, chromatic: -14 }, // B♭ tenor sax, bass clarinet
  { id: 'ebLow', diatonic: -12, chromatic: -21 }, // E♭ baritone sax
  { id: 'octaveDown', diatonic: -7, chromatic: -12 }, // guitar, bass, double bass
  { id: 'octaveUp', diatonic: 7, chromatic: 12 }, // piccolo, glockenspiel
]);

/** The farthest transposition offered, in semitones, up and down (one octave). What a catalogue instrument asks for beyond (tenor and baritone saxophones…) stays reachable by "follow the instrument". */
export const MAX_SEMITONES = 12;
/** Instruments that read at these transpositions (small text in the menu; the texts are in the catalogues, `tracks.transposeHint.<n>`). */
export const TRANSPOSITION_HINTS = Object.freeze([-2, -3, -5, -7, -9, -12, 2, 3, 12]);
export { intervalOfSemitones };
/** Choice id of an interval: `s:<semitones>` when it is the usual interval for that many semitones, else 'custom'. */
export const semitoneChoiceId = (iv) => {
  const n = iv?.chromatic ?? 0;
  const std = intervalOfSemitones(n);
  return std.diatonic === (iv?.diatonic ?? 0) ? `s:${n}` : 'custom';
};
/** The interval of a menu choice: `s:<semitones>` or the id of a preset; null for an unknown id. */
export function intervalOfChoice(id) {
  const m = /^s:(-?\d+)$/.exec(String(id));
  if (m) { const n = Number(m[1]); return Math.abs(n) <= MAX_SEMITONES ? intervalOfSemitones(n) : null; }
  const preset = TRANSPOSITION_PRESETS.find((p) => p.id === id);
  return preset ? { diatonic: preset.diatonic, chromatic: preset.chromatic } : null;
}
/**
 * Menu options of a display transposition: "follow" first, then EVERY semitone from +24 down to −24; the usual ones carry the name of the instrument
 * ("Si♭ (−2)"), the others just the number ("−5").
 */
export function transpositionOptions(label, { current = null } = {}) {
  const named = new Map(TRANSPOSITION_PRESETS.map((p) => [p.chromatic, p.id]));
  const text = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;
  const options = [['follow', label('tracks.transpose.follow'), label('tracks.transposeHint.follow')]];
  for (let n = MAX_SEMITONES; n >= -MAX_SEMITONES; n--) {
    const preset = named.get(n);
    options.push([`s:${n}`, preset && TRANSPOSITION_HINTS.includes(n) || n === 0 ? label(`tracks.transpose.${preset}`) : text(n), TRANSPOSITION_HINTS.includes(n) ? label(`tracks.transposeHint.${n}`) : undefined]);
  }
  // the current value when it is not in the list (an interval beyond the octave, or one that is not the usual one for its semitones): kept so that it shows as chosen
  if (current && !options.some(([v]) => v === current)) options.push([current, current === 'custom' ? label('tracks.transpose.custom') : text(Number(current.slice(2)))]);
  return options;
}

/** Preset id of an interval, or 'custom' (an interval that is not in the list). */
export const transpositionPresetId = (iv) => TRANSPOSITION_PRESETS.find((p) => p.diatonic === (iv?.diatonic ?? 0) && p.chromatic === (iv?.chromatic ?? 0))?.id ?? 'custom';

/** Error raised for a refused gesture (unknown id, forbidden move…); the message is for the developer, the UI shows its own text. */
export class TrackEditError extends Error {
  constructor(code, message) { super(message); this.name = 'TrackEditError'; this.code = code; }
}

const wrap = (fn) => {
  try { return fn(); } catch (e) {
    if (e instanceof EditError) throw new TrackEditError(/needs confirmation/i.test(e.message) ? 'confirm' : /only one chord track/i.test(e.message) ? 'oneChord' : /chord track stays|chord staff makes|holds only its chord/i.test(e.message) ? 'chordFirst' : /overlap another group/i.test(e.message) ? 'groupOverlap' : /contiguous/i.test(e.message) ? 'groupGap' : /group/i.test(e.message) ? 'group' : /at least one staff/i.test(e.message) ? 'lastStaff' : /at least one movement/i.test(e.message) ? 'lastMovement' : 'refused', e.message);
    throw e;
  }
};

function movementOfTrack(doc, trackId) {
  const track = doc.find(trackId);
  if (!track || track.type !== 'track') throw new TrackEditError('unknown', `Unknown track: ${trackId}`);
  return { mv: doc.movementOf(track), track };
}
/** Variant intents (model/variants.js): one gesture = one undo step. */
export function setVariantOfIntent(doc, trackId, baseId, label) { const { mv } = movementOfTrack(doc, trackId); setVariantOf(doc, mv, trackId, baseId, label); }
export function setVariantLabelIntent(doc, trackId, label) { const { mv } = movementOfTrack(doc, trackId); setVariantLabel(doc, mv, trackId, label); }
export function clearVariantIntent(doc, trackId) { const { mv } = movementOfTrack(doc, trackId); clearVariant(doc, mv, trackId); }
export function selectVariantIntent(doc, trackId) { const { mv } = movementOfTrack(doc, trackId); selectVariant(doc, mv, trackId); }
export function nextVariantIntent(doc, trackId) { const { mv } = movementOfTrack(doc, trackId); const id = nextVariantId(mv, trackId); if (id) selectVariant(doc, mv, id); }

function movementOfStaff(doc, staffId) {
  const staff = doc.find(staffId);
  if (!staff || staff.type !== 'staff') throw new TrackEditError('unknown', `Unknown staff: ${staffId}`);
  return { mv: doc.movementOf(staff), staff };
}

/**
 * Read-only outline: movements → tracks → staves, with what each row may do.
 * `name` is the track name as stored (may be empty: the UI then shows a generic label).
 */
/**
 * Shows or hides a TRACK or a STAFF on the score (`PID.VISIBLE`). A hidden staff is neither drawn nor given any room; it still plays.
 * Refused when it would leave no staff at all visible in the movement (`TrackEditError('lastVisible')`).
 */
/** Why a track / staff cannot be hidden: 'crossStaff' (a sibling staff draws its notes), 'lastVisible' (nothing else would stay visible) or null. */
export function hideRefusal(doc, id) {
  const el = doc.find(id);
  if (!el || (el.type !== 'track' && el.type !== 'staff')) return 'unknown';
  const mv = doc.movementOf(el);
  if (el.type === 'staff') {
    // a staff with a CROSS-STAFF component (a chord or rest drawn on a sibling staff, `PID.STAFF_MOVE`) cannot be hidden alone: hide the track
    const track = mv.tracks.find((t) => t.staves.some((s) => s.id === el.id));
    const crosses = track?.staves.some((st) => st.voices.some((v) => v.measures.some((m) => m.items.some((it) => (it.type === 'chord' || it.type === 'rest') && (getProperty(it, PID.STAFF_MOVE) ?? 0) !== 0))));
    if (crosses) return 'crossStaff';
  }
  const stillShown = mv.tracks.some((t) => t.id !== el.id && getProperty(t, PID.VISIBLE) !== false
    && t.staves.some((s) => s.id !== el.id && getProperty(s, PID.VISIBLE) !== false));
  return stillShown ? null : 'lastVisible';
}

export function setVisibleIntent(doc, id, visible) {
  const el = doc.find(id);
  if (!el || (el.type !== 'track' && el.type !== 'staff')) throw new TrackEditError('unknown', `Unknown track or staff: ${id}`);
  if (!visible) {
    const why = hideRefusal(doc, id);
    if (why === 'crossStaff') throw new TrackEditError('crossStaff', 'This track has cross-staff notes');
    if (why === 'lastVisible') throw new TrackEditError('lastVisible', 'At least one staff must stay visible');
    // hiding a staff hides everything it carries: the clefs, key / time signatures and barlines hidden one by one are shown again first, so the staff comes back clean
    for (const st of el.type === 'track' ? el.staves : [el]) if (getProperty(st, PID.HIDDEN_DECOR)?.length) doc.reset(st, PID.HIDDEN_DECOR);
  }
  doc.set(el, PID.VISIBLE, Boolean(visible));
}

const isShown = (el) => getProperty(el, PID.VISIBLE) !== false;
/** Is `trackId` the only track shown in its movement? */
export function visualSoloActive(doc, trackId) {
  const { mv } = movementOfTrack(doc, trackId);
  const shown = mv.tracks.filter(isShown);
  return shown.length === 1 && shown[0].id === trackId;
}
/**
 * Visual solo of a track (a long press on its eye): only this track stays shown; the same call again puts back what was shown. `memory` is what the previous call returned
 * (`{ movementId, shown: ids shown before, staves: Map(staff id → was shown) }`, kept by the caller, never in the document). → { memory, active }. Call inside a transaction.
 */
export function visualSoloIntent(doc, trackId, memory = null) {
  const { mv } = movementOfTrack(doc, trackId);
  const all = mv.tracks.map((t) => t.id);
  const own = memory && memory.movementId === mv.id ? memory : null;
  const next = nextVisualSolo({ all, shown: mv.tracks.filter(isShown).map((t) => t.id), target: [trackId], saved: own?.shown ?? null });
  const staves = own?.staves ?? new Map();
  for (const t of mv.tracks) doc.set(t, PID.VISIBLE, next.shown.includes(t.id));
  if (next.active) {
    const target = mv.tracks.find((t) => t.id === trackId);
    for (const st of target.staves) { if (!staves.has(st.id)) staves.set(st.id, isShown(st)); doc.set(st, PID.VISIBLE, true); }
    return { memory: { movementId: mv.id, shown: next.saved, staves }, active: true };
  }
  for (const [id, was] of staves) { const e = doc.find(id); if (e) doc.set(e, PID.VISIBLE, was); }
  return { memory: null, active: false };
}

export function tracksOutline(doc) {
  const cards = cardNumbers(doc.work);
  return doc.work.movements.map((mv, movementIndex) => ({
    id: mv.id,
    movementIndex,
    title: getProperty(mv, PID.TITLE) ?? '',
    description: getProperty(mv, PID.DESCRIPTION) ?? '',
    cardNumber: cards[movementIndex].number,
    cardForced: cards[movementIndex].forced,
    cardFormat: getProperty(doc.work, PID.CARD_NUMBER_FORMAT),
    canRemove: doc.work.movements.length > 1,
    measures: mv.masterbars.length,
    groupOrder: getProperty(mv, PID.GROUP_ORDER) ?? 'custom',
    groupLabels: doc.getStyle(mv, SID.GROUP_LABELS),
    system: {
      visible: doc.getStyle(mv, SID.SHOW_SYSTEM_OBJECTS) !== false,
      count: ['tempos', 'tempoChanges', 'fermatas', 'swings', 'jumps', 'markers', 'voltas', 'rehearsalMarks'].reduce((n, k) => n + (mv[k]?.length ?? 0), 0),
    },
    names: {
      show: doc.getStyle(mv, SID.SHOW_INSTRUMENT_NAMES), first: doc.getStyle(mv, SID.INSTRUMENT_NAME_FIRST),
      next: doc.getStyle(mv, SID.INSTRUMENT_NAME_NEXT), hideIfOne: doc.getStyle(mv, SID.HIDE_INSTRUMENT_NAME_IF_ONE),
    },
    groups: mv.groups.map(function outlineGroup(g) {
      return {
        id: g.id, from: mv.tracks.findIndex((t) => t.id === getProperty(g, PID.START_TRACK_ID)), to: mv.tracks.findIndex((t) => t.id === getProperty(g, PID.END_TRACK_ID)),
        style: getProperty(g, PID.BRACKET_STYLE), label: getProperty(g, PID.LABEL) ?? '', barlines: getProperty(g, PID.GROUP_BARLINES), groups: g.groups.map(outlineGroup),
      };
    }),
    tracks: mv.tracks.map((track, index) => ({
      id: track.id,
      index,
      name: getProperty(track, PID.NAME) ?? '',
      abbreviation: getProperty(track, PID.ABBREVIATION) ?? '',
      icon: getProperty(track, PID.ICON) ?? null,
      // display transposition: the track's own interval when set, else the catalogue's (see `trackTransposition`)
      transposition: { ...trackTransposition(track), preset: transpositionPresetId(trackTransposition(track)), own: getProperty(track, PID.TRANSPOSITION) != null },
      instrumentIcon: (() => { const id = getProperty(track, PID.INSTRUMENT_ID); return id ? instrumentIconName(id, instrumentInfo(id)) : null; })(),
      hasNotation: track.staves.some((st) => getProperty(st, PID.STAFF_TYPE) === 'score'),
      linkTypes: [...new Set(track.staves.filter((st) => !isLinkedStaff(st)).flatMap((st) => linkTypesFor(getProperty(st, PID.STAFF_TYPE))))], // linked staves the track can get
      visible: getProperty(track, PID.VISIBLE) !== false,
      variant: (() => {
        const v = variantOf(track), peers = variantPeers(mv, track);
        return v && peers.length > 1 ? { label: v.label, active: activeVariant(mv, track)?.id === track.id, peers: peers.map((t) => ({ id: t.id, label: variantOf(t).label, name: getProperty(t, PID.NAME) ?? '' })) } : null;
      })(),
      composites: compositesOf(track).map((c) => ({ id: c.id, name: c.name, base: c.base, equal: c.equal === 'tallest' ? 'tallest' : c.equal ? 'notation' : false, junction: c.junction ?? false, junctionClef: c.junctionClef === true, shown: compositeStaffByMeasure(mv, track, c) })), // the composite staves of the track; `shown` = the staff shown at each measure
      display: trackLayer(track), // own display layer of the track (screen 1): { showBars?, sizePct? }
      sizeable: true, // the size in % acts on every staff
      lyrics: track.staves.some((st) => getProperty(st, PID.STAFF_TYPE) === 'lyrics'), // the lyrics track of events: the panel offers its editing window
      chord: isChordTrack(track), // the chord track stays the first track (cannot be dragged) stays the first track (cannot be dragged)
      accompaniment: isAccompanimentTrack(track), // a player and no written notes: the tracks panel shows it in its own zone
      // the automatic player of the track (model/player.js), as plain values for the panel
      player: (() => { const p = playerOf(track); return { pattern: p?.pattern ?? null, card: p?.card ?? null, instrument: p?.instrument ?? 'auto', auto: ((a) => (a === 'piano' ? 'guitar' : a))(autoStrumInstrument(track)), active: p ? p.active : true, written: hasWrittenNotes(track), silent: !!p && playerIsSilent(track), seed: p?.seed ?? 0, kind: playerKindOf(track),
        rules: (p?.rules ?? []).map((r) => ({ ...r, where: { ...r.where } })), sections: [...new Set(sectionList(mv).map((x) => x.label || x.category))] }; })(),
      ...trackActions(mv, track),
      staves: track.staves.map((staff, k) => ({
        id: staff.id,
        index: k,
        type: getProperty(staff, PID.STAFF_TYPE),
        visible: getProperty(staff, PID.VISIBLE) !== false,
        ...staffActions(mv, staff),
        types: staffTypeChoices(mv, staff),
        linked: isLinkedStaff(staff),
        linkTypes: isLinkedStaff(staff) ? [] : linkTypesFor(getProperty(staff, PID.STAFF_TYPE)),
        linkTargets: linkCandidates(mv, staff).map((t) => t.id),
      })),
    })),
  }));
}

/**
 * Runs a change of the tracks; when the movement groups its tracks automatically (a score order), the groups are cleared first (so a
 * move is not refused for crossing one) and rebuilt afterwards from the new tracks.
 */
function withAutoGroups(doc, mv, fn, { sort = false } = {}) {
  const auto = getProperty(mv, PID.GROUP_ORDER);
  const isAuto = auto && auto !== 'custom' && hasScoreOrder(auto);
  if (isAuto) clearGroups(doc, mv);
  const result = fn();
  ensureChordFirst(doc, mv);
  if (isAuto) { refreshAutoGroups(doc, mv, { sort }); ensureChordFirst(doc, mv); }
  return result;
}

/**
 * Moving a track in an automatic grouping: when the new order still follows the score order the groups are rebuilt as usual; otherwise
 * the movement leaves the automatic mode (MuseScore: the order becomes "Customized") and the move follows the manual rules.
 */
function moveWithAuto(doc, mv, track, index, doMove) {
  const auto = getProperty(mv, PID.GROUP_ORDER);
  if (!auto || auto === 'custom' || !hasScoreOrder(auto)) return doMove();
  const after = mv.tracks.filter((t) => t.id !== track.id);
  after.splice(Math.max(0, Math.min(index, after.length)), 0, track);
  if (tracksFollowOrder(after, auto)) return withAutoGroups(doc, mv, doMove);
  doc.set(mv, PID.GROUP_ORDER, 'custom');
  return doMove();
}

/** spec: { movement (index, default 0), staves: [{ type, clef? }], name?, at? } → the new track id. */
export function addTrackIntent(doc, { movement = 0, staves = [{ type: 'score' }], name = '', at } = {}) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  const join = addToActiveView(doc, mv);
  return wrap(() => { const id = withAutoGroups(doc, mv, () => addTrack(doc, mv, { staves, name, at }).id, { sort: true }); join({ trackId: id }); return id; });
}
/** Adds a track made from a catalogue instrument id (see `addTrackFromInstrument`) → the new track id. */
export function addInstrumentTrackIntent(doc, instrumentId, { movement = 0, at, lang, linkedTab = false, linkedNotation = null, scorsaireKit = false, name } = {}) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  const join = addToActiveView(doc, mv);
  return wrap(() => {
    const id = withAutoGroups(doc, mv, () => {
      const track = addTrackFromInstrument(doc, mv, instrumentId, { at, lang, name });
      // `scorsaireKit`: the percussion staves keep no map of their own, so they use the default « Scorsaire Drum Kit »
      if (scorsaireKit) for (const st of track.staves) if (getProperty(st, PID.STAFF_TYPE) === 'percussion' && st.props[PID.PERCMAP] !== undefined) doc.reset(st, PID.PERCMAP);
      // `linkedTab`: a tablature LINKED to the first notation staff (notation + tablature from one content)
      if (linkedTab) { const primary = track.staves.find((st) => !isLinkedStaff(st) && canLink(getProperty(st, PID.STAFF_TYPE), 'tab')); if (primary) addLinkedStaff(doc, mv, primary, { type: 'tab' }); }
      // `linkedNotation` ({ clef }): a notation staff LINKED to the first tablature, placed above it (the tablature holds the content: it is the one to write in)
      if (linkedNotation) { const primary = track.staves.find((st) => !isLinkedStaff(st) && getProperty(st, PID.STAFF_TYPE) === 'tab'); if (primary) addLinkedStaff(doc, mv, primary, { type: 'score', clef: linkedNotation.clef ?? 'G', before: true }); }
      return track.id;
    }, { sort: true });
    join({ trackId: id });
    return id;
  });
}
/** Adds a staff LINKED to the first notation staff of the track (`type`: 'tab' | 'rhythm') → the new staff id. */
export function addLinkedStaffIntent(doc, trackId, type = 'tab') {
  const { mv, track } = movementOfTrack(doc, trackId);
  const primary = track.staves.find((st) => !isLinkedStaff(st) && canLink(getProperty(st, PID.STAFF_TYPE), type));
  if (!primary) throw new TrackEditError('refused', 'The track has no staff this kind of staff can be linked to');
  const join = addToActiveView(doc, mv);
  return wrap(() => { const id = withAutoGroups(doc, mv, () => addLinkedStaff(doc, mv, primary, { type }).id); join({ staffId: id }); return id; });
}
export function addStaffIntent(doc, trackId, { type = 'score', clef = 'G', at } = {}) {
  const { mv, track } = movementOfTrack(doc, trackId);
  const join = addToActiveView(doc, mv);
  return wrap(() => { const id = withAutoGroups(doc, mv, () => addStaff(doc, mv, track, { type, clef, at }).id); join({ staffId: id }); return id; });
}
export function removeTrackIntent(doc, trackId) {
  const { mv, track } = movementOfTrack(doc, trackId);
  return wrap(() => { const r = withAutoGroups(doc, mv, () => removeTrack(doc, mv, track)); pruneViews(doc, mv); return r; });
}
export function removeStaffIntent(doc, staffId) {
  const { mv, staff } = movementOfStaff(doc, staffId);
  return wrap(() => { const r = withAutoGroups(doc, mv, () => removeStaff(doc, mv, staff)); pruneViews(doc, mv); return r; });
}
export function moveTrackIntent(doc, trackId, dir) {
  const { mv, track } = movementOfTrack(doc, trackId);
  const to = mv.tracks.findIndex((t) => t.id === trackId) + dir;
  return wrap(() => moveWithAuto(doc, mv, track, to, () => moveTrack(doc, mv, track, dir)));
}
export function moveStaffIntent(doc, staffId, dir) {
  const { mv, staff } = movementOfStaff(doc, staffId);
  return wrap(() => moveStaff(doc, mv, staff, dir));
}
/** Drag and drop: moves a track to the final index `index` of its movement (any distance, one step). Refused when a group would change. */
export function moveTrackToIntent(doc, trackId, index) {
  const { mv, track } = movementOfTrack(doc, trackId);
  return wrap(() => moveWithAuto(doc, mv, track, index, () => moveTrackTo(doc, mv, track, index)));
}
/** Drag and drop: moves a staff to the final index `index` inside its own track. */
export function moveStaffToIntent(doc, staffId, index) {
  const { mv, staff } = movementOfStaff(doc, staffId);
  return wrap(() => moveStaffTo(doc, mv, staff, index));
}
/** Read-only plan of a staff type change: { from, to, confirm: [codes], outOfRange, unmapped, notes, chords }. */
export function planStaffTypeIntent(doc, staffId, to) {
  const { mv, staff } = movementOfStaff(doc, staffId);
  return wrap(() => planStaffTypeChange(mv, staff, to));
}
/** Converts a staff; `options` = the user's answers (see `changeStaffType`). Throws TrackEditError('confirm') when an answer is missing. */
export function changeStaffTypeIntent(doc, staffId, to, options = {}) {
  const { mv, staff } = movementOfStaff(doc, staffId);
  return wrap(() => changeStaffType(doc, mv, staff, to, options));
}
/** Read-only plan of linking a tablature to a notation staff: { same, mismatches }. */
export function planLinkIntent(doc, tabId, primaryId) {
  const { mv, staff } = movementOfStaff(doc, tabId);
  const primary = doc.find(primaryId);
  if (!primary) throw new TrackEditError('unknown', 'Unknown staff');
  const plan = planLink(mv, staff, primary);
  return { same: plan.same, mismatches: plan.mismatches };
}
/** Links a tablature to a notation staff (`force`: replace its content even when it differs). */
export function linkStaffIntent(doc, tabId, primaryId, { force = false } = {}) {
  const { mv, staff } = movementOfStaff(doc, tabId);
  const primary = doc.find(primaryId);
  if (!primary) throw new TrackEditError('unknown', 'Unknown staff');
  return wrap(() => { linkStaff(doc, mv, staff, primary, { force }); return true; });
}
/** Unlinks a staff: it keeps a copy of what it showed. */
export function unlinkStaffIntent(doc, staffId) {
  const { mv, staff } = movementOfStaff(doc, staffId);
  return wrap(() => { unlinkStaff(doc, mv, staff); return true; });
}
/** Sets the track name (trimmed; empty = generic label). Returns false when the name does not change (no undo step). */
export function renameTrackIntent(doc, trackId, name) {
  const { mv, track } = movementOfTrack(doc, trackId);
  return wrap(() => renameTrack(doc, mv, track, name));
}

// ---------- groups (brackets) ----------
function findGroup(doc, groupId) {
  const group = doc.find(groupId);
  if (!group || group.type !== 'group') throw new TrackEditError('unknown', `Unknown group: ${groupId}`);
  return { mv: doc.movementOf(group), group };
}
/** Groups contiguous tracks of one movement: { style?, label?, barlines? } → the new group id. Switches the movement to manual grouping. */
export function groupTracksIntent(doc, trackIds, options = {}) {
  if (!trackIds.length) throw new TrackEditError('refused', 'No track');
  const { mv } = movementOfTrack(doc, trackIds[0]);
  for (const id of trackIds) if (movementOfTrack(doc, id).mv !== mv) throw new TrackEditError('refused', 'Tracks of different movements');
  return wrap(() => groupTracks(doc, mv, trackIds, options).id);
}
export function ungroupIntent(doc, groupId) {
  const { mv, group } = findGroup(doc, groupId);
  return wrap(() => ungroup(doc, mv, group));
}
export function setGroupStyleIntent(doc, groupId, style) {
  const { mv, group } = findGroup(doc, groupId);
  return wrap(() => setGroupStyle(doc, mv, group, style));
}
export function setGroupLabelIntent(doc, groupId, label) {
  const { mv, group } = findGroup(doc, groupId);
  return wrap(() => setGroupLabel(doc, mv, group, label));
}
export function setGroupBarlinesIntent(doc, groupId, on) {
  const { mv, group } = findGroup(doc, groupId);
  return wrap(() => setGroupBarlines(doc, mv, group, on));
}
/** Chooses how the groups of a movement are made: a score order id (groups built now, then following the tracks) or 'custom' (by hand). */
export function setGroupOrderIntent(doc, movement, orderId) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  return wrap(() => {
    if (orderId === 'custom') { doc.set(mv, PID.GROUP_ORDER, 'custom'); return; }
    if (!hasScoreOrder(orderId)) throw new TrackEditError('unknown', `Unknown score order: ${orderId}`);
    applyScoreOrder(doc, mv, orderId, { sort: true });
  });
}
/** Shows or hides the group labels next to the brackets (a style of the movement). */
export function setGroupLabelsIntent(doc, movement, on) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  doc.setStyle(mv, SID.GROUP_LABELS, Boolean(on));
}
void walkGroups;

export function setTrackAbbreviationIntent(doc, trackId, text) {
  const { mv, track } = movementOfTrack(doc, trackId);
  return wrap(() => setTrackAbbreviation(doc, mv, track, text));
}
export function setTrackIconIntent(doc, trackId, icon) {
  const { mv, track } = movementOfTrack(doc, trackId);
  return wrap(() => setTrackIcon(doc, mv, track, icon));
}
/** Display transposition of a track: a preset id, or null = follow the instrument (the catalogue interval). */
export function setTrackTranspositionIntent(doc, trackId, presetId) {
  const { track } = movementOfTrack(doc, trackId);
  return wrap(() => {
    if (presetId === null || presetId === undefined) { if (getProperty(track, PID.TRANSPOSITION) != null) doc.reset(track, PID.TRANSPOSITION); return; }
    const interval = intervalOfChoice(presetId);
    if (!interval) throw new TrackEditError('unknown', `Unknown transposition: ${presetId}`);
    doc.set(track, PID.TRANSPOSITION, interval);
  });
}
/** patch: { show?, first?, next?, hideIfOne? } — how the track names are written on the score (styles of the movement). */
export function setNameStyleIntent(doc, movement, patch) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  const MODES = ['long', 'short', 'icon', 'none'];
  if (patch.first !== undefined && !MODES.includes(patch.first)) throw new TrackEditError('refused', 'Unknown name mode');
  if (patch.next !== undefined && !MODES.includes(patch.next)) throw new TrackEditError('refused', 'Unknown name mode');
  if (patch.show !== undefined) doc.setStyle(mv, SID.SHOW_INSTRUMENT_NAMES, Boolean(patch.show));
  if (patch.first !== undefined) doc.setStyle(mv, SID.INSTRUMENT_NAME_FIRST, patch.first);
  if (patch.next !== undefined) doc.setStyle(mv, SID.INSTRUMENT_NAME_NEXT, patch.next);
  if (patch.hideIfOne !== undefined) doc.setStyle(mv, SID.HIDE_INSTRUMENT_NAME_IF_ONE, Boolean(patch.hideIfOne));
}

/** Shows or hides the system objects (tempo, repeats, jumps, markers, voltas, fermatas, swings, rehearsal marks) of a movement on the score. */
export function setSystemVisibleIntent(doc, movement, visible) {
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  doc.setStyle(mv, SID.SHOW_SYSTEM_OBJECTS, Boolean(visible));
}

// ---------- movements (cards of a sheet) ----------
function movementById(doc, id) {
  const mv = doc.work.movements.find((m) => m.id === id);
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${id}`);
  return mv;
}
/** spec: { from (movement id, keeps its tracks with empty measures), measures, title, at (index) } → the new movement id. */
export function addMovementIntent(doc, { from = null, measures = 1, title = '', at } = {}) {
  const ref = from ? movementById(doc, from) : null;
  return wrap(() => addMovement(doc, { from: ref, measures, title, at }).id);
}
export function duplicateMovementIntent(doc, id) { return wrap(() => duplicateMovement(doc, movementById(doc, id)).id); }
export function removeMovementIntent(doc, id) { return wrap(() => removeMovement(doc, movementById(doc, id))); }
/** Drag and drop / list: moves a movement to the final index `index`. */
export function moveMovementToIntent(doc, id, index) { return wrap(() => moveMovementTo(doc, movementById(doc, id), index)); }
export function setCardTextIntent(doc, id, patch) { return wrap(() => setCardText(doc, movementById(doc, id), patch)); }
export function setCardNumberIntent(doc, id, text) { return wrap(() => setCardNumber(doc, movementById(doc, id), text)); }
export function setCardNumberFormatIntent(doc, format) { return wrap(() => setCardNumberFormat(doc, format)); }

/** Sets the automatic player of a track from a partial change { pattern?, card?, instrument?, active? } (see `setPlayer`). */
export function setTrackPlayerIntent(doc, trackId, patch) {
  const track = doc.find(trackId);
  if (!track || track.type !== 'track') throw new TrackEditError('unknown', `Unknown track: ${trackId}`);
  return wrap(() => setPlayer(doc, track, patch));
}

/**
 * Adds an accompaniment to the movement: a track of the instrument of the role ('piano', 'guitar', 'bass') with an automatic player (a pattern and a card), its staves hidden so that
 * nothing is drawn (it still plays, and the track has its own mixer strip). The chords come from the movement's chord track. → the new track id.
 */
export function addAccompanimentIntent(doc, role, { movement = 0, lang } = {}) {
  const preset = ACCOMPANIMENTS[role];
  if (!preset) throw new TrackEditError('unknown', `Unknown accompaniment: ${role}`);
  const mv = doc.work.movements[movement];
  if (!mv) throw new TrackEditError('unknown', `Unknown movement: ${movement}`);
  const join = addToActiveView(doc, mv);
  return wrap(() => {
    const id = withAutoGroups(doc, mv, () => {
      const track = addTrackFromInstrument(doc, mv, preset.instrument, { lang });
      setPlayer(doc, track, { pattern: preset.pattern, card: preset.card });
      if (!hideRefusal(doc, track.id)) doc.set(track, PID.VISIBLE, false);
      return track.id;
    }, { sort: true });
    join({ trackId: id });
    return id;
  });
}
