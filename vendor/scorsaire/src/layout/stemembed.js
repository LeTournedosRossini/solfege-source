/*
 * Hampes ligaturées enfoncées dans la barre (RENDU SEUL).
 *
 * Une hampe ligaturée s'arrête exactement au bord extérieur de la barre du niveau 0 (position vérifiée sur les exports MuseScore :
 * les coordonnées de `y2` ne changent donc pas). Or, à l'écran, le pixel de bord est alors couvert deux fois — par la barre et
 * par le bout de la hampe — ce qui laisse une petite bosse plus sombre au-dessus de la barre (mesurée dans Chromium : 0,4 à 0,6 px,
 * alors que la géométrie ne dépasse que de 0,006 espace). MuseScore arrête la hampe au CENTRE de la barre (invisible) ; ici on
 * garde `y2` tel quel (bornes, hit-test, liaisons le lisent) et on ajoute `into` = distance dont le rendu raccourcit la hampe
 * vers les têtes, pour qu'elle finisse au milieu de l'épaisseur de la barre.
 *
 * Détection géométrique, valable pour tous les peintres (notation, percussion, tablature, ornements, accordéon) : une hampe verticale
 * dont le bout tombe sur le bord extérieur (points 0 → 1) d'un polygone de ligature de la MÊME portée.
 */
const EPS = 0.02; // tolérance sur l'appartenance du bout de hampe au bord de la barre (espaces)

/** Ajoute `into` aux hampes dont le bout touche une barre de la liste (modifie les éléments d'affichage en place). */
export function embedStemsInBeams(items) {
  const beams = items.filter((i) => i.role === 'beam' && i.kind === 'polygon' && i.points.length === 4);
  if (!beams.length) return;
  // beams indexed by horizontal bucket (in the order of the list: the first beam that fits wins, as before) — a stem only looks at the beams over its x
  const BUCKET = 8;
  const grid = new Map();
  for (const b of beams) {
    const x1 = b.points[0][0]; const x2 = b.points[1][0];
    if (x2 <= x1) continue;
    for (let k = Math.floor((x1 - EPS) / BUCKET); k <= Math.floor((x2 + EPS) / BUCKET); k++) { const l = grid.get(k); if (l) l.push(b); else grid.set(k, [b]); }
  }
  for (const st of items) {
    if (st.role !== 'stem' || st.kind !== 'line' || st.x1 !== st.x2) continue;
    const dir = Math.sign(st.y2 - st.y1); // sens de la hampe (y vers le haut) : > 0 = montante
    if (!dir) continue;
    for (const b of grid.get(Math.floor(st.x1 / BUCKET)) ?? []) {
      const [[x1, y1], [x2, y2], , [, y4]] = b.points;
      if (x2 <= x1 || st.x1 < x1 - EPS || st.x1 > x2 + EPS) continue;
      const k = (st.x1 - x1) / (x2 - x1);
      const outer = y1 + (y2 - y1) * k; // bord extérieur de la barre à l'axe de la hampe
      const inner = outer + (y4 - y1);
      const centre = (outer + inner) / 2;
      // le bout de la hampe est sur le bord extérieur nominal ou déjà dans l'épaisseur de la barre
      if (dir * (st.y2 - outer) > EPS || dir * (st.y2 - inner) < -EPS) continue;
      st.into = Math.min(Math.max(0, dir * (st.y2 - centre)), Math.abs(st.y2 - st.y1) / 2);
      // rendu : la hampe est dessinée AVEC sa barre (un seul chemin, voir render/svg.js), pas en double
      (b.stems ??= []).push(st);
      st.merged = true;
      break;
    }
  }
}
