/*
 * Découpage rythmique : comment écrire une durée qui commence à une position donnée de la mesure.
 *
 * PUR (aucun DOM, aucun Document). Port de MuseScore 4.7.5, lu en entier (jamais deviné) :
 *   - `dom/durationtype.cpp` : `toDurationList`, `toRhythmicDurationList`, `populateRhythmicList`,
 *     `splitCompoundBeatsForList`, `forceRhythmicSplit` (+ `Simple` / `Compound`), `TDuration(Fraction, truncate, maxDots)` ;
 *   - `dom/sig.cpp` / `sig.h` : `TimeSigFrac` (`rtick2beatType`, `rtick2subbeatLevel`, `strongestBeatInRange`,
 *     `strongestSubbeatLevelInRange`, `ticksToNextBeat`, …).
 *
 * C'est LA règle de MuseScore pour les silences automatiques ET pour la découpe d'une note qui déborde (même
 * fonction des deux côtés, `isRest` ne change que quelques tests). Elle remplace l'ancienne formulation « plus gros
 * nœuds de l'arbre métrique » du CLAUDE.md : le comportement décrit (demi-pause seulement sur les temps 1 et 3 en 4/4,
 * soupir sur les temps, noire pointée en 6/8…) en est la conséquence, vérifiée par les tests.
 *
 * Unités : MuseScore compte en ticks de 480 par noire, soit 1920 par ronde. Les instants du modèle sont des fractions
 * exactes de ronde ; on les convertit en ticks entiers ici (une position qui ne tombe pas sur un tick entier — 1/256 de
 * ronde — est découpée sans règle métrique, comme `rtick2subbeatLevel` négatif dans MuseScore).
 */
import { frac, fAdd, fSub, fCmp, fEq, ZERO } from './fraction.js';
import { DURATION_VALUE, MEASURE_DURATION } from './pitch.js';

/** Ticks par ronde (MuseScore : `Constants::DIVISION` × 4). */
export const TICKS_PER_WHOLE = 1920;

/** Types de beat de MuseScore (`BeatType`) ; l'ordre numérique sert aux comparaisons `<=` des règles. */
const BeatType = Object.freeze({
  DOWNBEAT: 0,
  COMPOUND_STRESSED: 1,
  SIMPLE_STRESSED: 2,
  COMPOUND_UNSTRESSED: 3,
  SIMPLE_UNSTRESSED: 4,
  COMPOUND_SUBBEAT: 5,
  SUBBEAT: 6,
});

const MAX_DOTS = 4;

// Valeurs écrites, de la plus longue à la plus courte (MuseScore commence à V_LONG ; le modèle commence à la brève).
const TYPES_DESC = ['breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond', 'sixtyfourth'];

const dotsFactor = (dots) => frac(2 ** (dots + 1) - 1, 2 ** dots);

/** Fraction de ronde d'une durée écrite `{ base, dots }` (mêmes valeurs que `writtenDuration`, sans exception pour 'measure'). */
function valueOf(base, dots) {
  const v = DURATION_VALUE[base];
  const f = dotsFactor(dots);
  return frac(v[0] * f[0], v[1] * f[1]);
}

/**
 * `TDuration(l, true, maxDots, maxType)` : la plus longue durée écrite (points compris) qui tient dans `l`, en partant
 * du type `fromType` (inclus) ; `null` si rien ne tient. Même parcours que `truncateToFraction` : d'abord le type de
 * départ, puis les types plus courts, chacun avec `maxDots` points puis moins.
 */
function longestFitting(l, maxDots, fromType = 'breve') {
  const start = TYPES_DESC.indexOf(fromType);
  for (let i = start; i < TYPES_DESC.length; i++) {
    for (let dots = Math.min(maxDots, MAX_DOTS); dots >= 0; dots--) {
      if (fCmp(valueOf(TYPES_DESC[i], dots), l) <= 0) return { base: TYPES_DESC[i], dots };
    }
  }
  return null;
}

/**
 * `toDurationList` : décompose `length` en plus grandes valeurs successives, sans règle métrique (les points
 * seulement si `maxDots > 0`). Durées de la plus longue à la plus courte. `length` non décomposable exactement :
 * le reste est ignoré (MuseScore le signale dans le journal).
 */
export function toDurationList(length, maxDots = 0) {
  const list = [];
  let rest = length;
  let from = 'breve';
  for (;;) {
    if (rest[0] <= 0) break;
    const d = longestFitting(rest, maxDots, from);
    if (!d) break;
    list.push(d);
    rest = fSub(rest, valueOf(d.base, d.dots));
    from = d.base;
  }
  return list;
}

// ---------- TimeSigFrac (sig.h / sig.cpp) ----------

/** Aides de chiffrage en ticks, pour un chiffrage NOMINAL `[num, den]` (non réduit : 6/8 reste 6/8). */
export function timeSigHelpers([numerator, denominator], { halfRestInThreeFour = false } = {}) {
  const dUnitTicks = TICKS_PER_WHOLE / denominator;
  if (!Number.isInteger(dUnitTicks)) throw new Error(`Chiffrage sans unité entière : ${numerator}/${denominator}`);
  const isCompound = numerator > 3 && numerator % 3 === 0;
  const dUnitsPerBeat = isCompound ? 3 : 1;
  const beatTicks = dUnitTicks * dUnitsPerBeat;
  const beatsPerMeasure = numerator / dUnitsPerBeat;
  const isTriple = beatsPerMeasure % 3 === 0;
  const isDuple = !isTriple && beatsPerMeasure % 2 === 0;

  const rtick2beatType = (rtick) => {
    if (rtick === 0) return BeatType.DOWNBEAT;
    if (rtick % dUnitTicks !== 0) return BeatType.SUBBEAT;
    if (isCompound && rtick % beatTicks !== 0) return BeatType.COMPOUND_SUBBEAT;
    const beatNum = rtick / beatTicks;
    let stressBeat;
    if (isTriple) stressBeat = 3;
    else if (isDuple) stressBeat = 2;
    else stressBeat = Math.trunc((numerator + 1) / 2); // 5/4 = (3+2)/4, comme pour les ligatures
    if (stressBeat && beatNum % stressBeat === 0) return isCompound ? BeatType.COMPOUND_STRESSED : BeatType.SIMPLE_STRESSED;
    return isCompound ? BeatType.COMPOUND_UNSTRESSED : BeatType.SIMPLE_UNSTRESSED;
  };

  const subbeatTicks = (level) => {
    let t = dUnitTicks;
    for (let l = level; l > 0; l--) t = Math.trunc(t / 2);
    return t;
  };

  // `rtick2subbeatLevel` : 0 sur un temps / une unité du dénominateur, 1 à mi-chemin… négatif si non défini.
  const rtick2subbeatLevel = (rtick) => {
    let level = 0;
    let sub = dUnitTicks;
    let remainder = rtick % sub;
    while (remainder !== 0) {
      level++;
      if (sub % 2 !== 0) return -level;
      sub = sub / 2;
      remainder %= sub;
    }
    return level;
  };

  // `strongestSubbeatLevelInRange` (intervalle exclusif) : { level, tick } ; level négatif si aucun.
  const strongestSubbeatLevelInRange = (rtick1, rtick2) => {
    let level = 0;
    let sub = dUnitTicks;
    for (;;) {
      const n = Math.trunc(rtick1 / sub);
      const m = Math.trunc((rtick2 - 1) / sub);
      if (m > n) return { level, tick: m * sub };
      level++;
      if (sub % 2 !== 0) return { level: -level, tick: 0 };
      sub = sub / 2;
    }
  };

  // `strongestBeatInRange` : { type, unitsCrossed, tick }.
  const strongestBeatInRange = (rtick1, rtick2, saveLast) => {
    let strongest = BeatType.SUBBEAT;
    let unitsCrossed = 0;
    let tick = 0;
    for (let rtick = rtick1 + (dUnitTicks - (rtick1 % dUnitTicks)); rtick < rtick2; rtick += dUnitTicks) {
      unitsCrossed++;
      const type = rtick2beatType(rtick);
      if (type < strongest + (saveLast ? 1 : 0)) {
        strongest = type;
        tick = rtick;
      }
    }
    return { type: strongest, unitsCrossed, tick };
  };

  return {
    numerator,
    denominator,
    halfRestInThreeFour,
    isCompound,
    isTriple,
    isDuple,
    dUnitTicks,
    beatTicks,
    rtick2beatType,
    rtick2subbeatLevel,
    strongestSubbeatLevelInRange,
    strongestBeatInRange,
    ticksPastBeat: (rtick) => rtick % beatTicks,
    ticksToNextBeat: (rtick) => beatTicks - (rtick % beatTicks),
    ticksPastSubbeat: (rtick, level) => rtick % subbeatTicks(level),
    ticksToNextSubbeat: (rtick, level) => subbeatTicks(level) - (rtick % subbeatTicks(level)),
  };
}

// ---------- forceRhythmicSplit (durationtype.cpp) ----------

function forceRhythmicSplitSimple(isRest, startBeat, endBeat, beatsCrossed, strongestBeatCrossed) {
  switch (strongestBeatCrossed) {
    case BeatType.SIMPLE_STRESSED:
      if (isRest) return true; // un silence doit se couper sur un temps fort
      // une note qui commence ou finit sur un temps fort ne se coupe pas (double point en 4/4)
      if (startBeat <= BeatType.SIMPLE_STRESSED || endBeat <= BeatType.SIMPLE_STRESSED) return false;
      if (startBeat <= BeatType.SIMPLE_UNSTRESSED && endBeat <= BeatType.SIMPLE_UNSTRESSED) return false;
      return true;
    case BeatType.SIMPLE_UNSTRESSED:
      if (startBeat <= BeatType.SIMPLE_STRESSED && endBeat <= BeatType.SIMPLE_STRESSED) return false;
      // un silence qui ne commence/finit pas sur un temps se coupe ; une note peut traverser UN temps faible
      if (startBeat === BeatType.SUBBEAT || endBeat === BeatType.SUBBEAT) return isRest || beatsCrossed > 1;
      return false;
    default:
      return false;
  }
}

function forceRhythmicSplitCompound(isRest, startBeat, endBeat, dUnitsCrossed, strongestBeatCrossed) {
  switch (strongestBeatCrossed) {
    case BeatType.COMPOUND_STRESSED:
      return forceRhythmicSplitSimple(isRest, startBeat, endBeat, Math.trunc(dUnitsCrossed / 3), BeatType.SIMPLE_STRESSED);
    case BeatType.COMPOUND_UNSTRESSED:
      return false;
    case BeatType.COMPOUND_SUBBEAT:
      if (startBeat <= BeatType.COMPOUND_UNSTRESSED && endBeat <= BeatType.COMPOUND_UNSTRESSED) return false;
      if (isRest && startBeat > BeatType.COMPOUND_UNSTRESSED) return true;
      return forceRhythmicSplitSimple(isRest, startBeat, endBeat, dUnitsCrossed, BeatType.SIMPLE_UNSTRESSED);
    default:
      return forceRhythmicSplitSimple(isRest, startBeat, endBeat, dUnitsCrossed, strongestBeatCrossed);
  }
}

function forceRhythmicSplit(isRest, startBeat, endBeat, dUnitsCrossed, strongestBeatCrossed, ts) {
  // OPTION SCORSAIRE `RESTS_HALF_IN_THREE_FOUR` (décidée avec Jean ; MuseScore coupe toujours) : en 3/4, une demi-pause
  // posée sur les temps 1 et 2 reste entière (elle ne traverse qu'un temps, et finit sur le temps 3).
  if (isRest && ts.halfRestInThreeFour && !ts.isCompound && ts.isTriple && startBeat === BeatType.DOWNBEAT && dUnitsCrossed === 1
      && strongestBeatCrossed === BeatType.SIMPLE_UNSTRESSED && endBeat === BeatType.SIMPLE_UNSTRESSED) {
    return false;
  }
  // rien ne traverse un temps fort dans un chiffrage irrégulier
  if (strongestBeatCrossed <= BeatType.SIMPLE_STRESSED && !ts.isTriple && !ts.isDuple) return true;
  if (isRest) {
    if (strongestBeatCrossed <= BeatType.SIMPLE_UNSTRESSED && ts.numerator === 2) return true; // 2/4 : pas de silence à cheval sur le milieu
    if (strongestBeatCrossed <= BeatType.SIMPLE_UNSTRESSED && ts.isTriple) return true; // 3/4, 9/8… : pas de silence sur un temps
  }
  return ts.isCompound
    ? forceRhythmicSplitCompound(isRest, startBeat, endBeat, dUnitsCrossed, strongestBeatCrossed)
    : forceRhythmicSplitSimple(isRest, startBeat, endBeat, dUnitsCrossed, strongestBeatCrossed);
}

// ---------- listes rythmiques ----------

const ticksOf = (f) => (TICKS_PER_WHOLE * f[0]) / f[1];
const fromTicks = (t) => frac(t, TICKS_PER_WHOLE);

function populateRhythmicList(out, l, isRest, rtickStart, ts, maxDots) {
  const lTicks = ticksOf(l);
  const start = ticksOf(rtickStart);
  if (!Number.isInteger(lTicks) || !Number.isInteger(start)) {
    out.push(...toDurationList(l, maxDots));
    return;
  }
  const end = start + lTicks;

  const startLevel = ts.rtick2subbeatLevel(start);
  const endLevel = ts.rtick2subbeatLevel(end);
  const crossed = ts.strongestSubbeatLevelInRange(start, end);
  let strongestLevelCrossed = crossed.level;
  let splitTick = crossed.tick;

  if (startLevel < 0 || endLevel < 0 || strongestLevelCrossed < 0) {
    // au-delà du niveau maximal de sous-temps : plus grandes durées possibles
    out.push(...toDurationList(l, maxDots));
    return;
  }

  let needToSplit = false;
  if (strongestLevelCrossed < startLevel && strongestLevelCrossed < endLevel) needToSplit = true;
  // pas de coupure pour une syncope de niveau 1 (croche, noire, noire…)
  if (startLevel === endLevel && strongestLevelCrossed === startLevel - 1) needToSplit = false;
  // ni pour le cas suivant, de niveau 2 (double, croche, croche…), sauf double, noire, noire…
  if (startLevel === endLevel && strongestLevelCrossed === startLevel - 2) {
    const toNext = ts.ticksToNextSubbeat(start, startLevel - 1);
    const past = ts.ticksPastSubbeat(start, startLevel - 1);
    needToSplit = toNext !== past;
  }

  if (!needToSplit && strongestLevelCrossed === 0) {
    const startBeat = ts.rtick2beatType(start);
    const endBeat = ts.rtick2beatType(end);
    const useLast = startBeat <= BeatType.SIMPLE_UNSTRESSED; // couper sur le dernier temps si on part d'un temps
    const sb = ts.strongestBeatInRange(start, end, useLast);
    needToSplit = forceRhythmicSplit(isRest, startBeat, endBeat, sb.unitsCrossed, sb.type, ts);
    if (sb.tick) splitTick = sb.tick;
  }

  if (!needToSplit) {
    const d = longestFitting(l, maxDots);
    if (d && fEq(valueOf(d.base, d.dots), l)) {
      out.push(d); // une seule durée convient
      return;
    }
    // aucune durée ne convient seule : coupure obligatoire
  }

  // protection contre la récursion infinie : aucun point de coupure strictement à l'intérieur
  if (!(start < splitTick && splitTick < end)) {
    out.push(...toDurationList(l, maxDots));
    return;
  }

  const leftSplit = fromTicks(splitTick - start);
  const rightSplit = fSub(l, leftSplit);
  populateRhythmicList(out, leftSplit, isRest, rtickStart, ts, maxDots);
  populateRhythmicList(out, rightSplit, isRest, fromTicks(splitTick), ts, maxDots);
}

function splitCompoundBeatsForList(out, l, isRest, rtickStart, ts, maxDots) {
  const lTicks = ticksOf(l);
  const start = ticksOf(rtickStart);
  if (!Number.isInteger(lTicks) || !Number.isInteger(start)) {
    populateRhythmicList(out, l, isRest, rtickStart, ts, maxDots);
    return;
  }
  const end = start + lTicks;
  const startBeat = ts.rtick2beatType(start);
  const endBeat = ts.rtick2beatType(end);

  if (startBeat > BeatType.COMPOUND_UNSTRESSED) {
    // ne commence pas sur un temps composé : ne doit pas déborder sur le temps suivant
    const splitTicks = ts.ticksToNextBeat(start);
    if (lTicks > splitTicks) {
      const leftSplit = fromTicks(splitTicks);
      const rightSplit = fSub(l, leftSplit);
      populateRhythmicList(out, leftSplit, isRest, rtickStart, ts, maxDots);
      splitCompoundBeatsForList(out, rightSplit, isRest, fAdd(rtickStart, leftSplit), ts, maxDots);
      return;
    }
  }
  if (endBeat > BeatType.COMPOUND_UNSTRESSED) {
    // ne finit pas sur un temps composé : ne doit pas empiéter sur le temps précédent
    const splitTicks = ts.ticksPastBeat(end);
    if (lTicks > splitTicks) {
      const rightSplit = fromTicks(splitTicks);
      const leftSplit = fSub(l, rightSplit);
      populateRhythmicList(out, leftSplit, isRest, rtickStart, ts, maxDots);
      populateRhythmicList(out, rightSplit, isRest, fromTicks(end - splitTicks), ts, maxDots);
      return;
    }
  }
  populateRhythmicList(out, l, isRest, rtickStart, ts, maxDots);
}

/**
 * `toRhythmicDurationList` : écrit `length`, qui commence à `start` DEPUIS LE DÉBUT DE LA MESURE (fraction de ronde),
 * en respectant la métrique du chiffrage `timeSig` (`[num, den]` nominal). Retourne une liste de `{ base, dots }`.
 *
 * Options :
 *  - `isRest` : règles des silences (plus strictes que celles des notes) ;
 *  - `measureLength` : longueur de la mesure — un silence qui la remplit exactement est UN silence de mesure
 *    (`{ base: 'measure', dots: 0 }`), seulement si `allowMeasureRest` (jamais dans une mesure irrégulière) ;
 *  - `offset` : décalage d'anacrouse (`measureOffsetOf`), ajouté à `start` : les temps s'alignent sur la mesure complète ;
 *  - `maxDots` : points permis (1 pour une note ou un silence automatique, 0 pour le reste d'un silence coupé) ;
 *  - `halfRestInThreeFour` : option Scorsaire `RESTS_HALF_IN_THREE_FOUR` (voir `forceRhythmicSplit`). Non portées ici :
 *    `RESTS_USE_BEAM_GROUPING` et `RESTS_COMPOUND_BEAT_DOTTED` (la règle de MuseScore donne déjà la noire pointée en 6/8).
 */
export function toRhythmicDurationList(length, { isRest, start = ZERO, timeSig, measureLength, allowMeasureRest = true, offset = ZERO, maxDots = 1, halfRestInThreeFour = false }) {
  if (length[0] <= 0) return [];
  const anacrusis = !fEq(offset, ZERO);
  if (!anacrusis && isRest && allowMeasureRest && measureLength && fEq(length, measureLength) && fEq(start, ZERO)) {
    return [{ base: MEASURE_DURATION, dots: 0 }];
  }
  const ts = timeSigHelpers(timeSig, { halfRestInThreeFour });
  const out = [];
  const rstart = fAdd(start, offset);
  if (ts.isCompound) splitCompoundBeatsForList(out, length, isRest, rstart, ts, maxDots);
  else populateRhythmicList(out, length, isRest, rstart, ts, maxDots);
  return out;
}

/** Fraction de ronde d'une durée `{ base, dots }` produite par ce module (`base` ≠ 'measure'). */
export function durationValue({ base, dots = 0 }) {
  return valueOf(base, dots);
}
