/*
 * Fretboard lit during the playback: for ONE track chosen by the user, the notes sounding at the playback position are lit at the positions the score
 * gives (tablature notes, notation notes with a string hint) or, failing that, at the positions `assignPositions` computes for the whole track
 * (optimal path through the successive chords). `trackChoices`, `chooseTrack`, `tuningFor` and `prepareTrack` are PURE (tested without a browser).
 */
import { isAudibleTrack } from '../audio/mixer.js';
import { instrumentInfo } from '../model/instruments.js';
import { FRETBOARD_INSTRUMENTS, assignPositions, knownStringCount, applyPreset } from '../model/fretboardmap.js';

/** Pitched tracks of a sequence: [{ id, name, instrumentId }]. */
export function trackChoices(sequence) {
  return (sequence?.tracks ?? []).filter((t) => t.kind !== 'percussion').map((t) => ({ id: t.id, name: t.name || t.id, instrumentId: t.instrumentId ?? null }));
}

const STRINGED = /guitar|bass|ukulele|banjo|mandolin|lute|oud|bouzouki|cittern|charango|cavaquinho|dobro|steel/;
/** Default track: the one with the most known strings (tablature), else a stringed instrument, else the first pitched track. */
export function chooseTrack(sequence) {
  const choices = trackChoices(sequence); if (!choices.length) return null;
  const counts = new Map();
  for (const n of sequence.notes ?? []) if (n.string != null) counts.set(n.track, (counts.get(n.track) ?? 0) + 1);
  let best = null;
  for (const c of choices) if ((counts.get(c.id) ?? 0) > (counts.get(best) ?? 0)) best = c.id;
  if (best && counts.get(best)) return best;
  return (choices.find((c) => STRINGED.test(c.instrumentId ?? '')) ?? choices[0]).id;
}

/**
 * Tuning to use for a track. `choice` = 'auto' (the tuning of the track's tablature staff when the sequence carries it, else the catalogue's strings when
 * the instrument has 4 to 8 of them), or a key of FRETBOARD_INSTRUMENTS; `preset` (model/fretboardmap.js TUNING_PRESETS) then shifts the strings.
 * `trackInfo` = the track entry of the sequence ({ tuning, frets, instrumentId }).
 */
export function tuningFor(choice, instrumentId, { preset = 'standard', trackInfo = null } = {}) {
  let base;
  if (choice && choice !== 'auto' && FRETBOARD_INSTRUMENTS[choice]) base = { ...FRETBOARD_INSTRUMENTS[choice], key: choice };
  else if (trackInfo?.tuning?.length >= 3) base = { strings: [...trackInfo.tuning], frets: trackInfo.frets ?? 22, key: `tab:${trackInfo.tuning.join(',')}` };
  else {
    const info = instrumentInfo(instrumentId);
    if (info?.strings?.length >= 4 && info.strings.length <= 8) base = { strings: [...info.strings], frets: info.frets ?? 22, key: `catalog:${instrumentId}` };
    else base = { ...FRETBOARD_INSTRUMENTS.guitar, key: 'guitar' };
  }
  if (!preset || preset === 'standard') return base;
  const strings = applyPreset(base.strings, preset);
  return strings.every((m, i) => m === base.strings[i]) ? base : { ...base, strings, key: `${base.key}+${preset}` };
}

/**
 * Notes of a track with their positions on the neck, sorted by start, each with the CONTEXT in force at it (strings of the tuning, capo): the tuning of a
 * note is the one the score wrote at that point (`note.tuning`, lowest first) else the track's; `string` hints (1 = highest) become indices from the lowest
 * string of that tuning. Positions are searched run by run (a run = consecutive notes with the same context), so the search never mixes two tunings.
 */
export function prepareTrack(sequence, trackId, tuning, { limit = 0, preset = 'standard' } = {}) {
  const raw = (sequence?.notes ?? []).filter((x) => x.track === trackId && Number.isFinite(x.pitch) && x.duration > 0);
  raw.sort((a, b) => a.t - b.t);
  const contexts = new Map();
  const contextOf = (x) => {
    const strings = x.tuning ? applyPreset(x.tuning, preset) : tuning.strings;
    const n = strings.length;
    const capo = x.capo ? { fret: x.capo.fret, ignored: x.capo.ignored.map((hs) => n - hs).filter((i) => i >= 0 && i < n) } : null;
    const key = `${strings.join(',')}|${capo ? `${capo.fret}:${capo.ignored.join('.')}` : '-'}`;
    if (!contexts.has(key)) contexts.set(key, { key, strings, frets: tuning.frets, capo });
    return contexts.get(key);
  };
  const base = { key: `${tuning.strings.join(',')}|-`, strings: tuning.strings, frets: tuning.frets, capo: null };
  contexts.set(base.key, base);
  const notes = []; let maxDuration = 0; let known = 0;
  for (let i = 0; i < raw.length;) {
    const ctx = contextOf(raw[i]); let j = i;
    while (j < raw.length && contextOf(raw[j]) === ctx) j += 1;
    const n = ctx.strings.length;
    const run = raw.slice(i, j).map((x) => ({ pitch: x.pitch, t: x.t, string: x.string != null && x.string <= n ? n - x.string : null }));
    known += knownStringCount(run);
    const pos = assignPositions(run, { strings: ctx.strings, frets: ctx.frets, limit, capo: ctx.capo ? { fret: ctx.capo.fret, ignored: new Set(ctx.capo.ignored) } : null });
    raw.slice(i, j).forEach((x, k) => { if (!pos[k]) return; notes.push({ pitch: x.pitch, t: x.t, duration: x.duration, velocity: x.velocity, pos: pos[k], ctx }); if (x.duration > maxDuration) maxDuration = x.duration; });
    i = j;
  }
  return { notes, maxDuration, known, tuning, base };
}

/** The context (tuning, capo) the board shows at `position`: the one of the latest note started by then, else the track's own. */
export function contextAt(prepared, position) {
  const { notes } = prepared;
  let lo = 0; let hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t <= position) lo = mid + 1; else hi = mid; }
  return lo > 0 ? notes[lo - 1].ctx : prepared.base;
}

/** Map pitch → { velocity, pos } of the loudest note sounding at `position` (start included, end excluded). */
export function activeNotes(prepared, position, trackAudible = true) {
  const out = new Map();
  if (!trackAudible) return out;
  const { notes, maxDuration } = prepared;
  let lo = 0; let hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t <= position) lo = mid + 1; else hi = mid; }
  for (let i = lo - 1; i >= 0; i--) {
    const x = notes[i];
    if (x.t < position - maxDuration) break;
    if (position >= x.t + x.duration) continue;
    if ((out.get(x.pitch)?.velocity ?? 0) < x.velocity) out.set(x.pitch, { velocity: x.velocity, pos: x.pos });
  }
  return out;
}

/**
 * @param o.board    the fretboard (`noteOn(midi, velocity, color, pos)`, `noteOff`, `allNotesOff`, `setTuning`)
 * @param o.settings () → { track: 'auto' | trackId, instrument: 'auto' | key, preset, limit (0 = free, else the first frets preferred) }
 */
export function createGuitarFollow({ board, settings = () => ({ track: 'auto', instrument: 'auto', preset: 'standard', limit: 0 }), enabled = () => true }) {
  let unsubscribe = null; let player = null; let preparedFor = null; let prepared = null; let key = ''; let usedTrack = null; let usedTuning = null;
  let lit = new Set(); let boardKey = null; let locked = false;
  /** Puts the board in the tuning and capo of a context (clears what is lit: the positions belonged to the old one). */
  const applyContext = (ctx) => { if (locked || ctx.key === boardKey) return; board.setTuning({ strings: ctx.strings, frets: ctx.frets }); board.setCapo?.(ctx.capo); boardKey = ctx.key; lit = new Set(); };
  const clear = () => { for (const m of lit) board.noteOff(m); lit = new Set(); };
  /** Track and tuning in force for the sequence (the board is re-tuned when they change). */
  function resolve(sequence) {
    const s = settings();
    const choices = trackChoices(sequence);
    const track = s.track && s.track !== 'auto' && choices.some((c) => c.id === s.track) ? s.track : chooseTrack(sequence);
    const instrumentId = choices.find((c) => c.id === track)?.instrumentId ?? null;
    const trackInfo = (sequence?.tracks ?? []).find((t) => t.id === track) ?? null;
    return { track, tuning: tuningFor(s.instrument, instrumentId, { preset: s.preset, trackInfo }), limit: s.limit || 0 };
  }
  function ensure(sequence) {
    const { track, tuning, limit } = resolve(sequence);
    const k = `${track}|${tuning.key}|${limit}`;
    if (sequence === preparedFor && k === key) return true;
    if (!track) { prepared = null; preparedFor = sequence; key = k; return false; }
    prepared = prepareTrack(sequence, track, tuning, { limit, preset: settings().preset }); applyContext(prepared.base); preparedFor = sequence; key = k; usedTrack = track; usedTuning = tuning;
    return true;
  }
  function onState(state) {
    if (!enabled() || !state.playing) { if (lit.size) clear(); return; }
    const sequence = player?.sequence?.(); if (!sequence || !ensure(sequence) || !prepared) return;
    applyContext(contextAt(prepared, state.position));
    const mixer = Object.fromEntries((sequence.tracks ?? []).map((t) => [t.id, t.mixer ?? {}]));
    const now = activeNotes(prepared, state.position, isAudibleTrack(mixer, usedTrack));
    for (const m of [...lit]) if (!now.has(m)) { board.noteOff(m); lit.delete(m); }
    for (const [midi, { velocity, pos }] of now) { if (lit.has(midi)) continue; board.noteOn(midi, velocity, null, pos); lit.add(midi); }
  }
  return {
    attach(next) { unsubscribe?.(); clear(); player = next; preparedFor = null; key = ''; boardKey = null; unsubscribe = player?.subscribe(onState) ?? null; },
    detach() { unsubscribe?.(); unsubscribe = null; player = null; clear(); },
    /** While a note is entered the board shows the staff the notes go to (the caller sets its tuning and capo): playback no longer re-tunes it. */
    lock() { locked = true; clear(); },
    unlock() { if (!locked) return; locked = false; this.refresh(); },
    /** The user changed the track or the instrument: re-prepare and redraw. */
    refresh() {
      preparedFor = null; key = ''; boardKey = null; clear();
      const st = player?.state?.(); if (st) onState(st);
      const sequence = player?.sequence?.();
      if (sequence) { ensure(sequence); return; }
      // no sequence yet (nothing played): show the tuning the choices give without a track
      const t = tuningFor(settings().instrument, null, { preset: settings().preset });
      applyContext({ key: `${t.strings.join(',')}|-`, strings: t.strings, frets: t.frets, capo: null }); usedTuning = t;
    },
    /** Choices for the menu (pure data): the tracks of the current sequence. */
    tracks: () => trackChoices(player?.sequence?.()),
    /** The tuning the board shows for the current sequence (without lighting anything), or null. */
    current() { const seq = player?.sequence?.(); return seq ? resolve(seq) : null; },
  };
}
