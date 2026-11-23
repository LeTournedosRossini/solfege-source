/*
 * System dividers between the systems of ONE page (MuseScore 4.7.5 `PageLayout::layoutSystemDividers` / `updateSystemDivider`, rule by rule):
 *   - a divider is drawn after every system that is followed by another system on the same page (never after the last one of a page);
 *   - aligned to the system barline (default): centred on the outermost left barline (smallest `x0`) of the page, or on the outermost right barline (largest `x0 + width`);
 *     not aligned: at the left edge of the system, or flush with its right edge;
 *   - vertically: the middle of the glyph box sits halfway between the bottom line of the last staff of this system and the top line of the first staff of the next one;
 *   - the X and Y offsets (spaces, Y down) and the size factor are added.
 * The dividers are overlays of the system (system coordinates, y down), so nothing in the layout moves. The systems are copied, never changed in place (they may be cached).
 */
const topOf = (st) => {
  if (Number.isFinite(st.top)) return st.top;
  const ys = (st.items ?? []).filter((it) => it.role === 'staff-line').map((it) => it.y1);
  return ys.length ? st.originY - (Math.max(...ys) - Math.min(...ys)) : st.originY;
};

/** Adds the dividers described by `settings` (model/dividers.js `resolveDividers`) to the systems of a page; returns the new list. */
export function addSystemDividers(systems, settings, glyphs) {
  if (!settings || (!settings.left && !settings.right) || systems.length < 2) return systems;
  const leftMost = Math.min(...systems.map((s) => s.x0));
  const rightMost = Math.max(...systems.map((s) => s.x0 + s.width));
  return systems.map((sys, i) => {
    const next = systems[i + 1];
    if (!next || !sys.staves.length || !next.staves.length) return sys;
    const bottom = sys.staves[sys.staves.length - 1].originY;
    const topNext = (next.top - sys.top) + topOf(next.staves[0]);
    const yMid = (bottom + topNext) / 2;
    const overlays = [];
    for (const side of ['left', 'right']) {
      if (!settings[side]) continue;
      const name = settings[`${side}Sym`];
      const g = glyphs.glyphs[name];
      if (!g) continue;
      const natW = g.bbox.bBoxNE[0] - g.bbox.bBoxSW[0];
      const natH = g.bbox.bBoxNE[1] - g.bbox.bBoxSW[1];
      const size = settings[`${side}Size`];
      const w = natW * size; const h = natH * size;
      let x;
      if (side === 'left') x = settings.leftAlign ? (leftMost - sys.x0) - 0.5 * w : 0;
      else x = settings.rightAlign ? (rightMost - sys.x0) - 0.5 * w : sys.width - w;
      x += settings[`${side}X`];
      overlays.push({ kind: 'glyph-stretch', role: 'system-divider', name, x, y: yMid - h / 2 + settings[`${side}Y`], w, h, natW, natH });
    }
    return overlays.length ? { ...sys, overlays: [...(sys.overlays ?? []), ...overlays] } : sys;
  });
}
