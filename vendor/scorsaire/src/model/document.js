/*
 * Document = œuvre + index + historique. C'est la SEULE porte d'écriture du modèle.
 *
 * Aucune dépendance à une vue (décision d'étape 2) : le Document ne sait rien de la sélection ni de l'affichage.
 * Une vue s'abonne (`subscribe`) pour être prévenue des changements et émet des INTENTIONS que l'éditeur traduit
 * en transactions.
 *
 * Toute écriture se fait dans `doc.transaction(nom, () => { … })`. Pendant une transaction, les modifications
 * sont appliquées immédiatement ; si `fn` lève une erreur — ou si un invariant du modèle est violé à la fin —
 * tout est défait.
 */
import { touchedMeasures } from './dirty.js';
import { validateStyleValue, isSid } from './sid.js';
import { ensureIdsAtLeast } from './ids.js';
import { PID, PID_TABLE } from './pid.js';
import { getProperty, propertyFlags, propertyDefault, hasLocalValue, prepareValue, resolveStyle } from './props.js';
import { createHistory, changePropertyCommand, changeStyleCommand, structureCommand } from './history.js';
import { buildIndex, walk, ancestorOfType } from './store.js';
import { assertCanContain, validateWork } from './validate.js';
import { frozenClone } from './guard.js';
import { serializeWork } from './serialize.js';
import { buildListEntryIndex } from './listindex.js';

export class ModelInvariantError extends Error {
  constructor(errors) {
    super(`Le modèle violerait ses invariants :\n - ${errors.join('\n - ')}`);
    this.name = 'ModelInvariantError';
    this.errors = errors;
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** Refuse ce qui n'est pas de la donnée simple : fonctions, éléments du modèle (la vue stocke des identifiants, jamais des éléments). */
function assertPlainPayload(v, path = 'payload') {
  if (typeof v === 'function') throw new TypeError(`Charge utile de la vue : fonction refusée (${path})`);
  if (v && typeof v === 'object') {
    if (typeof v.id === 'string' && typeof v.type === 'string' && 'props' in v) {
      throw new TypeError(`Charge utile de la vue : élément du modèle refusé (${path}) — stocker son identifiant`);
    }
    for (const [k, x] of Object.entries(v)) assertPlainPayload(x, `${path}.${k}`);
  }
}
/** Copie gelée d'une charge utile de la vue (le Document n'en connaît pas le contenu). */
function viewPayload(payload) {
  assertPlainPayload(payload);
  return frozenClone(payload);
}

/**
 * @param work  Work du modèle
 * @param opts.checkInvariants  valider le modèle à la fin de chaque transaction (défaut : oui)
 */
export function createDocument(work, { checkInvariants = true } = {}) {
  // Identifiers created from now on must not collide with those of THIS work (a work built earlier, or by a reset of the counter, can hold
  // numbers above the counter): the largest numeric suffix of any "id" in the work (elements AND list entries) raises the counter.
  let maxId = 0;
  for (const m of JSON.stringify(work).matchAll(/"id":"[A-Za-z]+(\d+)"/g)) { const n = Number(m[1]); if (n > maxId) maxId = n; }
  ensureIdsAtLeast(maxId + 1);
  const index = buildIndex(work);
  const history = createHistory();
  const listeners = new Set();
  let depth = 0;

  const emit = (event) => {
    for (const fn of [...listeners]) fn(event);
  };

  /** Résout un élément ou un identifiant ; refuse un élément étranger à ce document. */
  // the staff a staffContainer hangs on: its parent staff, or — owned by a part — the staff named by `containerStaffId`
  const hostStaff = (id) => {
    const e = index.get(id);
    if (!e || e.el.type !== 'staffContainer') return null;
    if (e.parent?.type === 'staff') return e.parent;
    if (e.parent?.type === 'part') { const sid = e.el.props[PID.CONTAINER_STAFF_ID]; return sid ? index.get(sid)?.el ?? null : null; }
    return null;
  };
  const resolve = (target) => {
    const id = typeof target === 'string' ? target : target?.id;
    const entry = index.get(id);
    if (!entry) throw new Error(`Élément introuvable dans ce document : ${id}`);
    if (typeof target !== 'string' && entry.el !== target) throw new Error(`L'élément ${id} n'appartient pas à ce document`);
    return entry.el;
  };

  const layersFor = (el, ctx) => {
    const movement = ancestorOfType(index, el.id, 'movement');
    return [...(ctx?.layers ?? []), ...(movement ? [movement.style] : [])];
  };

  // Index de LECTURE des entrées de listes (liaisons, soufflets, doigtés…) : dérivé du modèle, reconstruit paresseusement au premier
  // accès après TOUTE modification (écriture, annulation d'une transaction en erreur, undo, redo). Jamais une voie d'écriture.
  let listIndex = null;
  const invalidateListIndex = () => { listIndex = null; };
  const listEntries = () => (listIndex ??= buildListEntryIndex(work, (id) => index.has(id)));

  const run = (command) => {
    if (!history.hasActive()) {
      throw new Error('Modification hors transaction : utiliser doc.transaction(nom, () => …)');
    }
    command.flip();
    invalidateListIndex();
    history.record(command);
  };

  const doc = {
    work,

    // ---------- lecture ----------
    find: (id) => index.get(id)?.el,
    /**
     * Entrée de liste (liaison, tie, soufflet, trille, ligne de technique, pédale, glissando, respiration, capo, accordage, trémolo
     * de couple, hopo, bend, doigté de note) retrouvée par identifiant : `{ id, kind, owner, pid, entry, index }` ou undefined.
     * LECTURE SEULE : pour modifier une entrée, écrire la propriété `pid` de `owner` dans une transaction. `doc.find` ne la connaît pas.
     */
    findListEntry: (id) => listEntries().byId.get(id),
    /** Identifiants d'entrée en double (corruption) : vide pour un modèle valide. */
    listEntryDuplicates: () => [...listEntries().duplicates],
    parentOf: (id) => index.get(id)?.parent ?? null,
    movementOf: (target) => {
      const id = resolve(target).id;
      const own = ancestorOfType(index, id, 'movement');
      if (own) return own;
      const host = hostStaff(id); // a container of a part has no movement above it: the one of the staff it hangs on
      return host ? ancestorOfType(index, host.id, 'movement') : null;
    },
    /** The staff a container hangs on: its parent staff, or (a container OWNED BY A PART, screen 2) the staff it names; null for anything else. */
    hostStaffOf: (target) => hostStaff(resolve(target).id),

    /** Position (0, 1, …) d'un masterbar dans son mouvement — dérivée à chaque appel, jamais stockée. */
    measureIndexOf(barId) {
      const movement = ancestorOfType(index, barId, 'movement');
      return movement ? movement.masterbars.findIndex((b) => b.id === barId) : -1;
    },

    /**
     * Valeur d'une propriété, style résolu (locale > ctx.layers > style du Mouvement > défaut).
     * @param ctx  { layers?: [dictionnaires de styles prioritaires] } — ex. l'onglet de l'écran 2 (plus tard)
     */
    get: (target, pid, ctx) => {
      const el = resolve(target);
      return getProperty(el, pid, layersFor(el, ctx));
    },
    flags: (target, pid) => propertyFlags(resolve(target), pid),
    defaultOf: (target, pid, ctx) => {
      const el = resolve(target);
      return propertyDefault(el, pid, layersFor(el, ctx));
    },
    getStyle: (movementTarget, sid, ctx) => {
      const mv = resolve(movementTarget);
      if (mv.type !== 'movement') throw new Error(`« ${mv.id} » n'est pas un mouvement`);
      return resolveStyle(sid, [...(ctx?.layers ?? []), mv.style]);
    },

    // ---------- écriture (dans une transaction) ----------

    /** Fixe une valeur locale. Renvoie false si rien n'a changé. */
    set(target, pid, value) {
      const el = resolve(target);
      const next = prepareValue(el, pid, value);
      const flags = propertyFlags(el, pid);
      const current = getProperty(el, pid, layersFor(el));
      // Une propriété stylée fixée à la valeur du style devient quand même une surcharge (elle ne suivra plus le style) ; une propriété
      // `explicit` (tri-état : vrai / faux / absent, ex. PID.PLAY) garde aussi une valeur locale égale à son défaut.
      if (deepEqual(current, next) && flags !== 'styled' && !(PID_TABLE[pid].explicit && !hasLocalValue(el, pid))) return false;
      run(changePropertyCommand(el, pid, { own: true, value: next }));
      return true;
    },

    /** Supprime la valeur locale : retour au style (propriété stylée) ou à la valeur par défaut. */
    reset(target, pid) {
      const el = resolve(target);
      propertyFlags(el, pid); // vérifie l'applicabilité
      if (!hasLocalValue(el, pid)) return false;
      run(changePropertyCommand(el, pid, { own: false }));
      return true;
    },

    /** Surcharge un style au niveau d'un Mouvement. */
    setStyle(movementTarget, sid, value) {
      const mv = resolve(movementTarget);
      if (mv.type !== 'movement' && mv.type !== 'part') throw new Error(`« ${mv.id} » n'est pas un mouvement ni une partie`);
      validateStyleValue(sid, value);
      if (Object.hasOwn(mv.style, sid) && deepEqual(mv.style[sid], value)) return false;
      run(changeStyleCommand(mv, sid, { own: true, value: frozenClone(value) }));
      return true;
    },

    resetStyle(movementTarget, sid) {
      const mv = resolve(movementTarget);
      if (mv.type !== 'movement' && mv.type !== 'part') throw new Error(`« ${mv.id} » n'est pas un mouvement ni une partie`);
      if (!isSid(sid)) throw new Error(`Style inconnu : ${sid}`);
      if (!Object.hasOwn(mv.style, sid)) return false;
      run(changeStyleCommand(mv, sid, { own: false }));
      return true;
    },

    /** Insère `el` dans `parent[key]` (à la fin par défaut). */
    add(parentTarget, key, el, at) {
      const parent = resolve(parentTarget);
      assertCanContain(parent, key, el);
      walk(el, (e) => {
        if (index.has(e.id)) throw new Error(`Identifiant déjà présent dans le document : ${e.id}`);
      });
      run(structureCommand({ index, parent, key, el, at: at ?? parent[key].length, add: true }));
      return el;
    },

    /** Retire un élément (et tout son sous-arbre). */
    remove(target) {
      const el = resolve(target);
      const entry = index.get(el.id);
      if (!entry.parent) throw new Error("L'œuvre elle-même ne peut pas être retirée");
      const at = entry.parent[entry.key].findIndex((x) => x.id === el.id);
      run(structureCommand({ index, parent: entry.parent, key: entry.key, el, at, add: false }));
      return el;
    },

    // ---------- transactions et historique ----------

    /**
     * Regroupe des modifications en UN pas d'annulation. Peut s'imbriquer (l'appel interne rejoint la transaction
     * externe). Toute erreur défait l'ensemble ; les invariants sont vérifiés à la sortie de la transaction externe.
     * `options.before` : charge utile OPAQUE de la vue (sélection, curseur de saisie…) à restaurer si on annule ; stockée avec la
     * transaction (copie gelée), jamais enregistrée dans le fichier. Sans option, rien n'est stocké. Complétée après le commit
     * par `setViewAfter`.
     */
    transaction(name, fn, options = {}) {
      if (depth > 0) return fn(); // imbriquée : rejoint l'externe, dont l'option `before` l'emporte
      // charge utile « avant » de la vue : copiée et gelée MAINTENANT (avant tout geste), opaque pour le Document
      const before = options.before === undefined ? undefined : viewPayload(options.before);
      history.begin(name, before);
      depth++;
      let result;
      try {
        result = fn();
        if (checkInvariants && history.activeSize() > 0) {
          // only the measures that were written are checked in depth when nothing else changed (everything else cannot have broken an invariant of theirs)
          const only = touchedMeasures(doc, history.activeInfos());
          const errors = validateWork(work, only ? { onlyMeasures: only } : undefined);
          if (errors.length) throw new ModelInvariantError(errors);
        }
      } catch (e) {
        depth--;
        history.end(true);
        invalidateListIndex(); // l'annulation de la transaction a défait des écritures
        throw e;
      }
      depth--;
      const t = history.end(false);
      if (t) emit({ type: 'commit', name: t.name, changes: t.commands.map((c) => c.info) });
      return result;
    },

    undo() {
      if (history.hasActive()) throw new Error('Annuler impossible pendant une transaction');
      if (!history.canUndo()) return false;
      const t = history.undo();
      invalidateListIndex();
      emit({ type: 'undo', name: t.name, changes: t.commands.map((c) => c.info), view: t.view.before });
      return true;
    },

    redo() {
      if (history.hasActive()) throw new Error('Refaire impossible pendant une transaction');
      if (!history.canRedo()) return false;
      const t = history.redo();
      invalidateListIndex();
      emit({ type: 'redo', name: t.name, changes: t.commands.map((c) => c.info), view: t.view.after });
      return true;
    },

    /**
     * Charge utile « après » de la vue pour la DERNIÈRE transaction validée (à appeler juste après `doc.transaction`). Lève une
     * erreur si la dernière action n'est pas un commit (transaction annulée ou vide, undo/redo, nouvelle transaction) : on ne
     * l'attache jamais à une mauvaise transaction. Le dernier appel l'emporte.
     */
    setViewAfter(payload) {
      history.setViewAfter(viewPayload(payload));
    },

    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    isClean: () => history.isClean(),
    markClean: () => history.markClean(),
    markDirty: () => history.markDirty(),
    historyNames: () => history.names(),
    historyPosition: () => history.position(),

    /** S'abonne aux changements ({type: 'commit' | 'undo' | 'redo', name, changes, view?} ; `view` = charge utile à restaurer pour undo/redo). Renvoie la fonction de désabonnement. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    validate: () => validateWork(work),
    save: () => serializeWork(work),
  };
  return doc;
}
