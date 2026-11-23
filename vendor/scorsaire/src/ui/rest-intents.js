/*
 * Switch rests off for printing (`PID.VISIBLE` false on the rest) — intentions WITHOUT DOM, to call inside `doc.transaction` (`Application.toggleRestsHidden`).
 * The rest keeps its duration and its place (the measure stays full, the playback and the spacing do not change); the layout flags its items `hidden`, which
 * the renderer draws grey for the editor and does not draw at all in an export, a print or a reader. Same toggle rule as the decor: if at least one rest
 * aimed at is shown, all of them are hidden, otherwise all are shown again.
 * A hidden rest is also made EXPLICIT, so that the automatic recalculation of rests (which reuses the automatic ones) does not lose the choice.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { resolveStaves, rangeItems } from '../model/range.js';
import { canVoice } from '../model/selectionfilter.js';

/** Rests that can be switched off: not the invisible "gap" rests of voices 2-4 (they are never drawn anyway). */
const switchable = (el) => el?.type === 'rest' && getProperty(el, PID.GAP) !== true;

/** The rests among `ids` (elements of the document). */
export function restTargets(doc, ids) {
  const out = [];
  for (const id of ids ?? []) { const el = doc.find(id); if (switchable(el)) out.push(el); }
  return out;
}

/** The rests of a range that the filter lets through (voices), on its sequential staves. */
export function rangeRestTargets(doc, range, filter = null) {
  const mv = doc.movementOf(doc.find(range.from.measureId));
  const staves = (resolveStaves(mv, range.staffIds) ?? []).filter((s) => s.voices);
  if (!staves.length) return [];
  return rangeItems(mv, { ...range, staffIds: staves.map((s) => s.id) })
    .filter((e) => switchable(e.item) && canVoice(filter, e.voiceIndex))
    .map((e) => e.item);
}

const hiddenNow = (el) => getProperty(el, PID.VISIBLE) === false;

/** What the toggle would do: true = hide, false = show again, null = no rest aimed at. */
export function nextRestsHidden(rests) {
  if (!rests.length) return null;
  return rests.some((r) => !hiddenNow(r));
}

/** Hides (`hidden` true) or shows the rests. Returns how many changed. To call inside `doc.transaction`. */
export function setRestsHidden(doc, rests, hidden) {
  let n = 0;
  for (const r of rests) {
    if (hiddenNow(r) === hidden) continue;
    if (hidden) {
      doc.set(r, PID.VISIBLE, false);
      if (getProperty(r, PID.EXPLICIT) !== true) doc.set(r, PID.EXPLICIT, true);
    } else doc.reset(r, PID.VISIBLE);
    n += 1;
  }
  return n;
}

/** Toggles the rests; returns how many changed. */
export function toggleRestsHidden(doc, rests) {
  const next = nextRestsHidden(rests);
  return next === null ? 0 : setRestsHidden(doc, rests, next);
}
