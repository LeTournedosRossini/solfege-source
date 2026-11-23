/*
 * Play offset of a chord symbol (chord staff): the symbol keeps its WRITTEN position but sounds earlier (advance, negative) or later (delay, positive).
 * Pure helpers shared by validation, playback and layout. Offsets are fractions of a whole note.
 */
import { frac, fAdd, fSub, fCmp, fEq, ZERO, isFraction } from './fraction.js';

const STEPS = [frac(1, 16), frac(1, 8), frac(3, 16), frac(1, 4)];
export const PLAY_OFFSETS = Object.freeze([...STEPS.map((f) => frac(-f[0], f[1])).reverse(), ...STEPS]);
const BEAT = frac(1, 4); // the beat used for the note value of a delay (quarter note; compound meters use it too)

/** null/absent = no offset; otherwise one of the allowed values. */
export function isAllowedPlayOffset(value) {
  if (value === null || value === undefined) return true;
  return isFraction(value) && PLAY_OFFSETS.some((o) => fEq(o, value));
}

/** The sounding position (measure-relative, may be negative = previous measure) of a symbol written at `position`. */
export const soundingPosition = (position, offset) => (offset ? fAdd(position, offset) : position);

/**
 * Value of the small rhythm note drawn at the sounding point.
 * Advance: the offset itself. Delay: the distance from the target to the next beat boundary (a target on the beat gives a whole beat).
 * @param target  sounding position inside ITS measure (0 = measure start)
 */
export function offsetNoteValue(offset, target) {
  if (fCmp(offset, ZERO) < 0) return frac(-offset[0], offset[1]);
  let rest = target;
  while (fCmp(rest, BEAT) >= 0) rest = fSub(rest, BEAT);
  return fEq(rest, ZERO) ? BEAT : fSub(BEAT, rest);
}

/** Does the delay land exactly on a beat (the arrow then starts at the far left of the root letter)? */
export function landsOnBeat(target) {
  let rest = target;
  while (fCmp(rest, BEAT) >= 0) rest = fSub(rest, BEAT);
  return fEq(rest, ZERO);
}

const GLYPHS = new Map([['1/16', ['metNote16thUp', false]], ['1/8', ['metNote8thUp', false]], ['3/16', ['metNote8thUp', true]], ['1/4', ['metNoteQuarterUp', false]]]);
/** { glyph, dot } for a note value, or null. */
export function noteGlyphFor(value) {
  const g = GLYPHS.get(`${value[0]}/${value[1]}`);
  return g ? { glyph: g[0], dot: g[1] } : null;
}
