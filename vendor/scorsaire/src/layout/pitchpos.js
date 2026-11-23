/*
 * Position d'une note sur la portée (en espaces depuis la ligne du bas : une ligne = 1, un interligne = +0,5).
 */
import { diatonicIndex, defaultSpelling } from '../model/index.js';
import { CLEF_DEFS } from './constants.js';

/** Position verticale d'une note (orthographe {step, alter, octave}) pour une clé (G, F, C1 à C5, clés d'octave). */
export function noteY(spelling, clefKey) {
  const clef = CLEF_DEFS[clefKey];
  if (!clef) throw new Error(`Clé inconnue : ${clefKey}`);
  return (diatonicIndex(spelling) - diatonicIndex(clef.bottomLine)) * 0.5;
}

/**
 * Orthographe d'une note : celle du modèle si elle existe, sinon une orthographe par défaut à partir de la hauteur :
 * dièses dans une armure à dièses ou neutre, bémols dans une armure à bémols (simplification du choix des noms de note de
 * MuseScore, qui tient aussi compte du contexte mélodique).
 */
export function spellingOf(pitch, spelling, keySig = 0) {
  return spelling || defaultSpelling(pitch, keySig);
}
