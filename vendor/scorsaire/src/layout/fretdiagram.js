/*
 * Fretted-instrument chord diagram (guitar, ukulele, bass…): PURE drawing, no DOM. Produces display items (line / circle / text) in staff spaces,
 * y UP, like every painter, so a diagram can be placed anywhere the engine draws (a container, a zone of a part, a chord symbol…).
 *
 * `fretDiagramItems(voicing, options)` → { items, width, height, bodyLeft, bodyWidth, geometry }
 *   - the box is anchored at its BOTTOM-LEFT corner (`x`, `y`); `width` includes the fret-number label on the left when there is one;
 *   - from top to bottom: title (optional), open / muted markers, nut (thick line when the window starts at fret 1), `rows` fret rows;
 *   - the window is `diagramWindow(frets)`: it starts at the nut for a shape that fits in 4 frets, otherwise at the lowest fretted fret, whose
 *     number is written on the left of the first row;
 *   - dots are circles (finger number inside when `voicing.fingers` has one), a barre is a thick round-capped line.
 * Everything scales with `scale` (1 = a diagram about 3.2 sp wide for 6 strings).
 */
import { voicingBarres, diagramWindow, voicingTuning } from '../model/fretvoicing.js';
import { chordSymbolItems } from './chorddisplay.js';
import { contrastInk } from '../model/color.js';

/** The colours of the chord editor's graphics (CCE): navy dots, a red cross for a muted string, a dark ring for an open one. */
// The default finger dot is navy on the light page and white on the dark one (`--diagram-dot` in static/index.html); `dotInk` is the finger number drawn on it
export const DIAGRAM_COLORS = Object.freeze({ dot: 'var(--diagram-dot, #1a2e52)', dotInk: 'var(--diagram-dot-ink, #fff)', muted: '#cc0000', open: 'var(--diagram-open, #444444)' });

export const FRET_DIAGRAM = Object.freeze({
  stringGap: 0.62, // between two strings
  fretGap: 0.78, // between two frets
  lineWidth: 0.05,
  nutWidth: 0.26,
  dotRadius: 0.235,
  markerRadius: 0.22,
  markerLift: 0.5, // centre of the markers above the nut
  markerZone: 0.85,
  labelSize: 0.95,
  labelGap: 0.2,
  titleSize: 1.15,
  titleZone: 1.45,
  fingerSize: 0.5,
  gaugeThick: 2.4, // relative width of the lowest string with `gauge` (the highest is `gaugeThin`)
  gaugeThin: 0.8,
});

/**
 * The title of a diagram: a plain string, or a chord-symbol layout (layout/chorddisplay.js) built by the caller at the wanted size. Centred on `cx`, in the zone of height `zone`
 * that starts at `baseY` (y up). Shared by the fretted and the piano diagrams.
 */
export function titleItems(title, { cx, baseY, zone, k, ref, role }) {
  const D = FRET_DIAGRAM;
  const mk = (extra) => ({ role, ref, ...extra });
  if (typeof title === 'string') return [mk({ kind: 'text', x: cx, y: baseY + (D.titleZone - D.titleSize) * k * 0.45, size: D.titleSize * k, text: title, anchor: 'middle', family: 'sans-serif', weight: 600 })];
  return chordSymbolItems(title.layout, { x: 0, mid: baseY + zone / 2, scale: 1, ref, family: title.family, weight: title.weight, centerX: cx }).map((it) => ({ ...it, role }));
}

/**
 * @param voicing  { instrument, tuning?, frets, barres?, fingers? }
 * @param options  { x, y, scale = 1, gauge = false (string thickness by pitch), dotColor (fill of the dots, '#rrggbb'), frame?, title?: string | { layout (chordSymbolLayout, built at the wanted size), family?, weight? }, ref?, role = 'fret-diagram', color?, minRows = 4 }
 */
export function fretDiagramItems(voicing, { x = 0, y = 0, scale = 1, title = null, ref, role = 'fret-diagram', color, minRows = 4, frame = null, gauge = false, dotColor = null } = {}) {
  const D = FRET_DIAGRAM;
  const k = scale;
  const n = voicing.frets.length;
  const win = frame ?? diagramWindow(voicing.frets, { minRows }); // `frame` { first, rows, nut } forces the window (the editor, to show the fret being fingered)
  const gx = D.stringGap * k;
  const gy = D.fretGap * k;
  const bodyW = (n - 1) * gx;
  const bodyH = win.rows * gy;
  const labelW = win.nut ? 0 : (D.labelSize * 0.55 * String(win.first).length + D.labelGap) * k;
  const dotR = D.dotRadius * k;
  const pad = dotR; // dots and the barre stick out of the outer strings
  const left = Math.max(labelW, 0) + pad;
  const width = left + bodyW + pad;
  const hasTitle = Boolean(title);
  const titleH = hasTitle ? D.titleZone * k : 0;
  const markerH = D.markerZone * k;
  const height = bodyH + markerH + titleH;
  const bx = x + left; // body left edge (leftmost string)
  const nutY = y + bodyH; // y of the top line of the body
  const mk = (extra) => ({ role, ref, color, ...extra });
  const items = [];
  const stringX = (i) => bx + i * gx;
  const rowCenterY = (fret) => nutY - (fret - win.first + 0.5) * gy; // fret n sits in row n - first

  // strings: with `gauge` the lower the pitch of the open string the thicker the line (like the tablature option), so the thick string is recognised at a glance
  const tuning = voicingTuning(voicing);
  const lo = Math.min(...tuning);
  const span = Math.max(...tuning) - lo;
  const thickness = (i) => (gauge && span > 0 ? D.gaugeThick - (D.gaugeThick - D.gaugeThin) * ((tuning[i] - lo) / span) : 1);
  // the fret lines reach the OUTER edge of the outer strings (half their thickness), or the corners show a step
  const edgeL = (D.lineWidth * k * thickness(0)) / 2;
  const edgeR = (D.lineWidth * k * thickness(n - 1)) / 2;
  // fret lines (the top one is the nut when the window starts at fret 1)
  for (let r = 0; r <= win.rows; r++) {
    const thick = r === 0 && win.nut;
    // the thick nut has rounded ends (a round cap, the line shortened by its radius so the corners stay on the outer edge of the outer strings)
    const rr = thick ? (D.nutWidth * k) / 2 : 0;
    items.push(mk({ kind: 'line', x1: bx - edgeL + rr, x2: bx + bodyW + edgeR - rr, y1: nutY - r * gy, y2: nutY - r * gy, width: (thick ? D.nutWidth : D.lineWidth) * k, cap: thick ? 'round' : undefined }));
  }
  // strings
  for (let i = 0; i < n; i++) items.push(mk({ kind: 'line', x1: stringX(i), x2: stringX(i), y1: nutY, y2: nutY - bodyH, width: D.lineWidth * k * thickness(i) }));

  // open / muted markers
  const my = nutY + D.markerLift * k * 0.75 + (win.nut ? D.nutWidth * k * 0.5 : 0);
  const mr = D.markerRadius * k;
  voicing.frets.forEach((f, i) => {
    if (f === 0) items.push(mk({ kind: 'circle', cx: stringX(i), cy: my, r: mr, fill: 'none', stroke: color ?? DIAGRAM_COLORS.open, strokeWidth: D.lineWidth * k * 1.3 }));
    else if (f < 0) {
      for (const s of [1, -1]) items.push(mk({ kind: 'line', x1: stringX(i) - mr, x2: stringX(i) + mr, y1: my - s * mr, y2: my + s * mr, width: D.lineWidth * k * 1.7, color: color ?? DIAGRAM_COLORS.muted }));
    }
  });

  // barres first (dots drawn over them)
  const barres = voicingBarres(voicing).filter((b) => b.fret >= win.first && b.fret < win.first + win.rows);
  for (const b of barres) {
    const yc = rowCenterY(b.fret);
    items.push(mk({ kind: 'line', x1: stringX(b.from), x2: stringX(b.to), y1: yc, y2: yc, width: 2 * dotR, cap: 'round', color: dotColor ?? color ?? DIAGRAM_COLORS.dot }));
  }
  // dots (a string covered by a barre needs none)
  voicing.frets.forEach((f, i) => {
    if (f < win.first || f >= win.first + win.rows) return;
    if (barres.some((b) => b.fret === f && i >= b.from && i <= b.to)) return;
    items.push(mk({ kind: 'circle', cx: stringX(i), cy: rowCenterY(f), r: dotR, fill: dotColor ?? color ?? DIAGRAM_COLORS.dot }));
  });
  // finger numbers, white on the dot (or on the barre, at its end string)
  voicing.fingers?.forEach((fg, i) => {
    const f = voicing.frets[i];
    if (!fg || f < win.first || f >= win.first + win.rows) return;
    items.push(mk({ kind: 'text', x: stringX(i), y: rowCenterY(f) - D.fingerSize * k * 0.34, size: D.fingerSize * k, text: String(fg), anchor: 'middle', family: 'sans-serif', color: dotColor ?? color ? contrastInk(dotColor ?? color) : DIAGRAM_COLORS.dotInk }));
  });
  // fret number of the first row
  if (!win.nut) {
    items.push(mk({ kind: 'text', x: bx - pad - D.labelGap * k, y: rowCenterY(win.first) - D.labelSize * k * 0.34, size: D.labelSize * k, text: String(win.first), anchor: 'end', family: 'sans-serif' }));
  }
  // title
  if (hasTitle) items.push(...titleItems(title, { cx: bx + bodyW / 2, baseY: nutY + markerH, zone: titleH, k, ref, role }));
  // where things are (staff spaces, y up, same frame as the items): lets an editor lay hit areas over the drawing
  const geometry = { stringX: Array.from({ length: n }, (_, i) => stringX(i)), nutY, rowGap: gy, stringGap: gx, rows: win.rows, first: win.first, nut: win.nut, markerY: my, markerZone: markerH, dotRadius: dotR };
  return { items, width, height, bodyLeft: bx, bodyWidth: bodyW, geometry };
}
