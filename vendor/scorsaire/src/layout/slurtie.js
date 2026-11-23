/*
 * Géométrie commune aux liaisons de PROLONGATION (tie, `ties.js`) et D'EXPRESSION (slur, `slurs.js`) : chez
 * MuseScore les deux sont dessinées par la même classe (`SlurTieLayout`, `slurtielayout.cpp`, dépôt cloné, jamais
 * deviné) — une courbe de Bézier cubique symétrique entre deux points d'ancrage, avec 2 points de contrôle à la
 * même hauteur d'« épaule » au-dessus (ou en dessous) de la corde reliant les 2 points.
 *
 * **Forme fuselée (fin-épais-fin), portée le 28/09/2026 sur retour de Jean** (captures + 2 exemples SVG exportés de
 * MuseScore fournis : la courbe réelle n'est pas un simple trait, mais un CONTOUR REMPLI entre deux Béziers). Lu
 * dans `SlurTieLayout::computeBezier(TieSegment*)` / `computeBezier(SlurSegment*)` (`slurtielayout.cpp`, dépôt
 * cloné) : le contour est construit avec la MÊME paire de points de contrôle (« colonne vertébrale », ci-dessous
 * `c1`/`c2`) pour les deux bords — aller (`bezier1 - épaisseur`, `bezier2 - épaisseur`) puis retour
 * (`bezier2 + épaisseur`, `bezier1 + épaisseur`) — sans décalage horizontal ni variation le long de la courbe :
 * l'effilement aux extrémités est un pur effet de la Bézier (les deux bords partagent les MÊMES points de départ et
 * d'arrivée, seuls les points de contrôle s'écartent), pas une épaisseur qui varie explicitly. `épaisseur` = moitié
 * de la largeur au milieu, `computeMidThickness` (port direct, `tieOrSlurThickness` ci-dessous) : interpole entre
 * `0,15 esp. − largeur des extrémités` pour une liaison courte (`Sid::minTieLength` = 1 esp.) et `largeur du milieu
 * − largeur des extrémités` (0,21 − 0,05 = 0,16 esp.) à partir de 4 esp. (`shortTieLimit`), plafonnée ensuite.
 * Valeurs `endWidth`/`midWidth` IDENTIQUES pour tie et slur (`Sid::tieEndWidth`/`tieMidWidth` = `slurEndWidth`/
 * `slurMidWidth` = 0,05/0,21 esp., `styledef.cpp`), d'où une seule formule partagée ici.
 *
 * **Simplification assumée et DOCUMENTÉE restante** (voir la discussion de conception,
 * claude/etape-3-suivi-et-decisions.md) :
 * - **Pas de moteur d'évitement de collision itératif** (`SlurTieLayout::avoidCollisions`, ~190 lignes : divise la
 *   courbe en 20 tranches, bombe localement la forme ou incline les extrémités selon la zone en collision, jusqu'à
 *   30 itérations). Ici, la hauteur d'épaule est simplement étendue par le bord le plus extrême des têtes de note
 *   trouvées dans la plage (même principe que `hairpins.js`, déjà simplifié pour la même raison), sans bombement
 *   localisé ni inclinaison des extrémités : une note isolée qui dépasse au milieu d'une longue liaison lève toute
 *   la courbe plutôt que de la faire bomber juste à cet endroit. Jamais faux, un peu moins raffiné — rattrapable à
 *   la main (geste d'édition, étape 5), comme convenu avec Jean.
 */

/** `Sid::tieEndWidth`/`slurEndWidth` (styledef.cpp) — largeur aux extrémités (esp.), identique tie/slur. */
export const CURVE_END_WIDTH = 0.05;
/** `Sid::tieMidWidth`/`slurMidWidth` (styledef.cpp) — largeur au milieu (esp.), identique tie/slur. */
export const CURVE_MID_WIDTH = 0.21;
/** `Sid::minTieLength` (styledef.cpp) — longueur (esp.) sous laquelle l'épaisseur est réduite. */
const MIN_TIE_LENGTH = 1.0;
/** `shortTieLimit` (`computeMidThickness`, en dur dans la source : `mag * 4.0`). */
const SHORT_TIE_LIMIT = 4.0;

/**
 * Épaisseur (demi-largeur, esp.) au milieu de la courbe pour une longueur `lengthSp` donnée — port DIRECT de
 * `SlurTieLayout::computeMidThickness` (mag/scalingFactor = 1 ici, pas de portée agrandie/réduite dans le moteur) :
 * `normalThickness = midWidth − endWidth` au-delà de `shortTieLimit`, sinon interpolation linéaire entre
 * `0,15 esp. − endWidth` (à `minTieLength`) et `normalThickness` (à `shortTieLimit`).
 */
export function tieOrSlurThickness(lengthSp, { endWidth = CURVE_END_WIDTH, midWidth = CURVE_MID_WIDTH } = {}) {
  const normalThickness = midWidth - endWidth;
  if (lengthSp > SHORT_TIE_LIMIT) return normalThickness;
  const minTieThickness = 0.15 - endWidth;
  const a = 1 / (SHORT_TIE_LIMIT - MIN_TIE_LENGTH);
  const b = normalThickness - minTieThickness;
  const c = SHORT_TIE_LIMIT * minTieThickness - MIN_TIE_LENGTH * normalThickness;
  return Math.max(0, a * (b * lengthSp + c));
}

/**
 * Points de contrôle de la Bézier cubique entre `(x1,y1)` et `(x2,y2)`, avec une épaule de hauteur `shoulderH`
 * (esp., toujours positive) du côté `up` (dessus) ou non (dessous). `shoulderW` : fraction de la longueur de la
 * corde occupée par l'intervalle entre les 2 points de contrôle (port direct : `shoulderW` de MuseScore).
 *
 * Port de la rotation de repère de MuseScore (`computeBezier`, dépôt cloné) : les calculs se font dans un repère où
 * la corde est horizontale (une liaison entre deux notes de hauteurs différentes n'est jamais parfaitement
 * horizontale), puis les points de contrôle sont retournés dans le repère de la portée. Repère : x croissant vers
 * la droite, y CROISSANT VERS LE HAUT (portée) — MuseScore utilise y vers le bas, d'où le signe de `shoulderH`
 * inversé par rapport à la source (même inversion que `hairpins.js`).
 */
export function bezierControlPoints({ x1, y1, x2, y2, shoulderW, shoulderH, up }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const length = Math.hypot(dx, dy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const c1xLocal = (length - length * shoulderW) / 2;
  const c2xLocal = c1xLocal + length * shoulderW;
  const cyLocal = (up ? 1 : -1) * shoulderH;
  const toGlobal = (lx, ly) => ({ x: x1 + lx * cos - ly * sin, y: y1 + lx * sin + ly * cos });
  return {
    c1: toGlobal(c1xLocal, cyLocal), c2: toGlobal(c2xLocal, cyLocal),
    // Repère local (voir `curveItem`) : nécessaire pour décaler les points de contrôle perpendiculairement à la
    // corde (épaisseur), pas verticalement dans le repère de la portée.
    _local: { c1xLocal, c2xLocal, cyLocal, cos, sin },
  };
}

/**
 * Élément d'affichage `curve` — contour fuselé REMPLI (port de `computeBezier`, voir l'en-tête du fichier) : deux
 * Béziers cubiques partageant les mêmes extrémités `(x1,y1)`/`(x2,y2)`, l'une décalée de `−épaisseur`, l'autre de
 * `+épaisseur` par rapport à la colonne vertébrale (`c1`/`c2`, INCHANGÉE — gardée pour les tests/l'édition future),
 * le décalage étant perpendiculaire à la corde (comme MuseScore, dans son repère tourné). `src/render/svg.js`
 * dessine le chemin fermé aller/retour et le remplit (pas de trait uniforme).
 */
export function curveItem({ x1, y1, x2, y2, shoulderW, shoulderH, up, endWidth, midWidth, role, ref }) {
  const { c1, c2, _local } = bezierControlPoints({ x1, y1, x2, y2, shoulderW, shoulderH, up });
  const { c1xLocal, c2xLocal, cyLocal, cos, sin } = _local;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const thickness = tieOrSlurThickness(length, { endWidth, midWidth });
  const toGlobal = (lx, ly) => ({ x: x1 + lx * cos - ly * sin, y: y1 + lx * sin + ly * cos });
  const top1 = toGlobal(c1xLocal, cyLocal - thickness);
  const top2 = toGlobal(c2xLocal, cyLocal - thickness);
  const bot1 = toGlobal(c1xLocal, cyLocal + thickness);
  const bot2 = toGlobal(c2xLocal, cyLocal + thickness);
  return {
    kind: 'curve', role, ref, x1, y1, x2, y2,
    c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y,
    thickness,
    topC1x: top1.x, topC1y: top1.y, topC2x: top2.x, topC2y: top2.y,
    botC1x: bot1.x, botC1y: bot1.y, botC2x: bot2.x, botC2y: bot2.y,
  };
}
