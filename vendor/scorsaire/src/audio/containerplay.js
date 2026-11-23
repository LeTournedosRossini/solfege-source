/*
 * Listening to the score of ONE container (the play button of the container editor): the nested score alone, as a small movement, never mixed with the
 * piece. It takes the timbre of the staff the container hangs on (the instrument of that track), and the tempo in force at the measure it sits on.
 * PURE: `buildContainerSequence(doc, containerId, options)` → a sequence ready for `engine.load`, or null when there is nothing to play.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { createTempo } from '../model/elements.js';
import { buildSequence } from './sequence.js';

/** A copy of an element that replaces one own property, keeping the non-enumerable readers (`staff.clef`…) the plain spread would drop. */
function withOwn(el, key, value) {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(el));
  Object.defineProperty(copy, key, { value, enumerable: true, writable: true, configurable: true });
  return copy;
}

/** The last explicit tempo (normal kind, with a bpm) at or before the measure `index` of `movement`, or null. */
function tempoBefore(movement, index) {
  let best = null; let bestAt = -1;
  for (const t of movement.tempos ?? []) {
    const at = movement.masterbars.findIndex((b) => b.id === getProperty(t, PID.MEASURE_ID));
    if (at < 0 || at > index || at < bestAt) continue;
    if ((getProperty(t, PID.TEMPO_KIND) ?? 'normal') !== 'normal' || !(getProperty(t, PID.TEMPO_BPM) > 0)) continue;
    best = t; bestAt = at;
  }
  return best;
}

/** @param doc the Document ; @param containerId a staff container with a nested score ; @param options passed to `buildSequence` (speed…) */
export function buildContainerSequence(doc, containerId, options = {}) {
  const container = doc.find(containerId);
  const fragment = container?.fragments?.[0];
  if (!fragment || !fragment.masterbars.length) return null;
  const host = doc.hostStaffOf(containerId);
  const hostTrack = host ? doc.parentOf(host.id) : null;
  const hostMovement = host ? doc.movementOf(host) : null;
  let movement = fragment;
  // the timbre of the staff below: the instrument of its track, on the first track of the nested score
  const instrumentId = hostTrack ? getProperty(hostTrack, PID.INSTRUMENT_ID) : null;
  if (instrumentId && fragment.tracks.length) {
    const first = fragment.tracks[0];
    movement = withOwn(movement, 'tracks', fragment.tracks.map((t, i) => (i === 0 ? withOwn(t, 'props', { ...t.props, [PID.INSTRUMENT_ID]: instrumentId }) : t)));
  }
  // the tempo of the piece where the container sits (the nested score has none of its own)
  if (hostMovement && !(fragment.tempos ?? []).length) {
    const at = hostMovement.masterbars.findIndex((b) => b.id === getProperty(container, PID.MEASURE_ID));
    const tempo = at >= 0 ? tempoBefore(hostMovement, at) : null;
    if (tempo) movement = withOwn(movement, 'tempos', [createTempo({ measureId: fragment.masterbars[0].id, bpm: getProperty(tempo, PID.TEMPO_BPM), beatUnit: getProperty(tempo, PID.BEAT_UNIT) })]);
  }
  const seq = buildSequence(movement, { ...options, chordSymbols: { play: false, ...(options.chordSymbols ?? {}) } });
  return seq.notes.length ? seq : null;
}
