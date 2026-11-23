/*
 * A chain of tied notes is ONE sustained note: when the pitch of one of them changes, the others must follow (the sound already merges them, the drawing must too).
 * `tieMates(doc, note)` = the other notes of the chain of `note` (both directions, same staff, through the staff's `PID.TIES`). Pure reading, no write.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';

/** The staff that holds a note (walks up the parents), or null. */
function staffOf(doc, el) {
  for (let p = doc.parentOf(el.id); p; p = doc.parentOf(p.id)) if (p.type === 'staff') return p;
  return null;
}

/** The other notes tied to `note`, directly or through other tied notes (earlier ones first is NOT guaranteed). */
export function tieMates(doc, note) {
  const staff = staffOf(doc, note);
  if (!staff) return [];
  const ties = getProperty(staff, PID.TIES) ?? [];
  if (!ties.length) return [];
  const seen = new Set([note.id]); const queue = [note.id]; const out = [];
  while (queue.length) {
    const id = queue.pop();
    for (const t of ties) {
      const other = t.startNoteId === id ? t.endNoteId : t.endNoteId === id ? t.startNoteId : null;
      if (!other || seen.has(other)) continue;
      seen.add(other);
      const n = doc.find(other);
      if (n && (n.type === 'note' || n.type === 'tabnote')) { out.push(n); queue.push(other); }
    }
  }
  return out;
}
