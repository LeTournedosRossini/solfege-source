/*
 * A CLICK on every measure start that is already placed on a recording (the taps of the tapping window, the measures of a map being corrected): while the recording plays, a short click
 * sounds at the instant of each one, so the person HEARS whether it falls on the beat. The clicks are scheduled a quarter of a second ahead from the position of the player (a video's
 * position is read a few times a second: it is a help to the ear, within a few hundredths of a second, not a measurement). Going back in the recording makes the passage click again.
 * `playClick` and `createAnchorClicker` take an AudioContext (made on demand, resumed by the page's first gesture).
 */

/** A short click at the audio-context time `when`; `accent` is higher and louder. */
export function playClick(ctx, when, accent = false) {
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(accent ? 0.7 : 0.45, when + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  osc.connect(gain).connect(ctx.destination); osc.start(when); osc.stop(when + 0.05);
}

/**
 * @param o.player   the player: `state()` → { position, playing, buffering?, rate }
 * @param o.times    () → the recording instants (s) to click on
 * @param o.getCtx   () → an AudioContext
 * @param o.enabled  () → whether the clicks sound (the person's switch)
 * Returns { start, stop, tick } — `tick` is the scheduling step (the timer calls it; tests too).
 */
export function createAnchorClicker({ player, times, getCtx, enabled = () => true, interval = 30, ahead = 0.25, setTimer = setInterval, clearTimer = clearInterval, click = playClick }) {
  let timer = null; let last = -Infinity; const done = new Set();
  function tick() {
    const st = player.state();
    if (!st.playing || st.buffering) return;
    if (st.position < last - 0.2) done.clear(); // the recording went back: the clicks of that passage come again
    last = st.position;
    if (!enabled()) return;
    const rate = st.rate || 1; const list = times(); let ctx = null;
    for (let i = 0; i < list.length; i += 1) {
      const d = (list[i] - st.position) / rate;
      if (d < -0.05 || d >= ahead || done.has(i)) continue;
      ctx ??= getCtx();
      click(ctx, ctx.currentTime + Math.max(0, d), true); done.add(i);
    }
  }
  return {
    tick,
    start() { if (timer === null) timer = setTimer(tick, interval); },
    stop() { if (timer !== null) { clearTimer(timer); timer = null; } done.clear(); last = -Infinity; },
  };
}
