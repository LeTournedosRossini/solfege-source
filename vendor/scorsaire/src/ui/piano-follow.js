/*
 * Touches allumées pendant la lecture : à chaque pas du lecteur, les notes de la séquence qui sonnent à la position courante sont allumées sur le
 * clavier à l'écran (`piano-keyboard.js`), les autres éteintes. Une piste muette (ou hors solo) n'allume rien ; la percussion non plus (pas de hauteur).
 * `prepareNotes` et `activePitches` sont PURS (testés sans navigateur) ; `createPianoFollow` fait le lien avec un clavier et un lecteur.
 */
import { isAudibleTrack } from '../audio/mixer.js';

/** The pitched notes of a sequence sorted by start, with the extent of the piece. */
export function prepareNotes(sequence) {
  const drums = new Set((sequence?.tracks ?? []).filter((t) => t.kind === 'percussion').map((t) => t.id)); // a drum note carries the MIDI number of its sound, not a pitch
  const notes = (sequence?.notes ?? []).filter((n) => Number.isFinite(n.pitch) && n.duration > 0 && !drums.has(n.track)).sort((a, b) => a.t - b.t);
  let maxDuration = 0; let lo = Infinity; let hi = -Infinity;
  for (const n of notes) { if (n.duration > maxDuration) maxDuration = n.duration; if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; }
  return { notes, maxDuration, lo: notes.length ? lo : null, hi: notes.length ? hi : null };
}

/** Map pitch → { velocity, track } of the loudest note sounding at `position` seconds on that pitch (start included, end excluded). */
export function activePitches(prepared, position, mixer = null) {
  const out = new Map();
  const { notes, maxDuration } = prepared;
  // first note starting after the position
  let lo = 0; let hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t <= position) lo = mid + 1; else hi = mid; }
  for (let i = lo - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.t < position - maxDuration) break;
    if (position >= n.t + n.duration) continue;
    if (mixer && !isAudibleTrack(mixer, n.track)) continue;
    if ((out.get(n.pitch)?.velocity ?? 0) < n.velocity) out.set(n.pitch, { velocity: n.velocity, track: n.track });
  }
  return out;
}

/** Distinct, readable colours for the keys lit by different tracks (the order of the tracks of the sequence). */
export const TRACK_PALETTE = Object.freeze(['#e5534b', '#3b82f6', '#16a34a', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b']);
/** Colour of each pitched track of a sequence (by its order among the tracks), or null when none. */
export function trackColors(sequence) {
  const out = new Map(); let i = 0;
  for (const t of sequence?.tracks ?? []) { if (t.kind === 'percussion') continue; out.set(t.id, TRACK_PALETTE[i % TRACK_PALETTE.length]); i += 1; }
  return out;
}

const mixerOf = (sequence) => Object.fromEntries((sequence?.tracks ?? []).map((t) => [t.id, t.mixer ?? {}]));

/**
 * @param o.keyboard  the keyboard (`noteOn`, `noteOff`, `allNotesOff`, `fitRange`, `getKeys`)
 * @param o.enabled   () → true when the keys must follow the playback
 * @param o.byTrack   () → true when each track lights its keys in its own colour (`trackColors`), false = the keyboard's own colour
 */
export function createPianoFollow({ keyboard, enabled = () => true, byTrack = () => false }) {
  let unsubscribe = null; let player = null;
  let preparedFor = null; let prepared = null; let mixer = null; let colors = new Map();
  let lit = new Map(); let wasPlaying = false;
  const clear = () => { for (const midi of lit.keys()) keyboard.noteOff(midi); lit = new Map(); };
  const fitIfNeeded = () => {
    if (!prepared || prepared.lo == null) return;
    const { count, startMidi } = keyboard.getKeys();
    if (prepared.lo < startMidi || prepared.hi > startMidi + count - 1) keyboard.fitRange(prepared.lo, prepared.hi);
  };
  function onState(state) {
    if (!enabled() || !state.playing) { if (lit.size) clear(); wasPlaying = false; return; }
    const sequence = player?.sequence?.();
    if (!sequence) return;
    if (sequence !== preparedFor) { preparedFor = sequence; prepared = prepareNotes(sequence); mixer = mixerOf(sequence); colors = trackColors(sequence); }
    if (!wasPlaying) { wasPlaying = true; fitIfNeeded(); }
    const now = activePitches(prepared, state.position, mixer);
    const tint = byTrack();
    for (const [midi, held] of [...lit]) if (!now.has(midi) || (tint ? colors.get(now.get(midi).track) ?? null : null) !== held.color) { keyboard.noteOff(midi); lit.delete(midi); }
    for (const [midi, { velocity, track }] of now) {
      if (lit.has(midi)) continue;
      const color = tint ? colors.get(track) ?? null : null;
      keyboard.noteOn(midi, velocity, color); lit.set(midi, { velocity, color });
    }
  }
  return {
    /** Follows a player (the previous one is left). */
    attach(next) { unsubscribe?.(); clear(); player = next; preparedFor = null; wasPlaying = false; unsubscribe = player?.subscribe(onState) ?? null; },
    detach() { unsubscribe?.(); unsubscribe = null; player = null; clear(); },
    /** Redraws the lit keys now (the colour mode changed). */
    refresh() { if (player) { const st = player.state?.(); if (st) { clear(); onState(st); } } },
    /** Re-fits the keyboard to the whole piece (the extent of the pitched notes). */
    fit() { const seq = player?.sequence?.(); if (!seq) return false; const p = prepareNotes(seq); if (p.lo == null) return false; keyboard.fitRange(p.lo, p.hi); return true; },
  };
}
