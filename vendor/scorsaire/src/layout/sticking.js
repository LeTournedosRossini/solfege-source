/*
 * Sticking (mains) sur portée de percussion — tranche 5c. Port de `TLayout::layoutSticking`, `SystemLayout::layoutSticking`
 * et `AlignmentLayout::alignItemsForSystem` (MuseScore v4.7.5), adapté à un sticking PAR NOTE (voir ../model/sticking.js).
 *  - Texte Edwin 10 pt (lettres) ou symbole de la police de notes à 10 pt (= échelle 0,5 d'un glyphe SMuFL, 20 pt par défaut), centré SUR LA
 *    LARGEUR DE LA TÊTE NOIRE (`noteheadBlack`) depuis l'origine de l'accord ; ligne de base à 1 sp au-dessus de la ligne du haut
 *    (`stickingPosAbove`) ou 2 sp sous la ligne du bas (`stickingPosBelow`).
 *  - Autoplace : la forme du texte (boîte SERRÉE, comme `layoutTextBlock` : `tightBoundingRect`) est repoussée à `stickingMinDistance`
 *    (0,5 sp) des éléments déjà dessinés, seulement si elle en est plus proche ; les stickings s'ignorent entre eux.
 *  - Alignement : tous les stickings d'une portée, d'un côté, dans un système, sont ramenés à la même hauteur (la plus éloignée).
 *  - Accord à deux mains différentes : les symboles s'empilent vers l'extérieur (interligne 1,2 × corps) — AJOUT Scorsaire.
 * ÉCARTS : côté par défaut AU-DESSUS (MuseScore : dessous) ; sticking par note (MuseScore : texte sur un segment) ; largeur d'une lettre
 * approchée (Edwin absente : 0,6 × corps, hauteur de capitale 0,7 × corps) ; tête noire en Bravura brut (1,18 sp, Leland : 1,3 sp).
 */
import { PID, getProperty, SID, resolveStickingSystem, stickingSymbol } from '../model/index.js';
import { rectsOf } from './bounds.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const DEFAULT_SMUFL_PT = 20; // corps SMuFL par défaut (4 espaces)
const LETTER_WIDTH = 0.6; // largeur d'une lettre / corps (approchée)
const CAP_HEIGHT = 0.7; // hauteur de capitale / corps (approchée)
const LINE_SPACING = 1.2;

const headWidth = (glyphs) => {
  const g = glyphs.glyphs.noteheadBlack?.bbox;
  return g ? g.bBoxNE[0] - g.bBoxSW[0] : 1.18;
};

/** Mains d'un accord, sans doublon, dans l'ordre des notes. */
export function chordHands(chord) {
  const hands = [];
  for (const n of chord.notes ?? []) {
    const h = getProperty(n, PID.STICKING);
    if (h && !hands.includes(h)) hands.push(h);
  }
  return hands;
}

/** Une ligne : { symbol, width, top, bottom (boîte serrée autour de la ligne de base, y vers le bas) }. */
function rowOf(symbol, ctx) {
  if (symbol.glyph) {
    const g = ctx.glyphs.glyphs[symbol.glyph];
    const mag = ctx.style(SID.STICKING_SYMBOL_SIZE) / DEFAULT_SMUFL_PT;
    if (!g) return { symbol, mag, width: 0, top: 0, bottom: 0, left: 0 };
    // le glyphe se pose sur la ligne de base par son ORIGINE (comme un fragment de police de notes)
    return { symbol, mag, left: g.bbox.bBoxSW[0] * mag, width: (g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0]) * mag, top: -g.bbox.bBoxNE[1] * mag, bottom: -g.bbox.bBoxSW[1] * mag };
  }
  const size = ctx.style(SID.STICKING_FONT_SIZE) / PT;
  return { symbol, size, left: 0, width: LETTER_WIDTH * size * symbol.text.length, top: -CAP_HEIGHT * size, bottom: 0 };
}

/**
 * @param perSystem  [{ sys, placed }]
 * @param staff      portée de percussion
 * @param result     tableaux d'éléments d'affichage par système (poussés ici)
 * @param existing   éléments déjà dessinés par système (autoplace)
 */
export function stickingItems({ perSystem, staff, ctx, result, lines, lineDist = 1, existing = [] }) {
  const sys = resolveStickingSystem(getProperty(staff, PID.STICKING_SYSTEM), ctx.style);
  const above = sys.placement !== 'below';
  const H = (lines - 1) * lineDist;
  const U = (y) => H - y;
  const glyphs = ctx.glyphs;
  const hw = headWidth(glyphs);
  const lineH = LINE_SPACING * (ctx.style(SID.STICKING_FONT_SIZE) / PT);
  const minDist = ctx.style(SID.STICKING_MIN_DISTANCE);
  const rest = above ? ctx.style(SID.STICKING_POS_ABOVE) : H + ctx.style(SID.STICKING_POS_BELOW);

  perSystem.forEach(({ placed }, k) => {
    const jobs = [];
    for (const p of placed) {
      if (p.entry.item.type !== 'chord') continue;
      const rows = chordHands(p.entry.item).map((h) => stickingSymbol(sys, h)).filter(Boolean).map((s) => rowOf(s, ctx));
      if (rows.length) jobs.push({ p, rows, cx: p.x + hw / 2 });
    }
    if (!jobs.length) return;
    // « skyline » : éléments déjà dessinés + corps de la portée (les stickings de ce système s'ignorent entre eux)
    const pool = rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], glyphs).map((r) => ({ x1: r.x1, x2: r.x2, top: U(r.y2), bottom: U(r.y1) }));
    pool.push({ x1: -Infinity, x2: Infinity, top: -0.05, bottom: H + 0.05 });
    for (const job of jobs) {
      const x1 = job.cx - Math.max(...job.rows.map((r) => r.width)) / 2;
      const x2 = job.cx + Math.max(...job.rows.map((r) => r.width)) / 2;
      const n = job.rows.length;
      // forme relative à la ligne de base de la 1re ligne (la plus proche de la portée) ; les suivantes s'éloignent
      const top = above ? -(n - 1) * lineH + Math.min(...job.rows.map((r) => r.top)) : Math.min(...job.rows.map((r) => r.top));
      const bottom = above ? Math.max(...job.rows.map((r) => r.bottom)) : (n - 1) * lineH + Math.max(...job.rows.map((r) => r.bottom));
      const overl = pool.filter((r) => r.x2 > x1 && r.x1 < x2);
      let base = rest;
      if (above) base = Math.min(base, Math.min(...overl.map((r) => r.top)) - minDist - bottom);
      else base = Math.max(base, Math.max(...overl.map((r) => r.bottom)) + minDist - top);
      job.base = base;
    }
    // alignement du système : tous à la hauteur la plus éloignée de la portée
    const aligned = above ? Math.min(...jobs.map((j) => j.base)) : Math.max(...jobs.map((j) => j.base));
    for (const job of jobs) {
      job.rows.forEach((r, i) => {
        const y = U(aligned + (above ? -i : i) * lineH);
        const ref = job.p.entry.item.id;
        if (r.symbol.glyph) result[k].push({ kind: 'glyph', name: r.symbol.glyph, x: job.cx - r.left - r.width / 2, y, mag: r.mag, role: 'sticking', ref });
        else result[k].push({ kind: 'text', role: 'sticking', text: r.symbol.text, x: job.cx, y, size: r.size, anchor: 'middle', ref });
      });
    }
  });
}

/** Vrai si la portée porte au moins un sticking (évite tout calcul sinon). */
export function staffHasSticking(staff) {
  for (const v of staff.voices) for (const m of v.measures) for (const it of m.items) if (it.type === 'chord' && chordHands(it).length) return true;
  return false;
}
