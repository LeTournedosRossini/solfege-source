// Styles: a named SET of automatic players by role (drums, bass, guitar, keys, strings, brass) with a swing. PURE. Applying a style to a movement (model/styleedit.js) sets the player of the
// track of each role — a track that has none yet is made — and the swing; it is a COPY: the movement keeps no link to the style, and what the style uses (patterns, grooves, cards) is
// copied into the project, so the file sounds the same on every device.
// Like the cards, the patterns and the grooves, a style lives at three levels: built in (this file), the USER's own (device preference `styles`) and the PROJECT's (`PID.STYLES`); lookup project > user > built in.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { instrumentInfo, searchInstruments } from './instruments.js';
import { isDrumTrack, ACCOMPANIMENTS } from './player.js';
import { SWING_PRESETS } from './swingpresets.js';

export const STYLE_ROLES = Object.freeze(['drums', 'bass', 'guitar', 'keys', 'strings', 'brass']);
/** The instrument of the catalogue a new track of a role gets (its sound). */
export const ROLE_INSTRUMENT = Object.freeze({ drums: 'drum-kit-5', bass: 'bass-guitar', guitar: 'guitar-steel', keys: 'piano', strings: 'violin', brass: 'trumpet' });
/** The swings a style may ask for: a preset of `swingpresets.js` ('straight' puts the swing back to straight). null = leave the swing of the movement as it is. */
export const STYLE_SWINGS = Object.freeze(Object.keys(SWING_PRESETS).filter((k) => k !== 'custom'));
export const MAX_STYLE_PLAYERS = 8;
/** A style may also ask for a CUSTOM swing: `swing: 'custom'` with `swingRatio` (the percentage of the beat the first note takes: 50 = straight, 60 the usual swing, 66 = triplets) and `swingUnit` ('eighth' | '16th'). */
export const CUSTOM_SWING_RANGE = Object.freeze({ min: 20, max: 90, dflt: 60 });
const swingOk = (v) => STYLE_SWINGS.includes(v) || v === 'custom';

/** The role an instrument of the catalogue plays in a band (never from a name): bass, guitar, keys, strings, brass; null for anything else. Drums are a percussion STAFF, see `roleOfTrack`. */
export function roleOfInstrument(id) {
  const info = id ? instrumentInfo(id) : null;
  if (!info) return null;
  if (info.family === 'bass-guitars' || id === 'double-bass') return 'bass';
  if (info.group === 'plucked-strings') return 'guitar';
  if (info.group === 'keyboards') return 'keys';
  if (info.group === 'strings') return 'strings';
  if (info.group === 'brass') return 'brass';
  return null;
}

/** The role a track plays in a band, from its instrument (never from its name): drums (a percussion staff), bass, guitar, keys, strings, brass; null for anything else. */
export function roleOfTrack(track) {
  if (isDrumTrack(track)) return 'drums';
  return roleOfInstrument(getProperty(track, PID.INSTRUMENT_ID) ?? null);
}

/** The instruments a style may ask for a role (the menu of the editor): [{ id, name }] of the catalogue, the default one of the role first. */
export function instrumentsOfRole(role, lang = 'en') {
  const all = searchInstruments({ lang });
  const found = role === 'drums' ? all.filter((i) => i.id.startsWith('drum-kit')) : all.filter((i) => roleOfInstrument(i.id) === role);
  const first = found.find((i) => i.id === ROLE_INSTRUMENT[role]);
  return (first ? [first, ...found.filter((i) => i !== first)] : found).map((i) => ({ id: i.id, name: i.name }));
}

/** The player a new line of a style gets for a role: a groove and a card for the drums, a chord pattern for the others (a held chord for strings and brass, until they get patterns of their own). */
export function defaultStylePlayer(role) {
  const a = { drums: ACCOMPANIMENTS.drums, bass: ACCOMPANIMENTS.bass, guitar: ACCOMPANIMENTS.guitar, keys: ACCOMPANIMENTS.piano }[role];
  return a ? { role, pattern: a.pattern, card: a.card } : { role, pattern: 'pad', card: null };
}

/** A new style with one drum player and a straight feel (the starting point of "New"). */
export const newStyle = (name = null) => createStyle({ id: '', name, swing: 'straight', players: [defaultStylePlayer('drums')] });

// ---- editing a style as a value (the editor saves the result through `app.saveStyle`); each returns a new style, or throws when the change would leave it without a player
const withPlayers = (style, players) => ({ ...style, players });
/** Changes a line: a patch of { role, instrument, pattern, card }. A new role takes the default pattern of that role (the drums and the others do not share their patterns) and forgets the instrument. */
export function setStylePlayer(style, index, patch) {
  const old = style.players[index];
  if (!old) throw new Error('Unknown player');
  const next = patch.role && patch.role !== old.role ? { ...defaultStylePlayer(patch.role), ...(patch.pattern ? { pattern: patch.pattern } : {}) } : { ...old, ...patch };
  if (!createStylePlayer(next)) throw new Error('A player needs a known role and a pattern');
  if (next.instrument === '' || next.instrument === null) delete next.instrument;
  return withPlayers(style, style.players.map((p, i) => (i === index ? next : p)));
}
export function addStylePlayer(style, role) {
  if (!STYLE_ROLES.includes(role)) throw new Error('Unknown role');
  if (style.players.length >= MAX_STYLE_PLAYERS) throw new Error(`A style has at most ${MAX_STYLE_PLAYERS} players`);
  return withPlayers(style, [...style.players, defaultStylePlayer(role)]);
}
export function removeStylePlayer(style, index) {
  if (style.players.length <= 1) throw new Error('A style needs at least one player');
  return withPlayers(style, style.players.filter((_, i) => i !== index));
}
/** Moves a line up (-1) or down (+1); the order only matters between two players of the same role (the first takes the first free track). */
export function moveStylePlayer(style, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= style.players.length) return style;
  const players = [...style.players]; [players[index], players[to]] = [players[to], players[index]];
  return withPlayers(style, players);
}

const text = (v, n) => (v == null ? null : String(v).slice(0, n));
const list = (v) => (Array.isArray(v) ? v : []);

/** A checked player entry { role, instrument?, pattern, card } or null. `pattern` is a groove for the drums, a chord pattern for the others; `instrument` (catalogue id) is only used when a track has to be made. */
function createStylePlayer(p) {
  if (!STYLE_ROLES.includes(p?.role) || typeof p?.pattern !== 'string' || !p.pattern) return null;
  return { role: p.role, ...(typeof p.instrument === 'string' && p.instrument ? { instrument: p.instrument } : {}), pattern: p.pattern, card: typeof p.card === 'string' && p.card ? p.card : null };
}

/** A complete, checked style from a partial one, or null when it has no valid player. `library` carries the patterns, grooves and cards the players use that are not built in, so the style is self-contained. */
export function createStyle(input = {}) {
  const players = list(input.players).map(createStylePlayer).filter(Boolean).slice(0, MAX_STYLE_PLAYERS);
  if (!players.length) return null;
  const lib = input.library && typeof input.library === 'object' ? input.library : null;
  const library = lib ? { patterns: list(lib.patterns), grooves: list(lib.grooves), cards: list(lib.cards) } : null;
  return {
    id: String(input.id ?? ''), name: text(input.name, 40), ...(text(input.folder, 40)?.trim() ? { folder: text(input.folder, 40).trim() } : {}), swing: swingOk(input.swing) ? input.swing : null, ...(input.swing === 'custom' ? { swingRatio: Number.isFinite(input.swingRatio) ? Math.min(CUSTOM_SWING_RANGE.max, Math.max(CUSTOM_SWING_RANGE.min, Math.round(input.swingRatio))) : CUSTOM_SWING_RANGE.dflt, swingUnit: input.swingUnit === '16th' ? '16th' : 'eighth' } : {}), players,
    ...(library && (library.patterns.length || library.grooves.length || library.cards.length) ? { library } : {}),
  };
}

export function validateStyle(s) {
  if (!s || typeof s !== 'object') return ['style: object expected'];
  const errors = [];
  if (typeof s.id !== 'string' || !s.id) errors.push('style: id expected');
  if (s.name != null && typeof s.name !== 'string') errors.push('style: name must be a string');
  if (s.folder != null && typeof s.folder !== 'string') errors.push('style: folder must be a string');
  if (s.swing != null && !swingOk(s.swing)) errors.push(`style ${s.id}: unknown swing`);
  if (s.swingRatio != null && !(Number.isInteger(s.swingRatio) && s.swingRatio >= CUSTOM_SWING_RANGE.min && s.swingRatio <= CUSTOM_SWING_RANGE.max)) errors.push(`style ${s.id}: swingRatio out of range`);
  if (!Array.isArray(s.players) || !s.players.length) errors.push(`style ${s.id}: at least one player expected`);
  else if (s.players.length > MAX_STYLE_PLAYERS || s.players.some((p) => !createStylePlayer(p))) errors.push(`style ${s.id}: a player needs a known role and a pattern (at most ${MAX_STYLE_PLAYERS} players)`);
  return errors;
}

export function validateStyleList(items) {
  if (!Array.isArray(items)) return ['styles: list expected'];
  const errors = []; const seen = new Set();
  for (const s of items) {
    errors.push(...validateStyle(s));
    if (s?.id && seen.has(s.id)) errors.push(`styles: duplicate id ${s.id}`);
    if (s?.id) seen.add(s.id);
    if (s?.id && BUILTIN_STYLES.some((b) => b.id === s.id)) errors.push(`styles: ${s.id} is a built-in id`);
  }
  return errors;
}

/** The user's styles as a preference section: { items: [style] }. */
export const validateStylePref = (v) => (v && typeof v === 'object' ? validateStyleList(v.items ?? []) : ['styles: { items } expected']);
export const createStylePref = (v) => ({ items: (v.items ?? []).map(createStyle).filter(Boolean) });

const P = (role, pattern, card = null) => ({ role, pattern, card });
/** Built-in styles (starting points chosen by Scorsaire, to be replaced by the user's own repertoire). Their names come from the language catalogs (`style.<id>`). */
export const BUILTIN_STYLES = Object.freeze([
  Object.freeze({ id: 'pop-rock', name: null, swing: 'straight', players: [P('drums', 'rock8', 'drums'), P('bass', 'bass-eighths', 'bass'), P('guitar', 'ballad', 'rock'), P('keys', 'pad', null)] }),
  Object.freeze({ id: 'ballad', name: null, swing: 'straight', players: [P('drums', 'ballad', 'drums'), P('bass', 'bass-root', 'bass'), P('guitar', 'arpeggio', 'standard'), P('keys', 'pad', null)] }),
  Object.freeze({ id: 'shuffle', name: null, swing: 'tripletEighth', players: [P('drums', 'shuffle', 'drums'), P('bass', 'bass-walking', 'bass'), P('guitar', 'offbeat', 'folk'), P('keys', 'ballad', null)] }),
  Object.freeze({ id: 'funk', name: null, swing: 'straight', players: [P('drums', 'funk16', 'drums'), P('bass', 'bass-octaves', 'bass'), P('guitar', 'offbeat', 'rock'), P('keys', 'offbeat', null)] }),
  // two examples of the string and brass roles (a string pad under a ballad, horn stabs over a funk): the mechanism is there for whoever wants other ones
  Object.freeze({ id: 'ballad-strings', name: null, swing: 'straight', players: [P('drums', 'ballad', 'drums'), P('bass', 'bass-root', 'bass'), P('guitar', 'arpeggio', 'standard'), { ...P('strings', 'pad', 'strings'), instrument: 'violins' }] }),
  Object.freeze({ id: 'funk-horns', name: null, swing: 'straight', players: [P('drums', 'funk16', 'drums'), P('bass', 'bass-octaves', 'bass'), P('guitar', 'offbeat', 'rock'), { ...P('brass', 'brass-stabs', 'brass'), instrument: 'trumpet' }] }),
]);

/** Style by id: project > user > built in; null for none or an unknown id. */
export function resolveStyle(id, { project = [], user = [] } = {}) {
  if (!id) return null;
  for (const l of [project, user, BUILTIN_STYLES]) {
    const found = (l ?? []).find((s) => s?.id === id);
    if (found) return createStyle(found);
  }
  return null;
}

/** Every style a menu offers, complete: [{ ...style, source: 'builtin' | 'user' | 'project' }] (a project style hides one of the same id); built in first. */
export function allStyles({ project = [], user = [] } = {}) {
  const seen = new Set(); const out = [];
  for (const [l, source] of [[project, 'project'], [user, 'user'], [BUILTIN_STYLES, 'builtin']]) {
    for (const s of l ?? []) {
      if (!s?.id || seen.has(s.id)) continue;
      const done = createStyle(s); if (!done) continue;
      seen.add(s.id); out.push({ ...done, source });
    }
  }
  const order = { builtin: 0, user: 1, project: 2 };
  return out.sort((a, b) => order[a.source] - order[b.source]);
}

/** Call inside `doc.transaction`. */
export function setProjectStyles(doc, work, items) {
  const errors = validateStyleList(items);
  if (errors.length) throw new Error(errors[0]);
  if (items.length) doc.set(work, PID.STYLES, items); else if ((doc.get(work, PID.STYLES) ?? []).length) doc.reset(work, PID.STYLES);
}

/** The players left out of a trial listening, from their lanes (`Map` index → 'mute' | 'solo'): with a solo only the soloed ones are heard, else everyone but the muted ones. */
export function skippedPlayers(count, lane = new Map()) {
  const solo = [...lane.values()].includes('solo');
  return Array.from({ length: count }, (_, i) => i).filter((i) => (solo ? lane.get(i) !== 'solo' : lane.get(i) === 'mute'));
}
