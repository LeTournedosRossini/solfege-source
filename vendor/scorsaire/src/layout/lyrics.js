/*
 * Paroles — port de `LyricsLayout` (MuseScore 4.7.5 : `rendering/score/lyricslayout.cpp`, `dom/lyricsline.cpp`, `dom/lyrics.cpp`,
 * `HorizontalSpacing::computeLyricsPadding`, `System/Measure::firstNoteRestSegmentX` / `endingXForOpenEndedLines`). Modèle : ../model/lyrics.js
 * (texte de couplet de l'œuvre + liens syllabe → accord sur la portée).
 *
 * Syllabe (`LyricsLayout::layout(Lyrics)`) : le texte se centre sous la TÊTE de l'accord (largeur de `noteheadBlack`), en excluant du centrage la
 * ponctuation et le numéro de couplet qui l'encadrent (`lyricsAlignVerseNumber` : `leading` = tout avant la 1re lettre, `trailing` = tout après la
 * dernière ; centre décalé de (leading − trailing) / 2) ; un mélisme ou un texte qui commence par un chiffre s'aligne À GAUCHE (`lyricsMelismaAlign`),
 * en ignorant `leading`. Ligne de base : couplet v à `H + v × interligne` sous la ligne du haut (au-dessus : `−(maxV − v) × interligne`), puis
 * `checkCollisionsWithStaffElements` : le couplet (et tous les suivants du côté extérieur) est repoussé jusqu'à `lyricsMinTopDistance` (1 sp) de ce que la
 * portée a de plus bas à son endroit (boîtes d'éléments de la portée, pas de skyline continue).
 * Lignes (`layoutDashes` / `layoutMelismaLine`) : une ligne de séparation par syllabe BEGIN / MIDDLE (tirets, jusqu'à la syllabe suivante du couplet) ou par
 * mélisme (trait, jusqu'au bord droit de la tête de l'accord de fin), UN SEGMENT PAR SYSTÈME : début = bord droit du texte + `lyricsDashPad` /
 * `lyricsMelismaPad`, ou début de système (`systemSpan.left`) ; fin = bord gauche de la syllabe suivante − `lyricsDashPad`, ou dernière barre − 0,25 sp
 * (`systemSpan.right`). Tirets : nombre, écart et longueur de `layoutDashes` ; trait de mélisme sous la longueur minimale : supprimé (ou forcé).
 * ÉCARTS / LIMITES : largeur du texte approchée (Edwin absente : table de chasses proportionnelles de type Times) ; boîtes d'éléments et non skyline
 * continue ; accord de fin d'un mélisme = bord droit de l'accord, pas de la note la plus éloignée ; `lyricsDashPosAtStartOfSystem` : STANDARD seulement ;
 * pas de lignes partielles de reprise (`PartialLyricsLine`) ; paroles sur silence, sur ornement et entre portées non traitées ; l'évitement des barres
 * passe par le remplissage LYRICS ↔ BAR_LINE de la table (pas de `spaceLyricsAgainstBarlines`) ; pas de `checkLyricsAgainstRightMargin` ;
 * non vérifié sur export MuseScore (aucun export de paroles fourni).
 */
import { SID } from '../model/index.js';
import { rectsOf } from './bounds.js';
import { systemSpan } from './painters/systemspan.js';
import { staffLyrics } from './painters/resolved.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const LINE_SPACING = 1.2; // interligne de la police / corps (approché)
const ASCENT = 0.68; // hauteur des capitales et hampes / corps
const X_HEIGHT = 0.45;
const DESCENT = 0.22;
const TOLERANCE = 0.05; // 0,05 sp (layoutMelismaLine)

// chasses (millièmes de corps) d'une police proportionnelle de type Times : approximation de la police Edwin absente
const W = { a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389, K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
  ' ': 250, '.': 250, ',': 250, ';': 278, ':': 278, '!': 333, '?': 444, '-': 333, "'": 180, '’': 333, '(': 333, ')': 333, '"': 408, '«': 500, '»': 500 };
const charW = (c) => {
  if (W[c] !== undefined) return W[c];
  if (/\d/.test(c)) return 500;
  const base = c.normalize('NFD')[0];
  if (base !== c && W[base] !== undefined) return W[base];
  if (c === 'œ') return 722;
  if (c === 'æ') return 667;
  return 500;
};
export const lyricTextWidth = (text, size) => ([...text].reduce((w, c) => w + charW(c), 0) / 1000) * size;

const isLetter = (c) => /\p{L}/u.test(c);
const hasAscender = (t) => /[\p{Lu}\d bdfhklt'’!?(|)"«»ÀÁÂÄÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜçÇœ]/u.test(t) || /[àáâäèéêëìíîïòóôöùúûü]/.test(t);
const hasDescender = (t) => /[gjpqy,;ç]/.test(t);

/**
 * Géométrie d'un texte de syllabe par rapport à l'origine de l'accord (x vers la droite ; y vers le HAUT depuis la ligne de base) :
 * { left, width, top, bottom, melismaAlign, size }.
 */
export function lyricTextBox(text, { size, headWidth, melisma, alignVerse }) {
  const width = lyricTextWidth(text, size);
  const chars = [...text];
  let leadN = 0, trailN = 0;
  if (alignVerse) {
    const first = chars.findIndex(isLetter);
    let last = -1;
    for (let i = chars.length - 1; i >= 0; i--) if (isLetter(chars[i])) { last = i; break; }
    if (first > 0) leadN = first;
    if (last >= 0 && last !== chars.length - 1) trailN = chars.length - 1 - last;
  }
  const leadW = lyricTextWidth(chars.slice(0, leadN).join(''), size);
  const trailW = lyricTextWidth(chars.slice(chars.length - trailN).join(''), size);
  const hasNumber = alignVerse && leadN > 0 && /\d/.test(chars[0]);
  const left = melisma || hasNumber ? -leadW : (headWidth - width) / 2 - (leadW - trailW) / 2;
  return {
    left, width, size,
    top: (hasAscender(text) ? ASCENT : X_HEIGHT) * size,
    bottom: -(hasDescender(text) ? DESCENT : 0) * size,
  };
}

const headWidthOf = (glyphs) => {
  const g = glyphs.glyphs.noteheadBlack?.bbox;
  return g ? g.bBoxNE[0] - g.bBoxSW[0] : 1.18;
};

const sideOf = (r, ctx) => r.placement ?? ctx.style(SID.LYRICS_PLACEMENT);

/**
 * Boîtes des syllabes d'une entrée (accord) pour l'espacement horizontal : [{ l, r, t, b (y vers le haut, repère nominal), syllabic, melisma, side }].
 * Posées dans `entry.lyricBoxes` par `context.js` ; `shapes.js` en fait des formes `LYRICS`.
 */
export function lyricBoxesFor(ctx, staff, entry) {
  if (entry.item?.type !== 'chord') return null;
  const mine = staffLyrics(ctx, staff).byChord.get(entry.item.id);
  if (!mine) return null;
  const size = ctx.style(SID.LYRICS_FONT_SIZE) / PT;
  const hw = headWidthOf(ctx.glyphs);
  const alignVerse = ctx.style(SID.LYRICS_ALIGN_VERSE_NUMBER);
  const out = [];
  for (const r of mine) {
    const melisma = r.endChordId !== undefined;
    const box = lyricTextBox(r.syllable.text, { size, headWidth: hw, melisma, alignVerse });
    const side = sideOf(r, ctx);
    const base = side === 'above' ? 1 + ASCENT * size : -1 - ASCENT * size - r.verse * LINE_SPACING * size * ctx.style(SID.LYRICS_LINE_HEIGHT);
    out.push({ l: box.left, r: box.left + box.width, t: base + box.bottom, b: base + box.top, syllabic: r.syllable.syllabic, melisma, side });
  }
  return out;
}

/** Nombre de tirets et leur disposition dans [startX, endX] (`layoutDashes`) → [[x1, x2]]. */
export function dashSegments(startX, endX, { style, dashOnFirst = false }) {
  const minLen = style(SID.LYRICS_DASH_MIN_LENGTH), maxLen = style(SID.LYRICS_DASH_MAX_LENGTH), maxDist = style(SID.LYRICS_DASH_MAX_DISTANCE);
  const half = style(SID.LYRICS_DASH_FIRST_LAST_GAP_HALF);
  const force = style(SID.LYRICS_DASH_FORCE);
  let curLength = endX - startX;
  let count = half && curLength > maxDist ? Math.ceil(curLength / maxDist) : Math.floor(curLength / maxDist);
  if (curLength > minLen || force) count = Math.max(count, 1);
  if (curLength < minLen && count > 0) {
    const diff = minLen - curLength;
    if (dashOnFirst) startX -= diff; else { startX -= 0.5 * diff; endX += 0.5 * diff; }
    curLength = endX - startX;
  }
  if (count <= 0) return [];
  const width = Math.min(curLength, maxLen);
  const dist = curLength / (half ? count : count + 1);
  const out = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    x += half && i === 0 ? 0.5 * dist : dist;
    out.push([startX + x - 0.5 * width, startX + x + 0.5 * width]);
  }
  return out;
}

/**
 * Paroles d'une portée sur tous les systèmes (appelé par `paintSpanners` des peintres, après les autres marques : elles se posent sous tout ce
 * que la portée a déjà dessiné).
 */
export function lyricsItems({ perSystem, staff, ctx, result, lines, lineDist = 1, existing = [] }) {
  const lyr = staffLyrics(ctx, staff);
  if (!lyr.list.length) return;
  const style = ctx.style;
  const H = (lines - 1) * lineDist;
  const U = (y) => H - y; // y vers le bas depuis la ligne du haut ↔ repère de portée
  const size = style(SID.LYRICS_FONT_SIZE) / PT;
  const lineSpacing = LINE_SPACING * size * style(SID.LYRICS_LINE_HEIGHT);
  const hw = headWidthOf(ctx.glyphs);
  const alignVerse = style(SID.LYRICS_ALIGN_VERSE_NUMBER);
  const lineW = style(SID.LYRICS_LINE_THICKNESS);
  const xHeight = X_HEIGHT * size;

  // où est chaque accord : système, position placée, rang dans l'ordre de la partition
  const where = new Map();
  let seq = 0;
  perSystem.forEach(({ placed }, k) => { for (const p of placed) if (p.entry.item.type === 'chord') where.set(p.entry.item.id, { k, p, seq: seq++ }); });

  // syllabes posées, groupées par côté et couplet, dans l'ordre de la partition
  const groups = new Map(); // `${side}|${verse}` → [lyric]
  for (const r of lyr.list) {
    const w = where.get(r.chordId);
    if (!w) continue;
    const melisma = r.endChordId !== undefined;
    const box = lyricTextBox(r.syllable.text, { size, headWidth: hw, melisma, alignVerse });
    const side = sideOf(r, ctx);
    const L = { r, k: w.k, seq: w.seq, side, verse: r.verse, box, x: w.p.x + box.left, text: r.syllable.text, ox: w.p.x, melisma, first: false };
    const key = `${side}|${r.verse}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(L);
  }
  for (const list of groups.values()) list.sort((a, b) => a.seq - b.seq || a.x - b.x);

  // lignes (tirets, traits de mélisme) : segments par système, avant le placement vertical
  const spans = perSystem.map((_, k) => systemSpan(perSystem, k));
  const firstChordOfSystem = perSystem.map(({ placed }) => placed.find((p) => p.entry.item.type === 'chord')?.entry.item.id);
  const segs = []; // { k, side, verse, x1, x2, ref, kind: 'dash'|'melisma', ownerIndex }
  for (const list of groups.values()) {
    list.forEach((L, i) => {
      const next = list[i + 1];
      if (L.melisma) {
        const end = where.get(L.r.endChordId);
        if (!end || end.seq < L.seq) return;
        for (let k = L.k; k <= end.k; k++) {
          let x1 = k === L.k ? L.x + L.box.width + style(SID.LYRICS_MELISMA_PAD) : spans[k].left;
          let x2 = k === end.k ? end.p.x + hw : spans[k].right;
          if (x2 - x1 < style(SID.LYRICS_MELISMA_MIN_LENGTH) - TOLERANCE) {
            if (style(SID.LYRICS_MELISMA_FORCE)) x2 = x1 + style(SID.LYRICS_MELISMA_MIN_LENGTH); else continue;
          }
          segs.push({ k, side: L.side, verse: L.verse, kind: 'melisma', x1, x2, ref: L.r.link.id, up: 0.5 * lineW });
        }
      } else if ((L.r.syllable.syllabic === 'begin' || L.r.syllable.syllabic === 'middle') && next && next.k >= L.k) {
        for (let k = L.k; k <= next.k; k++) {
          const x1 = k === L.k ? L.x + L.box.width + style(SID.LYRICS_DASH_PAD) : spans[k].left;
          const x2 = k === next.k ? next.x - style(SID.LYRICS_DASH_PAD) : spans[k].right;
          const dashOnFirst = k === next.k && firstChordOfSystem[k] === next.r.chordId;
          for (const [a, b] of dashSegments(x1, x2, { style, dashOnFirst })) segs.push({ k, side: L.side, verse: L.verse, kind: 'dash', x1: a, x2: b, ref: L.r.link.id, up: style(SID.LYRICS_DASH_YPOS_RATIO) * xHeight });
        }
      }
    });
  }

  // placement vertical par système et par côté
  const minDist = style(SID.LYRICS_MIN_TOP_DISTANCE);
  const bottomPad = Math.max(0, style(SID.LYRICS_MIN_BOTTOM_DISTANCE) - style(SID.MIN_VERTICAL_DISTANCE)); // `addToSkyline` : marge supplémentaire sous les paroles
  perSystem.forEach((_, k) => {
    const pool = rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], ctx.glyphs).map((r) => ({ x1: r.x1, x2: r.x2, top: U(r.y2), bottom: U(r.y1) }));
    pool.push({ x1: -Infinity, x2: Infinity, top: -0.05, bottom: H + 0.05 });
    for (const side of ['below', 'above']) {
      const verses = new Map(); // couplet → { texts: [L], lines: [seg] }
      for (const [key, list] of groups) {
        if (!key.startsWith(`${side}|`)) continue;
        const mine = list.filter((L) => L.k === k);
        if (mine.length) verses.set(list[0].verse, { texts: mine, lines: [] });
      }
      for (const s of segs) {
        if (s.k !== k || s.side !== side) continue;
        if (!verses.has(s.verse)) verses.set(s.verse, { texts: [], lines: [] });
        verses.get(s.verse).lines.push(s);
      }
      if (!verses.size) continue;
      const order = [...verses.keys()].sort((a, b) => a - b);
      const maxVerse = order[order.length - 1];
      // ligne de base par défaut (y vers le bas depuis la ligne du haut), puis décalage cumulé des couplets extérieurs
      const baseOf = (v) => (side === 'below' ? H + v * lineSpacing : -(maxVerse - v) * lineSpacing);
      const shift = new Map();
      let cum = 0;
      const seqOrder = side === 'below' ? order : [...order].reverse();
      for (const v of seqOrder) {
        const { texts, lines: ln } = verses.get(v);
        const base = baseOf(v) + cum;
        let need = 0;
        const probe = (x1, x2, top, bottom) => {
          const over = pool.filter((r) => r.x2 > x1 && r.x1 < x2);
          if (!over.length) return;
          if (side === 'below') need = Math.max(need, Math.max(...over.map((r) => r.bottom)) + minDist - (base - top)); // top > 0 : au-dessus de la ligne de base
          else need = Math.max(need, (base - bottom) - (Math.min(...over.map((r) => r.top)) - minDist)); // bottom < 0
        };
        for (const L of texts) probe(L.x, L.x + L.box.width, L.box.top, L.box.bottom);
        for (const s of ln) probe(s.x1, s.x2, s.up + lineW / 2, s.up - lineW / 2);
        if (need > 0) cum += side === 'below' ? need : -need;
        shift.set(v, cum);
      }
      const lowest = side === 'below' ? Math.max(...order) : Math.min(...order);
      for (const v of order) {
        const { texts, lines: ln } = verses.get(v);
        const base = baseOf(v) + shift.get(v);
        for (const L of texts) {
          const pad = v === lowest ? bottomPad : 0;
          result[k].push({
            kind: 'text', role: 'lyric', text: L.text, x: L.x, y: U(base), size: L.box.size, anchor: 'start', ref: L.r.link.id,
            box: { x1: 0, x2: L.box.width, y1: L.box.bottom - (side === 'below' ? pad : 0), y2: L.box.top + (side === 'above' ? pad : 0) },
          });
        }
        for (const s of ln) {
          const y = U(base + (s.kind === 'melisma' ? -0.5 * lineW : -style(SID.LYRICS_DASH_YPOS_RATIO) * xHeight));
          result[k].push({ kind: 'line', role: 'lyric-line', x1: s.x1, y1: y, x2: s.x2, y2: y, width: lineW, cap: 'butt', ref: s.ref });
        }
      }
    }
  });
}
