// Lecture des bends / dives — port de la chaîne MPE de MuseScore 4.7.5 : `BendsRenderer` (`renderMultibend`, `renderSlightBend`, `renderDip`, `renderScoop`,
// `timeFactors`, `buildBendEvent`, `buildPitchCurve`, `isMultibendPart`), `Note::bendFor/bendBack/diveBack` (`note.cpp`), `GuitarBend::propertyDefault`.
// Pur (aucun accès au modèle de portée) : `sequence.js` fournit les événements déjà rendus des notes de la chaîne.
//
// Un bend est UNE note fusionnée : la note de départ (durée étendue jusqu'à la fin de la chaîne) porte une courbe de hauteur `pitchCurve` ; les notes
// d'arrivée ne sont pas rejouées. Les dates sont en secondes (non mises à l'échelle de la vitesse), les hauteurs en « niveaux » MuseScore
// (50 par demi-ton) ; la sortie est convertie en demi-tons par l'appelant.
//
// Écarts / quirks de MuseScore portés tels quels : pourcentages tronqués à l'entier (`int(ratio × 100) × 100`, flottants 32 bits), facteur de durée du profil
// appliqué DEUX fois à la note de départ (une fois au rendu de la note, une fois à `buildNoteEvent` de la note fusionnée), facteurs de temps cherchés par
// `findLessOrEqual` (retombée sur { 0, 1, 1 } si aucun), `isMultibendPart` qui lit `note->bendBack()` au lieu de `currNote` (sans effet audible).
import { bendTimeFactors } from '../model/bend.js';

/** 50 niveaux par demi-ton (`mpe::PITCH_LEVEL_STEP`). */
export const PITCH_LEVEL_STEP = 50;
const ONE_PERCENT = 100;
const HUNDRED_PERCENT = 10000;
const EPS = 5e-7; // égalité de dates (MuseScore : microsecondes entières)
const f32 = Math.fround;
const DUMMY_FACTORS = Object.freeze({ start: 0, target: 1, end: 1 });

const DIVE_TYPES = new Set(['dive', 'preDive', 'dip', 'scoop']);
export const isDiveType = (t) => DIVE_TYPES.has(t);

/** Montant (quarts de ton) des bends sans notes d'arrivée (`bendAmountInQuarterTones`) : slight 1, scoop −2, dip −2 par défaut. */
export function auxAmount(entry) {
  if (entry.type === 'slightBend') return 1;
  if (entry.type === 'scoop') return -2;
  return entry.amount ?? -2; // dip
}

/** `Note::bendFor / bendBack / diveBack` sur la liste d'entrées de `PID.BENDS`. */
export function bendLookup(entries) {
  const byStart = new Map();
  const byEnd = new Map();
  for (const e of entries) {
    const end = e.endNoteId ?? e.startNoteId;
    if (!byStart.has(e.startNoteId)) byStart.set(e.startNoteId, []);
    byStart.get(e.startNoteId).push(e);
    if (!byEnd.has(end)) byEnd.set(end, []);
    byEnd.get(end).push(e);
  }
  const prefer = (list, skip) => {
    let dive = null;
    for (const b of list ?? []) {
      if (skip(b)) continue;
      if (!isDiveType(b.type)) return b;
      dive = b;
    }
    return dive;
  };
  return {
    bendFor: (id) => prefer(byStart.get(id), (b) => b.type === 'scoop'),
    bendBack: (id) => prefer(byEnd.get(id), (b) => b.type === 'slightBend' || b.type === 'dip'),
    diveBack: (id) => (byEnd.get(id) ?? []).find((b) => isDiveType(b.type) && b.type !== 'dip') ?? null,
    hasAny: (id) => byStart.has(id) || byEnd.has(id),
  };
}

/**
 * `BendsRenderer::isMultibendPart` : la note appartient-elle à une chaîne de bends ?
 * @param tie { next(id) : note liée suivante | null, back(id) : note liée précédente | null }
 */
export function isMultibendPart(id, lookup, tie) {
  if (!tie.next(id) && !tie.back(id)) return Boolean(lookup.bendFor(id) || lookup.bendBack(id));
  let curr = id;
  while (tie.back(curr)) curr = tie.back(curr); // firstTiedNote
  const visited = new Set();
  while (curr != null) {
    if (visited.has(curr)) break;
    visited.add(curr);
    if (lookup.bendFor(curr) || lookup.bendBack(id)) return true;
    curr = tie.next(curr);
    if (curr == null) return false;
  }
  return false;
}

/** Une note de départ dont la note d'arrivée de la chaîne n'est PAS rendue seule (`BendsRenderer::render` : seuls pre-bend, pre-dive et scoop rendent la note). */
export function isChainArrival(id, lookup) {
  const back = lookup.bendBack(id);
  return Boolean(back && back.type !== 'preBend' && back.type !== 'preDive' && back.type !== 'scoop');
}

/**
 * `BendsRenderer::renderMultibend` : parcourt la chaîne depuis `startId` et produit la liste des événements (notes rendues + notes auxiliaires de durée 0)
 * et la table des facteurs de temps.
 * @param startId   note de départ
 * @param lookup    `bendLookup`
 * @param tie       { next, back } liaisons de prolongation (identifiants de notes)
 * @param member    (id) => { ts, dur, level } | null — événement rendu de la note (dates réelles, niveau = hauteur sonnante × 50) ; null : rien à jouer
 * @param noteCtx   (id) => { start, nominal, level } | null — contexte de l'accord de la note (début et durée NOMINALES) pour les notes auxiliaires
 * @returns { events: [{ ts, dur, level, aux }], factors: [[ts, { start, target, end }]] }
 */
export function planMultibend({ startId, lookup, tie, member, noteCtx }) {
  const events = [];
  const factors = new Map();
  const visited = new Set();
  const playing = (b) => b.play !== false;
  const currentBend = (id) => {
    const dive = lookup.diveBack(id);
    if (dive && playing(dive) && dive.type === 'scoop') return dive;
    return lookup.bendFor(id);
  };
  const nextNote = (id, bend) => (bend && (bend.endNoteId ?? bend.startNoteId) !== id ? (bend.endNoteId ?? bend.startNoteId) : null);
  const aux = (id, ts, level) => events.push({ ts, dur: 0, level, aux: true, note: id });

  let curr = startId;
  while (curr != null) {
    if (visited.has(curr)) break;
    visited.add(curr);
    const ctx = noteCtx(curr);
    if (!tie.back(curr)) {
      const m = member(curr);
      if (m) events.push({ ...m, aux: false, note: curr });
    }
    let bend = currentBend(curr);
    // pas de bend sur cette note, mais liée à la suivante : on regarde celle-là aussi
    if (!bend && tie.next(curr)) { curr = tie.next(curr); continue; }
    if (!bend || !playing(bend) || !events.length || !ctx) break;
    const f = bendTimeFactors(bend);
    const offset = (PITCH_LEVEL_STEP / 2) * auxAmount(bend);
    const at = (factor) => ctx.start + ctx.nominal * factor;
    if (bend.type === 'slightBend') {
      if (f.start !== 0) aux(curr, at(f.start), ctx.level);
      aux(curr, at(f.end), ctx.level + offset);
      break;
    }
    if (bend.type === 'dip') {
      aux(curr, at(f.start), ctx.level);
      aux(curr, at(f.target), ctx.level + offset);
      if (Math.abs(f.target - f.end) > 1e-9) aux(curr, at(f.end), ctx.level);
      if (tie.next(curr)) { curr = tie.next(curr); continue; }
      break;
    }
    if (bend.type === 'scoop') {
      aux(curr, ctx.start, ctx.level + offset);
      if (f.start !== 0) aux(curr, at(f.start), ctx.level + offset);
      aux(curr, at(f.end), ctx.level);
      bend = lookup.bendFor(curr);
      curr = nextNote(curr, bend);
      continue;
    }
    const last = events[events.length - 1];
    factors.set(last.ts + last.dur, f);
    curr = nextNote(curr, bend);
  }
  return { events, factors: [...factors.entries()].sort((a, b) => a[0] - b[0]) };
}

/**
 * `BendsRenderer::buildPitchCurve` : courbe { pourcentage (0..10000) → décalage en niveaux } de la note fusionnée.
 * @param offsets [[ts, niveaux relatifs à la note de départ]]
 * @param factors table triée de `planMultibend`
 * @returns [[pourcentage, niveaux]] trié par pourcentage
 */
export function buildPitchCurve(noteTs, noteDur, offsets, factors) {
  const curve = new Map([[0, 0]]);
  const factorsAt = (time) => {
    let found = null;
    for (const [ts, f] of factors) { if (ts <= time + EPS) found = f; else break; }
    return found ?? DUMMY_FACTORS;
  };
  if (!(noteDur > 0)) return [[0, 0]];
  let prev = 0;
  const topValue = () => curve.get(Math.max(...curve.keys())); // `result.rbegin()` : valeur de la plus grande clé
  for (const [ts, offset] of offsets) {
    const f = factorsAt(ts);
    const ratio = f32(f32(ts - noteTs) / f32(noteDur));
    const nominal = Math.max(0, Math.trunc(f32(ratio * 100))) * ONE_PERCENT;
    const diff = nominal - prev;
    const startPct = Math.trunc(f32(prev + f32(diff * f32(f.start))));
    const endPct = Math.trunc(f32(prev + f32(diff * f32(f.end))));
    prev = nominal;
    curve.set(Math.min(startPct, HUNDRED_PERCENT), topValue());
    curve.set(Math.min(endPct, HUNDRED_PERCENT), offset);
  }
  return [...curve.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * `BendsRenderer::buildBendEvent` : assemble la note fusionnée à partir des événements de la chaîne (le premier est la note de départ).
 * @returns { ts, dur, curve : [[pct, niveaux]] } — `ts` / `dur` AVANT la seconde application des facteurs du profil (l'appelant les applique) ;
 *          date d'un point de courbe = ts + dur × pct / 10000.
 */
export function buildBendEvent(events, factors) {
  const [first, ...rest] = events;
  let dur = first.dur;
  const offsets = [];
  for (const ev of rest) {
    if (ev.dur !== 0) dur = ev.ts + ev.dur - first.ts;
    offsets.push([ev.ts, ev.level - first.level]);
  }
  return { ts: first.ts, dur, curve: buildPitchCurve(first.ts, dur, offsets, factors) };
}
