/*
 * Têtes de note de percussion — groupes de têtes de MuseScore (`NoteHeadGroup`, tableau `noteHeads[][]` de `dom/note.cpp` 4.7.5, lu tel quel).
 * Une « tête » de percmap est soit l'identifiant d'un groupe (ci-dessous), soit le NOM d'un glyphe SMuFL (tête personnalisée : MuseScore
 * `Drumset::noteHeads`, même glyphe pour toutes les durées dans toutes les données d'usine). Données pures : les noms de glyphes sont ceux
 * de SMuFL (Bravura), la mise en page les cherche dans `bravura-subset.json`.
 *
 * Colonnes : `quarter` (noire et valeurs plus courtes), `half`, `whole`. La brève utilise la colonne `whole` (comme `headGlyph` de la portée
 * standard) ; MuseScore a une 4e colonne (`DoubleWhole`) non utilisée ici.
 * Les tables « hampe haute » et « hampe basse » de MuseScore ne diffèrent que pour des groupes absents des données d'usine (large arrow, fa) :
 * une seule table ici.
 */
export const HEAD_GROUPS = {
  normal: { quarter: 'noteheadBlack', half: 'noteheadHalf', whole: 'noteheadWhole' },
  cross: { quarter: 'noteheadXBlack', half: 'noteheadXHalf', whole: 'noteheadXWhole' },
  xcircle: { quarter: 'noteheadCircleX', half: 'noteheadCircleXHalf', whole: 'noteheadCircleXWhole' },
  diamond: { quarter: 'noteheadDiamondBlack', half: 'noteheadDiamondHalf', whole: 'noteheadDiamondWhole' },
  'triangle-down': { quarter: 'noteheadTriangleDownBlack', half: 'noteheadTriangleDownHalf', whole: 'noteheadTriangleDownWhole' },
  'triangle-up': { quarter: 'noteheadTriangleUpBlack', half: 'noteheadTriangleUpHalf', whole: 'noteheadTriangleUpWhole' },
  slashed1: { quarter: 'noteheadSlashedBlack1', half: 'noteheadSlashedHalf1', whole: 'noteheadSlashedWhole1' },
  slashed2: { quarter: 'noteheadSlashedBlack2', half: 'noteheadSlashedHalf2', whole: 'noteheadSlashedWhole2' },
  slash: { quarter: 'noteheadSlashHorizontalEnds', half: 'noteheadSlashWhiteHalf', whole: 'noteheadSlashWhiteWhole' },
  'slash-small': { quarter: 'noteheadSlashSmall', half: 'noteheadSlashSmall', whole: 'noteheadSlashSmall' }, // the slash reduced to the width of a cross (shorter and thinner than the rhythm-notation slash)
  'circle-dot': { quarter: 'noteheadRoundWhiteWithDot', half: 'noteheadRoundWhiteWithDot', whole: 'noteheadRoundWhiteWithDot' }, // a circle with a dot inside (toms in many drum charts); one glyph for every duration, like the custom heads
  plus: { quarter: 'noteheadPlusBlack', half: 'noteheadPlusHalf', whole: 'noteheadPlusWhole' },
  la: { quarter: 'noteShapeSquareBlack', half: 'noteShapeSquareWhite', whole: 'noteShapeSquareWhite' },
  ti: { quarter: 'noteShapeTriangleRoundBlack', half: 'noteShapeTriangleRoundWhite', whole: 'noteShapeTriangleRoundWhite' },
  do: { quarter: 'noteShapeTriangleUpBlack', half: 'noteShapeTriangleUpWhite', whole: 'noteShapeTriangleUpWhite' },
};

export const HEAD_GROUP_IDS = Object.keys(HEAD_GROUPS);

/**
 * Single-glyph heads offered next to the groups in the percussion map editor (one glyph for every duration, like any custom head). The `noteheadE0xx` names are
 * SMuFL code points kept as they are: circle with a slash (E0F7), downward triangle (E0F3, scaled to the other triangles), diamond (E0E3), right triangle (E0C2);
 * `noteheadTriangleUpHalf` is the outlined upward triangle (E0BC).
 */
export const EXTRA_HEAD_GLYPHS = ['noteheadTriangleUpHalf', 'noteheadE0F7', 'noteheadE0F3', 'noteheadE0E3', 'noteheadE0C2'];

/** Une tête personnalisée est un nom de glyphe SMuFL de tête (`notehead…` ou `noteShape…`). */
const CUSTOM_HEAD = /^(notehead|noteShape)[A-Za-z0-9]+$/;

export function isCustomHead(head) {
  return typeof head === 'string' && !Object.hasOwn(HEAD_GROUPS, head) && CUSTOM_HEAD.test(head);
}

export function isDrumHead(head) {
  return typeof head === 'string' && (Object.hasOwn(HEAD_GROUPS, head) || CUSTOM_HEAD.test(head));
}

/** Colonne de la table selon la valeur de note écrite. */
export function headColumn(base) {
  return base === 'whole' || base === 'breve' ? 'whole' : base === 'half' ? 'half' : 'quarter';
}

/** Glyphe SMuFL de la tête `head` (groupe ou glyphe personnalisé) pour une valeur de note écrite. */
export function drumHeadGlyph(head, base) {
  if (Object.hasOwn(HEAD_GROUPS, head)) return HEAD_GROUPS[head][headColumn(base)];
  return head;
}
