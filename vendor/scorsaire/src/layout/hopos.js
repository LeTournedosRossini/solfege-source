/*
 * Marteaux / arrachés (hammer-on / pull-off, tranche 4d-a). `PID.HOPOS` (portée) : [{ id, startChordId, endChordId }] — ancrage par
 * IDENTITÉ des accords de bornes (comme les liaisons). MuseScore v4.7.5 : `HammerOnPullOff` est une sous-classe de `Slur` ; une chaîne
 * de plus de deux accords est UN seul spanner dont chaque paire consécutive porte une lettre (H si la frette monte, P si elle descend).
 */
import { PID, getProperty } from '../model/index.js';
import { itemMeasureIndexMap } from './hairpins.js';

export function resolveStaffHopos(staff) {
  const idx = itemMeasureIndexMap(staff);
  const raw = getProperty(staff, PID.HOPOS) || [];
  return raw
    .map((s) => ({ ...s, startMi: idx.get(s.startChordId), endMi: idx.get(s.endChordId) }))
    .filter((s) => s.startMi !== undefined && s.endMi !== undefined && s.startMi <= s.endMi);
}

/** Lettre d'une paire : H (la frette monte) / P (elle descend) ; null si égales (pas de lettre). `upper` : majuscules (HOPO_UPPER_CASE). */
export function hopoLetter(fretFrom, fretTo, upper = true) {
  if (fretTo === fretFrom) return null;
  const c = fretTo > fretFrom ? 'h' : 'p';
  return upper ? c.toUpperCase() : c;
}
