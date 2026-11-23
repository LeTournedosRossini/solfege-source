/*
 * Which TRACKS an exported page shows (12/11/2026, request of Jean): the page keeps the whole score, but the tracks the author chose to hide are marked hidden (`PID.VISIBLE` false) in the
 * copy that goes into the file, so the reader opens on what the author wants to be seen (the reader can still show a hidden track with its chip). The score being edited is never touched.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { createDocument } from '../model/document.js';
import { workToFileText, workFromFileText } from '../ui/file-io.js';

/** The tracks of the first movement as the person sees them: [{ id, name, shown }] — `shown` is what the editor shows now (`PID.VISIBLE`). */
export function trackChoices(work, movementIndex = 0) {
  const movement = work.movements[movementIndex];
  return (movement?.tracks ?? []).map((tr, i) => ({ id: tr.id, name: getProperty(tr, PID.NAME) || getProperty(tr, PID.ABBREVIATION) || `${i + 1}`, shown: getProperty(tr, PID.VISIBLE) !== false }));
}

/**
 * The text of the file of `work` with only the tracks of `shownIds` shown (the others hidden, in every movement that has them). `shownIds` null = the work as it is.
 * At least one track stays shown: an empty choice keeps the work as it is.
 */
export function workTextWithTracks(work, shownIds) {
  if (!Array.isArray(shownIds)) return workToFileText(work);
  const ids = new Set(shownIds);
  if (!work.movements.some((m) => m.tracks.some((t) => ids.has(t.id)))) return workToFileText(work);
  const copy = workFromFileText(workToFileText(work)); // the copy is what changes, never the score being edited
  const doc = createDocument(copy);
  doc.transaction('export: tracks shown', () => {
    for (const m of copy.movements) for (const tr of m.tracks) {
      const wanted = ids.has(tr.id); if ((getProperty(tr, PID.VISIBLE) !== false) !== wanted) doc.set(tr, PID.VISIBLE, wanted);
    }
  });
  return workToFileText(copy);
}
