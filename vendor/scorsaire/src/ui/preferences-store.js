/*
 * Magasin de préférences de l'application — sans DOM. Une section = un système de préférences (`model/preferences.js`) ; une section absente n'a pas de valeur choisie.
 *
 * PERSISTANCE (11/10/2026, demande de Jean) : si on lui donne un `storage` (même interface que `localStorage` : getItem / setItem / removeItem), le magasin s'y relit
 * à la création et s'y réécrit à chaque changement, sous la clé `key`, dans le format du fichier `scorsaire-preferences`. Le stockage est INJECTABLE (tests, autre
 * support) et toujours protégé par try / catch : navigateur qui l'interdit, quota, contenu illisible → le magasin reste en mémoire (`persistent` faux ou
 * `lastError` renseigné) ; l'export / l'import de fichier reste le filet de sécurité (le stockage d'un fichier ouvert hors serveur n'est pas garanti partout).
 */
import { PREFERENCE_SECTIONS, exportPreferences, importPreferences } from '../model/preferences.js';

export const PREFERENCES_STORAGE_KEY = 'scorsaire-preferences';

export function createPreferencesStore(initial = {}, { storage = null, key = PREFERENCES_STORAGE_KEY } = {}) {
  const values = {};
  const listeners = new Set();
  let lastError = null;
  const save = () => {
    if (!storage) return;
    try {
      if (Object.keys(values).length) storage.setItem(key, exportPreferences(values));
      else storage.removeItem(key);
      lastError = null;
    } catch (e) { lastError = e; }
  };
  const emit = () => { save(); listeners.forEach((fn) => fn()); };
  const store = {
    get: (name) => (values[name] === undefined ? undefined : structuredClone(values[name])),
    set(name, value) {
      const section = PREFERENCE_SECTIONS[name];
      if (!section) throw new Error(`Préférences : section inconnue « ${name} »`);
      const errors = section.validate(value);
      if (errors.length) throw new Error(`Préférences invalides (${name}) : ${errors[0]}`);
      values[name] = section.create(value);
      emit();
    },
    clear(name) { if (name in values) { delete values[name]; emit(); } },
    all: () => structuredClone(values),
    /** Texte du fichier `scorsaire-preferences` pour les sections choisies. */
    exportFile: () => exportPreferences(values),
    /** Lit un fichier de préférences (refusé en entier s'il est invalide) et remplace les sections qu'il contient. */
    importFile(input) {
      const read = importPreferences(input);
      Object.assign(values, read);
      emit();
      return Object.keys(read);
    },
    /** Vrai si un stockage est branché ET que la dernière écriture a réussi. */
    get persistent() { return !!storage && lastError === null; },
    get lastError() { return lastError; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  // relecture du stockage (jamais bloquante : un contenu absent, illisible ou refusé est ignoré)
  if (storage) {
    try {
      const text = storage.getItem(key);
      if (text) Object.assign(values, importPreferences(text));
    } catch (e) { lastError = e; }
  }
  for (const [name, value] of Object.entries(initial)) store.set(name, value);
  return store;
}
