/*
 * A SCALE MOVEMENT shown by a reader: the movement of the file carries the recipe (`PID.SCALE_RECIPE`) and the notes of the way the author wrote it; a reader replaces its content by what suits the
 * instrument of the pupil (the staff in his clef, written transposed for a transposing instrument, or the tablature of the position he chose). PURE: no DOM.
 *   scaleRecipeOf(movement) → the normalized recipe of a scale movement, or null
 *   scaleContent(recipe, choice) → { tracks, masterbars, recipe, view, system, systems, position, positions } : the content to put in the movement (fresh identifiers)
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { hydrate } from '../model/serialize.js';
import { cloneWithFreshIds } from '../model/partcontainers.js';
import { normalizeRecipe, scaleOf } from './recipe.js';
import { buildScaleDoc, positionOf } from './document.js';
import { instrumentViews } from './instruments.js';

export function scaleRecipeOf(movement) {
  const raw = getProperty(movement, PID.SCALE_RECIPE);
  if (!raw) return null;
  try { normalizeRecipe(raw); return raw; } catch { return null; }
}

/** `choice` = what the pupil picked { instrument, view, system, position, cagedSpan } over the recipe of the file. */
export function scaleContent(base, choice = {}, opts = {}) {
  const recipe = normalizeRecipe({ ...base, ...Object.fromEntries(Object.entries(choice).filter(([, v]) => v !== undefined && v !== null)) });
  const built = buildScaleDoc(recipe, opts);
  const mv = hydrate(cloneWithFreshIds(JSON.parse(JSON.stringify(built.doc.work.movements[0]))));
  let pos = null;
  if (recipe.view === 'tab' || recipe.view === 'fretboard') { try { pos = positionOf(recipe); } catch { pos = null; } }
  // (the keyboard is a drawing of the scale component, not of a score)
  return { tracks: mv.tracks, masterbars: mv.masterbars, recipe, views: instrumentViews(recipe.instrument).filter((v) => v !== 'keyboard'), scale: scaleOf(recipe), pos };
}
