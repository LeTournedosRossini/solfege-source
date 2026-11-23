/*
 * Peintre « rythmique » (`rhythm`) et « neutre » (`neutral`) : le peintre `score` avec un positionneur sans hauteur (../rhythmpos.js).
 * Portée à 0 ou 1 ligne (`PID.LINE_COUNT`) : la géométrie est celle d'une ligne unique à y = 0 ; à 0 ligne rien n'est tracé mais les barres de
 * mesure couvrent 2 sp autour de cette ligne virtuelle (MuseScore : portée à une ligne, `layoutTimeTickAnchor`, ±1 distance de lignes).
 * Clé : aucune sur `rhythm`, clé de percussion sur `neutral` (décision de Jean, 12/10/2026). Pas d'armure ; chiffrage centré.
 */
import { PID, SID, getProperty } from '../../model/index.js';
import { scorePainter, buildEntries } from './score.js';
import { lineStack } from './common.js';
import { rhythmPositioner } from '../rhythmpos.js';

const drawnLines = (staff) => (getProperty(staff, PID.LINE_COUNT) >= 1 ? 1 : 0);

function make(name, withClef) {
  return {
    ...scorePainter,
    name,
    lines: (staff, ctx) => (drawnLines(staff) ? lineStack(1, ctx.style(SID.STAFF_LINE_THICKNESS)) : []),
    barSpan: () => ({ lo: -1, hi: 1 }),
    clef: withClef ? () => ({ glyph: 'unpitchedPercussionClef1', y: 0, key: 'PERC' }) : () => null,
    keySig: () => null,
    timeSig: () => ({ yNum: 1, yDen: -1 }),
    entries(staff, mi, ctx) {
      return buildEntries(staff, mi, ctx, rhythmPositioner(staff, ctx.glyphs));
    },
  };
}

export const rhythmPainter = make('rhythm', false);
export const neutralPainter = make('neutral', true);
