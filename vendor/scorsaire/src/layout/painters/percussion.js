/*
 * Peintre « percussion » (tranche 5a : portée à 5 lignes ; 1, 2, 3 lignes en 5b). Réutilise tout le peintre `score` (têtes, hampes, ligatures, n-olets,
 * silences, ornements, articulations, lignes supplémentaires, parenthèses des notes fantômes) : seuls changent
 *  - la clé : clé de percussion (`unpitchedPercussionClef1`), centrée sur la portée (`ClefType::PERC`, clef.cpp) ;
 *  - pas d'armure (types de portée perc1/2/3/5Line, `stafftype.cpp`) ; chiffrage oui ;
 *  - la hauteur et la tête de chaque note, lues dans la percmap de la portée (`SegmentLayout::layoutChordDrumset`) ;
 *  - le sens des hampes : imposé (PID.STEM_DIRECTION de l'accord, sinon `stemDirection` du son de sa 1re note), sinon parité de la voix ;
 *  - pas d'altérations.
 * Voir drumpos.js (positionneur) et model/percmap.js.
 */
import { PID, SID, getProperty } from '../../model/index.js';
import { scorePainter, buildEntries } from './score.js';
import { lineStack, staffLineCount } from './common.js';
import { drumPositioner } from '../drumpos.js';

const lineCountOf = staffLineCount;

export const percussionPainter = {
  ...scorePainter,
  name: 'percussion',
  lines: (staff, ctx) => lineStack(lineCountOf(staff), ctx.style(SID.STAFF_LINE_THICKNESS)),
  clef: (staff) => ({ glyph: 'unpitchedPercussionClef1', y: (lineCountOf(staff) - 1) / 2, key: 'PERC' }),
  keySig: () => null,
  entries(staff, mi, ctx) {
    return buildEntries(staff, mi, ctx, drumPositioner(staff, ctx.glyphs, lineCountOf(staff)));
  },
};
