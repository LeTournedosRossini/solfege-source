/*
 * Parenthèses d'une note — port de MuseScore 4.7.5 (`rendering/score/parenthesislayout.cpp` : `createPathAndShape`,
 * `setChordValues`, `computeInternalParenthesisPadding`), CALÉ sur un export réel (ghost.svg de Jean : parenthèses de notes fantômes,
 * score et tablature). Applicable à TOUT type de portée et à toute note : propriété `PID.PARENTHESES` (la propriété `PID.GHOST` en
 * produit aussi, comme `useParens = ghost`). Une paire par note marquée.
 *
 * Forme : deux Béziers cubiques aller/retour entre les mêmes extrémités, épaisseur max au milieu (`midPointThickness`), trait
 * d'extrémité 0,05 sp arrondi (élément `curve` avec `strokeWidth`).
 *  - épaisseur au milieu (sp) = hauteur^e × S^(e−1), e = 0,33 (score) / 0,36 (tablature), S = 82,677 = spatium interne de MuseScore
 *    (94,488 px de l'export ÷ 1,142857) : calé à 0,001 sp sur les 20 parenthèses de ghost.svg, plafonnée à 0,2 sp ;
 *  - épaule (sp) = max(0,2 × (hauteur × S)^0,95 / S, 0,25) ; décalage vertical des points de contrôle = 0,2 × hauteur.
 *  - tablature : hauteur = boîte du numéro (1,3425 sp), pointes à 0,1 sp (`tabFretPadding`) du numéro ;
 *    portée normale : hauteur = tête + 0,5 sp, haut = bord de tête − 0,25 sp, pointes à 0,3 sp de la tête.
 */

const S_INTERNAL = 82.677;
const SHOULDER_MIN = 0.25;
const MID_MAX = 0.2;
const END_STROKE = 0.05;

/** Épaisseur au milieu et épaule (sp) pour une parenthèse de `height` sp. */
export function parenthesisMetrics(height, tab) {
  const e = tab ? 0.36 : 0.33;
  const mid = Math.min(Math.pow(height, e) * Math.pow(S_INTERNAL, e - 1), MID_MAX);
  const shoulder = Math.max((0.2 * Math.pow(height * S_INTERNAL, 0.95)) / S_INTERNAL, SHOULDER_MIN);
  return { mid, shoulder };
}

/**
 * Élément d'affichage d'UNE parenthèse. `x` = pointe (côté de la note), `top` = ordonnée du haut (y vers le haut).
 * @param side -1 gauche « ( », +1 droite « ) »
 * @returns élément `curve` + `bbox` { x1, x2, y1, y2 } (étendue : sert à couper les lignes de portée de la tablature)
 */
export function parenthesisItem({ x, top, height, side, tab, ref }) {
  const { mid, shoulder } = parenthesisMetrics(height, tab);
  const fwd = x + side * (shoulder + mid);
  const back = x + side * (shoulder - mid);
  const bottom = top - height;
  const dy = 0.2 * height;
  return {
    item: {
      kind: 'curve', role: 'parenthesis', ref, strokeWidth: END_STROKE, x1: x, y1: top, x2: x, y2: bottom,
      topC1x: fwd, topC1y: top - dy, topC2x: fwd, topC2y: bottom + dy,
      botC1x: back, botC1y: top - dy, botC2x: back, botC2y: bottom + dy,
    },
    bbox: { x1: Math.min(x, fwd) - END_STROKE / 2, x2: Math.max(x, fwd) + END_STROKE / 2, y1: bottom, y2: top },
  };
}

/** Paire de parenthèses autour d'une boîte [left, right] × [bottom, top] avec l'écart `pad` entre pointes et boîte. */
export function parenthesisPair({ left, right, top, bottom, pad, tab, ref }) {
  const height = top - bottom;
  return [
    parenthesisItem({ x: left - pad, top, height, side: -1, tab, ref }),
    parenthesisItem({ x: right + pad, top, height, side: 1, tab, ref }),
  ];
}

/** La note porte-t-elle des parenthèses ? (propriété explicite ou note fantôme) */
export function hasParentheses(note, getProperty, PID) {
  return Boolean(getProperty(note, PID.PARENTHESES) || getProperty(note, PID.GHOST));
}

export const SCORE_PAREN_PAD = 0.3; // écart pointe ↔ tête (`computeInternalParenthesisPadding`, NOTE hors tablature)
export const TAB_PAREN_PAD = 0.1; // = tabFretPadding

/** Étendue d'une parenthèse au-delà du bord de la note (pointe + bombement + demi-trait), pour réserver la place. */
export function parenthesisOutside(height, tab) {
  const { mid, shoulder } = parenthesisMetrics(height, tab);
  return (tab ? TAB_PAREN_PAD : SCORE_PAREN_PAD) + shoulder + mid + END_STROKE / 2;
}

/** Parenthèses d'une tête de portée normale : tête = [left, left+width] × [y + bBoxSW, y + bBoxNE]. */
export function scoreParentheses({ left, width, y, glyph, ref }) {
  const top = y + glyph.bbox.bBoxNE[1] + 0.25;
  const bottom = y + glyph.bbox.bBoxSW[1] - 0.25;
  return parenthesisPair({ left, right: left + width, top, bottom, pad: SCORE_PAREN_PAD, tab: false, ref });
}
