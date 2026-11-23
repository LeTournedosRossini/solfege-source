/*
 * Staff text (free text of ONE staff, as MuseScore's "staff text"): anchored by instant (masterbar id + exact fraction), above or below the staff,
 * normal / italic / bold; optionally a predefined technique (`techniques.js`) that also reaches the player. TO BE CALLED INSIDE `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';
import { measureLengthOf } from './timing.js';
import { fLe, fLt, fEq, ZERO } from './fraction.js';
import { EditError } from './noteedit.js';
import { techniqueText, isTechnique } from './techniques.js';
import { LESLIE_TECHNIQUE_MODE } from '../audio/leslie.js';

/** A Leslie sign (rotor speed of an organ): its text always comes from the technique, and a staff holds at most one per instant. */
export const isLeslieSign = (e) => !!e && Object.hasOwn(LESLIE_TECHNIQUE_MODE, e.technique);

export const STAFF_TEXT_STYLES = Object.freeze(['normal', 'italic', 'bold']);
export const STAFF_TEXT_PLACEMENTS = Object.freeze(['above', 'below']);
export const STAFF_TEXT_MAX = 60;
/** A staff text can carry a LINE that starts after it and runs over `lineSpan` measures (« solo ––––| »): solid or dashed, with or without a hook back toward the staff at its end. */
export const STAFF_TEXT_LINES = Object.freeze(['solid', 'dashed']);
export const STAFF_TEXT_LINE_SPAN_MAX = 64;

/** An entry of `PID.STAFF_TEXTS`. */
export function createStaffText({ measureId, position = ZERO, text = '', style = 'normal', placement = 'above', technique, line, hook, lineSpan } = {}) {
  const entry = { id: newId('st'), measureId, position, text, style, placement };
  if (technique) entry.technique = technique;
  if (line) { entry.line = line; entry.lineSpan = lineSpan ?? 1; if (hook) entry.hook = true; } // a hook or a span without a line mean nothing: not stored
  return entry;
}

/** Problems of a list of entries (empty = valid). `bars` = { index: (id) → rank or -1, elements: masterbars in order }. */
export function validateStaffTexts(list, bars) {
  const errors = [];
  const seen = new Set();
  for (const e of list ?? []) {
    const tag = `texte de portée ${e.id}`;
    if (seen.has(e.id)) errors.push(`${tag} : identifiant en double`);
    seen.add(e.id);
    const at = bars.index(e.measureId);
    if (at < 0) { errors.push(`${tag} : mesure inexistante`); continue; }
    const len = measureLengthOf(bars.elements[at]);
    if (!(e.position && fLe(ZERO, e.position) && fLt(e.position, len))) errors.push(`${tag} : position hors de la mesure`);
    if (typeof e.text !== 'string' || !e.text.trim()) errors.push(`${tag} : texte vide`);
    if (!STAFF_TEXT_STYLES.includes(e.style)) errors.push(`${tag} : style inconnu (${e.style})`);
    if (!STAFF_TEXT_PLACEMENTS.includes(e.placement)) errors.push(`${tag} : côté inconnu (${e.placement})`);
    if (e.technique !== undefined && !isTechnique(e.technique)) errors.push(`${tag} : technique inconnue (${e.technique})`);
    if (e.line !== undefined) {
      if (!STAFF_TEXT_LINES.includes(e.line)) errors.push(`${tag} : style de ligne inconnu (${e.line})`);
      if (!(Number.isInteger(e.lineSpan) && e.lineSpan >= 1 && e.lineSpan <= STAFF_TEXT_LINE_SPAN_MAX)) errors.push(`${tag} : étendue de la ligne hors limites (${e.lineSpan})`);
      if (e.hook !== undefined && typeof e.hook !== 'boolean') errors.push(`${tag} : crochet invalide`);
    } else if (e.lineSpan !== undefined || e.hook !== undefined) errors.push(`${tag} : crochet ou étendue sans ligne`);
  }
  return errors;
}

const clean = (text) => String(text ?? '').trim().slice(0, STAFF_TEXT_MAX);

/** Adds a text at an instant of a staff. A technique gives its own text when none is given. Returns the entry. */
export function addStaffText(doc, mv, staff, { measureId, position = ZERO, text, style = 'normal', placement = 'above', technique, line, hook, lineSpan } = {}) {
  const bar = mv.masterbars.find((b) => b.id === measureId);
  if (!bar) throw new EditError(`Unknown measure: ${measureId}`);
  if (technique && !isTechnique(technique)) throw new EditError(`Unknown technique: ${technique}`);
  const leslie = isLeslieSign({ technique });
  if (leslie && line) throw new EditError('A Leslie sign has no line');
  const value = leslie ? techniqueText(technique) : clean(text) || (technique ? techniqueText(technique) : '');
  if (!value) throw new EditError('A staff text needs a text');
  if (!STAFF_TEXT_STYLES.includes(style)) throw new EditError(`Unknown style: ${style}`);
  if (!STAFF_TEXT_PLACEMENTS.includes(placement)) throw new EditError(`Unknown placement: ${placement}`);
  if (!(fLe(ZERO, position) && fLt(position, measureLengthOf(bar)))) throw new EditError('The position is outside the measure');
  if (line !== undefined && line !== null && !STAFF_TEXT_LINES.includes(line)) throw new EditError(`Unknown line style: ${line}`);
  if (line && lineSpan !== undefined && !(Number.isInteger(lineSpan) && lineSpan >= 1 && lineSpan <= STAFF_TEXT_LINE_SPAN_MAX)) throw new EditError('The line covers 1 to 64 measures');
  const entry = createStaffText({ measureId, position, text: value, style, placement, technique, line: line || undefined, hook, lineSpan });
  // a new Leslie sign replaces the one already at the same instant of this staff (like a clef change pasted over another)
  const kept = (getProperty(staff, PID.STAFF_TEXTS) ?? []).filter((e) => !(leslie && isLeslieSign(e) && e.measureId === measureId && fEq(e.position, position)));
  doc.set(staff, PID.STAFF_TEXTS, [...kept, entry]);
  return entry;
}

/** Changes text / style / placement / line (`line: null` removes it; `hook`, `lineSpan` only count with a line) of an entry. */
export function updateStaffText(doc, staff, id, patch) {
  const list = getProperty(staff, PID.STAFF_TEXTS) ?? [];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) throw new EditError(`Unknown staff text: ${id}`);
  const next = { ...list[i] };
  if (isLeslieSign(next) && (patch.text !== undefined || patch.line)) throw new EditError('The text and line of a Leslie sign cannot be changed: pick another state'); // its text must stay the technique's
  if (patch.text !== undefined) { const t = clean(patch.text); if (!t) throw new EditError('A staff text needs a text'); next.text = t; }
  if (patch.style !== undefined) { if (!STAFF_TEXT_STYLES.includes(patch.style)) throw new EditError('Unknown style'); next.style = patch.style; }
  if (patch.placement !== undefined) { if (!STAFF_TEXT_PLACEMENTS.includes(patch.placement)) throw new EditError('Unknown placement'); next.placement = patch.placement; }
  if (patch.line !== undefined) {
    if (patch.line === null) { delete next.line; delete next.hook; delete next.lineSpan; } else { if (!STAFF_TEXT_LINES.includes(patch.line)) throw new EditError('Unknown line style'); next.line = patch.line; next.lineSpan ??= 1; }
  }
  if (next.line) {
    if (patch.hook !== undefined) { if (patch.hook) next.hook = true; else delete next.hook; }
    if (patch.lineSpan !== undefined) { if (!(Number.isInteger(patch.lineSpan) && patch.lineSpan >= 1 && patch.lineSpan <= STAFF_TEXT_LINE_SPAN_MAX)) throw new EditError('The line covers 1 to 64 measures'); next.lineSpan = patch.lineSpan; }
  }
  doc.set(staff, PID.STAFF_TEXTS, list.map((e, k) => (k === i ? next : e)));
  return next;
}

export function removeStaffText(doc, staff, id) {
  const list = getProperty(staff, PID.STAFF_TEXTS) ?? [];
  if (!list.some((e) => e.id === id)) return false;
  doc.set(staff, PID.STAFF_TEXTS, list.filter((e) => e.id !== id));
  return true;
}
