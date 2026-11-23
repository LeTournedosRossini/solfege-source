/*
 * What the Lecteur shows of a song: the person picks KINDS of track (the chord grid, a voice, a guitar…) and the choice is kept on the device. A kind is recognised from the
 * instrument of the track (never from its name) and from its staves. When a song has several tracks of a wanted kind (two guitars), the person is asked once; the answer is
 * remembered by the NAME of the track, so that "Guitare 1" is found again in the next song without asking. Pure functions.
 */
import { PID } from '../model/pid.js';
import { getProperty } from '../model/props.js';
import { instrumentInfo } from '../model/instruments.js';

export const KINDS = Object.freeze(['grid', 'voice', 'guitar', 'bass', 'keys', 'drums']);
export const ALL_TRACKS = '*'; // the remembered answer "all of them"

const GUITAR_FAMILIES = new Set(['guitars', 'ukuleles', 'banjos', 'mandolins', 'lutes', 'bouzoukis', 'cavaquinhos']);
const stavesOf = (track) => track.staves.map((s) => getProperty(s, PID.STAFF_TYPE));

/** The kind of a track: 'grid' (chord staff), 'voice', 'guitar', 'bass', 'keys', 'drums', or 'other'. */
export function trackKind(track) {
  const types = stavesOf(track);
  if (types.includes('chord')) return 'grid';
  if (types.every((t) => t === 'lyrics')) return 'voice'; // the lyrics track (syllables on their instants) goes with the voice
  const info = instrumentInfo(getProperty(track, PID.INSTRUMENT_ID));
  if (info) {
    if (info.family === 'voices' || info.family === 'voice-groups') return 'voice';
    if (info.family === 'bass-guitars') return 'bass';
    if (GUITAR_FAMILIES.has(info.family)) return 'guitar';
    if (info.group === 'keyboards') return 'keys';
    if (info.family === 'drums' || info.group === 'unpitched-percussion') return 'drums';
  }
  if (types.includes('percussion')) return 'drums';
  if (types.includes('tab')) return 'guitar';
  return 'other';
}

export const nameOf = (track, index) => getProperty(track, PID.NAME) || `${index + 1}`;

/**
 * The tracks to show for the wanted kinds.
 * @param movement  the movement
 * @param wanted    kinds wanted ([] = every track)
 * @param names     remembered answers: { kind: track name | '*' }
 * @param picked    names of tracks chosen one by one ([] = go by kinds)
 * @returns {{ tracks: string[] | null, pending: { kind: string, candidates: { id: string, name: string }[] }[] }}
 *   `tracks` = ids of the tracks to draw (null = all); `pending` = kinds with several candidates and no remembered answer (the question to ask)
 */
export function resolveShown(movement, wanted, names = {}, picked = []) {
  if (picked?.length) { // tracks chosen one by one (by name): they win over the kinds, as long as the song still has one of them
    const ids = movement.tracks.map((t, i) => ({ id: t.id, name: nameOf(t, i) })).filter((c) => picked.includes(c.name)).map((c) => c.id);
    if (ids.length) return { tracks: ids.length === movement.tracks.length ? null : ids, pending: [] };
  }
  if (!wanted?.length) return { tracks: null, pending: [] };
  const ids = []; const pending = [];
  for (const kind of wanted) {
    const candidates = movement.tracks.map((t, i) => ({ t, id: t.id, name: nameOf(t, i) })).filter((c) => trackKind(c.t) === kind);
    if (!candidates.length) continue;
    const answer = names[kind];
    if (candidates.length === 1 || answer === ALL_TRACKS) { ids.push(...candidates.map((c) => c.id)); continue; }
    const remembered = candidates.find((c) => c.name === answer);
    if (remembered) { ids.push(remembered.id); continue; }
    pending.push({ kind, candidates: candidates.map((c) => ({ id: c.id, name: c.name })) });
    ids.push(candidates[0].id); // until the person answers: the first one
  }
  return { tracks: ids.length ? ids : null, pending };
}

/** What the foot of the page says about the music shown: the names of the tracks read (all the tracks of the movement when none is chosen). */
export const shownNames = (movement, trackIds = null) => movement.tracks.map((t, i) => ({ t, i })).filter(({ t }) => !trackIds || trackIds.includes(t.id)).map(({ t, i }) => nameOf(t, i)).join(', ');

/** The kinds of track a movement has, in the order of `KINDS` (what the person can be asked to choose from). */
export const kindsPresent = (movement) => { const have = new Set(movement.tracks.map(trackKind)); return KINDS.filter((k) => have.has(k)); };

/** Roles of a layout made for a tablet (model/partroles.js) that suit each kind, the most usual first. */
export const ROLES_OF_KIND = Object.freeze({
  grid: ['CHORDS'], voice: ['VOX', 'LEAD', 'BVOX'], guitar: ['GTR', 'RGTR', 'LGTR', 'AC-GTR'], bass: ['BSS'], keys: ['KEYS', 'PNO'], drums: ['DRMS', 'PERC'],
});

/** The role to remember for a kind: the first suitable role that the layouts of the work really offer (`available`), or null when none does. */
export const roleForKind = (kind, available = []) => (ROLES_OF_KIND[kind] ?? []).find((r) => available.includes(r)) ?? null;
