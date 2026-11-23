// Lignes de trille (PID.TRILLS, portée) — port du modèle de `Trill` (MuseScore 4.7.5, `trill.cpp`, `spannersmetaparser.cpp`).
// Ancrage par IDENTITÉ des deux accords de bornes (comme PID.HAIRPINS) : la ligne couvre du début du premier au dernier accord INCLUS.
// Le signe de trille isolé est une articulation (`createArticulation('trill')`), pas une ligne.

import { newId } from './ids.js';

/** Types de ligne (`TrillType`) → type d'articulation joué (`SpannersMetaParser::parseTrill`) ; null = ligne sans effet sonore (PURE_LINE). */
export const TRILL_TYPES = Object.freeze({
  trill: 'Trill',           // TRILL_LINE
  upPrall: 'UpPrall',       // UPPRALL_LINE
  downPrall: 'PrallDown',   // DOWNPRALL_LINE
  prallPrall: 'LinePrall',  // PRALLPRALL_LINE
  pure: null,               // PURE_LINE
});

/**
 * Intervalle d'ornement (`OrnamentInterval`, types.h) : `step` = nombre de degrés diatoniques (0 unisson … 7 octave, 1 = seconde),
 * `type` ∈ ORNAMENT_INTERVAL_TYPES. Défaut MuseScore (`DEFAULT_ORNAMENT_INTERVAL`) : seconde automatique.
 */
export const ORNAMENT_INTERVAL_TYPES = Object.freeze(['auto', 'augmented', 'major', 'perfect', 'minor', 'diminished']);
export const DEFAULT_ORNAMENT_INTERVAL = Object.freeze({ step: 1, type: 'auto' });
const PERFECT_STEPS = new Set([0, 3, 4, 7]); // unisson, quarte, quinte, octave (`OrnamentInterval::isPerfectStep`)
const CHROMATIC_OF_STEP = [0, 2, 4, 5, 7, 9, 11, 12]; // `Interval::fromOrnamentInterval`

/** Intervalle effectif d'une entrée (articulation ou ligne) : `above` vrai = intervalAbove, faux = intervalBelow. */
export function ornamentIntervalOf(entry, above) {
  return (above ? entry?.intervalAbove : entry?.intervalBelow) ?? DEFAULT_ORNAMENT_INTERVAL;
}

/** Nombre de demi-tons d'un intervalle NON automatique (`Interval::fromOrnamentInterval`, champ `chromatic`). */
export function ornamentChromatic({ step, type }) {
  let n = CHROMATIC_OF_STEP[step];
  if (PERFECT_STEPS.has(step)) {
    if (type === 'diminished') n -= 1;
    else if (type === 'augmented') n += 1;
  } else if (type === 'diminished') n -= 2;
  else if (type === 'minor') n -= 1;
  else if (type === 'augmented') n += 1;
  return n;
}

/** Erreurs d'un intervalle d'ornement facultatif (`undefined` = défaut). */
export function validateOrnamentInterval(iv, label) {
  if (iv === undefined) return [];
  const errors = [];
  if (!iv || !Number.isInteger(iv.step) || iv.step < 0 || iv.step > 7) errors.push(`${label} : « step » doit être un entier de 0 à 7`);
  if (!iv || !ORNAMENT_INTERVAL_TYPES.includes(iv.type)) errors.push(`${label} : type d'intervalle inconnu (${iv?.type})`);
  return errors;
}

/**
 * Entrée de PID.TRILLS. `play` (vrai par défaut) : faux = affichée, ignorée à la lecture (`Trill::playSpanner`).
 * `intervalAbove` / `intervalBelow` : intervalles de l'ornement de la ligne (défaut : seconde automatique) ; `ornamentStyle: 'baroque'` ;
 * `placement` ('above' | 'below') : sinon parité de la voix ; `showAccidental` : réservé.
 */
export function createTrillLine(startChordId, endChordId, trillType = 'trill', { play, intervalAbove, intervalBelow, placement } = {}) {
  return Object.fromEntries(Object.entries({ id: newId('tr'), startChordId, endChordId, trillType, play, intervalAbove, intervalBelow, placement }).filter(([, v]) => v !== undefined));
}

/** Validation d'une liste de lignes : `known(id)` dit si l'accord existe dans la portée. */
export function validateTrills(list, known) {
  const errors = [];
  for (const t of list) {
    if (!(t.trillType in TRILL_TYPES)) errors.push(`trille ${t.id} : type inconnu (${t.trillType})`);
    if (!known(t.startChordId)) errors.push(`trille ${t.id} : accord de début inexistant dans la portée (${t.startChordId})`);
    if (!known(t.endChordId)) errors.push(`trille ${t.id} : accord de fin inexistant dans la portée (${t.endChordId})`);
    if (t.play !== undefined && typeof t.play !== 'boolean') errors.push(`trille ${t.id} : « play » doit être booléen`);
    errors.push(...validateOrnamentInterval(t.intervalAbove, `trille ${t.id} : intervalAbove`), ...validateOrnamentInterval(t.intervalBelow, `trille ${t.id} : intervalBelow`));
    if (t.placement !== undefined && t.placement !== 'above' && t.placement !== 'below') errors.push(`trille ${t.id} : placement inconnu (${t.placement})`);
  }
  return errors;
}
