/*
 * Smoothed playback clock for the DISPLAY of the play cursor. The audio clock is read in coarse steps (output buffers, render quanta), so a cursor placed on
 * the raw value advances by uneven amounts from one frame to the next. This clock extrapolates from the page's own timer and corrects itself softly toward
 * each reading; a large gap (seek, loop restart) snaps at once. It only drives what is DRAWN: sound and exact positions never use it.
 */
export function createSmoothClock({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), snap = 0.08, gain = 0.1 } = {}) {
  let estimate = null;
  let last = 0;
  return {
    reset() { estimate = null; },
    /** `observed` = seconds read from the audio clock; returns the smoothed seconds. */
    read(observed, playing) {
      const t = now();
      if (!playing || estimate == null) { estimate = observed; last = t; return observed; }
      let predicted = estimate + (t - last) / 1000;
      last = t;
      const error = observed - predicted;
      predicted = Math.abs(error) > snap ? observed : predicted + error * gain;
      estimate = predicted;
      return predicted;
    },
  };
}
