/*
 * The score of a Songsterr archive poured into the song of an All-in-One (Moïses) archive: the chords, the beat map, the time map and the audio stay those of the
 * analysis; the staves (the parts) come from Songsterr. PURE: analysis + imported work in, the analysis to import and the work to complete out.
 *
 *   planPartsMerge(analysis, sourceWork, { videos })  → { ok, shift, pickup, trimLast, dropLast, issues, video, … }   how the measures of the two files correspond
 *   mergeAnalysis(analysis, plan)                     → the analysis with the lead-in beat of a pick-up added and the end trimmed (then imported as usual)
 *   pourParts(work, sourceWork, { shift, sections })  → the parts of `sourceWork` added to `work` (the staves are given the measures of the target)
 *
 * `shift` = target measure − source measure (−1: the source starts with a pick-up the analysis does not have; 0: same start; n > 0: the analysis starts n measures
 * earlier, they stay empty). A measure of the source must be as long as the measure it goes on; the only ways out are the pick-up (added to the analysis) and a
 * short last measure (the analysis measure is cut to it). Anything else is a refusal that names the measure: a wrong pouring would shift every note.
 */
import { cleanBeats, groupMeasures } from './allinone.js';
import { measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';
import { PID } from '../model/pid.js';
import { createVoice, createStaff, createTrack, createEmptyMeasure, createSystemContainer } from '../model/elements.js';
import { withWrites } from '../model/guard.js';
import { setProp } from './musicxml-marks.js';
import { usablePoints } from '../audio/videosync.js';
import { lyricEventsOf, lyricsTrackFor } from '../model/lyricevents.js';

const SHIFTS = [0, -1, 1, 2, 3, 4]; // in this order when nothing tells them apart
const VIDEO_TOLERANCE = 0.3; // seconds: the measure starts of the video and of the beat map agree within this
const EPS = 1e-9;
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const whole = (x) => Math.abs(x - Math.round(x)) < EPS;

/** Beats (quarter notes) of every measure of a work. */
const beatsOfWork = (work) => work.movements[0].masterbars.map((b) => fToNumber(measureLengthOf(b)) * 4);

/**
 * @param analysis   { beats } as read from the archive
 * @param sourceWork the work imported from the Songsterr archive
 * @param o.videos   [{ videoId, points }] the videos of that archive: their measure times tell the shift (the first usable one is used)
 * @param o.shift    force the shift (the person's choice) instead of looking for it
 */
export function planPartsMerge(analysis, sourceWork, { videos = [], shift: forced = null } = {}) {
  const groups = groupMeasures(cleanBeats(analysis.beats));
  const tBeats = groups.map((g) => g.beats.length); const tStart = groups.map((g) => g.beats[0].time);
  const sBeats = beatsOfWork(sourceWork);
  const nT = tBeats.length; const nS = sBeats.length;
  const nominal = (() => { const c = new Map(); for (const n of tBeats) c.set(n, (c.get(n) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 4; })();
  const video = videos.find((v) => usablePoints(v.points, nS)) ?? null;

  const evaluate = (shift) => {
    const mismatches = []; let trim = null; let over = 0; const errors = [];
    for (let s = Math.max(0, -shift); s < nS; s += 1) {
      const t = s + shift;
      if (t >= nT) { over += 1; continue; }
      if (Math.abs(sBeats[s] - tBeats[t]) > EPS) {
        if (s === nS - 1 && tBeats[t] > sBeats[s] && whole(sBeats[s]) && sBeats[s] > 0) trim = { measure: t, beats: sBeats[s] }; // a short last measure
        else mismatches.push({ source: s, target: t, sourceBeats: sBeats[s], targetBeats: tBeats[t] });
      }
      if (video && t >= 0) errors.push(Math.abs(video.points[s] - tStart[t]));
    }
    return { shift, mismatches, trim, over, videoMean: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null, videoMax: errors.length ? Math.max(...errors) : null };
  };
  const candidates = (forced != null ? [forced] : SHIFTS).map(evaluate);
  const rank = (c) => [c.videoMean != null && c.videoMean < VIDEO_TOLERANCE ? 0 : 1, c.mismatches.length + c.over, c.videoMean ?? 0];
  const best = [...candidates].sort((a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; })[0];

  const issues = [];
  const { shift } = best;
  let pickup = null;
  if (shift < 0) {
    const nb = sBeats[0];
    if (shift < -1 || !whole(nb) || nb < 1 || nb >= nominal) issues.push({ code: 'leading', source: 0, beats: nb });
    else pickup = { beats: nb };
  }
  for (const m of best.mismatches) issues.push({ code: 'length', ...m });
  if (best.over) issues.push({ code: 'longer', count: best.over, sourceMeasures: nS, targetMeasures: nT });
  if (video && best.videoMean != null && best.videoMean >= VIDEO_TOLERANCE) issues.push({ code: 'video', mean: best.videoMean, max: best.videoMax });
  // the end: measures of the analysis after the last measure of the source stay empty, except an irregular last one (a tail of the analysis, not music)
  const lastCovered = Math.min(nT - 1, nS - 1 + shift);
  let dropLast = false;
  if (!best.over && nT - 1 > lastCovered && tBeats[nT - 1] !== nominal && nT - 1 > lastCovered) dropLast = true;
  const extra = Math.max(0, nT - 1 - lastCovered - (dropLast ? 1 : 0));
  return {
    ok: issues.length === 0, shift, pickup, trimLast: best.trim, dropLast, emptyAfter: extra, issues,
    video: video ? { videoId: video.videoId, mean: best.videoMean, max: best.videoMax } : null,
    counts: { source: nS, target: nT }, candidates: candidates.map((c) => ({ shift: c.shift, mismatches: c.mismatches.length, videoMean: c.videoMean })),
  };
}

/** The analysis to import: a lead-in beat (or more) before the first one for a pick-up, the cut measure and the dropped tail. The input is not changed. */
export function mergeAnalysis(analysis, plan) {
  const clean = cleanBeats(analysis.beats);
  const groups = groupMeasures(clean);
  const nominal = (() => { const c = new Map(); for (const g of groups) c.set(g.beats.length, (c.get(g.beats.length) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 4; })();
  const kept = groups.map((g) => ({ beats: [...g.beats] }));
  if (plan.trimLast) kept[plan.trimLast.measure].beats.length = Math.min(kept[plan.trimLast.measure].beats.length, plan.trimLast.beats);
  if (plan.dropLast) kept.pop();
  let beats = kept.flatMap((g) => g.beats);
  if (plan.pickup) {
    const nb = plan.pickup.beats; const first = beats[0].time;
    const step = median(beats.slice(1, 9).map((b, i) => b.time - beats[i].time)) || 0.5;
    const times = first - nb * step >= 0 ? Array.from({ length: nb }, (_, k) => first - (nb - k) * step) : Array.from({ length: nb }, (_, k) => (first * k) / nb); // before the start of the audio: spread over what there is
    beats = [...times.map((time, k) => ({ time, beatNum: nominal - nb + 1 + k })), ...beats];
  }
  return { ...analysis, beats };
}

/** A copy of `value` where every `measureId` that `map` knows is replaced (staff lists hold plain objects anchored on measure ids). */
function remapMeasureIds(value, map) {
  if (Array.isArray(value)) return value.map((v) => remapMeasureIds(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === 'measureId' && map.has(v) ? map.get(v) : remapMeasureIds(v, map);
    return out;
  }
  return value;
}

/**
 * Adds the tracks of `sourceWork` to `work` (the first movement of each; both are fresh imports, not in a document). The measures of the source go on the measures of
 * the target at `target = source + shift` (the target measures with no source measure get an empty measure). `sections`: 'target' keeps the sections of `work`;
 * 'source' replaces them by those of the source; 'both' keeps both (a measure that has both keeps the source's).
 * @returns {{ tracks: number, sections: number }}
 */
export function pourParts(work, sourceWork, { shift = 0, sections = 'source', title = true } = {}) {
  const mv = work.movements[0]; const src = sourceWork.movements[0];
  const targetIds = mv.masterbars.map((b) => b.id); const sourceIds = src.masterbars.map((b) => b.id);
  const idMap = new Map(); sourceIds.forEach((id, s) => { if (targetIds[s + shift]) idMap.set(id, targetIds[s + shift]); });
  const built = [];
  for (const track of src.tracks) {
    const staves = track.staves.map((staff) => {
      const type = staff.props[PID.STAFF_TYPE];
      const voices = staff.voices.map((voice) => createVoice(targetIds.map((_, t) => voice.measures[t - shift] ?? createEmptyMeasure(type))));
      const props = {}; for (const [k, v] of Object.entries(staff.props)) props[k] = remapMeasureIds(v, idMap);
      return createStaff({ type, clef: staff.props[PID.CLEF], voices, props });
    });
    const props = {}; for (const [k, v] of Object.entries(track.props)) props[k] = v;
    built.push(createTrack({ name: track.props[PID.NAME], abbreviation: track.props[PID.ABBREVIATION], transposition: track.props[PID.TRANSPOSITION], staves, props }));
  }
  withWrites(() => { for (const t of built) mv.tracks.push(t); });

  let nSections = 0;
  if (sections !== 'target') {
    const fromSource = src.systemContainers.filter((c) => idMap.has(c.props[PID.MEASURE_ID])).map((c) => createSystemContainer({ measureId: idMap.get(c.props[PID.MEASURE_ID]), kind: c.props[PID.CONTAINER_KIND] ?? 'section', label: c.props[PID.LABEL], category: c.props[PID.CATEGORY] }));
    const mine = new Set(fromSource.map((c) => c.props[PID.MEASURE_ID]));
    const keep = sections === 'both' ? [...mv.systemContainers].filter((c) => !mine.has(c.props[PID.MEASURE_ID])) : [];
    const order = (c) => targetIds.indexOf(c.props[PID.MEASURE_ID]);
    const all = [...keep, ...fromSource].sort((a, b) => order(a) - order(b));
    withWrites(() => { mv.systemContainers.splice(0, mv.systemContainers.length, ...all); });
    nSections = fromSource.length;
  }
  if (title) {
    const t = src.props[PID.TITLE] || sourceWork.props[PID.TITLE]; const composer = sourceWork.props[PID.COMPOSER];
    if (t) setProp(work, PID.TITLE, t);
    if (composer) setProp(work, PID.SUBTITLE, composer);
  }
  return { tracks: built.length, sections: nSections };
}

/** The sections of a work as [{ measure (index), label, category }], in order. */
export function sectionsOf(work) {
  const mv = work.movements[0]; const ids = mv.masterbars.map((b) => b.id);
  return mv.systemContainers.filter((c) => (c.props[PID.CONTAINER_KIND] ?? 'section') === 'section')
    .map((c) => ({ measure: ids.indexOf(c.props[PID.MEASURE_ID]), label: c.props[PID.LABEL], category: c.props[PID.SECTION_CATEGORY] ?? 'custom' }))
    .filter((x) => x.measure >= 0 && x.label).sort((a, b) => a.measure - b.measure);
}

/** The sections of the source seen on the measures of the target (`measure + shift`; the ones that fall outside are dropped). */
export const shiftSections = (list, shift, count) => list.map((x) => ({ ...x, measure: x.measure + shift })).filter((x) => x.measure >= 0 && x.measure < count);

/** Which sections the song has: 'audio' (those of the analysis), 'part' (those of the score) or 'both' (a measure that has both keeps the score's). */
export function combineSections(audio, part, mode) {
  if (mode === 'audio') return audio;
  if (mode === 'part') return part;
  const taken = new Set(part.map((x) => x.measure));
  return [...part, ...audio.filter((x) => !taken.has(x.measure))].sort((a, b) => a.measure - b.measure);
}

/**
 * The chord track of an imported analysis (`impWork`, from `importAllInOne`) as a track for a score that is the other file: its measures `shift + i` go on the measure
 * `i` of the score (`count` measures). Also the input grids of those measures (a masterbar setting) and the chord qualities the symbols need.
 * @returns {{ track, grids: { measure: number, value }[], qualities } | null} null when the analysis has no chord track
 */
export function chordTrackFor(impWork, { shift = 0, count }) {
  const mv = impWork.movements[0];
  const source = mv.tracks.find((t) => t.staves.some((st) => st.props[PID.STAFF_TYPE] === 'chord'));
  const staff = source?.staves.find((st) => st.props[PID.STAFF_TYPE] === 'chord');
  if (!staff) return null;
  const measures = Array.from({ length: count }, (_, i) => staff.voices[0].measures[i + shift] ?? createEmptyMeasure('chord'));
  const props = {}; for (const [k, v] of Object.entries(staff.props)) props[k] = v;
  const track = createTrack({ name: source.props[PID.NAME], abbreviation: source.props[PID.ABBREVIATION], staves: [createStaff({ type: 'chord', clef: staff.props[PID.CLEF], voices: [createVoice(measures)], props })] });
  const grids = [];
  for (let i = 0; i < count; i += 1) { const value = mv.masterbars[i + shift]?.props[PID.INPUT_GRID]; if (value) grids.push({ measure: i, value }); }
  return { track, grids, qualities: impWork.props[PID.CHORD_QUALITIES] ?? null };
}

/**
 * The lyrics track of an imported analysis (`impWork`) as a track for a score that is the other file: its events on the measure `shift + i` go on the measure `i` of the score
 * (`count` measures). Null when the analysis has no lyrics.
 */
export function lyricsTrackFrom(impWork, { shift = 0, count, name = 'Paroles' }) {
  const staff = impWork.movements[0].tracks.flatMap((t) => t.staves).find((st) => st.props[PID.STAFF_TYPE] === 'lyrics');
  if (!staff) return null;
  const events = lyricEventsOf(staff).filter((e) => e.measure - shift >= 0 && e.measure - shift < count).map((e) => ({ measure: e.measure - shift, position: e.position, text: e.text, line: e.line, target: null }));
  return events.length ? lyricsTrackFor(events, count, { name }) : null;
}
