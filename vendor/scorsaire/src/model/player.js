// The automatic PLAYER of a track: what a track plays by itself from the chords of the movement's first chord staff (the table of truth for every track), with a chord pattern
// (chordpatterns.js) and a card (strumcards.js). PURE (no DOM, no document): readers of the track's properties. The writing goes through `setPlayer` (call inside `doc.transaction`).
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { autoStrumInstrument } from './fretdiagram.js';
import { isChordTrack } from './chordtrack.js';
import { BUILTIN_STRUM_CARDS } from './strumcards.js';
import { validateVariationRules, createVariationRule } from './variation.js';

/** True for a track with a percussion staff: its player plays a GROOVE (model/grooves.js) instead of a chord pattern. */
export const isDrumTrack = (track) => (track.staves ?? []).some((st) => getProperty(st, PID.STAFF_TYPE) === 'percussion');
export const playerKindOf = (track) => (isDrumTrack(track) ? 'drums' : 'chords');

export const PLAYER_INSTRUMENTS = Object.freeze(['guitar', 'ukulele', 'bass', 'bass5', 'piano']);

/** { pattern, card, instrument ('auto' or one of `PLAYER_INSTRUMENTS`), active, seed, rules } of a track, or null when it has no player (no pattern). */
export function playerOf(track) {
  const pattern = getProperty(track, PID.PLAYER_PATTERN);
  if (!pattern) return null;
  return { pattern, card: getProperty(track, PID.PLAYER_CARD) ?? null, instrument: getProperty(track, PID.PLAYER_INSTRUMENT) ?? 'auto', active: getProperty(track, PID.PLAYER_ACTIVE) !== false, seed: getProperty(track, PID.PLAYER_SEED) ?? 0, rules: getProperty(track, PID.PLAYER_RULES) ?? [] };
}

const isRest = (it) => it.type === 'rest';
/** True when the track holds WRITTEN notes: a staff other than a chord staff or a strumming rhythm staff with something else than rests in it. */
export function hasWrittenNotes(track) {
  return (track.staves ?? []).some((st) => {
    const type = getProperty(st, PID.STAFF_TYPE);
    if (type === 'chord' || (type === 'rhythm' && getProperty(st, PID.STRUM) === true)) return false;
    return st.voices.some((v) => v.measures.some((m) => (m?.items ?? []).some((it) => !isRest(it))));
  });
}

/**
 * An ACCOMPANIMENT track: a track (other than the chord track) that has a player and holds no written notes — it plays by itself and is not written in. It is shown apart in the tracks panel;
 * writing notes in it, or writing what it plays as a real track, is what makes it an ordinary track again.
 */
export const isAccompanimentTrack = (track) => !isChordTrack(track) && !!playerOf(track) && !hasWrittenNotes(track);

/** The player plays unless it is switched off or the track holds written notes (then the notes are what the track plays). */
export const playerIsSilent = (track) => { const p = playerOf(track); return !p || !p.active || hasWrittenNotes(track); };

/**
 * The instrument a player's fingering is for. A pattern is a piano accompaniment unless the player says otherwise: its own `instrument`, or a card of the strumming kind
 * (then the instrument its track suggests, the guitar for a track that suggests the piano). `cards` = { project, user } lists.
 */
export function playerInstrumentOf(track, cards = { project: [], user: [] }) {
  if (isDrumTrack(track)) return 'drums';
  const p = playerOf(track);
  if (p && p.instrument !== 'auto') return p.instrument;
  const card = [...(cards.project ?? []), ...(cards.user ?? []), ...BUILTIN_STRUM_CARDS].find((c) => c.id === p?.card);
  if (!card || (card.kind ?? 'strum') !== 'strum') return 'piano';
  const auto = autoStrumInstrument(track);
  return auto === 'piano' ? 'guitar' : auto;
}

/** Sets the player of a track from a partial change { pattern? (id, null = none), card? (id, null = the default one), instrument? ('auto' or an instrument), active? (bool), seed? (int), rules? (the list of `createVariationRule`) }. Call inside `doc.transaction`. */
export function setPlayer(doc, track, patch) {
  const put = (pid, value, dflt = null) => { if (value == null || value === dflt) { if (doc.get(track, pid) != null && doc.get(track, pid) !== dflt) doc.reset(track, pid); } else doc.set(track, pid, value); };
  if (patch.pattern !== undefined) put(PID.PLAYER_PATTERN, patch.pattern === '' ? null : patch.pattern);
  if (patch.card !== undefined) put(PID.PLAYER_CARD, patch.card);
  if (patch.instrument !== undefined) {
    if (patch.instrument !== 'auto' && !PLAYER_INSTRUMENTS.includes(patch.instrument)) throw new Error(`unknown player instrument "${patch.instrument}"`);
    put(PID.PLAYER_INSTRUMENT, patch.instrument, 'auto');
  }
  if (patch.active !== undefined) put(PID.PLAYER_ACTIVE, patch.active === false ? false : true, true);
  if (patch.rules !== undefined) {
    const errors = validateVariationRules(patch.rules);
    if (errors.length) throw new Error(errors[0]);
    const list = patch.rules.map(createVariationRule);
    if (list.length) doc.set(track, PID.PLAYER_RULES, list); else if ((doc.get(track, PID.PLAYER_RULES) ?? []).length) doc.reset(track, PID.PLAYER_RULES);
  }
  if (patch.seed !== undefined) put(PID.PLAYER_SEED, Number.isInteger(patch.seed) && patch.seed > 0 ? patch.seed % 2147483647 : 0, 0);
}

/** What "add an accompaniment" gives a new track, by role: the instrument of the catalogue (its sound), the pattern and the card of the player. */
export const ACCOMPANIMENTS = Object.freeze({
  piano: Object.freeze({ instrument: 'piano', pattern: 'ballad', card: null }),
  guitar: Object.freeze({ instrument: 'guitar-steel', pattern: 'ballad', card: 'folk' }),
  bass: Object.freeze({ instrument: 'bass-guitar', pattern: 'bass-root-fifth', card: 'bass' }),
  drums: Object.freeze({ instrument: 'drum-kit-5', pattern: 'rock8', card: 'drums' }),
});
export const ACCOMPANIMENT_ROLES = Object.freeze(Object.keys(ACCOMPANIMENTS));
