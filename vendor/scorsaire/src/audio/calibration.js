/*
 * Latency calibration, PURE: the user taps a key on every click of a slow metronome; the median distance between each tap and the click it follows is
 * the offset to set in the recording window (it covers the audio device's real delay, the keyboard and the player's own habit of playing a little early
 * or late). Times are seconds since the first click as HEARD (the same clock as a take), + = the tap came after the click.
 */

export const CALIBRATION = Object.freeze({ bpm: 90, total: 16, skip: 4, minTaps: 8, okSpreadMs: 25, roughSpreadMs: 40 });

/** The click times of a calibration run (seconds since the first click) and which ones are accented. */
export function calibrationClicks({ bpm = CALIBRATION.bpm, total = CALIBRATION.total } = {}) {
  const period = 60 / bpm;
  return Array.from({ length: total }, (_, k) => ({ t: k * period, accent: k % 4 === 0 }));
}

const median = (list) => { const a = [...list].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0; };

/**
 * @param taps  seconds since the first click, one per key pressed
 * @returns { count, offsetMs, spreadMs, verdict: 'ok' | 'rough' | 'unsteady' | 'tooFew' }
 *   The first `skip` clicks are only for getting into the beat; a tap farther than a quarter of a period from a click is ignored (a stray key);
 *   two taps for one click keep the nearer one. `spreadMs` = robust spread (1.4826 × the median absolute deviation) of the distances.
 */
export function analyzeTaps(taps, { bpm = CALIBRATION.bpm, total = CALIBRATION.total, skip = CALIBRATION.skip } = {}) {
  const period = 60 / bpm;
  const byClick = new Map();
  for (const t of taps) {
    if (!Number.isFinite(t)) continue;
    const k = Math.round(t / period);
    if (k < skip || k >= total) continue;
    const d = t - k * period;
    if (Math.abs(d) > period / 4) continue;
    const prev = byClick.get(k);
    if (prev === undefined || Math.abs(d) < Math.abs(prev)) byClick.set(k, d);
  }
  const ds = [...byClick.values()].map((d) => d * 1000);
  if (ds.length < CALIBRATION.minTaps) return { count: ds.length, offsetMs: 0, spreadMs: 0, verdict: 'tooFew' };
  const mid = median(ds);
  const spread = 1.4826 * median(ds.map((d) => Math.abs(d - mid)));
  const verdict = spread <= CALIBRATION.okSpreadMs ? 'ok' : spread <= CALIBRATION.roughSpreadMs ? 'rough' : 'unsteady';
  return { count: ds.length, offsetMs: Math.round(mid), spreadMs: Math.round(spread), verdict };
}
