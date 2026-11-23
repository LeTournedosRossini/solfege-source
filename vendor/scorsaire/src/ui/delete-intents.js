/*
 * Supprimer des éléments sélectionnés (SANS DOM) — le geste de la barre contextuelle (tablette) et du clic droit (souris).
 * Règles : une note dont l'accord garde d'autres notes est retirée de l'accord ; un accord dont toutes les notes sont visées (ou l'accord
 * lui-même) devient silence (`noteedit.deleteItem`, mesures toujours remplies, n-olets compris) ; un silence de voix 2-4 devient un trou
 * invisible, un silence de voix 1 ne se supprime pas (il se recalcule). Concernés aussi : les ENTRÉES DE LISTE (liaisons, soufflets,
 * pédales, bends, doigtés… : `model/markdelete.js`) et les éléments de MASTERBAR (volta, saut, marqueur, tempo, point d'orgue, swing).
 * Les paroles ne se suppriment pas ici.
 */
import { deleteItem, removeNoteFromChord } from '../model/noteedit.js';
import { isDeletableEntry, isDeletableMasterbarElement, deleteListEntry, deleteMasterbarElement } from '../model/markdelete.js';

const NOTE_TYPES = ['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote'];

function voiceIndexOfRest(doc, rest) {
  const measure = doc.parentOf(rest.id);
  const voice = measure && doc.parentOf(measure.id);
  const staff = voice && doc.parentOf(voice.id);
  return staff?.voices ? staff.voices.indexOf(voice) : -1;
}

/** Sous-ensemble supprimable de `ids` (identifiants existants, accords / notes / silences de voix 2-4). */
export function deletableIds(doc, ids) {
  return ids.filter((id) => {
    if (isDeletableEntry(doc, id)) return true;
    const el = doc.find(id);
    if (!el) return false;
    if (isDeletableMasterbarElement(el)) return true;
    if (el.type === 'chord' || NOTE_TYPES.includes(el.type)) return true;
    return el.type === 'rest' && voiceIndexOfRest(doc, el) > 0;
  });
}

/**
 * À appeler dans `doc.transaction`. Retourne `{ select, count }` : les notes restantes des accords partiellement vidés (sinon rien).
 */
export function deleteElements(doc, ids) {
  const chords = new Map(); // id d'accord → { all: bool, notes: Set }
  const rests = [];
  const marks = [];
  for (const id of deletableIds(doc, ids)) {
    if (doc.findListEntry(id)) { marks.push(id); continue; }
    const el = doc.find(id);
    if (isDeletableMasterbarElement(el)) { marks.push(id); continue; }
    if (el.type === 'rest') { rests.push(id); continue; }
    const chordId = el.type === 'chord' ? el.id : doc.parentOf(el.id)?.id;
    if (!chordId) continue;
    if (!chords.has(chordId)) chords.set(chordId, { all: false, notes: new Set() });
    if (el.type === 'chord') chords.get(chordId).all = true; else chords.get(chordId).notes.add(el.id);
  }
  const select = [];
  let count = 0;
  for (const [chordId, g] of chords) {
    const chord = doc.find(chordId);
    if (!chord) continue;
    const whole = g.all || chord.notes.every((n) => g.notes.has(n.id)) || chord.notes.length <= g.notes.size;
    if (whole) { deleteItem(doc, chord); count++; continue; }
    for (const nid of g.notes) { if (doc.find(nid)) { removeNoteFromChord(doc, nid); count++; } }
    select.push(...chord.notes.filter((n) => !g.notes.has(n.id)).map((n) => n.id));
  }
  for (const id of rests) { const r = doc.find(id); if (r) { deleteItem(doc, r); count++; } }
  // marques : après les accords (une marque dont l'ancre vient de disparaître a déjà été réglée par `deleteItem`)
  for (const id of marks) {
    if (doc.findListEntry(id)) { if (deleteListEntry(doc, id)) count++; } else if (deleteMasterbarElement(doc, id)) count++;
  }
  return { select, count };
}
