/*
 * Touche T : liaison de PROLONGATION. Intentions SANS DOM, à appeler dans `doc.transaction` (via `Application.keyboardEntry`).
 *
 * Port de MuseScore 4.7.5 (lus : `editing/edit.cpp` `Score::cmdAddTie`, `cmdToggleTie`, `cmdTieNoteList`, `createAndAddTie` ; `dom/utils.cpp` `searchTieNote`) :
 *  - EN MODE SAISIE (`NotationNoteInput::addTie` → `cmdAddTie`) : les notes de l'accord sélectionné sont reposées APRÈS lui (durée de saisie courante,
 *    même hauteur) et liées à l'originale ; une liaison déjà sortante de ces notes est d'abord retirée ; la sélection passe sur la nouvelle note,
 *    le curseur après elle ;
 *  - HORS SAISIE (`addTieToSelection` → `cmdToggleTie`) : si toutes les notes sont du même accord et que l'une n'a pas de note de même hauteur juste
 *    après, c'est `cmdAddTie` (une note liée est ajoutée) ; sinon, si au moins une a une note à lier, ces liaisons sont créées ; sinon les liaisons
 *    existantes sont retirées ; plusieurs accords sélectionnés : chaque note se lie à la note de même hauteur suivante de la sélection.
 * `searchTieNote` : l'élément qui suit IMMÉDIATEMENT l'accord dans la voix (même mesure ou début de la suivante), s'il est un accord contenant une
 * note de même hauteur. Non porté : liaisons partielles (sauts, reprises), notes d'ornement, accord inter-portées, `unisonIndex`.
 */
import { PID, getProperty, createNote, createRhythmNote, createTabNote, createChord, createTie, fCmp, placeChord, placeChordInTuplet } from '../model/index.js';
import { NoteEntryError } from './noteentry-intents.js';
import { cursorOfElement, nextInputPos, neighbourCr, itemAtCursor } from './noteentry-cursor.js';

const NOTE_TYPES = ['note', 'tabnote', 'percnote', 'rhythmnote'];

/** Valeur qui décide si deux notes sont « la même » pour une liaison : hauteur (portée, tablature) ou son (percussion). */
const tieKey = (note) => (note.type === 'percnote' ? getProperty(note, PID.SOUND) : getProperty(note, PID.PITCH));

function staffOfNote(doc, note) {
  const at = cursorOfElement(doc, note.id);
  return at ? { at, staff: doc.find(at.staffId) } : null;
}

const tiesOf = (staff) => getProperty(staff, PID.TIES);
const tieFrom = (staff, note) => tiesOf(staff).find((t) => t.startNoteId === note.id) ?? null;

/** `searchTieNote` : note de même hauteur dans l'élément qui suit immédiatement l'accord, ou null. */
export function searchTieNote(doc, note) {
  const chord = doc.parentOf(note.id);
  const next = chord && neighbourCr(doc, chord, 1);
  if (!next || next.item.type !== 'chord') return null;
  const key = tieKey(note);
  return next.item.notes.find((n) => n.type === note.type && tieKey(n) === key) ?? null;
}

/** `createAndAddTie` : lie `start` à `end` ; une liaison qui sortait de `start` ou qui arrivait sur `end` est remplacée. */
function addTie(doc, start, end) {
  const a = staffOfNote(doc, start);
  const b = staffOfNote(doc, end);
  if (!a || !b || a.staff.id !== b.staff.id) throw new NoteEntryError('noNote', 'Liaison entre portées impossible');
  const kept = tiesOf(a.staff).filter((t) => t.startNoteId !== start.id && t.endNoteId !== end.id);
  doc.set(a.staff, PID.TIES, [...kept, createTie(start.id, end.id)]);
}

function removeTie(doc, note) {
  const s = staffOfNote(doc, note);
  const tie = s && tieFrom(s.staff, note);
  if (tie) doc.set(s.staff, PID.TIES, tiesOf(s.staff).filter((t) => t.id !== tie.id));
  return !!tie;
}

/** Notes visées (`cmdTieNoteList`) : note sélectionnée (en saisie : tout son accord), accord sélectionné (toutes ses notes), sinon notes de la sélection. */
export function tieNoteList(doc, selected, entryMode) {
  const out = [];
  const push = (n) => { if (!out.includes(n)) out.push(n); };
  if (selected.length === 1 && NOTE_TYPES.includes(selected[0].type)) {
    if (entryMode) doc.parentOf(selected[0].id).notes.forEach(push); else push(selected[0]);
    return out;
  }
  for (const e of selected) {
    if (NOTE_TYPES.includes(e.type)) push(e);
    else if (e.type === 'chord') e.notes.forEach(push);
  }
  return out;
}

const positionKey = (doc, note) => { const at = cursorOfElement(doc, note.id); return at ? [at.staffId, at.measureIndex, at.position, at.voice] : null; };
const sameTick = (doc, a, b) => { const x = positionKey(doc, a); const y = positionKey(doc, b); return x && y && x[0] === y[0] && x[1] === y[1] && fCmp(x[2], y[2]) === 0; };
const earlier = (doc, a, b) => {
  const x = cursorOfElement(doc, a.id); const y = cursorOfElement(doc, b.id);
  return x.measureIndex !== y.measureIndex ? x.measureIndex < y.measureIndex : fCmp(x.position, y.position) <= 0;
};

/**
 * `cmdAddTie` : reposer les notes de l'accord APRÈS lui, à la durée de saisie, et les lier. Retourne { select, cursor, action }.
 * Portée de notation et tablature seulement.
 */
export function addTiedNotes(doc, entry, notes) {
  const first = notes[0];
  const home = staffOfNote(doc, first);
  if (!home) throw new NoteEntryError('noNote', 'Aucune note sélectionnée');
  const type = first.type;
  if (type !== 'note' && type !== 'tabnote' && type !== 'rhythmnote') throw new NoteEntryError('unsupportedKeyboard', 'La liaison par T ne s\'applique qu\'aux notes de portée de notation et de tablature');
  const next = nextInputPos(doc, home.at);
  if (!next.moved) throw new NoteEntryError('clipped', 'Rien à poser ici');
  for (const n of notes) removeTie(doc, n);
  const make = (n) => (type === 'rhythmnote' ? createRhythmNote()
    : type === 'note'
    ? createNote({ ...getProperty(n, PID.SPELLING) })
    : createTabNote({ pitch: getProperty(n, PID.PITCH), string: getProperty(n, PID.STRING) }));
  const makeChord = (d) => createChord({ duration: d.base, dots: d.dots ?? 0, notes: notes.map(make) });
  const target = itemAtCursor(doc, next.cursor);
  const duration = { base: entry.duration.base, dots: entry.duration.dots ?? 0 };
  const chords = target && getProperty(target, PID.TUPLET)
    ? [placeChordInTuplet(doc, { item: target, makeChord })]
    : placeChord(doc, { staff: home.staff, voice: home.at.voice, measure: next.cursor.measureIndex, position: next.cursor.position, duration, makeChord }).chords;
  if (!chords.length) throw new NoteEntryError('clipped', 'Rien à poser ici');
  notes.forEach((n, k) => addTie(doc, n, chords[0].notes[k]));
  const last = chords[chords.length - 1];
  const after = cursorOfElement(doc, last.notes[0].id);
  return { select: last.notes.map((n) => n.id), cursor: nextInputPos(doc, after).cursor, action: 'tied' };
}

/**
 * Touche T. `entryMode` : mode saisie actif. `selected` : éléments sélectionnés. Retourne { select, cursor?, action: 'tied' | 'untied' | 'none' }.
 */
export function tieAction(doc, entry, selected, entryMode) {
  const notes = tieNoteList(doc, selected, entryMode);
  if (!notes.length) throw new NoteEntryError('noNote', 'Aucune note sélectionnée');
  if (entryMode) return addTiedNotes(doc, entry, notes);

  // cmdToggleTie
  let singleTick = true;
  let someNext = false;
  let allNext = true;
  const targets = notes.map((n) => {
    if (!sameTick(doc, n, notes[0])) singleTick = false;
    const s = staffOfNote(doc, n);
    if (s && tieFrom(s.staff, n)) return null;
    const t = searchTieNote(doc, n);
    if (t) someNext = true; else allNext = false;
    return t;
  });
  if (singleTick && !allNext) return addTiedNotes(doc, entry, notes);

  const list = notes.slice();
  let changed = 'none';
  notes.forEach((note, i) => {
    if (!list[i]) return;
    const to = targets[i];
    if (someNext && to) { const [a, b] = earlier(doc, note, to) ? [note, to] : [to, note]; addTie(doc, a, b); changed = 'tied'; return; }
    if (removeTie(doc, note)) { changed = 'untied'; return; }
    if (!(notes.length >= 2 && !singleTick) || i > notes.length - 2) return;
    // lie à la prochaine note de même hauteur de la sélection
    for (let j = i + 1; j < list.length; j += 1) {
      const c = list[j];
      if (c && tieKey(c) === tieKey(note) && !sameTick(doc, c, note)) {
        const [a, b] = earlier(doc, note, c) ? [note, c] : [c, note];
        addTie(doc, a, b);
        list[j] = null;
        changed = 'tied';
        break;
      }
    }
  });
  return { select: notes.map((n) => n.id), action: changed };
}
