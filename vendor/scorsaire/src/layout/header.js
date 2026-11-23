/*
 * En-tête de système : clé, armure, chiffrage (largeurs calculées depuis les vrais glyphes Bravura, roadmap §6).
 * Règles reprises du prototype et de MuseScore (`TLayout::layoutKeySig`) : par défaut une armure ne montre des bécarres
 * d'annulation que lors d'un retour à 0 altération.
 */
import {
  CLEF_DEFS, SHARP_ORDER, FLAT_ORDER, KEY_SIG_GAP, KEY_SIG_END_PAD, GLYPH_PAD,
  SMALL_CLEF_MAG, CLEF_LEFT_MARGIN, CLEF_BARLINE_MARGIN, CLEF_CHANGE_GAP,
} from './constants.js';

export const glyphItem = (name, x, y, extra = {}) => ({ kind: 'glyph', name, x, y, ...extra });

export const glyphWidth = (glyphs, name) => glyphs.glyphs[name].bbox.bBoxNE[0];

/** Armure du modèle (entier : dièses > 0, bémols < 0) → { type, count }. */
export function keySigOf(n) {
  return { type: n < 0 ? 'flat' : 'sharp', count: Math.abs(n) };
}

function letters(ks) {
  return (ks.type === 'flat' ? FLAT_ORDER : SHARP_ORDER).slice(0, ks.count);
}

/** Symboles à dessiner pour `newKs`, sachant que `prevKs` était active juste avant. */
export function keySigSymbols(newKs, prevKs) {
  if (newKs.count === 0 && prevKs && prevKs.count > 0) {
    return letters(prevKs).map((letter) => ({ letter, sym: 'accidentalNatural', posType: prevKs.type }));
  }
  if (newKs.count === 0) return [];
  const sym = newKs.type === 'flat' ? 'accidentalFlat' : 'accidentalSharp';
  return letters(newKs).map((letter) => ({ letter, sym, posType: newKs.type }));
}

export function keySigWidth(glyphs, newKs, prevKs) {
  const syms = keySigSymbols(newKs, prevKs);
  if (syms.length === 0) return 0;
  return syms.reduce((acc, s) => acc + glyphWidth(glyphs, s.sym) + KEY_SIG_GAP, 0) + KEY_SIG_END_PAD;
}

/** Glyphes de l'armure pour une portée dont la clé est `clefKey`, à partir de x. */
export function keySigItems(glyphs, x, clefKey, newKs, prevKs) {
  const items = [];
  let cx = x;
  for (const s of keySigSymbols(newKs, prevKs)) {
    const table = s.posType === 'flat' ? CLEF_DEFS[clefKey].flatPos : CLEF_DEFS[clefKey].sharpPos;
    items.push(glyphItem(s.sym, cx, table[s.letter]));
    cx += glyphWidth(glyphs, s.sym) + KEY_SIG_GAP;
  }
  return items;
}

const digits = (n) => String(n).split('').map((d) => `timeSig${d}`);
const partWidth = (glyphs, n) => digits(n).reduce((s, g) => s + glyphWidth(glyphs, g), 0);

/** Effective writing of a time signature: 'common' (C) only applies to 4/4 and 'cut' (C barré) only to 2/2, else digits. */
export function effectiveTimeSigStyle([num, den], style) {
  if (style === 'common' && num === 4 && den === 4) return 'common';
  if (style === 'cut' && num === 2 && den === 2) return 'cut';
  return 'normal';
}
const symbolOf = (style) => (style === 'common' ? 'timeSigCommon' : style === 'cut' ? 'timeSigCutCommon' : null);

/** Largeur du chiffrage [num, den] : la plus large de ses deux parties (ou le glyphe C / C barré). */
export function timeSigWidth(glyphs, [num, den], style = 'normal') {
  const sym = symbolOf(effectiveTimeSigStyle([num, den], style));
  if (sym) return glyphWidth(glyphs, sym);
  return Math.max(partWidth(glyphs, num), partWidth(glyphs, den));
}

/** Chiffrage : numérateur et dénominateur empilés, le plus étroit recentré sur le plus large (MuseScore `layoutTimeSig`). */
export function timeSigItems(glyphs, x, [num, den], yNum, yDen, style = 'normal') {
  const sym = symbolOf(effectiveTimeSigStyle([num, den], style));
  if (sym) return [{ ...glyphItem(sym, x, (yNum + yDen) / 2), sign: true }]; // centred on the middle line of the staff
  const numW = partWidth(glyphs, num);
  const denW = partWidth(glyphs, den);
  const w = Math.max(numW, denW);
  const items = [];
  let xn = x + (w - numW) / 2;
  for (const g of digits(num)) {
    items.push({ ...glyphItem(g, xn, yNum), sign: true });
    xn += glyphWidth(glyphs, g);
  }
  let xd = x + (w - denW) / 2;
  for (const g of digits(den)) {
    items.push({ ...glyphItem(g, xd, yDen), sign: true });
    xd += glyphWidth(glyphs, g);
  }
  return items;
}

/** Largeur d'une clé de tête de ligne (glyphe × échelle + respiration). */
export function clefWidth(glyphs, clef) {
  if (clef.width !== undefined) return clef.width; // clé vectorielle (accordéon) : largeur fournie
  return glyphWidth(glyphs, clef.glyph) * (clef.mag ?? 1) + GLYPH_PAD;
}

/** Largeur du glyphe d'une clé `clefKey` (taille normale ou petite, `Sid::smallClefMag`) + respiration. */
export function clefGlyphWidthUnits(glyphs, clefKey, small) {
  const w = glyphWidth(glyphs, CLEF_DEFS[clefKey].glyph);
  return (small ? w * SMALL_CLEF_MAG : w) + GLYPH_PAD;
}

/** Place réservée pour une clé insérée en cours de mesure (petite taille) : marge, glyphe, espace avant la note. */
export function clefChangeExtraWidth(glyphs, clefKey) {
  return CLEF_LEFT_MARGIN + clefGlyphWidthUnits(glyphs, clefKey, true) + CLEF_CHANGE_GAP;
}

/** Place réservée pour une clé de courtoisie (petite taille) avant la barre de fin de ligne (pas encore utilisé). */
export function courtesyClefExtraWidth(glyphs, clefKey) {
  return CLEF_LEFT_MARGIN + clefGlyphWidthUnits(glyphs, clefKey, true) + CLEF_BARLINE_MARGIN;
}
