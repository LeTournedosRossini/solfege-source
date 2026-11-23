/*
 * Suivi de l'affichage pendant la saisie de notes (PUR, sans DOM) : calcule de combien faire défiler la page pour que la mesure en cours
 * d'édition reste visible. Toutes les coordonnées sont dans UN MÊME repère (pixels CSS de la fenêtre) ; un rectangle est { left, top, right,
 * bottom }, y vers le bas.
 *
 * PORT de MuseScore 4.7.5 (lu, rien deviné) :
 *  - `NotationInteraction::showItem` (notationinteraction.cpp) : rectangle à montrer = la mesure de l'élément, ÉLARGIE de 3 espaces de
 *    portée de chaque côté (`border = spatium * 3`, `adjusted(-border, -border, border, border)`) ;
 *  - `AbstractNotationPaintView::onShowItemRequested` (abstractnotationpaintview.cpp ~555) : si la zone visible est plus étroite (plus basse)
 *    que ce rectangle, on ne montre plus que l'ÉLÉMENT lui-même dans cette dimension (ici : le curseur de saisie) ;
 *  - `AbstractNotationPaintView::adjustCanvasPosition` (~966-1029) : aucun défilement si la zone à montrer est plus grande que la zone
 *    visible (comparaison des AIRES), ni si elle y est déjà entièrement ; sinon nouvelle position du coin haut-gauche (jamais de centrage).
 *
 * Particularités du code de MuseScore, reproduites telles quelles (la description « défilement minimal avec 3 espaces de marge » en est un
 * résumé) :
 *  1. La marge est comptée DEUX fois : 3 espaces dans le rectangle élargi (c'est la zone de déclenchement : la mesure doit être à ≥ 3 espaces
 *     du bord pour ne pas défiler) et 3 espaces encore au défilement (la mesure se retrouve donc à 6 espaces du bord).
 *  2. Rectangle ENTIÈREMENT hors de la zone (dessous / dessus) : aligné sur le bord proche (défilement minimal). Rectangle qui CHEVAUCHE
 *     seulement le bord bas (ou droit) : aligné par son bord HAUT (ou gauche), donc plus qu'un défilement minimal. Option `straddle:
 *     'minimal'` pour ne faire que le nécessaire dans ce cas (ÉCART assumé avec MuseScore, non utilisé par défaut).
 *  3. `alignToCurrentPageBorder` (bords de page) n'a pas d'équivalent : la partition de Scorsaire est une seule colonne de systèmes, le
 *     navigateur borne déjà le défilement.
 */

/** Marge (en espaces de portée) dont MuseScore élargit le rectangle à montrer (`showItem`). */
export const SHOW_PAD_SP = 3;
/** Marge (en espaces de portée) laissée au bord au défilement (`BORDER_SPACING_RATIO` de `adjustCanvasPosition`). */
export const SCROLL_BORDER_SP = 3;

const finite = (r) => r && [r.left, r.top, r.right, r.bottom].every(Number.isFinite);
const widthOf = (r) => r.right - r.left;
const heightOf = (r) => r.bottom - r.top;

/**
 * De combien faire défiler pour montrer la mesure en cours (PUR). Retourne `{ dx, dy }` (à ajouter à la position de défilement : dy > 0 =
 * la page descend), ou null s'il n'y a rien à faire.
 * @param o.measure   rectangle de la mesure en cours d'édition (null : on s'en tient à `item`)
 * @param o.item      rectangle de l'élément édité (le curseur de saisie) : sert quand la mesure est plus grande que la zone visible
 * @param o.visible   zone visible (voir `visibleArea` de `float-place.js`)
 * @param o.spatium   un espace de portée, dans le repère des rectangles
 * @param o.straddle  'top' (MuseScore : un rectangle qui chevauche le bord bas / droit est aligné par son bord haut / gauche) | 'minimal'
 */
export function computeScroll({ measure, item, visible, spatium, straddle = 'top' }) {
  if (!finite(visible) || !(spatium > 0)) return null;
  const base = finite(measure) ? measure : item;
  if (!finite(base)) return null;
  const pad = SHOW_PAD_SP * spatium;
  const border = SCROLL_BORDER_SP * spatium;
  // rectangle à montrer = la mesure élargie ; dimension trop grande pour la zone → l'élément seul dans cette dimension
  const show = { left: base.left - pad, top: base.top - pad, right: base.right + pad, bottom: base.bottom + pad };
  if (widthOf(visible) < widthOf(show) && finite(item)) { show.left = item.left; show.right = item.right; }
  if (heightOf(visible) < heightOf(show) && finite(item)) { show.top = item.top; show.bottom = item.bottom; }

  // `adjustCanvasPosition`
  if (widthOf(visible) * heightOf(visible) < widthOf(show) * heightOf(show)) return null;
  if (show.left >= visible.left && show.right <= visible.right && show.top >= visible.top && show.bottom <= visible.bottom) return null;

  const W = widthOf(visible);
  const H = heightOf(visible);
  let x = visible.left;
  let y = visible.top;
  if (show.left < visible.left) x = show.left - border;
  else if (show.left > visible.right) x = show.right - W + border;
  else if (W >= widthOf(show) && show.right > visible.right) x = straddle === 'minimal' ? show.right - W + border : show.left - border;

  if (show.top < visible.top && show.bottom < visible.bottom) y = show.top - border;
  else if (show.top > visible.bottom) y = show.bottom - H + border;
  else if (H >= heightOf(show) && show.bottom > visible.bottom) y = straddle === 'minimal' ? show.bottom - H + border : show.top - border;

  const dx = x - visible.left;
  const dy = y - visible.top;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/**
 * Recentrage au retour à la ligne (PUR) : de combien faire défiler pour que le curseur de saisie se retrouve à `xFraction` de la largeur de la
 * zone visible depuis sa gauche (un quart par défaut) et à `yFraction` de sa hauteur depuis son haut (le milieu par défaut), d'un seul coup.
 * AJOUT Scorsaire (MuseScore ne recentre jamais) : sert quand la saisie d'une note fait passer le curseur à un autre système, notamment sous
 * zoom pincé où la règle de `computeScroll` (mesure entière visible) n'a plus de sens. Même repère que `computeScroll`.
 * @returns { dx, dy } ou null (entrées invalides, ou déjà en place)
 */
export function computeRecenter({ item, visible, xFraction = 0.25, yFraction = 0.5 }) {
  if (!finite(visible) || !finite(item)) return null;
  const targetX = visible.left + xFraction * widthOf(visible);
  const targetY = visible.top + yFraction * heightOf(visible);
  const dx = (item.left + item.right) / 2 - targetX;
  const dy = (item.top + item.bottom) / 2 - targetY;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/**
 * Page turn of the PLAY cursor in a sideways-scrolling view (AJOUT Scorsaire, demande de Jean 18/10/2026 : « faire revenir le curseur à gauche
 * quand il arrive à droite »). `x` = horizontal position of the cursor, `left` / `right` = the visible zone (same coordinates; `left` is already
 * to the right of the sticky header). Returns how far to scroll to the RIGHT (positive) so that the cursor lands near the left edge of the zone,
 * or 0 when it is still comfortably inside. A cursor to the left of the zone (a seek backwards, or hidden under the header) is brought back too.
 *  trigger: fraction of the zone width beyond which the cursor turns the page; lead: where it lands (fraction of the width from the left edge).
 */
export function computePageTurn({ x, left, right, trigger = 0.88, lead = 0.06 }) {
  if (![x, left, right].every(Number.isFinite)) return 0;
  const width = right - left;
  if (width <= 0) return 0;
  if (x >= left + trigger * width || x < left) return x - (left + lead * width);
  return 0;
}
