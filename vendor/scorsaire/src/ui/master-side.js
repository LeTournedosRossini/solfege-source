/*
 * Which side the master fader sits on, in the mixer of the score and in the media panel of screen 4 (the stems): 'left' (default) or 'right'. A device setting (not part of
 * the file), shared by both so that a person who prefers it on the right has it on the right everywhere. Storage may be unavailable: the default is used then.
 */
const KEY = 'scorsaire.masterSide';

export function masterSide() {
  try { return localStorage.getItem(KEY) === 'right' ? 'right' : 'left'; } catch { return 'left'; }
}

/** Sets the side ('left' | 'right') and returns the one now in force. */
export function setMasterSide(side) {
  const v = side === 'right' ? 'right' : 'left';
  try { localStorage.setItem(KEY, v); } catch { /* storage unavailable: the choice lasts until the page is closed only if the caller keeps it */ }
  return v;
}

export const flipMasterSide = () => setMasterSide(masterSide() === 'left' ? 'right' : 'left');
