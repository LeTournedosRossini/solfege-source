/*
 * Packs the lines of the songbook view into pages of COLUMNS: the first column is filled down the page, then the next, then a new page. Pure (heights in px, no DOM).
 * A line is never cut. A group of lines (a verse) is kept whole in one column when it fits there: if it does not fit in what is left of the current column but would fit in an
 * empty one, it starts the next column; a group taller than a whole column simply continues from one column to the next, between two lines.
 */

/**
 * @param items     [{ height, group }] in reading order (`height` includes the room after the line; `group` identifies the verse the line belongs to)
 * @param capacity  height of one column
 * @param perPage   number of columns on a page
 * @param o.keepGroups    keep a verse whole in a column when it fits one (the default); false = lines flow on, a verse is cut wherever the column ends (a page of one column)
 * @param o.pagePerGroup  every verse starts a new page
 * @returns {number[][][]} pages → columns → indices of `items`
 */
export function packColumns(items, capacity, perPage = 2, { keepGroups = true, pagePerGroup = false } = {}) {
  const total = new Map();
  for (const it of items) total.set(it.group, (total.get(it.group) ?? 0) + it.height);
  const pages = []; let page = null; let column = null; let used = 0;
  const openColumn = () => {
    if (!page || page.length === perPage) { page = []; pages.push(page); }
    column = []; page.push(column); used = 0;
  };
  items.forEach((it, i) => {
    const startsGroup = i === 0 || items[i - 1].group !== it.group;
    if (pagePerGroup && startsGroup && i > 0) { page = null; column = null; } // a new verse: a new page (the first column of it)
    if (!column) openColumn();
    else if (column.length && used + it.height > capacity + 1e-6) openColumn(); // the line does not fit: next column
    else if (keepGroups && startsGroup && column.length && total.get(it.group) <= capacity && used + total.get(it.group) > capacity + 1e-6) openColumn(); // a whole verse that would be split but fits a column
    column.push(i); used += it.height;
  });
  return pages;
}
