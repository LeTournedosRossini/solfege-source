/*
 * "Slashes" display of a staff: in the measures the user chose, the notes (and rests, ties, articulations) of a staff are hidden and ONE SLASH PER BEAT is drawn instead — the
 * notation that says "go on like this, with some freedom" / "improvise". DISPLAY ONLY: nothing is written in the piece, the playback does not change. Chord symbols, clefs, signatures
 * and bar lines stay. It belongs to the layers of the track's display (model/trackdisplay.js: screen 1, a printed part, a sheet cell). It runs LAST, after everything is placed, like the
 * other display settings, so that nothing else moves. PURE.
 */
import { categoryOf } from './displaycats.js';
import { beatsOfBar } from '../model/beatgrid.js';
import { glyphWidth } from './header.js';
import { rectsOf } from './bounds.js';

const HIDDEN = new Set(['notes', 'rests', 'autoRests', 'slurs', 'articulations']);
const SLASH = 'noteheadSlashHorizontalEnds';
export const SLASH_ROLE = 'slash-fill';

// where an item sits along the staff (a beam is a polygon: the middle of its points)
const xOf = (it) => {
  if (typeof it.x === 'number') return it.x;
  if (typeof it.x1 === 'number') return (it.x1 + (typeof it.x2 === 'number' ? it.x2 : it.x1)) / 2;
  if (Array.isArray(it.points) && it.points.length) { const xs = it.points.map((p) => p[0]); return (Math.min(...xs) + Math.max(...xs)) / 2; }
  return null;
};

/** y (staff coordinates, y up) of the middle of the staff: the middle line of its lines, else the middle of its bars, else 2. */
function centreOf(items) {
  const ys = items.filter((it) => it.role === 'staff-line').map((it) => it.y ?? it.y1).filter((y) => typeof y === 'number');
  if (ys.length) return (Math.min(...ys) + Math.max(...ys)) / 2;
  const bars = items.filter((it) => it.role === 'barline');
  const lo = bars.map((it) => Math.min(it.y1 ?? Infinity, it.y2 ?? Infinity)).filter(Number.isFinite);
  const hi = bars.map((it) => Math.max(it.y1 ?? -Infinity, it.y2 ?? -Infinity)).filter(Number.isFinite);
  return lo.length && hi.length ? (Math.min(...lo) + Math.max(...hi)) / 2 : 2;
}

/**
 * @param items     the items of ONE staff of ONE system
 * @param measures  the measures of that system: [{ index, x, width, barX }]
 * @param shown     Set of the measure indexes shown as slashes (this staff)
 * @param barLengths per measure index: its length as a fraction of a whole note
 * @returns the new items (the same array when nothing is shown here)
 */
export function applySlashFill(items, measures, shown, barLengths, glyphs, isAutoRest = () => false, { chordStaff = false } = {}) {
  const here = measures.filter((m) => shown.has(m.index));
  if (!here.length) return items;
  const spans = here.map((m) => [m.x - 0.3, m.barX - 0.05]);
  const inside = (x) => spans.some(([a, b]) => x >= a && x < b);
  const kept = items.filter((it) => {
    const cat = categoryOf(it, isAutoRest);
    if (!cat || !HIDDEN.has(cat)) return true;
    const x = xOf(it);
    return x === null || !inside(x);
  });
  const y = centreOf(items);
  const w = glyphWidth(glyphs, SLASH);
  // a chord staff writes its symbols INSIDE the bar: a beat where a symbol stands has no slash (the usual "G / / /" of a chord chart)
  const symbols = chordStaff ? rectsOf(items.filter((it) => it.role === 'harmony'), glyphs) : [];
  const clashes = (a, b) => symbols.some((r) => r.x1 < b + 0.2 && r.x2 > a - 0.2);
  const added = [];
  for (const m of here) {
    const beats = beatsOfBar(barLengths[m.index] ?? [4, 4]);
    if (!beats.length) continue;
    const total = beats.reduce((s, b) => s + b.len[0] / b.len[1], 0);
    const left = m.x; const span = Math.max(0.5, m.barX - 0.35 - left);
    let at = 0;
    for (const b of beats) {
      const len = b.len[0] / b.len[1];
      const cx = left + span * ((at + len / 2) / total);
      if (!clashes(cx - w / 2, cx + w / 2)) added.push({ kind: 'glyph', name: SLASH, x: cx - w / 2, y, role: SLASH_ROLE });
      at += len;
    }
  }
  return [...kept, ...added];
}
