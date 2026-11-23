/*
 * Sequence → Standard MIDI File (format 1). PURE: no DOM. Input: the sequence of `buildSequence` (speed 1).
 *
 * Timing: the sequence is dated in SECONDS of played time. The tempo map of the sequence (`tempo.steps`, in whole notes per second) is integrated
 * into musical time: ticks advance with the tempo, and the file carries the matching "set tempo" events (a ritardando or a fermata is a tempo change,
 * as in MuseScore's own export). Pauses (a breath, a pause between movements: `wps` 0) do not advance musical time and are therefore not in the file.
 * Channels: one per pitched track (0-8, 10-15, wrapping), 9 for percussion tracks (General MIDI). Program: a General MIDI instrument per timbre family.
 * Pitch bends: a note with a `pitchCurve` (bend, dive, portamento) is played on its own channel, because a pitch wheel is per CHANNEL: it takes a free
 * channel (one not used by a track) for its duration, with a bend range of ±12 semitones set by RPN, and the wheel is sampled every 20 ms along the curve
 * and put back to centre when the note ends. When no channel is free the note is written without its bend.
 * Leslie signs (messages of kind 'leslie', see leslie.js) are NOT exported, on purpose: the effect is a Web Audio amplitude LFO of the engines, which a MIDI file cannot carry, and the
 * only controller that comes close (CC1, modulation) means vibrato on most GM organ patches, would overwrite the modulation lane of the track and would double the chorale modulation that
 * the SoundFont already has. A wrong approximation on every synthesizer is worse than none.
 * Time and key signatures are not part of the sequence: pass `timeSignatures` / `keySignatures` (`{ t, ... }`, seconds) to have them written.
 */
import { isAudibleTrack } from './mixer.js';
import { compileGain, compilePan, compileLane } from './automation.js';
import { AUTOMATION_PARAMS } from '../model/automation.js';
import { programOfTrack, techniqueProgram } from './programs.js';

export const MIDI_PPQ = 480;
export const BEND_RANGE = 12; // semitones, set by RPN on the channels used for bends
export const BEND_STEP = 0.02; // seconds between two samples of a curve
export { PROGRAM_OF_TIMBRE } from './programs.js';

const vlq = (n) => {
  let v = Math.max(0, Math.round(n));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
};
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const text = (s) => [...new TextEncoder().encode(String(s ?? ''))];
const chunk = (id, data) => [...text(id), ...u32(data.length), ...data];

/** Seconds → ticks, integrating the tempo steps (`{ t, wps }`, wps = whole notes per second; 0 = pause). Returns { ticksAt(t), tempos }. */
export function tickMap(steps, ppq = MIDI_PPQ) {
  const list = (steps?.length ? steps : [{ t: 0, wps: 0.5 }]).slice().sort((a, b) => a.t - b.t);
  const marks = []; // { t, ticks, qps }
  let ticks = 0;
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    marks.push({ t: s.t, ticks, qps: s.wps * 4 });
    const next = list[i + 1];
    if (next) ticks += (next.t - s.t) * s.wps * 4 * ppq;
  }
  const ticksAt = (t) => {
    let lo = 0;
    for (let i = 0; i < marks.length; i += 1) { if (marks[i].t <= t) lo = i; else break; }
    const m = marks[lo];
    return m.ticks + Math.max(0, t - m.t) * m.qps * ppq;
  };
  const tempos = [];
  for (const m of marks) {
    if (m.qps <= 0) continue;
    const micros = Math.round(1e6 / m.qps);
    if (!tempos.length || tempos[tempos.length - 1].micros !== micros) tempos.push({ tick: Math.round(m.ticks), micros });
  }
  if (!tempos.length) tempos.push({ tick: 0, micros: 500000 });
  return { ticksAt, tempos };
}

/** Pitch wheel value (0..16383) for `semitones` with a range of ±BEND_RANGE. */
export const wheel = (semitones) => Math.min(16383, Math.max(0, Math.round(8192 + (semitones / BEND_RANGE) * 8191)));
/** Value of a piecewise linear curve at `t` (before the first point = the first, after the last = the last). */
export function curveAt(curve, t) {
  if (t <= curve[0].t) return curve[0].semitones;
  for (let i = 1; i < curve.length; i += 1) {
    if (t <= curve[i].t) {
      const a = curve[i - 1]; const b = curve[i];
      return b.t === a.t ? b.semitones : a.semitones + ((b.semitones - a.semitones) * (t - a.t)) / (b.t - a.t);
    }
  }
  return curve[curve.length - 1].semitones;
}

/** @returns Uint8Array holding the .mid file. */
export function sequenceToMidi(sequence, { ppq = MIDI_PPQ, title = '', timeSignatures = [], keySignatures = [] } = {}) {
  const { ticksAt, tempos } = tickMap(sequence.tempo?.steps, ppq);
  const conductor = [];
  const push = (list, tick, bytes, order = bytes[0] >= 0x90 && bytes[0] < 0xa0 && bytes[2] > 0 ? 3 : 1) => list.push({ tick, bytes, order });
  if (title) push(conductor, 0, [0xff, 0x03, ...vlq(text(title).length), ...text(title)]);
  for (const t of tempos) push(conductor, t.tick, [0xff, 0x51, 0x03, (t.micros >> 16) & 0xff, (t.micros >> 8) & 0xff, t.micros & 0xff]);
  for (const s of timeSignatures) push(conductor, Math.round(ticksAt(s.t)), [0xff, 0x58, 0x04, s.num & 0xff, Math.round(Math.log2(s.den)) & 0xff, 24, 8]);
  for (const k of keySignatures) push(conductor, Math.round(ticksAt(k.t)), [0xff, 0x59, 0x02, k.fifths & 0xff, 0]);
  const finish = (events) => {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const out = [];
    let last = 0;
    for (const e of events) { out.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
    out.push(...vlq(0), 0xff, 0x2f, 0x00);
    return chunk('MTrk', out);
  };
  // channels: one per pitched track (9 is percussion), the rest is a pool for the notes that bend
  const channelOf = new Map(); const usedChannels = new Set();
  let next = 0;
  for (const track of sequence.tracks ?? []) {
    if (track.kind === 'percussion') { channelOf.set(track.id, 9); usedChannels.add(9); continue; }
    if (next === 9) next += 1;
    const ch = next % 16;
    channelOf.set(track.id, ch); usedChannels.add(ch); next += 1;
  }
  const pool = [];
  for (let c = 0; c < 16; c += 1) if (!usedChannels.has(c)) pool.push({ channel: c, freeAt: -1, used: false });
  const trackById = new Map((sequence.tracks ?? []).map((t) => [t.id, t]));
  // bend allocation, in time order across the whole sequence
  const bendOf = new Map(); // note → { channel }
  const notesByTime = (sequence.notes ?? []).filter((n) => n.pitch != null && n.pitchCurve?.length && trackById.get(n.track)?.kind !== 'percussion').sort((a, b) => a.t - b.t);
  for (const n of notesByTime) {
    const on = Math.round(ticksAt(n.t)); const off = Math.max(on + 1, Math.round(ticksAt(n.t + n.duration)));
    const slot = pool.find((p) => p.freeAt < on);
    if (!slot) continue;
    slot.freeAt = off + 1; slot.used = true;
    bendOf.set(n, { channel: slot.channel, on, off });
  }
  const tracks = [finish(conductor)];
  const setup = [];
  for (const p of pool) {
    if (!p.used) continue;
    for (const [cc, v] of [[101, 0], [100, 0], [6, BEND_RANGE], [38, 0], [101, 127], [100, 127]]) push(setup, 0, [0xb0 | p.channel, cc, v], 0);
  }
  // the mixer: a muted track (or a track outside the solo set) is not exported; the volume of a pitched track is CC7, a percussion track (shared channel) scales its velocities
  const mixerOf = Object.fromEntries((sequence.tracks ?? []).map((t) => [t.id, t.mixer ?? {}]));
  for (const track of sequence.tracks ?? []) {
    if (!isAudibleTrack(mixerOf, track.id)) continue;
    const percussion = track.kind === 'percussion';
    const channel = channelOf.get(track.id);
    const volume = Math.min(1, Math.max(0, track.mixer?.volume ?? 1));
    const events = [];
    if (!percussion && volume < 1) push(events, 0, [0xb0 | channel, 7, Math.round(127 * Math.sqrt(volume))], 0);
    const panCc = (p) => Math.min(127, Math.max(0, Math.round(63.5 + 63.5 * Math.min(1, Math.max(-1, p))))); // −1 … +1 → CC10 0 … 127 (64 = centre)
    if (!percussion && (track.mixer?.pan ?? 0) !== 0) push(events, 0, [0xb0 | channel, 10, panCc(track.mixer.pan)], 0);
    // the volume and mute lanes of the track: CC7 along its gain curve (a ramp is sampled every 50 ms); percussion tracks share a channel and are left alone
    if (!percussion) {
      const lanes = {};
      for (const lane of sequence.automation ?? []) if (lane.track === track.id) lanes[lane.param] = lane.steps;
      const cc = (g) => Math.min(127, Math.max(0, Math.round(127 * Math.sqrt(Math.min(1, Math.max(0, g))))));
      for (const p of compileGain(lanes, track.mixer ?? { volume: 1 }, true)) {
        push(events, Math.round(ticksAt(p.t)), [0xb0 | channel, 7, cc(p.v)], 0.5);
        if (p.to) for (let t = p.t + 0.05; t < p.to.t - 1e-9; t += 0.05) push(events, Math.round(ticksAt(t)), [0xb0 | channel, 7, cc(p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t)))], 0.5);
      }
      // the controller lanes (expression CC11, reverb CC91, chorus CC93, brightness CC74, modulation CC1): the controller along the curve
      for (const [param, steps] of Object.entries(lanes)) {
        const spec = AUTOMATION_PARAMS[param];
        if (spec?.cc == null) continue;
        const cv = (v) => Math.min(127, Math.max(0, Math.round(127 * v)));
        for (const p of compileLane(steps, spec.rest)) {
          push(events, Math.round(ticksAt(p.t)), [0xb0 | channel, spec.cc, cv(p.v)], 0.5);
          if (p.to) for (let t = p.t + 0.05; t < p.to.t - 1e-9; t += 0.05) push(events, Math.round(ticksAt(t)), [0xb0 | channel, spec.cc, cv(p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t)))], 0.5);
        }
      }
      // the pan lane: CC10 along its curve
      for (const p of compilePan(lanes.pan, track.mixer ?? {})) {
        push(events, Math.round(ticksAt(p.t)), [0xb0 | channel, 10, panCc(p.v)], 0.5);
        if (p.to) for (let t = p.t + 0.05; t < p.to.t - 1e-9; t += 0.05) push(events, Math.round(ticksAt(t)), [0xb0 | channel, 10, panCc(p.v + (p.to.v - p.v) * ((t - p.t) / (p.to.t - p.t)))], 0.5);
      }
    }
    const name = text(track.name ?? '');
    push(events, 0, [0xff, 0x03, ...vlq(name.length), ...name]);
    const program = programOfTrack(track);
    if (!percussion) push(events, 0, [0xc0 | channel, program]);
    // technique texts (pizz., con sord.…) switch the program of the track at their instant (the catalogue channels of the instrument)
    const switches = [];
    for (const msg of percussion ? [] : sequence.messages ?? []) {
      if (msg.kind !== 'technique' || msg.track !== track.id || msg.t == null) continue;
      const p = techniqueProgram(track, msg.data?.technique);
      if (p != null) switches.push({ t: msg.t, program: p });
    }
    switches.sort((a, b) => a.t - b.t);
    for (const sw of switches) push(events, Math.round(ticksAt(sw.t)), [0xc0 | channel, sw.program], 1);
    const programAt = (t) => switches.reduce((acc, sw) => (sw.t <= t + 1e-9 ? sw.program : acc), program);
    for (const n of sequence.notes ?? []) {
      if (n.track !== track.id || n.pitch == null) continue;
      const bend = bendOf.get(n);
      const ch = bend ? bend.channel : channel;
      const on = bend ? bend.on : Math.round(ticksAt(n.t));
      const off = bend ? bend.off : Math.max(on + 1, Math.round(ticksAt(n.t + n.duration)));
      const pitch = Math.min(127, Math.max(0, Math.round(n.pitch)));
      const velocity = Math.min(127, Math.max(1, Math.round((n.velocity ?? 64) * (percussion ? Math.sqrt(volume) : 1))));
      if (bend) {
        push(events, on, [0xc0 | ch, programAt(n.t)], 1);
        if (volume < 1) push(events, on, [0xb0 | ch, 7, Math.round(127 * Math.sqrt(volume))], 0);
        push(events, on, [0xe0 | ch, wheel(n.pitchCurve[0].semitones) & 0x7f, wheel(n.pitchCurve[0].semitones) >> 7], 2);
        const times = new Set(n.pitchCurve.map((pt) => pt.t).filter((t) => t > n.t && t < n.t + n.duration));
        for (let t = n.t + BEND_STEP; t < n.t + n.duration; t += BEND_STEP) times.add(t);
        let lastWheel = wheel(n.pitchCurve[0].semitones); let lastTick = on;
        for (const t of [...times].sort((a, b) => a - b)) {
          const tick = Math.round(ticksAt(t)); const v = wheel(curveAt(n.pitchCurve, t));
          if (tick <= lastTick || tick >= off || v === lastWheel) continue;
          push(events, tick, [0xe0 | ch, v & 0x7f, v >> 7], 2);
          lastWheel = v; lastTick = tick;
        }
        push(events, off, [0x80 | ch, pitch, 0], 1);
        push(events, off, [0xe0 | ch, 0x00, 0x40], 1.5); // wheel back to centre after the note
      } else {
        push(events, on, [0x90 | ch, pitch, velocity], 3);
        push(events, off, [0x80 | ch, pitch, 0], 1);
        continue;
      }
      push(events, on, [0x90 | ch, pitch, velocity], 3);
    }
    for (const m of sequence.messages ?? []) {
      if (m.kind !== 'controller' || m.track !== track.id || !m.data) continue;
      push(events, Math.round(ticksAt(m.t)), [0xb0 | channel, m.data.number & 0x7f, Math.min(127, Math.max(0, Math.round(m.data.value)))]);
    }
    tracks.push(finish(events));
  }
  
  if (setup.length) tracks.splice(1, 0, finish(setup));
  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(ppq)]);
  return Uint8Array.from([...header, ...tracks.flat()]);
}
