/*
 * The hold line of a lyrics EVENT track: a syllable held over several notes (a melisma, `PID.LYRIC_HOLD` = how long it is held) can carry a line from the end of its text to the end of
 * the last note it covers. Off by default (`SID.LYRICS_HOLD_LINE`): then the following notes simply have no syllable. Drawn as an overlay with `xAt` (the x of an instant), after the
 * syllables are painted; nothing moves in the layout.
 */
import { PID, SID, getProperty } from '../model/index.js';
import { fAdd, fCmp } from '../model/fraction.js';

export function lyricHoldItems({ ctx, sref, sys, xAt, existing }) {
  if (getProperty(sref.staff, PID.STAFF_TYPE) !== 'lyrics') return [];
  const style = sref.ctx?.style ?? ctx.style;
  if (!style(SID.LYRICS_HOLD_LINE)) return [];
  const inSystem = new Map(sys.measures.map((m) => [m.mi, m]));
  const last = sys.measures[sys.measures.length - 1];
  const out = [];
  for (const voice of sref.staff.voices ?? []) {
    voice.measures.forEach((measure, mi) => {
      if (!inSystem.has(mi)) return;
      for (const item of measure?.items ?? []) {
        if (item.type !== 'lyricevent') continue;
        const hold = getProperty(item, PID.LYRIC_HOLD); const position = getProperty(item, PID.POSITION);
        if (!hold || !position) continue;
        const run = existing.find((it) => it.ref === item.id && it.role === 'lyric-event');
        if (!run) continue;
        const end = fAdd(fAdd(ctx.offsets?.[mi] ?? [0, 1], position), hold);
        let me = mi;
        while (me < ctx.barLengths.length - 1 && fCmp(end, fAdd(ctx.offsets?.[me] ?? [0, 1], ctx.barLengths[me])) > 0) me += 1;
        const x2 = inSystem.has(me) ? xAt(me, end) : last.barX; // a hold that runs on to the next system stops at the barline
        const x1 = run.x + (run.box?.x2 ?? 1) + 0.15 * run.size;
        if (!(x2 > x1 + 0.3)) continue;
        const y = run.y - 0.1 * run.size;
        out.push({ kind: 'line', role: 'lyric-hold', x1, y1: y, x2, y2: y, width: 0.07 * run.size, cap: 'butt', ref: item.id });
      }
    });
  }
  return out;
}
