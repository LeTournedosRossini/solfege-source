// Cues of the automatic players (PID.CUE_*, `createCue`): a sign on a measure that says what a drum player does there — which VERSION of its groove (from this measure on) or which BREAK (on this
// measure only). Everything stays automatic (model/variation.js, audio/drumplay.js) until a cue says otherwise. Call the editing functions INSIDE `doc.transaction`.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createCue } from './elements.js';
import { EditError } from './noteedit.js';

export const CUE_KINDS = Object.freeze(['groove', 'break', 'alt']);
/** The value of a groove cue for the main version, and of a break cue for "no break here". */
export const MAIN_VERSION = 'main';
export const NO_BREAK = 'none';

const sameTarget = (c, measureId, kind, trackId) => getProperty(c, PID.MEASURE_ID) === measureId && getProperty(c, PID.CUE_KIND) === kind && (getProperty(c, PID.CUE_TRACK) ?? null) === (trackId ?? null);

/** The cue of a kind on a measure for a track (null = the cue for every drum track), or null. */
export const cueAt = (mv, measureId, kind, trackId = null) => (mv.cues ?? []).find((c) => sameTarget(c, measureId, kind, trackId)) ?? null;

/**
 * Puts a cue on a measure: `{ kind, value, text?, trackId? }`. One cue per kind, measure and track: a cue already there is replaced.
 * A groove cue for the main version on a measure with nothing before it changes nothing but is kept (it is the author's word).
 */
export function setCue(doc, mv, measureId, { kind, value, text, trackId = null }) {
  if (!CUE_KINDS.includes(kind)) throw new EditError(`Unknown cue: ${kind}`);
  if (!mv.masterbars.some((b) => b.id === measureId)) throw new EditError(`Unknown measure: ${measureId}`);
  if (trackId && !mv.tracks.some((t) => t.id === trackId)) throw new EditError(`Unknown track: ${trackId}`);
  if (typeof value !== 'string' || !value) throw new EditError('A cue needs a value');
  const old = cueAt(mv, measureId, kind, trackId);
  if (old) doc.remove(old);
  const fresh = createCue({ measureId, kind, value, text, trackId: trackId ?? undefined });
  doc.add(mv, 'cues', fresh);
  return fresh;
}

/** Removes a cue (by id); true when something was removed. */
export function removeCue(doc, mv, id) {
  const c = (mv.cues ?? []).find((x) => x.id === id);
  if (!c) return false;
  doc.remove(c);
  return true;
}

/** The cues of a movement as simple entries, in score order: [{ id, measureId, measureIndex, kind, value, text, trackId }]. */
export function cueEntries(mv) {
  return (mv.cues ?? []).map((c) => ({
    id: c.id, measureId: getProperty(c, PID.MEASURE_ID), measureIndex: mv.masterbars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID)), kind: getProperty(c, PID.CUE_KIND), value: getProperty(c, PID.CUE_VALUE),
    text: getProperty(c, PID.TEXT) ?? '', trackId: getProperty(c, PID.CUE_TRACK) ?? null,
  })).sort((a, b) => a.measureIndex - b.measureIndex || a.kind.localeCompare(b.kind));
}

/**
 * What the cues say about each measure of a track: `{ version: (measureIndex) → 'main' | variant id | null, breakAt: (measureIndex) → fill id | 'none' | null, altAt: (measureIndex) → alternative phrase id | 'none' | null }`.
 * A groove cue holds from its measure on, until the next groove cue (for this track, else for every track: the cue of the track wins on its own measure);
 * a break cue holds on its measure only. PURE: reads the movement.
 */
export function cuesForTrack(mv, trackId) {
  const mine = cueEntries(mv).filter((c) => c.trackId === trackId || c.trackId === null);
  const groove = mine.filter((c) => c.kind === 'groove' && c.measureIndex >= 0);
  const breaks = new Map(); const alts = new Map();
  for (const c of mine.filter((x) => x.kind === 'break' && x.measureIndex >= 0)) if (!breaks.has(c.measureIndex) || c.trackId === trackId) breaks.set(c.measureIndex, c.value);
  for (const c of mine.filter((x) => x.kind === 'alt' && x.measureIndex >= 0)) if (!alts.has(c.measureIndex) || c.trackId === trackId) alts.set(c.measureIndex, c.value); // on its measure only, like a break
  return {
    version(k) {
      let found = null;
      for (const c of groove) if (c.measureIndex <= k && (!found || c.measureIndex > found.measureIndex || (c.measureIndex === found.measureIndex && c.trackId === trackId))) found = c;
      return found ? found.value : null;
    },
    breakAt: (k) => breaks.get(k) ?? null,
    altAt: (k) => alts.get(k) ?? null,
  };
}
