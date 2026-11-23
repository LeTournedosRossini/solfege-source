/*
 * Respirations et césures — AFFICHAGE (port de MuseScore 4.7.5 : `TLayout::layoutBreath`, `Breath::BREATH_LIST`, `ChordRest::drop`,
 * `Segment::isRightAligned`, `HorizontalSpacing::moveRightAlignedSegments`). Le modèle (`PID.BREATHS`, `src/model/breath.js`) et la lecture
 * (`tempomap.js`) existent déjà ; ici : où la respiration se pose, sa forme pour l'espacement horizontal, son dessin.
 *
 * Règles lues dans les sources :
 *  - une respiration est dans son PROPRE segment « Breath », à l'instant de FIN de l'accord / du silence visé (`undoGetSegment(Breath, endTick())`),
 *    avant le segment d'accord de même instant ; à la fin d'une mesure elle reste dans cette mesure, avant la barre ;
 *  - côté : en dessous si l'index de voix (0 à 3) est impair (voix 2 et 4), au-dessus sinon (`b->setPlacement(b->track() & 1 ? BELOW : ABOVE)`) ;
 *  - `layoutBreath` (y vers le BAS depuis la ligne du haut, hauteur de portée `h`, hauteur du glyphe `g`) : césure `chantCaesura` y = 1,5 (+ h en dessous) ;
 *    autre césure y = g/2 (+ h) ; respiration au-dessus y = −0,5, en dessous y = 0,5 + g (+ h) ; origine du glyphe (ligne de base) ;
 *  - x = −(bord droit de la boîte du glyphe) : le bord DROIT du glyphe est à l'origine du segment, qui est alignée À DROITE (`isRightAligned` :
 *    clé ou respiration) : après l'étirement, la respiration reste collée au segment suivant à sa distance minimale.
 * Repère de ce module : y vers le HAUT depuis la ligne du bas de la portée (comme les peintres).
 */
import { BREATH_TYPES, PID, getProperty, fAdd } from '../model/index.js';

/** Respirations d'une portée, mesure par mesure : `[{ id, breathType, position (fraction), voice, afterId }]` d'après ses entrées. */
export function resolveMeasureBreaths(staff, entries) {
  const list = getProperty(staff, PID.BREATHS) ?? [];
  if (!list.length) return [];
  const byAfter = new Map(list.map((b) => [b.afterId, b]));
  const out = [];
  for (const e of entries) {
    const b = byAfter.get(e.item?.id);
    if (!b || !BREATH_TYPES[b.breathType]) continue;
    out.push({ id: b.id, breathType: b.breathType, afterId: b.afterId, position: fAdd(e.position, e.duration), voice: e.voice ?? 0 });
  }
  return out;
}

/** Césure (`Breath::isCaesura`) : les 6 types de césure de `BREATH_LIST`. */
export const isCaesura = (type) => Boolean(BREATH_TYPES[type]?.caesura);

/** Une respiration se place en dessous pour une voix d'index impair (`track() & 1`). */
export const breathBelow = (voice) => (voice & 1) === 1;

/**
 * Géométrie d'une respiration : `{ name, below, y (origine du glyphe), x0 (origine du glyphe, par rapport au segment), l, r, t, b (boîte, repère du segment) }`.
 * `lines` = lignes de la portée (`painter.lines`, y vers le haut) ; `glyphs` = données Bravura.
 */
export function breathGeometry(breath, lines, glyphs) {
  const g = glyphs.glyphs[breath.breathType];
  if (!g) return null;
  const ys = lines.map((l) => l.y);
  const top = ys.length ? Math.max(...ys) : 4;
  const bottom = ys.length ? Math.min(...ys) : 0;
  const staffHeight = top - bottom;
  const [right, up] = g.bbox.bBoxNE, [left, down] = g.bbox.bBoxSW;
  const height = up - down; // `symHeight`
  const below = breathBelow(breath.voice);
  const voiceOffset = below ? staffHeight : 0;
  let posY; // vers le bas depuis la ligne du haut
  if (isCaesura(breath.breathType)) posY = (breath.breathType === 'chantCaesura' ? 1.5 : height / 2) + voiceOffset;
  else posY = (below ? 0.5 + height : -0.5) + voiceOffset;
  const y = top - posY;
  const x0 = -right;
  return { name: breath.breathType, below, y, x0, l: x0 + left, r: 0, t: y + up, b: y + down };
}

/** Élément d'affichage d'une respiration dont le bord droit est à `x` (position du segment). */
export function breathItem(breath, geom, x) {
  return { kind: 'glyph', name: geom.name, x: x + geom.x0, y: geom.y, role: 'breath', ref: breath.id };
}

/**
 * Éléments d'affichage des respirations d'UNE portée dans une mesure. `colOrigin(i)` = x de l'origine de la colonne `i` (après étirement),
 * `barOrigin` = x de la fin du contenu (origine du segment de barre). Chaque respiration est collée au segment qui la suit
 * (`moveRightAlignedSegments`, `min(x suivant − distance minimale)`), à sa distance minimale NATURELLE même si la mesure est étirée.
 */
export function measureBreathItems(columns, colOrigin, barOrigin, staffIndex) {
  const segs = columns.breathSegs ?? [];
  const xs = new Array(segs.length).fill(barOrigin);
  for (let k = segs.length - 1; k >= 0; k -= 1) { // les cibles « respiration » sont à droite : résolues d'abord
    let x = Infinity;
    for (const l of segs[k].links) {
      const base = l.target.col !== undefined ? colOrigin(l.target.col) : l.target.breath !== undefined ? xs[l.target.breath] : barOrigin;
      x = Math.min(x, base - l.dist);
    }
    xs[k] = x === Infinity ? barOrigin : x;
  }
  const items = [];
  segs.forEach((seg, k) => {
    for (const m of seg.members) if (m.staffIndex === staffIndex) items.push(breathItem(m.breath, m.geom, xs[k]));
  });
  return items;
}
