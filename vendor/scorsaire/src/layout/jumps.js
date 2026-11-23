/*
 * Sauts (D.C., D.S. al Coda…) et marqueurs (segno, coda, Fine, To Coda…) : mise en page sur la portée du haut de chaque système.
 * Port de `MarkerLayout::doLayoutMarker` / `TLayout::layoutJump` (MuseScore 4.7.5, rendering/score/markerlayout.cpp et tlayout.cpp),
 * styles `repeatLeft` / `repeatRight` (styledef.cpp) :
 *  - texte Edwin 10 pt (ici : serif générique, comme les autres textes), symboles à 18 pt (échelle 0,9 d'un glyphe SMuFL de 20 pt) ;
 *  - marqueur à GAUCHE (segno, coda, codetta, texte libre) : un symbole est CENTRÉ sur la barre qui ouvre la mesure (`centerOnSymbol`),
 *    un texte libre est aligné à gauche sur le bord gauche de cette barre ; sur le 1er système d'une ligne, la barre est le début du système ;
 *  - marqueur ou saut à DROITE (Fine, To Coda, Da Coda, D.S. al Coda…) : aligné à droite sur la fin de la barre de fin de mesure ;
 *    « To » + symbole coda : le symbole est centré sur la barre de fin ;
 *  - au-dessus de la portée du haut : ligne de base posée sur la ligne du haut, puis repoussée au-dessus de tout ce qui la recouvre
 *    horizontalement, à `repeatMinDistance` (0,5 sp) près (autoplace).
 * Écarts assumés : autoplace contre les BOÎTES des éléments déjà dessinés (pas de skyline continue), voltas comprises (MuseScore ne dit
 * pas laquelle s'écarte) ; largeur du texte approchée (0,5 × corps × caractères, Edwin absente) ; pas de décalage « évitement de barre »
 * pour les portées autres que la première (les sauts ne sont dessinés que sur la portée du haut). Rien n'est vérifié sur export.
 * Repère : portée du haut, y vers le HAUT, 0 = ligne du bas.
 */
import { PID, getProperty, jumpText, markerParts, isRightMarker } from '../model/index.js';
import { barlineFootprint } from './barlines.js';
import { BARLINE_THIN_W, BARLINE_THICK_W } from './constants.js';
import { rectsOf } from './bounds.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const TEXT_SIZE_BASE = 10 / PT; // repeatLeft/RightFontSize
const SYMBOL_MAG_BASE = 18 / 20; // repeatLeft/RightMusicalSymbolSize 18 pt
const MIN_DISTANCE = 0.5; // repeatMinDistance
const STAFF_TOP_HALF = 0.05; // demi-épaisseur de la ligne du haut
const TEXT_ASCENT = 0.9; // boîte approchée d'un texte : [−0,3 ; +0,9] × corps autour de la ligne de base
const TEXT_DESCENT = 0.3;
const WORD_GAP = 0.5; // espace entre « To » et le symbole coda (une espace de police ≈ 0,25 em)

/**
 * @param movement  Mouvement
 * @param sys       système { measures: [{ mi, start, barX, endType }], first, leadRepeat }
 * @param topLineY  y de la ligne du haut de la portée du haut
 * @param existing  éléments déjà dessinés sur cette portée (voltas comprises) : ils repoussent les marqueurs
 * @param scale     facteur de taille des signes et de leurs textes (1 = MuseScore)
 * @returns éléments d'affichage (glyph | text)
 */
export function jumpMarkerItems(movement, sys, topLineY, existing, glyphs, scale = 1) {
  const TEXT_SIZE = TEXT_SIZE_BASE * scale; const SYMBOL_MAG = SYMBOL_MAG_BASE * scale; // (`scale`: SID.READER_MARK_SCALE, the Lecteur keeps the signs at their size when it draws the writing bigger)
  const textWidth = (text) => 0.5 * TEXT_SIZE * text.length;
  const ids = movement.masterbars.map((b) => b.id);
  const byMi = new Map(sys.measures.map((m) => [m.mi, m]));
  const pool = rectsOf(existing, glyphs);
  pool.push({ x1: -Infinity, x2: Infinity, y1: topLineY - 1, y2: topLineY + STAFF_TOP_HALF }); // la portée elle-même
  const out = [];

  /** Barre qui ouvre la mesure `mi` : { left, right } (bords) ; début de système : le bord gauche de la portée. */
  const openingBar = (mi) => {
    if (mi === sys.first) {
      const startRepeat = getProperty(movement.masterbars[mi], PID.REPEAT_START);
      const w = startRepeat ? BARLINE_THICK_W : BARLINE_THIN_W;
      return { left: 0, right: w };
    }
    const prev = byMi.get(mi - 1);
    return { left: prev.barX, right: prev.barX + barlineFootprint(prev.endType) };
  };

  /** Pose une suite de parties { text } | { glyph } ; renvoie les éléments et leur boîte (y relatifs à la ligne de base). */
  const place = (parts, align, ref, role) => {
    const widths = parts.map((p) => (p.glyph ? glyphs.glyphs[p.glyph].advance * SYMBOL_MAG : textWidth(p.text)));
    const total = widths.reduce((a, b) => a + b, 0);
    const items = [];
    let top = -Infinity, bottom = Infinity;
    const grow = (t, b) => { top = Math.max(top, t); bottom = Math.min(bottom, b); };

    // un texte seul aligné à droite (Fine, D.S. al Coda…) : le moteur de rendu aligne le bord droit, la largeur n'est qu'approchée pour la boîte
    if (parts.length === 1 && parts[0].text !== undefined && align.kind === 'right') {
      items.push({ kind: 'text', text: parts[0].text, x: align.x, y: 0, size: TEXT_SIZE, anchor: 'end', role: `${role}-text`, ref });
      grow(TEXT_ASCENT * TEXT_SIZE, -TEXT_DESCENT * TEXT_SIZE);
      return { items, x1: align.x - total, x2: align.x, top, bottom };
    }

    let x;
    if (align.kind === 'center') {
      // centré sur le (premier) symbole : le mot qui le précède (« To ») reste à sa gauche
      const gi = parts.findIndex((p) => p.glyph);
      const before = widths.slice(0, gi).reduce((a, b) => a + b, 0);
      x = align.x - before - widths[gi] / 2;
    } else if (align.kind === 'right') x = align.x - total;
    else x = align.x;
    // un symbole centré sur le début d'un système ne sort pas de la page : le bord gauche reste à x ≥ 0 (MuseScore le laisse déborder dans la marge)
    x = Math.max(x, 0);

    let cursor = x;
    parts.forEach((p, i) => {
      if (p.glyph) {
        const g = glyphs.glyphs[p.glyph];
        items.push({ kind: 'glyph', name: p.glyph, x: cursor, y: 0, mag: SYMBOL_MAG, role, ref });
        grow(g.bbox.bBoxNE[1] * SYMBOL_MAG, g.bbox.bBoxSW[1] * SYMBOL_MAG);
      } else if (parts[i + 1]?.glyph) {
        // un mot suivi d'un symbole : il se termine juste à gauche du symbole, quelle que soit sa largeur réelle
        items.push({ kind: 'text', text: p.text.trimEnd(), x: cursor + widths[i] - WORD_GAP / 2, y: 0, size: TEXT_SIZE, anchor: 'end', role: `${role}-text`, ref });
        grow(TEXT_ASCENT * TEXT_SIZE, -TEXT_DESCENT * TEXT_SIZE);
      } else {
        items.push({ kind: 'text', text: p.text, x: cursor, y: 0, size: TEXT_SIZE, anchor: 'start', role: `${role}-text`, ref });
        grow(TEXT_ASCENT * TEXT_SIZE, -TEXT_DESCENT * TEXT_SIZE);
      }
      cursor += widths[i];
    });
    return { items, x1: x, x2: x + total, top, bottom };
  };

  const emit = (parts, align, ref, role) => {
    const laid = place(parts, align, ref, role);
    // autoplace : ligne de base sur la ligne du haut, repoussée au-dessus de tout ce qui la recouvre à MIN_DISTANCE près
    let base = topLineY;
    for (const r of pool) {
      if (r.x2 > laid.x1 && r.x1 < laid.x2) base = Math.max(base, r.y2 + MIN_DISTANCE - laid.bottom);
    }
    for (const it of laid.items) out.push({ ...it, y: base });
    pool.push({ x1: laid.x1, x2: laid.x2, y1: base + laid.bottom, y2: base + laid.top });
  };

  // sauts et marqueurs triés par mesure puis dans l'ordre du modèle (marqueurs avant sauts)
  for (const mk of movement.markers) {
    const mi = ids.indexOf(getProperty(mk, PID.MEASURE_ID));
    const m = byMi.get(mi);
    if (!m) continue;
    const parts = markerParts(mk);
    if (!parts.length) continue;
    const hasSymbol = parts.some((p) => p.glyph);
    if (isRightMarker(mk)) {
      const end = m.barX + barlineFootprint(m.endType);
      if (hasSymbol) emit(parts, { kind: 'center', x: m.barX + barlineFootprint(m.endType) / 2 }, mk.id, 'marker');
      else emit(parts, { kind: 'right', x: end }, mk.id, 'marker');
    } else {
      const bar = openingBar(mi);
      if (hasSymbol) emit(parts, { kind: 'center', x: (bar.left + bar.right) / 2 }, mk.id, 'marker');
      else emit(parts, { kind: 'left', x: bar.left }, mk.id, 'marker');
    }
  }
  // « x4 » above the end-repeat bar (right aligned on the end of the bar)
  movement.masterbars.forEach((bar, mi) => {
    const m = byMi.get(mi);
    const t = getProperty(bar, PID.REPEAT_TEXT);
    if (m && t && getProperty(bar, PID.REPEAT_END)) emit([{ text: t }], { kind: 'right', x: m.barX + barlineFootprint(m.endType) }, bar.id, 'repeat-count');
  });
  for (const jp of movement.jumps) {
    const mi = ids.indexOf(getProperty(jp, PID.MEASURE_ID));
    const m = byMi.get(mi);
    const text = jumpText(jp);
    if (!m || !text) continue;
    emit([{ text }], { kind: 'right', x: m.barX + barlineFootprint(m.endType) }, jp.id, 'jump');
  }
  return out;
}
