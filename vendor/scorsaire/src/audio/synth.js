/*
 * Sous-fonte légère de la V1 (décision de Jean, 11/10/2026 : 7 timbres simples par famille). PUR : ne touche ni au DOM ni à Web Audio — il
 * décrit, pour une note de la séquence, CE QU'IL FAUT JOUER (partiels, filtre, enveloppe, courbe de hauteur) sous forme de données ; `webaudio.js`
 * traduit ce plan en nœuds. Tout ce qui est testable (choix du timbre, catégories de percussion, enveloppe, vélocité → gain) l'est donc sous Node.
 *
 * Timbres : keyboard (piano / claviers / percussions à lames), plucked (cordes pincées), bowed (cordes frottées), woodwind (bois, anches libres),
 * brass (cuivres), voice (voix), percussion (sons indéterminés : une recette par catégorie, choisie d'après le n° MIDI de la percmap).
 * Le groupe du catalogue MuseScore (`instrumentInfo(id).group`) décide ; pas de groupe connu → keyboard. Choix de Scorsaire (MuseScore le tire de
 * MuseSounds), sans effet sur le contrat.
 */
import { instrumentInfo } from '../model/instruments.js';

export const TIMBRES = Object.freeze(['keyboard', 'plucked', 'bowed', 'woodwind', 'brass', 'voice', 'percussion']);

const GROUP_TIMBRE = Object.freeze({
  keyboards: 'keyboard', 'pitched-percussion': 'keyboard', 'electronic-instruments': 'keyboard',
  'plucked-strings': 'plucked', strings: 'bowed',
  woodwinds: 'woodwind', 'free-reed': 'woodwind', brass: 'brass', vocals: 'voice',
  'unpitched-percussion': 'percussion', 'marching-percussion': 'percussion', 'body-percussion': 'percussion',
});

/** Timbre d'une piste de la séquence (`{ kind, instrumentId }`). */
export function timbreOf(track) {
  if (track?.kind === 'percussion') return 'percussion';
  const group = instrumentInfo(track?.instrumentId)?.group;
  const timbre = GROUP_TIMBRE[group] ?? 'keyboard';
  return timbre === 'percussion' ? 'keyboard' : timbre; // une piste à hauteurs ne joue jamais de percussion indéterminée
}

/** Fréquence d'un numéro MIDI (La 440 = 69). */
export function midiToHz(midi) { return 440 * 2 ** ((midi - 69) / 12); }

/** Vélocité 1-127 → gain de crête (courbe en puissance : le piano reste audible, le fortissimo ne sature pas). */
export function velocityGain(velocity, ceiling = 0.3) {
  const v = Math.min(127, Math.max(1, velocity)) / 127;
  return ceiling * v ** 1.6;
}

/*
 * Recettes des timbres à hauteur. `parts` : partiels { type, mult (multiple de la fréquence), gain relatif, detune en cents }.
 * `filter` : passe-bas dont la coupure = base + vélocité × track (Hz). Enveloppe linéaire par segments : attaque → décroissance jusqu'au niveau
 * de maintien → (note tenue) → relâchement. `holdFloor` : durée minimale du maintien avant relâchement (évite un clic sur une note très brève).
 */
export const TONE_RECIPES = Object.freeze({
  keyboard: { parts: [{ type: 'triangle', mult: 1, gain: 1 }, { type: 'sine', mult: 2, gain: 0.25 }, { type: 'sine', mult: 3, gain: 0.08 }], filter: { base: 900, track: 4200, q: 0.4 }, env: { attack: 0.004, decay: 1.6, sustain: 0.12, release: 0.22 } },
  plucked: { parts: [{ type: 'sawtooth', mult: 1, gain: 0.8 }, { type: 'triangle', mult: 2, gain: 0.3 }], filter: { base: 700, track: 3000, q: 0.6 }, env: { attack: 0.002, decay: 0.7, sustain: 0.04, release: 0.12 } },
  bowed: { parts: [{ type: 'sawtooth', mult: 1, gain: 0.55, detune: -6 }, { type: 'sawtooth', mult: 1, gain: 0.55, detune: 6 }], filter: { base: 800, track: 2600, q: 0.5 }, env: { attack: 0.09, decay: 0.12, sustain: 0.85, release: 0.16 } },
  woodwind: { parts: [{ type: 'triangle', mult: 1, gain: 1 }, { type: 'square', mult: 1, gain: 0.12 }, { type: 'sine', mult: 3, gain: 0.1 }], filter: { base: 900, track: 2200, q: 0.7 }, env: { attack: 0.05, decay: 0.08, sustain: 0.9, release: 0.09 } },
  brass: { parts: [{ type: 'sawtooth', mult: 1, gain: 0.9 }, { type: 'square', mult: 1, gain: 0.15, detune: 4 }], filter: { base: 600, track: 3200, q: 0.8 }, env: { attack: 0.07, decay: 0.1, sustain: 0.85, release: 0.1 } },
  voice: { parts: [{ type: 'sine', mult: 1, gain: 1 }, { type: 'sawtooth', mult: 1, gain: 0.3 }], filter: { base: 500, track: 1400, q: 1.2 }, env: { attack: 0.08, decay: 0.1, sustain: 0.9, release: 0.18 } },
});

/*
 * Catégories de percussion d'après le n° MIDI de la percmap (nomenclature General MIDI pour 35-87). Les numéros hors de cette plage
 * (27-34, 88-98 : sons propres aux kits de MuseScore) ne sont PAS devinés : catégorie générique « click ».
 */
const GM_CATEGORY = new Map([
  [35, 'kick'], [36, 'kick'], [37, 'rim'], [38, 'snare'], [39, 'clap'], [40, 'snare'],
  [41, 'tom'], [43, 'tom'], [45, 'tom'], [47, 'tom'], [48, 'tom'], [50, 'tom'],
  [42, 'hatClosed'], [44, 'hatPedal'], [46, 'hatOpen'],
  [49, 'crash'], [57, 'crash'], [51, 'ride'], [59, 'ride'], [52, 'china'], [53, 'rideBell'], [55, 'splash'],
  [54, 'shaker'], [56, 'cowbell'], [58, 'shaker'],
  [60, 'drumHigh'], [61, 'drumHigh'], [62, 'drumHigh'], [63, 'drumHigh'], [64, 'drumHigh'], [65, 'drumHigh'], [66, 'drumHigh'],
  [67, 'cowbell'], [68, 'cowbell'], [69, 'shaker'], [70, 'shaker'], [71, 'click'], [72, 'click'], [73, 'shaker'], [74, 'shaker'],
  [75, 'click'], [76, 'click'], [77, 'click'], [78, 'drumHigh'], [79, 'drumHigh'], [80, 'ping'], [81, 'ping'], [82, 'shaker'],
  [83, 'ping'], [84, 'ping'], [85, 'click'], [86, 'drumHigh'], [87, 'drumHigh'],
]);

/** Catégorie de percussion d'un n° MIDI (`null`/inconnu → 'click'). */
export function percussionCategory(midi) { return GM_CATEGORY.get(midi) ?? 'click'; }

/*
 * Recettes de percussion. `tone` : sinus/triangle dont la fréquence glisse de f0 à f1 (exponentiel) ; `noise` : bruit blanc filtré ; `decay` en
 * secondes (le son est un coup unique : la durée écrite de la note ne le raccourcit pas). Les toms prennent leur f0 du n° MIDI (`tomFrequency`).
 */
export const PERCUSSION_RECIPES = Object.freeze({
  kick: { tone: { type: 'sine', f0: 130, f1: 45, sweep: 0.12, gain: 1, decay: 0.28 } },
  snare: { tone: { type: 'triangle', f0: 200, f1: 170, sweep: 0.05, gain: 0.5, decay: 0.1 }, noise: { filter: 'bandpass', freq: 1900, q: 0.7, gain: 0.8, decay: 0.2 } },
  rim: { tone: { type: 'square', f0: 900, f1: 700, sweep: 0.01, gain: 0.35, decay: 0.03 }, noise: { filter: 'bandpass', freq: 2500, q: 1, gain: 0.4, decay: 0.04 } },
  clap: { noise: { filter: 'bandpass', freq: 1500, q: 0.9, gain: 1, decay: 0.16, attack: 0.008 } },
  tom: { tone: { type: 'sine', f0: 120, f1: 80, sweep: 0.14, gain: 1, decay: 0.35 }, noise: { filter: 'bandpass', freq: 800, q: 1, gain: 0.12, decay: 0.05 } },
  drumHigh: { tone: { type: 'sine', f0: 330, f1: 260, sweep: 0.05, gain: 0.9, decay: 0.2 }, noise: { filter: 'bandpass', freq: 1800, q: 1, gain: 0.15, decay: 0.03 } },
  hatClosed: { noise: { filter: 'highpass', freq: 7000, q: 0.7, gain: 0.6, decay: 0.05 } },
  hatPedal: { noise: { filter: 'highpass', freq: 6000, q: 0.7, gain: 0.5, decay: 0.07 } },
  hatOpen: { noise: { filter: 'highpass', freq: 6500, q: 0.7, gain: 0.6, decay: 0.45 } },
  crash: { noise: { filter: 'highpass', freq: 4500, q: 0.6, gain: 0.8, decay: 1.4 } },
  splash: { noise: { filter: 'highpass', freq: 5500, q: 0.6, gain: 0.7, decay: 0.6 } },
  china: { noise: { filter: 'bandpass', freq: 3500, q: 0.5, gain: 0.8, decay: 0.9 } },
  ride: { tone: { type: 'sine', f0: 5200, f1: 5200, sweep: 0.01, gain: 0.1, decay: 0.5 }, noise: { filter: 'highpass', freq: 6500, q: 0.7, gain: 0.45, decay: 0.7 } },
  rideBell: { tone: { type: 'sine', f0: 3300, f1: 3300, sweep: 0.01, gain: 0.5, decay: 0.8 }, noise: { filter: 'highpass', freq: 7500, q: 0.7, gain: 0.15, decay: 0.3 } },
  cowbell: { tone: { type: 'square', f0: 560, f1: 560, sweep: 0.01, gain: 0.35, decay: 0.25 }, noise: { filter: 'bandpass', freq: 845, q: 6, gain: 0.3, decay: 0.2 } },
  shaker: { noise: { filter: 'bandpass', freq: 5200, q: 1.2, gain: 0.5, decay: 0.09, attack: 0.015 } },
  ping: { tone: { type: 'sine', f0: 2600, f1: 2600, sweep: 0.01, gain: 0.5, decay: 0.9 } },
  click: { tone: { type: 'sine', f0: 1800, f1: 1500, sweep: 0.01, gain: 0.7, decay: 0.05 } },
});

/** Fréquence de départ d'un tom d'après son n° MIDI (conception sonore de Scorsaire : plus le numéro monte, plus le tom est aigu). */
export function tomFrequency(midi) { return 70 * 2 ** ((midi - 41) / 14); }

const MIN_TONE_LENGTH = 0.03;

/**
 * Plan sonore d'une note de la séquence.
 * @param {object} note  { pitch, velocity, duration, pitchCurve?, t }
 * @param {object} track { kind, instrumentId }
 * @param {{ sustainUntil?: number }} [options]  sustainUntil : durée EFFECTIVE (secondes depuis le début de la note) quand une pédale tient la note
 * @returns {{ timbre, category?, parts, filter, noise, env, peak, length, release, curve }}  temps RELATIFS au début de la note
 */
export function voicePlan(note, track, { sustainUntil = null } = {}) {
  const timbre = timbreOf(track);
  const peak = velocityGain(note.velocity);
  if (timbre === 'percussion') return percussionPlan(note, peak);
  const recipe = TONE_RECIPES[timbre];
  const base = midiToHz(note.pitch);
  const vel = note.velocity / 127;
  const env = { ...recipe.env };
  const duration = Math.max(MIN_TONE_LENGTH, sustainUntil ?? note.duration);
  const cutoff = Math.min(18000, Math.max(200, recipe.filter.base + recipe.filter.track * vel));
  return {
    timbre,
    parts: recipe.parts.map((p) => ({ type: p.type, freq: base * p.mult, detune: p.detune ?? 0, gain: p.gain })),
    filter: { type: 'lowpass', freq: Math.min(cutoff * Math.max(1, base / 261.6) ** 0.5, 18000), q: recipe.filter.q },
    noise: null,
    env,
    peak,
    length: duration,
    release: env.release,
    curve: note.pitchCurve?.length ? note.pitchCurve.map((p) => ({ t: p.t - note.t, cents: p.semitones * 100 })) : null,
  };
}

function percussionPlan(note, peak) {
  const category = percussionCategory(note.pitch);
  const r = PERCUSSION_RECIPES[category];
  const tone = r.tone ? { ...r.tone } : null;
  if (tone && category === 'tom') { tone.f0 = tomFrequency(note.pitch); tone.f1 = tone.f0 * 0.66; }
  const decay = Math.max(tone?.decay ?? 0, r.noise?.decay ?? 0);
  return {
    timbre: 'percussion',
    category,
    parts: tone ? [{ type: tone.type, freq: tone.f0, freqEnd: tone.f1, sweep: tone.sweep, detune: 0, gain: tone.gain }] : [],
    filter: null,
    noise: r.noise ? { ...r.noise } : null,
    env: { attack: r.noise?.attack ?? 0.001, decay, sustain: 0, release: 0.02 },
    peak,
    length: decay + (r.noise?.attack ?? 0.001),
    release: 0.02,
    curve: null,
    oneShot: true,
  };
}

/**
 * Points de l'enveloppe de gain (rampes LINÉAIRES entre points consécutifs), temps relatifs : [{ t, v }]. Note tenue : attaque → décroissance
 * jusqu'au niveau de maintien → maintien → relâchement à la fin de `length`. Coup unique (percussion) : attaque puis extinction.
 */
export function envelopePoints(plan) {
  const { env, peak } = plan;
  if (plan.oneShot) {
    return [{ t: 0, v: 0 }, { t: env.attack, v: peak }, { t: env.attack + env.decay, v: 0 }];
  }
  const points = [{ t: 0, v: 0 }];
  const sustainLevel = peak * env.sustain;
  const endOfDecay = env.attack + env.decay;
  const levelAt = (t) => {
    if (t <= env.attack) return peak * (t / env.attack);
    if (t >= endOfDecay) return sustainLevel;
    return peak + (sustainLevel - peak) * ((t - env.attack) / env.decay);
  };
  if (plan.length <= env.attack) {
    points.push({ t: plan.length, v: levelAt(plan.length) });
  } else {
    points.push({ t: env.attack, v: peak });
    if (plan.length > endOfDecay) points.push({ t: endOfDecay, v: sustainLevel });
    points.push({ t: plan.length, v: levelAt(plan.length) });
  }
  points.push({ t: plan.length + plan.release, v: 0 });
  return points;
}
