/*
 * Fractions exactes — le temps musical du modèle (décision d'étape 2, session du 26/09).
 *
 * Une fraction est une paire d'entiers RÉDUITE `[numérateur, dénominateur]` (dénominateur > 0), exprimée en
 * fraction de RONDE : noire = [1, 4], croche de triolet = [1, 12], quintolet de doubles croches = [1, 20].
 * Deux instants sont égaux ssi leurs paires sont égales : aucune tolérance à régler, l'alignement de deux
 * portées ou de deux voix (un triolet contre deux croches) est exact. Même principe que `Fraction` dans MuseScore.
 *
 * Les valeurs sont gelées (et donc directement stockables dans le modèle, sérialisables en JSON telles quelles).
 * Les nombres décimaux n'apparaissent qu'à la sortie : secondes (avec le tempo), ticks MIDI (`fToTicks`).
 * Un dépassement d'entier sûr (2^53) lève une erreur au lieu de produire un résultat faux.
 */

/** Résolution des ticks à l'export (MIDI, audio) : 960 par noire. Sans effet sur le modèle. */
export const PPQ = 960;

const gcd = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

/** Construit une fraction réduite. */
export function frac(n, d = 1) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new Error(`Fraction hors limites (entiers sûrs dépassés) : ${n}/${d}`);
  }
  if (d === 0) throw new Error('Fraction : dénominateur nul');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return Object.freeze([n / g, d / g]);
}

/** Vrai pour une paire d'entiers réduite, à dénominateur strictement positif. */
export function isFraction(v) {
  return Array.isArray(v) && v.length === 2 && Number.isSafeInteger(v[0]) && Number.isSafeInteger(v[1])
    && v[1] > 0 && gcd(v[0], v[1]) === 1;
}

export const ZERO = frac(0, 1);

export function fAdd([n1, d1], [n2, d2]) {
  const g = gcd(d1, d2);
  return frac(n1 * (d2 / g) + n2 * (d1 / g), (d1 / g) * d2);
}

export function fSub(a, [n, d]) {
  return fAdd(a, [-n, d]);
}

export function fMul([n1, d1], [n2, d2]) {
  const g1 = gcd(n1, d2) || 1;
  const g2 = gcd(n2, d1) || 1;
  return frac((n1 / g1) * (n2 / g2), (d1 / g2) * (d2 / g1));
}

export function fDiv(a, [n, d]) {
  if (n === 0) throw new Error('Division par une fraction nulle');
  return fMul(a, [d, n]);
}

/** -1, 0 ou 1 (comparaison exacte par produit en croix). */
export function fCmp([n1, d1], [n2, d2]) {
  const l = n1 * d2;
  const r = n2 * d1;
  if (!Number.isSafeInteger(l) || !Number.isSafeInteger(r)) throw new Error('Comparaison de fractions hors limites');
  return l < r ? -1 : l > r ? 1 : 0;
}

export const fEq = (a, b) => a[0] === b[0] && a[1] === b[1]; // paires réduites : égalité structurelle
export const fLt = (a, b) => fCmp(a, b) < 0;
export const fLe = (a, b) => fCmp(a, b) <= 0;
export const fMin = (a, b) => (fCmp(a, b) <= 0 ? a : b);
export const fMax = (a, b) => (fCmp(a, b) >= 0 ? a : b);

export function fSum(list) {
  return list.reduce((acc, f) => fAdd(acc, f), ZERO);
}

/** Valeur décimale (affichage, calculs de position en pixels — jamais pour comparer deux instants). */
export const fToNumber = ([n, d]) => n / d;

/** Nombre de ticks à `ppq` par noire, ARRONDI à l'entier le plus proche (sortie MIDI/audio uniquement). */
export function fToTicks([n, d], ppq = PPQ) {
  return Math.round((n * 4 * ppq) / d);
}

/** Fraction de ronde correspondant à un nombre entier de ticks (import MIDI). */
export function fFromTicks(ticks, ppq = PPQ) {
  return frac(ticks, 4 * ppq);
}
