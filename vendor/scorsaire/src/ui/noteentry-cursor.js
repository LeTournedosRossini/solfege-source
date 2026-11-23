/*
 * Curseur de saisie de notes : position, avance et déplacements. PUR : aucun DOM, aucune écriture dans le Document.
 *
 * Port du comportement de MuseScore 4.7.5 (lus : `dom/input.cpp` `InputState::nextInputPos` / `moveToNextInputPos` / `moveInputPos`,
 * `editing/cmd.cpp` `Score::move` (« next-chord », « prev-chord », « next-measure », « prev-measure »),
 * `dom/navigate.cpp` `nextMeasure` / `prevMeasure`) :
 *  - le curseur est un instant d'UNE voix d'UNE portée : { staffId, measureIndex, position, voice } ; `position` = fraction exacte depuis le
 *    début du CONTENU de la mesure (même convention que `ScoreView.staffHit` et `placeChord`) ;
 *  - position suivante (`nextInputPos`) : dans la même mesure, le prochain élément de la voix ; sinon le début de la mesure suivante (même si
 *    la voix n'y a rien) ; en fin de partition le curseur ne bouge pas ;
 *  - position précédente (flèche gauche) : l'élément précédent de la voix (silences « trou » sautés), sinon, dans une mesure plus tôt, son
 *    dernier élément ou, à défaut, son début ;
 *  - flèches gauche / droite : le curseur ET la sélection avancent (la sélection suit l'élément voisin de celui qui est sélectionné ; elle ne
 *    saute jamais une mesure et ne dépasse pas le curseur) ;
 *  - Ctrl + flèche : mesure suivante (début de la mesure suivante ; dans la dernière mesure : fin = son dernier élément) / mesure précédente
 *    (début de la mesure, ou de la précédente si le curseur y est déjà).
 */
import { PID, getProperty, fAdd, fSub, fCmp, fEq, ZERO, measureLengthOf, measureOffsetOf, itemDuration, contentStaff } from '../model/index.js';

const isGap = (item) => item?.type === 'rest' && getProperty(item, PID.GAP) === true;
const isCr = (item) => item?.type === 'chord' || item?.type === 'rest';

/** Éléments d'une voix dans une mesure : [{ item, start, end }], positions depuis le début du CONTENU de la mesure. */
export function voiceSlots(doc, staffId, voice, mi) {
  const found = doc.find(staffId);
  const movement = found && doc.movementOf(found);
  const staff = found && contentStaff(movement, found); // a linked staff shows the content of its primary staff
  const mb = movement?.masterbars[mi];
  const measure = staff?.voices?.[voice]?.measures?.[mi];
  if (!mb || !measure) return [];
  const length = measureLengthOf(mb);
  let pos = ZERO;
  return measure.items.map((item) => { const start = pos; pos = fAdd(pos, itemDuration(item, length)); return { item, start, end: pos }; });
}

const measureCount = (doc, staffId) => doc.movementOf(doc.find(staffId)).masterbars.length;

/** Élément de la voix du curseur qui COMMENCE à la position du curseur, ou null. */
export function itemAtCursor(doc, c) {
  return voiceSlots(doc, c.staffId, c.voice, c.measureIndex).find((s) => fEq(s.start, c.position))?.item ?? null;
}

/** Curseur placé sur un accord, une note ou un silence (identifiant) ; null si l'élément n'est pas dans une portée. */
export function cursorOfElement(doc, id) {
  let item = doc.find(id);
  if (item?.type === 'note' || item?.type === 'tabnote' || item?.type === 'percnote' || item?.type === 'accnote' || item?.type === 'rhythmnote') item = doc.parentOf(item.id);
  if (!isCr(item)) return null;
  const measure = doc.parentOf(item.id);
  const voiceEl = measure && doc.parentOf(measure.id);
  const staff = voiceEl && doc.parentOf(voiceEl.id);
  if (!staff || staff.type !== 'staff') return null;
  const voice = staff.voices.indexOf(voiceEl);
  const mi = voiceEl.measures.indexOf(measure);
  if (voice < 0 || mi < 0) return null;
  const slot = voiceSlots(doc, staff.id, voice, mi).find((s) => s.item === item);
  return slot ? { staffId: staff.id, measureIndex: mi, position: slot.start, voice } : null;
}

/**
 * Where an element sits for the gestures that attach something to an instant (system objects, containers): like `cursorOfElement`, plus a chord symbol
 * (which is not a chord or a rest: its place is its own `position` in the measure of its voice).
 */
export function anchorOfElement(doc, id) {
  const c = cursorOfElement(doc, id);
  if (c) return c;
  const item = doc.find(id);
  if (item?.type !== 'chordsymbol') return null;
  const measure = doc.parentOf(item.id);
  const voiceEl = measure && doc.parentOf(measure.id);
  const staff = voiceEl && doc.parentOf(voiceEl.id);
  if (!staff || staff.type !== 'staff') return null;
  const mi = voiceEl.measures.indexOf(measure);
  return mi < 0 ? null : { staffId: staff.id, measureIndex: mi, position: getProperty(item, PID.POSITION) ?? ZERO, voice: staff.voices.indexOf(voiceEl) };
}

/** Début d'une portée : première mesure, position 0, voix 1. */
export const startOfStaff = (staffId, voice = 0) => ({ staffId, measureIndex: 0, position: ZERO, voice });

/**
 * Remet un curseur dans un état valable après un changement du Document (annuler, refaire…) : portée et mesure existantes, position = un
 * début d'élément de la voix (ou le début de mesure, ou — voix 2 à 4 — la fin d'un élément) ; sinon le début d'élément le plus proche à gauche.
 */
export function normalizeCursor(doc, c) {
  if (!c) return null;
  const staff = doc.find(c.staffId);
  if (!staff || staff.type !== 'staff') return null;
  const n = measureCount(doc, c.staffId);
  const mi = Math.min(Math.max(c.measureIndex, 0), n - 1);
  const voice = Math.min(Math.max(c.voice ?? 0, 0), 3);
  const slots = voiceSlots(doc, c.staffId, voice, mi);
  const out = { staffId: c.staffId, measureIndex: mi, voice };
  if (mi !== c.measureIndex) return { ...out, position: ZERO };
  if (fEq(c.position, ZERO) || slots.some((s) => fEq(s.start, c.position) || (voice > 0 && fEq(s.end, c.position)))) return { ...out, position: c.position };
  const before = slots.filter((s) => fCmp(s.start, c.position) <= 0).pop();
  return { ...out, position: before ? before.start : ZERO };
}

/** `InputState::nextInputPos` : { cursor, moved }. En fin de partition : le même curseur, `moved` faux. */
export function nextInputPos(doc, c) {
  const slots = voiceSlots(doc, c.staffId, c.voice, c.measureIndex);
  const next = slots.find((s) => fCmp(s.start, c.position) > 0);
  if (next) return { cursor: { ...c, position: next.start }, moved: true };
  if (c.measureIndex + 1 < measureCount(doc, c.staffId)) return { cursor: { ...c, measureIndex: c.measureIndex + 1, position: ZERO }, moved: true };
  return { cursor: c, moved: false };
}

/** Flèche gauche (« prev-chord ») : les silences « trou » sont sautés. */
export function prevInputPos(doc, c) {
  const before = voiceSlots(doc, c.staffId, c.voice, c.measureIndex).filter((s) => fCmp(s.start, c.position) < 0 && !isGap(s.item));
  if (before.length) return { cursor: { ...c, position: before[before.length - 1].start }, moved: true };
  for (let mi = c.measureIndex - 1; mi >= 0; mi -= 1) {
    const prev = voiceSlots(doc, c.staffId, c.voice, mi).filter((s) => !isGap(s.item));
    return { cursor: { ...c, measureIndex: mi, position: prev.length ? prev[prev.length - 1].start : ZERO }, moved: true };
  }
  return { cursor: c, moved: false };
}

/** Élément voisin dans la voix de `item` (`nextChordRest` / `prevChordRest`, traverse les mesures) ; les trous ne sont pas sautés. */
export function neighbourCr(doc, item, dir) {
  const at = cursorOfElement(doc, item.id);
  if (!at) return null;
  const slots = voiceSlots(doc, at.staffId, at.voice, at.measureIndex);
  const i = slots.findIndex((s) => s.item === item);
  const near = slots[i + dir];
  if (near) return { item: near.item, cursor: { ...at, position: near.start } };
  const mi = at.measureIndex + dir;
  if (mi < 0 || mi >= measureCount(doc, at.staffId)) return null;
  const other = voiceSlots(doc, at.staffId, at.voice, mi);
  const pick = dir > 0 ? other[0] : other[other.length - 1];
  return pick ? { item: pick.item, cursor: { ...at, measureIndex: mi, position: pick.start } } : null;
}

/**
 * Flèche droite / gauche. `selected` = accord ou silence de la sélection (ou null : on prend l'élément du curseur).
 * Retourne { cursor, select } : `select` = élément à sélectionner (accord, silence) ou null si la sélection ne change pas ; null si rien ne bouge.
 */
export function moveByChord(doc, c, selected, dir) {
  const cr = selected ?? itemAtCursor(doc, c);
  if (!cr) return null;
  const oldMeasure = c.measureIndex;
  const moved = dir > 0 ? nextInputPos(doc, c) : prevInputPos(doc, c);
  const cursor = moved.cursor;
  let el = neighbourCr(doc, cr, dir);
  const crAt = cursorOfElement(doc, cr.id);
  if (el) {
    // pas de saut de mesure pour la sélection : l'élément doit être dans la mesure d'origine ou dans celle du nouveau curseur
    if (el.cursor.measureIndex !== oldMeasure && el.cursor.measureIndex !== cursor.measureIndex) el = null;
    // le curseur vient de rattraper l'élément sélectionné : la sélection ne bouge pas
    else if (crAt && cursor.measureIndex === crAt.measureIndex && fEq(cursor.position, crAt.position)) el = null;
  }
  const select = el && !isGap(el.item) ? el.item : null;
  if (!moved.moved && !select) return null;
  return { cursor, select };
}

/** Ctrl + flèche : mesure suivante / précédente. `null` si le curseur n'est sur aucun élément. */
export function moveByMeasure(doc, c, dir) {
  if (!itemAtCursor(doc, c)) return null;
  const n = measureCount(doc, c.staffId);
  const own = voiceSlots(doc, c.staffId, c.voice, c.measureIndex);
  let target;
  if (dir > 0) {
    if (c.measureIndex + 1 < n) target = { ...c, measureIndex: c.measureIndex + 1, position: ZERO };
    else { const last = own[own.length - 1]; target = { ...c, position: last ? last.start : ZERO }; } // dernière mesure : sa fin
  } else {
    const first = own[0];
    if (first && !fEq(first.start, c.position)) target = { ...c, position: first.start };
    else if (c.measureIndex > 0) target = { ...c, measureIndex: c.measureIndex - 1, position: ZERO };
    else target = { ...c, position: ZERO };
  }
  const item = itemAtCursor(doc, target);
  return { cursor: target, select: item && !isGap(item) ? item : null };
}

/** Valeur de `position` en position NOMINALE de la mesure (anacrouse comprise), pour comparer avec les colonnes du moteur. */
export function nominalOf(doc, c) {
  const mv = doc.movementOf(doc.find(c.staffId));
  return fAdd(c.position, measureOffsetOf(mv.masterbars[c.measureIndex], c.measureIndex === 0));
}

/** Position relative d'une position nominale. */
export function relativeOf(doc, staffId, mi, nominal) {
  const mv = doc.movementOf(doc.find(staffId));
  return fSub(nominal, measureOffsetOf(mv.masterbars[mi], mi === 0));
}
