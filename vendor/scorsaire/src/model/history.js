/*
 * Historique annuler/refaire — même principe que MuseScore (editing/transaction/undostack.h, editproperty.cpp).
 *
 * - Une COMMANDE mémorise l'état inverse de ce qu'elle vient d'appliquer ; `flip()` échange l'état courant et
 *   l'état mémorisé. Le même code sert donc à annuler ET à refaire (`ChangeProperty::flip` chez MuseScore).
 * - Une TRANSACTION regroupe plusieurs commandes : un seul pas d'annulation pour un geste composé.
 * - La pile ne stocke que des commandes, jamais de copie du modèle.
 * - Ouvrir une nouvelle transaction validée vide la partie « refaire ».
 *
 * Cycle de vie d'une commande : créée avec l'état CIBLE, `flip()` immédiat (applique, mémorise l'état d'avant),
 * puis enregistrée dans la transaction active.
 */
import { readLocal, writeLocal } from './props.js';
import { PID } from './pid.js';
import { withWrites } from './guard.js';
import { indexSubtree, unindexSubtree } from './store.js';

/** Modification d'une propriété : { own, value } cible (own:false = retour à la valeur par défaut / au style). */
export function changePropertyCommand(el, pid, target) {
  let state = target;
  // the list of ties of a staff: both lists go with the record, so that the incremental layout can tell which ties changed (and re-lay out only the measures they touch)
  const lists = pid === PID.TIES ? { before: readLocal(el, pid)?.value, after: target.own ? target.value : undefined } : null;
  return {
    name: 'ChangeProperty',
    info: { kind: 'property', id: el.id, pid, ...(lists ?? {}) },
    flip() {
      const current = readLocal(el, pid);
      withWrites(() => writeLocal(el, pid, state));
      state = current;
    },
  };
}

const readLocalStyle = (movement, sid) =>
  Object.hasOwn(movement.style, sid) ? { own: true, value: movement.style[sid] } : { own: false };

/** Modification d'un style surchargé au niveau du Mouvement. */
export function changeStyleCommand(movement, sid, target) {
  let state = target;
  return {
    name: 'ChangeStyle',
    info: { kind: 'style', id: movement.id, sid },
    flip() {
      const current = readLocalStyle(movement, sid);
      withWrites(() => {
        if (state.own) movement.style[sid] = state.value;
        else delete movement.style[sid];
      });
      state = current;
    },
  };
}

/**
 * Ajout ou retrait d'un élément dans la liste `parent[key]`. Le retrait retrouve l'élément PAR IDENTITÉ
 * (jamais par sa position mémorisée) ; la position ne sert qu'à le remettre au même endroit.
 */
export function structureCommand({ index, parent, key, el, at, add }) {
  let adding = add;
  let position = at;
  return {
    name: add ? 'AddElement' : 'RemoveElement',
    info: { kind: 'structure', id: el.id, parentId: parent.id, key },
    flip() {
      withWrites(() => {
        const list = parent[key];
        if (adding) {
          position = Math.min(position, list.length);
          list.splice(position, 0, el);
          indexSubtree(index, el, parent, key);
        } else {
          const i = list.findIndex((x) => x.id === el.id);
          if (i < 0) throw new Error(`Élément ${el.id} introuvable dans ${parent.id}.${key}`);
          position = i;
          list.splice(i, 1);
          unindexSubtree(index, el);
        }
      });
      adding = !adding;
    },
  };
}

export function createHistory() {
  const transactions = [];
  let position = 0; // nombre de transactions appliquées
  let cleanPosition = 0; // position au dernier « enregistré » (-1 : plus jamais atteignable)
  let active = null;
  let lastCommitted = null; // dernière transaction validée, tant que rien d'autre ne s'est passé (cible de `setViewAfter`)

  const flipAll = (t, reverse) => {
    const cmds = reverse ? [...t.commands].reverse() : t.commands;
    for (const c of cmds) c.flip();
  };

  return {
    hasActive: () => active !== null,
    activeSize: () => (active ? active.commands.length : 0),
    /** The `info` records of what the active transaction has written so far (model/dirty.js reads them). */
    activeInfos: () => (active ? active.commands.map((c) => c.info) : []),

    /** `view` : charge utile OPAQUE de la vue avant le geste (déjà clonée et gelée par l'appelant) ; le Document n'en lit rien. */
    begin(name, view) {
      if (active) throw new Error('Une transaction est déjà ouverte');
      lastCommitted = null;
      active = { name, commands: [], view: { before: view, after: undefined } };
    },

    record(command) {
      if (!active) throw new Error('Modification hors transaction : utiliser doc.transaction(nom, () => …)');
      active.commands.push(command);
    },

    /** Ferme la transaction. `rollback` : défait tout ce qu'elle a fait. Renvoie la transaction validée, ou null. */
    end(rollback) {
      const t = active;
      active = null;
      if (!t) throw new Error('Aucune transaction ouverte');
      lastCommitted = null;
      if (rollback) {
        flipAll(t, true);
        return null;
      }
      if (!t.commands.length) return null;
      transactions.length = position; // on abandonne la branche « refaire »
      if (cleanPosition > position) cleanPosition = -1;
      transactions.push(t);
      position++;
      lastCommitted = t;
      return t;
    },

    /** Charge utile « après » de la dernière transaction validée (déjà gelée). Refusée si la dernière action n'est pas ce commit. */
    setViewAfter(view) {
      if (!lastCommitted) throw new Error('setViewAfter : la dernière action n\'est pas une transaction validée');
      lastCommitted.view.after = view;
    },

    canUndo: () => position > 0,
    canRedo: () => position < transactions.length,

    undo() {
      lastCommitted = null;
      const t = transactions[--position];
      flipAll(t, true);
      return t;
    },

    redo() {
      lastCommitted = null;
      const t = transactions[position++];
      flipAll(t, false);
      return t;
    },

    isClean: () => position === cleanPosition,
    markClean() {
      cleanPosition = position;
    },
    /** The document counts as modified although nothing was done to it here (a draft taken back after a crash): never clean again until it is saved. */
    markDirty() {
      cleanPosition = -1;
    },

    /** Noms des transactions (du plus ancien au plus récent) et position courante — pour un menu Édition. */
    names: () => transactions.map((t) => t.name),
    position: () => position,
  };
}
