/*
 * What a READER does for a SCALE container (a free nested score that carries `PID.SCALE_RECIPE`): the fragment written in the file is replaced by the scale calculated for the instrument of the
 * track that holds the container — the staff in his clef for a flute or a violin, the tablature for a guitar or a bass — in the view the reader asks (`SID.READER_SCALE`: auto | score | tab).
 * The layout calls this through `layout/scalehook.js`; nothing else knows. Cached by recipe, instrument and view.
 */
import { createMovement, createTrack } from '../model/elements.js';
import { setScaleHook } from '../layout/scalehook.js';
import { scaleContent } from './display.js';
import { instrumentOfTrack } from './instruments.js';

const cache = new Map();
export function scaleFragmentFor(container, recipe, hostTrack, mode) {
  const instrument = hostTrack ? instrumentOfTrack(hostTrack) : (recipe.instrument ?? 'piano');
  const view = mode === 'score' ? 'score' : mode === 'tab' ? 'tab' : undefined; // auto = the first view of the instrument
  const key = `${JSON.stringify(recipe)}|${instrument}|${view ?? ''}`;
  if (!cache.has(key)) {
    try {
      const base = { ...recipe }; delete base.position; if (view === undefined) delete base.view;
      const c = scaleContent(base, { instrument, ...(view ? { view } : {}) }, { plain: true });
      cache.set(key, createMovement({ masterbars: c.masterbars, tracks: [createTrack({ staves: c.tracks[0].staves })] }));
    } catch { cache.set(key, null); } // a scale the reader cannot calculate: the fragment of the file is drawn
  }
  return cache.get(key);
}
export const installScaleLayoutHook = () => setScaleHook(scaleFragmentFor);
