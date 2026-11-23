/*
 * Arpège sur portée SCORE (passe d'affichage score de la tranche 4d) — port de `ChordLayout::layoutChords3` (bloc « spanArp », chordlayout.cpp
 * ~180-290), `ArpeggioLayout::insetDistance/insetTop/insetBottom/insetWidth` et `ArpeggioLayout::calcTop` (MuseScore v4.7.5). Le dessin lui-même
 * est celui de `arpeggio.js` (partagé avec la tablature).
 *
 * Écart (distance entre le bord droit de l'arpège et ce qui est à sa droite), table de remplissage `PaddingTable` :
 *  - sans altération : 0,4 sp (`arpeggioNoteDistance`) de la tête la plus à gauche ; 0,3 sp + 0,33 sp (`ledgerLineLength`) d'elle si cette tête a une
 *    ligne supplémentaire (tête non décalée : la 1re ou la dernière note est hors de la portée ; sinon la tête la plus à gauche) ;
 *  - avec altérations : `arpeggioAccidentalDistance` (0,3) − `accidentalDistance` (0,25) − `insetDistance`, comptés à partir de `lll` (qui contient déjà
 *    les 0,25 sp de l'altération la plus à gauche). `insetDistance` = `insetWidth` (place de l'altération dans le creux de l'arpège), ou
 *    `arpeggioAccidentalDistance − arpeggioAccidentalDistanceMin` (−0,03) si l'altération la plus à gauche heurte une extrémité à pointe.
 * Haut (`calcTop`) : NORMAL / UP / DOWN seulement — si la note haute est sur un interligne DANS la portée, le haut monte de 0,4 sp (note basse sur un
 * interligne aussi, dans la portée) ou 0,25 sp. Portée à 5 lignes fixes. Repère : y vers le HAUT. Non porté : arpège sur plusieurs voix/portées,
 * `clearAccidentals` (altérations d'accords voisins non couverts).
 */
import { arpeggioLayout } from './arpeggio.js';

const ACC_DIST = 0.25; // accidentalDistance
const ARP_ACC = 0.3; // arpeggioAccidentalDistance
const ARP_ACC_MIN = 0.33; // arpeggioAccidentalDistanceMin
const ARP_NOTE = 0.4; // arpeggioNoteDistance
const ARP_LEDGER = 0.3;
const LEDGER_LEN = 0.33; // ledgerLineLength × sp
// ligne MuseScore : 0 = ligne du haut, y vers le bas, demi-espaces ; `T` = ligne du bas = 2 × (lignes − 1)

/**
 * @param spec      { type }
 * @param x         origine de l'accord
 * @param ys        ordonnées des notes
 * @param dx        décalages x des têtes (têtes en seconde)
 * @param head      glyphe de tête (métriques)
 * @param accs      [{ y, glyph, left }] altérations visibles (`left` = bord gauche relatif à `x`)
 * @param lll       place déjà réservée à gauche de l'origine (têtes décalées, altérations + 0,25)
 */
export function scoreArpeggio({ spec, x, ys, dx, head, accs, lll, glyphs, lineWidth, hookLen, ref, lines = 5 }) {
  const T = 2 * (lines - 1);
  const lineOf = (y) => Math.round(T - 2 * y);
  const G = glyphs.glyphs;
  const type = spec.type ?? 'normal';
  const hb = G[head].bbox;
  const halfH = (hb.bBoxNE[1] - hb.bBoxSW[1]) / 2;
  const iUp = ys.indexOf(Math.max(...ys)); const iDown = ys.indexOf(Math.min(...ys));
  let top = ys[iUp] + halfH; const bottom = ys[iDown] - halfH;
  const gw = (n) => G[n].bbox.bBoxNE[0] - G[n].bbox.bBoxSW[0];
  const gh = (n) => G[n].bbox.bBoxNE[1] - G[n].bbox.bBoxSW[1];
  // `calcTop` : le haut monte si la note haute est sur un interligne dans la portée
  if (type === 'normal' || type === 'up' || type === 'down') {
    const topLine = lineOf(ys[iUp]);
    if (!(topLine <= 0 || topLine % 2 === 0 || topLine >= T)) {
      const downLine = lineOf(ys[iDown]);
      top += downLine % 2 === 1 && downLine < T ? 0.4 : 0.25;
    }
  }
  // 1re passe : largeur de l'arpège (indépendante de l'écart)
  const probe = arpeggioLayout({ spec, x, top, bottom, lll: 0, gap: 0, glyphs, lineWidth, hookLen, ref });
  const width = probe.width;
  let gap;
  if (accs.length) {
    // `insetTop` / `insetBottom` (hors pointes : bords des têtes extrêmes, moins la pointe de l'extrémité)
    let arpTop = ys[iUp] + halfH; let arpBottom = ys[iDown] - halfH;
    if (type === 'up') arpTop -= gw('wiggleArpeggiatoUpArrow'); else if (type === 'upStraight') arpTop -= gw('arrowheadBlackUp');
    if (type === 'down') arpBottom += gw('wiggleArpeggiatoUpArrow'); else if (type === 'downStraight') arpBottom += gw('arrowheadBlackDown');
    const hasTop = type === 'up' || type === 'upStraight' || type === 'bracket';
    const hasBottom = type === 'down' || type === 'downStraight' || type === 'bracket';
    let furthest = null;
    const box = (a) => ({ top: a.y + G[a.glyph].bbox.bBoxNE[1], bottom: a.y + G[a.glyph].bbox.bBoxSW[1] });
    for (const a of accs) {
      if (!furthest) { furthest = a; continue; }
      const further = a.left < furthest.left; const same = a.left === furthest.left;
      const b = box(a);
      if (further || (same && ((b.top >= arpTop && hasTop) || (b.bottom <= arpBottom && hasBottom)))) furthest = a;
    }
    const fb = box(furthest);
    const collides = (hasTop && fb.top >= arpTop) || (hasBottom && fb.bottom <= arpBottom);
    let inset;
    if (collides) inset = ARP_ACC - ARP_ACC_MIN;
    else if (type === 'normal') inset = 0;
    else if (type === 'up' || type === 'down') inset = (width - gh('wiggleArpeggiatoUp')) / 2;
    else if (type === 'upStraight' || type === 'downStraight') inset = (width - lineWidth) / 2;
    else inset = width - lineWidth / 2;
    gap = ARP_ACC - ACC_DIST - inset;
  } else {
    gap = ARP_NOTE;
    const iLeft = dx.indexOf(Math.min(...dx));
    const ledger = (y) => lineOf(y) > T + 1 || lineOf(y) < -1;
    const needLedger = Math.min(...dx) === 0 ? (lineOf(ys[iDown]) > T + 1 || lineOf(ys[iUp]) < -1) : ledger(ys[iLeft]);
    if (needLedger) gap = ARP_LEDGER + LEDGER_LEN;
  }
  const res = arpeggioLayout({ spec, x, top, bottom, lll, gap, glyphs, lineWidth, hookLen, ref });
  return { ...res, extent: lll + width + gap };
}
