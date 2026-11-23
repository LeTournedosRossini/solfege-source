/*
 * Textes de portée liés à la tranche 4e : TEXTE DU CAPO (`Capo`, un StaffText daté) et TEXTE D'ACCORDAGE (`StringTunings`).
 * Port de `Capo::generateText`, `StringTunings::generateText` et `TLayout::layoutStringTunings` (MuseScore v4.7.5).
 *  - Capo : texte (modèle de `SID.CAPO_TEXT*` ou `text` propre à l'entrée), Edwin 10 pt, aligné à gauche sur la colonne de l'élément d'ancrage,
 *    ligne de base à 1 sp au-dessus de la portée (`staffTextPosAbove` (0, −1)), plusieurs lignes vers le bas, autoplace au-dessus (`minDistance` 0,5).
 *  - StringTunings : 9 pt ; par corde visible un glyphe `guitarStringN` (cerclé, à l'échelle 9 pt, abaissé de 0,35 sp) + « – » + lettre (+ altération) ;
 *    1 colonne sous 4 cordes visibles, sinon 2 colonnes (lignes = ⌈n/2⌉, ordre colonne par colonne) ; x = début de la mesure d'ancrage + 1 sp
 *    (`move(−segment.x + spatium)`) ; même autoplace.
 * Sans effet sur l'espacement horizontal (comme un texte de portée sans forme dans l'accord). Hauteurs de texte approchées (police Edwin absente) :
 * largeur ≈ 0,5 × corps × caractères, ligne = 1,2 × corps, boîte [−0,9 ; +0,3] × corps autour de la ligne de base. Rien n'est vérifié sur export.
 */
import { PID, getProperty, capoText } from '../model/index.js';
import { STANDARD_TUNING } from '../model/capo.js';
import { rectsOf } from './bounds.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const CAPO_SIZE = 10 / PT;
const TUNING_SIZE = 9 / PT;
// Chiffres cerclés : plus grands et plus hauts que le port brut (corps 9 pt, abaissés de 0,35 sp) — retour de Jean 04/10/2026 : cercle de 1,3 sp
// posé sur la ligne de base, donc centré sur la hauteur des capitales du texte voisin.
const GLYPH_MAG = 0.66; // cercle de 2,156 × 0,66 ≈ 1,42 sp (+10 % sur 0,6 : demande de Jean 04/10/2026)
// centre du cercle sur le centre des capitales du texte voisin (hauteur de capitale ≈ 0,66 × corps) ; vers le bas = positif
const SYMBOL_DROP = 0.33 * TUNING_SIZE - 1.078 * GLYPH_MAG + 0.06; // + 0,06 : ajusté à l'œil sur la capture
const GLYPH_TEXT_GAP = 0.3; // espace entre le chiffre cerclé et le tiret
const POS_ABOVE = 1; // ligne de base 1 sp au-dessus de la ligne du haut
const MIN_DISTANCE = 0.5; // staffTextMinDistance
const LINE_HEIGHT = 1.2;
const textWidth = (text, size) => 0.5 * size * text.length;

/** Lettre (+ altération) d'une corde : `String(pitchStr[0]).toUpper() + accidental`. */
function stringLetter(name) {
  const m = /^([A-G])([#b]?)/.exec(name);
  return m ? m[1] + m[2] : name;
}

/** Lignes du texte d'accordage : [{ n (numéro de corde), label }] puis disposition en colonnes. */
export function tuningLines(names, visible) {
  const list = [];
  for (let s = 1; s <= names.length; s++) if (!visible || visible.includes(s)) list.push({ n: s, label: ` – ${stringLetter(names[s - 1])}  ` });
  const cols = list.length < 4 ? 1 : 2;
  const rows = cols === 1 ? list.length : Math.ceil(list.length / 2);
  return { list, rows, cols };
}

export function staffTextItems({ perSystem, staff, ctx, result, lines, lineDist, existing = [] }) {
  const capos = (ctx.capoTimeline ?? []).filter((c) => c.entry);
  const tunings = getProperty(staff, PID.STRING_TUNINGS) ?? [];
  if (!capos.length && !tunings.length) return;
  const H = (lines - 1) * lineDist;
  const U = (y) => H - y;
  const glyphs = ctx.glyphs;
  const staffTuning = getProperty(staff, PID.TUNING) ?? STANDARD_TUNING;
  const where = new Map(); // id d'élément → { k, x, sys, mi }
  perSystem.forEach(({ placed, sys }, k) => { for (const p of placed) where.set(p.entry.item.id, { k, x: p.x, sys, mi: p.mi }); });
  const pool = perSystem.map((_, k) => {
    const rs = rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], glyphs).map((r) => ({ x1: r.x1, x2: r.x2, top: H - r.y2, bottom: H - r.y1 }));
    rs.push({ x1: -Infinity, x2: Infinity, top: -0.05, bottom: H + 0.05 });
    return rs;
  });

  // textes dans l'ordre du temps : (mesure, position), capo avant accordage à égalité
  const jobs = [];
  for (const c of capos) {
    const w = where.get(c.entry.itemId);
    if (w) jobs.push({ kind: 'capo', c, w, order: [c.mi, c.key[1][0] / c.key[1][1]] });
  }
  for (const t of tunings) {
    const w = where.get(t.itemId);
    if (w) jobs.push({ kind: 'tuning', t, w, order: [w.mi, 0] });
  }
  jobs.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || (a.kind === 'capo' ? -1 : 1));

  for (const job of jobs) {
    const { k, sys } = job.w;
    const out = []; // éléments à poser sur la ligne de base 0 (y bas, relatif) : { item(base) , ... }
    let x; let size; let box; let ref;
    if (job.kind === 'capo') {
      size = CAPO_SIZE;
      x = job.w.x;
      ref = job.c.entry.id;
      const text = job.c.entry.text ?? capoText(job.c.params, staffTuning.length, ctx.style);
      const rows = String(text).split('\n');
      rows.forEach((row, i) => out.push({ text: row, dx: 0, dy: i * LINE_HEIGHT * size, size }));
      box = { w: Math.max(...rows.map((r) => textWidth(r, size))), n: rows.length };
    } else {
      size = TUNING_SIZE;
      ref = job.t.id;
      const names = (job.t.tuning ?? staffTuning);
      const { list, rows, cols } = tuningLines(names, job.t.visibleStrings);
      if (!list.length) continue;
      const m = sys.measures.find((mm) => mm.mi === job.w.mi);
      x = (m ? m.start : job.w.x) + 1;
      const glyphW = glyphs.glyphs.guitarString1.advance * GLYPH_MAG;
      const colW = [0, 0];
      for (let i = 0; i < list.length; i++) { const col = Math.floor(i / rows); colW[col] = Math.max(colW[col], glyphW + GLYPH_TEXT_GAP + textWidth(list[i].label, size)); }
      let width = 0;
      for (let i = 0; i < list.length; i++) {
        const col = Math.floor(i / rows); const row = i % rows;
        const dx = col === 0 ? 0 : colW[0];
        out.push({ glyph: `guitarString${list[i].n}`, dx, dy: row * LINE_HEIGHT * size });
        out.push({ text: list[i].label, dx: dx + glyphW + GLYPH_TEXT_GAP, dy: row * LINE_HEIGHT * size, size });
        width = Math.max(width, dx + colW[col]);
      }
      box = { w: width, n: rows };
      void cols;
    }
    const shape = { x1: x, x2: x + box.w, top: -0.9 * size, bottom: 0.3 * size + (box.n - 1) * LINE_HEIGHT * size };
    // autoplace au-dessus : position de style (ligne de base à POS_ABOVE au-dessus de la portée), repoussée au-dessus du « skyline »
    let base = -POS_ABOVE;
    const overl = pool[k].filter((r) => r.x2 > shape.x1 && r.x1 < shape.x2);
    if (overl.length) {
      const sky = Math.min(...overl.map((r) => r.top));
      base = Math.min(base, sky - MIN_DISTANCE - shape.bottom);
    }
    for (const o of out) {
      if (o.glyph) result[k].push({ kind: 'glyph', name: o.glyph, x: x + o.dx, y: U(base + o.dy + SYMBOL_DROP), mag: GLYPH_MAG, role: 'string-tuning', ref });
      else result[k].push({ kind: 'text', role: job.kind === 'capo' ? 'capo-text' : 'string-tuning-text', text: o.text, x: x + o.dx, y: U(base + o.dy), size: o.size, anchor: 'start', ref });
    }
    pool[k].push({ x1: shape.x1, x2: shape.x2, top: base + shape.top, bottom: base + shape.bottom });
  }
}
