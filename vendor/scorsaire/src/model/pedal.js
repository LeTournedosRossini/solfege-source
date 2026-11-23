// Pédale (PID.PEDALS, propriété de la portée) — port du modèle de `Pedal` (MuseScore 4.7.5, `dom/pedal.cpp`, `TextLineBase`, `Anchor::SEGMENT`).
// Entrée : { id, startMeasureId, startPosition, endMeasureId, endPosition, play?, pedalType?, placement? } — début et fin = INSTANTS (identifiant de masterbar + fraction exacte
// depuis le début de la mesure, comme PID.CLEF_CHANGES) ; plage [début, fin[. Le « lever » est la fin de la ligne ; un changement « ped. * » = deux lignes
// qui se touchent. Le son : `play === false` la rend muette (`Spanner::playSpanner`). L'AFFICHAGE (layout/pedaldisplay.js) dépend de `pedalType`
// (les 6 préréglages de la palette de MuseScore, `palettecreator.cpp`) et de `placement` ('below' défaut = `pedalPlacement` | 'above').
import { isFraction, fLt, fLe, ZERO } from './fraction.js';
import { measureLengthOf } from './timing.js';

/**
 * Les 6 préréglages de pédale de la palette de MuseScore 4.7.5 (`PaletteCreator::newKeyboardPalette` / `newKeyboardPedalPalette`) :
 * crochets de début / de fin (`HookType`), ligne visible ou non. Texte de début « Ped. » seulement sans crochet de début
 * (`Pedal::getPropertyStyle` : `pedalText` si `beginHookType() == NONE`, sinon `pedalHookText` vide) ; même règle pour le texte de continuation
 * « (Ped.) » ; texte de fin : « * » (`pedalRosetteEndText`) si la ligne est invisible, sinon rien.
 */
export const PEDAL_TYPES = {
  pedLine:       { beginHook: 'none', endHook: '90', line: true },   // « Ped. » + ligne + crochet droit de fin (défaut)
  pedStar:       { beginHook: 'none', endHook: 'rosette', line: false }, // « Ped. » … « * » (sans ligne)
  hooks:         { beginHook: '90', endHook: '90', line: true },     // crochets droits aux deux bouts
  hooksEnd45:    { beginHook: '90', endHook: '45', line: true },     // début droit, fin oblique
  hooks45:       { beginHook: '45', endHook: '45', line: true },     // deux crochets obliques
  hooksStart45:  { beginHook: '45', endHook: '90', line: true },     // début oblique, fin droite
};
export const DEFAULT_PEDAL_TYPE = 'pedLine';

/** Préréglage d'affichage d'une pédale (repli sur le défaut). */
export function pedalSpec(entry) {
  return PEDAL_TYPES[entry?.pedalType] ?? PEDAL_TYPES[DEFAULT_PEDAL_TYPE];
}

/** Une pédale est jouée sauf `play === false`. */
export function pedalPlays(entry) {
  return entry?.play !== false;
}

/**
 * Erreurs de validation de PID.PEDALS.
 * @param list     entrées
 * @param barIds   identifiants des masterbars, dans l'ordre
 * @param bars     masterbars (pour la longueur de mesure)
 */
export function validatePedals(list, barIds, bars) {
  const errors = [];
  const seen = new Set();
  for (const p of list) {
    const tag = `pédale ${p.id}`;
    if (seen.has(p.id)) errors.push(`${tag} : identifiant en double`);
    seen.add(p.id);
    if (p.play !== undefined && typeof p.play !== 'boolean') errors.push(`${tag} : play doit être un booléen`);
    if (p.pedalType !== undefined && !Object.hasOwn(PEDAL_TYPES, p.pedalType)) errors.push(`${tag} : pedalType inconnu (${p.pedalType})`);
    if (p.placement !== undefined && p.placement !== 'below' && p.placement !== 'above') errors.push(`${tag} : placement doit être 'below' ou 'above'`);
    const ends = [['début', p.startMeasureId, p.startPosition], ['fin', p.endMeasureId, p.endPosition]];
    let ok = true;
    for (const [label, measureId, position] of ends) {
      const i = barIds.indexOf(measureId);
      if (i < 0) { errors.push(`${tag} : ${label} sur une mesure inexistante (${measureId})`); ok = false; continue; }
      if (!isFraction(position) || !fLe(ZERO, position) || !fLe(position, measureLengthOf(bars[i]))) {
        errors.push(`${tag} : position de ${label} invalide (fraction dans [0, longueur de la mesure])`);
        ok = false;
      }
    }
    if (ok) {
      const a = barIds.indexOf(p.startMeasureId);
      const b = barIds.indexOf(p.endMeasureId);
      if (!(a < b || (a === b && fLt(p.startPosition, p.endPosition)))) errors.push(`${tag} : la fin doit suivre le début`);
    }
  }
  return errors;
}
