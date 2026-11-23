/*
 * Plage (sélection de plage) — PURE, sans DOM, lecture seule du modèle. Étape 5, « sélection de plage », livraison 1.
 *
 * Une plage est un rectangle PORTÉES × TEMPS, comme `Selection` de MuseScore 4.7.5 (SelState::RANGE, lu : `select.cpp`,
 * `Score::selectRange`, `Selection::canCopy`, `checkStartForPartialCopy` / `checkEndForPartialCopy`) :
 *   { staffIds: [id…]  — portées CONSÉCUTIVES dans l'ordre à plat du Mouvement (pistes puis portées),
 *     from: { measureId, position }  — début INCLUS,
 *     to:   { measureId, position } }  — fin EXCLUE ; `position` = fraction exacte depuis le début du CONTENU de la mesure
 *                                         (même convention que `staffHit`) ; une fin au bord de mesure s'écrit
 *                                         `{ measureId: cette mesure, position: sa fin }`.
 * Ancrage par `measureId` (identité du masterbar), jamais par un numéro de mesure.
 *
 * DÉCISION de Jean (13/10/2026) — ÉCART avec MuseScore, qui REFUSE (`SOURCE_PARTIAL_TUPLET`, `SOURCE_PARTIAL_TREMOLO`) : une plage qui
 * coupe un n-olet ou un trémolo à deux notes est ÉTENDUE automatiquement au groupe entier (toutes voix des portées couvertes).
 * Les bornes s'accrochent aux instants des éléments (accord, silence) de la portée, toutes voix : un instant = un segment.
 */
import { fAdd, fCmp, fEq, fLt, fLe, fMax, fMin, ZERO } from './fraction.js';
import { measureLengthOf, itemDuration } from './timing.js';
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { contentStaff } from './linkedstaff.js';

/** Portées d'un Mouvement dans l'ordre à plat (pistes puis portées). */
export function flatStaves(movement) {
  const out = [];
  for (const track of movement.tracks) for (const staff of track.staves) out.push(staff);
  return out;
}

const indexOfMeasure = (movement, id) => movement.masterbars.findIndex((b) => b.id === id);

/** Éléments d'une voix dans une mesure, avec leurs bornes (fractions depuis le début du CONTENU). */
export function timed(movement, voice, mi) {
  const content = measureLengthOf(movement.masterbars[mi]);
  const measure = voice.measures?.[mi];
  let pos = ZERO;
  const out = [];
  for (const item of measure?.items ?? []) {
    if (item.type === 'lyricevent') { const at = getProperty(item, PID.POSITION) ?? ZERO; out.push({ item, start: at, end: at }); continue; } // a syllable has an instant, no duration
    const start = pos;
    pos = fAdd(pos, itemDuration(item, content));
    out.push({ item, start, end: pos });
  }
  return { out, content };
}

/** Longueur du CONTENU d'une mesure (= sa longueur réelle : l'anacrouse est plus courte que la mesure nominale). */
export function contentLength(movement, mi) {
  return measureLengthOf(movement.masterbars[mi]);
}

/** Instants (triés, uniques) d'une portée dans une mesure : débuts et fins de tous les éléments de toutes ses voix, 0 et la fin comprise. */
export function staffBoundaries(movement, staff, mi) {
  const content = contentLength(movement, mi);
  const set = [ZERO, content];
  for (const voice of staff.voices ?? []) {
    for (const t of timed(movement, voice, mi).out) { set.push(t.start, t.end); }
  }
  set.sort(fCmp);
  const out = [];
  for (const f of set) if (!out.length || !fEq(out[out.length - 1], f)) out.push(f);
  return out;
}

/** Compare deux points `{ index, position }`. */
const cmpPoint = (a, b) => (a.index !== b.index ? a.index - b.index : fCmp(a.position, b.position));

/** Union (instants) des bornes des portées couvertes, pour une mesure. */
export function rangeBoundaries(movement, staves, mi) {
  const set = [];
  for (const s of staves) set.push(...staffBoundaries(movement, s, mi));
  set.sort(fCmp);
  const out = [];
  for (const f of set) if (!out.length || !fEq(out[out.length - 1], f)) out.push(f);
  return out;
}

/** Point d'une plage → { index, position } (mesure inconnue : null). */
function toPoint(movement, p) {
  const index = indexOfMeasure(movement, p?.measureId);
  return index < 0 ? null : { index, position: p.position };
}
const fromPoint = (movement, pt) => ({ measureId: movement.masterbars[pt.index].id, position: pt.position });

/** Ramène un point sur l'instant le plus proche (égalité : le plus tôt) de l'union des bornes des portées couvertes. */
export function snapPoint(movement, staves, pt) {
  const index = Math.max(0, Math.min(movement.masterbars.length - 1, pt.index));
  const bounds = rangeBoundaries(movement, staves, index);
  let best = bounds[0], bestD = null;
  for (const b of bounds) {
    const d = Math.abs((b[0] / b[1]) - (pt.position[0] / pt.position[1]));
    if (bestD === null || d < bestD - 1e-12) { best = b; bestD = d; }
  }
  return { index, position: best };
}

/**
 * Étend [a, b[ jusqu'à couvrir tout n-olet (tuplet.id) et tout trémolo à deux notes (PID.TREMOLOS de la portée) dont un membre est
 * dans la plage, pour toutes les voix des portées couvertes ; répète jusqu'à stabilité (n-olets imbriqués, trémolo dans un n-olet).
 */
function expand(doc, movement, staves, a, b) {
  const chordPos = new Map(); // id d'élément → { index, start, end } pour les portées couvertes
  const tupletMembers = new Map(); // tuplet.id → [{ index, start, end }]
  for (const staff of staves) {
    for (const voice of staff.voices ?? []) {
      for (let mi = 0; mi < movement.masterbars.length; mi++) {
        for (const t of timed(movement, voice, mi).out) {
          const span = { index: mi, start: t.start, end: t.end };
          chordPos.set(t.item.id, span);
          const tup = t.item.type !== 'chord' && t.item.type !== 'rest' ? null : getProperty(t.item, PID.TUPLET);
          if (tup?.id) { if (!tupletMembers.has(tup.id)) tupletMembers.set(tup.id, []); tupletMembers.get(tup.id).push(span); }
        }
      }
    }
  }
  const groups = [...tupletMembers.values()];
  for (const staff of staves) {
    for (const t of doc.get(staff, PID.TREMOLOS) ?? []) {
      const s1 = chordPos.get(t.startChordId), s2 = chordPos.get(t.endChordId);
      if (s1 && s2) groups.push([s1, s2]);
    }
  }
  const asSpan = (g) => {
    let first = g[0], last = g[0];
    for (const s of g) {
      if (cmpPoint({ index: s.index, position: s.start }, { index: first.index, position: first.start }) < 0) first = s;
      if (cmpPoint({ index: s.index, position: s.end }, { index: last.index, position: last.end }) > 0) last = s;
    }
    return { from: { index: first.index, position: first.start }, to: { index: last.index, position: last.end } };
  };
  const spans = groups.map(asSpan);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of spans) {
      // chevauchement avec [a, b[ (bornes strictes : un groupe qui ne fait que toucher la plage n'en fait pas partie)
      if (cmpPoint(g.from, b) < 0 && cmpPoint(g.to, a) > 0) {
        if (cmpPoint(g.from, a) < 0) { a = g.from; changed = true; }
        if (cmpPoint(g.to, b) > 0) { b = g.to; changed = true; }
      }
    }
  }
  return { a, b };
}

/** Portées demandées → portées du Mouvement, consécutives dans l'ordre à plat (ids inconnus ignorés) ; null si aucune. */
function sliceOf(movement, staffIds) {
  const flat = flatStaves(movement);
  const idx = (staffIds ?? []).map((id) => flat.findIndex((s) => s.id === id)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const lo = Math.min(...idx), hi = Math.max(...idx);
  return flat.slice(lo, hi + 1);
}

/**
 * Portées demandées → portées qui PORTENT le contenu : une portée liée n'a aucun contenu, c'est sa portée principale qui compte
 * (une portée liée seule donne donc sa principale ; une portée et sa liée ne comptent qu'une fois).
 */
export function resolveStaves(movement, staffIds) {
  const slice = sliceOf(movement, staffIds);
  if (!slice) return null;
  const out = [];
  for (const s of slice) { const c = contentStaff(movement, s); if (!out.includes(c)) out.push(c); }
  return out;
}

/**
 * Normalise une plage : portées consécutives, bornes ordonnées, accrochées aux instants, étendues aux n-olets / trémolos entiers ;
 * une plage vide s'étend à l'élément suivant. Renvoie la plage canonique, ou null si elle n'est pas valable (mesure ou portée inconnue).
 */
export function normalizeRange(doc, movement, range) {
  if (!range) return null;
  const staves = resolveStaves(movement, range.staffIds);
  const shown = sliceOf(movement, range.staffIds); // the staves as chosen (a linked staff stays in the range: its band is drawn there)
  let a = toPoint(movement, range.from), b = toPoint(movement, range.to);
  if (!staves || !a || !b) return null;
  if (cmpPoint(a, b) > 0) [a, b] = [b, a];
  a = snapPoint(movement, staves, a);
  b = snapPoint(movement, staves, b);
  if (cmpPoint(a, b) === 0) {
    // plage vide : on prend l'intervalle jusqu'à l'instant suivant (ou précédent en fin de Mouvement)
    const bounds = rangeBoundaries(movement, staves, a.index);
    const next = bounds.find((f) => fLt(a.position, f));
    if (next) b = { index: a.index, position: next };
    else if (a.index + 1 < movement.masterbars.length) b = { index: a.index + 1, position: rangeBoundaries(movement, staves, a.index + 1)[1] ?? contentLength(movement, a.index + 1) };
    else { const prev = [...bounds].reverse().find((f) => fLt(f, a.position)); if (!prev) return null; b = a; a = { index: a.index, position: prev }; }
  }
  ({ a, b } = expand(doc, movement, staves, a, b));
  // une fin posée au début d'une mesure (position 0) s'écrit en fin de la mesure précédente (forme canonique)
  if (fEq(b.position, ZERO) && b.index > a.index) b = { index: b.index - 1, position: contentLength(movement, b.index - 1) };
  return { staffIds: shown.map((s) => s.id), from: fromPoint(movement, a), to: fromPoint(movement, b) };
}

/** Plage d'une ou plusieurs mesures entières (indices inclus) sur des portées. */
export function rangeFromMeasures(doc, movement, staffIds, firstIndex, lastIndex) {
  const lo = Math.max(0, Math.min(firstIndex, lastIndex)), hi = Math.min(movement.masterbars.length - 1, Math.max(firstIndex, lastIndex));
  if (hi < lo || !movement.masterbars.length) return null;
  return normalizeRange(doc, movement, {
    staffIds, from: { measureId: movement.masterbars[lo].id, position: ZERO },
    to: { measureId: movement.masterbars[hi].id, position: contentLength(movement, hi) },
  });
}

/** Plage d'un élément de mesure (accord, silence ; identifiant d'un accord ou d'une de ses notes) dans sa portée. Null si introuvable. */
export function rangeFromItem(doc, movement, itemId) {
  let target = doc.find(itemId);
  if (!target) return null;
  if (target.type !== 'chord' && target.type !== 'rest') { const p = doc.parentOf(itemId); if (p && (p.type === 'chord' || p.type === 'rest')) target = p; else return null; }
  for (const staff of flatStaves(movement)) {
    for (const voice of staff.voices ?? []) {
      for (let mi = 0; mi < movement.masterbars.length; mi++) {
        const t = timed(movement, voice, mi).out.find((x) => x.item.id === target.id);
        if (t) {
          return normalizeRange(doc, movement, { staffIds: [staff.id], from: { measureId: movement.masterbars[mi].id, position: t.start }, to: { measureId: movement.masterbars[mi].id, position: t.end } });
        }
      }
    }
  }
  return null;
}

/** Where an element of a measure (a chord, a rest, or one of the notes of a chord) is: { measure (index), position } in the first staff that holds it; null when it is not in the movement. No document needed. */
export function placeOfItem(movement, itemId) {
  for (const staff of flatStaves(movement)) {
    for (const voice of staff.voices ?? []) {
      for (let mi = 0; mi < movement.masterbars.length; mi++) {
        const t = timed(movement, voice, mi).out.find((x) => x.item.id === itemId || x.item.notes?.some((n) => n.id === itemId));
        if (t) return { measure: mi, position: t.start };
      }
    }
  }
  return null;
}

/** Plus petite plage qui contient `a` et `b` (portées réunies, bornes extrêmes) ; null si l'une est invalide. */
export function unionRanges(doc, movement, a, b) {
  const [pa, pb] = [a, b].map((r) => ({ from: toPoint(movement, r?.from), to: toPoint(movement, r?.to) }));
  if (!pa.from || !pb.from) return null;
  const from = cmpPoint(pa.from, pb.from) <= 0 ? a.from : b.from;
  const to = cmpPoint(pa.to, pb.to) >= 0 ? a.to : b.to;
  return normalizeRange(doc, movement, { staffIds: [...a.staffIds, ...b.staffIds], from, to });
}

/** Ajoute (delta = -1, portée au-dessus) ou (+1, portée en dessous) une portée à la plage, dans l'ordre à plat ; la plage reste inchangée si elle n'existe pas. */
export function extendRangeStaves(doc, movement, range, delta) {
  const flat = flatStaves(movement);
  const idx = range.staffIds.map((id) => flat.findIndex((s) => s.id === id)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const lo = Math.min(...idx), hi = Math.max(...idx);
  const next = delta < 0 ? lo - 1 : hi + 1;
  if (next < 0 || next >= flat.length) return range;
  return normalizeRange(doc, movement, { ...range, staffIds: [...range.staffIds, flat[next].id] });
}

/** Étend la plage à TOUTES les portées du Mouvement (toute la hauteur). */
export function extendRangeToAllStaves(doc, movement, range) {
  const flat = flatStaves(movement);
  if (!flat.length || !range) return null;
  return normalizeRange(doc, movement, { ...range, staffIds: flat.map((s) => s.id) });
}

/** Retire la portée du bas (delta = +1) ou du haut (delta = -1) de la plage ; au moins une portée reste. */
export function shrinkRangeStaves(doc, movement, range, delta) {
  const flat = flatStaves(movement);
  const ids = flat.filter((s) => range.staffIds.includes(s.id)).map((s) => s.id);
  if (ids.length <= 1) return range;
  return normalizeRange(doc, movement, { ...range, staffIds: delta > 0 ? ids.slice(0, -1) : ids.slice(1) });
}

/** Indices de mesure touchés { first, last } (inclus). */
export function rangeMeasureSpan(movement, range) {
  const a = indexOfMeasure(movement, range.from.measureId), b = indexOfMeasure(movement, range.to.measureId);
  if (a < 0 || b < 0) return null;
  return { first: a, last: b };
}

/** Vrai si la plage commence au début d'une mesure ET finit à la fin d'une mesure (retirer des MESURES a un sens). */
export function rangeIsWholeMeasures(movement, range) {
  const span = rangeMeasureSpan(movement, range);
  return !!span && fEq(range.from.position, ZERO) && fEq(range.to.position, contentLength(movement, span.last));
}

/** Éléments (accords, silences) de chaque voix des portées couvertes qui commencent dans la plage : [{ staff, voiceIndex, mi, item, start, end }]. */
export function rangeItems(movement, range) {
  const staves = resolveStaves(movement, range.staffIds) ?? [];
  const span = rangeMeasureSpan(movement, range);
  if (!span) return [];
  const out = [];
  for (const staff of staves) {
    (staff.voices ?? []).forEach((voice, voiceIndex) => {
      for (let mi = span.first; mi <= span.last; mi++) {
        for (const t of timed(movement, voice, mi).out) {
          const p = { index: mi, position: t.start };
          if (cmpPoint(p, { index: span.first, position: range.from.position }) < 0) continue;
          if (cmpPoint(p, { index: indexOfMeasure(movement, range.to.measureId), position: range.to.position }) >= 0) continue;
          out.push({ staff, voiceIndex, mi, item: t.item, start: t.start, end: t.end });
        }
      }
    });
  }
  return out;
}

/**
 * The chord symbols written in the range, on the chord staves it covers: [{ staff, mi, item, position }]. A chord staff has no timed elements of its own (a symbol sits at an
 * explicit position), so the symbols are looked up by position, inside the bounds of the first and last measure of the range.
 */
export function rangeChordSymbols(movement, range) {
  const span = rangeMeasureSpan(movement, range);
  if (!span) return [];
  const out = [];
  for (const staff of resolveStaves(movement, range.staffIds) ?? []) {
    if (staff.props?.staffType !== 'chord') continue;
    for (const voice of staff.voices ?? []) {
      for (let mi = span.first; mi <= span.last; mi++) {
        for (const item of voice.measures[mi]?.items ?? []) {
          if (item.type !== 'chordsymbol') continue;
          const position = item.props?.position ?? ZERO;
          if (cmpPoint({ index: mi, position }, { index: span.first, position: range.from.position }) < 0) continue;
          if (cmpPoint({ index: mi, position }, { index: span.last, position: range.to.position }) >= 0) continue;
          out.push({ staff, mi, item, position });
        }
      }
    }
  }
  return out;
}

export { fMax, fMin, fLe };
