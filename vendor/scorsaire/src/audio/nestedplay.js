/*
 * Playback of the nested scores of stacked containers (`PID.CONTAINER_PLAY`): 'add' plays the nested staves in addition to the staff below, 'replace' also
 * silences that staff on the measures the container covers. Pure: it only builds the list of staves handed to the sequencer. A nested score is
 * aligned on the measures of the piece (same lengths: validate.js), so it is shown to the sequencer like a staff whose earlier measures are empty and
 * it takes the timbre / track of the staff it sits on. A free layout, a container between measures or a text is never played.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { shimStaff } from '../layout/nestedshim.js';

/** Containers of `staff` that are played, with the index of their first measure. */
export function playedContainers(staff, movement) {
  const out = [];
  for (const c of staff.containers ?? []) {
    const mode = getProperty(c, PID.CONTAINER_PLAY);
    if (!mode || mode === 'none') continue;
    if (getProperty(c, PID.CONTAINER_KIND) !== 'nestedNotation' || getProperty(c, PID.CONTAINER_PLACEMENT) === 'between' || getProperty(c, PID.CONTAINER_LAYOUT) === 'free') continue;
    const fragment = c.fragments?.[0];
    const first = movement.masterbars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID));
    if (!fragment || first < 0) continue;
    out.push({ container: c, mode, first, span: getProperty(c, PID.SPAN) ?? 1, fragment });
  }
  return out;
}

/**
 * The staves of `track` as the sequencer must read them: every staff, in order, each followed by the (padded) staves of its played nested scores;
 * a staff covered by a 'replace' container has its covered measures emptied (all voices).
 */
export function staffListWithNested(track, movement) {
  const list = [];
  for (const staff of track.staves) {
    const played = playedContainers(staff, movement);
    if (!played.length) { list.push(staff); continue; }
    const silent = new Set();
    for (const p of played) if (p.mode === 'replace') for (let k = 0; k < p.span; k += 1) silent.add(p.first + k);
    list.push(silent.size
      ? { ...staff, voices: staff.voices.map((v) => ({ ...v, measures: v.measures.map((m, i) => (silent.has(i) ? { ...m, items: [] } : m)) })) }
      : staff);
    for (const p of played) for (const nested of p.fragment.tracks.flatMap((t) => t.staves)) list.push(shimStaff(nested, p.first));
  }
  return list;
}
