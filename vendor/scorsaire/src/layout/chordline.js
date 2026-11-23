/*
 * Slides / ChordLines (tranche 4d-a) : fall, doit (droite de la note), plop, scoop (gauche) — droits, courbes ou ondulés.
 * Port de `TLayout::layoutChordLine` + `TDraw::draw(ChordLine)` (MuseScore v4.7.5) ; contrôlé sur les mesures de l'export E9A de Jean.
 * `PID.CHORD_LINE` (accord) : { type: 'fall'|'doit'|'plop'|'scoop', straight, wavy }. La ligne s'accroche à la note la plus haute de l'accord
 * (`upNote`, faute de `note()` dans le modèle). Repère : y vers le HAUT (espaces) ; MuseScore travaille en y vers le BAS (convertis ici).
 */
const HOR_OFFSET = 0.33; // un tiers d'espace de l'accord
const VERT_OFFSET = 0.25; // un quart d'espace de la ligne centrale
const WAVY_RAISE_BELOW = -0.125; // `moveY(r.height() − 0,125 sp)` sous la note
const WAVY_RAISE_ABOVE = 0.075; // `moveY(0,075 sp)` au-dessus
const WAVE_GLYPH = { fall: 'brassFallRoughShort', plop: 'brassFallRoughShort', doit: 'brassLiftShort', scoop: 'brassLiftShort' };

export const chordLineIsLeft = (type) => type === 'plop' || type === 'scoop';
export const chordLineIsBelow = (type) => type === 'scoop' || type === 'fall';

/**
 * @param spec   { type, straight, wavy }
 * @param noteY  ordonnée (y haut) de la note d'accrochage
 * @param boxes  forme de l'accord : rectangles {x1,x2,y1,y2} (y haut) — numéros, hampe, crochet, points ; sans la ligne elle-même
 * @param dots   rectangles des points d'augmentation
 * @param lineThickness  épaisseur du trait (`chordlineThickness`)
 * @returns { items, left, right } : éléments d'affichage et boîte horizontale (absolue)
 */
export function chordLineLayout({ spec, noteY, boxes, dots = [], glyphs, thickness, ref }) {
  const { type } = spec;
  const wavy = Boolean(spec.wavy);
  const straight = Boolean(spec.straight) || wavy;
  const left = chordLineIsLeft(type);
  const below = chordLineIsBelow(type);
  const base = 1; // spatium × intrinsicMag
  const x2 = left ? -1.2 * base : 1.2 * base;
  const y2 = below ? base : -base; // y vers le BAS
  let r; // boîte (y vers le bas) relative à l'origine de la ligne
  const glyph = wavy ? glyphs.glyphs[WAVE_GLYPH[type]] : null;
  if (wavy) {
    const sw = glyph.bbox.bBoxSW; const ne = glyph.bbox.bBoxNE;
    r = { x: sw[0], y: -ne[1], w: ne[0] - sw[0], h: ne[1] - sw[1] };
  } else {
    r = { x: Math.min(0, x2), y: Math.min(0, y2), w: Math.abs(x2), h: Math.abs(y2) };
  }
  const noteDown = -noteY; // repère « bas » centré sur la hauteur de la note : 0
  const yd = (below ? VERT_OFFSET : -VERT_OFFSET); // départ, relatif au centre de la note (y bas)
  const yBelow = yd + r.h;
  // bord de la forme dans [yd, yBelow] (en y bas relatif à la note)
  let edge = null;
  for (const b of boxes) {
    const top = -(b.y2 - noteY); const bottom = -(b.y1 - noteY); // y bas relatif
    if (!(bottom > yd && top < yBelow)) continue;
    const e = left ? b.x1 : b.x2;
    edge = edge === null ? e : left ? Math.min(edge, e) : Math.max(edge, e);
  }
  const shapeLeft = boxes.length ? Math.min(...boxes.map((b) => b.x1)) : 0;
  if (edge === null) edge = left ? shapeLeft : Math.max(...boxes.map((b) => b.x2), 0);
  if (!left) {
    let xMin = shapeLeft;
    for (const d of dots) xMin = Math.max(xMin, d.x2);
    edge = Math.max(edge, xMin);
  }
  const px = left ? edge - HOR_OFFSET : edge + HOR_OFFSET;
  let pyd = yd; // y bas relatif à la note
  const items = [];
  if (!wavy) {
    const sx = px; const sy = noteY - pyd;
    const ex = px + x2; const ey = noteY - (pyd + y2);
    if (straight) {
      items.push({ kind: 'line', role: 'chord-line', x1: sx, y1: sy, x2: ex, y2: ey, width: thickness, cap: 'square', ref, sel: `${ref}-cl` });
    } else {
      // droite de la note : horizontale au départ ; gauche : verticale au départ (`cubicTo`, y bas)
      const c1 = left ? { x: sx, y: noteY - (pyd + y2 / 2) } : { x: sx + x2 / 2, y: sy };
      const c2 = left ? { x: sx + x2 / 2, y: noteY - (pyd + y2) } : { x: sx + x2, y: noteY - (pyd + y2 / 2) };
      items.push({ kind: 'bezier', role: 'chord-line', x1: sx, y1: sy, c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x2: ex, y2: ey, width: thickness, ref, sel: `${ref}-cl` });
    }
    return { items, left: Math.min(sx, ex), right: Math.max(sx, ex) };
  }
  pyd += below ? r.h + WAVY_RAISE_BELOW : WAVY_RAISE_ABOVE;
  const gx = left ? px - r.w : px;
  items.push({ kind: 'glyph', name: WAVE_GLYPH[type], x: gx, y: noteY - pyd, rotate: type === 'fall' ? -1 : 1, role: 'chord-line', ref, sel: `${ref}-cl` });
  return { items, left: gx + r.x, right: gx + r.x + r.w };
}
