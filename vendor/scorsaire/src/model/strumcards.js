// Strum cards: named sets of playing values for the strum playback of a rhythm staff (see audio/strum.js). PURE.
// A card lives at three levels: built in (this file), the USER's own cards (device preference `strumCards`, shared by every project) and the PROJECT's cards
// (`PID.STRUM_CARDS` of the work, saved in the file). A staff picks one by id (`PID.STRUM_CARD`, absent = "standard"); the staff's own pattern / delay win.
// Lookup by id: project > user > built in, so a project can carry its own version of a card without depending on the device.
import { STRUM_DEFAULTS } from '../audio/strum.js';
import { PID } from './pid.js';
import { isBassDegree } from './chorddegrees.js';
import { COMPING_DEFAULTS, APPROACH_KINDS, SPACINGS } from '../audio/comping.js';

export const STRUM_CARD_FIELDS = Object.freeze({
  downVelocity: { min: 0.1, max: 1.2, step: 0.05, dflt: 1 },
  upVelocity: { min: 0.1, max: 1.2, step: 0.05, dflt: STRUM_DEFAULTS.upVelocity },
  fall: { min: 0, max: 0.15, step: 0.01, dflt: STRUM_DEFAULTS.fall },
  delayMs: { min: 0, max: 60, step: 1, dflt: null }, // null = from the tempo
  upStrings: { min: 1, max: 6, step: 1, dflt: STRUM_DEFAULTS.upStrings },
  mutedDuration: { min: 0.01, max: 0.3, step: 0.01, dflt: STRUM_DEFAULTS.mutedDuration },
  mutedVelocity: { min: 0.1, max: 1.2, step: 0.05, dflt: STRUM_DEFAULTS.mutedVelocity },
  singleNote: { min: 0, max: 1, step: 1, dflt: STRUM_DEFAULTS.singleNote },
});
/** Values of the piano cards (comping.js); every card carries all the fields, a guitar card simply ignores these and the other way round. */
export const PIANO_CARD_FIELDS = Object.freeze({
  accentBoost: { min: 0.5, max: 2, step: 0.05, dflt: COMPING_DEFAULTS.accentBoost },
  handVelocity: { min: 0.1, max: 1.2, step: 0.05, dflt: COMPING_DEFAULTS.handVelocity },
  bassVelocity: { min: 0.1, max: 1.2, step: 0.05, dflt: COMPING_DEFAULTS.bassVelocity },
  staccatoDuration: { min: 0.03, max: 0.5, step: 0.01, dflt: COMPING_DEFAULTS.staccatoDuration },
  rollMs: { min: 0, max: 40, step: 1, dflt: COMPING_DEFAULTS.rollMs },
  handLow: { min: 40, max: 70, step: 1, dflt: COMPING_DEFAULTS.handLow },
  handHigh: { min: 65, max: 100, step: 1, dflt: COMPING_DEFAULTS.handHigh },
  bassDouble: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.bassDouble },
  approachBeats: { min: 0.5, max: 4, step: 0.5, dflt: COMPING_DEFAULTS.approachBeats },
  // voice leading of the right hand (comping.js `voicingCost`); the on / off ones lie in [0, 1]
  topSmooth: { min: 0, max: 2, step: 0.25, dflt: COMPING_DEFAULTS.topSmooth },
  avoidSeconds: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.avoidSeconds },
  sixthForSeventh: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.sixthForSeventh },
  contrary: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.contrary },
  noParallels: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.noParallels },
  skipBass: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.skipBass },
  // the approach chords: how often, how much likelier at the end of a section, and the rule of not coming twice at the same place
  approachChance: { min: 0, max: 1, step: 0.05, dflt: COMPING_DEFAULTS.approachChance },
  approachBelow: { min: 0, max: 1, step: 0.1, dflt: COMPING_DEFAULTS.approachBelow },
  structureBoost: { min: 0, max: 3, step: 0.25, dflt: COMPING_DEFAULTS.structureBoost },
  approachNoRepeat: { min: 0, max: 1, step: 1, dflt: COMPING_DEFAULTS.approachNoRepeat },
});
/** The fields of the piano cards that are switches (0 or 1). */
export const PIANO_FLAG_FIELDS = Object.freeze(['bassDouble', 'avoidSeconds', 'sixthForSeventh', 'contrary', 'noParallels', 'skipBass', 'singleNote', 'approachNoRepeat', 'fillNoRepeat', 'sectionCrash']);
export { SPACINGS };
/** Values of the DRUM cards (audio/drumplay.js): how much of the groove's variations is played, how likely they are at the end of a section (`structureBoost`, shared with the piano cards), the rule of not breaking twice at the same place, the crash at the start of a section, and the level of the whole kit. */
export const DRUM_CARD_FIELDS = Object.freeze({
  variation: { min: 0, max: 1, step: 0.05, dflt: 1 },
  fillNoRepeat: { min: 0, max: 1, step: 1, dflt: 1 },
  fillBeforeSection: { min: 0, max: 1, step: 1, dflt: 1 }, // always a break on the last bar before a change of section
  fillOnlyBeforeSection: { min: 0, max: 1, step: 1, dflt: 1 }, // no break anywhere else
  fillSpacing: { min: 0, max: 16, step: 1, dflt: 4 }, // bars that must pass after a break before the next one may come (0 = no limit): at most one break every 4 bars by default
  sectionCrash: { min: 0, max: 1, step: 1, dflt: 1 },
  velocityScale: { min: 0.5, max: 1.2, step: 0.05, dflt: 1 },
});
/** Alternative phrases of the patterns of a chord / bass player (what a break is to a drummer): off by default, a cue on the score asks for them. */
export const ALT_CARD_FIELDS = Object.freeze({
  altBeforeSection: { min: 0, max: 1, step: 1, dflt: 0 }, // always an alternative phrase on the last bar before a change of section
  altOnlyBeforeSection: { min: 0, max: 1, step: 1, dflt: 0 }, // the phrases that come by chance (`chance` of each) only there
  altSpacing: { min: 0, max: 16, step: 1, dflt: 4 }, // bars that must pass after an alternative phrase before the next one by chance
});
export const CARD_KINDS = Object.freeze(['strum', 'piano', 'drums']);
export { APPROACH_KINDS };
export const STRUM_PATTERNS = Object.freeze(['down', 'alternate']);
export const STANDARD_CARD_ID = 'standard';
/** What a chord pattern does with a degree the chord does not have (the 7th of a triad): nothing, or the usual note anyway. */
export const ABSENT_DEGREES = Object.freeze(['skip', 'play']);
/** The bass of a slash chord (C/E) in the fingering a fretted card chooses: 'follow' the named bass, or 'root' = the shape of the plain chord (another instrument plays the bass). */
export const SLASH_BASS = Object.freeze(['follow', 'root']);
export { isBassDegree };

const base = () => ({
  downVelocity: 1, upVelocity: STRUM_DEFAULTS.upVelocity, fall: STRUM_DEFAULTS.fall, delayMs: null, upStrings: STRUM_DEFAULTS.upStrings,
  mutedDuration: STRUM_DEFAULTS.mutedDuration, mutedVelocity: STRUM_DEFAULTS.mutedVelocity, singleNote: STRUM_DEFAULTS.singleNote, pattern: STRUM_DEFAULTS.pattern,
  kind: 'strum', approach: 'off', absentDegree: 'skip', slashBass: 'follow', bassDegree: null, spacing: COMPING_DEFAULTS.spacing, ...Object.fromEntries(Object.entries(DRUM_CARD_FIELDS).map(([k, v]) => [k, v.dflt])), ...Object.fromEntries(Object.entries(ALT_CARD_FIELDS).map(([k, v]) => [k, v.dflt])), ...Object.fromEntries(Object.entries(PIANO_CARD_FIELDS).map(([k, v]) => [k, v.dflt])),
});

/** Built-in cards (starting points chosen by Scorsaire, to be tuned by ear). Their names come from the language catalogs (`strum.card.<id>`). */
export const BUILTIN_STRUM_CARDS = Object.freeze([
  Object.freeze({ id: 'standard', name: null, ...base() }),
  Object.freeze({ id: 'folk', name: null, ...base(), pattern: 'alternate', delayMs: 18, fall: 0.04, upVelocity: 0.85 }),
  Object.freeze({ id: 'rock', name: null, ...base(), pattern: 'alternate', delayMs: 8, fall: 0.02, upStrings: 3, upVelocity: 0.95 }),
  Object.freeze({ id: 'bass', name: null, ...base(), delayMs: 0, upStrings: 1, fall: 0, singleNote: 1 }), // the bass guitar: single notes, the bass of the fingering follows the slash bass of the grid
  Object.freeze({ id: 'piano', name: null, ...base(), kind: 'piano' }),
  Object.freeze({ id: 'drums', name: null, ...base(), kind: 'drums', structureBoost: 1.5 }), // the drum kit: the whole variations of the groove, more of them at the end of a section
  // a string section pad: the chord tones in the warm middle of the compass (G3 – E5), the whole chord with its root (the pattern says which parts), close position, the top voice kept smooth (voice leading is what strings are about)
  Object.freeze({ id: 'strings', name: null, ...base(), kind: 'piano', handLow: 55, handHigh: 76, skipBass: 0, spacing: 'close', topSmooth: 1.5, handVelocity: 0.8, rollMs: 0 }),
  // a horn section (trumpets, saxes, trombone): four-part close position from just under middle C to an octave and a half above, short accented hits
  Object.freeze({ id: 'brass', name: null, ...base(), kind: 'piano', handLow: 58, handHigh: 82, skipBass: 0, spacing: 'close', accentBoost: 1.3, staccatoDuration: 0.14, handVelocity: 1, rollMs: 0 }),
  Object.freeze({ id: 'piano-approach', name: null, ...base(), kind: 'piano', approach: 'dominant', approachBeats: 1 }),
]);

/** A complete card from a partial one (missing or out-of-range values take the standard ones). */
export function createStrumCard(input = {}) {
  const out = { id: String(input.id ?? ''), name: input.name == null ? null : String(input.name).slice(0, 40), ...(input.folder != null && String(input.folder).trim() ? { folder: String(input.folder).trim().slice(0, 40) } : {}), ...base() };
  for (const [key, spec] of Object.entries(STRUM_CARD_FIELDS)) {
    const v = input[key];
    if (key === 'delayMs' && v === null) { out.delayMs = null; continue; }
    if (Number.isFinite(v)) out[key] = Math.min(spec.max, Math.max(spec.min, v));
  }
  for (const [key, spec] of Object.entries(PIANO_CARD_FIELDS)) if (Number.isFinite(input[key])) out[key] = Math.min(spec.max, Math.max(spec.min, input[key]));
  for (const [key, spec] of Object.entries(DRUM_CARD_FIELDS)) if (Number.isFinite(input[key])) out[key] = Math.min(spec.max, Math.max(spec.min, input[key]));
  for (const [key, spec] of Object.entries(ALT_CARD_FIELDS)) if (Number.isFinite(input[key])) out[key] = Math.min(spec.max, Math.max(spec.min, input[key]));
  out.handLow = Math.round(out.handLow); out.handHigh = Math.max(out.handLow + 5, Math.round(out.handHigh)); out.rollMs = Math.round(out.rollMs); for (const k of PIANO_FLAG_FIELDS) out[k] = out[k] >= 0.5 ? 1 : 0;
  if (CARD_KINDS.includes(input.kind)) out.kind = input.kind;
  if (APPROACH_KINDS.includes(input.approach)) out.approach = input.approach;
  if (SPACINGS.includes(input.spacing)) out.spacing = input.spacing;
  if (ABSENT_DEGREES.includes(input.absentDegree)) out.absentDegree = input.absentDegree;
  if (SLASH_BASS.includes(input.slashBass)) out.slashBass = input.slashBass;
  out.bassDegree = isBassDegree(input.bassDegree) ? input.bassDegree : null;
  if (STRUM_PATTERNS.includes(input.pattern)) out.pattern = input.pattern;
  out.upStrings = Math.round(out.upStrings);
  if (out.delayMs !== null) out.delayMs = Math.round(out.delayMs);
  return out;
}

export function validateStrumCard(card) {
  if (!card || typeof card !== 'object') return ['strum card: object expected'];
  const errors = [];
  if (typeof card.id !== 'string' || !card.id) errors.push('strum card: id expected');
  if (card.name != null && typeof card.name !== 'string') errors.push('strum card: name must be a string');
  for (const [key, spec] of Object.entries(STRUM_CARD_FIELDS)) {
    const v = card[key];
    if (key === 'delayMs' && (v === null || v === undefined)) continue;
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) errors.push(`strum card ${card.id}: ${key} must lie in [${spec.min}, ${spec.max}]`);
  }
  if (!STRUM_PATTERNS.includes(card.pattern)) errors.push(`strum card ${card.id}: unknown pattern`);
  if (card.kind !== undefined && !CARD_KINDS.includes(card.kind)) errors.push(`strum card ${card.id}: unknown kind`);
  if (card.approach !== undefined && !APPROACH_KINDS.includes(card.approach)) errors.push(`strum card ${card.id}: unknown approach`);
  if (card.spacing !== undefined && !SPACINGS.includes(card.spacing)) errors.push(`strum card ${card.id}: unknown spacing`);
  if (card.absentDegree !== undefined && !ABSENT_DEGREES.includes(card.absentDegree)) errors.push(`strum card ${card.id}: unknown absentDegree`);
  if (card.slashBass !== undefined && !SLASH_BASS.includes(card.slashBass)) errors.push(`strum card ${card.id}: unknown slashBass`);
  if (card.bassDegree != null && !isBassDegree(card.bassDegree)) errors.push(`strum card ${card.id}: bassDegree must be a degree from 1 to 7`);
  for (const [key, spec] of Object.entries(ALT_CARD_FIELDS)) if (card[key] !== undefined && (!Number.isFinite(card[key]) || card[key] < spec.min || card[key] > spec.max)) errors.push(`strum card ${card.id}: ${key} must be a number from ${spec.min} to ${spec.max}`);
  for (const [key, spec] of Object.entries(DRUM_CARD_FIELDS)) if (card[key] !== undefined && (!Number.isFinite(card[key]) || card[key] < spec.min || card[key] > spec.max)) errors.push(`strum card ${card.id}: ${key} must lie in [${spec.min}, ${spec.max}]`);
  for (const [key, spec] of Object.entries(PIANO_CARD_FIELDS)) if (card[key] !== undefined && (!Number.isFinite(card[key]) || card[key] < spec.min || card[key] > spec.max)) errors.push(`strum card ${card.id}: ${key} must lie in [${spec.min}, ${spec.max}]`);
  return errors;
}

export function validateStrumCardList(list) {
  if (!Array.isArray(list)) return ['strum cards: list expected'];
  const errors = [];
  const seen = new Set();
  for (const c of list) {
    errors.push(...validateStrumCard(c));
    if (c?.id && seen.has(c.id)) errors.push(`strum cards: duplicate id ${c.id}`);
    if (c?.id) seen.add(c.id);
    if (c?.id && BUILTIN_STRUM_CARDS.some((b) => b.id === c.id)) errors.push(`strum cards: ${c.id} is a built-in id`);
  }
  return errors;
}

/** The user's cards as a preference section: { items: [card] }. */
export const validateStrumCardPref = (v) => (v && typeof v === 'object' ? validateStrumCardList(v.items ?? []) : ['strumCards: { items } expected']);
export const createStrumCardPref = (v) => ({ items: (v.items ?? []).map(createStrumCard) });

/** The card for an id: project > user > built in; an unknown id gives the standard card. Returns { card, source: 'project' | 'user' | 'builtin' }. */
export function resolveStrumCard(id, { project = [], user = [], kind = 'strum' } = {}) {
  const dflt = kind === 'piano' ? 'piano' : kind === 'drums' ? 'drums' : STANDARD_CARD_ID;
  const key = id ?? dflt;
  const hit = (list, source) => { const c = (list ?? []).find((x) => x.id === key); return c ? { card: createStrumCard(c), source } : null; };
  const found = hit(project, 'project') ?? hit(user, 'user')
    ?? (() => { const b = BUILTIN_STRUM_CARDS.find((x) => x.id === key); return b ? { card: { ...b }, source: 'builtin' } : null; })();
  // a card of the other kind (a guitar card on a piano staff) or an unknown id gives the default card of the kind
  if (found && found.card.kind === kind) return found;
  return { card: { ...BUILTIN_STRUM_CARDS.find((x) => x.id === dflt) }, source: 'builtin' };
}

/** Every card offered by a menu: built in first, then the user's, then the project's (a project card hides the card of the same id). */
export function allStrumCards({ project = [], user = [] } = {}) {
  const seen = new Set();
  const out = [];
  for (const [list, source] of [[project, 'project'], [user, 'user'], [BUILTIN_STRUM_CARDS, 'builtin']]) {
    for (const c of list ?? []) if (!seen.has(c.id)) { seen.add(c.id); out.push({ ...createStrumCard(c), source }); }
  }
  const order = { builtin: 0, user: 1, project: 2 };
  return out.sort((a, b) => order[a.source] - order[b.source]);
}

/** Options for `planStrum` from a card and the staff's own overrides. */
export function strumOptionsFor(card, { pattern = null, delayMs = null } = {}) {
  const piano = Object.fromEntries([...Object.keys(PIANO_CARD_FIELDS), 'approach', 'absentDegree', 'slashBass', 'bassDegree', 'spacing'].map((k) => [k, card[k]]));
  const drums = Object.fromEntries([...Object.keys(DRUM_CARD_FIELDS), ...Object.keys(ALT_CARD_FIELDS)].map((k) => [k, card[k]]));
  return { ...piano, ...drums, downVelocity: card.downVelocity, upVelocity: card.upVelocity, fall: card.fall, upStrings: card.upStrings, mutedDuration: card.mutedDuration, mutedVelocity: card.mutedVelocity, singleNote: card.singleNote,
    pattern: pattern ?? card.pattern, delayMs: delayMs ?? card.delayMs };
}

// ---- edits (call inside doc.transaction) ----
export function setProjectStrumCards(doc, work, list) {
  const errors = validateStrumCardList(list);
  if (errors.length) throw new Error(errors[0]);
  if (list.length) doc.set(work, PID.STRUM_CARDS, list); else if ((doc.get(work, PID.STRUM_CARDS) ?? []).length) doc.reset(work, PID.STRUM_CARDS);
}
