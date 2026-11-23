// The ALTERNATIVE PHRASES of a chord / bass player (`alts` of a chord pattern, model/chordpatterns.js): which one, if any, each played measure plays instead of the end of the main pattern.
// PURE. What a break is to a drummer (audio/drumplay.js), for the other players. Nothing is drawn at random while playing: the seed of the player decides (model/variation.js).
//   1. a CUE on the score (model/cueedit.js, kind 'alt') is the author's word: that phrase on that measure, or 'none';
//   2. the card's `altBeforeSection`: always one on the last bar before a change of section (never on the last bar of the piece);
//   3. else by chance (`chance` of each phrase, 0 by default), only before a change of section with `altOnlyBeforeSection`, and `altSpacing` bars apart.
// Both options are off by default: unless a cue asks, the main pattern plays.
import { structureOfSlots, structureWeight, createVariationPicker } from '../model/variation.js';
import { cuesForTrack } from '../model/cueedit.js';

/**
 * @param p { pattern (checked), mv, track, slots, options (`strumOptionsFor(card)`), seed }
 * @returns an array with, for each played measure, an alternative phrase of the pattern or null
 */
export function altPhrases({ pattern, mv, track, slots, options = {}, seed = 0 }) {
  const alts = pattern.alts ?? [];
  if (!alts.length) return slots.map(() => null);
  const cues = cuesForTrack(mv, track.id);
  const structure = structureOfSlots(mv, slots);
  const picker = createVariationPicker({ seed });
  let last = -Infinity;
  return slots.map((slot, k) => {
    const said = cues.altAt(slot.measure);
    if (said === 'none') return null;
    const asked = said ? alts.find((a) => a.id === said) : null;
    if (asked) { last = k; return asked; }
    const st = structure[k];
    const beforeChange = st.barsLeft === 0 && k < slots.length - 1;
    if (options.altBeforeSection && beforeChange && k > 0) { last = k; return alts[Math.floor(picker.pick(`alt|${k}|which`) * alts.length)]; }
    if (options.altOnlyBeforeSection && !beforeChange) return null;
    if (k - last < (options.altSpacing ?? 0)) return null;
    for (const a of alts) {
      if (a.chance > 0 && picker.decide({ id: `alt|${k}|${a.id}`, key: st.key, occurrence: st.occurrence, chance: a.chance, weight: structureWeight(st, 1.5) })) { last = k; return a; }
    }
    return null;
  });
}
