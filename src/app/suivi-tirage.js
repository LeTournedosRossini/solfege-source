// Choix des questions adapté à la progression (REV-01, règles 7.2 du cahier) : ce qui est à retravailler revient plus souvent, les nouveaux éléments sont introduits un ou deux à la fois,
// ce qui est maîtrisé est espacé, un élément n'est jamais reposé deux fois d'affilée et revient quelques questions après une erreur. Pur (sans navigateur), testable sous Node.
import { cleDe, JOUR } from './suivi.js';

export const PARTS = { travail: 0.5, nouveau: 0.3, maitrise: 0.2 };   // répartition indicative (7.2)
export const MAX_NOUVEAUX = 2;                                        // jamais plus de deux éléments en cours d'introduction
export const ESSAIS_INTRODUCTION = 3;                                 // un élément est « introduit » après trois réponses
export const RETOUR_APRES_ERREUR = 3;                                 // l'élément raté revient après trois autres questions

/** État d'une séance : mémoire courte pour ne pas répéter et rappeler les erreurs. */
export const nouvelleSeance = () => ({ dernier: null, rappels: [] });

const classe = (etat) => (!etat ? 'nouveau' : etat.niveau === 'maitrise' ? 'maitrise' : 'travail');
const erreursRecentes = (etat) => (etat ? etat.recents.filter((x) => !x).length : 0);
/** Part d'erreurs parmi les dernières réponses (0 à 1) : un élément réussi à 20 % pèse bien plus qu'un élément réussi à 95 %. */
const tauxErreur = (etat) => (etat && etat.recents.length ? erreursRecentes(etat) / etat.recents.length : 0);

/**
 * Choisit l'élément de la prochaine question.
 *   candidats : liste d'éléments possibles (identifiants) ; etats : Map « modalité|élément » → état (voir suivi.js, `etats`) ; m : modalité 'L' | 'O' ;
 *   seance : { dernier, rappels } (modifié) ; maintenant : ms ; rnd : générateur dans [0,1[ ;
 *   mode : 'adapte' (règles 7.2) ou 'erreurs' (seulement ce qui a été raté : à retravailler, à revoir, ou une erreur récente).
 * Renvoie l'identifiant choisi, ou null s'il n'y a rien à poser en mode « erreurs ».
 */
export function choisir({ candidats, etats, m, seance, maintenant = Date.now(), rnd = Math.random, mode = 'adapte' }) {
  if (!candidats.length) return null;
  const etat = (e) => etats.get(cleDe(e, m));
  seance.rappels.forEach((r) => { r.dans -= 1; });
  let pool = candidats;
  if (mode === 'erreurs') {
    pool = candidats.filter((e) => { const s = etat(e); return s && (s.niveau === 'a_retravailler' || s.niveau === 'a_revoir' || (s.niveau !== 'maitrise' && erreursRecentes(s) > 0)); });
    if (!pool.length) return null;
  }
  // un élément n'est pas reposé deux fois d'affilée (sauf s'il n'y a pas le choix)
  const sansDernier = pool.filter((e) => e !== seance.dernier);
  const base = sansDernier.length ? sansDernier : pool;
  let choix = null;
  // retour d'un élément raté, quelques questions plus tard
  const du = seance.rappels.filter((r) => r.dans <= 0 && base.includes(r.e));
  if (du.length) { choix = du[0].e; seance.rappels = seance.rappels.filter((r) => r !== du[0]); }
  if (choix === null) {
    const groupes = { travail: [], nouveau: [], maitrise: [] };
    for (const e of base) groupes[classe(etat(e))].push(e);
    // introduction progressive : pas de nouvel élément tant que deux éléments rencontrés ne sont pas encore « introduits »
    const enIntroduction = candidats.filter((e) => { const s = etat(e); return s && s.essais < ESSAIS_INTRODUCTION; }).length;
    if (mode === 'erreurs' || enIntroduction >= MAX_NOUVEAUX) groupes.nouveau = [];
    const poids = Object.entries(groupes).filter(([, l]) => l.length).map(([k]) => [k, PARTS[k]]);
    if (!poids.length) groupes.nouveau = base.slice(), poids.push(['nouveau', 1]);
    let r = rnd() * poids.reduce((t, [, w]) => t + w, 0), cat = poids[0][0];
    for (const [k, w] of poids) { if (r < w) { cat = k; break; } r -= w; }
    const liste = groupes[cat], pw = (e) => { const s = etat(e); return s ? 1 + 12 * erreursRecentes(s) * tauxErreur(s) + Math.min(2, (maintenant - s.dernier) / JOUR / 7) : 1; };
    const total = liste.reduce((t, e) => t + pw(e), 0); let x = rnd() * total;
    choix = liste[liste.length - 1];
    for (const e of liste) { const w = pw(e); if (x < w) { choix = e; break; } x -= w; }
  }
  seance.dernier = choix;
  return choix;
}

/** À appeler après la réponse : une erreur fait revenir l'élément quelques questions plus tard. */
export function apresReponse(seance, element, juste) {
  if (!juste && !seance.rappels.some((r) => r.e === element)) seance.rappels.push({ e: element, dans: RETOUR_APRES_ERREUR });
}
