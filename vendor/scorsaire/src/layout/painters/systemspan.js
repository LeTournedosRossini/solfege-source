/*
 * Bords d'un système pour les marques qui le traversent (glissandos, ties, slurs coupés par un retour à la ligne) :
 *  - `left` : début d'un segment d'ARRIVÉE / de MILIEU = `System::firstNoteRestSegmentX(true)` — 1 sp après le bord VISIBLE de l'en-tête
 *    (0,25 sp après une barre d'ouverture de reprise), au plus la 1re note ; `headerMin` impose un bord d'en-tête minimal (tablature sans
 *    clé après le 1er système : la barre de début de système, 0,18 sp, compte comme en-tête — mesuré sur E4) ;
 *  - `right` : fin d'un segment de DÉPART / de MILIEU = `endingXForOpenEndedLines` = dernière barre − 0,25 sp ; `rawLeft`/`rawRight` sans marge.
 */
import { barlineFootprint } from '../barlines.js';
import { LINE_END_TO_BARLINE, HEADER_TO_LINE_START } from '../glissandos.js';

export function systemSpan(perSystem, k, { headerMin = 0 } = {}) {
  const { sys, placed, headerRight } = perSystem[k];
  const first = sys.measures[0];
  const firstNoteX = Math.min(...placed.filter((p) => p.mi === first.mi).map((p) => p.x), first.start);
  const left = Math.min(
    sys.leadRepeat ? sys.repeatX + barlineFootprint('startRepeat') + LINE_END_TO_BARLINE : Math.max(headerRight, headerMin) + HEADER_TO_LINE_START,
    firstNoteX,
  );
  const lastBar = sys.measures[sys.measures.length - 1].barX;
  return { left, rawLeft: first.start, right: lastBar - LINE_END_TO_BARLINE, rawRight: lastBar };
}
