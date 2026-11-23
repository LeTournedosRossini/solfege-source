/*
 * Saisie de notes à la souris / au doigt : intentions SANS DOM. À appeler dans `doc.transaction` (via `Application.enterNoteAt`).
 *
 * Reprise de `Score::putNote(const Position&, bool replace)` et `Score::noteValForPosition` (MuseScore 4.7.5, `dom/noteentry.cpp`, lus) :
 *  - clic sur un accord DE MÊME DURÉE ÉCRITE que celle choisie (et pas en mode « remplacer », ni silence choisi) : la note s'AJOUTE à l'accord ;
 *    si l'accord a déjà une note de même hauteur (même son en percussion) elle est RETIRÉE quand il en reste une autre, sinon rien ne change ;
 *    en tablature, une note déjà sur la même corde voit sa frette REMPLACÉE (MuseScore y ajoute un chiffre tapé au clavier : ici la frette est
 *    choisie dans la barre, donc pas de concaténation de chiffres — ÉCART assumé) ;
 *  - sinon (autre durée, silence choisi, mode remplacer) : l'accord ou le silence visé est REMPLACÉ par un nouvel accord de la durée choisie
 *    (`placeChord`, qui coupe, lie et complète de silences comme `setNoteRest`) ; un membre de n-olet est remplacé à durée égale
 *    (`placeChordInTuplet`) ;
 *  - hauteur d'une portée de notation : ligne → degré (clé EN VIGUEUR à cet instant) → altération = celle de la dernière note posée sur la même
 *    ligne plus tôt dans la mesure (toutes voix de la portée, `Measure::findAccidental`), sinon celle de l'armure ;
 *  - tablature : la ligne cliquée est la corde ; frette choisie dans la barre (0 par défaut, comme MuseScore) ; hauteur stockée = corde à vide + frette + capo ;
 *  - percussion : le son de la carte posé sur la ligne cliquée (le son choisi s'il y est, sinon le premier de la ligne) ;
 *  - portée rythmique / neutre : un accord sans hauteur.
 *  - accordéon main gauche : tap simple = basse (rang 2) à la hauteur de la ligne (clé de fa, armure, altérations des basses de la mesure) ;
 *    `entry.accRows` (rangs 1-6) pose plusieurs boutons d'un coup : 1-2 à la hauteur cliquée, 3-6 sur la fondamentale correspondante ; `entry.accAlter`
 *    force l'altération de la fondamentale ;
 *  - VOIX (`entry.voice`, 0 à 3) : les colonnes cliquables sont celles de la voix choisie (`ScoreView.staffHit`, `getNextValidInputSegment`) ; en
 *    PERCUSSION la note va dans la voix DE SON SON (carte), quelle que soit la voix choisie, et un accord de cette voix qui déborde la
 *    position est raccourci (`putNote` : `m_is.setVoice(ds->voice(pitch))`, `handleOverlappingChordRest`) ; un silence suit la voix choisie.
 *    Accordéon main gauche à DEUX voix (`entry.accVoices` = 2) : basses voix 1 (hampes en bas), boutons d'accord voix 2 (hampes en haut).
 * Limites : portée d'un instrument transpositeur refusée (la
 * hauteur écrite devrait être convertie) ; pas de portée d'accords ; pas de déplacement du curseur de saisie.
 */
import {
  PID, getProperty, midiFromSpelling, diatonicIndex, createChord, createAccNote, createTabNote, createPercNote, createRhythmChord, createNote,
  fEq, fCmp, fAdd, trackTransposition, intervalIsZero, staffSoundMap, drumSwitchesFor, tuningPitches, tuningPitchesAt, capoTimeline, capoAt, storedPitchOfFret,
  isLinkedStaff, primaryOf, projectedStrings, staffTimeline, defaultSpelling,
  placeChord, placeChordInTuplet, placeRest, addNoteToChord, removeNoteFromChord, measureLengthOf, measureOffsetOf, itemDuration, EditError,
} from '../model/index.js';
import { maxFretOf } from '../model/instruments.js';
import { SID } from '../model/sid.js';
import { tpcOfSpelling, spellingFromTpc, transposeTpc, staffInterval, writtenKey, writtenSpelling, writtenPitch } from '../model/transpose.js';
import { spellingOf } from '../layout/pitchpos.js';
import { ACC_ROW_BASS } from '../model/accordion.js';
import { CLEF_DEFS } from '../layout/constants.js';
import { clefTimeline, clefAt } from '../layout/clefchanges.js';
import { keySigAlters } from '../layout/accidentals.js';
import { staffLineCount } from '../layout/painters/common.js';

export class NoteEntryError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'NoteEntryError'; this.code = code; }
}

/** Types de portée où l'on peut saisir à la souris. */
export const ENTRY_STAFF_TYPES = ['score', 'tab', 'percussion', 'rhythm', 'neutral', 'accordion-left'];
/** Plus grande frette proposée par la barre (choix de Scorsaire ; MuseScore la tire de `StringData::frets()` de l'instrument). */
export const MAX_FRET = 24;

/** Frette maximale de la portée de tablature (catalogue de l'instrument de sa piste ; 24 par repli). */
export function maxFretFor(doc, staff) { return maxFretOf(doc.parentOf(staff.id)); }

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** État de saisie par défaut (propre à l'application, jamais dans le Document). */
export const DEFAULT_ENTRY = Object.freeze({ active: false, duration: Object.freeze({ base: 'quarter', dots: 0 }), rest: false, fret: 0, sound: null, replace: false, accRows: null, accAlter: undefined, accMode: 'bass', entryStaffType: null, accArmed: null, voice: 0, stem: 'auto', accVoices: 1, accidental: null, cursor: null, tabString: 1, sequential: false });

/** Altération choisie (touches ♭ ♮ ♯ du clavier) → décalage chromatique ; absente = celle de l'armure / de la mesure. */
export const ACCIDENTAL_ALTER = Object.freeze({ dflat: -2, flat: -1, natural: 0, sharp: 1, dsharp: 2 });

const sameDuration = (a, b) => a.base === b.base && (a.dots ?? 0) === (b.dots ?? 0);

/** Éléments de la mesure d'une voix avec leur début NOMINAL : [{ item, start }]. */
export function slotsOf(movement, staff, voice, mi) {
  const mb = movement.masterbars[mi];
  const measure = staff.voices[voice]?.measures[mi];
  if (!mb || !measure) return [];
  const length = measureLengthOf(mb);
  let pos = measureOffsetOf(mb, mi === 0);
  return measure.items.map((item) => { const slot = { item, start: pos }; pos = fAdd(pos, itemDuration(item, length)); return slot; });
}

/** Altération en vigueur sur chaque ligne avant `nominal` (toutes voix de la portée, ornements avant / principal / après dans l'ordre). */
export function accidentalState(movement, staff, mi, nominal, keepNote = () => true, spellOf = (note) => getProperty(note, PID.SPELLING)) {
  const state = new Map();
  const before = [];
  staff.voices.forEach((_, vi) => {
    slotsOf(movement, staff, vi, mi).forEach((s, order) => { if (fCmp(s.start, nominal) < 0) before.push({ ...s, vi, order }); });
  });
  before.sort((a, b) => fCmp(a.start, b.start) || a.vi - b.vi || a.order - b.order);
  for (const { item } of before) {
    if (item.type !== 'chord') continue;
    for (const chord of [...(item.graceNotes ?? []).filter((g) => !String(getProperty(g, PID.GRACE_TYPE) ?? '').endsWith('after')), item,
      ...(item.graceNotes ?? []).filter((g) => String(getProperty(g, PID.GRACE_TYPE) ?? '').endsWith('after'))]) {
      for (const note of chord.notes) {
        if (!keepNote(note)) continue;
        const sp = spellOf(note);
        if (sp) state.set(`${sp.step}${sp.octave}`, sp.alter ?? 0);
      }
    }
  }
  return state;
}

/**
 * Transposition SHOWN on a notation staff at measure `mi`, or null when notes are written at concert pitch (no instrument interval, a staff that is not a
 * notation staff, or the movement displays concert pitch). The model stores the CONCERT pitch and spelling; the staff shows the WRITTEN ones, so a click on
 * the staff is a written position that becomes a concert pitch (decided with Jean, 18/10/2026: the electric bass transposes by an octave).
 */
export function writtenContext(doc, staff, movement, mi) {
  if (getProperty(staff, PID.STAFF_TYPE) !== 'score') return null;
  if (doc.getStyle(movement, SID.CONCERT_PITCH)) return null;
  const track = doc.parentOf(staff.id);
  const iv = trackTransposition(track);
  if (intervalIsZero(iv)) return null;
  const concertKey = getProperty(movement.masterbars[mi], PID.KEY_SIG) ?? 0;
  const prefer = getProperty(track, PID.PREFER_SHARP_FLAT);
  return { iv, concertKey, prefer, writtenKey: writtenKey(concertKey, iv, prefer), effective: staffInterval(iv, concertKey, prefer) };
}

/** Written { pitch, spelling } of a stored note (what the staff shows), or its own values when nothing is transposed. */
export function writtenOf(ctx, note) {
  const pitch = getProperty(note, PID.PITCH);
  const stored = getProperty(note, PID.SPELLING);
  if (!ctx) return { pitch, spelling: stored };
  const concert = spellingOf(pitch, stored, ctx.concertKey);
  return { pitch: writtenPitch(pitch, ctx.iv), spelling: writtenSpelling(pitch, concert, ctx.iv, ctx.concertKey, ctx.prefer) };
}

/** Concert { pitch, spelling } of a WRITTEN spelling on a staff of that transposition (inverse of `writtenOf`). */
export function concertOfWritten(ctx, written) {
  const pitch = midiFromSpelling(written) + ctx.iv.chromatic;
  const tpc = transposeTpc(tpcOfSpelling(written), ctx.effective, true);
  return { pitch, spelling: spellingFromTpc(tpc, pitch) };
}

/**
 * Orthographe et hauteur d'une ligne cliquée sur une portée de notation.
 * @param hit  résultat de `ScoreView.staffHit` ({ staffId, measureIndex, position, line })
 * @returns {{ spelling: {step, alter, octave}, pitch: number }}
 */
export function pitchAtLine(doc, hit, { clefKey: forcedClef = null, accordion = false, alter: forcedAlter } = {}) {
  const staff = doc.find(hit.staffId);
  const movement = doc.movementOf(staff);
  const track = doc.parentOf(staff.id);
  void track;
  const mi = hit.measureIndex;
  // a transposing instrument: the click is a WRITTEN position (written clef, key signature and accidentals), stored at concert pitch
  const wctx = accordion ? null : writtenContext(doc, staff, movement, mi);
  const nominal = fAdd(hit.position, measureOffsetOf(movement.masterbars[mi], mi === 0));
  const clefKey = forcedClef ?? clefAt(clefTimeline(staff, movement, Boolean(doc.getStyle(movement, SID.CONCERT_PITCH))), mi, nominal);
  const clef = CLEF_DEFS[clefKey];
  if (!clef?.bottomLine) throw new NoteEntryError('clef', `Clé « ${clefKey} » sans hauteur`);
  // ligne 0 = ligne du haut ; chaque demi-interligne descend d'un degré diatonique
  // `hit.index` (saisie au clavier) : degré diatonique absolu déjà connu ; sinon il vient de la ligne cliquée
  const index = Number.isInteger(hit.index) ? hit.index : diatonicIndex(clef.bottomLine) + 2 * (staffLineCount(staff) - 1) - hit.line;
  const step = STEPS[((index % 7) + 7) % 7];
  const octave = Math.floor(index / 7);
  const key = wctx ? wctx.writtenKey : getProperty(movement.masterbars[mi], PID.KEY_SIG) ?? 0;
  // accordéon : seules les basses (rangs 1-2) sont écrites à hauteur réelle ; les boutons d'accord ne marquent aucune altération
  const state = accidentalState(movement, staff, mi, nominal, accordion ? (n) => getProperty(n, PID.ACC_ROW) <= 2 : undefined, wctx ? (note) => writtenOf(wctx, note).spelling : undefined);
  const alter = Number.isInteger(forcedAlter) ? forcedAlter : state.has(`${step}${octave}`) ? state.get(`${step}${octave}`) : (keySigAlters(key)[step] ?? 0);
  const spelling = { step, alter, octave };
  const result = wctx ? concertOfWritten(wctx, spelling) : { spelling, pitch: midiFromSpelling(spelling) };
  if (result.pitch < 0 || result.pitch > 127) throw new NoteEntryError('range', 'Hauteur hors de l\'étendue MIDI (0-127)');
  return result;
}

/** Son de la carte de la portée posé sur la ligne cliquée (le son choisi s'il y est), ou lève `noSound`. */
export function soundAtLine(doc, hit, preferred = null, switches = null) {
  const staff = doc.find(hit.staffId);
  const map = staffSoundMap(getProperty(staff, PID.PERCMAP));
  const here = map.sounds.filter((s) => s.line === hit.line);
  if (!here.length) throw new NoteEntryError('noSound', 'Aucun son de la carte sur cette ligne');
  const chosen = here.find((s) => s.id === preferred);
  if (chosen) return chosen.id;
  // the first sound of the line, unless it belongs to an entry switch: then the switch's current sound (default: its first)
  const group = drumSwitchesFor(map).find((g) => here.some((s) => g.sounds.includes(s.id))); // any sound of the line that belongs to a switch (the kit may list another sound first)
  if (group) return group.sounds[((switches?.[group.id] ?? 0) % group.sounds.length + group.sounds.length) % group.sounds.length];
  return here[0].id;
}

/**
 * Voix où va le geste : la voix choisie (`entry.voice`), sauf percussion (voix du SON de la carte, comme `putNote`) et accordéon main gauche
 * (voix 1 sans option ; à deux voix : basses voix 1, boutons d'accord voix 2).
 */
export function voiceForEntry(doc, hit, entry = DEFAULT_ENTRY) {
  const staff = doc.find(hit?.staffId);
  const type = staff && getProperty(staff, PID.STAFF_TYPE);
  const chosen = Number.isInteger(entry.voice) ? entry.voice : 0;
  if (type === 'percussion' && !entry.rest) {
    try {
      const id = soundAtLine(doc, hit, entry.sound, entry.drumSwitch);
      const sound = staffSoundMap(getProperty(staff, PID.PERCMAP)).sounds.find((s) => s.id === id);
      if (Number.isInteger(sound?.voice)) return sound.voice;
    } catch { /* ligne sans son : la pose échouera plus loin avec son message */ }
    return chosen;
  }
  if (type === 'accordion-left') {
    if ((entry.accVoices ?? 1) !== 2) return 0;
    const rows = entry.accRows?.length ? entry.accRows : null;
    const chordGesture = rows ? rows.some((r) => r > 2) : entry.accMode === 'chord';
    return entry.rest ? chosen : chordGesture ? 1 : 0;
  }
  return chosen;
}

/**
 * Open strings (stored MIDI pitches, lowest first), capo parameters and highest fret of a tablature staff at a position
 * (`hit` = { staffId, measureIndex, position }): what a fret or a played pitch is converted with.
 */
export function tabContextAt(doc, hit) {
  const staff = doc.find(hit.staffId);
  const movement = doc.movementOf(staff);
  const mi = hit.measureIndex;
  const nominal = fAdd(hit.position, measureOffsetOf(movement.masterbars[mi], mi === 0));
  const primary = isLinkedStaff(staff) ? primaryOf(movement, staff) : null; // a linked staff has no content of its own: its capos and tuning changes name chords of the primary staff
  const timeline = primary ? staffTimeline(movement, primary) : undefined;
  const open = tuningPitchesAt(movement, staff, [mi, nominal], timeline);
  const params = capoAt(capoTimeline(movement, staff, timeline), [mi, nominal]);
  return { open, params, limit: maxFretFor(doc, staff) };
}

/** Hauteur stockée et corde d'une frette sur la corde cliquée (corde 1 = ligne du haut), capo en vigueur compris. */
export function tabNoteAt(doc, hit, fret) {
  const { open, params, limit } = tabContextAt(doc, hit);
  const string = hit.line + 1;
  if (!Number.isInteger(fret) || fret < 0 || fret > limit) throw new NoteEntryError('fret', `Frette hors de la plage de l'instrument (0 à ${limit})`);
  if (string < 1 || string > open.length) throw new NoteEntryError('noString', 'Corde inexistante');
  return { string, pitch: storedPitchOfFret(open[string - 1], fret, params, string) };
}

/**
 * Pose la note correspondant à un clic. À appeler DANS une transaction.
 * @param hit    résultat de `ScoreView.staffHit`
 * @param entry  état de saisie { duration, rest, fret, sound, replace }
 * @returns {{ select: string[], action: 'placed'|'added'|'removed'|'refret'|'rest'|'none', chords?: object[] }}
 *          `select` : identifiants à sélectionner (la nouvelle note, ou le silence)
 */
export function enterNote(doc, hit, entry = DEFAULT_ENTRY) {
  const hitStaff = doc.find(hit?.staffId);
  if (!hitStaff || hitStaff.type !== 'staff') throw new NoteEntryError('staff', 'Portée introuvable');
  if (!ENTRY_STAFF_TYPES.includes(getProperty(hitStaff, PID.STAFF_TYPE))) throw new NoteEntryError('unsupported', `Portée « ${getProperty(hitStaff, PID.STAFF_TYPE)} » : saisie à la souris non prise en charge`);
  // a click on a LINKED staff writes into its primary staff (the notation staff): the note is a notation note that remembers the string
  const linked = isLinkedStaff(hitStaff) ? primaryOf(doc.movementOf(hitStaff), hitStaff) : null;
  if (isLinkedStaff(hitStaff) && !linked) throw new NoteEntryError('staff', 'Portée principale introuvable');
  // writing through a linked staff only exists for « tablature linked to a notation staff » : in every other pair the content is written in the primary staff
  if (linked && !(getProperty(hitStaff, PID.STAFF_TYPE) === 'tab' && getProperty(linked, PID.STAFF_TYPE) === 'score') && getProperty(hitStaff, PID.STAFF_TYPE) !== 'rhythm') throw new NoteEntryError('linkedPrimary', `Portée liée : saisissez dans la portée principale (${getProperty(linked, PID.STAFF_TYPE)})`);
  if (linked && getProperty(hitStaff, PID.STAFF_TYPE) === 'rhythm') throw new NoteEntryError('linkedRhythm', 'Une rythmique liée reprend le rythme de la notation : saisissez dans la portée de notation');
  const staff = linked ?? hitStaff;
  const type = linked ? 'score' : getProperty(staff, PID.STAFF_TYPE);
  const duration = { base: entry.duration.base, dots: entry.duration.dots ?? 0 };
  const voice = voiceForEntry(doc, hit, entry);
  const mi = hit.measureIndex;
  const movement = doc.movementOf(staff);
  const nominal = fAdd(hit.position, measureOffsetOf(movement.masterbars[mi], mi === 0));
  const target = slotsOf(movement, staff, voice, mi).find((s) => fEq(s.start, nominal))?.item ?? null;
  const place = { staff, voice, measure: mi, position: hit.position };
  // accordéon à deux voix et geste MIXTE (basses ET boutons d'accord) : deux poses, une par voix
  if (type === 'accordion-left' && (entry.accVoices ?? 1) === 2 && !entry.rest && entry.accRows?.some((r) => r <= 2) && entry.accRows?.some((r) => r > 2)) {
    const bass = enterNote(doc, hit, { ...entry, accRows: entry.accRows.filter((r) => r <= 2) });
    const chord = enterNote(doc, hit, { ...entry, accRows: entry.accRows.filter((r) => r > 2) });
    return { select: [...bass.select, ...chord.select], action: 'placed', chords: [...(bass.chords ?? []), ...(chord.chords ?? [])] };
  }

  // silence choisi : il remplace ce qui est là, sans hauteur à calculer (en tablature MuseScore s'arrête avant de lire la ligne)
  if (entry.rest) {
    const rest = placeRest(doc, { ...place, duration });
    return { select: [rest.id], action: 'rest' };
  }

  // fabrique des notes selon le type de portée (une note NEUVE à chaque appel : `placeChord` coupe en plusieurs accords)
  let makeNote;
  let accNotes = null; // accordéon : fabrique de TOUTES les notes du geste (basse et / ou boutons d'accord)
  let sameNote = null; // (note existante) → vrai si elle a la hauteur / le son de la note à poser
  let linkedNote = null; // linked tablature: { string, pitch, spelling } of the clicked fret
  if (linked) {
    const { string, pitch } = tabNoteAt(doc, hit, entry.fret ?? 0);
    const spelling = defaultSpelling(pitch, getProperty(movement.masterbars[mi], PID.KEY_SIG) ?? 0);
    linkedNote = { string, pitch, spelling };
    makeNote = () => createNote({ ...spelling, props: { [PID.TAB_STRING]: string } });
    const strings = target?.type === 'chord' ? projectedStrings(movement, hitStaff, target.id) : new Map();
    sameNote = (n) => strings.get(n.id) === string;
  } else if (type === 'score') {
    // `entry.played` = { pitch, spelling, string? }: a pitch played on the keyboard / the fretboard (concert pitch, nothing to read from a line)
    const { spelling, pitch } = entry.played ?? pitchAtLine(doc, hit, { alter: ACCIDENTAL_ALTER[entry.accidental] });
    const hint = entry.played?.string;
    makeNote = () => (hint ? createNote({ ...spelling, props: { [PID.TAB_STRING]: hint } }) : createNote(spelling));
    sameNote = (n) => getProperty(n, PID.PITCH) === pitch;
  } else if (type === 'tab') {
    const { string, pitch } = tabNoteAt(doc, hit, entry.fret ?? 0);
    makeNote = () => createTabNote({ pitch, string });
    sameNote = (n) => getProperty(n, PID.STRING) === string;
  } else if (type === 'percussion') {
    const sound = soundAtLine(doc, hit, entry.sound, entry.drumSwitch);
    makeNote = () => createPercNote({ sound });
    sameNote = (n) => getProperty(n, PID.SOUND) === sound;
  } else if (type === 'accordion-left') {
    const rows = [...new Set(entry.accRows?.length ? entry.accRows : [ACC_ROW_BASS])].sort((a, b) => a - b);
    const { spelling } = pitchAtLine(doc, hit, { clefKey: 'F', accordion: true });
    const alter = entry.accAlter ?? spelling.alter;
    accNotes = () => rows.map((row) => createAccNote(row <= 2 ? { row, step: spelling.step, alter, octave: spelling.octave } : { row, step: spelling.step, alter }));
    makeNote = () => accNotes()[0];
  } else {
    makeNote = null; // rythmique : accord sans hauteur
  }
  // a forced stem direction (the button of the entry bar) goes with every chord entered; not on the accordion's left hand, whose stems follow its voices
  const stemProps = type !== 'accordion-left' && (entry.stem === 'up' || entry.stem === 'down') ? { [PID.STEM_DIRECTION]: entry.stem } : {};
  const makeChord = (d) => (makeNote ? createChord({ duration: d.base, dots: d.dots ?? 0, notes: accNotes ? accNotes() : [makeNote()], props: stemProps }) : createRhythmChord(d.base, { dots: d.dots ?? 0, props: stemProps }));

  // ajout à l'accord visé (même durée écrite, pas en mode « remplacer »)
  if (!entry.replace && target?.type === 'chord' && makeNote && sameDuration(getProperty(target, PID.DURATION), duration)) {
    if (accNotes) {
      // accordéon : même bouton = même rang et même fondamentale (même hauteur pour les basses)
      const same = (a, b) => getProperty(a, PID.ACC_ROW) === getProperty(b, PID.ACC_ROW)
        && getProperty(a, PID.SPELLING).step === getProperty(b, PID.SPELLING).step && (getProperty(a, PID.SPELLING).alter ?? 0) === (getProperty(b, PID.SPELLING).alter ?? 0)
        && (getProperty(a, PID.ACC_ROW) > 2 || getProperty(a, PID.SPELLING).octave === getProperty(b, PID.SPELLING).octave);
      const wanted = accNotes();
      const present = wanted.map((w) => target.notes.find((n) => same(n, w)));
      if (present.every(Boolean)) {
        // tous déjà là : retirés s'il reste d'autres boutons, sinon rien (comme `putNote`)
        if (target.notes.length > present.length) { present.forEach((n) => removeNoteFromChord(doc, n)); return { select: [target.notes[0].id], action: 'removed' }; }
        return { select: [present[0].id], action: 'none' };
      }
      const added = wanted.filter((_, i) => !present[i]);
      added.forEach((n) => addNoteToChord(doc, target, n));
      return { select: [added[0].id], action: 'added' };
    }
    const existing = target.notes.find(sameNote);
    if (linkedNote && existing) {
      // same string on a linked tablature: the fret is replaced, i.e. the pitch of the notation note (and its spelling) changes
      doc.set(existing, PID.PITCH, linkedNote.pitch);
      doc.set(existing, PID.SPELLING, linkedNote.spelling);
      doc.set(existing, PID.TAB_STRING, linkedNote.string);
      return { select: [existing.id], action: 'refret' };
    }
    if (type === 'tab' && existing) {
      // même corde : la frette est remplacée (hauteur stockée mise à jour)
      const fresh = makeNote();
      doc.set(existing, PID.PITCH, getProperty(fresh, PID.PITCH));
      return { select: [existing.id], action: 'refret' };
    }
    if (existing) {
      // même hauteur / même son : retirée s'il en reste une autre, sinon rien (`putNote`)
      if (target.notes.length > 1) { removeNoteFromChord(doc, existing); return { select: [target.notes.find((n) => n.id !== existing.id).id], action: 'removed' }; }
      return { select: [existing.id], action: 'none' };
    }
    const note = makeNote();
    addNoteToChord(doc, target, note);
    return { select: [note.id], action: 'added' };
  }

  // remplacement ou création
  if (target && getProperty(target, PID.TUPLET)) {
    const chord = placeChordInTuplet(doc, { item: target, makeChord });
    return { select: [chord.notes[0].id], action: 'placed', chords: [chord] };
  }
  const { chords } = placeChord(doc, { ...place, duration, makeChord, shortenOverlap: type === 'percussion' });
  if (!chords.length) throw new NoteEntryError('clipped', 'Rien à poser ici');
  return { select: [chords[0].notes[0].id], action: 'placed', chords };
}

export { EditError };
