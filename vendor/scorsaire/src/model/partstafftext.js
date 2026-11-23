/*
 * Staff texts that belong to ONE PRINTED PART (screen 2): free text above / below a staff of the part, at an instant, normal / italic / bold, optionally followed by a dashed or solid LINE
 * (« solo ––––| ») that runs over a number of measures or to the end of the piece. They are drawn by the same code as the staff texts of screen 1 (layout/stafftextentries.js) and
 * only appear in this part (`PID.PART_STAFF_TEXTS`): the layout merges them into the staves of the part (`withPartStaffTexts`, layout/partlayout.js).
 * An entry is the entry of `PID.STAFF_TEXTS` plus `staffId`, and `toEnd` (the line goes to the last measure of the movement, whatever its length becomes).
 * To be called INSIDE `doc.transaction`. A text whose staff or measure no longer exists is simply not drawn (it comes back with an undo).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';
import { measureLengthOf } from './timing.js';
import { fLe, fLt, ZERO } from './fraction.js';
import { STAFF_TEXT_STYLES, STAFF_TEXT_PLACEMENTS, STAFF_TEXT_LINES, STAFF_TEXT_LINE_SPAN_MAX, STAFF_TEXT_MAX } from './stafftextedit.js';

export class PartTextError extends Error { constructor(message, code = 'invalid') { super(message); this.name = 'PartTextError'; this.code = code; } }

export const partStaffTextsOf = (part) => getProperty(part, PID.PART_STAFF_TEXTS) ?? [];

function partOf(doc, id) {
  const part = doc.work.parts.find((p) => p.id === id);
  if (!part) throw new PartTextError(`Unknown part: ${id}`, 'part');
  return part;
}

/** The staff and its movement for a staff id (null when it does not exist). */
function staffContext(doc, staffId) {
  for (const mv of doc.work.movements) for (const t of mv.tracks) { const staff = t.staves.find((s) => s.id === staffId); if (staff) return { mv, staff }; }
  return null;
}

const write = (doc, part, list) => { if (list.length) doc.set(part, PID.PART_STAFF_TEXTS, list); else if (getProperty(part, PID.PART_STAFF_TEXTS) != null) doc.reset(part, PID.PART_STAFF_TEXTS); };

function check(entry, mv) {
  const text = String(entry.text ?? '').trim().slice(0, STAFF_TEXT_MAX);
  if (!text) throw new PartTextError('A staff text needs a text', 'text');
  if (!STAFF_TEXT_STYLES.includes(entry.style)) throw new PartTextError('Unknown style', 'style');
  if (!STAFF_TEXT_PLACEMENTS.includes(entry.placement)) throw new PartTextError('Unknown placement', 'placement');
  const bar = mv.masterbars.find((b) => b.id === entry.measureId);
  if (!bar) throw new PartTextError('Unknown measure', 'measure');
  if (!(fLe(ZERO, entry.position) && fLt(entry.position, measureLengthOf(bar)))) throw new PartTextError('The position is outside the measure', 'position');
  const out = { id: entry.id, staffId: entry.staffId, measureId: entry.measureId, position: entry.position, text, style: entry.style, placement: entry.placement };
  if (entry.line) {
    if (!STAFF_TEXT_LINES.includes(entry.line)) throw new PartTextError('Unknown line style', 'line');
    out.line = entry.line;
    if (entry.toEnd) out.toEnd = true;
    else {
      const span = entry.lineSpan ?? 1;
      if (!(Number.isInteger(span) && span >= 1 && span <= STAFF_TEXT_LINE_SPAN_MAX)) throw new PartTextError('The line covers 1 to 64 measures', 'span');
      out.lineSpan = span;
    }
    if (entry.hook) out.hook = true;
  }
  return out;
}

/** Adds a text to a part; returns the entry. `spec`: { staffId, measureId, position?, text, style?, placement?, line?, lineSpan?, toEnd?, hook? }. */
export function addPartStaffText(doc, partId, spec) {
  const part = partOf(doc, partId);
  const ctx = staffContext(doc, spec.staffId);
  if (!ctx) throw new PartTextError('Unknown staff', 'staff');
  const entry = check({ position: ZERO, style: 'normal', placement: 'above', ...spec, id: newId('st') }, ctx.mv);
  write(doc, part, [...partStaffTextsOf(part), entry]);
  return entry;
}

/** Changes a text of a part (any field of `spec`; `line: null` removes the line). Returns the entry. */
export function updatePartStaffText(doc, partId, id, patch) {
  const part = partOf(doc, partId);
  const list = partStaffTextsOf(part);
  const at = list.findIndex((e) => e.id === id);
  if (at < 0) throw new PartTextError('Unknown text', 'unknown');
  const merged = { ...list[at], ...patch };
  if (patch.line === null) { delete merged.line; delete merged.lineSpan; delete merged.toEnd; delete merged.hook; }
  if (patch.toEnd === false) delete merged.toEnd;
  if (patch.toEnd === true) delete merged.lineSpan;
  if (patch.lineSpan !== undefined && patch.toEnd === undefined) delete merged.toEnd;
  const ctx = staffContext(doc, merged.staffId);
  if (!ctx) throw new PartTextError('Unknown staff', 'staff');
  const entry = check(merged, ctx.mv);
  write(doc, part, list.map((e, i) => (i === at ? entry : e)));
  return entry;
}

export function removePartStaffText(doc, partId, id) {
  const part = partOf(doc, partId);
  const list = partStaffTextsOf(part);
  if (!list.some((e) => e.id === id)) return false;
  write(doc, part, list.filter((e) => e.id !== id));
  return true;
}

/**
 * The entries of a part as staff-text entries of ONE movement, by staff id: `{ <staffId>: [entry…] }`, the `toEnd` lines given their number of measures. Entries of other
 * movements, or whose measure is gone, are left out. PURE (read only).
 */
export function partTextsByStaff(part, mv) {
  const ids = mv.masterbars.map((b) => b.id);
  const staves = new Set(mv.tracks.flatMap((t) => t.staves.map((s) => s.id)));
  const out = {};
  const styles = getProperty(part, PID.PART_TEXT_STYLES) ?? {};
  for (const e of partStaffTextsOf(part)) {
    const at = ids.indexOf(e.measureId);
    if (at < 0 || !staves.has(e.staffId)) continue;
    const { staffId, toEnd, ...rest } = e;
    const fmt = styles[`stext:${e.id}`]; // font, size (pt), bold / italic / underline, colour chosen in the text editor (the same record as the page texts)
    const entry = { ...rest, ...(toEnd ? { lineSpan: ids.length - at } : {}), ...(fmt && Object.keys(fmt).length ? { fmt } : {}) };
    (out[staffId] ??= []).push(entry);
  }
  return out;
}

/** Problems of the texts of a part (for `validateWork`): ids, texts, styles; anchors that no longer exist are not errors (they are not drawn). */
export function validatePartStaffTexts(part) {
  const errors = [];
  const seen = new Set();
  for (const e of partStaffTextsOf(part)) {
    const tag = `partie ${part.id}, texte de portée ${e?.id}`;
    if (!e || typeof e.id !== 'string') { errors.push(`partie ${part.id} : texte de portée sans identifiant`); continue; }
    if (seen.has(e.id)) errors.push(`${tag} : identifiant en double`);
    seen.add(e.id);
    if (typeof e.staffId !== 'string' || typeof e.measureId !== 'string') errors.push(`${tag} : ancrage manquant`);
    if (typeof e.text !== 'string' || !e.text.trim()) errors.push(`${tag} : texte vide`);
    if (!STAFF_TEXT_STYLES.includes(e.style)) errors.push(`${tag} : style inconnu`);
    if (!STAFF_TEXT_PLACEMENTS.includes(e.placement)) errors.push(`${tag} : côté inconnu`);
    if (e.line !== undefined && !STAFF_TEXT_LINES.includes(e.line)) errors.push(`${tag} : ligne inconnue`);
    if (e.line === undefined && (e.lineSpan !== undefined || e.hook !== undefined || e.toEnd !== undefined)) errors.push(`${tag} : étendue ou crochet sans ligne`);
  }
  return errors;
}
