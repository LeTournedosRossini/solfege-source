/*
 * Barres de mesure (portage de `drawBarlineByType` et `barlineFootprint` du prototype, valeurs de MuseScore `styledef.cpp`).
 * Types : simple, double, finale, finale inversée, épaisse, double épaisse, pointillée, tiretée, courte, tick, et les reprises
 * `startRepeat` / `endRepeat` / `endStartRepeat` (ces trois-là ne viennent pas de BAR_TYPE mais des drapeaux de reprise du
 * masterbar : voir `endBarType` dans systems.js).
 *
 * La géométrie INTERNE d'une barre composée est fixe (jamais étirée par la justification) : seule sa position de départ
 * bouge. Une barre déborde légèrement de la portée (demi-épaisseur d'une ligne) : barre et lignes sont des éléments
 * séparés, ce débord masque toute imprécision sans jamais être visuellement faux. Les points de reprise sont le glyphe
 * Bravura `repeatDot`. Hauteur des deux points (`opts.dotYs`) : port de `drawDots` de MuseScore (deux interlignes autour du milieu : 2e et 3e
 * interligne d'une portée de 5 lignes, 2e et 4e d'une tablature de 6 lignes), centrés sur la barre d'une portée sans lignes ; défaut 1,5 / 2,5.
 * Ailettes (`opts.tips`, option REPEAT_BAR_TIPS, `repeatBarTips` de MuseScore) : glyphes `bracketTop/Bottom` à l'ouverture d'une reprise
 * (courbés vers la droite), `reversedBracketTop/Bottom` à sa fermeture (vers la gauche), aux extrémités de la barre épaisse.
 */
import { BARLINE_THIN_W, BARLINE_THICK_W, BARLINE_LINE_GAP, BARLINE_DOT_GAP, BARLINE_DOT_W, BARLINE_DASH_LEN, BARLINE_DASH_GAP } from './constants.js';
import { glyphItem } from './header.js';

/** On the CHORD staff only, the thick bar of a repeat is drawn thinner (the room it takes stays the one of a final bar, so the dots line up with the other staves). */
const COMPACT_THICK_W = 0.42;

export function barlineFootprint(type) {
  switch (type) {
    case 'double': return 2 * BARLINE_THIN_W + BARLINE_LINE_GAP;
    case 'final': case 'reverseFinal': return BARLINE_THICK_W + BARLINE_THIN_W + BARLINE_LINE_GAP;
    case 'heavy': return BARLINE_THICK_W;
    case 'heavyHeavy': return 2 * BARLINE_THICK_W + BARLINE_LINE_GAP;
    case 'startRepeat': case 'endRepeat':
      return BARLINE_THICK_W + BARLINE_THIN_W + BARLINE_LINE_GAP + BARLINE_DOT_GAP + BARLINE_DOT_W;
    case 'endStartRepeat':
      return BARLINE_THICK_W + 2 * (BARLINE_THIN_W + BARLINE_LINE_GAP + BARLINE_DOT_GAP + BARLINE_DOT_W);
    default: return BARLINE_THIN_W; // simple, tiretée, pointillée, courte, tick : une ligne fine
  }
}

/**
 * @param x       position de départ (bord gauche de la barre)
 * @param bottom  y (local, vers le haut) du bord bas ; top : du bord haut
 * @param glyphs  données Bravura (pour les points de reprise)
 */
export function barlineItems(x, type, bottom, top, ref, glyphs, opts = {}) {
  const items = [];
  // `opts.compact` (the CHORD staff): the curls are smaller and INSIDE the height of the bar, the lines of a repeat stop where they begin, the thick bar is thinner:
  // the whole sign is as tall as a plain bar line. Every other staff keeps Bravura's curls at their size, hanging beyond the bar.
  const fit = !!opts.compact; const tipMag = fit ? opts.tipScale ?? 1 : 1; const tipH = 1.18 * tipMag;
  const cutTop = fit && opts.tips && opts.tips.top !== false ? tipH : 0; const cutBottom = fit && opts.tips && opts.tips.bottom !== false ? tipH : 0;
  const rep = () => ({ lo: bottom + cutBottom, hi: top - cutTop, thick: fit ? COMPACT_THICK_W : BARLINE_THICK_W, pad: fit ? (BARLINE_THICK_W - COMPACT_THICK_W) / 2 : 0 }); // the lines of a repeat bar
  const vline = (lx, w, y1 = bottom, y2 = top, extra = {}) => items.push({ kind: 'line', role: 'barline', x1: lx + w / 2, x2: lx + w / 2, y1, y2, width: w, ref, ...extra });
  const dots = (dx) => {
    const half = glyphs.glyphs.repeatDot.bbox.bBoxNE[0] / 2;
    for (const y of opts.dotYs ?? [1.5, 2.5]) items.push(glyphItem('repeatDot', dx, y, { role: 'repeat-dot', ref }));
    return half;
  };
  // tip = which side of the thick bar the curls hang on (`reversed` = left of the bar's right edge)
  const tips = (tx, reversed) => {
    if (!opts.tips) return;
    for (const [base, y, show] of [['Top', top, opts.tips.top !== false], ['Bottom', bottom, opts.tips.bottom !== false]]) {
      if (!show) continue;
      const name = (reversed ? 'reversedBracket' : 'bracket') + base;
      const w = (glyphs.glyphs[name]?.bbox.bBoxNE[0] ?? 0) * tipMag;
      items.push(glyphItem(name, reversed ? tx - w : tx, !fit ? y : base === 'Top' ? y - tipH : y + tipH, { role: 'repeat-tip', ref, ...(tipMag !== 1 ? { mag: tipMag } : {}) }));
    }
  };
  let cx = x;
  switch (type) {
    case 'double':
      vline(cx, BARLINE_THIN_W); cx += BARLINE_THIN_W + BARLINE_LINE_GAP;
      vline(cx, BARLINE_THIN_W);
      break;
    case 'final':
      vline(cx, BARLINE_THIN_W); cx += BARLINE_THIN_W + BARLINE_LINE_GAP;
      vline(cx, BARLINE_THICK_W);
      break;
    case 'reverseFinal':
      vline(cx, BARLINE_THICK_W); cx += BARLINE_THICK_W + BARLINE_LINE_GAP;
      vline(cx, BARLINE_THIN_W);
      break;
    case 'heavy':
      vline(cx, BARLINE_THICK_W);
      break;
    case 'heavyHeavy':
      vline(cx, BARLINE_THICK_W); cx += BARLINE_THICK_W + BARLINE_LINE_GAP;
      vline(cx, BARLINE_THICK_W);
      break;
    case 'dashed':
      // le bout arrondi déborde de w/2 à chaque extrémité : on le retranche pour garder le même débord que les autres types
      vline(cx, BARLINE_THIN_W, bottom + BARLINE_THIN_W / 2, top - BARLINE_THIN_W / 2, { dash: [BARLINE_DASH_LEN, BARLINE_DASH_GAP], cap: 'round' });
      break;
    case 'dotted':
      // pas de glyphe rond en trait simple : un tiret quasi nul à bout arrondi simule des points (approximation du prototype)
      vline(cx, BARLINE_THIN_W, bottom + BARLINE_THIN_W / 2, top - BARLINE_THIN_W / 2, { dash: [0.001, BARLINE_THIN_W * 1.7], cap: 'round' });
      break;
    case 'short':
      vline(cx, BARLINE_THIN_W, (bottom + top) / 2, top); // moitié haute de la portée
      break;
    case 'tick':
      vline(cx, BARLINE_THIN_W, top - 0.528, top + 0.48); // dépasse la ligne du haut (métrique SMuFL barlineTick)
      break;
    case 'startRepeat': {
      const { lo, hi, thick, pad } = rep();
      vline(cx + pad, thick, lo, hi); cx += BARLINE_THICK_W + BARLINE_LINE_GAP;
      vline(cx, BARLINE_THIN_W, lo, hi); cx += BARLINE_THIN_W + BARLINE_DOT_GAP;
      dots(cx);
      tips(x, false);
      break;
    }
    case 'endRepeat': {
      const { lo, hi, thick, pad } = rep();
      dots(cx); cx += BARLINE_DOT_W + BARLINE_DOT_GAP;
      vline(cx, BARLINE_THIN_W, lo, hi); cx += BARLINE_THIN_W + BARLINE_LINE_GAP;
      vline(cx + pad, thick, lo, hi);
      tips(cx + BARLINE_THICK_W, true);
      break;
    }
    case 'endStartRepeat': {
      const { lo, hi, thick, pad } = rep();
      dots(cx); cx += BARLINE_DOT_W + BARLINE_DOT_GAP;
      vline(cx, BARLINE_THIN_W, lo, hi); cx += BARLINE_THIN_W + BARLINE_LINE_GAP;
      // the thick bar sits between the two halves: curls lean outwards on each side (MuseScore draws the second pair at x = 0, which overlaps the dots)
      tips(cx, true);
      tips(cx + BARLINE_THICK_W, false);
      vline(cx + pad, thick, lo, hi); cx += BARLINE_THICK_W + BARLINE_LINE_GAP;
      vline(cx, BARLINE_THIN_W, lo, hi); cx += BARLINE_THIN_W + BARLINE_DOT_GAP;
      dots(cx);
      break;
    }
    default:
      vline(cx, BARLINE_THIN_W);
  }
  if (/Repeat$/.test(type)) for (const it of items) it.sign = true; // a repeat bar is a structure sign (a reader may colour it)
  return items;
}
