// Mode B of screen 4: movements (« fragments ») PLACED on the timeline of a recording or of a video: each placement is [start, end) seconds of the media.
// Inside a placement the score advances in proportion: the movement's own measures (its own tempo) are stretched to fill the placement. PURE: lists in, lists out.
import { createSyncMap } from './syncmap.js';
import { advanced } from './cursor.js';

export const MIN_LENGTH = 1; // seconds
export const METRONOME_TRACK = 'metronome';
export const DEFAULT_LENGTH = 8;
let counter = 0;
const nextId = (list) => { let id; do { counter += 1; id = `pl${counter}`; } while (list.some((p) => p.id === id)); return id; };

export const sortPlacements = (list) => [...list].sort((a, b) => a.start - b.start);
/** The row of a placement: 0 (top) or 1 (bottom). Two placements may overlap only when they are in different rows. */
export const MAX_ROWS = 4; // rows (tracks) per group: the author may have 1 to 4 under the video and 1 to 4 on it
export const rowOf = (p) => (Number.isInteger(p.row) && p.row > 0 ? Math.min(MAX_ROWS - 1, p.row) : 0);
export const ROWS = MAX_ROWS;
const sameRow = (list, row) => list.filter((p) => rowOf(p) === row);
/** The two GROUPS of the timeline: 0 = under the video, 1 = on the video; each has up to four rows; a LANE (0..7) = group × 4 + row. Two placements may overlap only in different lanes. */
export const groupOf = (p) => (isOver(p) ? 1 : 0);
export const laneOf = (p) => groupOf(p) * MAX_ROWS + rowOf(p);
export const LANES = 2 * MAX_ROWS;
const sameLane = (list, lane) => list.filter((p) => laneOf(p) === lane);
/**
 * The card of a PLACED fragment: its own `name` and `number` (any text) when it has them, else those of the fragment it plays (the movement's card).
 * The same fragment may be placed several times (« reuse »): each placement can then carry its own name and number.
 * @param p      the placement (`name` / `number` optional, empty = follow the fragment)
 * @param base   { number, title } of the movement's card
 */
export const NAME_MAX = 80; export const NUMBER_MAX = 12;
const own = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
export const placementCard = (p, base = {}) => ({ number: own(p?.number) ?? String(base.number ?? ''), title: own(p?.name) ?? String(base.title ?? '') });
export const placementCardText = (p, base = {}) => { const c = placementCard(p, base); return `${c.number} ${c.title}`.trim(); };
/** Sets (or, with an empty text, clears) the own name and / or number of the placement `id`. Texts are trimmed and cut to NAME_MAX / NUMBER_MAX. */
export function setPlacementCard(list, id, { name, number } = {}) {
  return list.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p };
    if (name !== undefined) { const v = own(name); if (v) next.name = v.slice(0, NAME_MAX); else delete next.name; }
    if (number !== undefined) { const v = own(number); if (v) next.number = v.slice(0, NUMBER_MAX); else delete next.number; }
    return next;
  });
}

/** The placement that holds media time `t` (start included, end excluded), or null. */
export const placementAt = (list, t) => list.find((p) => t >= p.start && t < p.end) ?? null;

/** Free room around the placement `id`: [lowest start, highest end] without touching its neighbours or leaving [0, duration]. */
function room(list, id, duration) {
  const me = list.find((p) => p.id === id);
  const others = sortPlacements(sameLane(list, laneOf(me)).filter((p) => p.id !== id));
  let lo = 0; let hi = duration;
  for (const p of others) { if (p.end <= me.start + 1e-9) lo = Math.max(lo, p.end); else if (p.start >= me.end - 1e-9) hi = Math.min(hi, p.start); }
  return [lo, hi];
}

/** Adds a placement of `movementId` at `start` (moved to the first free spot at or after it); null when there is no room. */
export function addPlacement(list, { movementId, start, length = DEFAULT_LENGTH, duration, row = 0, lane = null }) {
  const ln = lane ?? (Number.isInteger(row) && row > 0 ? Math.min(MAX_ROWS - 1, row) : 0); // `lane` (0..7) also says whether it goes ON the video (4..7)
  let at = Math.max(0, start);
  const sorted = sortPlacements(sameLane(list, ln));
  for (let guard = 0; guard < sorted.length + 1; guard += 1) {
    const hit = sorted.find((p) => at < p.end && at + MIN_LENGTH > p.start);
    if (!hit) break;
    at = hit.end;
  }
  const next = sorted.find((p) => p.start >= at);
  const limit = Math.min(duration, next ? next.start : duration);
  if (limit - at < MIN_LENGTH) return null;
  const end = Math.min(at + length, limit);
  return [...list, { id: nextId(list), movementId, start: at, end, ...(ln % MAX_ROWS ? { row: ln % MAX_ROWS } : {}), ...(ln >= MAX_ROWS ? { over: {} } : {}) }];
}

/** Slides a placement (same length) as far as its neighbours and the media allow. */
export function movePlacement(list, id, start, duration) {
  const me = list.find((p) => p.id === id); if (!me) return list;
  const [lo, hi] = room(list, id, duration);
  const len = me.end - me.start;
  const s = Math.max(lo, Math.min(start, hi - len));
  return list.map((p) => (p.id === id ? { ...p, start: s, end: s + len } : p));
}

/** Puts a placement in `row` (0 | 1) if its time span is free there; the list is returned as it was when it is not. */
export function setPlacementRow(list, id, row) {
  const me = list.find((p) => p.id === id); if (!me) return list;
  return setPlacementLane(list, id, groupOf(me) * MAX_ROWS + Math.max(0, Math.min(MAX_ROWS - 1, row | 0)));
}

/** Puts a placement in `lane` (0, 1 = under the video; 2, 3 = on it) if its time span is free there; the list is returned as it was when it is not. The box of a fragment taken off the video is remembered (`overMemo`) and comes back with it. */
export function setPlacementLane(list, id, lane) {
  const me = list.find((p) => p.id === id); if (!me || !(lane >= 0 && lane < LANES) || laneOf(me) === lane) return list;
  if (sameLane(list, lane).some((p) => p.id !== id && me.start < p.end - 1e-9 && me.end > p.start + 1e-9)) return list;
  return list.map((p) => {
    if (p.id !== id) return p;
    const { row: _r, over, overMemo, ...rest } = p;
    return { ...rest, ...(lane % MAX_ROWS ? { row: lane % MAX_ROWS } : {}), ...(lane >= MAX_ROWS ? { over: over ?? overMemo ?? {} } : (over ?? overMemo) ? { overMemo: over ?? overMemo } : {}) };
  });
}

/** Moves one edge ('start' | 'end') of a placement to `time` (the placement keeps at least MIN_LENGTH and stays clear of its neighbours). */
export function resizePlacement(list, id, edge, time, duration) {
  const me = list.find((p) => p.id === id); if (!me) return list;
  const [lo, hi] = room(list, id, duration);
  if (edge === 'start') return list.map((p) => (p.id === id ? { ...p, start: Math.max(lo, Math.min(time, p.end - MIN_LENGTH)) } : p));
  return list.map((p) => (p.id === id ? { ...p, end: Math.min(hi, Math.max(time, p.start + MIN_LENGTH)) } : p));
}

export const removePlacement = (list, id) => list.filter((p) => p.id !== id);

/** Problems of a list (never thrown: a file can hold anything): unknown movement, bad times, bad row or display values, overlap inside one row. */
export function placementProblems(list, movementIds, duration = Infinity) {
  const out = [];
  for (const p of list) {
    if (!movementIds.includes(p.movementId)) out.push(`${p.id}: unknown movement`);
    if (!(p.start >= 0 && p.end > p.start && p.end <= duration + 1e-6)) out.push(`${p.id}: bad times`);
    if (p.row != null && !(Number.isInteger(p.row) && p.row >= 0 && p.row < MAX_ROWS)) out.push(`${p.id}: bad row`);
    if (p.view != null && !PLACEMENT_VIEWS.includes(p.view)) out.push(`${p.id}: bad view`);
    if (p.over != null) { const v = overProblems(p.over); if (v) out.push(`${p.id}: ${v}`); }
    for (const k of ['lead', 'tail', 'fade', 'fadeOut']) if (p[k] != null && !(Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 60)) out.push(`${p.id}: bad ${k}`);
  }
  for (let row = 0; row < LANES; row += 1) {
    const sorted = sortPlacements(sameLane(list, row));
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i].start < sorted[i - 1].end - 1e-9) out.push(`${sorted[i].id}: overlaps ${sorted[i - 1].id}`);
  }
  return out;
}

// ---- a fragment placed ON the video: `over` = { x, y, w } in percent of the WIDTH of the video frame (x, y = top left corner; y stays within the picture, whose height is 56 % of its width; the height of the box comes from the music),
// and the look of its box (color of the fill, opacity, soft edge). A fragment without `over` is shown under the video as before.
export const OVER_DEFAULTS = Object.freeze({ x: 5, y: 30, w: 50, color: '#ffffff', ink: '#000000', opacity: 0.9, soft: 10, size: 70 }); // ink = colour of the music inside the box; // size = size of the writing, in % of the usual one (it decides the height of the box)
export const OVER_LIMITS = Object.freeze({ x: [0, 95], y: [0, 50], w: [10, 100], opacity: [0, 1], soft: [0, 24], size: [20, 200] });
export const isOver = (p) => p?.over != null && typeof p.over === 'object';
const clampTo = (v, [lo, hi], d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
/** The box of an overlaid fragment with every value checked and the defaults filled in. */
export function overOf(p) {
  const o = p?.over ?? {};
  return { x: clampTo(o.x, OVER_LIMITS.x, OVER_DEFAULTS.x), y: clampTo(o.y, OVER_LIMITS.y, OVER_DEFAULTS.y), w: clampTo(o.w, OVER_LIMITS.w, OVER_DEFAULTS.w), color: /^#[0-9a-f]{6}$/i.test(o.color ?? '') ? o.color : OVER_DEFAULTS.color, ink: /^#[0-9a-f]{6}$/i.test(o.ink ?? '') ? o.ink : OVER_DEFAULTS.ink, opacity: clampTo(o.opacity, OVER_LIMITS.opacity, OVER_DEFAULTS.opacity), soft: clampTo(o.soft, OVER_LIMITS.soft, OVER_DEFAULTS.soft), size: clampTo(o.size, OVER_LIMITS.size, OVER_DEFAULTS.size) };
}
function overProblems(o) {
  if (typeof o !== 'object') return 'bad over';
  // a file made before y was kept inside the picture may hold a y up to 100: it is accepted (and brought back inside by `overOf`)
  for (const k of ['x', 'y', 'w', 'opacity', 'soft', 'size']) { const hi = k === 'y' ? 100 : OVER_LIMITS[k][1]; if (o[k] != null && !(Number.isFinite(o[k]) && o[k] >= OVER_LIMITS[k][0] && o[k] <= hi)) return `bad over.${k}`; }
  if (o.color != null && !/^#[0-9a-f]{6}$/i.test(o.color)) return 'bad over.color';
  if (o.ink != null && !/^#[0-9a-f]{6}$/i.test(o.ink)) return 'bad over.ink';
  return null;
}
/** Puts a placement on the video (`over` = null puts it back under it); `patch` changes some values of its box (the first call creates it with the defaults). */
export function setPlacementOver(list, id, over) {
  return list.map((p) => { if (p.id !== id) return p; const { over: _drop, overMemo, ...rest } = p; return over ? { ...rest, over: { ...(isOver(p) ? p.over : overMemo ?? {}), ...over } } : { ...rest, ...(isOver(p) ? { overMemo: p.over } : overMemo ? { overMemo } : {}) }; });
}
export const overStored = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v != null && OVER_DEFAULTS[k] !== undefined));

// ---- how a fragment uses the width of the screen: 'fit' = one line as wide as the screen (the default, loaded with a new fragment), 'wrap' = lines, 'scroll' = one long line that scrolls sideways
export const PLACEMENT_VIEWS = Object.freeze(['fit', 'wrap', 'scroll']);
export const viewOf = (p) => (PLACEMENT_VIEWS.includes(p?.view) ? p.view : 'fit');
export function setPlacementView(list, id, view) {
  return list.map((p) => { if (p.id !== id) return p; const { view: _drop, ...rest } = p; return view && view !== 'fit' && PLACEMENT_VIEWS.includes(view) ? { ...rest, view } : rest; });
}

// ---- when a fragment is SHOWN (wider than when it plays)
export const DISPLAY_DEFAULTS = { lead: 3, tail: 3, fadeIn: 1.5, fadeOut: 2, showBlocks: true, lanes: { under: 2, over: 2 } };
const clampNum = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
/** The display options of a file (`{ lead, tail, fadeIn, fadeOut, showBlocks, lanes: { under, over } }`: how many tracks the timeline of the editor shows under the video and on it), every value checked; anything missing takes its default (`fade` of older files = `fadeIn`). */
export function normalizeDisplay(d) {
  return { lead: clampNum(d?.lead, 0, 30, DISPLAY_DEFAULTS.lead), tail: clampNum(d?.tail, 0, 60, DISPLAY_DEFAULTS.tail), fadeIn: clampNum(d?.fadeIn ?? d?.fade, 0, 5, DISPLAY_DEFAULTS.fadeIn), fadeOut: clampNum(d?.fadeOut, 0, 5, DISPLAY_DEFAULTS.fadeOut), showBlocks: d?.showBlocks !== false, lanes: { under: clampNum(Math.round(d?.lanes?.under), 1, MAX_ROWS, 2), over: clampNum(Math.round(d?.lanes?.over), 1, MAX_ROWS, 2) } };
}
export const leadOf = (p, display) => (Number.isFinite(p.lead) ? p.lead : normalizeDisplay(display).lead);
/** How long a fragment stays on show after it has played (seconds): its own `tail`, else the default of the file (3 s). */
export const tailOf = (p, display) => (Number.isFinite(p.tail) ? p.tail : normalizeDisplay(display).tail);
/** Fade IN of a fragment: its own `fade`, else the default of the file. Fade OUT (when it goes away): its own `fadeOut`, else the default. */
export const fadeInOf = (p, display) => (Number.isFinite(p.fade) ? p.fade : normalizeDisplay(display).fadeIn);
export const fadeOutOf = (p, display) => (Number.isFinite(p.fadeOut) ? p.fadeOut : normalizeDisplay(display).fadeOut);
export const fadeOf = fadeInOf;

/** When the display window of `p` ENDS: `tail` seconds after its end, or sooner when the next fragment of its row appears (or the media ends). */
export function holdEnd(list, p, display, duration = Infinity) {
  const next = sortPlacements(sameLane(list, laneOf(p))).find((x) => x.start > p.start);
  const nextFrom = next ? next.start - leadOf(next, display) : duration;
  const bound = Math.max(p.end, Math.min(nextFrom, duration));
  return Math.min(bound, p.end + tailOf(p, display));
}

/**
 * What each row SHOWS at time `t`: [placement | null, placement | null] (top, bottom). A fragment appears `lead` seconds before it starts (the first one too: nothing is
 * on show before its time) and goes away `tail` seconds after its end, unless the next one of its row has appeared by then and takes its place.
 */
export function shownAt(list, t, display) {
  return Array.from({ length: MAX_ROWS }, (_, row) => {
    const sorted = sortPlacements(sameRow(list, row));
    let pick = null;
    for (const p of sorted) if (p.start - leadOf(p, display) <= t) pick = p;
    if (pick && t >= pick.end + tailOf(pick, display)) return null;
    return pick;
  });
}

/** The placement of `row` that is PLAYING at `t` (start included, end excluded), or null. */
export const playingAt = (list, t, row) => sameRow(list, row).find((p) => t >= p.start && t < p.end) ?? null;

/**
 * The time map of a placement: the measures of the movement (`slots` = the sequence slots of THAT movement, in order: { measure, t, end } in the movement's own seconds)
 * stretched over [start, end). → a sync map (`locate(time)` → measure + ratio) or null when the movement has no measure.
 */
export function placementMap(slots, placement) {
  if (!slots.length) return null;
  const t0 = slots[0].t; const total = slots[slots.length - 1].end - t0;
  if (!(total > 0)) return null;
  const k = (placement.end - placement.start) / total;
  const at = (t) => placement.start + (t - t0) * k;
  return createSyncMap(slots.map((s) => ({ start: at(s.t), end: at(s.end), beats: [at(s.t)] })));
}

/**
 * The score heard with the video: the sequence of the work (written tempo, no repeats) re-timed so that the notes of each movement fall inside ITS placement (the movement's
 * own timing stretched over [start, end)), then divided by the listening speed. A movement with no placement is silent. PURE: sequence in, sequence out.
 * @param seq        a sequence (buildSequence, speed 1, playRepeats false)
 * @param placements [{ movementId, start, end }]
 * @param options    { indexOf(movementId) → index of the movement in the work, rate = 1, metronome = a click on every quarter-note beat of every fragment (a check for the editor, never
 *                 exported), beatsOf(movementIndex, measureIndex) → quarter-note beats in that measure, metronomeVolume 0..1 }
 */
export function retimePlacements(seq, placements, { indexOf, rate = 1, metronome = false, beatsOf = null, metronomeVolume = 0.6 } = {}) {
  const parts = [];
  for (const p of placements) {
    const idx = indexOf(p.movementId);
    const slots = seq.slots.filter((s) => s.movement === idx);
    if (!slots.length) continue;
    const t0 = slots[0].t; const tE = slots[slots.length - 1].end;
    if (!(tE > t0)) continue;
    parts.push({ p, idx, slots, t0, tE, k: (p.end - p.start) / (tE - t0) });
  }
  const media = (part, tau) => part.p.start + (tau - part.t0) * part.k;
  const notes = [];
  for (const n of seq.notes) { // a movement REUSED by several placements is heard in each of them
    parts.filter((x) => x.idx === n.movement).forEach((part, k) => {
      const start = media(part, n.t);
      if (start >= part.p.end) return;
      const out = { ...n, ...(k ? { id: `${n.id}@${part.p.id}` } : {}), t: start / rate, duration: Math.max(0.005, Math.min(n.duration * part.k, part.p.end - start) / rate) };
      if (n.pitchCurve) out.pitchCurve = n.pitchCurve.map((c) => ({ ...c, t: media(part, c.t) / rate }));
      notes.push(out);
    });
  }
  notes.sort((a, b) => a.t - b.t);
  const messages = [];
  for (const m of seq.messages) for (const part of parts) if (m.t >= part.t0 - 1e-9 && m.t <= part.tE + 1e-9) messages.push({ ...m, t: media(part, m.t) / rate });
  const slots = parts.flatMap((part) => part.slots.map((s) => ({ ...s, t: media(part, s.t) / rate, end: media(part, s.end) / rate }))).sort((a, b) => a.t - b.t);
  const steps = parts.flatMap((part) => part.slots.map((s) => {
    const dur = Math.max(1e-6, (s.end - s.t) * part.k / rate); const wps = advanced(seq.tempo.steps, s.t, s.end) / dur;
    return { t: media(part, s.t) / rate, wps, bpm: wps * 240 };
  })).sort((a, b) => a.t - b.t);
  const duration = parts.reduce((m, part) => Math.max(m, part.p.end), 0) / rate;
  const tracks = [...seq.tracks];
  if (metronome && beatsOf) { // clicks as the notes of a percussion track: they go through the same engine and the same sound offset as the score, so what is heard is what the cursor says
    tracks.push({ id: METRONOME_TRACK, name: 'Metronome', instrumentId: null, family: null, kind: 'percussion', mixer: { volume: metronomeVolume, mute: false, solo: false } });
    for (const part of parts) {
      for (const sl of part.slots) {
        const beats = beatsOf(part.idx, sl.measure); if (!(beats > 0)) continue;
        for (let k = 0; k < beats - 1e-9; k += 1) {
          const start = media(part, sl.t + ((sl.end - sl.t) * k) / beats);
          if (start >= part.p.end) break;
          notes.push({ id: `click#${part.p.id}#${sl.measure}#${k}`, track: METRONOME_TRACK, staff: METRONOME_TRACK, voice: 0, movement: part.idx, measure: sl.measure, chord: null, pitch: k === 0 ? 76 : 77, velocity: k === 0 ? 112 : 84, t: start / rate, duration: 0.05 });
        }
      }
    }
    notes.sort((a, b) => a.t - b.t);
  }
  return { ...seq, tracks, notes, messages, automation: [], slots, tempo: { ...seq.tempo, steps }, duration, speed: rate, synced: true };
}
