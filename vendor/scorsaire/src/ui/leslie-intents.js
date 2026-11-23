// Leslie signs (rotor speed of an organ, see audio/leslie.js): where the user may place one. Pure: no DOM.
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { instrumentInfo } from '../model/instruments.js';

/** Technique ids of the three signs, in the order of the Sys page. */
export const LESLIE_SIGNS = Object.freeze(['leslieChorale', 'leslieTremolo', 'leslieBrake']);

/**
 * Why a Leslie sign cannot go on a staff: 'needStaff' (no staff selected), 'notKeyboard' (not a pitched staff of a keyboard-group
 * instrument: tablature, percussion, chords, rhythm, accordion keyboard, lyrics… — pianos are allowed, an organ track often has a piano-like staff),
 * or null when it can.
 */
export function leslieStaffProblem(doc, staffId) {
  const staff = staffId ? doc.find(staffId) : null;
  if (!staff || staff.type !== 'staff') return 'needStaff';
  if ((getProperty(staff, PID.STAFF_TYPE) ?? 'score') !== 'score') return 'notKeyboard';
  const track = doc.parentOf(staff.id);
  const info = instrumentInfo(track ? getProperty(track, PID.INSTRUMENT_ID) : null);
  return info?.group === 'keyboards' ? null : 'notKeyboard';
}

/** True when a Leslie sign may be placed on this staff. */
export const leslieStaff = (doc, staffId) => leslieStaffProblem(doc, staffId) === null;
