/*
 * How many buttons the context bar shows in a row, and how a longer list is cut into pages. The count follows the REAL width of the bar (a tablet in a narrow
 * window behaves like a phone), unless the user fixes it for this device (kept in the browser, never in the Document, like the button size).
 *   slots = floor((width + gap) / (button + gap)), kept between MIN_SLOTS and MAX_SLOTS (a page holds at least Jean's six chosen buttons and an arrow)
 * `slotsFor` and `paginate` are pure (tested without a DOM).
 */
export const BAR_BUTTONS_KEY = 'scorsaire.barButtons';
export const BAR_BUTTONS_CHOICES = Object.freeze(['auto', '7', '9', '12', '14']);
export const MIN_SLOTS = 7;
export const MAX_SLOTS = 16;
export const BAR_GAP = 4;
export const BAR_PADDING = 16;

/** Slots of a row. `choice` = 'auto' or a number (as text); `width` = usable width in px; `target` = button size in px. */
export function slotsFor({ choice = 'auto', width, target }) {
  const fixed = Number(choice);
  if (Number.isFinite(fixed) && fixed > 0) return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, Math.round(fixed)));
  const n = Math.floor((width - BAR_PADDING + BAR_GAP) / (target + BAR_GAP));
  return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, Number.isFinite(n) ? n : MIN_SLOTS));
}

/**
 * Cut `keys` into pages of at most `slots` buttons, arrows included: the first page keeps a place for "›", the middle ones for "‹" and "›", the last one
 * for "‹". Everything fits in one page → no arrows. Returns [{ keys, prev, next }].
 */
export function paginate(keys, slots) {
  const pages = [];
  let i = 0;
  while (i < keys.length || !pages.length) {
    const first = pages.length === 0;
    const remaining = keys.length - i;
    const take = first ? (remaining <= slots ? remaining : slots - 1) : (remaining <= slots - 1 ? remaining : slots - 2);
    pages.push({ keys: keys.slice(i, i + take), prev: !first, next: i + take < keys.length });
    i += take;
    if (take <= 0) break;
  }
  return pages;
}

const readStored = (storage) => { try { const v = storage?.getItem(BAR_BUTTONS_KEY); return BAR_BUTTONS_CHOICES.includes(v) ? v : 'auto'; } catch { return 'auto'; } };

/** The device's choice, shared by the settings menu and the context bar. */
export function createBarButtons(storage = (typeof localStorage === 'undefined' ? null : (() => { try { return localStorage; } catch { return null; } })())) {
  let choice = readStored(storage);
  const listeners = new Set();
  return {
    choice: () => choice,
    set(next) {
      if (!BAR_BUTTONS_CHOICES.includes(next) || next === choice) return;
      choice = next;
      try { storage?.setItem(BAR_BUTTONS_KEY, next); } catch { /* optional */ }
      for (const fn of listeners) fn(choice);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    slots: (width, target) => slotsFor({ choice, width, target }),
  };
}
export const barButtons = createBarButtons();

/**
 * Pages cut by the MEASURED widths of the items (buttons are not all the same width: a text switch is wider than a square button). `widths` = pixel width of each
 * item, `avail` = usable width of the bar, `arrow` = width of a « ‹ » / « › » button, `gap` = space between items. Everything fits → one page, no arrows. Otherwise the
 * first page keeps a place for « › », the others for « ‹ » and « › » (the last one only « ‹ »); `breakAt` (an index) ends the first page right before that item when it
 * fits. Every page holds at least one item. Returns [{ from, to, prev, next }] (item index ranges).
 */
export function packPages(widths, avail, { arrow = 34, gap = BAR_GAP, breakAt = -1 } = {}) {
  const n = widths.length;
  const span = (from, to) => { let w = 0; for (let i = from; i < to; i++) w += widths[i] + (i > from ? gap : 0); return w; };
  if (span(0, n) <= avail) return [{ from: 0, to: n, prev: false, next: false }];
  const pages = [];
  let from = 0;
  while (from < n) {
    const first = pages.length === 0;
    const prevW = first ? 0 : arrow + gap;
    // all the rest fits with only the « ‹ » arrow: last page
    if (prevW + span(from, n) <= avail) { pages.push({ from, to: n, prev: !first, next: false }); break; }
    let to = from;
    while (to < n && prevW + span(from, to + 1) + gap + arrow <= avail) to += 1;
    if (first && breakAt > from && breakAt <= to) to = breakAt;
    if (to === from) to = from + 1;
    pages.push({ from, to, prev: !first, next: true });
    from = to;
  }
  return pages;
}
