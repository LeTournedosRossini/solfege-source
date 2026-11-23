// The scale catalogue and the calculator of the scale pack (Jean, 02/11/2026), ready to use: `lib.notes(scale, root)`, `lib.positions(...)`, `lib.list(...)`. Pure: no DOM.
import ScaleLib from './scales-lib.cjs';
import data from './scales.json' with { type: 'json' };

export const lib = ScaleLib.create(data, { lang: 'fr' });
export const TUNINGS = ScaleLib.TUNINGS;
export const CATALOGUE_VERSION = data.meta.version;
export const LEVELS = data.meta.levels;
export const CATEGORIES = data.meta.categories;
/** The twelve roots offered (sharp spelling first, the flat one when it is the usual one). */
export const ROOTS = Object.freeze(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);
