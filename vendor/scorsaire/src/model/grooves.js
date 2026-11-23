// Grooves: the patterns of the automatic player of a DRUM track (model/player.js). PURE.
// A groove is written by ROLE (kick, snare, closed hi-hat, ride, crash, toms…), never by sound: the percussion map of the track (`percmap.js`) says which sound of the kit plays each role, so the
// same groove fits any kit. It lasts 1 to 4 bars of one metre (positions are exact fractions of a whole note, like the chord patterns), and comes with its VARIATIONS:
//   - `fills` (breaks): a part of the bar that replaces the groove from `from` to the end of the bar (a half bar by default: the last two beats of 4/4), each with its own chance;
//   - `extras`: single hits that may be added to the groove (a ghost snare, an extra kick), each with its own chance;
//   - `variants`: OTHER versions of the main groove (a chorus groove, an alternative), same length, each with its name; `variantAt` (audio/drumplay.js) picks the one a bar plays by itself —
//     by section when the piece has sections, else by phrases of 8 bars — unless the score says otherwise. The fills and extras are shared by all the versions;
//   - `crashOnSection`: a crash on the first bar of each section of the form.
// The chances are only a starting point: the player decides with the seed saved in it, the place in the form and the user's rules (`variation.js`), so nothing is random at play time.
// Like the cards and the chord patterns, a groove lives at three levels: built in (this file), the USER's own (device preference `grooves`) and the PROJECT's (`PID.GROOVES`); lookup project > user > built in.
import { PID } from './pid.js';
import { checkBeats, MAX_STEPS } from './beatgrid.js';
import { drumSoundForMidi } from './percmap.js';

export const DRUM_ROLES = Object.freeze(['kick', 'snare', 'sideStick', 'hatClosed', 'hatOpen', 'hatPedal', 'ride', 'rideBell', 'crash', 'splash', 'china', 'tomHigh', 'tomMid', 'tomLow', 'tomFloor', 'cowbell', 'tambourine']);
/** General MIDI numbers that stand for each role, in order of preference (a kit that follows the General MIDI map plays them as they are). */
export const ROLE_MIDI = Object.freeze({
  kick: [36, 35], snare: [38, 40], sideStick: [37], hatClosed: [42], hatOpen: [46], hatPedal: [44], ride: [51, 59], rideBell: [53], crash: [49, 57], splash: [55], china: [52],
  tomHigh: [50, 48], tomMid: [47, 45], tomLow: [45, 43], tomFloor: [43, 41], cowbell: [56], tambourine: [54],
});
export const MAX_BARS = 4;
export const MAX_VARIANTS = 7;
export const DEFAULT_FILL_FROM = Object.freeze([1, 2]);

/** The sound id of a percussion map that plays a role (the first General MIDI number the map has), or null when the kit has no such sound. */
export function soundForRole(percmap, role) {
  for (const midi of ROLE_MIDI[role] ?? []) { const s = drumSoundForMidi(percmap, midi); if (s) return s.id; }
  return null;
}

const isFraction = (x) => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[1] > 0 && x[0] >= 0;
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; };
const reduce = (n, d) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
export const fAdd = (a, b) => reduce(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
export const fSub = (a, b) => reduce(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
export const fCmp = (a, b) => a[0] * b[1] - b[0] * a[1];
const clamp = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

/** A checked hit { at, role, velocity } or null. `velocity` is a factor of the nominal level (1 = as written, 0.5 = a ghost note, 1.15 = an accent). */
function createHit(h, length) {
  if (!isFraction(h?.at) || !DRUM_ROLES.includes(h?.role) || fCmp(h.at, length) >= 0) return null;
  return { at: reduce(h.at[0], h.at[1]), role: h.role, velocity: clamp(h.velocity, 0.1, 1.5, 1) };
}
const byTime = (a, b) => fCmp(a.at, b.at) || DRUM_ROLES.indexOf(a.role) - DRUM_ROLES.indexOf(b.role);

/** A complete, checked groove from a partial one, or null when it is unusable (no valid hit). Bad hits, fills and extras are dropped. */
export function createGroove(input = {}) {
  const bars = Number.isInteger(input.bars) && input.bars >= 1 && input.bars <= MAX_BARS ? input.bars : 1;
  const bar = isFraction(input.length) && input.length[0] > 0 ? input.length : [1, 1]; // the length of ONE bar
  const total = reduce(bar[0] * bars, bar[1]);
  const hits = (input.hits ?? []).map((h) => createHit(h, total)).filter(Boolean).sort(byTime);
  if (!hits.length) return null;
  const fills = (input.fills ?? []).map((f, i) => {
    const from = isFraction(f?.from) && fCmp(f.from, bar) < 0 ? reduce(f.from[0], f.from[1]) : [...DEFAULT_FILL_FROM];
    const fh = (f?.hits ?? []).map((h) => createHit(h, bar)).filter((h) => h && fCmp(h.at, from) >= 0).sort(byTime);
    return fh.length ? { id: String(f.id ?? `fill${i + 1}`), name: f.name == null ? null : String(f.name).slice(0, 40), chance: clamp(f.chance, 0, 1, 0.3), from, hits: fh } : null;
  }).filter(Boolean);
  const variants = (input.variants ?? []).map((v, i) => {
    const vh = (v?.hits ?? []).map((h) => createHit(h, total)).filter(Boolean).sort(byTime);
    return vh.length ? { id: String(v.id ?? `v${i + 1}`), name: v.name == null ? null : String(v.name).slice(0, 40), hits: vh } : null;
  }).filter(Boolean).slice(0, MAX_VARIANTS);
  const extras = (input.extras ?? []).map((e) => { const h = createHit(e, bar); return h ? { ...h, chance: clamp(e.chance, 0, 1, 0.3) } : null; }).filter(Boolean);
  return {
    id: String(input.id ?? ''), name: input.name == null ? null : String(input.name).slice(0, 40), ...(input.folder != null && String(input.folder).trim() ? { folder: String(input.folder).trim().slice(0, 40) } : {}), length: bar, ...(bars > 1 ? { bars } : {}), hits,
    ...(checkBeats(input.beats, bar, bars) ? { beats: checkBeats(input.beats, bar, bars) } : {}),
    ...(input.mainName != null && String(input.mainName).trim() ? { mainName: String(input.mainName).trim().slice(0, 40) } : {}), ...(variants.length ? { variants } : {}),
    ...(fills.length ? { fills } : {}), ...(extras.length ? { extras } : {}), ...(input.crashOnSection === false ? { crashOnSection: false } : {}),
  };
}

/** Problems of a stored groove: [] when it is usable as it is. */
export function validateGroove(g) {
  if (!g || typeof g !== 'object') return ['groove: object expected'];
  const errors = [];
  if (typeof g.id !== 'string' || !g.id) errors.push('groove: id expected');
  if (g.name != null && typeof g.name !== 'string') errors.push('groove: name must be a string');
  if (g.folder != null && typeof g.folder !== 'string') errors.push('groove: folder must be a string');
  if (!isFraction(g.length) || g.length[0] === 0) errors.push(`groove ${g.id}: length (one bar) must be a fraction of a whole note`);
  if (g.bars !== undefined && !(Number.isInteger(g.bars) && g.bars >= 1 && g.bars <= MAX_BARS)) errors.push(`groove ${g.id}: bars must be a whole number from 1 to ${MAX_BARS}`);
  if (g.beats !== undefined && !(Array.isArray(g.beats) && g.beats.every((k) => Number.isInteger(k) && k >= 1 && k <= MAX_STEPS))) errors.push(`groove ${g.id}: beats must be whole step counts`);
  const bad = (h) => !isFraction(h?.at) || !DRUM_ROLES.includes(h?.role);
  if (!Array.isArray(g.hits) || !g.hits.length) errors.push(`groove ${g.id}: at least one hit expected`);
  else if (g.hits.some(bad)) errors.push(`groove ${g.id}: a hit needs an "at" (fraction) and a known role`);
  for (const f of g.fills ?? []) if (!Array.isArray(f?.hits) || !f.hits.length || f.hits.some(bad)) errors.push(`groove ${g.id}: a fill needs hits with an "at" and a known role`);
  for (const v of g.variants ?? []) if (!Array.isArray(v?.hits) || !v.hits.length || v.hits.some(bad)) errors.push(`groove ${g.id}: a variant needs hits with an "at" and a known role`);
  for (const e of g.extras ?? []) if (bad(e)) errors.push(`groove ${g.id}: an extra needs an "at" and a known role`);
  return errors;
}

export function validateGrooveList(list) {
  if (!Array.isArray(list)) return ['grooves: list expected'];
  const errors = []; const seen = new Set();
  for (const g of list) {
    errors.push(...validateGroove(g));
    if (g?.id && seen.has(g.id)) errors.push(`grooves: duplicate id ${g.id}`);
    if (g?.id) seen.add(g.id);
    if (g?.id && BUILTIN_GROOVES.some((b) => b.id === g.id)) errors.push(`grooves: ${g.id} is a built-in id`);
  }
  return errors;
}

/** The user's grooves as a preference section: { items: [groove] }. */
export const validateGroovePref = (v) => (v && typeof v === 'object' ? validateGrooveList(v.items ?? []) : ['grooves: { items } expected']);
export const createGroovePref = (v) => ({ items: (v.items ?? []).map(createGroove).filter(Boolean) });

// ---- built-in grooves (starting points chosen by Scorsaire, to be replaced by the user's own repertoire)
const f = (n, d) => reduce(n, d);
const h = (n, d, role, velocity = 1) => ({ at: f(n, d), role, velocity });
const eighths = (role, velocity = 1) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => h(k, 8, role, velocity));
const FILL_SNARES = { id: 'snares', name: null, chance: 0.35, from: f(1, 2), hits: [h(8, 16, 'snare'), h(9, 16, 'snare', 0.8), h(10, 16, 'snare'), h(11, 16, 'snare', 0.8), h(12, 16, 'snare'), h(13, 16, 'snare', 0.8), h(14, 16, 'snare'), h(15, 16, 'snare', 1.15)] };
const FILL_TOMS = { id: 'toms', name: null, chance: 0.3, from: f(1, 2), hits: [h(8, 16, 'snare'), h(10, 16, 'tomHigh'), h(11, 16, 'tomHigh', 0.9), h(12, 16, 'tomMid'), h(13, 16, 'tomMid', 0.9), h(14, 16, 'tomFloor'), h(15, 16, 'kick', 1.1)] };
const FILL_LOW = { id: 'twoBeats', name: null, chance: 0.2, from: f(3, 4), hits: [h(12, 16, 'snare'), h(13, 16, 'snare', 0.8), h(14, 16, 'tomMid'), h(15, 16, 'tomFloor', 1.1)] };

export const BUILTIN_GROOVES = Object.freeze([
  Object.freeze({
    id: 'rock8', name: null, length: f(1, 1), // rock in eighth notes: closed hi-hat in eighths, kick on 1 and the "and" of 3, snare on 2 and 4
    hits: [...eighths('hatClosed', 0.85), h(0, 8, 'kick'), h(4, 8, 'kick'), h(5, 8, 'kick', 0.9), h(2, 8, 'snare'), h(6, 8, 'snare')],
    fills: [FILL_SNARES, FILL_TOMS, FILL_LOW], extras: [h(7, 8, 'kick', 0.8), h(3, 8, 'kick', 0.8)].map((e) => ({ ...e, chance: 0.25 })),
  }),
  Object.freeze({
    id: 'funk16', name: null, length: f(1, 1), // sixteenth-note funk: hi-hat in sixteenths with a lighter off-beat, ghost snares around the backbeat
    hits: [...[...Array(16).keys()].map((k) => h(k, 16, 'hatClosed', k % 4 === 0 ? 0.95 : k % 2 === 0 ? 0.8 : 0.6)), h(0, 16, 'kick'), h(10, 16, 'kick', 0.9), h(7, 16, 'kick', 0.85), h(4, 16, 'snare', 1.1), h(12, 16, 'snare', 1.1), h(3, 16, 'snare', 0.4), h(11, 16, 'snare', 0.4), h(15, 16, 'snare', 0.4)],
    fills: [FILL_SNARES, FILL_TOMS], extras: [h(9, 16, 'snare', 0.4), h(14, 16, 'kick', 0.8)].map((e) => ({ ...e, chance: 0.3 })),
  }),
  Object.freeze({
    id: 'shuffle', name: null, length: f(1, 1), // shuffle written in triplets: ride on the beat and the third triplet, kick on 1 and 3, snare on 2 and 4
    hits: [...[0, 1, 2, 3].flatMap((b) => [h(3 * b, 12, 'ride'), h(3 * b + 2, 12, 'ride', 0.8)]), h(0, 12, 'kick'), h(6, 12, 'kick'), h(3, 12, 'snare'), h(9, 12, 'snare'), h(1, 4, 'hatPedal', 0.7), h(3, 4, 'hatPedal', 0.7)],
    fills: [{ id: 'triplets', name: null, chance: 0.3, from: f(1, 2), hits: [h(6, 12, 'snare', 0.9), h(7, 12, 'snare', 0.8), h(8, 12, 'tomHigh'), h(9, 12, 'tomMid'), h(10, 12, 'tomMid', 0.9), h(11, 12, 'tomFloor', 1.1)] }], extras: [],
  }),
  Object.freeze({
    id: 'ballad', name: null, length: f(1, 1), // slow ballad: side stick on 2 and 4, closed hi-hat on the beats, kick on 1 and 3
    hits: [h(0, 4, 'kick'), h(2, 4, 'kick', 0.9), h(1, 4, 'sideStick'), h(3, 4, 'sideStick'), ...[0, 1, 2, 3].map((b) => h(b, 4, 'hatClosed', 0.7))],
    fills: [FILL_LOW], extras: [h(3, 8, 'kick', 0.7), h(7, 8, 'hatClosed', 0.5)].map((e) => ({ ...e, chance: 0.2 })),
  }),
]);

/** Groove by id: project > user > built in; null for none or an unknown id. */
export function resolveGroove(id, { project = [], user = [] } = {}) {
  if (!id) return null;
  for (const list of [project, user, BUILTIN_GROOVES]) {
    const found = (list ?? []).find((g) => g?.id === id);
    if (found) return createGroove(found);
  }
  return null;
}

/** Every groove a menu offers, complete: [{ ...groove, source: 'builtin' | 'user' | 'project' }] (a project groove hides one of the same id); built in first. */
export function allGrooves({ project = [], user = [] } = {}) {
  const seen = new Set(); const out = [];
  for (const [list, source] of [[project, 'project'], [user, 'user'], [BUILTIN_GROOVES, 'builtin']]) {
    for (const g of list ?? []) {
      if (!g?.id || seen.has(g.id)) continue;
      const done = createGroove(g); if (!done) continue;
      seen.add(g.id); out.push({ ...done, source });
    }
  }
  const order = { builtin: 0, user: 1, project: 2 };
  return out.sort((a, b) => order[a.source] - order[b.source]);
}

/** Call inside `doc.transaction`. */
export function setProjectGrooves(doc, work, list) {
  const errors = validateGrooveList(list);
  if (errors.length) throw new Error(errors[0]);
  if (list.length) doc.set(work, PID.GROOVES, list); else if ((doc.get(work, PID.GROOVES) ?? []).length) doc.reset(work, PID.GROOVES);
}

/**
 * The hits of a groove over ONE measure of length `measureLength` (a fraction of a whole note): [{ at, role, velocity }] sorted, the groove's own hits only.
 * `measureIndex`: a groove of several bars plays bar `measureIndex mod bars` in the measure. `variant`: 0 = the main version, k = its k-th variant. The bar repeats to fill a longer measure and is cut at the bar line of a shorter one.
 */
export function grooveHitsForMeasure(groove, measureLength, measureIndex = 0, variant = 0) {
  const bars = groove.bars ?? 1; const bar = groove.length;
  const all = variant > 0 && groove.variants?.[variant - 1] ? groove.variants[variant - 1].hits : groove.hits; // 0 = the groove itself, 1… = its variants
  const k = ((measureIndex % bars) + bars) % bars;
  const first = reduce(bar[0] * k, bar[1]); const last = fAdd(first, bar);
  const source = all.filter((x) => fCmp(x.at, first) >= 0 && fCmp(x.at, last) < 0).map((x) => ({ ...x, at: fSub(x.at, first) }));
  const out = [];
  for (let start = [0, 1]; fCmp(start, measureLength) < 0; start = fAdd(start, bar)) {
    for (const x of source) { const at = fAdd(start, x.at); if (fCmp(at, measureLength) < 0) out.push({ ...x, at }); }
  }
  return out.sort(byTime);
}

/** How many versions a groove has: the main one and its variants. */
export const grooveVersionCount = (groove) => 1 + (groove.variants?.length ?? 0);

// ---- pure edits of a groove, for the editor (each returns new lists, nothing is changed in place)
/** What a tap on a cell goes through: nothing → a hit as written (1) → a ghost note (0.5) → an accent (1.15) → nothing. */
export const VELOCITY_CYCLE = Object.freeze([1, 0.5, 1.15]);
const sameSpot = (a, b) => a.role === b.role && fCmp(a.at, b.at) === 0;

/** The hits with the cell (`at`, `role`) taken one step further in the velocity cycle (added, ghost, accent, removed). */
export function cycleHit(hits, at, role) {
  const found = hits.find((x) => sameSpot(x, { at, role }));
  if (!found) return [...hits, { at: reduce(at[0], at[1]), role, velocity: VELOCITY_CYCLE[0] }].sort(byTime);
  const k = VELOCITY_CYCLE.findIndex((v) => Math.abs(v - found.velocity) < 1e-6);
  if (k < 0 || k + 1 >= VELOCITY_CYCLE.length) return hits.filter((x) => x !== found);
  return hits.map((x) => (x === found ? { ...x, velocity: VELOCITY_CYCLE[k + 1] } : x));
}

/** The extras with one added at (`at`, `role`) as a ghost note with a chance of 30 %, or removed when there already. */
export function toggleExtra(extras, at, role) {
  const found = (extras ?? []).find((x) => sameSpot(x, { at, role }));
  if (found) return extras.filter((x) => x !== found);
  return [...(extras ?? []), { at: reduce(at[0], at[1]), role, velocity: 0.5, chance: 0.3 }].sort(byTime);
}

/** The extras with the chance of one of them changed (bounded to [0, 1]). */
export const setExtraChance = (extras, index, chance) => extras.map((x, i) => (i === index ? { ...x, chance: clamp(chance, 0, 1, x.chance) } : x));

/** A new empty-ish fill: starts at the second half of the bar, a snare on its first place. */
export function newFill(existing = [], bar = [1, 1]) {
  const from = [...DEFAULT_FILL_FROM];
  return { id: `fill${Date.now().toString(36)}${existing.length}`, name: null, chance: 0.3, from: fCmp(from, bar) < 0 ? from : [0, 1], hits: [{ at: from, role: 'snare', velocity: 1 }] };
}
