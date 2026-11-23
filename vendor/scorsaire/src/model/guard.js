/*
 * Garde d'écriture (mode strict) — filet de sécurité de développement.
 *
 * Principe (décision validée à l'étape 2) : toute modification du modèle passe par une COMMANDE de l'historique.
 * Une écriture directe (`note.props.pitch = 60`, `measure.items.push(...)`) contournerait l'annuler/refaire
 * sans aucune erreur. En mode strict, les propriétés et les listes d'enfants sont enveloppées dans un Proxy
 * qui refuse toute écriture hors d'une commande (`withWrites`). Les tests l'activent ; en production il est
 * désactivé par défaut (coût nul). S'applique aux éléments créés APRÈS l'activation.
 */

let strict = false;
let writeDepth = 0;

export function setStrict(value) {
  strict = Boolean(value);
}

export function isStrict() {
  return strict;
}

/** Exécute `fn` en autorisant les écritures (réservé aux commandes de l'historique). */
export function withWrites(fn) {
  writeDepth++;
  try {
    return fn();
  } finally {
    writeDepth--;
  }
}

function deny(action) {
  throw new Error(
    `Modification directe du modèle interdite (${action}) : passer par le Document (set/add/remove/setStyle) dans une transaction`
  );
}

/** Enveloppe un objet ou une liste ; sans effet hors mode strict. */
export function guard(target) {
  if (!strict) return target;
  return new Proxy(target, {
    set(t, key, value) {
      if (!writeDepth) deny(`écriture de « ${String(key)} »`);
      return Reflect.set(t, key, value);
    },
    deleteProperty(t, key) {
      if (!writeDepth) deny(`suppression de « ${String(key)} »`);
      return Reflect.deleteProperty(t, key);
    },
    defineProperty(t, key, descriptor) {
      if (!writeDepth) deny(`définition de « ${String(key)} »`);
      return Reflect.defineProperty(t, key, descriptor);
    },
  });
}

/** Gèle récursivement une valeur JSON (les valeurs de propriétés ne se modifient jamais sur place). */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Copie profonde gelée : la valeur stockée n'est jamais partagée avec l'appelant. */
export function frozenClone(value) {
  return deepFreeze(value === undefined ? undefined : structuredClone(value));
}
