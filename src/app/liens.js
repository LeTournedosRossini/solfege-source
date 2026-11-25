// Liens entre leçons et jeux, dans les deux sens (NAV-02, correspondances de l'annexe A du cahier), et noms des activités telles que le suivi les enregistre.
import { CATALOGUE } from './data/catalogue.js';

/** Leçon (identifiant) → jeux associés (identifiants de route : #/jeux/<id>, ou « oreille »). */
export const JEUX_DE_LECON = {
  'portee-cles': ['clef-sol', 'clef-fa'], 'notes-de-musique': ['clef-sol', 'clef-fa'], 'figures-de-note': ['durees-silences'], 'gammes-majeures': ['tonalites'],
  intervalles: ['intervalles', 'oreille'], 'mesure-temps': ['rythme', 'rythme-vue'], 'cercle-quintes': ['tonalites'], 'accords-base': ['accords'], 'degres-gamme': ['degres'],
  'silences-liaisons': ['durees-silences'], 'accords-septieme': ['accords'], 'harmonisation-degres': ['degres', 'accords'],
};
export const LECONS_DE_JEU = (() => { const m = {}; for (const [l, js] of Object.entries(JEUX_DE_LECON)) for (const j of js) (m[j] ||= []).push(l); return m; })();

const titreJeu = (id) => CATALOGUE.games.find((g) => g.id === id)?.title;
export const routeJeu = (id) => (id === 'oreille' ? '#/oreille' : `#/jeux/${id}`);
export const titreActivite = (id) => (id === 'oreille' ? 'Jeu d’oreille' : titreJeu(id) ?? id);

/** Activité enregistrée par le suivi (champ « j » des événements) → { titre, route }. */
const IDS_JEU = { ig: 'intervalles', ag: 'accords', dg: 'durees-silences', gg: 'degres', rythme: 'rythme', 'rythme-vue': 'rythme-vue', tonalites: 'tonalites', 'clef-sol': 'clef-sol', 'clef-fa': 'clef-fa' };
const OREILLE = { 'oreille-intervalles': 'Oreille : intervalles', 'oreille-gammes': 'Oreille : gammes et arpèges', 'oreille-phrases': 'Oreille : phrases' };
export function activite(j) {
  if (OREILLE[j]) return { titre: OREILLE[j], route: '#/oreille' };
  const id = IDS_JEU[j] ?? j;
  return { titre: titreJeu(id) ?? j, route: routeJeu(id) };
}

export const titreLecon = (id) => CATALOGUE.lessons.find((l) => l.id === id)?.title ?? id;

/** HTML des liens « Pour s'exercer » sous une leçon. */
export function liensExercices(leconId) {
  const js = JEUX_DE_LECON[leconId]; if (!js) return '';
  return `<nav class="liens-croises" aria-label="Pour s’exercer"><strong>Pour s’exercer :</strong> ${js.map((j) => `<a href="${routeJeu(j)}">${titreActivite(j)}</a>`).join(' · ')}</nav>`;
}
/** HTML des liens « Leçon à relire » sous un jeu. */
export function liensLecons(jeuId) {
  const ls = LECONS_DE_JEU[jeuId]; if (!ls) return '';
  return `<nav class="liens-croises" aria-label="Leçon à relire"><strong>Leçon à relire :</strong> ${ls.map((l) => `<a href="#/cours/${l}">${titreLecon(l)}</a>`).join(' · ')}</nav>`;
}

/** Jeu de lecture qui travaille un élément suivi (pour « Réviser ») ; null si l'élément n'appartient à aucun jeu de lecture (rythme, oreille…). */
const JEU_DE = { intervalle: 'intervalles', accord: 'accords', duree: 'durees-silences', degre: 'degres', tonalite: 'tonalites' };
export const jeuDeLecture = (e) => (e.startsWith('note:bass') ? 'clef-fa' : e.startsWith('note:') ? 'clef-sol' : JEU_DE[e.split(':')[0]] ?? null);
/** Jeux de lecture ayant des éléments à retravailler ou à revoir, du plus chargé au moins chargé : [[jeu, nombre], …]. `et` : Map des états (suivi.js, `etats`). */
export function jeuxARevoir(et) {
  const n = new Map();
  for (const x of et.values()) { if (x.m !== 'L' || (x.niveau !== 'a_retravailler' && x.niveau !== 'a_revoir')) continue; const j = jeuDeLecture(x.e); if (j) n.set(j, (n.get(j) || 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
}
