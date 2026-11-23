/*
 * Layers ("pools") of preferred fingerings of a work. The MAIN pool is `PID.PREFERRED_VOICINGS` (what "Use everywhere" writes); the others are
 * `PID.VOICING_POOLS` = [{ id, name, voicings: { <key>: voicing }, alternatives?: { <key>: [voicing…] }, rule: null | 'power' | 'easy' }]: an easier set, power chords… A layer only
 * holds what it changes. `alternatives` = the other fingerings found for a chord when the layer was made from a tablature (model/voicingpoolfrom.js), to step through;
 * `unnamed` = [{ voicing, count }], fingerings of the tablature that have no chord name yet (they join the layer when the user names them); `names` = { <key>: chord } the
 * chord each fingering of the layer was made / named for (lists a chord of the layer that the piece does not write); `hidden` = { <key>: [variantId…] } the alternatives switched
 * OFF (kept, not shown by the diagram lists); `tags` = { <key>: { <variantId>: [label…] } } the labels the user gave each fingering, `labelOrder` = the labels in the order of
 * the groups of a list grouped by label; `rank` = { <label in lower case>: [`${key}|${variantId}`…] } the order the user ranked the fingerings of a group in.
 *
 * What a part / zone shows from a layer is the EFFECTIVE preferred map of that layer: `{ ...main, ...layer.voicings }` — an object of the same shape as
 * the main map, so everything that already takes a `preferred` map (layouts, playback, MusicXML) takes it as is. A layer with a `rule` carries it hidden
 * (`POOL_RULE`) and `resolveDiagram` applies it to the chords the layer does not set itself, BEFORE the main pool: with the rule 'power' every chord that
 * the layer has no fingering for is shown as a power chord (root, fifth, octave). To be called inside `doc.transaction` for the edits.
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { newId } from './ids.js';
import { createVoicing, voicingTuning, validateVoicing } from './fretvoicing.js';
import { chordSpecFromSymbol } from './fretsuggest.js';
import { chordKey, tuningOfInstrument } from './fretdiagram.js';
import { POOL_RULE, POOL_RULES, POOL_ALTERNATIVES, POOL_SOURCE, powerChordVoicing, easyPowerVoicing, ruleVoicing, ruleOf } from './voicingrule.js';

export const MAIN_POOL = 'main';
export { POOL_RULE, POOL_RULES, POOL_ALTERNATIVES, POOL_SOURCE, powerChordVoicing, easyPowerVoicing, ruleVoicing, ruleOf };

export class PoolError extends Error { constructor(message, code = 'invalid') { super(message); this.name = 'PoolError'; this.code = code; } }

/** The layers of a work (the main pool is not one of them; neither are the built-in ones). */
export const poolsOf = (work) => getProperty(work, PID.VOICING_POOLS) ?? [];

/**
 * The BUILT-IN layers, part of the software and never written in a file: « Easy PC » = the two-note power chords on the low E / A strings, whatever the
 * quality of the chord (`easyPowerVoicing`). They have a rule and no fingering of their own, so a fingering written by hand on a chord still wins.
 */
export const EASY_POOL_ID = 'easy-pc';
export const BUILTIN_POOLS = Object.freeze([Object.freeze({ id: EASY_POOL_ID, name: 'Easy PC', rule: 'easy', voicings: Object.freeze({}), builtin: true })]);
/** The built-in layers, then the ones of the work. */
export const allPoolsOf = (work) => [...BUILTIN_POOLS, ...poolsOf(work)];

/** The alternative fingerings of a layer that are switched ON, { <chord key>: [voicing…] }: all of them, but the ones listed in `pool.hidden[key]` (the `fingeringKey`s the user switched off). */
export function activeAlternatives(pool) {
  const out = {};
  for (const [key, list] of Object.entries(pool?.alternatives ?? {})) {
    const off = new Set(pool.hidden?.[key] ?? []);
    const on = list.filter((v) => !off.has(variantId(v)));
    if (on.length) out[key] = on;
  }
  return out;
}
/** Identity of a fingering inside a layer (its frets, or its keys for a piano). */
export const variantId = (v) => (v.frets ? v.frets.join(',') : `p${(v.notes ?? []).join(',')}`);

/** Effective preferred map of a layer (null / 'main' / unknown id = the main pool as it is). */
export function effectivePreferred(work, poolId = null) {
  const main = getProperty(work, PID.PREFERRED_VOICINGS) ?? null;
  const pool = poolId && poolId !== MAIN_POOL ? allPoolsOf(work).find((p) => p.id === poolId) : null;
  if (!pool) return main;
  const map = { ...(main ?? {}), ...(pool.voicings ?? {}) };
  Object.defineProperty(map, POOL_SOURCE, { value: pool, enumerable: false });
  const alts = activeAlternatives(pool);
  if (Object.keys(alts).length) Object.defineProperty(map, POOL_ALTERNATIVES, { value: alts, enumerable: false });
  if (pool.rule) Object.defineProperty(map, POOL_RULE, { value: { rule: pool.rule, own: new Set(Object.keys(pool.voicings ?? {})) }, enumerable: false });
  return map;
}

/** Display name of a layer (the main pool is called by the interface). */
export const poolName = (work, poolId) => allPoolsOf(work).find((p) => p.id === poolId)?.name ?? null;

// ---------- reading the layer a map comes from ----------

// ---------- edits ----------

const writePools = (doc, work, list) => { if (list.length) doc.set(work, PID.VOICING_POOLS, list); else doc.reset(work, PID.VOICING_POOLS); };
const cleanName = (name) => String(name ?? '').trim().slice(0, 40);

/** A new empty layer; returns it. */
export function addPool(doc, work, name) {
  const text = cleanName(name);
  if (!text) throw new PoolError('A layer needs a name', 'name');
  const pool = { id: newId('vp'), name: text, voicings: {}, rule: null };
  writePools(doc, work, [...poolsOf(work), pool]);
  return pool;
}

function mutate(doc, work, poolId, fn) {
  const list = poolsOf(work);
  const at = list.findIndex((p) => p.id === poolId);
  if (at < 0) throw new PoolError('Unknown layer', 'unknown');
  const next = fn({ ...list[at], voicings: { ...(list[at].voicings ?? {}) } });
  writePools(doc, work, list.map((p, i) => (i === at ? next : p)));
  return next;
}

export const renamePool = (doc, work, poolId, name) => {
  const text = cleanName(name);
  if (!text) throw new PoolError('A layer needs a name', 'name');
  return mutate(doc, work, poolId, (p) => ({ ...p, name: text }));
};

export const setPoolRule = (doc, work, poolId, rule) => {
  if (rule !== null && !POOL_RULES.includes(rule)) throw new PoolError(`Unknown rule: ${rule}`, 'rule');
  return mutate(doc, work, poolId, (p) => ({ ...p, rule }));
};

/** Removes a layer; the parts and zones that showed it go back to the main pool (they are reset here: a layer that no longer exists is never read). */
export function removePool(doc, work, poolId) {
  const list = poolsOf(work);
  if (!list.some((p) => p.id === poolId)) throw new PoolError('Unknown layer', 'unknown');
  writePools(doc, work, list.filter((p) => p.id !== poolId));
  for (const part of work.parts ?? []) {
    if (getProperty(part, PID.PART_VOICING_POOL) === poolId) doc.reset(part, PID.PART_VOICING_POOL);
    for (const c of part.containers ?? []) if (getProperty(c, PID.DIAGRAM_LIST_POOL) === poolId) doc.reset(c, PID.DIAGRAM_LIST_POOL);
  }
}

const keyOf = (chord, voicing, dict) => {
  const spec = chordSpecFromSymbol(chord, dict);
  if (!spec) throw new PoolError('unknown chord quality', 'chord');
  return chordKey(spec, voicing.instrument, voicingTuning(voicing) ?? []);
};

/** Sets the fingering of a chord in a layer (poolId null / 'main' = the main pool). */
export function setPoolVoicing(doc, work, poolId, chord, voicing, dict) {
  const v = createVoicing(voicing);
  const key = keyOf(chord, v, dict);
  if (!poolId || poolId === MAIN_POOL) { doc.set(work, PID.PREFERRED_VOICINGS, { ...(getProperty(work, PID.PREFERRED_VOICINGS) ?? {}), [key]: v }); return; }
  mutate(doc, work, poolId, (p) => { p.voicings[key] = v; return p; });
}

/** Forgets the fingering a layer sets for a chord (the layer then falls back to the main pool and the suggestions). */
export function clearPoolVoicing(doc, work, poolId, chord, instrument, dict) {
  const spec = chordSpecFromSymbol(chord, dict);
  if (!spec) return;
  const key = chordKey(spec, instrument, tuningOfInstrument(instrument));
  if (!poolId || poolId === MAIN_POOL) {
    const all = { ...(getProperty(work, PID.PREFERRED_VOICINGS) ?? {}) };
    if (!(key in all)) return;
    delete all[key];
    if (Object.keys(all).length) doc.set(work, PID.PREFERRED_VOICINGS, all); else doc.reset(work, PID.PREFERRED_VOICINGS);
    return;
  }
  const pool = poolsOf(work).find((p) => p.id === poolId);
  if (!pool || !(key in (pool.voicings ?? {}))) return;
  mutate(doc, work, poolId, (p) => { delete p.voicings[key]; if (p.alternatives) { const rest = { ...p.alternatives }; delete rest[key]; if (Object.keys(rest).length) p.alternatives = rest; else delete p.alternatives; } if (p.names) { const rest = { ...p.names }; delete rest[key]; if (Object.keys(rest).length) p.names = rest; else delete p.names; } if (p.hidden) { const rest = { ...p.hidden }; delete rest[key]; if (Object.keys(rest).length) p.hidden = rest; else delete p.hidden; } if (p.tags) { const rest = { ...p.tags }; delete rest[key]; if (Object.keys(rest).length) p.tags = rest; else delete p.tags; } return p; });
}

export const MAX_LABELS_PER_FINGERING = 8;
export const MAX_LABEL_LENGTH = 30;
const cleanLabels = (labels) => {
  const out = [];
  for (const raw of labels ?? []) { const t = String(raw ?? '').trim().slice(0, MAX_LABEL_LENGTH); if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); }
  if (out.length > MAX_LABELS_PER_FINGERING) throw new PoolError(`At most ${MAX_LABELS_PER_FINGERING} labels per fingering`, 'labels');
  return out;
};

/**
 * Sets the LABELS of one fingering of a chord in a layer (its main fingering or one of its alternatives; `vid` = `variantId`): free names such as « Couplet » or « Refrain »
 * the user gives, that a diagram list grouped by label uses instead of the sections of the form. `pool.tags` = { <chord key>: { <variantId>: [label…] } }; `pool.labelOrder` keeps the
 * labels in the order they were first given (the order of the groups of a list), and forgets one that nothing uses any more.
 */
export function setVariantLabels(doc, work, poolId, key, vid, labels) {
  const clean = cleanLabels(labels);
  mutate(doc, work, poolId, (p) => {
    const ids = [p.voicings?.[key], ...(p.alternatives?.[key] ?? [])].filter(Boolean).map(variantId);
    if (!ids.includes(vid)) throw new PoolError('Unknown fingering', 'unknown');
    const tags = { ...(p.tags ?? {}) };
    const mine = { ...(tags[key] ?? {}) };
    if (clean.length) mine[vid] = clean; else delete mine[vid];
    if (Object.keys(mine).length) tags[key] = mine; else delete tags[key];
    if (Object.keys(tags).length) p.tags = tags; else delete p.tags;
    const used = new Set(Object.values(p.tags ?? {}).flatMap((m) => Object.values(m).flat()).map((l) => l.toLowerCase()));
    const order = (p.labelOrder ?? []).filter((l) => used.has(l.toLowerCase()));
    for (const l of clean) if (!order.some((x) => x.toLowerCase() === l.toLowerCase())) order.push(l);
    if (order.length) p.labelOrder = order; else delete p.labelOrder;
    return p;
  });
}

/** The fingerings of a layer that carry labels (main ones and ACTIVE alternatives): [{ key, vid, voicing, main, labels }]. */
export function labelledFingerings(pool) {
  const out = [];
  const off = pool.hidden ?? {};
  for (const [key, mine] of Object.entries(pool.tags ?? {})) {
    const main = pool.voicings?.[key];
    for (const [vid, labels] of Object.entries(mine)) {
      if (main && variantId(main) === vid) { out.push({ key, vid, ref: `${key}|${vid}`, voicing: main, main: true, labels }); continue; }
      const alt = (pool.alternatives?.[key] ?? []).find((v) => variantId(v) === vid);
      if (alt && !(off[key] ?? []).includes(vid)) out.push({ key, vid, ref: `${key}|${vid}`, voicing: alt, main: false, labels });
    }
  }
  return out;
}

/** The fingerings that carry a label, in the order a list shows them in that group: the user's ranking first (`pool.rank`), then the rest in a steady order. */
export function groupMembers(pool, label) {
  const lower = String(label).toLowerCase();
  const rank = pool.rank?.[lower] ?? [];
  const mine = labelledFingerings(pool).filter((t) => t.labels.some((l) => l.toLowerCase() === lower));
  const at = (t) => { const i = rank.indexOf(t.ref); return i < 0 ? 1e6 : i; };
  return mine.map((t, i) => ({ t, i })).sort((a, b) => at(a.t) - at(b.t) || a.i - b.i).map((x) => x.t);
}

/** Moves a fingering one place earlier (`delta` -1) or later (+1) inside a group (`label`) of a layer: it is shown earlier / later in a list grouped by label. `ref` = `${key}|${variantId}`. */
export function moveInGroup(doc, work, poolId, label, ref, delta) {
  mutate(doc, work, poolId, (p) => {
    const members = groupMembers(p, label).map((t) => t.ref);
    const from = members.indexOf(ref);
    if (from < 0) throw new PoolError('Unknown fingering in this group', 'unknown');
    const to = Math.min(members.length - 1, Math.max(0, from + delta));
    members.splice(to, 0, members.splice(from, 1)[0]);
    p.rank = { ...(p.rank ?? {}), [String(label).toLowerCase()]: members };
    return p;
  });
}

/**
 * Switches one alternative fingering of a chord ON or OFF in a layer (an alternative that is off is kept but not shown by the lists). `fkey` = `variantId` of the fingering.
 */
export function setVariantActive(doc, work, poolId, key, fkey, on) {
  mutate(doc, work, poolId, (p) => {
    if (!(p.alternatives?.[key] ?? []).some((v) => variantId(v) === fkey)) throw new PoolError('Unknown variant', 'unknown');
    const off = new Set(p.hidden?.[key] ?? []);
    if (on) off.delete(fkey); else off.add(fkey);
    const hidden = { ...(p.hidden ?? {}) };
    if (off.size) hidden[key] = [...off]; else delete hidden[key];
    if (Object.keys(hidden).length) p.hidden = hidden; else delete p.hidden;
    return p;
  });
}

/** Makes an alternative the MAIN fingering of its chord in the layer (the main one takes its place among the alternatives). */
export function setPoolMain(doc, work, poolId, key, fkey) {
  mutate(doc, work, poolId, (p) => {
    const list = [...(p.alternatives?.[key] ?? [])];
    const at = list.findIndex((v) => variantId(v) === fkey);
    if (at < 0) throw new PoolError('Unknown variant', 'unknown');
    const [chosen] = list.splice(at, 1);
    const old = p.voicings[key];
    p.voicings[key] = chosen;
    p.alternatives = { ...(p.alternatives ?? {}), [key]: old ? [old, ...list] : list };
    if (p.hidden?.[key]) { const hidden = { ...p.hidden }; hidden[key] = hidden[key].filter((k) => k !== fkey); if (!hidden[key].length) delete hidden[key]; if (Object.keys(hidden).length) p.hidden = hidden; else delete p.hidden; }
    return p;
  });
}

/** Problems of the layers (for `validateWork`). */
export function validatePools(work) {
  const errors = [];
  const seen = new Set();
  for (const p of poolsOf(work)) {
    if (!p || typeof p.id !== 'string' || !p.id) { errors.push('voicing pool: no id'); continue; }
    if (seen.has(p.id)) errors.push(`voicing pool ${p.id}: duplicate id`);
    seen.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim()) errors.push(`voicing pool ${p.id}: no name`);
    if (p.rule !== null && p.rule !== undefined && !POOL_RULES.includes(p.rule)) errors.push(`voicing pool ${p.id}: unknown rule`);
    for (const [key, v] of Object.entries(p.voicings ?? {})) for (const problem of validateVoicing(v)) errors.push(`voicing pool ${p.id} ${key}: ${problem}`);
    for (const u of p.unnamed ?? []) for (const problem of validateVoicing(u?.voicing ?? {})) errors.push(`voicing pool ${p.id} (to name): ${problem}`);
    for (const [key, byId] of Object.entries(p.tags ?? {})) for (const labels of Object.values(byId ?? {})) if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string' || !l.trim())) errors.push(`voicing pool ${p.id} ${key}: bad labels`);
    for (const [key, list] of Object.entries(p.alternatives ?? {})) { // the other fingerings found for a chord (model/voicingpoolfrom.js)
      if (!Array.isArray(list)) { errors.push(`voicing pool ${p.id} ${key}: alternatives are not a list`); continue; }
      for (const v of list) for (const problem of validateVoicing(v)) errors.push(`voicing pool ${p.id} ${key} (alternative): ${problem}`);
    }
  }
  return errors;
}
