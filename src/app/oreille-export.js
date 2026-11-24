// Export de phrases vers Scorsaire : un fichier .scorsaire (JSON) qui s'ouvre dans Scorsaire ; plusieurs phrases = un document à plusieurs mouvements
// (l'inverse de l'import). Sans dépendance au navigateur (testable sous Node) : le téléchargement est fait par la page.
import { buildScore } from '../music/describe.js';
import { FILE_VERSION } from '../../vendor/scorsaire/src/model/serialize.js';

/** Fichier Scorsaire (forme JSON : { format, version, idCounter, work }) d'une phrase : { title, noteDoc } (créée ici ou importée) ou { title, desc } (répertoire de base). Le mouvement porte le titre de la phrase. */
export function fichierDe(phrase) {
  const doc = phrase.noteDoc ?? buildScore(phrase.desc);
  const fichier = JSON.parse(JSON.stringify((typeof doc === 'string' ? JSON.parse(doc) : doc).work)); // la « note » enveloppe un fichier Scorsaire
  const mv = fichier.work.movements?.[0];
  if (mv) mv.props = { ...mv.props, title: phrase.title };
  return fichier;
}

/** Donne à chaque élément (et à chaque renvoi vers lui) un identifiant propre à la phrase d'indice k : les identifiants de deux phrases écrites à des moments différents se ressemblent. */
function renumeroter(work, k) {
  if (k === 0) return work;
  const ids = new Set();
  (function voir(o) { if (Array.isArray(o)) o.forEach(voir); else if (o && typeof o === 'object') { if (typeof o.id === 'string' && typeof o.type === 'string') ids.add(o.id); Object.values(o).forEach(voir); } })(work);
  const neuf = (s) => (ids.has(s) ? `${s}x${k}` : s);
  return (function copie(o) {
    if (Array.isArray(o)) return o.map(copie);
    if (typeof o === 'string') return neuf(o);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([cle, v]) => [neuf(cle), copie(v)]));
    return o;
  })(work);
}

/** Texte d'un document Scorsaire contenant ces phrases (un mouvement chacune), dans l'ordre. */
export function documentScorsaire(phrases) {
  if (!phrases.length) throw new Error('Aucune phrase à exporter');
  const fichiers = phrases.map(fichierDe);
  const travaux = fichiers.map((f, k) => renumeroter(f.work, k));
  const base = travaux[0];
  base.movements = travaux.flatMap((w) => w.movements ?? []);
  base.parts = travaux.flatMap((w) => w.parts ?? []);
  base.sheets = travaux.flatMap((w) => w.sheets ?? []);
  base.props = { ...base.props, title: phrases.length === 1 ? phrases[0].title : 'Phrases Solfège' };
  return JSON.stringify({ format: 'scorsaire', version: FILE_VERSION, idCounter: Math.max(...fichiers.map((f) => f.idCounter ?? 0)), work: base });
}

/** Nom de fichier sûr (sans accents ni espaces) : « Ma petite phrase » → « Ma-petite-phrase.scorsaire ». */
export const nomDeFichier = (titre) => `${(titre || 'phrases').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'phrases'}.scorsaire`;
