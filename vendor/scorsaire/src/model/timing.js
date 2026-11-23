/*
 * Temps d'une mesure : longueur d'une mesure et durée de son contenu, en fractions exactes de ronde.
 * (Fonctions de LECTURE — les invariants correspondants sont vérifiés par validate.js.)
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { isApplicable } from './schema.js';
import { MEASURE_DURATION, actualDuration, timeSigDuration } from './pitch.js';
import { fSum, fEq, fLt, fSub, ZERO } from './fraction.js';

/**
 * Longueur RÉELLE d'une mesure : sa longueur propre si elle est irrégulière (anacrouse…, propriété `measureLength`),
 * sinon celle du chiffrage. MuseScore : `Measure::ticks()` contre `Measure::timesig()` (`isIrregular`).
 */
export function measureLengthOf(masterbar) {
  return getProperty(masterbar, PID.MEASURE_LENGTH) ?? timeSigDuration(getProperty(masterbar, PID.TIME_SIG));
}

/** Vrai si la mesure est irrégulière : sa longueur diffère de celle du chiffrage. */
export function isIrregularMeasure(masterbar) {
  const len = getProperty(masterbar, PID.MEASURE_LENGTH);
  return len !== null && !fEq(len, timeSigDuration(getProperty(masterbar, PID.TIME_SIG)));
}

/**
 * Décalage de la mesure : position, dans la mesure NOMINALE (chiffrage), où commence son contenu. Les temps (donc les
 * silences automatiques et les ligatures) s'alignent sur la mesure complète, pas sur le début de cette mesure.
 * Valeur explicite (`measureOffset`) sinon automatique, comme MuseScore (`Measure::anacrusisOffset`) : pour la 1re mesure
 * du mouvement plus courte que le chiffrage, chiffrage − longueur (l'anacrouse est la FIN d'une mesure complète) ;
 * sinon 0 (une mesure raccourcie au milieu du morceau part de son début).
 */
export function measureOffsetOf(masterbar, isFirstInMovement) {
  const explicit = getProperty(masterbar, PID.MEASURE_OFFSET);
  if (explicit !== null) return explicit;
  if (isFirstInMovement) {
    const nominal = timeSigDuration(getProperty(masterbar, PID.TIME_SIG));
    const length = measureLengthOf(masterbar);
    if (fLt(length, nominal)) return fSub(nominal, length);
  }
  return ZERO;
}

/** Vrai pour une anacrouse : le contenu de la mesure ne commence pas au début de la mesure nominale. */
export function isAnacrusis(masterbar, isFirstInMovement) {
  return !fEq(measureOffsetOf(masterbar, isFirstInMovement), ZERO);
}

/** Vrai pour un silence de mesure (durée `measure`). */
export function isMeasureRest(item) {
  return isApplicable(item.type, PID.DURATION) && getProperty(item, PID.DURATION).base === MEASURE_DURATION;
}

/** Durée réelle d'un élément de mesure (accord, silence…), n-olet compris ; un silence de mesure vaut la mesure. */
export function itemDuration(item, measureLength) {
  const duration = getProperty(item, PID.DURATION);
  if (duration.base === MEASURE_DURATION) return measureLength;
  const tuplet = isApplicable(item.type, PID.TUPLET) ? getProperty(item, PID.TUPLET) : null;
  return actualDuration(duration, tuplet);
}

/** Somme des durées du contenu d'une voix dans une mesure. */
export function voiceMeasureDuration(measure, measureLength) {
  return fSum(measure.items.map((item) => itemDuration(item, measureLength)));
}
