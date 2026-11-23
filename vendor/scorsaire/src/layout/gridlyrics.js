/*
 * Lyrics written ON THE GRID of measures (model/lyrics.js `gridSegments`): the verse text has « | » between measures and no link to notes. They are shown under the first
 * chord staff of the movement, the syllables of a measure sharing its width evenly. Items of that staff, added after the painters (like the measure numbers), so the
 * vertical spacing makes room for them. A verse that is linked to notes is NOT shown here (the lyric links of the staves draw it).
 */
import { PID, SID, getProperty } from '../model/index.js';
import { isGridText, gridSyllables } from '../model/lyrics.js';
import { lyricTextWidth } from './lyrics.js';

const PT = (1.75 * 72) / 25.4;
const LINE_SPACING = 1.2;
const ASCENT = 0.68;
const DESCENT = 0.22;
const GAP = 0.3; // sp between the bars and the first verse
const LEFT_PAD = 0.3; // sp after the barline
const MIN_GAP = 0.45; // sp between two syllables

/** The grid verses of a movement: [{ id, verse, from (index of the first measure), syllables }], memoised. */
export function gridVerses(ctx) {
  return ctx.memo.of('gridVerses', ctx.movement, (movement) => {
    const linked = new Set();
    for (const t of movement.tracks) for (const st of t.staves) for (const l of getProperty(st, PID.LYRIC_LINKS) ?? []) linked.add(l.textId);
    const ids = movement.masterbars.map((m) => m.id);
    return (ctx.lyricTexts ?? []).filter((t) => isGridText(t.text) && !linked.has(t.id)).map((t) => ({
      id: t.id, verse: t.verse, from: Math.max(0, ids.indexOf(t.measureId)), syllables: gridSyllables(t.text),
    })).filter((v) => v.syllables.length).sort((a, b) => a.verse - b.verse);
  });
}

const sizeOf = (style) => style(SID.LYRICS_FONT_SIZE) / PT;
const textOf = (s) => (s.join === '-' ? `${s.text}-` : s.text);

/** What a verse writes in measure `mi`: { list: syllables, widths, sum } or null. */
function measureText(v, mi, size) {
  const list = v.syllables.filter((s) => s.bar === mi - v.from);
  if (!list.length) return null;
  const widths = list.map((s) => lyricTextWidth(textOf(s), size));
  return { list, widths, sum: widths.reduce((a, b) => a + b, 0) };
}

const CARRIER_TYPES = ['chord', 'rhythm'];
/** y (up from the origin of the staff) below which the lyrics start: the bars of a chord staff, the bars and the stems of a rhythm staff. */
const bottomOf = (type) => (type === 'rhythm' ? -2.5 : 0);

/**
 * Indices (in `staves`, items of `{ staff }`) of the staves that carry the grid lyrics: those whose property says 'on' (chord or rhythm staves);
 * when none does, the first chord staff that does not say 'off'.
 */
export function gridLyricsStaves(staves) {
  const typeOf = (s) => getProperty(s.staff, PID.STAFF_TYPE);
  const on = [];
  staves.forEach((s, i) => { if (CARRIER_TYPES.includes(typeOf(s)) && getProperty(s.staff, PID.GRID_LYRICS) === 'on') on.push(i); });
  if (on.length) return on;
  const first = staves.findIndex((s) => typeOf(s) === 'chord' && getProperty(s.staff, PID.GRID_LYRICS) !== 'off');
  return first < 0 ? [] : [first];
}

/**
 * @param sys       the system being built (`sys.measures`: { mi, start, content, barX })
 * @returns {object[]} text items of the chord staff (y down from the top of the bars, like the other painters of staves), with their `box`
 */
export function gridLyricItems({ ctx, sys, type = 'chord' }) {
  const verses = gridVerses(ctx);
  if (!verses.length) return [];
  const size = sizeOf(ctx.style);
  const lineH = LINE_SPACING * size * ctx.style(SID.LYRICS_LINE_HEIGHT);
  const items = [];
  verses.forEach((v, row) => {
    const y = bottomOf(type) - (GAP + ASCENT * size + row * lineH); // the baseline, under the bars (y goes up from the bottom of the bars)
    for (const m of sys.measures) {
      const t = measureText(v, m.mi, size);
      if (!t) continue;
      const gap = Math.max(MIN_GAP, (m.content - LEFT_PAD - t.sum) / t.list.length);
      let x = m.start + LEFT_PAD;
      t.list.forEach((s, j) => {
        items.push({ kind: 'text', role: 'grid-lyric', text: textOf(s), x, y, size, anchor: 'start', ref: `${v.id}#${s.index}`, box: { x1: 0, x2: t.widths[j], y1: -DESCENT * size, y2: ASCENT * size } });
        x += t.widths[j] + gap;
      });
    }
  });
  return items;
}

/**
 * Room for the grid lyrics in the horizontal spacing: the first entry of each measure of the chord staff gets one LYRICS box as wide as the longest verse written in that
 * measure, so the measures grow to hold the words (`entry.lyricBoxes`, read by shapes.js).
 */
export function attachGridLyricBoxes({ movement, lyricTexts, memo, style, staves, entries }) {
  const ctx = { movement, lyricTexts, memo, style };
  const verses = gridVerses(ctx);
  if (!verses.length) return;
  const size = sizeOf(style);
  const lineH = LINE_SPACING * size * style(SID.LYRICS_LINE_HEIGHT);
  for (const si of gridLyricsStaves(staves)) {
    const bottom = bottomOf(getProperty(staves[si].staff, PID.STAFF_TYPE));
    movement.masterbars.forEach((_, mi) => {
      const first = entries[si]?.[mi]?.[0];
      if (!first) return;
      const boxes = [];
      verses.forEach((v, row) => {
        const t = measureText(v, mi, size);
        if (!t) return;
        const base = bottom - (GAP + ASCENT * size + row * lineH);
        boxes.push({ l: 0, r: LEFT_PAD + t.sum + t.list.length * MIN_GAP, t: base - DESCENT * size, b: base + ASCENT * size, syllabic: 'single', melisma: false, side: 'below' });
      });
      if (boxes.length) first.lyricBoxes = [...(first.lyricBoxes ?? []), ...boxes];
    });
  }
}
