/*
 * Chord diagrams of a fretted instrument, at the level of the DOCUMENT: which fingering is shown for a chord. PURE (the edits are to be called inside
 * `doc.transaction`).
 *
 * A diagram knows the CHORD it is for (`PID.DIAGRAM_CHORD` = { root, quality, bass }, the same shape as a chord symbol), the instrument
 * (`PID.DIAGRAM_INSTRUMENT`) and, when the user fingered it by hand, the voicing itself (`PID.VOICING`). Nothing derivable is stored. The fingering
 * actually shown is resolved from, in this order:
 *   1. the diagram's own `voicing` (the user edited THIS diagram);
 *   2. the work's preferred fingering for that chord and instrument (`PID.PREFERRED_VOICINGS`, "use this one everywhere");
 *   3. the n-th suggestion (`PID.DIAGRAM_SUGGESTION`, 0 = the best) computed from the chord.
 * So a diagram "follows" its chord: change the chord and the fingering changes with it, until the user fingers it by hand ("reset to the
 * suggestion" = `doc.reset(el, PID.VOICING)`).
 */
import { PID } from './pid.js';
import { getProperty, resolveStyle } from './props.js';
import { SID } from './sid.js';
import { walk } from './store.js';
import { isApplicable } from './schema.js';
import { tuningPitches } from './capo.js';
import { INSTRUMENT_PRESETS, validateVoicing, sameVoicing, voicingTuning, createVoicing } from './fretvoicing.js';
import { suggestVoicings, chordSpecFromSymbol } from './fretsuggest.js';
import { chooseFretPath, DEFAULT_PATH_MODE } from './fretpath.js';
import { instrumentInfo } from './instruments.js';
import { measureTimeline } from './noteedit.js';
import { measureLengthOf } from './timing.js';
import { primaryOf, projectLinkedStaff } from './linkedstaff.js';
import { fLt } from './fraction.js';
import { ruleOf, ruleVoicing } from './voicingrule.js';

export const DIAGRAM_INSTRUMENTS = Object.freeze(['guitar', 'ukulele', 'bass', 'bass5', 'piano']);
/** Open-string pitches of an instrument for the keys of the preferred fingerings (a piano has none). */
export const tuningOfInstrument = (instrument) => (instrument === 'piano' ? [] : INSTRUMENT_PRESETS[instrument]?.tuning ?? null);
const LETTERS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

/** Problems of a note { step, alter } (empty = valid). */
const noteProblems = (n, what) => (n && LETTERS.has(n.step) && Number.isInteger(n.alter ?? 0) && Math.abs(n.alter ?? 0) <= 2 ? [] : [`${what}: invalid note`]);

/** Problems of the chord a diagram is for. */
export function validateDiagramChord(chord) {
  if (chord === null || chord === undefined) return [];
  if (typeof chord !== 'object') return ['diagram chord: not an object'];
  const errors = noteProblems(chord.root, 'diagram chord root');
  if (typeof (chord.quality ?? '') !== 'string') errors.push('diagram chord: invalid quality');
  if (chord.bass) errors.push(...noteProblems(chord.bass, 'diagram chord bass'));
  return errors;
}

/** Problems of the diagram properties of an element (empty = valid). */
export function validateDiagram(el) {
  const errors = [];
  const voicing = getProperty(el, PID.VOICING);
  if (voicing) errors.push(...validateVoicing(voicing));
  errors.push(...validateDiagramChord(getProperty(el, PID.DIAGRAM_CHORD)));
  const follow = getProperty(el, PID.DIAGRAM_FOLLOW);
  if (follow) {
    if (getProperty(el, PID.CONTAINER_PLACEMENT) === 'between') errors.push('diagram: a diagram that follows the chord staff is stacked over measures');
    for (const [key, o] of Object.entries(getProperty(el, PID.DIAGRAM_OVERRIDES) ?? {})) {
      if (o?.voicing) for (const p of validateVoicing(o.voicing)) errors.push(`diagram override ${key}: ${p}`);
      if (o?.suggestion !== undefined && !(Number.isInteger(o.suggestion) && o.suggestion >= 0 && o.suggestion <= 99)) errors.push(`diagram override ${key}: invalid suggestion`);
    }
  } else if (!getProperty(el, PID.DIAGRAM_CHORD) && !voicing) errors.push('diagram: neither a chord nor a voicing');
  const index = getProperty(el, PID.DIAGRAM_SUGGESTION);
  if (!Number.isInteger(index) || index < 0 || index > 99) errors.push('diagram: invalid suggestion index');
  return errors;
}

/** Problems of the diagram a chord symbol carries (empty = valid; a symbol without diagram has none). */
export function validateSymbolDiagram(sym) {
  const errors = [];
  const voicing = getProperty(sym, PID.VOICING);
  if (voicing) errors.push(...validateVoicing(voicing));
  const scale = getProperty(sym, PID.DIAGRAM_SCALE);
  if (!(scale >= 0.4 && scale <= 3)) errors.push(`diagram: scale ${scale} outside 0.4..3`);
  const index = getProperty(sym, PID.DIAGRAM_SUGGESTION);
  if (!Number.isInteger(index) || index < 0 || index > 99) errors.push('diagram: invalid suggestion index');
  const lift = getProperty(sym, PID.DIAGRAM_LIFT);
  if (lift !== null && !(lift >= 0 && lift <= 20)) errors.push(`diagram: lift ${lift} outside 0..20`);
  return errors;
}

/** Problems of the diagram a chord of notes carries (size, height, instrument). */
export function validateChordDiagram(chord) {
  const errors = [];
  const scale = getProperty(chord, PID.DIAGRAM_SCALE);
  if (!(scale >= 0.4 && scale <= 3)) errors.push(`diagram: scale ${scale} outside 0.4..3`);
  const lift = getProperty(chord, PID.DIAGRAM_LIFT);
  if (lift !== null && !(lift >= 0 && lift <= 20)) errors.push(`diagram: lift ${lift} outside 0..20`);
  return errors;
}

/**
 * The fingering a chord of NOTES shows when it carries a diagram: it is DERIVED from the notes, never stored.
 *  - on a tablature staff: the strings and frets written there (the neck position of each note, capo not counted), on the tuning of the staff;
 *  - on a notation staff: each note is put on a string of `instrument` (the string hinted by `PID.TAB_STRING` when the note has one, else, from the highest
 *    note down, the free string where it needs the lowest fret).
 * A note that finds no string is left out. Returns null when no note could be placed.
 */
export function chordDiagramVoicing(staff, chord, instrument = 'guitar') {
  const type = getProperty(staff, PID.STAFF_TYPE);
  if (instrument === 'piano' && (type === 'score' || type === 'tab')) { // the keys of the written pitches
    const notes = chord.notes.map((n) => getProperty(n, PID.PITCH)).filter((p) => Number.isInteger(p) && p >= 0 && p <= 127);
    return notes.length ? createVoicing({ instrument: 'piano', notes }) : null;
  }
  if (type === 'tab') {
    const high = tuningPitches(staff); // string 1 = the highest
    const frets = high.map(() => -1);
    for (const n of chord.notes) {
      const s = getProperty(n, PID.STRING) - 1;
      const pitch = getProperty(n, PID.PITCH);
      if (s >= 0 && s < high.length && Number.isInteger(pitch) && pitch - high[s] >= 0) frets[high.length - 1 - s] = pitch - high[s]; // diagram order: lowest string first
    }
    if (frets.every((f) => f < 0)) return null;
    const low = [...high].reverse();
    const guitar = INSTRUMENT_PRESETS.guitar.tuning;
    const same = low.length === guitar.length && low.every((p, i) => p === guitar[i]);
    try { return createVoicing(same ? { instrument: 'guitar', frets } : { instrument: 'custom', tuning: low, frets }); } catch { return null; }
  }
  const preset = INSTRUMENT_PRESETS[instrument];
  if (!preset || type !== 'score') return null;
  const open = preset.tuning; // lowest string first
  const frets = open.map(() => -1);
  const pitched = chord.notes.map((n) => ({ pitch: getProperty(n, PID.PITCH), hint: isApplicable(n.type, PID.TAB_STRING) ? getProperty(n, PID.TAB_STRING) : null })).filter((n) => Number.isInteger(n.pitch));
  const place = (n, i) => { frets[i] = n.pitch - open[i]; };
  const rest = [];
  for (const n of pitched) {
    const i = Number.isInteger(n.hint) ? open.length - n.hint : -1; // TAB_STRING 1 = the highest string
    if (i >= 0 && i < open.length && frets[i] < 0 && n.pitch - open[i] >= 0 && n.pitch - open[i] <= preset.maxFret) place(n, i); else rest.push(n);
  }
  for (const n of rest.sort((a, b) => b.pitch - a.pitch)) {
    let best = -1;
    for (let i = 0; i < open.length; i++) {
      const f = n.pitch - open[i];
      if (frets[i] >= 0 || f < 0 || f > preset.maxFret) continue;
      if (best < 0 || f < n.pitch - open[best]) best = i;
    }
    if (best >= 0) place(n, best);
  }
  if (frets.every((f) => f < 0)) return null;
  try { return createVoicing({ instrument, frets }); } catch { return null; }
}

/** Key of a chord for the work's preferred fingerings: pitch classes, not spelling or quality id, so renaming a quality never loses a choice. */
export function chordKey(spec, instrument, tuning) {
  const rel = [...new Set([0, ...spec.intervals.map((i) => ((i % 12) + 12) % 12)])].sort((a, b) => a - b).join(',');
  return `${instrument}|${tuning.join(',')}|${spec.rootPc}|${rel}|${spec.bassPc ?? ''}`;
}

/**
 * The fingering a diagram shows.
 * @param p { voicing, chord, instrument = 'guitar', index = 0, preferred, dict }
 * @returns { voicing, source: 'own' | 'preferred' | 'suggestion', spec } | null (nothing to show: no voicing and no usable chord)
 */
export function resolveDiagram(p = {}) {
  const res = resolveDiagramBase(p);
  // `played`: undefined = the diagrams do not read a tablature; null = they do, and nothing is played there (the proposed fingering is shown, marked as such)
  return p.played === null && res && res.source !== 'own' ? { ...res, fallback: true } : res;
}
function resolveDiagramBase({ voicing = null, chord = null, instrument = 'guitar', index = 0, preferred = null, dict, noSuggestion = false, pathVoicing = null, played } = {}) {
  const spec = chord ? chordSpecFromSymbol(chord, dict) : null;
  if (voicing) return { voicing, source: 'own', spec };
  if (played) return { voicing: played, source: 'tab', spec }; // the fingering the tablature plays under this chord
  if (!spec) return null;
  const tuning = tuningOfInstrument(instrument);
  if (!tuning) return null;
  const key = chordKey(spec, instrument, tuning);
  const rule = ruleOf(preferred); // a layer with a rule (power chords…): for the chords it has no fingering of its own for, the rule comes before the main pool
  if (rule && !rule.own.has(key)) { const ruled = ruleVoicing(rule.rule, spec, instrument); if (ruled) return { voicing: ruled, source: 'preferred', spec, rule: rule.rule }; }
  const pref = preferred?.[key];
  if (pref && validateVoicing(pref).length === 0) return { voicing: pref, source: 'preferred', spec };
  if (pathVoicing && !noSuggestion) return { voicing: pathVoicing, source: 'suggestion', spec, path: true }; // chosen with its neighbours (`chordPathFor`)
  if (noSuggestion) return { voicing: null, source: 'suggestion', spec }; // the caller chooses among the suggestions itself (model/fretpath.js)
  const list = suggestVoicings(spec, { instrument, limit: Math.max(8, index + 1) });
  const pick = list[Math.min(index, list.length - 1)];
  return pick ? { voicing: pick.voicing, source: 'suggestion', spec } : null;
}

/** The diagram of an element (container) resolved with the work's preferences. */
export function resolveElementDiagram(el, { preferred, dict } = {}) {
  return resolveDiagram({
    voicing: getProperty(el, PID.VOICING), chord: getProperty(el, PID.DIAGRAM_CHORD), instrument: getProperty(el, PID.DIAGRAM_INSTRUMENT),
    index: getProperty(el, PID.DIAGRAM_SUGGESTION), preferred, dict,
  });
}

/** The chord of a chord symbol item, as a diagram stores it. */
export const diagramChordOf = (symbolItem) => {
  const root = getProperty(symbolItem, PID.CHORD_ROOT);
  if (!root) return null;
  return { root: { step: root.step, alter: root.alter ?? 0 }, quality: getProperty(symbolItem, PID.CHORD_QUALITY) ?? '', bass: getProperty(symbolItem, PID.CHORD_BASS) ?? null };
};

// ---------- the fingering PLAYED in a tablature ----------

/** The tablature staff a chord staff reads its diagrams' fingering from (`PID.DIAGRAM_TAB_STAFF`): the staff of the movement, or null (none chosen, or it is gone / not a tablature). */
export function tabStaffOf(mv, chordStaff) {
  const id = chordStaff ? getProperty(chordStaff, PID.DIAGRAM_TAB_STAFF) : null;
  if (!id) return null;
  const staff = mv.tracks.flatMap((t) => t.staves).find((s) => s.id === id);
  return staff && getProperty(staff, PID.STAFF_TYPE) === 'tab' ? staff : null;
}

/**
 * The fingering a tablature plays under a chord symbol: the notes it plays from the symbol's instant to the next symbol of the chord staff (or the end of that measure),
 * one per string (the first met), as the diagram of a chord of notes. At least two strings are needed, else null (the caller falls back on the proposed fingering).
 */
export function playedVoicing(mv, chordStaff, tabStaff, symbol, mi) {
  const mb = mv.masterbars[mi]; if (!mb || !tabStaff) return null;
  const length = measureLengthOf(mb);
  const from = getProperty(symbol, PID.POSITION) ?? [0, 1];
  let to = length;
  for (const voice of chordStaff.voices) for (const it of voice.measures[mi]?.items ?? []) {
    if (it.type !== 'chordsymbol' || it === symbol) continue;
    const at = getProperty(it, PID.POSITION) ?? [0, 1];
    if (fLt(from, at) && fLt(at, to)) to = at;
  }
  const byString = new Map();
  for (const voice of tabStaff.voices) {
    const m = voice.measures[mi]; if (!m) continue;
    for (const u of measureTimeline(m, length)) {
      if (u.item.type !== 'chord' || fLt(u.start, from) || !fLt(u.start, to)) continue;
      for (const n of u.item.notes) { const s = getProperty(n, PID.STRING); if (Number.isInteger(s) && !byString.has(s)) byString.set(s, n); }
    }
  }
  if (byString.size < 2) return null;
  return chordDiagramVoicing(tabStaff, { notes: [...byString.values()] }, 'guitar');
}

/** `played` for `resolveDiagram` of a chord symbol: undefined when its chord staff reads no tablature, else the played voicing or null. */
export function playedFor(mv, chordStaff, symbol, mi) {
  const tab = tabStaffOf(mv, chordStaff);
  return tab ? playedVoicing(mv, chordStaff, tab, symbol, mi) : undefined;
}

// ---------- following the chord staff ----------

/**
 * The chord symbols written in `span` measures from `measureId`, on the FIRST chord staff of the movement, in playing order:
 * [{ key (the symbol id), mi (measure index), position (fraction), chord }]. `%`, `%%` and N.C. are not chords and are skipped.
 */
export function chordSymbolsInSpan(mv, measureId, span = 1) {
  const from = mv.masterbars.findIndex((b) => b.id === measureId);
  if (from < 0) return [];
  const staff = mv.tracks.flatMap((t) => t.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'chord');
  if (!staff) return [];
  const out = [];
  for (let mi = from; mi < Math.min(mv.masterbars.length, from + Math.max(1, span)); mi++) {
    for (const voice of staff.voices) {
      for (const it of voice.measures[mi]?.items ?? []) {
        if (it.type !== 'chordsymbol') continue;
        const special = getProperty(it, PID.CHORD_SPECIAL) ?? 'none';
        if (special !== 'none') continue;
        const chord = diagramChordOf(it);
        if (chord) out.push({ key: it.id, mi, position: getProperty(it, PID.POSITION) ?? [0, 1], chord, sym: it });
      }
    }
  }
  const num = (f) => f[0] / f[1];
  return out.sort((a, b) => a.mi - b.mi || num(a.position) - num(b.position));
}

// ---------- the path of least movement through the chord symbols ----------

/**
 * The chords of a progression ready for `chooseFretPath`: [{ fixed, candidates }] for chord SYMBOLS (elements). A fingering the author wrote, or the work prefers, is
 * fixed; so is the one a symbol has when its "solver" switch is off (`PID.DIAGRAM_SOLVER` false) or when the author picked another suggestion: the fingering the chord
 * would have on its own. Every other chord offers its ten best suggestions.
 */
export function pathChordsOf(symbols, { instrument, preferred = null, dict, memo = new Map(), chordOf = diagramChordOf }) {
  const tuning = tuningOfInstrument(instrument);
  return symbols.map((sym) => {
    const own = getProperty(sym, PID.VOICING);
    const index = getProperty(sym, PID.DIAGRAM_SUGGESTION) ?? 0;
    const r = resolveDiagram({ voicing: own && own.instrument === instrument ? own : null, chord: chordOf(sym), instrument, index, preferred, dict, noSuggestion: true });
    if (!r) return { fixed: null, candidates: [] };
    if (r.voicing) return { fixed: r.voicing, candidates: [] };
    const key = `${chordKey(r.spec, instrument, tuning)}`;
    if (!memo.has(key)) memo.set(key, suggestVoicings(r.spec, { instrument, limit: 10 }));
    const list = memo.get(key);
    if (getProperty(sym, PID.DIAGRAM_SOLVER) === false || index > 0) {
      const alone = list[Math.min(index, list.length - 1)]?.voicing ?? null;
      return { fixed: alone, candidates: [] };
    }
    return { fixed: null, candidates: list };
  });
}

/** The fingering instrument a track suggests for a strumming staff: keyboards and organs → piano, ukuleles → ukulele, bass guitars → bass / bass5, anything else → guitar. */
export function autoStrumInstrument(track) {
  const id = track ? getProperty(track, PID.INSTRUMENT_ID) : null;
  const info = id ? instrumentInfo(id) : null;
  if (!info) return 'guitar';
  if (info.group === 'keyboards') return 'piano';
  if (info.family === 'ukuleles') return 'ukulele';
  if (info.family === 'bass-guitars') return (info.strings?.length ?? 4) >= 5 ? 'bass5' : 'bass';
  return 'guitar';
}

/** The instrument a strumming staff plays and shows: its own choice, or (`auto`, the default) the one its track suggests. */
export function strumInstrumentOf(track, staff) {
  const own = getProperty(staff, PID.STRUM_INSTRUMENT);
  return own && own !== 'auto' ? own : autoStrumInstrument(track);
}

/** How the fingerings follow one another, as the movement's guitar rhythm staff says (its first strumming staff of this instrument), 'balanced' without one. */
export function pathModeOf(mv, instrument) {
  const staves = mv.tracks.flatMap((t) => t.staves.map((st) => ({ st, track: t }))).filter(({ st }) => getProperty(st, PID.STAFF_TYPE) === 'rhythm' && getProperty(st, PID.STRUM) === true);
  const mine = (staves.find(({ st, track }) => strumInstrumentOf(track, st) === instrument) ?? staves[0])?.st;
  return mine ? getProperty(mine, PID.STRUM_PATH) ?? DEFAULT_PATH_MODE : DEFAULT_PATH_MODE;
}

const pathCache = new Map(); // signature → Map(symbol id → voicing)

/**
 * The fingering the path of least movement gives each chord symbol of the movement's first chord staff, in written order: Map(symbol id → voicing). Empty for an instrument
 * without frets or when the setting is 'off'. Cached by what it depends on, so that every diagram of a layout shares one computation.
 */
export function chordPathFor(mv, instrument, { preferred = null, dict } = {}) {
  const tuning = instrument ? tuningOfInstrument(instrument) : null;
  if (!tuning || instrument === 'piano' || !mv.masterbars.length) return new Map();
  const mode = pathModeOf(mv, instrument);
  if (mode === 'off') return new Map();
  const entries = chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length).filter((e) => chordSpecFromSymbol(e.chord, dict));
  const signature = JSON.stringify([instrument, mode, preferred, entries.map((e) => [e.key, chordSpecFromSymbol(e.chord, dict), getProperty(e.sym, PID.VOICING) ?? null, getProperty(e.sym, PID.DIAGRAM_SUGGESTION) ?? 0, getProperty(e.sym, PID.DIAGRAM_SOLVER) !== false])]);
  const hit = pathCache.get(signature);
  if (hit) return hit;
  const chosen = chooseFretPath(pathChordsOf(entries.map((e) => e.sym), { instrument, preferred, dict }), { mode });
  const out = new Map();
  entries.forEach((e, i) => { if (chosen[i]) out.set(e.key, chosen[i]); });
  if (pathCache.size > 12) pathCache.delete(pathCache.keys().next().value);
  pathCache.set(signature, out);
  return out;
}

/** What a container in 'follow' mode shows: one entry per chord symbol of its measures, each with its own resolved fingering. */
export function followedDiagrams(mv, container, { preferred, dict } = {}) {
  const instrument = getProperty(container, PID.DIAGRAM_INSTRUMENT);
  const overrides = getProperty(container, PID.DIAGRAM_OVERRIDES) ?? {};
  const path = chordPathFor(mv, instrument, { preferred, dict });
  const chordStaff = mv.tracks.flatMap((t) => t.staves).find((st) => getProperty(st, PID.STAFF_TYPE) === 'chord');
  return chordSymbolsInSpan(mv, getProperty(container, PID.MEASURE_ID), getProperty(container, PID.SPAN)).map((e) => ({
    ...e, instrument,
    res: resolveDiagram({ voicing: overrides[e.key]?.voicing ?? null, chord: e.chord, instrument, index: overrides[e.key]?.suggestion ?? 0, preferred, dict, pathVoicing: overrides[e.key]?.suggestion ? null : path.get(e.key) ?? null, played: chordStaff ? playedFor(mv, chordStaff, e.sym, e.mi) : undefined }),
  }));
}

function writeOverride(doc, el, key, patch) {
  const all = { ...(getProperty(el, PID.DIAGRAM_OVERRIDES) ?? {}) };
  const next = { ...(all[key] ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  if (Object.keys(next).length) all[key] = next; else delete all[key];
  if (Object.keys(all).length) doc.set(el, PID.DIAGRAM_OVERRIDES, all); else if (getProperty(el, PID.DIAGRAM_OVERRIDES)) doc.reset(el, PID.DIAGRAM_OVERRIDES);
}

// ---------- edits (inside doc.transaction) ----------

/** The user fingers THIS diagram by hand. */
export function setDiagramVoicing(doc, el, voicing, key = null) {
  const v = createVoicing(voicing); // validates
  if (key) writeOverride(doc, el, key, { voicing: v });
  else doc.set(el, PID.VOICING, v);
}

// ---------- the look of the diagrams of chord symbols / chords: each one its own, else the movement's default ----------

/** A chord symbol or a chord of notes: the hosts whose diagram follows the movement's defaults (a diagram container has its own settings only). */
const isHost = (el) => el.type === 'chordsymbol' || el.type === 'chord';
const ownValue = (el, pid) => Object.hasOwn(el.props, pid);

/** The movement's default look as a lookup: `style(SID.X)` → value (layers = the movement's style object). */
export const styleLookup = (...layers) => (sid) => resolveStyle(sid, layers.filter(Boolean));

/** What a diagram is drawn with: its own value, else the movement's default. `style` = `styleLookup(...)` or the layout's `ctx.style`. */
export function diagramLook(el, style) {
  const own = (pid, sidName, fallback) => (ownValue(el, pid) && el.props[pid] !== null ? el.props[pid] : style(sidName) ?? fallback);
  return {
    scale: own(PID.DIAGRAM_SCALE, SID.DIAGRAM_SCALE, 1),
    lift: own(PID.DIAGRAM_LIFT, SID.DIAGRAM_LIFT, 0.5),
    orientation: own(PID.DIAGRAM_ORIENTATION, SID.DIAGRAM_ORIENTATION, 'horizontal'),
    gauge: own(PID.DIAGRAM_GAUGE, SID.DIAGRAM_GAUGE, true) !== false,
    color: getProperty(el, PID.COLOR) ?? (style(SID.DIAGRAM_DOT_COLOR) || null),
  };
}

/** Writes `value` on `pid` of a host unless it equals the movement's default (then the diagram just follows the default). */
function setLook(doc, el, pid, value, sidName) {
  const dflt = resolveStyle(sidName, [doc.movementOf(el)?.style].filter(Boolean));
  if (value === dflt) { if (ownValue(el, pid)) doc.reset(el, pid); } else doc.set(el, pid, value);
}

/** The size of the diagram of a chord symbol / chord. */
export function setDiagramScale(doc, el, scale) { setLook(doc, el, PID.DIAGRAM_SCALE, scale, SID.DIAGRAM_SCALE); }

/** A piano diagram lies horizontally or stands vertically. */
export function setDiagramOrientation(doc, el, orientation) {
  if (orientation !== 'horizontal' && orientation !== 'vertical') throw new RangeError(`orientation ${orientation}`);
  if (isHost(el)) { setLook(doc, el, PID.DIAGRAM_ORIENTATION, orientation, SID.DIAGRAM_ORIENTATION); return; }
  if (orientation === 'horizontal') { if (getProperty(el, PID.DIAGRAM_ORIENTATION) !== 'horizontal') doc.reset(el, PID.DIAGRAM_ORIENTATION); } else doc.set(el, PID.DIAGRAM_ORIENTATION, 'vertical');
}

/** Thick lines for the low strings on / off (default on: only the off state is stored). */
export function setDiagramGauge(doc, el, on) {
  if (isHost(el)) { setLook(doc, el, PID.DIAGRAM_GAUGE, on, SID.DIAGRAM_GAUGE); return; }
  if (on) { if (getProperty(el, PID.DIAGRAM_GAUGE) === false) doc.reset(el, PID.DIAGRAM_GAUGE); } else doc.set(el, PID.DIAGRAM_GAUGE, false);
}

/** Back to the suggestion (and the work's preference, if any). */
export function resetDiagramVoicing(doc, el, key = null) {
  if (key) writeOverride(doc, el, key, { voicing: undefined });
  else doc.reset(el, PID.VOICING);
}

/** Choose another suggestion (0 = the best). Forgets a hand-made voicing. */
export function setDiagramSuggestion(doc, el, index, key = null) {
  if (!Number.isInteger(index) || index < 0 || index > 99) throw new RangeError('suggestion index');
  if (key) { writeOverride(doc, el, key, { voicing: undefined, suggestion: index || undefined }); return; }
  if (getProperty(el, PID.VOICING)) doc.reset(el, PID.VOICING);
  doc.set(el, PID.DIAGRAM_SUGGESTION, index);
}

/** Height of a symbol's diagram above it; null = back to the movement's setting. */
export function setDiagramLift(doc, sym, lift) {
  if (lift === null) { if (getProperty(sym, PID.DIAGRAM_LIFT) !== null) doc.reset(sym, PID.DIAGRAM_LIFT); return; }
  if (!(lift >= 0 && lift <= 20)) throw new RangeError('lift 0..20');
  doc.set(sym, PID.DIAGRAM_LIFT, Math.round(lift * 100) / 100);
}

/** Switches the path of least movement on / off for ONE chord symbol (default on: only off is stored): off = the fingering the chord would have on its own. */
export function setSymbolSolver(doc, sym, on) {
  if (on) { if (getProperty(sym, PID.DIAGRAM_SOLVER) === false) doc.reset(sym, PID.DIAGRAM_SOLVER); } else doc.set(sym, PID.DIAGRAM_SOLVER, false);
}

/** Shows / hides the diagram of a chord symbol or of a chord of notes. */
export function setSymbolDiagramShown(doc, sym, on) {
  if (on) doc.set(sym, PID.DIAGRAM_SHOWN, true); else if (getProperty(sym, PID.DIAGRAM_SHOWN)) doc.reset(sym, PID.DIAGRAM_SHOWN);
  if (sym.type !== 'chord') return;
  // a chord of a tablature that draws its diagrams by itself: removing one hides it, showing it again brings it back
  const staff = doc.parentOf(doc.parentOf(doc.parentOf(sym.id)?.id)?.id);
  if (on) { if (getProperty(sym, PID.DIAGRAM_HIDDEN)) doc.reset(sym, PID.DIAGRAM_HIDDEN); } else if (staff && getProperty(staff, PID.STAFF_TYPE) === 'tab' && (getProperty(staff, PID.TAB_DIAGRAMS) ?? 'off') !== 'off' && !getProperty(sym, PID.DIAGRAM_HIDDEN)) doc.set(sym, PID.DIAGRAM_HIDDEN, true);
}

export function setDiagramChord(doc, el, chord) {
  const problems = validateDiagramChord(chord);
  if (problems.length || !chord) throw new RangeError(problems[0] ?? 'chord needed');
  doc.set(el, PID.DIAGRAM_CHORD, { root: { step: chord.root.step, alter: chord.root.alter ?? 0 }, quality: chord.quality ?? '', bass: chord.bass ? { step: chord.bass.step, alter: chord.bass.alter ?? 0 } : null });
}

export function setDiagramInstrument(doc, el, instrument) {
  if (!DIAGRAM_INSTRUMENTS.includes(instrument)) throw new RangeError(`instrument ${instrument}`);
  if (isApplicable(el.type, PID.VOICING) && getProperty(el, PID.VOICING)) doc.reset(el, PID.VOICING); // a guitar fingering is not a ukulele one
  if (isApplicable(el.type, PID.DIAGRAM_OVERRIDES) && getProperty(el, PID.DIAGRAM_OVERRIDES)) doc.reset(el, PID.DIAGRAM_OVERRIDES);
  doc.set(el, PID.DIAGRAM_INSTRUMENT, instrument);
}

/** "Use this fingering for every occurrence of this chord": records it as the work's preference for the chord and instrument. */
export function setPreferredVoicing(doc, work, chord, voicing, dict) {
  const spec = chordSpecFromSymbol(chord, dict);
  if (!spec) throw new RangeError('unknown chord quality');
  const v = createVoicing(voicing);
  const key = chordKey(spec, v.instrument, voicingTuning(v) ?? []);
  doc.set(work, PID.PREFERRED_VOICINGS, { ...(getProperty(work, PID.PREFERRED_VOICINGS) ?? {}), [key]: v });
}

/** Forget the work's preference for a chord. */
export function clearPreferredVoicing(doc, work, chord, instrument, dict) {
  const spec = chordSpecFromSymbol(chord, dict);
  if (!spec) return;
  const key = chordKey(spec, instrument, tuningOfInstrument(instrument));
  const all = { ...(getProperty(work, PID.PREFERRED_VOICINGS) ?? {}) };
  if (!(key in all)) return;
  delete all[key];
  if (Object.keys(all).length) doc.set(work, PID.PREFERRED_VOICINGS, all);
  else doc.reset(work, PID.PREFERRED_VOICINGS);
}

/** Do two diagrams of the same chord show the same fingering? (used to tell "edited" from "unchanged") */
export const sameDiagramVoicing = (a, b) => Boolean(a && b && sameVoicing(a, b));

// ---------- "apply to all": the look of one diagram for the others, and the movement's default ----------

/** The settings "apply to all" can copy. */
export const LOOK_KEYS = Object.freeze(['scale', 'lift', 'orientation', 'gauge', 'color']);
const LOOK_PID = { scale: PID.DIAGRAM_SCALE, lift: PID.DIAGRAM_LIFT, orientation: PID.DIAGRAM_ORIENTATION, gauge: PID.DIAGRAM_GAUGE, color: PID.COLOR };
const LOOK_SID = { scale: SID.DIAGRAM_SCALE, lift: SID.DIAGRAM_LIFT, orientation: SID.DIAGRAM_ORIENTATION, gauge: SID.DIAGRAM_GAUGE };

/**
 * The chord symbols and chords of notes of a movement that carry (or can carry) a diagram: [{ el, staff }].
 * `shownOnly` keeps those that show one; `staffId` those of one staff; `instrument` those drawn for one instrument.
 */
export function diagramHostsIn(mv, { shownOnly = true, staffId = null, instrument = null } = {}) {
  const out = [];
  for (const track of mv.tracks) {
    for (const staff of track.staves) {
      if (staffId && staff.id !== staffId) continue;
      walk(staff, (el) => {
        if (!isHost(el)) return;
        if (el.type === 'chordsymbol' && (getProperty(el, PID.CHORD_SPECIAL) ?? 'none') !== 'none') return;
        if (shownOnly && !getProperty(el, PID.DIAGRAM_SHOWN)) return;
        if (instrument && getProperty(el, PID.DIAGRAM_INSTRUMENT) !== instrument) return;
        out.push({ el, staff });
      });
    }
  }
  return out;
}

/**
 * Copies the look of the diagram `source` (the settings in `keys`) to the other diagrams. Call inside a transaction.
 * scope 'movement' (every instrument): the look becomes the movement's DEFAULT, and the diagrams' own values for those settings are removed so they follow it
 * (diagrams added later follow it too). scope 'staff' (the chord staff of `source`) or `sameInstrument`: the values are written on each diagram, the movement's default is left alone.
 * The fingering written by hand is never copied. Returns the number of diagrams changed.
 */
export function applyDiagramLook(doc, mv, source, { keys = LOOK_KEYS, scope = 'movement', staffId = null, sameInstrument = false } = {}) {
  const chosen = LOOK_KEYS.filter((k) => keys.includes(k));
  const look = diagramLook(source, styleLookup(mv.style));
  const asDefault = scope === 'movement' && !sameInstrument;
  const instrument = sameInstrument ? getProperty(source, PID.DIAGRAM_INSTRUMENT) : null;
  const hosts = diagramHostsIn(mv, { shownOnly: !asDefault, staffId: scope === 'staff' ? staffId : null, instrument });
  if (asDefault) {
    for (const k of chosen) {
      if (k === 'color') { if (look.color) doc.setStyle(mv, SID.DIAGRAM_DOT_COLOR, look.color); else doc.resetStyle(mv, SID.DIAGRAM_DOT_COLOR); } else doc.setStyle(mv, LOOK_SID[k], look[k]);
    }
    for (const { el } of hosts) {
      for (const k of chosen) if (ownValue(el, LOOK_PID[k])) doc.reset(el, LOOK_PID[k]);
    }
    return hosts.filter((h) => getProperty(h.el, PID.DIAGRAM_SHOWN)).length;
  }
  let changed = 0;
  for (const { el } of hosts) {
    if (el === source) continue;
    for (const k of chosen) {
      if (k === 'color') { if (look.color) doc.set(el, PID.COLOR, look.color); else if (getProperty(el, PID.COLOR)) doc.reset(el, PID.COLOR); } else setLook(doc, el, LOOK_PID[k], look[k], LOOK_SID[k]);
    }
    changed += 1;
  }
  return changed;
}

// ---------- the fingerings WRITTEN in a tablature staff: a diagram per chord event, and a pool of the distinct ones ----------

/** How many strings a chord of this tablature staff needs to count as a chord (2 = power chords; 2 to 6). */
export function tabDiagramMin(staff) {
  const n = Math.trunc(Number(getProperty(staff, PID.TAB_DIAGRAMS_MIN) ?? 2));
  return Math.min(6, Math.max(2, Number.isFinite(n) ? n : 2));
}

/** Two fingerings of a staff are the same chord when they have the same frets. */
export const fingeringKey = (voicing) => voicing.frets.join(',');

/** The fingering a chord of a tablature staff writes, or null when it plays fewer than `min` strings (a single note is no chord). */
export function tabChordVoicing(staff, chord, min = 2) {
  const v = chordDiagramVoicing(staff, chord, 'guitar');
  if (!v?.frets) return null;
  return v.frets.filter((f) => f >= 0).length >= min ? v : null;
}

/**
 * The chord events of a tablature staff in the measures `from`..`to` (indices), in the order they are written: [{ item, mi, voicing, key }]. A chord with a diagram the user
 * removed (`PID.DIAGRAM_HIDDEN`) is left out.
 */
export function tabChordEvents(staff, { from = 0, to = Infinity, min = tabDiagramMin(staff), mv = null } = {}) {
  const out = [];
  const src = mv && primaryOf(mv, staff) ? projectLinkedStaff(mv, staff) : staff; // a linked tablature stores nothing: read its projection
  for (const voice of src.voices) {
    voice.measures.forEach((m, mi) => {
      if (mi < from || mi > to) return;
      for (const it of m?.items ?? []) {
        if (it.type !== 'chord' || getProperty(it, PID.DIAGRAM_HIDDEN)) continue;
        const voicing = tabChordVoicing(src, it, min);
        if (voicing) out.push({ item: it, mi, voicing, key: fingeringKey(voicing) });
      }
    });
  }
  return out.sort((a, b) => a.mi - b.mi);
}

/** The tablature staff a diagram list reads: the one it names, else the first tablature of the movement (null when there is none). */
export function listTabStaff(mv, container) {
  const staves = mv.tracks.flatMap((t) => t.staves).filter((s) => getProperty(s, PID.STAFF_TYPE) === 'tab');
  const id = getProperty(container, PID.DIAGRAM_LIST_STAFF);
  return staves.find((s) => s.id === id) ?? staves[0] ?? null;
}

/** The pool of a tablature staff: [{ item, mi, voicing, key }] over the measures `first`..`last`, each distinct fingering once (`unique`) or every event. */
export function tabPool(staff, { first = 0, last = Infinity, unique = true, mv = null } = {}) {
  const seen = new Set();
  return tabChordEvents(staff, { from: first, to: last, mv }).filter((e) => { if (!unique) return true; if (seen.has(e.key)) return false; seen.add(e.key); return true; });
}
