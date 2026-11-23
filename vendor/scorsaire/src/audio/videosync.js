/*
 * A video (YouTube) synchronised with the measures of a score, from the time at which each measure starts in that video (the `points` of a Songsterr archive).
 * PURE: numbers in, the measure map of screen 4 (`createSyncMap`) out.
 *
 *   points[i]   second of the video at which measure i begins (a pick-up measure is the first one: it begins before the first beat)
 *   lengths[i]  length of measure i in whole notes (1 = a 4/4 bar, 1/4 = a pick-up of one beat)
 */
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** True when a list of measure times is usable: numbers, strictly increasing, one per measure. */
export function usablePoints(points, measureCount) {
  return Array.isArray(points) && points.length === measureCount && points.every((p, i) => Number.isFinite(p) && (i === 0 || p > points[i - 1]));
}

/** The videos whose list of measure times fits `measureCount` measures, the main one first (a video with no `feature` is the main one). */
export function usableVideos(videos, measureCount) {
  return (videos ?? []).filter((v) => v && typeof v.videoId === 'string' && usablePoints(v.points, measureCount)).sort((a, b) => Number(a.feature != null) - Number(b.feature != null));
}

/**
 * The measures of the sync map (see audio/syncmap.js): each begins at its point and ends where the next begins; the last one lasts as long as its length says, at the
 * pace of the others. The beats of a measure are evenly spaced (the file gives the start of the measures, not of the beats): `max(1, round(4 × length))` of them.
 * @returns {{ start: number, end: number, beats: number[] }[]}
 */
export function videoMeasures(points, lengths) {
  const n = points.length;
  const perWhole = median(points.slice(1).map((p, i) => (p - points[i]) / Math.max(1e-9, lengths[i]))); // seconds per whole note, from the full measures
  return points.map((start, i) => {
    const end = i + 1 < n ? points[i + 1] : start + perWhole * lengths[i];
    const count = Math.max(1, Math.round(lengths[i] * 4));
    return { start, end, beats: Array.from({ length: count }, (_, k) => start + ((end - start) * k) / count) };
  });
}

/** Segments for the timeline of the panel from named measures: [{ measure, label }] (sorted) → [{ start, end, label }] ending where the next begins (the last one at the end of the map). */
export function sectionSegments(sections, measures) {
  const list = [...sections].filter((s) => Number.isInteger(s.measure) && s.measure >= 0 && s.measure < measures.length).sort((a, b) => a.measure - b.measure);
  return list.map((s, i) => ({ start: measures[s.measure].start, end: i + 1 < list.length ? measures[list[i + 1].measure].start : measures[measures.length - 1].end, label: s.label }));
}

/** The name shown for a video of the list: its kind, then its number among the others of the same kind. */
export function videoLabel(video, index, list, names) {
  const same = list.filter((v) => (v.feature ?? null) === (video.feature ?? null));
  const kind = names[video.feature ?? 'main'] ?? names.other ?? String(video.feature);
  return same.length > 1 ? `${kind} ${same.indexOf(video) + 1}` : kind;
}

/**
 * The time of a video for a time of the recording, through the measures: the recording's map (`audioMap`, see audio/syncmap.js) says which measure and which part of it
 * `t` is, the video's measures (`videoMeasures`) say when that is in the video. `shift` = measure of the song − measure of the video's list (a song that starts earlier than
 * the score the video times were made for). Before the first covered measure and after the last one the two clocks are taken as running at the same pace.
 */
export function audioToVideoTime(audioMap, vMeasures, shift, t) {
  const at = audioMap.locate(t);
  const index = at.measure - shift;
  if (!vMeasures.length) return t;
  if (at.before || index < 0) return vMeasures[0].start - (audioMap.timeOf(Math.max(0, shift), 0) - t);
  if (at.after && index < vMeasures.length) return vMeasures[Math.min(vMeasures.length - 1, index)].end + (t - audioMap.end()); // past the end of the recording's map
  if (index >= vMeasures.length) {
    const next = shift + vMeasures.length;
    const audioEnd = next < audioMap.measureCount ? audioMap.timeOf(next, 0) : audioMap.end();
    return vMeasures[vMeasures.length - 1].end + (t - audioEnd);
  }
  const m = vMeasures[index];
  return m.start + at.ratio * (m.end - m.start);
}

/**
 * The videos a song of `count` measures can show while its recording plays: their measure times increase and cover measures `shift … shift + points.length` of the song
 * (a song may have more measures than the score the times were made for: the others are before or after). The main video first.
 */
export function followableVideos(videos, count, shift = 0) {
  return (videos ?? []).filter((v) => v && typeof v.videoId === 'string' && Array.isArray(v.points) && v.points.length >= 2 && usablePoints(v.points, v.points.length) && v.points.length + shift <= count)
    .sort((a, b) => Number(a.feature != null) - Number(b.feature != null));
}
