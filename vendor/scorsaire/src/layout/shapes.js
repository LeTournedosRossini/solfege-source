/*
 * Formes de segment pour l'espacement par formes (`hspacing.js`) : conversion des éléments d'affichage d'un accord / silence
 * (ce que dessine déjà le peintre, origine de l'élément = x 0) en rectangles TYPÉS (types de `padding.js`), comme `Segment::createShape` /
 * `Chord::shape` de MuseScore. Repère : x vers la droite, y vers le HAUT (repère de portée) — seule la cohérence entre éléments compte.
 */
import { fToNumber } from '../model/fraction.js';

const GRACE_TYPE = {
  note: 'NOTE', accidental: 'ACCIDENTAL', ledger: 'LEDGER_LINE', hook: 'HOOK', stem: 'STEM', rest: 'REST', slash: 'STEM_SLASH', barline: 'BAR_LINE',
};

/** Rectangle {type, l, r, t, b, …} pour un élément d'affichage, ou null (élément qui n'entre pas dans la forme du segment). */
function rectOf(it, glyphs) {
  // forme sans dessin (un symbole d'accord en mode rendu ne réserve qu'une forme fantôme) et texte à boîte connue (symboles d'accord)
  if (it.kind === 'shape') return { type: it.type, l: it.l, r: it.r, t: it.t, b: it.b };
  if (it.kind === 'text' && it.role === 'harmony' && it.box) return { type: 'HARMONY', l: it.x + it.box.x1, r: it.x + it.box.x2, t: it.y + it.box.y1, b: it.y + it.box.y2 };
  if (it.kind === 'glyph') {
    const b = glyphs.glyphs[it.name]?.bbox;
    if (!b) return null;
    const m = it.mag ?? 1;
    let type = null;
    const extra = {};
    switch (it.role) {
      case 'accidental': type = 'ACCIDENTAL'; break;
      case 'flag': type = 'HOOK'; break;
      case 'dot': type = 'NOTEDOT'; break;
      case 'arpeggio': type = 'ARPEGGIO'; break;
      case 'chord-line': type = 'CHORDLINE'; break;
      case 'tremolo': type = 'TREMOLO_SINGLECHORD'; break;
      case 'clef-change': type = 'CLEF'; extra.midClef = true; break;
      case 'harmony': type = 'HARMONY'; break;
      case 'articulation': type = 'ARTICULATION'; extra.articulationUp = /Above$/.test(it.name); break;
      case undefined: case null:
        if (it.name.startsWith('notehead')) type = 'NOTE';
        else if (it.name.startsWith('tabFret')) { type = 'NOTE'; extra.fret = true; }
        else if (it.name.startsWith('rest')) { type = 'REST'; if (/LegerLine$/.test(it.name)) extra.ledgerRestLeft = b.bBoxSW[0] * m; }
        break;
      default: break;
    }
    if (!type) return null;
    const x1 = it.x + b.bBoxSW[0] * m, x2 = it.x + b.bBoxNE[0] * m;
    return { type, l: x1, r: x2, t: it.y + b.bBoxSW[1] * m, b: it.y + b.bBoxNE[1] * m, ref: it.ref, ...extra };
  }
  if (it.kind === 'line') {
    const h = (it.width ?? 0) / 2;
    const x1 = Math.min(it.x1, it.x2), x2 = Math.max(it.x1, it.x2), y1 = Math.min(it.y1, it.y2), y2 = Math.max(it.y1, it.y2);
    switch (it.role) {
      case 'stem': return { type: 'STEM', l: x1 - h, r: x2 + h, t: y1, b: y2 };
      case 'ledger': return { type: 'LEDGER_LINE', l: x1, r: x2, t: y1 - h, b: y2 + h };
      case 'arpeggio': return { type: 'ARPEGGIO', l: x1 - h, r: x2 + h, t: y1 - h, b: y2 + h };
      case 'chord-line': return { type: 'CHORDLINE', l: x1, r: x2, t: y1, b: y2 };
      default: return null;
    }
  }
  if (it.kind === 'bezier' && it.role === 'chord-line') {
    const xs = [it.x1, it.c1x, it.c2x, it.x2], ys = [it.y1, it.c1y, it.c2y, it.y2];
    return { type: 'CHORDLINE', l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  }
  if (it.kind === 'curve' && it.role === 'parenthesis') {
    const xs = [it.x1, it.topC1x, it.topC2x, it.botC1x, it.botC2x], ys = [it.y1, it.y2];
    return { type: 'PARENTHESIS', l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  }
  return null;
}

/** Formes typées d'un ensemble d'éléments d'affichage : [{type, l, r, t, b, voice, staff, mag, …}] (voir `hspacing.js`). */
export function shapeFromItems(items, glyphs, meta) {
  const out = [];
  for (const it of items) {
    const r = rectOf(it, glyphs);
    if (!r || !Number.isFinite(r.l + r.r + r.t + r.b)) continue;
    out.push({ voice: meta.voice, staff: meta.staff, mag: 1, ...r });
  }
  return out;
}

/** Boîtes typées d'un groupe d'ornements (`gracenotes.js: typedBoxes`, minuscules) → formes de ce module, décalées de `dx`. */
export function graceShape(boxes, meta, dx = 0) {
  return boxes.map((bx) => ({
    type: GRACE_TYPE[bx.type] ?? 'NOTE', l: bx.left + dx, r: bx.right + dx, t: bx.bottom, b: bx.top,
    voice: bx.voice ?? meta.voice, staff: meta.staff, mag: bx.mag ?? 1, grace: Boolean(bx.grace), beamId: bx.beamId ?? null,
  }));
}

/**
 * Forme d'une entrée (accord / silence) d'un peintre : ce que dessine `paintEntry` à x = 0, plus les ornements « avant ». Repli : rectangle
 * unique couvrant la place que le peintre réserve (`lead`, `itemWidth`) — pour les peintres dont les éléments ne sont pas encore typés.
 */
export function entryShape(entry, painter, pctx, { staff, naturalSpace }) {
  const meta = { voice: entry.voice ?? 0, staff };
  const glyphs = pctx.glyphs;
  let shape = [];
  try {
    // `spacingItems` : ce que le peintre veut montrer à l'espacement (symboles d'accord : forme fantôme en mode rendu) ; sinon ce qu'il dessine
    const items = painter.spacingItems ? painter.spacingItems(entry, pctx) : painter.paintEntry ? painter.paintEntry(entry, 0, pctx) : [];
    shape = shapeFromItems(items, glyphs, meta);
  } catch (err) {
    shape = [];
  }
  const start = entry.position ? fToNumber(entry.position) : 0;
  const end = entry.duration ? start + fToNumber(entry.duration) : start;
  const kern = { above: true, below: true };
  for (const it of entry.articItems ?? []) {
    if (it.role !== 'articulation') continue;
    if (/Above$/.test(it.name ?? '')) kern.above = false; else if (/Below$/.test(it.name ?? '')) kern.below = false;
  }
  for (const r of shape) {
    r.rtick = start;
    if (r.type === 'NOTE' || r.type === 'REST') { r.endTick = end; r.cy = (r.t + r.b) / 2; r.up = entry.stemUp; r.kernAbove = kern.above; r.kernBelow = kern.below; r.width = r.r - r.l; }
    if (r.type === 'REST' && entry.item?.type === 'rest' && entry.fullMeasure) r.fullRest = true;
  }
  // points d'accroche de lignes (glissandos…) : `entry.lineAttach` = Map(id de note → [{ line, x (relatif à l'origine de l'accord), kind }])
  if (entry.lineAttach) {
    for (const r of shape) {
      if (r.type !== 'NOTE' || !r.ref || !entry.lineAttach.has(r.ref)) continue;
      r.attach = entry.lineAttach.get(r.ref).map((a) => ({ line: a.line, kind: a.kind, x: a.x - r.l }));
    }
  }
  // paroles : une forme LYRICS par syllabe (le tiret ou le trait qui suit est réservé par `computePadding`)
  for (const b of entry.lyricBoxes ?? []) shape.push({ type: 'LYRICS', l: b.l, r: b.r, t: b.t, b: b.b, voice: meta.voice, staff, mag: 1, rtick: start, lyric: { syllabic: b.syllabic, melisma: b.melisma } });
  // réserve à gauche propre au peintre (tablature : `lll` d'un glissando d'arrivée), en forme fantôme
  const reserve = painter.leftReserve ? painter.leftReserve(entry, pctx) : 0;
  if (reserve > 0) shape.push({ type: 'NOTE', l: -reserve, r: -reserve + 0.01, t: -1, b: 5, voice: meta.voice, staff, mag: 1, rtick: start, phantom: true });
  if (entry.graceLayout?.boxes) shape.push(...graceShape(entry.graceLayout.boxes, meta));
  if (!entry.annotation && !shape.some((r) => r.type === 'NOTE' || r.type === 'REST')) {
    // repli : forme réduite à ce que demande le peintre
    const lead = painter.lead ? painter.lead(entry, pctx) : 0;
    const w = painter.itemWidth ? painter.itemWidth(entry, pctx) : lead + naturalSpace;
    shape.push({ type: 'NOTE', l: -lead, r: Math.max(1.18, w - lead - naturalSpace + 1.18), t: -1, b: 5, voice: meta.voice, staff, mag: 1, rtick: start, endTick: end, cy: 2, width: 1.18 });
  }
  return shape;
}
