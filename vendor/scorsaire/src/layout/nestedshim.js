/*
 * Nested staves of a STACKED container (`container.staves`, aligned on the measures it covers): the painters index the measures of a voice by
 * the index of the masterbar, so a nested staff is shown to them as a staff whose measures are padded up to the anchor measure.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';

/** Placeholder for the measures before the anchor (painters iterate every measure of a voice; this one is empty and never drawn). */
export const PAD_MEASURE = Object.freeze({ id: 'm-pad', type: 'measure', props: {}, items: [] });

export function shimStaff(nested, anchorIndex) {
  const padding = new Array(anchorIndex).fill(PAD_MEASURE);
  return { ...nested, voices: nested.voices.map((v) => ({ ...v, measures: [...padding, ...v.measures] })) };
}

/**
 * Per-staff context overrides of an ALIGNED nested score (the fragment of a stacked container): `transpose: false` when the notes are shown as
 * entered (`containerTransposeFollow` false); `keySigs` / `timeSigs` / `beamGroupings` (indexed by main masterbar) where the score has its OWN
 * signature (`containerShowKeySig` / `containerShowTimeSig`), so its notes are spelled and beamed against it. `first` = index of the anchor masterbar.
 */
export function nestedRefOptions(movement, container, first) {
  const opts = {};
  if (getProperty(container, PID.CONTAINER_TRANSPOSE_FOLLOW) === false) opts.transpose = false;
  const fragment = container.fragments?.[0];
  if (!fragment || getProperty(container, PID.CONTAINER_LAYOUT) === 'free') return opts;
  const pick = (pid) => movement.masterbars.map((mb, i) => getProperty(i >= first && i - first < fragment.masterbars.length ? fragment.masterbars[i - first] : mb, pid));
  if (getProperty(container, PID.CONTAINER_SHOW_KEYSIG)) opts.keySigs = pick(PID.KEY_SIG);
  if (getProperty(container, PID.CONTAINER_SHOW_TIMESIG)) { opts.timeSigs = pick(PID.TIME_SIG); opts.beamGroupings = pick(PID.BEAM_GROUPING); }
  return opts;
}
