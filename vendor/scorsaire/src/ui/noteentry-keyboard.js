/*
 * Saisie de notes AU CLAVIER : intentions SANS DOM, à appeler dans `doc.transaction` (via `Application.keyboardEntry`).
 *
 * Port du comportement de MuseScore 4.7.5 (lus : `editing/cmd.cpp` `Score::resolveNoteInputParams`, `cmdAddPitch`, `upDownChromatic`,
 * `Score::upDown` ; `dom/input.cpp`) :
 *  - UNE LETTRE (A-G) pose une note à la position du curseur, REMPLAÇANT ce qui s'y trouve (`putNote(pos, replace = true)`), puis le curseur
 *    avance d'une durée ; Maj + lettre AJOUTE une note à l'accord sélectionné, au-dessus de sa note la plus haute, sans avancer ;
 *  - OCTAVE de la lettre (`resolveNoteInputParams`) : on part de la note la plus BASSE de l'accord précédent de la voix (sans son altération) ;
 *    sans accord précédent (ou si la clé a changé depuis) : la ligne du milieu de la portée ; on choisit l'octave qui met la lettre à moins d'un
 *    triton (≤ 6 demi-tons) de cette référence ; en mode « ajout » : au-dessus de la note la plus haute de l'accord ;
 *  - altération : celle de l'armure ou déjà posée dans la mesure, sauf touche ♭ ♮ ♯ (`entry.accidental`, consommée par la note posée) ;
 *  - SILENCE (touche 0) : `enterRest` à la position du curseur puis avance ; SUPPRIMER : retire la note sélectionnée (accord de plusieurs notes) ou
 *    remplace l'accord / le silence par un silence, le curseur reste ;
 *  - ↑ ↓ : demi-ton avec les règles d'orthographe de `upDownChromatic` (tpc) ; Ctrl + ↑ ↓ : octave (hauteur < 116 en montant, > 11 en descendant).
 * Limites : portées de notation (`score`) seulement pour les lettres et ↑ ↓ ; instrument transpositeur refusé ; tablature / percussion : voir la souris.
 */
import {
  PID, getProperty, staffSoundMap, midiFromSpelling, diatonicIndex, fAdd, fCmp, deleteItem, removeNoteFromChord, measureOffsetOf, isLinkedStaff, primaryOf,
  defaultSpelling, convertPitch, capoFretShift, projectedStrings, linkedStavesOf,
} from '../model/index.js';
import { CLEF_DEFS } from '../layout/constants.js';
import { clefTimeline, clefAt } from '../layout/clefchanges.js';
import { keySigAlters } from '../layout/accidentals.js';
import { staffLineCount } from '../layout/painters/common.js';
import { enterNote, NoteEntryError, slotsOf, accidentalState, voiceForEntry, writtenContext, writtenOf, tabContextAt } from './noteentry-intents.js';
import { SID } from '../model/sid.js';
import { tieMates } from '../model/tiechain.js';
import { voiceSlots, cursorOfElement, nextInputPos, nominalOf, itemAtCursor, prevInputPos, normalizeCursor } from './noteentry-cursor.js';

const STEP_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function scoreStaffOf(doc, cursor) {
  const staff = doc.find(cursor?.staffId);
  if (!staff || staff.type !== 'staff') throw new NoteEntryError('noCursor', 'Pas de curseur de saisie');
  if (getProperty(staff, PID.STAFF_TYPE) !== 'score') throw new NoteEntryError('unsupportedKeyboard', 'Saisie au clavier : portée de notation seulement');
  return staff;
}

/** Hauteur MIDI naturelle (sans altération) de la ligne du milieu (ligne 4 de MuseScore) pour une clé. */
function middleLinePitch(staff, clefKey) {
  const clef = CLEF_DEFS[clefKey];
  const index = diatonicIndex(clef.bottomLine) + 2 * (staffLineCount(staff) - 1) - 4;
  return midiFromSpelling({ step: STEPS[((index % 7) + 7) % 7], alter: 0, octave: Math.floor(index / 7) });
}

/** Note la plus basse / la plus haute d'un accord (par hauteur). */
const lowest = (chord) => chord.notes.reduce((a, b) => (getProperty(b, PID.PITCH) < getProperty(a, PID.PITCH) ? b : a));
const highest = (chord) => chord.notes.reduce((a, b) => (getProperty(b, PID.PITCH) > getProperty(a, PID.PITCH) ? b : a));
const natural = (note, wctx = null) => { const w = writtenOf(wctx, note); return w.pitch - (w.spelling.alter ?? 0); };

/**
 * Degré diatonique absolu (`octave * 7 + degré`, octave scientifique) d'une lettre tapée (`note` 0 = do … 6 = si).
 * `addTo` : note sélectionnée (mode ajout) ; sinon le curseur donne la référence (accord précédent de la voix, ou la clé).
 */
export function letterIndex(doc, cursor, note, { addTo = null } = {}) {
  const staff = scoreStaffOf(doc, cursor);
  if (addTo) {
    const chord = doc.parentOf(addTo.id);
    const top = highest(chord);
    const wctx0 = writtenContext(doc, staff, doc.movementOf(staff), cursor.measureIndex);
    const sp = writtenOf(wctx0, top).spelling;
    let octave = Math.floor(natural(top, wctx0) / 12);
    if (note <= STEPS.indexOf(sp.step)) octave += 1;
    return (octave - 1) * 7 + note;
  }
  const movement = doc.movementOf(staff);
  const timeline = clefTimeline(staff, movement, Boolean(doc.getStyle(movement, SID.CONCERT_PITCH)));
  const clefHere = clefAt(timeline, cursor.measureIndex, nominalOf(doc, cursor));
  let curPitch = null;
  for (let mi = cursor.measureIndex; mi >= 0 && curPitch === null; mi -= 1) {
    const slots = voiceSlots(doc, cursor.staffId, cursor.voice, mi)
      .filter((s) => (mi < cursor.measureIndex || fCmp(s.start, cursor.position) < 0) && s.item.type === 'chord');
    const last = slots[slots.length - 1];
    if (!last) continue;
    // une clé différente entre cet accord et le curseur : MuseScore repart de la clé (changement réel de clé rencontré en remontant)
    const nominal = fAdd(last.start, measureOffsetOf(movement.masterbars[mi], mi === 0));
    if (clefAt(timeline, mi, nominal) === clefHere) curPitch = natural(lowest(last.item), writtenContext(doc, staff, movement, mi));
    break;
  }
  if (curPitch === null) curPitch = middleLinePitch(staff, clefHere);
  let octave = Math.floor(curPitch / 12);
  const delta = octave * 12 + STEP_SEMITONE[note] - curPitch;
  if (delta > 6) octave -= 1;
  else if (delta < -6) octave += 1;
  return (octave - 1) * 7 + note;
}

const advance = (doc, cursor) => nextInputPos(doc, cursor).cursor;

/**
 * Lettre tapée. `note` 0-6 (do … si). Sans `add` : remplace à la position du curseur puis avance. Avec `add` : ajoute à l'accord de la note
 * sélectionnée (`selected`), sans avancer. Retourne { select, cursor, action }.
 */
export function enterLetter(doc, entry, cursor, note, { add = false, selected = null } = {}) {
  scoreStaffOf(doc, cursor);
  if (add && selected?.type === 'note') {
    const at = cursorOfElement(doc, selected.id);
    if (!at) throw new NoteEntryError('noCursor', 'Note sélectionnée introuvable');
    const chord = doc.parentOf(selected.id);
    const hit = { staffId: at.staffId, measureIndex: at.measureIndex, position: at.position, index: letterIndex(doc, at, note, { addTo: selected }) };
    const duration = getProperty(chord, PID.DURATION);
    const r = enterNote(doc, hit, { ...entry, rest: false, replace: false, voice: at.voice, duration: { base: duration.base, dots: duration.dots ?? 0 } });
    return { select: r.select, cursor, action: r.action };
  }
  const hit = { staffId: cursor.staffId, measureIndex: cursor.measureIndex, position: cursor.position, index: letterIndex(doc, cursor, note) };
  const r = enterNote(doc, hit, { ...entry, rest: false, replace: true, voice: cursor.voice });
  return { select: r.select, cursor: advance(doc, cursor), action: r.action };
}

/**
 * Touche de batterie (percussion) : le son `soundId` de la carte de la portée à la position du curseur. Même geste qu'un clic sur la ligne du
 * son : la note va dans la voix DE SON SON et le curseur la suit. Sans `add` : remplace et avance ; avec `add` (Maj) : ajoute à l'accord
 * sélectionné (sa position, sa durée), sans avancer — comme `cmdAddPitch(addFlag)`.
 */
export function enterDrumSound(doc, entry, cursor, soundId, { add = false, selected = null } = {}) {
  const staff = doc.find(cursor?.staffId);
  if (!staff || staff.type !== 'staff') throw new NoteEntryError('noCursor', 'Pas de curseur de saisie');
  if (getProperty(staff, PID.STAFF_TYPE) !== 'percussion') throw new NoteEntryError('unsupportedKeyboard', 'Touche de batterie : portée de percussion seulement');
  const sound = staffSoundMap(getProperty(staff, PID.PERCMAP)).sounds.find((x) => x.id === soundId);
  if (!sound) throw new NoteEntryError('noSound', `Son « ${soundId} » absent de la carte de cette portée`);
  const base = { ...entry, rest: false, sound: sound.id };
  if (add && (selected?.type === 'percnote' || selected?.type === 'chord')) {
    const at = cursorOfElement(doc, selected.id);
    if (!at) throw new NoteEntryError('noCursor', 'Note sélectionnée introuvable');
    const chord = selected.type === 'chord' ? selected : doc.parentOf(selected.id);
    const duration = getProperty(chord, PID.DURATION);
    const hit = { staffId: at.staffId, measureIndex: at.measureIndex, position: at.position, line: sound.line };
    const r = enterNote(doc, hit, { ...base, replace: false, voice: at.voice, duration: { base: duration.base, dots: duration.dots ?? 0 } });
    return { select: r.select, cursor, action: r.action };
  }
  const hit = { staffId: cursor.staffId, measureIndex: cursor.measureIndex, position: cursor.position, line: sound.line };
  const r = enterNote(doc, hit, { ...base, replace: true, voice: cursor.voice });
  const placed = { staffId: hit.staffId, measureIndex: hit.measureIndex, position: hit.position, voice: voiceForEntry(doc, hit, base) };
  return { select: r.select, cursor: nextInputPos(doc, placed).cursor, action: r.action };
}

/**
 * Frette tapée (tablature, saisie au clavier) : la frette `fret` sur la corde `string` (1 = la plus aiguë) à la position du curseur, comme
 * `Score::cmdAddFret` (MuseScore 4.7.5, lu : `Position.line = physStringToVisual(is.string())`, `fret` donnée, hauteur par `getPitch`, capo compris).
 * Sans `add` : remplace et le curseur avance ; avec `add` (Maj + lettre) : ajoute à l'accord sélectionné (sa position, sa durée), sans avancer.
 * Une frette hors de la plage de l'instrument est refusée (message), jamais tronquée en silence.
 */
export function enterFret(doc, entry, cursor, fret, { string = 1, add = false, selected = null } = {}) {
  const staff = doc.find(cursor?.staffId);
  if (!staff || staff.type !== 'staff') throw new NoteEntryError('noCursor', 'Pas de curseur de saisie');
  if (getProperty(staff, PID.STAFF_TYPE) !== 'tab') throw new NoteEntryError('unsupportedKeyboard', 'Frette : portée de tablature seulement');
  const line = Math.max(0, string - 1);
  const base = { ...entry, rest: false, fret };
  const linked = isLinkedStaff(staff);
  if (add && (selected?.type === 'tabnote' || (linked && selected?.type === 'note') || selected?.type === 'chord')) {
    const at = cursorOfElement(doc, selected.id);
    if (!at) throw new NoteEntryError('noCursor', 'Note sélectionnée introuvable');
    // the selected chord belongs to the primary staff of a linked tablature: the gesture stays on the tablature (its strings)
    if (linked && primaryOf(doc.movementOf(staff), staff)?.id === at.staffId) at.staffId = cursor.staffId;
    const chord = selected.type === 'chord' ? selected : doc.parentOf(selected.id);
    const duration = getProperty(chord, PID.DURATION);
    const hit = { staffId: at.staffId, measureIndex: at.measureIndex, position: at.position, line };
    const r = enterNote(doc, hit, { ...base, replace: false, voice: at.voice, duration: { base: duration.base, dots: duration.dots ?? 0 } });
    return { select: r.select, cursor, action: r.action };
  }
  const hit = { staffId: cursor.staffId, measureIndex: cursor.measureIndex, position: cursor.position, line };
  const r = enterNote(doc, hit, { ...base, replace: true, voice: cursor.voice });
  return { select: r.select, cursor: advance(doc, cursor), action: r.action };
}

/**
 * Style « Guitar Pro » : une frette sur la corde `string` pour l'accord qui est AU curseur (la note rejoint cet accord, ou change de frette si la corde y est déjà) ; sans accord au
 * curseur (un silence, rien) un accord neuf prend sa place. Le curseur RESTE : on tape une autre corde et une autre frette pour faire un accord, → pour avancer.
 */
export function enterFretStay(doc, entry, cursor, fret, { string = 1 } = {}) {
  const item = itemAtCursor(doc, cursor);
  if (item && item.type === 'chord' && !isGapRest(item)) {
    const r = enterFret(doc, entry, cursor, fret, { string, add: true, selected: item });
    return { select: r.select, cursor, action: r.action };
  }
  const r = enterFret(doc, entry, cursor, fret, { string, add: false, selected: null });
  return { select: r.select, cursor, action: r.action };
}

/**
 * String (1 = highest) and fret (as the tablature shows it) for a played pitch on the tablature staff at `pos` ({ staffId, measureIndex, position }): the
 * position pressed on a fretboard with as many strings as the staff, else the pitch converted with the staff's tuning and capo (`avoid` = strings already
 * taken by the chord; frets beyond the instrument are skipped). Throws `fret` when the pitch cannot be played.
 */
export function tabStringFor(doc, pos, played, avoid = []) {
  const ctx = tabContextAt(doc, pos);
  if (played.string && played.stringCount === ctx.open.length && Number.isInteger(played.fret)) return { string: played.string, fret: played.fret - capoFretShift(ctx.params, played.string) };
  const taken = [...avoid];
  for (let tries = 0; tries < ctx.open.length; tries += 1) {
    const c = convertPitch(played.midi, ctx.open, ctx.params, taken);
    if (!c) break;
    if (c.fret <= ctx.limit) return { string: c.string, fret: c.fret };
    taken.push(c.string);
  }
  throw new NoteEntryError('fret', 'Frette hors de la plage de l\'instrument');
}

/**
 * A pitch PLAYED on the on-screen keyboard or the fretboard, written at the cursor like MuseScore's MIDI input (`NotationMidiInput::addNoteToScore`,
 * `Score::addMidiPitch`, 4.7.5 read): without `add` the note replaces what is at the cursor and the cursor advances; with `add` (another key is still
 * held, or Shift) it is added to the chord `previous` (the note put by the previous key), at its position and with its duration, without advancing.
 *  - `played` = { midi, string?, fret?, stringCount? }: `string` (1 = highest) and `fret` (absolute, as the fretboard shows it) come from the fretboard;
 *    `stringCount` is the number of strings of the board (the position is only trusted when it equals the staff's).
 *  - Notation staff: the key is the SOUNDING pitch, which is what the model stores (a transposing staff shows the written note on its own); spelling
 *    from the key signature (`defaultSpelling`); a string given by the fretboard is remembered (`PID.TAB_STRING`) so a linked tablature shows it.
 *  - Tablature staff (linked or not): the string and fret pressed on the fretboard, else the pitch is converted with the staff's tuning and capo
 *    (`StringData::convertPitch`), skipping the strings of the chord and the ones where the fret would be out of range.
 * Same pitch already in the chord: nothing changes. Percussion, rhythm and accordion staves are refused.
 */
export function enterPlayedNote(doc, entry, cursor, played, { add = false, previous = null } = {}) {
  const staff = doc.find(cursor?.staffId);
  if (!staff || staff.type !== 'staff') throw new NoteEntryError('noCursor', 'Pas de curseur de saisie');
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (type !== 'score' && type !== 'tab') throw new NoteEntryError('unsupportedPlayed', 'Notes jouées : portée de notation ou de tablature seulement');
  const midi = played?.midi;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new NoteEntryError('range', 'Hauteur hors de l\'étendue MIDI (0-127)');
  const movement = doc.movementOf(staff);
  let target = null;
  if (add && previous) {
    const chord = previous.type === 'chord' ? previous : doc.parentOf(previous.id);
    if (chord?.type === 'chord' && cursorOfElement(doc, chord.id)) target = chord;
  }
  const at = target && cursorOfElement(doc, target.id);
  // a chord of the primary staff of a linked tablature: the gesture stays on the tablature
  const pos = at
    ? { staffId: isLinkedStaff(staff) ? cursor.staffId : at.staffId, measureIndex: at.measureIndex, position: at.position }
    : { staffId: cursor.staffId, measureIndex: cursor.measureIndex, position: cursor.position };
  const duration = target ? { base: getProperty(target, PID.DURATION).base, dots: getProperty(target, PID.DURATION).dots ?? 0 } : entry.duration;
  const base = { ...entry, rest: false, replace: !target, voice: at ? at.voice : cursor.voice, duration };
  let r;
  if (type === 'score') {
    if (target) {
      const same = target.notes.find((n) => getProperty(n, PID.PITCH) === midi);
      if (same) return { select: [same.id], cursor, action: 'none' };
    }
    const key = getProperty(movement.masterbars[pos.measureIndex], PID.KEY_SIG) ?? 0;
    r = enterNote(doc, pos, { ...base, played: { pitch: midi, spelling: defaultSpelling(midi, key), string: played.string } });
  } else {
    const avoid = [];
    if (target) {
      if (isLinkedStaff(staff)) projectedStrings(movement, staff, target.id).forEach((v) => { if (v) avoid.push(v); });
      else target.notes.forEach((n) => { const v = getProperty(n, PID.STRING); if (v) avoid.push(v); });
    }
    const { string, fret } = tabStringFor(doc, pos, played, avoid);
    r = enterNote(doc, { ...pos, line: string - 1 }, { ...base, fret });
  }
  return { select: r.select, cursor: target ? cursor : advance(doc, cursor), action: r.action };
}

/**
 * What the fretboard must show while a note is entered at `cursor`: the tuning, the highest fret and the capo of the tablature staff the notes go to
 * (the staff itself, or the tablature linked to the notation staff), or null when there is none (the board then keeps following the score).
 * `strings` = open MIDI pitches, LOWEST first (the staff's order is highest first); `capo` = { fret, ignored: [indices from the lowest string] } or null.
 */
export function fretboardContextAt(doc, cursor) {
  const staff = doc.find(cursor?.staffId);
  if (!staff || staff.type !== 'staff') return null;
  const movement = doc.movementOf(staff);
  const type = getProperty(staff, PID.STAFF_TYPE);
  const tab = type === 'tab' ? staff : type === 'score' ? linkedStavesOf(movement, staff).find((s) => getProperty(s, PID.STAFF_TYPE) === 'tab') : null;
  if (!tab) return null;
  const { open, params, limit } = tabContextAt(doc, { staffId: tab.id, measureIndex: cursor.measureIndex, position: cursor.position });
  const n = open.length;
  const capo = params.active && params.fret > 0 && params.mode !== 'playback'
    ? { fret: params.fret, ignored: params.ignoredStrings.map((hs) => n - hs).filter((i) => i >= 0 && i < n) } : null;
  return { strings: [...open].reverse(), frets: limit, capo, key: `${open.join(',')}|${capo ? `${capo.fret}:${capo.ignored.join('.')}` : '-'}` };
}

/** Touche silence : un silence de la durée choisie à la position du curseur, puis avance. */
export function enterRestAtCursor(doc, entry, cursor) {
  const staff = doc.find(cursor?.staffId);
  if (!staff || staff.type !== 'staff') throw new NoteEntryError('noCursor', 'Pas de curseur de saisie');
  const hit = { staffId: cursor.staffId, measureIndex: cursor.measureIndex, position: cursor.position, line: 0 };
  const r = enterNote(doc, hit, { ...entry, rest: true, replace: true, voice: cursor.voice });
  return { select: r.select, cursor: advance(doc, cursor), action: r.action };
}

/** Supprimer : la note sélectionnée (retirée si l'accord en garde d'autres), sinon l'accord / silence sélectionné ou celui du curseur. */
export function deleteAtCursor(doc, cursor, selected = null) {
  if (selected?.type === 'note' || selected?.type === 'tabnote' || selected?.type === 'percnote' || selected?.type === 'accnote') {
    const chord = doc.parentOf(selected.id);
    if (chord.notes.length > 1) { removeNoteFromChord(doc, selected); return { select: [chord.notes.find((n) => n.id !== selected.id).id], cursor }; }
    deleteItem(doc, chord);
    return { select: [], cursor };
  }
  const target = selected && (selected.type === 'chord' || selected.type === 'rest') ? selected : itemAtCursor(doc, cursor);
  if (!target) throw new NoteEntryError('noCursor', 'Rien à supprimer ici');
  deleteItem(doc, target);
  return { select: [], cursor };
}

/**
 * « Revenir » (saisie séquentielle) : the chord (or rest) just written goes away WHOLE — the selected one, else the one before the cursor — and the cursor comes back to its
 * place, ready to write it again. Unlike `deleteAtCursor` (which removes one note of a chord and leaves the cursor where it is).
 */
export function backOverLast(doc, cursor, selected = null) {
  const chordOf = (el) => (el && (el.type === 'chord' || el.type === 'rest') ? el : el ? doc.parentOf(el.id) : null);
  let target = chordOf(selected);
  if (!target || (target.type !== 'chord' && target.type !== 'rest')) {
    const prev = prevInputPos(doc, cursor);
    const found = prev?.moved ? itemAtCursor(doc, prev.cursor) : null;
    target = found && !isGapRest(found) ? found : null;
  }
  if (!target) throw new NoteEntryError('noCursor', 'Rien à reprendre');
  const at = cursorOfElement(doc, target.id);
  if (!at) throw new NoteEntryError('noCursor', 'Élément introuvable');
  deleteItem(doc, target);
  // (a tablature linked to a notation staff shows chords that live in the notation staff: the cursor stays on the staff it was on)
  return { select: [], cursor: normalizeCursor(doc, { ...cursor, ...at, staffId: cursor.staffId }) ?? cursor, action: 'back' };
}
const isGapRest = (item) => item?.type === 'rest' && getProperty(item, PID.GAP) === true;

// ---------- ↑ ↓ : transposition chromatique d'une note (orthographe par fifths, `tpc` de MuseScore : do = 14, sol = 15, fa = 13…) ----------
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 };
const STEP_OF_FIFTHS = { '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B' };
const TPC_C = 14;
const TPC_A = 17;
const tpcOf = ({ step, alter = 0 }) => TPC_C + FIFTHS[step] + 7 * alter;
function spellingOfTpc(tpc, pitch) {
  const n = tpc - TPC_C;
  const alter = Math.floor((n + 1) / 7);
  const step = STEP_OF_FIFTHS[n - 7 * alter];
  return { step, alter, octave: (pitch - alter - STEP_SEMITONE[STEPS.indexOf(step)]) / 12 - 1 };
}

/** Nouvelle (hauteur, orthographe) d'une note après un demi-ton (`upDownChromatic`) ou une octave. null si la limite MIDI est atteinte. */
export function pitchStep(doc, note, up, octave = false) {
  const chord = doc.parentOf(note.id);
  const at = cursorOfElement(doc, chord.id);
  const staff = doc.parentOf(doc.parentOf(doc.parentOf(chord.id).id).id);
  const sp = getProperty(note, PID.SPELLING);
  const pitch = getProperty(note, PID.PITCH);
  if (octave) {
    if (up ? pitch >= 116 : pitch <= 11) return null;
    return { pitch: pitch + (up ? 12 : -12), spelling: { ...sp, octave: sp.octave + (up ? 1 : -1) } };
  }
  const movement = doc.movementOf(staff);
  const key = getProperty(movement.masterbars[at.measureIndex], PID.KEY_SIG) ?? 0;
  const state = accidentalState(movement, staff, at.measureIndex, nominalOf(doc, at));
  const accState = state.has(`${sp.step}${sp.octave}`) ? state.get(`${sp.step}${sp.octave}`) : (keySigAlters(key)[sp.step] ?? 0);
  const noteAlter = sp.alter ?? 0;
  const tpc = tpcOf(sp);
  let newTpc; let newPitch;
  if (up && pitch < 127) {
    newPitch = pitch + 1;
    newTpc = tpc > TPC_A + key && noteAlter >= accState ? tpc - 5 : tpc + 7;
  } else if (!up && pitch > 0) {
    newPitch = pitch - 1;
    newTpc = tpc > TPC_C + key || noteAlter > accState ? tpc - 7 : tpc + 5;
  } else return null;
  return { pitch: newPitch, spelling: spellingOfTpc(newTpc, newPitch) };
}

/** Applique ↑ ↓ aux notes (portée de notation) ; retourne le nombre de notes changées. */
export function shiftNotes(doc, notes, up, octave = false) {
  let changed = 0;
  const list = notes.filter((n) => n?.type === 'note');
  if (!list.length) throw new NoteEntryError('unsupportedKeyboard', 'Sélectionnez une note de portée de notation');
  const done = new Set();
  for (const n of list) {
    if (done.has(n.id)) continue;
    const r = pitchStep(doc, n, up, octave);
    if (!r) continue;
    const before = getProperty(n, PID.PITCH);
    doc.set(n, PID.PITCH, r.pitch);
    doc.set(n, PID.SPELLING, r.spelling);
    done.add(n.id);
    changed += 1;
    // the notes tied to it are the same sustained note: they follow (a tie between two different pitches is not a prolongation: left alone)
    for (const m of tieMates(doc, n)) {
      if (done.has(m.id) || m.type !== 'note' || getProperty(m, PID.PITCH) !== before) continue;
      doc.set(m, PID.PITCH, r.pitch);
      doc.set(m, PID.SPELLING, r.spelling);
      done.add(m.id);
    }
  }
  return changed;
}

export { slotsOf };
