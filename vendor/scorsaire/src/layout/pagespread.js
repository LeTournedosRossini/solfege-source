/*
 * Vertical spread of a printed page (screen 2): the space left under the last system is shared between the gaps of the page, the way MuseScore
 * 4.7.5 does it (`PageLayout::distributeStaves`, `VerticalGapData`, and the plain system distribution when the spread is off).
 * Pure: it reads a first layout and a pagination and returns the extra space to give to every gap; the layout is then computed again with it
 * (`layoutMovement(..., { verticalPlan })`), so braces, brackets and barlines that link the staves follow by construction.
 *
 * A gap = the space above a staff (from the bottom line of the staff above, or from the top border for the first staff of the page).
 *  - the first staff of a page: fixed;
 *  - the first staff of a system: stretch factor `SPREAD_SYSTEM` (2.5), at most `MAX_SYSTEM_SPREAD` (32 sp) / factor;
 *  - a staff that starts a bracket or follows one: factor 1.2 (`SPREAD_SQUARE_BRACKET`); a staff that starts a brace or follows one: 1.1;
 *  - a staff inside a brace: at most `MAX_AKKOLADE` (6.5 sp) / factor; any other gap: at most `MAX_STAFF_SPREAD` (20 sp) / factor.
 * The smallest gaps grow first, up to the next smallest (equalising them), then what is left is spread with a limit of `maxFill` per gap.
 */

export const SPREAD_SYSTEM = 2.5;
export const SPREAD_SQUARE_BRACKET = 1.2;
export const SPREAD_CURLY_BRACKET = 1.1;
export const MAX_SYSTEM_SPREAD = 32;
export const MAX_STAFF_SPREAD = 20;
export const MAX_AKKOLADE = 6.5;
const EPS = 1e-9;
const isNull = (x) => Math.abs(x) < EPS;

/** One gap (port of VerticalGapData). */
function makeGap({ fixed = false, spacing, meta, firstOfSystem }) {
  const g = { fixed, factor: 1, norm: spacing, maxActual: fixed ? spacing : MAX_STAFF_SPREAD, added: 0, fill: 0, lastStep: 0 };
  const updateFactor = (f) => { if (g.fixed) return; const nf = Math.max(f, g.factor); g.norm *= g.factor / nf; g.factor = nf; };
  if (!fixed) {
    if (firstOfSystem) { updateFactor(SPREAD_SYSTEM); g.maxActual = MAX_SYSTEM_SPREAD / g.factor; }
    if (meta?.bracketBoundary) updateFactor(SPREAD_SQUARE_BRACKET);
    if (meta?.braceStart) updateFactor(SPREAD_CURLY_BRACKET);
    else if (meta?.braceInside) g.maxActual = MAX_AKKOLADE / g.factor;
  }
  return g;
}
const spacingOf = (g) => g.norm + g.added;
const isFixed = (g) => g.fixed || isNull(g.norm - g.maxActual);
function addSpacing(g, step) {
  if (g.fixed) return 0;
  if (g.norm >= g.maxActual) { g.norm = g.maxActual; step = 0; } else if (g.norm + g.added + step >= g.maxActual) step = g.maxActual - g.norm - g.added;
  g.added += step; g.lastStep = step;
  return step;
}
function addFillSpacing(g, step, maxFill) {
  const act = step + g.fill / g.factor > maxFill ? maxFill - g.fill / g.factor : step;
  const res = addSpacing(g, act);
  g.fill += res * g.factor;
  return res;
}
const sumFactor = (list) => list.reduce((s, g) => (isFixed(g) ? s : s + g.factor), 0);
function smallest(list, limit = -1) {
  let best = null;
  for (const g of list) {
    if (isFixed(g)) continue;
    if (Math.ceil(limit) === Math.ceil(spacingOf(g))) continue;
    if (!best || spacingOf(g) < spacingOf(best)) best = g;
  }
  return best ? spacingOf(best) : 0;
}

/** Shares `spaceRemaining` between the gaps (port of the two loops of `distributeStaves`). Mutates the gaps (`added`). */
export function distributeGaps(list, spaceRemaining, maxFill) {
  let remaining = spaceRemaining;
  let ngaps = list.length - 1;
  let pass = 0;
  while (!isNull(remaining) && ngaps > 0 && ++pass < 20) {
    ngaps = 0;
    const small = smallest(list);
    let next = smallest(list, small);
    if (isNull(small) || isNull(next)) break;
    const sum = sumFactor(list);
    if ((next - small) * sum > remaining) next = small + remaining / sum;
    let added = 0;
    const modified = [];
    for (const g of list) {
      if (!isNull(spacingOf(g) - small)) continue;
      let step = next - spacingOf(g);
      if (step < 0) continue;
      step = addSpacing(g, step);
      if (!isNull(step)) { added += step * g.factor; modified.push(g); ngaps += 1; }
      if (remaining - added <= 0) break;
    }
    if (remaining - added <= 0) { for (const g of modified) { g.added -= g.lastStep; g.lastStep = 0; } ngaps = 0; } else remaining -= added;
  }
  remaining = Math.min(maxFill * list.length, remaining);
  pass = 0; ngaps = 1;
  while (!isNull(remaining) && !isNull(maxFill) && ngaps > 0 && ++pass < 20) {
    ngaps = 0;
    let added = 0;
    const step = remaining / sumFactor(list);
    for (const g of list) {
      const res = addFillSpacing(g, step, maxFill);
      if (!isNull(res)) { added += res * g.factor; ngaps += 1; }
    }
    remaining -= added;
  }
}

/**
 * Plan of one movement.
 * @param layout  first layout (`layoutMovement`), with `layout.staffMeta`
 * @param pages   [{ indices: [system index…] }] (see paginate)
 * @param o       { contentHeight, upper, lower, spread (bool), maxFill }  (staff spaces)
 * @returns { systems: { [system index]: { before, staffGaps: [] } }, any }
 */
export function planVerticalSpread(layout, pages, { contentHeight, upper, lower, spread, maxFill, inks }) {
  const inkOf = (i) => inks?.[i] ?? { top: 0, bottom: layout.systems[i].height }; // where the ink of a system starts / ends (see partlayout.js)
  const out = {};
  let any = false;
  const mark = (si, patch) => { out[si] ??= { before: 0, staffGaps: [] }; Object.assign(out[si], patch); any = true; };
  for (const page of pages) {
    const sys = page.indices.map((i) => layout.systems[i]);
    const top = page.top ?? 0; // room taken above the music of this page (title block, header)
    const limit = page.limitBottom ?? contentHeight; // y where the music of this page must end (footer)
    const base = sys[0].top + inkOf(page.indices[0]).top - (upper + top); // page y = system y − base (the ink of the first system starts at `upper` under that room)
    const bottom = sys[sys.length - 1].top - base + inkOf(page.indices[page.indices.length - 1]).bottom;
    if (!spread) {
      continue; // spread off (default): systems stay as close as they are laid out, the distances set by the user (room above the first staff) are kept
      // plain distribution between systems (MuseScore: maxSystemDistance 15 sp, shortest distances first)
      const gaps = sys.length - 1;
      if (gaps < 1) continue;
      let rest = Math.max(0, limit - lower - bottom);
      const maxDist = 15;
      const list = [];
      for (let i = 0; i < gaps; i++) list.push({ i, distance: sys[i + 1].top - sys[i].top, height: sys[i].height });
      const orig = list.map((l) => l.distance);
      const sorted = [...list].sort((a, b) => (a.distance - a.height) - (b.distance - b.height));
      let dist = sorted[0].distance - sorted[0].height;
      for (let i = 1; i < sorted.length; i++) {
        const ndist = sorted[i].distance - sorted[i].height;
        let fill = ndist - dist;
        if (fill > 0) {
          let total = fill * i;
          if (total > rest) { total = rest; fill = rest / i; }
          for (let k = 0; k < i; k++) {
            const s = sorted[k]; let d = s.distance + fill;
            if (d - s.height > maxDist) d = Math.max(maxDist + s.height, s.distance);
            s.distance = d;
          }
          rest -= total;
          if (rest <= 0) break;
        }
        dist = ndist;
      }
      if (rest > 0) {
        const fill = rest / list.length;
        for (const s of list) { let d = s.distance + fill; if (d - s.height > maxDist) d = Math.max(maxDist + s.height, s.distance); s.distance = d; }
      }
      let shift = 0;
      list.forEach((l, k) => { shift += l.distance - orig[k]; if (!isNull(l.distance - orig[k])) mark(page.indices[k + 1], { before: l.distance - orig[k] }); });
      continue;
    }
    // vertical spread: one gap per staff
    const gapsList = [];
    const owners = []; // { sysIndex, staff }
    let prevBottom = upper + top;
    let lastStaffBottom = upper + top;
    sys.forEach((s, k) => {
      s.staves.forEach((st, j) => {
        const topY = s.top - base + st.top;
        const first = gapsList.length === 0;
        const meta = layout.staffMeta?.[j];
        gapsList.push(makeGap({ fixed: first, spacing: first ? upper + top : topY - prevBottom, meta, firstOfSystem: j === 0 }));
        owners.push({ sysIndex: page.indices[k], staff: j });
        prevBottom = s.top - base + st.originY;
        lastStaffBottom = prevBottom;
      });
    });
    const remaining = Math.min(limit - bottom, limit - lower - lastStaffBottom);
    if (remaining <= 0 || gapsList.length < 2) continue;
    distributeGaps(gapsList, remaining, maxFill);
    gapsList.forEach((g, n) => {
      const space = g.added * g.factor;
      if (isNull(space)) return;
      const { sysIndex, staff } = owners[n];
      if (staff === 0) mark(sysIndex, { before: space });
      else { out[sysIndex] ??= { before: 0, staffGaps: [] }; out[sysIndex].staffGaps[staff] = space; any = true; }
    });
  }
  return { systems: out, any };
}
