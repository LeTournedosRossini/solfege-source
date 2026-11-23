/*
 * Muted notes in the display: every display item that belongs to a chord or a note whose LOCAL `play` is false gets `muted: true`
 * (heads, stem, flag, dots, accidentals, ledger lines, articulations… everything that carries the chord's or the note's id).
 * A beam is muted only when every stem it carries is muted. The renderer draws muted items in grey for the editor (`showMuted`) and does
 * NOT draw them at all otherwise (exports, printed parts, a reader); the layout does not change, so the place stays.
 */
const isFalse = (el) => el?.props?.play === false;

/** Ids (chords and notes, grace notes included) whose play is switched off. */
export function mutedIds(movement) {
  const out = new Set();
  const note = (n, parentMuted) => { if (parentMuted || isFalse(n)) out.add(n.id); };
  const chord = (c) => {
    const m = isFalse(c);
    if (m) out.add(c.id);
    for (const n of c.notes ?? []) note(n, m);
    for (const g of c.graceNotes ?? []) chord(g);
  };
  for (const track of movement.tracks ?? []) for (const staff of track.staves ?? []) for (const voice of staff.voices ?? []) for (const measure of voice.measures ?? []) {
    for (const item of measure.items ?? []) if (item.type !== 'rest' && (item.notes || item.graceNotes)) chord(item);
  }
  return out;
}

/** Flag the muted display items of the laid-out systems (in place). Returns the number of items flagged. */
export function markMuted(systems, movement) {
  const ids = mutedIds(movement);
  if (!ids.size) return 0;
  let count = 0;
  for (const sys of systems) for (const st of sys.staves) {
    for (const it of st.items) if (it.ref && ids.has(it.ref)) { it.muted = true; count++; }
    for (const it of st.items) if (it.role === 'beam' && it.stems?.length && it.stems.every((s) => s.muted)) { it.muted = true; count++; }
  }
  return count;
}
