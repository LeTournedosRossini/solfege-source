// Written pitch wheel ("Molette", model/wheel.js) on top of the pitch curve a note may already have (a guitar bend, a continuous glissando).
// Both are `[{ t, semitones }]` with `t` in seconds of playback; the result is their SUM at every date of either.

const levelAt = (curve, t) => {
  if (t <= curve[0].t) return curve[0].semitones;
  const last = curve[curve.length - 1];
  if (t >= last.t) return last.semitones;
  let i = 1;
  while (curve[i].t < t) i++;
  const a = curve[i - 1]; const b = curve[i];
  return b.t === a.t ? b.semitones : a.semitones + ((b.semitones - a.semitones) * (t - a.t)) / (b.t - a.t);
};

/** Sum of two pitch curves (`base` may be undefined: the wheel alone). */
export function addWheelCurve(base, wheel) {
  if (!base?.length) return wheel;
  const dates = [...new Set([...base.map((p) => p.t), ...wheel.map((p) => p.t)])].sort((a, b) => a - b);
  return dates.map((t) => ({ t, semitones: levelAt(base, t) + levelAt(wheel, t) }));
}
