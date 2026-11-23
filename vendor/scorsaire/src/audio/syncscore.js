// The score heard together with a recording: the sequence of the score (built at the written tempo, no repeats) is RE-TIMED so that each note falls where
// its measure is in the recording. Each time inside a measure is placed by the share of the measure it has gone through (the tempo of the sequence tells
// how much of the measure has gone by), then converted to recording time by the sync map, then to playing time by dividing by the listening speed.
// Pitched notes follow the pitch shift. PURE: sequences in, a new sequence out.
import { advanced } from './cursor.js';

/**
 * @param seq     a sequence (buildSequence, speed 1; playRepeats false, or true when the map has a played order — then its slots are the played measures)
 * @param map     sync map (createSyncMap)
 * @param options { rate = 1 (listening speed of the recording), semitones = 0, lengths: number[] (length of each measure in wholes, per measure index of the movement) }
 */
export function retimeSequence(seq, map, { rate = 1, semitones = 0, lengths } = {}) {
  const slots = seq.slots;
  const steps = seq.tempo.steps;
  // a map with a PLAYED ORDER (repeats in the recording): when the sequence has the same measures in the same order, slot k IS played measure k and every pass has its own time
  const played = !!map.order && slots.length === map.playedCount && slots.every((s, k) => s.measure === map.order[k]);
  const mediaOf = (measure, ratio, k = -1) => {
    if (played && k >= 0) {
      if (ratio >= 0 && ratio <= 1) return map.timeOfPlayed(k, ratio);
      const a = map.timeOfPlayed(k, 0); const b = map.timeOfPlayed(k, 1);
      return a + ratio * (b - a);
    }
    const m = Math.min(Math.max(measure, 0), map.measureCount - 1);
    if (ratio >= 0 && ratio <= 1) return map.timeOf(m, ratio);
    const a = map.timeOf(m, 0); const b = map.timeOf(m, 1);
    return a + ratio * (b - a);
  };
  const slotAt = (tau) => { let k = 0; for (let lo = 0, hi = slots.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (slots[mid].t <= tau) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  const toPlay = (tau) => {
    if (!slots.length) return tau / rate;
    const k = slotAt(tau); const slot = slots[k];
    const len = lengths[slot.measure] || 1;
    const wholes = tau >= slot.t ? advanced(steps, slot.t, tau) : -advanced(steps, tau, slot.t);
    return mediaOf(slot.measure, wholes / len, k) / rate;
  };
  const pitched = new Set(seq.tracks.filter((t) => t.kind !== 'percussion').map((t) => t.id));
  const notes = seq.notes.map((n) => {
    const t = toPlay(n.t);
    const out = { ...n, t, duration: Math.max(0.005, toPlay(n.t + n.duration) - t) };
    if (semitones && n.pitch != null && pitched.has(n.track)) out.pitch = Math.min(127, Math.max(0, n.pitch + semitones));
    if (n.pitchCurve) out.pitchCurve = n.pitchCurve.map((p) => ({ ...p, t: toPlay(p.t) }));
    return out;
  });
  const messages = seq.messages.map((m) => ({ ...m, t: toPlay(m.t) }));
  const newSlots = slots.map((s, k) => ({ ...s, t: mediaOf(s.measure, 0, k) / rate, end: mediaOf(s.measure, 1, k) / rate }));
  const newSteps = newSlots.map((s) => {
    const len = lengths[s.measure] || 1; const dur = Math.max(1e-6, s.end - s.t); const wps = len / dur;
    return { t: s.t, wps, bpm: wps * 240 };
  });
  const automation = (seq.automation ?? []).map((l) => ({ ...l, steps: l.steps.map((p) => ({ ...p, t: toPlay(p.t) })) }));
  return { ...seq, notes, messages, automation, slots: newSlots, tempo: { ...seq.tempo, steps: newSteps }, duration: newSlots.length ? newSlots[newSlots.length - 1].end : seq.duration / rate, speed: rate, synced: true };
}
