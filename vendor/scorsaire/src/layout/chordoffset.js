/*
 * Play offset of a chord symbol (chord staff): an arrow leaves the root letter and lands just before a small rhythm note drawn at the arrow's height,
 * at the sounding point; the note value shows the offset (see model/chordoffset.js). When the sounding point is in another system, each system draws
 * its own half (the arrow runs to / from the system edge, like a tie that is split).
 * Staff coordinates, y up. System-level pass: it needs `xAt` (x of an instant in this system).
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { fAdd, fCmp, ZERO } from '../model/fraction.js';
import { offsetNoteValue, noteGlyphFor } from '../model/chordoffset.js';

const LIFT = 1.0; // arrow height above the top of the root letter
const BULGE = 0.5; // maximum arch of the arrow (shrinks on short arrows)
const HEAD_MAG = 0.8 / 1.5; // size of the small note
const HEAD_W = 1.18 * HEAD_MAG; // notehead width (Bravura raw)
const STROKE = 0.1;
const FLAG = 0.5; // extra room before a flagged note
const GAP = 0.2; // between the arrow tip and the note
const BASE_FONT_SIZE = 5; // default chord size (SID.CHORD_FONT_SIZE): the arrow and the note scale with the ratio
let K = 1; // scale of the current staff (set per call)

/** The playing-order target of a symbol: { mi, q } with `q` the measure-relative sounding position, or null when it leaves the movement. */
export function offsetTarget(position, offset, barLengths, mi) {
  let q = fAdd(position, offset);
  let t = mi;
  if (fCmp(q, ZERO) < 0) {
    t = mi - 1;
    if (t < 0) return null;
    q = fAdd(q, barLengths[t]);
  } else if (fCmp(q, barLengths[mi]) >= 0) {
    t = mi + 1;
    if (t >= barLengths.length) return null;
    q = fAdd(q, [-barLengths[mi][0], barLengths[mi][1]]);
  }
  return { mi: t, q };
}

const bulgeFor = (dx) => Math.min((BULGE * K), Math.abs(dx) * 0.15);

function arrow(sx, ex, y, ref) {
  const dx = ex - sx;
  const bulge = bulgeFor(dx);
  const c1 = { x: sx + dx * 0.3, y: y + bulge * 1.33 };
  const c2 = { x: sx + dx * 0.7, y: y + bulge * 1.33 };
  const dirx = ex - c2.x, diry = y - c2.y;
  const len = Math.hypot(dirx, diry) || 1;
  const ux = dirx / len, uy = diry / len;
  const hl = 0.45 * K, hw = 0.2 * K;
  const bx = ex - ux * hl, by = y - uy * hl;
  return [
    { kind: 'bezier', x1: sx, y1: y, c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x2: bx, y2: by, width: (STROKE * K), cap: 'butt', join: 'miter', role: 'chord-offset', ref },
    { kind: 'polygon', points: [[ex, y], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]], role: 'chord-offset', ref },
  ];
}

/** Open end (the other half is in another system): a plain arch from `sx` to the system edge. */
function stub(sx, ex, y, ref, head) {
  if (head) return arrow(sx, ex, y, ref);
  const dx = ex - sx;
  return [{ kind: 'bezier', x1: sx, y1: y, c1x: sx + dx * 0.3, c1y: y + bulgeFor(dx) * 1.33, c2x: sx + dx * 0.7, c2y: y + bulgeFor(dx) * 1.33, x2: ex, y2: y, width: (STROKE * K), cap: 'butt', join: 'miter', role: 'chord-offset', ref }];
}

function noteItems(x, y, value, ref) {
  const g = noteGlyphFor(value);
  if (!g) return [];
  const out = [{ kind: 'glyph', name: g.glyph, x, y, mag: (HEAD_MAG * K), role: 'chord-offset', ref }];
  if (g.dot) out.push({ kind: 'glyph', name: 'metAugmentationDot', x: x + (HEAD_W * K) + 0.15 * K, y, mag: (HEAD_MAG * K), role: 'chord-offset', ref });
  return out;
}

export function chordOffsetItems({ ctx, sref, sys, xAt, existing }) {
  const style = sref.ctx?.style ?? ctx.style; // the staff's own style carries the display size of its track
  K = style ? (style(SID.CHORD_FONT_SIZE) / BASE_FONT_SIZE) || 1 : 1; // follows the display size of the track
  const staff = sref.staff;
  if (getProperty(staff, PID.STAFF_TYPE) !== 'chord') return [];
  const inSystem = new Map(sys.measures.map((m) => [m.mi, m]));
  const first = sys.measures[0], last = sys.measures[sys.measures.length - 1];
  const barHeight = style ? style(SID.CHORD_BAR_HEIGHT) : 4;
  const out = [];
  for (const voice of staff.voices) {
    voice.measures.forEach((measure, mi) => {
      for (const item of measure?.items ?? []) {
        if (item.type !== 'chordsymbol') continue;
        const offset = getProperty(item, PID.PLAY_OFFSET);
        const position = getProperty(item, PID.POSITION);
        if (!offset || !position) continue;
        const target = offsetTarget(position, offset, ctx.barLengths, mi);
        if (!target) continue;
        const writtenHere = inSystem.has(mi), targetHere = inSystem.has(target.mi);
        if (!writtenHere && !targetHere) continue;
        const advance = fCmp(offset, ZERO) < 0;
        const value = offsetNoteValue(offset, target.q);
        const run = existing.find((it) => it.ref === item.id && it.role === 'harmony');
        const top = run ? run.y + (run.box?.y2 ?? 0.7 * (run.size ?? 2)) : barHeight;
        const y = (run ? top : barHeight) + (LIFT * K);
        const noteW = (HEAD_W * K) + (noteGlyphFor(value)?.dot ? (0.15 + 0.4 * HEAD_MAG) * K : 0);
        let sx = null;
        if (writtenHere && run) {
          const width = run.box?.x2 ?? 1;
          sx = advance ? run.x + width / 2 : run.x; // a delay always leaves the left edge of the root letter
        }
        let xt = targetHere ? xAt(target.mi, fAdd(ctx.offsets?.[target.mi] ?? [0, 1], target.q)) : null;
        if (advance && xt !== null && writtenHere && run && fCmp(offset, [-1, 16]) === 0) {
          // only a sixteenth early note sits halfway between its sounding column and the written column
          const xw = xAt(mi, fAdd(ctx.offsets?.[mi] ?? [0, 1], position));
          xt = (xt + xw) / 2;
        }
        // a note that sounds in the previous measure never crosses the barline
        if (advance && xt !== null && target.mi !== mi && inSystem.get(target.mi)) xt = Math.min(xt, inSystem.get(target.mi).barX - noteW - (GAP * K));
        // a flagged note (shorter than a quarter) has a flag to its right: the arrow stops before it
        const flagged = value[1] >= 8;
        const stopGap = advance && flagged ? (FLAG * K) : 0;
        if (writtenHere && targetHere && sx !== null) {
          const ex = advance ? xt + noteW + (GAP * K) + stopGap : xt - (GAP * K);
          out.push(...arrow(sx, ex, y, item.id), ...noteItems(xt, y - 0.3 * (HEAD_MAG * K), value, item.id));
        } else if (writtenHere && sx !== null) {
          out.push(...stub(sx, advance ? first.start : last.barX, y, item.id, false));
        } else if (targetHere) {
          const edge = advance ? last.barX : first.start;
          const ex = advance ? xt + noteW + (GAP * K) + stopGap : xt - (GAP * K);
          out.push(...arrow(edge, ex, y, item.id), ...noteItems(xt, y - 0.3 * (HEAD_MAG * K), value, item.id));
        }
      }
    });
  }
  return out;
}
