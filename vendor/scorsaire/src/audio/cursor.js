/*
 * Curseur : passage entre SECONDES de lecture et POSITION dans la partition, à partir d'une séquence (`sequence.js`) seulement — sans relire le
 * modèle. Utilise la table de tempo de la séquence (pas de marche constante, `wps` = rondes par seconde JOUÉES, 0 pendant une pause) et les
 * créneaux (un par mesure jouée, dans l'ordre de lecture).
 * Les positions sont des fractions exactes de ronde depuis le début du contenu de la mesure (arrondies au tick de 960 par noire, la précision
 * d'un curseur) ; les secondes ne sont que des nombres décimaux.
 */
import { frac, fToNumber, ZERO } from '../model/fraction.js';

const TICKS_PER_WHOLE = 960 * 4;

function stepsWithin(steps, from, to) {
  const out = [];
  let current = steps[0]?.wps ?? 0;
  for (const s of steps) {
    if (s.t <= from) current = s.wps;
    else if (s.t < to) out.push(s);
  }
  return { start: current, inner: out };
}

/** Rondes avancées entre deux instants de lecture (intégrale du tempo). */
export function advanced(steps, from, to) {
  const { start, inner } = stepsWithin(steps, from, to);
  let wps = start;
  let t = from;
  let total = 0;
  for (const s of inner) {
    total += (s.t - t) * wps;
    t = s.t;
    wps = s.wps;
  }
  return total + (to - t) * wps;
}

/**
 * Où en est la partition à l'instant `seconds` ?
 * @returns {{ slot: number, movement: number, measure: number, position: fraction } | null}  null si la séquence n'a aucun créneau.
 */
export function locate(sequence, seconds) {
  const { slots, tempo } = sequence;
  if (!slots.length) return null;
  let k = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].t <= seconds) k = i; else break;
  }
  const slot = slots[k];
  const to = Math.min(seconds, slot.end);
  const whole = Math.max(0, advanced(tempo.steps, slot.t, to));
  const ticks = Math.round(whole * TICKS_PER_WHOLE);
  return { slot: k, movement: slot.movement, measure: slot.measure, position: ticks === 0 ? ZERO : frac(ticks, TICKS_PER_WHOLE) };
}

/**
 * Secondes de lecture d'une position (mesure d'un Mouvement + fraction depuis le début du contenu), pour la `occurrence`-ième fois qu'elle est
 * jouée (0 = la première ; reprises et sauts la font rejouer). `null` si la mesure n'est pas jouée ou si la position dépasse la mesure.
 */
export function secondsOf(sequence, movement, measure, position = ZERO, occurrence = 0) {
  const { slots, tempo } = sequence;
  const matching = slots.filter((s) => s.movement === movement && s.measure === measure);
  const slot = matching[occurrence];
  if (!slot) return null;
  const target = fToNumber(position);
  const { start, inner } = stepsWithin(tempo.steps, slot.t, slot.end);
  let wps = start;
  let t = slot.t;
  let remaining = target;
  for (const s of inner) {
    const gained = (s.t - t) * wps;
    if (wps > 0 && remaining <= gained + 1e-12) return t + remaining / wps;
    remaining -= gained;
    t = s.t;
    wps = s.wps;
  }
  if (wps > 0 && t + remaining / wps <= slot.end + 1e-9) return t + remaining / wps;
  return null;
}
