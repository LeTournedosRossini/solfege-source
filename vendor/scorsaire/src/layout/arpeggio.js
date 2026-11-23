/*
 * Arpège (tranche 4d-d) — port de `TLayout::layoutArpeggio`, `ArpeggioLayout::calcTop/calcBottom/computeHeight` et `TDraw::draw(Arpeggio)`
 * (MuseScore v4.7.5). `PID.ARPEGGIO` (accord) : { type: 'normal'|'up'|'down'|'bracket'|'upStraight'|'downStraight' }.
 *
 * Les arpèges NORMAL / UP / DOWN sont une rangée de glyphes `wiggleArpeggiatoUp` (+ `wiggleArpeggiatoUpArrow` à l'extrémité pour UP / DOWN),
 * tournée de −90° (UP, NORMAL : l'extrémité en haut) ou +90° (DOWN : l'extrémité en bas) ; nombre de glyphes = `lrint((hauteur − avance de l'extrémité) /
 * avance du glyphe)`. Les types droits sont un trait (`arpeggioLineWidth`) avec une pointe `arrowheadBlackUp/Down` ; BRACKET = crochet [.
 * Étendue = de la boîte de la note la plus haute à celle de la plus basse de l'accord (`computeHeight`) ; en tablature `Note::line()` n'est pas
 * définie (« tab staff is already correct ») : `calcTop` ne décale donc jamais le haut (cas « topNoteLine <= 0 »).
 * Placement horizontal en tablature (`layoutTablature`) : bord DROIT de l'arpège à 0,5 sp à gauche de l'origine de l'accord (`lll += width + 0,5 sp ;
 * setPos(-lll)`), `lll` = place déjà réservée à gauche.
 * Repère : y vers le HAUT (espaces). Limites : un arpège sur plusieurs portées / voix (`span`) n'est pas modélisé ; non vérifié sur export.
 */
const lrint = (v) => Math.round(v); // `lrint` : arrondi au plus proche (égalité → pair, négligeable ici)

/**
 * @param spec    { type }
 * @param x       origine (x) de l'accord
 * @param top     ordonnée du haut de la boîte de la note la plus haute
 * @param bottom  ordonnée du bas de la boîte de la note la plus basse
 * @param lll     place déjà réservée à gauche de l'origine (≥ 0)
 * @param gap     écart entre cette place et le bord droit de l'arpège (tablature : 0,5 sp ; portée score : voir `scoreArpeggioGap`)
 * @returns { items, width, left } — `width` = largeur de la boîte (réservée à gauche avec 0,5 sp), `left` = bord gauche (absolu)
 */
export function arpeggioLayout({ spec, x, top, bottom, lll = 0, gap = 0.5, glyphs, lineWidth, hookLen, ref }) {
  const G = glyphs.glyphs;
  const h = top - bottom;
  const items = [];
  const adv = (n) => G[n].advance ?? G[n].bbox.bBoxNE[0];
  const type = spec.type ?? 'normal';
  let width;
  const place = (w) => x - (lll + w + gap);
  if (type === 'normal' || type === 'up' || type === 'down') {
    const fill = 'wiggleArpeggiatoUp';
    const end = type === 'normal' ? fill : 'wiggleArpeggiatoUpArrow';
    const n = Math.max(0, lrint((h - adv(end)) / adv(fill)));
    const names = [...Array(n).fill(fill), end];
    // boîte de la chaîne (`font->bbox(symbols)`) : x de la 1re boîte à la fin de la dernière, y = extrêmes
    let cum = 0; let right = 0;
    names.forEach((nm, i) => { right = cum + G[nm].bbox.bBoxNE[0]; if (i < names.length - 1) cum += adv(nm); });
    const left = G[names[0]].bbox.bBoxSW[0];
    const ymax = Math.max(...names.map((nm) => G[nm].bbox.bBoxNE[1]));
    const ymin = Math.min(...names.map((nm) => G[nm].bbox.bBoxSW[1]));
    width = ymax - ymin; // la chaîne est tournée : sa hauteur devient la largeur
    const px = place(width);
    if (type === 'down') {
      // rotate(+90) : l'extrémité (flèche) en bas ; 1re origine à `y1 − left` sous le haut
      let y = top + left;
      names.forEach((nm) => { items.push({ kind: 'glyph', name: nm, x: px - ymin, y, rotate: -90, role: 'arpeggio', ref, sel: `${ref}-arp` }); y -= adv(nm); });
    } else {
      // rotate(−90) : l'extrémité en haut ; 1re origine à `y1 + right` sous le haut
      let y = top - right;
      names.forEach((nm) => { items.push({ kind: 'glyph', name: nm, x: px + ymax, y, rotate: 90, role: 'arpeggio', ref, sel: `${ref}-arp` }); y += adv(nm); });
    }
    return { items, width, left: px };
  }
  if (type === 'upStraight' || type === 'downStraight') {
    const arrow = type === 'upStraight' ? 'arrowheadBlackUp' : 'arrowheadBlackDown';
    const b = G[arrow].bbox;
    const w = b.bBoxNE[0] - b.bBoxSW[0];
    width = w;
    const px = place(width);
    const x1 = px + 0.5; // `x1 = spatium × 0,5`
    const y1 = top + 0.25; const y2 = bottom - 0.25; // haut / bas de la boîte : top − sp/4, bottom + sp/4
    const nh = b.bBoxNE[1]; // hauteur de la pointe
    if (type === 'upStraight') {
      items.push({ kind: 'glyph', name: arrow, x: x1 - w / 2, y: y1 - nh, role: 'arpeggio', ref, sel: `${ref}-arp` });
      items.push({ kind: 'line', role: 'arpeggio', x1, y1: y1 - nh / 2, x2: x1, y2, width: lineWidth, cap: 'butt', ref, sel: `${ref}-arp` });
    } else {
      items.push({ kind: 'glyph', name: arrow, x: x1 - w / 2, y: y2, role: 'arpeggio', ref, sel: `${ref}-arp` });
      items.push({ kind: 'line', role: 'arpeggio', x1, y1, x2: x1, y2: y2 + nh / 2, width: lineWidth, cap: 'butt', ref, sel: `${ref}-arp` });
    }
    return { items, width, left: px + 0.5 - w / 2 };
  }
  // bracket
  width = hookLen;
  const px = place(width);
  const y1 = top + lineWidth / 2; const y2 = bottom - lineWidth / 2;
  items.push({ kind: 'line', role: 'arpeggio', x1: px, y1, x2: px + hookLen, y2: y1, width: lineWidth, cap: 'butt', ref, sel: `${ref}-arp` });
  items.push({ kind: 'line', role: 'arpeggio', x1: px, y1: y2, x2: px + hookLen, y2, width: lineWidth, cap: 'butt', ref, sel: `${ref}-arp` });
  items.push({ kind: 'line', role: 'arpeggio', x1: px, y1: y1 + lineWidth / 2, x2: px, y2: y2 - lineWidth / 2, width: lineWidth, cap: 'butt', ref, sel: `${ref}-arp` });
  return { items, width, left: px };
}
