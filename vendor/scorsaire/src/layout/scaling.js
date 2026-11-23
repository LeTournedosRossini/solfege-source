/*
 * Reduced size of a nested score (`PID.CONTAINER_SCALE`): every display item of the score is scaled — positions, sizes of glyphs and text, widths
 * of lines. Two uses: `scaleItem` for a nested staff aligned on the columns of the piece (x positions come from the piece, only y and sizes
 * shrink: `kx` = 1), and `scaledLayout` for a score laid out on its own (free layout, between measures: everything shrinks about its origin).
 */

const mapPoints = (list, kx, ky) => list?.map(([x, y]) => [x * kx, y * ky]);

/** A scaled COPY of a display item (staff coordinates, y UP): x by `kx`, y by `ky`, sizes (glyph magnification, text size, line widths) by `k`. */
export function scaleItem(it, kx, ky, k) {
  const n = { ...it };
  switch (it.kind) {
    case 'glyph': n.x = it.x * kx; n.y = it.y * ky; n.mag = (it.mag ?? 1) * k; break;
    case 'text': n.x = it.x * kx; n.y = it.y * ky; n.size = it.size * k; if (it.letterSpacing) n.letterSpacing = it.letterSpacing * k; break;
    case 'line':
      n.x1 = it.x1 * kx; n.x2 = it.x2 * kx; n.y1 = it.y1 * ky; n.y2 = it.y2 * ky; n.width = it.width * k;
      if (it.dash) n.dash = it.dash.map((v) => v * k);
      if (it.into) n.into = it.into * k;
      break;
    case 'rect': n.x = it.x * kx; n.y = it.y * ky; n.w = it.w * kx; n.h = it.h * ky; break;
    case 'circle': n.cx = it.cx * kx; n.cy = it.cy * ky; n.r = it.r * k; if (it.strokeWidth) n.strokeWidth = it.strokeWidth * k; break;
    case 'glyph-stretch': n.x = it.x * kx; n.y = it.y * ky; n.w = it.w * kx; n.h = it.h * ky; break;
    case 'path': n.x = it.x * kx; n.y = it.y * ky; n.scale = it.scale * k; break;
    case 'bezier':
      for (const key of ['x1', 'x2', 'c1x', 'c2x']) n[key] = it[key] * kx;
      for (const key of ['y1', 'y2', 'c1y', 'c2y']) n[key] = it[key] * ky;
      n.width = it.width * k;
      break;
    case 'polyline': n.points = mapPoints(it.points, kx, ky); n.width = it.width * k; break;
    case 'polygon':
      n.points = mapPoints(it.points, kx, ky);
      if (it.stems) n.stems = it.stems.map((s) => ({ ...s, x1: s.x1 * kx, y1: s.y1 * ky, y2: s.y2 * ky, width: s.width * k, ...(s.into ? { into: s.into * k } : {}) }));
      break;
    case 'curve':
      for (const key of ['x1', 'x2', 'topC1x', 'topC2x', 'botC1x', 'botC2x']) n[key] = it[key] * kx;
      for (const key of ['y1', 'y2', 'topC1y', 'topC2y', 'botC1y', 'botC2y']) n[key] = it[key] * ky;
      if (it.strokeWidth) n.strokeWidth = it.strokeWidth * k;
      break;
    default: return it;
  }
  if (it.bounds) n.bounds = { x1: it.bounds.x1 * kx, x2: it.bounds.x2 * kx, y1: it.bounds.y1 * ky, y2: it.bounds.y2 * ky };
  return n;
}

const scaleOverlay = (ov, k) => {
  const n = { ...ov };
  if (ov.kind === 'glyph-stretch') { n.x = ov.x * k; n.y = ov.y * k; n.w = ov.w * k; n.h = ov.h * k; return n; }
  if (ov.kind === 'path') {
    const m = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s*L\s*(-?[\d.]+)\s+(-?[\d.]+)\s*$/.exec(ov.d ?? '');
    if (m) n.d = `M ${+m[1] * k} ${+m[2] * k} L ${+m[3] * k} ${+m[4] * k}`;
    if (ov.strokeWidth) n.strokeWidth = ov.strokeWidth * k;
    if (ov.dash) n.dash = ov.dash.map((v) => v * k);
  }
  return n;
};

/** A layout (`layoutMovement` result) reduced by `k` about its origin; `k` = 1 returns it unchanged. Only the data the nested-score blocks read is carried. */
export function scaledLayout(layout, k) {
  if (!(k > 0) || k === 1) return layout;
  return {
    ...layout,
    width: layout.width * k,
    height: layout.height * k,
    systems: layout.systems.map((sys) => ({
      ...sys,
      x0: sys.x0 * k, width: sys.width * k, height: sys.height * k,
      overlays: (sys.overlays ?? []).map((ov) => scaleOverlay(ov, k)),
      staves: sys.staves.map((st) => ({ ...st, originY: st.originY * k, items: st.items.map((it) => scaleItem(it, k, k, k)) })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Size of ONE staff in % (`trackDisplay.sizePct`), for every staff type. The columns of time are shared by all staves, so the x positions of the notes
// stay where they are: y, the sizes of glyphs, text and strokes shrink by `k`, and x is mapped AROUND THE NOTE it belongs to: x' = c + (x − c)·k with `c`
// the centre of the nearest note column. A notehead, its stem, dots, accidentals, ledger lines, articulations, flags and the ends of beams and ties all
// move with the same `c`, so they stay attached (a notehead scaled about its left edge would leave its stem behind).
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const NOTE_CENTRE = 0.6; // from the origin of a column (left edge of the notehead) to the centre of the head, in staff spaces
const REACH = 1.8; // an x further than this from every note column is left where it is
const FIXED_ROLES = new Set(['staff-line', 'barline', 'repeat-dot', 'repeat-tip', 'clef', 'clef-change', 'key-sig', 'time-sig', 'brace', 'bracket', 'system-barline', 'letters', 'tab-letter']);

/** x mapper for one staff of one system: `columns` = x of the column origins, `fixedBefore` = x up to which nothing moves (the header). */
export function makeXMap(k, columns, fixedBefore = 0) {
  const centres = columns.map((x) => x + NOTE_CENTRE).sort((a, b) => a - b);
  return (x) => {
    if (!centres.length || x <= fixedBefore + 1e-6) return x;
    let lo = 0; let hi = centres.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (centres[mid] <= x) lo = mid; else hi = mid; }
    const c = Math.abs(centres[lo] - x) <= Math.abs(centres[hi] - x) ? centres[lo] : centres[hi];
    return Math.abs(x - c) > REACH ? x : c + (x - c) * k;
  };
}

/** A copy of a display item shrunk by `k` (y, sizes) with its x coordinates mapped by `fx`. */
export function scaleStaffItem(it, k, fx) {
  const n = scaleItem(it, 1, k, k);
  if (n === it) return it;
  if (it.role && (FIXED_ROLES.has(it.role) || it.role.startsWith('barline'))) return n; // aligned with the other staves: x untouched
  const m = (key) => { if (n[key] != null) n[key] = fx(n[key]); };
  const span = (xk, wk) => { if (n[xk] == null) return; const a = fx(n[xk]); const b = fx(n[xk] + (n[wk] ?? 0)); n[xk] = a; if (n[wk] != null) n[wk] = b - a; };
  switch (n.kind) {
    case 'glyph': case 'text': case 'path': m('x'); break;
    case 'line': m('x1'); m('x2'); break;
    case 'rect': case 'glyph-stretch': span('x', 'w'); break;
    case 'circle': m('cx'); break;
    case 'bezier': for (const key of ['x1', 'x2', 'c1x', 'c2x']) m(key); break;
    case 'polyline': n.points = n.points?.map(([x, y]) => [fx(x), y]); break;
    case 'polygon':
      n.points = n.points?.map(([x, y]) => [fx(x), y]);
      if (n.stems) n.stems = n.stems.map((s) => ({ ...s, x1: fx(s.x1) }));
      break;
    case 'curve': for (const key of ['x1', 'x2', 'topC1x', 'topC2x', 'botC1x', 'botC2x']) m(key); break;
    default: break;
  }
  if (n.bounds) n.bounds = { ...n.bounds, x1: fx(n.bounds.x1), x2: fx(n.bounds.x2) };
  return n;
}
