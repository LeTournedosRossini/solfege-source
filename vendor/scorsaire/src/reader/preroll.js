/*
 * Pre-roll of the reader: before the chosen start, the music of the `count` measures that PRECEDE it (in the order they are played) is heard, optionally with a
 * metronome. When fewer measures precede the start (at the beginning of a piece) the missing ones are a metronome-only count-in. Pure (no DOM, no audio).
 */

/** Beats of a measure: the numerator, or a third of it in compound time (6/8, 9/8, 12/8). */
export function beatsIn([num, den]) {
  return num > 3 && num % 3 === 0 && den >= 8 ? num / 3 : Math.max(1, num);
}

/** Every beat of the sequence (for a metronome that plays all the time): [{ t, accent }] in seconds, from the measure slots. */
export function beatClicks(sequence, timeSig) {
  const out = [];
  for (const slot of sequence?.slots ?? []) {
    const n = beatsIn(timeSig(slot.measure) ?? [4, 4]); const len = slot.end - slot.t;
    for (let j = 0; j < n; j += 1) out.push({ t: slot.t + (len * j) / n, accent: j === 0 });
  }
  return out;
}

/**
 * The plan for starting at `start` seconds with `count` measures of pre-roll. `sequence.slots` give the measures in played order; `timeSig(measureIndex)` → [num, den].
 * → null (nothing to do) or { playFrom, lead, clicks: [{ t, accent }] }:
 *   - `playFrom`: where the music starts (seconds of the sequence); - `lead`: seconds of silent count-in BEFORE the music (0 when enough measures precede);
 *   - `clicks`: metronome clicks, `t` in seconds of the sequence (negative = inside the count-in), only when `metronome` is true.
 */
export function prerollPlan(sequence, { start, count, metronome, timeSig }) {
  const slots = sequence?.slots ?? [];
  if (!count || !slots.length) return null;
  let k = 0;
  for (let i = 0; i < slots.length; i += 1) { if (slots[i].t <= start + 1e-6) k = i; else break; }
  const from = Math.max(0, k - count);
  const missing = count - (k - from);
  if (k === from && !(missing > 0 && metronome)) return null;
  const clicks = [];
  const beatsOf = (slot) => beatsIn(timeSig(slot.measure) ?? [4, 4]);
  if (metronome) {
    for (let i = from; i < k; i += 1) {
      const n = beatsOf(slots[i]); const len = slots[i].end - slots[i].t;
      for (let j = 0; j < n; j += 1) clicks.push({ t: slots[i].t + (len * j) / n, accent: j === 0 });
    }
    if (missing > 0) {
      const slot = slots[k]; const n = beatsOf(slot); const len = slot.end - slot.t;
      for (let m = missing; m >= 1; m -= 1) for (let j = 0; j < n; j += 1) clicks.push({ t: slots[from].t - m * len + (len * j) / n, accent: j === 0 });
    }
  }
  const lead = metronome && missing > 0 ? missing * (slots[k].end - slots[k].t) : 0;
  return { playFrom: slots[from].t, lead, clicks };
}
