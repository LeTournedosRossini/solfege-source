/*
 * Suppression des MARQUES (étape 5) — entrées de listes et éléments de masterbar. À APPELER DANS `doc.transaction`.
 *
 * Règles de MuseScore 4.7.5 (`Score::deleteItem`, `edit.cpp`, lu) :
 *  - un segment de ligne (liaison, tie, soufflet, trille, pédale, glissando, ligne de technique, bend, hopo…) supprime TOUTE la ligne
 *    (`el = spannerSegment->spanner(); undoRemoveElement(el)`) ;
 *  - un bend « pre-bend » ou « pre-dive » supprime AUSSI sa note de départ (`deleteItem(bend->startNote())`) : la note d'ornement ;
 *  - tempo, saut, marqueur, volta, point d'orgue : l'élément est simplement retiré ;
 *  - nuance, arpège, trémolo sur une note, tapping, slide, articulation : l'élément est retiré (`default: undoRemoveElement`) ;
 *  - un capo est retiré avec la réécriture des hauteurs de `EditCapo` (`removeCapo`).
 * Les paroles ne sont pas concernées (un mot appartient à un texte de l'œuvre : autre geste).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { removeCapo } from './capo.js';
import { purgeReferences } from './noteedit.js';
import { STAFF_LIST_KINDS, NOTE_LIST_KINDS, MARK_KINDS, CHORD_PROPERTY_MARKS } from './listindex.js';

/** Genres d'entrées de liste qu'on sait supprimer (les paroles sont exclues). */
export const DELETABLE_ENTRY_KINDS = Object.freeze(
  [...[...STAFF_LIST_KINDS, ...NOTE_LIST_KINDS].map(([, kind]) => kind).filter((k) => k !== 'lyric'), ...MARK_KINDS],
);

/** Types d'éléments de masterbar (listes du Mouvement) qu'on sait supprimer. */
export const DELETABLE_MASTERBAR_TYPES = Object.freeze(['volta', 'jump', 'marker', 'rehearsal', 'tempo', 'tempoChange', 'fermata', 'swing', 'cue', 'staffContainer']);

const staffOf = (doc, el) => {
  let cur = el;
  while (cur && cur.type !== 'staff') cur = doc.parentOf(cur.id);
  return cur ?? null;
};

/** Retire une note d'ornement ; si c'est la seule de son accord d'ornement, l'accord d'ornement disparaît. */
function removeGraceNote(doc, noteId) {
  const note = doc.find(noteId);
  if (!note) return;
  const grace = doc.parentOf(note.id);
  if (!grace || grace.type !== 'chord') return;
  const staff = staffOf(doc, grace);
  if (grace.notes.length > 1) {
    doc.remove(note);
    if (staff) purgeReferences(doc, staff, [note]);
    return;
  }
  const main = doc.parentOf(grace.id);
  if (!main || !Array.isArray(main.graceNotes) || !main.graceNotes.includes(grace)) return; // pas un ornement : rien à faire
  doc.remove(grace);
  if (staff) purgeReferences(doc, staff, [grace]);
}

/** Vrai si `id` est une entrée de liste supprimable par ce module. */
export function isDeletableEntry(doc, id) {
  const found = doc.findListEntry(id);
  return !!found && DELETABLE_ENTRY_KINDS.includes(found.kind);
}

/** Vrai si `el` est un élément de masterbar supprimable. */
export function isDeletableMasterbarElement(el) {
  return !!el && DELETABLE_MASTERBAR_TYPES.includes(el.type);
}

/**
 * Supprime une entrée de liste. Retourne true si quelque chose a été retiré.
 * Entrée disparue entre-temps ou genre non supprimable : false, rien n'est touché.
 */
export function deleteListEntry(doc, id) {
  const found = doc.findListEntry(id);
  if (!found || !DELETABLE_ENTRY_KINDS.includes(found.kind)) return false;
  const { owner, pid, entry, kind } = found;
  if (kind === 'capo') {
    removeCapo(doc, doc.movementOf(owner), owner, id);
    return true;
  }
  if (CHORD_PROPERTY_MARKS.some(([, k]) => k === kind)) {
    doc.reset(owner, pid);
    if (kind === 'dynamic' && owner.props?.[PID.DYNAMIC_TEXT] !== undefined) doc.reset(owner, PID.DYNAMIC_TEXT); // texte propre de la nuance
    return true;
  } // nuance, arpège, trémolo, tapping, slide
  const list = getProperty(owner, pid) ?? [];
  doc.set(owner, pid, list.filter((e) => e.id !== id));
  if (kind === 'bend' && (entry.type === 'preBend' || entry.type === 'preDive')) removeGraceNote(doc, entry.startNoteId);
  return true;
}

/** Supprime un élément de masterbar (volta, saut, marqueur, tempo, changement graduel, point d'orgue, swing). */
export function deleteMasterbarElement(doc, idOrEl) {
  const el = typeof idOrEl === 'string' ? doc.find(idOrEl) : idOrEl;
  if (!isDeletableMasterbarElement(el)) return false;
  doc.remove(el);
  return true;
}
