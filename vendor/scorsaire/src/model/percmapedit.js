/*
 * Édition de la carte de percussion d'UNE portée (étape 5, éditeur de percmap). Lecture et écriture au niveau du Document : à appeler dans `doc.transaction`.
 * Règles (décisions de Jean, 13/10/2026) : l'identité d'un son est son NOM (identifiant anglais) ; le n° MIDI est un attribut (un principal + d'autres) ;
 * renommer un son migre les notes qui l'utilisent dans la même transaction ; supprimer est refusé tant que des notes l'utilisent (sauf remplaçant).
 * Invariant du modèle : tout son d'une note existe dans la carte de sa portée (`validate.js`) — chaque opération le respecte avant d'écrire.
 */
import { PID } from './pid.js';
import { walk } from './store.js';
import {
  DEFAULT_PERCMAP, createPercMap, createDrumSound, drumSound, validatePercMap, updateDrumSound, removeDrumSound, addDrumSound, moveDrumSound, withDrumSwitches,
} from './percmap.js';

export class PercMapError extends Error {
  constructor(code, message, data = {}) { super(message); this.name = 'PercMapError'; this.code = code; this.data = data; }
}

/** Carte en vigueur d'une portée (la sienne, sinon la batterie de Scorsaire). */
export const staffPercMap = (staff) => staff.props?.[PID.PERCMAP] ?? DEFAULT_PERCMAP;

const percnotesOf = (staff) => { const out = []; walk(staff, (el) => { if (el.type === 'percnote') out.push(el); }); return out; };

/** Nombre de notes de la portée qui utilisent chaque son : Map(id → nombre). */
export function soundUsageMap(staff) {
  const counts = new Map();
  for (const n of percnotesOf(staff)) { const id = n.props?.[PID.SOUND]; counts.set(id, (counts.get(id) ?? 0) + 1); }
  return counts;
}

/** Écrit la carte de la portée (la valide d'abord). Une carte contenant des sons encore utilisés par des notes ne peut pas les perdre. */
export function storePercMap(doc, staff, map) {
  const errors = validatePercMap(map);
  if (errors.length) throw new PercMapError('invalid', errors[0]);
  const orphans = [...soundUsageMap(staff)].filter(([id]) => !drumSound(map, id));
  if (orphans.length) throw new PercMapError('in-use', `des notes utilisent des sons que cette carte ne connaîtrait plus : ${orphans.map(([id, n]) => `« ${id} » (${n})`).join(', ')}`, { orphans: orphans.map(([id, count]) => ({ id, count })), count: orphans.reduce((n, [, c]) => n + c, 0) });
  doc.set(staff, PID.PERCMAP, map);
  return map;
}

/** Modifie les réglages d'un son (tête, ligne, voix, hampe, MIDI, noms…) — pas son identifiant (voir `renameSound`). */
export function updateSound(doc, staff, id, changes) {
  if (!drumSound(staffPercMap(staff), id)) throw new PercMapError('unknown', `Son inconnu : ${id}`, { id });
  if ('id' in changes && changes.id !== id) throw new PercMapError('invalid', 'renommer passe par renameSound');
  return storePercMap(doc, staff, updateDrumSound(staffPercMap(staff), id, changes));
}

/** Renomme un son (son identifiant) ; les notes qui l'utilisent suivent dans la même transaction. */
export function renameSound(doc, staff, id, newId) {
  const map = staffPercMap(staff);
  if (!drumSound(map, id)) throw new PercMapError('unknown', `Son inconnu : ${id}`, { id });
  if (newId === id) return map;
  if (drumSound(map, newId)) throw new PercMapError('conflict', `Un son porte déjà l'identifiant « ${newId} »`, { name: newId });
  const next = updateDrumSound(map, id, { id: newId });
  const errors = validatePercMap(next);
  if (errors.length) throw new PercMapError('invalid', errors[0]);
  for (const n of percnotesOf(staff)) if (n.props[PID.SOUND] === id) doc.set(n, PID.SOUND, newId);
  doc.set(staff, PID.PERCMAP, next);
  return next;
}

export function addSound(doc, staff, sound) {
  const map = staffPercMap(staff);
  if (drumSound(map, sound.id)) throw new PercMapError('conflict', `Un son porte déjà l'identifiant « ${sound.id} »`, { name: sound.id });
  return storePercMap(doc, staff, addDrumSound(map, createDrumSound(sound)));
}

/** Supprime un son. Refusé si des notes l'utilisent, sauf `replaceWith` (autre son de la carte vers lequel elles migrent). */
export function removeSound(doc, staff, id, { replaceWith = null } = {}) {
  const map = staffPercMap(staff);
  if (!drumSound(map, id)) throw new PercMapError('unknown', `Son inconnu : ${id}`, { id });
  const used = soundUsageMap(staff).get(id) ?? 0;
  if (used && !replaceWith) throw new PercMapError('in-use', `${used} note(s) utilisent le son « ${id} »`, { id, count: used });
  if (used && (replaceWith === id || !drumSound(map, replaceWith))) throw new PercMapError('invalid', `Remplaçant invalide : ${replaceWith}`);
  if (used) for (const n of percnotesOf(staff)) if (n.props[PID.SOUND] === id) doc.set(n, PID.SOUND, replaceWith);
  doc.set(staff, PID.PERCMAP, removeDrumSound(map, id));
}

/** Sets the entry-button groups of the staff's map ([{ id, sounds }] ; null = the default groups). */
export function setSwitches(doc, staff, switches) {
  return storePercMap(doc, staff, withDrumSwitches(staffPercMap(staff), switches));
}

export function moveSound(doc, staff, id, toIndex) {
  return storePercMap(doc, staff, moveDrumSound(staffPercMap(staff), id, toIndex));
}

/**
 * Remplace la carte par une autre (préréglage, import). Les sons utilisés par des notes doivent exister dans la nouvelle carte, sinon refusé ;
 * `matchByMidi` : un son utilisé absent est cherché par n° MIDI (principal ou autre) et les notes migrent vers lui (échange Guitar Pro / General MIDI).
 */
export function replacePercMap(doc, staff, map, { matchByMidi = false } = {}) {
  const next = createPercMap(map);
  const old = staffPercMap(staff);
  if (matchByMidi) {
    const moves = new Map();
    for (const [id] of soundUsageMap(staff)) {
      if (drumSound(next, id)) continue;
      const from = drumSound(old, id);
      const target = from && [from.midi, ...(from.midiAlso ?? [])].filter((m) => m !== null && m !== undefined).map((m) => next.sounds.find((s) => s.midi === m || s.midiAlso?.includes(m))).find(Boolean);
      if (target) moves.set(id, target.id);
    }
    const errors = validatePercMap(next);
    if (errors.length) throw new PercMapError('invalid', errors[0]);
    for (const n of percnotesOf(staff)) { const to = moves.get(n.props[PID.SOUND]); if (to) doc.set(n, PID.SOUND, to); }
  }
  return storePercMap(doc, staff, next);
}
