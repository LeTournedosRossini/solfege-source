/*
 * Changing the TIME SIGNATURE of measures that already hold music (4/4 → 12/8). CALL IT INSIDE `doc.transaction(name, () => …)`: one gesture = one undoable step.
 *
 * Rule (decided with Jean, 04/11/2026): the notes STAY where they are, measure by measure — nothing flows from one measure into the next.
 *   - a longer measure gets automatic rests at its end;
 *   - a shorter measure is CUT: a note or rest that starts after the new end goes, one that crosses it is shortened to the longest written value that fits
 *     (the rest of the room becomes rests), and a tuplet that the new end would cut is replaced by rests as a whole.
 * Chord symbols and lyrics (staves whose items carry their own position) follow the same rule. An irregular length (pickup measure) and a hand-made beam grouping
 * of a changed measure are dropped: they belonged to the old signature. `planTimeSignature` counts what would be lost, without touching anything, to warn first.
 *
 *   planTimeSignature(mv, { from, to, timeSig }) → { measures, cut: { notes, rests, tuplets, shortened } }
 *   changeTimeSignature(doc, mv, { from, to, timeSig }) → the same report
 *   signatureSpanFrom(mv, from) → index of the last measure that shares the signature of measure `from` (“from this measure to the next change”)
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { STAFF_TYPES, isApplicable } from './schema.js';
import { timeSigDuration, MEASURE_DURATION } from './pitch.js';
import { measureLengthOf, itemDuration } from './timing.js';
import { inputGridError } from './inputgrid.js';
import { fAdd, fSub, fLt, fLe, fCmp, ZERO } from './fraction.js';
import { toRhythmicDurationList, durationValue } from './rhythmsplit.js';
import { measureTimeline, replaceVoiceMeasure } from './noteedit.js';
import { EditError } from './noteedit.js';

export const TIME_SIG_DENOMINATORS = [1, 2, 4, 8, 16, 32];

const staffsOf = (mv) => mv.tracks.flatMap((t) => t.staves);
const sequential = (staff) => STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.items.includes('rest');
const isRest = (item) => item.type === 'rest';
const tupletOf = (item) => (isApplicable(item.type, PID.TUPLET) ? getProperty(item, PID.TUPLET) : null);

function checkSig(timeSig) {
  const [num, den] = timeSig ?? [];
  if (!Number.isInteger(num) || num < 1 || num > 32 || !TIME_SIG_DENOMINATORS.includes(den)) throw new EditError('Invalid time signature');
  return [num, den];
}

/** The last measure that shares the signature of measure `from` (and no hand-made length), so that “from here” stops where the signature already changes. */
export function signatureSpanFrom(mv, from) {
  const sig = getProperty(mv.masterbars[from], PID.TIME_SIG);
  let last = from;
  while (last + 1 < mv.masterbars.length) {
    const next = getProperty(mv.masterbars[last + 1], PID.TIME_SIG);
    if (next[0] !== sig[0] || next[1] !== sig[1]) break;
    last += 1;
  }
  return last;
}

/** The longest single written value (dots included) that fits in `length` from `start`, as the metre of the new signature would write it. */
function fitting(length, start, timeSig, newLen) {
  const [first] = toRhythmicDurationList(length, { isRest: true, start, timeSig, measureLength: newLen, allowMeasureRest: false, offset: ZERO, maxDots: 1 });
  return first;
}

/** What one voice of one measure becomes: the units that stay (`{ el, start, end, duration? }`), and what goes. */
function planSequential(measure, oldLen, newLen, timeSig) {
  const timeline = measureTimeline(measure, oldLen);
  // tuplet groups: contiguous members with the same id
  const groups = new Map();
  for (const u of timeline) { const t = tupletOf(u.item); if (!t) continue; const g = groups.get(t.id) ?? { start: u.start, end: u.end, members: [] }; g.end = u.end; g.members.push(u); groups.set(t.id, g); }
  const keep = []; const dropped = []; let shortened = 0; let tuplets = 0;
  const seenGroups = new Set();
  for (const u of timeline) {
    const item = u.item;
    const t = tupletOf(item);
    const duration = getProperty(item, PID.DURATION);
    if (t) {
      const g = groups.get(t.id);
      if (fLe(g.end, newLen)) keep.push({ el: item, start: u.start, end: u.end });
      else { dropped.push(item); if (!seenGroups.has(t.id)) { seenGroups.add(t.id); tuplets += 1; } }
      continue;
    }
    if (isRest(item) && (duration.base === MEASURE_DURATION || (getProperty(item, PID.EXPLICIT) !== true && getProperty(item, PID.GAP) !== true))) continue; // automatic rests are written again
    if (fLe(newLen, u.start)) { dropped.push(item); continue; }
    if (fLt(newLen, u.end)) {
      const d = fitting(fSub(newLen, u.start), u.start, timeSig, newLen);
      keep.push({ el: item, start: u.start, end: fAdd(u.start, durationValue(d)), duration: d });
      shortened += 1;
    } else keep.push({ el: item, start: u.start, end: u.end });
  }
  return { keep, dropped, shortened, tuplets };
}

/** Staves whose items carry their own position (chord symbols, lyrics): what stays, what is shortened, what goes. */
function planPositioned(measure, oldLen, newLen, timeSig) {
  const dropped = []; const shorten = [];
  for (const item of measure.items) {
    const pos = getProperty(item, PID.POSITION) ?? ZERO;
    if (fLe(newLen, pos)) { dropped.push(item); continue; }
    const dur = getProperty(item, PID.DURATION);
    if (!dur || dur.base === MEASURE_DURATION) continue;
    const end = fAdd(pos, itemDuration(item, oldLen));
    if (fLt(newLen, end)) shorten.push({ item, duration: fitting(fSub(newLen, pos), pos, timeSig, newLen) });
  }
  return { dropped, shorten };
}

function check(mv, from, to, timeSig) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= mv.masterbars.length) throw new EditError('Invalid range of measures');
  return checkSig(timeSig);
}

function planAll(mv, { from, to, timeSig }) {
  const sig = check(mv, from, to, timeSig);
  const newLen = timeSigDuration(sig);
  const plans = []; const report = { measures: 0, cut: { notes: 0, rests: 0, tuplets: 0, shortened: 0 } };
  for (let mi = from; mi <= to; mi += 1) {
    const bar = mv.masterbars[mi];
    const old = getProperty(bar, PID.TIME_SIG);
    const oldLen = measureLengthOf(bar);
    if (old[0] === sig[0] && old[1] === sig[1] && fCmp(oldLen, newLen) === 0) continue; // already so
    report.measures += 1;
    for (const staff of staffsOf(mv)) {
      if (sequential(staff)) {
        staff.voices.forEach((voice, v) => {
          const measure = voice.measures[mi]; if (!measure) return;
          const plan = planSequential(measure, oldLen, newLen, sig);
          plans.push({ kind: 'sequential', staff, voice: v, mi, plan });
          for (const item of plan.dropped) report.cut[item.type === 'chord' ? 'notes' : 'rests'] += 1;
          report.cut.tuplets += plan.tuplets; report.cut.shortened += plan.shortened;
        });
      } else {
        staff.voices.forEach((voice) => {
          const measure = voice.measures[mi]; if (!measure) return;
          const plan = planPositioned(measure, oldLen, newLen, sig);
          plans.push({ kind: 'positioned', staff, mi, plan });
          report.cut.notes += plan.dropped.length; report.cut.shortened += plan.shorten.length;
        });
      }
    }
  }
  return { plans, report, sig };
}

/** What changing the signature of measures `from`…`to` would cost, without changing anything. */
export function planTimeSignature(mv, o) { return planAll(mv, o).report; }

export function changeTimeSignature(doc, mv, o) {
  const { plans, report, sig } = planAll(mv, o); // everything is read from the measures AS THEY ARE before anything changes
  for (let mi = o.from; mi <= o.to; mi += 1) {
    const bar = mv.masterbars[mi];
    doc.set(bar, PID.TIME_SIG, sig);
    if (o.style !== undefined) { // how it is written: digits, C (4/4 only) or cut C (2/2 only); `normal` is the default and is not stored
      if (o.style && o.style !== 'normal') doc.set(bar, PID.TIME_SIG_STYLE, o.style); else if (bar.props[PID.TIME_SIG_STYLE] != null) doc.reset(bar, PID.TIME_SIG_STYLE);
    }
    for (const pid of [PID.MEASURE_LENGTH, PID.MEASURE_OFFSET, PID.BEAM_GROUPING]) if (bar.props[pid] != null) doc.reset(bar, pid);
    { const grid = getProperty(bar, PID.INPUT_GRID); if (grid && inputGridError(grid, measureLengthOf(bar))) doc.reset(bar, PID.INPUT_GRID); } // the chord cells of the old signature (two per measure in a new score) that no longer fit the new length: back to the cells of the new signature
  }
  for (const p of plans) {
    if (p.kind === 'positioned') {
      for (const s of p.plan.shorten) doc.set(s.item, PID.DURATION, s.duration);
      for (const item of p.plan.dropped) doc.remove(item);
    } else {
      for (const k of p.plan.keep) if (k.duration) doc.set(k.el, PID.DURATION, k.duration);
      replaceVoiceMeasure(doc, { staff: p.staff, voice: p.voice, measure: p.mi, occupants: p.plan.keep.map(({ el, start, end }) => ({ el, start, end })) });
    }
  }
  followContainers(doc, mv, o.from, o.to, sig);
  return report;
}

/** The nested scores aligned on the measures that changed (above a staff, on screen 1 or hung by a part) follow the new length: the same rule, on the measures they cover. */
function followContainers(doc, mv, from, to, sig) {
  const hung = (doc.work.parts ?? []).flatMap((p) => p.containers ?? []).filter((c) => getProperty(c, PID.CONTAINER_PLACEMENT) !== 'zone');
  for (const staff of staffsOf(mv)) {
    for (const c of [...(staff.containers ?? []), ...hung.filter((h) => getProperty(h, PID.CONTAINER_STAFF_ID) === staff.id)]) {
      const fragment = c.fragments?.[0];
      if (!fragment || getProperty(c, PID.CONTAINER_LAYOUT) === 'free' || getProperty(c, PID.CONTAINER_PLACEMENT) === 'between') continue; // independent of the piece
      const first = mv.masterbars.findIndex((b) => b.id === getProperty(c, PID.MEASURE_ID));
      if (first < 0) continue;
      const ownTime = getProperty(c, PID.CONTAINER_SHOW_TIMESIG);
      for (let k = Math.max(0, from - first); k < fragment.masterbars.length && first + k <= to; k += 1) {
        if (ownTime) continue; // an own signature is kept as written (and must keep the length: the editor of the container says so)
        changeTimeSignature(doc, fragment, { from: k, to: k, timeSig: sig });
      }
    }
  }
}
