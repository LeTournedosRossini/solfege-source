/*
 * System dividers (MuseScore 4.7.5 `dividerLeft`, `dividerRight`, `layoutSystemDividers`): the small oblique strokes (two slashes) written in the gap between a system and the next
 * one on the same page, at the left, at the right, or both. Off by default. A screen keeps its own settings: a printed part (`PID.PART_DIVIDERS`) or a sheet (`PID.SHEET_DIVIDERS`).
 *   side `left` / `right`: switched on, symbol (short / long / extra long), `X` and `Y` offsets in staff spaces (Y positive = down), aligned to the outermost system barline of the
 *   page (else the left / right edge of the system), size factor.
 * Only the values that differ from the defaults are stored. ALL WRITES GO THROUGH `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { EditError } from './noteedit.js';

export const DIVIDER_SYMBOLS = Object.freeze(['systemDivider', 'systemDividerLong', 'systemDividerExtraLong']);
export const DIVIDER_OFFSET_MAX = 50; // spaces
export const DIVIDER_SIZE_MIN = 0.25;
export const DIVIDER_SIZE_MAX = 4;

export const DIVIDER_DEFAULTS = Object.freeze({
  left: false, right: false, leftSym: 'systemDivider', rightSym: 'systemDivider', leftX: 0, leftY: 0, rightX: 0, rightY: 0, leftAlign: true, rightAlign: true, leftSize: 1, rightSize: 1,
});

const KINDS = {
  left: 'bool', right: 'bool', leftAlign: 'bool', rightAlign: 'bool', leftSym: 'sym', rightSym: 'sym', leftX: 'offset', leftY: 'offset', rightX: 'offset', rightY: 'offset', leftSize: 'size', rightSize: 'size',
};

/** Checks one value; returns it normalised or throws. */
function cleanValue(key, value) {
  const kind = KINDS[key];
  if (!kind) throw new EditError(`Réglage de séparateur inconnu : ${key}`);
  if (kind === 'bool') { if (typeof value !== 'boolean') throw new EditError(`${key} : booléen attendu`); return value; }
  if (kind === 'sym') { if (!DIVIDER_SYMBOLS.includes(value)) throw new EditError(`${key} : symbole inconnu`); return value; }
  if (!Number.isFinite(value)) throw new EditError(`${key} : nombre attendu`);
  if (kind === 'offset') return Math.round(Math.min(DIVIDER_OFFSET_MAX, Math.max(-DIVIDER_OFFSET_MAX, value)) * 100) / 100;
  return Math.round(Math.min(DIVIDER_SIZE_MAX, Math.max(DIVIDER_SIZE_MIN, value)) * 100) / 100;
}

/** The settings of a stored object, completed with the defaults; unknown or invalid entries are ignored (a file written by another version never breaks the layout). */
export function resolveDividers(stored) {
  const out = { ...DIVIDER_DEFAULTS };
  for (const [k, v] of Object.entries(stored ?? {})) { try { if (k in KINDS) out[k] = cleanValue(k, v); } catch { /* ignored */ } }
  return out;
}

/** True when at least one side is on. */
export const dividersOn = (settings) => Boolean(settings?.left || settings?.right);

/** Merges a patch into a stored object keeping only what differs from the defaults; null when nothing is left. */
export function patchDividers(stored, patch) {
  const next = { ...(stored ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete next[k]; continue; }
    const clean = cleanValue(k, v);
    if (clean === DIVIDER_DEFAULTS[k]) delete next[k]; else next[k] = clean;
  }
  return Object.keys(next).length ? next : null;
}

function write(doc, element, pid, patch) {
  const next = patchDividers(getProperty(element, pid), patch);
  if (next) doc.set(element, pid, next); else if (getProperty(element, pid) != null) doc.reset(element, pid);
  return resolveDividers(next);
}

/** Changes the system dividers of a printed part. `patch` = { left?, right?, leftSym?, … } (null = back to the default). Returns the resulting settings. */
export function setPartDividers(doc, partId, patch) {
  const part = doc.work.parts.find((p) => p.id === partId);
  if (!part) throw new EditError('Partie introuvable');
  return write(doc, part, PID.PART_DIVIDERS, patch);
}

/** Same for a sheet (screen 3). */
export function setSheetDividers(doc, sheetId, patch) {
  const sheet = doc.work.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new EditError('Feuille introuvable');
  return write(doc, sheet, PID.SHEET_DIVIDERS, patch);
}

export const partDividers = (part) => resolveDividers(getProperty(part, PID.PART_DIVIDERS));
export const sheetDividers = (sheet) => resolveDividers(getProperty(sheet, PID.SHEET_DIVIDERS));
