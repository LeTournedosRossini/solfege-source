/*
 * Index id → élément (+ parent et clé de liste). Reconstruit à la création du Document, tenu à jour par les
 * commandes structurelles. Sert à retrouver un élément PAR IDENTITÉ (jamais par position) et à remonter au
 * Mouvement qui porte les styles.
 */
import { elementSchema } from './schema.js';

/** Parcourt l'arbre en profondeur : fn(élément, parent, clé). */
export function walk(el, fn, parent = null, key = null) {
  fn(el, parent, key);
  for (const childKey of Object.keys(elementSchema(el.type).children)) {
    for (const child of el[childKey]) walk(child, fn, el, childKey);
  }
}

export function buildIndex(root) {
  const index = new Map();
  walk(root, (el, parent, key) => {
    if (index.has(el.id)) throw new Error(`Identifiant en double : ${el.id}`);
    index.set(el.id, { el, parent, key });
  });
  return index;
}

/** Ajoute tout le sous-arbre de `el` (déjà attaché à `parent[key]`). */
export function indexSubtree(index, el, parent, key) {
  walk(el, (e, p, k) => {
    if (index.has(e.id)) throw new Error(`Identifiant en double : ${e.id}`);
    index.set(e.id, { el: e, parent: p, key: k });
  }, parent, key);
}

export function unindexSubtree(index, el) {
  walk(el, (e) => index.delete(e.id));
}

/** Ancêtre de type donné (ou l'élément lui-même). */
export function ancestorOfType(index, id, type) {
  let entry = index.get(id);
  while (entry) {
    if (entry.el.type === type) return entry.el;
    entry = entry.parent ? index.get(entry.parent.id) : null;
  }
  return null;
}
