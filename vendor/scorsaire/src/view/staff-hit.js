/*
 * Clic sur la partition → (système, portée, mesure, colonne, ligne). PUR : aucun DOM, aucune écriture.
 *
 * Port de `Score::getPosition` (MuseScore 4.7.5, `dom/score.cpp`, lu en entier) :
 *  - mesure = la PREMIÈRE du système dont le bord droit (barre de fin) est à droite du clic (`x < mb->x() + largeur`) ;
 *  - portée = on parcourt les portées de haut en bas ; la frontière entre deux portées voisines est
 *    `bas de la portée + (haut de la suivante − bas) × facteur`, facteur 0,5, ou 0,75 pour la portée « préférée » (celle de la saisie en
 *    cours : plus facile d'ajouter des notes loin au-dessus ou en dessous) et 0,25 pour la portée juste après elle ; la dernière portée
 *    s'étend jusqu'en bas ;
 *  - colonne = parmi les « segments valides » de la voix (ici : les éléments de la voix 1 de la mesure), le premier dont le x est tel que
 *    `x < x1 + (x2 − x1) / 2` (milieu entre deux colonnes), sinon le dernier ;
 *  - ligne = `lrint((y − haut de la portée) / distance)` : distance = un demi-interligne pour une portée de notation, la distance de lignes
 *    pour une tablature (on passe d'une corde à l'autre). En tablature le clic doit tomber entre `-1` et `lignes + 1`, puis la ligne est
 *    ramenée sur les cordes ; ailleurs la validité de la hauteur est jugée par l'appelant (`pitchAtLine`).
 */

/** Arrondi à l'entier le plus proche, les demis s'éloignant de zéro (`lrint` de MuseScore arrondit au pair ; écart sans importance ici). */
const round = (v) => Math.round(v);

/**
 * @param layout     sortie de `layoutMovement` (systèmes → portées, mesures, `xAt`)
 * @param point      { x, y } en pixels du SVG
 * @param o.staffSpace, o.margin   pixels par espace de portée et marge gauche en pixels (comme `renderSvgString`)
 * @param o.preferredStaffId       portée de la saisie en cours (facteur 0,75), ou null
 * @param o.staffInfo(ref)         { lines, lineDist, tab } d'une portée : nombre de lignes, distance de lignes (espaces) et tablature ?
 * @param o.columnsOf(ref, mi)     positions (fractions NOMINALES depuis le début de la mesure) des éléments de la voix 1 de la mesure `mi`
 * @returns {{ systemIndex, staffRef, staffType, measureIndex, measureRef, column, position, line, lineCount, x, y } | null}
 *          `x`, `y` : pixels du point d'insertion (colonne, centre de la ligne) pour un aperçu
 */
export function hitStaffPosition(layout, point, { staffSpace, margin, preferredStaffId = null, staffInfo, columnsOf }) {
  const systems = layout.systems.filter((s) => s.staves.length && s.measures.length);
  if (!systems.length) return null;
  const ys = point.y / staffSpace;
  // système : le premier dont le bas est sous le clic, sinon le dernier (on peut cliquer au-dessus de tout)
  const sys = systems.find((s) => ys < s.top + s.height) ?? systems[systems.length - 1];
  const xs = (point.x - margin) / staffSpace - sys.x0;

  // mesure : bord droit à droite du clic ; au-delà de la dernière barre, rien
  const measure = sys.measures.find((m) => xs < m.barX);
  if (!measure) return null;

  // portée
  const geo = sys.staves.map((st) => {
    const info = staffInfo(st.ref) ?? { lines: 5, lineDist: 1, tab: false };
    const height = (info.lines - 1) * info.lineDist;
    return { st, info, bottom: sys.top + st.originY, top: sys.top + st.originY - height };
  });
  let k = 0;
  for (; k < geo.length; k += 1) {
    const next = geo[k + 1];
    if (!next) break;
    const factor = geo[k].st.ref === preferredStaffId ? 0.75 : next.st.ref === preferredStaffId ? 0.25 : 0.5;
    const boundary = geo[k].bottom + (next.top - geo[k].bottom) * factor;
    if (ys < boundary) break;
  }
  const { st, info, top } = geo[k];

  // colonne : milieu entre deux colonnes de la voix 1
  const positions = columnsOf(st.ref, measure.index);
  if (!positions.length) return null;
  const xsOf = positions.map((p, i) => {
    const v = sys.xAt ? sys.xAt(measure.index, p) : NaN;
    return Number.isFinite(v) ? v : i === 0 ? measure.x : measure.x + (measure.barX - measure.x) * (i / positions.length);
  });
  let col = positions.length - 1;
  for (let i = 0; i < positions.length - 1; i += 1) {
    if (xs < xsOf[i] + (xsOf[i + 1] - xsOf[i]) / 2) { col = i; break; }
  }

  // ligne : demi-interligne (notation) ou corde (tablature), 0 = ligne du haut
  const step = info.tab ? info.lineDist : info.lineDist / 2;
  let line = round((ys - top) / step);
  if (info.tab) {
    if (line < -1 || line > info.lines + 1) return null;
    line = Math.min(Math.max(line, 0), info.lines - 1);
  }
  return {
    systemIndex: sys.index,
    staffRef: st.ref,
    staffType: st.type,
    measureIndex: measure.index,
    measureRef: measure.ref,
    column: col,
    position: positions[col],
    line,
    lineCount: info.lines,
    x: margin + (sys.x0 + xsOf[col]) * staffSpace,
    // centre de la tête de note (origine de la colonne + demi-largeur de tête : 0,59 sp Bravura ; 0,65 sp en tablature) : là où l'on dessine le repère
    cx: margin + (sys.x0 + xsOf[col] + 0.5) * staffSpace,
    y: (top + line * step) * staffSpace,
  };
}
