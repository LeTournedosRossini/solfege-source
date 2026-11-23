/*
 * Piano keyboard diagram: the keys of a chord lit on a keyboard. PURE drawing, no DOM; display items in staff spaces, y up, anchored at the BOTTOM-LEFT corner of the box
 * (like `fretDiagramItems`, so a piano diagram goes wherever a guitar diagram goes). The look is the one of the chord editor's SVG graphics (CCE): a light frame with
 * rounded corners, each white key outlined in thin grey with slightly rounded corners, black keys 58 % as wide as a white and 62 % as high, lit keys filled with
 * the diagram's colour (a dark navy by default), a white dot on the lowest lit key, and a small grey "c" above each C.
 *
 *  - the keyboard shows one or two keys below the lowest note and one or two above the highest, and starts and ends on a WHITE key (`pianoRange`) — or runs over
 *    `frame` { start, octaves } (the editor shows whole octaves, C to B);
 *  - `orientation` 'horizontal' (low keys on the left) or 'vertical' (low keys at the BOTTOM, the black keys on the left): the same keyboard turned a quarter turn,
 *    to save width (the "c" marks are then on the right);
 *  - `voicing.fingers` writes a finger number (1 = thumb … 5) in a small round badge on the lit key (centred on the white-only part of a white key, so it never
 *    touches a black key).
 * A key is drawn in "key space" (u along the keyboard, v across it, 0 at the black-key side) and mapped to the page by the orientation.
 */
import { titleItems, FRET_DIAGRAM } from './fretdiagram.js';
import { contrastInk } from '../model/color.js';

export const PIANO = Object.freeze({ whiteW: 0.58, whiteH: 2.6, blackW: 0.34, blackH: 1.55, line: 0.035, blackLine: 0.02, keyRadius: 0.06, frameRadius: 0.16, markRoom: 0.45, mark: 0.38, finger: 0.4, fingerBlack: 0.34, badge: 0.24, badgeBlack: 0.2, root: 0.12, lit: '#1a2e52', frame: '#fafafa', edge: '#999999', blackKey: '#222222', markInk: '#a09a8e', pad: 0.12 });
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
export const isWhiteKey = (midi) => WHITE_PCS.has(midi % 12);

/**
 * { start, end } of the keyboard. Rule: one key below the lowest note and one above the highest — two when that key is black — so that the keyboard begins and ends
 * on a white key. A `frame` { start, octaves } overrides it.
 */
export function pianoRange(notes, frame = null) {
  if (frame) return { start: frame.start, end: frame.start + 12 * frame.octaves - 1 };
  const lo = Math.min(...notes); const hi = Math.max(...notes);
  let start = lo - 1; if (!isWhiteKey(start)) start -= 1;
  let end = hi + 1; if (!isWhiteKey(end)) end += 1;
  return { start: Math.max(0, start), end: Math.min(127, end) };
}

/** @param voicing { instrument: 'piano', notes, fingers? } @param options { x, y, scale, title, ref, role, color, dotColor, orientation, frame } */
export function pianoDiagramItems(voicing, { x = 0, y = 0, scale = 1, title = null, ref, role = 'fret-diagram', color, dotColor = null, orientation = 'horizontal', frame = null } = {}) {
  const P = PIANO; const k = scale;
  const { start, end } = pianoRange(voicing.notes, frame);
  const lit = new Set(voicing.notes);
  const fingerOf = new Map(voicing.notes.map((n, i) => [n, voicing.fingers?.[i] ?? null]));
  const litColor = dotColor ?? P.lit;
  const ink = color ?? '#000';
  const ww = P.whiteW * k; const H = P.whiteH * k; const bw = P.blackW * k; const bh = P.blackH * k; const lw = P.line * k; const pad = P.pad * k;
  const whiteIndex = new Map();
  let nWhite = 0;
  for (let m = start; m <= end; m++) if (isWhiteKey(m)) whiteIndex.set(m, nWhite++);
  const L = nWhite * ww;
  const vertical = orientation === 'vertical';
  const titleH = title ? FRET_DIAGRAM.titleZone * k : 0;
  const room = P.markRoom * k; // where the "c" marks are written: above the keys (lying) or on their right (standing)
  const keysH = vertical ? L : H;
  const X0 = x + pad;
  const Y0 = y; // bottom of the keyboard area
  // key space → page (y up): horizontal: u → x, v (down from the top edge) → y; vertical: v → x, u → y (low keys at the bottom)
  const px = (u, v) => (vertical ? X0 + v : X0 + u);
  const py = (u, v) => (vertical ? Y0 + u : Y0 + H - v);
  const mk = (extra) => ({ role, ref, ...extra });
  const items = [];
  const keys = [];
  // a rounded rectangle in key space (all four corners round, radius r); coordinates relative to the item origin
  const OX = X0; const OY = Y0 + keysH;
  const rel = (u, v) => `${(px(u, v) - OX).toFixed(4)} ${(OY - py(u, v)).toFixed(4)}`;
  const roundRect = (u0, u1, v0, v1, r) => `M${rel(u0, v0 + r)} Q${rel(u0, v0)} ${rel(u0 + r, v0)} L${rel(u1 - r, v0)} Q${rel(u1, v0)} ${rel(u1, v0 + r)} L${rel(u1, v1 - r)} Q${rel(u1, v1)} ${rel(u1 - r, v1)} L${rel(u0 + r, v1)} Q${rel(u0, v1)} ${rel(u0, v1 - r)} Z`;
  const shape = (u0, u1, v0, v1, r, fill, stroke, strokeWidth) => {
    const xa = Math.min(px(u0, v0), px(u1, v1)); const xb = Math.max(px(u0, v0), px(u1, v1));
    const ya = Math.min(py(u0, v0), py(u1, v1)); const yb = Math.max(py(u0, v0), py(u1, v1));
    return { x1: xa, y1: ya, x2: xb, y2: yb, item: mk({ kind: 'path', x: OX, y: OY, scale: 1, d: roundRect(u0, u1, v0, v1, r), fill, stroke, strokeWidth, bounds: { x1: xa, x2: xb, y1: ya, y2: yb } }) };
  };
  const kr = P.keyRadius * k; const blw = P.blackLine * k;
  items.push(shape(0, L, 0, H, P.frameRadius * k, P.frame, P.edge, lw * 1.6).item);
  // white keys, each inset by half a line from its neighbours (lit ones filled)
  for (const [m, w] of whiteIndex) {
    const r = shape(w * ww + lw / 2, (w + 1) * ww - lw / 2, lw / 2, H - lw / 2, kr, lit.has(m) ? litColor : '#ffffff', P.edge, lw);
    items.push(r.item);
    keys.push({ midi: m, black: false, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 });
  }
  // black keys on top
  for (let m = start; m <= end; m++) {
    if (isWhiteKey(m)) continue;
    const below = whiteIndex.get(m - 1);
    if (below === undefined) continue; // a black key whose white neighbour is outside the keyboard (a frame cutting it)
    const u = (below + 1) * ww;
    const r = shape(u - bw / 2, u + bw / 2, 0, bh, kr, lit.has(m) ? litColor : P.blackKey, '#000000', blw);
    items.push(r.item);
    keys.push({ midi: m, black: true, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 });
  }
  // a white dot on the lowest lit key (where the chord starts), unless a finger number is written there
  const lowest = Math.min(...voicing.notes);
  if (!fingerOf.get(lowest)) {
    const lowWhite = whiteIndex.get(lowest); const lowBelow = whiteIndex.get(lowest - 1);
    const uc = lowWhite !== undefined ? (lowWhite + 0.5) * ww : lowBelow !== undefined ? (lowBelow + 1) * ww : null;
    if (uc !== null) { const v = lowWhite !== undefined ? H - 0.32 * k : bh - 0.26 * k; items.push(mk({ kind: 'circle', cx: px(uc, v), cy: py(uc, v), r: P.root * k, fill: '#ffffff' })); }
  }
  // a small grey "c" above (lying) or beside (standing) every C
  const size = P.mark * k;
  for (const [m, w] of whiteIndex) {
    if (m % 12 !== 0) continue;
    const uc = (w + 0.5) * ww;
    if (vertical) items.push(mk({ kind: 'text', x: px(uc, H) + 0.1 * k, y: py(uc, 0) - size * 0.34, size, text: 'c', anchor: 'start', family: 'sans-serif', color: P.markInk }));
    else items.push(mk({ kind: 'text', x: px(uc, 0), y: py(uc, 0) + 0.1 * k, size, text: 'c', anchor: 'middle', family: 'sans-serif', color: P.markInk }));
  }
  // finger numbers in small round badges: a white key's badge sits in the middle of its white-only part (below the black keys), a black key's near its front end
  const fsz = P.finger * k;
  for (const [m, finger] of fingerOf) {
    if (!finger) continue;
    const white = whiteIndex.has(m);
    const below = whiteIndex.get(m - 1);
    const uc = white ? (whiteIndex.get(m) + 0.5) * ww : below === undefined ? null : (below + 1) * ww;
    if (uc === null) continue;
    const rad = (white ? P.badge : P.badgeBlack) * k;
    const v = white ? bh + rad + 0.06 * k : bh - rad - 0.12 * k;
    const cx = px(uc, v); const cy = py(uc, v);
    const dark = white; // dark badge on a white key, white badge on a black one
    items.push(mk({ kind: 'circle', cx, cy, r: rad, fill: dark ? '#1a1a1a' : '#ffffff', stroke: dark ? '#1a1a1a' : '#ffffff', strokeWidth: 0.02 * k }));
    const fs = (white ? fsz : P.fingerBlack * k);
    items.push(mk({ kind: 'text', x: cx, y: cy - fs * 0.34, size: fs, text: String(finger), anchor: 'middle', family: 'sans-serif', weight: 700, color: dark ? '#ffffff' : '#1a1a1a' }));
  }
  const width = (vertical ? H + room : L) + 2 * pad;
  const height = keysH + (vertical ? 0 : room) + titleH;
  if (title) items.push(...titleItems(title, { cx: X0 + (vertical ? H : L) / 2, baseY: Y0 + keysH + (vertical ? 0 : room), zone: titleH, k, ref, role }));
  return { items, width, height, bodyLeft: X0, bodyWidth: vertical ? H : L, geometry: { keys, range: { start, end }, orientation, whites: nWhite } };
}
