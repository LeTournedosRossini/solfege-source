/*
 * Free texts of ONE staff (`PID.STAFF_TEXTS`, MuseScore "staff text"): at an instant, above or below the staff, normal / italic / bold.
 * Rules (MuseScore 4.7.5 style `staffText*`): text 10 pt, baseline 2 sp above the top line (or below the staff), pushed away from what is
 * already drawn by 0.5 sp (autoplace against element boxes). Width approximated (0.5 × size per character, 0.55 in bold): Edwin is absent.
 * Coordinates: staff, y UP, 0 = bottom line. Called last by the painters (after the other marks), like the capo texts.
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';
import { rectsOf } from './bounds.js';
import { distributedDash } from './techlines.js';

const PT = (1.75 * 72) / 25.4;
const SIZE_BASE = 10 / PT;
const REST_ABOVE = 2; // staffTextPosAbove
const MIN_DISTANCE = 0.5;
const ASCENT = 0.8; const DESCENT = 0.25; // × size, approximate box around the baseline
// the LINE of a text (« solo ––––| »): it starts a little after the text, at the middle of the letters, and ends just before the bar of its last measure, with an optional hook back toward the staff
const LINE_GAP = 0.6; const LINE_WIDTH = 0.11; const LINE_HEIGHT = 0.3; /* × size above the baseline */ const HOOK = 1.0; const LINE_END_GAP = 0.25; const LINE_MIN = 0.8;

/**
 * The segments of a text line: for the systems from `k` (where it starts, `startMi`) on, while they hold measures of the span (`span` measures from `startMi`, cut at the end of the movement).
 * The first starts at `firstX1` (after the text), the others at the beginning of their system; each ends just before the bar of the last measure of the span it holds; `final` marks the last one.
 */
function segmentsOf(perSystem, movement, k, startMi, span, firstX1) {
  const lastMi = Math.min(startMi + span - 1, movement.masterbars.length - 1);
  const out = [];
  for (let kk = k; kk < perSystem.length; kk++) {
    const ms = perSystem[kk].sys.measures;
    if (!ms.length || ms[0].mi > lastMi) break;
    const end = [...ms].reverse().find((mm) => mm.mi <= lastMi);
    const x2 = end.barX - LINE_END_GAP;
    const x1 = kk === k ? firstX1 : ms[0].start;
    if (x2 - x1 >= LINE_MIN) out.push({ k: kk, x1, x2, final: end.mi === lastMi });
    if (end.mi === lastMi) break;
  }
  return out;
}

export function staffTextEntryItems({ perSystem, staff, movement, ctx, result, lines, lineDist, existing = [] }) {
  const entries = getProperty(staff, PID.STAFF_TEXTS) ?? [];
  if (!entries.length) return;
  const SIZE_DEFAULT = SIZE_BASE * (ctx.style?.(SID.READER_MARK_SCALE) ?? 1); // (the Lecteur keeps these texts at their size when it draws the writing bigger)
  const H = (lines - 1) * lineDist;
  const glyphs = ctx.glyphs;
  const pool = perSystem.map((_, k) => rectsOf([...(existing[k] ?? []), ...(result[k] ?? [])], glyphs));
  // in the order of time, so that two texts at one place stack in a stable way
  const mi = (id) => movement.masterbars.findIndex((b) => b.id === id);
  const sorted = [...entries].sort((a, b) => mi(a.measureId) - mi(b.measureId) || (a.position[0] / a.position[1]) - (b.position[0] / b.position[1]));
  const spaceMm = ctx.spaceMm ?? 1.75;
  for (const e of sorted) {
    // a text the user restyled (font, size in pt, bold / italic / underline, colour: the text editor of screen 2) keeps its own look; the others keep the staff text style
    const fmt = e.fmt ?? null;
    const SIZE = fmt?.size ? (fmt.size * 25.4 / 72 / spaceMm) * (ctx.style?.(SID.READER_MARK_SCALE) ?? 1) : SIZE_DEFAULT;
    const bold = fmt?.bold ?? (e.style === 'bold'); const italic = fmt?.italic ?? (e.style === 'italic');
    const k = perSystem.findIndex((p) => p.sys.measures.some((m) => movement.masterbars[m.mi]?.id === e.measureId));
    if (k < 0) continue;
    const m = perSystem[k].sys.measures.find((mm) => movement.masterbars[mm.mi]?.id === e.measureId);
    const x = perSystem[k].xAt ? perSystem[k].xAt(m.mi, e.position) : m.start;
    const width = (bold ? 0.55 : 0.5) * SIZE * [...e.text].length;
    const x1 = x; const x2 = x + width;
    // the line: one segment per system the span crosses (the text only on the first one); `last` = the last measure of the span
    const lineAt = e.line ? segmentsOf(perSystem, movement, k, m.mi, e.lineSpan ?? 1, x2 + LINE_GAP) : [];
    const first = lineAt.find((sg) => sg.k === k);
    const reach = Math.max(x2, first ? first.x2 : x2); // the box that pushes the text away from what it overlaps
    const baseFor = (kk, from, to) => {
      const overlap = pool[kk].filter((r) => r.x2 > from && r.x1 < to);
      let b;
      if (e.placement === 'below') {
        b = -REST_ABOVE * 0.5 - ASCENT * SIZE; // under the bottom line
        for (const r of overlap) b = Math.min(b, r.y1 - MIN_DISTANCE - ASCENT * SIZE);
      } else {
        b = H + REST_ABOVE;
        for (const r of overlap) b = Math.max(b, r.y2 + MIN_DISTANCE + DESCENT * SIZE);
      }
      return b;
    };
    const base = baseFor(k, x1, reach);
    result[k].push({
      kind: 'text', text: e.text, x, y: base, size: SIZE, anchor: 'start', italic, bold, role: 'staff-text', ref: e.id,
      ...(fmt?.family ? { family: fmt.family } : {}), ...(fmt?.underline ? { underline: true } : {}), ...(fmt?.color ? { tint: fmt.color } : {}),
    });
    pool[k].push({ x1, x2, y1: base - DESCENT * SIZE, y2: base + ASCENT * SIZE });
    for (const sg of lineAt) {
      const b = sg.k === k ? base : baseFor(sg.k, sg.x1, sg.x2);
      const y = b + LINE_HEIGHT * SIZE;
      const dash = e.line === 'dashed' ? distributedDash(sg.x2 - sg.x1, LINE_WIDTH) : null;
      result[sg.k].push({ kind: 'line', role: 'staff-text-line', x1: sg.x1, y1: y, x2: sg.x2, y2: y, width: LINE_WIDTH, cap: 'butt', ...(dash ? { dash } : {}), ref: e.id });
      if (e.hook && sg.final) result[sg.k].push({ kind: 'line', role: 'staff-text-line', x1: sg.x2, y1: y, x2: sg.x2, y2: y + (e.placement === 'below' ? HOOK : -HOOK), width: LINE_WIDTH, cap: 'butt', ref: e.id });
      pool[sg.k].push({ x1: sg.x1, x2: sg.x2, y1: Math.min(y, y - HOOK) - 0.1, y2: Math.max(y, y + HOOK) + 0.1 });
    }
  }
}
