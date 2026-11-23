/*
 * Staff containers (`staff.containers`, roadmap "conteneur portée"): content anchored to (staff, measure) with a `span`, drawn JUST ABOVE
 * the anchor staff. Kinds drawn here: `text` / `annotation` (a text), `nestedNotation` (one or more nested staves, e.g. a
 * simplified rhythm under chord symbols), any other kind a labelled frame (placeholder until its content type is built).
 *
 * Rules:
 *  - width = the covered measures (never set by hand); a span may cross barlines and systems (each system draws its own part);
 *  - height = content height; the container stacks above whatever the staff already carries (autoplace against element boxes), and the
 *    final vertical spacing of the system then pushes the staff above away (layout/index.js uses the item boxes);
 *  - nested notes are placed at the x of the SAME instants as the main columns (`xAt`: exact column, else time interpolation), so
 *    rhythm written in a container lines up with the chord symbols / notes of the measures it covers;
 *  - on screen a thin frame (role `container-frame`, not printed) and a handle at the top left (role `container-handle`) are drawn:
 *    both carry the container id (hit-test selects the container).
 * Coordinates: staff-local, y UP, 0 = bottom line (like every painter output).
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { rectsOf } from './bounds.js';
import { barlineItems } from './barlines.js';
import { translateItem } from './offsets.js';
import { SLOT_TEXT_SIZE } from './slots.js';
import { glyphItem, glyphWidth, keySigItems, keySigWidth, keySigOf, timeSigItems, timeSigWidth, effectiveTimeSigStyle } from './header.js';
import { shimStaff, nestedRefOptions } from './nestedshim.js';
import { scaleItem } from './scaling.js';
import { nestedStaves } from '../model/containerstaves.js';
import { measureColumns } from './columns.js';
import { stretchColumns } from './springs.js';
import { diagramLayout, followedItems } from './diagramcontainer.js';

const PT = (1.75 * 72) / 25.4;
const TEXT_SIZE = 10 / PT; // 10 pt in staff spaces
const GAP = 0.6; // between the container and what is below it
const PAD = 0.5; // inside the frame
export const HANDLE = 0.9;
const HANDLE_COLOR = '#6a4bd0'; // violet, like the other handles of the pages
const MUTED = 'var(--muted, #8a8a8a)';
const WARN = '#c0392b';
const NESTED_STAFF_DISTANCE = 9; // sp between the bottom lines of two nested staves of an aligned score

/**
 * A FREE nested score (`containerLayout` 'free'): the fragment is laid out on its own and spread over the width of the container (first segment
 * only; a continuation after a line break shows just the frame). A fragment too dense for the width is laid out with a tighter spacing; if it
 * still does not fit it overflows to the right and the container carries a warning (`items.warning`).
 */
function freeItems(ctx, c, anchorIndex, visible, x1, x2) {
  const items = [];
  if (visible[0].mi !== anchorIndex) return items;
  const res = ctx.freeFragmentLayout(c, x2 - x1 - 2 * PAD);
  const sys = res.layout.systems[0];
  if (!sys) return items;
  const dx = x1 + PAD + sys.x0;
  for (const st of sys.staves) for (const it of st.items) items.push(translateItem(it, dx, st.originY));
  items.push(...overlayItems(sys.overlays, 0, dx));
  if (res.overflow) items.warning = true;
  return items;
}

function nestedItems(ctx, sref, c, anchorIndex, visible, x1, x2, xAt, sys) {
  if (getProperty(c, PID.CONTAINER_LAYOUT) === 'free') return freeItems(ctx, c, anchorIndex, visible, x1, x2);
  const items = [];
  const refOptions = nestedRefOptions(ctx.movement, c, anchorIndex);
  const refs = nestedStaves(c).map((nested) => {
    const shim = shimStaff(nested, anchorIndex);
    const nref = ctx.makeRef(sref.track, shim, 0, refOptions);
    nref.ctx.minDuration = ctx.minDuration;
    return { shim, nref };
  });
  // spacing of the nested notes: 'chords' (default) = the instants of the anchor staff (`xAt`: the column of that instant, else interpolation);
  // 'document' = the nested staves are spaced on their own columns, like the rest of the document, inside each measure they cover
  const own = getProperty(c, PID.CONTAINER_SPACING) === 'document';
  const placedOwn = new Map(); // measure index → per nested staff: [{ entry, x }]
  if (own) {
    const virtual = refs.map(({ nref }, k) => ({ ...nref, index: k }));
    const bars = ctx.movement.masterbars;
    const nctx = {
      ...ctx, staves: virtual, spacingStaves: undefined, spacingEntries: undefined, breaths: virtual.map(() => bars.map(() => [])),
      entries: virtual.map((r) => bars.map((_, mi) => (visible.some((m) => m.mi === mi) ? r.painter.entries(r.staff, mi, r.ctx) : []))),
    };
    for (const m of visible) {
      const cols = measureColumns(nctx, m.mi);
      const widths = stretchColumns(cols, m.content);
      const perStaff = virtual.map(() => []);
      let colX = m.start;
      for (const col of cols) {
        const w = widths.get(col);
        const ratio = col.width > 0 ? w / col.width : 1;
        for (const e of col.entries) perStaff[e.staffIndex].push({ entry: e, x: colX + col.lead * ratio + (e.vx ? e.vx.moveX : 0) });
        colX += w;
      }
      placedOwn.set(m.mi, perStaff);
    }
  }
  let left = Infinity; // leftmost x of the headers: the frame and the staff lines reach it
  const scale = getProperty(c, PID.CONTAINER_SCALE) ?? 1; // reduced size: y and sizes shrink about the bottom line, x stays on the columns of the piece
  refs.forEach(({ shim, nref }, k) => {
    const first = items.length;
    const { painter } = nref;
    const lines = painter.lines(shim, nref.ctx);
    const half = 0.06;
    // header of the segment, right-to-left from the first column: small clef, then (only when the score has its OWN signature) key and time
    // signature. A score that follows the piece shows its clef alone.
    const clef = painter.clef(shim, nref.ctx, visible[0].mi);
    const firstX = own ? (placedOwn.get(visible[0].mi)?.[k]?.[0]?.x ?? visible[0].start) : xAt(visible[0].mi, [0, 1]);
    const showKey = !!getProperty(c, PID.CONTAINER_SHOW_KEYSIG) && painter.keySig(shim, nref.ctx, visible[0].mi);
    const tsDefs = getProperty(c, PID.CONTAINER_SHOW_TIMESIG) ? painter.timeSig(shim, nref.ctx) : null;
    const mi0 = visible[0].mi;
    const tsHere = tsDefs && nref.ctx.timeSigs[mi0] && (mi0 === anchorIndex || JSON.stringify(nref.ctx.timeSigs[mi0]) !== JSON.stringify(nref.ctx.timeSigs[mi0 - 1]));
    let cursor = firstX - 0.5;
    if (tsHere) {
      const ts = nref.ctx.timeSigs[mi0];
      const tsStyle = effectiveTimeSigStyle(ts, getProperty(ctx.movement.masterbars[mi0], PID.TIME_SIG_STYLE));
      cursor -= timeSigWidth(ctx.glyphs, ts, tsStyle);
      items.push(...timeSigItems(ctx.glyphs, cursor, ts, tsDefs.yNum, tsDefs.yDen, tsStyle).map((it) => ({ ...it, ref: c.id })));
    }
    if (showKey) {
      const ks = keySigOf(nref.ctx.keySigs[mi0] ?? 0);
      const w = keySigWidth(ctx.glyphs, ks, ks);
      cursor -= w;
      items.push(...keySigItems(ctx.glyphs, cursor, showKey.clefKey, ks, ks).map((it) => ({ ...it, ref: c.id })));
    }
    if (clef && clef.glyph && !clef.items) {
      const mag = 0.8;
      const w = glyphWidth(ctx.glyphs, clef.glyph) * mag;
      cursor -= w + (showKey || tsHere ? 0.3 : 0);
      items.push(glyphItem(clef.glyph, cursor, clef.y, { mag, ref: c.id, role: 'clef' }));
    }
    left = Math.min(left, cursor);
    for (const l of lines) items.push({ kind: 'line', role: 'staff-line', x1: Math.min(x1, cursor - 0.2), x2, y1: l.y, y2: l.y, width: l.thickness, ref: c.id });
    const span = painter.barSpan ? painter.barSpan(shim, nref.ctx) : null;
    const ys = lines.map((l) => l.y);
    const lo = (span ? span.lo : ys.length ? Math.min(...ys) : 0) - half;
    const hi = (span ? span.hi : ys.length ? Math.max(...ys) : 0) + half;
    items.push(...barlineItems(Math.min(x1, cursor - 0.2), 'simple', lo, hi, c.id, ctx.glyphs));
    for (const m of visible) {
      items.push(...barlineItems(m.barX, 'simple', lo, hi, c.id, ctx.glyphs));
      const placedFull = own
        ? placedOwn.get(m.mi)[k]
        : painter.entries(shim, m.mi, nref.ctx).map((entry) => ({ entry, x: xAt(m.mi, entry.position) }));
      // Reduced size: the entries are painted at x / scale and their items then scaled in x by `scale` about 0, so every column lands exactly where it
      // is in the piece while everything built around it (head, stem, beam, flag, dots, accidental) shrinks TOGETHER — scaling the finished items about
      // their own left edge would pull the stems away from the heads
      const placed = scale === 1 ? placedFull : placedFull.map((p) => ({ ...p, x: p.x / scale }));
      const mctx = { ...nref.ctx, systemFirst: sys.first, measure: scale === 1
        ? { index: m.mi, x0: m.start, width: m.content, barX: m.barX }
        : { index: m.mi, x0: m.start / scale, width: m.content / scale, barX: m.barX / scale } };
      const painted = painter.paintMeasure ? painter.paintMeasure(placed, mctx) : placed.flatMap((p) => painter.paintEntry(p.entry, p.x, mctx));
      items.push(...(scale === 1 ? painted : painted.map((it) => scaleItem(it, scale, 1, 1))));
    }
    if (scale !== 1) for (let i = first; i < items.length; i += 1) items[i] = scaleItem(items[i], 1, scale, scale);
    // several nested staves (a piano): each one below the previous, at a fixed distance between their bottom lines
    if (k > 0) for (let i = first; i < items.length; i += 1) items[i] = translateItem(items[i], 0, NESTED_STAFF_DISTANCE * k * scale);
  });
  if (Number.isFinite(left)) items.left = left;
  return items;
}

/**
 * @param {object} a
 * @param {object} a.ctx        layout context (buildContext)
 * @param {object} a.sref       anchor staff reference ({ staff, track, … })
 * @param {object} a.sys        system (breakIntoSystems)
 * @param {Function} a.xAt      (measure index, fraction) → x of that instant in this system
 * @param {Array} a.existing    display items already drawn on the staff (the containers stack above them)
 * @returns {Array} display items to append to the staff
 */
export function containerItems({ ctx, sref, sys, xAt, existing }) {
  const list = sref.staff.containers ?? [];
  if (!list.length) return [];
  const barIds = ctx.movement.masterbars.map((b) => b.id);
  const pool = rectsOf(existing, ctx.glyphs);
  const staffTop = pool.length ? Math.max(...pool.map((r) => r.y2)) : 4;
  const out = [];
  for (const c of list) {
    if (getProperty(c, PID.CONTAINER_PLACEMENT) === 'between') continue; // drawn in its slot (slotItems)
    if (getProperty(c, PID.SCALE_RECIPE) && ctx.style(SID.READER_SCALE) === 'hidden') continue; // a reader that hides the scales
    const anchor = barIds.indexOf(getProperty(c, PID.MEASURE_ID));
    if (anchor < 0) continue;
    const span = Math.max(1, getProperty(c, PID.SPAN) ?? 1);
    const visible = sys.measures.filter((m) => m.mi >= anchor && m.mi < anchor + span);
    if (!visible.length) continue;
    let x1 = visible[0].start;
    const x2 = visible[visible.length - 1].barX;
    const kind = getProperty(c, PID.CONTAINER_KIND);
    // content in a local frame whose origin is its lowest edge; extents measured afterwards
    let content = [];
    if (kind === 'text' || kind === 'annotation') {
      const text = getProperty(c, PID.TEXT) ?? '';
      const zoom = getProperty(c, PID.CONTAINER_SCALE) ?? 1; // a text can be enlarged
      if (text) content.push({ kind: 'text', text, x: x1 + HANDLE + 0.5, y: 0.25 * TEXT_SIZE * zoom, size: TEXT_SIZE * zoom, anchor: 'start', role: 'container-text', ref: c.id });
    } else if (kind === 'chordDiagram') {
      const d = getProperty(c, PID.DIAGRAM_FOLLOW) ? null : diagramLayout(ctx, c);
      if (getProperty(c, PID.DIAGRAM_FOLLOW)) content = followedItems(ctx, c, visible, xAt, x1 + 0.05); // one diagram per chord symbol of the covered measures, under its symbol
      if (d) content = d.items.map((it) => translateItem(it, x1 + HANDLE + 0.4 + d.shift, 0)); // after the handle; room for a title wider than the diagram
      else if (!content.length) content.push({ kind: 'text', text: '?', x: x1 + HANDLE + 0.5, y: 0.25 * TEXT_SIZE, size: TEXT_SIZE, anchor: 'start', italic: true, role: 'container-text', ref: c.id, color: MUTED });
    } else if (kind === 'nestedNotation') {
      content = nestedItems(ctx, sref, c, anchor, visible, x1, x2, xAt, sys);
    } else {
      content.push({ kind: 'text', text: String(kind), x: x1 + HANDLE + 0.5, y: 0.25 * TEXT_SIZE, size: TEXT_SIZE * 0.8, anchor: 'start', italic: true, role: 'container-text', ref: c.id, color: MUTED });
    }
    if (content.left !== undefined) x1 = Math.min(x1, content.left - PAD); // own signatures reach left of the first measure: the frame follows
    if (content.warning) {
      // the sign sits at the top right of what the container holds (never at the origin of the local frame: a lifted nested score would be stretched down to it, with a huge empty margin)
      const held = rectsOf(content, ctx.glyphs);
      const top = held.length ? Math.max(...held.map((r) => r.y2)) : TEXT_SIZE;
      content.push({ kind: 'text', text: '⚠', x: x2 - PAD - 1, y: top - 0.8 * TEXT_SIZE, size: TEXT_SIZE, anchor: 'start', role: 'container-warning', ref: c.id, color: WARN });
      ctx.warnings.push(`Conteneur ${c.id} : la partition libre est trop dense pour sa largeur`);
    }
    const boxes = rectsOf(content, ctx.glyphs);
    // a text is approximated (Edwin absent): 0.5 × size per character
    for (const it of content) if (it.kind === 'text') boxes.push({ x1: it.x, x2: it.x + 0.5 * it.size * [...it.text].length, y1: it.y - 0.25 * it.size, y2: it.y + 0.8 * it.size });
    const lo = boxes.length ? Math.min(...boxes.map((r) => r.y1)) : 0;
    const hi = boxes.length ? Math.max(...boxes.map((r) => r.y2)) : TEXT_SIZE;
    // rest above what lies under the container's width
    const under = pool.filter((r) => r.x2 > x1 && r.x1 < x2);
    const floor = under.length ? Math.max(...under.map((r) => r.y2)) : staffTop;
    const frameBottom = floor + GAP + (getProperty(c, PID.CONTAINER_GAP) ?? 0); // the user may lift the container away from what lies under it
    const dy = frameBottom + PAD - lo; // content shift
    const frameTop = frameBottom + PAD + (hi - lo) + PAD;
    const placed = content.map((it) => translateItem(it, 0, -dy)); // translateItem takes y DOWN
    out.push(...placed);
    // frame (screen aid, not printed) and handle
    const frame = (xa, ya, xb, yb) => ({ kind: 'line', role: 'container-frame', x1: xa, y1: ya, x2: xb, y2: yb, width: 0.05, color: MUTED, ref: c.id });
    out.push(frame(x1, frameBottom, x2, frameBottom), frame(x1, frameTop, x2, frameTop), frame(x1, frameBottom, x1, frameTop), frame(x2, frameBottom, x2, frameTop));
    out.push({ kind: 'rect', role: 'container-handle', x: x1 + 0.2, y: frameTop - 0.2 - HANDLE, w: HANDLE, h: HANDLE, fill: HANDLE_COLOR, ref: c.id, sel: c.id });
    pool.push({ x1, x2, y1: frameBottom, y2: frameTop }, ...rectsOf(placed, ctx.glyphs));
  }
  return out;
}

/**
 * Content of one slot between measures, in the row of its staff: the text centred on the middle of the staff and, on screen only, a thin
 * frame and a handle (both carry the container id). `ys` = the staff lines (may be empty), `span` = { lo, hi } of a staff without lines.
 */
export function slotItems({ ctx, container, x, width, ys, span, half }) {
  const lo = span ? span.lo : ys.length ? Math.min(...ys) : 0;
  const hi = span ? span.hi : ys.length ? Math.max(...ys) : 4;
  const mid = (lo + hi) / 2;
  let top = hi + Math.max(0.5, half ?? 0) + 0.5;
  let bottom = lo - 0.5;
  const out = [];
  const kind = getProperty(container, PID.CONTAINER_KIND);
  const zoom = kind === 'text' ? getProperty(container, PID.CONTAINER_SCALE) ?? 1 : 1;
  let text = kind === 'text' ? getProperty(container, PID.TEXT) ?? '' : String(kind);
  if (kind === 'chordDiagram') {
    // a diagram centred in the slot, on the middle of the staff; the frame grows to hold it when it is taller than the staff
    const d = diagramLayout(ctx, container);
    text = d ? '' : '?';
    if (d) {
      const dy = mid - d.height / 2;
      for (const it of d.items) out.push(translateItem(it, x + (width - d.width) / 2 + d.shift, -dy));
      top = Math.max(top, mid + d.height / 2 + 0.5);
      bottom = Math.min(bottom, mid - d.height / 2 - 0.5);
    }
  }
  if (text) out.push({ kind: 'text', text, x: x + width / 2, y: mid - 0.3 * SLOT_TEXT_SIZE * zoom, size: SLOT_TEXT_SIZE * zoom, anchor: 'middle', role: 'container-text', ref: container.id });
  const frame = (xa, ya, xb, yb) => ({ kind: 'line', role: 'container-frame', x1: xa, y1: ya, x2: xb, y2: yb, width: 0.05, color: MUTED, ref: container.id });
  const x1 = x + 0.1; const x2 = x + width - 0.1;
  out.push(frame(x1, bottom, x2, bottom), frame(x1, top, x2, top), frame(x1, bottom, x1, top), frame(x2, bottom, x2, top));
  // the separator (an option of the container): a thin line in the middle of the room, along the staff; unlike the frame it is printed
  if (getProperty(container, PID.CONTAINER_SEPARATOR)) out.push({ kind: 'line', role: 'slot-separator', x1: x + width / 2, x2: x + width / 2, y1: lo, y2: hi, width: 0.12, ref: container.id });
  out.push({ kind: 'rect', role: 'container-handle', x: x1 + 0.2, y: top - 0.2 - HANDLE, w: HANDLE, h: HANDLE, fill: HANDLE_COLOR, ref: container.id, sel: container.id });
  // the corner to pull to change the width (ui/slot-resize.js); drawn on the screens that edit, never printed
  out.push({ kind: 'rect', role: 'container-resize', x: x2 - 0.2 - HANDLE, y: bottom + 0.2, w: HANDLE, h: HANDLE, fill: HANDLE_COLOR, ref: container.id, sel: container.id });
  return out;
}

/**
 * The system overlays of a nested score (braces of a track with several staves, brackets of a group, the barlines that join the staves) as items of
 * the anchor staff. Overlay coordinates: x from the system origin, y DOWN from the top of the nested system; `A` = the staff y (up) of that top,
 * so an overlay at `y` lands at `A − y`; `dx` = x of the nested system origin in the anchor staff. Only what the nested system draws is carried:
 * stretched glyphs and straight (M … L …) paths; other overlay kinds (labels) are not.
 */
export function overlayItems(overlays, A, dx) {
  const out = [];
  for (const ov of overlays ?? []) {
    if (ov.kind === 'glyph-stretch') {
      out.push({ kind: 'glyph-stretch', role: ov.role, name: ov.name, x: dx + ov.x, y: A - ov.y, w: ov.w, h: ov.h, natW: ov.natW, natH: ov.natH, ref: ov.ref });
    } else if (ov.kind === 'path') {
      const m = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s*L\s*(-?[\d.]+)\s+(-?[\d.]+)\s*$/.exec(ov.d ?? '');
      if (!m) continue;
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      out.push({ kind: 'line', role: ov.role, x1: dx + x1, y1: A - y1, x2: dx + x2, y2: A - y2, width: ov.strokeWidth ?? 0.1, ...(ov.dash ? { dash: ov.dash } : {}), ...(ov.cap ? { cap: ov.cap } : {}), ...(ov.ref ? { ref: ov.ref } : {}) });
    }
  }
  return out;
}

/**
 * A nested score (fragment) in a slot, once the vertical stacking of the system is known: the inner layout (one system) is translated into
 * the staff of the anchor so that its middle sits on the middle of the staves of the system; frame (screen only) and handle around it.
 * `inner` = layoutMovement of the fragment; `anchorOrigin` = y of the anchor staff origin, system coordinates (down); `center` = y of the
 * middle of the system staves (same coordinates).
 */
export function fragmentSlotItems({ ctx, container, slot, inner, anchorOrigin, center }) {
  const sys = inner.systems[0];
  if (!sys) return [];
  const out = [];
  const x = slot.x + (slot.width - inner.width) / 2 + sys.x0; // the nested system origin sits `x0` right of the block's left edge (braces room)
  const topY = center - sys.height / 2; // system coordinates of the top of the block
  for (const st of sys.staves) {
    // y (up) of an inner item in the anchor staff = anchorOrigin − (topY + inner staff origin) + y
    const dyUp = anchorOrigin - (topY + st.originY);
    for (const it of st.items) out.push(translateItem(it, x, -dyUp));
  }
  out.push(...overlayItems(sys.overlays, anchorOrigin - topY, x));
  const frameTop = anchorOrigin - (topY - 0.5);
  const frameBottom = anchorOrigin - (topY + sys.height + 0.5);
  const x1 = slot.x + 0.1; const x2 = slot.x + slot.width - 0.1;
  const frame = (xa, ya, xb, yb) => ({ kind: 'line', role: 'container-frame', x1: xa, y1: ya, x2: xb, y2: yb, width: 0.05, color: MUTED, ref: container.id });
  out.push(frame(x1, frameBottom, x2, frameBottom), frame(x1, frameTop, x2, frameTop), frame(x1, frameBottom, x1, frameTop), frame(x2, frameBottom, x2, frameTop));
  out.push({ kind: 'rect', role: 'container-handle', x: x1 + 0.2, y: frameTop - 0.2 - HANDLE, w: HANDLE, h: HANDLE, fill: HANDLE_COLOR, ref: container.id, sel: container.id });
  return out;
}

/**
 * A nested score in the ROW of its staff (option A): the FIRST nested staff is aligned on the host staff — its middle line on the middle line
 * of the host staff, so both staves read as one staff across the slot (the other nested staves follow, in their own distances) — and stays
 * a part of the staff items BEFORE the vertical stacking, so a block taller than the staff pushes the neighbouring staves apart.
 * Coordinates: staff, y UP, 0 = bottom line.
 */
export function fragmentRowItems({ ctx, container, slot, inner, ys, span }) {
  const sys = inner.systems[0];
  if (!sys || !sys.staves.length) return [];
  const lo = span ? span.lo : ys.length ? Math.min(...ys) : 0;
  const hi = span ? span.hi : ys.length ? Math.max(...ys) : 4;
  const hostMid = (lo + hi) / 2;
  // middle of the first nested staff: its lines, else its barlines (a staff without lines), else the middle of a 5-line staff
  const first = sys.staves[0];
  const lineYs = first.items.filter((it) => it.role === 'staff-line').map((it) => it.y1);
  const barYs = first.items.filter((it) => it.role === 'barline').flatMap((it) => [it.y1, it.y2]);
  const pick = lineYs.length ? lineYs : barYs;
  const innerMid = pick.length ? (Math.min(...pick) + Math.max(...pick)) / 2 : 2;
  const x = slot.x + (slot.width - inner.width) / 2 + sys.x0;
  const out = [];
  for (const st of sys.staves) {
    // inner item y (up, from its staff origin) → y (up) in the host staff: shift by the distance between nested origins, then align the middles
    const dyUp = hostMid - innerMid - (st.originY - first.originY);
    for (const it of st.items) out.push(translateItem(it, x, -dyUp));
  }
  out.push(...overlayItems(sys.overlays, first.originY + hostMid - innerMid, x));
  const rects = rectsOf(out, ctx.glyphs);
  const top = (rects.length ? Math.max(...rects.map((r) => r.y2)) : hi) + 0.5;
  const bottom = (rects.length ? Math.min(...rects.map((r) => r.y1)) : lo) - 0.5;
  const x1 = slot.x + 0.1; const x2 = slot.x + slot.width - 0.1;
  const frame = (xa, ya, xb, yb) => ({ kind: 'line', role: 'container-frame', x1: xa, y1: ya, x2: xb, y2: yb, width: 0.05, color: MUTED, ref: container.id });
  out.push(frame(x1, bottom, x2, bottom), frame(x1, top, x2, top), frame(x1, bottom, x1, top), frame(x2, bottom, x2, top));
  out.push({ kind: 'rect', role: 'container-handle', x: x1 + 0.2, y: top - 0.2 - HANDLE, w: HANDLE, h: HANDLE, fill: HANDLE_COLOR, ref: container.id, sel: container.id });
  return out;
}
