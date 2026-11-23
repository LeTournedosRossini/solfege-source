// Grattage d'accords : interpréteur PUR (sans DOM, sans modèle de document) qui transforme un rythme de coups de médiator + l'accord en vigueur en
// notes datées, corde par corde. Aucune référence MuseScore (il n'a pas de grattage) : les valeurs par défaut sont des choix de Scorsaire, à régler à l'oreille.
//
// Entrées (déjà résolues par l'appelant, `sequence.js`) :
//   - un doigté (`voicing` de `fretvoicing.js` : guitare, ukulélé, basse, piano…) ou, à défaut, une liste de hauteurs ;
//   - des évènements du rythme : coups (`chord`) et silences (`rest`), datés en secondes, avec leurs signes (`pickDown` / `pickUp`) ;
//   - une fonction `chordAt(t)` : accord en vigueur à la date t, avec la date du changement suivant.
// « Mode ouvert » : l'instrument du doigté (guitare 6 cordes, ukulélé, basse, piano…) est INDÉPENDANT du son joué : le son vient de la piste, donc des notes
// de guitare peuvent sonner avec un piano si la SoundFont n'a pas de guitare.
import { isPiano, voicingPitches } from '../model/fretvoicing.js';

export const STRUM_DIRECTIONS = Object.freeze(['down', 'up']);
export const STRUM_PATTERNS = Object.freeze(['down', 'alternate']);

export const STRUM_DEFAULTS = Object.freeze({
  /** coup sans signe : 'down' (toujours bas) | 'alternate' (bas sur les temps, haut sur les contretemps) */
  pattern: 'down',
  /** délai entre deux cordes, en ms ; null = automatique d'après le tempo */
  delayMs: null,
  /** nombre de cordes aiguës jouées par un coup haut */
  upStrings: 4,
  /** vélocité relative d'un coup bas */
  downVelocity: 1,
  /** vélocité relative d'un coup haut */
  upVelocity: 0.9,
  /** décroissance de vélocité de chaque corde suivante d'un coup (0,03 = −3 % par corde) */
  fall: 0.03,
  /** durée d'une note de coup étouffé, en secondes */
  mutedDuration: 0.06,
  /** vélocité relative d'un coup étouffé */
  mutedVelocity: 0.6,
  /** 1 = a single note per stroke, the lowest of the fingering (a bass guitar plays one note at a time) */
  singleNote: 0,
});

/** Délai entre cordes automatique (ms) : environ 14 ms à 120 à la noire, plus court quand le tempo monte, borné à 5-30 ms. */
export function autoDelayMs(bpm) {
  if (!(bpm > 0)) return 14;
  return Math.max(5, Math.min(30, Math.round((14 * 120) / bpm)));
}

/** Cordes d'un doigté dans l'ordre des cordes (la plus grave d'abord pour une guitare) : [{ index, pitch }] sans les cordes étouffées. Piano : par hauteur croissante. */
export function voicingStrings(voicing) {
  if (!voicing) return [];
  if (isPiano(voicing)) return [...voicing.notes].sort((a, b) => a - b).map((pitch, index) => ({ index, pitch }));
  return voicingPitches(voicing).map((pitch, index) => ({ index, pitch })).filter((s) => s.pitch !== null);
}

/** Sens d'un coup : le signe de médiator l'emporte ; sinon le motif choisi (`offbeat` = le coup tombe sur un contretemps). */
export function strokeDirection(articulations, { offbeat = false, pattern = STRUM_DEFAULTS.pattern } = {}) {
  if (articulations?.includes('pickUp')) return 'up';
  if (articulations?.includes('pickDown')) return 'down';
  return pattern === 'alternate' && offbeat ? 'up' : 'down';
}

/**
 * Notes d'UN coup.
 * @param p { strings: [{ index, pitch }], direction, muted, delayMs, upStrings, upVelocity, fall, mutedDuration, mutedVelocity, start, duration }
 *   `start` date du coup (s), `duration` durée jusqu'au coup suivant ou au changement d'accord (s).
 * @returns {{ pitch, t, duration, velocity }[]}  `velocity` = facteur 0-1 (le coup bas, première corde = 1) ; l'appelant le combine à la nuance.
 */
export function strokeNotes(p) {
  const o = { ...STRUM_DEFAULTS, ...p };
  if (!(o.duration > 0)) return [];
  let strings = [...o.strings];
  if (o.direction === 'up') strings = strings.slice(-Math.max(1, o.upStrings)).reverse(); // les cordes aiguës, de l'aiguë à la grave
  const delay = (o.delayMs ?? 14) / 1000;
  const base = (o.direction === 'up' ? o.upVelocity : o.downVelocity) * (o.muted ? o.mutedVelocity : 1);
  const out = [];
  strings.forEach((s, i) => {
    const offset = Math.min(i * delay, o.duration * 0.5); // un coup très court reste dans sa durée
    const length = o.muted ? Math.min(o.mutedDuration, o.duration - offset) : o.duration - offset;
    if (!(length > 0)) return;
    out.push({ pitch: s.pitch, t: o.start + offset, duration: length, velocity: Math.max(0.05, base * (1 - o.fall * i)), string: s.index });
  });
  return out;
}

/**
 * Plan de grattage d'une portée rythmique.
 * @param events  [{ t, kind: 'chord' | 'rest', articulations?, offbeat?, muted?, id? }] triés par date (s)
 * @param ctx     { chordAt(t) → { voicing | pitches, until } | null, end (s : fin de la portée), bpmAt?(t), options }
 *   `chordAt(t).until` = date du changement d'accord suivant (null = jamais) ; `voicing` ou `pitches` ([ hauteurs ] jouées de la grave à l'aiguë).
 * @returns les notes de tous les coups, avec `event` (id de l'évènement d'origine)
 *   Le coup tient jusqu'à l'évènement suivant (coup ou silence), au changement d'accord ou à la fin ; l'accord est celui du DÉBUT du coup.
 */
export function planStrum(events, ctx) {
  const options = { ...STRUM_DEFAULTS, ...(ctx.options ?? {}) };
  const out = [];
  events.forEach((ev, i) => {
    if (ev.kind !== 'chord') return;
    const chord = ctx.chordAt(ev.t);
    if (!chord) return;
    let strings = chord.voicing ? voicingStrings(chord.voicing) : (chord.pitches ?? []).map((pitch, index) => ({ index, pitch }));
    if (options.singleNote) strings = strings.slice(0, 1);
    if (!strings.length) return;
    let end = events[i + 1]?.t ?? ctx.end;
    if (chord.until != null && chord.until < end) end = chord.until;
    const direction = strokeDirection(ev.articulations, { offbeat: ev.offbeat, pattern: options.pattern });
    const delayMs = options.delayMs ?? autoDelayMs(ev.bpm ?? ctx.bpmAt?.(ev.t));
    for (const n of strokeNotes({ ...options, strings, direction, muted: !!ev.muted, delayMs, start: ev.t, duration: end - ev.t })) out.push({ ...n, direction, event: ev.id ?? null });
  });
  return out;
}
