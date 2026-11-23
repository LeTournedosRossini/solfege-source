/*
 * Ligne de temps du tempo d'un Mouvement : position (fraction exacte de ronde depuis le début) → secondes.
 * Port de `Score::setUpTempoMap` / `rebuildTempoAndTimeSigMaps` / `fixAnacrusisTempo` et de `TempoMap` (MuseScore 4.7.5, score.cpp, tempo.cpp),
 * avec trois ÉCARTS assumés, tous marqués ci-dessous :
 *   1. courbe des graduels RÉGLABLE (`PID.CHANGE_CURVE`) au lieu des 5 allures de MuseScore ; résolution des marches réglable
 *      (croche par défaut, jusqu'à la triple croche ; MuseScore : au moins 8 marches ou une par noire) ; tempo d'arrivée explicite possible ;
 *   2. l'étirement d'un point d'orgue est un FACTEUR appliqué au tempo de base sur [instant, instant suivant) — chez MuseScore il s'écrit
 *      comme un tempo « posé » à l'instant, qu'une marche de graduel recouvrant la même plage ÉCRASE (l'étirement disparaîtrait au
 *      milieu du point d'orgue) : on garde l'intention (étirer) plutôt que le défaut ;
 *   3. un graduel qui commence dans une anacrouse sans tempo utilise le tempo de la mesure suivante (MuseScore applique ce correctif
 *      APRÈS les graduels).
 * Positions : toujours des fractions exactes ; les décimaux n'apparaissent que dans les tempos (notes rondes par seconde) et les secondes.
 * Une position de tempo est comptée depuis le début RÉEL de la mesure (début de son contenu, anacrouse comprise).
 *
 * Semantique conservée de MuseScore : un événement de tempo vaut jusqu'au suivant ; les graduels sont des marches de tempo CONSTANT
 * (valeur de la marche à son début), la dernière marche (= l'arrivée) reste en vigueur ; un tempo explicite posé à l'instant d'une marche
 * l'emporte ; un graduel part du tempo en cours (graduels précédents compris) ; « a tempo » revient au tempo d'avant le graduel
 * (les graduels sont calculés APRÈS tous les textes) ; avant tout tempo : 120 bpm.
 */
import { PID } from './pid.js';
import { breathPause } from './breath.js';
import { getProperty } from './props.js';
import { STAFF_TYPES } from './schema.js';
import { measureLengthOf, isIrregularMeasure, itemDuration } from './timing.js';
import { timeSigDuration } from './pitch.js';
import { ZERO, frac, fAdd, fSub, fMul, fCmp, fLt, fToNumber } from './fraction.js';
import {
  DEFAULT_WPS, QUARTER_UNIT, MAX_WPS, MIN_WPS, GRADUAL_TYPES, roundWps, wpsFromBpm, fermataStretch, parseTempoText,
} from './tempo.js';

const key = (f) => `${f[0]}/${f[1]}`;

/** Débuts de mesure (fractions depuis le début du Mouvement), longueurs et fin. */
export function measureLayout(mv) {
  const ids = mv.masterbars.map((b) => b.id);
  const lengths = mv.masterbars.map((b) => measureLengthOf(b));
  const starts = [];
  let t = ZERO;
  for (const len of lengths) {
    starts.push(t);
    t = fAdd(t, len);
  }
  return { ids, lengths, starts, end: t };
}

/** Position absolue d'une ancre (identifiant de masterbar + fraction depuis le début de la mesure), ou null si la mesure n'existe pas. */
export function absolutePosition(layout, measureId, position = ZERO) {
  const i = layout.ids.indexOf(measureId);
  return i < 0 ? null : fAdd(layout.starts[i], position ?? ZERO);
}

/** Progression d'un graduel : x^(4^courbe) ; courbe 0 = linéaire, > 0 convexe (démarre lentement), < 0 concave (démarre vite). */
export const curveProgress = (x, curve = 0) => (x <= 0 ? 0 : x >= 1 ? 1 : x ** (4 ** curve));

/**
 * Points d'orgue : { at, end, stretch } — éléments `movement.fermatas` (signes de STRUCTURE, ancrés par mesure + fraction : ce que les portées
 * contiennent à cet endroit, silence compris, n'a aucun effet sur la lecture). `at` = instant du signe, `end` = instant suivant (le plus proche
 * entre la prochaine attaque, toutes portées séquentielles confondues, et la fin de la mesure ; `Segment::next1`), `stretch` = le plus grand
 * étirement des signes posés au même instant.
 */
export function fermataIntervals(mv, layout = measureLayout(mv)) {
  const fermatas = new Map(); // clé -> { at, stretch, measure }
  for (const f of mv.fermatas ?? []) {
    const measure = layout.ids.indexOf(getProperty(f, PID.MEASURE_ID));
    if (measure < 0) continue;
    const stretch = fermataStretch({
      fermataType: getProperty(f, PID.FERMATA_TYPE), timeStretch: getProperty(f, PID.TIME_STRETCH), play: getProperty(f, PID.PLAY),
    });
    if (!stretch) continue;
    const at = fAdd(layout.starts[measure], getProperty(f, PID.POSITION) ?? ZERO);
    const prev = fermatas.get(key(at));
    fermatas.set(key(at), { at, stretch: Math.max(stretch, prev?.stretch ?? 0), measure });
  }
  if (!fermatas.size) return [];
  const onsets = new Map(); // clé -> fraction (toutes les attaques)
  for (const track of mv.tracks) {
    for (const staff of track.staves) {
      if (!STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential) continue;
      for (const voice of staff.voices) {
        voice.measures.forEach((measure, mi) => {
          if (mi >= layout.ids.length) return;
          let t = layout.starts[mi];
          for (const item of measure?.items ?? []) {
            onsets.set(key(t), t);
            t = fAdd(t, itemDuration(item, layout.lengths[mi]));
          }
        });
      }
    }
  }
  const candidates = [...onsets.values(), ...layout.starts, layout.end];
  return [...fermatas.values()].map(({ at, stretch, measure }) => {
    const limit = fAdd(layout.starts[measure], layout.lengths[measure]);
    let end = limit;
    for (const c of candidates) if (fLt(at, c) && fLt(c, end)) end = c;
    return { at, end, stretch };
  }).sort((x, y) => fCmp(x.at, y.at));
}

/**
 * Pauses des respirations et césures : `[{ at, seconds }]` triée, `at` = fin de l'élément visé par `PID.BREATHS` (fraction absolue). À un même
 * instant la plus longue pause l'emporte, toutes portées confondues (`Score::rebuildTempoAndTimeSigMaps`, « find longest pause »).
 */
export function breathPauses(mv, layout = measureLayout(mv)) {
  const found = new Map();
  for (const track of mv.tracks) {
    for (const staff of track.staves) {
      const list = getProperty(staff, PID.BREATHS);
      if (!list.length || !STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential) continue;
      const ends = new Map();
      for (const voice of staff.voices) {
        voice.measures.forEach((measure, mi) => {
          if (mi >= layout.ids.length) return;
          let t = layout.starts[mi];
          for (const item of measure?.items ?? []) {
            t = fAdd(t, itemDuration(item, layout.lengths[mi]));
            ends.set(item.id, t);
          }
        });
      }
      for (const b of list) {
        const at = ends.get(b.afterId);
        const seconds = breathPause(b);
        if (!at || !(seconds > 0)) continue;
        const prev = found.get(key(at));
        if (!prev || seconds > prev.seconds) found.set(key(at), { at, seconds });
      }
    }
  }
  return [...found.values()].sort((a, b) => fCmp(a.at, b.at));
}

/**
 * Ligne de temps du Mouvement.
 * @returns {{ events: {at, wps, unit, pause}[], tempoAt(abs): number, secondsAt(abs): number, secondsEndAt(abs): number, pauses, absolute(mi, position): fraction,
 *             layout, fermatas }}
 *   `events` : suite triée d'événements de tempo CONSTANT (`wps` = notes rondes par seconde), le premier à 0 ; `secondsAt` : secondes depuis
 *   le début du Mouvement, pauses de respiration comprises (pas la pause entre Mouvements, `PID.PAUSE`).
 */
export function tempoTimeline(mv) {
  const layout = measureLayout(mv);
  const events = []; // { at, wps, unit } non triés pendant la construction
  const index = new Map();
  const set = (at, wps, unit) => {
    const ev = { at, wps, unit };
    const old = index.get(key(at));
    if (old) events[events.indexOf(old)] = ev;
    else events.push(ev);
    index.set(key(at), ev);
  };
  const DEFAULT = { wps: DEFAULT_WPS, unit: QUARTER_UNIT };
  /** Tempo en vigueur à `at` (inclus) ou strictement avant (`strict`) ; 120 bpm avant tout événement. */
  const lookup = (at, strict = false) => {
    let best = null;
    for (const e of events) {
      const c = fCmp(e.at, at);
      if ((strict ? c < 0 : c <= 0) && (!best || fCmp(e.at, best.at) > 0)) best = e;
    }
    return best ?? DEFAULT;
  };
  const anchored = (list, read) => list.map((el) => ({ el, ...read(el) })).filter((x) => x.at !== null)
    .sort((a, b) => fCmp(a.at, b.at)); // tri stable : l'ordre de la liste départage deux tempos au même instant

  // 1. textes de tempo (MuseScore : parcours des mesures, segment par segment)
  const texts = anchored(mv.tempos.filter((t) => getProperty(t, PID.PLAY)), (el) => ({
    at: absolutePosition(layout, getProperty(el, PID.MEASURE_ID), getProperty(el, PID.POSITION)),
  }));
  let primo = null;
  for (const { el, at } of texts) {
    let kind = getProperty(el, PID.TEMPO_KIND);
    let bpm = getProperty(el, PID.TEMPO_BPM);
    let unit = getProperty(el, PID.BEAT_UNIT);
    let factor = getProperty(el, PID.TEMPO_FACTOR);
    const text = getProperty(el, PID.TEXT);
    if (getProperty(el, PID.TEMPO_FOLLOW_TEXT) && text && (kind === 'normal' || kind === 'relative')) {
      const parsed = parseTempoText(text);
      if (parsed?.kind === 'normal') { bpm = parsed.bpm; unit = parsed.beatUnit; kind = 'normal'; }
      else if (parsed?.kind === 'relative') { factor = parsed.factor; kind = 'relative'; }
    }
    if (kind === 'relative') {
      const before = lookup(at, true);
      set(at, roundWps(Math.min(MAX_WPS, Math.max(MIN_WPS, before.wps * factor))), before.unit);
    } else if (kind === 'aTempo') {
      const now = lookup(at);
      set(at, now.wps, now.unit);
    } else if (kind === 'tempoPrimo') {
      set(at, primo?.wps ?? DEFAULT_WPS, primo?.unit ?? QUARTER_UNIT);
    } else {
      const wps = wpsFromBpm(bpm, unit);
      if (!primo) primo = { wps, unit };
      set(at, wps, unit);
    }
  }

  // 2. anacrouse sans tempo : tempo du premier texte de la mesure suivante (`fixAnacrusisTempo`)
  const measureOf = (at) => {
    let mi = 0;
    while (mi + 1 < layout.starts.length && !fLt(at, layout.starts[mi + 1])) mi++;
    return mi;
  };
  const firstTextIn = (mi) => texts.find((x) => measureOf(x.at) === mi);
  mv.masterbars.forEach((bar, mi) => {
    if (mi + 1 >= mv.masterbars.length) return;
    if (!fLt(layout.lengths[mi], timeSigDuration(getProperty(bar, PID.TIME_SIG)))) return; // pas une mesure raccourcie
    if (firstTextIn(mi)) return;
    const next = firstTextIn(mi + 1);
    if (next) {
      const ev = index.get(key(next.at));
      set(layout.starts[mi], ev.wps, ev.unit);
    }
  });

  // 3. changements graduels, APRÈS tous les textes (donc « a tempo » retrouve le tempo d'avant)
  const ramps = anchored(mv.tempoChanges.filter((c) => getProperty(c, PID.PLAY)), (el) => ({
    at: absolutePosition(layout, getProperty(el, PID.MEASURE_ID), getProperty(el, PID.POSITION)),
    end: absolutePosition(layout, getProperty(el, PID.END_MEASURE_ID), getProperty(el, PID.END_POSITION)),
  }));
  for (const { el, at, end } of ramps) {
    if (!end || !fLt(at, end)) continue;
    const from = lookup(at);
    const targetBpm = getProperty(el, PID.TARGET_BPM);
    const type = getProperty(el, PID.CHANGE_TYPE);
    const to = targetBpm !== null
      ? wpsFromBpm(targetBpm, getProperty(el, PID.TARGET_BEAT_UNIT) ?? from.unit)
      : from.wps * (getProperty(el, PID.CHANGE_FACTOR) ?? GRADUAL_TYPES[type].factor);
    const curve = getProperty(el, PID.CHANGE_CURVE);
    const duration = fSub(end, at);
    const steps = Math.max(1, Math.round(fToNumber(duration) * getProperty(el, PID.CHANGE_RESOLUTION)));
    for (let i = 0; i <= steps; i++) {
      const when = fAdd(at, fMul(duration, frac(i, steps)));
      if (!index.has(key(when))) set(when, roundWps(from.wps + curveProgress(i / steps, curve) * (to - from.wps)), from.unit);
    }
  }

  // 4. points d'orgue : facteur sur [instant, instant suivant)
  const fermatas = fermataIntervals(mv, layout);
  const stretchAt = (p) => {
    for (const f of fermatas) if (!fLt(p, f.at) && fLt(p, f.end)) return f.stretch;
    return 1;
  };
  // 5. pauses des respirations : le temps s'arrête à l'instant, avant l'attaque qui y commence
  const pauses = breathPauses(mv, layout);
  const pauseAt = new Map(pauses.map((p) => [key(p.at), p.seconds]));
  const points = new Map([[key(ZERO), ZERO]]);
  for (const e of events) points.set(key(e.at), e.at);
  for (const f of fermatas) { points.set(key(f.at), f.at); points.set(key(f.end), f.end); }
  for (const p of pauses) points.set(key(p.at), p.at);
  const final = [];
  for (const p of [...points.values()].sort(fCmp)) {
    const base = lookup(p);
    const wps = roundWps(base.wps / stretchAt(p));
    const pause = pauseAt.get(key(p)) ?? 0;
    const last = final[final.length - 1];
    if (!last || last.wps !== wps || pause) final.push({ at: p, wps, unit: base.unit, pause });
  }

  // temps cumulé à chaque événement (secondes) : `arrive` = instant atteint, `time` = instant où l'attaque a lieu (après la pause éventuelle)
  let time = 0;
  final.forEach((e, i) => {
    if (i > 0) time += fToNumber(fSub(e.at, final[i - 1].at)) / final[i - 1].wps;
    e.arrive = time;
    time += e.pause;
    e.time = time;
  });
  const eventAt = (abs) => {
    let lo = 0;
    for (let i = 0; i < final.length; i++) if (fCmp(final[i].at, abs) <= 0) lo = i; else break;
    return final[lo];
  };
  return {
    layout,
    fermatas,
    events: final,
    tempoAt: (abs) => eventAt(abs).wps,
    /** Secondes depuis le début du Mouvement jusqu'à l'ATTAQUE à `abs` (pauses de respiration à `abs` comprises). */
    secondsAt: (abs) => {
      const e = eventAt(abs);
      return e.time + fToNumber(fSub(abs, e.at)) / e.wps;
    },
    /** Secondes jusqu'à la FIN d'un élément qui finit à `abs` : comme `secondsAt` mais sans la pause posée à `abs` (elle suit cet élément). */
    secondsEndAt: (abs) => {
      const e = eventAt(abs);
      return (fCmp(abs, e.at) === 0 ? e.arrive : e.time) + (fCmp(abs, e.at) === 0 ? 0 : fToNumber(fSub(abs, e.at)) / e.wps);
    },
    pauses,
    absolute: (mi, position = ZERO) => fAdd(layout.starts[mi], position),
  };
}

/** Durée en secondes entre deux positions absolues du Mouvement. */
export const secondsBetween = (timeline, a, b) => timeline.secondsAt(b) - timeline.secondsAt(a);
