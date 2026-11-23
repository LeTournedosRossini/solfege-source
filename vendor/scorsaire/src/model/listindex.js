/*
 * Index de LECTURE des entrées de listes (étape 5, tranche 2 bis).
 *
 * Les liaisons, ties, soufflets, trilles, lignes de technique, pédales, glissandos, respirations, capos, accordages, trémolos de
 * couple, hopos, bends (listes d'une portée) et les doigtés (liste d'une note) sont des ENTRÉES `{ id, … }` rangées dans la valeur
 * d'une propriété `list`. Elles ont un identifiant stable mais ne sont pas des éléments de l'arbre : `doc.find` ne les connaît pas.
 * Cet index les rend retrouvables par identifiant : id → { id, kind, owner, pid, entry, index }.
 *
 * C'est un DÉRIVÉ pur du modèle : il ne modifie rien et n'est JAMAIS une voie d'écriture (toute modification reste
 * `doc.transaction` + `doc.set` sur la propriété du propriétaire). Le Document le reconstruit paresseusement après toute écriture.
 */
import { PID } from './pid.js';
import { walk } from './store.js';

/** Listes d'une PORTÉE dont les entrées portent un identifiant : [pid, genre d'entrée]. */
export const STAFF_LIST_KINDS = Object.freeze([
  [PID.HAIRPINS, 'hairpin'], [PID.TRILLS, 'trill'], [PID.BREATHS, 'breath'], [PID.TIES, 'tie'], [PID.SLURS, 'slur'],
  [PID.HOPOS, 'hopo'], [PID.BENDS, 'bend'], [PID.WHEELS, 'wheel'], [PID.TECH_LINES, 'techline'], [PID.TREMOLOS, 'tremolo'],
  [PID.GLISSANDOS, 'glissando'], [PID.PEDALS, 'pedal'], [PID.CAPOS, 'capo'], [PID.STRING_TUNINGS, 'stringtuning'], [PID.LYRIC_LINKS, 'lyric'], [PID.STAFF_TEXTS, 'stafftext'],
]);

/** Listes d'une NOTE (quel que soit son type de portée). */
export const NOTE_LIST_KINDS = Object.freeze([[PID.FINGERINGS, 'fingering']]);

/**
 * MARQUES D'ACCORD (étape 5, suppression des marques) : articulations (liste d'un accord ou d'une note de percussion, entrées `{ id, … }`) et
 * marques portées par une PROPRIÉTÉ de l'accord (nuance, arpège, trémolo sur une note, tapping, slide) — celles-ci n'ont pas d'identifiant
 * propre : l'index leur en donne un SYNTHÉTIQUE, `<id de l'accord><suffixe>`, que la mise en page reprend à l'identique (`sel`).
 */
export const CHORD_ARTICULATION_KIND = 'articulation';
export const CHORD_PROPERTY_MARKS = Object.freeze([
  [PID.DYNAMIC, 'dynamic', '-dyn'], [PID.ARPEGGIO, 'arpeggio', '-arp'], [PID.TREMOLO, 'chordtremolo', '-trem'],
  [PID.TAPPING, 'tapping', '-tap'], [PID.CHORD_LINE, 'chordline', '-cl'],
]);
/** Genres de marques d'accord. */
export const MARK_KINDS = Object.freeze([CHORD_ARTICULATION_KIND, ...CHORD_PROPERTY_MARKS.map(([, k]) => k)]);

const NOTE_TYPES = new Set(['note', 'tabnote', 'percnote', 'accnote', 'rhythmnote']);

/** Tous les genres d'entrées indexées. */
export const LIST_ENTRY_KINDS = Object.freeze([...STAFF_LIST_KINDS, ...NOTE_LIST_KINDS].map(([, k]) => k));

const kindsOf = (el) => (el.type === 'staff' ? STAFF_LIST_KINDS : NOTE_TYPES.has(el.type) ? NOTE_LIST_KINDS : null);

/**
 * @param work        œuvre
 * @param isElementId (id) → vrai si c'est déjà l'identifiant d'un élément de l'arbre (collision refusée)
 * @returns {{ byId: Map<string, {id, kind, owner, pid, entry, index}>, duplicates: string[] }}
 */
export function buildListEntryIndex(work, isElementId = () => false) {
  const byId = new Map();
  const duplicates = [];
  walk(work, (el) => {
    if (el.type === 'chord' || NOTE_TYPES.has(el.type)) {
      const arts = el.props?.[PID.ARTICULATIONS];
      if (Array.isArray(arts)) {
        arts.forEach((entry, index) => {
          if (!entry || typeof entry.id !== 'string') return;
          if (byId.has(entry.id) || isElementId(entry.id)) { duplicates.push(entry.id); return; }
          byId.set(entry.id, { id: entry.id, kind: CHORD_ARTICULATION_KIND, owner: el, pid: PID.ARTICULATIONS, entry, index });
        });
      }
    }
    if (el.type === 'chord') {
      for (const [pid, kind, suffix] of CHORD_PROPERTY_MARKS) {
        const value = el.props?.[pid];
        if (value === undefined || value === null) continue;
        const id = `${el.id}${suffix}`;
        if (byId.has(id) || isElementId(id)) { duplicates.push(id); continue; }
        byId.set(id, { id, kind, owner: el, pid, entry: { id, value }, index: -1 });
      }
    }
    const kinds = kindsOf(el);
    if (!kinds) return;
    for (const [pid, kind] of kinds) {
      const list = el.props?.[pid];
      if (!Array.isArray(list)) continue;
      list.forEach((entry, index) => {
        if (!entry || typeof entry.id !== 'string') return;
        if (byId.has(entry.id) || isElementId(entry.id)) { duplicates.push(entry.id); return; }
        byId.set(entry.id, { id: entry.id, kind, owner: el, pid, entry, index });
      });
    }
  });
  return { byId, duplicates };
}
