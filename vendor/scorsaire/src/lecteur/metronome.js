/*
 * The visual metronome of the Lecteur: how long one beat lasts in a song (its first tempo), and how bright the bar is at a given instant. PURE: the page
 * only draws the number this returns. The beat is the unit the tempo is written in (a dotted quarter for a 6/8 marked ♩. = 60), as the player counts it.
 */
import { tempoTimeline } from '../model/tempomap.js';
import { beatUnitFraction } from '../model/tempo.js';
import { fToNumber } from '../model/fraction.js';

/** The fastest flashing the bar does (flashes per second): a quicker tempo flashes every second beat, which also keeps clear of the rates that bother people sensitive to flicker. */
export const MAX_FLASHES_PER_SECOND = 3;

/**
 * How the bar flashes for a movement: `period` = seconds between two flashes, `every` = how many beats of the tempo one flash covers (1 = every beat). The beat is that of
 * the first tempo (120 ♩ when the song has none); while it would flash too fast the bar flashes every second beat, then every fourth…
 */
export function flashPlan(movement) {
  const first = tempoTimeline(movement).events[0];
  let period = first && first.wps > 0 ? fToNumber(beatUnitFraction(first.unit)) / first.wps : 0.5;
  if (!Number.isFinite(period) || period <= 0) period = 0.5;
  let every = 1;
  while (period < 1 / MAX_FLASHES_PER_SECOND) { period *= 2; every *= 2; }
  return { period: Math.min(period, 12), every };
}

/** Seconds between two flashes (see `flashPlan`). */
export const flashPeriod = (movement) => flashPlan(movement).period;

/** Brightness (1 at the beat, fading to 0 within about half a beat) at `now` seconds, for a pulse that started at `start` seconds. Locked to the clock, so it never drifts. */
export function flashLevel(now, start, period) {
  if (!(period > 0)) return 0;
  const phase = (((now - start) % period) + period) % period / period;
  return phase < 0.5 ? 1 - phase * 2 : 0;
}
