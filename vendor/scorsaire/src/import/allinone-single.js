/*
 * The SINGLE-FILE form of an analysed song: one JSON (`<song>_metadonnees.json`) instead of beats.json / chords.json / segments.json / infos.json.
 * PURE: the parsed JSON in, the analysis the importer already understands out ({ infos, beats, chords, segments }), so `importAllInOne`, the sync map, the
 * panel and the `.scorsaire` file do not know there are two forms. The original JSON goes along as `source` (it also holds what Scorsaire does not read: lyrics
 * with times, names of pupil / teacher, level…), so that it is kept as it came.
 *
 *   structure.beats[i] (seconds) + structure.beat_positions[i] (1..n)  →  beats [{ time, beatNum }]
 *   accords [{ start, end, chord: "G:maj" }] (Harte, free times)         →  chords [{ curr_beat_time, chord_complex_pop: "G", bass }] (snapped to a beat)
 *   structure.segments [{ start, end, label }]                           →  segments (the zero-length « start » / « end » markers dropped)
 *   metadata { morceau, artiste, tonalite }, structure.bpm               →  infos { titre, artiste, tonalite, bpm, duree_secondes }
 */
import { wordsFromParoles } from './lyrics-times.js';

const PC_OF_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Harte shorthand → the pop suffix the chord reader knows. A shorthand that is not here is written as a plain major / minor chord (see `approx`). */
const QUALITY = {
  '': '', maj: '', min: 'm', 7: '7', maj7: 'maj7', min7: 'm7', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4', 6: '6', maj6: '6', min6: 'm6',
  9: '9', maj9: 'maj9', min9: 'm9', 11: '11', 13: '13', min11: 'm11', min13: 'm13', maj13: 'maj13', dim7: 'dim7', hdim7: 'm7b5', 5: '5', minmaj7: 'mMaj7',
};
/** Scale degree (as Harte writes a bass) → semitones above the root. */
const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 2, 11: 5, 13: 9 };

/**
 * One chord of the analysis in Harte notation (`G:maj`, `A:min7`, `C:maj/3`, `N`) → { pop, bass, approx }, or null when it cannot be read.
 * `pop` is the chord as the other form writes it (`G`, `Am7`); `bass` is a note name or null; `N` (no chord) is `{ pop: 'N' }`.
 */
export function harteToPop(text) {
  const raw = String(text ?? '').trim();
  if (!raw || /^(N|X|NC|N\.C\.)$/i.test(raw)) return { pop: 'N', bass: null, approx: false };
  const m = /^([A-G])([#b]?)(?::([^/(]*))?(?:\(([^)]*)\))?(?:\/(.+))?$/.exec(raw);
  if (!m) return null;
  const root = `${m[1]}${m[2]}`;
  const short = (m[3] ?? '').trim();
  const known = Object.hasOwn(QUALITY, short);
  const suffix = known ? QUALITY[short] : (short.startsWith('min') ? 'm' : '');
  let bass = null;
  if (m[5]) {
    const note = /^([A-G])([#b]?)$/.exec(m[5]);
    const degree = /^([b#]?)(\d{1,2})$/.exec(m[5]);
    if (note) bass = `${note[1]}${note[2]}`;
    else if (degree && Object.hasOwn(DEGREE_SEMITONES, degree[2])) {
      const rootPc = (PC_OF_STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
      const pc = (rootPc + DEGREE_SEMITONES[degree[2]] + (degree[1] === '#' ? 1 : degree[1] === 'b' ? -1 : 0) + 12) % 12;
      bass = (m[2] === 'b' || root === 'F' ? FLAT_NAMES : SHARP_NAMES)[pc];
    }
    if (bass === root) bass = null;
  }
  return { pop: `${root}${suffix}`, bass, approx: !known };
}

/** "05. Sheryl Crow - If It Makes You Happy (Official Music Video)" → { title: "If It Makes You Happy", artist: "Sheryl Crow" }. */
export function cleanSongTitle(text, artist = '') {
  let title = String(text ?? '').trim();
  title = title.replace(/^\s*\d{1,3}\s*[.\-)]\s+/, ''); // track number
  title = title.replace(/\s*[([](?:official[^)\]]*|lyrics?(?: video)?|audio|hd|hq|video)[)\]]\s*$/i, ''); // « (Official Music Video) » and the like
  let who = String(artist ?? '').trim();
  if (who && title.toLowerCase().startsWith(`${who.toLowerCase()} - `)) title = title.slice(who.length + 3).trim();
  else if (!who) {
    const k = title.indexOf(' - ');
    if (k > 0) { who = title.slice(0, k).trim(); title = title.slice(k + 3).trim(); }
  }
  return { title, artist: who };
}

/** True when an object is the single-file form (a beat map in `structure`, and its positions). */
export function isSingleFileAnalysis(obj) {
  return Boolean(obj) && typeof obj === 'object' && Boolean(obj.structure) && Array.isArray(obj.structure.beats) && Array.isArray(obj.structure.beat_positions);
}

const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Index of the beat closest to `t` (the array is sorted). */
function nearestBeat(times, t) {
  let lo = 0; let hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t) ? lo - 1 : lo;
}

/**
 * @returns {{ infos, beats, chords, segments, source }} — `source` is the object that was given, untouched.
 * @throws Error when the beat map is missing or unusable
 */
export function adaptSingleFileAnalysis(src) {
  if (!isSingleFileAnalysis(src)) throw new Error('The file holds no beat map (structure.beats and structure.beat_positions)');
  const { beats: times, beat_positions: positions } = src.structure;
  const beats = [];
  for (let i = 0; i < Math.min(times.length, positions.length); i += 1) {
    const time = Number(times[i]); const beatNum = Number(positions[i]);
    if (Number.isFinite(time) && Number.isInteger(beatNum) && beatNum >= 1) beats.push({ time, beatNum });
  }
  beats.sort((a, b) => a.time - b.time);
  if (beats.length < 2) throw new Error('The beat map holds no usable beat');
  const beatTimes = beats.map((b) => b.time);
  const step = median(beatTimes.slice(1).map((t, i) => t - beatTimes[i]));

  // chords: the analysis gives free times, the score has beats: each change goes to the closest beat (a chord that comes before the first beat starts on it);
  // two changes that land on the same beat leave the later one
  const chords = [];
  for (const c of [...(src.accords ?? [])].sort((a, b) => Number(a.start) - Number(b.start))) {
    const h = harteToPop(c.chord);
    const start = Number(c.start);
    if (!h || !Number.isFinite(start)) continue;
    const idx = nearestBeat(beatTimes, start);
    if (Math.abs(beatTimes[idx] - start) > step) continue; // far from every beat (before the map starts, after it ends)
    const record = { curr_beat_time: beatTimes[idx], chord_complex_pop: h.pop, bass: h.bass };
    if (chords.length && chords[chords.length - 1].curr_beat_time === record.curr_beat_time) chords[chords.length - 1] = record;
    else chords.push(record);
  }

  const segments = (src.structure.segments ?? [])
    .filter((s) => !/^(start|end)$/i.test(String(s.label ?? '')) && Number(s.end) > Number(s.start))
    .map((s) => ({ start: Number(s.start), end: Number(s.end), label: s.label }));

  const meta = src.metadata ?? {};
  const { title, artist } = cleanSongTitle(meta.morceau || String(meta.nom_fichier ?? '').replace(/\.[A-Za-z0-9]{2,4}$/, ''), meta.artiste);
  const ends = [beatTimes[beatTimes.length - 1] + step, ...(src.accords ?? []).map((c) => Number(c.end)), ...segments.map((s) => s.end)].filter(Number.isFinite);
  const infos = { titre: title, artiste: artist, duree_secondes: Math.max(...ends), tonalite: meta.tonalite ?? '' };
  if (Number(src.structure.bpm) > 0) infos.bpm = Number(src.structure.bpm);
  const lyrics = wordsFromParoles(src.paroles);
  return { infos, beats, chords, segments, ...(lyrics ? { lyrics } : {}), source: src };
}
