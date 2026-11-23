/*
 * MIDI import, quantization: from the ticks of a file to positions on a grid. PURE (no DOM, no model).
 *
 * Everything is counted in integer UNITS of 1/R whole note, R = 3 · G · r (G = the grid denominator: 8, 16 or 32; r = 1, 2, 4 or 8, the smallest that makes every
 * bar an integer number of units). On the grid, a plain step is 3r units and a triplet slot is 4r units (so 12r units hold either 4 steps or 3 triplet slots:
 * the same span, called a WINDOW — a quarter note for a sixteenth grid). Windows start at the start of their bar.
 *
 *   buildTimebase(raw, lastTick, { grid }, report)   → { bars, R, r, step, slot, W, factor, total, barAt(u) }
 *   quantizeNotes(notes, tb, { triplets })            → { notes: [{ S, E, midi, velocity }], triplets: Set('bar:window'), mixed }
 *   groupChords(notes, { durations })                → chord groups [{ s, e, midis, vel: Map(midi → velocity) }]
 *   assignVoices(groups, report)                      → voice index (0…3) per group, the upper line being voice 0
 *   drumGroups(notes, soundOf, tb)                    → { voices: [groups], dropped } for a percussion part
 *
 * Triplets ('auto'): a window is a triplet window when one of its note starts sits on the triplet slots and NOT on the plain steps while none sits on the plain
 * steps only. A window holding both kinds ("two against three") is written with plain values and reported; 'on' also takes it when the triplet grid fits better
 * on the whole; 'off' never writes a triplet.
 */
import { MidiError } from './midi-read.js';

export const MAX_MEASURES = 3000;
export const GRID_DENOMINATORS = [8, 16, 32];
const DENOMINATORS = [1, 2, 4, 8, 16, 32, 64];
const EPS = 1e-6;

/** Bars, time base and conversion factor for a file whose last note ends at `lastTick`. */
export function buildTimebase(raw, lastTick, { grid = 16 } = {}, report) {
  const G = GRID_DENOMINATORS.includes(grid) ? grid : 16;
  const tpw = raw.division * 4; // ticks per whole note
  const meters = [];
  for (const ts of raw.timeSigs) {
    if (!(ts.num >= 1 && ts.num <= 99 && DENOMINATORS.includes(ts.den))) { report.warn('timesig.invalid', 'A time signature that cannot be written was ignored'); continue; }
    const last = meters[meters.length - 1];
    if (last && last.tick === ts.tick) { meters[meters.length - 1] = ts; continue; }
    if (last && last.num === ts.num && last.den === ts.den) continue;
    meters.push(ts);
  }
  if (!meters.length || meters[0].tick > 0) {
    if (!raw.timeSigs.length) report.info('timesig.default', 'The file has no time signature: 4/4 was used');
    meters.unshift({ tick: 0, num: 4, den: 4 });
  }
  let r = 1;
  const whole = (m, rr) => 3 * G * rr * m.num / m.den;
  while (r < 8 && meters.some((m) => Math.abs(whole(m, r) - Math.round(whole(m, r))) > EPS)) r *= 2;
  const R = 3 * G * r;
  const factor = R / tpw;

  const keyAt = (tick) => {
    let key = 0;
    for (const k of raw.keySigs) { if (k.tick <= tick + EPS) key = Math.max(-7, Math.min(7, k.fifths)); else break; }
    return key;
  };
  const bars = [];
  let tick = 0; let mi = 0; let startU = 0;
  while (tick < lastTick - EPS || !bars.length) {
    while (mi + 1 < meters.length && meters[mi + 1].tick <= tick + EPS) mi += 1;
    const m = meters[mi];
    const lenTicks = tpw * m.num / m.den;
    const lenU = Math.round(whole(m, r));
    bars.push({ startTick: tick, lenTicks, num: m.num, den: m.den, startU, lenU, key: keyAt(tick) });
    tick += lenTicks; startU += lenU;
    if (bars.length > MAX_MEASURES) throw new MidiError('tooLong', 'The MIDI file is too long to import', { measures: bars.length, max: MAX_MEASURES });
  }
  const starts = new Set(bars.map((b) => Math.round(b.startTick)));
  for (const m of meters) if (m.tick > 0 && !starts.has(Math.round(m.tick))) report.warn('timesig.moved', 'A time signature change in the middle of a measure was moved to the next barline');
  const end = bars[bars.length - 1].startU + bars[bars.length - 1].lenU;
  const barAt = (u) => {
    let lo = 0; let hi = bars.length - 1;
    if (u < 0) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].startU <= u) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  return { bars, G, R, r, step: 3 * r, slot: 4 * r, W: 12 * r, factor, total: end, meters, barAt };
}

/** Bar, window and offset (units, may be slightly negative) of a raw position `u`; an early position belongs to the NEXT window. */
function locate(tb, u) {
  let b = tb.barAt(u);
  let bar = tb.bars[b];
  let rel = u - bar.startU;
  let w = Math.floor((rel + tb.r) / tb.W);
  if (w * tb.W >= bar.lenU && b + 1 < tb.bars.length) { rel -= bar.lenU; b += 1; bar = tb.bars[b]; w = 0; }
  return { b, w, rw: rel - w * tb.W, bar };
}

const fitStep = (rw, g) => Math.abs(rw - g * Math.round(rw / g));

/**
 * Snaps the notes of ONE part. `notes`: [{ tick, end, midi, velocity }] of the file. Returns notes in grid units (S start, E end, E > S), the triplet windows and
 * how many windows were left plain because they mixed plain and triplet starts.
 */
export function quantizeNotes(notes, tb, { triplets = 'auto' } = {}) {
  const items = [];
  for (const n of notes) items.push({ n, s: n.tick * tb.factor, e: n.end * tb.factor });
  const stats = new Map();
  for (const it of items) {
    const at = locate(tb, it.s);
    it.at = at;
    if ((at.w + 1) * tb.W > at.bar.lenU) continue; // a window cut by the end of the bar cannot hold a triplet
    const key = `${at.b}:${at.w}`;
    let st = stats.get(key);
    if (!st) { st = { errB: 0, errT: 0, tOnly: 0, bOnly: 0 }; stats.set(key, st); }
    const dB = fitStep(at.rw, tb.step); const dT = fitStep(at.rw, tb.slot);
    st.errB += dB; st.errT += dT;
    const fitsB = dB <= 0.6 * tb.r; const fitsT = dT <= 0.8 * tb.r;
    if (fitsT && !fitsB) st.tOnly += 1;
    if (fitsB && !fitsT) st.bOnly += 1;
  }
  const trip = new Set(); let mixed = 0;
  if (triplets !== 'off') {
    for (const [key, st] of stats) {
      if (st.tOnly && st.bOnly) {
        if (triplets === 'on' && st.errT < st.errB) trip.add(key); else mixed += 1;
      } else if (st.tOnly) trip.add(key);
      else if (triplets === 'on' && st.errT < st.errB && st.errB > 0) trip.add(key);
    }
  }
  const snapped = [];
  for (const it of items) {
    const { b, w, rw, bar } = it.at;
    const inTrip = trip.has(`${b}:${w}`);
    const g = inTrip ? tb.slot : tb.step;
    const S = bar.startU + w * tb.W + g * Math.round(rw / g);
    if (S >= tb.total) continue;
    const to = locate(tb, it.e);
    const g2 = trip.has(`${to.b}:${to.w}`) ? tb.slot : tb.step;
    let E = to.bar.startU + to.w * tb.W + g2 * Math.round(to.rw / g2);
    if (E <= S) E = S + g;
    snapped.push({ S, E: Math.min(E, tb.total), midi: it.n.midi, velocity: it.n.velocity });
  }
  return { notes: snapped, triplets: trip, mixed };
}

/** The loudest of two strikes of the same key at the same place. */
const addVelocity = (map, key, velocity) => { if (!(map.get(key) >= velocity)) map.set(key, velocity); };

/**
 * Chords of a pitched part. 'played': notes with the same start AND the same end make one chord (a note of another length is another group, for another
 * voice). 'chained': every chord lasts until the next start (one line, no rests between chords).
 */
export function groupChords(notes, { durations = 'played' } = {}) {
  const sorted = [...notes].sort((a, b) => a.S - b.S || a.midi - b.midi);
  if (durations === 'chained') {
    const starts = [];
    const byStart = new Map();
    for (const n of sorted) {
      let g = byStart.get(n.S);
      if (!g) { g = { s: n.S, e: n.E, midis: new Set(), vel: new Map() }; byStart.set(n.S, g); starts.push(g); }
      g.midis.add(n.midi); g.e = Math.max(g.e, n.E); addVelocity(g.vel, n.midi, n.velocity);
    }
    return starts.map((g, i) => ({ s: g.s, e: starts[i + 1] ? starts[i + 1].s : g.e, midis: [...g.midis].sort((a, b) => a - b), vel: g.vel }));
  }
  const map = new Map(); const out = [];
  for (const n of sorted) {
    const key = `${n.S}|${n.E}`;
    let g = map.get(key);
    if (!g) { g = { s: n.S, e: n.E, midis: new Set(), vel: new Map() }; map.set(key, g); out.push(g); }
    g.midis.add(n.midi); addVelocity(g.vel, n.midi, n.velocity);
  }
  return out.map((g) => ({ ...g, midis: [...g.midis].sort((a, b) => a - b) }));
}

const average = (list) => list.reduce((s, x) => s + x, 0) / list.length;

/**
 * Voice (0…3) of every group: a group goes to the first voice that is free when it starts; groups that overlap in time are then renamed so that the HIGHEST line
 * is voice 0. With more than four lines at once, the earlier note of a voice is cut where the next one starts (or, at the same start, the group is merged into the
 * one of closest length): `report` says so. Mutates `groups` only for those cuts.
 */
export function assignVoices(groups, report) {
  const order = groups.map((g, i) => i).sort((a, b) => groups[a].s - groups[b].s || groups[b].midis[groups[b].midis.length - 1] - groups[a].midis[groups[a].midis.length - 1]);
  const voice = new Array(groups.length).fill(0);
  const last = [null, null, null, null]; // the last group index of each voice
  const merged = new Set();
  for (const i of order) {
    const g = groups[i];
    let v = last.findIndex((j) => j === null || groups[j].e <= g.s);
    if (v < 0) {
      let best = -1; let bestCost = Infinity;
      last.forEach((j, k) => {
        const p = groups[j];
        const cost = p.s === g.s ? 1e9 + Math.abs(p.e - g.e) : p.e - g.s;
        if (cost < bestCost) { bestCost = cost; best = k; }
      });
      const p = groups[last[best]];
      if (p.s === g.s) {
        for (const m of g.midis) { if (!p.midis.includes(m)) p.midis.push(m); addVelocity(p.vel, m, g.vel.get(m)); }
        p.midis.sort((a, b) => a - b);
        merged.add(i); voice[i] = best;
        report?.warn('voices.limit', 'More than four lines sound at once: some notes were shortened or merged into a chord');
        continue;
      }
      p.e = g.s; v = best;
      report?.warn('voices.limit', 'More than four lines sound at once: some notes were shortened or merged into a chord');
    }
    voice[i] = v; last[v] = i;
  }
  // renaming by pitch inside each stretch of overlapping groups
  let comp = []; let compEnd = -Infinity;
  const flush = () => {
    if (!comp.length) return;
    const used = [...new Set(comp.map((i) => voice[i]))];
    if (used.length > 1) {
      const mean = new Map(used.map((v) => [v, average(comp.filter((i) => voice[i] === v).flatMap((i) => groups[i].midis))]));
      const ranked = [...used].sort((a, b) => mean.get(b) - mean.get(a) || a - b);
      const rename = new Map(ranked.map((v, k) => [v, k]));
      for (const i of comp) voice[i] = rename.get(voice[i]);
    }
    comp = [];
  };
  for (const i of order) {
    if (merged.has(i)) continue;
    if (groups[i].s >= compEnd) { flush(); compEnd = -Infinity; }
    comp.push(i); compEnd = Math.max(compEnd, groups[i].e);
  }
  flush();
  return { voice, merged };
}

/**
 * Percussion: `soundOf(midi)` → { id, voice } | null. One line per voice of the drum map (cymbals above, drums below…); a chord lasts until the next hit of its
 * line, at most a quarter note. Returns { voices: [groups per voice index], dropped (notes of unknown drums) }.
 */
export function drumGroups(notes, soundOf, tb) {
  const lines = [[], [], [], []];
  let dropped = 0;
  for (const n of [...notes].sort((a, b) => a.S - b.S)) {
    const sound = soundOf(n.midi);
    if (!sound) { dropped += 1; continue; }
    lines[Math.max(0, Math.min(3, sound.voice ?? 0))].push({ S: n.S, id: sound.id, velocity: n.velocity });
  }
  const cap = Math.round(tb.R / 4);
  const voices = lines.map((line) => {
    const groups = []; let cur = null;
    for (const h of line) {
      if (cur && cur.s === h.S) { if (!cur.sounds.includes(h.id)) cur.sounds.push(h.id); addVelocity(cur.vel, h.id, h.velocity); continue; }
      cur = { s: h.S, e: 0, sounds: [h.id], vel: new Map([[h.id, h.velocity]]) };
      groups.push(cur);
    }
    groups.forEach((g, i) => { g.e = Math.min(groups[i + 1] ? groups[i + 1].s : tb.total, g.s + cap, tb.total); if (g.e <= g.s) g.e = Math.min(tb.total, g.s + tb.step); });
    return groups;
  });
  return { voices, dropped };
}
