/*
 * General MIDI program of a track, for the SoundFont engine and the MIDI export. The instrument of the catalogue (`PID.INSTRUMENT_ID`, MuseScore's
 * `instruments.xml`) gives its own program (e.g. violin 40, flute 73, trumpet 56); a track without a catalogue instrument (or one the catalogue gives no
 * program for) falls back to the program of its timbre family (`synth.js`: keyboard, plucked, bowed, woodwind, brass, voice).
 */
import { instrumentInfo } from '../model/instruments.js';
import { timbreOf } from './synth.js';

/** Program of each timbre family, used when the catalogue has none. */
export const PROGRAM_OF_TIMBRE = Object.freeze({ keyboard: 0, plucked: 24, bowed: 48, woodwind: 73, brass: 56, voice: 52, percussion: 0 });

/** @param track a track of a sequence: { instrumentId, kind, family } → GM program 0-127 */
export function programOfTrack(track) {
  const p = instrumentInfo(track?.instrumentId)?.program;
  if (Number.isInteger(p) && p >= 0 && p <= 127) return p;
  return PROGRAM_OF_TIMBRE[timbreOf(track)] ?? 0;
}

/** Playing modes of a note (`mode` of a sequence note) → the NAME of the MuseScore channel of the instrument that plays it. */
export const MODE_CHANNEL = Object.freeze({ slap: 'slap', pop: 'pop', mute: 'mute', harmonics: 'harmonics' });

/**
 * GM program of the channel of that name of the instrument (e.g. a bass: slap 36, pop 37; a guitar: mute 28, harmonics 31), or null when the instrument
 * has none (the note then plays with the normal sound). MuseScore itself does not switch channels on these marks (only its text techniques and its palm
 * mute line, whose channel "palmmute" no instrument defines): linking them is a choice of Scorsaire, using the channels the catalogue already names.
 */
export function modeProgram(track, mode) {
  const name = MODE_CHANNEL[mode];
  if (!name) return null;
  const p = instrumentInfo(track?.instrumentId)?.channels?.[name];
  return Number.isInteger(p) && p >= 0 && p <= 127 ? p : null;
}

/**
 * Playing-technique texts (`model/techniques.js`) → the NAME of the MuseScore channel of the instrument that plays it (`instruments.xml`: arco, pizzicato,
 * mute, open…). Techniques with no channel in MuseScore (col legno, sul pont., sul tasto, flz., solo, tutti) change nothing.
 */
export const TECHNIQUE_CHANNEL = Object.freeze({ pizz: 'pizzicato', arco: 'arco', conSord: 'mute', senzaSord: 'open' });

/** GM programs for a track WITHOUT a catalogue channel of that name, by timbre family (Scorsaire's own choice, not MuseScore's). */
const FALLBACK = Object.freeze({ bowed: { pizz: 45 }, brass: { conSord: 59 } });

/**
 * Program that a technique text switches a track to, or null when it changes nothing. `ord.` and the "back to normal" techniques (arco, senza sord.)
 * return the normal program when the instrument has no channel of that name, so a `pizz.` can always be undone.
 */
export function techniqueProgram(track, techniqueId) {
  if (techniqueId === 'ord') return programOfTrack(track);
  const name = TECHNIQUE_CHANNEL[techniqueId];
  if (!name) return null;
  const own = instrumentInfo(track?.instrumentId)?.channels?.[name];
  if (Number.isInteger(own) && own >= 0 && own <= 127) return own;
  const fallback = FALLBACK[timbreOf(track)]?.[techniqueId];
  if (fallback !== undefined) return fallback;
  return techniqueId === 'arco' || techniqueId === 'senzaSord' ? programOfTrack(track) : null;
}
