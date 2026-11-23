/*
 * Intentions sur une PLAGE, conditionnées par le filtre de sélection (étape 5, filtres). AUCUN DOM : fonctions pures sur le Document,
 * appelées par l'Application à l'intérieur de `app.edit(...)`. Extension Scorsaire (MuseScore n'applique le filtre ni au jouer/muet ni au
 * masquage) : décidée avec Jean le 13/10/2026.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { STAFF_TYPES } from '../model/schema.js';
import { resolveStaves, rangeItems, rangeMeasureSpan } from '../model/range.js';
import { splitChordNotes, containsMultiNoteChords, canVoice, canCategory } from '../model/selectionfilter.js';
import { DECOR_KINDS, isDecorHidden } from '../model/decor.js';
import { nextPlayValue, togglePlay } from './play-intents.js';
import { setDecorHidden } from './decor-intents.js';

const movementOf = (doc, range) => doc.movementOf(doc.find(range.from.measureId));
const isSequential = (staff) => STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential !== false;

/**
 * Identifiants jouables visés par le filtre dans la plage : un accord dont toutes les notes passent (muet = l'accord), sinon ses notes
 * retenues ; les symboles d'accord de la voix cochée si « symboles d'accord » est coché.
 */
export function rangePlayTargets(doc, range, filter = null) {
  const mv = movementOf(doc, range);
  const staves = resolveStaves(mv, range.staffIds) ?? [];
  const ids = [];
  const seq = staves.filter(isSequential);
  if (seq.length) {
    const all = rangeItems(mv, { ...range, staffIds: seq.map((s) => s.id) });
    const hasMulti = containsMultiNoteChords(all.filter((e) => e.item.type === 'chord').map((e) => e.item));
    for (const e of all) {
      if (e.item.type !== 'chord' || !canVoice(filter, e.voiceIndex)) continue;
      const { kept, dropped } = splitChordNotes(filter, e.item, hasMulti);
      if (!kept.length) continue;
      if (!dropped.length) ids.push(e.item.id); else ids.push(...kept.map((n) => n.id));
    }
  }
  const span = rangeMeasureSpan(mv, range);
  if (canCategory(filter, 'chordSymbol')) {
    for (const staff of staves.filter((s) => !isSequential(s))) {
      (staff.voices ?? []).forEach((voice, vi) => {
        if (!canVoice(filter, vi)) return;
        for (let mi = span.first; mi <= span.last; mi++) {
          for (const it of voice.measures?.[mi]?.items ?? []) {
            if (it.type !== 'chordsymbol') continue;
            const pos = getProperty(it, PID.POSITION);
            if (mi === span.first && pos[0] * range.from.position[1] < range.from.position[0] * pos[1]) continue;
            if (mi === span.last && pos[0] * range.to.position[1] >= range.to.position[0] * pos[1]) continue;
            ids.push(it.id);
          }
        }
      });
    }
  }
  return ids;
}

/** Valeur que donnerait la bascule jouer/muet de la plage (false = couper, true = jouer, null = rien de jouable). */
export const nextRangePlayValue = (doc, range, filter = null) => nextPlayValue(doc, rangePlayTargets(doc, range, filter));

/** Bascule jouer/muet sur ce que le filtre vise dans la plage. À appeler dans une transaction. Retourne le nombre d'éléments changés. */
export const toggleRangePlay = (doc, range, filter = null) => togglePlay(doc, rangePlayTargets(doc, range, filter));

/** Entrées de décor { staff, kind, measureId } de la plage (barres, clés, armures, chiffrages de chaque mesure, chaque portée). */
export function rangeDecorTargets(doc, range, filter = null) {
  if (!canCategory(filter, 'decor')) return [];
  const mv = movementOf(doc, range);
  const span = rangeMeasureSpan(mv, range);
  const out = [];
  for (const staff of resolveStaves(mv, range.staffIds) ?? []) {
    for (let mi = span.first; mi <= span.last; mi++) for (const kind of DECOR_KINDS) out.push({ staff, kind, measureId: mv.masterbars[mi].id });
  }
  return out;
}

/** Masquer (vrai) si au moins un élément est visible, sinon ré-afficher ; null si rien à faire. */
export function nextRangeDecorHidden(doc, range, filter = null) {
  const t = rangeDecorTargets(doc, range, filter);
  if (!t.length) return null;
  return t.some((x) => !isDecorHidden(x.staff, x.kind, x.measureId));
}

/** Masque / ré-affiche le décor de la plage. À appeler dans une transaction. Retourne le nombre d'entrées changées. */
export function toggleRangeDecorHidden(doc, range, filter = null) {
  const value = nextRangeDecorHidden(doc, range, filter);
  if (value === null) return 0;
  let n = 0;
  for (const x of rangeDecorTargets(doc, range, filter)) if (setDecorHidden(doc, x.staff, x.kind, x.measureId, value)) n++;
  return n;
}
