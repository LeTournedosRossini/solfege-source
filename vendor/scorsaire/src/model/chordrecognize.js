/*
 * Recognising a chord from a fingering: which chord symbol { root, quality, bass } does a fingering sound? PURE. Used to PROPOSE a name (never to write one by itself): the
 * fingerings of a tablature that have no chord symbol wait in a layer to be named, and the name found here is the one already filled in.
 *
 * Every pitch class that sounds is tried as the root; a quality of the dictionary fits when every sounding note belongs to it, the root sounds, the third (if the quality has
 * one) sounds, and the fifth may be left out. Among the readings, the best is the one that leaves out the fewest notes of the quality, has the bass note as its root, and comes
 * first in the dictionary (the common qualities are first). A bass note that is not the root makes a slash chord.
 */
import { voicingPitches } from './fretvoicing.js';
import { DEFAULT_CHORD_QUALITY_DICTIONARY } from './chordquality.js';

const mod12 = (n) => ((n % 12) + 12) % 12;
// how a pitch class is spelled when nothing says better: flats for the usual flat keys (Db Eb Ab Bb), F# for 6
const SPELLING = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
const noteOf = (pc) => ({ step: SPELLING[mod12(pc)][0], alter: SPELLING[mod12(pc)][1] });

/**
 * @param voicing a fingering (`createVoicing`)
 * @param dict    the chord-quality dictionary (the work's), default the standard one
 * @returns { root: { step, alter }, quality, bass: { step, alter } | null } or null when nothing fits (fewer than two different notes, a cluster)
 */
export function suggestChordName(voicing, dict = DEFAULT_CHORD_QUALITY_DICTIONARY) {
  const pitches = voicingPitches(voicing).filter((p) => p !== null);
  const pcs = [...new Set(pitches.map(mod12))];
  if (pcs.length < 2) return null;
  const bassPc = mod12(Math.min(...pitches));
  const qualities = dict?.qualities ?? DEFAULT_CHORD_QUALITY_DICTIONARY.qualities;
  let best = null;
  for (const rootPc of pcs) {
    const rel = new Set(pcs.map((pc) => mod12(pc - rootPc)));
    qualities.forEach((q, order) => {
      const qrel = new Set(q.intervals.map(mod12));
      for (const r of rel) if (!qrel.has(r)) return; // a sounding note the quality does not have
      const needs = [...qrel].filter((i) => i === 3 || i === 4); // the third defines major / minor: it must sound
      if (needs.length && !needs.some((i) => rel.has(i))) return;
      const missing = [...qrel].filter((i) => !rel.has(i) && !(i === 7 && qrel.size > 2)).length; // an omitted fifth is free (except in a power chord)
      const score = missing * 4 + (rootPc === bassPc ? 0 : 6) + order * 0.1;
      if (!best || score < best.score) best = { score, rootPc, quality: q.id };
    });
  }
  if (!best) return null;
  return { root: noteOf(best.rootPc), quality: best.quality, bass: best.rootPc === bassPc ? null : noteOf(bassPc) };
}
