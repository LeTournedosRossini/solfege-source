/*
 * Swing — résolution par portée et règle de lecture. Port de MuseScore 4.7.5 : `Score::updateSwing`, `Staff::swing`, `Swing::applySwing` /
 * `swingAdjustParams` (dom/swing.cpp), `NoteRenderer::applySwingIfNeed` (playback/renderers/noterenderer.cpp), `StaffTextBase`, `TripletFeel`.
 *
 * Écriture : éléments `swing` de `movement.swings` (voir `createSwing`), ancrés par `measureId` + fraction exacte comme le tempo. Un signe
 * SANS `staffId` vaut pour toutes les portées (cas courant : 99 %), un signe AVEC `staffId` ne vaut que pour cette portée (surcharge : la batterie
 * « binarisée » pendant que le reste swingue). Chez MuseScore un texte système s'insère dans la table de CHAQUE portée (`updateSwing`) et un texte de
 * portée dans la sienne : une seule ligne de temps par portée, le dernier signe avant l'instant l'emporte. Ici de même (donc un signe général
 * posé plus tard remplace aussi la surcharge d'une portée, comme chez MuseScore) ; à la même position, le signe de la portée l'emporte.
 * Sans aucun signe : styles `SWING_UNIT` (défaut 'none' = pas de swing) et `SWING_RATIO` (60).
 *
 * Lecture : pour chaque accord (jamais dans un n-olet), si son début tombe sur la 2e moitié d'un temps de swing (`début % (2 × unité) == unité`,
 * début compté depuis le début de la mesure NOMINALE, anacrouse comprise) et qu'il n'est pas « subdivisé » (ni lui ni l'élément précédent plus court
 * que l'unité), son attaque est retardée de `(2 × unité) × (ratio − 50) / 100` ; si sa fin tombe sur la 2e moitié et que l'élément suivant n'est pas
 * subdivisé, sa durée est allongée d'autant. Résultat par accord : `{ remaining, duration }` = fraction de la durée ÉCRITE dont l'attaque est
 * retardée, et multiplicateur de durée (notes liées : le multiplicateur ne porte que sur la durée de l'accord lui-même). Les arrondis entiers
 * de MuseScore (millièmes de la durée, centièmes pour la durée) sont conservés.
 *
 * Écarts / limites : unités en ticks de MuseScore (480 par noire) uniquement pour reproduire ces arrondis ; les notes d'ornement ne comptent ni
 * comme voisins ni comme accords swingués (MuseScore compte un ornement comme voisin de durée nulle) ; une voix absente d'une mesure compte comme
 * une absence de voisin.
 */
import { PID } from './pid.js';
import { SID } from './sid.js';
import { getProperty, resolveStyle } from './props.js';
import { STAFF_TYPES, isApplicable } from './schema.js';
import { measureLengthOf, measureOffsetOf, itemDuration } from './timing.js';
import { ZERO, fAdd, fSub, fCmp } from './fraction.js';
import { measureLayout, absolutePosition } from './tempomap.js';

/** `Constants::DIVISION` de MuseScore : ticks par noire. */
const DIVISION = 480;
const TICKS_PER_WHOLE = DIVISION * 4;
/** Unité du swing en ticks (`Staff::swing`, `TripletFeel`) : croche = DIVISION / 2, double croche = DIVISION / 4. */
export const SWING_UNIT_TICKS = Object.freeze({ none: 0, eighth: DIVISION / 2, '16th': DIVISION / 4 });

const toTicks = ([n, d]) => (n * TICKS_PER_WHOLE) / d;

/**
 * Ligne de temps du swing d'une portée : `[{ at, unit, ratio }]` triée (positions absolues dans le Mouvement) + `at(abs)` = paramètres en vigueur.
 * @param layers  couches de style (ex. `[mouvement.style]`) pour les valeurs de repli
 */
export function staffSwingTimeline(mv, staff, { layers = [], layout = measureLayout(mv) } = {}) {
  const fallback = {
    unit: resolveStyle(SID.SWING_UNIT, layers),
    ratio: resolveStyle(SID.SWING_RATIO, layers),
  };
  const events = [];
  for (const sw of mv.swings ?? []) {
    const target = getProperty(sw, PID.TARGET_STAFF_ID);
    if (target !== null && target !== staff.id) continue;
    const at = absolutePosition(layout, getProperty(sw, PID.MEASURE_ID), getProperty(sw, PID.POSITION));
    if (!at) continue;
    events.push({ at, own: target !== null, unit: getProperty(sw, PID.SWING_UNIT), ratio: getProperty(sw, PID.SWING_RATIO) });
  }
  // tri stable : à la même position, le signe de la portée passe après le signe général (donc l'emporte)
  events.sort((a, b) => fCmp(a.at, b.at) || Number(a.own) - Number(b.own));
  return {
    events,
    at(abs) {
      let best = fallback;
      for (const e of events) { if (fCmp(e.at, abs) <= 0) best = e; else break; }
      return { unit: best.unit, ratio: best.ratio };
    },
  };
}

/** `Swing::swingAdjustParams` + `applySwing` : ajustement d'un accord (voir l'en-tête), ticks entiers de MuseScore. */
function adjust({ start, ticks, unit, ratio, prevTicks, nextTicks, prevOfNextTicks }) {
  const swingBeat = unit * 2;
  const swingActualAdjust = ((swingBeat * ((ratio - 50) / 100)) / ticks) * 1000;
  // `isSubdivided(c)` : c existe et (sa durée < unité ou la durée de son précédent < unité)
  const subdivided = (own, before) => own !== null && (own < unit || (before !== null && before < unit));
  let onTime = 0;
  let gateTime = 100;
  if (start % swingBeat === unit && !subdivided(ticks, prevTicks)) {
    onTime = Math.trunc(onTime + swingActualAdjust);
    gateTime = Math.trunc(200 - (gateTime + swingActualAdjust / 10));
  }
  if ((start + ticks) % swingBeat === unit && !subdivided(nextTicks, ticks)) {
    gateTime = Math.trunc(gateTime + swingActualAdjust / 10);
  }
  if (gateTime <= 0) gateTime = 100;
  return { remaining: onTime / 1000, duration: gateTime / 100 };
}

/**
 * Ajustements de swing de tous les accords d'une portée : `Map(chordId → { remaining, duration })`. Les accords sans effet (ni retard ni
 * changement de durée) n'y figurent pas.
 */
export function staffSwing(mv, staff, { layers = [], layout = measureLayout(mv) } = {}) {
  const result = new Map();
  if (!STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential) return result;
  const timeline = staffSwingTimeline(mv, staff, { layers, layout });
  if (!timeline.events.length && SWING_UNIT_TICKS[timeline.at(ZERO).unit] === 0) return result;
  for (const voice of staff.voices) {
    // éléments de la voix à plat, avec leur début absolu, leur début dans la mesure nominale et leur durée en ticks
    const flat = [];
    voice.measures.forEach((measure, mi) => {
      if (mi >= layout.ids.length || !measure) return;
      const bar = mv.masterbars[mi];
      const offset = measureOffsetOf(bar, mi === 0);
      const length = measureLengthOf(bar);
      let t = ZERO;
      for (const item of measure.items) {
        if (item.type !== 'chord' && item.type !== 'rest') continue;
        const duration = itemDuration(item, length);
        flat.push({
          item, abs: fAdd(layout.starts[mi], t), rtick: toTicks(fAdd(t, offset)), ticks: toTicks(duration),
          tuplet: isApplicable(item.type, PID.TUPLET) && getProperty(item, PID.TUPLET) !== null,
          end: fAdd(layout.starts[mi], fAdd(t, duration)),
        });
        t = fAdd(t, duration);
      }
    });
    flat.forEach((cur, i) => {
      if (cur.item.type !== 'chord' || cur.tuplet) return;
      const { unit: unitName, ratio } = timeline.at(cur.abs);
      const unit = SWING_UNIT_TICKS[unitName];
      if (!unit || !Number.isInteger(cur.ticks) || !Number.isInteger(cur.rtick) || cur.ticks <= 0) return;
      // voisins : seulement s'ils se touchent (une voix absente d'une mesure = pas de voisin)
      const prev = i > 0 && fCmp(flat[i - 1].end, cur.abs) === 0 ? flat[i - 1] : null;
      const next = i + 1 < flat.length && fCmp(flat[i + 1].abs, cur.end) === 0 ? flat[i + 1] : null;
      const result_ = adjust({
        start: cur.rtick, ticks: cur.ticks, unit, ratio,
        prevTicks: prev ? prev.ticks : null, nextTicks: next ? next.ticks : null,
      });
      if (result_.remaining !== 0 || result_.duration !== 1) result.set(cur.item.id, result_);
    });
  }
  return result;
}

/**
 * The swing of the hits of an automatic PLAYER (model/player.js): a hit that starts on the second half of a swing beat (`start % (2 × unit) == unit`) is delayed like a written chord would be.
 * @param timeline  `staffSwingTimeline` of a staff of the player's track
 * @param bar       the masterbar of the measure, `index` its index, `abs` the absolute start of the hit, `measureStart` the absolute start of the measure (fractions of a whole note)
 * @returns the delay as a fraction of a whole note, or null when the hit is not swung
 */
export function playerSwingDelay(timeline, bar, index, abs, measureStart) {
  const { unit: unitName, ratio } = timeline.at(abs);
  const unit = SWING_UNIT_TICKS[unitName];
  if (!unit) return null;
  const rtick = toTicks(fAdd(fSub(abs, measureStart), measureOffsetOf(bar, index === 0)));
  if (!Number.isInteger(rtick) || rtick % (unit * 2) !== unit) return null;
  const ticks = Math.trunc(unit * 2 * ((ratio - 50) / 100) * 1000) / 1000;
  if (!(ticks > 0)) return null;
  const g = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
  const num = Math.round(ticks * 1000); const den = TICKS_PER_WHOLE * 1000; const d = g(num, den);
  return [num / d, den / d];
}
