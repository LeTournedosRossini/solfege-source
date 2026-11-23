/*
 * Disposition verticale d'un système : empilement des portées (distance entre deux portées d'une même piste = grand
 * staff, sinon entre deux pistes), marges haute et basse. Coordonnées en espaces, y vers le BAS depuis le haut du système.
 * Les marques au-dessus/au-dessous des portées (tranche 3) augmenteront ces distances selon leur contenu.
 */
import { SID } from '../model/index.js';
import { minStackDistance, yExtent } from './bounds.js';

/** @returns { staves: [{ originY, top }], height } — originY = y de la ligne du bas de chaque portée. */
export function stackStaves(ctx) {
  const style = ctx.style;
  const placed = [];
  let bottomOfPrevious = null;
  let prev = -1; // the last staff that takes room (a collapsed source staff of a composite takes none: its measures are drawn on the carrier)
  ctx.staves.forEach((sref, i) => {
    const lines = sref.painter.lines(sref.staff, sref.ctx);
    if (sref.ctx.collapsed) { placed.push({ originY: bottomOfPrevious ?? 0, top: bottomOfPrevious ?? 0, lines }); return; }
    const topLine = lines.length ? Math.max(...lines.map((l) => l.y)) : sref.painter.barSpan ? sref.painter.barSpan(sref.staff, sref.ctx).hi : 0; // sans lignes : le haut des barres
    let topY;
    if (prev < 0) {
      topY = style(SID.SYSTEM_TOP_MARGIN);
    } else {
      const sameTrack = ctx.staves[prev].track === sref.track;
      topY = bottomOfPrevious + style(sameTrack ? SID.AKKOLADE_DISTANCE : SID.STAFF_DISTANCE);
    }
    const originY = topY + topLine * (sref.ctx.sizeScale ?? 1) * (sref.ctx.sizeVertical ?? 1); // a staff shown smaller is lower in the stack by its reduced height
    placed.push({ originY, top: topY, lines });
    bottomOfPrevious = originY;
    prev = i;
  });
  const height = (bottomOfPrevious ?? style(SID.SYSTEM_TOP_MARGIN)) + style(SID.SYSTEM_BOTTOM_MARGIN);
  return { staves: placed, height };
}

/**
 * Empilement DÉFINITIF d'un système, après le dessin de toutes ses portées : part de l'empilement par distances fixes
 * (`base`, plancher) et écarte deux portées voisines si des éléments de la portée du haut touchent ceux de la portée du bas
 * (distance minimale `MIN_VERTICAL_DISTANCE`, horizontalement à `SKYLINE_MIN_HORIZONTAL_CLEARANCE` près) ; décale aussi tout
 * le système vers le bas si des marques dépassent au-dessus de la 1re portée. Comme MuseScore (`layoutStaves`) :
 * distance entre origines = max(distance fixe, distance de collision + minVerticalDistance).
 * @param minDist  facultatif : par rang de portée i, distance minimale entre les origines des portées i − 1 et i (ligatures croisées)
 * @param rects  par portée : boîtes de tous ses éléments (bounds.js), repère de portée
 * @returns { staves: [{ originY, top, lines }], height, shift }
 */
export function spaceSystemStaves(ctx, base, rects, minDist = [], extra = []) {
  const style = ctx.style;
  const clr = style(SID.MIN_VERTICAL_DISTANCE);
  const hClr = style(SID.SKYLINE_MIN_HORIZONTAL_CLEARANCE);
  const edge = style(SID.SYSTEM_EDGE_DISTANCE) >= 0 ? style(SID.SYSTEM_EDGE_DISTANCE) : clr; // at the top and the bottom of the system (between two staves `clr` stays)
  const origins = [];
  const gone = (i) => Boolean(ctx.staves[i]?.ctx.collapsed); // a collapsed source staff of a composite sits on the staff before it and takes no room
  let prev = -1;
  base.staves.forEach((b, i) => {
    if (gone(i)) { origins.push(prev >= 0 ? origins[prev] : b.originY); return; }
    let originY = b.originY;
    if (prev >= 0) {
      const need = minStackDistance(rects[prev], rects[i], hClr);
      if (Number.isFinite(need)) originY = Math.max(originY - base.staves[prev].originY, need + clr) + origins[prev];
      else originY = origins[prev] + (originY - base.staves[prev].originY);
    }
    if (prev >= 0 && Number.isFinite(minDist[i])) originY = Math.max(originY, origins[prev] + minDist[i]); // ligatures croisées : distance minimale entre origines
    origins.push(originY + (prev >= 0 ? (extra[i] ?? 0) : 0)); // `extra`: space added by the vertical spread of a printed page (staff i below staff i − 1)
    prev = i;
  });
  // marques au-dessus de la 1re portée : décalage de tout le système pour qu'elles gardent la marge du haut
  const ext0 = yExtent(rects[0] ?? []);
  const shift = ext0 ? Math.max(0, edge - (origins[0] - ext0.hi)) : 0;
  const staves = base.staves.map((b, i) => ({ ...b, originY: origins[i] + shift, top: origins[i] + shift - (b.originY - b.top) }));
  let last = staves.length - 1;
  while (last > 0 && gone(last)) last -= 1; // the last staff that takes room
  const extL = yExtent(rects[last] ?? []);
  const height = Math.max(
    (staves[last] ? staves[last].originY : 0) + style(SID.SYSTEM_BOTTOM_MARGIN),
    extL ? staves[last].originY - extL.lo + edge : 0,
  );
  return { staves, height, shift };
}

/**
 * Accolade d'une piste à plusieurs portées, comme MuseScore (`Bracket::setStaffSpan`, `TLayout::layoutBracket`, `TDraw::draw`) :
 * glyphe Bravura choisi selon le nombre de portées `v` (1 : braceSmall, 2 : brace ; 3 et plus : voir l'écart ci-dessous),
 * étiré en largeur d'un facteur `magx = v + (v − 1) × 1,625` et en hauteur jusqu'à couvrir les portées.
 * Coordonnées système : x depuis l'origine du système, y vers le bas depuis son haut ; le bord droit du glyphe se place
 * à `akkoladeBarDistance` (0,35) à gauche de la 1re portée.
 */
export function braceItem(top, bottom, staffCount, glyphs, style) {
  // ÉCART : MuseScore prend braceLarge/braceLarger à partir de 3 portées ; leurs métriques n'ont pas été vérifiées à l'œil,
  // on garde `brace` (et le magx de 2 portées) tant qu'aucune piste n'a plus de 2 portées.
  const name = staffCount <= 1 ? 'braceSmall' : 'brace';
  const g = glyphs.glyphs[name];
  const natW = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
  const natH = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1];
  const v = Math.min(staffCount, 2);
  const magx = v + (v - 1) * 1.625;
  const w = natW * magx;
  return {
    kind: 'glyph-stretch', role: 'brace', name,
    x: -(w + style(SID.AKKOLADE_BAR_DISTANCE)), y: top, w, h: bottom - top,
    natW, natH,
  };
}
