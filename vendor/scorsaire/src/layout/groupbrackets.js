/*
 * Brackets of track groups and bar lines that continue between staves (step 5, "tracks and staves" panel, slice 4).
 * Ported from MuseScore 4.7.5: `TLayout::layoutBracket`, `TDraw::draw(Bracket)`, `System::setBracketsXPosition`,
 * `SystemLayout::layoutBrackets` / `totalBracketOffset`, `MeasureLayout::createSystemBeginBarLine`, `BarLine::calcY` (all read).
 *
 * Geometry (spaces; x from the left end of the staves, negative to the left; y down from the top of the system):
 *   normal : line of `bracketWidth` (0.45) + curled ends (`bracketTop` / `bracketBottom`) that go past the staves by 0.25 sp (Bravura; 0.5 Leland);
 *            reserved width = bracketWidth + bracketDistance (0.45) = 0.9
 *   square : line of one staff line thickness with two short horizontal strokes of 0.5 sp; reserved width = lineWidth/2 + 0.5
 *   line   : line of 0.67 × bracketWidth; reserved width = 0.67 × bracketWidth + bracketDistance
 *   brace  : the `brace` glyph stretched over the staves (same as the automatic brace of a multi-staff track)
 * A bracket is placed OUTSIDE everything it contains: the brace of its multi-staff tracks and its child groups. (MuseScore stacks by
 * column; the nesting depth is the column here.)
 */
import { SID } from '../model/sid.js';
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { barlinesConnect } from '../model/groupedit.js';
import { braceItem } from './vertical.js';
import { barlineItems } from './barlines.js';
import { BARLINE_THIN_W } from './constants.js';

const LABEL_SIZE = 1.5; // sp, body of the group label (rotated, read bottom to top)
const LABEL_GAP = 0.4;
// bar types continued between staves: every type drawn as vertical strokes over the whole staff (dashed / dotted keep their pattern); short and tick are not
const CONNECTED = new Set(['simple', 'double', 'final', 'reverseFinal', 'heavy', 'heavyHeavy', 'dashed', 'dotted', 'startRepeat', 'endRepeat', 'endStartRepeat']);

function indexRange(ctx, mvGroup) {
  // the group spans the tracks from its first to its last track in the movement; HIDDEN tracks are not in `ctx.staves`, so the bracket
  // covers the visible staves in that range (even a single one), and comes back with the tracks that are shown again
  const tracks = ctx.movement.tracks;
  const a = tracks.findIndex((t) => t.id === getProperty(mvGroup, PID.START_TRACK_ID));
  const b = tracks.findIndex((t) => t.id === getProperty(mvGroup, PID.END_TRACK_ID));
  if (a < 0 || b < 0) return null;
  let first = -1;
  let last = -1;
  ctx.staves.forEach((s, i) => {
    const k = tracks.indexOf(s.track);
    if (k >= a && k <= b) { if (first < 0) first = i; last = i; }
  });
  return first < 0 ? null : [first, last];
}

/** Reserved width of one bracket (spaces). */
function bracketWidth(kind, style, glyphs, staffCount) {
  const w = style(SID.BRACKET_WIDTH);
  const d = style(SID.BRACKET_DISTANCE);
  switch (kind) {
    case 'square': return style(SID.STAFF_LINE_THICKNESS) / 2 + 0.5;
    case 'line': return 0.67 * w + d;
    case 'brace': return braceItem(0, 1, staffCount, glyphs, style).w + style(SID.AKKOLADE_BAR_DISTANCE);
    default: return w + d;
  }
}

/** Width of the automatic brace of a 2-staff track (what the groups must clear). */
export function trackBraceWidth(glyphs, style) {
  return braceItem(0, 1, 2, glyphs, style).w + style(SID.AKKOLADE_BAR_DISTANCE);
}

/**
 * Plan independent of the system: every group with its staves, x offset and width. `total` = room needed left of the staves.
 * @returns {{ groups: Array, total: number, labelRoom: number }}
 */
export function groupBracketPlan(ctx, style, glyphs) {
  const braceW = trackBraceWidth(glyphs, style);
  const showLabels = style(SID.GROUP_LABELS);
  const out = [];
  let total = 0;
  let labelRoom = 0;
  const place = (group) => {
    const range = indexRange(ctx, group);
    const kids = group.groups.map(place).filter(Boolean);
    if (!range) return null;
    const [first, last] = range;
    const hasBrace = ctx.staves.slice(first, last + 1).some((s) => s.indexInTrack > 0 && !s.ctx.collapsed);
    const inner = Math.max(hasBrace ? braceW : 0, ...kids.map((k) => k.end));
    const kind = getProperty(group, PID.BRACKET_STYLE);
    const width = bracketWidth(kind, style, glyphs, last - first + 1);
    const label = showLabels ? getProperty(group, PID.LABEL) : null;
    const node = { group, first, last, kind, offset: inner, width, end: inner + width + (label ? LABEL_SIZE + LABEL_GAP : 0), label: label || null, kids };
    out.push(node);
    total = Math.max(total, node.end);
    if (node.label) labelRoom = LABEL_SIZE + LABEL_GAP;
    return node;
  };
  ctx.movement.groups.forEach(place);
  return { groups: out, total, labelRoom };
}

/** Overlay items (system coordinates) of the group brackets of one system. `spaced.staves[i]` = { top, originY }. */
export function groupBracketItems(plan, spaced, style, glyphs) {
  const items = [];
  const lineW = style(SID.STAFF_LINE_THICKNESS);
  const bw = style(SID.BRACKET_WIDTH);
  const bd = 0.25; // curl overshoot, Bravura (MuseScore: 0.5 with Leland)
  for (const n of plan.groups) {
    const a = spaced.staves[n.first];
    const b = spaced.staves[n.last];
    if (!a || !b) continue;
    const top = a.top;
    const bottom = b.originY;
    const right = -n.offset; // right edge of the reserved width
    switch (n.kind) {
      case 'brace': {
        const it = braceItem(top, bottom, n.last - n.first + 1, glyphs, style);
        items.push({ ...it, x: it.x - n.offset });
        break;
      }
      case 'square': {
        const x = right - n.width;
        const reach = n.width - lineW / 2;
        items.push({ kind: 'path', role: 'group-bracket', d: `M${x} ${top - lineW / 2} L${x} ${bottom + lineW / 2}`, stroke: 'ink', strokeWidth: lineW });
        for (const y of [top, bottom]) items.push({ kind: 'path', role: 'group-bracket', d: `M${x - lineW / 2} ${y} L${x + lineW / 2 + reach} ${y}`, stroke: 'ink', strokeWidth: lineW });
        break;
      }
      case 'line': {
        const w = 0.67 * bw;
        const x = right - n.width + bw / 2;
        items.push({ kind: 'path', role: 'group-bracket', d: `M${x} ${top - lineW / 2} L${x} ${bottom + lineW / 2}`, stroke: 'ink', strokeWidth: w });
        break;
      }
      default: { // normal
        const x = right - n.width + bw / 2;
        items.push({ kind: 'path', role: 'group-bracket', d: `M${x} ${top - bd - bw / 2} L${x} ${bottom + bd + bw / 2}`, stroke: 'ink', strokeWidth: bw });
        const natW = glyphs.glyphs.bracketTop.bbox.bBoxNE[0];
        const natH = glyphs.glyphs.bracketTop.bbox.bBoxNE[1];
        items.push({ kind: 'glyph-stretch', role: 'group-bracket', name: 'bracketTop', x: x - bw / 2, y: top - bd - natH, w: natW, h: natH, natW, natH });
        items.push({ kind: 'glyph-stretch', role: 'group-bracket', name: 'bracketBottom', x: x - bw / 2, y: bottom + bd, w: natW, h: natH, natW, natH });
      }
    }
    if (n.label) {
      const x = -(n.offset + n.width + LABEL_GAP);
      items.push({ kind: 'text', role: 'group-label', text: n.label, size: LABEL_SIZE, x, y: (top + bottom) / 2, rotate: 90, anchor: 'middle' });
    }
  }
  return items;
}

/**
 * Bar lines between staves: at the start of the system (every staff of the system, option `START_BARLINE_MULTIPLE`) and at the end of each
 * measure between two ADJACENT staves that are connected (staves of one track; tracks of a group that continues its bar lines).
 * Drawn as vertical strokes in the gap between the staves, with the bar type of the measure.
 */
export function barlineConnectorItems({ ctx, sys, spaced, style, glyphs }) {
  const items = [];
  const rows = spaced.staves.map((_, i) => i).filter((i) => !ctx.staves[i]?.ctx.collapsed); // a collapsed source staff of a composite takes no room: no bar line joins it
  if (rows.length < 2) return items;
  const half = style(SID.STAFF_LINE_THICKNESS) / 2;
  // a staff with no lines but bars (the rhythm staff) has bars of its own height around its origin (`barSpan`): the connectors reach them, the chord staff stays apart
  const spanOf = (i) => (!(spaced.staves[i].lines?.length) && ctx.staves[i].type !== 'chord' && ctx.staves[i].painter.barSpan ? ctx.staves[i].painter.barSpan(ctx.staves[i].staff, ctx.staves[i].ctx) : null);
  const topOf = (i) => (spanOf(i) ? spaced.staves[i].originY - spanOf(i).hi - half : spaced.staves[i].top - half);
  const bottomOf = (i) => (spanOf(i) ? spaced.staves[i].originY - spanOf(i).lo + half : spaced.staves[i].originY + half);
  const stroke = (x, w, y1, y2, extra = {}) => items.push({ kind: 'path', role: 'barline-connector', d: `M${x} ${y1} L${x} ${y2}`, stroke: 'ink', strokeWidth: w, ...extra });
  const solid = (type, x, y1, y2) => {
    const lines = barlineItems(x, CONNECTED.has(type) ? type : 'simple', 0, 1, null, glyphs).filter((it) => it.kind === 'line');
    const sign = /Repeat$/.test(type); // the connecting stroke of a repeat bar is a structure sign too (a reader may colour it)
    for (const l of lines) {
      // a round cap overshoots by half the width at each end: inset the gap (as `barlineItems` does for the staff pieces)
      if (l.dash) stroke(l.x1, l.width, y1 + l.width / 2, y2 - l.width / 2, { dash: l.dash, cap: l.cap, ...(sign ? { sign: true } : {}) });
      else stroke(l.x1, l.width, y1, y2, sign ? { sign: true } : {});
    }
  };

  // the chord track works differently (bars only): the bar that joins the staves at the start of the system begins at the top of the first staff that is not a chord staff,
  // as if nothing were above it
  const first = rows.find((i) => ctx.staves[i].type !== 'chord') ?? -1;
  const lastRow = rows[rows.length - 1];
  if (style(SID.START_BARLINE_MULTIPLE) && first >= 0 && rows.filter((i) => i >= first).length >= 2) stroke(BARLINE_THIN_W / 2, BARLINE_THIN_W, topOf(first), bottomOf(lastRow));

  // which gaps are connected: [i, i + 1]
  const connected = [];
  for (let p = 0; p + 1 < rows.length; p += 1) {
    const a = ctx.staves[rows[p]].track;
    const b = ctx.staves[rows[p + 1]].track;
    if (a.id === b.id || barlinesConnect(ctx.movement, a, b)) connected.push([rows[p], rows[p + 1]]);
  }
  const hasBars = (i) => (spaced.staves[i].lines?.length ?? 0) > 0 || Boolean(spanOf(i));
  for (const [i, j] of connected) {
    if (!hasBars(i) || !hasBars(j)) continue;
    const y1 = bottomOf(i);
    const y2 = topOf(j);
    if (sys.leadRepeat) solid('startRepeat', sys.repeatX, y1, y2);
    for (const m of sys.measures) solid(m.endType ?? 'simple', m.barX, y1, y2);
  }
  return items;
}
