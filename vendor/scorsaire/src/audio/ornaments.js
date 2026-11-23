/*
 * Notes d'ornement, ornements (mordants, gruppetti) et arpèges de la lecture — fonctions PURES, port de MuseScore 4.7.5
 * (`playback/renderers/gracechordcontext.cpp`, `ornamentsrenderer.cpp`, `arpeggiorenderer.cpp`, `dom/utils.cpp: chromaticPitchSteps`,
 * `dom/measure.cpp: findAccidental`). Les durées sont en SECONDES (MuseScore : microsecondes entières), les ticks à 480 par noire.
 *
 * Notes d'ornement (`graceNotesPlan`) : durée disponible = moitié de la durée nominale de l'accord principal (appoggiature « après », ou « avant » seule ;
 * 2/3 en mesure composée si l'accord dépasse la croche), sinon (acciaccature, ou plusieurs ornements « avant ») au plus la moitié et 30 ticks (une demi-triple
 * croche) par ornement ; les ornements se partagent cette durée au prorata de leurs durées écrites (réduite si elles dépassent la place disponible) ;
 * l'accord principal commence après les ornements « avant » et finit avant les ornements « après » (qui sont posés à la fin de l'accord).
 *
 * Ornements (`ornamentEvents`) : table `DISCLOSURE_RULES` de MuseScore (préfixe + corps répété + suffixe, décalages en pas de degré voisin), durée d'une
 * sous-note selon le tempo (≥ 200 bpm : 3e valeur, ≥ 108 bpm : 2e, sinon 1re), l'intervalle voisin (« seconde automatique ») = demi-tons jusqu'au degré
 * diatonique voisin en tenant compte de l'armure et des altérations déjà posées dans la mesure sur ce degré (`neighbourSemitones`).
 *
 * Arpèges (`arpeggioPlan`) : notes triées par hauteur (une seule note par hauteur), la n-ième attaque retardée de n × min(durée / nombre de notes, 60 ms).
 *
 * Écarts / limites assumés (documentés dans `claude/contrat-audio-fait.md`) :
 *  - MuseScore peut produire une durée NÉGATIVE (corps de mordant quand le préfixe dépasse l'accord) : ces sous-notes sont ignorées ;
 *  - l'orthographe et l'armure utilisées sont celles de CONCERT (MuseScore : celles de l'affichage, écrites si la hauteur de concert est désactivée) ;
 *  - l'intervalle de l'ornement est toujours « seconde automatique » (le modèle n'a ni intervalle au-dessus/en dessous ni style d'ornement baroque) ;
 *  - `LowerMordentBaroque` (absent de la table de MuseScore : rien n'est joué) n'est pas porté.
 *
 * Trémolos (`tremoloStepTicks`, `tremoloPlan`, port de `TremoloRenderer::doRender` / `stepDurationTicks`) : voir plus bas.
 */
import { diatonicIndex, midiFromSpelling } from '../model/pitch.js';
import { ornamentChromatic } from '../model/trill.js';

export const TICKS_PER_QUARTER = 480;
const QUAVER = TICKS_PER_QUARTER / 2;
const SEMIQUAVER = TICKS_PER_QUARTER / 4;
const DEMISEMIQUAVER = TICKS_PER_QUARTER / 8;

const roundTo2 = (x) => Math.round(x * 100) / 100;
const PRESTISSIMO_BPS = roundTo2(200 / 60); // quarts de note par seconde (arrangementutils.h)
const MODERATO_BPS = roundTo2(108 / 60);
const BPS_EPSILON = 1e-6;

/** Durée en secondes de `ticks` à `bps` noires par seconde (`durationFromTempoAndTicks`). */
export const ticksToSeconds = (ticks, bps) => ticks / TICKS_PER_QUARTER / bps;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Notes d'ornement
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Mesure composée (`TimeSigFrac::isCompound` : numérateur > 3 et multiple de 3). */
export const isCompoundTimeSig = ([num]) => num > 3 && num % 3 === 0;

function graceMaxAvailable(type, nominal, count, { bps, compound, nominalTicks }) {
  const halved = 0.5 * nominal;
  if (type === 'PostAppoggiatura' || (type === 'PreAppoggiatura' && count === 1)) {
    return compound && nominalTicks > QUAVER ? (2 * nominal) / 3 : halved;
  }
  return Math.min(ticksToSeconds(DEMISEMIQUAVER / 2, bps) * count, halved);
}

/**
 * Chronologie d'un groupe d'ornements d'un côté de l'accord principal (`GraceChordCtx::buildCtx`).
 * @param side         'before' | 'after'
 * @param type         type d'articulation du groupe : 'Acciaccatura' | 'PreAppoggiatura' | 'PostAppoggiatura'
 * @param graceTicks   durées écrites (ticks) des accords d'ornement, dans l'ordre de jeu
 * @param start        début de l'accord (secondes) ; nominal : sa durée nominale
 * @returns {{ actual: number, graces: { start: number, duration: number }[] }}  `actual` = durée totale prise à l'accord principal
 */
export function graceNotesPlan({ side, type, graceTicks, start, nominal, bps, compound, nominalTicks }) {
  const accumulated = graceTicks.reduce((s, t) => s + ticksToSeconds(t, bps), 0);
  const available = graceMaxAvailable(type, nominal, graceTicks.length, { bps, compound, nominalTicks });
  const actual = Math.min(available, accumulated);
  const factor = accumulated > 0 ? actual / accumulated : 0;
  let cursor = side === 'before' ? start : start + nominal - actual;
  const graces = graceTicks.map((ticks) => {
    const duration = Math.round(factor * ticksToSeconds(ticks, bps) * 1e6) / 1e6; // `RealRound(…, 0)` en microsecondes
    const g = { start: cursor, duration };
    cursor += duration;
    return g;
  });
  return { actual, graces };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Arpèges
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const ARPEGGIO_MAX_STEP = 0.06; // MAX_TIMESTAMP_OFFSET_STEP = 60000 µs

/** Sens de l'arpège : vers le haut sauf `ArpeggioDown` et `ArpeggioStraightDown`. */
export const arpeggioGoesUp = (type) => type !== 'ArpeggioDown' && type !== 'ArpeggioStraightDown';

/**
 * Plan d'un arpège : retard d'attaque (secondes) de chaque note. `notes` = [{ key, pitch }] ; une seule note par hauteur est jouée (la première :
 * `std::map::emplace` de MuseScore). Le pas = durée / nombre de notes de l'accord (doublons compris), plafonné à 60 ms (microsecondes entières) ; `stepMs` > 0 le remplace.
 * @returns {{ key, offset }[]} dans l'ordre d'attaque
 */
export function arpeggioPlan({ type, notes, nominal, stepMs = 0 }) {
  const byPitch = new Map();
  for (const n of notes) if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, n);
  const ordered = [...byPitch.values()].sort((a, b) => a.pitch - b.pitch);
  if (!arpeggioGoesUp(type)) ordered.reverse();
  let stepUs = Math.min(Math.trunc((nominal * 1e6) / notes.length), ARPEGGIO_MAX_STEP * 1e6);
  // a step chosen by the person (chord, track or movement) replaces the automatic one and is not held to 60 ms, but the last note still starts inside the chord
  if (stepMs > 0) stepUs = Math.min(Math.round(stepMs * 1000), Math.trunc((nominal * 0.9e6) / Math.max(1, ordered.length - 1)));
  return ordered.map((n, i) => ({ key: n.key, offset: (stepUs * i) / 1e6 }));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Ornements : table de MuseScore
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * `DISCLOSURE_RULES` : décalages en MULTIPLES du degré voisin (MuseScore : multiples de `PITCH_LEVEL_STEP`, multipliés ensuite par le nombre de demi-tons du
 * degré voisin), `repeat` = le corps peut se répéter, `bounds` = durée (ticks) d'une sous-note aux tempos [lent, moyen, rapide] ; la première valeur sert aussi de
 * seuil : un accord qui ne la dépasse pas est joué tel quel.
 */
export const DISCLOSURE_RULES = Object.freeze({
  Trill: { prefix: [], repeat: true, body: [0, 1], suffix: [], bounds: [QUAVER / 10, DEMISEMIQUAVER, SEMIQUAVER] },
  TrillBaroque: { prefix: [], repeat: true, body: [1, 0], suffix: [-1, 0], bounds: [QUAVER / 10, DEMISEMIQUAVER, SEMIQUAVER] },
  LinePrall: { prefix: [2, 2, 2], repeat: true, body: [1, 0], suffix: [1, 0], bounds: [DEMISEMIQUAVER, DEMISEMIQUAVER, DEMISEMIQUAVER] },
  UpPrall: { prefix: [-1, 0], repeat: true, body: [1, 0], suffix: [1, 0], bounds: [DEMISEMIQUAVER, DEMISEMIQUAVER, DEMISEMIQUAVER] },
  UpMordent: { prefix: [-1, 0], repeat: true, body: [1, 0], suffix: [-1, 0], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
  UpperMordent: { prefix: [0, 1], repeat: false, body: [0], suffix: [], bounds: [DEMISEMIQUAVER / 2, DEMISEMIQUAVER, SEMIQUAVER] },
  LowerMordent: { prefix: [0, -1], repeat: false, body: [0], suffix: [], bounds: [DEMISEMIQUAVER / 2, DEMISEMIQUAVER, SEMIQUAVER] },
  UpperMordentBaroque: { prefix: [1, 0, 1], repeat: false, body: [0], suffix: [], bounds: [DEMISEMIQUAVER / 2, DEMISEMIQUAVER, SEMIQUAVER] },
  MordentWithUpperPrefix: { prefix: [1, 1, 1, 0], repeat: true, body: [1, 0], suffix: [], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
  DownMordent: { prefix: [1, 1, 1, 0], repeat: true, body: [1, 0], suffix: [-1, 0], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
  PrallUp: { prefix: [1, 0], repeat: true, body: [1, 0], suffix: [-1, 0], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
  PrallDown: { prefix: [1, 0], repeat: true, body: [1, 0], suffix: [-1, 0, 0, 0], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
  Turn: { prefix: [1, 0, -1], repeat: false, body: [0], suffix: [], bounds: [DEMISEMIQUAVER / 2, DEMISEMIQUAVER, SEMIQUAVER] },
  InvertedTurn: { prefix: [-1, 0, 1], repeat: false, body: [0], suffix: [], bounds: [DEMISEMIQUAVER / 2, DEMISEMIQUAVER, SEMIQUAVER] },
  Tremblement: { prefix: [1, 0], repeat: false, body: [1, 0], suffix: [], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
  PrallMordent: { prefix: [], repeat: false, body: [1, 0, -1, 0], suffix: [], bounds: [SEMIQUAVER, SEMIQUAVER, SEMIQUAVER] },
});

/** Durée (ticks) d'une sous-note au tempo `bps` (noires par seconde). */
export function subNoteTicks(rule, bps) {
  if (bps >= PRESTISSIMO_BPS - BPS_EPSILON) return rule.bounds[2];
  if (bps >= MODERATO_BPS - BPS_EPSILON) return rule.bounds[1];
  return rule.bounds[0];
}

/**
 * Sous-notes d'un ornement (`OrnamentsRenderer::convert`).
 * @param type       type d'articulation (clé de `DISCLOSURE_RULES`)
 * @param ticks      durée de l'accord en ticks (liaisons de prolongation comprises)
 * @param start      début (secondes) ; duration : durée en secondes
 * @param semisUp    demi-tons jusqu'au degré voisin au-dessus ; semisDown : jusqu'au degré voisin en dessous (valeurs positives)
 * @returns {{ t: number, duration: number, semitones: number }[] | null}  null : type sans règle (rien n'est joué)
 */
export function ornamentEvents({ type, ticks, start, duration, bps, semisUp, semisDown }) {
  const rule = DISCLOSURE_RULES[type];
  if (!rule) return null;
  if (ticks <= rule.bounds[0]) return [{ t: start, duration, semitones: 0 }];
  const shift = (k) => (k === 0 ? 0 : k > 0 ? k * semisUp : k * semisDown);
  const prefix = rule.prefix.map(shift);
  const body = rule.body.map(shift);
  const suffix = rule.suffix.map(shift);
  const sub = subNoteTicks(rule, bps);
  const prefixTicks = Math.round(prefix.length * sub);
  const suffixTicks = Math.round(suffix.length * sub);
  const out = [];
  let cursor = start;
  const create = (count, availableTicks, offsets) => {
    const step = (duration * (availableTicks / ticks)) / (count * offsets.length);
    for (let a = 0; a < count; a++) {
      for (const semitones of offsets) {
        if (step > 0) out.push({ t: cursor, duration: step, semitones });
        cursor += step;
      }
    }
  };
  if (prefix.length) create(1, prefixTicks, prefix);
  if (body.length) {
    const count = rule.repeat ? Math.trunc(Math.max(ticks / sub / 2, 0)) : 1;
    if (count === 0) out.push({ t: cursor, duration, semitones: 0 });
    else create(count, ticks - prefixTicks - suffixTicks, body);
  }
  if (suffix.length) create(1, suffixTicks, suffix);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Degré voisin (chromaticPitchSteps)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Altération de chaque nom de note dans l'armure `keySig` (dièses > 0, bémols < 0). */
export function keyAlters(keySig) {
  const alters = {};
  const order = keySig < 0 ? FLAT_ORDER : SHARP_ORDER;
  for (const step of order.slice(0, Math.abs(keySig))) alters[step] = keySig < 0 ? -1 : 1;
  return alters;
}

/**
 * Demi-tons (valeur positive) entre une note et le degré diatonique voisin (`direction` +1 au-dessus, −1 en dessous), comme `chromaticPitchSteps` pour une
 * portée à hauteurs : le degré voisin prend l'altération de l'armure, sauf si une note déjà posée dans la mesure sur CE degré (même nom, même octave) l'a
 * changée (`state` : Map « D4 » → altération). Portée sans hauteurs (tablature, percussion) : 1.
 */
export function neighbourSemitones({ pitch, spelling, keySig, state, direction, pitched = true, steps = 1 }) {
  if (steps === 0) return 0; // `chromaticPitchSteps` : 0 degré → 0 demi-ton
  if (!pitched) return 1;
  const index = diatonicIndex(spelling) + direction * steps;
  const step = STEPS[((index % 7) + 7) % 7];
  const octave = Math.floor(index / 7);
  const alter = state.has(`${step}${octave}`) ? state.get(`${step}${octave}`) : (keyAlters(keySig)[step] ?? 0);
  return Math.abs(midiFromSpelling({ step, alter: 0, octave }) + alter - pitch);
}

/**
 * Demi-tons d'un côté de l'ornement selon son intervalle `{ step, type }` (`DisclosurePattern::updatePitchOffsets`) : automatique → degrés voisins
 * avec armure et altérations de la mesure ; sinon nombre fixe de demi-tons (`Interval::fromOrnamentInterval`).
 */
export function ornamentSideSemitones(iv, args) {
  if (iv.type === 'auto') return neighbourSemitones({ ...args, steps: iv.step });
  return ornamentChromatic(iv);
}

/**
 * Durée d'un pas de trémolo en ticks (`TremoloRenderer::stepDurationTicks`) : `480 / 2^(barres de la durée écrite + barres du trémolo)`, au moins 1,
 * multipliée (flottant 32 bits, tronqué) par le facteur d'étirement de l'accord (n-olet : dénominateur / numérateur ; trémolo à deux notes : 1).
 */
export function tremoloStepTicks({ beams, strokes, stretch = 1 }) {
  const ticks = Math.trunc(TICKS_PER_QUARTER / 2 ** (beams + strokes));
  if (ticks <= 0) return 1;
  return Math.trunc(Math.fround(ticks * Math.fround(stretch)));
}

/**
 * Pas d'un trémolo (`TremoloRenderer::doRender`) : nombre = arrondi(durée totale / pas), 0 → rien ; pas réel = division entière. Roulement (`buzz`) : un seul
 * pas = toute la durée. Trémolo à deux notes : les pas pairs sont joués par le 1er accord (`which` 0), les impairs par le 2e (`which` 1).
 * @returns {{ start: number, ticks: number, which: 0|1 }[]} `start` en ticks depuis le début du 1er accord.
 */
export function tremoloPlan({ overallTicks, stepTicks, buzz = false, two = false }) {
  const step = buzz ? overallTicks : stepTicks;
  if (!(step > 0) || !(overallTicks > 0)) return [];
  const count = Math.round(overallTicks / Math.fround(step));
  if (count === 0) return [];
  const each = Math.trunc(overallTicks / count);
  return Array.from({ length: count }, (_, i) => ({ start: i * each, ticks: each, which: two && i % 2 ? 1 : 0 }));
}
