/*
 * Boîtes englobantes des éléments d'affichage d'une portée (repère de portée : y vers le HAUT, en espaces) et distance
 * verticale minimale entre deux portées voisines.
 *
 * ÉCART ASSUMÉ avec MuseScore : MuseScore tient des « skylines » par portée (silhouette continue construite pendant la mise en
 * page) ; ici on retombe sur les boîtes des éléments déjà dessinés (Shape::minVerticalDistance de MuseScore fait la même chose
 * sur des rectangles : max sur les paires qui se recouvrent horizontalement — à `skylineMinHorizontalClearance` près — de
 * `bas du haut − haut du bas`). Les boîtes de texte sont approchées (largeur ≈ 0,5 × corps × nombre de caractères).
 */

/** @returns {{x1,x2,y1,y2}|null} y1 = bord BAS, y2 = bord HAUT (repère de portée, y vers le haut). */
export function itemRect(it, glyphs) {
  switch (it.kind) {
    case 'glyph': {
      const g = glyphs.glyphs[it.name];
      if (!g) return null;
      const mag = it.mag ?? 1;
      const sw = g.bbox.bBoxSW, ne = g.bbox.bBoxNE;
      if (!it.rotate) { // the common case, without building the four corners (same coordinates, same arithmetic)
        const xa = it.x + sw[0] * mag, xb = it.x + ne[0] * mag, ya = it.y + sw[1] * mag, yb = it.y + ne[1] * mag;
        return { x1: Math.min(xa, xb), x2: Math.max(xa, xb), y1: Math.min(ya, yb), y2: Math.max(ya, yb) };
      }
      const corners = [[sw[0], sw[1]], [ne[0], sw[1]], [ne[0], ne[1]], [sw[0], ne[1]]].map(([cx, cy]) => [cx * mag, cy * mag]);
      let pts = corners;
      if (it.rotate) {
        const a = (it.rotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        pts = corners.map(([px, py]) => [px * c - py * s, px * s + py * c]);
      }
      return fromPoints(pts.map(([px, py]) => [it.x + px, it.y + py]), 0);
    }
    case 'glyph-stretch': return { x1: it.x, x2: it.x + it.w, y1: it.y - it.h, y2: it.y }; // y = TOP edge, y up
    case 'line': {
      const h = (it.width ?? 0) / 2;
      return { x1: Math.min(it.x1, it.x2), x2: Math.max(it.x1, it.x2), y1: Math.min(it.y1, it.y2) - h, y2: Math.max(it.y1, it.y2) + h };
    }
    case 'bezier': {
      const h = it.width / 2;
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        pts.push([u * u * u * it.x1 + 3 * u * u * t * it.c1x + 3 * u * t * t * it.c2x + t * t * t * it.x2,
          u * u * u * it.y1 + 3 * u * u * t * it.c1y + 3 * u * t * t * it.c2y + t * t * t * it.y2]);
      }
      return fromPoints(pts, h);
    }
    case 'curve': {
      const p0 = [it.x1, it.y1], p3 = [it.x2, it.y2];
      const pts = [];
      for (const [a, b] of [[[it.topC1x, it.topC1y], [it.topC2x, it.topC2y]], [[it.botC1x, it.botC1y], [it.botC2x, it.botC2y]]]) {
        for (let k = 0; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          pts.push([u * u * u * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p3[1]]);
        }
      }
      return fromPoints(pts, 0);
    }
    case 'path': return it.bounds ? { ...it.bounds } : null; // tracé vectoriel : boîte fournie par celui qui le crée
    case 'polygon': return fromPoints(it.points, 0);
    case 'polyline': return fromPoints(it.points, it.width / 2);
    case 'rect': return { x1: it.x, x2: it.x + it.w, y1: it.y, y2: it.y + it.h };
    case 'circle': return { x1: it.cx - it.r, x2: it.cx + it.r, y1: it.cy - it.r, y2: it.cy + it.r };
    case 'text': {
      // boîte fournie par celui qui crée le texte (symboles d'accord : police à chasse fixe, largeur exacte), relative à (x, y)
      if (it.box) return { x1: it.x + it.box.x1, x2: it.x + it.box.x2, y1: it.y + it.box.y1, y2: it.y + it.box.y2 };
      const w = 0.5 * it.size * String(it.text).length;
      const x1 = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
      return { x1, x2: x1 + w, y1: it.y - 0.25 * it.size, y2: it.y + 0.75 * it.size };
    }
    default: return null;
  }
}

function fromPoints(pts, pad) {
  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
  for (const [px, py] of pts) { x1 = Math.min(x1, px); x2 = Math.max(x2, px); y1 = Math.min(y1, py); y2 = Math.max(y2, py); }
  return { x1: x1 - pad, x2: x2 + pad, y1: y1 - pad, y2: y2 + pad };
}

export function rectsOf(items, glyphs) {
  const out = [];
  for (const it of items) {
    const r = itemRect(it, glyphs);
    if (r && Number.isFinite(r.x1 + r.x2 + r.y1 + r.y2)) out.push(r);
  }
  return out;
}

/**
 * Distance verticale minimale entre l'ORIGINE (ligne du bas) de la portée du haut et celle de la portée du bas pour que leurs
 * éléments ne se touchent pas : max, sur les x où les deux ont des éléments, de (−bord bas du haut) + (bord haut du bas).
 * `hClear` : deux éléments sont « au même endroit » s'ils se recouvrent à `hClear` près horizontalement.
 * @returns {number} −Infinity si aucun recouvrement horizontal (aucune contrainte).
 */
export function minStackDistance(upperRects, lowerRects, hClear = 0) {
  if (!upperRects.length || !lowerRects.length) return -Infinity;
  // grid of every x where a box starts or ends (typed array: a numeric sort without a comparison callback is several times faster)
  const raw = new Float64Array(2 * (upperRects.length + lowerRects.length));
  let w = 0;
  for (const r of upperRects) { raw[w++] = r.x1 - hClear; raw[w++] = r.x2 + hClear; }
  for (const r of lowerRects) { raw[w++] = r.x1; raw[w++] = r.x2; }
  raw.sort();
  let m = 0;
  for (let i = 0; i < raw.length; i++) if (i === 0 || raw[i] !== raw[i - 1]) raw[m++] = raw[i];
  const grid = raw.subarray(0, m);
  const n = grid.length - 1;
  if (n < 1) return -Infinity;
  const a = new Float64Array(n).fill(-Infinity); // bas du haut (en valeur positive vers le bas)
  const b = new Float64Array(n).fill(-Infinity); // haut du bas
  const index = (x) => {
    let lo = 0, hi = grid.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (grid[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const fill = (arr, x1, x2, v) => {
    for (let k = index(x1), end = index(x2); k < end; k++) if (v > arr[k]) arr[k] = v;
  };
  for (const r of upperRects) fill(a, r.x1 - hClear, r.x2 + hClear, -r.y1);
  for (const r of lowerRects) fill(b, r.x1, r.x2, r.y2);
  let best = -Infinity;
  // a cell thinner than 1e-6 space is the noise of two edges that coincide (the same coordinate reached by two ways of adding, e.g. a measure painted in its own
  // coordinates and translated): it must not decide the distance between two staves
  for (let k = 0; k < n; k++) if (a[k] > -Infinity && b[k] > -Infinity && grid[k + 1] - grid[k] > 1e-6) best = Math.max(best, a[k] + b[k]);
  return best;
}

/** Étendue verticale (bord bas, bord haut) d'un ensemble de boîtes. */
export function yExtent(rects) {
  let lo = Infinity, hi = -Infinity;
  for (const r of rects) { lo = Math.min(lo, r.y1); hi = Math.max(hi, r.y2); }
  return rects.length ? { lo, hi } : null;
}
