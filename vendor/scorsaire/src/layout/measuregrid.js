/*
 * The MEASURE GRID: the bar lines of one system fall under those of the others. The line is cut into equal COLUMNS of one base width; a measure takes one column when it is a usual
 * one, two (or more) when it is too dense for one, and half a column when it is very light (two light measures side by side share a column). A line that holds fewer columns than
 * the page keeps its last columns empty, so that the bar lines stay where they are in the other lines. Pure: widths in staff spaces, no layout.
 *
 *   planGrid({ need, overhead, natural, slots, avail, base, chords, starts, breaksAfter }) → { columns, pitch, base, lines: [[{ mi, col, span }]] }
 *     need[mi]      the width a measure asks for at its natural spacing (its notes AND the bar, the gaps…)
 *     overhead[mi]  what of `need` is not the notes (bar, gaps): used to size a column from a number of chords
 *     natural[mi] / slots[mi]  the width of the notes and the number of time columns of a measure (for the « N chords » base)
 *     avail         the width of the line left for the columns (after the clef / key / time signature, the same on every line)
 *     base          'common' (the width most measures ask for) | 'widest' | 'chords' (a measure of `chords` chords)
 *     columns       a number of columns asked for (0 = as many as the base width lets fit)
 *     stretch       'off' (default) | '2' | '3' | 'any': the last measure of a line takes the empty columns that follow it, so that its end bar falls on the right edge like the
 *                   full lines (the inner bars do not move). Only when it then spans at most 2 (3) columns, 'any' = always; never on the last line of the movement
 *     starts        Set of measures that begin a section (a new line always begins there); breaksAfter: Set of measures a line ends after
 */
const EPS = 1e-6;
const FIT = 1.12; // a measure may be pressed by this much into its columns (the bar of the end, a key change…) before it takes more of them

const median = (list) => { const a = [...list].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

/** The width of one column, in spaces, for the base chosen. */
export function baseWidth({ need, overhead = [], natural = [], slots = [], base = 'common', chords = 2 }) {
  if (!need.length) return 1;
  if (base === 'widest') return Math.max(...need);
  if (base === 'chords') {
    let n = 0; let s = 0;
    natural.forEach((w, i) => { if (slots[i] > 0) { n += w; s += slots[i]; } });
    if (s > 0) return Math.max(1, median(overhead) + chords * (n / s));
  }
  // the width most measures ask for: widths are grouped by steps of about a twelfth of the median, the fullest step wins (the wider one on a tie)
  const step = Math.max(0.5, median(need) / 12);
  const bins = new Map();
  for (const w of need) { const k = Math.round(w / step); const b = bins.get(k) ?? { n: 0, sum: 0 }; b.n += 1; b.sum += w; bins.set(k, b); }
  let best = null;
  for (const [k, b] of bins) if (!best || b.n > best.n || (b.n === best.n && k > best.k)) best = { k, n: b.n, mean: b.sum / b.n };
  return best.mean;
}

export function planGrid({ need, overhead = [], natural = [], slots = [], avail, base = 'common', chords = 2, columns: fixedColumns = 0, stretch = 'off', starts = new Set(), breaksAfter = new Set() }) {
  const w0 = baseWidth({ need, overhead, natural, slots, base, chords });
  const columns = fixedColumns > 0 ? Math.min(64, Math.floor(fixedColumns)) : Math.max(1, Math.min(64, Math.floor(avail / w0 + EPS))); // a number of columns given: the columns share the line, whatever the base
  const pitch = avail / columns;
  const unit = need.map((w) => w / pitch);
  const breakBefore = (mi) => mi > 0 && (starts.has(mi) || breaksAfter.has(mi - 1));
  const lines = []; let line = null; let col = 0;
  const place = (mi, span, width) => {
    if (!line || col + width > columns + EPS) { line = []; lines.push(line); col = 0; }
    line.push({ mi, col, span }); col += width;
  };
  for (let mi = 0; mi < need.length; mi += 1) {
    if (breakBefore(mi)) line = null;
    const u = unit[mi];
    if (u <= 0.5 * FIT + EPS) {
      if (mi + 1 < need.length && !breakBefore(mi + 1) && unit[mi + 1] <= 0.5 * FIT + EPS) { // two light measures share a column
        place(mi, 0.5, 1); line[line.length - 1].span = 0.5; col -= 0.5; // (the pair is placed together: the second takes the other half)
        line.push({ mi: mi + 1, col, span: 0.5 }); col += 0.5; mi += 1;
      } else place(mi, 1, 1);
    } else if (u <= FIT + EPS) place(mi, 1, 1);
    else { const span = Math.min(columns, Math.ceil(u / FIT - EPS)); place(mi, span, span); }
  }
  if (stretch !== 'off') {
    const cap = stretch === 'any' ? Infinity : Number(stretch) || 0;
    lines.forEach((items, i) => {
      if (i === lines.length - 1) return; // the last line of the movement stays as it is
      const last = items[items.length - 1];
      const free = columns - (last.col + last.span);
      if (free > EPS && last.span + free <= cap + EPS) last.span += free;
    });
  }
  return { columns, pitch, base: w0, lines };
}
