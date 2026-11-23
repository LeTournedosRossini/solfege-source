/*
 * Piste « Paroles » à événements (staffType 'lyrics', élément `lyricevent`) : des syllabes posées à un INSTANT exact, sur une ou plusieurs lignes.
 *  - `lyricEventsOf(staff)` : les événements d'une portée, à plat.
 *  - `snapPosition(p, length)` : un instant (en rondes depuis le début de la mesure) → la fraction exacte où on le pose : la double-croche la plus proche, sauf quand une
 *    grille de triolet colle nettement mieux (le chant n'est pas tapé au métronome : une syllabe à 10 ms d'un triolet n'en devient pas un).
 *  - `placeSyllables(syllables, map, lengths)` : des syllabes datées en secondes [{ text, time, line? }] → [{ measure, position, text, line }] par la carte de temps d'un
 *    enregistrement (audio/syncmap.js) ; une syllabe qui tombe hors de la carte est ignorée.
 *  - `lyricsTrackFor(events, count, { name })` : la piste (pure, hors document) ; `addLyricsTrackIntent(doc, …)` : la même, ajoutée au document (annulable).
 * PURE (pas de DOM).
 */
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { frac, fToNumber } from './fraction.js';
import { createLyricEvent, createStaff, createTrack, createVoice, createMeasure } from './elements.js';

/** Les événements d'une portée « paroles » : [{ item, measure (indice), position, text, line, target }] dans l'ordre de la partition. */
export function lyricEventsOf(staff) {
  const out = [];
  for (const voice of staff.voices ?? []) {
    (voice.measures ?? []).forEach((measure, mi) => {
      for (const item of measure.items ?? []) {
        if (item.type !== 'lyricevent') continue;
        out.push({ item, measure: mi, position: getProperty(item, PID.POSITION), text: getProperty(item, PID.TEXT) ?? '', line: getProperty(item, PID.LYRIC_LINE) ?? 0, target: getProperty(item, PID.LYRIC_TARGET) ?? null });
      }
    });
  }
  return out;
}

const SIXTEENTH = 16; // grille par défaut : 16 divisions de la ronde
const TRIPLET = 12; // grille de triolet de croches : 12 divisions de la ronde
const TRIPLET_MARGIN = 1 / 200; // en rondes : le triolet doit gagner d'au moins ça sur la double-croche pour être choisi

/** Instant `p` (en rondes depuis le début de la mesure de longueur `length`, fraction) → la fraction exacte où le poser. */
export function snapPosition(p, length) {
  const limit = fToNumber(length);
  const best = (div) => { const n = Math.round(p * div); return { n, div, err: Math.abs(p - n / div) }; };
  const a = best(SIXTEENTH); const b = best(TRIPLET);
  const pick = b.err + TRIPLET_MARGIN < a.err ? b : a;
  const value = pick.n / pick.div;
  if (value >= limit - 1e-9) return null; // rounded onto the end of the measure: the caller puts it on the next one
  return frac(Math.max(0, pick.n), pick.div);
}

/**
 * @param syllables [{ text, time (s), line? }]
 * @param map       sync map (`createSyncMap`): `locate(time)` → { measure, ratio, before, after }
 * @param lengths   length of each measure, as fractions (whole notes)
 */
export function placeSyllables(syllables, map, lengths) {
  const out = []; const taken = new Set();
  for (const s of syllables) {
    const text = String(s.text ?? '').trim();
    if (!text || !Number.isFinite(s.time)) continue;
    const at = map.locate(s.time);
    if (at.before || at.after) continue;
    let measure = at.measure;
    let position = snapPosition(at.ratio * fToNumber(lengths[measure]), lengths[measure]);
    if (position === null) { measure += 1; position = frac(0, 1); } // closer to the next bar line than to the last grid point of its own measure
    if (measure >= lengths.length) continue;
    // two syllables on the same instant of the same line would be drawn on each other: the later one moves to the next sixteenth (or the next measure)
    const key = (m, p) => `${m}|${p[0]}/${p[1]}|${s.line ?? 0}`;
    while (taken.has(key(measure, position))) {
      const next = snapPosition(fToNumber(position) + 1 / SIXTEENTH, lengths[measure]);
      if (next === null) { measure += 1; position = frac(0, 1); if (measure >= lengths.length) break; } else position = next;
    }
    if (measure >= lengths.length) continue;
    taken.add(key(measure, position));
    out.push({ measure, position, text, line: s.line ?? 0 });
  }
  return out;
}

/** A track made only of lyrics staves: it makes no sound, so it has no volume, no mute / solo, no automation, and is not in the mixer. */
export const isLyricsTrack = (track) => (track?.staves?.length ?? 0) > 0 && track.staves.every((s) => getProperty(s, PID.STAFF_TYPE) === 'lyrics');

/** The track (outside any document): one staff of type 'lyrics' with `count` measures holding the events ({ measure, position, text, line?, target? }). */
export function lyricsTrackFor(events, count, { name = 'Paroles' } = {}) {
  const byMeasure = Array.from({ length: count }, () => []);
  for (const e of events) if (e.measure >= 0 && e.measure < count) byMeasure[e.measure].push(createLyricEvent({ text: e.text, position: e.position, line: e.line ?? 0, target: e.target ?? null }));
  const measures = byMeasure.map((items) => createMeasure(items.sort((x, y) => fToNumber(getProperty(x, PID.POSITION)) - fToNumber(getProperty(y, PID.POSITION)))));
  return createTrack({ name, abbreviation: '', staves: [createStaff({ type: 'lyrics', clef: 'G', voices: [createVoice(measures)] })] });
}

/** Adds a lyrics track to a movement of an open document (one edit that can be undone); `at` = its index among the tracks (default: last). */
export function addLyricsTrackIntent(doc, { events = [], name = 'Paroles', movement = 0, at } = {}) {
  const mv = doc.work.movements[movement];
  const track = lyricsTrackFor(events, mv.masterbars.length, { name });
  doc.add(mv, 'tracks', track, at);
  return track;
}
