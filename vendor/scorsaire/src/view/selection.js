/*
 * Sélection d'une vue : LISTE d'identifiants (jamais d'éléments). Pure, sans DOM.
 * Un événement n'est émis que si la liste change réellement (comme MuseScore : pas de notification sans changement).
 * Plage (Maj + clic) : non codée dans cette tranche.
 */
export function createSelection() {
  let ids = [];
  const listeners = new Set();
  const emit = () => { const snap = [...ids]; for (const fn of [...listeners]) fn(snap); };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const set = (next) => {
    const uniq = [...new Set(next)];
    if (same(uniq, ids)) return false;
    ids = uniq;
    emit();
    return true;
  };
  return {
    ids: () => [...ids],
    has: (id) => ids.includes(id),
    /** Remplace la sélection. */
    replace: (list) => set(list),
    /** Bascule chaque identifiant (Ctrl + clic). */
    toggle(list) {
      const next = [...ids];
      for (const id of list) {
        const k = next.indexOf(id);
        if (k >= 0) next.splice(k, 1); else next.push(id);
      }
      return set(next);
    },
    clear: () => set([]),
    /** Retire les identifiants qui ne satisfont plus `keep` (éléments disparus). */
    prune: (keep) => set(ids.filter(keep)),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
