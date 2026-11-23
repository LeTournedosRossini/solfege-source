/*
 * Pages of the Lecteur: the systems of a laid-out song are packed into screens (a page = whole systems that fit the height of the screen, a system taller than the
 * screen gets a page of its own and is simply clipped). Pure: the positions are in pixels (spaces × `staffSpace` + `margin`).
 */

/**
 * @param o.hints  Set of measure indices where the author advises a page to START (model/pagehints.js). When a page is full, the cut moves back to the latest system that holds one of them, if the
 *                 page up to there is at least `minFill` full (never forced: a hint that would leave a nearly empty page is ignored). The page then starts with that WHOLE system.
 * @returns {{ y0: number, y1: number, first: number, last: number }[]} one entry per page; `y0` / `y1` = top and bottom of the page in the drawing
 */
export function paginateSystems(systems, { staffSpace, margin = 0, pageHeight, pad = 6, hints = null, minFill = 0.6 }) {
  const top = (s) => s.top * staffSpace + margin;
  const bottom = (s) => (s.top + s.height) * staffSpace + margin;
  // a laid-out system says which measures it holds: `first` and `last`, indices of the movement
  const hinted = (s) => { if (!hints?.size) return false; for (let m = s.first ?? -1; m <= (s.last ?? -2); m += 1) if (hints.has(m)) return true; return false; };
  const pages = [];
  let current = null;
  const open = (i) => { current = { y0: i === 0 ? 0 : Math.max(0, top(systems[i]) - pad), y1: bottom(systems[i]), first: i, last: i }; pages.push(current); };
  systems.forEach((s, i) => {
    if (current && bottom(s) - current.y0 <= pageHeight) { current.y1 = bottom(s); current.last = i; return; }
    if (current && hints?.size) { // the page is full: look back for a place the author advised, with enough music before it
      for (let j = i - 1; j > current.first; j -= 1) {
        if (!hinted(systems[j]) || bottom(systems[j - 1]) - current.y0 < pageHeight * minFill) continue;
        current.last = j - 1; current.y1 = bottom(systems[j - 1]);
        open(j); for (let k = j + 1; k < i; k += 1) { current.y1 = bottom(systems[k]); current.last = k; }
        if (bottom(s) - current.y0 <= pageHeight) { current.y1 = bottom(s); current.last = i; return; }
        break;
      }
    }
    open(i);
  });
  if (!pages.length) pages.push({ y0: 0, y1: pageHeight, first: 0, last: -1 });
  return pages;
}
