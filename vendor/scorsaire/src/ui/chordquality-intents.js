/*
 * Intentions « dictionnaire de qualités d'accord » (étape 5, tranche 5). AUCUN DOM : fonctions sur le Document, appelées par l'Application à l'intérieur de
 * `app.edit(...)` (donc UNE transaction, annulable avec les symboles migrés). Elles ne produisent leurs écritures qu'APRÈS avoir tout vérifié : une intention
 * refusée (`ChordQualityError`) n'a rien écrit.
 *
 * Règles de Jean (11/10/2026) : le dictionnaire est une propriété du document ; renommer une qualité migre les symboles qui l'utilisent dans la même
 * transaction ; supprimer est refusé tant que des symboles l'utilisent (le nombre est indiqué), sauf si un remplaçant est donné ; tout changement qui rendrait
 * inconnue la qualité d'un symbole (alias retiré, remise à zéro, import) est refusé de la même façon.
 */
import * as dict from '../model/chordquality.js';
import { PID } from '../model/pid.js';
import { workChordQualities, chordQualityTextCounts, chordQualityUsage, unknownChordQualities, storeChordQualities, migrateChordSymbolQualities } from '../model/chordqualityedit.js';

const { ChordQualityError } = dict;

/** Dictionnaire en vigueur pour le document. */
export const getChordQualities = (doc) => workChordQualities(doc.work);

/** Nombre de symboles qui utilisent la qualité (identifiant ou alias). */
export function chordQualityUse(doc, id) {
  const quality = getChordQualities(doc).qualities.find((x) => x.id === id);
  return quality ? chordQualityUsage(doc.work, quality) : 0;
}

/** Nombre de symboles par qualité : Map(identifiant → nombre), plus les textes inconnus du dictionnaire (clé = le texte). */
export function chordQualityUsageMap(doc) {
  const counts = chordQualityTextCounts(doc.work);
  const out = new Map(getChordQualities(doc).qualities.map((x) => [x.id, chordQualityUsage(doc.work, x, counts)]));
  for (const { text, count } of unknownChordQualities(doc.work, getChordQualities(doc))) out.set(text, count);
  return out;
}

const describe = (orphans) => orphans.map((o) => `« ${o.text || '(aucune)'} » (${o.count})`).join(', ');

/** Refuse un dictionnaire qui rendrait inconnue la qualité de symboles qui la connaissaient (les textes déjà inconnus avant ne comptent pas). */
function guard(doc, next, message = 'des symboles utilisent des qualités que ce dictionnaire ne connaîtrait plus') {
  const before = new Set(unknownChordQualities(doc.work, getChordQualities(doc)).map((x) => x.text));
  const orphans = unknownChordQualities(doc.work, next).filter((x) => !before.has(x.text));
  if (orphans.length) throw new ChordQualityError('in-use', `${message} : ${describe(orphans)}`, { orphans, count: orphans.reduce((n, o) => n + o.count, 0) });
}

const createFrom = (d, id, q) => ({ ...d, qualities: d.qualities.map((x) => (x.id === id ? q : x)) });
const apply = (doc, next) => storeChordQualities(doc, next);

/** Ajoute une qualité { id, intervals, aliases? }. */
export function addQuality(doc, spec) {
  apply(doc, dict.addQuality(getChordQualities(doc), dict.withAutoShown(spec)));
}

/** Remplace les intervalles (demi-tons, tout entier de 0 à 127) d'une qualité. */
export function setIntervals(doc, id, intervals) {
  apply(doc, dict.setQualityIntervals(getChordQualities(doc), id, intervals));
}

/** Remplace les alias d'une qualité ; un alias retiré que des symboles utilisent est refusé. */
export function setAliases(doc, id, aliases) {
  const next = dict.setQualityAliases(getChordQualities(doc), id, aliases);
  guard(doc, next, 'des symboles utilisent un alias retiré');
  apply(doc, next);
}

/** Écritures affichables d'une qualité (liste de boutons composés) ; l'écriture choisie est retirée si elle n'y est plus. N'affecte aucun symbole (l'affichage change seul). */
export function setVariants(doc, id, variants) {
  apply(doc, dict.setQualityVariants(getChordQualities(doc), id, variants));
}

/** Choisit l'écriture affichée d'une qualité (`null` = affichage dérivé de l'identifiant). */
export function setShown(doc, id, shown) {
  apply(doc, dict.setQualityShown(getChordQualities(doc), id, shown));
}

/** Espacements (em) entre les pièces de l'écriture affichée d'une qualité ; l'affichage change seul. */
export function setGaps(doc, id, gaps) {
  apply(doc, dict.setQualityGaps(getChordQualities(doc), id, gaps));
}

/** Intervalles d'une qualité notés par leur autre écriture (♯4 au lieu de ♭5…). */
export function setEnharmonic(doc, id, list) {
  apply(doc, dict.setQualityEnharmonic(getChordQualities(doc), id, list));
}

/** Orthographe des notes d'une portée d'accords : 'enharmonic' (défaut) | 'key'. */
export function setSpelling(doc, staff, mode) {
  if (staff?.type !== 'staff' || doc.get(staff, PID.STAFF_TYPE) !== 'chord') throw new ChordQualityError('invalid', 'orthographe des notes : réservée à une portée d\'accords');
  if (!['enharmonic', 'key'].includes(mode)) throw new ChordQualityError('invalid', `orthographe des notes : « ${mode} » inconnu`);
  doc.set(staff, PID.CHORD_SPELLING, mode);
}

/** Change l'identifiant d'une qualité et migre, dans la même transaction, les symboles qui l'utilisaient sous cet identifiant. Renvoie le nombre de symboles migrés. */
export function renameQuality(doc, id, newId) {
  if (newId === id) return 0;
  // Sans écriture choisie, la qualité garde son apparence actuelle (écriture dérivée de l'ancien identifiant)
  const current = getChordQualities(doc);
  const old = current.qualities.find((x) => x.id === id);
  const base = old && old.shown == null && dict.withAutoShown(old) !== old
    ? createFrom(current, id, dict.withAutoShown(old)) : current;
  const next = dict.renameQuality(base, id, newId);
  const migrated = migrateChordSymbolQualities(doc, [id], newId);
  apply(doc, next);
  return migrated;
}

/**
 * Supprime une qualité. Si des symboles l'utilisent (identifiant ou alias) : refusé (`in-use`, avec le nombre) sauf si `replaceWith` désigne l'identifiant d'une
 * AUTRE qualité du dictionnaire, vers laquelle ils sont migrés. Renvoie le nombre de symboles migrés.
 */
export function removeQuality(doc, id, { replaceWith } = {}) {
  const current = getChordQualities(doc);
  const quality = current.qualities.find((x) => x.id === id);
  if (!quality) throw new ChordQualityError('unknown', `dictionnaire de qualités : « ${id} » n'existe pas`, { id });
  const used = chordQualityUsage(doc.work, quality);
  const next = dict.removeQuality(current, id);
  if (used === 0) { apply(doc, next); return 0; }
  if (replaceWith === undefined) throw new ChordQualityError('in-use', `${used} symbole(s) d'accord utilisent « ${id || '(aucune)'} »`, { id, count: used });
  if (replaceWith === id || !next.qualities.some((x) => x.id === replaceWith)) throw new ChordQualityError('unknown', `le remplaçant « ${replaceWith} » n'est pas une autre qualité du dictionnaire`, { id: replaceWith });
  const migrated = migrateChordSymbolQualities(doc, dict.chordQualityNames(quality), replaceWith);
  apply(doc, next);
  return migrated;
}

/** Remet une qualité intégrée telle qu'à l'origine (intervalles et alias). */
export function resetQuality(doc, id) {
  const next = dict.resetQuality(getChordQualities(doc), id);
  guard(doc, next, 'des symboles utilisent un alias que la remise à zéro retirerait');
  apply(doc, next);
}

/** Restaure une qualité intégrée qui a été supprimée ou renommée (ajoutée en fin de liste, définition d'origine). */
export function restoreQuality(doc, id) {
  apply(doc, dict.restoreQuality(getChordQualities(doc), id));
}

/** Revient aux qualités intégrées pour tout le dictionnaire. Refusé si des symboles utilisent une qualité qui n'y est pas. */
export function resetAll(doc) {
  const next = dict.createChordQualities();
  guard(doc, next, 'des symboles utilisent des qualités absentes du dictionnaire intégré');
  apply(doc, next);
}

/** Remplace tout le dictionnaire (fichier importé, défaut de l'application) ; refusé si des symboles perdent leur qualité. */
export function replaceDictionary(doc, next) {
  const errors = dict.validateChordQualities(next);
  if (errors.length) throw new ChordQualityError('invalid', errors[0]);
  guard(doc, next, 'des symboles utilisent des qualités absentes de ce dictionnaire');
  apply(doc, next);
}

/** Lit un fichier `scorsaire-chord-qualities` (texte ou objet) puis le range comme `replaceDictionary`. */
export function importDictionary(doc, input) {
  let next;
  try { next = dict.importChordQualities(input); } catch (e) { throw new ChordQualityError('invalid', e.message); }
  replaceDictionary(doc, next);
}
