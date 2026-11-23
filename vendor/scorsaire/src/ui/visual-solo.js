// « Visual solo »: a long press on the eye of a track shows ONLY that track (to read it on its own while transcribing); the same long press again puts back what was
// shown before. PURE: the three screens keep their own list of what is shown (screen 1: the visible flags of the tracks, screen 2: the staves of a part, screen 3: the
// tracks of a cell) and ask this function what the list becomes.

/**
 * @param all     every id that can be shown (in order)
 * @param shown   the ids shown now
 * @param target  the ids to show alone
 * @param saved   what was shown before the solo (null when no solo is active)
 * @returns { shown: ids, saved: ids | null, active: boolean }
 */
export function nextVisualSolo({ all, shown, target, saved = null }) {
  const now = new Set(shown);
  const alone = now.size === target.length && target.every((id) => now.has(id));
  if (alone) { // already alone: back to what was shown (everything when it is not known)
    const back = (saved ?? all).filter((id) => all.includes(id));
    return { shown: back.length ? back : [...all], saved: null, active: false };
  }
  return { shown: [...target], saved: saved ?? [...shown], active: true };
}

/** With the option « the visual solo is also an audio solo »: puts (or takes off) the audio solo of the track. */
export function applyAudioSolo(app, trackId, active) {
  if (!app.visualSoloAudio?.()) return;
  app.clearSolo();
  if (active) app.setTrackSolo(trackId, true);
}
