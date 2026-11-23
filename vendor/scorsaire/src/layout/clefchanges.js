/*
 * Changements de clé (`PID.CLEF_CHANGES`, propriété de la portée) : liste plate d'objets
 * `{ id, measureId, position, clef, concertClef? }` (`concertClef` : clé de l'affichage de concert, sinon `clef`) — ancrés comme les voltas (`measureId` = identifiant du masterbar, jamais un
 * numéro de mesure), à une fraction exacte À L'INTÉRIEUR de la mesure (comme une colonne : `position` = [n, d] depuis
 * le début de la mesure). `clef` = une des clés de `CLEF_DEFS` ('G', 'F', 'C1' à 'C5', clés d'octave).
 *
 * Cette tranche traite le cas EN COURS DE MESURE (`position` > 0, vérifié dans le document de référence de Jean :
 * quatre « do » de suite, chacun précédé d'une nouvelle clé) : petite taille (`Sid::smallClefMag`), juste avant la
 * note qui la porte, avec une marge avant elle (`Sid::clefLeftMargin`) et un espace avant la note qui suit
 * (approximation, comme `EXTRA_NO_ACC_GAP` ailleurs dans ce fichier : MuseScore calcule cette marge via son moteur de
 * collision de formes, non reproduit ici).
 *
 * Une clé positionnée EXACTEMENT en tête de mesure (`position` = 0) — vérifié sur un 2e export MuseScore de Jean (deux
 * systèmes, quatre mesures, la clé change à chaque barre) : ELLE NE SE DESSINE JAMAIS APRÈS LA BARRE (contrairement à
 * l'armure/au chiffrage) — toujours en PETITE taille, juste AVANT la barre qui la précède, à la fin de la mesure
 * PRÉCÉDENTE (`clefChangeEndingMeasure`) : que cette barre soit un simple milieu de ligne OU la fin d'un système. Si la
 * mesure qui suit ouvre en plus un nouveau système, sa clé de tête (taille normale, `clefAtMeasureStart`) se dessine
 * EN PLUS — les deux dessins coexistent (petite clé de courtoisie en fin de ligne précédente + vraie clé en tête de la
 * suivante), exactement comme pour l'armure de courtoisie, mais ici la règle ne dépend PAS d'un retour à la ligne :
 * une clé qui change au milieu d'une ligne (entre deux mesures, sans retour à la ligne) affiche la petite clé de la
 * même façon, sans rien de plus après la barre.
 */
import { PID, getProperty, fCmp, ZERO } from '../model/index.js';
import { CLEF_DEFS } from './constants.js';
import { clefKeyOf } from './painters/common.js';

/** Résout `PID.CLEF_CHANGES` d'une portée en { base, changes: [{ mi, position, clef }] }, trié, mesureId → index résolu. */
export function clefTimeline(staff, movement, concertPitch = false) {
  const base = clefKeyOf(staff, concertPitch);
  const raw = getProperty(staff, PID.CLEF_CHANGES) || [];
  const indexOf = new Map(movement.masterbars.map((mb, i) => [mb.id, i]));
  const changes = raw
    .map((c) => ({ mi: indexOf.get(c.measureId), position: c.position, clef: (concertPitch && c.concertClef) || c.clef }))
    .filter((c) => c.mi !== undefined && CLEF_DEFS[c.clef])
    .sort((a, b) => a.mi - b.mi || fCmp(a.position, b.position));
  return { base, changes };
}

/** Clé active à l'instant (mi, position) : le dernier changement à cet instant ou avant lui, sinon la clé de base de la portée. */
export function clefAt(timeline, mi, position) {
  let key = timeline.base;
  for (const c of timeline.changes) {
    if (c.mi > mi || (c.mi === mi && fCmp(c.position, position) > 0)) break;
    key = c.clef;
  }
  return key;
}

/** Clé active en tout début de la mesure `mi` (utile pour l'en-tête de système). */
export function clefAtMeasureStart(timeline, mi) {
  return clefAt(timeline, mi, ZERO);
}

/** Changement EN COURS DE MESURE (position > 0) exactement à `position` dans la mesure `mi`, sinon `null`. */
export function clefChangeAt(timeline, mi, position) {
  const hit = timeline.changes.find((c) => c.mi === mi && fCmp(c.position, ZERO) > 0 && fCmp(c.position, position) === 0);
  return hit ? hit.clef : null;
}

/** Clé qui commence en tête de la mesure `mi + 1` (position 0), à annoncer par une petite clé avant LA BARRE de `mi` — sinon `null`. */
export function clefChangeEndingMeasure(timeline, mi) {
  const hit = timeline.changes.find((c) => c.mi === mi + 1 && fCmp(c.position, ZERO) === 0);
  return hit ? hit.clef : null;
}
