/*
 * Which canvas (tablet layouts fixed by the author, screen 2) suits the screen the Lecteur runs on, and which of its layouts suits the tracks the person reads.
 * Pure: no DOM. The Lecteur falls back on its own automatic pagination when nothing suits.
 */
import { resolveStyle, pageGeometry, getProperty, PID } from '../model/index.js';
import { canvasesOf, partsOfCanvas, partStaffIds } from '../model/partedit.js';

export const AUTO = 'auto';
export const NONE = 'none'; // the person wants the Lecteur's own pages, whatever canvases exist
export const RATIO_TOLERANCE = 0.12; // a canvas is used when its width / height is within 12 % of the screen's

/** Width / height of the page of a layout, as the paper has it. */
export const partRatio = (part) => { const g = pageGeometry((sid) => resolveStyle(sid, [part.style])); return g.widthMm / g.heightMm; };

/** Ids of the tracks of `movement` that a layout shows (a track is shown when one of its staves is). */
export function partTracksIn(work, part, movement) {
  const ids = new Set(partStaffIds(work, part));
  return movement.tracks.filter((t) => t.staves.some((s) => ids.has(s.id))).map((t) => t.id);
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * @param o.screen    { width, height } in pixels
 * @param o.tracks    ids of the tracks the person reads (null = every track)
 * @param o.role      the role the person always reads (model/partroles.js), or null: the layout of that role wins over the tracks read
 * @param o.choice    AUTO, or the NAME of a canvas the person forces (a name travels from one work to another, an id does not) (then the closest shape is not required)
 * @param o.needFit   false: the closest canvas is returned even when its shape is too far from the screen (`fits` says so): the Lecteur then only reads the reader settings of its layout
 * @returns {{ canvas, part, exact: boolean, fits: boolean }|null}  `exact`: the layout shows exactly the tracks read (else it is the first layout of the canvas)
 */
export function pickCanvas(work, movement, { screen, tracks = null, choice = AUTO, role = null, tolerance = RATIO_TOLERANCE, needFit = true } = {}) {
  const canvases = canvasesOf(work).filter((c) => partsOfCanvas(work, c.id).length);
  if (choice === NONE || !canvases.length || !screen?.width || !screen?.height) return null;
  const ratio = screen.width / screen.height;
  let canvas = null; let fits = true;
  if (choice !== AUTO) canvas = canvases.find((c) => c.name === choice) ?? null;
  if (!canvas) {
    let best = Infinity;
    for (const c of canvases) {
      const d = Math.abs(Math.log(ratio / partRatio(partsOfCanvas(work, c.id)[0])));
      if (d < best) { best = d; canvas = c; }
    }
    fits = best <= Math.log(1 + tolerance);
    if (choice === AUTO && !fits && needFit) return null;
  }
  const parts = partsOfCanvas(work, canvas.id);
  const wanted = tracks ?? movement.tracks.map((t) => t.id);
  const byRole = role ? parts.find((p) => getProperty(p, PID.PART_ROLE) === role) : null;
  if (byRole) return { canvas, part: byRole, exact: true, fits };
  const match = parts.find((p) => sameSet(partTracksIn(work, p, movement), wanted));
  return { canvas, part: match ?? parts[0], exact: !!match, fits };
}

/**
 * The layout of a canvas as it is READ with a display transposition: the same part, a copy whose `PID.PART_TRANSPOSE_ALL` is the person's transposition (semitones, + = written higher,
 * the rule of screen 2 « Transposer toute la partie »), so the page breaks the author fixed stay where they are and only the measures may be a little more or less tight. The part
 * itself is never touched (a copy keeps the non-enumerable readers of the element).
 */
export function partForReading(part, semitones, { chordView = 'author' } = {}) {
  const view = chordView === 'original' || chordView === 'capo' ? chordView : null; // the reader's own way of reading the chords (null = as the author made the part)
  if (!semitones && !view) return part;
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(part));
  Object.defineProperty(copy, 'props', { value: { ...part.props, ...(semitones ? { [PID.PART_TRANSPOSE_ALL]: (part.props[PID.PART_TRANSPOSE_ALL] ?? 0) + semitones } : {}), ...(view ? { [PID.PART_CHORD_VIEW]: view } : {}) }, enumerable: true, writable: true, configurable: true });
  return copy;
}
