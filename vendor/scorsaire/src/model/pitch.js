/*
 * Hauteurs et durées — fonctions pures partagées par le modèle et la mise en page.
 */
import { frac, fMul } from './fraction.js';

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Valeur MIDI d'une orthographe {step, alter, octave} (do central = C4 = 60). */
export function midiFromSpelling({ step, alter = 0, octave }) {
  return 12 * (octave + 1) + STEP_SEMITONE[step] + alter;
}

const SHARP_SPELLING = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELLING = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/**
 * Orthographe PAR DÉFAUT d'une hauteur MIDI quand le modèle n'en stocke pas : dièses dans une armure à dièses ou neutre, bémols dans une armure à
 * bémols (simplification du choix des noms de note de MuseScore, qui tient aussi compte du contexte mélodique). On reste sur les noms naturels de
 * 12 tons (jamais B#, Cb ici).
 */
export function defaultSpelling(pitch, keySig = 0) {
  const pc = ((pitch % 12) + 12) % 12;
  const [step, alter] = (keySig < 0 ? FLAT_SPELLING : SHARP_SPELLING)[pc];
  return { step, alter, octave: Math.floor(pitch / 12) - 1 };
}

/** Numéro de degré diatonique absolu (C0 = 0, D0 = 1, ... C1 = 7). Sert au placement sur la portée. */
export function diatonicIndex({ step, octave }) {
  return octave * 7 + STEP_INDEX[step];
}

/**
 * Valeurs de note (durées ÉCRITES) → fraction de ronde. Remplace l'ancienne unité de « ticks » du squelette
 * (ronde = 32) : le temps du modèle est désormais exact (voir fraction.js).
 */
export const DURATION_VALUE = {
  breve: frac(2),
  whole: frac(1),
  half: frac(1, 2),
  quarter: frac(1, 4),
  eighth: frac(1, 8),
  sixteenth: frac(1, 16),
  thirtysecond: frac(1, 32),
  sixtyfourth: frac(1, 64),
};

export const DURATION_BASES = Object.keys(DURATION_VALUE);

/**
 * Type de durée particulier du SILENCE DE MESURE (MuseScore : `V_MEASURE`) : un silence qui remplit toute la mesure,
 * quel que soit le chiffrage, dessiné centré. Stocké (pas dérivé). Sa durée réelle est la longueur de la mesure : elle
 * ne se calcule donc pas ici mais avec `itemDuration(item, longueurDeMesure)` (timing.js).
 */
export const MEASURE_DURATION = 'measure';

/** Durée ÉCRITE (valeur de note + points) en fraction de ronde : noire pointée = [3, 8]. */
export function writtenDuration({ base, dots = 0 }) {
  if (base === MEASURE_DURATION) {
    throw new Error('La durée « measure » (silence de mesure) dépend de la longueur de la mesure : utiliser itemDuration()');
  }
  const v = DURATION_VALUE[base];
  if (!v) throw new Error(`Valeur de durée inconnue : ${base}`);
  return fMul(v, frac(2 ** (dots + 1) - 1, 2 ** dots));
}

/**
 * Durée RÉELLE en fraction de ronde : durée écrite corrigée par un éventuel n-olet `{ratio:[num, den], …}`
 * (un triolet de croches est ratio [3, 2] : chaque croche vaut [1, 12]). Dérivée, jamais stockée
 * (CLAUDE.md : rien n'est figé quand c'est dérivable). Ne dépend jamais du tempo.
 */
export function actualDuration(duration, tuplet = null) {
  const w = writtenDuration(duration);
  return tuplet ? fMul(w, frac(tuplet.ratio[1], tuplet.ratio[0])) : w;
}

/**
 * Étendue totale d'un groupe n-olet `{ratio: [num, den], base}` : `den` fois la valeur de base du groupe
 * (un triolet de croches, ratio [3, 2] et base croche, occupe 2 croches = une noire ; un quintolet de doubles croches,
 * ratio [5, 4], en occupe 4 = une noire). C'est MuseScore : `Tuplet::baseLen` et `ratio`. Elle permet de savoir combien
 * de temps un groupe doit remplir, même quand l'un de ses éléments a été retiré.
 */
export function tupletSpan(tuplet) {
  return fMul(writtenDuration(tuplet.base), frac(tuplet.ratio[1]));
}

/** Longueur d'une mesure pour un chiffrage [num, den] : 3/4 → [3, 4], 6/8 → [3, 4]. */
export function timeSigDuration([num, den]) {
  return frac(num, den);
}
