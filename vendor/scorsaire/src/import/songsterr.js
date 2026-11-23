/*
 * Songsterr archive: a ZIP made of `meta.json` (title, artist, the tracks), one `part_<n>.json` per track (the measures with their beats and notes as fret / string
 * numbers, exact durations, section markers, tempo changes, lyrics), `video_points.json` (for every YouTube video of the song: the second at which each measure
 * starts) and the MusicXML of the same score (not read: the JSON holds more, and in a form that needs no guessing).
 *
 * The JSON is translated into the model of AlphaTab (what the Guitar Pro importer reads), then imported by `importAlphaTabScore`, so that tablatures, percussion,
 * tuplets, ties, hammer-ons, slides, sections and tempo changes come out exactly as for a Guitar Pro file. PURE (bytes in, work out).
 *
 *   part.measures[i].voices[v].beats[b]  { duration: [n, d], type, dots, rest, notes: [{ fret, string, tie, hp, slide, dead, staccato, accentuated }], velocity, letRing, text }
 *   string: 0 = the HIGHEST string of `tuning` (listed from the highest) ; a drum note keeps its MIDI number in `fret` (`string` is a height on the staff)
 *   tie: the note is the END of a tie (it goes on the previous note of that string) ; hp / slide: the note is the START (to the next note of that string)
 *   measure.signature [n, d] (only where it changes), measure.marker.text (a section), part.automations.tempo [{ measure, bpm, type, linear }]
 */
import { zipEntries, zipRead, looksLikeZip, MxlError } from './mxl.js';
import { importAlphaTabScore } from './guitarpro.js';
import { frac, fAdd, fCmp, ZERO } from '../model/fraction.js';
import { PID } from '../model/pid.js';
import { setProp } from './musicxml-marks.js';
import { lyricsTrackFor } from '../model/lyricevents.js';
import { withWrites } from '../model/guard.js';

const baseName = (path) => path.split('/').pop();
const PART = /^part_(\d+)\.json$/i;
const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
const DEFAULT_DYNAMIC = 5; // f, the level the Guitar Pro importer takes as "nothing written"
const CLEF_G = 4; const CLEF_F = 3; // AlphaTab's Clef enumeration
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/** True when the bytes are a ZIP of a Songsterr song (a `meta.json` and at least one `part_<n>.json`; never a Scorsaire file). */
export function isSongsterrArchive(bytes) {
  if (!looksLikeZip(bytes)) return false;
  try {
    const names = zipEntries(bytes).map((e) => baseName(e.name).toLowerCase());
    return !names.includes('score.json') && names.includes('meta.json') && names.some((n) => PART.test(n));
  } catch { return false; }
}

/** @returns {Promise<{ meta, parts: object[], videos: { videoId, feature, points: number[], countries }[] }>} */
export async function readSongsterrArchive(bytes) {
  const entries = zipEntries(bytes).filter((e) => !e.name.endsWith('/') && !baseName(e.name).startsWith('.') && !e.name.includes('__MACOSX'));
  const json = async (e) => {
    try { return JSON.parse(new TextDecoder().decode(await zipRead(bytes, e))); } catch { throw new MxlError(`The file ${baseName(e.name)} of the archive cannot be read`); }
  };
  const metaEntry = entries.find((e) => baseName(e.name).toLowerCase() === 'meta.json');
  const partEntries = entries.filter((e) => PART.test(baseName(e.name))).sort((a, b) => Number(PART.exec(baseName(a.name))[1]) - Number(PART.exec(baseName(b.name))[1]));
  if (!metaEntry || !partEntries.length) throw new MxlError('The archive holds no Songsterr song (meta.json and part_<n>.json)');
  const meta = await json(metaEntry);
  const parts = [];
  for (const e of partEntries) parts.push(await json(e));
  if (!parts.every((p) => Array.isArray(p?.measures))) throw new MxlError('A track of the archive holds no measures');
  const pointsEntry = entries.find((e) => baseName(e.name).toLowerCase() === 'video_points.json');
  const raw = pointsEntry ? await json(pointsEntry) : [];
  const videos = (Array.isArray(raw) ? raw : [])
    .filter((v) => typeof v?.videoId === 'string' && Array.isArray(v.points) && v.points.length && v.points.every((p) => Number.isFinite(p)))
    .map((v) => ({ videoId: v.videoId, feature: v.feature ?? null, points: v.points, countries: v.countries ?? null, problematic: v.problematic ?? null }));
  return { meta, parts, videos };
}

/** The video to open first: the main one (no `feature`) when there is one, then the others in the order of the file. */
export function videosByPreference(videos) {
  return [...videos].sort((a, b) => Number(a.feature !== null) - Number(b.feature !== null));
}

/** General MIDI program of a track: Songsterr's distortion / overdriven / muted guitars (28-31) are the catalogue's electric guitar (27), a voice has no program. */
const programOf = (id, info) => (info.isVocalTrack ? -1 : id >= 28 && id <= 31 ? 27 : id);

const lastPart = (name) => String(name ?? '').split('|').pop().trim() || String(name ?? '').trim();

/** Duration of a beat as a reduced fraction of a whole note. */
const beatLength = (b) => {
  const [n, d] = Array.isArray(b.duration) && b.duration[1] ? b.duration : [1, b.type || 4];
  return frac(n, d);
};

/**
 * One beat of the file → an AlphaTab beat. `duration` is the note value (the denominator), `dots` the dots; a beat whose real length is not that of its note value
 * is a tuplet member: with ratio p/q (real / written), AlphaTab's numerator is q (notes in the group) and denominator p (notes they replace).
 */
function toBeat(b, staff, state) {
  const type = Number.isInteger(b.type) && b.type > 0 ? b.type : (() => { const [n, d] = beatLength(b); return n === 1 ? d : 4; })();
  const dots = b.dots ?? 0;
  const [n, d] = beatLength(b);
  const p0 = n * type * 2 ** dots; const q0 = d * (2 ** (dots + 1) - 1);
  const g = gcd(p0, q0) || 1; const p = p0 / g; const q = q0 / g;
  const beat = {
    duration: type, dots, tupletNumerator: p === q ? 0 : q, tupletDenominator: p === q ? 0 : p, tupletGroup: null, graceType: 0, isEmpty: false, notes: [], automations: [],
    isLetRing: !!b.letRing, isPalmMute: !!b.palmMute, dynamics: DEFAULT_DYNAMIC, text: b.text?.text ?? undefined, whammyBarPoints: undefined, _len: frac(n, d), _src: b,
  };
  if (typeof b.velocity === 'string' && DYNAMICS.includes(b.velocity)) state.dynamic = DYNAMICS.indexOf(b.velocity);
  beat.dynamics = state.dynamic;
  if (b.rest || !Array.isArray(b.notes)) return beat;
  for (const sn of b.notes) {
    if (sn.rest) continue;
    const note = {
      fret: sn.fret, string: 0, realValueWithoutHarmonic: 0, percussionArticulation: -1,
      isDead: !!sn.dead, isStaccato: !!sn.staccato, accentuated: Number(sn.accentuated) || 0, isGhost: !!sn.ghost, isPalmMute: !!sn.palmMute, isLetRing: !!sn.letRing,
      isTieDestination: false, tieOrigin: null, isHammerPullOrigin: false, hammerPullDestination: null, slideOutType: 0, slideInType: 0, slideTarget: null,
      _tie: !!sn.tie, _hp: !!sn.hp, _slide: sn.slide, _stringIndex: sn.string,
    };
    if (staff.isPercussion) { note.percussionArticulation = sn.fret; note.realValueWithoutHarmonic = sn.fret; } else {
      const open = staff.tuning[sn.string];
      if (!Number.isFinite(open)) continue; // a note on a string the track does not have
      note.string = staff.tuning.length - sn.string; // AlphaTab: 1 = the LOWEST string
      note.realValueWithoutHarmonic = open + sn.fret;
    }
    beat.notes.push(note);
  }
  return beat;
}

/** Tuplet members that follow each other with the same ratio form groups that close when they add up to a plain length (a quarter, an eighth…). */
function groupTuplets(beats) {
  let group = null; let sum = ZERO;
  const plain = (f) => (f[0] === 1 || f[0] === 3) && Number.isInteger(Math.log2(f[1]));
  for (const beat of beats) {
    if (!beat.tupletNumerator) { group = null; sum = ZERO; continue; }
    if (!group || group.n !== beat.tupletNumerator || group.d !== beat.tupletDenominator) { group = { beats: [], n: beat.tupletNumerator, d: beat.tupletDenominator }; sum = ZERO; }
    group.beats.push(beat); beat.tupletGroup = group; sum = fAdd(sum, beat._len);
    if (plain(sum)) { group = null; sum = ZERO; }
  }
}

/** Ties (the flagged note is the END), hammer-ons / pull-offs and slides (the flagged note is the START) are links between notes of the same string, across measures. */
function linkNotes(beats) {
  const sounding = beats.filter((b) => b.notes.length);
  sounding.forEach((beat, i) => {
    for (const note of beat.notes) {
      const sameString = (other) => other.notes.find((x) => x._stringIndex === note._stringIndex);
      if (note._tie) {
        const origin = i > 0 ? sameString(sounding[i - 1]) : null;
        if (origin) { note.isTieDestination = true; note.tieOrigin = origin; }
      }
      if (note._hp || note._slide) {
        const target = i + 1 < sounding.length ? (sameString(sounding[i + 1]) ?? null) : null;
        if (target && note._hp) { note.isHammerPullOrigin = true; note.hammerPullDestination = target; }
        if (target && note._slide) { note.slideOutType = note._slide === 'legato' ? 2 : 1; note.slideTarget = target; }
      }
    }
  });
}

/** Songsterr { meta, parts } → the score model of AlphaTab (only what the Guitar Pro importer reads). */
export function songsterrToAlphaTab({ meta = {}, parts }) {
  const nM = Math.max(...parts.map((p) => p.measures.length));
  // time signatures are written where they change; the content of a measure shorter than its signature (a pick-up, the last bar) is an irregular bar
  const signatures = []; let current = [4, 4];
  for (let m = 0; m < nM; m += 1) {
    const s = parts.map((p) => p.measures[m]?.signature).find((x) => Array.isArray(x) && x.length === 2);
    if (s) current = s;
    signatures.push(current);
  }
  // a tempo written again at the same value (Songsterr repeats it at the start of a ritardando) says nothing new
  const tempoSource = (parts.find((p) => p.automations?.tempo?.length)?.automations.tempo ?? []).filter((t, i, all) => i === 0 || t.bpm !== all[i - 1].bpm || t.linear);
  const masterBars = signatures.map((sig, m) => {
    const section = parts.map((p) => p.measures[m]?.marker?.text).find((x) => typeof x === 'string' && x.trim());
    return {
      timeSignatureNumerator: sig[0], timeSignatureDenominator: sig[1], timeSignatureCommon: sig[0] === 4 && sig[1] === 4, isAnacrusis: false, isRepeatStart: false, repeatCount: 0,
      alternateEndings: 0, isDoubleBar: false, tripletFeel: 0, isFreeTime: false, section: section ? { text: section.trim(), marker: '' } : null, directions: [],
      tempoAutomations: tempoSource.filter((t) => t.measure === m && t.bpm > 0).map((t) => ({ type: 0, ratioPosition: 0, value: t.bpm * 4 / (Number(t.type) > 0 ? Number(t.type) : 4), text: '' })),
    };
  });
  const tracks = parts.map((part, k) => {
    const infoTrack = (meta.tracks ?? []).find((t) => t.partId === part.partId) ?? meta.tracks?.[k] ?? {};
    const isDrums = !!infoTrack.isDrums || part.instrumentId === 1024;
    const tabbed = !isDrums && (infoTrack.isGuitar || infoTrack.isBassGuitar);
    const tuning = isDrums ? [] : (Array.isArray(part.tuning) ? part.tuning : infoTrack.tuning ?? []);
    const staff = { isPercussion: isDrums, tuning, showTablature: !!tabbed, showStandardNotation: !tabbed, showSlash: false, capo: 0, displayTranspositionPitch: 0, bars: [] };
    const state = { dynamic: DEFAULT_DYNAMIC };
    const allBeats = [];
    part.measures.forEach((measure, m) => {
      const voices = (measure.voices?.length ? measure.voices : [{ beats: [] }]).slice(0, 4).map((v) => {
        const beats = (v.beats ?? []).map((b) => toBeat(b, staff, state));
        return { beats };
      });
      voices.forEach((v, vi) => { if (vi === 0) allBeats.push(...v.beats); });
      staff.bars.push({ clef: isDrums ? 0 : (infoTrack.isBassGuitar ? CLEF_F : CLEF_G), keySignature: 0, barLineRight: 0, voices });
    });
    for (let m = part.measures.length; m < nM; m += 1) staff.bars.push({ clef: staff.bars[0]?.clef ?? 4, keySignature: 0, barLineRight: 0, voices: [{ beats: [] }] });
    for (const bar of staff.bars) for (const v of bar.voices) groupTuplets(v.beats);
    linkNotes(allBeats);
    const instrumentId = Number.isInteger(infoTrack.instrumentId ?? part.instrumentId) ? (infoTrack.instrumentId ?? part.instrumentId) : -1;
    return { name: lastPart(infoTrack.name ?? part.name), shortName: '', staves: [staff], playbackInfo: { program: isDrums ? -1 : programOf(instrumentId, infoTrack), isMute: false } };
  });
  // the length of the content of each measure (the longest voice of any track): a short one is a pick-up / a short last bar
  masterBars.forEach((mb, m) => {
    let longest = ZERO;
    for (const t of tracks) for (const v of t.staves[0].bars[m].voices) {
      let sum = ZERO;
      for (const b of v.beats) sum = fAdd(sum, b._len);
      if (fCmp(sum, longest) > 0) longest = sum;
    }
    const nominal = mb.timeSignatureNumerator / mb.timeSignatureDenominator;
    const real = longest[0] / longest[1];
    mb.isAnacrusis = real > 0 && real < nominal - 1e-9;
  });
  const bpm = tempoSource[0]?.bpm * 4 / (Number(tempoSource[0]?.type) > 0 ? Number(tempoSource[0].type) : 4);
  return { title: String(meta.title ?? ''), artist: String(meta.artist ?? ''), tempo: Number.isFinite(bpm) ? bpm : 0, masterBars, tracks };
}

/**
 * The lyrics a part carries (`newLyrics`: one text per line, syllables separated by blanks) as events on the notes of that part: [{ measure, position, text, line }].
 * Verified on Take Me Out (271 sounding notes that do not end a tie, 271 places): a token with text takes the NEXT such note ; a trailing `_` (or a token of `_` only) holds
 * one more note each, without text ; a token `-` alone is only a hyphen between two syllables of a word and takes no note ; `+` joins two words sung on one note.
 */
export function lyricEventsOfPart(part) {
  const lines = (part.newLyrics ?? []).filter((l) => l && String(l.text ?? '').trim());
  if (!lines.length) return [];
  const slots = [];
  (part.measures ?? []).forEach((measure, mi) => {
    let position = frac(0, 1);
    for (const b of measure.voices?.[0]?.beats ?? []) {
      const sounding = (b.notes ?? []).filter((n) => !n.rest);
      if (!b.rest && sounding.length && !sounding.every((n) => n.tie)) slots.push({ measure: mi, position });
      position = fAdd(position, beatLength(b));
    }
  });
  const events = [];
  for (const l of lines) {
    let i = 0;
    for (const token of String(l.text).split(/\s+/).filter(Boolean)) {
      if (token === '-') continue;
      const held = (/_+$/.exec(token)?.[0] ?? '').length;
      const text = token.replace(/_+$/, '').replace(/\+/g, ' ').replace(/([.,;:!?])-$/, '$1');
      if (text) { const slot = slots[i]; if (slot) events.push({ ...slot, text, line: Math.max(0, (Number(l.line) || 1) - 1) }); i += 1; }
      i += held;
    }
  }
  return events;
}

/** Bytes of the ZIP → { work, report, errors, meta, videos, sections } (the same result as the other importers, plus the videos with their measure times). */
export async function importSongsterrBytes(bytes, { lang = 'en' } = {}) {
  const { meta, parts, videos } = await readSongsterrArchive(bytes);
  const score = songsterrToAlphaTab({ meta, parts });
  const imported = importAlphaTabScore(score);
  const sections = score.masterBars.map((mb, measure) => (mb.section ? { measure, label: mb.section.text } : null)).filter(Boolean);
  const movement = imported.work.movements[0];
  const tracks = [...movement.tracks]; // the tracks of the parts, before the lyrics tracks are added
  let added = 0;
  parts.forEach((part, k) => {
    const info = (meta.tracks ?? []).find((t) => t.partId === part.partId) ?? meta.tracks?.[k] ?? {};
    if (info.isVocalTrack && tracks[k]) setProp(tracks[k], PID.INSTRUMENT_ID, 'voice');
    // the words of a part: a lyrics track right under it, one event per syllable on the instant of its note
    const events = tracks[k] ? lyricEventsOfPart(part) : [];
    if (events.length) {
      withWrites(() => { movement.tracks.splice(k + 1 + added, 0, lyricsTrackFor(events, movement.masterbars.length, { name: lang === 'fr' ? 'Paroles (Songsterr)' : 'Lyrics (Songsterr)' })); });
      added += 1;
    }
  });
  return { ...imported, videos: videosByPreference(videos), sections, songsterr: { songId: meta.songId ?? null, revisionId: meta.revisionId ?? null, url: meta.url ?? null } };
}
