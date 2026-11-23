/*
 * Bord réel d'une tête de note à la hauteur où la hampe s'accroche (approximation par ellipse à partir de la boîte
 * englobante, comme le prototype `noteheadEdgeAtAnchor`). MuseScore ne se sert pas des ancrages fins de la police
 * (issue #25088) ; le prototype, validé contre une capture MuseScore, corrige le point brut ainsi.
 * Valeurs de contrôle (noteheadBlack) : montante 1,0857 ; descendante × 0,5 = 0,0172.
 */
export function noteheadEdgeAtAnchor(glyphs, glyphName, anchorKey) {
  const g = glyphs.glyphs[glyphName];
  const { bBoxNE, bBoxSW } = g.bbox;
  const anchor = g.anchors[anchorKey];
  const cx = (bBoxNE[0] + bBoxSW[0]) / 2;
  const rx = (bBoxNE[0] - bBoxSW[0]) / 2;
  const cy = (bBoxNE[1] + bBoxSW[1]) / 2;
  const ry = (bBoxNE[1] - bBoxSW[1]) / 2;
  const dy = (anchor[1] - cy) / ry;
  const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
  return anchor[0] >= cx ? cx + half : cx - half;
}

const ELLIPSE_HEADS = new Set(['noteheadBlack', 'noteheadHalf', 'noteheadWhole']);

/**
 * x de la hampe pour une tête posée en `x` (prototype : montante = bord droit de la hampe sur le bord de la tête, descendante = moitié).
 * `head` : glyphe de la tête qui porte la hampe. Têtes ordinaires (noire / blanche / ronde) : calage du prototype (ellipse, ci-dessus), sur la noire.
 * Autres têtes (croix, losange, triangle, barre oblique… — percussion) : ancre SMuFL de la tête (`stemUpSE` / `stemDownNW`), bord droit de la
 * hampe sur le bord de la tête (montante), axe à l'abscisse de l'ancre (descendante) ; sans ancre dans le sous-ensemble : calage de la noire.
 * ÉCART assumé : le calage fin du prototype (ellipse) n'est calibré que sur la tête ordinaire.
 */
export function stemXFor(glyphs, x, up, thickness, head = 'noteheadBlack') {
  const anchors = ELLIPSE_HEADS.has(head) ? null : glyphs.glyphs[head]?.anchors;
  const a = anchors && (up ? anchors.stemUpSE : anchors.stemDownNW);
  // Têtes barre oblique : extrémités verticales plates, donc le moindre débord de la hampe se voit (retour de Jean, 12/10/2026) :
  // la hampe descendante est calée À L'INTÉRIEUR du bord gauche (bord gauche de la hampe = bord de la tête), comme la montante à droite.
  if (a && head.startsWith('noteheadSlash')) return up ? x + a[0] - thickness / 2 : x + a[0] + thickness / 2;
  if (a) return up ? x + a[0] - thickness / 2 : x + a[0] * 0.5;
  return up
    ? x + noteheadEdgeAtAnchor(glyphs, 'noteheadBlack', 'stemUpSE') - thickness / 2
    : x + noteheadEdgeAtAnchor(glyphs, 'noteheadBlack', 'stemDownNW') * 0.5;
}
