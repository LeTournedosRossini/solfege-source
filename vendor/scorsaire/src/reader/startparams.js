/*
 * What the address of a reader page may ask for at the start (all optional, an invalid value is ignored, never an error):
 *   m=<movement id>      show only that movement
 *   v=<percent>          speed
 *   tr=<semitones>       transposition (display and playback)
 *   loop=<id>-<id>       loop between two measures, by the ids of the measures (they follow insertions, unlike numbers)
 *   scale=<id>, root=<note>   the scale (`dorian`, `minor_pentatonic`…) and its root (`D`, `Bb`, `Sol`) of the SCALE movements of the file, over the recipe the author wrote (the portal gives each pupil his own)
 *   tracks=<id>,<id>…    the tracks shown at the start (their ids, stable in the file); the reader can still show the others
 *   tt=<id>:<n>,…        display transposition of single tracks (semitones), over the transposition of the sheet
 *   who=<id>:<name>,…    the name of the person who plays a track, written next to the track name (each name encoded once with encodeURIComponent, then the whole list as a query value)
 *   mute=<id>,<id>…      tracks that start MUTED (the pupil plays them herself: they stay on the page, they do not sound)
 *   pre=<0..2>           measures of count-in before the music (the reader can change it)
 *   click=off|pre|always the metronome: off, only the count-in (usual), or all the time
 *   viewer=piano|guitar|none   the viewer unfolded at the start (the piano keyboard or the guitar fretboard); with `tracks=` it lights the tracks asked for; `none` (usual) leaves it folded
 *   lyrics=strophes|staff   how the words are shown: as strophes under the music (the usual) or on their own staff
 *   instrument=<name>    the instrument of the pupil (`guitar6`, `guitare`, `clarinette`…): a SCALE movement is shown for it (staff or tablature); ignored when unknown
 * They are STARTING values: a lock set by the author (speed, transposition) still wins, the reader never goes past it.
 */
import { SPEED_RANGE, TRANSPOSE_RANGE } from '../model/sheetedit.js';

const intOf = (text) => (/^-?\d+$/.test(String(text ?? '').trim()) ? Number(text) : null);

/** @param params URLSearchParams */
const ID = /^[A-Za-z0-9_]+$/;
/** `a,b,c` → the ids that are well formed (at most 64), or null. */
function idList(text) {
  const ids = String(text ?? '').split(',').map((s) => s.trim()).filter((s) => ID.test(s)).slice(0, 64);
  return ids.length ? [...new Set(ids)] : null;
}
/** `id:value,…` → [[id, rawValue]…] (the value is what follows the first colon). */
function pairs(text) {
  return String(text ?? '').split(',').map((s) => { const i = s.indexOf(':'); return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1)] : null; }).filter((p) => p && ID.test(p[0])).slice(0, 64);
}

export function parseStartParams(params) {
  const out = { movement: null, speed: null, transpose: null, loop: null, instrument: null, scale: null, root: null, tracks: null, trackShifts: null, who: null, mute: null, preroll: null, click: null, viewer: null, lyrics: null };
  const m = params.get('m');
  if (m && /^[A-Za-z0-9_]+$/.test(m)) out.movement = m;
  const v = intOf(params.get('v'));
  if (v !== null && v >= SPEED_RANGE[0] && v <= SPEED_RANGE[1]) out.speed = v;
  const tr = intOf(params.get('tr'));
  if (tr !== null && Math.abs(tr) <= TRANSPOSE_RANGE) out.transpose = tr;
  const loop = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)$/.exec(params.get('loop') ?? '');
  if (loop) out.loop = { from: loop[1], to: loop[2] };
  const ins = String(params.get('instrument') ?? '').trim();
  if (ins && ins.length <= 40 && /^[\p{L}\p{N} _-]+$/u.test(ins)) out.instrument = ins;
  const sc = String(params.get('scale') ?? '').trim(); if (/^[a-z][a-z0-9_]{0,40}$/.test(sc)) out.scale = sc;
  const rt = String(params.get('root') ?? '').trim(); if (/^[\p{L}]{1,5}[#b♯♭]{0,3}$/u.test(rt) && rt.length <= 6) out.root = rt;
  out.tracks = idList(params.get('tracks'));
  out.mute = idList(params.get('mute'));
  const pre = intOf(params.get('pre')); if (pre !== null && pre >= 0 && pre <= 2) out.preroll = pre;
  const viewer = String(params.get('viewer') ?? '').trim(); if (['piano', 'guitar', 'none'].includes(viewer)) out.viewer = viewer;
  const lyrics = String(params.get('lyrics') ?? '').trim(); if (lyrics === 'strophes' || lyrics === 'staff') out.lyrics = lyrics;
  const click = String(params.get('click') ?? '').trim(); if (['off', 'pre', 'always'].includes(click)) out.click = click;
  const shifts = {};
  for (const [id, v] of pairs(params.get('tt'))) { const n = intOf(v); if (n !== null && Math.abs(n) <= TRANSPOSE_RANGE) shifts[id] = n; }
  if (Object.keys(shifts).length) out.trackShifts = shifts;
  const who = {};
  for (const [id, v] of pairs(params.get('who'))) {
    let name = v; try { name = decodeURIComponent(v); } catch { /* not encoded: as it is */ }
    name = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40);
    if (name) who[id] = name;
  }
  if (Object.keys(who).length) out.who = who;
  return out;
}
