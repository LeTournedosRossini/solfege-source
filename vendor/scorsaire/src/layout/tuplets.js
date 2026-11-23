/*
 * Marques de n-olet : chiffre (glyphe Bravura `tupletN`, pas de texte) et, quand le groupe n'est pas exactement un groupe de
 * ligature, crochet coupé sous le chiffre. Position : ABOVE_PAD au-delà du point le plus extrême du groupe, du côté choisi
 * comme MuseScore (`TupletLayout::computeDirection` : plus de hampes montantes que descendantes → au-dessus ; un groupe de
 * silences → au-dessus), sans évitement d'autres éléments. Coordonnées de portée (y vers le haut).
 * Écarts assumés avec le prototype : chiffre en glyphe SMuFL (le prototype : texte italique) à l'échelle NUMBER_MAG ; étendue
 * réelle du groupe (têtes et pointes de hampe) au lieu de « tête + 3,5 », et côté selon les hampes (le prototype : toujours dessus).
 */
import { PID, getProperty } from '../model/index.js';
import { glyphItem, glyphWidth } from './header.js';

const ABOVE_PAD = 1.2; // espace au-dessus du point le plus haut du groupe
const HOOK_H = 0.5; // hauteur des crochets verticaux aux extrémités
const NUMBER_HALF_GAP = 0.4; // demi-coupure du crochet sous le chiffre, par caractère
const NUMBER_MAG = 0.5;
// tupletStemLeft/RightDistance (0,5) − tupletBracketWidth/2 (0,05) ; tupletNoteLeft/RightDistance (0) − 0,05 : le bord des têtes est REPOUSSÉ vers l'intérieur de 0,05 (valeurs MuseScore, signe compris)
const STEM_SIDE_DIST = 0.45;
const NOTE_SIDE_DIST = -0.05;

/** Groupes de n-olet d'une voix : { id, ratio, indices } (au moins 2 membres, consécutifs). */
export function tupletGroups(entries) {
  const groups = [];
  let cur = null;
  entries.forEach((entry, i) => {
    const t = entry.item.props ? getProperty(entry.item, PID.TUPLET) : null;
    if (t && cur && cur.id === t.id) cur.indices.push(i);
    else {
      if (cur) groups.push(cur);
      cur = t ? { id: t.id, ratio: t.ratio, indices: [i] } : null;
    }
  });
  if (cur) groups.push(cur);
  return groups.filter((g) => g.indices.length >= 2);
}

/**
 * @param group    groupe de n-olet
 * @param xs       x (tête) de chaque élément de la voix (index = celui de `entries`)
 * @param extents  par élément de la voix : { hi, lo (y extrêmes : têtes, pointe de hampe ou ligature), up (+1 hampe montante, −1 descendante, 0 silence) }
 * @param sameAsBeam  le groupe coïncide avec une ligature : chiffre seul
 */
export function tupletItems(group, xs, extents, sameAsBeam, { glyphs, thickness, avoidLines = null }) {
  const first = group.indices[0];
  const last = group.indices[group.indices.length - 1];
  const votes = group.indices.reduce((sum, i) => sum + extents[i].up, 0);
  const above = votes >= 0; // égalité et silences : au-dessus
  let y = above ? Math.max(...group.indices.map((i) => extents[i].hi)) + ABOVE_PAD : Math.min(...group.indices.map((i) => extents[i].lo)) - ABOVE_PAD;
  // Tablature Full : le chiffre ne doit jamais couvrir une ligne de corde → tout le repère glisse (dans le sens qui
  // s'éloigne des notes) jusqu'au milieu de l'interligne suivant.
  if (avoidLines) y = onInterline(y, above, glyphs, String(group.ratio[0]).split('').map((d) => `tuplet${d}`), avoidLines);
  const hook = above ? -HOOK_H : HOOK_H; // crochets vers les notes
  // Horizontale : port de `TupletLayout::layoutBracket` (4.7.5) quand la géométrie des membres est connue (`extents[i].geom`),
  // sinon repli : origines des membres, chiffre au milieu.
  let x1 = xs[first];
  let x2 = xs[last];
  let mid = (x1 + x2) / 2;
  const g1 = extents[first].geom;
  const g2 = extents[last].geom;
  if (g1 && g2) {
    const sideUp = above ? 1 : -1;
    // extrémités du crochet : hampe du côté du chiffre → bord de hampe ∓ (tupletStemLeft/RightDistance − largeur/2) ; sinon bord des têtes
    const toward1 = g1.stemX != null && g1.stemDir === sideUp;
    const toward2 = g2.stemX != null && g2.stemDir === sideUp;
    x1 = toward1 ? g1.stemX - g1.stemWidth / 2 - STEM_SIDE_DIST : g1.left - NOTE_SIDE_DIST;
    x2 = toward2 ? g2.stemX + g2.stemWidth / 2 + STEM_SIDE_DIST : g2.right + NOTE_SIDE_DIST;
    mid = (x1 + x2) / 2;
    // beamé sans crochet, chiffre du côté des hampes : centré sur la ligature = bord gauche de la 1re hampe + moitié de l'écart des origines
    if (sameAsBeam && g1.stemX != null && g1.stemDir === sideUp) mid = g1.stemX - g1.stemWidth / 2 + (xs[last] - xs[first]) / 2;
  }
  const digits = String(group.ratio[0]).split('').map((d) => `tuplet${d}`);
  const items = [];
  if (!sameAsBeam) {
    const width = thickness * 0.9;
    const gap = NUMBER_HALF_GAP * digits.length;
    const line = (a, b, c, d) => items.push({ kind: 'line', role: 'tuplet-bracket', x1: a, x2: b, y1: c, y2: d, width });
    line(x1, mid - gap, y, y);
    line(mid + gap, x2, y, y);
    line(x1, x1, y, y + hook);
    line(x2, x2, y, y + hook);
  }
  // chiffre centré sur la ligne du crochet
  const total = digits.reduce((s, d) => s + glyphWidth(glyphs, d) * NUMBER_MAG, 0);
  let gx = mid - total / 2;
  for (const d of digits) {
    const { bBoxNE, bBoxSW } = glyphs.glyphs[d].bbox;
    items.push(glyphItem(d, gx, y - ((bBoxNE[1] + bBoxSW[1]) / 2) * NUMBER_MAG, { mag: NUMBER_MAG, role: 'tuplet-number' }));
    gx += glyphWidth(glyphs, d) * NUMBER_MAG;
  }
  return items;
}

/** Ramène `y` au centre d'un interligne si la boîte du chiffre croise une ligne (`avoidLines` : { lines, lineDist, thickness }). */
function onInterline(y, above, glyphs, digits, { lines, lineDist, thickness = 0.13 }) {
  let top = -Infinity;
  let bottom = Infinity;
  for (const d of digits) {
    const { bBoxNE, bBoxSW } = glyphs.glyphs[d].bbox;
    top = Math.max(top, bBoxNE[1] * NUMBER_MAG);
    bottom = Math.min(bottom, bBoxSW[1] * NUMBER_MAG);
  }
  const half = (top - bottom) / 2 + thickness / 2;
  const crosses = (yc) => {
    for (let k = 0; k < lines; k++) if (Math.abs(k * lineDist - yc) < half) return true;
    return false;
  };
  if (!crosses(y)) return y;
  const step = lineDist / 2;
  for (let n = 1; n <= 4 * lines; n++) {
    const cand = above ? y + n * step * 0.5 : y - n * step * 0.5;
    if (!crosses(cand)) return cand;
  }
  return y;
}
