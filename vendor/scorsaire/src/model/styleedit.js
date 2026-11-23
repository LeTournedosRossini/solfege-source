// Applying a style to a movement, and making a style from the arrangement of a movement (model/styles.js). Call the editing functions INSIDE `doc.transaction`.
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { addTrackFromInstrument } from './trackedit.js';
import { isChordTrack } from './chordtrack.js';
import { playerOf, setPlayer, hasWrittenNotes, isDrumTrack } from './player.js';
import { roleOfTrack, createStyle, ROLE_INSTRUMENT } from './styles.js';
import { createSwing } from './elements.js';
import { swingAt } from './systemedit.js';
import { BUILTIN_CHORD_PATTERNS, createChordPattern, setProjectChordPatterns } from './chordpatterns.js';
import { BUILTIN_GROOVES, createGroove, setProjectGrooves } from './grooves.js';
import { BUILTIN_STRUM_CARDS, createStrumCard, setProjectStrumCards } from './strumcards.js';

const KINDS = [
  { key: 'patterns', pid: PID.CHORD_PATTERNS, builtin: BUILTIN_CHORD_PATTERNS, create: createChordPattern, setProject: setProjectChordPatterns, user: 'patterns' },
  { key: 'grooves', pid: PID.GROOVES, builtin: BUILTIN_GROOVES, create: createGroove, setProject: setProjectGrooves, user: 'grooves' },
  { key: 'cards', pid: PID.STRUM_CARDS, builtin: BUILTIN_STRUM_CARDS, create: createStrumCard, setProject: setProjectStrumCards, user: 'cards' },
];

/**
 * Sets the swing at the very start of the movement: a preset of `swingpresets.js`, 'custom' (with `spec` { ratio, unit }: the percentage and the unit of the swing), 'straight' (no swing) or null
 * (leave it). A swing already there is replaced.
 */
export function setSwingAtStart(doc, mv, kind, spec = {}) {
  if (kind == null) return;
  const target = { measureId: mv.masterbars[0].id, position: [0, 1] };
  const old = swingAt(mv, target);
  const custom = kind === 'custom' ? { ratio: spec.ratio ?? 60, unit: spec.unit ?? 'eighth' } : null;
  if (old && getProperty(old, PID.SWING_KIND) === kind && (!custom || (getProperty(old, PID.SWING_RATIO) === custom.ratio && getProperty(old, PID.SWING_UNIT) === custom.unit))) return;
  if (old) doc.remove(old);
  if (kind === 'straight' || kind === 'none') return; // no sign at all is a straight movement
  doc.add(mv, 'swings', createSwing({ measureId: target.measureId, position: target.position, kind, ...(custom ? { ...custom, text: `swing ${custom.ratio} %` } : {}) }));
}

/** The swing at the very start of the movement as a style swing: a preset id, or 'straight' when there is none. */
export function swingAtStart(mv) {
  const s = mv.masterbars.length ? swingAt(mv, { measureId: mv.masterbars[0].id, position: [0, 1] }) : null;
  return s ? getProperty(s, PID.SWING_KIND) : 'straight';
}

/** The same with what a custom swing needs: { swing, swingRatio?, swingUnit? }. */
export function swingSpecAtStart(mv) {
  const swing = swingAtStart(mv);
  if (swing !== 'custom') return { swing };
  const s = swingAt(mv, { measureId: mv.masterbars[0].id, position: [0, 1] });
  return { swing, swingRatio: getProperty(s, PID.SWING_RATIO), swingUnit: getProperty(s, PID.SWING_UNIT) };
}

/** What a style uses that is not built in: the ids of its patterns (chord patterns), grooves and cards. */
export function styleReferences(style) {
  return {
    patterns: [...new Set(style.players.filter((p) => p.role !== 'drums').map((p) => p.pattern))],
    grooves: [...new Set(style.players.filter((p) => p.role === 'drums').map((p) => p.pattern))],
    cards: [...new Set(style.players.map((p) => p.card).filter(Boolean))],
  };
}

/** Copies what the style uses (and the project does not have yet, nor the program) into the project, so the file sounds the same everywhere. `user` = the device lists { patterns, grooves, cards }. */
function copyResources(doc, style, user) {
  const refs = styleReferences(style);
  for (const k of KINDS) {
    const project = doc.get(doc.work, k.pid) ?? [];
    const have = new Set([...project.map((x) => x.id), ...k.builtin.map((x) => x.id)]);
    const added = [];
    for (const id of refs[k.key]) {
      if (have.has(id)) continue;
      const found = (style.library?.[k.key] ?? []).find((x) => x?.id === id) ?? (user?.[k.user] ?? []).find((x) => x?.id === id);
      const made = found ? k.create(found) : null;
      if (made) { added.push(made); have.add(id); }
    }
    if (added.length) k.setProject(doc, doc.work, [...project, ...added]);
  }
}

/**
 * Applies a style to a movement. The accompaniment is a layer ON TOP of the score: a style never takes the tracks you wrote or kept for writing (a guitar, a bass, a drum kit without notes stay as they
 * are). For each player of the style, the first ACCOMPANIMENT track of the same role (a track that already has a player and no written notes, made by an earlier style) is given the player again;
 * a track is made when there is none (a hidden one, with its own mixer strip). The chord track is never touched: it is the table of truth. Then the swing. Nothing is deleted.
 * @param opts { lang, user: { patterns, grooves, cards } (the device lists, for what the style uses and the project lacks) }
 * @returns {{ players: { role, trackId, created: boolean }[], swing: string | null }}
 */
export function applyStyle(doc, mv, style, { lang = 'en', user = {} } = {}) {
  copyResources(doc, style, user);
  const used = new Set(); const players = [];
  for (const p of style.players) {
    let track = mv.tracks.find((t) => !used.has(t.id) && !isChordTrack(t) && roleOfTrack(t) === p.role && !hasWrittenNotes(t) && !!playerOf(t)); // only a track that is already an accompaniment track
    let created = false;
    if (!track) {
      track = addTrackFromInstrument(doc, mv, p.instrument ?? ROLE_INSTRUMENT[p.role], { lang });
      created = true;
      // nothing is drawn for a track made by a style (it plays by itself), unless it would leave nothing on the score
      if (mv.tracks.some((t) => t !== track && getProperty(t, PID.VISIBLE) !== false)) doc.set(track, PID.VISIBLE, false);
    }
    used.add(track.id);
    setPlayer(doc, track, { pattern: p.pattern, card: p.card, instrument: 'auto', active: true });
    players.push({ role: p.role, trackId: track.id, created });
  }
  setSwingAtStart(doc, mv, style.swing, { ratio: style.swingRatio, unit: style.swingUnit });
  return { players, swing: style.swing };
}

const withoutSource = ({ source, ...rest }) => rest; // eslint-disable-line no-unused-vars

/**
 * The style with its `library` recomputed: the patterns, grooves and cards it uses that are not built in, taken from the CURRENT lists (so a pattern edited since is up to date), else from the
 * library it already had. `lists` = { patterns, grooves, cards } (any level, `source` allowed); an id that is found nowhere is left out (applying the style then skips it).
 */
export function refreshStyleLibrary(style, lists = {}) {
  const refs = styleReferences(style);
  const library = {};
  for (const k of KINDS) {
    library[k.key] = refs[k.key].filter((id) => !k.builtin.some((b) => b.id === id))
      .map((id) => (lists[k.key] ?? []).find((x) => x?.id === id) ?? (style.library?.[k.key] ?? []).find((x) => x?.id === id)).filter(Boolean).map(withoutSource);
  }
  const { library: _old, ...rest } = style; // eslint-disable-line no-unused-vars
  return createStyle({ ...rest, library });
}

/**
 * The arrangement of a movement as a style: the players of its tracks (the chord track's own included), their role from their instrument, and the swing at its start. What they use that is
 * not built in goes into the `library` of the style, so it can be applied anywhere.
 * @param o { id?, name, user: { patterns, grooves, cards } }
 */
export function styleFromMovement(doc, mv, { id = '', name = null, user = {} } = {}) {
  const players = [];
  for (const t of mv.tracks) {
    const p = playerOf(t);
    const role = roleOfTrack(t);
    if (!p || !role) continue;
    players.push({ role, instrument: getProperty(t, PID.INSTRUMENT_ID) ?? undefined, pattern: p.pattern, card: p.card });
  }
  const draft = createStyle({ id, name, ...swingSpecAtStart(mv), players });
  if (!draft) return null;
  const refs = styleReferences(draft);
  const library = {};
  for (const k of KINDS) {
    const project = doc.get(doc.work, k.pid) ?? [];
    library[k.key] = refs[k.key].filter((rid) => !k.builtin.some((b) => b.id === rid))
      .map((rid) => project.find((x) => x.id === rid) ?? (user?.[k.user] ?? []).find((x) => x.id === rid)).filter(Boolean);
  }
  return createStyle({ ...draft, library });
}
