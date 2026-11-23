// The sound of a note moved by the pupil's transposition. Pure: no DOM (the component file cannot be imported under Node).
/** The same sequence moved by `n` semitones: every pitched note (a drum track keeps its sounds). Pure: the sequence it is given is not changed. */
export function transposeSequence(seq, n) {
  if (!n) return seq;
  const pitched = new Set((seq.tracks ?? []).filter((t) => t.kind !== 'percussion').map((t) => t.id));
  return { ...seq, notes: seq.notes.map((x) => (x.pitch != null && pitched.has(x.track) ? { ...x, pitch: Math.min(127, Math.max(0, x.pitch + n)) } : x)) };
}
