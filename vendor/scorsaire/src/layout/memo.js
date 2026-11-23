/*
 * Mémos de mise en page : résolutions par portée (liaisons, soufflets, paroles, trémolos à deux accords…) rattachées au
 * CONTEXTE d'UNE mise en page (`ctx.memo`, créé par `buildContext`). Elles naissent et meurent avec elle.
 *
 * Pourquoi pas des `WeakMap` globales : le Document modifie les éléments EN PLACE et leur identité reste stable ; un mémo indexé
 * par l'objet portée devenait donc périmé dès la première édition (et `staffBends` gardait le style du 1er appel). Ici rien ne
 * survit à un rendu : aucun état caché hors des données, aucune péremption possible (contrat de l'étape 5, §4).
 * Plus tard, le cache entre les rendus réintroduira ces résolutions avec une invalidation par portée pilotée par `changes`.
 */
export function createLayoutMemo() {
  const stores = new Map(); // genre de résolution → WeakMap(portée → valeur)
  return {
    /** Valeur du genre `kind` pour `staff` ; `compute(staff)` n'est appelé qu'une fois par portée dans ce contexte (null / false compris). */
    of(kind, staff, compute) {
      let store = stores.get(kind);
      if (!store) { store = new WeakMap(); stores.set(kind, store); }
      if (store.has(staff)) return store.get(staff);
      const value = compute(staff);
      store.set(staff, value);
      return value;
    },
  };
}
