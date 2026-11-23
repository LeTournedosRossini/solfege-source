/*
 * Peintre par défaut : un type de portée sans peintre est dessiné VIDE (lignes seulement) et le moteur ajoute un
 * avertissement. Il ne fait jamais échouer la mise en page d'un fichier qui contient un type pas encore rendu.
 */
import { SID } from '../../model/index.js';
import { lineStack } from './common.js';

export const emptyPainter = {
  name: 'empty',
  lines: (staff, ctx) => lineStack(5, ctx.style(SID.STAFF_LINE_THICKNESS)),
  clef: () => null,
  keySig: () => null,
  timeSig: () => null,
  entries: () => [],
  itemWidth: () => 0,
  paintEntry: () => [],
};
