/*
 * "Molette" (written pitch wheel, model/wheel.js) on a score staff. Not a MuseScore element: it borrows the look of the guitar bend of the tablature
 * (a line that goes up with an arrow head, and the amount written above it: « 1 », « ½ », « −1 »), but there is no arrival note. The line is the curve
 * itself, drawn small above the chord: left = start of the note, right = its end, height = how far the wheel moves (0,45 sp per semitone, at most 2,4 sp).
 * A wheel written on ONE note of a chord (scope 'note') adds a tiny ramp, as high as a notehead, right behind that note; a wheel on the chord has none.
 * The curve spans the whole tied chain of the note (it sounds that long).
 *
 * Known limits: the width is fixed (3,2 sp, kept inside the system) and does not look for what is already above the chord (no skyline).
 */
import { PID, SID, getProperty } from '../model/index.js';
import { sampleBendCurve } from '../model/bend.js';
import { wheelCurveOf } from '../model/wheel.js';
import { bendAmountToString } from './bends.js';
import { TEXT_SIZE } from './glissandos.js';
import { systemSpan } from './painters/systemspan.js';

const WIDTH = 3.2; const PER_SEMITONE = 0.45; const MAX_HEIGHT = 2.4; const CLEARANCE = 0.8; const STAFF_TOP = 4;

/** « 1 », « ½ », « 1½ » of an amount in semitones (a whole tone = 1), signed with « − » when negative. */
export function wheelAmountText(semitones, useFractions = true) {
  const q = Math.round(Math.abs(semitones) * 2); // quarter tones
  if (q === 0) return '';
  const s = bendAmountToString(Math.trunc(q / 4), q % 4, useFractions);
  return semitones < 0 ? `−${s}` : s;
}

/**
 * @param locate    noteId → { k, x, y (staff space, up), w, h, boxes: [{ top }], … } | null (as for `scoreBendItems`; the tablature gives the same shape)
 * @param staffTop  y of the top line of the staff (4 for five lines; the first string of a tablature)
 */
export function scoreWheelItems({ perSystem, staff, ctx, locate, result, staffTop = STAFF_TOP }) {
  const list = getProperty(staff, PID.WHEELS) ?? [];
  if (!list.length) return;
  const { style } = ctx;
  const chordOf = new Map();
  for (const vo of staff.voices) for (const m of vo.measures) for (const it of m.items) if (it.type === 'chord') for (const n of it.notes) chordOf.set(n.id, it.notes.map((x) => x.id));
  const tieTo = new Map((getProperty(staff, PID.TIES) ?? []).map((t) => [t.startNoteId, t.endNoteId]));
  const lw = style(SID.GUITAR_BEND_LINE_WIDTH);
  const arrowW = 0.6 * style(SID.GUITAR_BEND_ARROW_WIDTH); const arrowH = 0.6 * style(SID.GUITAR_BEND_ARROW_HEIGHT); // smaller than a tablature bend: the curve is small
  for (const w of list) {
    const ids = chordOf.get(w.startNoteId);
    const L = locate(w.startNoteId);
    if (!ids || !L) continue;
    const Ls = ids.map((id) => locate(id)).filter((x) => x && x.k === L.k);
    const right = Math.max(...Ls.map((x) => x.x + x.w));
    const top = Math.max(staffTop + 1, ...Ls.flatMap((x) => x.boxes.map((b) => b.top)).map((y) => y + CLEARANCE));
    const x0 = right + 0.35;
    const span = systemSpan(perSystem, L.k);
    // the curve lasts as long as the sound: it runs over the whole tied chain (to the end of the system when the chain goes on in the next one)
    let reach = x0 + WIDTH;
    for (let id = tieTo.get(w.startNoteId), guard = 0; id && guard < 64; id = tieTo.get(id), guard++) {
      const T = locate(id);
      if (!T || T.k !== L.k) { reach = span.right; break; }
      reach = Math.max(reach, T.x + T.w - 0.3);
    }
    const width = Math.max(1.2, Math.min(reach, span.right - 0.3) - x0);
    const sampled = sampleBendCurve(wheelCurveOf(w), 8);
    const amp = Math.max(0.5, ...sampled.map((p) => Math.abs(p.s)));
    const k = Math.min(PER_SEMITONE, MAX_HEIGHT / amp);
    const pts = sampled.map((p) => [x0 + p.t * width, top + p.s * k]);
    const out = result[L.k];
    if (w.scope === 'note' && ids.length > 1) { // a wheel on ONE note of a chord: a tiny ramp, as high as a notehead, right behind that note
      const bx = L.x + L.w + 0.15; const half = 0.5 * (L.h || 1) * 0.6;
      out.push({ kind: 'bezier', x1: bx, y1: L.y - half, c1x: bx + 0.45, c1y: L.y - half, c2x: bx + 0.45, c2y: L.y + half, x2: bx + 0.9, y2: L.y + half, width: lw, cap: 'butt', join: 'miter', role: 'bend', ref: w.id });
    }
    out.push({ kind: 'polyline', points: pts, width: lw, cap: 'butt', join: 'miter', role: 'bend', ref: w.id });
    const first = sampled[0]; const last = sampled[sampled.length - 1];
    if (Math.abs(last.s - first.s) > 0.25) {
      const end = pts[pts.length - 1]; const prev = pts.findLast((p) => Math.hypot(end[0] - p[0], end[1] - p[1]) > 0.3) ?? pts[0];
      const dx = end[0] - prev[0]; const dy = end[1] - prev[1]; const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len; const uy = dy / len; // direction of travel
      const bx = end[0] - ux * arrowH; const by = end[1] - uy * arrowH;
      out.push({ kind: 'polygon', points: [end, [bx - uy * arrowW / 2, by + ux * arrowW / 2], [bx + uy * arrowW / 2, by - ux * arrowW / 2]], role: 'bend-arrow', ref: w.id });
    }
    const peak = sampled.reduce((m, p) => (Math.abs(p.s) > Math.abs(m.s) ? p : m), first);
    const text = wheelAmountText(peak.s, style(SID.USE_FRACTION_CHARACTERS));
    if (text) {
      const tx = x0 + peak.t * width; const ty = top + peak.s * k;
      out.push({ kind: 'text', role: 'bend-text', text, x: tx, y: peak.s >= 0 ? ty + 0.45 : ty - 0.45 - TEXT_SIZE * 0.6, size: TEXT_SIZE, anchor: 'middle', ref: w.id });
    }
  }
}
