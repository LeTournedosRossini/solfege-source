/*
 * Internationalisation (roadmap §1) : modèle et code en anglais, interface en français par défaut,
 * anglais en option, via un catalogue clé → texte. Les catalogues sont des données pures, extensibles
 * par la communauté (même principe que percmap / accordage / dictionnaire de qualités).
 */
import fr from './fr.js';
import en from './en.js';

export const CATALOGS = { fr, en };
export const DEFAULT_LANG = 'fr';

/** Crée une fonction de traduction. Repli : langue par défaut, puis la clé elle-même. */
export function createI18n(lang = DEFAULT_LANG, catalogs = CATALOGS) {
  const chain = [catalogs[lang], catalogs[DEFAULT_LANG]].filter(Boolean);
  return function t(key, params = {}) {
    let text = key;
    for (const c of chain) {
      if (Object.prototype.hasOwnProperty.call(c, key)) {
        text = c[key];
        break;
      }
    }
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
}
