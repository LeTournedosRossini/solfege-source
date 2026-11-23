// The stretch of a sequence to hear a note "in situation": from `before` notes of the same track before it to `after` notes after it. PURE.
// Times are the seconds of the sequence (what the player and the engines use). A note counts once per onset (a chord is one), and a bend that
// merges several written notes (a guitar bend with its arrival note) is one note that lasts until its end.

const EPS = 1e-6;

/**
 * @param sequence  the built sequence (`notes` with `id`, `chord`, `track`, `t`, `duration`)
 * @param o.noteId  the note the bend belongs to; `chordId`: when the bend moves a whole chord, any note of it counts
 * @returns { start, end } in seconds, or null when the note does not sound (muted, not played)
 */
export function contextSpan(sequence, { noteId, chordId = null, before = 2, after = 2, tail = 0.35 }) {
  const notes = sequence?.notes ?? [];
  const targets = notes.filter((n) => n.id === noteId || (chordId && n.chord === chordId));
  if (!targets.length) return null;
  const track = targets[0].track;
  const t0 = Math.min(...targets.map((n) => n.t));
  const t1 = Math.max(...targets.map((n) => n.t + n.duration));
  const mine = notes.filter((n) => n.track === track);
  const onsets = [...new Set(mine.map((n) => Math.round(n.t / EPS) * EPS))].sort((a, b) => a - b);
  const earlier = onsets.filter((t) => t < t0 - EPS);
  const later = onsets.filter((t) => t >= t1 - EPS);
  const start = before > 0 && earlier.length ? earlier[Math.max(0, earlier.length - before)] : t0;
  let end = t1;
  if (after > 0 && later.length) {
    const last = later[Math.min(later.length, after) - 1];
    end = Math.max(t1, ...mine.filter((n) => Math.abs(n.t - last) < 1e-5).map((n) => n.t + n.duration));
  }
  return { start: Math.max(0, start), end: Math.min(sequence.duration ?? Infinity, end + tail) };
}
