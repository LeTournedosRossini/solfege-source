/*
 * Accès aux propriétés — fonctions libres sur des éléments qui sont des données pures.
 *
 * Modèle (à la MuseScore, mais sans indicateur séparé) : une propriété a ou n'a pas de valeur LOCALE
 * (`el.props[pid]`). Son état (`propertyFlags`) en découle :
 *   - 'nostyle'  : pas de style associé ; sans valeur locale, la valeur par défaut de la table Pid ;
 *   - 'styled'   : associée à un Sid, sans valeur locale → suit le style (chaîne de résolution, voir sid.js) ;
 *   - 'unstyled' : associée à un Sid, avec valeur locale → surcharge, ne suit plus le style.
 * Réinitialiser = supprimer la valeur locale.
 *
 * Ces fonctions LISENT. Les écritures passent par le Document (commandes annulables) ; seuls `readLocal` /
 * `writeLocal` (réservés à l'historique) touchent réellement aux données.
 */
import { PID_TABLE, validatePropertyValue } from './pid.js';
import { SID_TABLE } from './sid.js';
import { isApplicable } from './schema.js';
import { deepFreeze, frozenClone } from './guard.js';

for (const d of Object.values(PID_TABLE)) deepFreeze(d.default);

export function assertApplicable(el, pid) {
  if (!PID_TABLE[pid]) throw new Error(`Propriété inconnue : ${pid}`);
  if (!isApplicable(el.type, pid)) {
    throw new Error(`La propriété « ${pid} » ne s'applique pas à un élément de type « ${el.type} »`);
  }
}

/**
 * Valeur d'un style : première couche de `layers` (ordre de priorité décroissant) qui le définit, sinon défaut du Sid.
 * @param layers  liste de dictionnaires { sid: valeur } (ex. [styleDeLOnglet, styleDuMouvement])
 */
// The USER layer: the style values the user chose on this device (preferences), seen by every layout between the layers of the document and the defaults of the table.
// It is set by the application (never by the document); `userStyleEpoch()` changes with it so that layout caches know to start again.
let userLayer = {};
let userEpoch = 0;
export function setUserStyleLayer(layer) { userLayer = layer ?? {}; userEpoch++; }
export const userStyleEpoch = () => userEpoch;

export function resolveStyle(sid, layers = []) {
  for (const layer of layers) {
    if (layer && Object.hasOwn(layer, sid)) return layer[sid];
  }
  if (Object.hasOwn(userLayer, sid)) return userLayer[sid];
  const def = SID_TABLE[sid];
  if (!def) throw new Error(`Style inconnu : ${sid}`);
  return def.default;
}

/** Valeur par défaut d'une propriété pour un élément : celle du style si elle est stylée, sinon celle de la table. */
export function propertyDefault(el, pid, layers = []) {
  assertApplicable(el, pid);
  const d = PID_TABLE[pid];
  return d.sid ? resolveStyle(d.sid, layers) : d.default;
}

export function hasLocalValue(el, pid) {
  return Object.hasOwn(el.props, pid);
}

/** 'nostyle' | 'styled' | 'unstyled' (voir en-tête). */
export function propertyFlags(el, pid) {
  assertApplicable(el, pid);
  if (!PID_TABLE[pid].sid) return 'nostyle';
  return hasLocalValue(el, pid) ? 'unstyled' : 'styled';
}

export function getProperty(el, pid, layers = []) {
  assertApplicable(el, pid);
  if (hasLocalValue(el, pid)) return el.props[pid];
  return propertyDefault(el, pid, layers);
}

// ---------- réservé à l'historique et aux constructeurs ----------

/** État local d'une propriété : { own, value } (sert de mémoire pour annuler). */
export function readLocal(el, pid) {
  return hasLocalValue(el, pid) ? { own: true, value: el.props[pid] } : { own: false };
}

/** Applique un état local. À appeler dans `withWrites` (mode strict). */
export function writeLocal(el, pid, state) {
  if (state.own) el.props[pid] = state.value;
  else delete el.props[pid];
}

/** Valide, clone et gèle une valeur avant stockage. */
export function prepareValue(el, pid, value) {
  assertApplicable(el, pid);
  validatePropertyValue(pid, value);
  return frozenClone(value);
}
