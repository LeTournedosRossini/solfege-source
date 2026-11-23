/*
 * A LAYER of fingerings (model/voicingpools.js) made from what the piece already shows, instead of chosen chord by chord:
 *  - `chordsFromTab`: the fingerings a TABLATURE plays under the chord symbols (the same reading as the diagrams above a chord staff: `playedVoicing`);
 *  - `chordsFromChordStaff`: the fingerings the diagrams SHOWN above the symbols of a chord staff are drawn with (the symbol's own fingering, the tablature it reads,
 *    the path of least movement, the work's preferred one…).
 * Both give entries `{ key, chord, voicings: [{ voicing, count }] }` — the chord key of the pools, one chord, and the distinct fingerings found for it, the most frequent
 * first. `fillPool` writes them in a layer: the most frequent fingering becomes the layer's fingering of that chord, the others are kept as its ALTERNATIVES
 * (`pool.alternatives[key]`), to step through in the "Chords of the piece" window. A chord with no fingering found gets no entry (it keeps its usual fingering).
 * `chordsFromTabAll` also collects the fingerings the tablature writes that have NO chord symbol: they wait in `pool.unnamed` ([{ voicing, count }]) until the user names them
 * (`nameUnnamed`, the name found by `suggestChordName` is only a proposal), when they join the layer under that chord.
 * The readers are PURE (nothing is written); `fillPool` / `createPoolFrom…` are to be called inside `doc.transaction`.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { createVoicing, voicingTuning } from './fretvoicing.js';
import { chordSpecFromSymbol } from './fretsuggest.js';
import { workChordQualities } from './chordqualityedit.js';
import { chordKey, chordSymbolsInSpan, playedVoicing, tabStaffOf, tabChordEvents, tabDiagramMin, resolveDiagram, chordPathFor, diagramChordOf, playedFor, fingeringKey } from './fretdiagram.js';
import { primaryOf, projectLinkedStaff } from './linkedstaff.js';
import { addPool, poolsOf, effectivePreferred, PoolError, MAIN_POOL } from './voicingpools.js';

const staffsOf = (mv) => mv.tracks.flatMap((t) => t.staves);
const chordStaffOf = (mv, id = null) => staffsOf(mv).find((s) => getProperty(s, PID.STAFF_TYPE) === 'chord' && (!id || s.id === id)) ?? null;

/** The chord staves and tablature staves of the work the layer can be made from: [{ id, name, movementIndex }]. */
export function poolSources(work) {
  const out = { tabs: [], chordStaves: [] };
  work.movements.forEach((mv, movementIndex) => {
    for (const track of mv.tracks) for (const st of track.staves) {
      const type = getProperty(st, PID.STAFF_TYPE);
      const name = getProperty(track, PID.NAME) || '?';
      if (type === 'tab') out.tabs.push({ id: st.id, name, movementIndex });
      else if (type === 'chord') out.chordStaves.push({ id: st.id, name, movementIndex });
    }
  });
  return out;
}

/** Collects `(key, chord, voicing)` triples into entries, the most frequent fingering first (ties: the order of appearance). */
function collect(triples) {
  const byKey = new Map();
  for (const { key, chord, voicing } of triples) {
    let entry = byKey.get(key);
    if (!entry) { entry = { key, chord, voicings: new Map() }; byKey.set(key, entry); }
    const fk = fingeringKey(voicing);
    const hit = entry.voicings.get(fk);
    if (hit) hit.count += 1; else entry.voicings.set(fk, { voicing, count: 1 });
  }
  return [...byKey.values()].map((e) => ({ key: e.key, chord: e.chord, voicings: [...e.voicings.values()].sort((a, b) => b.count - a.count) }));
}

const keyOfVoicing = (spec, voicing) => chordKey(spec, voicing.instrument, voicingTuning(voicing) ?? []);

/**
 * The fingerings a tablature plays under the chord symbols of the piece. `tabStaffId` = the tablature to read (null: the one each chord staff reads — `PID.DIAGRAM_TAB_STAFF` —
 * in each movement). A chord with nothing played under it (fewer than two strings) gives no entry.
 */
export function chordsFromTab(work, { tabStaffId = null } = {}) {
  const dict = workChordQualities(work);
  const triples = [];
  for (const mv of work.movements) {
    if (!mv.masterbars.length) continue;
    const chordStaff = chordStaffOf(mv);
    if (!chordStaff) continue;
    const tab = tabStaffId ? staffsOf(mv).find((s) => s.id === tabStaffId && getProperty(s, PID.STAFF_TYPE) === 'tab') : tabStaffOf(mv, chordStaff);
    if (!tab) continue;
    const readable = primaryOf(mv, tab) ? projectLinkedStaff(mv, tab) : tab; // a tablature linked to a notation staff stores nothing: its projection is read
    if (!Array.isArray(readable?.voices)) continue;
    for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) {
      const spec = chordSpecFromSymbol(e.chord, dict);
      const voicing = spec ? playedVoicing(mv, chordStaff, readable, e.sym, e.mi) : null;
      if (voicing) triples.push({ key: keyOfVoicing(spec, voicing), chord: e.chord, voicing });
    }
  }
  return collect(triples);
}

/**
 * The fingerings the diagrams SHOWN on a chord staff are drawn with (the symbols that have their diagram turned on, `PID.DIAGRAM_SHOWN`), resolved like the layout does.
 * `chordStaffId` null = the first chord staff of each movement.
 */
export function chordsFromChordStaff(work, { chordStaffId = null } = {}) {
  const dict = workChordQualities(work);
  const preferred = effectivePreferred(work, MAIN_POOL);
  const triples = [];
  for (const mv of work.movements) {
    if (!mv.masterbars.length) continue;
    const staff = chordStaffOf(mv, chordStaffId);
    if (!staff) continue;
    const paths = new Map();
    const pathOf = (instrument) => { if (!paths.has(instrument)) paths.set(instrument, chordPathFor(mv, instrument, { preferred, dict })); return paths.get(instrument); };
    for (const e of chordSymbolsInSpan(mv, mv.masterbars[0].id, mv.masterbars.length)) {
      if (!getProperty(e.sym, PID.DIAGRAM_SHOWN)) continue;
      const chord = diagramChordOf(e.sym);
      const instrument = getProperty(e.sym, PID.DIAGRAM_INSTRUMENT) ?? 'guitar';
      const res = resolveDiagram({
        voicing: getProperty(e.sym, PID.VOICING), chord, instrument, index: getProperty(e.sym, PID.DIAGRAM_SUGGESTION) ?? 0,
        preferred, dict, pathVoicing: pathOf(instrument).get(e.key) ?? null, played: playedFor(mv, staff, e.sym, e.mi),
      });
      if (res?.voicing && res.spec) triples.push({ key: keyOfVoicing(res.spec, res.voicing), chord, voicing: res.voicing });
    }
  }
  return collect(triples);
}


/**
 * EVERY chord the tablature writes: `entries` are the ones under a chord symbol (as `chordsFromTab`), `unnamed` the other distinct fingerings ([{ voicing, count }], the most
 * frequent first) — what the tablature plays where the piece names no chord. `tabStaffId` null = the tablature each chord staff reads, else the first one of the movement.
 */
export function chordsFromTabAll(work, { tabStaffId = null } = {}) {
  const entries = chordsFromTab(work, { tabStaffId });
  const named = new Set(entries.flatMap((e) => e.voicings.map((v) => fingeringKey(v.voicing))));
  const counts = new Map();
  for (const mv of work.movements) {
    if (!mv.masterbars.length) continue;
    const all = staffsOf(mv).filter((s) => getProperty(s, PID.STAFF_TYPE) === 'tab');
    const chordStaff = chordStaffOf(mv);
    const staff = tabStaffId ? all.find((s) => s.id === tabStaffId) : (chordStaff && tabStaffOf(mv, chordStaff)) || all[0];
    if (!staff) continue;
    for (const ev of tabChordEvents(staff, { mv })) {
      if (named.has(ev.key)) continue;
      const hit = counts.get(ev.key);
      if (hit) hit.count += 1; else counts.set(ev.key, { voicing: createVoicing(ev.voicing), count: 1 });
    }
  }
  return { entries, unnamed: [...counts.values()].sort((a, b) => b.count - a.count) };
}

/** The chord of a symbol / of a naming, as the layer keeps it: { root: { step, alter }, quality, bass }. */
const cleanChord = (c) => ({ root: { step: c.root.step, alter: c.root.alter ?? 0 }, quality: c.quality ?? '', bass: c.bass ? { step: c.bass.step, alter: c.bass.alter ?? 0 } : null });

/**
 * The chords of a TABLATURE staff whose diagram is SHOWN (`PID.TAB_DIAGRAMS` 'off' | 'first' | 'changes' | 'all', plus the chords the user turned on by hand, `PID.DIAGRAM_SHOWN`;
 * a chord the user removed never shows): [{ item, mi, voicing, key }] over the whole staff, in the order they are written. The same rule as the page, read over the whole
 * piece instead of one system (the "first chord of each system" rule does not apply).
 */
export function shownTabChords(mv, staff) {
  const mode = getProperty(staff, PID.TAB_DIAGRAMS) ?? 'off';
  const events = tabChordEvents(staff, { mv, min: tabDiagramMin(staff) });
  const seen = new Set(); let previous = null;
  return events.filter((e) => {
    const manual = !!getProperty(e.item, PID.DIAGRAM_SHOWN);
    let show = manual;
    if (mode === 'all') show = true;
    else if (mode === 'changes') show = show || e.key !== previous;
    else if (mode === 'first') show = show || !seen.has(e.key);
    previous = e.key; seen.add(e.key);
    return show;
  });
}

/**
 * The fingerings of the diagrams shown on a tablature staff (`tabStaffId`, else the first tablature with diagrams of each movement): `entries` are the ones that also sit under a
 * chord symbol (named), `unnamed` the others, waiting for a name. Same shape as `chordsFromTabAll`.
 */
export function chordsFromTabDiagrams(work, { tabStaffId = null } = {}) {
  const shown = new Map();
  for (const mv of work.movements) {
    if (!mv.masterbars.length) continue;
    const tabs = staffsOf(mv).filter((s) => getProperty(s, PID.STAFF_TYPE) === 'tab');
    const staff = tabStaffId ? tabs.find((s) => s.id === tabStaffId) : tabs.find((s) => shownTabChords(mv, s).length);
    if (!staff) continue;
    for (const e of shownTabChords(mv, staff)) {
      const hit = shown.get(e.key);
      if (hit) hit.count += 1; else shown.set(e.key, { voicing: createVoicing(e.voicing), count: 1 });
    }
  }
  // the ones a chord symbol names: the fingering the tablature plays under it (the same staff), kept only when it is one of the shown fingerings
  const named = chordsFromTab(work, { tabStaffId }).map((e) => ({ ...e, voicings: e.voicings.filter((v) => shown.has(fingeringKey(v.voicing))) })).filter((e) => e.voicings.length);
  const used = new Set(named.flatMap((e) => e.voicings.map((v) => fingeringKey(v.voicing))));
  return { entries: named, unnamed: [...shown.entries()].filter(([k]) => !used.has(k)).map(([, v]) => v).sort((a, b) => b.count - a.count) };
}

const knownKeys = (pool) => new Set([...Object.values(pool.voicings ?? {}), ...Object.values(pool.alternatives ?? {}).flat()].map(fingeringKey));

/**
 * Writes entries in a layer. `mode` 'replace' empties it first, 'complete' only adds the chords it has no fingering for. The most frequent fingering of a chord is the layer's;
 * the others are its alternatives. Returns { written, kept } (chords written, chords left as they were).
 */
export function fillPool(doc, work, poolId, entries, { mode = 'replace', unnamed = [] } = {}) {
  const pool = poolsOf(work).find((p) => p.id === poolId);
  if (!pool) throw new PoolError('Unknown layer', 'unknown');
  const voicings = mode === 'replace' ? {} : { ...(pool.voicings ?? {}) };
  const alternatives = mode === 'replace' ? {} : { ...(pool.alternatives ?? {}) };
  const names = mode === 'replace' ? {} : { ...(pool.names ?? {}) }; // the chord each fingering of the layer is for (so a chord that is not in the piece can be listed)
  let written = 0; let kept = 0;
  for (const e of entries) {
    if (!e.voicings.length) continue;
    if (mode === 'complete' && e.key in voicings) { kept += 1; continue; }
    voicings[e.key] = createVoicing(e.voicings[0].voicing);
    names[e.key] = cleanChord(e.chord);
    if (e.voicings.length > 1) alternatives[e.key] = e.voicings.slice(1).map((v) => createVoicing(v.voicing)); else delete alternatives[e.key];
    written += 1;
  }
  // the fingerings waiting for a name: the new ones (those already in the layer, named, are not waiting), kept in `complete` mode
  const waiting = mode === 'replace' ? [] : [...(pool.unnamed ?? [])];
  const known = knownKeys({ voicings, alternatives });
  for (const u of unnamed) { const k = fingeringKey(u.voicing); if (known.has(k) || waiting.some((w) => fingeringKey(w.voicing) === k)) continue; waiting.push({ voicing: createVoicing(u.voicing), count: u.count }); }
  const list = poolsOf(work).map((p) => {
    if (p.id !== poolId) return p;
    const next = { ...p, voicings };
    if (Object.keys(alternatives).length) next.alternatives = alternatives; else delete next.alternatives;
    if (Object.keys(names).length) next.names = names; else delete next.names;
    if (waiting.length) next.unnamed = waiting; else delete next.unnamed;
    return next;
  });
  doc.set(work, PID.VOICING_POOLS, list);
  return { written, kept, waiting: waiting.length };
}

/** A new layer called `name`, filled with the entries (and the fingerings waiting for a name). Returns { pool, written, waiting }. */
export function createPoolFrom(doc, work, name, entries, { unnamed = [] } = {}) {
  const pool = addPool(doc, work, name);
  const { written, waiting } = fillPool(doc, work, pool.id, entries, { mode: 'replace', unnamed });
  return { pool, written, waiting };
}

/**
 * Gives a name to a fingering that waits in a layer (`fingeringKey` of the fingering): it leaves the waiting list and becomes the layer's fingering of that chord — or one of
 * its alternatives when the chord already has one. `chord` = { root: { step, alter }, quality, bass }.
 */
export function nameUnnamed(doc, work, poolId, fkey, chord, dict = workChordQualities(work)) {
  const pool = poolsOf(work).find((p) => p.id === poolId);
  if (!pool) throw new PoolError('Unknown layer', 'unknown');
  const waiting = pool.unnamed ?? [];
  const found = waiting.find((u) => fingeringKey(u.voicing) === fkey);
  if (!found) throw new PoolError('That fingering is no longer waiting', 'unknown');
  const spec = chordSpecFromSymbol(chord, dict);
  if (!spec) throw new PoolError('unknown chord quality', 'chord');
  const key = keyOfVoicing(spec, found.voicing);
  const voicings = { ...(pool.voicings ?? {}) }; const alternatives = { ...(pool.alternatives ?? {}) };
  if (!(key in voicings)) voicings[key] = createVoicing(found.voicing);
  else if (fingeringKey(voicings[key]) !== fkey && !(alternatives[key] ?? []).some((v) => fingeringKey(v) === fkey)) alternatives[key] = [...(alternatives[key] ?? []), createVoicing(found.voicing)];
  const rest = waiting.filter((u) => u !== found);
  const next = { ...pool, voicings, names: { ...(pool.names ?? {}), [key]: cleanChord(chord) } };
  if (Object.keys(alternatives).length) next.alternatives = alternatives; else delete next.alternatives;
  if (rest.length) next.unnamed = rest; else delete next.unnamed;
  doc.set(work, PID.VOICING_POOLS, poolsOf(work).map((p) => (p.id === poolId ? next : p)));
  return key;
}

/** Forgets a fingering that waits for a name. */
export function discardUnnamed(doc, work, poolId, fkey) {
  const pool = poolsOf(work).find((p) => p.id === poolId);
  if (!pool) throw new PoolError('Unknown layer', 'unknown');
  const rest = (pool.unnamed ?? []).filter((u) => fingeringKey(u.voicing) !== fkey);
  const next = { ...pool };
  if (rest.length) next.unnamed = rest; else delete next.unnamed;
  doc.set(work, PID.VOICING_POOLS, poolsOf(work).map((p) => (p.id === poolId ? next : p)));
}
