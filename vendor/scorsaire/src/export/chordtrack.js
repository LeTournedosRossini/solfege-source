/*
 * The CHORD TRACK of a movement as a file for another tool (Flibuste's Carte): `flibuste-accords` version 1, written by Scorsaire.
 *   { format, version: 1, from: 'scorsaire', unrolled, title, timeSignatures: [{ fromMeasure, ts }], measures: [{ at, dur, ts, source }],
 *     chords: [{ at, dur, root, quality, bass } | { at, dur, nc: true }], qualities: { <id>: [semitones] } }
 * Rules decided with Jean (05/11/2026):
 *  - the song is UNROLLED by default (what is played: repeats, voltas and jumps developed as in `playOrder`); `unrolled: false` keeps the written order;
 *  - SCORSAIRE'S METRE rules: the time signature belongs to each measure; a measure has its REAL length (an irregular measure, a pick-up, is shorter than its signature), so the
 *    bar lines are the `measures` list, never deduced from the signatures; times are exact fractions of a whole note [n, d] from the start of the (unrolled) song;
 *  - `dur` of a chord = the time until the next chord (or no-chord), or the end of the song for the last one; `at` is the reference;
 *  - the chords are those of the FIRST chord staff of the movement; `%` and `%%` write nothing (the chord before goes on); « no chord » is `{ nc: true }`;
 *  - `root` and `bass` are letters with up to two `#` or `b`; `quality` is the identifier of Scorsaire's dictionary (major = ''); `qualities` gives the semitones of those used.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { playOrder } from '../model/repeatlist.js';
import { measureLengthOf } from '../model/timing.js';
import { fAdd, fSub, ZERO, fCmp } from '../model/fraction.js';
import { workChordQualities } from '../model/chordqualityedit.js';
import { findChordQuality } from '../model/chordquality.js';

export const CHORD_TRACK_FORMAT = 'flibuste-accords';
export const CHORD_TRACK_VERSION = 1;

const letter = (name) => (name ? `${name.step}${name.alter > 0 ? '#'.repeat(name.alter) : name.alter < 0 ? 'b'.repeat(-name.alter) : ''}` : null);

/** @returns the object of the file (see above) for movement `movement` of `work`. */
export function exportChordTrack(work, { movement = 0, unrolled = true } = {}) {
  const mv = work.movements[movement];
  if (!mv) throw new Error(`Unknown movement: ${movement}`);
  const order = playOrder(mv, { expand: unrolled });
  const staff = mv.tracks.flatMap((t) => t.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'chord') ?? null;

  const measures = []; const events = []; const timeSignatures = [];
  let t = ZERO; let lastTs = null;
  order.forEach((mi, pass) => {
    const bar = mv.masterbars[mi];
    const ts = [...getProperty(bar, PID.TIME_SIG)];
    const len = measureLengthOf(bar);
    measures.push({ at: t, dur: len, ts, source: mi });
    if (!lastTs || lastTs[0] !== ts[0] || lastTs[1] !== ts[1]) { timeSignatures.push({ fromMeasure: pass, ts }); lastTs = ts; }
    for (const voice of staff?.voices ?? []) {
      for (const item of voice.measures[mi]?.items ?? []) {
        if (item.type !== 'chordsymbol') continue;
        const special = getProperty(item, PID.CHORD_SPECIAL) ?? 'none';
        if (special === 'repeat1' || special === 'repeat2') continue;
        const position = getProperty(item, PID.POSITION) ?? ZERO;
        if (fCmp(position, len) >= 0) continue;
        events.push({ at: fAdd(t, position), item, nc: special === 'noChord' });
      }
    }
    t = fAdd(t, len);
  });
  events.sort((a, b) => fCmp(a.at, b.at));

  const dict = workChordQualities(work);
  const used = new Set();
  const chords = events.map((e, i) => {
    const end = i + 1 < events.length ? events[i + 1].at : t;
    const dur = fSub(end, e.at);
    if (e.nc) return { at: e.at, dur, nc: true };
    const root = getProperty(e.item, PID.CHORD_ROOT);
    if (!root) return null;
    const quality = getProperty(e.item, PID.CHORD_QUALITY) ?? '';
    used.add(quality);
    return { at: e.at, dur, root: letter(root), quality, bass: letter(getProperty(e.item, PID.CHORD_BASS)) };
  }).filter(Boolean);

  const qualities = {};
  for (const id of [...used].sort()) { const q = findChordQuality(dict, id); if (q) qualities[id] = [...q.intervals]; }
  return { format: CHORD_TRACK_FORMAT, version: CHORD_TRACK_VERSION, from: 'scorsaire', unrolled, title: String(getProperty(work, PID.TITLE) ?? ''), timeSignatures, measures, chords, qualities };
}

export const serializeChordTrack = (work, options) => JSON.stringify(exportChordTrack(work, options), null, 2);
