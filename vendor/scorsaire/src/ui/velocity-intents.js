/*
 * Intentions « vélocité imposée d'une note » (PID.USER_VELOCITY). AUCUN DOM : fonctions pures sur le Document, appelées par
 * l'Application dans `app.edit(...)`. Port du comportement de l'inspecteur de MuseScore 4.7.5 (lu) : entier 0-127, pas de 1,
 * 0 = automatique affiché « 64 » (`noteplaybackmodel.cpp`). Chez Scorsaire « Auto » EFFACE la valeur locale (retour à l'automatique).
 */
import { PID } from '../model/pid.js';
import { hasLocalValue } from '../model/props.js';

export const VELOCITY_TYPES = Object.freeze(['note', 'tabnote', 'percnote', 'accnote']);
export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;
/** Valeur affichée tant que rien n'est imposé (MuseScore affiche 64 quand la valeur est 0). */
export const VELOCITY_DISPLAY_DEFAULT = 64;

/** Notes visées : les notes sélectionnées + les notes des accords sélectionnés (sans doublon). */
export function velocityTargets(doc, ids) {
  const out = new Map();
  for (const id of ids) {
    const el = doc.find(id);
    if (!el) continue;
    if (VELOCITY_TYPES.includes(el.type)) out.set(el.id, el);
    else if (el.type === 'chord') for (const n of el.notes ?? []) if (VELOCITY_TYPES.includes(n.type)) out.set(n.id, n);
  }
  return [...out.values()];
}

/** Vélocité imposée localement (1-127) ou null = automatique. */
export const imposedVelocity = (note) => (hasLocalValue(note, PID.USER_VELOCITY) && note.props[PID.USER_VELOCITY] > 0 ? note.props[PID.USER_VELOCITY] : null);

/** État pour la barre : { count, auto (aucune imposée), value (affichée), mixed (valeurs différentes) } ou null si aucune note. */
export function velocityState(doc, ids) {
  const targets = velocityTargets(doc, ids);
  if (!targets.length) return null;
  const values = targets.map(imposedVelocity);
  const imposed = values.filter((v) => v !== null);
  const distinct = new Set(values.map((v) => v ?? 0));
  return {
    count: targets.length,
    auto: imposed.length === 0,
    value: imposed.length ? imposed[0] : VELOCITY_DISPLAY_DEFAULT,
    mixed: distinct.size > 1,
  };
}

/** Impose `value` (1-127) ou revient à l'automatique (null). À appeler dans `doc.transaction`. Retourne le nombre de notes changées. */
export function setVelocity(doc, ids, value) {
  if (value !== null && !(Number.isInteger(value) && value >= VELOCITY_MIN && value <= VELOCITY_MAX)) throw new Error(`setVelocity : entier ${VELOCITY_MIN}-${VELOCITY_MAX} ou null`);
  let changed = 0;
  for (const note of velocityTargets(doc, ids)) {
    if (imposedVelocity(note) === value) continue;
    if (value === null) { if (hasLocalValue(note, PID.USER_VELOCITY)) doc.reset(note, PID.USER_VELOCITY); } else doc.set(note, PID.USER_VELOCITY, value);
    changed++;
  }
  return changed;
}

/** Décale la vélocité de `delta` (valeur de départ : celle affichée, 64 si automatique), bornée à 1-127. */
export function stepVelocity(doc, ids, delta) {
  const st = velocityState(doc, ids);
  if (!st) return 0;
  return setVelocity(doc, ids, Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, st.value + delta)));
}
