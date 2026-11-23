/*
 * Affichage des textes de tempo et des lignes rit. / accel. (changements de tempo graduels) — port de MuseScore 4.7.5 :
 * `TLayout::layoutTempoText`, `TLayout::doLayoutGradualTempoChangeSegment` / `manageTempoChangeSnapping`, `TLayout::layoutTextLineBaseSegment`,
 * `SLine::linePos`, `GradualTempoChange`, `TempoText`, palette de tempo (`palettecreator.cpp`), styles `tempo*` / `tempoChange*` (styledef.cpp).
 *
 * Règles lues dans les sources :
 *  - texte de tempo : Edwin 12 pt GRAS, aligné à gauche sur la ligne de base ; position de style (0, −2 sp) = ligne de base 2 sp AU-DESSUS de la
 *    ligne du haut, puis `autoplaceSegmentElement` (repoussé vers le haut à `tempoMinDistance` = 0,5 sp de tout ce qui le recouvre) ;
 *    sur le 1er instant d'une mesure qui porte un chiffrage, le texte se cale sur le chiffrage (`layoutTempoText`) ;
 *  - les symboles de métronome (`<sym>metNoteQuarterUp</sym>`, point `metAugmentationDot`) sont des glyphes à 20 pt (`tempoMusicalSymbolSize`
 *    = échelle 1) ; les textes de la palette : « ♩ = bpm » (valeur exacte du tempo), « a tempo », « tempo primo » ;
 *  - changement graduel : texte de début (« rit. ») puis ligne POINTILLÉE de 0,15 sp (`tempoChangeLineStyle` DASHED) qui démarre à 0,5 sp du texte
 *    (`gapBetweenTextAndLine`), à la ligne de base + ½ épaisseur (`alignBaseLine`) ; un trait qui irait à l'envers (texte plus long que la ligne)
 *    n'est pas dessiné ; sans texte ni crochet : simple trait à la ligne de base ;
 *  - retour à la ligne : un segment par système ; les segments suivants portent le texte de continuation « (rit.) » (palette) ; départ de segment
 *    = x du début (1re colonne du système si le segment continue), fin = x de l'instant d'arrivée − 1 sp (`SLine::linePos`), ou dernière barre − 0,25 sp
 *    quand la ligne continue sur le système suivant ;
 *  - accrochage (`snapToItemAfter`, vrai par défaut) : si un texte de tempo ou le début d'un autre changement graduel tombe à l'instant d'arrivée,
 *    la ligne s'étend jusqu'à son bord gauche − 1 sp × (corps / 10) (= 1,2 sp pour 12 pt).
 * Écarts / limites (NON vérifié sur export) : un instant qui n'a pas de colonne est placé par interpolation du temps entre les colonnes voisines
 * (MuseScore crée un segment) ; largeur du texte approchée (Edwin absente : espace 0,25, point 0,28, autres 0,55 × corps, gras) ; boîtes d'éléments
 * au lieu d'une skyline continue ; ordre de placement (textes de tempo et lignes d'abord par x, après les sauts / marqueurs) non vérifié ; dessiné sur la
 * portée du haut du système ; pas de repère de répétition (`rehearsal mark`) ; pas de texte de fin / crochet / flèche (rien de tel par défaut).
 * Repère : portée du haut, y vers le HAUT, 0 = ligne du bas.
 */
import { PID, getProperty, fCmp } from '../model/index.js';
import { GRADUAL_TYPES, beatUnitText } from '../model/tempo.js';
import { rectsOf } from './bounds.js';
import { distributedDash } from './techlines.js';

const PT = (1.75 * 72) / 25.4; // points par espace
const TEXT_SIZE = 12 / PT; // tempoFontSize / tempoChangeFontSize
const SYMBOL_MAG = 1; // tempoMusicalSymbolSize 20 pt = glyphe SMuFL à l'échelle 1
const POS_ABOVE = 2; // tempoPosAbove (0, −2) : ligne de base à 2 sp au-dessus de la ligne du haut
const MIN_DISTANCE = 0.5; // tempoMinDistance
const LINE_WIDTH = 0.15; // tempoChangeLineWidth
const TEXT_GAP = 0.5; // gapBetweenTextAndLine
const END_GAP = 1; // SLine::linePos : fin = x du segment d'arrivée − spatium
const BAR_GAP = 0.25; // fin d'un segment qui continue : dernière barre − 0,25 sp
const SNAP_PADDING = 12 / 10; // spatium × corps / 10 (corps 12 pt)
const TEXT_ASCENT = 0.9; // boîte approchée d'un texte, comme jumps.js
const TEXT_DESCENT = 0.3;
const FERMATA_POS_ABOVE = 0.5; // fermataPosAbove (0, −0,5)
const FERMATA_MIN_DISTANCE = 0.4; // fermataMinDistance
const HEAD_HALF = 0.59; // centre d'une tête (centerX d'un accord), tête Bravura brute
const STAFF_TOP_HALF = 0.05;

/** Caractères de métronome de la police de texte de MuseScore (zone privée SMuFL) → glyphe Bravura. */
const PUA = {
  '': 'metNoteDoubleWhole', '': 'metNoteWhole', '': 'metNoteHalfUp', '': 'metNoteQuarterUp', '': 'metNote8thUp',
  '': 'metNote16thUp', '': 'metNote32ndUp', '': 'metNote64thUp', '': 'metAugmentationDot',
};
const SPACE_W = 0.25 * TEXT_SIZE;
const charWidth = (c) => (c === ' ' ? SPACE_W : c === '.' || c === ',' ? 0.28 * TEXT_SIZE : 0.55 * TEXT_SIZE);

/** Découpe un texte en parties `{ text }` | `{ glyph }` (caractères de métronome et balises `<sym>nom</sym>`). */
export function tempoTextParts(text) {
  const parts = [];
  const push = (t) => { if (!t) return; const last = parts[parts.length - 1]; if (last && last.text !== undefined) last.text += t; else parts.push({ text: t }); };
  const re = /<sym>([A-Za-z0-9]+)<\/sym>/g;
  let rest = text.replace(re, (_, name) => (name === 'space' ? ' ' : `\u0000${name}\u0000`));
  for (const chunk of rest.split('\u0000')) {
    if (/^(met[A-Za-z0-9]+)$/.test(chunk)) { parts.push({ glyph: chunk }); continue; }
    for (const c of chunk) { if (PUA[c]) parts.push({ glyph: PUA[c] }); else push(c); }
  }
  return parts;
}

/** Texte affiché d'un tempo : texte propre, sinon celui de la palette de MuseScore selon le genre. */
export function tempoDisplayText(tempo) {
  const own = getProperty(tempo, PID.TEXT);
  if (typeof own === 'string' && own.length) return own;
  switch (getProperty(tempo, PID.TEMPO_KIND) ?? 'normal') {
    case 'aTempo': return 'a tempo';
    case 'tempoPrimo': return 'tempo primo';
    case 'normal': {
      const bpm = getProperty(tempo, PID.TEMPO_BPM);
      const unit = getProperty(tempo, PID.BEAT_UNIT) ?? { base: 'quarter', dots: 0 };
      const note = beatUnitText(unit);
      if (!note || typeof bpm !== 'number') return '';
      return `${note} = ${Number.isInteger(bpm) ? bpm : Number(bpm.toFixed(2))}`;
    }
    default: return ''; // relatif sans texte : rien à montrer
  }
}

/** Texte d'un changement graduel (début) : texte propre, sinon l'abréviation du type (palette). */
export function gradualDisplayText(change) {
  const own = getProperty(change, PID.TEXT);
  if (typeof own === 'string') return own;
  return GRADUAL_TYPES[getProperty(change, PID.CHANGE_TYPE)]?.text ?? '';
}

/** Mesure un texte : largeur et boîte verticale (relatives à la ligne de base). */
function measure(parts, glyphs) {
  let w = 0, top = -Infinity, bottom = Infinity;
  const placed = [];
  for (const p of parts) {
    if (p.glyph) {
      const g = glyphs.glyphs[p.glyph];
      if (!g) continue;
      placed.push({ glyph: p.glyph, dx: w });
      w += g.advance * SYMBOL_MAG;
      top = Math.max(top, g.bbox.bBoxNE[1] * SYMBOL_MAG); bottom = Math.min(bottom, g.bbox.bBoxSW[1] * SYMBOL_MAG);
    } else {
      const lead = p.text.length - p.text.trimStart().length;
      const trimmed = p.text.trim();
      const full = [...p.text].reduce((a, c) => a + charWidth(c), 0);
      if (trimmed) { placed.push({ text: trimmed, dx: w + lead * SPACE_W }); top = Math.max(top, TEXT_ASCENT * TEXT_SIZE); bottom = Math.min(bottom, -TEXT_DESCENT * TEXT_SIZE); }
      w += full;
    }
  }
  if (top === -Infinity) { top = 0; bottom = 0; }
  return { width: w, top, bottom, placed };
}

/** The cues of the automatic players are written a third smaller than a tempo text (a note, not a heading): 1 / 1.5. */
const CUE_SCALE = 1 / 1.5;
const scaled = (m, s) => (s === 1 ? m : { width: m.width * s, top: m.top * s, bottom: m.bottom * s, placed: m.placed.map((p) => ({ ...p, dx: p.dx * s })) });

const labelItems = (m, x, ref, role, scale = 1) => m.placed.map((p) => (p.glyph
  ? { kind: 'glyph', name: p.glyph, x: x + p.dx, y: 0, mag: SYMBOL_MAG * scale, role, ref }
  : { kind: 'text', text: p.text, x: x + p.dx, y: 0, size: TEXT_SIZE * scale, bold: true, anchor: 'start', role: `${role}-text`, ref }));

/**
 * @param movement  Mouvement
 * @param sys       système { first, measures: [{ mi, start, barX }] }
 * @param opts      { xAt(mi, position) → x, firstColumnX(mi) → x, timeSigX(mi) → x | null, topLineY, existing, glyphs }
 * @returns éléments d'affichage (glyph | text | line)
 */
export function tempoDisplayItems(movement, sys, opts) {
  const { xAt, firstColumnX, timeSigX, topLineY, existing, glyphs, showCues = true, showTempoText = true, skipStart = false, startOnly = false } = opts;
  // `skipStart`: leave out the tempo of the very beginning (it is drawn later, above everything); `startOnly`: draw nothing but that tempo
  const isStart = (a) => a.mi === 0 && a.pos[0] === 0;
  const ids = movement.masterbars.map((b) => b.id);
  const mis = sys.measures.map((m) => m.mi);
  const firstMi = mis[0], lastMi = mis[mis.length - 1];
  const barOf = new Map(sys.measures.map((m) => [m.mi, m]));
  const anchor = (el, idKey, posKey) => ({ mi: ids.indexOf(getProperty(el, idKey)), pos: getProperty(el, posKey) ?? [0, 1] });

  // 1. textes de tempo de ce système
  const texts = [];
  for (const t of showTempoText ? movement.tempos : []) {
    const a = anchor(t, PID.MEASURE_ID, PID.POSITION);
    if (!barOf.has(a.mi)) continue;
    if ((skipStart && isStart(a)) || (startOnly && !isStart(a))) continue;
    const parts = tempoTextParts(tempoDisplayText(t));
    if (!parts.length) continue;
    const m = measure(parts, glyphs);
    // 1er instant d'une mesure qui porte un chiffrage : calé sur le chiffrage (`layoutTempoText`)
    let x = xAt(a.mi, a.pos);
    if (a.pos[0] === 0) { const tx = timeSigX(a.mi); if (tx !== null) x = tx; }
    texts.push({ kind: 'text', id: t.id, mi: a.mi, pos: a.pos, x, m, parts });
  }

  // 2. changements graduels : segments de ce système
  const segs = [];
  for (const c of startOnly ? [] : movement.tempoChanges) {
    const s = anchor(c, PID.MEASURE_ID, PID.POSITION), e = anchor(c, PID.END_MEASURE_ID, PID.END_POSITION);
    if (s.mi < 0 || e.mi < 0 || s.mi > lastMi || e.mi < firstMi) continue;
    if (s.mi > e.mi || (s.mi === e.mi && fCmp(s.pos, e.pos) > 0)) continue;
    const isFirst = s.mi >= firstMi, isLast = e.mi <= lastMi;
    const begin = gradualDisplayText(c);
    const label = isFirst ? begin : begin ? `(${begin})` : '';
    const m = measure(tempoTextParts(label), glyphs);
    const x1 = isFirst ? xAt(s.mi, s.pos) : firstColumnX(firstMi);
    segs.push({ kind: 'line', id: c.id, change: c, s, e, isFirst, isLast, label, m, x1, x2: 0 });
  }
  for (const sg of segs) {
    if (!sg.isLast) { sg.x2 = barOf.get(lastMi).barX - BAR_GAP; continue; }
    sg.x2 = xAt(sg.e.mi, sg.e.pos) - END_GAP;
    // accrochage : texte de tempo ou autre changement graduel qui commence à l'instant d'arrivée
    const same = (a, b) => a.mi === b.mi && fCmp(a.pos, b.pos) === 0;
    const t = texts.find((tx) => same({ mi: tx.mi, pos: tx.pos }, sg.e));
    const other = segs.find((o) => o !== sg && o.isFirst && same(o.s, sg.e));
    if (t) sg.x2 = t.x - SNAP_PADDING;
    else if (other) sg.x2 = other.x1 - (other.m.placed.length ? SNAP_PADDING : 1);
  }

  // 2b. swing / straight : texte système (style TEMPO, `layoutSystemText`), sans calage sur le chiffrage ; seuls les signes généraux (pas la
  // surcharge d'une portée) sont dessinés, sur la portée du haut
  for (const w of startOnly ? [] : movement.swings ?? []) {
    if (getProperty(w, PID.TARGET_STAFF_ID)) continue;
    const a = anchor(w, PID.MEASURE_ID, PID.POSITION);
    if (!barOf.has(a.mi)) continue;
    const text = getProperty(w, PID.TEXT);
    const parts = typeof text === 'string' && text.length ? tempoTextParts(text) : [];
    if (!parts.length) continue;
    texts.push({ kind: 'text', id: w.id, mi: a.mi, pos: a.pos, x: xAt(a.mi, a.pos), m: measure(parts, glyphs), parts, role: 'swing' });
  }

  // 2c. cues of the automatic players (model/cueedit.js): their text, in the row of the tempo and the swing, on the top staff
  for (const c of showCues && !startOnly ? movement.cues ?? [] : []) {
    const mi = ids.indexOf(getProperty(c, PID.MEASURE_ID)); // a cue is anchored on a measure, at its start
    if (!barOf.has(mi)) continue;
    const text = getProperty(c, PID.TEXT);
    const parts = typeof text === 'string' && text.length ? tempoTextParts(text) : [];
    if (!parts.length) continue;
    texts.push({ kind: 'text', id: c.id, mi, pos: [0, 1], x: xAt(mi, [0, 1]), m: scaled(measure(parts, glyphs), CUE_SCALE), parts, role: 'cue', scale: CUE_SCALE });
  }

  // 3. placement : de gauche à droite, chacun repoussé au-dessus de tout ce qui le recouvre (autoplace)
  const pool = rectsOf(existing, glyphs);
  pool.push({ x1: -Infinity, x2: Infinity, y1: topLineY - 1, y2: topLineY + STAFF_TOP_HALF }); // la portée elle-même
  const out = [];
  // points d'orgue de structure (`layoutFermata`) : glyphe « Above » centré sur la tête, au repos 0,5 sp au-dessus de la ligne du haut
  // (`fermataPosAbove`), repoussé à `fermataMinDistance` (0,4 sp) de tout ce qui le recouvre ; posés avant les textes
  for (const f of startOnly ? [] : movement.fermatas ?? []) {
    const a = anchor(f, PID.MEASURE_ID, PID.POSITION);
    if (!barOf.has(a.mi)) continue;
    const type = getProperty(f, PID.FERMATA_TYPE) ?? 'fermata';
    const name = `${type}Above`;
    const g = glyphs.glyphs[name];
    if (!g) continue;
    const w = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
    const x = xAt(a.mi, a.pos) + HEAD_HALF - w / 2 - g.bbox.bBoxSW[0];
    const box = { x1: x + g.bbox.bBoxSW[0], x2: x + g.bbox.bBoxNE[0] };
    let y = topLineY + FERMATA_POS_ABOVE;
    for (const r of pool) if (r.x2 > box.x1 && r.x1 < box.x2) y = Math.max(y, r.y2 + FERMATA_MIN_DISTANCE - g.bbox.bBoxSW[1]);
    out.push({ kind: 'glyph', name, x, y, mag: 1, role: 'fermata', ref: f.id });
    pool.push({ ...box, y1: y + g.bbox.bBoxSW[1], y2: y + g.bbox.bBoxNE[1] });
  }
  const emit = (box, items, hasLine) => {
    let base = topLineY + POS_ABOVE;
    for (const r of pool) if (r.x2 > box.x1 && r.x1 < box.x2) base = Math.max(base, r.y2 + MIN_DISTANCE - box.bottom);
    for (const it of items) {
      if (it.kind === 'line') out.push({ ...it, y1: base + it.dy, y2: base + it.dy });
      else out.push({ ...it, y: base });
    }
    pool.push({ x1: box.x1, x2: box.x2, y1: base + box.bottom, y2: base + box.top });
    void hasLine;
  };

  const all = [...texts.map((t) => ({ ...t, order: t.x })), ...segs.map((s) => ({ ...s, order: s.x1 }))].sort((a, b) => a.order - b.order);
  for (const it of all) {
    if (it.kind === 'text') {
      emit({ x1: it.x, x2: it.x + it.m.width, top: it.m.top, bottom: it.m.bottom }, labelItems(it.m, it.x, it.id, it.role ?? 'tempo', it.scale ?? 1), false);
      continue;
    }
    const hasText = it.m.placed.length > 0;
    const items = hasText ? labelItems(it.m, it.x1, it.id, 'tempo-change') : [];
    let top = hasText ? it.m.top : 0, bottom = hasText ? it.m.bottom : 0;
    const lx1 = it.x1 + (hasText ? it.m.width + TEXT_GAP : 0), lx2 = it.x2;
    if (!(hasText && lx1 > lx2) && lx2 > lx1) { // pas de ligne « à l'envers »
      const dy = hasText ? LINE_WIDTH / 2 : 0; // `alignBaseLine` : ligne de base du texte + ½ épaisseur
      const dash = distributedDash(lx2 - lx1, LINE_WIDTH);
      items.push({ kind: 'line', role: 'tempo-change-line', x1: lx1, x2: lx2, dy, width: LINE_WIDTH, cap: 'butt', ...(dash ? { dash } : {}), ref: it.id });
      top = Math.max(top, dy + LINE_WIDTH / 2); bottom = Math.min(bottom, dy - LINE_WIDTH / 2);
    }
    if (!items.length) continue;
    emit({ x1: it.x1, x2: Math.max(it.x1 + it.m.width, it.x2), top, bottom }, items, true);
  }
  return out;
}
