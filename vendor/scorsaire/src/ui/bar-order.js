/*
 * The ORDER of the buttons of the contextual bar (`ui/dom.js`): five families, always in the same order, so a button keeps its place whatever is selected (a note, a range, a
 * chord cell): 1 selection · 2 edition · 3 marks · 4 structure · 5 view. A button that does not apply is simply absent; the others only move inside their own family.
 * Every button already carries a `data-action` (or `data-range-menu`, keyed `menu:<name>`): this table is the only place that knows the order.
 *
 *   barKeyOf(el)               → the key of a button (`data-action`, or `menu:<data-range-menu>`), or null
 *   orderBarItems(items)       → { items: the same elements in family order, firstOfFamily: Set of the elements that begin a family but the first, endOfEdition: index just after
 *                                 the edition family (where the first page of a packed bar ends), or -1 }
 * A button the table does not know follows the button that came before it (a stepper stays with its unit button) or, first, goes to the marks. PURE apart from reading attributes.
 */
export const BAR_FAMILIES = Object.freeze(['selection', 'edit', 'marks', 'structure', 'view']);

const TABLE = Object.freeze({
  selection: ['range-clear', 'range-from-item', 'range-from-cell', 'range-grow', 'range-filter', 'select-similar'],
  edit: ['menu:edit', 'duplicate-again', 'delete', 'toggle-decor', 'toggle-decor-all', 'toggle-rest-hidden', 'move-toggle', 'move-reset', 'grips-toggle', 'grips-reset',
    'container-copy', 'container-edit', 'container-edit-fragment', 'container-edit-diagram'],
  marks: ['marks-toggle', 'retouch-toggle', 'glissando-run', 'lyrics-start', 'symbol-diagram', 'symbol-diagram-edit', 'stem-direction', 'chord-voice', 'bend-graph', 'bend-size-less', 'bend-size-more',
    'tempo-unit', 'velocity-pill', 'hairpin-type-'],
  structure: ['system-toggle', 'container-toggle', 'bar-toggle', 'menu:insert', 'menu:play', 'menu:auto', 'container-play'],
  view: ['range-focus', 'range-slashes', 'play-toggle', 'staff-play-switch', 'track-play-switch', 'staff-hide-switch', 'track-hide-switch', 'open-percmap', 'open-staff-props', 'menu:more'],
});

/** key → { family, rank }; keys ending with « - » are prefixes. */
const EXACT = new Map(); const PREFIX = [];
BAR_FAMILIES.forEach((family, f) => TABLE[family].forEach((key, rank) => {
  if (key.endsWith('-')) PREFIX.push({ key, family: f, rank }); else EXACT.set(key, { family: f, rank });
}));

export const barKeyOf = (el) => {
  const action = el?.getAttribute?.('data-action');
  if (action) return action;
  const menu = el?.getAttribute?.('data-range-menu');
  return menu ? `menu:${menu}` : null;
};

/** { family, rank } of a key, or null when the table does not know it. */
export function placeOf(key) {
  if (!key) return null;
  return EXACT.get(key) ?? PREFIX.find((p) => key.startsWith(p.key)) ?? null;
}

export function orderBarItems(items) {
  let last = { family: 2, rank: 999 }; // the marks
  const tagged = items.map((el, seq) => {
    const known = placeOf(barKeyOf(el));
    if (known) last = known;
    return { el, seq, family: last.family, rank: last.rank };
  });
  tagged.sort((a, b) => a.family - b.family || a.rank - b.rank || a.seq - b.seq);
  const firstOfFamily = new Set();
  let endOfEdition = -1;
  tagged.forEach((t, i) => {
    if (i > 0 && t.family !== tagged[i - 1].family) firstOfFamily.add(t.el);
    if (t.family > 1 && endOfEdition < 0 && tagged.some((x) => x.family === 1)) endOfEdition = i;
  });
  return { items: tagged.map((t) => t.el), firstOfFamily, endOfEdition };
}
