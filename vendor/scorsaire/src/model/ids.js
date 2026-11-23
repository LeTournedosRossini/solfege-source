/*
 * Identifiants stables des éléments (roadmap §1 : jamais se fier à la position dans une collection).
 * Format : préfixe + entier croissant (« n12 »). Le compteur est partagé par tous les documents du processus ;
 * au chargement d'un fichier il est remonté au-dessus du plus grand identifiant lu (voir serialize.js).
 */

let nextId = 1;

export function newId(prefix = 'e') {
  return `${prefix}${nextId++}`;
}

/** Réinitialise le compteur (tests déterministes). */
export function resetIds() {
  nextId = 1;
}

/** Valeur du prochain entier qui sera attribué (sauvegardée dans le fichier). */
export function idCounter() {
  return nextId;
}

/** Garantit que les prochains identifiants seront tous ≥ `n` (jamais de collision après un chargement). */
export function ensureIdsAtLeast(n) {
  if (Number.isInteger(n) && n > nextId) nextId = n;
}

/** Partie numérique d'un identifiant (« n12 » → 12), ou 0 s'il n'en a pas. */
export function idNumber(id) {
  const m = /(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : 0;
}
