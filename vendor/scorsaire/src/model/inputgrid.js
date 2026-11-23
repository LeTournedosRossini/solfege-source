/*
 * Grille de saisie des symboles d'accord (étape 5, tranche 6). PUR, sans DOM. Fonctions de LECTURE ; les écritures passent par
 * `setInputGrid` / les intentions de `ui/chordentry-intents.js`, toujours dans une transaction.
 *
 * Une CASE = un symbole possible : `{ start, length }` en fractions exactes de ronde, depuis le début de la mesure. Sans réglage
 * (`PID.INPUT_GRID` null) la grille vient du chiffrage : un temps par case (mesure composée 6/8, 9/8, 12/8 : une noire pointée),
 * ou de `beamGrouping` s'il existe ; une anacrouse garde l'alignement sur la mesure complète (`measureOffsetOf`).
 * Subdiviser une case la coupe en deux (÷2) ; « rétablir » efface le réglage (retour à la grille dérivée).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { frac, fAdd, fSub, fMul, fCmp, fEq, fLt, fLe, isFraction, ZERO } from './fraction.js';
import { measureLengthOf, measureOffsetOf } from './timing.js';
import { DURATION_VALUE, writtenDuration } from './pitch.js';

/** Plus petite case permise (une triple croche). */
export const MIN_CELL = frac(1, 32);

/** Cases dérivées du chiffrage sur la mesure NOMINALE : [{ start, length }]. */
function nominalCells(timeSig, beamGrouping) {
  const [num, den] = timeSig;
  let sizes;
  if (beamGrouping?.length) sizes = beamGrouping.map((n) => frac(n, den));
  else if (den >= 8 && num % 3 === 0) sizes = Array.from({ length: num / 3 }, () => frac(3, den));
  else sizes = Array.from({ length: num }, () => frac(1, den));
  const cells = [];
  let at = ZERO;
  for (const length of sizes) { cells.push({ start: at, length }); at = fAdd(at, length); }
  return cells;
}

/** Grille dérivée d'un masterbar (sans le réglage `inputGrid`). `isFirst` : 1re mesure du Mouvement (anacrouse automatique). */
export function derivedInputGrid(masterbar, isFirst = false) {
  const length = measureLengthOf(masterbar);
  const offset = measureOffsetOf(masterbar, isFirst);
  const cells = [];
  for (const c of nominalCells(getProperty(masterbar, PID.TIME_SIG), getProperty(masterbar, PID.BEAM_GROUPING))) {
    let start = fSub(c.start, offset);
    let end = fSub(fAdd(c.start, c.length), offset);
    if (fLe(end, ZERO)) continue;
    if (fLt(start, ZERO)) start = ZERO;
    if (fLt(length, end)) end = length;
    if (fLe(end, start)) continue;
    cells.push({ start, length: fSub(end, start) });
  }
  return cells.length ? cells : [{ start: ZERO, length }];
}

/** Débuts de cases → cases ({ start, length }) sur une mesure de longueur `length`. */
export function cellsFromStarts(starts, length) {
  return starts.map((start, i) => ({ start, length: fSub(i + 1 < starts.length ? starts[i + 1] : length, start) }));
}

/** Erreur de forme d'une liste de débuts (null = valide). */
export function inputGridError(starts, length) {
  if (!Array.isArray(starts) || !starts.length) return 'liste vide';
  if (!starts.every(isFraction)) return 'fraction attendue';
  if (!fEq(starts[0], ZERO)) return 'la première case doit commencer à 0';
  for (let i = 1; i < starts.length; i++) if (fCmp(starts[i - 1], starts[i]) >= 0) return 'débuts non croissants';
  if (!fLt(starts[starts.length - 1], length)) return 'case hors de la mesure';
  return null;
}

/** Cases d'une mesure : le réglage du masterbar s'il est valide, sinon la grille dérivée. */
export function inputGridOf(masterbar, isFirst = false) {
  const length = measureLengthOf(masterbar);
  const own = getProperty(masterbar, PID.INPUT_GRID);
  if (own && !inputGridError(own, length)) return cellsFromStarts(own, length);
  return derivedInputGrid(masterbar, isFirst);
}

/** Vrai si le masterbar porte un réglage propre de grille. */
export const hasOwnInputGrid = (masterbar) => getProperty(masterbar, PID.INPUT_GRID) !== null;

/** Index de la case qui contient `position` (la dernière si au-delà), ou -1 si la liste est vide. */
export function cellIndexAt(cells, position) {
  let found = -1;
  cells.forEach((c, i) => { if (fLe(c.start, position)) found = i; });
  return found;
}

/** Débuts de cases après avoir coupé la case `index` en deux ; null si elle est trop petite (< 2 × MIN_CELL). */
export function splitStarts(cells, index) {
  const c = cells[index];
  if (!c) return null;
  const half = fMul(c.length, frac(1, 2));
  if (fLt(half, MIN_CELL)) return null;
  const starts = cells.map((x) => x.start);
  starts.splice(index + 1, 0, fAdd(c.start, half));
  return starts;
}

/** Débuts de `count` cases ÉGALES sur une mesure de longueur `length` ; null si une case serait plus petite que `MIN_CELL`. */
export function equalStarts(length, count) {
  if (!Number.isInteger(count) || count < 1) return null;
  const size = fMul(length, frac(1, count));
  if (fLt(size, MIN_CELL)) return null;
  return Array.from({ length: count }, (_, i) => fMul(length, frac(i, count)));
}

/** Nombres de cases proposés pour une mesure : de 1 au nombre de cases de sa grille DÉRIVÉE (les temps), sans les nombres impossibles. */
export function slotOptions(masterbar, isFirst = false) {
  const length = measureLengthOf(masterbar);
  const max = derivedInputGrid(masterbar, isFirst).length;
  return Array.from({ length: max }, (_, i) => i + 1).filter((n) => equalStarts(length, n));
}

/** Valeur de note + points dont la durée vaut exactement `length`, ou null (cases impossibles à écrire : 5/8…). */
export function durationOfLength(length) {
  for (const base of Object.keys(DURATION_VALUE)) {
    for (const dots of [0, 1, 2]) if (fEq(writtenDuration({ base, dots }), length)) return { base, dots };
  }
  return null;
}

/** Durée écrite d'un symbole qui occupe `length` : exacte si possible, sinon la plus grande valeur qui tient. */
export function fitDuration(length) {
  const exact = durationOfLength(length);
  if (exact) return exact;
  let best = { base: 'sixtyfourth', dots: 0 };
  for (const base of Object.keys(DURATION_VALUE)) {
    for (const dots of [0, 1, 2]) {
      const w = writtenDuration({ base, dots });
      if (fLe(w, length) && fCmp(w, writtenDuration(best)) > 0) best = { base, dots };
    }
  }
  return best;
}
