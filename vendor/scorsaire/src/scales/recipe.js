/*
 * The RECIPE of a scale given to a pupil: what is stored (never the notes nor the frets, they are calculated when shown).
 *   { scale: id, root: 'D', alias?: key of a display name, instrument?: id, view?: 'score'|'tab'|'fretboard', system?: 'caged'…, position?: id of a position, cagedSpan?: 4|5, custom?: { formula, name } }
 * `normalizeRecipe` returns a clean recipe (or throws a RecipeError with a code): unknown scale, unknown root, impossible view for the instrument…
 */
import { lib, CATALOGUE_VERSION } from './index.js';
import { SCALE_INSTRUMENTS, DEFAULT_INSTRUMENT, parseInstrument, instrumentViews, defaultView } from './instruments.js';

export class RecipeError extends Error { constructor(code, message) { super(message); this.name = 'RecipeError'; this.code = code; } }
export const VIEWS = Object.freeze(['score', 'tab', 'fretboard', 'keyboard']);

/** `open`: a recipe WITHOUT instrument stays without (« according to the pupil »); otherwise a missing instrument is the piano. */
export function normalizeRecipe(input = {}, { open = false } = {}) {
  const r = typeof input === 'string' ? JSON.parse(input) : { ...input };
  let scale;
  if (r.custom && typeof r.custom.formula === 'string') {
    try { scale = lib.custom(r.custom.formula, { name: String(r.custom.name ?? '').slice(0, 60) || undefined }); } catch { throw new RecipeError('formula', `Unreadable formula: ${r.custom.formula}`); }
  } else {
    scale = lib.get(r.scale);
    if (!scale) throw new RecipeError('scale', `Unknown scale: ${r.scale}`);
  }
  const root = String(r.root ?? 'C');
  try { lib.notes(scale, root); } catch { throw new RecipeError('root', `Unknown root: ${root}`); }
  const instrument = parseInstrument(r.instrument) ?? (open ? null : DEFAULT_INSTRUMENT);
  const views = instrument ? instrumentViews(instrument) : VIEWS;
  const view = VIEWS.includes(r.view) && views.includes(r.view) ? r.view : (instrument ? defaultView(instrument) : undefined);
  const out = { scale: r.custom ? null : scale.id, root };
  if (instrument) out.instrument = instrument;
  if (view) out.view = view;
  if (r.custom) out.custom = { formula: r.custom.formula, name: r.custom.name ?? null };
  if (typeof r.alias === 'string' && r.alias) out.alias = r.alias;
  if (typeof r.system === 'string' && r.system) out.system = r.system;
  if (typeof r.position === 'string' && r.position) out.position = r.position;
  if (r.cagedSpan === 4 || r.cagedSpan === 5) out.cagedSpan = r.cagedSpan;
  out.catalogue_version = CATALOGUE_VERSION;
  return out;
}
export const scaleOf = (recipe) => (recipe.custom ? lib.custom(recipe.custom.formula, { name: recipe.custom.name ?? undefined }) : lib.get(recipe.scale));
export { SCALE_INSTRUMENTS };
